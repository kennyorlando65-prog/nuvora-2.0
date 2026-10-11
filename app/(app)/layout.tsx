import type { Metadata } from "next";

import { AppShell } from "@/components/app/app-shell";
import { requireUser } from "@/lib/app/session";

export const metadata: Metadata = {
  title: { default: "Dashboard", template: "%s | NUVORA" },
  // The signed-in app is private to the account. Nothing here should be indexed.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The signed-in app's layout - the customer gate.
 *
 * `requireUser` runs on the server for every page in this group, so an unauthenticated
 * visitor is redirected to sign-in before any page renders. This is the same pattern as
 * the admin layout, with a different question: this one asks "is anybody signed in?", the
 * admin one asks "is this person an operator?".
 *
 * The two are independent. A signed-in customer passes this check and still fails the
 * admin check, which is exactly the intended behaviour.
 */
export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = await requireUser();

  return <AppShell user={user}>{children}</AppShell>;
}
