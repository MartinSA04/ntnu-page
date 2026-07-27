import { describe, expect, test } from "vitest";
import { lecturesAreExclusive, nextSelection } from "../../src/components/planner/popover.js";
import type { TimetableEntry } from "../../src/lib/planner/data.js";
import {
  applyGroupSelection,
  defaultLectureKeys,
  groupOptions,
} from "../../src/lib/planner/groups.js";

/**
 * The popover itself is DOM code with no vitest environment to mount it in —
 * its rendering and focus behaviour are covered by e2e/flows.pw.ts. What IS
 * testable, and what has twice deleted real teaching from the week, is the
 * write path: which keys the picker stores when the student toggles one
 * option. Those two pure functions are exported for exactly this, and the last
 * suite feeds their output straight into `applyGroupSelection` — the seam
 * where a picker decision becomes a week.
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
    // families, so resolveLectureDefaults narrows nothing (groups-2).
    expect(lecturesAreExclusive([])).toBe(false);
  });

  test("several default keys are one provisional pick per family — still not one choice", () => {
    expect(lecturesAreExclusive(["forelesning-1-mtdt", "plenumsregning"])).toBe(false);
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
    expect(next.some((key) => LECTURES.has(key))).toBe(false);
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
    expect(next.filter((key) => OTHERS.has(key))).toEqual(["mattelab-1", "mattelab-2"]);
  });
});

/**
 * The seam itself: what the picker decides, fed straight into the engine that
 * draws the week. TMA4400 as MTDT sees it — "Forelesning 1 …" (tir),
 * "Forelesning 2 …" (tor) and "Plenumsregning" (ons) are three weekly sessions
 * for the same programme cluster, plus the parallels tagged for MTBYGG that
 * the picker still lists but the programme filter drops (groups-2, live data
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

    // …and unticking them again returns the whole default week (groups-6).
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
