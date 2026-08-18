import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeCourses,
  createPlanStore,
  type EventTargetLike,
  LAST_SEMESTER_KEY,
  PLANS_STORAGE_KEY,
  type PlanCourse,
  PROFILE_STORAGE_KEY,
  type StorageLike,
} from "../../src/lib/planner/store.js";

/** In-memory `StorageLike` fake. */
function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

/** Minimal `EventTargetLike` fake backed by a real Node `EventTarget` (no DOM/jsdom in this test env). */
function fakeEvents(): EventTargetLike {
  const target = new EventTarget();
  return {
    dispatchEvent: (e) => target.dispatchEvent(e),
    addEventListener: (type, listener) => target.addEventListener(type, listener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener),
  };
}

/**
 * Stand-in for a `StorageEvent` (unavailable in vitest's default Node
 * environment — no jsdom dependency in this repo). `onPlanChange`'s handler
 * only reads `.key`, so a plain `Event` with that property attached
 * satisfies it structurally.
 */
function fakeStorageEvent(key: string | null): Event {
  const event = new Event("storage");
  Object.defineProperty(event, "key", { value: key });
  return event;
}

describe("createPlanStore", () => {
  let storage: StorageLike;
  let events: EventTargetLike;

  beforeEach(() => {
    storage = fakeStorage();
    events = fakeEvents();
  });

  it("does not throw when constructed with no options (guards non-DOM/global fallback)", () => {
    expect(() => createPlanStore("26h")).not.toThrow();
  });

  it("loadPlan defaults to an empty plan for the given semester when storage is empty", () => {
    const store = createPlanStore("26h", { storage, events });
    expect(store.loadPlan()).toEqual({ semesterId: "26h", courses: [] });
  });

  it("loadPlan reads the semester from np:lastSemester when present", () => {
    storage.setItem(LAST_SEMESTER_KEY, "27v");
    const store = createPlanStore("26h", { storage, events });
    expect(store.loadPlan().semesterId).toBe("27v");
  });

  /**
   * `hasAnyCourses` is the "has this person used the tool" question, and it is
   * a different question from `loadPlan()`'s. The planner's first-run screen
   * turns on it: a student sitting in a term they have not filled yet still has
   * a plan, and greeting them as a first-time visitor would hide the semester
   * control that is their way back to it.
   */
  describe("hasAnyCourses", () => {
    it("is false for empty storage", () => {
      expect(createPlanStore("26h", { storage, events }).hasAnyCourses()).toBe(false);
    });

    it("is false when every semester's list is empty", () => {
      storage.setItem(PLANS_STORAGE_KEY, JSON.stringify({ "26h": [], "27v": [] }));
      expect(createPlanStore("26h", { storage, events }).hasAnyCourses()).toBe(false);
    });

    it("is true for a course in ANOTHER semester than the current one", () => {
      storage.setItem(LAST_SEMESTER_KEY, "27v");
      storage.setItem(
        PLANS_STORAGE_KEY,
        JSON.stringify({ "26h": [{ code: "TDT4100", name: "OOP", version: "1" }], "27v": [] }),
      );
      const store = createPlanStore("26h", { storage, events });
      expect(store.loadPlan().courses).toEqual([]);
      expect(store.hasAnyCourses()).toBe(true);
    });

    it("goes false again once the last course anywhere is removed", () => {
      const store = createPlanStore("26h", { storage, events });
      store.addCourse({ code: "TDT4100", name: "OOP" });
      expect(store.hasAnyCourses()).toBe(true);
      store.removeCourse("TDT4100");
      expect(store.hasAnyCourses()).toBe(false);
    });

    it("survives a malformed payload rather than throwing", () => {
      storage.setItem(PLANS_STORAGE_KEY, "{not json");
      expect(createPlanStore("26h", { storage, events }).hasAnyCourses()).toBe(false);
    });
  });

  it("addCourse appends and persists, defaulting version and source", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "Objektorientert programmering" });
    expect(store.loadPlan().courses).toEqual([
      { code: "TDT4100", name: "Objektorientert programmering", version: "1", source: "manual" },
    ]);
  });

  it("addCourse honors an explicit version and source", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A", version: "2", source: "program" });
    expect(store.loadPlan().courses[0]).toEqual({
      code: "TDT4100",
      name: "A",
      version: "2",
      source: "program",
    });
  });

  it("addCourse dedupes by code", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A" });
    store.addCourse({ code: "TDT4100", name: "A duplicate" });
    expect(store.loadPlan().courses).toHaveLength(1);
  });

  it("removeCourse removes by code", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A" });
    store.addCourse({ code: "TMA4100", name: "B" });
    store.removeCourse("TDT4100");
    expect(store.loadPlan().courses.map((c) => c.code)).toEqual(["TMA4100"]);
  });

  it("removeCourse is a no-op for an absent code", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A" });
    store.removeCourse("NOPE0000");
    expect(store.loadPlan().courses).toHaveLength(1);
  });

  it("hasCourse reflects membership", () => {
    const store = createPlanStore("26h", { storage, events });
    expect(store.hasCourse("TDT4100")).toBe(false);
    store.addCourse({ code: "TDT4100", name: "A" });
    expect(store.hasCourse("TDT4100")).toBe(true);
  });

  it("setSemester updates the semester id, switching to that semester's own (here: empty) course list", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A" });
    store.setSemester("27v");
    const plan = store.loadPlan();
    expect(plan.semesterId).toBe("27v");
    expect(plan.courses).toHaveLength(0);
  });

  it("setProgram records program context", () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgram({ code: "MTDT", name: "Datateknologi", cohort: 2024 });
    expect(store.loadPlan().program).toEqual({ code: "MTDT", name: "Datateknologi", cohort: 2024 });
  });

  it("persists across store instances sharing the same storage (round trip)", () => {
    const storeA = createPlanStore("26h", { storage, events });
    storeA.addCourse({ code: "TDT4100", name: "A" });
    storeA.setProgram({ code: "MTDT", name: "Datateknologi", cohort: 2024 });

    const storeB = createPlanStore("26h", { storage, events: fakeEvents() });
    const plan = storeB.loadPlan();
    expect(plan.courses.map((c) => c.code)).toEqual(["TDT4100"]);
    expect(plan.program).toEqual({ code: "MTDT", name: "Datateknologi", cohort: 2024 });
  });

  it("falls back to an empty plan for unparseable JSON in the plans map", () => {
    storage.setItem(PLANS_STORAGE_KEY, "{not json");
    const store = createPlanStore("26h", { storage, events });
    expect(store.loadPlan()).toEqual({ semesterId: "26h", courses: [] });
  });

  it("falls back to no program for unparseable JSON in the profile", () => {
    storage.setItem(PROFILE_STORAGE_KEY, "{not json");
    const store = createPlanStore("26h", { storage, events });
    expect(store.loadPlan()).toEqual({ semesterId: "26h", courses: [] });
  });

  it("coerces a partial stored course ({code,name} only) by defaulting version and source", () => {
    storage.setItem(PLANS_STORAGE_KEY, JSON.stringify({ "26h": [{ code: "TDT4100", name: "A" }] }));
    const store = createPlanStore("26h", { storage, events });
    expect(store.loadPlan().courses).toEqual([
      { code: "TDT4100", name: "A", version: "1", source: "manual" },
    ]);
  });

  it("onPlanChange fires on same-tab saves via the custom event", () => {
    const store = createPlanStore("26h", { storage, events });
    const cb = vi.fn();
    const unsubscribe = store.onPlanChange(cb);
    store.addCourse({ code: "TDT4100", name: "A" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]?.courses[0]?.code).toBe("TDT4100");
    unsubscribe();
    store.addCourse({ code: "TMA4100", name: "B" });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("onPlanChange fires on cross-tab storage events for any of the three plan keys", () => {
    const store = createPlanStore("26h", { storage, events });
    const cb = vi.fn();
    store.onPlanChange(cb);
    events.dispatchEvent(fakeStorageEvent(PLANS_STORAGE_KEY));
    events.dispatchEvent(fakeStorageEvent(PROFILE_STORAGE_KEY));
    events.dispatchEvent(fakeStorageEvent(LAST_SEMESTER_KEY));
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("onPlanChange ignores storage events for unrelated keys", () => {
    const store = createPlanStore("26h", { storage, events });
    const cb = vi.fn();
    store.onPlanChange(cb);
    events.dispatchEvent(fakeStorageEvent("some:other:key"));
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("dropCourse / restoreCourse", () => {
  let storage: StorageLike;
  let events: EventTargetLike;

  beforeEach(() => {
    storage = fakeStorage();
    events = fakeEvents();
  });

  it("drops a programme course: stays listed, gains dropped:true", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A", source: "program" });
    store.dropCourse("TDT4100");
    const plan = store.loadPlan();
    expect(plan.courses).toHaveLength(1);
    expect(plan.courses[0]).toMatchObject({ code: "TDT4100", dropped: true });
  });

  it("restoreCourse clears the dropped flag", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A", source: "program" });
    store.dropCourse("TDT4100");
    store.restoreCourse("TDT4100");
    const plan = store.loadPlan();
    expect(plan.courses[0]?.dropped).toBeUndefined();
  });

  it("dropCourse is a no-op for a manual course (drop only applies to programme courses)", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "PSY1000", name: "A", source: "manual" });
    const before = store.loadPlan();
    store.dropCourse("PSY1000");
    expect(store.loadPlan()).toEqual(before);
  });

  it("dropCourse is a no-op for an absent code", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A", source: "program" });
    const before = store.loadPlan();
    store.dropCourse("NOPE0000");
    expect(store.loadPlan()).toEqual(before);
  });

  it("restoreCourse is a no-op for a course that isn't dropped", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A", source: "program" });
    const before = store.loadPlan();
    store.restoreCourse("TDT4100");
    expect(store.loadPlan()).toEqual(before);
  });

  it("dropCourse does not persist/dispatch when it's a no-op", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "PSY1000", name: "A", source: "manual" });
    const cb = vi.fn();
    store.onPlanChange(cb);
    store.dropCourse("PSY1000");
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("activeCourses", () => {
  it("excludes dropped courses", () => {
    const courses: PlanCourse[] = [
      { code: "A", name: "A", version: "1", source: "program" },
      { code: "B", name: "B", version: "1", source: "program", dropped: true },
      { code: "C", name: "C", version: "1", source: "manual" },
    ];
    expect(activeCourses({ courses }).map((c) => c.code)).toEqual(["A", "C"]);
  });

  it("returns [] for an all-dropped plan", () => {
    const courses: PlanCourse[] = [
      { code: "A", name: "A", version: "1", source: "program", dropped: true },
    ];
    expect(activeCourses({ courses })).toEqual([]);
  });

  it("returns [] for an empty plan", () => {
    expect(activeCourses({ courses: [] })).toEqual([]);
  });
});

describe("setProgramPlan", () => {
  let storage: StorageLike;
  let events: EventTargetLike;

  beforeEach(() => {
    storage = fakeStorage();
    events = fakeEvents();
  });

  it("replaces the programme course set and records the program", () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4100", name: "A" },
      { code: "TMA4100", name: "B" },
    ]);
    const plan = store.loadPlan();
    expect(plan.program).toEqual({ code: "MTDT", name: "Datateknologi", cohort: 2024 });
    expect(plan.courses).toEqual([
      { code: "TDT4100", name: "A", version: "1", source: "program" },
      { code: "TMA4100", name: "B", version: "1", source: "program" },
    ]);
  });

  it("preserves drops on codes that persist across a re-fetch", () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4100", name: "A" },
      { code: "TMA4100", name: "B" },
    ]);
    store.dropCourse("TDT4100");
    // Re-fetching the same plan (e.g. programme/kull re-selected) must not
    // silently un-drop TDT4100.
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4100", name: "A" },
      { code: "TMA4100", name: "B" },
    ]);
    const plan = store.loadPlan();
    expect(plan.courses.find((c) => c.code === "TDT4100")?.dropped).toBe(true);
    expect(plan.courses.find((c) => c.code === "TMA4100")?.dropped).toBeUndefined();
  });

  it("preserves a course's group selection across a re-fetch of the same programme set", () => {
    // A shared link's group pick on a programme course (or a student's own
    // parallel/øving choice) used to be dropped the moment the study plan
    // re-derived (B4/onPlanChange re-runs setProgramPlan with the same
    // codes) — the group showed on first paint, then vanished.
    const store = createPlanStore("26h", { storage, events });
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4100", name: "A" },
      { code: "TMA4100", name: "B" },
    ]);
    store.setCourseGroups("TDT4100", ["forelesningsparallell-2"]);
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4100", name: "A" },
      { code: "TMA4100", name: "B" },
    ]);
    const plan = store.loadPlan();
    expect(plan.courses.find((c) => c.code === "TDT4100")?.groups).toEqual([
      "forelesningsparallell-2",
    ]);
    expect(plan.courses.find((c) => c.code === "TMA4100")?.groups).toBeUndefined();
  });

  it("drops a code that no longer appears in the new programme set (silently, since it's gone)", () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4100", name: "A" },
    ]);
    store.dropCourse("TDT4100");
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TMA4100", name: "B" },
    ]);
    const plan = store.loadPlan();
    expect(plan.courses.map((c) => c.code)).toEqual(["TMA4100"]);
  });

  it("preserves every manual add untouched", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "PSY1000", name: "Manual", source: "manual" });
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4100", name: "A" },
    ]);
    const plan = store.loadPlan();
    expect(plan.courses.map((c) => c.code)).toEqual(["TDT4100", "PSY1000"]);
    expect(plan.courses.find((c) => c.code === "PSY1000")?.source).toBe("manual");
  });

  it("a second setProgramPlan call fully replaces the first programme set", () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4100", name: "A" },
      { code: "TMA4100", name: "B" },
    ]);
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2023 }, [
      { code: "TDT4110", name: "C" },
    ]);
    const plan = store.loadPlan();
    expect(plan.courses.map((c) => c.code)).toEqual(["TDT4110"]);
    expect(plan.program?.cohort).toBe(2023);
  });
});

describe("removeProgram", () => {
  let storage: StorageLike;
  let events: EventTargetLike;

  beforeEach(() => {
    storage = fakeStorage();
    events = fakeEvents();
  });

  /* Clearing the programme clears the PROFILE, and nothing else. This used to
     drop every programme-sourced course, which made "Lagre" in the studieinfo
     dialog the only control in the product that deleted a student's work
     without saying so — five prefilled rows, plus whatever groups had been
     chosen on them, gone with nothing to undo it with. */
  it("clears the programme profile and keeps every course, re-sourced as a manual add", () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4100", name: "A" },
      { code: "TMA4100", name: "B" },
    ]);
    store.addCourse({ code: "PSY1000", name: "Manual", source: "manual" });
    store.removeProgram();
    const plan = store.loadPlan();
    expect(plan.program).toBeUndefined();
    expect(plan.courses.map((c) => c.code)).toEqual(["TDT4100", "TMA4100", "PSY1000"]);
    expect(plan.courses.every((c) => c.source === "manual")).toBe(true);
  });

  /* And re-selecting the same programme afterwards does not double the rows:
     the survivors are manual now, and `setProgramPlan` dedupes by code with the
     programme entry winning. Without this the repair above would trade a silent
     deletion for a silent duplication. */
  it("re-selecting the same programme does not duplicate the courses it kept", () => {
    const store = createPlanStore("26h", { storage, events });
    const mtdt = { code: "MTDT", name: "Datateknologi", cohort: 2024 };
    store.setProgramPlan(mtdt, [{ code: "TDT4100", name: "A" }]);
    store.removeProgram();
    store.setProgramPlan(mtdt, [{ code: "TDT4100", name: "A" }]);
    const plan = store.loadPlan();
    expect(plan.courses.map((c) => c.code)).toEqual(["TDT4100"]);
    expect(plan.courses[0]?.source).toBe("program");
  });

  it("persists the cleared profile — a re-read store does not resurrect the program", () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgram({ code: "MTDT", name: "Datateknologi", cohort: 2024 });
    store.removeProgram();
    const reread = createPlanStore("26h", { storage, events: fakeEvents() });
    expect(reread.loadPlan().program).toBeUndefined();
  });

  it("dispatches a plan-change event carrying the program-less plan", () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgram({ code: "MTDT", name: "Datateknologi", cohort: 2024 });
    const cb = vi.fn();
    store.onPlanChange(cb);
    store.removeProgram();
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]?.program).toBeUndefined();
  });

  it("is why the program-less hash-load needs it: savePlan alone cannot clear a stale profile", () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgram({ code: "MTDT", name: "Datateknologi", cohort: 2024 });
    // A program-less `savePlan` (what a program-less shared hash writes) leaves
    // the stored profile untouched — `savePlan` only ever *writes* `np:profile`,
    // never clears it — so the header chip kept naming MTDT (finding 2).
    store.savePlan({
      semesterId: "26h",
      courses: [{ code: "TDT4100", name: "A", version: "1", source: "manual" }],
    });
    expect(store.loadPlan().program?.code).toBe("MTDT");
    // `removeProgram` is what actually clears it — the fix calls it in both
    // hash-load paths before writing the hash's own courses.
    store.removeProgram();
    expect(store.loadPlan().program).toBeUndefined();
  });
});

describe("semester-scoped plans", () => {
  it("a manual add in one semester does not leak into another", () => {
    const store = createPlanStore("26h", { storage: fakeStorage(), events: fakeEvents() });
    store.addCourse({ code: "IT2805", name: "Webteknologi" });
    store.setSemester("27v");
    expect(store.loadPlan().courses).toHaveLength(0);
    store.setSemester("26h");
    expect(store.loadPlan().courses.map((c) => c.code)).toEqual(["IT2805"]);
  });

  it("the programme profile is shared across semesters", () => {
    const store = createPlanStore("26h", { storage: fakeStorage(), events: fakeEvents() });
    store.setProgram({ code: "MTDT", name: "Datateknologi", cohort: 2024 });
    store.setSemester("27v");
    expect(store.loadPlan().program?.code).toBe("MTDT");
  });
});

describe("setCourseGroups", () => {
  it("sets, replaces and clears a course's group selection", () => {
    const store = createPlanStore("26h", { storage: fakeStorage(), events: fakeEvents() });
    store.addCourse({ code: "TDT4110", name: "ITGK" });
    expect(
      store.setCourseGroups("TDT4110", ["forelesningsparallell-2"]).courses[0]?.groups,
    ).toEqual(["forelesningsparallell-2"]);
    expect(store.setCourseGroups("TDT4110", []).courses[0]?.groups).toBeUndefined();
  });
});

describe("one entry per code (edit-1 / store-6)", () => {
  let storage: StorageLike;
  let events: EventTargetLike;

  beforeEach(() => {
    storage = fakeStorage();
    events = fakeEvents();
  });

  const MTDT = { code: "MTDT", name: "Datateknologi", cohort: 2026 };

  it("setProgramPlan does not store a manual add a second time as a programme course", () => {
    // Two ordinary clicks: add TDT4109 from its own page, then pick your
    // programme in studieinfo. The plan used to hold TDT4109 twice — "22,5 av
    // 30 sp" for 15 sp of courses and a red "samme dag" exam collision of the
    // course with itself.
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4109", name: "IT grunnkurs" });
    const plan = store.setProgramPlan(MTDT, [
      { code: "TDT4109", name: "IT grunnkurs", credits: 7.5 },
      { code: "TMA4100", name: "Matematikk 1", credits: 7.5 },
    ]);
    expect(plan.courses.map((c) => c.code)).toEqual(["TDT4109", "TMA4100"]);
    const codes = activeCourses(plan).map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("the programme entry wins the merge — it carries the study plan's credits and the drop semantics", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4109", name: "IT grunnkurs" });
    store.setProgramPlan(MTDT, [{ code: "TDT4109", name: "IT grunnkurs", credits: 7.5 }]);
    const course = store.loadPlan().courses[0];
    expect(course).toMatchObject({ source: "program", credits: 7.5 });
    // …and Dropp therefore works on it, with no manual twin left to keep
    // feeding the week and the exam list.
    store.dropCourse("TDT4109");
    expect(activeCourses(store.loadPlan())).toEqual([]);
  });

  it("the merge keeps the manual entry's group selection", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4109", name: "IT grunnkurs" });
    store.setCourseGroups("TDT4109", ["forelesningsparallell-2"]);
    store.setProgramPlan(MTDT, [{ code: "TDT4109", name: "IT grunnkurs", credits: 7.5 }]);
    expect(store.loadPlan().courses[0]).toMatchObject({
      source: "program",
      groups: ["forelesningsparallell-2"],
    });
  });

  it("repairs an already-duplicated stored plan on read (the programme entry wins)", () => {
    storage.setItem(
      PLANS_STORAGE_KEY,
      JSON.stringify({
        "26h": [
          { code: "TDT4109", name: "A", version: "1", source: "program", credits: 7.5 },
          { code: "TMA4100", name: "B", version: "1", source: "program" },
          { code: "TDT4109", name: "A", version: "1", source: "manual" },
        ],
      }),
    );
    const store = createPlanStore("26h", { storage, events });
    const courses = store.loadPlan().courses;
    expect(courses.map((c) => c.code)).toEqual(["TDT4109", "TMA4100"]);
    expect(courses[0]).toMatchObject({ source: "program", credits: 7.5 });
  });
});

describe("removeCourse is source-aware (store-3)", () => {
  let storage: StorageLike;
  let events: EventTargetLike;

  beforeEach(() => {
    storage = fakeStorage();
    events = fakeEvents();
  });

  it('"Fjern fra planen" on a programme course drops it instead of deleting it', () => {
    const store = createPlanStore("26h", { storage, events });
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2024 }, [
      { code: "TDT4136", name: "A" },
      { code: "TMA4135", name: "B" },
    ]);
    store.removeCourse("TDT4136");
    const plan = store.loadPlan();
    expect(plan.courses.map((c) => c.code)).toEqual(["TDT4136", "TMA4135"]);
    expect(plan.courses[0]?.dropped).toBe(true);
    expect(activeCourses(plan).map((c) => c.code)).toEqual(["TMA4135"]);
  });

  it("the removal survives the next study-plan derive instead of being resurrected un-dropped", () => {
    const program = { code: "MTDT", name: "Datateknologi", cohort: 2024 };
    const store = createPlanStore("26h", { storage, events });
    store.setProgramPlan(program, [
      { code: "TDT4136", name: "A" },
      { code: "TMA4135", name: "B" },
    ]);
    store.removeCourse("TDT4136");
    // What the planner does on its next mount (programDerivedFor starts null).
    store.setProgramPlan(program, [
      { code: "TDT4136", name: "A" },
      { code: "TMA4135", name: "B" },
    ]);
    expect(store.loadPlan().courses.find((c) => c.code === "TDT4136")?.dropped).toBe(true);
  });

  it("still deletes a manual add outright", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "PSY1000", name: "A" });
    store.removeCourse("PSY1000");
    expect(store.loadPlan().courses).toEqual([]);
  });

  it("does not persist/dispatch for an absent code", () => {
    const store = createPlanStore("26h", { storage, events });
    const cb = vi.fn();
    store.onPlanChange(cb);
    store.removeCourse("NOPE0000");
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("blocked or failing storage (store-1 / sec-2)", () => {
  /** A `StorageLike` whose reads and/or writes throw, like a denied `localStorage`. */
  function throwingStorage(mode: "read" | "write" | "both"): StorageLike {
    const map = new Map<string, string>();
    return {
      getItem: (key) => {
        if (mode !== "write") throw new Error("Access is denied for this document.");
        return map.get(key) ?? null;
      },
      setItem: (key, value) => {
        if (mode === "read") {
          map.set(key, value);
          return;
        }
        throw new Error("QuotaExceededError");
      },
    };
  }

  it("does not throw when window.localStorage access itself throws", () => {
    // Chrome "block all cookies" / a sandboxed embed: the *property access*
    // throws, which is why the nullStorage fallback never engaged and the
    // planner and every course page died to a blank shell.
    const deniedWindow = {
      get localStorage(): StorageLike {
        throw new Error("Access is denied for this document.");
      },
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
    vi.stubGlobal("window", deniedWindow);
    try {
      const store = createPlanStore("26h");
      expect(store.loadPlan()).toEqual({ semesterId: "26h", courses: [] });
      // …and the session still works, in memory.
      store.addCourse({ code: "TDT4100", name: "A" });
      expect(store.loadPlan().courses.map((c) => c.code)).toEqual(["TDT4100"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["read", "write", "both"] as const)(
    "degrades to an in-memory plan when storage throws on %s",
    (mode) => {
      const store = createPlanStore("26h", {
        storage: throwingStorage(mode),
        events: fakeEvents(),
      });
      expect(() => store.loadPlan()).not.toThrow();
      store.addCourse({ code: "TDT4100", name: "A", source: "program" });
      store.addCourse({ code: "TMA4100", name: "B" });
      store.dropCourse("TDT4100");
      const plan = store.loadPlan();
      expect(plan.courses.map((c) => c.code)).toEqual(["TDT4100", "TMA4100"]);
      expect(activeCourses(plan).map((c) => c.code)).toEqual(["TMA4100"]);
    },
  );

  it("savePlan does not throw when the write fails", () => {
    const store = createPlanStore("26h", {
      storage: throwingStorage("write"),
      events: fakeEvents(),
    });
    expect(() =>
      store.savePlan({
        semesterId: "26h",
        courses: [{ code: "TDT4100", name: "A", version: "1", source: "manual" }],
      }),
    ).not.toThrow();
  });
});

describe("code-shape validation (sec-1)", () => {
  it("drops an already-poisoned profile and course list on read", () => {
    const storage = fakeStorage();
    storage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        program: { code: "Ring 800 12 345", name: "Ring 800 12 345", cohort: 2024 },
      }),
    );
    storage.setItem(
      PLANS_STORAGE_KEY,
      JSON.stringify({
        "26h": [
          { code: "Ring 800 12 345", name: "x", version: "1", source: "manual" },
          { code: "TDT4100", name: "A", version: "1", source: "manual" },
        ],
      }),
    );
    const store = createPlanStore("26h", { storage, events: fakeEvents() });
    const plan = store.loadPlan();
    expect(plan.program).toBeUndefined();
    expect(plan.courses.map((c) => c.code)).toEqual(["TDT4100"]);
  });

  it("keeps a stored direction that is a real code", () => {
    const storage = fakeStorage();
    storage.setItem(
      PROFILE_STORAGE_KEY,
      JSON.stringify({
        program: {
          code: "BSPL",
          name: "Sykepleie",
          cohort: 2026,
          direction: { code: "BSPL26-V-GJØVIK", name: "Gjøvik" },
        },
      }),
    );
    const store = createPlanStore("26h", { storage, events: fakeEvents() });
    expect(store.loadPlan().program?.direction?.code).toBe("BSPL26-V-GJØVIK");
  });
});

describe("credits carried into the plan (B9.1)", () => {
  // MTKJ kull 2026 rendered "15 av 30 sp (+2 emner uten oppgitt sp)" because
  // TMA4101 and TMT4115 are absent from the catalog — while the study plan
  // response the prefill was built from gave both 7,5.
  let creditStorage: StorageLike;
  let creditStore: ReturnType<typeof createPlanStore>;

  beforeEach(() => {
    creditStorage = fakeStorage();
    creditStore = createPlanStore("26h", { storage: creditStorage, events: fakeEvents() });
  });

  it("addCourse persists the study plan's credit figure", () => {
    creditStore.addCourse({ code: "TMA4101", name: "Matematikk 2", credits: 7.5 });
    expect(creditStore.loadPlan().courses[0]?.credits).toBe(7.5);
  });

  it("addCourse leaves credits absent when the caller has none", () => {
    creditStore.addCourse({ code: "TDT4100", name: "OOP" });
    expect(creditStore.loadPlan().courses[0]?.credits).toBeUndefined();
  });

  it("setProgramPlan carries credits for every programme course", () => {
    creditStore.setProgramPlan({ code: "MTKJ", name: "Kjemi", cohort: 2026 }, [
      { code: "TMA4101", name: "Matematikk 2", credits: 7.5 },
      { code: "TMT4115", name: "Generell kjemi", credits: 7.5 },
    ]);
    expect(creditStore.loadPlan().courses.map((c) => c.credits)).toEqual([7.5, 7.5]);
  });

  it("survives the storage round trip", () => {
    creditStore.addCourse({ code: "TMA4101", name: "Matematikk 2", credits: 7.5 });
    const reread = createPlanStore("26h", { storage: creditStorage, events: fakeEvents() });
    expect(reread.loadPlan().courses[0]?.credits).toBe(7.5);
  });

  it("keeps credits and the drop flag across a re-fetch of the same programme set", () => {
    const program = { code: "MTKJ", name: "Kjemi", cohort: 2026 };
    creditStore.setProgramPlan(program, [{ code: "TMA4101", name: "Matematikk 2", credits: 7.5 }]);
    creditStore.dropCourse("TMA4101");
    creditStore.setProgramPlan(program, [{ code: "TMA4101", name: "Matematikk 2", credits: 7.5 }]);
    expect(creditStore.loadPlan().courses[0]).toMatchObject({ credits: 7.5, dropped: true });
  });
});

/**
 * The `#v2;…` grammar is gone, superseded by `/user/<navn>` (spec §5). Nothing
 * was ever sent through it — the project has never been connected to
 * Cloudflare — so there is no back-compat shim to keep alive.
 */
describe("the plan hash is gone", () => {
  it("exports no hash grammar", async () => {
    const store = await import("../../src/lib/planner/store.js");
    expect("parsePlanHash" in store).toBe(false);
    expect("formatPlanHash" in store).toBe(false);
  });

  it("leaves no hash handling in the planner", () => {
    // Comments stripped: the file carries tombstones saying what was deleted
    // and why, which is exactly the prose this asserts on.
    const source = readFileSync("src/components/planner/plannerApp.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "");
    expect(source).not.toMatch(/hashchange/);
    expect(source).not.toMatch(/replacedPlan/);
    expect(source).not.toMatch(/withStoredFacts/);
    expect(source).not.toMatch(/syncHash/);
  });
});
