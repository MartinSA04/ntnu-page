import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  activeCourses,
  createPlanStore,
  DEFAULT_VERSION,
  type EventTargetLike,
  formatPlanHash,
  PLAN_STORAGE_KEY,
  type PlanCourse,
  parsePlanHash,
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
    expect(store.loadPlan()).toEqual({ v: 1, semesterId: "26h", courses: [] });
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

  it("setSemester updates the semester id, preserving courses", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "A" });
    store.setSemester("27v");
    const plan = store.loadPlan();
    expect(plan.semesterId).toBe("27v");
    expect(plan.courses).toHaveLength(1);
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

  it("falls back to an empty plan for unparseable JSON in storage", () => {
    storage.setItem(PLAN_STORAGE_KEY, "{not json");
    const store = createPlanStore("26h", { storage, events });
    expect(store.loadPlan()).toEqual({ v: 1, semesterId: "26h", courses: [] });
  });

  it("falls back to an empty plan when the stored version is not 1", () => {
    storage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ v: 2, semesterId: "26h", courses: [] }));
    const store = createPlanStore("26h", { storage, events });
    expect(store.loadPlan()).toEqual({ v: 1, semesterId: "26h", courses: [] });
  });

  it("migrates a bare v1-shaped stored course ({code,name}, no version/source) to source:manual", () => {
    storage.setItem(
      PLAN_STORAGE_KEY,
      JSON.stringify({ v: 1, semesterId: "26h", courses: [{ code: "TDT4100", name: "A" }] }),
    );
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

  it("onPlanChange fires on cross-tab storage events for the plan key", () => {
    const store = createPlanStore("26h", { storage, events });
    const cb = vi.fn();
    store.onPlanChange(cb);
    storage.setItem(PLAN_STORAGE_KEY, JSON.stringify({ v: 1, semesterId: "26h", courses: [] }));
    events.dispatchEvent(fakeStorageEvent(PLAN_STORAGE_KEY));
    expect(cb).toHaveBeenCalledTimes(1);
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

describe("parsePlanHash / formatPlanHash — v2 grammar", () => {
  it("parses a v2 hash with semester, program, and mixed items", () => {
    const parsed = parsePlanHash("#v2;26h;MTDT.2024;TDT4100,TMA4100.2,-IT2805,+PSY1000");
    expect(parsed).toEqual({
      semesterId: "26h",
      program: { code: "MTDT", cohort: 2024, direction: null },
      courses: [
        { code: "TDT4100", version: "1", source: "program" },
        { code: "TMA4100", version: "2", source: "program" },
        { code: "IT2805", version: "1", source: "program", dropped: true },
        { code: "PSY1000", version: "1", source: "manual" },
      ],
    });
  });

  it('parses a v2 hash with no program ("-" segment)', () => {
    const parsed = parsePlanHash("#v2;26h;-;TDT4100");
    expect(parsed?.program).toBeNull();
    expect(parsed?.courses).toEqual([{ code: "TDT4100", version: "1", source: "program" }]);
  });

  it("parses a v2 hash with no items", () => {
    const parsed = parsePlanHash("#v2;26h;-;");
    expect(parsed).toEqual({ semesterId: "26h", program: null, courses: [] });
  });

  it("parses without the leading #", () => {
    const parsed = parsePlanHash("v2;26h;-;TDT4100");
    expect(parsed?.semesterId).toBe("26h");
  });

  it("drops empty/malformed course tokens", () => {
    const parsed = parsePlanHash("#v2;26h;-;TDT4100,,+ ,TMA4100");
    expect(parsed?.courses.map((c) => c.code)).toEqual(["TDT4100", "TMA4100"]);
  });

  it("returns null for an empty hash", () => {
    expect(parsePlanHash("")).toBeNull();
    expect(parsePlanHash("#")).toBeNull();
  });

  it("formats a full plan (program + drops + manual + non-default versions)", () => {
    const hash = formatPlanHash({
      semesterId: "26h",
      program: { code: "MTDT", name: "Datateknologi", cohort: 2024 },
      courses: [
        { code: "TDT4100", name: "A", version: "1", source: "program" },
        { code: "TMA4100", name: "B", version: "2", source: "program" },
        { code: "IT2805", name: "C", version: "1", source: "program", dropped: true },
        { code: "PSY1000", name: "D", version: "1", source: "manual" },
      ],
    });
    expect(hash).toBe("#v2;26h;MTDT.2024;TDT4100,TMA4100.2,-IT2805,+PSY1000");
  });

  it('formats a plan with no program as a "-" segment', () => {
    const hash = formatPlanHash({ semesterId: "26h", courses: [] });
    expect(hash).toBe("#v2;26h;-;");
  });

  it("appends the studieretning to the programme segment when one is chosen", () => {
    const hash = formatPlanHash({
      semesterId: "26h",
      program: {
        code: "MTDT",
        name: "Datateknologi",
        cohort: 2024,
        direction: { code: "MTDTDS-24", name: "Databaser og søk" },
      },
      courses: [{ code: "TDT4117", name: "A", version: "1", source: "program" }],
    });
    expect(hash).toBe("#v2;26h;MTDT.2024.MTDTDS-24;TDT4117");
  });

  it("parses the studieretning back out of the programme segment", () => {
    const parsed = parsePlanHash("#v2;26h;MTDT.2024.MTDTDS-24;TDT4117");
    expect(parsed?.program).toEqual({
      code: "MTDT",
      cohort: 2024,
      direction: "MTDTDS-24",
    });
  });

  it("still parses a programme segment written before studieretning existed", () => {
    const parsed = parsePlanHash("#v2;26h;MTDT.2024;TDT4100");
    expect(parsed?.program).toEqual({ code: "MTDT", cohort: 2024, direction: null });
  });

  it("round-trips format → parse for every field (program, drops, extras, non-default versions)", () => {
    const original: Parameters<typeof formatPlanHash>[0] = {
      semesterId: "27v",
      program: { code: "MTIOT", name: "Datateknologi", cohort: 2023 },
      courses: [
        { code: "TDT4110", name: "X", version: "1", source: "program" },
        { code: "TMA4115", name: "Y", version: "3", source: "program", dropped: true },
        { code: "IT3708", name: "Z", version: "1", source: "manual" },
      ],
    };
    const hash = formatPlanHash(original);
    const parsed = parsePlanHash(hash);
    expect(parsed).toEqual({
      semesterId: "27v",
      program: { code: "MTIOT", cohort: 2023, direction: null },
      courses: [
        { code: "TDT4110", version: "1", source: "program" },
        { code: "TMA4115", version: "3", source: "program", dropped: true },
        { code: "IT3708", version: "1", source: "manual" },
      ],
    });
  });

  it("round-trips an empty plan", () => {
    const hash = formatPlanHash({ semesterId: "26h", courses: [] });
    expect(parsePlanHash(hash)).toEqual({ semesterId: "26h", program: null, courses: [] });
  });
});

describe("parsePlanHash — legacy v1-compat read (D15)", () => {
  it("parses a legacy hash (no v token, bare codes) as all-manual, version 1, no program", () => {
    const parsed = parsePlanHash("#26h;TDT4100,TMA4100");
    expect(parsed).toEqual({
      semesterId: "26h",
      program: null,
      courses: [
        { code: "TDT4100", version: DEFAULT_VERSION, source: "manual" },
        { code: "TMA4100", version: DEFAULT_VERSION, source: "manual" },
      ],
    });
  });

  it("parses a legacy hash without the leading #", () => {
    expect(parsePlanHash("26h;TDT4100")?.courses).toEqual([
      { code: "TDT4100", version: "1", source: "manual" },
    ]);
  });

  it("parses a legacy semester with no courses", () => {
    expect(parsePlanHash("#26h;")).toEqual({ semesterId: "26h", program: null, courses: [] });
    expect(parsePlanHash("#26h")).toEqual({ semesterId: "26h", program: null, courses: [] });
  });

  it("drops empty course tokens in a legacy hash", () => {
    const parsed = parsePlanHash("#26h;TDT4100,,TMA4100");
    expect(parsed?.courses.map((c) => c.code)).toEqual(["TDT4100", "TMA4100"]);
  });

  it("never writes a legacy hash again: formatPlanHash always emits v2", () => {
    const hash = formatPlanHash({ semesterId: "26h", courses: [] });
    expect(hash.startsWith("#v2;")).toBe(true);
  });
});

describe("parsePlanHash / formatPlanHash — encoding and validation (B10)", () => {
  it("round-trips a direction code containing Ø", () => {
    // BSPL kull 2026 → "Bachelor i sykepleie (Gjøvik)". Written raw, the
    // browser handed the hash back percent-encoded, the direction lookup
    // missed, the campus question re-opened and the banner showed a machine
    // code — every Gjøvik/Ålesund campus split was affected.
    const plan = {
      semesterId: "26h",
      program: {
        code: "BSPL",
        name: "Sykepleie",
        cohort: 2026,
        direction: { code: "BSPL26-V-GJØVIK", name: "Gjøvik" },
      },
      courses: [],
    };
    const hash = formatPlanHash(plan);
    expect(hash).toBe("#v2;26h;BSPL.2026.BSPL26-V-GJ%C3%98VIK;");
    expect(parsePlanHash(hash)?.program).toEqual({
      code: "BSPL",
      cohort: 2026,
      direction: "BSPL26-V-GJØVIK",
    });
  });

  it("round-trips a programme code containing Ø and a literal slash", () => {
    const plan = {
      semesterId: "26h",
      program: { code: "MSØK/5", name: "Samfunnsøkonomi", cohort: 2024 },
      courses: [],
    };
    const parsed = parsePlanHash(formatPlanHash(plan));
    expect(parsed?.program?.code).toBe("MSØK/5");
  });

  it("round-trips a course code containing Ø", () => {
    const plan = {
      semesterId: "26h",
      courses: [
        { code: "BØA1100", name: "Bedriftsøkonomi", version: "1", source: "manual" as const },
      ],
    };
    const hash = formatPlanHash(plan);
    expect(hash).toBe("#v2;26h;-;+B%C3%98A1100");
    expect(parsePlanHash(hash)?.courses).toEqual([
      { code: "BØA1100", version: "1", source: "manual" },
    ]);
  });

  it("keeps the token prefixes and the field separator readable", () => {
    // encodeURIComponent leaves "." and "-" alone, which is what lets the
    // grammar's own punctuation survive the encoding.
    const hash = formatPlanHash({
      semesterId: "26h",
      program: { code: "MTDT", name: "Datateknologi", cohort: 2024 },
      courses: [
        { code: "TMA4100", name: "M1", version: "2", source: "program" as const },
        { code: "IT2805", name: "Web", version: "1", source: "program" as const, dropped: true },
      ],
    });
    expect(hash).toBe("#v2;26h;MTDT.2024;TMA4100.2,-IT2805");
  });

  it("rejects a programme segment whose cohort is not a plausible year", () => {
    // The grammar PRODUCT §7 used to document put *courses* in this slot;
    // feeding that form to the shipped parser produced {code:"TDT4100",
    // cohort:1}, a 400 from ?year=1 and a banner reading "TDT4100 · kull 1".
    const parsed = parsePlanHash("#v2;26h;TDT4100.1,TMA4100.1;IT2805.1");
    expect(parsed?.program).toBeNull();
    expect(parsed?.semesterId).toBe("26h");
  });

  it("rejects a cohort far in the future or before the university had plans", () => {
    expect(parsePlanHash("#v2;26h;MTDT.3025;")?.program).toBeNull();
    expect(parsePlanHash("#v2;26h;MTDT.1899;")?.program).toBeNull();
    expect(parsePlanHash("#v2;26h;MTDT.2026;")?.program).not.toBeNull();
  });

  it("ignores a hash written by a future grammar rather than half-reading it", () => {
    expect(parsePlanHash("#v3;26h;MTDT.2026;TDT4100")).toBeNull();
    // ...and does not mistake it for the legacy v1 form.
    expect(parsePlanHash("#v9;whatever")).toBeNull();
  });

  it("survives a hand-mangled percent escape instead of losing the whole plan", () => {
    const parsed = parsePlanHash("#v2;26h;-;+TDT4100,+B%ZZA1100");
    expect(parsed?.courses.map((c) => c.code)).toEqual(["TDT4100", "B%ZZA1100"]);
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
