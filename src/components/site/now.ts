/**
 * NÅ — the landing page's answer to the only question a returning student has
 * on a Tuesday at 11:05: **which room** (REWORK-2026-07-29b D3).
 *
 * What used to be here was a sentence — "Planen din: MTDT · 5 emner → gå til
 * planleggeren" — which is a description of the plan, not an answer from it.
 * This renders the session that is running (or the next one today, or the next
 * one this week) with the room set as display type, because the room is the
 * fact you are walking somewhere to find out and everything else on the card
 * is context for it.
 *
 * It degrades in a straight line, and every step is a real state rather than a
 * spinner: no plan → nothing at all (the page keeps its own empty invitation);
 * a plan whose timetables have not landed → the course count, as before;
 * a plan with nothing left this week → "ingenting mer denne uka".
 *
 * The clock is read ONCE per render and passed down, so the "nå" band, the
 * countdown and the ordering of the list cannot disagree with each other by a
 * few milliseconds across a slow render.
 */
import { classifyActivity } from "../../lib/planner/activity.js";
import { fetchCourseBundle } from "../../lib/planner/data.js";
import { applyGroupSelection } from "../../lib/planner/groups.js";
import { entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
import type { PlanCourse, PlanState } from "../../lib/planner/store.js";

/** One session of the student's own week, flattened for the card. */
export interface NowSession {
  code: string;
  courseName: string;
  activity: string;
  /**
   * The room to SET as the display figure — the first one only.
   *
   * A lab publishes four ("A3-138, A4-100, A3-100, A3-125"), and the joined
   * string blown up to 7rem is four lines of noise where a student wanted one
   * word. The rest are not lost: `roomsExtra` carries the count for the line
   * underneath, which is where "+3 rom" belongs.
   */
  room: string;
  /** Rooms beyond the first, for the sub-line. 0 for the ordinary case. */
  roomsExtra: number;
  /**
   * An all-day drop-in window (a lab open 08:00–18:00), not an appointment.
   *
   * The week grid already draws these as a band behind the day rather than as
   * a block in it, and this card owes them the same distinction: "NÅ · 474 min
   * igjen" over an open lab is a countdown to nothing, and it hides the
   * lecture that actually starts in twenty minutes. They stay in the list —
   * they are real — but they never become the answer.
   */
  allDay: boolean;
  dayNumber: number;
  startTime: string;
  endTime: string;
  /** Minutes from the week's Monday 00:00 — the axis everything here sorts on. */
  startAt: number;
  endAt: number;
}

export type NowVerdict =
  | {
      kind: "running";
      session: NowSession;
      minutesLeft: number;
      progress: number;
      rest: NowSession[];
    }
  | { kind: "next"; session: NowSession; rest: NowSession[] }
  | { kind: "done" }
  | { kind: "empty" };

/** Matches the grid's own drop-in-band threshold (grid.ts, U1). */
const ALL_DAY_MINUTES = 5 * 60;

const toMinutes = (time: string): number => {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
};

/**
 * Where "now" falls on the same week-minute axis the sessions use. Sunday is
 * `getDay() === 0` in JS and day 7 in NTNU's data, so it is mapped rather than
 * used raw — otherwise a Sunday evening would read as before Monday morning
 * and offer the student a lecture that has already happened.
 */
export function weekMinutes(at: Date): number {
  const jsDay = at.getDay();
  const dayNumber = jsDay === 0 ? 7 : jsDay;
  return (dayNumber - 1) * 24 * 60 + at.getHours() * 60 + at.getMinutes();
}

/**
 * The card's state, given the week's sessions and the moment. Pure, because
 * this is the half worth testing: which session counts as "now" is an
 * inclusive-start/exclusive-end decision, and getting it wrong sends a student
 * to a room they have just left.
 */
export function nowVerdict(sessions: NowSession[], nowAt: number): NowVerdict {
  if (sessions.length === 0) return { kind: "empty" };
  const ordered = [...sessions].sort((a, b) => a.startAt - b.startAt);
  // An open lab is never the hero — see `NowSession.allDay`.
  const running = ordered.find((s) => !s.allDay && s.startAt <= nowAt && nowAt < s.endAt);
  const upcoming = ordered.filter((s) => s.startAt > nowAt);
  if (running) {
    const length = Math.max(1, running.endAt - running.startAt);
    return {
      kind: "running",
      session: running,
      minutesLeft: running.endAt - nowAt,
      progress: (nowAt - running.startAt) / length,
      rest: upcoming.slice(0, 3),
    };
  }
  // Same rule for "next": a drop-in window that opens at 08:00 tomorrow is not
  // the thing to put a room number on.
  const next = upcoming.find((s) => !s.allDay);
  if (!next) return { kind: "done" };
  const rest = upcoming.filter((s) => s !== next).slice(0, 3);
  return { kind: "next", session: next, rest };
}

const roomNames = (rooms: { building: string | null; room: string | null }[]): string[] =>
  rooms.map((r) => r.room ?? r.building ?? "").filter(Boolean);

/**
 * Fetches the plan's timetables and flattens them to this semester's week.
 *
 * Only the ACTIVE courses, and only through `applyGroupSelection` — the same
 * narrowing the planner's two views use, so the landing page can never offer a
 * parallel the week itself does not draw. A course whose fetch fails is simply
 * absent: the landing page is not the surface that explains why (the planner
 * is), and a half-loaded card is better than an error on a page whose job is
 * to get you to the planner.
 */
export async function loadWeekSessions(
  plan: PlanState,
  semesterId: string,
  teachingWeeks: number[],
): Promise<NowSession[]> {
  const year = semesterYear(semesterId);
  if (year === null) return [];
  const active: PlanCourse[] = plan.courses.filter((c) => !c.dropped);
  const bundles = await Promise.all(
    active.map((course) => fetchCourseBundle(course.code, year, course.version).catch(() => null)),
  );

  const out: NowSession[] = [];
  active.forEach((course, index) => {
    const bundle = bundles[index];
    const timetable = bundle?.timetable;
    if (!timetable) return;
    const selected = applyGroupSelection(timetable, course.groups, plan.program?.code ?? null);
    for (const raw of entriesInSemester(selected, teachingWeeks)) {
      const startAt = (raw.dayNumber - 1) * 24 * 60 + toMinutes(raw.startTime);
      const rooms = roomNames(raw.rooms);
      const length = toMinutes(raw.endTime) - toMinutes(raw.startTime);
      out.push({
        code: course.code,
        courseName: bundle?.details?.courseName ?? course.name,
        activity: raw.title?.trim() || raw.name?.trim() || "",
        room: rooms[0] ?? "",
        roomsExtra: Math.max(0, rooms.length - 1),
        allDay: length >= ALL_DAY_MINUTES && classifyActivity(raw) !== "lecture",
        dayNumber: raw.dayNumber,
        startTime: raw.startTime,
        endTime: raw.endTime,
        startAt,
        endAt: startAt + length,
      });
    }
  });
  return out;
}
