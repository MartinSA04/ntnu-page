import { describe, expect, test } from "vitest";
import { type NowSession, nowVerdict, weekMinutes } from "../../src/components/site/now.js";

/**
 * The landing card's decision half. Which session
 * counts as "now" is an inclusive-start/exclusive-end call, and getting it
 * wrong sends a student to a room they have just walked out of — so it is
 * pure, and it is tested here rather than only in the browser.
 */

const session = (
  code: string,
  dayNumber: number,
  startTime: string,
  endTime: string,
  room = "R1",
  allDay = false,
): NowSession => {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const startAt = (dayNumber - 1) * 24 * 60 + mins(startTime);
  return {
    code,
    courseName: code,
    activity: "Forelesning",
    room,
    roomsExtra: 0,
    allDay,
    dayNumber,
    startTime,
    endTime,
    startAt,
    endAt: startAt + (mins(endTime) - mins(startTime)),
  };
};

// Tuesday 10:15–12:00 and 14:15–16:00; Wednesday 08:15–10:00.
const TUE_MORNING = session("TMA4400", 2, "10:15", "12:00", "F1");
const TUE_AFTERNOON = session("TDT4136", 2, "14:15", "16:00", "EL5");
const WED = session("TMA4412", 3, "08:15", "10:00");
const WEEK = [WED, TUE_AFTERNOON, TUE_MORNING]; // deliberately unsorted

const at = (day: number, time: string): number =>
  (day - 1) * 24 * 60 + Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

describe("weekMinutes", () => {
  test("Monday 00:00 is the origin", () => {
    // 2026-08-24 is a Monday.
    expect(weekMinutes(new Date(2026, 7, 24, 0, 0))).toBe(0);
  });

  test("Tuesday 11:05 is a day and eleven hours in", () => {
    expect(weekMinutes(new Date(2026, 7, 25, 11, 5))).toBe(24 * 60 + 11 * 60 + 5);
  });

  test("Sunday is the END of the week, not before Monday", () => {
    // JS calls Sunday 0; NTNU calls it 7. Used raw, a Sunday evening would sort
    // before Monday morning and offer a lecture that has already happened.
    const sunday = weekMinutes(new Date(2026, 7, 30, 18, 0));
    expect(sunday).toBeGreaterThan(weekMinutes(new Date(2026, 7, 28, 23, 59)));
    expect(sunday).toBe(6 * 24 * 60 + 18 * 60);
  });
});

describe("nowVerdict", () => {
  test("a plan with no drawable sessions says nothing at all", () => {
    // Not "done" — the page keeps its own invitation rather than claiming the
    // week is over when the timetables simply have not landed.
    expect(nowVerdict([], at(2, "11:05")).kind).toBe("empty");
  });

  test("mid-session: the running one, its countdown and its progress", () => {
    const v = nowVerdict(WEEK, at(2, "11:05"));
    if (v.kind !== "running") throw new Error(`expected running, got ${v.kind}`);
    expect(v.session.code).toBe("TMA4400");
    expect(v.minutesLeft).toBe(55);
    expect(v.progress).toBeCloseTo(50 / 105, 5);
    // What comes after it, in time order across the rest of the week.
    expect(v.rest.map((s) => s.code)).toEqual(["TDT4136", "TMA4412"]);
  });

  test("the start minute counts as running, the end minute does not", () => {
    // A student standing outside the door at 10:15 is at the right lecture; one
    // at 12:00 sharp has been let out and wants the NEXT room.
    expect(nowVerdict(WEEK, at(2, "10:15")).kind).toBe("running");
    const atEnd = nowVerdict(WEEK, at(2, "12:00"));
    expect(atEnd.kind).toBe("next");
    if (atEnd.kind !== "next") throw new Error("unreachable");
    expect(atEnd.session.code).toBe("TDT4136");
  });

  test("between sessions: the next one, and it is not repeated in the list", () => {
    const v = nowVerdict(WEEK, at(2, "13:00"));
    if (v.kind !== "next") throw new Error(`expected next, got ${v.kind}`);
    expect(v.session.code).toBe("TDT4136");
    expect(v.rest.map((s) => s.code)).toEqual(["TMA4412"]);
    expect(v.rest).not.toContainEqual(v.session);
  });

  test("it crosses midnight into the next teaching day", () => {
    const v = nowVerdict(WEEK, at(2, "22:00"));
    if (v.kind !== "next") throw new Error(`expected next, got ${v.kind}`);
    expect(v.session.code).toBe("TMA4412");
    expect(v.session.dayNumber).toBe(3);
  });

  test("after the last session the week is done, not empty", () => {
    // A real answer — "ingenting mer denne uka" — rather than the card
    // vanishing, which would read as a plan that failed to load.
    expect(nowVerdict(WEEK, at(5, "16:00")).kind).toBe("done");
  });

  test("an open lab is never the answer, but it stays in the list", () => {
    // BK1151 publishes a 08:00–18:00 drop-in window. Treated as a session it
    // reads "NÅ · 474 min igjen" and hides the lecture starting in twenty
    // minutes — a countdown to nothing, over the wrong room.
    const lab = session("BK1151", 2, "08:00", "18:00", "A3-138", true);
    const v = nowVerdict([lab, TUE_AFTERNOON], at(2, "10:00"));
    if (v.kind !== "next") throw new Error(`expected next, got ${v.kind}`);
    expect(v.session.code).toBe("TDT4136");
    expect(v.rest.map((s) => s.code)).not.toContain("BK1151");
  });

  test("a week of nothing but open labs is done, not a fake countdown", () => {
    const lab = session("BK1151", 2, "08:00", "18:00", "A3-138", true);
    expect(nowVerdict([lab], at(2, "10:00")).kind).toBe("done");
  });

  test("input order never decides the answer", () => {
    const shuffled = [TUE_AFTERNOON, WED, TUE_MORNING];
    const a = nowVerdict(WEEK, at(2, "13:00"));
    const b = nowVerdict(shuffled, at(2, "13:00"));
    expect(b).toEqual(a);
  });
});
