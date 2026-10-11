# Admin access control: what is proven, and how

This document exists because the brief for the admin area asked for a test or a documented
manual check proving that **a non-admin authenticated user cannot read another user's orders**.
Rather than assert that here, this file points at the check that actually runs, and states
plainly which layer proves what.

## The short version

The proof is executable, not descriptive:

```bash
bash .verify/apply_migrations.sh
```

It applies every migration in `supabase/migrations/` to a throwaway PostgreSQL cluster and then
runs **98 assertions**, of which the last groups exercise Row Level Security *as a real role*
rather than by inspecting grants.

## Why "as a real role" matters

`has_column_privilege()` and `has_table_privilege()` prove the GRANT layer. They say nothing
about which ROWS a policy returns. A table can be perfectly granted and still leak every row if
its policy is wrong, and a policy can be perfectly written and permit nothing if the grant is
missing - both mistakes have already occurred in this project and both were caught by running
the harness rather than by reading the SQL.

So these assertions do this instead:

```sql
begin;
set local role authenticated;                                   -- drops superuser for the transaction
select set_config('request.jwt.claims', '<claims>', true);      -- as PostgREST would
select count(*) from public.orders where user_id = '<someone else>';
rollback;
```

`set local role authenticated` means RLS is genuinely enforced, and the count is the real answer.

## The specific assertions

| Assertion | What a failure would mean |
|---|---|
| a signed-in user CAN read their OWN order | Customers cannot see their own purchases |
| **a non-admin CANNOT read another user's order** | **The core claim of this document** |
| an admin CAN read the order (`is_admin()` drives the policy) | Admins are locked out; the policy is inverted |
| a non-admin CANNOT read `pricing_rules` | Margin structure leaks to any signed-in user |
| a non-admin CANNOT read private `app_settings` | Internal configuration leaks |
| a visitor CAN read public `app_settings` | The storefront footer breaks |
| a non-admin's setting write changes nothing | A customer could rewrite business configuration |
| an admin's setting write is permitted | The admin policy exists but its grant does not |
| a non-admin CANNOT insert a product | A customer could add catalogue entries |
| `log_admin_action` REFUSES a non-admin | A customer could forge the audit trail |
| `log_admin_action` ACCEPTS an admin and returns the row id | The audit helper refuses its intended caller |
| the audit row records the real actor from the JWT | The trail records assertions, not facts |
| `authenticated` CANNOT read `suppliers.credential_ciphertext` | Supplier API keys reach a browser |
| `authenticated` CANNOT read `suppliers.webhook_secret_ciphertext` | Callback forgery becomes possible |
| `authenticated` CAN read `suppliers.credential_hint` | The masked indicator cannot render |

Both directions are asserted deliberately. A security check that only ever asserts "denied"
passes on a completely broken deployment in which nobody can do anything - which is why every
"cannot" above is paired with a "can" that would break if the check were vacuous.

## The two layers, and why both are needed

**Layer 1 - column grants.** `anon` and `authenticated` cannot read `products.supplier_cost_minor`,
`product_prices.margin_minor`, `order_items.unit_cost_minor` or `payments.raw_payload`. This is
per-role, not per-row, so RLS cannot express it: a policy grants rows, and PostgREST still refuses
the columns. That is why the admin order and product pages read cost and margin through
`requireAdminColumns()`, which runs the gate and then returns a service-role reader.

**Layer 2 - RLS policies.** Written in the same migration that creates each table. Twelve tables
now. `is_admin()` reads `app_metadata.nuvora_role` from the verified JWT - deliberately
`app_metadata` rather than `user_metadata`, because a user can write their own `user_metadata`,
which would make every admin policy self-service.

## What is NOT proven here

- **The application layer.** The harness proves the database refuses a non-admin. It does not
  prove `middleware.ts` or `lib/auth/guard.ts` redirect correctly, because that needs a running
  server and a real session. The guard is written fail-closed and is the only path to the admin
  surfaces, but it is verified by reading, not by test.
- **Live Supabase behaviour.** The assertions run against bare PostgreSQL 15 with a shim
  supplying `auth.jwt()`, the three roles and `auth.users`. Supabase's own PostgREST and GoTrue
  layers sit in front of the same SQL, so the policies hold, but the HTTP path is untested.
- **Rate limiting.** `lib/ratelimit.ts` is in-memory and therefore per-instance. The sign-in
  limiter is a speed bump, not a control.

## Manual check, if you want to see it yourself

1. Create a second account that is **not** an admin: set `app_metadata.nuvora_role` to
   `customer`, or leave it unset.
2. Place an order with the admin account, or insert one and set its `user_id`.
3. Sign in as the non-admin account and request the admin's order id with that session's token.
4. Expect **no rows**, not a 403: RLS filters rather than raises on reads. A 403 would mean the
   request failed earlier, at a grant - also a refusal, but a different one.
5. Repeat against `/admin/orders/<id>` in a browser. Expect a redirect to `/auth/sign-in`, since
   the middleware refuses before the query runs.
