import Link from "next/link";

import { AdminNav } from "@/components/admin/admin-nav";
import { signOutAction } from "@/lib/auth/actions";
import { displayIdentity, roleOf, type RoleBearingUser } from "@/lib/auth/roles";

/**
 * The admin chrome: identity, navigation, sign-out.
 *
 * A Server Component. The operator's identity is resolved on the server and rendered as
 * text, so the email never has to reach a client component to be displayed - and there is
 * no client-side "am I an admin" state that could be tampered with.
 */
export function AdminShell({
  user,
  children,
}: {
  user: RoleBearingUser;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-8">
      <header className="flex flex-col gap-4 border-b border-line pb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="nuvora-label">NUVORA operations</span>
            <h1 className="text-xl font-semibold tracking-tight text-ink">Admin</h1>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col items-start gap-0.5 sm:items-end">
              <span className="nuvora-label">Signed in as</span>
              <span className="font-mono text-xs text-ink">{displayIdentity(user)}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                {roleOf(user) ?? "no role"}
              </span>
            </div>

            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-md border border-line bg-panel px-3 py-1.5 text-sm text-muted transition-colors hover:border-bad/50 hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>

        <AdminNav />
      </header>

      <main className="flex flex-col gap-6">{children}</main>

      <footer className="border-t border-line pt-4 text-xs text-dim">
        <p>
          Every administrative change is written to the audit log with the actor taken from
          the verified session token.{" "}
          <Link href="/admin/audit" className="text-muted underline hover:text-ink">
            Review the trail
          </Link>
        </p>
      </footer>
    </div>
  );
}
