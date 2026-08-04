import { describe, expect, test } from "vitest";
import { isoWeekNumber, isoWeekStart, weekdayDates } from "../../src/lib/planner/weekDates.js";

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

/**
 * The inverse of `isoWeekNumber`, and the reason the week picker can date a
 * week it is not open in: a chosen week carries its own Monday's numerals.
 * The two must agree, which is what these check rather than any one value.
 */
describe("isoWeekStart", () => {
  test("round-trips through isoWeekNumber for a whole autumn term", () => {
    for (let week = 33; week <= 52; week++) {
      expect(isoWeekNumber(isoWeekStart(2026, week))).toBe(week);
    }
  });

  test("lands on a Monday", () => {
    for (const week of [1, 14, 34, 47, 52]) {
      // getDay(): 1 = Monday.
      expect(isoWeekStart(2026, week).getDay()).toBe(1);
    }
  });

  test("week 1 may start in the previous December", () => {
    // 2026-01-01 is a Thursday, so ISO week 1 opens on 29 December 2025.
    const monday = isoWeekStart(2026, 1);
    expect(monday.getFullYear()).toBe(2025);
    expect(monday.getMonth()).toBe(11);
    expect(monday.getDate()).toBe(29);
  });

  test("dates the whole week the way the columns read it", () => {
    // Week 36 of 2026 opens on Monday 31 August.
    expect([...weekdayDates(isoWeekStart(2026, 36)).values()]).toEqual([31, 1, 2, 3, 4, 5]);
  });
});
