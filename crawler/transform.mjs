/**
 * Pure transform functions from `ntnu-api` shapes to the JSON contracts in
 * docs/SPEC.md ("Crawled data contracts"), plus the pure floor checks the
 * crawl asserts before it writes anything. No I/O, no network — kept pure so
 * they are unit-testable with inline fixtures.
 */

/**
 * @typedef {object} CatalogExam
 * @property {string | null} season
 * @property {string | null} date
 * @property {boolean} continuation
 */

/**
 * @typedef {object} CatalogCourse
 * @property {string} code
 * @property {string} name
 * @property {string | null} url
 * @property {string | null} version
 * @property {string | null} location
 * @property {boolean} examOnly
 * @property {CatalogExam[]} exams
 * @property {number[]} offeredYears catalog years this course appears in, newest first
 */

/**
 * @typedef {object} Catalog
 * @property {number} year canonical (newest) catalog year — metadata comes from it
 * @property {number[]} years all crawled catalog years, newest first
 * @property {string} crawledAt
 * @property {CatalogCourse[]} courses
 */

/**
 * Build a single-year catalog from raw catalog search hits.
 *
 * Keeps only the SPEC-listed fields, dedupes by course code (the upstream
 * catalog contains verbatim duplicate entries — first occurrence wins after
 * sorting is irrelevant since duplicates are expected to be identical), and
 * sorts by code. `mergeCatalogs` unions several of these into the shipped
 * `data/catalog.json`.
 *
 * @param {import("ntnu-api").CourseSearchHit[]} hits
 * @param {number} year
 * @param {string} crawledAt ISO timestamp
 * @returns {Catalog}
 */
export function toCatalog(hits, year, crawledAt) {
  const byCode = new Map();
  for (const hit of hits) {
    if (byCode.has(hit.courseCode)) continue;
    byCode.set(hit.courseCode, {
      code: hit.courseCode,
      name: hit.courseName,
      url: hit.courseUrl,
      version: hit.courseVersion,
      location: hit.location,
      examOnly: hit.examOnly,
      exams: hit.exams.map((exam) => ({
        season: exam.season,
        date: exam.date,
        continuation: exam.continuation,
      })),
      offeredYears: [year],
    });
  }
  const courses = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { year, years: [year], crawledAt, courses };
}

/**
 * Union several single-year catalogs into one, newest year first.
 *
 * A course NTNU stops offering disappears from the catalog the moment the new
 * year opens — 703 courses present in 2025 are absent from 2026, TMA4100
 * among them — which used to mean no page, no search hit and no credits for
 * every study-plan reference to them. Unioning two years keeps them
 * addressable; `offeredYears` is what lets a page say "ikke undervist i 2026 ·
 * sist undervist 2025" instead of implying the course still runs.
 *
 * The newest catalog that carries a course wins its metadata (name, version,
 * location, exams): older years' exam dates are stale by construction, and the
 * newest year is the one the site's timetable and exam surfaces are built for.
 *
 * @param {Catalog[]} catalogs newest year first; at least one
 * @returns {Catalog}
 */
export function mergeCatalogs(catalogs) {
  if (catalogs.length === 0) throw new Error("mergeCatalogs: expected at least one catalog");
  const byCode = new Map();
  for (const catalog of catalogs) {
    for (const course of catalog.courses) {
      const seen = byCode.get(course.code);
      if (seen === undefined) {
        byCode.set(course.code, { ...course, offeredYears: [...course.offeredYears] });
        continue;
      }
      // Metadata stays as the newest year left it; only the year list grows.
      for (const year of course.offeredYears) {
        if (!seen.offeredYears.includes(year)) seen.offeredYears.push(year);
      }
    }
  }
  const courses = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  for (const course of courses) course.offeredYears.sort((a, b) => b - a);
  const years = [...new Set(catalogs.flatMap((c) => c.years))].sort((a, b) => b - a);
  return { year: years[0], years, crawledAt: catalogs[0].crawledAt, courses };
}

/**
 * Build the compact `public/data/search-index.json` shape from a catalog.
 *
 * Exams are filtered to non-continuation and mapped to `[season, date]` pairs.
 *
 * WARNING — that kont filter is a no-op against today's upstream, so DR-3's
 * "ordinary-only by default, kont filtered out" is NOT delivered here and the
 * emitted pairs are every published sitting, ordinary and deferred alike.
 * The catalog search portlet reports `continuation: false` on every exam it
 * returns: 0 of 2 438 exam rows in `data/catalog.json` carry the flag, and a
 * raw portlet response for HBIOT2030 (measured 2026-07-27) sends
 * `continuation: false` for its 2026-12-01 sitting, which
 * `/api/course/HBIOT2030` labels `occasion: "Utsatt eksamen"`. The filter
 * stays because it is the contract and costs nothing the day upstream starts
 * populating the flag — but the only honest kont signal is `occasion` in the
 * per-course details payload, which this crawl deliberately does not fetch:
 * that is one request per course, against the ~20 requests docs/SPEC.md
 * budgets for the whole crawl. Joining `occasion` onto these `[season, date]`
 * pairs by exact ISO date is the consumer's job; see audit finding exams-1.
 *
 * The tuple is fetched at runtime, so it stays positional and append-only:
 * `version` (index 4) is what DR-4 needs to fetch the right timetable — 293
 * of 5 470 index rows are not version "1" (220 of them offered in the
 * canonical year; both measured 2026-07-27), and asking for the default
 * version of one of them returns a differently-shaped payload for the same
 * slot — and `offeredYears` (index 5) lets a result row say a course is not
 * taught this year rather than pretending it is.
 *
 * @param {{ year: number, courses: CatalogCourse[] }} catalog
 * @returns {{ year: number, courses: [string, string, string | null, [string | null, string | null][], string | null, number[]][] }}
 */
export function toSearchIndex(catalog) {
  return {
    year: catalog.year,
    courses: catalog.courses.map((course) => [
      course.code,
      course.name,
      course.location,
      course.exams.filter((exam) => !exam.continuation).map((exam) => [exam.season, exam.date]),
      course.version,
      course.offeredYears,
    ]),
  };
}

/**
 * Build the `data/programs.json` shape: full program objects, deduped by
 * code and sorted by code.
 *
 * @param {import("ntnu-api").StudyProgramSummary[]} programs
 * @param {string} crawledAt ISO timestamp
 * @returns {{ crawledAt: string, programs: import("ntnu-api").StudyProgramSummary[] }}
 */
export function toPrograms(programs, crawledAt) {
  const byCode = new Map();
  for (const program of programs) {
    if (byCode.has(program.code)) continue;
    byCode.set(program.code, program);
  }
  const sorted = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { crawledAt, programs: sorted };
}

/**
 * Build the `data/semesters.json` shape.
 *
 * @param {import("ntnu-api").Semester[]} semesters
 * @param {import("ntnu-api").Semester | null} current
 * @param {string} crawledAt ISO timestamp
 * @returns {{ crawledAt: string, current: import("ntnu-api").Semester | null, semesters: import("ntnu-api").Semester[] }}
 */
export function toSemesters(semesters, current, crawledAt) {
  return { crawledAt, current, semesters };
}

/**
 * Absolute floor for one catalog year. A real year is ~4 767 courses (2026),
 * so an order of magnitude below that is a broken crawl, not a shrinking NTNU.
 */
export const MIN_COURSES_PER_YEAR = 1000;

/** Floors for the two small lists (real 2026 numbers: 403 and 36). */
export const MIN_PROGRAMS = 100;
export const MIN_SEMESTERS = 4;

/** Fraction of upstream's own `numFound` a finished year pass must reach. */
const CATALOG_COVERAGE = 0.9;

/**
 * The minimum course count one catalog-year pass has to produce.
 *
 * The ratio against upstream's own `numFound` catches a truncated pagination
 * run: `hasMoreResults` goes through `asBool`, which defaults a missing or
 * renamed field to `false`, so `searchAll` would stop after page 1 — 500 of
 * 4 767 courses. The absolute floor catches the case where `numFound` is
 * itself 0: the search portlet answers an empty 200 body instead of an error
 * when it dislikes a parameter, and ntnu-api turns that into
 * `{ courses: [], hasMoreResults: false, numFound: 0 }` without throwing.
 *
 * @param {number} numFound upstream's reported hit count for the year
 * @returns {number}
 */
export function catalogFloor(numFound) {
  const covered = Number.isFinite(numFound) ? Math.ceil(numFound * CATALOG_COVERAGE) : 0;
  return Math.max(MIN_COURSES_PER_YEAR, covered);
}

/**
 * Throw unless `actual` clears `minimum`.
 *
 * docs/SPEC.md states the rule this enforces — "if either catalog pass fails
 * the whole crawl fails (exit 1) — a half-crawl that looks complete is worse
 * than a red build" — but nothing used to enforce it: crawl.mjs only logged
 * its counts, and `.github/workflows/crawl.yml` runs crawl → build → deploy
 * nightly with no lint, typecheck, test or e2e step in between, so a hollow
 * catalog would deploy itself with every badge green.
 *
 * @param {string} label what is being counted, for the error message
 * @param {number} actual
 * @param {number} minimum
 */
export function assertFloor(label, actual, minimum) {
  if (!(actual >= minimum)) {
    throw new Error(
      `${label}: got ${actual}, expected at least ${minimum} — refusing to write a hollow artifact`,
    );
  }
}
