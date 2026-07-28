/**
 * Contract test over the REAL built client bundle.
 *
 * The planner now imports pure helpers from `ntnu-api` (`parseWeeks`,
 * `toMinutes`, `classifyActivity`, `findConflicts`, `decodeEntities`,
 * `isDeferredOccasion`) instead of keeping its own copies. Those copies
 * existed for a reason PLANNER.md §3 wrote down: `ntnu-api` also contains
 * `HttpClient` and three service clients, and shipping those to the browser
 * would be both dead weight and a surface the client has no business holding.
 *
 * The reason no longer applies — the package is `sideEffects: false`, every
 * imported helper is pure, and Rollup drops the rest — but "no longer applies"
 * is exactly the kind of claim that quietly stops being true after a refactor,
 * a bundler upgrade, or one careless `import { NTNUClient }`. So it is
 * asserted rather than assumed: if any upstream URL ever appears in a client
 * chunk, the client module graph has pulled in the HTTP layer.
 *
 * `dist/` is gitignored build output, so this SKIPS on a fresh checkout that
 * has not run `npm run build`, matching `tests/artifacts.test.mjs`.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "dist", "_astro");

/**
 * Every base URL `ntnu-api`'s service clients hold. None of them has any
 * business in a browser chunk: the client talks to our own `/api/*` worker.
 */
const UPSTREAM_MARKERS = [
  "dbh.hkdir.no", // grades.ts — DBH statistics API
  "tp.educloud.no", // semesters.ts — TP semester list
  "www.ntnu.no/web/studier", // courses.ts / programs.ts — Liferay portlets
  "studyprogrammeplannerportlet", // programs.ts — portlet id scraping
  "fetch-courselist-as-json", // courses.ts — search portlet resource id
];

const present = existsSync(ASSETS);
if (!present) {
  console.warn("bundle: skipping, dist/_astro missing (run `npm run build`)");
}

describe.skipIf(!present)("built client bundle", () => {
  const chunks = present
    ? readdirSync(ASSETS)
        .filter((name) => name.endsWith(".js"))
        .map((name) => ({ name, source: readFileSync(join(ASSETS, name), "utf8") }))
    : [];

  it("emits client chunks at all (guards against a vacuous pass)", () => {
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("carries no NTNU upstream URL — ntnu-api's HTTP layer is tree-shaken out", () => {
    const leaks = [];
    for (const { name, source } of chunks) {
      for (const marker of UPSTREAM_MARKERS) {
        if (source.includes(marker)) leaks.push(`${name}: ${marker}`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("still bundles the pure helpers it imports from ntnu-api", () => {
    // Sanity check in the other direction: if the client had stopped pulling
    // anything from ntnu-api, the test above would pass vacuously. These are
    // keyword-list regex sources from `classifyActivity`, which only reach a
    // chunk by being imported from the package.
    const all = chunks.map((c) => c.source).join("");
    for (const keyword of ["forelesning(?:sparallell)", "regneverksted", "problembasert"]) {
      expect(all, keyword).toContain(keyword);
    }
  });
});
