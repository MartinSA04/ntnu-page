import { describe, expect, test } from "vitest";
import type { TimetableEntry } from "../../src/lib/planner/data.js";
import {
  applyGroupSelection,
  defaultLectureKeys,
  groupKey,
  groupOptions,
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
    // The explicit branch is unchanged: a student who deliberately selects a
    // foreign-tagged øving group keeps it, programme filter notwithstanding.
    const service = [
      e("Forelesning", { studyProgramKeys: ["MTDT"] }),
      e("Øvingsgruppe 9", { studyProgramKeys: ["MTKJ"] }),
    ];
    const kept = applyGroupSelection(service, ["øvingsgruppe-9"], "MTDT").map((x) => x.title);
    expect(kept).toContain("Øvingsgruppe 9");
    expect(kept).not.toContain("Forelesning");
  });

  test("default keeps the lone lecture group when there is only one", () => {
    const solo = [e(null), e("Forelesning")];
    const kept = applyGroupSelection(solo, undefined, "MTDT").map((x) => x.title);
    expect(kept).toEqual([null, "Forelesning"]);
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
