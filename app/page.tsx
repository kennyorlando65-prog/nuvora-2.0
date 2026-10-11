import type { Metadata } from "next";
import { ModuleExplorer } from "@/components/module-explorer";

export const metadata: Metadata = {
  title: "Digital services, delivered",
};

const principles = [
  {
    title: "No wallet, ever",
    body: "NUVORA never holds your money. Each order is paid for directly at checkout through the payment gateway, so there is no balance to top up, drain or lose.",
  },
  {
    title: "No documents, ever",
    body: "No passport scans, no selfies, no ID uploads. Sign in with Google or email and nothing more is asked of you.",
  },
  {
    title: "Priced on the server",
    body: "Every price is calculated and re-validated on the server before payment. A tampered browser cannot change what an order costs.",
  },
  {
    title: "Minimal by design",
    body: "We keep name, email, order history and payment metadata. Nothing else. Built to NDPA 2023 and GDPR expectations.",
  },
];

export default function HomePage() {
  return (
    <>
      <section className="border-b border-line-soft">
        <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
          <p className="nuvora-label">Pay-per-order digital goods</p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl lg:text-6xl">
            The things you need online, bought one order at a time.
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-relaxed text-muted sm:text-lg">
            eSIM data, airtime and data top-ups, gift cards, game credits and
            subscriptions - delivered digitally to customers worldwide.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#catalogue"
              className="rounded-lg bg-accent px-5 py-3 text-sm font-semibold text-bg transition-colors hover:brightness-110"
            >
              Browse the store
            </a>
            <a
              href="#principles"
              className="rounded-lg border border-line px-5 py-3 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
            >
              How we operate
            </a>
          </div>
        </div>
      </section>

      <section id="catalogue" className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="nuvora-label">The Digital Store</p>
            <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
              Five product lines, one checkout
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            Filter a product line to see how it behaves at checkout. Availability per
            region is confirmed server-side before any payment is taken.
          </p>
        </div>
        <ModuleExplorer />
      </section>

      <section
        id="principles"
        className="border-y border-line-soft bg-panel-2"
      >
        <div className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
          <p className="nuvora-label">Operating principles</p>
          <h2 className="mt-2 text-2xl font-semibold sm:text-3xl">
            Four commitments we will not trade away
          </h2>
          <div className="mt-9 grid gap-4 sm:grid-cols-2">
            {principles.map((item) => (
              <article key={item.title} className="nuvora-card p-6">
                <h3 className="text-base font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-14 sm:py-20">
        <div className="nuvora-card overflow-hidden">
          <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-2 lg:gap-12">
            <div>
              <p className="nuvora-label">Checkout</p>
              <h2 className="mt-2 text-2xl font-semibold">
                One order, one payment, no balance
              </h2>
              <p className="mt-4 text-sm leading-relaxed text-muted">
                You choose a product, we verify availability and price on the server,
                then you pay the gateway directly. Once the gateway confirms the payment,
                your order is fulfilled. Because there is no wallet, there is nothing to
                withdraw and no balance to leave behind.
              </p>
            </div>
            <dl className="grid gap-4 self-center sm:grid-cols-2">
              {[
                ["Card & transfer", "via the payment gateway"],
                ["Server-verified price", "before every charge"],
                ["Digital delivery", "no shipping, ever"],
                ["Refund policy", "per line, published"],
              ].map(([term, detail]) => (
                <div key={term} className="rounded-lg border border-line p-4">
                  <dt className="font-mono text-xs uppercase tracking-widest text-dim">
                    {term}
                  </dt>
                  <dd className="mt-1 text-sm text-ink">{detail}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </section>
    </>
  );
}
