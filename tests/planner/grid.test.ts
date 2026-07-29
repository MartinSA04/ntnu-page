import { afterEach, describe, expect, test } from "vitest";
import {
  lectureLessCourses,
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

describe("lectureLessCourses", () => {
  /**
   * The gap the auto-reveal cannot cover. `visibleLayer`'s B7a reveal is
   * plan-GLOBAL — it only fires when NOT ONE course in the plan has a lecture.
   * So a lecture-less course sharing a plan with an ordinary one is silently
   * dropped from both the week and the collision check, with nothing said.
   * TFY4220's 2026_HØST hit exactly this before its "Formidling" titles were
   * classified; ~22% of course-terms still do, and always will (Kunstakademiet
   * publishes "allmøte" and "atelierflyt/rydding", never a lecture).
   */
  const lec = (courseCode: string) => ({ courseCode, isLecture: true, groupPicked: false });
  const oth = (courseCode: string) => ({ courseCode, isLecture: false, groupPicked: false });

  test("names a course whose entries are all non-lecture", () => {
    expect(lectureLessCourses([lec("TMA4400"), oth("BK1151"), oth("BK1151")])).toEqual(["BK1151"]);
  });

  test("says nothing when every course has a lecture", () => {
    expect(lectureLessCourses([lec("TMA4400"), oth("TMA4400"), lec("TFY4220")])).toEqual([]);
  });

  test("reports each lecture-less course once, in plan order", () => {
    expect(lectureLessCourses([oth("BK2452"), oth("BK1151"), oth("BK2452")])).toEqual([
      "BK2452",
      "BK1151",
    ]);
  });

  test("a course with no entries at all is not lecture-less — planGaps owns that sentence", () => {
    expect(lectureLessCourses([])).toEqual([]);
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
  offsetTop = 0;
  offsetHeight = 0;
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
  /**
   * Class selectors only, and deliberately so. `renderGrid` reaches for this
   * to wire the time readout and place the now marker; anything richer would
   * be a selector engine, which this shim is explicitly not.
   */
  querySelector(sel: string): ShimEl | null {
    if (!sel.startsWith(".")) return null;
    return this.find(sel.slice(1).split("[")[0] ?? "")[0] ?? null;
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
describe("renderGrid: the transposed shell (REWORK-2026-07-29b D1)", () => {
  const courses = [state({ code: "TMA4400", bundle: bundleFromEntries([entry("Forelesning")]) })];

  test("days are rows with a spine, not columns with a three-letter header", () => {
    const frame = draw(courses, false);
    const rows = frame.find("planner-grid-row");
    expect(rows).toHaveLength(5);
    // The spine carries the whole word: it is the page's typographic event and
    // the thing a student finds their row by, not a label.
    expect(frame.find("planner-grid-spine").map((s) => s.textContent)).toEqual([
      "mandag",
      "tirsdag",
      "onsdag",
      "torsdag",
      "fredag",
    ]);
    // Every day has somewhere to append bars, empty ones included.
    expect(frame.find("planner-grid-field")).toHaveLength(5);
  });

  test("the ruler ties each hour figure to its own position on the axis", () => {
    const ticks = draw(courses, false).find("planner-grid-tick");
    expect(ticks.length).toBeGreaterThan(1);
    // First tick at 0 %, last at 100 % — the axis spans exactly the clamped
    // range, so a bar's percentage and a tick's percentage mean the same thing.
    expect(ticks[0]?.props.get("--planner-x")).toBe("0%");
    expect(ticks[ticks.length - 1]?.props.get("--planner-x")).toBe("100%");
  });

  test("today's row is marked so the spine can carry it at full ink", () => {
    uninstall = installShim(false);
    const frame = new ShimEl("DIV");
    renderGrid(
      frame as unknown as HTMLElement,
      new ShimEl("DIV") as unknown as HTMLElement,
      courses,
      false,
      { todayNumber: 3 },
    );
    const marked = frame.find("planner-grid-row").filter((r) => r.attrs.has("data-today"));
    expect(marked).toHaveLength(1);
    expect(marked[0]?.find("planner-grid-spine")[0]?.textContent).toBe("onsdag");
  });
});

describe("renderGrid: overlap stacks into lanes and never piles (D1)", () => {
  // The exact case that used to pile: two overlapping Monday sessions, which
  // at a 150 px day column could not be split without breaking course codes.
  const overlapping = [
    state({
      code: "FRA1010",
      bundle: bundleFromEntries([
        entry("Forelesning", { courseCode: "FRA1010", startTime: "10:15", endTime: "12:00" }),
        entry("Forelesning", { courseCode: "FRA1010", startTime: "11:15", endTime: "13:00" }),
      ]),
    }),
  ];

  const laneCheck = (narrow: boolean): void => {
    const frame = draw(overlapping, narrow);
    const blocks = frame.find("planner-block");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.props.get("--planner-lane")).toBe("0");
    expect(blocks[1]?.props.get("--planner-lane")).toBe("1");
    // The pile is gone as a concept — there is no width left to run out of.
    expect(frame.find("planner-block-pile")).toHaveLength(0);
    // Both bars keep their own start, which is what a lane cannot express.
    expect(blocks[0]?.props.get("--planner-x")).not.toBe(blocks[1]?.props.get("--planner-x"));
  };

  test("stacks at desktop width", () => laneCheck(false));

  // The whole point of transposing: the phone gets the SAME two readable bars,
  // where the vertical grid collapsed them into one slab of text (grid-3).
  test("stacks identically at phone width", () => laneCheck(true));

  test("the row reserves the depth its lanes need", () => {
    const field = draw(overlapping, false).find("planner-grid-field")[0];
    expect(field?.props.get("--planner-lanes")).toBe("2");
  });
});

describe("renderGrid: a bar's geometry is its time (D1)", () => {
  test("x and width are percentages of the day's own span", () => {
    // A single 10:15–12:00 session clamps the axis to 10:00–12:00, so the bar
    // starts an eighth of the way in and runs to the end.
    const frame = draw(
      [
        state({
          code: "TMA4400",
          bundle: bundleFromEntries([
            entry("Forelesning", { startTime: "10:15", endTime: "12:00" }),
          ]),
        }),
      ],
      false,
    );
    const block = frame.find("planner-block")[0];
    expect(block?.props.get("--planner-x")).toBe("12.5%");
    expect(block?.props.get("--planner-w")).toBe("87.5%");
  });

  test("a bar carries its code, and its activity only when there is room", () => {
    const short = draw(
      [
        state({
          code: "TDT4109",
          bundle: bundleFromEntries([
            entry("Digital forelesning", { startTime: "12:15", endTime: "13:00" }),
          ]),
        }),
      ],
      false,
    );
    // 45 minutes is ~100 px of axis — the code, and nothing that would clip.
    expect(short.find("planner-block-code")).toHaveLength(1);
    expect(short.find("planner-block-what")).toHaveLength(0);
  });
});

describe("renderGrid: the collision is one zone per day (D4)", () => {
  const clashing = [
    state({
      code: "TMA4412",
      bundle: bundleFromEntries([
        entry("Forelesning", { courseCode: "TMA4412", startTime: "08:15", endTime: "10:00" }),
      ]),
    }),
    state({
      code: "TDT4136",
      bundle: bundleFromEntries([
        entry("Forelesning", { courseCode: "TDT4136", startTime: "09:15", endTime: "11:00" }),
      ]),
    }),
  ];

  test("one zone, spanning exactly the minutes that overlap", () => {
    const frame = draw(clashing, false);
    const zones = frame.find("planner-clash-zone");
    // Not one per block: the mark belongs to the moment, not to either course.
    expect(zones).toHaveLength(1);
    // 08:00–11:00 axis (180 min); the 09:15–10:00 overlap starts 75 min in and
    // runs 45 — the zone is the minutes, not a whole-block tint.
    expect(zones[0]?.props.get("--planner-x")).toBe(`${(75 / 180) * 100}%`);
    expect(zones[0]?.props.get("--planner-w")).toBe("25%");
    expect(zones[0]?.getAttribute("aria-hidden")).toBe("true");
  });

  test("a clean week draws no zone at all", () => {
    expect(
      draw(
        [state({ code: "TMA4400", bundle: bundleFromEntries([entry("Forelesning")]) })],
        false,
      ).find("planner-clash-zone"),
    ).toHaveLength(0);
  });
});
