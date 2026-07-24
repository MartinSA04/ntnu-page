/**
 * Plan state + persistence (PLANNER.md §3, PRODUCT.md §7/§0). Storage and
 * the change-event target are injected so this module works in tests (and
 * any non-DOM context) without touching `window`/`localStorage` at import
 * time.
 *
 * v2 (PRODUCT.md §0/§7, ROADMAP Phase §0): courses carry `source` (did this
 * come from the programme pre-fill or a manual add?) and, for programme
 * courses only, an optional `dropped` flag — "drop a programme course →
 * grays out, one tap restores, excluded from schedule/credits" (§0.3).
 * Manual adds have no drop state; removing one deletes it outright.
 */

export const PLAN_STORAGE_KEY = "ntnu:plan:v1";
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
   * Only meaningful for `source: "program"`. `true` = the student dropped
   * this programme course: still listed (grayed out, one tap restores),
   * excluded from the schedule and credit total. Manual adds are never
   * `dropped` — removing one deletes it outright instead.
   */
  dropped?: boolean;
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
  v: 1;
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

function emptyPlan(semesterId: string): PlanState {
  return { v: 1, semesterId, courses: [] };
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
 * Type-guards one course entry out of untrusted JSON. Handles both the v2
 * shape and a bare v1 course (`{code, name}`, no `version`/`source`) by
 * migrating the latter in memory to `source: "manual"` (§7's "v1 courses →
 * source: manual" migration rule) — a stored v1 course was, definitionally,
 * something the student added themselves; there was no programme concept
 * yet to have pre-filled it.
 */
function coerceCourse(raw: unknown): PlanCourse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.code !== "string" || typeof obj.name !== "string") return null;

  const version =
    typeof obj.version === "string" && obj.version !== "" ? obj.version : DEFAULT_VERSION;
  const source: CourseSource = obj.source === "program" ? "program" : "manual";
  const course: PlanCourse = { code: obj.code, name: obj.name, version, source };
  if (source === "program" && obj.dropped === true) course.dropped = true;
  return course;
}

/**
 * Type-guards a parsed JSON value into a `PlanState`, defensively rebuilding
 * it field-by-field (upstream localStorage content is untrusted). Falls back
 * to an empty plan for the given semester when the shape is unusable.
 */
function coercePlan(raw: unknown, fallbackSemesterId: string): PlanState {
  if (typeof raw !== "object" || raw === null) return emptyPlan(fallbackSemesterId);
  const obj = raw as Record<string, unknown>;
  if (obj.v !== 1) return emptyPlan(fallbackSemesterId);

  const semesterId = typeof obj.semesterId === "string" ? obj.semesterId : fallbackSemesterId;

  const courses: PlanCourse[] = [];
  if (Array.isArray(obj.courses)) {
    for (const c of obj.courses) {
      const course = coerceCourse(c);
      if (course) courses.push(course);
    }
  }

  const plan: PlanState = { v: 1, semesterId, courses };

  const rawProgram = asRecord(obj.program);
  if (
    rawProgram &&
    typeof rawProgram.code === "string" &&
    typeof rawProgram.name === "string" &&
    typeof rawProgram.cohort === "number"
  ) {
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
    plan.program = program;
  }

  return plan;
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

  function loadPlan(): PlanState {
    const raw = storage.getItem(PLAN_STORAGE_KEY);
    if (raw === null) return emptyPlan(defaultSemesterId);
    try {
      return coercePlan(JSON.parse(raw), defaultSemesterId);
    } catch {
      return emptyPlan(defaultSemesterId);
    }
  }

  function savePlan(plan: PlanState): void {
    storage.setItem(PLAN_STORAGE_KEY, JSON.stringify(plan));
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
   * must not silently un-drop something the student already removed), and
   * (b) every `source: "manual"` course untouched. Used when the
   * programme/kull selection changes (or the study plan is (re)fetched).
   */
  function setProgramPlan(program: PlanProgram, courses: AddCourseInput[]): PlanState {
    const plan = loadPlan();
    const previousDrops = new Map(
      plan.courses.filter((c) => c.source === "program" && c.dropped).map((c) => [c.code, true]),
    );
    const manual = plan.courses.filter((c) => c.source === "manual");
    const program_: PlanCourse[] = courses.map((c) => {
      const course: PlanCourse = {
        code: c.code,
        name: c.name,
        version: c.version ?? DEFAULT_VERSION,
        source: "program",
      };
      if (previousDrops.has(c.code)) course.dropped = true;
      return course;
    });
    const next: PlanState = { ...plan, program, courses: [...program_, ...manual] };
    savePlan(next);
    return next;
  }

  function setSemester(semesterId: string): PlanState {
    const plan = loadPlan();
    const next: PlanState = { ...plan, semesterId };
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
   * Subscribes to plan changes: same-tab saves (custom event) and
   * cross-tab saves (native `storage` event on `PLAN_STORAGE_KEY`). Returns
   * an unsubscribe function.
   */
  function onPlanChange(cb: (plan: PlanState) => void): () => void {
    const onCustom = (event: Event) => {
      cb((event as CustomEvent<PlanState>).detail ?? loadPlan());
    };
    const onStorage = (event: Event) => {
      const storageEvent = event as StorageEvent;
      if (storageEvent.key !== null && storageEvent.key !== PLAN_STORAGE_KEY) return;
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
    onPlanChange,
  };
}

/**
 * One course token in the v2 hash grammar: `code[.version]` with an
 * optional prefix — `-` = dropped programme course, `+` = manual add, no
 * prefix = active (non-dropped) programme course.
 */
interface HashToken {
  code: string;
  version: string;
  source: CourseSource;
  dropped: boolean;
}

function parseHashToken(raw: string): HashToken | null {
  let rest = raw.trim();
  if (rest === "") return null;
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
  const [code = "", version = DEFAULT_VERSION] = rest.split(".");
  if (code === "") return null;
  return { code, version: version === "" ? DEFAULT_VERSION : version, source, dropped };
}

function formatHashToken(course: PlanCourse): string {
  const codeVersion =
    course.version === DEFAULT_VERSION ? course.code : `${course.code}.${course.version}`;
  if (course.source === "manual") return `+${codeVersion}`;
  if (course.dropped) return `-${codeVersion}`;
  return codeVersion;
}

/** One course as recovered from a hash: names are unknown from the hash alone (D15/§7). */
export interface HashCourse {
  code: string;
  version: string;
  source: CourseSource;
  dropped?: boolean;
}

export interface ParsedPlanHash {
  semesterId: string;
  /**
   * `null` when the hash carries no programme segment (`"-"`, or a legacy v1
   * hash). `direction` is the studieretning code only — its display name is
   * recovered from the study plan, exactly as the programme's own name is.
   */
  program: { code: string; cohort: number; direction: string | null } | null;
  courses: HashCourse[];
}

/**
 * Parse a plan hash into semester id + optional programme + courses.
 *
 * Accepts **both** grammars (D15 — v1-compat read, v2-only write):
 * - v2: `#v2;<semesterId>;<progCode.cohort or ->;<items>` where `items` is a
 *   comma list of `code[.version]` tokens, each optionally prefixed `-`
 *   (dropped programme course) or `+` (manual add); a bare token is an
 *   active programme course.
 * - v1 (legacy read-only): `#<semesterId>;<codes>` — no `v` token, bare
 *   comma-separated codes, upgraded in memory to `version: "1"`,
 *   `source: "manual"` (mirrors `coerceCourse`'s stored-state migration —
 *   a v1 hash predates the programme concept), no programme.
 *
 * Returns `null` for an empty/absent hash. Malformed course tokens are
 * dropped rather than failing the whole parse.
 */
export function parsePlanHash(hash: string): ParsedPlanHash | null {
  const trimmed = hash.replace(/^#/, "").trim();
  if (trimmed === "") return null;
  const segments = trimmed.split(";");

  if (segments[0] === "v2") {
    const semesterId = (segments[1] ?? "").trim();
    if (semesterId === "") return null;
    const progRaw = (segments[2] ?? "").trim();
    let program: ParsedPlanHash["program"] = null;
    if (progRaw !== "" && progRaw !== "-") {
      const [code = "", cohortRaw = "", directionRaw = ""] = progRaw.split(".");
      const cohort = Number(cohortRaw);
      if (code !== "" && Number.isFinite(cohort) && cohortRaw !== "") {
        program = { code, cohort, direction: directionRaw === "" ? null : directionRaw };
      }
    }
    const itemsRaw = segments[3] ?? "";
    const courses: HashCourse[] = [];
    for (const token of itemsRaw.split(",")) {
      const parsed = parseHashToken(token);
      if (!parsed) continue;
      const course: HashCourse = {
        code: parsed.code,
        version: parsed.version,
        source: parsed.source,
      };
      if (parsed.source === "program" && parsed.dropped) course.dropped = true;
      courses.push(course);
    }
    return { semesterId, program, courses };
  }

  // Legacy v1: "<semesterId>;<codes>" — no version token, bare codes, all manual.
  const [semesterPart = "", coursesPart = ""] = segments;
  const semesterId = semesterPart.trim();
  if (semesterId === "") return null;
  const courses: HashCourse[] = coursesPart
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "")
    .map((code) => ({ code, version: DEFAULT_VERSION, source: "manual" as const }));
  return { semesterId, program: null, courses };
}

/**
 * Format a plan into its v2 shareable hash form (D15 — no un-versioned
 * segment is ever written again), e.g.
 * `"#v2;26h;MTDT.2024.MTDTDS-24;TDT4100,TMA4100.2,-IT2805,+PSY1000"`.
 *
 * The programme segment is `code.cohort[.direction]`; the direction part is
 * appended only when one was chosen, so hashes written before studieretning
 * existed still parse (and still format) identically.
 */
export function formatPlanHash(
  plan: Pick<PlanState, "semesterId" | "courses" | "program">,
): string {
  const program = plan.program;
  const progSegment = program
    ? `${program.code}.${program.cohort}${program.direction ? `.${program.direction.code}` : ""}`
    : "-";
  const items = plan.courses.map(formatHashToken).join(",");
  return `#v2;${plan.semesterId};${progSegment};${items}`;
}
