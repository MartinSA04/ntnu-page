import { afterEach, describe, expect, test } from "vitest";
import type { PlanCourseState } from "../../src/components/planner/types.js";
import {
  blockDetailFor,
  buildingLabel,
  lectureLessCourses,
  planGaps,
  unresolvedLectureChoices,
  visibleLayer,
  weekNotes,
} from "../../src/components/planner/weekNotes.js";
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

function installShim(narrow = false): void {
  const g = globalThis as unknown as Record<string, unknown>;
  const before = { document: g.document, matchMedia: g.matchMedia };
  g.document = { createElement: (tag: string) => new ShimEl(tag.toUpperCase()) };
  g.matchMedia = (query: string) => ({
    matches: narrow && query === "(max-width: 40rem)",
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
  narrow = false,
) {
  installShim(narrow);
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

describe("the margin folds behind one line (mob-D)", () => {
  // A course whose timetable never arrived: one gap note, and one that
  // qualifies the collision check.
  const withGap = [
    state({ code: "TMA4400", bundle: bundleFromEntries([entry("Forelesning")]) }),
    state({ code: "TDT4120", bundle: failedBundle() }),
  ];

  test("the count and the qualification stay on the line, the paragraph goes inside", () => {
    const { host } = notesFor(withGap, true, {}, true);
    const fold = host.find("planner-notes-fold")[0];
    expect(fold).toBeDefined();
    expect(host.find("planner-notes-summary")[0]?.textContent).toBe(
      "1 merknad. Kollisjonssjekken er ufullstendig",
    );
    // The sentence itself is inside the fold, not deleted.
    expect(fold?.find("planner-grid-note")[0]?.textContent).toContain(
      "Fikk ikke hentet timeplan for",
    );
  });

  test("closed on a phone, open where the notes cost nothing", () => {
    expect(notesFor(withGap, true, {}, true).host.find("planner-notes-fold")[0]?.open).toBe(false);
    expect(notesFor(withGap, true, {}, false).host.find("planner-notes-fold")[0]?.open).toBe(true);
  });

  test("nothing with a verb in it is folded", () => {
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
    const { host } = notesFor(clashing, true, {}, true);
    // Red is the one mark on this page that may not be one tap away.
    expect(host.find("planner-notes-fold")).toHaveLength(0);
    expect(host.find("np-note-clash")).toHaveLength(1);

    // Nor is a control. Nothing inside the fold is pressable at all: the "velg
    // din gruppe" lines are what change the week, and a folded button is a
    // button nobody presses. (That the phone really renders them is asserted
    // in e2e/flows.pw.ts's target-size pass, which is what caught this.)
    const folded = notesFor(withGap, true, {}, true).host.find("planner-notes-fold")[0];
    expect(folded?.find("planner-note-link")).toHaveLength(0);
  });
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
   * The gap the auto-reveal cannot cover. `visibleLayer`'s reveal is
   * plan-GLOBAL — it only fires when NOT ONE course has a lecture — so a
   * lecture-less course sharing a plan with an ordinary one is silently dropped
   * from both the week and the collision check. ~22% of course-terms are
   * lecture-less and always will be.
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

describe("buildingLabel (the fact the bar has no room for)", () => {
  test("names the building behind a room code", () => {
    // The bar prints "F1" and the popover used to as well, which is not enough
    // to walk to: the data has the building and nothing rendered it.
    expect(buildingLabel([{ room: "F1", building: "IT-bygget, sydfløy" }])).toBe(
      "IT-bygget, sydfløy",
    );
  });

  test("names a shared building once, however many rooms are booked", () => {
    // TDT4110's Ferdighetstrening books four Realfagbygget rooms per slot.
    expect(
      buildingLabel([
        { room: "A3-100", building: "Realfagbygget" },
        { room: "A3-125", building: "Realfagbygget" },
        { room: "A4-100", building: "Realfagbygget" },
      ]),
    ).toBe("Realfagbygget");
  });

  test("lists two buildings when the session really is in two", () => {
    expect(
      buildingLabel([
        { room: "R1", building: "Realfagbygget" },
        { room: "H3 521", building: "Tapirbygget" },
      ]),
    ).toBe("Realfagbygget, Tapirbygget");
  });

  test("says nothing when the building repeats the room's own name", () => {
    // Upstream does publish rows where the two fields carry the same string;
    // printing it under itself is the noise this function exists to avoid.
    expect(buildingLabel([{ room: "R9", building: "R9" }])).toBe("");
  });

  test("says nothing when the building IS the room label", () => {
    // `roomLabel` falls back to the building when there is no room, so
    // repeating it underneath would print the same string twice.
    expect(buildingLabel([{ room: null, building: "Realfagbygget" }])).toBe("");
    expect(buildingLabel([])).toBe("");
    expect(buildingLabel([{ room: "R1", building: null }])).toBe("");
  });
});

describe("blockDetailFor (what a clicked bar hands the popover)", () => {
  // Exactly `BlockSource`: the fields the function reads and no more. Both
  // views adapt their own session shape to this, which is what lets one card
  // answer for a column block and a list row alike.
  const session = {
    courseCode: "TDT4110",
    courseName: "Informasjonsteknologi, grunnkurs",
    dayNumber: 1,
    startTime: "14:15",
    endTime: "16:00",
    name: "Forelesningsparallell 3",
    rooms: "F1",
    buildings: "IT-bygget, sydfløy",
    weeksLabel: "uke 34–47",
    isLecture: true,
    groupCount: 1,
  };

  test("hands over the clock as its own pair, not a pre-joined sentence", () => {
    // The card sets the time as its largest figure and the day beside it, so it
    // needs the two halves rather than "mandag 14:15–16:00".
    const detail = blockDetailFor(session, null);
    expect(detail.startTime).toBe("14:15");
    expect(detail.endTime).toBe("16:00");
    expect(detail.dayNumber).toBe(1);
  });

  test("hands over the building, so the card can name where the room is", () => {
    expect(blockDetailFor(session, null).buildings).toBe("IT-bygget, sydfløy");
  });

  test("names the collision partner and the minutes they share", () => {
    // Red-Is-Collision: if red appears, the copy names both things. The zone in
    // the week says WHEN; only the partner code says WITH WHAT.
    const detail = blockDetailFor(session, {
      partners: ["TDT4160"],
      window: { start: 14 * 60 + 15, end: 16 * 60 },
    });
    expect(detail.clash).toEqual({
      partners: ["TDT4160"],
      startTime: "14:15",
      endTime: "16:00",
    });
  });

  test("stays quiet when the session collides with nothing", () => {
    expect(blockDetailFor(session, null).clash).toBeNull();
  });
});
