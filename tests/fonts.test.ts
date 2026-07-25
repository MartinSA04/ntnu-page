/**
 * The vendored faces are the one asset whose correctness is invisible on
 * screen: a static instance smuggled in where a variable font is declared
 * renders *something* at every weight, just browser-synthesised rather than
 * drawn (D12). `scripts/fetch-fonts.mjs` asserts this too, but only when
 * someone re-runs the fetch — which is roughly never. These run on every CI
 * build, against the bytes actually committed.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — plain .mjs helper shared with scripts/fetch-fonts.mjs.
import { woff2Tables } from "../scripts/woff2-tables.mjs";

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
    expect(faces).toHaveLength(FACES.length);
    for (const file of FACES) expect(css).toContain(file);
    // Two values, not one: a single-value descriptor would instance the axis
    // at one weight and re-introduce synthesis for the other two.
    const ranges = [...css.matchAll(/font-weight:\s*(\d{3})\s+(\d{3})\s*;/g)];
    expect(ranges).toHaveLength(FACES.length);
    // Never `font-display: block`/`optional` — text must not go invisible.
    expect([...css.matchAll(/font-display:\s*swap\s*;/g)]).toHaveLength(FACES.length);
  });
});
