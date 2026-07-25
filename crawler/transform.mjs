/**
 * Pure transform functions from `ntnu-api` shapes to the JSON contracts in
 * docs/SPEC.md ("Crawled data contracts"). No I/O, no network — kept pure so
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
 * Exams are filtered to non-continuation (kont exams are not planning data)
 * and mapped to `[season, date]` pairs.
 *
 * The tuple is fetched at runtime, so it stays positional and append-only:
 * `version` (index 4) is what DR-4 needs to fetch the right timetable — 220
 * courses are not version "1", and asking for the default version of one of
 * them returns a differently-shaped payload for the same slot — and
 * `offeredYears` (index 5) lets a result row say a course is not taught this
 * year rather than pretending it is.
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
