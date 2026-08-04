/**
 * Plan state + persistence (PRODUCT.md §6 for the shape and the hash grammar,
 * §1 for the mandate the drop/restore semantics come from). Storage and the
 * change-event target are injected so this works in non-DOM contexts.
 *
 * Courses carry `source` (programme pre-fill or manual add) and, for programme
 * courses only, `dropped` — grays out, one tap restores, excluded from
 * schedule/credits (PRODUCT §1.3). Removing a manual add deletes it outright.
 *
 * Storage is split three ways: the programme choice is global (it survives a
 * semester switch), the course list is scoped per semester.
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
   * Credits as the *study plan* stated them. Live `details().credits` wins when
   * it arrives; this is the fallback for the 39 of 1 383 period-1 obligatory
   * references absent from the catalog. `null`/absent = unknown.
   */
  credits?: number | null;
  /**
   * Only meaningful for `source: "program"`: the student dropped this course —
   * still listed, excluded from schedule and credits. Manual adds are never
   * `dropped`; removing one deletes it.
   */
  dropped?: boolean;
  /** Selected group keys (which parallell/øvingsgruppe). Absent = defaults. */
  groups?: string[];
}

/**
 * The studieretning picked at a `Valg av studieretning` waypoint. Later-year
 * sivilingeniør periods carry no top-level courses, so this is what turns the
 * study plan from a choice space into a concrete course list.
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
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    // With cookies blocked, in a sandboxed embed, or in a webview with DOM
    // storage off, the *property access itself* throws (SecurityError).
    return undefined;
  }
}

function defaultEvents(): EventTargetLike | undefined {
  return typeof window !== "undefined" ? window : undefined;
}

/**
 * Wraps a backing storage so a denied or failing one degrades to an in-memory
 * plan for the session instead of throwing. Every write is mirrored into the
 * map and the backing store is abandoned the first time it throws, so the plan
 * still loads, adds, drops and shares — it just stops surviving a reload.
 */
function resilientStorage(backing: StorageLike | undefined): StorageLike {
  const memory = new Map<string, string>();
  let live = backing;
  return {
    getItem(key) {
      if (live) {
        try {
          const value = live.getItem(key);
          if (value !== null) return value;
        } catch {
          live = undefined;
        }
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      if (!live) return;
      try {
        live.setItem(key, value);
      } catch {
        live = undefined;
      }
    },
  };
}

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

/**
 * What a course or programme code may look like. All 5 470 course codes and
 * 403 programme codes fit within 16 characters (`EMNE/HF`, `MSECT+OH`,
 * `MSØK/5` are why `/` and `+` are here). Studieretning codes run to 20.
 *
 * Untrusted input reaches both: a shared plan hash could write any text into
 * `np:profile` as a programme "code", which every surface reading the profile
 * then repeated for the rest of the visit. The same guard runs on read, so an
 * already-poisoned profile is dropped rather than rendered.
 */
const CODE_PATTERN = /^[A-ZÆØÅ0-9_+/-]{2,16}$/i;
const DIRECTION_PATTERN = /^[A-ZÆØÅ0-9_+/-]{2,32}$/i;

/** Narrows an untrusted JSON value to a plain object, or `null`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Type-guards one course out of untrusted JSON, rebuilding it field-by-field
 * and defaulting `version`/`source` for a bare `{code, name}`.
 */
function coerceCourse(raw: unknown): PlanCourse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.code !== "string" || typeof obj.name !== "string") return null;
  if (!CODE_PATTERN.test(obj.code)) return null;

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
    !CODE_PATTERN.test(rawProgram.code) ||
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
  if (
    rawDirection &&
    typeof rawDirection.code === "string" &&
    DIRECTION_PATTERN.test(rawDirection.code)
  ) {
    program.direction = {
      code: rawDirection.code,
      name: typeof rawDirection.name === "string" ? rawDirection.name : rawDirection.code,
    };
  }
  return { program };
}

/**
 * Enforces the one-entry-per-code invariant. When a code appears twice the
 * `source: "program"` entry wins — it carries the study plan's credits and the
 * Dropp/Legg tilbake semantics — and inherits the loser's group selection when
 * it has none of its own. Otherwise the first entry wins.
 *
 * Two ordinary clicks break this (add a course from its page, then pick your
 * programme), so it is enforced here on read and on every write rather than in
 * the callers that kept forgetting it.
 */
function dedupeByCode(courses: PlanCourse[]): PlanCourse[] {
  const byCode = new Map<string, PlanCourse>();
  for (const course of courses) {
    const existing = byCode.get(course.code);
    if (!existing) {
      byCode.set(course.code, course);
      continue;
    }
    const winner = existing.source === "program" ? existing : course;
    const loser = winner === existing ? course : existing;
    const merged: PlanCourse = { ...winner };
    if (!merged.groups?.length && loser.groups?.length) merged.groups = loser.groups;
    byCode.set(course.code, merged);
  }
  return [...byCode.values()];
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
    // Repairs a plan already written twice by an older build, too.
    result[semesterId] = dedupeByCode(courses);
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
  /**
   * Does this student hold any course in ANY semester?
   *
   * `loadPlan()` answers for the current term only, which is the right scope
   * for the week but the wrong one for "has this person used the tool" — a
   * manual add sitting in another semester is still a plan.
   */
  hasAnyCourses(): boolean;
  onPlanChange(cb: (plan: PlanState) => void): () => void;
}

/**
 * Builds a plan store bound to injected (or default global) storage/events.
 * Reads are always fresh from storage so multiple stores/tabs stay consistent.
 * Safe at module load in a non-DOM context, and where storage is denied or
 * full: both degrade to an in-memory plan plus no-op events.
 */
export function createPlanStore(
  defaultSemesterId: string,
  options: PlanStoreOptions = {},
): PlanStore {
  const storage = resilientStorage(options.storage ?? defaultStorage());
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

  /** See `PlanStore.hasAnyCourses`. */
  function hasAnyCourses(): boolean {
    return Object.values(readPlans()).some((list) => list.length > 0);
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

  /**
   * "Fjern fra planen". A manual add is spliced out; a `source: "program"`
   * course is *dropped* instead — hard-deleting one looked like it worked and
   * was silently undone by the next study-plan derive. The store decides the
   * verb so every call site agrees by construction.
   */
  function removeCourse(code: string): PlanState {
    const plan = loadPlan();
    const target = plan.courses.find((c) => c.code === code);
    if (!target) return plan;
    if (target.source === "program") return dropCourse(code);
    const next: PlanState = { ...plan, courses: plan.courses.filter((c) => c.code !== code) };
    savePlan(next);
    return next;
  }

  function hasCourse(code: string): boolean {
    return loadPlan().courses.some((c) => c.code === code);
  }

  /**
   * Marks a programme course dropped. No-op for a manual course or an absent
   * code — dropping only ever applies to `source: "program"`.
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
   * Replaces the plan's `source: "program"` course set, preserving across the
   * replacement: (a) `dropped` on any persisting code, so re-picking the same
   * programme does not un-drop something; (b) `groups` on any persisting code,
   * so a parallel/øving pick survives a re-derive; (c) every `source: "manual"`
   * course the prefill does not itself contain — a code in both is one course,
   * collapsed onto the programme entry by `dedupeByCode`.
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
    const next: PlanState = { ...plan, program, courses: dedupeByCode([...program_, ...manual]) };
    savePlan(next);
    return next;
  }

  /**
   * Switches the active semester: the current courses are persisted under the
   * semester they belong to first, then the target's own list is loaded. Manual
   * adds stay in the semester they were added to. The profile is global.
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
   * Clears the programme profile and re-derives. `savePlan` can only ever
   * *write* a profile — it skips the key when `program` is undefined — so the
   * key is reset directly here, then the pruned course list goes through the
   * normal save path.
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
   * Subscribes to plan changes: same-tab saves (custom event) and cross-tab
   * saves (native `storage` event on any plan key). Returns an unsubscribe.
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
    hasAnyCourses,
    onPlanChange,
  };
}
