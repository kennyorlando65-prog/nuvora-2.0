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
 */

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/orders", label: "Orders" },
  { href: "/admin/products", label: "Catalogue" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/providers", label: "Providers" },
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/audit", label: "Audit log" },
];

export function AdminNav() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <nav aria-label="Admin sections" className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
      <ul className="flex items-center gap-1 whitespace-nowrap">
        {LINKS.map((link) => {
          const active = isActive(link.href);
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "block rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent"
                    : "block rounded-md border border-transparent px-3 py-1.5 text-sm text-muted transition-colors hover:border-line hover:text-ink"
                }
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
