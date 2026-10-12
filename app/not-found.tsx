import Link from "next/link";

import { supportEmail } from "@/lib/site";

/**
 * The 404.
 *
 * DELIBERATELY NOT A CARBON COPY OF THE REST OF THE SITE. It keeps the palette and the type
 * scale, but it drops the marketing chrome: no product grid, no sign-up push, no second
 * attempt at selling. A person who reached a dead link wants to get where they were going, and
 * a page covered in calls to action gets in the way of that.
 *
 * IT IS ALSO NOT DRESSED AS A FAILURE. A 404 is not critical - nothing broke and nothing was
 * charged - so it uses a neutral notice band rather than the danger treatment the 500 uses.
 * An interface that treats every bad link as an emergency teaches people to ignore the colour
 * that means an emergency.
 */
export default function NotFound() {
  return (
    <main
      id="main"
      className="mx-auto flex min-h-[70dvh] w-full max-w-3xl flex-col justify-center px-5 py-16"
    >
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-panel shadow-[var(--shadow-card)]">
        <div className="flex items-center gap-3 border-b border-line bg-panel-2 px-5 py-3">
          <span className="h-2 w-2 shrink-0 rounded-full bg-warn" aria-hidden="true" />
          <span className="font-mono text-[10px] uppercase tracking-widest text-warn">
            Error 404 - page not found
          </span>
        </div>

        <div className="p-6 sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
            This page does not exist
          </h1>

          <p className="mt-4 text-sm leading-relaxed text-muted">
            The link may be old, mistyped, or for something that has been withdrawn. Nothing
            broke: no payment was taken and no order was affected.
          </p>

          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/" className="nuvora-btn nuvora-btn-primary">
              Go to the home page
            </Link>
            <Link href="/contact" className="nuvora-btn nuvora-btn-secondary">
              Contact support
            </Link>
          </div>

          <p className="mt-6 text-xs leading-relaxed text-dim">
            Looking for an order? Order pages are reached from the link you were given after
            checkout, or from your orders list once you are signed in. If you have lost the
            link, email{" "}
            <a href={`mailto:${supportEmail}`} className="text-muted underline hover:text-accent">
              {supportEmail}
            </a>{" "}
            and it can be reissued.
          </p>
        </div>
      </div>
    </main>
  );
}
