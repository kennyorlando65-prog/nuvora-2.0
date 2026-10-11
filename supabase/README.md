# Supabase migrations

Versioned SQL, applied in **filename order**. The filename timestamp is the version: it
is chosen so that lexicographic order equals apply order.

| File | Contents |
| --- | --- |
| `20261011090000_init_extensions_helpers.sql` | Extensions, `touch_updated_at`, auth helpers |
| `20261011090100_enums.sql` | Every enumerated domain |
| `20261011090200_catalogue.sql` | `suppliers`, `products`, `pricing_rules`, `product_prices` |
| `20261011090300_orders.sql` | `orders`, `order_items`, order number generator |
| `20261011090400_payments.sql` | `payments`, `webhook_events` |
| `20261011090500_audit_log.sql` | `audit_log` and its triggers |
| `20261011090600_rls_and_grants.sql` | **Security boundary.** RLS, column secrecy, grants |

## Applying them

```bash
# With the Supabase CLI linked to the project
supabase link --project-ref <PROJECT_REF>
supabase db push

# Without the CLI: open the SQL editor and run each file in filename order.
```

The migrations reference Supabase's predefined roles (`anon`, `authenticated`,
`service_role`) and the `auth.jwt()` function. They are written for a Supabase project,
not a bare Postgres instance.

## Drift policy

The repository is authoritative. If the live database and these files disagree, the
live database is wrong: correct it by adding a new migration, never by editing the live
schema by hand. A hand-edited schema silently diverges and the next `db push` cannot
reproduce the environment.

## Rules for new migrations

1. **Never edit an applied migration.** Add a new file.
2. **RLS and grants land with the table.** A new buyer-facing table without RLS is a
   data leak, not an incomplete feature.
3. **A new sensitive column must be added to the revoke list** in the same migration
   that creates it. Supabase's default privileges grant `SELECT` on new columns, so
   omitting this step silently publishes our supplier cost.
4. **Money is always `bigint` minor units** in a column named `*_minor`, always beside
   its own currency code. Never floating point.
5. **State the invariant as a `CHECK` constraint.** If the application relies on it,
   the database should refuse to store anything else.

## No product data is seeded

No migration inserts products, prices or suppliers. The catalogue is populated with real
supplier data, not fixtures, so that a demo row can never be mistaken for something
purchasable. The sandbox supplier adapter is selected by environment variable
(`PROVIDER_MODE`) and needs no database row.

## Verifying a migration set before applying

```bash
# Applies every migration to a throwaway PostgreSQL cluster and asserts the security
# invariants. Requires a local postgres; see the script header for details.
bash .verify/apply_migrations.sh
```

The harness reaches the migrations through a Supabase compatibility shim providing only
what a bare PostgreSQL lacks: the `anon` / `authenticated` / `service_role` roles and
`auth.jwt()`. The migration SQL itself is not modified in any way.

As of 2026-10-11 it reports **53 assertions passed, 0 failed**, covering: table
presence, RLS enabled on every table, column-level secrecy of supplier cost and margin,
server-only writes, audit immutability, and runtime rejection of below-cost pricing, an
inconsistent margin, an inconsistent order total, a duplicate idempotency key, a second
successful payment on one order, an unverified 'succeeded' payment, a replayed webhook
event, and `raw_payload` leakage into the audit trail.
