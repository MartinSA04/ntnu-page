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
import { fileURLToPath } from "node:url";
import { NTNUClient } from "ntnu-api";
import { toCatalog, toPrograms, toSearchIndex, toSemesters } from "./transform.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const PUBLIC_DATA_DIR = path.join(ROOT, "public", "data");

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
  const client = new NTNUClient();
  const crawledAt = new Date().toISOString();

  const current = await client.semesters.current();
  const year = yearFlag ?? current?.year ?? new Date().getUTCFullYear();

  console.log(`crawl  year=${year}`);

  const hits = [];
  for await (const page of client.courses.searchAll(year)) {
    hits.push(...page.courses);
  }
  const catalog = toCatalog(hits, year, crawledAt);
  console.log(`catalog     courses=${catalog.courses.length}`);

  const searchIndex = toSearchIndex(catalog);
  console.log(`searchIndex courses=${searchIndex.courses.length}`);

  const programs = toPrograms(await client.programs.all(), crawledAt);
  console.log(`programs    programs=${programs.programs.length}`);

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
