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
    const [timetableResult, detailsResult] = await Promise.allSettled([
      fetchJson<TimetableEntry[]>(
        `/api/course/${code}/timetable?year=${year}&version=${encodeURIComponent(version)}`,
      ),
      fetchJson<CourseDetails>(`/api/course/${code}`),
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

export type PlannerIndexCourse = [
  code: string,
  name: string,
  location: string,
  exams: PlannerIndexExam[],
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
 * Catalog exam inputs for one course, filtered to a semester's season
 * (DR-3, PRODUCT.md §8): the exam ribbon's source of truth is catalog
 * `ExamDate`, not scraped `CourseExam` text — `details().exams` is
 * enrichment-only (popover text), never the ribbon source.
 *
 * Matches by **season, not calendar year**: an autumn semester's exam
 * window regularly spills into the following January/February (e.g. `26h`'s
 * `examLastDate` is `2027-02-01` in semesters.json), so a same-year filter
 * would silently drop real exams. `search-index.json` rows are built by
 * `crawler/transform.mjs`'s `toSearchIndex`, which already excludes
 * continuation (kont) exams before this data ever reaches the client — so,
 * unlike the raw catalog's `CatalogExam.continuation` field, there is
 * nothing left to filter here; this function's job is purely the season
 * match. A `null` date is kept (not dropped) so callers can render the
 * "dato ikke satt" bucket (DR-3) instead of silently losing the exam.
 */
export function examsFromIndex(
  course: Pick<PlannerIndexCourse, 0 | 3>,
  semesterId: string,
): { code: string; date: string | null }[] {
  const code = course[0];
  const exams = course[3];
  const season = seasonForSemesterId(semesterId);
  if (season === null) return [];
  return exams.filter(([s]) => s === season).map(([, date]) => ({ code, date }));
}
