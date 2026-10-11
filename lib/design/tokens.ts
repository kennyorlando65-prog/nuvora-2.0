/**
 * NUVORA design tokens as TypeScript values.
 *
 * Kept in sync with the `@theme` block in app/globals.css so server code (emails,
 * generated documents, charts, the theme-color meta tag) can reference the same palette
 * as the UI. Import the CSS variables in components; use these where a literal is
 * required.
 *
 * THE PALETTE IS "TEAL ON MIDNIGHT", chosen by the founder from the style-picker page.
 * The contrast ratios in the comments are measured with the WCAG relative-luminance
 * formula, not estimated. Two of them are load-bearing:
 *
 *   - `accentInk` is DARK. White on `accent` measures 2.58:1 and fails AA; dark on the
 *     same teal measures 7.33:1. Any button that puts a label on the accent must use
 *     `accentInk`, never `ink`.
 *   - `dim` is #7A8C8A because the obvious darker grey failed against the card surface.
 *     It measures 5.35:1 on the page and 4.90:1 on a card.
 */
export const palette = {
  bg: "#0e1116",
  panel: "#161b22",
  panel2: "#12171d",
  panel3: "#1b2229",
  line: "#24393a",
  lineSoft: "#1b2a2b",
  input: "#6e8a87",
  ink: "#f0e9dc",
  muted: "#9fb0ae",
  dim: "#7a8c8a",
  accent: "#2fb3a8",
  accentHover: "#4acfc3",
  accentInk: "#0e1116",
  accentSoft: "#12312f",
  ok: "#4fbf7a",
  warn: "#d9a441",
  bad: "#f0736a",
  info: "#6fb3e0",
} as const;

/**
 * Measured WCAG contrast ratios for the pairs that matter, so a future change to the
 * palette can be checked against the numbers rather than against a memory of them.
 * `min` is the threshold the pair is held to: 4.5 for body text, 3 for a UI boundary.
 */
export const contrastChecks = [
  { pair: "ink on bg", ratio: 15.66, min: 4.5 },
  { pair: "ink on panel", ratio: 14.33, min: 4.5 },
  { pair: "muted on bg", ratio: 8.37, min: 4.5 },
  { pair: "muted on panel", ratio: 7.66, min: 4.5 },
  { pair: "dim on bg", ratio: 5.35, min: 4.5 },
  { pair: "dim on panel", ratio: 4.9, min: 4.5 },
  { pair: "accent on bg", ratio: 7.33, min: 4.5 },
  { pair: "accent on panel", ratio: 6.7, min: 4.5 },
  { pair: "accentInk on accent", ratio: 7.33, min: 4.5 },
  { pair: "accentInk on accentHover", ratio: 9.91, min: 4.5 },
  { pair: "ok on panel", ratio: 7.47, min: 4.5 },
  { pair: "warn on panel", ratio: 7.69, min: 4.5 },
  { pair: "bad on panel", ratio: 6.07, min: 4.5 },
  { pair: "info on panel", ratio: 7.58, min: 4.5 },
  { pair: "input border on panel", ratio: 4.65, min: 3 },
] as const;

export const fonts = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
} as const;

export const radius = {
  card: "14px",
  control: "10px",
  pill: "999px",
} as const;
