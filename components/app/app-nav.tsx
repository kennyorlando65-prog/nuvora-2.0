"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The signed-in app's navigation.
 *
 * A client component for one reason: the active link needs the current pathname, and
 * `usePathname` is a client hook. Only the navigation is client-side - every page behind it
 * is a Server Component, so no order data crosses into the browser bundle.
 *
 * THERE IS NO ADMIN LINK HERE, and that is a requirement rather than an omission. The
 * admin console must be completely invisible in the customer UI: no link, no menu item, no
 * mention. The operator knows the address and the server-side gate is what actually keeps
 * everyone else out - hiding the link is the finishing touch, not the lock.
 */

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/store", label: "Store" },
  { href: "/orders", label: "My orders" },
];

export function AppNav({ variant = "sidebar" }: { variant?: "sidebar" | "bar" }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  if (variant === "bar") {
    // Phone layout: a horizontal strip. Scrolls rather than wrapping, so the bar keeps a
    // predictable height and the content below it does not jump.
    return (
      <nav aria-label="App sections" className="-mx-4 overflow-x-auto px-4 lg:hidden">
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
    <nav aria-label="App sections" className="flex flex-col gap-1">
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
