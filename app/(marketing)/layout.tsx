import { MarketingSiteFooter, MarketingSiteHeader } from "@/components/marketing-chrome";

/**
 * The public front door's frame.
 *
 * Everything a logged-out visitor can reach lives under this group: the landing page, the
 * trust pages, the legal documents and the order receipt. The signed-in app and the admin
 * console are separate groups with their own chrome, so the marketing navigation can never
 * appear on top of the console.
 */
export default function MarketingLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-dvh flex-col">
      <MarketingSiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <MarketingSiteFooter />
    </div>
  );
}
