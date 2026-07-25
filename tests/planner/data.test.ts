import { describe, expect, it } from "vitest";
import {
  academicYearOf,
  examsFromIndex,
  indexCoversSemester,
  indexForSemester,
  type PlannerIndex,
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

/** A search-index row. Elements 4/5 (version, offeredYears) came with the two-year crawl. */
function course(exams: PlannerIndexCourse[3], code = "TDT4100"): PlannerIndexCourse {
  return [code, "Objektorientert programmering", "Trondheim", exams, "1", [2026, 2025]];
}

describe("academicYearOf", () => {
  it("puts an autumn and the following spring in one academic year", () => {
    expect(academicYearOf("26h")).toBe(2026);
    expect(academicYearOf("27v")).toBe(2026);
  });

  it("returns null for a malformed id", () => {
    expect(academicYearOf("banana")).toBeNull();
  });
});

describe("indexCoversSemester", () => {
  const index: PlannerIndex = { year: 2026, courses: [] };

  it("covers the crawl year's own autumn and the following spring", () => {
    expect(indexCoversSemester(index, "26h")).toBe(true);
    expect(indexCoversSemester(index, "27v")).toBe(true);
  });

  it("does not cover the next academic year — that is where borrowed dates came from (C3)", () => {
    expect(indexCoversSemester(index, "27h")).toBe(false);
    expect(indexCoversSemester(index, "28v")).toBe(false);
  });

  it("is false without an index", () => {
    expect(indexCoversSemester(null, "26h")).toBe(false);
  });
});

describe("examsFromIndex", () => {
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

describe("examsFromIndex — the semester's own window (C3)", () => {
  // Straight out of data/semesters.json.
  const window26h = { fromDate: "2026-07-27", examFinalDate: "2027-02-28" };
  const window27h = { fromDate: "2027-07-26", examFinalDate: "2028-02-28" };

  it("keeps an exam inside the window", () => {
    const c = course([["AUTUMN", "2026-12-10"]]);
    expect(examsFromIndex(c, "26h", window26h)).toEqual([{ code: "TDT4100", date: "2026-12-10" }]);
  });

  it("keeps the January spill an autumn semester really has", () => {
    const c = course([["AUTUMN", "2027-01-09"]]);
    expect(examsFromIndex(c, "26h", window26h)).toEqual([{ code: "TDT4100", date: "2027-01-09" }]);
  });

  it("refuses to lend Høst 2026's dates to Høst 2027 — the C3 defect", () => {
    const c = course([["AUTUMN", "2027-01-09"]]);
    // Season matches, so the old season-only filter presented this as 27h's.
    expect(examsFromIndex(c, "27h")).toEqual([{ code: "TDT4100", date: "2027-01-09" }]);
    expect(examsFromIndex(c, "27h", window27h)).toEqual([]);
  });

  it("still keeps a dateless exam: it carries no year to be wrong about", () => {
    const c = course([["AUTUMN", null]]);
    expect(examsFromIndex(c, "27h", window27h)).toEqual([{ code: "TDT4100", date: null }]);
  });
});

describe("indexForSemester", () => {
  const index: PlannerIndex = {
    year: 2026,
    courses: [
      course([["AUTUMN", "2026-12-10"]], "TDT4100"),
      course([["AUTUMN", "2027-01-09"]], "TDT4109"),
      course([["SPRING", "2027-05-20"]], "TMA4100"),
      course([], "EXPH0300"),
    ],
  };
  const window26h = { fromDate: "2026-07-27", examFinalDate: "2027-02-28" };
  const window27h = { fromDate: "2027-07-26", examFinalDate: "2028-02-28" };

  it("narrows every row to the semester's season and window", () => {
    const narrowed = indexForSemester(index, "26h", window26h);
    expect(narrowed.courses.map((c) => [c[0], c[3].length])).toEqual([
      ["TDT4100", 1],
      ["TDT4109", 1],
      ["TMA4100", 0],
      ["EXPH0300", 0],
    ]);
  });

  it("leaves nothing to borrow when the semester is outside the crawl year", () => {
    const narrowed = indexForSemester(index, "27h", window27h);
    expect(narrowed.courses.every((c) => c[3].length === 0)).toBe(true);
  });

  it("preserves code, name, location, version and offeredYears", () => {
    const row = indexForSemester(index, "27v", null).courses[2];
    expect(row).toEqual([
      "TMA4100",
      "Objektorientert programmering",
      "Trondheim",
      [["SPRING", "2027-05-20"]],
      "1",
      [2026, 2025],
    ]);
  });

  it("hands back the original row when nothing was filtered out (no needless copies)", () => {
    const narrowed = indexForSemester(index, "26h", window26h);
    expect(narrowed.courses[0]).toBe(index.courses[0]);
    expect(narrowed.courses[3]).toBe(index.courses[3]);
  });

  it("keeps the index year, so indexCoversSemester still answers correctly", () => {
    expect(indexForSemester(index, "27h", window27h).year).toBe(2026);
  });
});
