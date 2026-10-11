/**
 * Public site details: contact, legal entity and the canonical route lists.
 *
 * ONE PLACE, ON PURPOSE. Every legal document, every trust page, the footer nav and the
 * sitemap all read from here, so a change to the support address or a document URL cannot
 * leave half the site pointing at the old value.
 *
 * THESE ARE PLACEHOLDERS UNTIL THE BUSINESS DETAILS ARE CONFIRMED. They are deliberately
 * obvious - "example.com", "[RC number not yet configured]" - so that an unfinished page
 * cannot be mistaken for a signed-off one. Set the real values as environment variables in
 * Vercel rather than editing them into this file, so an address or company number is never
 * committed to the repository by accident.
 */

export const supportEmail =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@example.com";

export const legalEntityName =
  process.env.NEXT_PUBLIC_LEGAL_ENTITY_NAME ?? "NUVORA (legal entity not yet configured)";

export const legalEntityRegistration =
  process.env.NEXT_PUBLIC_LEGAL_ENTITY_RC ?? "[RC number not yet configured]";

export const legalEntityAddress =
  process.env.NEXT_PUBLIC_LEGAL_ENTITY_ADDRESS ?? "[registered address not yet configured]";

export const governingJurisdiction = "the Federal Republic of Nigeria";

/** Shown on every legal page. Not decoration - it is the honest status of the document. */
export const LEGAL_REVIEW_NOTICE =
  "Working draft, not yet reviewed. This document has not been checked by a qualified " +
  "Nigerian lawyer, and has not been checked by an EU or UK adviser for GDPR. It is not " +
  "legal advice and it is not finished. Every policy on this site must be reviewed and " +
  "approved before NUVORA takes its first live order.";

export const policyUpdated = "11 October 2026";

export const siteTagline =
  "Buy eSIM data plans, top-ups, gift cards, game credits and subscriptions. Pay per " +
  "order - no wallet and no stored balance.";

/** Public pages, used by the sitemap and the footer. */
export const sitePages = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact & support" },
  { href: "/status", label: "Status" },
] as const;

/** Legal documents, used by the legal sidebar, the footer and the sitemap. */
export const legalDocuments = [
  { href: "/legal", label: "Legal overview" },
  { href: "/legal/terms", label: "Terms & Conditions" },
  { href: "/legal/privacy", label: "Privacy Policy" },
  { href: "/legal/cookies", label: "Cookie Policy" },
  { href: "/legal/refunds", label: "Refund & Cancellation" },
  { href: "/legal/acceptable-use", label: "Acceptable Use" },
  { href: "/legal/aml-kyc", label: "AML / KYC" },
] as const;
