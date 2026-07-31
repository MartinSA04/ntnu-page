import { describe, expect, test } from "vitest";
import type { TimetableEntry } from "../../src/lib/planner/data.js";
import {
  applyGroupSelection,
  defaultLectureKeys,
  groupKey,
  groupOptions,
  resolveLectureDefaults,
} from "../../src/lib/planner/groups.js";

/**
 * `title` carries the distinguishing activity label on real NTNU data
 * (`title` first, `name` a coarse fallback — see groups.ts's `rawGroupName`
 * doc), so the fixture puts the distinguishing text there by default.
 */
const e = (title: string | null, over: Partial<TimetableEntry> = {}): TimetableEntry => ({
  courseCode: "TDT4110",
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

describe("groupKey", () => {
  test("slugs a parallel name", () =>
    expect(groupKey("Forelesningsparallell 2")).toBe("forelesningsparallell-2"));
  test("keeps æøå", () => expect(groupKey("Øvingsgruppe 5")).toBe("øvingsgruppe-5"));
  test("null and blank give null", () => {
    expect(groupKey(null)).toBeNull();
    expect(groupKey("  ")).toBeNull();
  });
  test("never emits the hash's ~ delimiter", () => {
    expect(groupKey("Forelesningsparallell~2")).toBe("forelesningsparallell-2");
  });
});

describe("groupOptions", () => {
  test("distinct names, lecture-first, with counts", () => {
    const opts = groupOptions([
      e("Forelesningsparallell 1"),
      e("Forelesningsparallell 1", { dayNumber: 3 }),
      e("Forelesningsparallell 2"),
      e("Øvingsgruppe 5"),
    ]);
    expect(opts.map((o) => o.key)).toEqual([
      "forelesningsparallell-1",
      "forelesningsparallell-2",
      "øvingsgruppe-5",
    ]);
    expect(opts[0]).toMatchObject({ kind: "lecture", entryCount: 2 });
    expect(opts[2]?.kind).toBe("other");
  });

  test("falls back to name when title is missing", () => {
    const opts = groupOptions([e(null, { name: "Forelesningsparallell 2" })]);
    expect(opts).toEqual([
      {
        key: "forelesningsparallell-2",
        label: "Forelesningsparallell 2",
        kind: "lecture",
        entryCount: 1,
      },
    ]);
  });

  test("numbered groups sort numerically, not lexically (groups-7/edit-6)", () => {
    // EXPH0300 publishes 39 seminar groups; string order put "Seminargruppe 2"
    // at position 12, behind 1, 10, 11 … 19.
    const opts = groupOptions([
      e("Seminargruppe 10 Trondheim"),
      e("Seminargruppe 2 Trondheim"),
      e("Seminargruppe 1 Trondheim"),
      e("Seminargruppe 20 Trondheim"),
    ]);
    expect(opts.map((o) => o.label)).toEqual([
      "Seminargruppe 1 Trondheim",
      "Seminargruppe 2 Trondheim",
      "Seminargruppe 10 Trondheim",
      "Seminargruppe 20 Trondheim",
    ]);
  });
});

describe("defaultLectureKeys", () => {
  const parallels = [
    e("Forelesningsparallell 1", { studyProgramKeys: ["MTDT"] }),
    e("Forelesningsparallell 2", { studyProgramKeys: ["MTKJ"] }),
    e("Forelesningsparallell 3", { studyProgramKeys: ["BIT"] }),
  ];
  test("programme match picks the programme's parallel", () => {
    expect(defaultLectureKeys(parallels, "MTKJ")).toEqual(["forelesningsparallell-2"]);
  });
  test("no programme falls back to the first parallel", () => {
    expect(defaultLectureKeys(parallels, null)).toEqual(["forelesningsparallell-1"]);
  });
  test("a single lecture stream needs no selection", () => {
    expect(defaultLectureKeys([e("Forelesning"), e(null)], "MTDT")).toEqual([]);
  });
  test("non-numbered, ambiguous lecture streams with no programme match resolve to no guess", () => {
    const streams = [e("Hovedforelesning"), e("Ekstraforelesning")];
    expect(defaultLectureKeys(streams, null)).toEqual([]);
    expect(defaultLectureKeys(streams, "MTDT")).toEqual([]);
  });

  test("the programme's own parallel is reported as resolved, a guess is not (groups-5)", () => {
    expect(resolveLectureDefaults(parallels, "MTKJ")).toEqual({
      keys: ["forelesningsparallell-2"],
      resolved: true,
      alternatives: [],
    });
    // Same data, no programme: the first parallel is drawn, but the caller is
    // told it is a guess so the surface can say "velg din".
    expect(resolveLectureDefaults(parallels, null)).toEqual({
      keys: ["forelesningsparallell-1"],
      resolved: false,
      alternatives: [
        "forelesningsparallell-1",
        "forelesningsparallell-2",
        "forelesningsparallell-3",
      ],
    });
  });

  test("campus parallels the programme is listed on both of stay unresolved (groups-5)", () => {
    // Live EXPH0300: BDIGSEC is on the Trondheim AND the Gjøvik parallel, so
    // entriesForProgram cannot narrow. Before, this returned [] and the week
    // silently drew two campuses' lectures with nothing marked.
    const exph = [
      e("Forelesningsparallell 1 Trondheim", { studyProgramKeys: ["BDIGSEC", "BPROG"] }),
      e("Forelesningsparallell 3 Gjøvik", { studyProgramKeys: ["BDIGSEC", "BPROG"] }),
    ];
    const resolution = resolveLectureDefaults(exph, "BDIGSEC");
    expect(resolution.resolved).toBe(false);
    expect(resolution.keys).toEqual(["forelesningsparallell-1-trondheim"]);
    expect(resolution.alternatives).toEqual([
      "forelesningsparallell-1-trondheim",
      "forelesningsparallell-3-gjøvik",
    ]);
  });
});

/**
 * A course's lecture entries are not all alternatives: some are different
 * weekly sessions the student attends all of. Fixtures are the real 2026
 * titles from `/api/course/<code>/timetable`.
 */
describe("defaultLectureKeys — sessions vs parallels", () => {
  test("two complementary weekly slots are both kept (week-2, IT2805)", () => {
    // "Forelesning 1" (Tuesday, A1) and "Forelesning 2" (Monday, R7) carry the
    // same programme keys — the digit heuristic used to drop the Monday one.
    const it2805 = [
      e("Forelesning 2", { dayNumber: 1, studyProgramKeys: ["MLREAL", "BIT", "MTDESIG"] }),
      e("Forelesning 1", { dayNumber: 2, studyProgramKeys: ["MLREAL", "BIT", "MTDESIG"] }),
    ];
    expect(resolveLectureDefaults(it2805, "BIT")).toEqual({
      keys: [],
      resolved: true,
      alternatives: [],
    });
    expect(applyGroupSelection(it2805, undefined, "BIT").map((x) => x.title)).toEqual([
      "Forelesning 2",
      "Forelesning 1",
    ]);
  });

  test("clock times in a title are not session numbers (week-2, TMR4106)", () => {
    const tmr4106 = [
      e("Forelesning introuke tirsdag kl. 08:15- 11:00", { weeks: ["34"] }),
      e("Forelesning morgen tirsdager kl. 08:15-10:00", { weeks: ["35-48"] }),
      e("Forelesning/prosjektbasert tirsdager kl.12:15-14:00", { weeks: ["35-47"] }),
    ];
    expect(defaultLectureKeys(tmr4106, "MTIØT")).toEqual([]);
    expect(applyGroupSelection(tmr4106, undefined, "MTIØT")).toHaveLength(3);
  });

  test("one session split across programme clusters is an alternative set (week-5, TMA4400)", () => {
    // MTIØT is named on three "Forelesning 1" and two "Forelesning 2" entries,
    // so the programme filter cannot narrow: the week drew all of them.
    const tma4400 = [
      e("Forelesning 1 MTELSYS & MTTK", { dayNumber: 1, studyProgramKeys: ["MTELSYS", "MTTK"] }),
      e("Forelesning 1 MTBYGG, MTING, MTIØT", {
        dayNumber: 1,
        startTime: "10:15",
        studyProgramKeys: ["MTBYGG", "MTING", "MTIØT"],
      }),
      e("Forelesning 1 MTDT, MTIØT, MTKOM", {
        dayNumber: 2,
        startTime: "10:15",
        studyProgramKeys: ["MTDT", "MTIØT", "MTKOM"],
      }),
      e("Forelesning 2 MTING, MTIØT, MTMART", {
        dayNumber: 3,
        startTime: "10:15",
        studyProgramKeys: ["MTING", "MTIØT", "MTMART"],
      }),
      e("Forelesning 2 MTIØT og MTMASKIN", {
        dayNumber: 3,
        startTime: "12:15",
        studyProgramKeys: ["MTIØT", "MTMASKIN"],
      }),
      e("Plenumsregning", { dayNumber: 3, startTime: "14:15" }),
      e("Mattelab 1", { dayNumber: 3, startTime: "12:15" }),
    ];
    const resolution = resolveLectureDefaults(tma4400, "MTIØT");
    expect(resolution.resolved).toBe(false);
    // One "Forelesning 1", one "Forelesning 2", plus the plenary session that
    // is nobody's alternative.
    expect(resolution.keys).toEqual([
      "forelesning-1-mtbygg-mting-mtiøt",
      "forelesning-2-mting-mtiøt-mtmart",
      "plenumsregning",
    ]);
    expect(resolution.alternatives).not.toContain("plenumsregning");
    expect(resolution.alternatives).toHaveLength(4);
    expect(applyGroupSelection(tma4400, undefined, "MTIØT").map((x) => x.title)).toEqual([
      "Forelesning 1 MTBYGG, MTING, MTIØT",
      "Forelesning 2 MTING, MTIØT, MTMART",
      "Plenumsregning",
      "Mattelab 1",
    ]);
  });
});

describe("applyGroupSelection", () => {
  const entries = [
    e(null),
    e("Forelesningsparallell 1", { studyProgramKeys: ["MTDT"] }),
    e("Forelesningsparallell 2", { studyProgramKeys: ["MTKJ"] }),
    e("Øvingsgruppe 5"),
    e("Øvingsgruppe 7"),
  ];
  test("default keeps ungrouped, the default parallel, and every øving group", () => {
    const kept = applyGroupSelection(entries, undefined, "MTDT").map((x) => x.title);
    expect(kept).toEqual([null, "Forelesningsparallell 1", "Øvingsgruppe 5", "Øvingsgruppe 7"]);
  });
  test("an explicit selection filters both kinds", () => {
    const kept = applyGroupSelection(
      entries,
      ["forelesningsparallell-2", "øvingsgruppe-7"],
      "MTDT",
    ).map((x) => x.title);
    expect(kept).toEqual([null, "Forelesningsparallell 2", "Øvingsgruppe 7"]);
  });

  test("an explicit pick of a parallel tagged for ANOTHER programme is kept (finding 1)", () => {
    // Programme MTDT is set, but the student explicitly picked
    // Forelesningsparallell 2 — tagged only for MTKJ. The explicit selection
    // must win over programme narrowing here, because this module is the single
    // owner of that narrowing: the caller no longer pre-narrows by programme, so
    // if this dropped the foreign-tagged pick the block the caller wrote to the
    // hash could never draw (the silent-vanish bug).
    const kept = applyGroupSelection(entries, ["forelesningsparallell-2"], "MTDT").map(
      (x) => x.title,
    );
    expect(kept).toContain("Forelesningsparallell 2");
    expect(kept).not.toContain("Forelesningsparallell 1");
  });

  test("default drops non-lecture groups tagged for another programme (no EXPH0300 flood)", () => {
    // A multi-programme service course: the øving/lab layer is programme-tagged
    // too. By default only the programme's own (and untagged) non-lecture groups
    // survive — not every programme's, which was the flood F1's pre-narrow drop
    // briefly re-opened.
    const service = [
      e("Forelesning", { studyProgramKeys: ["MTDT"] }),
      e("Øvingsgruppe 5", { studyProgramKeys: ["MTDT"] }),
      e("Øvingsgruppe 9", { studyProgramKeys: ["MTKJ"] }),
      e("Øvingsgruppe 1"), // untagged — everyone's
    ];
    const kept = applyGroupSelection(service, undefined, "MTDT").map((x) => x.title);
    expect(kept).toEqual(["Forelesning", "Øvingsgruppe 5", "Øvingsgruppe 1"]);
  });

  test("an explicit non-lecture pick tagged for another programme is still kept", () => {
    // A student who deliberately selects a foreign-tagged øving group keeps it,
    // programme filter notwithstanding — and the lecture layer, which has no
    // pick of its own, keeps its default (this assertion used to
    // demand the lecture be dropped, which was the bug).
    const service = [
      e("Forelesning", { studyProgramKeys: ["MTDT"] }),
      e("Øvingsgruppe 9", { studyProgramKeys: ["MTKJ"] }),
    ];
    const kept = applyGroupSelection(service, ["øvingsgruppe-9"], "MTDT").map((x) => x.title);
    expect(kept).toEqual(["Forelesning", "Øvingsgruppe 9"]);
  });

  test("ticking an øving group does not delete the course's lectures (groups-1)", () => {
    // Live TDT4120: one lecture group, two øving-kind groups. Ticking the first
    // checkbox wrote ["øvingsforelesning"] and the flat allow-list then filtered
    // the Friday lecture out of the week — while the verdict still read
    // "ingen kollisjoner".
    const tdt4120 = [
      e("Forelesning", { dayNumber: 5, startTime: "12:15" }),
      e("Øvingsforelesning", { dayNumber: 3 }),
      e("Øvingsveiledning", { dayNumber: 4 }),
    ];
    const kept = applyGroupSelection(tdt4120, ["øvingsforelesning"], "MTDT").map((x) => x.title);
    expect(kept).toEqual(["Forelesning", "Øvingsforelesning"]);
  });

  test("picking a lecture parallel does not delete the øving layer (groups-1, mirror)", () => {
    const tma4412 = [
      e("Forelesningsparallell 1", { studyProgramKeys: ["MTDT"] }),
      e("Forelesningsparallell 2", { studyProgramKeys: ["MTKJ"] }),
      e("Mattelab 1"),
      e("Mattelab 2"),
    ];
    const kept = applyGroupSelection(tma4412, ["forelesningsparallell-2"], "MTDT").map(
      (x) => x.title,
    );
    expect(kept).toEqual(["Forelesningsparallell 2", "Mattelab 1", "Mattelab 2"]);
  });

  test("a stored key that matches no entry degrades to the default, not to nothing (store-5)", () => {
    // #26h;-;+TDT4136~forelesning-3 — NTNU retitled the groups (they are English
    // now), so the shared key matches nothing. The week drew zero blocks and the
    // page then claimed NTNU had no timetable data.
    const tdt4136 = [
      e("Main lecture", { dayNumber: 1 }),
      e("Assignment lecture", { dayNumber: 2 }),
      e("Lab hour for assignments 1-4", { dayNumber: 3 }),
    ];
    const kept = applyGroupSelection(tdt4136, ["forelesning-3"], null).map((x) => x.title);
    expect(kept).toEqual(["Main lecture", "Assignment lecture", "Lab hour for assignments 1-4"]);
  });

  test("a stale key alongside a live one only narrows the kind it matches (store-5)", () => {
    const entries = [
      e("Forelesningsparallell 1", { studyProgramKeys: ["MTDT"] }),
      e("Forelesningsparallell 2", { studyProgramKeys: ["MTKJ"] }),
      e("Øvingsgruppe 5"),
      e("Øvingsgruppe 7"),
    ];
    const kept = applyGroupSelection(entries, ["forelesningsparallell-9", "øvingsgruppe-7"], "MTDT")
      .map((x) => x.title)
      .sort();
    // The unknown lecture key falls back to the programme default; the live
    // øving key still narrows its own layer.
    expect(kept).toEqual(["Forelesningsparallell 1", "Øvingsgruppe 7"]);
  });

  test("default keeps the lone lecture group when there is only one", () => {
    const solo = [e(null), e("Forelesning")];
    const kept = applyGroupSelection(solo, undefined, "MTDT").map((x) => x.title);
    expect(kept).toEqual([null, "Forelesning"]);
  });

  test("an explicit lecture pick narrows its own session only (groups-2)", () => {
    // TMA4400 as MTDT: "Forelesning 1 …" (tir), "Forelesning 2 …" (tor) and
    // "Plenumsregning" (ons) are three weekly sessions the student attends all
    // of, and the MTBYGG entries are alternatives to the first two. A flat
    // allow-list made ticking one of them delete the other two sessions —
    // exactly the loss the default branch's session families exist to prevent.
    const tma4400 = [
      e("Forelesning 1 MTDT, MTIØT, MTKOM", { dayNumber: 2, studyProgramKeys: ["MTDT"] }),
      e("Forelesning 1 MTBYGG, MTING", { dayNumber: 1, studyProgramKeys: ["MTBYGG"] }),
      e("Forelesning 2 MTIØT, MTKOM, MTDT", { dayNumber: 4, studyProgramKeys: ["MTDT"] }),
      e("Forelesning 2 MTBYGG", {
        dayNumber: 3,
        startTime: "08:15",
        studyProgramKeys: ["MTBYGG"],
      }),
      e("Plenumsregning", { dayNumber: 3, startTime: "14:15" }),
    ];
    const drawn = (selected: string[] | undefined) =>
      applyGroupSelection(tma4400, selected, "MTDT").map((x) => x.title);

    expect(drawn(["forelesning-1-mtdt-mtiøt-mtkom"])).toEqual([
      "Forelesning 1 MTDT, MTIØT, MTKOM",
      "Forelesning 2 MTIØT, MTKOM, MTDT",
      "Plenumsregning",
    ]);
    // The pick still beats the programme filter inside its own family: the
    // MTBYGG variant of "Forelesning 1" replaces MTDT's, and only that one.
    expect(drawn(["forelesning-2-mtbygg"])).toEqual([
      "Forelesning 1 MTDT, MTIØT, MTKOM",
      "Forelesning 2 MTBYGG",
      "Plenumsregning",
    ]);
    // Two picks answer two families; the plenary still has none and keeps its
    // default.
    expect(drawn(["forelesning-1-mtbygg-mting", "forelesning-2-mtbygg"])).toEqual([
      "Forelesning 1 MTBYGG, MTING",
      "Forelesning 2 MTBYGG",
      "Plenumsregning",
    ]);
  });

  test("bare-numbered complementary lectures survive a pick of one (groups-2, IT2805)", () => {
    // "Forelesning 1" (tir) and "Forelesning 2" (man) are two weekly slots with
    // identical programme keys — each is its own session family, so picking one
    // must not take the other with it.
    const it2805 = [
      e("Forelesning 2", { dayNumber: 1, studyProgramKeys: ["BIT"] }),
      e("Forelesning 1", { dayNumber: 2, studyProgramKeys: ["BIT"] }),
    ];
    expect(applyGroupSelection(it2805, ["forelesning-1"], "BIT").map((x) => x.title)).toEqual([
      "Forelesning 2",
      "Forelesning 1",
    ]);
  });

  test("genuine alternatives in one family still replace each other", () => {
    // TDT4110's three parallels share the family "forelesningsparallell", so a
    // pick there is still the whole layer — the per-family rule must not turn
    // every lecture list into an additive pile.
    const tdt4110 = [
      e("Forelesningsparallell 1", { dayNumber: 1 }),
      e("Forelesningsparallell 2", { dayNumber: 3 }),
      e("Forelesningsparallell 3", { dayNumber: 5 }),
    ];
    expect(
      applyGroupSelection(tdt4110, ["forelesningsparallell-2"], null).map((x) => x.title),
    ).toEqual(["Forelesningsparallell 2"]);
  });

  test("a lecture entry tagged only for a different programme is dropped by default even with no ambiguity", () => {
    const soloOtherProgramme = [
      e("Forelesning", { studyProgramKeys: ["OTHERPROG"] }),
      e("Øvingsgruppe 1", { studyProgramKeys: ["MTDT"] }),
    ];
    const kept = applyGroupSelection(soloOtherProgramme, undefined, "MTDT").map((x) => x.title);
    expect(kept).toEqual(["Øvingsgruppe 1"]);
  });
});
