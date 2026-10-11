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
 *
 * THE SHAPE MATCHES THE CUSTOMER APP SHELL, deliberately. The admin console and the
 * storefront are the same product, and an operator who moves between them should not feel
 * they have changed applications. Same floating panel, same sidebar, same top bar, same
 * tokens - so a palette change lands in both at once and neither can drift.
 *
 * WHAT IS DIFFERENT, AND WHY. The sidebar carries an "Operations" label and the top bar
 * carries the operator's role, because an operator needs to be certain which surface they
 * are on before they change a price or block an account. The customer shell has no such
 * marker, because a customer has no second surface to confuse this one with.
 */
export function AdminShell({
  user,
  children,
}: {
  user: RoleBearingUser;
  children: React.ReactNode;
}) {
  const identity = displayIdentity(user);
  const role = roleOf(user) ?? "no role";

  return (
    <div className="min-h-dvh bg-bg p-0 lg:p-4">
      <div className="mx-auto flex min-h-dvh max-w-[100rem] flex-col overflow-hidden border-line bg-panel-2 lg:min-h-[calc(100dvh-2rem)] lg:flex-row lg:rounded-[var(--radius-card)] lg:border lg:shadow-[var(--shadow-raised)]">
        {/* -- sidebar (desktop) ------------------------------------------- */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
          <div className="flex flex-col gap-1 border-b border-line px-5 py-4">
            <Link href="/admin" aria-label="NUVORA operations">
              <span className="nuvora-wordmark text-sm">NUVORA</span>
            </Link>
            <span className="nuvora-label">Operations</span>
          </div>

          <div className="flex-1 px-3 py-4">
            <p className="nuvora-label px-3 pb-2">Console</p>
            <AdminNav />
          </div>

          <div className="border-t border-line p-3">
            <div className="flex items-center gap-3 rounded-[var(--radius-control)] px-2 py-2">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent"
              >
                {identity.slice(0, 1).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">{identity}</p>
                <p className="truncate font-mono text-[10px] uppercase tracking-wider text-accent">
                  {role}
                </p>
              </div>
            </div>
            <form action={signOutAction} className="mt-1">
              <button
                type="submit"
                className="nuvora-btn nuvora-btn-ghost w-full justify-start px-3 py-2 text-xs"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>

        {/* -- main column -------------------------------------------------- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* -- top bar ---------------------------------------------------- */}
          <header className="flex flex-col gap-3 border-b border-line bg-panel px-4 py-3 lg:px-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5 lg:hidden">
                <Link href="/admin" aria-label="NUVORA operations">
                  <span className="nuvora-wordmark text-sm">NUVORA</span>
                </Link>
                <span className="nuvora-label">Operations</span>
              </div>

              <div className="hidden flex-col gap-0.5 lg:flex">
                <span className="nuvora-label">Administrator console</span>
                <span className="text-xs text-muted">
                  Every change here is recorded in the audit log.
                </span>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden flex-col items-end sm:flex">
                  <span className="nuvora-label">Signed in as</span>
                  <span className="max-w-[16rem] truncate font-mono text-xs text-ink">
                    {identity}
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-accent">
                    {role}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent lg:hidden"
                >
                  {identity.slice(0, 1).toUpperCase()}
                </span>
                <form action={signOutAction} className="lg:hidden">
                  <button
                    type="submit"
                    className="nuvora-btn nuvora-btn-ghost px-2 py-1.5 text-xs"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </div>

            <AdminNav variant="bar" />
          </header>

          {/* -- content ---------------------------------------------------- */}
          <main id="main" className="flex-1 px-4 py-6 lg:px-6 lg:py-8">
            <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">{children}</div>
          </main>

          <footer className="border-t border-line px-4 py-4 lg:px-6">
            <p className="text-xs text-dim">
              Every administrative change is written to the audit log with the actor taken from
              the verified session token.{" "}
              <Link href="/admin/audit" className="text-muted underline hover:text-accent">
                Review the trail
              </Link>
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}
