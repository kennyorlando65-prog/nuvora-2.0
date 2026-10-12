import Link from "next/link";

/**
 * The NUVORA wordmark.
 *
 * THERE IS NO LOGO FILE, and none is invented. The mark is the plain word NUVORA in clean
 * type, so its presence has to come entirely from typography - weight, size, letter-spacing
 * and the space held around it. That is what this component is for: to make the mark
 * consistent and deliberate wherever it appears, rather than a span with a class on it in a
 * dozen different files.
 *
 * THE RULE IS THE ONE GRAPHIC ELEMENT. A short hairline in the accent sits beneath the word.
 * It is not decoration for its own sake: it repeats the motif's language of thin signal lines
 * and gives the mark something to stand on, which is what stops a word in wide caps from
 * floating.
 *
 * ACCESSIBILITY. The anchor carries an aria-label naming the destination, and the visual word
 * is marked aria-hidden so a screen reader announces "NUVORA home" once rather than spelling
 * out a spaced word. Without that, wide tracking is read letter by letter by some screen
 * readers - the visual treatment quietly breaking the accessible one.
 */

export type WordmarkSize = "sm" | "md" | "lg";

const SIZE_CLASS: Record<WordmarkSize, string> = {
  sm: "nuvora-wordmark-sm",
  md: "nuvora-wordmark-md",
  lg: "nuvora-wordmark-lg",
};

export function Wordmark({
  size = "md",
  href,
  label,
  rule = false,
  tagline,
  className = "",
}: {
  size?: WordmarkSize;
  /** When set the mark is a link. Omitted for a static mark, such as in a footer. */
  href?: string;
  /** Accessible name. Defaults to the destination, or "NUVORA". */
  label?: string;
  /** Show the accent hairline beneath the word. */
  rule?: boolean;
  /** Optional small line under the mark, e.g. the surface name. */
  tagline?: string;
  className?: string;
}) {
  const mark = (
    <span className="inline-flex flex-col gap-2">
      <span aria-hidden="true" className={SIZE_CLASS[size]}>
        NUVORA
      </span>
      {rule && <span aria-hidden="true" className="nuvora-wordmark-rule" />}
      {tagline && (
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-dim">
          {tagline}
        </span>
      )}
    </span>
  );

  if (!href) {
    return (
      <span className={className}>
        <span className="sr-only">NUVORA</span>
        {mark}
      </span>
    );
  }

  return (
    <Link href={href} aria-label={label ?? "NUVORA"} className={`inline-flex ${className}`}>
      <span className="sr-only">NUVORA</span>
      {mark}
    </Link>
  );
}
