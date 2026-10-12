/**
 * The NUVORA signal motif.
 *
 * WHAT IT IS, AND WHY THIS AND NOT SOMETHING ELSE. The brief asked for a visual motif unique
 * to NUVORA, drawn from what the product actually is: network, fulfilment, digital delivery,
 * signal paths. NUVORA does not warehouse or ship anything - it routes a paid order to a
 * supplier and returns a digital good. That IS a signal path between nodes: our node, the
 * supplier's node, and the delivery travelling between them. So the motif is exactly that -
 * a small network of nodes joined by signal paths.
 *
 * IT IS INLINE SVG, NOT AN IMAGE FILE. Three reasons: there is no asset pipeline to maintain;
 * it inherits the palette through `currentColor`, so it can never drift from the tokens; and
 * it stays crisp at any size and costs one DOM subtree rather than a network request.
 *
 * IT IS aria-hidden AND POINTER-EVENTS: NONE. It is ornament. It carries no information that
 * is not already in the text beside it, so it must not appear in the accessibility tree, and
 * it must never intercept a click that was meant for a link underneath it. Both are set here
 * once rather than remembered at every call site.
 *
 * NO GRADIENTS. The brief rules out decorative gradients, and these are pure strokes and
 * filled nodes - which also means every element renders at full contrast in forced-colours
 * mode instead of degrading to a grey smear.
 */

export type MotifVariant = "rule" | "corner" | "panel" | "mark";

type MotifProps = {
  variant?: MotifVariant;
  /** `line` is the quiet default; `accent` for the moments the brand should show. */
  tone?: "line" | "accent";
  className?: string;
};

const TONE_CLASS: Record<NonNullable<MotifProps["tone"]>, string> = {
  line: "nuvora-motif",
  accent: "nuvora-motif nuvora-motif-accent",
};

/**
 * A horizontal run of signal paths.
 *
 * Used along a section edge - under a header, above a band - to break the vertical rhythm of
 * a long page. It reads as a horizon of connections without being a picture of anything.
 */
function RuleMotif() {
  return (
    <svg
      viewBox="0 0 320 24"
      fill="none"
      preserveAspectRatio="xMidYMid meet"
      className="h-6 w-full"
      aria-hidden="true"
      focusable="false"
    >
      {/* The trunk line every branch leaves from. */}
      <path d="M0 12h56" stroke="currentColor" strokeWidth="1" opacity="0.7" />
      {/* Branches: each one leaves the trunk, rises and returns - a route out and back. */}
      <path d="M56 12c8 0 8-8 16-8h20" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M56 12c8 0 8 8 16 8h20" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M92 4h44" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M92 20h44" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M136 4c8 0 8 8 16 8s8-8 16-8" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M136 20c8 0 8-8 16-8" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M168 12h48" stroke="currentColor" strokeWidth="1" opacity="0.7" />
      <path d="M216 12c8 0 8-6 16-6h24" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M216 12c8 0 8 6 16 6h24" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M256 6h40" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M256 18h40" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M296 6c8 0 8 6 16 6h8" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <path d="M296 18c8 0 8-6 16-6" stroke="currentColor" strokeWidth="1" opacity="0.5" />

      {/* Nodes. A filled dot marks a place a signal actually lands. */}
      <circle cx="56" cy="12" r="2.5" fill="currentColor" />
      <circle cx="168" cy="12" r="2.5" fill="currentColor" />
      <circle cx="136" cy="12" r="2" fill="currentColor" opacity="0.8" />
      <circle cx="216" cy="12" r="2" fill="currentColor" opacity="0.8" />
    </svg>
  );
}

/**
 * A corner fan of signal paths.
 *
 * Used as a quiet backdrop behind a hero or a header, anchored to one corner so it never sits
 * behind the text. Larger and calmer than the rule: the point is a sense of a network
 * arriving from off-screen, not a diagram.
 */
function CornerMotif() {
  return (
    <svg
      viewBox="0 0 400 300"
      fill="none"
      preserveAspectRatio="xMaxYMin slice"
      className="h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M120 0v96c0 12 10 22 22 22h96" stroke="currentColor" strokeWidth="1" opacity="0.55" />
      <path d="M170 0v58c0 10 8 18 18 18h120" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M220 0v30c0 8 7 15 15 15h165" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <path d="M70 0v150c0 14 11 25 25 25h80" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M20 0v210c0 16 13 29 29 29h60" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <path d="M238 118h72" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M175 175h56c10 0 18 8 18 18v40" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <path d="M109 242h48c12 0 22 10 22 22v36" stroke="currentColor" strokeWidth="1" opacity="0.25" />

      <circle cx="142" cy="118" r="3" fill="currentColor" />
      <circle cx="310" cy="118" r="3" fill="currentColor" />
      <circle cx="249" cy="175" r="2.5" fill="currentColor" opacity="0.85" />
      <circle cx="179" cy="242" r="2.5" fill="currentColor" opacity="0.7" />
      <circle cx="188" cy="58" r="2.5" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

/**
 * A dense panel of paths.
 *
 * Used where a large area is otherwise plain - the panel beside a hero, or a band between
 * sections - so the space carries the brand instead of reading as an empty box.
 */
function PanelMotif() {
  return (
    <svg
      viewBox="0 0 360 220"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      className="h-full w-full"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M0 40h74c10 0 18-8 18-18V0" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <path d="M0 92h50c12 0 22 10 22 22v54" stroke="currentColor" strokeWidth="1" opacity="0.45" />
      <path d="M0 156h30c14 0 25 11 25 25v39" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <path d="M92 68h96c12 0 22-10 22-22V0" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M72 220v-46c0-12 10-22 22-22h140" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M234 152h96c14 0 25-11 25-25V96" stroke="currentColor" strokeWidth="1" opacity="0.35" />
      <path d="M210 46h64c12 0 22 10 22 22v26" stroke="currentColor" strokeWidth="1" opacity="0.3" />
      <path d="M296 94h64" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M150 220v-24c0-10 8-18 18-18h78" stroke="currentColor" strokeWidth="1" opacity="0.25" />

      <circle cx="92" cy="68" r="3" fill="currentColor" />
      <circle cx="234" cy="152" r="3" fill="currentColor" />
      <circle cx="296" cy="94" r="2.5" fill="currentColor" opacity="0.85" />
      <circle cx="22" cy="92" r="2.5" fill="currentColor" opacity="0.7" />
      <circle cx="296" cy="68" r="2.5" fill="currentColor" opacity="0.7" />
      <circle cx="168" cy="220" r="2.5" fill="currentColor" opacity="0.7" />
    </svg>
  );
}

/**
 * The compact mark: three nodes joined in a line.
 *
 * For places a full motif would be noise - a sidebar header, an error page band. It is the
 * motif reduced to its smallest true form rather than a different graphic.
 */
function MarkMotif() {
  return (
    <svg
      viewBox="0 0 44 16"
      fill="none"
      className="h-4 w-11"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M4 8h12M20 8h12" stroke="currentColor" strokeWidth="1.25" opacity="0.8" />
      <path d="M16 8c3 0 3-5 6-5s3 5 6 5" stroke="currentColor" strokeWidth="1" opacity="0.5" />
      <circle cx="4" cy="8" r="2" fill="currentColor" />
      <circle cx="22" cy="3" r="1.75" fill="currentColor" opacity="0.85" />
      <circle cx="40" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

export function SignalMotif({ variant = "rule", tone = "line", className = "" }: MotifProps) {
  const inner =
    variant === "corner" ? (
      <CornerMotif />
    ) : variant === "panel" ? (
      <PanelMotif />
    ) : variant === "mark" ? (
      <MarkMotif />
    ) : (
      <RuleMotif />
    );

  // A non-rule variant is a backdrop: absolutely positioned, and it must never clip a
  // neighbour, so it is overflow-hidden by its own wrapper rather than by the parent.
  const layout =
    variant === "corner" || variant === "panel"
      ? `pointer-events-none absolute inset-0 overflow-hidden ${TONE_CLASS[tone]}`
      : `pointer-events-none ${TONE_CLASS[tone]}`;

  return <div className={`${layout} ${className}`}>{inner}</div>;
}

/**
 * A hairline rule with the motif running along it.
 *
 * This is the piece that does the structural work: it separates two sections without a heavy
 * border, and it gives the brand somewhere to appear between them.
 */
export function SectionRule({ tone = "line" }: { tone?: "line" | "accent" }) {
  return (
    <div className="relative w-full">
      <div className="absolute inset-x-0 top-1/2 h-px bg-line-soft" aria-hidden="true" />
      <div className="relative mx-auto flex max-w-6xl items-center px-5">
        <div className="bg-bg pr-4">
          <SignalMotif variant="mark" tone={tone} />
        </div>
      </div>
    </div>
  );
}
