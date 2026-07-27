import { describe, expect, test } from "vitest";
import {
  metaLine,
  pileSummary,
  planGaps,
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
