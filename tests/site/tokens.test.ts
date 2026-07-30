import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Contrast floors for the ink/surface pairs the product actually renders.
 *
 * These exist because two of them shipped under AA and no gate could see it:
 * dark `--clash` measured 4.42:1 on `--bg` — the sentence naming which two
 * courses collide, i.e. the single most consequential string the tool
 * produces — and light `--accent-contrast` on `--accent` measured 4.39:1 on
 * every accent-filled control including the Studieinfo primary
 * (audit a11y-5 / a11y-6). Both are 13.44px/400–500 text, so WCAG AA's 4.5:1
 * applies, not the 3:1 large-text exception.
 *
 * `--accent` is gone (REWORK-2026-07-30). It became `--verdict`, which is
 * greener AND darker precisely so that one token can be both the text and the
 * fill — the pair of tokens the old accent needed (`-ink` at 7.63:1 to be
 * readable, `-strong` at 6.03:1 to be fillable) existed only because green-600
 * cleared neither. The floor below is therefore checked in BOTH directions and
 * on all three paper steps, which is the claim that replaced them.
 *
 * The ratios are computed from the literal hex in tokens.css, so changing a
 * swatch re-runs the measurement rather than the reviewer's eye.
 */

const TOKENS = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");

/** The declarations inside one selector block of tokens.css. */
function tokenBlock(selector: string): Map<string, string> {
  const start = TOKENS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block in tokens.css`);
  const end = TOKENS.indexOf("\n}", start);
  const body = TOKENS.slice(start, end);
  const out = new Map<string, string>();
  for (const match of body.matchAll(/^\s*(--[a-z-]+):\s*([^;]+);/gm)) {
    const [, name, value] = match;
    if (name && value) out.set(name, value.trim());
  }
  return out;
}

const LIGHT = tokenBlock(":root");
const DARK = tokenBlock(':root[data-theme="dark"]');

/** Resolve a token to a `#rrggbb`, following one level of `var(--other)`. */
function hex(theme: "light" | "dark", name: string): string {
  const dark = theme === "dark";
  const raw = (dark ? DARK.get(name) : undefined) ?? LIGHT.get(name);
  if (!raw) throw new Error(`no ${name} in tokens.css`);
  const indirect = /^var\((--[a-z-]+)\)$/.exec(raw);
  if (indirect) return hex(theme, indirect[1] as string);
  if (!/^#[0-9a-f]{6}$/i.test(raw)) throw new Error(`${name} is not a literal hex: ${raw}`);
  return raw;
}

function luminance(color: string): number {
  const channel = (n: number): number => {
    const c = n / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [1, 3, 5].map((i) => channel(Number.parseInt(color.slice(i, i + 2), 16)));
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe("contrast: sanity of the ratio calculation", () => {
  it("matches the two reference values WCAG defines", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });
});

describe.each(["light", "dark"] as const)("contrast: %s theme", (theme) => {
  /* Collision ink. --clash is a *sentence* colour (.np-note-clash on the
     planner verdict, the margin note, the exam gap, /emne/'s clash line), and
     it lands on three surfaces: the page, a card, and its own tinted band. */
  it.each(["--bg", "--card", "--clash-bg"])("--clash on %s clears AA", (surface) => {
    expect(contrast(hex(theme, "--clash"), hex(theme, surface))).toBeGreaterThanOrEqual(AA);
  });

  /* The verdict, in both of its roles. It is a sentence colour on the banner
     ("ingen kollisjoner") and on the credit line, and it has to survive a card
     and a nested card — and it is a fill under --verdict-contrast wherever the
     mark is drawn. One token doing two jobs is only allowed while both clear. */
  it.each(["--bg", "--card", "--card-nested"])("--verdict clears AA on %s", (surface) => {
    expect(contrast(hex(theme, "--verdict"), hex(theme, surface))).toBeGreaterThanOrEqual(AA);
  });

  it("--verdict-contrast on --verdict clears AA", () => {
    expect(
      contrast(hex(theme, "--verdict-contrast"), hex(theme, "--verdict")),
    ).toBeGreaterThanOrEqual(AA);
  });

  /* Ink fills. Every filled control is --ui now (.np-btn[aria-pressed],
     .np-toggle[aria-pressed], .studieinfo-save, .skip-link), which is the
     change that made the a11y-6 compromise unnecessary rather than merely
     compliant: --fg on --bg is the highest-contrast pair the palette has. */
  it("--ui-contrast on --ui clears AA", () => {
    expect(contrast(hex(theme, "--ui-contrast"), hex(theme, "--ui"))).toBeGreaterThanOrEqual(AA);
  });

  /* Body and secondary ink on both paper steps. */
  it.each(["--fg", "--muted"])("%s clears AA on --bg and --card", (ink) => {
    expect(contrast(hex(theme, ink), hex(theme, "--bg"))).toBeGreaterThanOrEqual(AA);
    expect(contrast(hex(theme, ink), hex(theme, "--card"))).toBeGreaterThanOrEqual(AA);
  });
});
