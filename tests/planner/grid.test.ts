import { afterEach, describe, expect, test } from "vitest";
import {
  metaLine,
  pileSummary,
  planGaps,
  renderGrid,
  unresolvedLectureChoices,
  visibleLayer,
} from "../../src/components/planner/grid.js";
import type { PlanCourseState } from "../../src/components/planner/types.js";
import {
  bundleFromEntries,
  type CourseBundle,
  type TimetableEntry,
} from "../../src/lib/planner/data.js";

/**
 * The pure half of the week grid. `renderGrid` itself needs a DOM (this suite
 * runs in vitest's default Node environment — the repo has no jsdom), so the
 * rules it composes are exported and tested here; the DOM assembly around
 * them is covered by `e2e/flows.pw.ts`.
 */

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

describe("visibleLayer (ux-fail-1)", () => {
  const lecture = { isLecture: true, groupPicked: false };
  const unpicked = { isLecture: false, groupPicked: false };
  const picked = { isLecture: false, groupPicked: true };

  test("lecture-only by default (DR-1)", () => {
    const r = visibleLayer([lecture, unpicked, picked], false);
    expect(r.shown).toEqual([lecture]);
    expect(r.mutedLayerAutoRevealed).toBe(false);
  });

  test("with the toggle on, only PICKED øving groups join (the EXPH0300 flood guard)", () => {
    const r = visibleLayer([lecture, unpicked, picked], true);
    expect(r.shown).toEqual([lecture, picked]);
    expect(r.mutedLayerAutoRevealed).toBe(false);
  });

  test("a course with no lecture-classified entry and NO pick still draws (B7a)", () => {
    // BI1006: 11 real entries, every title classified "other", 7 groups, none
    // picked. The auto-reveal fired and the pick filter then removed every
    // entry it had just revealed — a blank week under "ingen kollisjoner".
    const r = visibleLayer([unpicked, unpicked, unpicked], false);
    expect(r.mutedLayerAutoRevealed).toBe(true);
    expect(r.shown).toHaveLength(3);
  });

  test("an empty week is not an auto-reveal", () => {
    expect(visibleLayer([], false)).toEqual({ shown: [], mutedLayerAutoRevealed: false });
  });
});

describe("planGaps (pc-3, ux-4)", () => {
  test("a failed fetch is a gap in the ANSWER, not an empty course", () => {
    const gaps = planGaps([state({ code: "TMA4400", bundle: failedBundle() })]);
    expect(gaps.failed).toEqual(["TMA4400"]);
    expect(gaps.empty).toEqual([]);
    expect(gaps.offSemester).toEqual([]);
  });

  test("a hand-built bundle with a null timetable is still classified failed", () => {
    // `courseTimetable.ts` builds bundles by hand and carries no outcome;
    // `timetableOutcomeOf` derives one rather than reading `timetable` here.
    const bundle: CourseBundle = { timetable: null, details: null, errors: [] };
    expect(planGaps([state({ code: "IT2805", bundle })]).failed).toEqual(["IT2805"]);
  });

  test("NTNU publishing zero rows is a different sentence from a failed fetch", () => {
    // TMA4135: /api/course/TMA4135/timetable?year=2026 returns exactly [].
    const gaps = planGaps([state({ code: "TMA4135", bundle: bundleFromEntries([]) })]);
    expect(gaps.empty).toEqual(["TMA4135"]);
    expect(gaps.failed).toEqual([]);
  });

  test("entries that exist but not in this semester keep the FETCH's outcome", () => {
    // The exact clone plannerApp makes: the narrowed array is empty, the
    // outcome still says "entries". Recomputing the outcome from the array
    // would turn "undervises ikke i valgt semester" into "fikk ikke hentet".
    const fetched = bundleFromEntries([entry("Forelesning"), entry("Forelesning")]);
    const narrowed: CourseBundle = { ...fetched, timetable: [] };
    const gaps = planGaps([state({ code: "TMA4135", bundle: narrowed })]);
    expect(gaps.offSemester).toEqual(["TMA4135"]);
    expect(gaps.empty).toEqual([]);
    expect(gaps.failed).toEqual([]);
  });

  test("a fetch in flight is no gap; one that was never made is", () => {
    expect(planGaps([state({ code: "TDT4109", loading: true })]).pending).toEqual([]);
    expect(planGaps([state({ code: "TDT4109", loading: false })]).pending).toEqual(["TDT4109"]);
  });

  test("a course that renders normally produces no gap at all", () => {
    const gaps = planGaps([
      state({ code: "TDT4109", bundle: bundleFromEntries([entry("Forelesning")]) }),
    ]);
    expect(gaps).toEqual({ failed: [], pending: [], empty: [], offSemester: [] });
  });
});

describe("unresolvedLectureChoices (edit-4, ux-1)", () => {
  // Live TMA4400: "MTIØT" is named on three "Forelesning 1 …" clusters and
  // five "Forelesning 2 …" ones, so the programme filter narrows nothing and
  // the week drew nine blocks with no note.
  const tma4400 = [
    entry("Forelesning 1 MTBYGG, MTING, MTIØT", { studyProgramKeys: ["MTIØT"] }),
    entry("Forelesning 1 MTDT, MTIØT, MTKOM", { studyProgramKeys: ["MTIØT"], dayNumber: 2 }),
    entry("Forelesning 2 MTIØT, MTKOM, MTDT", { studyProgramKeys: ["MTIØT"], dayNumber: 4 }),
    entry("Forelesning 2 MTBYGG, MTIØT", { studyProgramKeys: ["MTIØT"], dayNumber: 3 }),
  ];

  test("an unresolved parallel gets a note naming how many alternatives there are", () => {
    const choices = unresolvedLectureChoices(
      [
        state({
          code: "TMA4400",
          programCode: "MTIØT",
          bundle: bundleFromEntries(tma4400),
        }),
      ],
      false,
    );
    expect(choices).toHaveLength(1);
    expect(choices[0]?.code).toBe("TMA4400");
    // Two session families, two alternatives each — every one of them a real
    // lecture the student might be in.
    expect(choices[0]?.count).toBe(4);
  });

  test("no note once the student has picked a lecture group", () => {
    const picked = state({
      code: "TMA4400",
      programCode: "MTIØT",
      bundle: bundleFromEntries(tma4400),
    });
    picked.course.groups = ["forelesning-1-mtdt-mtiøt-mtkom"];
    expect(unresolvedLectureChoices([picked], false)).toEqual([]);
  });

  test("no note when the programme's own parallel resolves it", () => {
    const resolved = [
      entry("Forelesningsparallell 1", { studyProgramKeys: ["BPROG"] }),
      entry("Forelesningsparallell 2", { studyProgramKeys: ["MTDT"] }),
    ];
    const choices = unresolvedLectureChoices(
      [state({ code: "TDT4110", programCode: "MTDT", bundle: bundleFromEntries(resolved) })],
      false,
    );
    expect(choices).toEqual([]);
  });

  test("the /emne/ reuse narrows nothing, so nothing there is a guess", () => {
    const choices = unresolvedLectureChoices(
      [state({ code: "TMA4400", programCode: null, bundle: bundleFromEntries(tma4400) })],
      true,
    );
    expect(choices).toEqual([]);
  });

  test("a course with no timetable produces no note", () => {
    expect(unresolvedLectureChoices([state({ code: "TMA4400" })], false)).toEqual([]);
    expect(
      unresolvedLectureChoices([state({ code: "TMA4400", bundle: failedBundle() })], false),
    ).toEqual([]);
  });
});

describe("pileSummary (grid-1, grid-2, grid-5, copy-1)", () => {
  const session = (courseCode: string, startTime: string, endTime: string) => ({
    courseCode,
    startTime,
    endTime,
  });

  test("every session is named and timed — not one row per course", () => {
    // BERGO kull 2026, tirsdag: the pile said "2 emner · 08:15" over these.
    const summary = pileSummary([
      session("ETT1101", "08:15", "10:00"),
      session("ETT1102", "08:15", "11:00"),
      session("ETT1101", "10:15", "11:00"),
    ]);
    expect(summary.codes).toEqual(["ETT1101", "ETT1102"]);
    expect(summary.byCourse).toEqual([
      { code: "ETT1101", times: ["08:15–10:00", "10:15–11:00"] },
      { code: "ETT1102", times: ["08:15–11:00"] },
    ]);
    expect(summary.sessions).toBe("ETT1101 08:15–10:00 og 10:15–11:00; ETT1102 08:15–11:00");
  });

  test("courses count as emner, sessions as aktiviteter", () => {
    const summary = pileSummary([
      session("ETT1101", "08:15", "10:00"),
      session("ETT1102", "08:15", "11:00"),
      session("ETT1101", "10:15", "11:00"),
    ]);
    expect(summary.meta).toBe("2 emner · 3 aktiviteter");
    expect(summary.activities).toBe("3 aktiviteter");
  });

  test("one course's own overlapping sessions are not '1 emner'", () => {
    // /emne/EXPH0300/ rendered 17 piles, every one captioned "1 emner · 08:15".
    const summary = pileSummary([
      session("EXPH0300", "08:15", "10:00"),
      session("EXPH0300", "08:15", "12:00"),
      session("EXPH0300", "09:15", "11:00"),
    ]);
    expect(summary.meta).toBe("3 aktiviteter");
    expect(summary.meta).not.toContain("emner");
    // The code sits above the list, so the rows carry times alone.
    expect(summary.sessions).toBe("08:15–10:00, 08:15–12:00 og 09:15–11:00");
  });

  test("the activity noun branches (no '1 aktiviteter')", () => {
    expect(pileSummary([session("ETT1101", "08:15", "10:00")]).activities).toBe("1 aktivitet");
  });
});

describe("metaLine (week-4)", () => {
  test("the start time comes first, so the room is what the ellipsis eats", () => {
    expect(metaLine({ rooms: "Digital undervisning", startTime: "12:15" })).toBe(
      "12:15 · Digital undervisning",
    );
  });

  test("no room, still a time", () => {
    expect(metaLine({ rooms: "", startTime: "08:15" })).toBe("08:15");
  });
});

/* --- The DOM half ------------------------------------------------------
 *
 * Two of `renderGrid`'s decisions are not expressible in the pure helpers
 * above and were shipping unverified below the browser suite: the header
 * row's shape (week-7) and the phone-width column cap (grid-3). This repo
 * ships no jsdom/happy-dom and does not want one, so the shim below is the
 * smallest thing `renderGrid` actually touches — createElement, classList,
 * append/replaceChildren, attributes and a `style.setProperty` that records
 * custom properties, because both findings are asserted on those.
 *
 * It is NOT a DOM: no layout, no CSS, no selector engine. It proves which
 * nodes are built and what they carry, never how wide they end up.
 */

class ShimEl {
  classes = new Set<string>();
  props = new Map<string, string>();
  attrs = new Map<string, string>();
  children: ShimEl[] = [];
  text = "";
  title = "";
  hidden = false;
  offsetWidth = 0;
  constructor(readonly tagName: string) {}
  classList = {
    add: (...names: string[]) => {
      for (const n of names) this.classes.add(n);
    },
    remove: (...names: string[]) => {
      for (const n of names) this.classes.delete(n);
    },
    toggle: (name: string, force?: boolean) => {
      if (force ?? !this.classes.has(name)) this.classes.add(name);
      else this.classes.delete(name);
    },
    contains: (name: string) => this.classes.has(name),
  };
  style = {
    setProperty: (name: string, value: string) => {
      this.props.set(name, value);
    },
    removeProperty: (name: string) => {
      this.props.delete(name);
    },
  };
  get className(): string {
    return [...this.classes].join(" ");
  }
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
  removeAttribute(name: string) {
    this.attrs.delete(name);
  }
  append(...nodes: ShimEl[]) {
    this.children.push(...nodes);
  }
  prepend(...nodes: ShimEl[]) {
    this.children.unshift(...nodes);
  }
  replaceChildren(...nodes: ShimEl[]) {
    this.children = [...nodes];
  }
  addEventListener() {}
  focus() {}
  scrollIntoView() {}
  /** Depth-first walk — the shim has no selector engine. */
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

function installShim(narrow: boolean): () => void {
  const g = globalThis as unknown as Record<string, unknown>;
  const before = { document: g.document, matchMedia: g.matchMedia };
  g.document = { createElement: (tag: string) => new ShimEl(tag.toUpperCase()) };
  g.matchMedia = (query: string) => ({
    matches: narrow && query === "(max-width: 40rem)",
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  return () => {
    g.document = before.document;
    g.matchMedia = before.matchMedia;
  };
}

let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
});

/** Renders one plan into a fresh frame and hands back the frame. */
function draw(courses: PlanCourseState[], narrow: boolean): ShimEl {
  uninstall = installShim(narrow);
  const frame = new ShimEl("DIV");
  const notes = new ShimEl("DIV");
  renderGrid(frame as unknown as HTMLElement, notes as unknown as HTMLElement, courses, false, {});
  return frame;
}

describe("renderGrid: the header row (week-7)", () => {
  const courses = [state({ code: "TMA4400", bundle: bundleFromEntries([entry("Forelesning")]) })];

  test("row 1 spans the hour rail, so a sticky header can cover the full width", () => {
    const headers = draw(courses, false).find("planner-grid-day-header");
    // Five weekdays plus the rail cell — without the rail cell, column 1 is a
    // background-less band the hour labels slide through while scrolling.
    expect(headers).toHaveLength(6);
    const rail = headers.filter((h) => h.classes.has("planner-grid-rail-header"));
    expect(rail).toHaveLength(1);
    expect(rail[0]?.props.get("--planner-day")).toBe("0");
    expect(rail[0]?.textContent).toBe("");
    // It names nothing, so it must not be announced as a column either.
    expect(rail[0]?.getAttribute("aria-hidden")).toBe("true");
  });

  test("the day names still come first, so scrollToToday's index is unmoved", () => {
    // plannerApp.ts's scrollToToday reads `.planner-grid-day-header` by
    // weekday ordinal; a rail cell in front of them would scroll to Sunday.
    const headers = draw(courses, false).find("planner-grid-day-header");
    expect(headers.slice(0, 5).map((h) => h.textContent)).toEqual([
      "man",
      "tir",
      "ons",
      "tor",
      "fre",
    ]);
    expect(headers[5]?.classes.has("planner-grid-rail-header")).toBe(true);
  });
});

describe("renderGrid: the phone column cap (grid-3)", () => {
  // Two overlapping Monday sessions: two readable columns on a desktop day
  // column, two 27 px slivers of one-character-per-line code on a phone.
  const overlapping = [
    state({
      code: "FRA1010",
      bundle: bundleFromEntries([
        entry("Forelesning", { courseCode: "FRA1010", startTime: "10:15", endTime: "12:00" }),
        entry("Forelesning", { courseCode: "FRA1010", startTime: "11:15", endTime: "13:00" }),
      ]),
    }),
  ];

  test("splits into two columns above 40rem", () => {
    const frame = draw(overlapping, false);
    const blocks = frame.find("planner-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.props.get("--planner-col-count")).toBe("2");
    expect(frame.find("planner-block-pile")).toHaveLength(0);
  });

  test("piles into one block at 40rem and below", () => {
    const frame = draw(overlapping, true);
    const piles = frame.find("planner-block-pile");
    expect(piles).toHaveLength(1);
    expect(piles[0]?.props.get("--planner-col-count")).toBe("1");
    // Nothing is dropped: the pile names both sessions it stands for.
    expect(piles[0]?.textContent).toContain("10:15");
    expect(piles[0]?.textContent).toContain("11:15");
  });
});
