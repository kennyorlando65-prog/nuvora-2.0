#!/usr/bin/env bash
# =============================================================================
# NUVORA 2.0  |  migration verification harness
#
# Applies supabase/migrations/*.sql IN ORDER against a throwaway PostgreSQL
# cluster, then asserts the security invariants that matter:
#
#   1. every expected table exists
#   2. RLS is ENABLED on every table (a table without RLS is a data leak)
#   3. anon/authenticated CANNOT read supplier cost or margin columns
#   4. anon CANNOT read pricing_rules, suppliers, webhook_events or audit_log
#   5. anon/authenticated CANNOT write orders, order_items or payments
#   6. a second 'succeeded' payment on one order is REJECTED by the database
#   7. an order total that contradicts its parts is REJECTED
#   8. a line total that contradicts unit_price * quantity is REJECTED
#   9. the audit trigger fires, and redacts raw_payload from the trail
#  10. a replayed (provider, event_id) webhook is REJECTED
#  11. a webhook event may be freshly received, processed, or failed - and may never
#      be both processed and errored (the Stage 6 constraint fix, which was caught
#      only because these assertions were run rather than reasoned about)
#
# The migration files target Supabase, so a shim supplies only what a bare
# PostgreSQL lacks: the anon/authenticated/service_role roles, and auth.jwt().
# Nothing else is stubbed - the SQL under test runs exactly as written.
#
# Usage:  bash .verify/apply_migrations.sh      (run from the repository root)
# Exit:   0 = all assertions passed; 1 = at least one failed
# =============================================================================
set -uo pipefail

PGVER="${PGVER:-15}"
LOCK=/tmp/.nuvora_pg
DB=nuvora_verify
PASS=0
FAIL=0

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); printf '  PASS  %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL  %s\n' "$*"; }

# SQL is passed through a file, never an inline -c string: inline strings get
# mangled by shell quoting, which produced false failures on an earlier run.
psql_val() {
  printf '%s\n' "$1" > /tmp/nuvora_q.sql
  su postgres -c "psql -tAqX -v ON_ERROR_STOP=1 -d $DB -f /tmp/nuvora_q.sql" 2>&1
}
psql_run() {
  printf '%s\n' "$1" > /tmp/nuvora_q.sql
  su postgres -c "psql -qX -v ON_ERROR_STOP=1 -d $DB -f /tmp/nuvora_q.sql" 2>&1
}
# A statement expected to FAIL; returns the error text.
psql_expect_fail() {
  printf '%s\n' "$1" > /tmp/nuvora_q.sql
  su postgres -c "psql -qX -v ON_ERROR_STOP=1 -d $DB -f /tmp/nuvora_q.sql" 2>&1
}

say "=============================================================="
say " NUVORA migration verification - PostgreSQL $PGVER"
say "=============================================================="

# The migrations directory is resolved relative to the CWD. Run from anywhere else,
# the apply loop below silently iterates over nothing and the harness reports a
# spurious failure. Say so instead of producing a confusing one.
if [ ! -d "supabase/migrations" ]; then
  say "ERROR: run this from the repository root (supabase/migrations not found in $PWD)."
  exit 1
fi

# --- 1. cluster + database ----------------------------------------------------
if [ ! -f "$LOCK" ]; then
  say "starting cluster..."
  pg_ctlcluster "$PGVER" main start >/dev/null 2>&1 || { say "cluster start failed"; exit 1; }
  touch "$LOCK"
fi

su postgres -c "dropdb --if-exists $DB" >/dev/null 2>&1
su postgres -c "createdb $DB" >/dev/null 2>&1 || { say "createdb failed"; exit 1; }

# --- 2. Supabase compatibility shim ------------------------------------------
say "applying Supabase shim (roles + auth.jwt)..."
cat > /tmp/nuvora_shim.sql <<'SQL'
-- Roles are cluster-level and outlive the database, so creation is guarded to keep
-- repeated runs of this harness idempotent.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;
create schema if not exists auth;
-- Modelled on Supabase's auth.jwt(): reads the claims a request carries. In a real
-- project this is populated by PostgREST from the verified access token.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
SQL
su postgres -c "psql -qX -v ON_ERROR_STOP=1 -d $DB -f /tmp/nuvora_shim.sql" >/dev/null 2>&1 \
  && ok "shim applied" || { bad "shim failed"; exit 1; }

# --- 3. apply migrations in filename order -----------------------------------
say ""
say "-- applying migrations in order --"
MIG_FAIL=0
for f in $(ls supabase/migrations/*.sql | sort); do
  OUT=$(su postgres -c "psql -qX -v ON_ERROR_STOP=1 -d $DB -f /workspace/$f" 2>&1)
  if [ $? -eq 0 ]; then
    say "  applied  $(basename "$f")"
  else
    say "  ERROR    $(basename "$f")"
    say "$OUT" | tail -12
    MIG_FAIL=1
  fi
done
[ "$MIG_FAIL" -eq 0 ] && ok "all migration files applied cleanly" || bad "one or more migrations failed to apply"

say ""
say "-- security invariants --"

# --- 4. tables exist ---------------------------------------------------------
for t in products pricing_rules product_prices suppliers orders order_items payments webhook_events audit_log; do
  C=$(psql_val "select count(*) from information_schema.tables where table_schema='public' and table_name='$t';")
  [ "$C" = "1" ] && ok "table public.$t exists" || bad "table public.$t MISSING"
done

# --- 5. RLS enabled everywhere ----------------------------------------------
RLS_OUT=$(psql_val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;")
[ "$RLS_OUT" = "0" ] \
  && ok "RLS enabled on every public table (0 tables without it)" \
  || bad "RLS DISABLED on $RLS_OUT public table(s)"

# --- 6. column secrecy: the commercial secret -------------------------------
for col in supplier_cost_minor supplier_reference supplier_currency; do
  R=$(psql_val "select has_column_privilege('anon','public.products','$col','select');")
  [ "$R" = "f" ] && ok "anon CANNOT read products.$col" || bad "anon CAN read products.$col - COST LEAK"
done
for col in supplier_cost_minor supplier_currency; do
  R=$(psql_val "select has_column_privilege('authenticated','public.products','$col','select');")
  [ "$R" = "f" ] && ok "authenticated CANNOT read products.$col" || bad "authenticated CAN read products.$col - COST LEAK"
done
for col in margin_minor supplier_cost_minor; do
  R=$(psql_val "select has_column_privilege('anon','public.product_prices','$col','select');")
  [ "$R" = "f" ] && ok "anon CANNOT read product_prices.$col" || bad "anon CAN read product_prices.$col - MARGIN LEAK"
done
R=$(psql_val "select has_column_privilege('authenticated','public.order_items','unit_cost_minor','select');")
[ "$R" = "f" ] && ok "authenticated CANNOT read order_items.unit_cost_minor" || bad "authenticated CAN read order_items.unit_cost_minor - COST LEAK"
R=$(psql_val "select has_column_privilege('anon','public.payments','raw_payload','select');")
[ "$R" = "f" ] && ok "anon CANNOT read payments.raw_payload" || bad "anon CAN read payments.raw_payload"

# The other direction: the customer-facing price MUST be readable, or the store
# cannot render a catalogue at all. A security test that only checks "denied"
# would pass on a completely broken deployment.
R=$(psql_val "select has_column_privilege('anon','public.product_prices','customer_price_minor','select');")
[ "$R" = "t" ] && ok "anon CAN read product_prices.customer_price_minor (store renders)" || bad "anon CANNOT read the customer price - store would break"

# --- 7. server-only internals ------------------------------------------------
for t in pricing_rules suppliers webhook_events audit_log; do
  R=$(psql_val "select has_table_privilege('anon','public.$t','select');")
  [ "$R" = "f" ] && ok "anon CANNOT select $t" || bad "anon CAN select $t"
done

# --- 8. writes are server-only ----------------------------------------------
for t in orders order_items payments; do
  for priv in insert update delete; do
    R=$(psql_val "select has_table_privilege('authenticated','public.$t','$priv');")
    [ "$R" = "f" ] && ok "authenticated CANNOT $priv $t" || bad "authenticated CAN $priv $t - client-writable money path"
  done
done
R=$(psql_val "select has_table_privilege('anon','public.orders','insert');")
[ "$R" = "f" ] && ok "anon CANNOT insert orders" || bad "anon CAN insert orders"

# --- 9. audit log is append-only --------------------------------------------
R=$(psql_val "select has_table_privilege('service_role','public.audit_log','update');")
[ "$R" = "f" ] && ok "not even service_role can UPDATE audit_log (immutable trail)" || bad "audit_log is updatable"
R=$(psql_val "select has_table_privilege('service_role','public.audit_log','delete');")
[ "$R" = "f" ] && ok "not even service_role can DELETE audit_log" || bad "audit_log is deletable"

# --- 10. runtime behaviour ---------------------------------------------------
say ""
say "-- runtime behaviour --"

psql_run "insert into public.suppliers (key,name,adapter,supported_lines) values ('verify-supplier','Verification Supplier','esim-sandbox','{esim}');" >/dev/null

PID=$(psql_val "insert into public.products (sku,slug,name,product_line,currency,base_price_minor,supplier_key,supplier_cost_minor,status,coverage_regions) values ('VERIFY-1','verify-1','Verification eSIM','esim','NGN',500000,'verify-supplier',400000,'active','{NG}') returning id;")
[ -n "$PID" ] && ok "product insert succeeded" || bad "product insert failed: $PID"

OUT=$(psql_expect_fail "insert into public.products (sku,slug,name,product_line,currency,base_price_minor,supplier_key,supplier_cost_minor) values ('VERIFY-2','verify-2','Below cost','esim','NGN',100,'verify-supplier',5000);")
echo "$OUT" | grep -qi "products_never_sell_below_cost" \
  && ok "DB refuses a product priced below supplier cost" || bad "below-cost product was NOT refused"

PRICE=$(psql_val "insert into public.product_prices (product_id,currency,supplier_cost_minor,margin_minor,customer_price_minor,engine_version) values ('$PID','NGN',400000,100000,500000,'1.0.0') returning id;")
[ -n "$PRICE" ] && ok "price snapshot insert succeeded" || bad "price snapshot insert failed: $PRICE"

OUT=$(psql_expect_fail "insert into public.product_prices (product_id,currency,supplier_cost_minor,margin_minor,customer_price_minor,engine_version) values ('$PID','NGN',400000,999999,500000,'1.0.0');")
echo "$OUT" | grep -qi "product_prices_margin_consistent" \
  && ok "DB refuses an inconsistent margin (price - cost must equal margin)" || bad "inconsistent margin was NOT refused"

OID=$(psql_val "insert into public.orders (email,currency,subtotal_minor,total_minor,idempotency_key,engine_version) values ('verify@example.com','NGN',500000,500000,'verify-key-0001','1.0.0') returning id;")
[ -n "$OID" ] && ok "order insert succeeded" || bad "order insert failed: $OID"
ONUM=$(psql_val "select order_number from public.orders where id='$OID';")
echo "$ONUM" | grep -qE '^NUV-[0-9]{8}-[0-9]{6}$' \
  && ok "order number in NUV-YYYYMMDD-NNNNNN form ($ONUM)" || bad "order number malformed: $ONUM"

OUT=$(psql_expect_fail "insert into public.orders (email,currency,subtotal_minor,discount_minor,total_minor,idempotency_key,engine_version) values ('verify@example.com','NGN',500000,100000,999999,'verify-key-0002','1.0.0');")
echo "$OUT" | grep -qi "orders_total_consistent" \
  && ok "DB refuses an order whose total contradicts its parts" || bad "inconsistent order total was NOT refused"

OUT=$(psql_expect_fail "insert into public.orders (email,currency,subtotal_minor,total_minor,idempotency_key,engine_version) values ('verify@example.com','NGN',500000,500000,'verify-key-0001','1.0.0');")
echo "$OUT" | grep -qiE "orders_idempotency_key_idx|duplicate key" \
  && ok "DB refuses a duplicate idempotency key (retry cannot double-charge)" || bad "duplicate idempotency key was NOT refused"

IID=$(psql_val "insert into public.order_items (order_id,product_id,product_name,product_line,unit_price_minor,unit_cost_minor,quantity,line_total_minor) values ('$OID','$PID','Verification eSIM','esim',500000,400000,1,500000) returning id;")
[ -n "$IID" ] && ok "order line insert succeeded" || bad "order line insert failed: $IID"

OUT=$(psql_expect_fail "insert into public.order_items (order_id,product_id,product_name,product_line,unit_price_minor,unit_cost_minor,quantity,line_total_minor) values ('$OID','$PID','x','esim',500000,400000,3,100);")
echo "$OUT" | grep -qi "order_items_total_consistent" \
  && ok "DB refuses a line total != unit_price * quantity" || bad "inconsistent line total was NOT refused"

# The most important runtime assertion in the schema.
psql_run "insert into public.payments (order_id,provider,provider_reference,status,amount_minor,currency,verified_at) values ('$OID','paystack','verify-ref-1','succeeded',500000,'NGN',now());" >/dev/null
OUT=$(psql_expect_fail "insert into public.payments (order_id,provider,provider_reference,status,amount_minor,currency,verified_at) values ('$OID','paystack','verify-ref-2','succeeded',500000,'NGN',now());")
echo "$OUT" | grep -qiE "payments_one_success_per_order|duplicate key" \
  && ok "DB refuses a SECOND successful payment on one order (double-charge blocked)" \
  || bad "a second successful payment was accepted - DOUBLE CHARGE POSSIBLE"

OUT=$(psql_expect_fail "insert into public.payments (order_id,provider,provider_reference,status,amount_minor,currency) values ('$OID','paystack','verify-ref-3','succeeded',500000,'NGN');")
echo "$OUT" | grep -qi "payments_succeeded_requires_verification" \
  && ok "DB refuses 'succeeded' without a verification timestamp" || bad "'succeeded' was accepted unverified"

psql_run "insert into public.webhook_events (provider,event_id,event_type,signature_valid,payload) values ('paystack','evt-verify-1','charge.success',true,'{}'::jsonb);" >/dev/null
OUT=$(psql_expect_fail "insert into public.webhook_events (provider,event_id,event_type,signature_valid,payload) values ('paystack','evt-verify-1','charge.success',true,'{}'::jsonb);")
echo "$OUT" | grep -qiE "webhook_events_provider_event_idx|duplicate key" \
  && ok "DB refuses a replayed webhook event (idempotent by constraint)" \
  || bad "duplicate webhook event was accepted"

# --- 11. webhook_events processed-consistency --------------------------------
# Added with the Stage 6 fix. The constraint in 20261011090400 originally FORBADE the
# normal success state - setting processed_at alone violated it - which would have broken
# the last step of the money-critical path on every webhook. A first correction then
# forced exactly one of the two columns and FORBADE the freshly-received row. These four
# assertions pin all four lifecycle states so neither mistake can come back.
say ""
say "-- webhook_events processed consistency --"

OUT=$(psql_run "insert into public.webhook_events (provider,event_id,event_type,signature_valid,payload,processed_at) values ('paystack','evt-xor-ok','charge.success',true,'{}'::jsonb,now());")
[ -z "$OUT" ] && ok "webhook event CAN be marked processed (processed_at set, no error)" \
  || bad "marking a webhook event processed was REFUSED: $OUT"

OUT=$(psql_run "insert into public.webhook_events (provider,event_id,event_type,signature_valid,payload,processing_error) values ('paystack','evt-xor-fail','charge.success',true,'{}'::jsonb,'gateway unreachable');")
[ -z "$OUT" ] && ok "webhook event CAN be marked failed for retry (processing_error set)" \
  || bad "marking a webhook event failed was REFUSED: $OUT"

OUT=$(psql_run "insert into public.webhook_events (provider,event_id,event_type,signature_valid,payload) values ('paystack','evt-xor-neither','charge.success',true,'{}'::jsonb);")
[ -z "$OUT" ] && ok "a freshly received event is ACCEPTED before processing (neither column set)" \
  || bad "a newly received webhook event was REFUSED, so inserts would fail in production: $OUT"

OUT=$(psql_expect_fail "insert into public.webhook_events (provider,event_id,event_type,signature_valid,payload,processed_at,processing_error) values ('paystack','evt-xor-both','charge.success',true,'{}'::jsonb,now(),'also an error');")
echo "$OUT" | grep -qi "webhook_events_processed_consistent" \
  && ok "DB refuses an event that is both processed and errored" \
  || bad "an event marked both processed and errored was accepted"

# The audit trigger must fire on every table it is attached to.
AC=$(psql_val "select count(distinct entity_table) from public.audit_log where entity_table in ('orders','order_items','payments','products','product_prices');")
[ "${AC:-0}" -ge 5 ] && ok "audit trigger fired on all 5 audited tables" || bad "audit trigger covered only $AC tables"

# Redaction: put a sentinel in raw_payload, update the row, and confirm the
# sentinel never reaches audit_log.
psql_run "update public.payments set raw_payload = '{\"sentinel\":\"NUVORA_SENTINEL_RAW_PAYLOAD\"}'::jsonb where order_id='$OID';" >/dev/null
RP=$(psql_val "select count(*) from public.audit_log where after::text like '%NUVORA_SENTINEL_RAW_PAYLOAD%' or before::text like '%NUVORA_SENTINEL_RAW_PAYLOAD%';")
[ "$RP" = "0" ] && ok "raw_payload is redacted out of the audit trail" || bad "raw_payload LEAKED into audit_log ($RP rows)"

say ""
say "=============================================================="
printf ' RESULT:  %d passed, %d failed\n' "$PASS" "$FAIL"
say "=============================================================="
[ "$FAIL" -eq 0 ] || exit 1
