import type { Metadata } from "next";
import Link from "next/link";

import { LegalList, LegalSection, LegalShell } from "@/components/legal/legal-ui";
import { governingJurisdiction, legalEntityName, supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description:
    "Draft terms governing the use of NUVORA: pay-per-order digital goods with no wallet and no stored balance.",
};

export default function TermsPage() {
  return (
    <LegalShell
      label="Legal"
      title="Terms & Conditions"
      summary="These terms describe the agreement between you and NUVORA when you buy a digital product on this site. They are written to match how the platform actually works: one order, one payment, no stored balance."
    >
      <LegalSection id="who" title="1. Who these terms are between">
        <p>
          This site is operated by {legalEntityName} (&ldquo;NUVORA&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;). By placing an order you agree to these terms. If you do not
          agree with them, do not place an order.
        </p>
        <p>
          You must be old enough to enter a binding contract in your own country. Where a
          product has its own age requirement, that requirement also applies.
        </p>
      </LegalSection>

      <LegalSection id="orders" title="2. Orders and how a contract forms">
        <p>
          Browsing the store is not an offer. An order is only accepted once we have
          confirmed the price and availability on our servers and the payment gateway has
          confirmed the payment. Until both of those have happened, we may decline an order
          and you will not be charged.
        </p>
        <LegalList
          items={[
            "Prices are shown in the currency of the order and are re-validated on the server before any charge is created.",
            "We may correct an obvious pricing or description error before fulfilling, and will cancel and refund the order rather than fulfil it at the wrong price.",
            "An order confirmation is a record that we have accepted the order, not a tax invoice unless it says so.",
          ]}
        />
      </LegalSection>

      <LegalSection id="no-wallet" title="3. No wallet, no stored balance">
        <p>
          NUVORA is not a wallet, a stored-value facility or a deposit-taking service. We do
          not hold customer money and there is no balance to fund, top up, transfer or
          withdraw.
        </p>
        <p>
          Every order is paid for directly with the payment gateway at checkout. Because no
          balance exists, a refund is made back to the original payment method through the
          gateway - never to an account balance, because there is none.
        </p>
      </LegalSection>

      <LegalSection id="delivery" title="4. Digital delivery">
        <p>
          All products are digital. There is no shipping and nothing to collect. Delivery
          means the product (a data plan, top-up, card code, credits or subscription) is
          made available to you or credited to the destination you supplied.
        </p>
        <LegalList
          items={[
            "You are responsible for entering the destination correctly - the phone number, email address, account or device an order should go to.",
            "A delivery sent to a destination you supplied correctly is a completed delivery, even if you can no longer access that destination.",
            "Some products activate on the supplier's side and may take time to appear. Where a product is asynchronous, that is stated on the product.",
          ]}
        />
      </LegalSection>

      <LegalSection id="payment" title="5. Payment">
        <p>
          Payments are processed by a third-party payment gateway. We do not receive or
          store your full card details; they are handled by the gateway. Your use of the
          gateway is also subject to the gateway&rsquo;s own terms.
        </p>
        <p>
          An order is only treated as paid once the gateway&rsquo;s confirmation has been
          re-verified on our server. A callback that claims success is not by itself proof of
          payment.
        </p>
      </LegalSection>

      <LegalSection id="refunds" title="6. Refunds and cancellations">
        <p>
          Refunds are governed by the{" "}
          <Link href="/legal/refunds" className="text-accent underline">
            Refund &amp; Cancellation policy
          </Link>
          , which forms part of these terms. It sets out which products can be refunded, and
          why codes that have already been revealed generally cannot be.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="7. Acceptable use">
        <p>
          Your use of the site is also governed by the{" "}
          <Link href="/legal/acceptable-use" className="text-accent underline">
            Acceptable Use policy
          </Link>
          . We may suspend an account or refuse an order where we reasonably believe these
          terms or that policy have been broken.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="8. Liability">
        <p>
          We do not exclude liability that cannot lawfully be excluded, including for fraud
          or for death or personal injury caused by negligence. Subject to that, our
          liability for any order is limited to the amount you paid for that order.
        </p>
        <p>
          We are not responsible for failures of third parties we do not control - mobile
          networks, suppliers, or the payment gateway - beyond refunding an order that cannot
          be delivered.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="9. Changes to these terms">
        <p>
          We may update these terms. The version that applies to an order is the version in
          force when the order was placed. Material changes will be reflected by the
          &ldquo;last updated&rdquo; date on this page.
        </p>
      </LegalSection>

      <LegalSection id="law" title="10. Governing law">
        <p>
          These terms are governed by the laws of {governingJurisdiction}, and the courts of
          that jurisdiction have exclusive jurisdiction over any dispute - without removing
          any right you have to bring a claim in your own country of residence where the law
          gives you that right.
        </p>
        <p>
          Questions about these terms can be sent to{" "}
          <a href={`mailto:${supportEmail}`} className="text-accent underline">
            {supportEmail}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
