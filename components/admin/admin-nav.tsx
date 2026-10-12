"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Admin navigation with an active state.
 *
 * A client component for one reason: the active link needs the current pathname, and
 * `usePathname` is a client hook. Only the navigation is client-side - every admin page
 * behind it is a Server Component, so no order data, cost or margin crosses into the
 * browser bundle.
 *
 * THE ACTIVE STATE USES THE TEAL-TINTED SURFACE from the chosen palette, matching the
 * customer app's navigation exactly. An operator moving between the two surfaces should not
 * have to relearn which colour means "you are here".
 *
 * This navigation is reachable ONLY from inside the admin console. Nothing in the customer
 * app links to it, and no customer-facing page mentions that it exists.
 */

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/products", label: "Catalogue" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/providers", label: "Providers" },
  { href: "/admin/diagnostics", label: "Diagnostics" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav({ variant = "sidebar" }: { variant?: "sidebar" | "bar" }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  if (variant === "bar") {
    // Phone layout: a horizontal strip that scrolls rather than wraps, so the bar keeps a
    // predictable height and the content below it does not jump.
    return (
      <nav aria-label="Admin sections" className="-mx-4 overflow-x-auto px-4 lg:hidden">
        <ul className="flex items-center gap-1 whitespace-nowrap">
          {LINKS.map((link) => {
            const active = isActive(link.href);
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={`nuvora-nav-item ${active ? "nuvora-nav-item-active" : ""}`}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }

  return (
    <nav aria-label="Admin sections" className="flex flex-col gap-1">
      {LINKS.map((link) => {
        const active = isActive(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`nuvora-nav-item ${active ? "nuvora-nav-item-active" : ""}`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
