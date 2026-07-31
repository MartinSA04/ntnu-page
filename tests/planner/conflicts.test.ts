import { describe, expect, it } from "vitest";
import { lecturesOnly } from "../../src/lib/planner/activity.js";
import {
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

  it("does not red BI1001 against TKT4116 — PBL is parallel group work, not a plenary", () => {
    // 's exact live geometry (2026_VÅR, both courses curled). BI1001
    // publishes "Problembasert læring" across five mutually exclusive weekly
    // slots; two of them sit exactly on TKT4116's two lectures. While PBL was
    // hand-labeled a lecture this produced 2 conflict groups — a false red for
    // a student who attends ONE PBL group. Its real lectures (1-1/1-2) clear
    // TKT4116 entirely, so the honest answer is 0.
    const bi1001 = [
      {
        courseCode: "BI1001",
        dayNumber: 1,
        startTime: "12:15",
        endTime: "14:00",
        weeks: ["2-13", "16-18"],
        title: "1-1Forelesning",
      },
      {
        courseCode: "BI1001",
        dayNumber: 4,
        startTime: "15:15",
        endTime: "17:00",
        weeks: ["2-13", "15"],
        title: "1-2Forelesning",
      },
      {
        courseCode: "BI1001",
        dayNumber: 1,
        startTime: "14:15",
        endTime: "16:00",
        weeks: ["5-13", "16-17"],
        title: "Problembasert læring",
      },
      {
        courseCode: "BI1001",
        dayNumber: 4,
        startTime: "12:15",
        endTime: "15:00",
        weeks: ["5-13", "15-17"],
        title: "Problembasert læring",
      },
    ];
    const tkt4116 = [
      {
        courseCode: "TKT4116",
        dayNumber: 1,
        startTime: "14:15",
        endTime: "16:00",
        weeks: ["2-13", "16-17"],
        title: "Forelesning",
      },
      {
        courseCode: "TKT4116",
        dayNumber: 4,
        startTime: "12:15",
        endTime: "14:00",
        weeks: ["2-13", "15-17"],
        title: "Forelesning",
      },
    ];
    const lectures = lecturesOnly([...bi1001, ...tkt4116]);
    expect(lectures.map((e) => e.title)).toEqual([
      "1-1Forelesning",
      "1-2Forelesning",
      "Forelesning",
      "Forelesning",
    ]);
    expect(groupConflicts(findConflicts(lectures))).toEqual([]);

    // Anti-vacuity: the two slots really do overlap — treating PBL as a lecture
    // (what the classifier used to do) is what produced the two false groups.
    const asLectures = groupConflicts(findConflicts([...bi1001, ...tkt4116]));
    expect(asLectures.map((g) => [g.dayNumber, g.start, g.end])).toEqual([
      [1, 855, 960],
      [4, 735, 840],
    ]);
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

  it("keeps every clashing entry when distinct pairs share one overlap window", () => {
    // with the live geometry that produces it: TDT4109's only 26h
    // lecture is Fri 12:15–13:00 (uke 34-35,45-46), and SYG1000 publishes
    // three Friday lectures that each cover it. All three intersections are
    // the identical window 12:15–13:00 over uke 34,35,45,46 — so a dedupe key
    // built from the INTERSECTION collapsed them to one conflict and dropped
    // two entries that really do clash. grid.ts reads the dropped set for
    // `groupsByEntry`, `clashWindowFor` and blockAriaLabel's "kolliderer med".
    const tdt4109 = {
      courseCode: "TDT4109",
      dayNumber: 5,
      startTime: "12:15",
      endTime: "13:00",
      weeks: ["34-35", "45-46"],
    };
    const syg1000 = [
      ["08:15", "15:00"],
      ["11:15", "13:00"],
      ["12:15", "14:00"],
    ].map(([startTime, endTime]) => ({
      courseCode: "SYG1000",
      dayNumber: 5,
      startTime: startTime ?? "",
      endTime: endTime ?? "",
      weeks: ["33-38", "40-47"],
    }));

    const conflicts = findConflicts([tdt4109, ...syg1000]);
    expect(conflicts).toHaveLength(3);
    // Every SYG1000 lecture is present in the output, exactly once.
    expect(conflicts.map((c) => `${c.b.startTime}-${c.b.endTime}`)).toEqual([
      "08:15-15:00",
      "11:15-13:00",
      "12:15-14:00",
    ]);
    // The intersection really is identical for all three — that is the whole
    // reason the old key merged them.
    expect(conflicts.map((c) => [c.start, c.end, c.weeks])).toEqual([
      [735, 780, [34, 35, 45, 46]],
      [735, 780, [34, 35, 45, 46]],
      [735, 780, [34, 35, 45, 46]],
    ]);
    // Downstream is unchanged: one day, one window, still one problem to fix.
    expect(groupConflicts(conflicts)).toHaveLength(1);
    expect(groupConflicts(conflicts)[0]?.entries).toHaveLength(4);
  });

  it("collapses parallel groups regardless of the order the courses interleave", () => {
    // The dedupe key sorts the two (course, span) tokens, so the same pair of
    // slots keys identically whichever entry the loop visits first. Keying on
    // `a` and `b` positionally would leave this list with 2 conflicts.
    const entries = [
      entry("AAA1000", "g1", 1, "10:15", "12:00"),
      entry("BBB2000", "h1", 1, "11:15", "13:00"),
      entry("BBB2000", "h2", 1, "11:15", "13:00"),
      entry("AAA1000", "g2", 1, "10:15", "12:00"),
    ];
    expect(findConflicts(entries)).toHaveLength(1);
  });
});
