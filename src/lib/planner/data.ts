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
 * `code:year` for the lifetime of the module (page load). Never rejects:
 * each part's failure is recorded in `errors` and its field left `null`.
 */
export function fetchCourseBundle(code: string, year: number): Promise<CourseBundle> {
  const key = `${code}:${year}`;
  const cached = bundleMemo.get(key);
  if (cached) return cached;

  const promise = (async (): Promise<CourseBundle> => {
    const errors: string[] = [];
    const [timetableResult, detailsResult] = await Promise.allSettled([
      fetchJson<TimetableEntry[]>(`/api/course/${code}/timetable?year=${year}`),
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
