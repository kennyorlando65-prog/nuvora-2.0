import type { Metadata } from "next";

import { LegalList, LegalSection, LegalShell } from "@/components/legal/legal-ui";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "AML / KYC Policy",
  description:
    "Draft anti-money-laundering and identity-check policy for NUVORA - and an honest account of where checks actually sit, given that NUVORA collects no identity documents.",
};

export default function AmlKycPage() {
  return (
    <LegalShell
      label="Legal"
      title="AML / KYC Policy"
      summary="NUVORA is designed so that most anti-money-laundering controls sit with the regulated payment gateway rather than in a document-collection flow. This page sets out that position honestly, including what is not yet built."
    >
      <LegalSection id="position" title="1. Our starting position">
        <p>
          NUVORA is not a bank, a wallet or a deposit-taking business. We do not hold customer
          money and we do not maintain balances, so there is no stored-value relationship to
          monitor. Every order is a one-off payment made directly to a regulated payment
          gateway.
        </p>
        <p>
          Because of that, the identity and AML obligations that attach to holding and moving
          customer funds sit with the gateway on the business side. NUVORA does not ask
          customers for passports, ID cards, selfies or proof of address, and does not store
          any.
        </p>
      </LegalSection>

      <LegalSection id="what-we-do" title="2. What NUVORA does do">
        <LegalList
          items={[
            "Uses regulated payment providers for every payment, so each transaction passes through the provider's own AML and sanctions screening.",
            "Does not accept deposits and does not allow value to be stored on the platform, which removes the main way a store can be used to hold or layer funds.",
            "Limits goods to vetted digital product lines, and excludes categories known to attract fraud such as social media accounts.",
            "Keeps an audit record of order, payment and fulfilment events, so a transaction can be reconstructed if it is questioned.",
            "Can suspend an account where activity indicates abuse, with the reason recorded rather than left unexplained.",
          ]}
        />
      </LegalSection>

      <LegalSection id="red-flags" title="3. Indicators we act on">
        <LegalList
          items={[
            "Repeated payment failures or reversals against the same account or destination.",
            "Ordering patterns that look like card testing or coordinated abuse.",
            "Destinations that do not match the customer, or that look like an attempt to convert stolen value.",
            "Pressure to fulfil an order before the payment has been re-verified.",
          ]}
        />
        <p>
          Where one of these appears, an order may be held, refused or refunded.
        </p>
      </LegalSection>

      <LegalSection id="limits" title="4. What is not built yet">
        <p>
          This is a draft, not a completed programme. In particular, the following are
          recognised gaps and will be addressed before launch:
        </p>
        <LegalList
          items={[
            "No formal, written AML risk assessment has been completed.",
            "No named compliance owner or money-laundering reporting officer has been appointed.",
            "There is no documented process for reporting a suspicious transaction to the relevant authority.",
            "There is no staff training record.",
            "There is no self-service account closure or data export tool yet, which also affects how a subject request is handled.",
          ]}
        />
        <p>
          Until these are closed, this page should be read as a statement of intent and
          current design, not as evidence of a functioning compliance programme.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="5. Contact">
        <p>
          Compliance questions can be sent to{" "}
          <a href={`mailto:${supportEmail}`} className="text-accent underline">
            {supportEmail}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
