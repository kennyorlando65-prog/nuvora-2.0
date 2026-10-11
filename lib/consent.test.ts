import { afterEach, describe, expect, it } from "vitest";

import { analyticsEnabled, CONSENT_COOKIE, CONSENT_MAX_AGE } from "./consent";

/**
 * The invariant worth locking: the cookie banner must NOT be shown while the site sets
 * only strictly-necessary cookies. If this test ever fails in the "off" direction, a
 * consent banner has appeared for cookies that do not exist - which is both bad privacy
 * practice and a broken promise in the Cookie Policy.
 */
describe("cookie consent gating", () => {
  const original = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED;

  afterEach(() => {
    if (original === undefined) delete process.env.NEXT_PUBLIC_ANALYTICS_ENABLED;
    else process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = original;
  });

  it("does not ask for consent when no non-essential cookie exists", () => {
    delete process.env.NEXT_PUBLIC_ANALYTICS_ENABLED;
    expect(analyticsEnabled()).toBe(false);
  });

  it("asks for consent once a non-essential cookie is switched on", () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "1";
    expect(analyticsEnabled()).toBe(true);
  });

  it("treats any other value as off, so a typo cannot silently enable tracking", () => {
    process.env.NEXT_PUBLIC_ANALYTICS_ENABLED = "true";
    expect(analyticsEnabled()).toBe(false);
  });

  it("records a choice that outlives a single session", () => {
    expect(CONSENT_COOKIE).toBe("nuvora_consent");
    expect(CONSENT_MAX_AGE).toBeGreaterThanOrEqual(60 * 60 * 24 * 30);
  });
});
