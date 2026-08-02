import { describe, expect, test } from "vitest";
import {
  courseFacts,
  lecturesAreExclusive,
  namesProgramme,
  nextSelection,
  pickableGroups,
} from "../../src/components/planner/courseSettings.js";
import type { TimetableEntry } from "../../src/lib/planner/data.js";
import {
  applyGroupSelection,
  defaultLectureKeys,
  groupOptions,
} from "../../src/lib/planner/groups.js";

/**
 * The modal itself is DOM code with no vitest environment to mount it in —
 * its rendering and focus behaviour are covered by e2e/flows.pw.ts. What IS
 * testable, and what has twice deleted real teaching from the week, is the
 * write path: which keys the picker stores when the student toggles one
 * option. These pure functions are exported for exactly this, and the last
 * suite feeds their output straight into `applyGroupSelection` — the seam
 * where a picker decision becomes a week.
 *
 * They moved from `popover.ts` to `courseSettings.ts` unchanged in
 * (the surface around them became a real modal opened from
 * two places); this file moved with them.
 */

const LECTURES = new Set(["forelesning-1-mtdt", "forelesning-2-mtdt", "plenumsregning"]);
const OTHERS = new Set(["mattelab-1", "mattelab-2"]);

describe("lecturesAreExclusive", () => {
  test("one default key means the layer was narrowed to one group — a real choice", () => {
    expect(lecturesAreExclusive(["forelesningsparallell-1"])).toBe(true);
  });

  test("no default key means nothing was narrowed — complementary sessions, not a choice", () => {
    // TMA4400 for MTDT: "Forelesning 1 …", "Forelesning 2 …" and
    // "Plenumsregning" all survive the programme filter as separate session
    // families, so resolveLectureDefaults narrows nothing.
    expect(lecturesAreExclusive([])).toBe(false);
  });

  test("several default keys are one provisional pick per family — still not one choice", () => {
    expect(lecturesAreExclusive(["forelesning-1-mtdt", "plenumsregning"])).toBe(false);
  });
});

describe("pickableGroups", () => {
  const option = (key: string, kind: "lecture" | "other") => ({
    key,
    label: key,
    kind: kind === "lecture" ? ("lecture" as const) : ("other" as const),
    entryCount: 1,
  });

  test("the two kinds are counted separately", () => {
    // One parallel and two øving groups: the lone parallel is not a choice, so
    // it draws no dead radio above the checkboxes that are.
    const { lectures, others } = pickableGroups(
      [
        option("forelesningsparallell-1", "lecture"),
        option("mattelab-1", "other"),
        option("mattelab-2", "other"),
      ],
      ["forelesningsparallell-1"],
    );
    expect(lectures).toEqual([]);
    expect(others.map((o) => o.key)).toEqual(["mattelab-1", "mattelab-2"]);
  });

  test("a single option of either kind is not something to choose between", () => {
    const { lectures, others } = pickableGroups(
      [option("forelesningsparallell-1", "lecture"), option("øvingsgruppe-1", "other")],
      ["forelesningsparallell-1"],
    );
    expect(lectures).toEqual([]);
    expect(others).toEqual([]);
  });

  test("lectures the week already draws in full are not a choice (TMA4401)", () => {
    // TMA4401 publishes "Forelesning" and "Plenumsregning" — two complementary
    // weekly sessions, both classified as lectures, both on screen. Counting
    // alone made them two checkboxes, which invited the student to untick
    // teaching they attend. There is nothing to switch to, so there is no
    // control.
    const { lectures, others } = pickableGroups(
      [
        option("forelesning", "lecture"),
        option("plenumsregning", "lecture"),
        option("øvingstime", "other"),
      ],
      ["forelesning", "plenumsregning"],
    );
    expect(lectures).toEqual([]);
    expect(others).toEqual([]);
  });

  test("a parallel the week is NOT drawing keeps the picker (TMA4400 as MTDT)", () => {
    // The mirror image, and why the gate cannot be `defaults.length > 0`:
    // TMA4400 narrows nothing either (three singleton session families), but
    // the parallels tagged for other programmes are listed and undrawn, and
    // picking one is a documented capability (groups.ts, e2e/flows.pw.ts).
    const { lectures } = pickableGroups(
      [
        option("forelesning-1-mtdt-mtiot-mtkom", "lecture"),
        option("forelesning-2-mtiot-mtkom-mtdt", "lecture"),
        option("plenumsregning", "lecture"),
        option("forelesning-1-mtbygg-mting", "lecture"),
      ],
      ["forelesning-1-mtdt-mtiot-mtkom", "forelesning-2-mtiot-mtkom-mtdt", "plenumsregning"],
    );
    expect(lectures.map((o) => o.key)).toContain("forelesning-1-mtbygg-mting");
    expect(lectures).toHaveLength(4);
  });
});

describe("nextSelection — øving/lab layer", () => {
  test("ticking an øving group never touches the lecture layer (week-1)", () => {
    // TMA4412: one lecture group, three Mattelab groups. The old seeding wrote
    // ctx.defaults (empty for a single-lecture course) plus the øving key, and
    // the flat allow-list then filtered both weekly lectures out of the week.
    const next = nextSelection({
      selection: [],
      layerKeys: OTHERS,
      shown: [],
      key: "mattelab-1",
      checked: true,
      exclusive: false,
    });
    expect(next).toEqual(["mattelab-1"]);
  });

  test("a second øving group adds to the first rather than replacing it", () => {
    const next = nextSelection({
      selection: ["mattelab-1"],
      layerKeys: OTHERS,
      shown: ["mattelab-1"],
      key: "mattelab-2",
      checked: true,
      exclusive: false,
    });
    expect(next).toEqual(["mattelab-1", "mattelab-2"]);
  });

  test("unticking the last øving group clears that layer and keeps the lecture pick", () => {
    const next = nextSelection({
      selection: ["forelesning-1-mtdt", "mattelab-1"],
      layerKeys: OTHERS,
      shown: ["mattelab-1"],
      key: "mattelab-1",
      checked: false,
      exclusive: false,
    });
    expect(next).toEqual(["forelesning-1-mtdt"]);
  });
});

describe("nextSelection — lecture layer", () => {
  test("an exclusive pick replaces the lecture layer and keeps the øving pick", () => {
    // TDT4110's three numbered parallels really are alternatives: picking
    // Forelesningsparallell 2 must turn Forelesningsparallell 1 off.
    const parallels = new Set(["forelesningsparallell-1", "forelesningsparallell-2"]);
    const next = nextSelection({
      selection: ["forelesningsparallell-1", "øvingsgruppe-5"],
      layerKeys: parallels,
      shown: ["forelesningsparallell-1"],
      key: "forelesningsparallell-2",
      checked: true,
      exclusive: true,
    });
    expect(next).toEqual(["forelesningsparallell-2", "øvingsgruppe-5"]);
  });

  test("an additive pick keeps the sessions already drawn (groups-2)", () => {
    // The regression this exists to prevent: with complementary sessions the
    // pick must not become the whole lecture layer.
    const next = nextSelection({
      selection: [],
      layerKeys: LECTURES,
      shown: ["forelesning-1-mtdt", "plenumsregning"],
      key: "forelesning-2-mtdt",
      checked: true,
      exclusive: false,
    });
    expect(next).toEqual(["forelesning-1-mtdt", "plenumsregning", "forelesning-2-mtdt"]);
  });

  test("unticking the last lecture leaves no lecture key — back to the default (groups-6)", () => {
    const next = nextSelection({
      selection: ["forelesning-2-mtdt", "mattelab-1"],
      layerKeys: LECTURES,
      shown: ["forelesning-2-mtdt"],
      key: "forelesning-2-mtdt",
      checked: false,
      exclusive: false,
    });
    expect(next).toEqual(["mattelab-1"]);
    expect(next.some((key: string) => LECTURES.has(key))).toBe(false);
  });

  test("a stored pick for the other layer survives every lecture edit", () => {
    const next = nextSelection({
      selection: ["mattelab-1", "mattelab-2"],
      layerKeys: LECTURES,
      shown: [],
      key: "forelesning-1-mtdt",
      checked: true,
      exclusive: false,
    });
    expect(next.filter((key: string) => OTHERS.has(key))).toEqual(["mattelab-1", "mattelab-2"]);
  });
});

/**
 * The seam itself: what the picker decides, fed straight into the engine that
 * draws the week. TMA4400 as MTDT sees it — "Forelesning 1 …" (tir),
 * "Forelesning 2 …" (tor) and "Plenumsregning" (ons) are three weekly sessions
 * for the same programme cluster, plus the parallels tagged for MTBYGG that
 * the picker still lists but the programme filter drops (live data
 * confirmed against /api/course/TMA4400/timetable?year=2026).
 */
describe("TMA4400 as MTDT — the picker's decision against applyGroupSelection", () => {
  const entry = (title: string, over: Partial<TimetableEntry> = {}): TimetableEntry => ({
    courseCode: "TMA4400",
    courseName: { nob: null, nno: null, eng: null },
    dayNumber: 3,
    startTime: "10:15",
    endTime: "12:00",
    weeks: ["34-47"],
    rooms: [],
    title,
    name: null,
    ...over,
  });
  const tma4400: TimetableEntry[] = [
    entry("Forelesning 1 MTDT, MTIØT, MTKOM", { dayNumber: 2, studyProgramKeys: ["MTDT"] }),
    entry("Forelesning 1 MTBYGG, MTING", { dayNumber: 1, studyProgramKeys: ["MTBYGG"] }),
    entry("Forelesning 2 MTIØT, MTKOM, MTDT", { dayNumber: 4, studyProgramKeys: ["MTDT"] }),
    entry("Forelesning 2 MTBYGG", {
      dayNumber: 3,
      startTime: "08:15",
      studyProgramKeys: ["MTBYGG"],
    }),
    entry("Plenumsregning", { dayNumber: 3, startTime: "14:15" }),
    entry("Mattelab 1", { dayNumber: 3, startTime: "12:15" }),
    entry("Mattelab 2", { dayNumber: 4, startTime: "12:15" }),
  ];
  const defaults = defaultLectureKeys(tma4400, "MTDT");
  const drawn = (selected: string[] | undefined) =>
    applyGroupSelection(tma4400, selected, "MTDT").map((x) => x.title);

  test("the week opens on all three of the student's sessions", () => {
    expect(drawn(undefined)).toEqual([
      "Forelesning 1 MTDT, MTIØT, MTKOM",
      "Forelesning 2 MTIØT, MTKOM, MTDT",
      "Plenumsregning",
      "Mattelab 1",
      "Mattelab 2",
    ]);
  });

  test("the lecture options are not alternatives, so they get no radio", () => {
    // groups.ts narrows nothing here: three session families, one member each.
    expect(defaults).toEqual([]);
    expect(lecturesAreExclusive(defaults)).toBe(false);
  });

  test("even an exclusive write can no longer delete the other sessions (groups-2)", () => {
    // What the radio wrote — and what an old share hash still carries, where no
    // picker control can intervene. groups.ts applies a lecture pick per session
    // family now, so it answers "Forelesning 1" and leaves the Thursday session
    // and the plenary on their defaults.
    const exclusiveWrite = nextSelection({
      selection: [],
      layerKeys: new Set(groupOptions(tma4400).map((o) => o.key)),
      shown: defaults,
      key: "forelesning-1-mtdt-mtiøt-mtkom",
      checked: true,
      exclusive: true,
    });
    expect(exclusiveWrite).toEqual(["forelesning-1-mtdt-mtiøt-mtkom"]);
    expect(drawn(exclusiveWrite)).toContain("Plenumsregning");
    expect(drawn(exclusiveWrite)).toContain("Forelesning 2 MTIØT, MTKOM, MTDT");
    // Its own family is still narrowed — a pick is not a no-op.
    expect(drawn(exclusiveWrite)).not.toContain("Forelesning 1 MTBYGG, MTING");
  });

  test("additive ticks narrow within a session, never across sessions", () => {
    const lectureKeys = new Set(
      groupOptions(tma4400)
        .filter((o) => o.kind === "lecture")
        .map((o) => o.key),
    );
    const tick = (selection: string[], key: string, checked: boolean) =>
      nextSelection({
        selection,
        layerKeys: lectureKeys,
        shown: selection.filter((k) => lectureKeys.has(k)),
        key,
        checked,
        exclusive: false,
      });
    let selection = tick([], "forelesning-1-mtbygg-mting", true);
    expect(drawn(selection)).toEqual([
      "Forelesning 1 MTBYGG, MTING",
      "Forelesning 2 MTIØT, MTKOM, MTDT",
      "Plenumsregning",
      "Mattelab 1",
      "Mattelab 2",
    ]);

    selection = tick(selection, "forelesning-2-mtbygg", true);
    expect(drawn(selection)).toEqual([
      "Forelesning 1 MTBYGG, MTING",
      "Forelesning 2 MTBYGG",
      "Plenumsregning",
      "Mattelab 1",
      "Mattelab 2",
    ]);

    // …and unticking them again returns the whole default week.
    selection = tick(selection, "forelesning-1-mtbygg-mting", false);
    selection = tick(selection, "forelesning-2-mtbygg", false);
    expect(selection).toEqual([]);
    expect(drawn(selection)).toEqual(drawn(undefined));
  });

  test("a cross-programme parallel the student picks still draws", () => {
    // The MTBYGG session is listed but filtered out by default; an explicit
    // tick must beat the programme filter (e2e/flows.pw.ts covers this live).
    // The øving layer is untouched by a lecture pick, and so are the two
    // sessions the pick says nothing about.
    expect(drawn(["forelesning-2-mtbygg"])).toEqual([
      "Forelesning 1 MTDT, MTIØT, MTKOM",
      "Forelesning 2 MTBYGG",
      "Plenumsregning",
      "Mattelab 1",
      "Mattelab 2",
    ]);
  });
});

describe("courseFacts", () => {
  /* The modal used to join its facts into one mono run-on: "7,5 sp · fra
     programmet · droppet". The card the student arrives from sets a figure and
     qualifies it on the line below, and this is the same block. */
  test("sets the credits as the figure and where the course came from under it", () => {
    expect(courseFacts({ credits: 7.5, source: "program", dropped: false })).toEqual({
      figure: "7,5 sp",
      provenance: "Fra programmet",
    });
  });

  test("names a manual add as the student's own", () => {
    expect(courseFacts({ credits: 7.5, source: "manual", dropped: false })).toEqual({
      figure: "7,5 sp",
      provenance: "Lagt til selv",
    });
  });

  /* A dropped course is still in the plan and still restorable, so the line
     says what dropping DID rather than repeating the verb (§0.3). */
  test("says what a dropped course is excluded from", () => {
    expect(courseFacts({ credits: 7.5, source: "program", dropped: true })).toEqual({
      figure: "7,5 sp",
      provenance: "Droppet, ikke med i uka eller i sp",
    });
  });

  /* DR-6: credits are null-holed. With no figure to set, the provenance is the
     fact, and `figure` stays null rather than carrying it, because the figure
     is typeset in the mono and "Fra programmet" is a sentence fragment, not
     data (Data-Is-Mono). */
  test("keeps the figure empty when the credits are missing", () => {
    expect(courseFacts({ credits: null, source: "program", dropped: false })).toEqual({
      figure: null,
      provenance: "Fra programmet",
    });
  });
});

/**
 * Which row is the student's own.
 *
 * The picker sorts this row to the top and marks it "ditt program", so a false
 * positive is not cosmetic: it puts our label on another programme's lecture
 * and sends someone to the wrong room. Hence whole-token matching, and hence
 * this file rather than a glance at the regex.
 */
describe("namesProgramme", () => {
  test("finds the programme in NTNU's own comma-separated title", () => {
    expect(namesProgramme("Forelesning 1 MTDT, MTIØT, MTKOM", "MTDT")).toBe(true);
    expect(namesProgramme("Forelesning 1 MTDT, MTIØT, MTKOM", "MTIØT")).toBe(true);
    expect(namesProgramme("Forelesning 1 MTDT, MTIØT, MTKOM", "MTKOM")).toBe(true);
  });

  test("does not match a code that merely sits inside another", () => {
    // The whole reason this is a token match. "BAT" inside "BATEK" would put
    // "ditt program" on a lecture for a different degree.
    expect(namesProgramme("Forelesning 2 BATEK", "BAT")).toBe(false);
    expect(namesProgramme("Forelesning 2 MTDTX", "MTDT")).toBe(false);
    expect(namesProgramme("Forelesning 2 XMTDT", "MTDT")).toBe(false);
  });

  test("handles the separators upstream actually uses", () => {
    expect(namesProgramme("Forelesning 2 MTELSYS & MTTK", "MTTK")).toBe(true);
    expect(namesProgramme("Forelesning 2 MTELSYS/MTTK", "MTELSYS")).toBe(true);
    expect(namesProgramme("Forelesningsparallell 2 Trondheim MTDT", "MTDT")).toBe(true);
  });

  test("Æ/Ø/Å are letters, not separators", () => {
    // A `\b`-based regex splits MTIØT in two and matches "MTI" against it.
    expect(namesProgramme("Forelesning 1 MTIØT", "MTI")).toBe(false);
    expect(namesProgramme("Forelesning 1 BØA1100", "BØA1100")).toBe(true);
  });

  test("is case-insensitive and unbothered by no programme at all", () => {
    expect(namesProgramme("forelesning 1 mtdt", "MTDT")).toBe(true);
    expect(namesProgramme("Forelesning 1 MTDT", null)).toBe(false);
    expect(namesProgramme("Forelesning 1 MTDT", undefined)).toBe(false);
    expect(namesProgramme("Forelesning 1 MTDT", "  ")).toBe(false);
  });
});
