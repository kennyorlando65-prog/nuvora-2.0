import type { Metadata } from "next";

import { LegalList, LegalSection, LegalShell } from "@/components/legal/legal-ui";
import { legalEntityName, supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Draft privacy policy for NUVORA: what personal data is collected, why, how long it is kept, and the rights available under Nigeria's NDPA 2023 and the GDPR.",
};

export default function PrivacyPage() {
  return (
    <LegalShell
      label="Legal"
      title="Privacy Policy"
      summary="NUVORA is built to collect as little personal data as a store can. This policy describes exactly what is collected, why, and what is deliberately never collected - written against Nigeria's Data Protection Act 2023 and, for customers in Europe, the GDPR."
    >
      <LegalSection id="controller" title="1. Who is responsible for your data">
        <p>
          {legalEntityName} is the data controller for the personal data described here. A
          formal data protection officer contact is being appointed; until it is in place,
          privacy requests go to{" "}
          <a href={`mailto:${supportEmail}`} className="text-accent underline">
            {supportEmail}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="what" title="2. What we collect">
        <LegalList
          items={[
            "Account details: your name and email address, and where you sign in with Google, the account identifier the provider returns to us.",
            "Order details: the products ordered, the amounts, the currency, the destination you supplied for a delivery, and the order status.",
            "Payment metadata: the gateway reference, the amount, the currency, the payment status and any transaction identifier the gateway returns. We do not receive or store your full card number.",
            "Support correspondence: the messages you send us and our replies.",
            "Technical data: the minimum needed to keep the service secure - server logs, and cookie data described in the Cookie Policy.",
          ]}
        />
      </LegalSection>

      <LegalSection id="never" title="3. What we deliberately never collect">
        <p>
          This is a design decision, not an oversight. NUVORA does not collect, request or
          store:
        </p>
        <LegalList
          items={[
            "Passport, national ID, driver's licence or any other identity document.",
            "Selfies, photographs of your face, or any biometric data.",
            "Proof of address documents such as utility bills or bank statements.",
            "Your full card number or card security code - those stay with the payment gateway.",
            "A stored monetary balance, because no wallet or stored-value account exists to hold one.",
          ]}
        />
        <p>
          Where a payment provider is required to perform identity or anti-money-laundering
          checks, that obligation sits with the gateway on the business side, not with us,
          and does not involve us collecting documents from you.
        </p>
      </LegalSection>

      <LegalSection id="why" title="4. Why we use it, and our lawful basis">
        <LegalList
          items={[
            "To create and fulfil your order - performance of a contract.",
            "To take payment and reconcile it with the gateway - performance of a contract.",
            "To provide support and handle refunds - performance of a contract and our legitimate interests.",
            "To keep the service and our customers secure, including rate limiting and audit records - our legitimate interests and, where required, legal obligation.",
            "To meet accounting, tax and record-keeping duties - legal obligation.",
            "To send transactional messages about an order you placed - performance of a contract. Withdrawable marketing consent is separate and is not bundled with an order.",
          ]}
        />
      </LegalSection>

      <LegalSection id="sharing" title="5. Who we share it with">
        <LegalList
          items={[
            "The payment gateway, to process and verify your payment.",
            "The suppliers behind a product, to the extent needed to deliver it (for example the destination for a top-up).",
            "Our hosting and database providers, which process data on our behalf.",
            "Authorities, where we are legally required to disclose.",
          ]}
        />
        <p>
          We do not sell personal data, and we do not share it for third-party advertising.
        </p>
      </LegalSection>

      <LegalSection id="transfers" title="6. International transfers">
        <p>
          Some of our service providers process data outside Nigeria, including in the EU
          and the United States. Where personal data is transferred across a border we rely
          on an appropriate safeguard, such as a lawful transfer mechanism under the NDPA
          2023 and, for European data, a recognised GDPR transfer mechanism. The specific
          mechanism in use is being documented with our providers.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="7. How long we keep it">
        <LegalList
          items={[
            "Order and payment records are kept for the period required for accounting and tax purposes, then deleted or anonymised.",
            "Account data is kept while your account exists, and is deleted when you delete your account, except where a record must be retained by law.",
            "Support correspondence is kept for a limited period after a matter is closed.",
            "Server logs are kept for a short period for security purposes.",
          ]}
        />
        <p>
          The exact retention periods are being finalised with our advisers and will be
          stated here once confirmed.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="8. Your rights">
        <p>
          Under the NDPA 2023, and under the GDPR for customers in Europe, you have the
          right to be informed, to access your data, to correct it, to have it erased, to
          restrict or object to certain processing, to data portability, and to withdraw
          consent where consent is the basis. You also have the right to complain to a
          supervisory authority - the Nigeria Data Protection Commission, or your local
          authority in the EU or UK.
        </p>
        <p>
          NUVORA is required to provide a way to delete your account and to export your
          data. <strong className="text-ink">Those self-service tools are not built yet.</strong>{" "}
          Until they are, send the request to{" "}
          <a href={`mailto:${supportEmail}`} className="text-accent underline">
            {supportEmail}
          </a>{" "}
          and it will be actioned manually. This section will be rewritten once the tools
          ship, so that it describes a button rather than an inbox.
        </p>
      </LegalSection>

      <LegalSection id="security" title="9. Security">
        <p>
          Access to personal data is restricted by database-level rules - a customer can
          read their own orders and nothing else, and internal fields such as supplier cost
          are never exposed to a customer-facing route. Payment gateway secrets are stored
          server-side only and are never sent to a browser.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="10. Cookies">
        <p>
          Cookies are described separately in the Cookie Policy. In short: sign-in cookies
          are strictly necessary, and no non-essential cookie is set without consent.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="11. Changes">
        <p>
          Material changes to this policy will be reflected by the &ldquo;last updated&rdquo;
          date above.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
