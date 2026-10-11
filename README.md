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
| `ESIM_PROVIDER_API_KEY` | **server only** | Supplier credential |
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
