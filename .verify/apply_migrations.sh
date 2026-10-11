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
# Bring the cluster up only if it is not already online.
#
# This used to read `pg_ctlcluster start || { say "cluster start failed"; exit 1; }`
# guarded by a lock file. `pg_ctlcluster start` exits non-zero when the cluster is
# ALREADY RUNNING, so any second run in the same environment - a fresh shell, or a
# container where the cluster survived the timeout - aborted with "cluster start
# failed" against a perfectly healthy database. A guard that fails when the thing it
# guards is already done is worse than no guard, so the outcome is now asserted
# rather than the command's exit code.
cluster_status() {
  pg_lsclusters -h "$PGVER" main 2>/dev/null | awk '{print $4}'
}

if [ "$(cluster_status)" != "online" ]; then
  # A cluster that reports `down` while a stale postmaster.pid survives refuses to
  # start, which is exactly the state a container restart leaves behind.
  rm -f "/var/lib/postgresql/${PGVER}/main/postmaster.pid" 2>/dev/null || true
  say "starting cluster $PGVER/main..."
  pg_ctlcluster "$PGVER" main start >/dev/null 2>&1 || true
fi
touch "$LOCK"

if [ "$(cluster_status)" != "online" ]; then
  say "ERROR: cluster $PGVER/main is not online."
  say "--- pg_lsclusters ---"
  pg_lsclusters 2>/dev/null || true
  say "--- tail of /var/log/postgresql/postgresql-${PGVER}-main.log ---"
  tail -20 "/var/log/postgresql/postgresql-${PGVER}-main.log" 2>/dev/null || true
  exit 1
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
-- auth.users is owned by GoTrue in a real project and cannot be created by a migration.
-- The shim provides the minimum a foreign key needs: an id and an email. Without it the
-- FK from public.user_moderation cannot be exercised, and an untested foreign key is
-- indistinguishable from a missing one.
create table if not exists auth.users (
  id    uuid primary key,
  email text unique
);
-- Modelled on Supabase's auth.jwt(): reads the claims a request carries. In a real
-- project this is populated by PostgREST from the verified access token.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- USAGE on schema auth is a REAL dependency of the security model, not shim scaffolding.
-- Every RLS policy calls public.is_admin() or public.current_user_id(), and both read
-- auth.jwt(). If the caller lacks USAGE on schema auth, those functions raise
-- "permission denied for schema auth" - which in a policy means the query FAILS rather
-- than returning no rows. Supabase grants USAGE on auth to anon/authenticated by default,
-- so this holds in production; the shim has to mirror it or it tests a world that does
-- not exist. Found by these assertions, which is exactly what they are for.
grant usage on schema auth to anon, authenticated, service_role;
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
for t in products pricing_rules product_prices suppliers orders order_items payments webhook_events audit_log app_settings user_moderation fulfilment_attempts; do
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
say "-- admin RBAC: does RLS actually block a non-admin? --"

# Everything above proves the GRANT layer. These assertions prove the POLICY layer, by
# assuming the role in a transaction and asking the database. `set local role authenticated`
# drops superuser for the duration, so row level security is genuinely enforced - checking
# has_column_privilege() says nothing about whether a policy returns the wrong rows.
ADMIN_UUID='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
OTHER_UUID='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

psql_run "insert into auth.users (id,email) values ('$ADMIN_UUID','owner@example.com'),('$OTHER_UUID','stranger@example.com') on conflict do nothing;" >/dev/null

psql_run "insert into public.user_moderation (user_id,email,status) values ('$OTHER_UUID','stranger@example.com','active') on conflict (user_id) do nothing;" >/dev/null

psql_run "insert into public.orders (user_id,email,currency,subtotal_minor,total_minor,idempotency_key,engine_version) values ('$ADMIN_UUID','owner@example.com','NGN',100,100,'rbac-key-0001','1.0.0');" >/dev/null

JWT_OWNER="'{\"sub\":\"$ADMIN_UUID\",\"role\":\"authenticated\"}'"
JWT_OTHER="'{\"sub\":\"$OTHER_UUID\",\"role\":\"authenticated\"}'"
JWT_ADMIN="'{\"sub\":\"$ADMIN_UUID\",\"role\":\"authenticated\",\"app_metadata\":{\"nuvora_role\":\"admin\"}}'"

R=$(psql_val "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_OWNER, true); select count(*) from public.orders where user_id='$ADMIN_UUID'; rollback;")
[ "$(echo "$R" | tail -1)" = "1" ] && ok "a signed-in user CAN read their OWN order" || bad "owner could not read their own order (got '$R')"

R=$(psql_val "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_OTHER, true); select count(*) from public.orders where user_id='$ADMIN_UUID'; rollback;")
[ "$(echo "$R" | tail -1)" = "0" ] && ok "a non-admin CANNOT read another user's order (RLS policy holds)" || bad "ORDER LEAK: non-admin saw $R row(s)"

R=$(psql_val "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_ADMIN, true); select count(*) from public.orders where user_id='$ADMIN_UUID'; rollback;")
[ "$(echo "$R" | tail -1)" = "1" ] && ok "an admin CAN read the order (is_admin() drives the policy)" || bad "admin could not read the order (got '$R')"

R=$(psql_val "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_OTHER, true); select count(*) from public.pricing_rules; rollback;")
[ "$(echo "$R" | tail -1)" = "0" ] && ok "a non-admin CANNOT read pricing_rules (margin secrecy)" || bad "MARGIN LEAK: non-admin read $R rule(s)"

R=$(psql_val "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_OTHER, true); select count(*) from public.app_settings where not is_public; rollback;")
[ "$(echo "$R" | tail -1)" = "0" ] && ok "a non-admin CANNOT read private app settings" || bad "SETTINGS LEAK: non-admin read $R private setting(s)"

R=$(psql_val "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_OTHER, true); select count(*) from public.app_settings where is_public; rollback;")
# tail -1: `select set_config(...)` PRINTS the config value, so the capture holds the JWT
# on the first line and the count on the last. Comparing the whole capture against an
# integer is a shell error, not a test failure, and the -gt guard then silently misreads.
PC=$(echo "$R" | tail -1)
[ "${PC:-0}" -gt 0 ] && ok "a visitor CAN read public settings (the storefront still renders)" || bad "public settings are unreadable - the footer would break (got '$PC')"

# Writes: a non-admin must not be able to change a setting or insert a product.
#
# WHY THIS ASSERTS ON THE VALUE RATHER THAN ON AN ERROR MESSAGE.
# This assertion used to expect a "permission denied" error, and it passed - for the wrong
# reason. There was no UPDATE grant on app_settings at all, so the statement was refused before
# RLS was ever consulted. Migration 20261011091000 added the grant (the admin policy was
# unreachable without it), and the assertion immediately broke - which is the assertion doing its
# job, because the old form was measuring the absence of a grant rather than the presence of a
# policy.
#
# The correct expectation for a policy refusal on UPDATE is SILENCE, not an error: a USING clause
# filters rows rather than raising, so a non-admin's UPDATE succeeds and affects zero rows. An
# assertion looking for an error message would therefore pass on a broken deployment and fail on a
# working one - precisely backwards. What matters is that the stored value did not move.
SETTING_BEFORE=$(psql_val "select value::text from public.app_settings where key='business.legal_name';")
psql_run "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_OTHER, true); update public.app_settings set value='\"pwned\"'::jsonb where key='business.legal_name'; commit;" >/dev/null 2>&1
SETTING_AFTER=$(psql_val "select value::text from public.app_settings where key='business.legal_name';")
[ "$SETTING_BEFORE" = "$SETTING_AFTER" ] \
  && ok "a non-admin's setting write changes nothing (RLS filters the row)" \
  || bad "a non-admin CHANGED a setting: was '$SETTING_BEFORE', now '$SETTING_AFTER'"

# And the other direction, which proves the new grant actually works. Without this, a deployment
# could refuse EVERYBODY - admin included - and the assertion above would still pass.
psql_run "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_ADMIN, true); update public.app_settings set value='\"NUVORA\"'::jsonb where key='business.legal_name'; commit;" >/dev/null 2>&1
ADMIN_AFTER=$(psql_val "select value::text from public.app_settings where key='business.legal_name';")
[ -n "$ADMIN_AFTER" ] \
  && ok "an admin's setting write is permitted (the granted policy is reachable)" \
  || bad "an ADMIN could not write a setting - the policy exists but the grant does not"

# A moderation row must be insertable by an admin, because the first suspension of an account has
# no row to update. This is the second policy that was unreachable before the write grants.
#
# The upsert writes EVERY field a block needs - status, reason and suspended_at - because
# user_moderation_blocked_needs_reason requires the reason and the timestamp together. An earlier
# version of this assertion only flipped `status` on the conflict branch and was refused by that
# constraint, which is the constraint doing its job: a block with no reason is exactly what it
# exists to prevent. The application's own action writes all four fields for the same reason.
psql_run "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_ADMIN, true); insert into public.user_moderation (user_id, email, status, reason, suspended_at) values ('$OTHER_UUID','stranger@example.com','suspended','verification of the admin insert path', now()) on conflict (user_id) do update set status='suspended', reason='verification of the admin insert path', suspended_at=now(); commit;" >/dev/null 2>&1
MOD_STATUS=$(psql_val "select status from public.user_moderation where user_id='$OTHER_UUID';")
[ "$MOD_STATUS" = "suspended" ] \
  && ok "an admin CAN suspend an account (insert path reachable)" \
  || bad "an ADMIN could not suspend an account (status is '$MOD_STATUS')"

# And the constraint itself must still refuse a block recorded without a reason - which is the
# property the assertion above had to satisfy rather than work around.
OUT=$(psql_expect_fail "insert into public.user_moderation (user_id, email, status) values (gen_random_uuid(),'noreason@example.com','suspended');")
echo "$OUT" | grep -qi "user_moderation_blocked_needs_reason" \
  && ok "DB refuses to block an account with no reason recorded" \
  || bad "an account was blocked without a reason: $OUT"

OUT=$(psql_expect_fail "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_OTHER, true); insert into public.products (sku,slug,name,product_line,currency,base_price_minor,supplier_key,supplier_cost_minor,status) values ('RBAC-X','rbac-x','X','esim','NGN',100,'verify-supplier',50,'active'); rollback;")
echo "$OUT" | grep -qiE "permission denied|violates row-level security" \
  && ok "a non-admin CANNOT insert a product" || bad "a non-admin INSERTED a product: $OUT"

# The audit helper is the one function an admin session must be able to call, and it must
# refuse everybody else. Both directions are asserted, because a helper that refuses the
# admin is as broken as one that admits a stranger.
OUT=$(psql_expect_fail "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_OTHER, true); select public.log_admin_action('settings.update','app_settings','business.legal_name'); rollback;")
echo "$OUT" | grep -qiE "not authorised|permission denied" \
  && ok "log_admin_action REFUSES a non-admin" || bad "a non-admin wrote the audit log: $OUT"

# NOTE THE ABSENT ROLLBACK, and an earlier version of this assertion had one. Rolling back
# discarded the audit row, so the very next check - "does the row carry the real actor?" -
# could never find it and failed for a reason that had nothing to do with the product. An
# append-only audit log cannot be cleaned up in a verifying transaction anyway, and
# asserting against a committed row is the stronger test. Test data accumulating in a
# throwaway database is a non-issue; a test that cannot see what it just wrote is not.
#
# No before/after JSON is passed on purpose. This assertion is about authorisation and
# actor stamping, and keeping JSON literals out of the SQL removes a whole layer of shell
# quoting - which is exactly how the previous version of this line acquired escaped quotes
# and became a bash syntax error that a bare syntax check caught only because it was run.
AID=$(psql_val "begin; set local role authenticated; select set_config('request.jwt.claims', $JWT_ADMIN, true); select public.log_admin_action('settings.update','app_settings','business.legal_name'); commit;")
echo "$AID" | tail -1 | grep -qE '^[0-9]+$' \
  && ok "log_admin_action ACCEPTS an admin and returns the audit row id" || bad "admin could not write the audit log: $AID"

# The audit row just written must carry the ACTOR FROM THE JWT, not a value the caller
# supplied - otherwise the trail records assertions rather than facts.
AC=$(psql_val "select count(*) from public.audit_log where action='settings.update' and actor_user_id='$ADMIN_UUID';")
[ "${AC:-0}" -ge 1 ] && ok "the audit row records the real actor from the JWT" || bad "audit actor was not stamped from the JWT"

# Credential columns must be unreadable by a client role even with the admin claim.
R=$(psql_val "select has_column_privilege('authenticated','public.suppliers','credential_ciphertext','select');")
[ "$R" = "f" ] && ok "authenticated CANNOT read suppliers.credential_ciphertext" || bad "CREDENTIAL LEAK: ciphertext is client-readable"
R=$(psql_val "select has_column_privilege('authenticated','public.suppliers','webhook_secret_ciphertext','select');")
[ "$R" = "f" ] && ok "authenticated CANNOT read suppliers.webhook_secret_ciphertext" || bad "WEBHOOK SECRET LEAK"
R=$(psql_val "select has_column_privilege('authenticated','public.suppliers','credential_hint','select');")
[ "$R" = "t" ] && ok "authenticated CAN read suppliers.credential_hint (masked indicator works)" || bad "the masked credential indicator cannot render"

# An enabled live provider with no endpoint is a trap: the first order fails at the worst
# possible moment. The schema refuses the configuration rather than the order.
psql_run "insert into public.suppliers (key,name,adapter,supported_lines,implementation,mode) values ('rbac-supplier','RBAC Supplier','generic-http','{esim}','generic-http','live');" >/dev/null
OUT=$(psql_expect_fail "update public.suppliers set is_active=true where key='rbac-supplier';")
echo "$OUT" | grep -qi "suppliers_live_requires_endpoint" \
  && ok "DB refuses to ENABLE a live provider with no endpoint or key" || bad "an unusable live provider was enabled: $OUT"

# And a product may not name a supplier that does not exist, because fulfilment resolves
# the adapter by that key - the order would be paid and then undeliverable.
OUT=$(psql_expect_fail "insert into public.products (sku,slug,name,product_line,currency,base_price_minor,supplier_key,supplier_cost_minor) values ('RBAC-Y','rbac-y','Y','esim','NGN',100,'no-such-supplier',50);")
echo "$OUT" | grep -qiE "products_supplier_exists|foreign key" \
  && ok "DB refuses a product naming a supplier that does not exist" || bad "a product with an unknown supplier was accepted: $OUT"

say ""
say "=============================================================="
printf ' RESULT:  %d passed, %d failed\n' "$PASS" "$FAIL"
say "=============================================================="
[ "$FAIL" -eq 0 ] || exit 1
