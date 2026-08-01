import { describe, expect, test } from "vitest";
import { isoWeekNumber, weekdayDates } from "../../src/lib/planner/weekDates.js";

describe("isoWeekNumber", () => {
  test("the reference week the artifact is drawn for", () => {
    // Monday 14 September 2026 is ISO week 38, which is the week the design
    // reference names in its own context line.
    expect(isoWeekNumber(new Date(2026, 8, 14))).toBe(38);
    expect(isoWeekNumber(new Date(2026, 8, 18))).toBe(38);
    // …and the Sunday of it, which `getDay()` calls 0 and ISO calls 7.
    expect(isoWeekNumber(new Date(2026, 8, 20))).toBe(38);
    expect(isoWeekNumber(new Date(2026, 8, 21))).toBe(39);
  });

  test("the year boundary, which is the whole reason for the Thursday rule", () => {
    // 1 January 2027 is a Friday, so its week contains Thursday 31 Dec 2026 —
    // ISO week 53 OF 2026, not week 1 of 2027.
    expect(isoWeekNumber(new Date(2027, 0, 1))).toBe(53);
    // 4 January 2027 is the Monday of the first week whose Thursday is in 2027.
    expect(isoWeekNumber(new Date(2027, 0, 4))).toBe(1);
    // And the other direction: 1 January 2026 is a Thursday, so it IS week 1.
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeekNumber(new Date(2025, 11, 29))).toBe(1);
  });
});

describe("weekdayDates", () => {
  test("every weekday of the asked date's own week, keyed 1 = mandag", () => {
    // Wednesday 16 September 2026.
    const dates = weekdayDates(new Date(2026, 8, 16));
    expect([...dates.entries()]).toEqual([
      [1, 14],
      [2, 15],
      [3, 16],
      [4, 17],
      [5, 18],
      [6, 19],
    ]);
  });

  test("a Sunday belongs to the week that just ended, not the one starting", () => {
    // Sunday 20 September: ISO's seventh day, so the week is still 14–19.
    expect(weekdayDates(new Date(2026, 8, 20)).get(1)).toBe(14);
  });

  test("a week that crosses a month keeps counting into the next one", () => {
    // Monday 28 September 2026 → Saturday 3 October.
    const dates = weekdayDates(new Date(2026, 8, 28));
    expect(dates.get(1)).toBe(28);
    expect(dates.get(4)).toBe(1);
    expect(dates.get(6)).toBe(3);
  });
});
