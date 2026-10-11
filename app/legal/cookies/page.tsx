import type { Metadata } from "next";

import { LegalList, LegalSection, LegalShell } from "@/components/legal/legal-ui";
import { supportEmail } from "@/lib/site";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description:
    "Draft cookie policy for NUVORA: which cookies are used, why the sign-in cookie is strictly necessary, and why no consent banner is shown until a non-essential cookie exists.",
};

export default function CookiePage() {
  return (
    <LegalShell
      label="Legal"
      title="Cookie Policy"
      summary="What cookies NUVORA sets, what they do, and the rule we hold ourselves to: no non-essential cookie is set before consent, and no consent banner is shown while only strictly-necessary cookies exist."
    >
      <LegalSection id="what" title="1. What a cookie is">
        <p>
          A cookie is a small file a site stores in your browser so that it can recognise
          your session on the next request. Some are essential to signing in at all; others
          are used for measurement or advertising. NUVORA currently uses only the first
          kind.
        </p>
      </LegalSection>

      <LegalSection id="essential" title="2. Strictly necessary cookies">
        <p>
          These are required for the site to work, and no consent is required to set them
          because there is no meaningful choice - without them there is no signed-in
          session.
        </p>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="py-2 pr-4 font-semibold text-ink">Cookie</th>
                <th className="py-2 pr-4 font-semibold text-ink">Purpose</th>
                <th className="py-2 font-semibold text-ink">Lifetime</th>
              </tr>
            </thead>
            <tbody className="text-muted">
              <tr className="border-b border-line-soft">
                <td className="py-2 pr-4 font-mono text-xs">sb-*-auth-token</td>
                <td className="py-2 pr-4">Keeps you signed in to your NUVORA session.</td>
                <td className="py-2">Session / up to 1 year if &ldquo;remember me&rdquo;</td>
              </tr>
              <tr className="border-b border-line-soft">
                <td className="py-2 pr-4 font-mono text-xs">nuvora_consent</td>
                <td className="py-2 pr-4">
                  Records your cookie choice so we do not ask again.
                </td>
                <td className="py-2">1 year</td>
              </tr>
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection id="non-essential" title="3. Non-essential cookies">
        <p>
          <strong className="text-ink">NUVORA sets no non-essential cookies today.</strong>{" "}
          There is no analytics, no advertising and no third-party tracking cookie on this
          site.
        </p>
        <p>
          Because of that, no consent banner is shown - showing one would ask you to agree to
          something that is not happening. If a non-essential cookie is ever introduced, the
          banner switches on automatically before that cookie is set, and this policy will
          list the cookie and its purpose here.
        </p>
      </LegalSection>

      <LegalSection id="managing" title="4. Managing cookies">
        <p>You can control cookies from your browser. Note that:</p>
        <LegalList
          items={[
            "Blocking strictly-necessary cookies will prevent you from signing in and from completing an order.",
            "Clearing cookies signs you out and resets your recorded consent choice.",
            "Your browser also lets you delete individual cookies already stored.",
          ]}
        />
      </LegalSection>

      <LegalSection id="contact" title="5. Questions">
        <p>
          Questions about cookies can be sent to{" "}
          <a href={`mailto:${supportEmail}`} className="text-accent underline">
            {supportEmail}
          </a>
          .
        </p>
      </LegalSection>
    </LegalShell>
  );
}
