import type { Metadata, Viewport } from "next";
import "./globals.css";
import { CookieConsent } from "@/components/cookie-consent";
import { analyticsEnabled } from "@/lib/consent";
import { palette } from "@/lib/design/tokens";

/**
 * The root layout.
 *
 * IT RENDERS NO CHROME. There is no header and no footer here, and that is the point:
 * the public front door, the signed-in app and the admin area each need a different
 * frame, and a shared header in the root would put the marketing navigation on top of
 * the admin console. Each route group supplies its own chrome instead.
 *
 * The one thing that does belong at the root is the cookie banner, because it is about
 * the whole site rather than about any one section.
 */

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: {
    default: "NUVORA - Digital services, delivered",
    template: "%s | NUVORA",
  },
  description:
    "Buy eSIM data plans, top-ups, gift cards, game credits and subscriptions. Pay per order, no wallet, no stored balance.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  // Matches --color-bg so the browser chrome on a phone blends with the page instead of
  // flashing a different colour above it.
  themeColor: palette.bg,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // The banner is rendered only when a non-essential cookie is actually in use. While the
  // site sets nothing but the sign-in session cookie, asking for consent would be asking
  // about something that is not happening - see lib/consent.ts.
  const showConsent = analyticsEnabled();

  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
        >
          Skip to content
        </a>
        {children}
        {showConsent ? <CookieConsent /> : null}
      </body>
    </html>
  );
}
