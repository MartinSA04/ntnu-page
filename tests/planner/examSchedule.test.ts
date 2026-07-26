import { describe, expect, it } from "vitest";
import { buildExamList } from "../../src/lib/planner/examSchedule.js";

describe("buildExamList", () => {
  it("sorts dated exams chronologically and computes whole-day gaps", () => {
    const model = buildExamList(
      [
        { code: "B", date: "2026-12-01" },
        { code: "A", date: "2026-11-26" },
      ],
      "2026-01-01",
    );
    expect(model.rows.map((r) => r.code)).toEqual(["A", "B"]);
    expect(model.rows[0]?.gapToNext).toBe(5);
    expect(model.rows[1]?.gapToNext).toBeNull();
  });

  it("flags tight at a 2-day gap, not at a 3-day gap", () => {
    const gap2 = buildExamList(
      [
        { code: "A", date: "2026-11-26" },
        { code: "B", date: "2026-11-28" },
      ],
      "2026-01-01",
    );
    expect(gap2.rows[0]?.gapToNext).toBe(2);
    expect(gap2.rows[0]?.tight).toBe(true);

    const gap3 = buildExamList(
      [
        { code: "A", date: "2026-11-26" },
        { code: "B", date: "2026-11-29" },
      ],
      "2026-01-01",
    );
    expect(gap3.rows[0]?.gapToNext).toBe(3);
    expect(gap3.rows[0]?.tight).toBe(false);
  });

  it("the last dated row always has gapToNext null and tight false", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-11-26" },
        { code: "B", date: "2026-12-01" },
      ],
      "2026-01-01",
    );
    expect(model.rows[1]?.gapToNext).toBeNull();
    expect(model.rows[1]?.tight).toBe(false);
  });

  it("flags sameDay on both rows of a 0-gap pair (gapToNext 0, tight)", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-11-26" },
        { code: "B", date: "2026-11-26" },
      ],
      "2026-01-01",
    );
    expect(model.rows[0]?.sameDay).toBe(true);
    expect(model.rows[1]?.sameDay).toBe(true);
    expect(model.rows[0]?.gapToNext).toBe(0);
    expect(model.rows[0]?.tight).toBe(true);
  });

  it("does not flag sameDay on rows with distinct dates", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-11-26" },
        { code: "B", date: "2026-12-01" },
      ],
      "2026-01-01",
    );
    expect(model.rows[0]?.sameDay).toBe(false);
    expect(model.rows[1]?.sameDay).toBe(false);
  });

  it("sets daysFromToday only on the first row with date >= today", () => {
    const model = buildExamList(
      [
        { code: "PAST", date: "2026-01-01" },
        { code: "NOW", date: "2026-01-10" },
        { code: "FUTURE", date: "2026-01-20" },
      ],
      "2026-01-05",
    );
    expect(model.rows.map((r) => r.daysFromToday)).toEqual([null, 5, null]);
  });

  it("treats today itself as upcoming (date >= today is inclusive)", () => {
    const model = buildExamList(
      [
        { code: "PAST", date: "2026-01-01" },
        { code: "TODAY", date: "2026-01-10" },
      ],
      "2026-01-10",
    );
    expect(model.rows.map((r) => r.daysFromToday)).toEqual([null, 0]);
  });

  it("an all-past list has no row with daysFromToday set", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-01-01" },
        { code: "B", date: "2026-01-02" },
      ],
      "2026-06-01",
    );
    expect(model.rows.every((r) => r.daysFromToday === null)).toBe(true);
  });

  it("keeps dateless codes in input order, apart from rows and out of summary math", () => {
    const model = buildExamList(
      [
        { code: "Z", date: null },
        { code: "A", date: "2026-11-26" },
        { code: "Y", date: null },
      ],
      "2026-01-01",
    );
    expect(model.dateless).toEqual(["Z", "Y"]);
    expect(model.rows.map((r) => r.code)).toEqual(["A"]);
    expect(model.summary).toBe("1 eksamen");
  });

  it("summary is singular for one dated exam, with no 'over' clause", () => {
    const model = buildExamList([{ code: "A", date: "2026-11-26" }], "2026-01-01");
    expect(model.summary).toBe("1 eksamen");
  });

  it("summary is plural 'N eksamener over M dager' spanning first to last dated row", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-11-26" },
        { code: "B", date: "2026-12-01" },
        { code: "C", date: "2026-12-10" },
        { code: "D", date: "2026-12-10" },
      ],
      "2026-01-01",
    );
    expect(model.summary).toBe("4 eksamener over 14 dager");
  });

  it("a same-day pair summarizes as spanning 0 days", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-11-26" },
        { code: "B", date: "2026-11-26" },
      ],
      "2026-01-01",
    );
    expect(model.summary).toBe("2 eksamener over 0 dager");
  });

  it("returns the empty model for no exams", () => {
    expect(buildExamList([], "2026-01-01")).toEqual({ summary: null, rows: [], dateless: [] });
  });

  it("summary is null when every input is dateless", () => {
    const model = buildExamList(
      [
        { code: "A", date: null },
        { code: "B", date: null },
      ],
      "2026-01-01",
    );
    expect(model.summary).toBeNull();
    expect(model.dateless).toEqual(["A", "B"]);
  });

  it("computes the correct 2-letter Norwegian weekday for a known date", () => {
    const model = buildExamList([{ code: "A", date: "2026-11-26" }], "2026-01-01");
    expect(model.rows[0]?.weekday).toBe("to");
  });
});
