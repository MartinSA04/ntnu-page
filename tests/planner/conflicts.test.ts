import { describe, expect, it } from "vitest";
import { lecturesOnly } from "../../src/lib/planner/activity.js";
import {
  analyzeExams,
  findConflicts,
  groupConflicts,
  mergeParallelSlots,
} from "../../src/lib/planner/conflicts.js";
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

describe("groupConflicts", () => {
  it("reports a real 3-way clash as one problem, not three pairs", () => {
    const a = entry({ courseCode: "TDT4160", startTime: "14:15", endTime: "16:00" });
    const b = entry({ courseCode: "TDT4136", startTime: "14:15", endTime: "16:00" });
    const c = entry({ courseCode: "TMA4145", startTime: "14:15", endTime: "16:00" });
    const conflicts = findConflicts([a, b, c]);
    expect(conflicts).toHaveLength(3);

    const groups = groupConflicts(conflicts);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.codes).toEqual(["TDT4160", "TDT4136", "TMA4145"]);
    expect(groups[0]?.entries).toEqual([a, b, c]);
    expect(groups[0]?.start).toBe(14 * 60 + 15);
    expect(groups[0]?.end).toBe(16 * 60);
  });

  it("keeps different overlap windows on the same day apart", () => {
    const a = entry({ courseCode: "A", startTime: "10:00", endTime: "12:00" });
    const b = entry({ courseCode: "B", startTime: "10:00", endTime: "11:00" });
    const c = entry({ courseCode: "C", startTime: "11:00", endTime: "12:00" });
    const groups = groupConflicts(findConflicts([a, b, c]));
    expect(groups.map((g) => [g.start, g.end])).toEqual([
      [600, 660],
      [660, 720],
    ]);
  });

  it("unions the weeks of every pair in a group, ascending", () => {
    const a = entry({ courseCode: "A", weeks: ["34-40"] });
    const b = entry({ courseCode: "B", weeks: ["34-35"] });
    const c = entry({ courseCode: "C", weeks: ["39-40"] });
    const groups = groupConflicts(findConflicts([a, b, c]));
    expect(groups).toHaveLength(1);
    expect(groups[0]?.weeks).toEqual([34, 35, 39, 40]);
  });

  it("sorts groups by day, then by start", () => {
    const mon = [
      entry({ courseCode: "A", dayNumber: 1, startTime: "12:00", endTime: "14:00" }),
      entry({ courseCode: "B", dayNumber: 1, startTime: "12:00", endTime: "14:00" }),
    ];
    const tue = [
      entry({ courseCode: "A", dayNumber: 2, startTime: "08:00", endTime: "10:00" }),
      entry({ courseCode: "B", dayNumber: 2, startTime: "08:00", endTime: "10:00" }),
    ];
    const groups = groupConflicts(findConflicts([...tue, ...mon]));
    expect(groups.map((g) => g.dayNumber)).toEqual([1, 2]);
  });

  it("returns [] for no conflicts", () => {
    expect(groupConflicts([])).toEqual([]);
  });
});

describe("mergeParallelSlots", () => {
  it("collapses a course's identical parallel slots into one group", () => {
    const slots = [1, 2, 3, 4].map(() =>
      entry({ courseCode: "TDT4109", startTime: "08:00", endTime: "18:00" }),
    );
    const merged = mergeParallelSlots(slots);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.entries).toHaveLength(4);
    expect(merged[0]?.representative).toBe(slots[0]);
  });

  it("normalises week spellings, so 34-36 and 34,35,36 are the same slot", () => {
    const a = entry({ courseCode: "A", weeks: ["34-36"] });
    const b = entry({ courseCode: "A", weeks: ["34", "35", "36"] });
    expect(mergeParallelSlots([a, b])).toHaveLength(1);
  });

  it("keeps different courses, days, times and weeks apart", () => {
    const base = entry({ courseCode: "A" });
    const others = [
      entry({ courseCode: "B" }),
      entry({ courseCode: "A", dayNumber: 2 }),
      entry({ courseCode: "A", startTime: "08:15" }),
      entry({ courseCode: "A", endTime: "13:00" }),
      entry({ courseCode: "A", weeks: ["41"] }),
    ];
    expect(mergeParallelSlots([base, ...others])).toHaveLength(6);
  });

  it("honours extraKey, so two campuses at the same hour stay two blocks", () => {
    const trondheim = { ...entry({ courseCode: "EXPH0300" }), title: "Parallell 2 Trondheim" };
    const gjovik = { ...entry({ courseCode: "EXPH0300" }), title: "Parallell 3 Gjøvik" };
    expect(mergeParallelSlots([trondheim, gjovik])).toHaveLength(1);
    expect(mergeParallelSlots([trondheim, gjovik], (e) => e.title)).toHaveLength(2);
  });

  it("preserves input order and returns [] for an empty list", () => {
    const a = entry({ courseCode: "A" });
    const b = entry({ courseCode: "B" });
    expect(mergeParallelSlots([b, a]).map((g) => g.representative.courseCode)).toEqual(["B", "A"]);
    expect(mergeParallelSlots([])).toEqual([]);
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

describe("findConflicts — lecture-only (DR-1)", () => {
  // An entry shaped like ScheduleEntry + a title, the way a caller filters
  // real TimetableEntry data before handing it to findConflicts.
  function titled(overrides: Partial<ScheduleEntry> & Pick<ScheduleEntry, "courseCode">) {
    return { ...entry(overrides) };
  }

  it("does not flag an øving/lecture overlap when the caller pre-filters to lectures", () => {
    const lecture = {
      ...titled({ courseCode: "A", startTime: "10:00", endTime: "12:00" }),
      title: "Forelesning",
    };
    const oving = {
      ...titled({ courseCode: "B", startTime: "11:00", endTime: "13:00" }),
      title: "Øving",
    };
    expect(findConflicts(lecturesOnly([lecture, oving]))).toEqual([]);
  });

  it("still flags a lecture/lecture overlap after pre-filtering to lectures", () => {
    const a = {
      ...titled({ courseCode: "A", startTime: "10:00", endTime: "12:00" }),
      title: "Forelesning",
    };
    const b = {
      ...titled({ courseCode: "B", startTime: "11:00", endTime: "13:00" }),
      title: "Forelesning",
    };
    expect(findConflicts(lecturesOnly([a, b]))).toHaveLength(1);
  });

  it("øving/øving overlap across different courses is never flagged, filtered or not", () => {
    const a = {
      ...titled({ courseCode: "A", startTime: "10:00", endTime: "12:00" }),
      title: "Øving",
    };
    const b = {
      ...titled({ courseCode: "B", startTime: "11:00", endTime: "13:00" }),
      title: "Lab",
    };
    expect(findConflicts(lecturesOnly([a, b]))).toEqual([]);
    // Unfiltered, this WOULD be flagged -- demonstrating filtering is load-bearing.
    expect(findConflicts([a, b])).toHaveLength(1);
  });
});

describe("findConflicts dedupe", () => {
  const entry = (code: string, group: string, day = 1, start = "10:15", end = "12:00") => ({
    courseCode: code,
    dayNumber: day,
    startTime: start,
    endTime: end,
    weeks: ["35-41"],
    name: group,
  });

  it("collapses identical collisions from parallel groups into one conflict", () => {
    // 4 øving groups of A against 2 groups of B in the same slot = 8 raw pairs.
    const entries = [
      ...["g1", "g2", "g3", "g4"].map((g) => entry("AAA1000", g)),
      ...["h1", "h2"].map((g) => entry("BBB2000", g)),
    ];
    const conflicts = findConflicts(entries);
    expect(conflicts).toHaveLength(1);
    expect([conflicts[0]?.a.courseCode, conflicts[0]?.b.courseCode].sort()).toEqual([
      "AAA1000",
      "BBB2000",
    ]);
  });

  it("keeps distinct slots as distinct conflicts", () => {
    const entries = [
      entry("AAA1000", "g1", 1, "10:15", "12:00"),
      entry("AAA1000", "g2", 2, "10:15", "12:00"),
      entry("BBB2000", "h1", 1, "10:15", "12:00"),
      entry("BBB2000", "h2", 2, "10:15", "12:00"),
    ];
    expect(findConflicts(entries)).toHaveLength(2);
  });
});
