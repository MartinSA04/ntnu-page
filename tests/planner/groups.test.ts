import { describe, expect, test } from "vitest";
import type { TimetableEntry } from "../../src/lib/planner/data.js";
import {
  applyGroupSelection,
  defaultLectureKeys,
  groupKey,
  groupOptions,
} from "../../src/lib/planner/groups.js";

const e = (name: string | null, over: Partial<TimetableEntry> = {}): TimetableEntry => ({
  courseCode: "TDT4110",
  courseName: { nob: null, nno: null, eng: null },
  dayNumber: 1,
  startTime: "10:15",
  endTime: "12:00",
  weeks: ["34-47"],
  rooms: [],
  title: null,
  name,
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
    const kept = applyGroupSelection(entries, undefined, "MTDT").map((x) => x.name);
    expect(kept).toEqual([null, "Forelesningsparallell 1", "Øvingsgruppe 5", "Øvingsgruppe 7"]);
  });
  test("an explicit selection filters both kinds", () => {
    const kept = applyGroupSelection(
      entries,
      ["forelesningsparallell-2", "øvingsgruppe-7"],
      "MTDT",
    ).map((x) => x.name);
    expect(kept).toEqual([null, "Forelesningsparallell 2", "Øvingsgruppe 7"]);
  });
});
