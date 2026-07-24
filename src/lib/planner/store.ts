/**
 * Plan state + persistence (PLANNER.md §3). Storage and the change-event
 * target are injected so this module works in tests (and any non-DOM
 * context) without touching `window`/`localStorage` at import time.
 */

export const PLAN_STORAGE_KEY = "ntnu:plan:v1";
export const PLAN_CHANGE_EVENT = "ntnu:plan-change";

export interface PlanCourse {
  code: string;
  name: string;
}

export interface PlanProgram {
  code: string;
  name: string;
  cohort: number;
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
      if (
        typeof c === "object" &&
        c !== null &&
        typeof (c as Record<string, unknown>).code === "string" &&
        typeof (c as Record<string, unknown>).name === "string"
      ) {
        courses.push({ code: (c as PlanCourse).code, name: (c as PlanCourse).name });
      }
    }
  }

  const plan: PlanState = { v: 1, semesterId, courses };

  const rawProgram = obj.program;
  if (
    typeof rawProgram === "object" &&
    rawProgram !== null &&
    typeof (rawProgram as Record<string, unknown>).code === "string" &&
    typeof (rawProgram as Record<string, unknown>).name === "string" &&
    typeof (rawProgram as Record<string, unknown>).cohort === "number"
  ) {
    plan.program = rawProgram as PlanProgram;
  }

  return plan;
}

export interface PlanStore {
  loadPlan(): PlanState;
  savePlan(plan: PlanState): void;
  addCourse(course: PlanCourse): PlanState;
  removeCourse(code: string): PlanState;
  hasCourse(code: string): boolean;
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

  function addCourse(course: PlanCourse): PlanState {
    const plan = loadPlan();
    if (plan.courses.some((c) => c.code === course.code)) return plan;
    const next: PlanState = { ...plan, courses: [...plan.courses, course] };
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
    setSemester,
    setProgram,
    onPlanChange,
  };
}

/**
 * Parse a plan hash (`#26h;TDT4100,TMA4100`, course names unknown from the
 * hash alone — callers backfill names once course data is available) into
 * a semester id + course codes. Returns `null` for an empty/absent hash.
 * Malformed course-code tokens (empty after trim) are dropped.
 */
export function parsePlanHash(hash: string): { semesterId: string; codes: string[] } | null {
  const trimmed = hash.replace(/^#/, "").trim();
  if (trimmed === "") return null;
  const [semesterPart = "", coursesPart = ""] = trimmed.split(";");
  const semesterId = semesterPart.trim();
  if (semesterId === "") return null;
  const codes = coursesPart
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");
  return { semesterId, codes };
}

/** Format a plan into its shareable hash form, e.g. `"#26h;TDT4100,TMA4100"`. */
export function formatPlanHash(plan: Pick<PlanState, "semesterId" | "courses">): string {
  const codes = plan.courses.map((c) => c.code).join(",");
  return `#${plan.semesterId};${codes}`;
}
