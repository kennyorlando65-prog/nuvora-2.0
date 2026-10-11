import Link from "next/link";
import type { User } from "@supabase/supabase-js";

import { AppNav } from "@/components/app/app-nav";
import { signOutAction } from "@/lib/auth/actions";
import { displayName, initialOf } from "@/lib/app/session";

/**
 * The signed-in app shell.
 *
 * A Server Component. The customer's identity is resolved on the server and rendered as
 * text, so the email never has to reach a client component to be displayed.
 *
 * THE SHAPE IS THE POINT. The founder asked for a real web app rather than a website, and
 * the difference is mostly this frame: a persistent sidebar, a top bar that stays put, and
 * a content area that swaps in place. The shell is a floating panel inset from the page
 * edge, which is the structure taken from the reference screenshots - it reads as an
 * application window rather than as a document with a header.
 *
 * On a phone the sidebar collapses into a horizontal strip under the top bar, because a
 * fixed sidebar on a 390px screen leaves no room for the content.
 */
export function AppShell({
  user,
  children,
}: {
  user: User;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-bg p-0 lg:p-4">
      <div className="mx-auto flex min-h-dvh max-w-[100rem] flex-col overflow-hidden border-line bg-panel-2 lg:min-h-[calc(100dvh-2rem)] lg:flex-row lg:rounded-[var(--radius-card)] lg:border lg:shadow-[var(--shadow-raised)]">
        {/* -- sidebar (desktop) ------------------------------------------- */}
        <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel lg:flex">
          <div className="flex items-center gap-2 border-b border-line px-5 py-4">
            <Link href="/dashboard" aria-label="NUVORA dashboard">
              <span className="nuvora-wordmark text-sm">NUVORA</span>
            </Link>
          </div>

          <div className="flex-1 px-3 py-4">
            <p className="nuvora-label px-3 pb-2">Menu</p>
            <AppNav />
          </div>

          <div className="border-t border-line p-3">
            <div className="flex items-center gap-3 rounded-[var(--radius-control)] px-2 py-2">
              <span
                aria-hidden="true"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent"
              >
                {initialOf(user)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-ink">{displayName(user)}</p>
                <p className="truncate text-[10px] text-dim">{user.email ?? user.id}</p>
              </div>
            </div>
            <form action={signOutAction} className="mt-1">
              <button type="submit" className="nuvora-btn nuvora-btn-ghost w-full justify-start px-3 py-2 text-xs">
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
              <Link href="/dashboard" className="lg:hidden" aria-label="NUVORA dashboard">
                <span className="nuvora-wordmark text-sm">NUVORA</span>
              </Link>

              {/* A pill search field, as in the reference layout. It is a real form that
                  navigates to the store with a query, not a decorative input. */}
              <form action="/store" method="get" className="hidden flex-1 sm:block">
                <label htmlFor="app-search" className="sr-only">
                  Search the store
                </label>
                <input
                  id="app-search"
                  name="q"
                  type="search"
                  placeholder="Search the store"
                  className="nuvora-input max-w-md rounded-[var(--radius-pill)] px-4 py-2"
                />
              </form>

              <div className="flex items-center gap-3">
                <div className="hidden flex-col items-end sm:flex">
                  <span className="nuvora-label">Signed in as</span>
                  <span className="max-w-[14rem] truncate text-xs text-ink">
                    {displayName(user)}
                  </span>
                </div>
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-soft font-mono text-xs font-semibold text-accent lg:hidden"
                >
                  {initialOf(user)}
                </span>
                <form action={signOutAction} className="lg:hidden">
                  <button type="submit" className="nuvora-btn nuvora-btn-ghost px-2 py-1.5 text-xs">
                    Sign out
                  </button>
                </form>
              </div>
            </div>

            <AppNav variant="bar" />
          </header>

          {/* -- content ---------------------------------------------------- */}
          <main id="main" className="flex-1 px-4 py-6 lg:px-6 lg:py-8">
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
