import type { Metadata } from "next";

import { LegalList, LegalSection, LegalShell } from "@/components/legal/legal-ui";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Acceptable Use Policy",
  description:
    "Draft acceptable use policy for NUVORA: what is prohibited on the platform, including the resale of social media accounts, and what happens when the rules are broken.",
};

export default function AcceptableUsePage() {
  return (
    <LegalShell
      label="Legal"
      title="Acceptable Use Policy"
      summary="What you may not do with NUVORA, and why some of these rules exist for reasons that are not obvious from the product itself - fraud, platform terms, and the safety of other customers."
    >
      <LegalSection id="apply" title="1. Who this applies to">
        <p>
          This policy applies to everyone who uses the site, whether signed in or checking
          out as a guest.
        </p>
      </LegalSection>

      <LegalSection id="prohibited" title="2. Prohibited uses">
        <LegalList
          items={[
            "Buying with a payment method you are not authorised to use, or with the proceeds of crime.",
            "Using a stolen, purchased or fraudulently obtained gift card or code.",
            "Reselling goods in a way that misrepresents them, or presenting NUVORA as your own service.",
            "Attempting to bypass the server-side price or availability checks, including tampering with requests to change what an order costs.",
            "Automated purchasing, scraping, or placing orders at a volume intended to abuse the platform or a promotion.",
            "Using the service to launder money, to fund prohibited activity, or to move value for someone else.",
            "Interfering with the security or integrity of the site, or attempting to access data belonging to another customer.",
            "Using a destination (number, account or device) that you are not entitled to top up or credit.",
          ]}
        />
      </LegalSection>

      <LegalSection id="social" title="3. Social media accounts are excluded">
        <p>
          NUVORA does not sell social media accounts, followers, likes or engagement, and
          will not fulfil an order for them. This is excluded on purpose: it is contrary to
          the platforms&rsquo; own terms and it is a common vector for fraud. Any listing
          that appears to offer such a thing is an error, and you should report it.
        </p>
      </LegalSection>

      <LegalSection id="enforcement" title="4. What happens if these rules are broken">
        <LegalList
          items={[
            "An order may be refused or cancelled before delivery.",
            "An account may be suspended; where an account is suspended, the reason is recorded rather than left unexplained.",
            "Where a payment is suspected to be fraudulent, it may be reported to the payment gateway and to the relevant authority.",
            "Where required by law, information may be disclosed to law enforcement.",
          ]}
        />
      </LegalSection>

      <LegalSection id="your-responsibility" title="5. Your responsibility">
        <p>
          You are responsible for keeping your account secure and for what is done through
          it. If you believe your account has been used without your permission, contact us
          immediately.
        </p>
      </LegalSection>

      <LegalSection id="report" title="6. Reporting">
        <p>
          Report abuse, a suspected fraudulent listing, or a security concern to{" "}
          <a href={`mailto:${supportEmail}`} className="text-accent underline">
            {supportEmail}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
