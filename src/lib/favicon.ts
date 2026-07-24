/**
 * The Ruteark mark: a 2x2 ruled square (hairline grid) with one cell filled
 * in the accent green — "the squared paper every Norwegian student sketches
 * a timetable on" (docs/DESIGN.md §1). Rendered on a fixed dark ground so
 * the tab icon reads the same regardless of the page's current theme.
 * Inlined as a `data:` URI so there is no per-build asset to manage.
 */

/** Flexoki black ground (matches tokens.css's dark-mode `--bg`). */
export const GROUND = "#100f0f";

/** Neutral hairline color for the ruling strokes (theme-independent). */
export const LINE = "#575653";

/**
 * Flexoki green (matches tokens.css's light-mode `--accent`). Build-time SVG
 * markup can't read CSS custom properties, so this is the one sanctioned
 * literal — callers should use it rather than re-hardcoding the hex value.
 */
export const ACCENT = "#66800b";

/** The 2x2 ruled square mark as an SVG string, one cell filled with `accent`. */
export function faviconSvg(accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Semesterplan">` +
    `<rect x="4" y="4" width="56" height="56" rx="9" fill="${GROUND}"/>` +
    `<rect x="16" y="16" width="14" height="14" fill="${accent}"/>` +
    `<path d="M16 30h28M30 16v28" stroke="${LINE}" stroke-width="2"/>` +
    `<rect x="15.5" y="15.5" width="33" height="33" fill="none" stroke="${LINE}" stroke-width="2"/>` +
    `</svg>`
  );
}

/**
 * The mark as an inline `data:image/svg+xml` URI, ready for
 * `<link rel="icon">`. `accent` may be any CSS color; the `#` in hex colors
 * is escaped so it isn't read as a URL fragment.
 */
export function faviconDataUri(accent: string): string {
  return `data:image/svg+xml,${encodeURIComponent(faviconSvg(accent))}`;
}
