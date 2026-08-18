import { describe, expect, test } from "vitest";
import type { SessionEntry } from "../../src/components/planner/board.js";
import { columnGeometry } from "../../src/components/planner/columnGrid.js";

/**
 * The column view's geometry — the half that decides how wide a day has to be
 * and therefore whether a course code survives. `renderColumnGrid` itself needs
 * a DOM (this suite runs in vitest's default Node environment), so the rule it
 * rests on is exported and tested here; the assembly is covered by
 * `e2e/flows.pw.ts`.
 */

const session = (over: Partial<SessionEntry> = {}): SessionEntry => ({
  courseCode: "TDT4120",
  dayNumber: 1,
  startTime: "10:15",
  endTime: "12:00",
  weeks: ["34-47"],
  hueVar: "--hue-blue",
  courseName: "Algoritmer og datastrukturer",
  label: "Forelesning",
  rooms: "F1",
  buildings: "IT-bygget",
  weeksLabel: "uke 34–47",
  isLecture: true,
  groupPicked: true,
  ...over,
});

describe("columnGeometry: the drawn hours", () => {
  test("clamps to whole hours, so the ruling tiles the column exactly", () => {
    const geo = columnGeometry([session({ startTime: "08:15", endTime: "15:45" })]);
    expect(geo.minMinutes).toBe(8 * 60);
    expect(geo.maxMinutes).toBe(16 * 60);
    expect(geo.hours).toBe(8);
    expect(geo.span).toBe(480);
  });

  test("a Saturday session widens the week to six columns", () => {
    expect(columnGeometry([session({ dayNumber: 6 })]).dayCount).toBe(6);
    expect(columnGeometry([session({ dayNumber: 5 })]).dayCount).toBe(5);
  });
});

describe("columnGeometry: lanes are per cluster, not per day", () => {
  // The case the rule exists for: a Tuesday where two lectures collide at
  // 10:15 and an unrelated øving sits alone at 16:00. Dividing the whole
  // column by the day's worst moment would make that øving half-width for
  // nothing — and half of a column is where a course code breaks.
  const week = [
    session({ dayNumber: 2, startTime: "10:15", endTime: "12:00", courseCode: "IT2810" }),
    session({ dayNumber: 2, startTime: "10:15", endTime: "12:00", courseCode: "TDT4225" }),
    session({ dayNumber: 2, startTime: "16:15", endTime: "18:00", courseCode: "TDT4120" }),
  ];

  test("the colliding pair splits its column, the lone session keeps all of it", () => {
    const day = columnGeometry(week).days[1];
    const lanesOf = (code: string) =>
      day?.slots.find((s) => s.entry.courseCode === code)?.lanes ?? 0;
    expect(lanesOf("IT2810")).toBe(2);
    expect(lanesOf("TDT4225")).toBe(2);
    expect(lanesOf("TDT4120")).toBe(1);
  });

  test("the pair takes one lane each, so neither is drawn over the other", () => {
    const day = columnGeometry(week).days[1];
    const lanes = day?.slots
      .filter((s) => s.entry.startTime === "10:15")
      .map((s) => s.lane)
      .sort();
    expect(lanes).toEqual([0, 1]);
  });

  test("lanesMax is the week's deepest cluster — what a column must fit", () => {
    // It is the maximum across every day, because the columns are equal: a
    // Friday two deep is what makes Monday wide enough too.
    expect(columnGeometry(week).lanesMax).toBe(2);
    expect(columnGeometry([week[0] as SessionEntry]).lanesMax).toBe(1);
  });

  test("touching sessions do not overlap, so they share one lane", () => {
    const geo = columnGeometry([
      session({ startTime: "10:15", endTime: "12:00" }),
      session({ startTime: "12:00", endTime: "14:00", courseCode: "TMA4245" }),
    ]);
    expect(geo.lanesMax).toBe(1);
  });
});

describe("columnGeometry: a drop-in window takes a strip, not a lane", () => {
  const dropIn = session({
    courseCode: "TDT4120",
    isLecture: false,
    label: "Øvingsveiledning",
    startTime: "08:15",
    endTime: "14:00",
  });

  test("five hours of open øvingsveiledning is a band", () => {
    const day = columnGeometry([dropIn]).days[0];
    expect(day?.bands).toHaveLength(1);
    expect(day?.slots).toHaveLength(0);
  });

  test("it never counts toward the lanes, so it cannot narrow a lecture", () => {
    const geo = columnGeometry([dropIn, session({ startTime: "10:15", endTime: "12:00" })]);
    expect(geo.lanesMax).toBe(1);
    expect(geo.bandsMax).toBe(1);
  });

  test("a long LECTURE is still a lecture — the rule is not about length alone", () => {
    const geo = columnGeometry([session({ startTime: "08:15", endTime: "14:00" })]);
    expect(geo.days[0]?.bands).toHaveLength(0);
    expect(geo.days[0]?.slots).toHaveLength(1);
  });

  test("bandsMax is the busiest day's strip count, so every column reserves it", () => {
    const geo = columnGeometry([
      dropIn,
      { ...dropIn, courseCode: "TDT4180", dayNumber: 2 },
      { ...dropIn, courseCode: "IT2810", dayNumber: 2 },
    ]);
    expect(geo.bandsMax).toBe(2);
  });
});

describe("columnGeometry: an empty week", () => {
  test("falls back to a drawable day rather than an axis of zero minutes", () => {
    const geo = columnGeometry([]);
    expect(geo.hours).toBeGreaterThan(0);
    expect(geo.span).toBeGreaterThan(0);
    expect(geo.days).toHaveLength(5);
  });
});
