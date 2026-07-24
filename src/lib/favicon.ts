/**
 * Per-course favicon.
 *
 * The mark is the `>_` command-prompt glyph from martinsundal.no, but tinted to
 * the course's brand accent so each open tab is identifiable at a glance. The
 * ground is a fixed near-black so the mark pairs with any accent hue and reads
 * on both light and dark browser chrome; every foreground element (border,
 * chevron, underscore) uses the single accent. CourseLayout inlines the result
 * as a `data:` URI, so it's generated at render time with no per-course file.
 */

/** Near-black ground, neutral so it sits under any accent hue. */
export const GROUND = "#0b0e14";

/** The `>_` mark as an SVG string, foreground tinted with `accent`. */
export function faviconSvg(accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="study-companion">` +
    `<rect x="4" y="6" width="56" height="52" rx="9" fill="${GROUND}" stroke="${accent}" stroke-width="5"/>` +
    `<path d="M18 21l11 11-11 11" fill="none" stroke="${accent}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<rect x="34" y="41" width="17" height="6" rx="2" fill="${accent}"/>` +
    `</svg>`
  );
}

/**
 * The `>_` favicon as an inline `data:image/svg+xml` URI, ready for
 * `<link rel="icon">`. `accent` may be any CSS color; it's encoded verbatim
 * (the `#` in hex colors is escaped so it isn't read as a URL fragment).
 */
export function faviconDataUri(accent: string): string {
  return "data:image/svg+xml," + encodeURIComponent(faviconSvg(accent));
}

/**
 * The `>_` mark as a single-layer monochrome silhouette for Safari's pinned-tab
 * `mask-icon` (the chevron + underscore only, no ground). Safari masks by the
 * shapes' alpha and tints with the `<link … color>` attribute, so the fill here
 * is irrelevant — only the geometry matters. Emitted as a real file at build.
 */
export function maskIconSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<path d="M18 21l11 11-11 11" fill="none" stroke="#000" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<rect x="34" y="41" width="17" height="6" rx="2" fill="#000"/>` +
    `</svg>`
  );
}
