import { describe, expect, it } from "vitest";
import { analyzeExams, findConflicts } from "../../src/lib/planner/conflicts.js";
import type { ScheduleEntry } from "../../src/lib/planner/schedule.js";

function entry(
  overrides: Partial<ScheduleEntry> & Pick<ScheduleEntry, "courseCode">,
): ScheduleEntry {
  return {
    dayNumber: 1,
    startTime: "10:15",
    endTime: "12:00",
    weeks: ["34-40"],
    ...overrides,
  };
}

describe("findConflicts", () => {
  it("finds a conflict for overlapping same-day entries of different courses", () => {
    const a = entry({ courseCode: "A", startTime: "10:00", endTime: "12:00" });
    const b = entry({ courseCode: "B", startTime: "11:00", endTime: "13:00" });
    const conflicts = findConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ dayNumber: 1, start: 660, end: 720 });
  });

  it("does NOT flag a shared boundary instant (12:00 end vs 12:00 start) as a conflict", () => {
    const a = entry({ courseCode: "A", startTime: "10:00", endTime: "12:00" });
    const b = entry({ courseCode: "B", startTime: "12:00", endTime: "14:00" });
    expect(findConflicts([a, b])).toEqual([]);
  });

  it("flags a 1-minute overlap as a conflict", () => {
    const a = entry({ courseCode: "A", startTime: "10:00", endTime: "12:00" });
    const b = entry({ courseCode: "B", startTime: "11:59", endTime: "14:00" });
    const conflicts = findConflicts([a, b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.start).toBe(719);
    expect(conflicts[0]?.end).toBe(720);
  });

  it("does not flag disjoint weeks even with overlapping time", () => {
    const a = entry({ courseCode: "A", weeks: ["34-36"] });
    const b = entry({ courseCode: "B", weeks: ["37-40"] });
    expect(findConflicts([a, b])).toEqual([]);
  });

  it("computes the shared-week intersection", () => {
    const a = entry({ courseCode: "A", weeks: ["34-38"] });
    const b = entry({ courseCode: "B", weeks: ["36-40"] });
    const conflicts = findConflicts([a, b]);
    expect(conflicts[0]?.weeks).toEqual([36, 37, 38]);
  });

  it("never conflicts entries of the same course (parallel groups)", () => {
    const a = entry({ courseCode: "A", startTime: "10:00", endTime: "12:00" });
    const b = entry({ courseCode: "A", startTime: "11:00", endTime: "13:00" });
    expect(findConflicts([a, b])).toEqual([]);
  });

  it("does not flag different days", () => {
    const a = entry({ courseCode: "A", dayNumber: 1 });
    const b = entry({ courseCode: "B", dayNumber: 2 });
    expect(findConflicts([a, b])).toEqual([]);
  });

  it("does not flag entries that don't overlap in time at all", () => {
    const a = entry({ courseCode: "A", startTime: "08:00", endTime: "09:00" });
    const b = entry({ courseCode: "B", startTime: "10:00", endTime: "11:00" });
    expect(findConflicts([a, b])).toEqual([]);
  });

  it("skips entries with malformed time strings rather than throwing", () => {
    const a = entry({ courseCode: "A", startTime: "bad", endTime: "12:00" });
    const b = entry({ courseCode: "B", startTime: "10:00", endTime: "12:00" });
    expect(findConflicts([a, b])).toEqual([]);
  });

  it("finds all pairwise conflicts among 3+ overlapping courses", () => {
    const a = entry({ courseCode: "A", startTime: "10:00", endTime: "12:00" });
    const b = entry({ courseCode: "B", startTime: "10:30", endTime: "11:30" });
    const c = entry({ courseCode: "C", startTime: "11:00", endTime: "13:00" });
    const conflicts = findConflicts([a, b, c]);
    // A-B, B-C, A-C all overlap
    expect(conflicts).toHaveLength(3);
  });

  it("returns [] for a single entry or empty list", () => {
    expect(findConflicts([])).toEqual([]);
    expect(findConflicts([entry({ courseCode: "A" })])).toEqual([]);
  });
});

describe("analyzeExams", () => {
  it("sorts by date and computes day gaps", () => {
    const rows = analyzeExams([
      { code: "A", date: "2026-12-10" },
      { code: "B", date: "2026-12-05" },
    ]);
    expect(rows.map((r) => r.code)).toEqual(["B", "A"]);
    expect(rows[0]?.dayGap).toBe(5);
    expect(rows[1]?.dayGap).toBeNull();
  });

  it("flags a same-day collision on both rows", () => {
    const rows = analyzeExams([
      { code: "A", date: "2026-12-05" },
      { code: "B", date: "2026-12-05" },
    ]);
    expect(rows[0]?.collision).toBe(true);
    expect(rows[1]?.collision).toBe(true);
    expect(rows[0]?.dayGap).toBe(0);
    expect(rows[0]?.tight).toBe(false);
  });

  it("flags a 1-day gap as tight, not a collision", () => {
    const rows = analyzeExams([
      { code: "A", date: "2026-12-05" },
      { code: "B", date: "2026-12-06" },
    ]);
    expect(rows[0]?.tight).toBe(true);
    expect(rows[1]?.tight).toBe(true);
    expect(rows[0]?.collision).toBe(false);
  });

  it("does not flag a 2-day gap as tight or a collision", () => {
    const rows = analyzeExams([
      { code: "A", date: "2026-12-05" },
      { code: "B", date: "2026-12-07" },
    ]);
    expect(rows[0]?.tight).toBe(false);
    expect(rows[0]?.collision).toBe(false);
    expect(rows[0]?.dayGap).toBe(2);
  });

  it("skips null dates", () => {
    const rows = analyzeExams([
      { code: "A", date: null },
      { code: "B", date: "2026-12-05" },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.code).toBe("B");
  });

  it("skips empty-string dates", () => {
    const rows = analyzeExams([{ code: "A", date: "" }]);
    expect(rows).toEqual([]);
  });

  it("handles multiple exams for the same course", () => {
    const rows = analyzeExams([
      { code: "A", date: "2026-05-15" },
      { code: "A", date: "2026-12-05" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.code === "A")).toBe(true);
  });

  it("returns [] for no exams", () => {
    expect(analyzeExams([])).toEqual([]);
  });

  it("handles a three-way same-day collision", () => {
    const rows = analyzeExams([
      { code: "A", date: "2026-12-05" },
      { code: "B", date: "2026-12-05" },
      { code: "C", date: "2026-12-05" },
    ]);
    expect(rows.every((r) => r.collision)).toBe(true);
  });

  it("computes gaps across a chain of exams", () => {
    const rows = analyzeExams([
      { code: "A", date: "2026-12-01" },
      { code: "B", date: "2026-12-03" },
      { code: "C", date: "2026-12-10" },
    ]);
    expect(rows.map((r) => r.dayGap)).toEqual([2, 7, null]);
  });
});
