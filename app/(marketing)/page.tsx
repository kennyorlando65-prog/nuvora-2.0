import type { Metadata } from "next";
import Link from "next/link";

import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Digital services, delivered",
  description:
    "NUVORA sells eSIM data plans, top-ups, gift cards, game credits and subscriptions. Pay per order, no wallet, no stored balance, no identity documents.",
};

/**
 * The public front door.
 *
 * WHAT THIS PAGE IS FOR, and what it deliberately is not. It explains what NUVORA is and
 * why it is safe to use, and it pushes to sign up. It does NOT show prices and it does NOT
 * offer a "browse the store" button, because the catalogue is empty until the operator
 * adds real products and a shop with nothing in it reads as a broken site. The store lives
 * behind the sign-in, where an empty catalogue is an honest empty state.
 *
 * THE LAYOUT IS SECTIONED ON PURPOSE. The previous version was one long scroll with no
 * division, which is what made it read as a brochure. This is cut into distinct blocks -
 * a hero, a product-line grid, a numbered "how it works" strip, a trust grid and a closing
 * call to action - so the page has structure and a visitor can see where one idea ends and
 * the next begins.
 */

const PRODUCT_LINES = [
  {
    name: "eSIM data plans",
    summary:
      "Local and regional data bundles installed by QR code. No physical SIM, no shop visit.",
    detail: "Issued by the network supplier, then delivered to your account.",
  },
  {
    name: "Airtime & data top-ups",
    summary: "Mobile credit and data bundles sent to a number you specify.",
    detail: "The recipient number is checked before payment is taken.",
  },
  {
    name: "Gift cards",
    summary: "Digital gift card codes for the brands we are authorised to resell.",
    detail: "Region-locked cards are filtered out for your billing country.",
  },
  {
    name: "Game credits",
    summary: "In-game currency and top-up codes for supported platforms.",
    detail: "Platform terms govern redemption and are shown before you buy.",
  },
  {
    name: "Subscriptions",
    summary: "Prepaid subscription codes and periods for supported services.",
    detail: "Recurring supplier billing is never passed on to your card.",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Create an account",
    body: "Sign up with an email address. No documents, no selfie, no waiting for approval.",
  },
  {
    step: "02",
    title: "Choose what you need",
    body: "Pick a product and quantity. The price is calculated on our server, not in your browser.",
  },
  {
    step: "03",
    title: "Pay for that order",
    body: "You pay the payment gateway directly. There is no balance to top up and nothing to leave behind.",
  },
  {
    step: "04",
    title: "Receive it digitally",
    body: "Once the gateway confirms payment, your order is fulfilled and the codes appear on your order page.",
  },
];

const TRUST = [
  {
    title: "No wallet, ever",
    body: "NUVORA never holds your money. Each order is paid for directly at checkout through the payment gateway, so there is no balance to top up, drain or lose.",
  },
  {
    title: "No documents, ever",
    body: "No passport scans, no selfies, no ID uploads. Sign in with an email address and nothing more is asked of you.",
  },
  {
    title: "Priced on the server",
    body: "Every price is calculated and re-validated on the server before payment. A tampered browser cannot change what an order costs.",
  },
  {
    title: "Minimal by design",
    body: "We keep your name, email, order history and payment metadata. Nothing else. Built to NDPA 2023 and GDPR expectations.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* -- hero ------------------------------------------------------------ */}
      <section className="border-b border-line-soft">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <p className="nuvora-label">Pay-per-order digital goods</p>
              <h1 className="mt-4 text-4xl font-semibold leading-tight sm:text-5xl">
                The things you need online, bought one order at a time.
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
                eSIM data, airtime and data top-ups, gift cards, game credits and
                subscriptions - delivered digitally, worldwide.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/auth/sign-up" className="nuvora-btn nuvora-btn-primary">
                  Create your account
                </Link>
                <Link href="/auth/sign-in" className="nuvora-btn nuvora-btn-secondary">
                  I already have an account
                </Link>
              </div>
              <p className="mt-4 text-xs text-dim">
                Free to create. You only pay when you place an order.
              </p>
            </div>

            {/* A compact summary card rather than a screenshot: there is no product
                imagery to show yet, and inventing some would be a lie. */}
            <div className="nuvora-card p-6">
              <p className="nuvora-label">At a glance</p>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                {[
                  ["Product lines", "Five"],
                  ["Wallet", "None"],
                  ["Stored balance", "None"],
                  ["Identity documents", "None"],
                  ["Payment", "Per order"],
                  ["Delivery", "Digital only"],
                ].map(([term, value]) => (
                  <div
                    key={term}
                    className="rounded-[var(--radius-control)] border border-line-soft p-3"
                  >
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-dim">
                      {term}
                    </dt>
                    <dd className="mt-1 text-sm font-medium text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>

      {/* -- what we sell ---------------------------------------------------- */}
      <section id="what" className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="nuvora-label">The Digital Store</p>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
              Five product lines, one checkout
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Availability and price are confirmed on our server before any payment is taken.
            Sign in to see what is currently on sale.
          </p>
        </div>

        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PRODUCT_LINES.map((line) => (
            <article key={line.name} className="nuvora-card flex flex-col gap-3 p-5">
              <h3 className="text-base font-semibold text-ink">{line.name}</h3>
              <p className="text-sm leading-relaxed text-muted">{line.summary}</p>
              <p className="mt-auto border-t border-line-soft pt-3 text-xs leading-relaxed text-dim">
                {line.detail}
              </p>
            </article>
          ))}

          <article className="nuvora-card flex flex-col justify-center gap-3 border-accent/40 bg-accent-soft p-5">
            <h3 className="text-base font-semibold text-accent">Ready to start?</h3>
            <p className="text-sm leading-relaxed text-muted">
              Create an account to reach the store and place your first order.
            </p>
            <Link
              href="/auth/sign-up"
              className="nuvora-btn nuvora-btn-primary mt-1 self-start"
            >
              Create account
            </Link>
          </article>
        </div>
      </section>

      {/* -- how it works ---------------------------------------------------- */}
      <section id="how" className="border-y border-line-soft bg-panel-2">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <p className="nuvora-label">How it works</p>
          <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
            Four steps, and none of them is a top-up
          </h2>

          <ol className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((item) => (
              <li key={item.step} className="nuvora-card flex flex-col gap-3 p-5">
                <span className="font-mono text-xs tracking-widest text-accent">
                  {item.step}
                </span>
                <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                <p className="text-sm leading-relaxed text-muted">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* -- trust ----------------------------------------------------------- */}
      <section id="trust" className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <p className="nuvora-label">Operating principles</p>
        <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
          Four commitments we will not trade away
        </h2>

        <div className="mt-9 grid gap-4 sm:grid-cols-2">
          {TRUST.map((item) => (
            <article key={item.title} className="nuvora-card p-6">
              <h3 className="text-base font-semibold text-ink">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
            </article>
          ))}
        </div>

        <div className="mt-6 rounded-[var(--radius-card)] border border-line-soft p-5">
          <p className="text-xs leading-relaxed text-muted">
            NUVORA is not a bank, a wallet or a money-transfer service. We do not accept
            deposits, we do not hold customer funds, and we do not collect identity
            documents. Any identity checks that apply to a payment are carried out by the
            payment gateway on the business side, not by us.
          </p>
        </div>
      </section>

      {/* -- closing call to action ------------------------------------------ */}
      <section className="border-t border-line-soft bg-panel-2">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <div className="nuvora-card overflow-hidden">
            <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:items-center lg:gap-12">
              <div>
                <p className="nuvora-label">Get started</p>
                <h2 className="mt-2 text-2xl font-semibold">
                  One order, one payment, no balance
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-muted">
                  Create an account to reach the store. You choose a product, we verify
                  availability and price on the server, then you pay the gateway directly.
                  Once the gateway confirms the payment, your order is fulfilled.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/auth/sign-up" className="nuvora-btn nuvora-btn-primary">
                    Create your account
                  </Link>
                  <a
                    href={`mailto:${supportEmail}`}
                    className="nuvora-btn nuvora-btn-secondary"
                  >
                    Ask a question first
                  </a>
                </div>
              </div>

              <dl className="grid gap-4 self-center sm:grid-cols-2">
                {[
                  ["Card & transfer", "via the payment gateway"],
                  ["Server-verified price", "before every charge"],
                  ["Digital delivery", "no shipping, ever"],
                  ["Refund policy", "per line, published"],
                ].map(([term, detail]) => (
                  <div
                    key={term}
                    className="rounded-[var(--radius-control)] border border-line p-4"
                  >
                    <dt className="font-mono text-[10px] uppercase tracking-widest text-dim">
                      {term}
                    </dt>
                    <dd className="mt-1 text-sm text-ink">{detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
