import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/admin-shell";
import { getSessionUser } from "@/lib/auth/guard";
import { isAdminUser } from "@/lib/auth/roles";

export const metadata: Metadata = {
  title: { default: "Admin", template: "%s | Admin | NUVORA" },
  // An admin surface must never be indexed. A single crawled order page would publish a
  // customer's email address in a search result.
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Admin layout - the authoritative gate.
 *
 * Middleware already refuses a non-admin with a 403 before this runs, so in practice each
 * branch below is unreachable through the normal request path. It is implemented anyway,
 * because middleware can be misconfigured, a matcher can be edited by mistake, and this is
 * the layer that runs in-process with the data access. Two independent checks, and the
 * inner one is the one that cannot be edited from outside the codebase.
 *
 * NOTE ON THE SHAPE. This layout RENDERS the refusal for a signed-in non-admin rather than
 * redirecting to a "forbidden" route. A redirect would target a path under /admin, which
 * is guarded by this same layout - an infinite loop, and a loop is exactly what the brief
 * asked to avoid. Rendering means no admin query runs, no admin data is fetched, and the
 * operator sees a clear refusal.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user } = await getSessionUser();

  if (!user) {
    redirect("/auth/sign-in?next=%2Fadmin");
  }

  if (!isAdminUser(user)) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-16">
        <div className="nuvora-card flex flex-col gap-3 p-6">
          <span className="nuvora-label">403 - Forbidden</span>
          <h1 className="text-xl font-semibold tracking-tight text-ink">
            This account is not a NUVORA administrator
          </h1>
          <p className="text-sm text-muted">
            You are signed in as{" "}
            <span className="font-mono text-xs text-ink">{user.email ?? user.id}</span>, but
            this area is restricted to operator accounts. Signing in again will not change
            that: the privilege has to be granted to your account by an existing
            administrator, and it is stored in a field that only the server can write.
          </p>
          <p className="text-sm text-muted">
            If you believe this is a mistake, contact support and quote your account email.
          </p>
        </div>
      </div>
    );
  }

  return <AdminShell user={user}>{children}</AdminShell>;
}
