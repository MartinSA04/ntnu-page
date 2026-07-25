/**
 * Fetch + shape layer for the planner (PLANNER.md §3). Talks to the same
 * `/api/*` Worker routes the course-detail page uses; per-course failures
 * are captured rather than thrown so the page can render partial plans
 * (PLANNER.md's "one error line per failed course").
 */

/** Structural subset of `ntnu-api`'s `TimetableEntry` (see routes.ts serialization). */
export interface TimetableEntry {
  courseCode: string;
  courseName: { nob: string | null; nno: string | null; eng: string | null };
  dayNumber: number;
  startTime: string;
  endTime: string;
  weeks: string[];
  rooms: { building: string | null; room: string | null; url: string | null }[];
  title: string | null;
  name: string | null;
  /** Programme codes this section is scheduled for (multi-section courses); see entriesForProgram. */
  studyProgramKeys?: string[];
}

/** Structural subset of `ntnu-api`'s `CourseExam`. */
export interface CourseExam {
  date: string | null;
  dateText: string | null;
  season: string | null;
  form: string | null;
  occasion: string | null;
  time: string | null;
  duration: string | null;
}

/** Structural subset of `ntnu-api`'s `CourseDetails` — the fields the planner reads. */
export interface CourseDetails {
  courseCode: string | null;
  courseName: string | null;
  credits: number | null;
  location: string | null;
  assessmentScheme: string | null;
  exams: CourseExam[];
}

/** Per-course fetch result: each part captured independently, errors collected by message. */
export interface CourseBundle {
  timetable: TimetableEntry[] | null;
  details: CourseDetails | null;
  errors: string[];
}

const bundleMemo = new Map<string, Promise<CourseBundle>>();

/** Default course version used when a caller has no real one yet (mirrors store.ts's DEFAULT_VERSION). */
const DEFAULT_VERSION = "1";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let message = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // ignore unparseable error bodies, fall back to the status code
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/**
 * Fetch a course's timetable + details in parallel, memoized per
 * `code:year:version` for the lifetime of the module (page load). Never
 * rejects: each part's failure is recorded in `errors` and its field left
 * `null`.
 *
 * `version` threads to the timetable call (DR-4, PRODUCT.md §7/§8) — a
 * re-versioned course otherwise shows the wrong grid. It is NOT passed to
 * the details call: `courses.details()` has no `version` option (it scrapes
 * the version-less rendered course page — see `ntnu-api`'s `CoursesClient`),
 * so details are the same regardless of which version's timetable is shown.
 * Defaults to `"1"`, matching `store.ts`'s `DEFAULT_VERSION` and the
 * worker/`ntnu-api`'s own default.
 */
export function fetchCourseBundle(
  code: string,
  year: number,
  version: string = DEFAULT_VERSION,
): Promise<CourseBundle> {
  const key = `${code}:${year}:${version}`;
  const cached = bundleMemo.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<CourseBundle> => {
    const errors: string[] = [];
    // The code stays percent-encoded until the worker's own parseCode decodes
    // it — 238 catalog codes contain Æ/Ø/Å and used to take a hard 400 (B1).
    const segment = encodeURIComponent(code);
    const [timetableResult, detailsResult] = await Promise.allSettled([
      fetchJson<TimetableEntry[]>(
        `/api/course/${segment}/timetable?year=${year}&version=${encodeURIComponent(version)}`,
      ),
      fetchJson<CourseDetails>(`/api/course/${segment}`),
    ]);

    let timetable: TimetableEntry[] | null = null;
    if (timetableResult.status === "fulfilled") {
      timetable = timetableResult.value;
    } else {
      errors.push(`timeplan: ${timetableResult.reason?.message ?? timetableResult.reason}`);
    }

    let details: CourseDetails | null = null;
    if (detailsResult.status === "fulfilled") {
      details = detailsResult.value;
    } else {
      errors.push(`detaljer: ${detailsResult.reason?.message ?? detailsResult.reason}`);
    }

    return { timetable, details, errors };
  })();

  bundleMemo.set(key, promise);
  return promise;
}

/** Clears the in-memory bundle memo. Exposed for tests only. */
export function clearCourseBundleMemo(): void {
  bundleMemo.clear();
}

/** One catalog course as compacted in `search-index.json` (PLANNER.md §4). */
export type PlannerIndexExam = [season: string, date: string | null];

/**
 * Positional tuple — elements 0–3 have never moved; 4 and 5 were appended by
 * the two-year crawl (C1/C2).
 *
 * `offeredYears` is newest-first and never empty. When it does **not** contain
 * `PlannerIndex.year`, the row's name/version/location/exams all come from the
 * older catalog year: the course is not taught in the canonical year, and its
 * exam dates are last year's. That is exactly what the semester-window filter
 * below has to catch (C3).
 */
export type PlannerIndexCourse = [
  code: string,
  name: string,
  location: string | null,
  exams: PlannerIndexExam[],
  version: string | null,
  offeredYears: number[],
];

export interface PlannerIndex {
  year: number;
  courses: PlannerIndexCourse[];
}

let indexMemo: Promise<PlannerIndex> | null = null;

/** Fetch `/data/search-index.json` once per page load (module-level memo). */
export function loadPlannerIndex(): Promise<PlannerIndex> {
  if (!indexMemo) {
    indexMemo = fetchJson<PlannerIndex>("/data/search-index.json");
  }
  return indexMemo;
}

/** Clears the in-memory index memo. Exposed for tests only. */
export function clearPlannerIndexMemo(): void {
  indexMemo = null;
}

/**
 * The `Semester.season` a `Semester.id` (`"26h"`/`"27v"`) encodes — the same
 * two letters `semesterYear` (schedule.ts) parses, kept separate here since
 * only this module needs the season string. `null` for a malformed id.
 */
export function seasonForSemesterId(semesterId: string): "AUTUMN" | "SPRING" | null {
  const m = /^\d{2}([hv])$/i.exec(semesterId.trim());
  if (!m) return null;
  return m[1]?.toLowerCase() === "h" ? "AUTUMN" : "SPRING";
}

/**
 * The **academic** year a semester belongs to: autumn `Y` and the following
 * spring `Y+1` are one academic year `Y`. `search-index.json` is built from a
 * single catalog year, so this is exactly which semesters its exam dates can
 * speak for — `26h` and `27v` for the 2026 catalog, and nothing later (C3).
 * `null` for a malformed id.
 */
export function academicYearOf(semesterId: string): number | null {
  const m = /^(\d{2})([hv])$/i.exec(semesterId.trim());
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  return m[2]?.toLowerCase() === "h" ? year : year - 1;
}

/**
 * True when the planner index's catalog year can speak for `semesterId` at
 * all. Outside it the caller must say so ("eksamensdatoer er ikke publisert
 * for Høst 2027") rather than presenting the previous year's dates as this
 * semester's — which is what a season-only match did, a full year early.
 */
export function indexCoversSemester(index: PlannerIndex | null, semesterId: string): boolean {
  if (!index) return false;
  const academic = academicYearOf(semesterId);
  return academic !== null && academic === index.year;
}

/** The date span an exam has to fall inside to belong to a semester — `semesters.json`'s own fields. */
export interface ExamWindow {
  fromDate: string | null;
  examFinalDate: string | null;
}

/**
 * Catalog exam inputs for one course, filtered to a semester's season
 * (DR-3, PRODUCT.md §8): the exam ribbon's source of truth is catalog
 * `ExamDate`, not scraped `CourseExam` text — `details().exams` is
 * enrichment-only (popover text), never the ribbon source.
 *
 * Matches by season **and**, when a `window` is supplied, by the semester's
 * own date span. The season match alone is not a year match: an autumn
 * semester's exam window regularly spills into the following
 * January/February (e.g. `26h`'s `examLastDate` is `2027-02-01`), so a
 * same-calendar-year filter would silently drop real exams — but a
 * season-only filter presented Høst 2026's dates as Høst 2027's, a year
 * early and with no staleness marker (C3). The window is `fromDate` …
 * `examFinalDate` straight out of `semesters.json`, which is both wide
 * enough for the January spill and narrow enough to exclude the next
 * year's.
 *
 * `search-index.json` rows are built by `crawler/transform.mjs`'s
 * `toSearchIndex`, which already excludes continuation (kont) exams before
 * this data ever reaches the client. A `null` date is kept (not dropped) so
 * callers can render the "dato ikke satt" bucket (DR-3) instead of silently
 * losing the exam — a dateless exam carries no year to be wrong about.
 */
export function examsFromIndex(
  course: Pick<PlannerIndexCourse, 0 | 3>,
  semesterId: string,
  window?: ExamWindow | null,
): { code: string; date: string | null }[] {
  const keep = examBelongsTo(semesterId, window);
  if (!keep) return [];
  return course[3].filter(keep).map(([, date]) => ({ code: course[0], date }));
}

/**
 * The predicate `examsFromIndex` and `indexForSemester` share: does this
 * catalog exam belong to `semesterId`? `null` when the semester id itself is
 * unusable, so callers can distinguish "no exams" from "no question".
 */
function examBelongsTo(
  semesterId: string,
  window?: ExamWindow | null,
): ((exam: PlannerIndexExam) => boolean) | null {
  const season = seasonForSemesterId(semesterId);
  if (season === null) return null;
  const from = window?.fromDate ?? null;
  const until = window?.examFinalDate ?? null;
  return ([s, date]) => {
    if (s !== season) return false;
    if (date === null) return true;
    if (from !== null && date < from) return false;
    if (until !== null && date > until) return false;
    return true;
  };
}

/**
 * A copy of the index whose every row carries only the exams that belong to
 * `semesterId` — season **and** the semester's own `fromDate`…`examFinalDate`
 * window.
 *
 * This exists because the exam ribbon reaches into the index itself and so
 * cannot be handed a window per call. Pre-filtering here means the ribbon's
 * season match becomes a no-op rather than a second, weaker filter, and the
 * ribbon has no way to render a date from a semester it was not asked about:
 * selecting "2027 HØST" used to present Høst 2026's dates as 27h's, a year
 * early, with no staleness marker (C3).
 *
 * Cheap enough to run per semester (one pass over ~5 500 two-element arrays)
 * but not per render — callers should memoise by `semesterId`.
 */
export function indexForSemester(
  index: PlannerIndex,
  semesterId: string,
  window?: ExamWindow | null,
): PlannerIndex {
  const keep = examBelongsTo(semesterId, window);
  const courses = index.courses.map((row): PlannerIndexCourse => {
    const exams = keep ? row[3].filter(keep) : [];
    // Most rows have no exams at all — hand the original back rather than
    // allocating 5 470 identical tuples on every semester switch.
    if (exams.length === row[3].length) return row;
    return [row[0], row[1], row[2], exams, row[4], row[5]];
  });
  return { year: index.year, courses };
}
