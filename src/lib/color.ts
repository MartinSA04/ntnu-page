/**
 * Color utilities for the accent-contrast guard.
 *
 * The per-course `accent` is arbitrary (`course.accent`), so two things must
 * stay legible regardless of what a course picks: text placed ON the accent
 * (skip-link, SelfCheck badge, filled chips) and the accent used AS link text
 * on the page ground. CourseLayout derives `--accent-contrast` from the
 * accent's luminance at build time, and the build warns (dev and production) if
 * the accent is too light to read as a link.
 */

/** Parse #rgb / #rgba / #rrggbb / #rrggbbaa to [r,g,b] (0–255), or null. */
export function parseHex(input: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3,8})$/i.exec(input.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  if (h.length !== 6 && h.length !== 8) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** WCAG relative luminance (0–1) from sRGB 0–255. */
export function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio (1–21) between two luminances. */
export function contrastRatio(l1: number, l2: number): number {
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_INK = "#ffffff";
const DARK_INK = "#100f0f"; // matches the token system's --fg near-black

/**
 * The legible text color (light or dark ink) to sit ON `accent`. The accent is
 * the same in light and dark themes, so this is theme-independent. Falls back
 * to white for un-parseable CSS colors (named / hsl() / etc.).
 */
export function contrastText(accent: string): string {
  const rgb = parseHex(accent);
  if (!rgb) return LIGHT_INK;
  const la = luminance(rgb);
  const onDarkInk = contrastRatio(la, luminance([16, 15, 15]));
  const onWhite = contrastRatio(la, 1);
  return onDarkInk >= onWhite ? DARK_INK : LIGHT_INK;
}

/** Contrast of `accent` used AS text on a background hex (for the build warning). */
export function accentOnBg(accent: string, bgHex: string): number | null {
  const a = parseHex(accent);
  const b = parseHex(bgHex);
  if (!a || !b) return null;
  return contrastRatio(luminance(a), luminance(b));
}

/**
 * The AA-safe accent-as-text color: `accent` mixed 75% toward `fg`, per
 * channel, in sRGB — the build-time equivalent of tokens.css's
 * `--accent-ink: color-mix(in srgb, var(--accent) 75%, var(--fg))`. Falls back
 * to `accent` unchanged for un-parseable CSS colors (named / hsl() / etc.).
 */
export function accentInk(accent: string, fg: string): string {
  const a = parseHex(accent);
  const f = parseHex(fg);
  if (!a || !f) return accent;
  const mix = (i: number) => Math.round(a[i] * 0.75 + f[i] * 0.25);
  return `#${[mix(0), mix(1), mix(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Accent share (0–1) of the two accent-TINTED grounds that --accent-ink text
 * renders on, copied from tokens.css so they move together:
 *   --accent-soft: color-mix(in srgb, var(--accent) 10%, var(--bg-elevated))
 *   --accent-weak: color-mix(in srgb, var(--accent) 12%, transparent)
 * --accent-weak paints over the same --bg-elevated panels, so 12% accent over
 * --bg-elevated reproduces its composite. Must track tokens.css:27-28.
 */
export const ACCENT_SOFT_MIX = 0.1;
export const ACCENT_WEAK_MIX = 0.12;

/**
 * Reproduce `color-mix(in srgb, a <weight>, b)` for two opaque colors: a
 * gamma-encoded per-channel mix, channel = round(a*weight + b*(1-weight)) — the
 * same composite `color-mix(in srgb, a P%, transparent)` yields when painted
 * over an opaque `b`. Unlike the guard's literal neutral grounds (copied hex),
 * an accent-tinted ground depends on the per-course accent and must be computed;
 * this stays a pure named export so it still tree-shakes. Falls back to null for
 * un-parseable CSS colors (named / hsl() / etc.).
 */
export function mixSrgb(a: string, b: string, weight: number): string | null {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return null;
  const ch = (i: number) => Math.round(ca[i] * weight + cb[i] * (1 - weight));
  return `#${[ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
