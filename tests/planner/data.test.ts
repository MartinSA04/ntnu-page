import { describe, expect, it } from "vitest";
import {
  examsFromIndex,
  type PlannerIndexCourse,
  seasonForSemesterId,
} from "../../src/lib/planner/data.js";

describe("seasonForSemesterId", () => {
  it("maps an autumn id to AUTUMN", () => {
    expect(seasonForSemesterId("26h")).toBe("AUTUMN");
  });

  it("maps a spring id to SPRING", () => {
    expect(seasonForSemesterId("27v")).toBe("SPRING");
  });

  it("is case-insensitive", () => {
    expect(seasonForSemesterId("27V")).toBe("SPRING");
    expect(seasonForSemesterId("26H")).toBe("AUTUMN");
  });

  it("returns null for a malformed id", () => {
    expect(seasonForSemesterId("2026h")).toBeNull();
    expect(seasonForSemesterId("26s")).toBeNull(); // summer: not h/v
    expect(seasonForSemesterId("")).toBeNull();
  });
});

describe("examsFromIndex", () => {
  function course(exams: PlannerIndexCourse[3]): PlannerIndexCourse {
    return ["TDT4100", "Objektorientert programmering", "Trondheim", exams];
  }

  it("keeps only exams matching the semester's season", () => {
    const c = course([
      ["AUTUMN", "2026-12-10"],
      ["SPRING", "2027-05-20"],
    ]);
    expect(examsFromIndex(c, "26h")).toEqual([{ code: "TDT4100", date: "2026-12-10" }]);
    expect(examsFromIndex(c, "27v")).toEqual([{ code: "TDT4100", date: "2027-05-20" }]);
  });

  it("keeps an autumn exam dated into the following January/February (season match, not calendar year)", () => {
    // 26h's examLastDate in semesters.json is 2027-02-01 -- autumn exams
    // regularly fall in the next calendar year.
    const c = course([["AUTUMN", "2027-01-15"]]);
    expect(examsFromIndex(c, "26h")).toEqual([{ code: "TDT4100", date: "2027-01-15" }]);
  });

  it("keeps a dateless exam (does not drop it) so callers can render 'dato ikke satt'", () => {
    const c = course([["AUTUMN", null]]);
    expect(examsFromIndex(c, "26h")).toEqual([{ code: "TDT4100", date: null }]);
  });

  it("returns [] when no exam matches the season", () => {
    const c = course([["SPRING", "2027-05-20"]]);
    expect(examsFromIndex(c, "26h")).toEqual([]);
  });

  it("returns [] for a course with no exams", () => {
    expect(examsFromIndex(course([]), "26h")).toEqual([]);
  });

  it("returns [] for a malformed semesterId", () => {
    const c = course([["AUTUMN", "2026-12-10"]]);
    expect(examsFromIndex(c, "not-a-semester")).toEqual([]);
  });

  it("handles multiple exams in the same season (rare but not impossible)", () => {
    const c = course([
      ["AUTUMN", "2026-11-01"],
      ["AUTUMN", "2026-12-15"],
    ]);
    expect(examsFromIndex(c, "26h")).toEqual([
      { code: "TDT4100", date: "2026-11-01" },
      { code: "TDT4100", date: "2026-12-15" },
    ]);
  });
});
