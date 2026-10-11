# NUVORA 2.0

White-label digital services platform — eSIM data plans, airtime/data top-ups, gift
cards, game credits and subscriptions — sold globally on a **pay-per-order** basis.

## What NUVORA is, and is not

These are load-bearing product constraints. Code that contradicts them is a bug.

- NUVORA is **not a wallet** and **does not hold customer money or balances**.
  Every order is paid for directly at checkout through the payment gateway.
  There is no stored balance and no top-up-wallet screen.
- NUVORA **does not collect or store identity documents** — no passport images, no
  selfies. Sign-in is Google OAuth and email only. KYC belongs to the payment
  gateway on the business side.
- The Digital Store sells **digital goods only**. Social media accounts are excluded
  (platform terms + fraud risk).
- Data collected is minimal: name, email, Google account identifier, order history and
  payment metadata. Privacy alignment: **NDPA 2023** and **GDPR**.

## Architecture

| Layer | Choice |
| --- | --- |
| Frontend + API | Next.js (App Router) on Vercel. **All provider API calls run server-side.** |
| Database + Auth | Supabase Postgres with Row Level Security enforced from migration one. |
| Code | This repo is the source of truth. DB changes are versioned SQL in `supabase/migrations/`. |
| Suppliers | Behind a single adapter interface in `lib/providers/` so one provider can be swapped or added without touching the app. |
| Secrets | Vercel Environment Variables (and Supabase secrets for scheduled jobs). Never in the repo. |

**Server-side rule:** supplier API keys never reach the browser, and only publishable
keys may be exposed with a `NEXT_PUBLIC_` prefix. Prices are always computed and
validated on the server — a client-supplied price is never trusted.

## Repository layout

```
app/                     Next.js App Router (pages + server routes)
  api/health/            Liveness + config check (safe, leaks nothing)
components/              Design-system components
lib/env.ts               Typed environment access (build-safe, server-guarded)
lib/supabase/            Server (service-role) and browser clients
lib/pricing/             Server-side pricing engine
lib/providers/           Supplier adapter interface + implementations
supabase/migrations/     Versioned SQL migrations, applied in filename order
```

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in real values locally
npm run dev                    # http://localhost:3000
npm run verify                 # typecheck + production build
```

`npm run verify` must pass before any deploy. There is no CI gate wired yet, so this
is currently a manual discipline — see "Before launch".

## Database migrations

Migrations are plain SQL in `supabase/migrations/`, named
`YYYYMMDDHHMMSS_description.sql` so that lexicographic order equals apply order.

Apply them one of two ways:

```bash
# With the Supabase CLI linked to the project
supabase link --project-ref <PROJECT_REF>
supabase db push

# Without the CLI: paste each file into the Supabase SQL editor,
# in filename order. Never hand-edit these changes in the dashboard first.
```

**Drift policy.** The repo is authoritative. If the live database and these files
disagree, the dashboard is wrong: fix it by writing a new migration, not by editing
the live schema by hand. Every table exposed to the API has RLS enabled and explicit
policies — never rely on a disabled or permissive default.

## Supplier adapters

Every supplier sits behind one interface (`lib/providers/types.ts`), so a provider can be
added or swapped without touching checkout, pricing or the database. `resolveAdapter()` in
`lib/providers/index.ts` is the single place that decides whether a call is real.

**Switching a supplier live — the whole switch:**

1. `PROVIDER_MODE=live`
2. `ESIM_PROVIDER_BASE_URL` and `ESIM_PROVIDER_API_KEY`

Until both are set, mode stays `sandbox` and nothing leaves the process.

**Sandbox output is visibly marked.** Every sandbox result carries `isSandbox: true`, and
the deliverable itself is stamped `NUVORA-SANDBOX-NOT-A-REAL-ESIM`. If a sandbox code ever
reached a customer it would be obvious at a glance, rather than a plausible-looking code
that fails silently later. The sandbox invents no products: it derives every response from
a hash of the request, so it is deterministic and there is no seeded fixture anywhere.

**Fail-closed in production.** On a Vercel production deployment the sandbox adapter
throws instead of returning simulated deliveries, so a live store cannot quietly sell goods
it never delivers. Set `PROVIDER_ALLOW_SANDBOX_IN_PRODUCTION=true` only for a deliberate
demo. The guard keys off `VERCEL_ENV`, so it does not cover a non-Vercel production host.

**Fulfilment must be idempotent.** Every fulfilment carries an idempotency key (the order
line id) because a network call can fail *after* the supplier has already acted. An adapter
treats a repeat of the same key as the same request, and `getStatus()` returns null for an
unknown key — which is what makes a retry after a timeout safe rather than a double
delivery that costs real money.

**Honest scope of the live adapter.** No eSIM supplier has been chosen yet, so
`esim-live.ts` is written against a documented, configurable contract with the mapping
isolated in one place. The transport around it — hard timeout, bounded retry with backoff,
no retry on auth failure, typed errors — is production-grade; the field mapping is the part
expected to change once a supplier is picked. Do not assume it matches a specific vendor.

## Environment variables

Every variable is documented as a placeholder in [`.env.example`](.env.example).

| Variable | Scope | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client + server | Publishable key, RLS-scoped |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | Bypasses RLS. Never expose. |
| `NEXT_PUBLIC_SITE_URL` | client + server | Absolute URLs for emails/redirects |
| `PAYMENT_PROVIDER` | server | `paystack` \| `flutterwave` \| `disabled` |
| `PAYSTACK_SECRET_KEY` | **server only** | Server API calls + webhook verification |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | client | Checkout widget |
| `FLUTTERWAVE_SECRET_KEY` | **server only** | Server API calls |
| `FLUTTERWAVE_WEBHOOK_SECRET_HASH` | **server only** | Verifies webhook authenticity |
| `PROVIDER_MODE` | server | `sandbox` \| `live` — the single switch for supplier traffic |
| `ESIM_PROVIDER_BASE_URL` | **server only** | Supplier API base URL. Must be https. |
| `ESIM_PROVIDER_API_KEY` | **server only** | Supplier credential |
| `ESIM_PROVIDER_AUTH_HEADER` | **server only** | Optional extra auth header name |
| `PROVIDER_SANDBOX_OUTCOME` | server | `completed` \| `pending` \| `failed` — test control, ignored when live |
| `PROVIDER_SANDBOX_UNIT_COST_MINOR` | server | Simulated sandbox cost; not a catalogue price |
| `PROVIDER_ALLOW_SANDBOX_IN_PRODUCTION` | server | `true` only for a deliberate demo on a production deployment |
| `RESEND_API_KEY` | **server only** | Transactional email |

Set production values in **Vercel → Settings → Environment Variables**, and for
scheduled Supabase functions in **Supabase → Project Settings → Secrets**. Secrets are
never committed and never pasted into chat.

## Status

This repo is under active staged construction. The current build stage, what is proven
working, and what is still unverified are recorded per stage in the build report that
accompanies each stage. Treat unverified items as unverified.

## Before launch

- [ ] Tighten CSP to a nonce-based policy (currently allows `'unsafe-inline'`).
- [ ] Enable CI running `npm run verify` on every pull request.
- [ ] Branch protection on `main`.
- [ ] Enable 2FA on the GitHub account.
- [ ] Rate limiting on checkout and webhook endpoints.
- [ ] Legal pages reviewed by a qualified Nigerian lawyer (and an EU/UK adviser for GDPR).
- [ ] Accessibility audit and automated a11y checks.
