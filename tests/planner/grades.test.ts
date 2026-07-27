import { describe, expect, test } from "vitest";
import {
  buildGradeSemesters,
  type GradeRowInput,
  peakPercent,
} from "../../src/lib/planner/grades.js";

const row = (over: Partial<GradeRowInput> = {}): GradeRowInput => ({
  courseCode: "TDT4100-1",
  year: 2024,
  semester: 1,
  semesterName: "Vår",
  grade: "A",
  total: 10,
  ...over,
});

describe("buildGradeSemesters", () => {
  test("groups rows into one bucket per (year, semester) with percentages", () => {
    const model = buildGradeSemesters([
      row({ grade: "A", total: 25 }),
      row({ grade: "B", total: 50 }),
      row({ grade: "F", total: 25 }),
    ]);
    expect(model).toHaveLength(1);
    expect(model[0]?.label).toBe("Vår 2024");
    expect(model[0]?.candidates).toBe(100);
    expect(model[0]?.bars.map((b) => [b.grade, b.percent])).toEqual([
      ["A", 25],
      ["B", 50],
      ["F", 25],
    ]);
  });

  test("sums counts across DBH course versions rather than overwriting them", () => {
    // The same (year, semester, grade) reported once per version — a candidate
    // sat the course, not a version of it.
    const model = buildGradeSemesters([
      row({ courseCode: "TDT4100-1", grade: "A", total: 30 }),
      row({ courseCode: "TDT4100-2", grade: "A", total: 10 }),
    ]);
    expect(model[0]?.bars).toHaveLength(1);
    expect(model[0]?.bars[0]?.count).toBe(40);
    expect(model[0]?.candidates).toBe(40);
  });

  test("a privacy-masked count is not a zero — it leaves the percentage base", () => {
    const model = buildGradeSemesters([
      row({ grade: "A", total: 30 }),
      row({ grade: "B", total: 10 }),
      row({ grade: "F", total: null }),
    ]);
    expect(model[0]?.masked).toBe(1);
    expect(model[0]?.candidates).toBe(40);
    // No F bar at all, rather than an F bar asserting 0 %.
    expect(model[0]?.bars.map((b) => b.grade)).toEqual(["A", "B"]);
    expect(model[0]?.bars[0]?.percent).toBe(75);
  });

  test("a semester whose every cell is masked is dropped, not drawn as empty", () => {
    const model = buildGradeSemesters([
      row({ year: 2023, grade: "A", total: null }),
      row({ year: 2023, grade: "B", total: null }),
    ]);
    expect(model).toEqual([]);
  });

  test("orders semesters newest first, autumn after spring within a year", () => {
    const model = buildGradeSemesters([
      row({ year: 2023, semester: 1, semesterName: "Vår" }),
      row({ year: 2024, semester: 3, semesterName: "Høst" }),
      row({ year: 2024, semester: 1, semesterName: "Vår" }),
      row({ year: 2023, semester: 3, semesterName: "Høst" }),
    ]);
    expect(model.map((s) => s.label)).toEqual(["Høst 2024", "Vår 2024", "Høst 2023", "Vår 2023"]);
  });

  test("falls back to DBH's numeric semester codes when the name is absent", () => {
    const model = buildGradeSemesters([
      row({ semesterName: null, semester: 3 }),
      row({ year: 2023, semesterName: null, semester: 1 }),
    ]);
    expect(model.map((s) => s.label)).toEqual(["Høst 2024", "Vår 2023"]);
  });

  test("sorts A–F in scale order regardless of input order", () => {
    const model = buildGradeSemesters([
      row({ grade: "F" }),
      row({ grade: "C" }),
      row({ grade: "A" }),
      row({ grade: "E" }),
    ]);
    expect(model[0]?.bars.map((b) => b.grade)).toEqual(["A", "C", "E", "F"]);
  });

  test("a pass/fail course still renders — non-letter codes sort after letters", () => {
    const model = buildGradeSemesters([
      row({ grade: "H", total: 20 }),
      row({ grade: "G", total: 80 }),
    ]);
    expect(model[0]?.bars.map((b) => b.grade)).toEqual(["G", "H"]);
    expect(model[0]?.bars[0]?.percent).toBe(80);
  });

  test("limit keeps the most recent semesters", () => {
    const rows = [2020, 2021, 2022, 2023, 2024].map((year) => row({ year }));
    const model = buildGradeSemesters(rows, 2);
    expect(model.map((s) => s.year)).toEqual([2024, 2023]);
  });

  test("empty input returns an empty model", () => {
    expect(buildGradeSemesters([])).toEqual([]);
  });
});

describe("peakPercent", () => {
  test("is the tallest bar across every semester — the shared y-scale", () => {
    const model = buildGradeSemesters([
      row({ year: 2024, grade: "A", total: 90 }),
      row({ year: 2024, grade: "B", total: 10 }),
      row({ year: 2023, grade: "A", total: 50 }),
      row({ year: 2023, grade: "B", total: 50 }),
    ]);
    expect(peakPercent(model)).toBe(90);
  });

  test("is 0 for an empty model, so the caller never divides by it", () => {
    expect(peakPercent([])).toBe(0);
  });
});
