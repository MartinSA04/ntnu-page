/**
 * The vendored faces are the one asset whose correctness is invisible on
 * screen: a static instance where a variable font is declared renders
 * *something* at every weight, just browser-synthesised. `fetch-fonts.mjs`
 * asserts this too, but only when someone re-runs the fetch.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs helper shared with scripts/fetch-fonts.mjs.
import { woff2Metrics, woff2Tables } from "../scripts/woff2-tables.mjs";

const FACES = [
  "schibsted-grotesk-latin.woff2",
  "schibsted-grotesk-latin-ext.woff2",
  "spline-sans-mono-latin.woff2",
  "spline-sans-mono-latin-ext.woff2",
];

const fontPath = (file: string) =>
  fileURLToPath(new URL(`../src/styles/fonts/${file}`, import.meta.url));

async function readFace(file: string): Promise<Buffer> {
  return await readFile(fontPath(file));
}

describe("vendored font files", () => {
  it.each(FACES)("%s carries an fvar table, so its weights are real", async (file) => {
    const tables = woff2Tables(await readFace(file)) as string[];
    // fvar = the variation axes. Without it, `font-weight: 400 700` in
    // fonts.css is a lie and every weight above 400 is faked by the browser.
    expect(tables).toContain("fvar");
    expect(tables).toContain("gvar");
  });

  it("ships four distinct files — a collapse means the subsetting broke", async () => {
    const hashes = await Promise.all(
      FACES.map(async (file) =>
        createHash("sha256")
          .update(await readFace(file))
          .digest("hex"),
      ),
    );
    expect(new Set(hashes).size).toBe(FACES.length);
  });

  it("declares exactly these four faces, each as a weight RANGE", async () => {
    const css = await readFile(
      fileURLToPath(new URL("../src/styles/fonts.css", import.meta.url)),
      "utf8",
    );
    const faces = [...css.matchAll(/@font-face\s*\{/g)];
    // The four real faces plus the two metric-matched fallbacks.
    expect(faces).toHaveLength(FACES.length + 2);
    for (const file of FACES) expect(css).toContain(file);
    // Two values, not one: a single-value descriptor would instance the axis
    // at one weight and re-introduce synthesis for the other two.
    const ranges = [...css.matchAll(/font-weight:\s*(\d{3})\s+(\d{3})\s*;/g)];
    expect(ranges).toHaveLength(FACES.length);
    // Never `font-display: block`/`optional` — text must not go invisible.
    expect([...css.matchAll(/font-display:\s*swap\s*;/g)]).toHaveLength(FACES.length);
  });
});

/**
 * The fallbacks are the half of `font-display: swap` that keeps it from costing
 * a relayout. Their whole value is that the numbers agree with the vendored
 * bytes — a drifted override is worse than none, because it moves the page in
 * the opposite direction with full confidence. So they are checked against the
 * files, not against themselves.
 */
describe("metric-matched fallback faces", () => {
  const FALLBACKS = [
    { file: "schibsted-grotesk-latin.woff2", family: "Schibsted Grotesk Fallback" },
    { file: "spline-sans-mono-latin.woff2", family: "Spline Sans Mono Fallback" },
  ];

  it.each(FALLBACKS)("$family overrides match the metrics in $file", async ({ file, family }) => {
    const css = await readFile(
      fileURLToPath(new URL("../src/styles/fonts.css", import.meta.url)),
      "utf8",
    );
    const block = css.match(
      new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*'${family}'[^}]*\\}`),
    )?.[0];
    expect(block, `no @font-face for '${family}'`).toBeTruthy();

    const descriptor = (name: string): number => {
      const raw = block?.match(new RegExp(`${name}:\\s*([\\d.]+)%`))?.[1];
      expect(raw, `${family} has no ${name}`).toBeTruthy();
      return Number(raw) / 100;
    };

    const metrics = woff2Metrics(await readFace(file)) as {
      unitsPerEm: number;
      ascent: number;
      descent: number;
      lineGap: number;
    };
    const sizeAdjust = descriptor("size-adjust");
    // `size-adjust` scales the face's metrics as well as its outlines, so the
    // overrides carry the ratio back out of themselves — get this backwards
    // and the line box is adjusted twice.
    const expected = (units: number): number => Math.abs(units) / metrics.unitsPerEm / sizeAdjust;

    expect(descriptor("ascent-override")).toBeCloseTo(expected(metrics.ascent), 3);
    expect(descriptor("descent-override")).toBeCloseTo(expected(metrics.descent), 3);
    expect(descriptor("line-gap-override")).toBeCloseTo(expected(metrics.lineGap), 3);
    // A fallback that downloads anything is not a fallback: it would be a
    // second network round trip in front of the one it exists to cover for.
    expect(block).not.toMatch(/url\(/);
    expect(block).toMatch(/src:\s*local\(/);
  });

  it("both fallbacks are in the token stacks, behind their real face", async () => {
    const tokens = await readFile(
      fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url)),
      "utf8",
    );
    for (const [real, fallback] of [
      ["Schibsted Grotesk", "Schibsted Grotesk Fallback"],
      ["Spline Sans Mono", "Spline Sans Mono Fallback"],
    ]) {
      const stack = tokens.match(new RegExp(`--font-(?:sans|mono):[^;]*"${fallback}"[^;]*;`))?.[0];
      expect(stack, `${fallback} is not in a font stack`).toBeTruthy();
      // Behind the real face — in front of it, the swap would never happen.
      expect(stack?.indexOf(`"${real}"`)).toBeLessThan(stack?.indexOf(`"${fallback}"`) ?? -1);
    }
  });
});
