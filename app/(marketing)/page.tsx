import type { Metadata } from "next";
import Link from "next/link";

import { SectionRule, SignalMotif } from "@/components/brand/signal-motif";
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
 * THE HERO LEADS WITH WHY, NOT HOW. The earlier version opened on delivery mechanics, which
 * answered a question the visitor had not asked yet. This one opens on the three things that
 * make NUVORA different from a wallet app - nothing held, nothing collected, one order at a
 * time - and the mechanics have moved down the page to "How it works", where somebody who has
 * already decided they are interested will read them.
 *
 * NO INVENTED PROOF. There are no customer counts, no ratings, no logos and no testimonials
 * anywhere on this page. NUVORA is pre-launch and has none of those, so the trust section
 * carries commitments that are structural facts about how the product is built, which can be
 * checked, rather than social proof that would be fiction.
 *
 * THE RHYTHM IS DELIBERATELY VARIED. The founder's note was that the page was clean but
 * repetitive after scrolling, so the sections no longer share one shape: the hero carries a
 * motif backdrop, the trust block pairs one feature card with quieter supporting cards, the
 * product grid gives its first entry more weight than the rest, "how it works" is a numbered
 * list rather than four equal boxes, and hairline section rules run between the major blocks.
 */

/** The product lines, in the order they are most likely to be bought. */
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
] as const;

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

/**
 * The trust block, rewritten as benefits rather than as an administrative summary.
 *
 * The first entry is the headline commitment and gets the feature treatment; the rest are
 * quieter. Each one is a fact about how the product is built, not a claim about performance.
 */
const COMMITMENTS = [
  {
    title: "We never hold your money",
    body: "There is no wallet and no balance anywhere in NUVORA. Every order is paid for at checkout, directly to the payment gateway, and the money never rests with us. There is nothing to top up, nothing to drain and nothing to lose if you stop using the service.",
    feature: true,
  },
  {
    title: "We never ask for identity documents",
    body: "No passport scans, no selfies, no uploaded IDs. You sign in with an email address and nothing else is requested. Any identity check that applies to a payment is done by the payment gateway, on the business side.",
  },
  {
    title: "Prices are set on our server",
    body: "Every price is calculated and re-checked on our server before anything is charged. A modified browser cannot change what an order costs.",
  },
  {
    title: "We keep almost nothing about you",
    body: "Your name, email, order history and payment metadata. That is the whole list. It is built to match Nigeria's data protection expectations and GDPR.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* -- hero -------------------------------------------------------------- */}
      <section className="relative isolate overflow-hidden border-b border-line">
        {/* The corner motif. Absolute, behind the content, aria-hidden and pointer-events:none,
            so it is present without ever interfering. It fades out towards the content side so
            it cannot reduce the contrast of the text sitting over the other half of the grid. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] opacity-[0.55] lg:block"
        >
          <SignalMotif variant="corner" tone="line" />
        </div>

        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <div className="max-w-3xl">
            <p className="nuvora-label">Pay-per-order digital goods</p>

            {/* Why-led. No wallet, no documents, one order at a time - the three things that
                distinguish NUVORA, before any mention of how delivery works. */}
            <h1 className="mt-5 text-3xl font-semibold leading-[1.12] tracking-tight sm:text-5xl">
              Buy what you need online without opening your life to a wallet app.
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
              NUVORA sells eSIM data, airtime and data top-ups, gift cards, game credits and
              subscriptions - and nothing else. You pay for one order at a time, we hand it to
              you digitally, and we keep no balance, no documents and no reason to hold on to
              your money.
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
        </div>
      </section>

      {/* -- why nuvora -------------------------------------------------------- */}
      <section id="why" className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <div className="flex flex-col gap-2">
          <p className="nuvora-label">Why NUVORA</p>
          <h2 className="max-w-3xl text-2xl font-semibold tracking-tight sm:text-3xl">
            Four things we do differently, and none of them is a promise about uptime
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">
            Each of these is a decision baked into how the product is built, not a marketing
            claim. They are the reason there is no wallet screen and no document upload.
          </p>
        </div>

        {/* Varied weight on purpose: one featured card carrying the headline commitment, then
            three quieter cards. A uniform grid of four equal boxes was the repetitive pattern
            the founder flagged. */}
        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          {COMMITMENTS.filter((item) => item.feature).map((item) => (
            <article
              key={item.title}
              className="nuvora-card-feature flex flex-col gap-3 p-6 lg:col-span-1 lg:row-span-2 lg:justify-center"
            >
              <h3 className="text-lg font-semibold tracking-tight text-ink">{item.title}</h3>
              <p className="text-sm leading-relaxed text-muted">{item.body}</p>
              <Link
                href="/about"
                className="mt-1 text-xs text-accent underline underline-offset-2"
              >
                More about how NUVORA is built
              </Link>
            </article>
          ))}

          <div className="flex flex-col gap-4 lg:col-span-2">
            <div className="grid gap-4 sm:grid-cols-2">
              {COMMITMENTS.filter((item) => !item.feature).map((item) => (
                <article key={item.title} className="nuvora-card-quiet flex flex-col gap-2 p-5">
                  <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-muted">{item.body}</p>
                </article>
              ))}
            </div>

            {/* The factual disclaimer, kept as its own block rather than buried in the footer,
                because it is the single most important thing to be clear about. */}
            <div className="rounded-[var(--radius-card)] border border-line-soft bg-panel-2 p-5">
              <p className="nuvora-label">What NUVORA is not</p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                NUVORA is not a bank, a wallet or a money-transfer service. We do not accept
                deposits, we do not hold customer funds, and we do not collect identity
                documents. We are not a marketplace, and we do not resell social media accounts.
              </p>
            </div>
          </div>
        </div>
      </section>

      <SectionRule />

      {/* -- what we sell ------------------------------------------------------ */}
      <section id="what" className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="nuvora-label">The Digital Store</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Five product lines, one checkout
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Availability and price are confirmed on our server before any payment is taken.
            Sign in to see what is currently on sale.
          </p>
        </div>

        {/* The first entry is given more room than the rest, so the grid reads as a ranked list
            rather than five interchangeable tiles. */}
        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          {PRODUCT_LINES.slice(0, 1).map((line) => (
            <article
              key={line.name}
              className="nuvora-card flex flex-col gap-3 p-6 lg:col-span-2"
            >
              <h3 className="text-lg font-semibold tracking-tight text-ink">{line.name}</h3>
              <p className="max-w-xl text-sm leading-relaxed text-muted">{line.summary}</p>
              <p className="mt-auto border-t border-line-soft pt-3 text-xs leading-relaxed text-dim">
                {line.detail}
              </p>
            </article>
          ))}

          <article className="nuvora-card-quiet flex flex-col gap-3 p-5">
            <h3 className="text-base font-semibold text-ink">{PRODUCT_LINES[1].name}</h3>
            <p className="text-sm leading-relaxed text-muted">{PRODUCT_LINES[1].summary}</p>
            <p className="mt-auto border-t border-line-soft pt-3 text-xs leading-relaxed text-dim">
              {PRODUCT_LINES[1].detail}
            </p>
          </article>

          {PRODUCT_LINES.slice(2).map((line) => (
            <article key={line.name} className="nuvora-card-quiet flex flex-col gap-3 p-5">
              <h3 className="text-base font-semibold text-ink">{line.name}</h3>
              <p className="text-sm leading-relaxed text-muted">{line.summary}</p>
              <p className="mt-auto border-t border-line-soft pt-3 text-xs leading-relaxed text-dim">
                {line.detail}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* -- how it works ------------------------------------------------------ */}
      <section id="how" className="nuvora-band">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <div className="max-w-3xl">
            <p className="nuvora-label">How it works</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Four steps, and none of them is a top-up
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              This is the mechanics, which matters once you have decided NUVORA is worth trying -
              so it sits below the reasons rather than above them.
            </p>
          </div>

          {/* A numbered list on hairlines instead of four identical cards: the sequence is the
              point, and a numbered list says that better than a grid does. */}
          <ol className="mt-9 grid gap-x-10 gap-y-6 lg:grid-cols-2">
            {STEPS.map((item) => (
              <li key={item.step} className="nuvora-reason flex gap-4">
                <span className="font-mono text-sm tracking-widest text-accent">{item.step}</span>
                <span className="flex flex-col gap-1.5">
                  <span className="text-sm font-semibold text-ink">{item.title}</span>
                  <span className="text-sm leading-relaxed text-muted">{item.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* -- closing call to action -------------------------------------------- */}
      <section className="relative isolate overflow-hidden border-t border-line">
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <div className="nuvora-card overflow-hidden">
            <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-12">
              <div>
                <p className="nuvora-label">Get started</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                  One order, one payment, no balance left behind
                </h2>
                <p className="mt-4 text-sm leading-relaxed text-muted">
                  Create an account to reach the store. You choose a product, we verify
                  availability and price on the server, then you pay the gateway directly.
                  Once the gateway confirms the payment, your order is fulfilled and the codes
                  appear on your order page.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link href="/auth/sign-up" className="nuvora-btn nuvora-btn-primary">
                    Create your account
                  </Link>
                  <a href={`mailto:${supportEmail}`} className="nuvora-btn nuvora-btn-secondary">
                    Ask a question first
                  </a>
                </div>
              </div>

              {/* Four plain statements rather than four identical metric boxes: there are no
                  numbers to show, and inventing them would be a lie. */}
              <dl className="flex flex-col gap-4 self-center">
                {[
                  ["Card & transfer", "paid through the payment gateway"],
                  ["Server-verified price", "re-checked before every charge"],
                  ["Digital delivery", "no shipping, ever"],
                  ["Refund policy", "published per product line"],
                ].map(([term, detail]) => (
                  <div key={term} className="nuvora-reason flex flex-col gap-1">
                    <dt className="nuvora-label">{term}</dt>
                    <dd className="text-sm text-ink">{detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>

          {/* The motif closes the page, matching the header treatment. */}
          <div className="mt-10 overflow-hidden opacity-70">
            <SignalMotif variant="rule" tone="accent" />
          </div>
        </div>
      </section>
    </>
  );
}
