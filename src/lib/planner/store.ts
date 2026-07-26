/**
 * Plan state + persistence (PLANNER.md §3, PRODUCT.md §7/§0). Storage and
 * the change-event target are injected so this module works in tests (and
 * any non-DOM context) without touching `window`/`localStorage` at import
 * time.
 *
 * Courses carry `source` (did this come from the programme pre-fill or a
 * manual add?) and, for programme courses only, an optional `dropped` flag —
 * "drop a programme course → grays out, one tap restores, excluded from
 * schedule/credits" (§0.3). Manual adds have no drop state; removing one
 * deletes it outright.
 *
 * Storage is split three ways instead of one blob: the programme choice is
 * global (it survives a semester switch), while the course list is scoped
 * per semester (a manual add in 26h has no business showing up in 27v) —
 * see `PROFILE_STORAGE_KEY`/`PLANS_STORAGE_KEY`/`LAST_SEMESTER_KEY` below.
 */

export const PROFILE_STORAGE_KEY = "np:profile";
export const PLANS_STORAGE_KEY = "np:plans";
export const LAST_SEMESTER_KEY = "np:lastSemester";
export const PLAN_CHANGE_EVENT = "ntnu:plan-change";

/** Default course version when a caller doesn't have a real one yet. */
export const DEFAULT_VERSION = "1";

export type CourseSource = "program" | "manual";

export interface PlanCourse {
  code: string;
  name: string;
  /** Course version (DR-4) — threads to timetable/schedule/details calls. Defaults to `"1"`. */
  version: string;
  source: CourseSource;
  /**
   * Credits as the *study plan* stated them, when the plan is where this
   * course came from. The live `details().credits` still wins when it
   * arrives; this is the fallback for the 39 of 1 383 period-1 obligatory
   * references that are absent from the catalog and would otherwise
   * under-report the semester's load (B9.1). `null`/absent = unknown.
   */
  credits?: number | null;
  /**
   * Only meaningful for `source: "program"`. `true` = the student dropped
   * this programme course: still listed (grayed out, one tap restores),
   * excluded from the schedule and credit total. Manual adds are never
   * `dropped` — removing one deletes it outright instead.
   */
  dropped?: boolean;
  /**
   * Selected group keys (e.g. which forelesningsparallell/øvingsgruppe the
   * student is in) — Task 3 defines the key shape. Absent = the defaults.
   */
  groups?: string[];
}

/**
 * The studieretning a student picked at a `Valg av studieretning` waypoint
 * (programPlan.ts). Later-year periods of a sivilingeniør programme carry no
 * top-level courses at all, so this is what turns the study plan from a
 * choice space into a concrete course list.
 */
export interface PlanDirection {
  code: string;
  name: string;
}

export interface PlanProgram {
  code: string;
  name: string;
  cohort: number;
  /** Absent until the student answers the studieretning question (or the plan has none). */
  direction?: PlanDirection;
}

export interface PlanState {
  semesterId: string;
  courses: PlanCourse[];
  program?: PlanProgram;
}

/** Structural subset of the `Storage` interface (so a fake can be injected). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Structural subset of `EventTarget` (so a fake can be injected). */
export interface EventTargetLike {
  dispatchEvent(event: Event): boolean;
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
}

export interface PlanStoreOptions {
  storage?: StorageLike;
  events?: EventTargetLike;
}

function defaultStorage(): StorageLike | undefined {
  return typeof window !== "undefined" ? window.localStorage : undefined;
}

function defaultEvents(): EventTargetLike | undefined {
  return typeof window !== "undefined" ? window : undefined;
}

/** A no-op storage used when neither an injected nor a global storage is available. */
const nullStorage: StorageLike = {
  getItem: () => null,
  setItem: () => {
    // discard: no persistence available (e.g. non-DOM context)
  },
};

/** A no-op event target used when neither an injected nor a global target is available. */
const nullEvents: EventTargetLike = {
  dispatchEvent: () => true,
  addEventListener: () => {
    // no-op
  },
  removeEventListener: () => {
    // no-op
  },
};

/** Narrows an untrusted JSON value to a plain object, or `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Type-guards one course entry out of untrusted JSON, defensively rebuilding
 * it field-by-field and defaulting `version`/`source` when a record is only
 * a bare `{code, name}` (e.g. a hand-edited or partially-written entry).
 */
function coerceCourse(raw: unknown): PlanCourse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.code !== "string" || typeof obj.name !== "string") return null;

  const version =
    typeof obj.version === "string" && obj.version !== "" ? obj.version : DEFAULT_VERSION;
  const source: CourseSource = obj.source === "program" ? "program" : "manual";
  const course: PlanCourse = { code: obj.code, name: obj.name, version, source };
  if (typeof obj.credits === "number" && Number.isFinite(obj.credits)) course.credits = obj.credits;
  if (source === "program" && obj.dropped === true) course.dropped = true;
  if (Array.isArray(obj.groups)) {
    const groups = obj.groups.filter((g): g is string => typeof g === "string");
    if (groups.length > 0) course.groups = groups;
  }
  return course;
}

/** The shape stored under `PROFILE_STORAGE_KEY`. */
interface StoredProfile {
  program?: PlanProgram;
}

/** Type-guards a parsed JSON value into `{ program? }`, or `{}` when unusable. */
function coerceProfile(raw: unknown): StoredProfile {
  const obj = asRecord(raw);
  if (!obj) return {};
  const rawProgram = asRecord(obj.program);
  if (
    !rawProgram ||
    typeof rawProgram.code !== "string" ||
    typeof rawProgram.name !== "string" ||
    typeof rawProgram.cohort !== "number"
  ) {
    return {};
  }
  const program: PlanProgram = {
    code: rawProgram.code,
    name: rawProgram.name,
    cohort: rawProgram.cohort,
  };
  const rawDirection = asRecord(rawProgram.direction);
  if (rawDirection && typeof rawDirection.code === "string") {
    program.direction = {
      code: rawDirection.code,
      name: typeof rawDirection.name === "string" ? rawDirection.name : rawDirection.code,
    };
  }
  return { program };
}

/** Type-guards a parsed JSON value into `{ [semesterId]: PlanCourse[] }`, dropping unusable entries. */
function coercePlansMap(raw: unknown): Record<string, PlanCourse[]> {
  const obj = asRecord(raw);
  if (!obj) return {};
  const result: Record<string, PlanCourse[]> = {};
  for (const [semesterId, coursesRaw] of Object.entries(obj)) {
    if (!Array.isArray(coursesRaw)) continue;
    const courses: PlanCourse[] = [];
    for (const c of coursesRaw) {
      const course = coerceCourse(c);
      if (course) courses.push(course);
    }
    result[semesterId] = courses;
  }
  return result;
}

/** The non-dropped courses of a plan — what actually counts toward the schedule/credits. */
export function activeCourses(plan: Pick<PlanState, "courses">): PlanCourse[] {
  return plan.courses.filter((c) => !c.dropped);
}

/** A course to add via `addCourse`; `version` defaults to `"1"`, `source` to `"manual"`. */
export interface AddCourseInput {
  code: string;
  name: string;
  version?: string;
  source?: CourseSource;
  /** Study-plan credits, when the caller has them (B9.1). Omitted = unknown. */
  credits?: number | null;
}

export interface PlanStore {
  loadPlan(): PlanState;
  savePlan(plan: PlanState): void;
  addCourse(course: AddCourseInput): PlanState;
  removeCourse(code: string): PlanState;
  hasCourse(code: string): boolean;
  dropCourse(code: string): PlanState;
  restoreCourse(code: string): PlanState;
  setProgramPlan(program: PlanProgram, courses: AddCourseInput[]): PlanState;
  setSemester(semesterId: string): PlanState;
  setProgram(program: PlanProgram): PlanState;
  /** Clears the programme profile: drops the program and every programme-sourced course, keeps manual adds. */
  removeProgram(): PlanState;
  /** Replaces a course's selected group keys; `[]` clears back to defaults. */
  setCourseGroups(code: string, groups: string[]): PlanState;
  onPlanChange(cb: (plan: PlanState) => void): () => void;
}

/**
 * Builds a plan store bound to injected (or default global) storage/events.
 * Reads are always fresh from storage (no in-memory cache) so multiple
 * store instances / tabs stay consistent. Safe to call at module load in a
 * non-DOM context: falls back to inert no-op storage/events rather than
 * touching `window`.
 */
export function createPlanStore(
  defaultSemesterId: string,
  options: PlanStoreOptions = {},
): PlanStore {
  const storage = options.storage ?? defaultStorage() ?? nullStorage;
  const events = options.events ?? defaultEvents() ?? nullEvents;

  function readProfile(): StoredProfile {
    const raw = storage.getItem(PROFILE_STORAGE_KEY);
    if (raw === null) return {};
    try {
      return coerceProfile(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  function readPlans(): Record<string, PlanCourse[]> {
    const raw = storage.getItem(PLANS_STORAGE_KEY);
    if (raw === null) return {};
    try {
      return coercePlansMap(JSON.parse(raw));
    } catch {
      return {};
    }
  }

  /** Writes one semester's course list into the plans map, returning the updated map. */
  function writePlansEntry(
    semesterId: string,
    courses: PlanCourse[],
  ): Record<string, PlanCourse[]> {
    const plans = readPlans();
    plans[semesterId] = courses;
    storage.setItem(PLANS_STORAGE_KEY, JSON.stringify(plans));
    return plans;
  }

  function loadPlan(): PlanState {
    const rawLast = storage.getItem(LAST_SEMESTER_KEY);
    const semesterId = rawLast !== null && rawLast !== "" ? rawLast : defaultSemesterId;
    const plans = readPlans();
    const profile = readProfile();
    const plan: PlanState = { semesterId, courses: plans[semesterId] ?? [] };
    if (profile.program) plan.program = profile.program;
    return plan;
  }

  function savePlan(plan: PlanState): void {
    writePlansEntry(plan.semesterId, plan.courses);
    if (plan.program !== undefined) {
      storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({ program: plan.program }));
    }
    storage.setItem(LAST_SEMESTER_KEY, plan.semesterId);
    events.dispatchEvent(new CustomEvent(PLAN_CHANGE_EVENT, { detail: plan }));
  }

  function addCourse(course: AddCourseInput): PlanState {
    const plan = loadPlan();
    if (plan.courses.some((c) => c.code === course.code)) return plan;
    const full: PlanCourse = {
      code: course.code,
      name: course.name,
      version: course.version ?? DEFAULT_VERSION,
      source: course.source ?? "manual",
    };
    if (course.credits != null) full.credits = course.credits;
    const next: PlanState = { ...plan, courses: [...plan.courses, full] };
    savePlan(next);
    return next;
  }

  function removeCourse(code: string): PlanState {
    const plan = loadPlan();
    const next: PlanState = { ...plan, courses: plan.courses.filter((c) => c.code !== code) };
    savePlan(next);
    return next;
  }

  function hasCourse(code: string): boolean {
    return loadPlan().courses.some((c) => c.code === code);
  }

  /**
   * Marks a programme course dropped (grayed out, excluded from
   * schedule/credits, still listed). No-op for a manual course or an
   * absent code — dropping only ever applies to `source: "program"`.
   */
  function dropCourse(code: string): PlanState {
    const plan = loadPlan();
    let changed = false;
    const courses = plan.courses.map((c) => {
      if (c.code !== code || c.source !== "program" || c.dropped) return c;
      changed = true;
      return { ...c, dropped: true };
    });
    if (!changed) return plan;
    const next: PlanState = { ...plan, courses };
    savePlan(next);
    return next;
  }

  /** Restores a previously dropped programme course. No-op if it wasn't dropped. */
  function restoreCourse(code: string): PlanState {
    const plan = loadPlan();
    let changed = false;
    const courses = plan.courses.map((c) => {
      if (c.code !== code || !c.dropped) return c;
      changed = true;
      const { dropped: _dropped, ...rest } = c;
      return rest;
    });
    if (!changed) return plan;
    const next: PlanState = { ...plan, courses };
    savePlan(next);
    return next;
  }

  /**
   * Replaces the plan's `source: "program"` course set with `courses`,
   * preserving: (a) the `dropped` flag on any code that persists across the
   * replacement (re-picking the same programme+kull, or a plan refresh,
   * must not silently un-drop something the student already removed), (b)
   * the `groups` selection on any code that persists (a shared link's group
   * pick, or the student's own parallel/øving choice, must survive a study
   * plan re-derive — it used to show on first paint and then vanish the
   * moment `onPlanChange` re-ran this with the same codes), and (c) every
   * `source: "manual"` course untouched. Used when the programme/kull
   * selection changes (or the study plan is (re)fetched).
   */
  function setProgramPlan(program: PlanProgram, courses: AddCourseInput[]): PlanState {
    const plan = loadPlan();
    const previousDrops = new Map(
      plan.courses.filter((c) => c.source === "program" && c.dropped).map((c) => [c.code, true]),
    );
    const previousGroups = new Map(
      plan.courses
        .filter((c) => c.source === "program" && c.groups && c.groups.length > 0)
        .map((c) => [c.code, c.groups as string[]]),
    );
    const manual = plan.courses.filter((c) => c.source === "manual");
    const program_: PlanCourse[] = courses.map((c) => {
      const course: PlanCourse = {
        code: c.code,
        name: c.name,
        version: c.version ?? DEFAULT_VERSION,
        source: "program",
      };
      if (c.credits != null) course.credits = c.credits;
      if (previousDrops.has(c.code)) course.dropped = true;
      const groups = previousGroups.get(c.code);
      if (groups) course.groups = groups;
      return course;
    });
    const next: PlanState = { ...plan, program, courses: [...program_, ...manual] };
    savePlan(next);
    return next;
  }

  /**
   * Switches the plan's active semester: the current courses are persisted
   * under the semester they belong to first, then the target semester's own
   * stored course list is loaded in their place. Manual adds therefore stay
   * in the semester they were added to (user mandate 7) — they are never
   * carried across a switch. The programme profile is global and is
   * untouched by this.
   */
  function setSemester(semesterId: string): PlanState {
    const plan = loadPlan();
    const plans = writePlansEntry(plan.semesterId, plan.courses);
    const next: PlanState = { semesterId, courses: plans[semesterId] ?? [] };
    if (plan.program !== undefined) next.program = plan.program;
    savePlan(next);
    return next;
  }

  function setProgram(program: PlanProgram): PlanState {
    const plan = loadPlan();
    const next: PlanState = { ...plan, program };
    savePlan(next);
    return next;
  }

  /**
   * Clears the programme profile and re-derives: the stored program is
   * removed and every `source: "program"` course dropped from the active
   * semester, while manual adds survive. `savePlan` can only ever *write* a
   * profile — it skips the `np:profile` key when `program` is undefined, so
   * it cannot clear one — hence the key is reset to an empty record directly
   * here, then the pruned course list is persisted through the normal save
   * path (which writes the plans/last-semester keys and dispatches the
   * change event). Used by the studieinfo modal's "no programme" commit.
   */
  function removeProgram(): PlanState {
    const plan = loadPlan();
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify({}));
    const next: PlanState = {
      semesterId: plan.semesterId,
      courses: plan.courses.filter((c) => c.source !== "program"),
    };
    savePlan(next);
    return next;
  }

  /** Replaces one course's selected group keys; `[]` deletes the property (back to defaults). */
  function setCourseGroups(code: string, groups: string[]): PlanState {
    const plan = loadPlan();
    const courses = plan.courses.map((c): PlanCourse => {
      if (c.code !== code) return c;
      if (groups.length === 0) {
        const { groups: _groups, ...rest } = c;
        return rest;
      }
      return { ...c, groups: [...groups] };
    });
    const next: PlanState = { ...plan, courses };
    savePlan(next);
    return next;
  }

  /**
   * Subscribes to plan changes: same-tab saves (custom event) and
   * cross-tab saves (native `storage` event on any of the three plan keys).
   * Returns an unsubscribe function.
   */
  function onPlanChange(cb: (plan: PlanState) => void): () => void {
    const onCustom = (event: Event) => {
      cb((event as CustomEvent<PlanState>).detail ?? loadPlan());
    };
    const onStorage = (event: Event) => {
      const key = (event as StorageEvent).key;
      if (
        key !== null &&
        key !== PROFILE_STORAGE_KEY &&
        key !== PLANS_STORAGE_KEY &&
        key !== LAST_SEMESTER_KEY
      ) {
        return;
      }
      cb(loadPlan());
    };
    events.addEventListener(PLAN_CHANGE_EVENT, onCustom);
    events.addEventListener("storage", onStorage);
    return () => {
      events.removeEventListener(PLAN_CHANGE_EVENT, onCustom);
      events.removeEventListener("storage", onStorage);
    };
  }

  return {
    loadPlan,
    savePlan,
    addCourse,
    removeCourse,
    hasCourse,
    dropCourse,
    restoreCourse,
    setProgramPlan,
    setSemester,
    setProgram,
    removeProgram,
    setCourseGroups,
    onPlanChange,
  };
}

/** Cohort years outside this band are not a kull — they are a mis-parse (B10). */
const MIN_COHORT_YEAR = 1990;
const COHORT_YEARS_AHEAD = 5;

function cohortIsPlausible(cohort: number): boolean {
  if (!Number.isInteger(cohort)) return false;
  return cohort >= MIN_COHORT_YEAR && cohort <= new Date().getFullYear() + COHORT_YEARS_AHEAD;
}

/** A hash's semester segment must look like this or the whole hash is rejected. */
const SEMESTER_ID_PATTERN = /^\d{2}[hv]$/i;

/**
 * Every field in the hash is percent-encoded on write and decoded on read.
 *
 * `encodeURIComponent` leaves `. - _ ~ ! * ' ( )` alone, which is what makes
 * this safe: `.` (field separator) and `-` (dropped-course prefix) keep
 * their grammatical meaning, while `;`, `,`, `+` and every non-ASCII byte
 * become escapes. Without it a direction code like `BSPL26-V-GJØVIK` was
 * written raw, read back percent-encoded by the browser, and never matched
 * its own study plan again — the campus question re-opened on every load and
 * the banner showed a raw machine code (B10.1).
 */
function encodeField(value: string): string {
  return encodeURIComponent(value);
}

function decodeField(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A hand-mangled escape ("%ZZ") is not worth failing the whole parse over.
    return value;
  }
}

/**
 * One course token in the hash grammar: `[-|+]code[.version]` followed by
 * zero or more `~<groupKey>` segments. `-` = dropped programme course,
 * `+` = manual add, no prefix = active (non-dropped) programme course. The
 * whole token (prefix + code/version + groups) is encoded/decoded as one
 * unit — `~` and `.` both survive `encodeURIComponent` untouched, which is
 * what makes them safe delimiters here; `+` does not survive (it becomes
 * `%2B`), which only matters for round-tripping through this same parser,
 * never for hand-typing.
 */
interface HashToken {
  code: string;
  version: string;
  source: CourseSource;
  dropped: boolean;
  groups: string[];
}

function parseHashToken(raw: string): HashToken | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const decoded = decodeField(trimmed);
  const [head = "", ...groupParts] = decoded.split("~");
  const groups = groupParts.filter((g) => g !== "");

  let rest = head;
  let source: CourseSource = "program";
  let dropped = false;
  if (rest.startsWith("-")) {
    dropped = true;
    rest = rest.slice(1);
  } else if (rest.startsWith("+")) {
    source = "manual";
    rest = rest.slice(1);
  }
  if (rest === "") return null;
  const [codeRaw = "", versionRaw = ""] = rest.split(".");
  if (codeRaw === "") return null;
  const version = versionRaw === "" ? DEFAULT_VERSION : versionRaw;
  return { code: codeRaw, version, source, dropped, groups };
}

function formatHashToken(course: PlanCourse): string {
  const codeVersion =
    course.version === DEFAULT_VERSION ? course.code : `${course.code}.${course.version}`;
  let raw = codeVersion;
  if (course.source === "manual") raw = `+${codeVersion}`;
  else if (course.dropped) raw = `-${codeVersion}`;
  for (const group of course.groups ?? []) {
    raw += `~${group}`;
  }
  return encodeField(raw);
}

/** One course as recovered from a hash: names are unknown from the hash alone. */
export interface HashCourse {
  code: string;
  version: string;
  source: CourseSource;
  dropped?: boolean;
  /** Selected group keys — `[]` when the token carried none. */
  groups: string[];
}

export interface ParsedPlanHash {
  semesterId: string;
  /**
   * `null` when the hash carries no programme segment (`"-"`). `direction`
   * is the studieretning code only — its display name is recovered from the
   * study plan, exactly as the programme's own name is.
   */
  program: { code: string; cohort: number; direction: string | null } | null;
  courses: HashCourse[];
}

/**
 * Parse a plan hash into semester id + optional programme + courses.
 *
 * **The grammar** (three `;`-separated segments; every field percent-encoded,
 * see `encodeField`):
 *
 *     #<semesterId>;<programme>;<courses>
 *
 * - `semesterId` — `26h` / `27v`. Must match `/^\d{2}[hv]$/i` or the whole
 *   hash is rejected — that also kills every old `#v2;…` link by
 *   construction, with no separate version check needed. Whether the *site*
 *   can plan the semester is the caller's call (an id we don't ship data for
 *   falls back to the current semester with a note — C4).
 * - `programme` — `-` (none) or `code[.cohort[.direction]]`. `cohort` must be
 *   a plausible 4-digit year or the whole segment is rejected: the grammar
 *   PRODUCT §7 used to document put *courses* in this slot, and feeding that
 *   form to this parser produced `{code: "TDT4100", cohort: 1}`, a 400 from
 *   `?year=1` and a banner reading "TDT4100 · kull 1" (B10.2).
 * - `courses` — comma list of `[-|+]code[.version][~groupKey…]`. `-` =
 *   dropped programme course, `+` = manual add, bare = active programme
 *   course. A version equal to the default is omitted. Malformed course
 *   tokens are dropped rather than failing the whole parse — one bad token
 *   should not cost the student the other five courses.
 *
 * Returns `null` for an empty/absent hash and for a hash whose semester
 * segment doesn't parse as one.
 */
export function parsePlanHash(hash: string): ParsedPlanHash | null {
  const trimmed = hash.replace(/^#/, "").trim();
  if (trimmed === "") return null;
  const segments = trimmed.split(";");

  const semesterRaw = (segments[0] ?? "").trim();
  if (!SEMESTER_ID_PATTERN.test(semesterRaw)) return null;
  const semesterId = decodeField(semesterRaw);

  const progRaw = (segments[1] ?? "").trim();
  let program: ParsedPlanHash["program"] = null;
  if (progRaw !== "" && progRaw !== "-") {
    const [codeRaw = "", cohortRaw = "", directionRaw = ""] = progRaw.split(".");
    const code = decodeField(codeRaw);
    const cohort = Number(cohortRaw);
    if (code !== "" && cohortRaw !== "" && cohortIsPlausible(cohort)) {
      program = {
        code,
        cohort,
        direction: directionRaw === "" ? null : decodeField(directionRaw),
      };
    }
  }

  const itemsRaw = segments[2] ?? "";
  const courses: HashCourse[] = [];
  for (const token of itemsRaw.split(",")) {
    const parsed = parseHashToken(token);
    if (!parsed) continue;
    const course: HashCourse = {
      code: parsed.code,
      version: parsed.version,
      source: parsed.source,
      groups: parsed.groups,
    };
    if (parsed.source === "program" && parsed.dropped) course.dropped = true;
    courses.push(course);
  }
  return { semesterId, program, courses };
}

/**
 * Format a plan into its shareable hash form. Example:
 * `"#26h;MTDT.2024.MTDTDS-24;TDT4100,TMA4100.2,-IT2805,%2BPSY1000"`.
 *
 * The programme segment is `code.cohort[.direction]`; the direction part is
 * appended only when one was chosen, so hashes written before studieretning
 * existed still parse (and still format) identically. Every field goes
 * through `encodeField`, which is what makes `BSPL26-V-GJØVIK` survive the
 * round trip (B10.1) — and `parsePlanHash` is its exact inverse.
 */
export function formatPlanHash(
  plan: Pick<PlanState, "semesterId" | "courses" | "program">,
): string {
  const program = plan.program;
  const progSegment = program
    ? `${encodeField(program.code)}.${program.cohort}${
        program.direction ? `.${encodeField(program.direction.code)}` : ""
      }`
    : "-";
  const items = plan.courses.map(formatHashToken).join(",");
  return `#${encodeField(plan.semesterId)};${progSegment};${items}`;
}
