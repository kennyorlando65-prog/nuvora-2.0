import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { CookieConsent } from "@/components/cookie-consent";
import { analyticsEnabled } from "@/lib/consent";

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
  themeColor: "#0b0f14",
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
      <body className="min-h-dvh flex flex-col antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-bg"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        {showConsent ? <CookieConsent /> : null}
      </body>
    </html>
  );
}
