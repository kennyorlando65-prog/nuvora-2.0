/**
 * NUVORA design tokens as TypeScript values.
 *
 * Kept in sync with the `@theme` block in app/globals.css so server code (emails,
 * generated documents, charts) can reference the same palette as the UI.
 * Import the CSS variables in components; use these where a literal is required.
 */
export const palette = {
  bg: "#0b0f14",
  panel: "#121820",
  panel2: "#0f151d",
  line: "#212b36",
  lineSoft: "#1a222c",
  ink: "#e6edf3",
  muted: "#8b98a5",
  dim: "#5f6b78",
  accent: "#f0b429",
  ok: "#3fb950",
  bad: "#f85149",
  info: "#58a6ff",
} as const;

export const fonts = {
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace',
} as const;

export const radius = {
  card: "14px",
} as const;
