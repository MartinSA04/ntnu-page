/**
 * Fetch + shape layer for the planner (PLANNER.md §3). Talks to the same
 * `/api/*` Worker routes the course-detail page uses; per-course failures
 * are captured rather than thrown so the page can render partial plans
 * (PLANNER.md's "one error line per failed course").
 *
 * This layer owns the *honest signal* PRODUCT §1's moat is built on: for every
 * course it says whether the timetable came back **with entries**, came back
 * **empty**, or **failed and why** (`TimetableOutcome`). The three must never
 * collapse into "no blocks drawn" at a consumer — that is how a failed fetch
 * ended up rendered as "ingen kollisjoner". Read `timetableOutcomeOf(bundle)`
 * or `courseFetchState(code)`, never `bundle.timetable?.length` alone.
 *
 * Upstream English never reaches the UI from here: every failure is classified
 * into a `FetchFailureReason` and carries a ready Norwegian `message`; the raw
 * string survives as `detail` for the console only.
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

/**
 * Why a fetch failed, classified so no upstream English ever reaches the
 * Norwegian UI (pd-9/ux-7/ux-fail-6). The worker answers in English
 * (`{"error":"Not found"}`, `"Rate limited"`) and a rejected `fetch` carries
 * the browser's own "Failed to fetch"; both stop here.
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
 * ikke" — reporting a download failure as an upstream fact is exactly the
 * dishonesty pd-3 flagged.
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
 * The only error this module rejects with. `message` is already the Norwegian
 * sentence, so even a consumer that prints `err.message` blindly stays in
 * bokmål; `detail` keeps the raw upstream/browser text for the console.
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
 * What the timetable leg actually produced. `empty` and `failed` are the two
 * states the week must never merge: "NTNU has no teaching registered" and "we
 * do not know" look identical on a grid, and only one of them permits a
 * "ingen kollisjoner" verdict (audit §1).
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
   * The entries, or `null` when the timetable could not be fetched. `null`
   * means **unknown**, `[]` means **NTNU has no entries** — read
   * `timetableOutcomeOf()` rather than deciding from this field alone.
   */
  timetable: TimetableEntry[] | null;
  details: CourseDetails | null;
  /**
   * Set on every bundle `fetchCourseBundle` returns. Optional only because
   * `courseTimetable.ts` hand-builds a bundle from entries it already has;
   * `timetableOutcomeOf()` covers that case, so prefer it over `?.`.
   */
  timetableOutcome?: TimetableOutcome;
  /** Every leg that failed, classified. Empty on a healthy fetch. */
  failures?: CourseFetchFailure[];
  /**
   * `failures` pre-rendered as `"timeplan: NTNU svarte ikke"` — the shape the
   * course rows and the provenance line already consume (they split on the
   * colon for the part label). Norwegian on both sides of the colon.
   */
  errors: string[];
}

/**
 * What `fetchCourseBundle` always hands back: the honest fields are
 * guaranteed. Prefer this type wherever a bundle is known to come from a
 * fetch; `CourseBundle` exists for the hand-built case only.
 */
export interface FetchedCourseBundle extends CourseBundle {
  timetableOutcome: TimetableOutcome;
  failures: CourseFetchFailure[];
}

/**
 * A complete bundle around entries the caller already has (the course page
 * reuses the planner's grid with its own timetable). Keeps hand-built bundles
 * from being the one place the honest fields are missing.
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
 * neither year nor version, so keying them with the bundle's composite key
 * re-fetched byte-identical data on every semester switch (pd-8).
 */
const detailsMemo = new Map<string, Promise<CourseDetails>>();
/** Latest outcome per course code — the by-code half of the honest signal. */
const fetchStates = new Map<string, CourseFetchState>();

/** Default course version used when a caller has no real one yet (mirrors store.ts's DEFAULT_VERSION). */
const DEFAULT_VERSION = "1";

/** Client-side cap on one planner request. Without it a stalled socket hangs the page (pd-4). */
export const FETCH_TIMEOUT_MS = 15_000;

export interface FetchOptions {
  /**
   * The caller's lifetime signal (`onPage`'s). Combined with the timeout cap.
   * Note it is shared through the memo: aborting it aborts the fetch for every
   * caller of that course, which is what a page teardown wants.
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
  // AbortSignal.any is Baseline 2024; without it the caller's signal wins,
  // which is the safer half to keep.
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

/** Named + numeric HTML entities NTNU's own activity titles carry (ux-7). */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Decodes the HTML entities upstream ships inside plain-text fields — real
 * blocks render "Forelesning 1 MTELSYS &#38; MTTK" without this. Regex, not
 * an element: this module runs under vitest too, and innerHTML on upstream
 * text is not a trade we want.
 */
export function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (!body.startsWith("#")) return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    const code =
      body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

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
  // it — 238 catalog codes contain Æ/Ø/Å and used to take a hard 400 (B1).
  const segment = encodeURIComponent(code);
  const url = `/api/course/${segment}/timetable?year=${year}&version=${encodeURIComponent(version)}`;
  const raw = await fetchJson<unknown>(url, "ntnu", options);
  if (!Array.isArray(raw)) {
    throw new FetchFailureError("unknown", "ntnu", "timetable response was not an array");
  }
  return (raw as TimetableEntry[]).map(decodeEntry);
}

/** Details, memoized by code alone — the URL carries neither year nor version (pd-8). */
function fetchCourseDetails(code: string, options?: FetchOptions): Promise<CourseDetails> {
  const key = codeKey(code);
  const cached = detailsMemo.get(key);
  if (cached) return cached;
  const promise: Promise<CourseDetails> = fetchJson<CourseDetails>(
    `/api/course/${encodeURIComponent(code)}`,
    "ntnu",
    options,
  ).catch((err: unknown) => {
    // A failure must not be memoized (pd-5); the in-flight promise still is,
    // so concurrent callers share the one request.
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
 * `code:year:version` for the lifetime of the module (page load). Never
 * rejects: each part's failure is recorded in `failures`/`errors`, its field
 * left `null`, and the timetable's fate stated in `timetableOutcome`.
 *
 * A bundle that carries a failure is **dropped from the memo** as it settles
 * (pd-5): the module outlives every in-site navigation (CLAUDE.md's
 * ClientRouter rule), so memoizing a transient blip made it permanent for the
 * session with only a hard reload to recover. In-flight dedup is unaffected —
 * the promise stays in the map until it resolves.
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
 * The honest signal for one bundle, including bundles built by hand rather
 * than fetched (`courseTimetable.ts`) and the semester-narrowed clones
 * plannerApp makes — those keep the *fetch's* outcome, so "fetched 12 entries,
 * none of them in this semester" stays distinguishable from "fetch failed".
 * A `null` bundle is not-yet-loaded.
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
 * The latest fetch outcome for `code`, or `null` when this page never asked.
 * For surfaces that know a course code but hold no bundle. Keyed by code
 * alone, so a semester switch overwrites it — a bundle in hand is the more
 * precise source (`timetableOutcomeOf`).
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

/**
 * Fetch `/data/search-index.json` once per page load (module-level memo).
 *
 * A *rejection* is deliberately not memoized (pd-3): the memo used to hold the
 * failed promise for the whole SPA session, so one dropped download left the
 * exam column spinning, the add-course dialog stuck on "Henter emner …", and
 * the provenance line asserting NTNU had published no exam dates — a download
 * failure reported as an upstream fact. Callers may simply call again.
 *
 * Rejects with a `FetchFailureError` whose `source` is `"site"`: this is our
 * own build artifact, so its failure must not be worded as NTNU's.
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
 *
 * Identical `[season, date]` tuples collapse to one (exams-4). 68 catalog
 * courses repeat a tuple (FI3202 has three `AUTUMN, null`), and the tuple
 * carries nothing that could tell the occasions apart — so they rendered as
 * byte-identical "dato ikke satt" rows and inflated the provenance count.
 * Deduping here rather than in the crawler keeps the raw catalog faithful and
 * fixes both readers (the exam list and `countDatelessExams`) at once.
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
