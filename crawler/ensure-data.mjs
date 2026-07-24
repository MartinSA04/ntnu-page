/**
 * Prebuild guard: crawled data is gitignored, so a fresh checkout has none —
 * without this, `astro build` fails on the missing JSON imports. Runs the
 * crawler only when a required file is absent; `npm run crawl` is the way to
 * force a refresh.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const required = [
  "data/catalog.json",
  "data/programs.json",
  "data/semesters.json",
  "public/data/search-index.json",
];

const missing = required.filter((rel) => !existsSync(join(root, rel)));
if (missing.length === 0) {
  console.log("ensure-data: all crawl artifacts present, skipping crawl");
  process.exit(0);
}

console.log(`ensure-data: missing ${missing.join(", ")} — running crawler`);
const res = spawnSync(process.execPath, [join(root, "crawler/crawl.mjs")], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
