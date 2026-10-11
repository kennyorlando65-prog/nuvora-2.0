import type { Metadata } from "next";

import { LegalList, LegalSection, LegalShell } from "@/components/legal/legal-ui";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy",
  description:
    "Draft refund policy for NUVORA: which digital goods can be refunded, why revealed codes and used eSIM data generally cannot, and how to raise a refund request.",
};

export default function RefundsPage() {
  return (
    <LegalShell
      label="Legal"
      title="Refund & Cancellation Policy"
      summary="Digital goods are delivered instantly, which changes what a refund can realistically mean. This policy sets out honest rules per product line, and says plainly where a refund cannot be given."
    >
      <LegalSection id="principle" title="1. The principle">
        <p>
          You cannot return a code you have already seen, or data you have already used. So
          the test we apply is simple: has the goods been delivered, and is it still
          possible for the supplier to reverse it?
        </p>
      </LegalSection>

      <LegalSection id="before" title="2. Before delivery">
        <p>
          If an order has not yet been delivered - for example it is still awaiting a
          supplier - it can be cancelled and refunded in full. If we cannot deliver at all,
          we cancel and refund rather than leave the order pending.
        </p>
      </LegalSection>

      <LegalSection id="lines" title="3. What can be refunded, per product line">
        <LegalList
          items={[
            "eSIM data plans: an eSIM that has not been installed or activated can generally be refunded. Once it is installed or has consumed data, it cannot.",
            "Airtime and data top-ups: once the top-up has been applied to the destination number, it cannot be refunded. A top-up that failed to apply is refunded.",
            "Gift cards: a gift card whose code has been revealed cannot be refunded, because the code can be used. If a code is invalid or was already redeemed, it is refunded or replaced once the supplier confirms the fault.",
            "Game credits: once credited to the account you supplied, they cannot be refunded. Credits that were never credited are refunded.",
            "Subscriptions: a subscription that has been activated cannot be refunded. A subscription that failed to activate is refunded.",
          ]}
        />
      </LegalSection>

      <LegalSection id="wrong-destination" title="4. Wrong or mistyped destination">
        <p>
          If a delivery fails because the destination was mistyped, we will try to help, but
          whether it can be recovered depends on the supplier. Once goods have been delivered
          to a destination you supplied, the delivery is complete even if that destination is
          not the one you intended.
        </p>
      </LegalSection>

      <LegalSection id="how" title="5. How to request a refund">
        <LegalList
          items={[
            `Email ${supportEmail} with the order number and what went wrong.`,
            "We check the delivery status and any supplier records for that order.",
            "If a refund is due, it is sent back to the original payment method through the gateway. There is no account balance to credit, because NUVORA holds no balances.",
          ]}
        />
        <p>
          Refunds are returned in the currency of the original payment. How quickly the money
          appears depends on your bank or card issuer, not on us.
        </p>
      </LegalSection>

      <LegalSection id="chargebacks" title="6. Chargebacks">
        <p>
          If you believe a charge was unauthorised, contact us first - we can usually resolve
          it faster than a bank dispute. A chargeback raised through your bank may suspend
          the account while it is investigated, and we will provide the delivery records
          needed to resolve it.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="7. Your statutory rights">
        <p>
          Where consumer law gives you a right to cancel digital content, that right is
          affected by your express consent to immediate delivery and your acknowledgement
          that you then lose the right to cancel. Nothing in this policy removes a right you
          have under the mandatory law of your own country.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
