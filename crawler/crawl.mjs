#!/usr/bin/env node
/**
 * Nightly crawler: fetches the cheap bulk endpoints (course catalog search,
 * program catalog, semester list) from `ntnu-api` and writes the committed
 * JSON artifacts documented in docs/SPEC.md ("Crawled data contracts").
 *
 * Usage: node crawler/crawl.mjs [--year 2026]
 */
import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { NTNUClient } from "ntnu-api";
import {
  assertFloor,
  catalogFloor,
  MIN_PROGRAMS,
  MIN_SEMESTERS,
  mergeCatalogs,
  toCatalog,
  toPrograms,
  toSearchIndex,
  toSemesters,
} from "./transform.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DATA_DIR = path.join(ROOT, "public", "data");

/**
 * Pause between consecutive upstream requests. The crawl is ~20 requests
 * total, but they'd otherwise fire back-to-back; spacing them out costs a few
 * seconds a night and keeps the burst shape friendly.
 */
const REQUEST_GAP_MS = 500;

/**
 * Catalog years to crawl, counting back from the canonical year. Two, because a
 * course NTNU stops offering vanishes from the catalog immediately while the
 * API still serves its grades and timetables and study plans still reference
 * it. See `mergeCatalogs`.
 */
const CATALOG_YEARS = 2;

/**
 * Write `content` to `filePath` atomically: write a tmp file in the same
 * directory then rename over the target.
 *
 * @param {string} filePath
 * @param {string} content
 */
async function writeAtomic(filePath, content) {
  const dir = path.dirname(filePath);
  // `data/` and `public/data/` are gitignored build artifacts, so on a FRESH
  // CLONE they do not exist — and the tmp dir is deliberately a sibling of the
  // target (that is what makes the rename atomic), so `mkdtemp` was the first
  // thing to touch a directory nothing had created. Every local run had one
  // lying around from a previous crawl, so this only ever failed where it
  // mattered: the first CI run on a new checkout, after spending the whole
  // crawl's worth of upstream requests and failing on the write.
  await mkdir(dir, { recursive: true });
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

  const years = Array.from({ length: CATALOG_YEARS }, (_, i) => year - i);
  console.log(`crawl  year=${year} catalogYears=${years.join(",")}`);

  const perYear = [];
  for (const catalogYear of years) {
    // Stable sort order keeps courses from hopping between pages mid-crawl, so
    // searchAll's cross-page dedup drops duplicates instead of real courses.
    const hits = [];
    let numFound = 0;
    await sleep(REQUEST_GAP_MS);
    for await (const page of client.courses.searchAll(catalogYear, null, {
      sort: "+ntnucoursecode",
    })) {
      if (page.pageNr === 1) numFound = page.numFound;
      hits.push(...page.courses);
      await sleep(REQUEST_GAP_MS);
    }
    const yearCatalog = toCatalog(hits, catalogYear, crawledAt);
    console.log(
      `catalog     year=${catalogYear} courses=${yearCatalog.courses.length} numFound=${numFound}`,
    );
    // Fail here rather than unioning a hollow year with a healthy one: the
    // merge would hide it behind the other year's courses and stamp every
    // survivor "ikke undervist i {year}".
    assertFloor(
      `catalog year ${catalogYear} (upstream numFound=${numFound})`,
      yearCatalog.courses.length,
      catalogFloor(numFound),
    );
    perYear.push(yearCatalog);
  }

  const catalog = mergeCatalogs(perYear);
  const carriedOver = catalog.courses.filter((c) => !c.offeredYears.includes(year)).length;
  console.log(`catalog     courses=${catalog.courses.length} notOfferedIn${year}=${carriedOver}`);

  const searchIndex = toSearchIndex(catalog);
  console.log(`searchIndex courses=${searchIndex.courses.length}`);
  // The index is a projection of the catalog, so it must not lose rows.
  assertFloor("searchIndex", searchIndex.courses.length, catalog.courses.length);

  const programs = toPrograms(await client.programs.all(), crawledAt);
  console.log(`programs    programs=${programs.programs.length}`);
  assertFloor("programs", programs.programs.length, MIN_PROGRAMS);

  await sleep(REQUEST_GAP_MS);
  const semesters = toSemesters(await client.semesters.all(), current, crawledAt);
  console.log(
    `semesters   semesters=${semesters.semesters.length} current=${current?.id ?? "null"}`,
  );
  assertFloor("semesters", semesters.semesters.length, MIN_SEMESTERS);

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
