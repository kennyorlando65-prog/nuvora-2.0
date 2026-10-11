import type { Metadata } from "next";

import {
  legalEntityAddress,
  legalEntityName,
  legalEntityRegistration,
  supportEmail,
} from "@/lib/site";

export const metadata: Metadata = {
  title: "Contact & support",
  description:
    "How to reach NUVORA support about an order, a payment or a refund - and what we can and cannot see.",
};

const topics = [
  {
    title: "An order did not arrive",
    body: "Send the order number from your confirmation. We can see the delivery status and every supplier attempt against that order, and we can re-run a delivery that failed.",
  },
  {
    title: "A payment looks wrong",
    body: "Send the order number and the gateway reference if you have it. We can trace the payment through the gateway, but the charge itself appears on your card or bank statement, and any chargeback starts with your bank.",
  },
  {
    title: "You want a refund",
    body: "Refunds depend on the product line and whether the goods have already been delivered. The rules are written out in full in the Refund & Cancellation policy.",
  },
];

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:py-16">
      <p className="nuvora-label">Contact</p>
      <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">Contact &amp; support</h1>
      <p className="mt-4 text-base leading-relaxed text-muted">
        One address, monitored during Nigerian business hours (WAT). Include your order
        number if you have one - it is the fastest way for us to find what you are asking
        about.
      </p>

      <div className="mt-8 nuvora-card p-6">
        <p className="nuvora-label">Email</p>
        <a
          href={`mailto:${supportEmail}`}
          className="mt-2 block text-lg font-semibold text-accent underline"
        >
          {supportEmail}
        </a>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          This is a placeholder address until the support mailbox is provisioned. Set the
          real address as{" "}
          <code className="font-mono text-[11px] text-accent">NEXT_PUBLIC_SUPPORT_EMAIL</code>{" "}
          in Vercel so it appears here and in the footer without a code change.
        </p>
      </div>

      <div className="mt-8 grid gap-4">
        {topics.map((topic) => (
          <article key={topic.title} className="nuvora-card p-5">
            <h2 className="text-sm font-semibold text-ink">{topic.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{topic.body}</p>
          </article>
        ))}
      </div>

      <section className="mt-10 nuvora-card p-6">
        <h2 className="text-sm font-semibold text-ink">Who you are writing to</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          {[
            ["Legal entity", legalEntityName],
            ["Registration", legalEntityRegistration],
            ["Registered address", legalEntityAddress],
          ].map(([term, value]) => (
            <div key={term} className="flex flex-wrap justify-between gap-2">
              <dt className="text-xs text-dim">{term}</dt>
              <dd className="text-right text-sm text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 border-t border-line-soft pt-4 text-xs leading-relaxed text-dim">
          Business details are placeholders until the registered entity is confirmed. Fill
          them via{" "}
          <code className="font-mono text-[11px]">NEXT_PUBLIC_LEGAL_ENTITY_NAME</code>,{" "}
          <code className="font-mono text-[11px]">NEXT_PUBLIC_LEGAL_ENTITY_RC</code> and{" "}
          <code className="font-mono text-[11px]">NEXT_PUBLIC_LEGAL_ENTITY_ADDRESS</code> in
          Vercel.
        </p>
      </section>

      <p className="mt-8 text-xs leading-relaxed text-dim">
        NUVORA never asks for your password, card number, one-time passcode or a copy of
        your ID over email. If a message claiming to be from us asks for any of those, it
        did not come from us.
      </p>
    </div>
  );
}
