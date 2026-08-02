/**
 * Fetch + shape layer for the planner (SPEC.md). Per-course failures are
 * captured rather than thrown so the page can render partial plans.
 *
 * Owns the *honest signal* PRODUCT §2's moat rests on: for every course it says
 * whether the timetable came back **with entries**, came back **empty**, or
 * **failed and why** (`TimetableOutcome`). Never collapse the three into "no
 * blocks drawn" — read `timetableOutcomeOf(bundle)` or `courseFetchState(code)`,
 * never `bundle.timetable?.length` alone.
 *
 * Upstream English never reaches the UI from here: every failure carries a
 * ready Norwegian `message`, and the raw string survives as `detail`.
 */

import { decodeEntities } from "ntnu-api";

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

/**
 * Why a fetch failed, classified so no upstream English reaches the Norwegian
 * UI. The worker answers in English and a rejected `fetch` carries the
 * browser's own "Failed to fetch"; both stop here.
 */
export type FetchFailureReason =
  | "not-found" // 404 — the catalog has no such course
  | "invalid" // 400 — the code/year we asked with is malformed
  | "rate-limited" // 429
  | "server" // 5xx, incl. the worker's 502 for an upstream error
  | "network" // fetch itself rejected: offline, DNS, CORS
  | "timeout" // our own client-side cap, or the caller aborted
  | "unknown";

/**
 * Who we were talking to. Only used to word a failure honestly: a failed
 * download of our *own* build artifact must not be reported as "NTNU svarte
 * ikke".
 */
export type FetchSource = "ntnu" | "site";

/** The Norwegian sentence a reason renders as, completing "fikk ikke hentet timeplan: …". */
export function failureMessage(reason: FetchFailureReason, source: FetchSource = "ntnu"): string {
  const who = source === "ntnu" ? "NTNU" : "nettstedet";
  switch (reason) {
    case "not-found":
      return source === "ntnu" ? "finnes ikke i katalogen" : "fant ikke dataene";
    case "invalid":
      return "ugyldig emnekode";
    case "rate-limited":
      return "for mange forespørsler akkurat nå";
    case "server":
      return `${who} svarte ikke`;
    case "network":
      return "ingen nettforbindelse";
    case "timeout":
      return `${who} svarte ikke i tide`;
    default:
      return "ukjent feil";
  }
}

/**
 * The only error this module rejects with. `message` is already Norwegian;
 * `detail` keeps the raw upstream/browser text for the console.
 */
export class FetchFailureError extends Error {
  readonly reason: FetchFailureReason;
  readonly source: FetchSource;
  /** Raw upstream/browser text ("Not found", "Failed to fetch"). Debugging only — never render it. */
  readonly detail: string;

  constructor(reason: FetchFailureReason, source: FetchSource, detail: string) {
    super(failureMessage(reason, source));
    this.name = "FetchFailureError";
    this.reason = reason;
    this.source = source;
    this.detail = detail;
  }
}

/** One failed leg of a course fetch. */
export interface CourseFetchFailure {
  part: "timetable" | "details";
  reason: FetchFailureReason;
  /** Ready-to-render Norwegian sentence. */
  message: string;
  /** Raw upstream text, for `console.debug` only. */
  detail: string;
}

/**
 * What the timetable leg produced. `empty` and `failed` are the two states the
 * week must never merge: they look identical on a grid, and only one permits a
 * "ingen kollisjoner" verdict.
 */
export type TimetableOutcome =
  | { kind: "entries"; count: number }
  | { kind: "empty" }
  | { kind: "failed"; reason: FetchFailureReason; message: string };

/** `TimetableOutcome` plus the in-flight/not-loaded state. */
export type CourseFetchState = TimetableOutcome | { kind: "pending" };

/** Per-course fetch result: each part captured independently, never thrown. */
export interface CourseBundle {
  /**
   * The entries, or `null` when the timetable could not be fetched. `null` =
   * **unknown**, `[]` = **NTNU has no entries**. Prefer `timetableOutcomeOf()`.
   */
  timetable: TimetableEntry[] | null;
  details: CourseDetails | null;
  /**
   * Set on every bundle `fetchCourseBundle` returns. Optional only because
   * `courseTimetable.ts` hand-builds one; prefer `timetableOutcomeOf()`.
   */
  timetableOutcome?: TimetableOutcome;
  /** Every leg that failed, classified. Empty on a healthy fetch. */
  failures?: CourseFetchFailure[];
  /**
   * `failures` pre-rendered as `"timeplan: NTNU svarte ikke"` — the shape the
   * course rows and provenance line consume (they split on the colon).
   */
  errors: string[];
}

/**
 * What `fetchCourseBundle` always hands back, with the honest fields
 * guaranteed. `CourseBundle` exists for the hand-built case only.
 */
export interface FetchedCourseBundle extends CourseBundle {
  timetableOutcome: TimetableOutcome;
  failures: CourseFetchFailure[];
}

/**
 * A complete bundle around entries the caller already has, so hand-built
 * bundles are not the one place the honest fields go missing.
 */
export function bundleFromEntries(entries: TimetableEntry[]): FetchedCourseBundle {
  return {
    timetable: entries,
    details: null,
    timetableOutcome:
      entries.length > 0 ? { kind: "entries", count: entries.length } : { kind: "empty" },
    failures: [],
    errors: [],
  };
}

const PART_LABEL: Record<CourseFetchFailure["part"], string> = {
  timetable: "timeplan",
  details: "detaljer",
};

const bundleMemo = new Map<string, Promise<FetchedCourseBundle>>();
/**
 * Details are memoized on their own, by code: `/api/course/:code` carries
 * neither year nor version, so a composite key re-fetched identical data on
 * every semester switch.
 */
const detailsMemo = new Map<string, Promise<CourseDetails>>();
/** Latest outcome per course code — the by-code half of the honest signal. */
const fetchStates = new Map<string, CourseFetchState>();

/** Default course version used when a caller has no real one yet (mirrors store.ts's DEFAULT_VERSION). */
const DEFAULT_VERSION = "1";

/** Client-side cap on one planner request. Without it a stalled socket hangs the page. */
export const FETCH_TIMEOUT_MS = 15_000;

export interface FetchOptions {
  /**
   * The caller's lifetime signal, combined with the timeout cap. Shared through
   * the memo: aborting it aborts the fetch for every caller of that course.
   */
  signal?: AbortSignal | null;
}

/** Memo/registry key. The worker uppercases codes too, so casing is not identity. */
function codeKey(code: string): string {
  return code.trim().toUpperCase();
}

function requestSignal(external?: AbortSignal | null): AbortSignal | undefined {
  const timeout =
    typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : null;
  if (!timeout) return external ?? undefined;
  if (!external) return timeout;
  // AbortSignal.any is Baseline 2024; without it the caller's signal wins.
  return typeof AbortSignal.any === "function" ? AbortSignal.any([external, timeout]) : external;
}

function reasonForStatus(status: number): FetchFailureReason {
  if (status === 404) return "not-found";
  if (status === 400) return "invalid";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "server";
  return "unknown";
}

/** Anything thrown at us → a classified failure. */
function classify(err: unknown, source: FetchSource): FetchFailureError {
  if (err instanceof FetchFailureError) return err;
  const name = (err as { name?: string } | null)?.name ?? "";
  const detail = (err as { message?: string } | null)?.message ?? String(err);
  // A caller abort (page teardown) lands here too; nothing renders after a
  // teardown, so wording it as a timeout costs nothing.
  if (name === "TimeoutError" || name === "AbortError") {
    return new FetchFailureError("timeout", source, detail);
  }
  if (err instanceof TypeError) return new FetchFailureError("network", source, detail);
  return new FetchFailureError("unknown", source, detail);
}

async function fetchJson<T>(
  url: string,
  source: FetchSource = "ntnu",
  options?: FetchOptions,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal: requestSignal(options?.signal) });
  } catch (err) {
    throw classify(err, source);
  }
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string } | null;
      if (body?.error) detail = body.error;
    } catch {
      // ignore unparseable error bodies, fall back to the status code
    }
    throw new FetchFailureError(reasonForStatus(res.status), source, detail);
  }
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw classify(err, source);
  }
}

/**
 * Decodes the HTML entities upstream ships inside plain-text fields.
 *
 * `ntnu-api` applies it inside `parseTimetableEntry` too, so a freshly-parsed
 * payload arrives decoded and this pass is a no-op on it. Still applied because
 * the worker's KV cache holds entries parsed by the *previous* library version
 * for up to a full TTL after a deploy. Decoding twice is safe.
 */
export { decodeEntities };

/** Same entry unless `title`/`name` actually carried an entity. */
function decodeEntry(entry: TimetableEntry): TimetableEntry {
  const title = entry.title === null ? null : decodeEntities(entry.title);
  const name = entry.name === null ? null : decodeEntities(entry.name);
  if (title === entry.title && name === entry.name) return entry;
  return { ...entry, title, name };
}

async function fetchTimetable(
  code: string,
  year: number,
  version: string,
  options?: FetchOptions,
): Promise<TimetableEntry[]> {
  // The code stays percent-encoded until the worker's own parseCode decodes
  // it — 238 catalog codes contain Æ/Ø/Å and used to take a hard 400.
  const segment = encodeURIComponent(code);
  const url = `/api/course/${segment}/timetable?year=${year}&version=${encodeURIComponent(version)}`;
  const raw = await fetchJson<unknown>(url, "ntnu", options);
  if (!Array.isArray(raw)) {
    throw new FetchFailureError("unknown", "ntnu", "timetable response was not an array");
  }
  return (raw as TimetableEntry[]).map(decodeEntry);
}

/** Details, memoized by code alone — the URL carries neither year nor version. */
function fetchCourseDetails(code: string, options?: FetchOptions): Promise<CourseDetails> {
  const key = codeKey(code);
  const cached = detailsMemo.get(key);
  if (cached) return cached;
  const promise: Promise<CourseDetails> = fetchJson<CourseDetails>(
    `/api/course/${encodeURIComponent(code)}`,
    "ntnu",
    options,
  ).catch((err: unknown) => {
    // A failure must not be memoized; the in-flight promise still is, so
    // concurrent callers share the one request.
    if (detailsMemo.get(key) === promise) detailsMemo.delete(key);
    throw err;
  });
  detailsMemo.set(key, promise);
  return promise;
}

function toFailure(part: CourseFetchFailure["part"], reason: unknown): CourseFetchFailure {
  const err = classify(reason, "ntnu");
  return { part, reason: err.reason, message: err.message, detail: err.detail };
}

async function loadBundle(
  code: string,
  year: number,
  version: string,
  options?: FetchOptions,
): Promise<FetchedCourseBundle> {
  const [timetableResult, detailsResult] = await Promise.allSettled([
    fetchTimetable(code, year, version, options),
    fetchCourseDetails(code, options),
  ]);

  const failures: CourseFetchFailure[] = [];

  let timetable: TimetableEntry[] | null = null;
  let timetableOutcome: TimetableOutcome;
  if (timetableResult.status === "fulfilled") {
    timetable = timetableResult.value;
    timetableOutcome =
      timetable.length > 0 ? { kind: "entries", count: timetable.length } : { kind: "empty" };
  } else {
    const failure = toFailure("timetable", timetableResult.reason);
    failures.push(failure);
    timetableOutcome = { kind: "failed", reason: failure.reason, message: failure.message };
  }

  let details: CourseDetails | null = null;
  if (detailsResult.status === "fulfilled") {
    details = detailsResult.value;
  } else {
    failures.push(toFailure("details", detailsResult.reason));
  }

  fetchStates.set(codeKey(code), timetableOutcome);
  return {
    timetable,
    details,
    timetableOutcome,
    failures,
    errors: failures.map((f) => `${PART_LABEL[f.part]}: ${f.message}`),
  };
}

/**
 * Fetch a course's timetable + details in parallel, memoized per
 * `code:year:version` for the module's lifetime. Never rejects: each part's
 * failure lands in `failures`/`errors` and the timetable's fate in
 * `timetableOutcome`.
 *
 * A bundle carrying a failure is **dropped from the memo** as it settles: the
 * module outlives every in-site navigation, so memoizing a transient blip made
 * it permanent for the session. In-flight dedup is unaffected.
 *
 * `version` threads to the timetable call (DR-4) but NOT to details:
 * `courses.details()` has no `version` option, so details are the same
 * whichever version's timetable is shown.
 */
export function fetchCourseBundle(
  code: string,
  year: number,
  version: string = DEFAULT_VERSION,
  options?: FetchOptions,
): Promise<FetchedCourseBundle> {
  const key = `${codeKey(code)}:${year}:${version}`;
  const cached = bundleMemo.get(key);
  if (cached) return cached;

  fetchStates.set(codeKey(code), { kind: "pending" });
  const promise: Promise<FetchedCourseBundle> = loadBundle(code, year, version, options).then(
    (bundle) => {
      if (bundle.failures.length > 0 && bundleMemo.get(key) === promise) bundleMemo.delete(key);
      return bundle;
    },
  );
  bundleMemo.set(key, promise);
  return promise;
}

/**
 * The honest signal for one bundle, including hand-built ones and the
 * semester-narrowed clones plannerApp makes — those keep the *fetch's* outcome,
 * so "fetched 12 entries, none this semester" stays distinct from "fetch
 * failed". A `null` bundle is not-yet-loaded.
 */
export function timetableOutcomeOf(bundle: CourseBundle | null | undefined): CourseFetchState {
  if (!bundle) return { kind: "pending" };
  if (bundle.timetableOutcome) return bundle.timetableOutcome;
  if (bundle.timetable === null) {
    return { kind: "failed", reason: "unknown", message: failureMessage("unknown") };
  }
  return bundle.timetable.length > 0
    ? { kind: "entries", count: bundle.timetable.length }
    : { kind: "empty" };
}

/**
 * The latest fetch outcome for `code`, for surfaces that know a code but hold
 * no bundle. Keyed by code alone, so a semester switch overwrites it — a bundle
 * in hand is more precise (`timetableOutcomeOf`).
 */
export function courseFetchState(code: string): CourseFetchState | null {
  return fetchStates.get(codeKey(code)) ?? null;
}

/** Clears the in-memory bundle/details memos and the per-code states. Exposed for tests and "Prøv igjen". */
export function clearCourseBundleMemo(): void {
  bundleMemo.clear();
  detailsMemo.clear();
  fetchStates.clear();
}

/** One catalog course as compacted in `search-index.json` (SPEC.md). */
export type PlannerIndexExam = [season: string, date: string | null];

/**
 * Positional tuple — elements 0–3 have never moved; 4 and 5 were appended by
 * the two-year crawl. New fields are only ever appended.
 *
 * `offeredYears` is newest-first and never empty. When it does NOT contain
 * `PlannerIndex.year` the row's fields all come from the older catalog year:
 * the course is not taught in the canonical year and its exam dates are last
 * year's, which the semester-window filter below has to catch.
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

/**
 * Fetch `/data/search-index.json` once per page load (module-level memo).
 *
 * A *rejection* is deliberately not memoized: holding the failed promise for
 * the whole SPA session left the exam column spinning and the provenance line
 * asserting NTNU had published no exam dates. Callers may simply call again.
 *
 * Rejects with `source: "site"` — our own artifact, not NTNU's.
 */
export function loadPlannerIndex(): Promise<PlannerIndex> {
  if (indexMemo) return indexMemo;
  const pending: Promise<PlannerIndex> = fetchJson<PlannerIndex>(
    "/data/search-index.json",
    "site",
  ).catch((err: unknown) => {
    if (indexMemo === pending) indexMemo = null;
    throw err;
  });
  indexMemo = pending;
  return pending;
}

/** Clears the in-memory index memo. Exposed for tests only. */
export function clearPlannerIndexMemo(): void {
  indexMemo = null;
}

/**
 * The `Semester.season` a `Semester.id` (`"26h"`/`"27v"`) encodes. `null` for a
 * malformed id.
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
 * speak for. `null` for a malformed id.
 */
export function academicYearOf(semesterId: string): number | null {
  const m = /^(\d{2})([hv])$/i.exec(semesterId.trim());
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  return m[2]?.toLowerCase() === "h" ? year : year - 1;
}

/**
 * True when the planner index's catalog year can speak for `semesterId` at all.
 * Outside it the caller must say so rather than presenting the previous year's
 * dates as this semester's — which is what a season-only match did.
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
 * Catalog exam inputs for one course, filtered to a semester (DR-3): the exam
 * ribbon's source of truth is catalog `ExamDate`, never scraped `CourseExam`
 * text, which is enrichment-only.
 *
 * Matches by season **and**, when a `window` is supplied, the semester's own
 * date span. Season alone is not a year match — an autumn exam window spills
 * into January/February, so a same-calendar-year filter drops real exams, while
 * a season-only filter presented Høst 2026's dates as Høst 2027's.
 *
 * A `null` date is kept so callers can render the "dato ikke satt" bucket — a
 * dateless exam carries no year to be wrong about. Identical `[season, date]`
 * tuples collapse to one: 68 catalog courses repeat a tuple with nothing to
 * tell the occasions apart. Deduping here keeps the raw catalog faithful and
 * fixes both readers at once.
 */
export function examsFromIndex(
  course: Pick<PlannerIndexCourse, 0 | 3>,
  semesterId: string,
  window?: ExamWindow | null,
): { code: string; date: string | null }[] {
  const keep = examBelongsTo(semesterId, window);
  if (!keep) return [];
  const seen = new Set<string>();
  const out: { code: string; date: string | null }[] = [];
  for (const exam of course[3]) {
    if (!keep(exam)) continue;
    const key = `${exam[0]}|${exam[1] ?? "null"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code: course[0], date: exam[1] });
  }
  return out;
}

/**
 * The predicate `examsFromIndex` and `indexForSemester` share. `null` when the
 * semester id itself is unusable, so callers can tell "no exams" from "no
 * question".
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
 * A copy of the index whose every row carries only the exams belonging to
 * `semesterId` — season **and** the semester's own date window.
 *
 * Exists because the exam ribbon reaches into the index itself and cannot be
 * handed a window per call. Pre-filtering makes the ribbon's own season match a
 * no-op rather than a second, weaker filter, so it has no way to render a date
 * from a semester it was not asked about.
 *
 * One pass over ~5 500 rows: cheap per semester, not per render — memoise by
 * `semesterId`.
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
