import { afterEach, describe, expect, test } from "vitest";
import type { PlanCourseState } from "../../src/components/planner/types.js";
import { weekNotes } from "../../src/components/planner/weekNotes.js";
import {
  bundleFromEntries,
  type CourseBundle,
  type TimetableEntry,
} from "../../src/lib/planner/data.js";

/**
 * The margin, without a week to hang it on.
 *
 * `weekNotes` exists because the notes, the conflict count and the honest-gap
 * reporting are facts about the WEEK rather than about which way round it is
 * drawn. Before it, `plannerApp` obtained them by rendering a complete grid
 * into a detached host on every render.
 *
 * The shim below is the smallest thing `weekNotes` touches. It is not a DOM:
 * no layout, no CSS, no selector engine. It proves which nodes are built and
 * what they carry.
 */

class ShimEl {
  classes = new Set<string>();
  attrs = new Map<string, string>();
  children: (ShimEl | string)[] = [];
  text = "";
  open = false;
  constructor(readonly tagName: string) {}
  classList = {
    add: (...names: string[]) => {
      for (const n of names) this.classes.add(n);
    },
    remove: (...names: string[]) => {
      for (const n of names) this.classes.delete(n);
    },
  };
  style = {
    setProperty: () => {},
    removeProperty: () => {},
  };
  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }
  get textContent(): string {
    return this.children.length === 0
      ? this.text
      : this.children.map((c) => (typeof c === "string" ? c : c.textContent)).join("");
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string) {
    return this.attrs.get(name) ?? null;
  }
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  append(...nodes: (ShimEl | string)[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: (ShimEl | string)[]) {
    this.children = [...nodes];
  }
  listeners: (() => void)[] = [];
  addEventListener(_type: string, fn: () => void) {
    this.listeners.push(fn);
  }
  *walk(): Generator<ShimEl> {
    for (const child of this.children) {
      if (typeof child === "string") continue;
      yield child;
      yield* child.walk();
    }
  }
  find(className: string): ShimEl[] {
    return [...this.walk()].filter((n) => n.classes.has(className));
  }
}

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
});

function installShim(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const before = { document: g.document, matchMedia: g.matchMedia };
  g.document = { createElement: (tag: string) => new ShimEl(tag.toUpperCase()) };
  g.matchMedia = () => ({
    matches: false,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  uninstall = () => {
    g.document = before.document;
    g.matchMedia = before.matchMedia;
  };
}

const entry = (title: string | null, over: Partial<TimetableEntry> = {}): TimetableEntry => ({
  courseCode: "TMA4400",
  courseName: { nob: null, nno: null, eng: null },
  dayNumber: 1,
  startTime: "10:15",
  endTime: "12:00",
  weeks: ["34-47"],
  rooms: [],
  title,
  name: null,
  ...over,
});

const state = (over: Partial<PlanCourseState> & { code: string }): PlanCourseState => ({
  course: { code: over.code, name: `${over.code} emne`, version: "1", source: "manual" },
  hueVar: "--hue-1",
  bundle: null,
  loading: false,
  ...over,
});

/** A bundle whose timetable leg failed — what `fetchCourseBundle` returns on a 503. */
const failedBundle = (): CourseBundle => ({
  timetable: null,
  details: null,
  timetableOutcome: { kind: "failed", reason: "server", message: "NTNU svarte ikke" },
  failures: [{ part: "timetable", reason: "server", message: "NTNU svarte ikke", detail: "503" }],
  errors: ["timeplan: NTNU svarte ikke"],
});

function notesFor(
  courses: PlanCourseState[],
  showOthers = false,
  options: Parameters<typeof weekNotes>[3] = {},
) {
  installShim();
  const host = new ShimEl("DIV");
  const result = weekNotes(host as unknown as HTMLElement, courses, showOthers, options);
  return { host, result };
}

describe("weekNotes: the branch a week is in", () => {
  test("an empty plan is a message, not a week", () => {
    const { result } = notesFor([]);
    expect(result.state).toBe("empty");
    expect(result.message).toBe("Legg til emner for å se ukeplanen.");
  });

  test("a studieretning question outranks the canned recovery copy", () => {
    const { result } = notesFor([], false, { pendingChoiceMessage: "Velg studieretning." });
    expect(result.state).toBe("pending-choice");
    expect(result.message).toBe("Velg studieretning.");
  });

  test("a failed fetch outranks a question the student cannot answer with it", () => {
    // Order is load-bearing: pointing at the studieretning control over a dead
    // fetch sends the student to something that cannot fix the week.
    const { result } = notesFor([state({ code: "TMA4400", bundle: failedBundle() })], false, {
      pendingChoiceMessage: "Velg studieretning.",
    });
    expect(result.state).toBe("empty");
    expect(result.message).toBe("Fikk ikke hentet timeplan for TMA4400.");
  });

  test("a week with something to draw reports no message at all", () => {
    const { result } = notesFor([
      state({ code: "TMA4400", bundle: bundleFromEntries([entry("Forelesning")]) }),
    ]);
    expect(result.state).toBe("grid");
    expect(result.message).toBeNull();
  });
});

describe("weekNotes: what the verdict is allowed to claim", () => {
  test("a failed fetch makes the check partial and names the course", () => {
    const { result } = notesFor([
      state({ code: "TMA4400", bundle: bundleFromEntries([entry("Forelesning")]) }),
      state({ code: "TDT4120", bundle: failedBundle() }),
    ]);
    expect(result.incompleteCourses).toEqual(["TDT4120"]);
    expect(result.partial).toBe(true);
  });

  test("a three-way clash is one slot to fix, not three notes", () => {
    const clashing = ["TMA4400", "TDT4120", "TDT4100"].map((code) =>
      state({ code, bundle: bundleFromEntries([entry("Forelesning")]) }),
    );
    const { result } = notesFor(clashing);
    expect(result.conflictCount).toBe(1);
    expect(result.conflictPairCount).toBe(3);
  });

  test("a clean plan of one course claims nothing about anyone else", () => {
    const { result } = notesFor([
      state({ code: "TMA4400", bundle: bundleFromEntries([entry("Forelesning")]) }),
    ]);
    expect(result.conflictCount).toBe(0);
    expect(result.partial).toBe(false);
    expect(result.uncheckedCourses).toEqual([]);
  });
});

describe("weekNotes: a collision note is a control, and the caller owns its target", () => {
  /**
   * The note cannot flash the sessions itself: the nodes belong to whichever
   * view is mounted, which this module never sees. It hands the group back
   * instead. This is also the repair for a click that had been reaching
   * detached nodes ever since the planner started rendering its notes from a
   * throwaway grid.
   */
  test("clicking a collision note hands its group to the caller", () => {
    const seen: number[] = [];
    const clashing = ["TMA4400", "TDT4120"].map((code) =>
      state({ code, bundle: bundleFromEntries([entry("Forelesning")]) }),
    );
    const { host } = notesFor(clashing, false, {
      onConflictClick: (group) => seen.push(group.dayNumber),
    });
    const notes = host.find("planner-note-link");
    expect(notes).toHaveLength(1);
    for (const fn of notes[0]?.listeners ?? []) fn();
    expect(seen).toEqual([1]);
  });
});
