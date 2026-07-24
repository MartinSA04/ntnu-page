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
 */

/**
 * Build the `data/catalog.json` shape from raw catalog search hits.
 *
 * Keeps only the SPEC-listed fields, dedupes by course code (the upstream
 * catalog contains verbatim duplicate entries — first occurrence wins after
 * sorting is irrelevant since duplicates are expected to be identical), and
 * sorts by code.
 *
 * @param {import("ntnu-api").CourseSearchHit[]} hits
 * @param {number} year
 * @param {string} crawledAt ISO timestamp
 * @returns {{ year: number, crawledAt: string, courses: CatalogCourse[] }}
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
    });
  }
  const courses = [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
  return { year, crawledAt, courses };
}

/**
 * Build the compact `public/data/search-index.json` shape from a catalog.
 *
 * Exams are filtered to non-continuation (kont exams are not planning data)
 * and mapped to `[season, date]` pairs.
 *
 * @param {{ year: number, courses: CatalogCourse[] }} catalog
 * @returns {{ year: number, courses: [string, string, string | null, [string | null, string | null][]][] }}
 */
export function toSearchIndex(catalog) {
  return {
    year: catalog.year,
    courses: catalog.courses.map((course) => [
      course.code,
      course.name,
      course.location,
      course.exams.filter((exam) => !exam.continuation).map((exam) => [exam.season, exam.date]),
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
