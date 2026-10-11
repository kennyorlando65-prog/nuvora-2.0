import Link from "next/link";

const nav = [
  { href: "/#catalogue", label: "Store" },
  { href: "/#principles", label: "How we operate" },
  { href: "/api/health", label: "Status" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3.5">
        <Link href="/" className="flex items-baseline gap-2" aria-label="NUVORA home">
          <span className="text-lg font-semibold tracking-tight text-ink">NUVORA</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-dim">
            2.0
          </span>
        </Link>

        <nav aria-label="Primary" className="flex items-center gap-1 sm:gap-2">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-2.5 py-2 text-sm text-muted transition-colors hover:text-ink sm:px-3"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
