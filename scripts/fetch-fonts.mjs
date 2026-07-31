// Vendor the two brand fonts (Schibsted Grotesk, Spline Sans Mono) from Google
// Fonts so the site carries no third-party request. Re-run to refresh:
// `node scripts/fetch-fonts.mjs`. The generated fonts.css + woff2 files are
// committed; Vite fingerprints the url()s at build time.
//
// Both families ship as *variable* fonts: one file per (family, subset)
// carrying the whole wght axis. Asking css2 for discrete weights therefore
// yields several @font-face rules pointing at one byte-identical file — twelve
// rules doing four rules' work, and a reviewer's reasonable conclusion that all
// medium/bold is synthesised. We ask for the axis range instead: four faces,
// `font-weight: <min> <max>`.
//
// Two assertions below keep that from rotting: every file must carry an `fvar`
// table (a static instance smuggled in here becomes fake bold at every weight
// but one), and the four files must hash differently (a collapse means the
// subsetting broke).
import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { woff2Metrics, woff2Tables } from "./woff2-tables.mjs";

// Axis ranges are the weights docs/DESIGN.md §3 declares: the grotesk speaks
// at 400/500/700, the mono carries data at 400/500/600.
const CSS_URL =
  "https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400..700&family=Spline+Sans+Mono:wght@400..600&display=swap";

// One face per family per subset — assert the shape we expect back.
const EXPECTED_FACES = 4;

// `swap` over `optional`/`block`: text must never be invisible, and the two
// latin faces are preloaded from Layout.astro, so the swap window is the
// preload's round trip. Rewritten here rather than inherited from Google.
const FONT_DISPLAY = "swap";

// A modern browser UA makes Google serve woff2 with subset comments.
const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

// --- The metric-matched fallbacks --------------------------------------
//
// `font-display: swap` repaints the page in our face after first painting it in
// a system one, and the two set to different widths and line boxes — so the
// swap RELAID the page. Measured on a 1.6 Mbit link at ~875ms: the subcopy
// moved 45px and the nav 14px sideways, on every page with a cold cache.
//
// A fallback face standing in for each family fixes that without giving up
// `swap` (and without `optional`, which would leave the first visit unbranded).
// The overrides make a line of Arial occupy exactly the line box a line of
// Schibsted Grotesk will, so the swap changes shapes without moving anything.
//
// `ascent`/`descent`/`lineGap` are read out of the vendored file below, so a
// refresh cannot leave them stale. `sizeAdjust` cannot be — it is the ratio of
// the two faces' average advance width, and OS/2's `xAvgCharWidth` is not
// comparable across them (1.32 against a real 1.04). So it is MEASURED in a
// browser over a sample of this site's own copy:
//
//   const w = (text, family) => { const c = document.createElement("canvas")
//     .getContext("2d"); c.font = `200px ${family}`;
//     return c.measureText(text).width; };
//   w(sample, '"Schibsted Grotesk"') / w(sample, "Arial")
//
// Re-derive it the same way if a refresh changes either face. Being a little
// off is survivable — a few pixels instead of forty — being absent is not.
const FALLBACKS = [
  {
    family: "Schibsted Grotesk",
    // Arial where it exists, Liberation Sans (metric-compatible) where it does
    // not. If neither is present the face simply does not load and the stack
    // falls through to `system-ui` unadjusted, which is today's behaviour.
    locals: ["Arial", "Liberation Sans"],
    sizeAdjust: 1.0386,
  },
  {
    family: "Spline Sans Mono",
    locals: ["Courier New", "Liberation Mono"],
    // 0.9998 measured — the two set at almost exactly the same advance. Kept
    // verbatim rather than rounded to 1: it is a measurement.
    sizeAdjust: 0.9998,
  },
];

/** `104.61%` — the descriptor form, rounded where a browser cannot see it. */
const pct = (ratio) => `${(ratio * 100).toFixed(2)}%`;

/**
 * The fallback face for one family. The three overrides are divided by
 * `size-adjust` because that descriptor scales the face's metrics as well as
 * its outlines — the ratio has to come back out, or the line box is adjusted
 * twice.
 */
function fallbackFace({ family, locals, sizeAdjust }, metrics) {
  const { unitsPerEm, ascent, descent, lineGap } = metrics;
  const src = locals.map((name) => `local('${name}')`).join(", ");
  return [
    "@font-face {",
    `  font-family: '${family} Fallback';`,
    "  font-style: normal;",
    `  src: ${src};`,
    `  size-adjust: ${pct(sizeAdjust)};`,
    `  ascent-override: ${pct(ascent / unitsPerEm / sizeAdjust)};`,
    `  descent-override: ${pct(Math.abs(descent) / unitsPerEm / sizeAdjust)};`,
    `  line-gap-override: ${pct(lineGap / unitsPerEm / sizeAdjust)};`,
    "}",
  ].join("\n");
}

const outDir = fileURLToPath(new URL("../src/styles/fonts/", import.meta.url));
const cssPath = fileURLToPath(new URL("../src/styles/fonts.css", import.meta.url));

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// The woff2 table reader lives in ./woff2-tables.mjs so tests/fonts.test.ts can
// assert the same invariant against the committed files on every CI run, not
// only when someone re-runs this script.

// --- fetch -------------------------------------------------------------

const res = await fetch(CSS_URL, { headers: { "user-agent": UA } });
if (!res.ok) throw new Error(`fonts css: HTTP ${res.status}`);
const css = await res.text();

// Each @font-face block is preceded by a `/* subset */` comment.
const blocks = [...css.matchAll(/\/\* ([a-z-]+) \*\/\s*(@font-face\s*\{[^}]+\})/g)];
if (blocks.length !== EXPECTED_FACES) {
  throw new Error(`expected ${EXPECTED_FACES} @font-face blocks, parsed ${blocks.length}`);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

let out = "/* Generated by scripts/fetch-fonts.mjs — do not edit by hand. */\n";
const hashes = new Map();
/** One family's vertical metrics, read off whichever subset arrives first. */
const metrics = new Map();

for (const [, subset, block] of blocks) {
  const family = block.match(/font-family:\s*'([^']+)'/)?.[1];
  const weight = block.match(/font-weight:\s*(\d+\s+\d+)/)?.[1];
  const url = block.match(/url\((https:[^)]+\.woff2)\)/)?.[1];
  if (!family || !url) throw new Error(`unparsed block:\n${block}`);
  // A single-value descriptor means Google served a discrete weight — the
  // twelve-rules-four-files shape this script exists to avoid.
  if (!weight) throw new Error(`${family} ${subset}: expected a weight range, got:\n${block}`);

  const file = `${slug(family)}-${subset}.woff2`;
  const fontRes = await fetch(url, { headers: { "user-agent": UA } });
  if (!fontRes.ok) throw new Error(`${file}: HTTP ${fontRes.status}`);
  const bytes = Buffer.from(await fontRes.arrayBuffer());

  // The guarantee: a variable file renders every weight in the range for
  // real. Without fvar the browser synthesises everything above 400.
  const tables = woff2Tables(bytes);
  if (!tables.includes("fvar")) {
    throw new Error(`${file}: no fvar table — this is a static instance, weights would be faked`);
  }

  // Both subsets of a family carry the same vertical metrics; take the first.
  if (!metrics.has(family)) metrics.set(family, woff2Metrics(bytes));

  const hash = createHash("sha256").update(bytes).digest("hex");
  const clash = [...hashes].find(([, h]) => h === hash)?.[0];
  if (clash) throw new Error(`${file} is byte-identical to ${clash} — subsetting broke`);
  hashes.set(file, hash);

  await writeFile(`${outDir}${file}`, bytes);
  out += `\n${block
    .replace(/url\(https:[^)]+\.woff2\)\s*format\('woff2'\)/, `url('./fonts/${file}') format('woff2')`)
    .replace(/font-display:\s*[a-z]+;/, `font-display: ${FONT_DISPLAY};`)}\n`;
}

// The fallbacks last, so a reader meets the real faces first and these read as
// what they are: scaffolding for the second or two before those arrive.
out += "\n/* Metric-matched fallbacks — see FALLBACKS in scripts/fetch-fonts.mjs. */\n";
for (const fallback of FALLBACKS) {
  const parsed = metrics.get(fallback.family);
  if (!parsed) throw new Error(`no metrics parsed for ${fallback.family}`);
  out += `\n${fallbackFace(fallback, parsed)}\n`;
}

await writeFile(cssPath, out, "utf8");
console.log(`fonts  wrote ${hashes.size} variable faces to src/styles/fonts/ + fonts.css`);
for (const [file, hash] of hashes) console.log(`       ${hash.slice(0, 16)}  ${file}`);
for (const { family } of FALLBACKS) {
  const m = metrics.get(family);
  console.log(`       fallback '${family} Fallback'  upem ${m.unitsPerEm} asc ${m.ascent}`);
}
