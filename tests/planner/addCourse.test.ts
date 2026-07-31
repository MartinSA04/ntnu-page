/**
 * `addCourseRowControl` — the add-course modal's row logic, extracted so it is
 * testable without a DOM. Driven against a *real* plan store on in-memory
 * storage, so a mis-wired verb (calling `removeCourse` where `dropCourse`
 * belongs) fails here rather than in a browser. The rendering half is DOM and
 * is not covered here.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { addCourseRowControl } from "../../src/components/planner/addCourse.js";
import {
  createPlanStore,
  type EventTargetLike,
  type PlanStore,
  type StorageLike,
} from "../../src/lib/planner/store.js";

function fakeStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

function fakeEvents(): EventTargetLike {
  const target = new EventTarget();
  return {
    dispatchEvent: (e) => target.dispatchEvent(e),
    addEventListener: (type, listener) => target.addEventListener(type, listener),
    removeEventListener: (type, listener) => target.removeEventListener(type, listener),
  };
}

const TDT4109 = { code: "TDT4109", name: "Informasjonsteknologi, grunnkurs", version: "1" };

describe("addCourseRowControl", () => {
  let store: PlanStore;

  beforeEach(() => {
    store = createPlanStore("26h", { storage: fakeStorage(), events: fakeEvents() });
  });

  it("offers 'Legg til' for a course that is not in the plan, and adds it", () => {
    const control = addCourseRowControl(store, TDT4109);
    expect(control.label).toBe("Legg til");
    expect(control.state).toBe("");
    expect(control.stateKind).toBe("none");
    expect(control.ariaLabel).toContain("Legg til");

    expect(control.run()).toBe("TDT4109 lagt til i planen.");
    expect(store.loadPlan().courses).toEqual([
      { code: "TDT4109", name: TDT4109.name, version: "1", source: "manual" },
    ]);
  });

  it("offers 'Fjern' for a manual add, and deletes it outright", () => {
    store.addCourse(TDT4109);
    const control = addCourseRowControl(store, TDT4109);
    expect(control.label).toBe("Fjern");
    // DESIGN §7's mandated half of the pair, not "Lagt til ✓".
    expect(control.state).toBe("I planen");
    expect(control.stateKind).toBe("added");

    expect(control.run()).toBe("TDT4109 fjernet fra planen.");
    expect(store.loadPlan().courses).toEqual([]);
  });

  // /the modal called `removeCourse` regardless of source.
  it("offers 'Dropp' for a programme course, and drops rather than deletes it", () => {
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2026 }, [TDT4109]);
    const control = addCourseRowControl(store, TDT4109);
    expect(control.label).toBe("Dropp");
    expect(control.state).toBe("fra programmet");
    // 's CSS half: the tone split needs a hook CSS can select on.
    expect(control.stateKind).toBe("program");

    expect(control.run()).toBe("TDT4109 droppet, men fortsatt en del av programmet.");
    expect(store.loadPlan().courses).toEqual([
      { code: "TDT4109", name: TDT4109.name, version: "1", source: "program", dropped: true },
    ]);
  });

  // /the half that made the old bug invisible: a hard delete
  // left no `dropped` marker, so the next study-plan derive put the course
  // straight back with the credit total restored and no explanation.
  it("survives the next study-plan derive instead of silently reverting", () => {
    const program = { code: "MTDT", name: "Datateknologi", cohort: 2026 };
    store.setProgramPlan(program, [
      TDT4109,
      { code: "TMA4400", name: "Matematikk 1", version: "1" },
    ]);

    addCourseRowControl(store, TDT4109).run();
    // What plannerApp does on the next mount: re-derive the same period.
    store.setProgramPlan(program, [
      TDT4109,
      { code: "TMA4400", name: "Matematikk 1", version: "1" },
    ]);

    const entry = store.loadPlan().courses.find((c) => c.code === "TDT4109");
    expect(entry?.dropped).toBe(true);
    expect(addCourseRowControl(store, TDT4109).label).toBe("Legg tilbake");
  });

  // `hasCourse` reports a dropped course as present, so the row
  // asserted "Lagt til ✓" and its only control was inert.
  it("offers 'Legg tilbake' for a dropped programme course, and restores it", () => {
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2026 }, [TDT4109]);
    store.dropCourse("TDT4109");

    const control = addCourseRowControl(store, TDT4109);
    expect(control.label).toBe("Legg tilbake");
    expect(control.state).toBe("droppet");
    expect(control.stateKind).toBe("dropped");
    expect(control.state).not.toContain("Lagt til");

    expect(control.run()).toBe("TDT4109 lagt tilbake i planen.");
    expect(store.loadPlan().courses[0]?.dropped).toBeUndefined();
    expect(addCourseRowControl(store, TDT4109).label).toBe("Dropp");
  });

  it("round-trips drop → restore → drop without ever leaving the plan", () => {
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2026 }, [TDT4109]);
    for (let i = 0; i < 3; i++) {
      addCourseRowControl(store, TDT4109).run(); // Dropp
      expect(store.hasCourse("TDT4109")).toBe(true);
      addCourseRowControl(store, TDT4109).run(); // Legg tilbake
      expect(store.hasCourse("TDT4109")).toBe(true);
    }
    expect(store.loadPlan().courses).toHaveLength(1);
  });

  it("keeps the visible label inside the accessible name (2.5.3 label-in-name)", () => {
    store.setProgramPlan({ code: "MTDT", name: "Datateknologi", cohort: 2026 }, [TDT4109]);
    for (const step of [0, 1]) {
      const control = addCourseRowControl(store, TDT4109);
      expect(control.ariaLabel.startsWith(control.label)).toBe(true);
      expect(control.ariaLabel).toContain("TDT4109");
      if (step === 0) control.run();
    }
  });
});
