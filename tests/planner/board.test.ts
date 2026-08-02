import { afterEach, describe, expect, test } from "vitest";
import { isRoomCode, renderBoard } from "../../src/components/planner/board.js";
import type { PlanCourseState } from "../../src/components/planner/types.js";
import { bundleFromEntries, type TimetableEntry } from "../../src/lib/planner/data.js";

/**
 * Tavla's DOM half. Like `grid.test.ts` this runs in vitest's default Node
 * environment — the repo ships no jsdom and does not want one — so the shim
 * below is the smallest thing `renderBoard` actually touches. It is not a DOM:
 * no layout, no CSS, no selector engine. It proves which nodes are built and
 * what they carry.
 *
 * What it is here for: `data-motion-key`. The layer change
 * matches a row across a re-render by that key alone, so a key that shifts
 * when the øving layer arrives would make every row a newcomer and turn the
 * toggle back into the full redraw it replaced. That is not visible in a
 * screenshot and not covered by the e2e suite, which asserts on text.
 */

class ShimEl {
  classes = new Set<string>();
  attrs = new Map<string, string>();
  props = new Map<string, string>();
  children: ShimEl[] = [];
  text = "";
  type = "";
  constructor(readonly tagName: string) {}
  classList = {
    add: (...names: string[]) => {
      for (const n of names) this.classes.add(n);
    },
  };
  style = {
    setProperty: (name: string, value: string) => {
      this.props.set(name, value);
    },
  };
  set className(value: string) {
    this.classes = new Set(value.split(/\s+/).filter(Boolean));
  }
  get textContent(): string {
    return this.children.length === 0
      ? this.text
      : this.children.map((c) => c.textContent).join("");
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
  append(...nodes: (ShimEl | string)[]) {
    for (const node of nodes) {
      if (typeof node === "string")
        this.children.push(Object.assign(new ShimEl("#text"), { text: node }));
      else this.children.push(node);
    }
  }
  replaceChildren(...nodes: ShimEl[]) {
    this.children = [...nodes];
  }
  addEventListener() {}
  *walk(): Generator<ShimEl> {
    for (const child of this.children) {
      yield child;
      yield* child.walk();
    }
  }
  find(className: string): ShimEl[] {
    return [...this.walk()].filter((n) => n.classes.has(className));
  }
}

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

const entry = (title: string, over: Partial<TimetableEntry> = {}): TimetableEntry => ({
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

/** Renders one plan into a fresh host and hands back the host. */
function draw(courses: PlanCourseState[], showOthers: boolean): ShimEl {
  const g = globalThis as unknown as Record<string, unknown>;
  const before = { document: g.document, button: g.HTMLButtonElement };
  g.document = { createElement: (tag: string) => new ShimEl(tag.toUpperCase()) };
  // `buildRow` narrows with `row instanceof HTMLButtonElement` before setting
  // `type`. Nothing here is one — this render gets no click handler, so every
  // row is a `div` — but the constructor still has to exist to be asked about.
  g.HTMLButtonElement = class {};
  restore = () => {
    g.document = before.document;
    g.HTMLButtonElement = before.button;
  };
  const host = new ShimEl("DIV");
  renderBoard(host as unknown as HTMLElement, courses, [34, 35], showOthers);
  return host;
}

const keysOf = (host: ShimEl): string[] =>
  [...host.walk()]
    .map((n) => n.getAttribute("data-motion-key"))
    .filter((k): k is string => k !== null);

describe("isRoomCode", () => {
  test("a room code is set as a figure; a sentence is not", () => {
    expect(isRoomCode("R1")).toBe(true);
    expect(isRoomCode("EL5")).toBe(true);
    expect(isRoomCode("Digital undervisning")).toBe(false);
    expect(isRoomCode("Realfagbygget A")).toBe(false);
  });

  test("punctuation does not make a code a sentence", () => {
    // A4-156 is a real Realfagbygget room — where TDT4120's øvingsveiledning
    // sits five days a week — and a letters-then-digits shape test demoted it
    // to the small style meant for "Digital undervisning", purely for the
    // hyphen. What separates a code from a sentence is whitespace and a digit.
    expect(isRoomCode("A4-156")).toBe(true);
    expect(isRoomCode("KJL1")).toBe(true);
    // Still not a code: no digit, or long enough to be prose.
    expect(isRoomCode("Auditorium")).toBe(false);
    expect(isRoomCode("Gløshaugen/12")).toBe(false);
  });
});

describe("data-motion-key (the layer-motion contract, DESIGN §7)", () => {
  // One lecture and one øving group. A course offering exactly ONE non-lecture
  // group counts as picked, which is what puts the øving in the list at all
  // when the layer is revealed.
  const courses = [
    state({
      code: "TMA4400",
      bundle: bundleFromEntries([
        entry("Forelesning"),
        entry("Øving gruppe 1", { dayNumber: 2, startTime: "14:15", endTime: "16:00" }),
      ]),
    }),
  ];

  test("a lecture's key survives the øving layer arriving", () => {
    const quiet = keysOf(draw(courses, false));
    const full = keysOf(draw(courses, true));
    const lecture = "TMA4400|1|10:15|12:00|Forelesning#0";
    expect(quiet).toContain(lecture);
    expect(full).toContain(lecture);
    // Every SESSION the quiet render listed is still there under the same
    // name. Tuesday's "Ingen undervisning" is not, and should not be: the
    // øving took its place, so it genuinely leaves and gets a ghost.
    const sessions = (keys: string[]) => keys.filter((k) => k.includes("|"));
    expect(sessions(full)).toEqual(expect.arrayContaining(sessions(quiet)));
    expect(sessions(full).length).toBe(sessions(quiet).length + 1);
    expect(quiet).toContain("free-2");
    expect(full).not.toContain("free-2");
  });

  test("every key is unique, so two rows can never claim the same identity", () => {
    // Identical parallels at the same hour are what the occurrence index is
    // for: EXPH0300 publishes several, and a shared key would make one row
    // travel to the other's place.
    const twins = [
      state({
        code: "EXPH0300",
        bundle: bundleFromEntries([entry("Forelesning"), entry("Forelesning")]),
      }),
    ];
    const keys = keysOf(draw(twins, false));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("day heads are keyed too — they move as much as the rows do", () => {
    expect(keysOf(draw(courses, false))).toContain("day-1");
  });
});
