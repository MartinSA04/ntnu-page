import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlanStore,
  type EventTargetLike,
  formatPlanHash,
  PLAN_STORAGE_KEY,
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

  it("addCourse appends and persists", () => {
    const store = createPlanStore("26h", { storage, events });
    store.addCourse({ code: "TDT4100", name: "Objektorientert programmering" });
    expect(store.loadPlan().courses).toEqual([
      { code: "TDT4100", name: "Objektorientert programmering" },
    ]);
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
    expect(store.loadPlan().courses).toEqual([{ code: "TMA4100", name: "B" }]);
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
    expect(plan.courses).toEqual([{ code: "TDT4100", name: "A" }]);
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

  it("onPlanChange fires on same-tab saves via the custom event", () => {
    const store = createPlanStore("26h", { storage, events });
    const cb = vi.fn();
    const unsubscribe = store.onPlanChange(cb);
    store.addCourse({ code: "TDT4100", name: "A" });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0]?.[0]?.courses).toEqual([{ code: "TDT4100", name: "A" }]);
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

describe("parsePlanHash / formatPlanHash", () => {
  it("parses a semester + courses hash", () => {
    expect(parsePlanHash("#26h;TDT4100,TMA4100")).toEqual({
      semesterId: "26h",
      codes: ["TDT4100", "TMA4100"],
    });
  });

  it("parses without the leading #", () => {
    expect(parsePlanHash("26h;TDT4100")).toEqual({ semesterId: "26h", codes: ["TDT4100"] });
  });

  it("parses a semester with no courses", () => {
    expect(parsePlanHash("#26h;")).toEqual({ semesterId: "26h", codes: [] });
    expect(parsePlanHash("#26h")).toEqual({ semesterId: "26h", codes: [] });
  });

  it("returns null for an empty hash", () => {
    expect(parsePlanHash("")).toBeNull();
    expect(parsePlanHash("#")).toBeNull();
  });

  it("drops empty course tokens", () => {
    expect(parsePlanHash("#26h;TDT4100,,TMA4100")).toEqual({
      semesterId: "26h",
      codes: ["TDT4100", "TMA4100"],
    });
  });

  it("formats a plan into its hash form", () => {
    expect(
      formatPlanHash({
        semesterId: "26h",
        courses: [
          { code: "TDT4100", name: "A" },
          { code: "TMA4100", name: "B" },
        ],
      }),
    ).toBe("#26h;TDT4100,TMA4100");
  });

  it("formats a plan with no courses", () => {
    expect(formatPlanHash({ semesterId: "26h", courses: [] })).toBe("#26h;");
  });

  it("round-trips format → parse", () => {
    const original = {
      semesterId: "27v",
      courses: [
        { code: "TDT4110", name: "X" },
        { code: "TMA4115", name: "Y" },
      ],
    };
    const hash = formatPlanHash(original);
    const parsed = parsePlanHash(hash);
    expect(parsed).toEqual({
      semesterId: original.semesterId,
      codes: original.courses.map((c) => c.code),
    });
  });

  it("round-trips parse → format for codes (name-less)", () => {
    const parsed = parsePlanHash("#26h;TDT4100,TMA4100");
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const rebuilt = formatPlanHash({
      semesterId: parsed.semesterId,
      courses: parsed.codes.map((code) => ({ code, name: "" })),
    });
    expect(rebuilt).toBe("#26h;TDT4100,TMA4100");
  });
});
