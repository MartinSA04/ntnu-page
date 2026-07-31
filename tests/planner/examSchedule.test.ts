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

  // The cases below came over from `analyzeExams`, the dead second engine
  // deleted under /. Its threshold was `gapDays === 1` set on
  // BOTH rows; this module's is `gap <= 2` on the earlier row only, and these
  // pin that difference so the surviving rule cannot drift back.
  it("flags a 1-day gap as tight on the earlier row only, and not as sameDay", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-12-05" },
        { code: "B", date: "2026-12-06" },
      ],
      "2026-01-01",
    );
    expect(model.rows[0]?.gapToNext).toBe(1);
    expect(model.rows.map((r) => r.tight)).toEqual([true, false]);
    expect(model.rows.map((r) => r.sameDay)).toEqual([false, false]);
  });

  it("a 2-day gap is tight but never sameDay", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-12-05" },
        { code: "B", date: "2026-12-07" },
      ],
      "2026-01-01",
    );
    expect(model.rows[0]?.gapToNext).toBe(2);
    expect(model.rows[0]?.tight).toBe(true);
    expect(model.rows.every((r) => !r.sameDay)).toBe(true);
  });

  it("computes gaps across a chain of exams", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-12-01" },
        { code: "B", date: "2026-12-03" },
        { code: "C", date: "2026-12-10" },
      ],
      "2026-01-01",
    );
    expect(model.rows.map((r) => r.gapToNext)).toEqual([2, 7, null]);
    expect(model.rows.map((r) => r.tight)).toEqual([true, false, false]);
  });

  it("keeps multiple exams for the same course as separate rows", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-12-05" },
        { code: "A", date: "2026-05-15" },
      ],
      "2026-01-01",
    );
    expect(model.rows.map((r) => r.date)).toEqual(["2026-05-15", "2026-12-05"]);
    expect(model.rows.every((r) => r.code === "A")).toBe(true);
  });

  it("treats an empty-string date as dateless, not as a row with NaN gaps", () => {
    const model = buildExamList(
      [
        { code: "A", date: "" },
        { code: "B", date: "2026-12-05" },
      ],
      "2026-01-01",
    );
    expect(model.dateless).toEqual(["A"]);
    expect(model.rows.map((r) => r.code)).toEqual(["B"]);
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

  it("flags sameDay on all three rows of a 3-way same-day clash", () => {
    const model = buildExamList(
      [
        { code: "A", date: "2026-11-26" },
        { code: "B", date: "2026-11-26" },
        { code: "C", date: "2026-11-26" },
      ],
      "2026-01-01",
    );
    expect(model.rows.map((r) => r.sameDay)).toEqual([true, true, true]);
    // Only the earlier row of each adjacent pair carries gapToNext 0, so the old
    // `gapToNext === 0` count read 2 for this 3-way. examList.ts's verdict counts
    // rows sharing a day (`sameDay`), so it reads "3 eksamener samme dag" — the
    // actual same-day row count.
    expect(model.rows.map((r) => r.gapToNext)).toEqual([0, 0, null]);
    expect(model.rows.filter((r) => r.sameDay).length).toBe(3);
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

  it("marks rows strictly before today as past, and today itself as not past", () => {
    const model = buildExamList(
      [
        { code: "SAT", date: "2026-01-01" },
        { code: "TODAY", date: "2026-01-10" },
        { code: "SOON", date: "2026-01-20" },
      ],
      "2026-01-10",
    );
    expect(model.rows.map((r) => r.past)).toEqual([true, false, false]);
  });

  it("gives a caller enough to drop clash ink between two exams already sat", () => {
    // 's live repro: on 11. des, the 9. des → 10. des connector still
    // read "1 dags mellomrom · tett" in clash ink about two exams that were
    // both over. `tight` stays true (the spacing WAS tight — that is a fact
    // about the dates, not about now); what the renderer needs is knowing both
    // ends are history.
    const model = buildExamList(
      [
        { code: "TDT4120", date: "2026-12-09" },
        { code: "TDT4195", date: "2026-12-10" },
      ],
      "2026-12-11",
    );
    expect(model.rows[0]?.tight).toBe(true);
    expect(model.rows.map((r) => r.past)).toEqual([true, true]);
    expect(model.rows.every((r) => r.daysFromToday === null)).toBe(true);
  });

  it("keeps dateless codes in input order, apart from rows", () => {
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
  });

  it("returns the empty model for no exams", () => {
    expect(buildExamList([], "2026-01-01")).toEqual({ rows: [], dateless: [] });
  });

  // The model used to carry a `summary` string ("4 eksamener over 14 dager")
  // that the page rendered in a ruled box above the list. It restated what
  // the dated rows underneath already showed, so both are gone — the model
  // is rows + dateless and nothing else.
  it("carries no summary field", () => {
    const model = buildExamList([{ code: "A", date: "2026-11-26" }], "2026-01-01");
    expect(model).not.toHaveProperty("summary");
  });

  it("keeps every dateless input when none is dated", () => {
    const model = buildExamList(
      [
        { code: "A", date: null },
        { code: "B", date: null },
      ],
      "2026-01-01",
    );
    expect(model.rows).toEqual([]);
    expect(model.dateless).toEqual(["A", "B"]);
  });

  it("computes the correct 2-letter Norwegian weekday for a known date", () => {
    const model = buildExamList([{ code: "A", date: "2026-11-26" }], "2026-01-01");
    expect(model.rows[0]?.weekday).toBe("to");
  });
});

describe("readingDays — the days you actually get to revise", () => {
  const on = (code: string, date: string) => ({ code, date });

  it("both exam days come off the distance", () => {
    // The user's own case: exams on the 15th and the 17th are two days apart
    // and leave exactly ONE day to read, because the other two are exam days.
    const model = buildExamList([on("A", "2026-12-15"), on("B", "2026-12-17")], "2026-11-01");
    expect(model.rows[0]?.gapToNext).toBe(2);
    expect(model.rows[0]?.readingDays).toBe(1);
  });

  it("consecutive days leave none", () => {
    const model = buildExamList([on("A", "2026-12-15"), on("B", "2026-12-16")], "2026-11-01");
    expect(model.rows[0]?.readingDays).toBe(0);
    expect(model.rows[0]?.tight).toBe(true);
  });

  it("a same-day pair reports none, never minus one", () => {
    const model = buildExamList([on("A", "2026-12-15"), on("B", "2026-12-15")], "2026-11-01");
    expect(model.rows[0]?.gapToNext).toBe(0);
    expect(model.rows[0]?.readingDays).toBe(0);
  });

  it("the last dated row has no next, so no reading days", () => {
    const model = buildExamList([on("A", "2026-12-15")], "2026-11-01");
    expect(model.rows[0]?.readingDays).toBeNull();
  });

  it("tight is still one reading day or none", () => {
    // Same threshold as the old `gapToNext <= 2`, re-expressed: a three-day
    // distance is two reading days and is not tight.
    const model = buildExamList([on("A", "2026-12-15"), on("B", "2026-12-18")], "2026-11-01");
    expect(model.rows[0]?.readingDays).toBe(2);
    expect(model.rows[0]?.tight).toBe(false);
  });
});
