#!/usr/bin/env node
/**
 * Nightly crawler: fetches the cheap bulk endpoints (course catalog search,
 * program catalog, semester list) from `ntnu-api` and writes the committed
 * JSON artifacts documented in docs/SPEC.md ("Crawled data contracts").
 *
 * Usage: node crawler/crawl.mjs [--year 2026]
 */
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { NTNUClient } from "ntnu-api";
import { toCatalog, toPrograms, toSearchIndex, toSemesters } from "./transform.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DATA_DIR = path.join(ROOT, "public", "data");

/**
 * Pause between consecutive upstream requests. The crawl is ~10 requests
 * total, but they'd otherwise fire back-to-back; spacing them out costs a few
 * seconds a night and keeps the burst shape friendly.
 */
const REQUEST_GAP_MS = 500;

/**
 * Write `content` to `filePath` atomically: write a tmp file in the same
 * directory then rename over the target.
 *
 * @param {string} filePath
 * @param {string} content
 */
async function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  const tmpDir = await mkdtemp(path.join(dir, ".crawl-tmp-"));
  const tmpFile = path.join(tmpDir, path.basename(filePath));
  await writeFile(tmpFile, content, "utf8");
  await rename(tmpFile, filePath);
  await rm(tmpDir, { recursive: true, force: true });
}

/**
 * @param {string[]} argv
 * @returns {{ year: number | null }}
 */
function parseArgs(argv) {
  const yearIndex = argv.indexOf("--year");
  if (yearIndex === -1) return { year: null };
  const value = argv[yearIndex + 1];
  const year = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(year)) {
    throw new Error(`--year expects a number, got ${value}`);
  }
  return { year };
}

async function main() {
  const { year: yearFlag } = parseArgs(process.argv.slice(2));
  // Identify ourselves to the upstream. Retries/backoff (incl. Retry-After on
  // 429) live in ntnu-api's HttpClient — no outer retry layer here, so a
  // struggling upstream is never hammered twice over.
  const client = new NTNUClient({
    userAgent: "ntnu-page-crawler/0.1 (+https://github.com/MartinSA04/ntnu-page)",
  });
  const crawledAt = new Date().toISOString();

  const current = await client.semesters.current();
  const year = yearFlag ?? current?.year ?? new Date().getUTCFullYear();

  console.log(`crawl  year=${year}`);

  // Stable sort order keeps courses from hopping between pages mid-crawl, so
  // searchAll's cross-page dedup drops duplicates instead of real courses.
  const hits = [];
  await sleep(REQUEST_GAP_MS);
  for await (const page of client.courses.searchAll(year, null, { sort: "+ntnucoursecode" })) {
    hits.push(...page.courses);
    await sleep(REQUEST_GAP_MS);
  }
  const catalog = toCatalog(hits, year, crawledAt);
  console.log(`catalog     courses=${catalog.courses.length}`);

  const searchIndex = toSearchIndex(catalog);
  console.log(`searchIndex courses=${searchIndex.courses.length}`);

  const programs = toPrograms(await client.programs.all(), crawledAt);
  console.log(`programs    programs=${programs.programs.length}`);

  await sleep(REQUEST_GAP_MS);
  const semesters = toSemesters(await client.semesters.all(), current, crawledAt);
  console.log(
    `semesters   semesters=${semesters.semesters.length} current=${current?.id ?? "null"}`,
  );

  await writeAtomic(path.join(DATA_DIR, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
  await writeAtomic(path.join(DATA_DIR, "programs.json"), `${JSON.stringify(programs, null, 2)}\n`);
  await writeAtomic(
    path.join(DATA_DIR, "semesters.json"),
    `${JSON.stringify(semesters, null, 2)}\n`,
  );
  await writeAtomic(path.join(PUBLIC_DATA_DIR, "search-index.json"), JSON.stringify(searchIndex));

  console.log("crawl  done");
}

main().catch((error) => {
  console.error("crawl  failed:", error);
  process.exitCode = 1;
});
