/**
 * Cookie consent, gated on the thing that actually requires consent.
 *
 * WHY THIS IS GATED RATHER THAN ALWAYS-ON.
 * NUVORA sign-in uses Supabase session cookies. Those are strictly necessary: without them
 * there is no signed-in session at all, and the GDPR/ePrivacy consent requirement does not
 * apply to them. A consent banner shown while only strictly-necessary cookies exist would
 * be asking the visitor to consent to something that is not happening - which trains people
 * to dismiss banners, and is exactly the pattern that regulators have treated as
 * non-compliant.
 *
 * So the banner appears only when non-essential cookies are actually switched on. Turning
 * on analytics (or anything else non-essential) means setting NEXT_PUBLIC_ANALYTICS_ENABLED=1
 * in Vercel; `analyticsEnabled()` then returns true and the banner renders on the next
 * request. No code change required, and no banner that lies.
 */

export const CONSENT_COOKIE = "nuvora_consent";

/** One year, in seconds. */
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 365;

export type ConsentValue = "all" | "essential";

/**
 * Whether non-essential cookies are in use.
 *
 * Read at call time, not module load, so a client component can be re-rendered without
 * re-evaluating a captured constant.
 */
export function analyticsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ANALYTICS_ENABLED === "1";
}
