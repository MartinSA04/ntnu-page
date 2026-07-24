import { describe, expect, it } from "vitest";
import {
  entriesForProgram,
  entriesInSemester,
  parseWeeks,
  semesterYear,
  toMinutes,
} from "../../src/lib/planner/schedule.js";

describe("parseWeeks", () => {
  it("expands a simple range", () => {
    expect(parseWeeks(["2-13"])).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("parses a single week", () => {
    expect(parseWeeks(["15"])).toEqual([15]);
  });

  it("merges ranges and singles, deduplicated and sorted", () => {
    expect(parseWeeks(["2-4", "3", "10", "8-9"])).toEqual([2, 3, 4, 8, 9, 10]);
  });

  it("returns [] for an empty list", () => {
    expect(parseWeeks([])).toEqual([]);
  });

  it("skips malformed tokens", () => {
    expect(parseWeeks(["abc", "", "5"])).toEqual([5]);
  });

  it("skips a reversed range", () => {
    expect(parseWeeks(["13-2"])).toEqual([]);
  });

  it("handles a single-week range (start === end)", () => {
    expect(parseWeeks(["7-7"])).toEqual([7]);
  });
});

describe("toMinutes", () => {
  it("parses HH:MM", () => {
    expect(toMinutes("10:15")).toBe(615);
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("23:59")).toBe(1439);
  });

  it("parses single-digit hours", () => {
    expect(toMinutes("9:05")).toBe(545);
  });

  it("returns null for malformed input", () => {
    expect(toMinutes("not-a-time")).toBeNull();
    expect(toMinutes("25:00")).toBeNull();
    expect(toMinutes("10:60")).toBeNull();
    expect(toMinutes("")).toBeNull();
  });
});

describe("semesterYear", () => {
  it("reads the 4-digit year from an autumn id", () => {
    expect(semesterYear("26h")).toBe(2026);
  });

  it("reads the 4-digit year from a spring id, case-insensitively", () => {
    expect(semesterYear("27V")).toBe(2027);
  });

  it("returns null for malformed ids", () => {
    expect(semesterYear("2026h")).toBeNull();
    expect(semesterYear("26x")).toBeNull();
    expect(semesterYear("")).toBeNull();
  });
});

describe("entriesInSemester", () => {
  const entry = (code: string, weeks: string[]) => ({
    courseCode: code,
    dayNumber: 1,
    startTime: "10:15",
    endTime: "12:00",
    weeks,
  });

  it("keeps entries whose weeks intersect the teaching weeks", () => {
    const entries = [entry("A", ["34-40"])];
    expect(entriesInSemester(entries, [39, 40, 41])).toEqual(entries);
  });

  it("drops entries with an empty intersection (not taught this semester)", () => {
    const entries = [entry("A", ["1-13"])];
    expect(entriesInSemester(entries, [34, 35, 36])).toEqual([]);
  });

  it("returns [] when given no entries", () => {
    expect(entriesInSemester([], [34, 35])).toEqual([]);
  });

  it("returns [] when the semester has no teaching weeks", () => {
    expect(entriesInSemester([entry("A", ["34-40"])], [])).toEqual([]);
  });

  it("keeps only the matching entries out of several", () => {
    const inSem = entry("A", ["34-40"]);
    const notInSem = entry("B", ["1-13"]);
    expect(entriesInSemester([inSem, notInSem], [34, 35])).toEqual([inSem]);
  });
});

describe("entriesForProgram", () => {
  const e = (keys: string[] | undefined) => ({
    courseCode: "TMA4400",
    dayNumber: 1,
    startTime: "08:15",
    endTime: "10:00",
    weeks: ["34-47"],
    studyProgramKeys: keys,
  });

  it("keeps only own-programme + programme-less sections when the programme is named", () => {
    const entries = [e(["MTDT", "MTKOM"]), e(["MTBYGG"]), e([]), e(undefined)];
    const out = entriesForProgram(entries, "MTDT");
    expect(out).toHaveLength(3);
    expect(out.some((x) => x.studyProgramKeys?.includes("MTBYGG"))).toBe(false);
  });

  it("keeps everything when no entry names the programme (course outside programme)", () => {
    const entries = [e(["MTBYGG"]), e(["MTING"])];
    expect(entriesForProgram(entries, "MTDT")).toHaveLength(2);
  });

  it("keeps everything without a programme context", () => {
    const entries = [e(["MTBYGG"]), e([])];
    expect(entriesForProgram(entries, undefined)).toHaveLength(2);
    expect(entriesForProgram(entries, null)).toHaveLength(2);
  });
});
