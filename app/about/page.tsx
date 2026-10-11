import type { Metadata } from "next";
import Link from "next/link";

import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "What NUVORA is, and just as importantly what it is not: a pay-per-order digital services platform with no wallet, no stored balance and no identity documents.",
};

const is = [
  {
    title: "A store for digital goods",
    body: "eSIM data plans, airtime and data top-ups, gift cards, game credits and subscriptions. Everything is delivered digitally and nothing is shipped.",
  },
  {
    title: "Paid per order",
    body: "You pay for one order at a time, directly through the payment gateway. There is no account balance to fund, top up or lose.",
  },
  {
    title: "Server-priced",
    body: "Every price is calculated and re-validated on the server before a charge is created. A tampered browser cannot change what an order costs.",
  },
  {
    title: "Minimal by design",
    body: "We keep your name, email, order history and payment metadata, and nothing else. There is no profile to fill in and no documents to upload.",
  },
];

const isNot = [
  {
    title: "Not a wallet",
    body: "NUVORA does not take deposits and does not hold customer money. There is no stored balance anywhere in the product, so there is nothing to withdraw.",
  },
  {
    title: "Not a KYC/identity collector",
    body: "We do not collect passports, ID cards, selfies or proof of address. Sign-in is Google or email, and that is all. Identity checks, where they apply, belong to the payment gateway on the business side.",
  },
  {
    title: "Not a marketplace",
    body: "We do not host third-party sellers. Every product is supplied by NUVORA through a vetted provider, and a marketplace module was deliberately left out.",
  },
  {
    title: "Not a social account seller",
    body: "We do not and will not sell social media accounts. It is excluded by the platforms' own terms and it is a fraud magnet.",
  },
];

export default function AboutPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-12 sm:py-16">
      <p className="nuvora-label">About</p>
      <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">
        A digital store with fewer moving parts, on purpose.
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted">
        NUVORA sells digital goods to customers worldwide and runs from Nigeria. The whole
        product is shaped by two decisions: every order is paid for at checkout, and we
        collect as little as a store can get away with. Everything below follows from those
        two.
      </p>

      <div className="mt-12 grid gap-10 lg:grid-cols-2">
        <section>
          <h2 className="text-xl font-semibold text-ink">What NUVORA is</h2>
          <div className="mt-5 grid gap-4">
            {is.map((item) => (
              <article key={item.title} className="nuvora-card p-5">
                <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-ink">What NUVORA is not</h2>
          <div className="mt-5 grid gap-4">
            {isNot.map((item) => (
              <article
                key={item.title}
                className="nuvora-card border-line-soft bg-panel-2 p-5"
              >
                <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <section className="mt-14 nuvora-card p-7 sm:p-10">
        <h2 className="text-xl font-semibold text-ink">How an order works</h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Choose a product", "Pick a plan, top-up, card or credit and confirm availability."],
            ["Price re-checked", "The server validates the price and stock position before charging."],
            ["Pay the gateway", "You pay the gateway directly. NUVORA never holds the money."],
            ["Delivered digitally", "The order is fulfilled and the delivery is recorded against your order."],
          ].map(([step, detail], index) => (
            <li key={step} className="rounded-lg border border-line p-4">
              <span className="font-mono text-xs text-dim">0{index + 1}</span>
              <p className="mt-1 text-sm font-semibold text-ink">{step}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted">{detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-10 flex flex-wrap items-center gap-4 rounded-lg border border-line-soft bg-panel-2 p-5">
        <p className="text-sm text-muted">
          Questions about the platform, or need help with an order?
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/contact"
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg transition-colors hover:brightness-110"
          >
            Contact support
          </Link>
          <a
            href={`mailto:${supportEmail}`}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
          >
            {supportEmail}
          </a>
        </div>
      </section>
    </div>
  );
}
