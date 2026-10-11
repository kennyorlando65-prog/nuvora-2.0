"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { CONSENT_COOKIE, CONSENT_MAX_AGE, type ConsentValue } from "@/lib/consent";

/**
 * Cookie banner - shown ONLY when a non-essential cookie is actually in use.
 *
 * The decision to render is made by the server (see app/layout.tsx, which passes
 * `needed`). This component's only job is to record the choice.
 *
 * Default is the privacy-preserving one: choosing nothing, or dismissing, leaves only the
 * strictly-necessary cookies in place. An explicit "accept" is required to allow anything
 * else, and the value is stored the same way the Cookie Policy describes.
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // The server already decided a banner is warranted; re-check the stored choice here so a
    // visitor who has answered is not asked again on a later navigation.
    try {
      const stored = document.cookie
        .split("; ")
        .find((row) => row.startsWith(`${CONSENT_COOKIE}=`))
        ?.split("=")[1];
      if (!stored) setVisible(true);
    } catch {
      // Cookie access blocked: fall back to not showing, rather than looping a banner that
      // cannot persist an answer.
    }
  }, []);

  function record(value: ConsentValue) {
    try {
      document.cookie = `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax`;
    } catch {
      // If the cookie cannot be written, still dismiss so the visitor is not trapped.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie choices"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-xl border border-line bg-panel p-5 shadow-lg"
    >
      <p className="text-sm font-semibold text-ink">A note about cookies</p>
      <p className="mt-2 text-xs leading-relaxed text-muted">
        NUVORA uses a strictly-necessary cookie to keep you signed in. It also wants to use a
        non-essential cookie, and that one is your choice. Read the{" "}
        <Link href="/legal/cookies" className="text-accent underline">
          Cookie Policy
        </Link>
        .
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => record("all")}
          className="nuvora-btn nuvora-btn-primary"
        >
          Accept all
        </button>
        <button
          type="button"
          onClick={() => record("essential")}
          className="rounded-md border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:border-accent hover:text-accent"
        >
          Essential only
        </button>
      </div>
    </div>
  );
}
