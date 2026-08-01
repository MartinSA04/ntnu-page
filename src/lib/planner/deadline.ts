/**
 * THE DEADLINE. PRODUCT.md D13/c3-1: the whole positioning is "the thinking
 * tool upstream of Studentweb, used *before* the registration deadline", and
 * the deadline was on screen in zero of the six flows. This is that MUST.
 *
 * NTNU's registration dates are standing institutional facts, not crawled
 * ones: **15 September** for a høst semester and **1 February** for a vår
 * semester. They are written here rather than fetched because there is no
 * endpoint for them and inventing one would be worse than stating what every
 * student already knows — but they ARE a fact about NTNU, so if this ever
 * moves upstream it moves to `ntnu-api` with the rest (CLAUDE.md's layering
 * rule).
 */

import { semesterYear } from "./schedule.js";

/** Day and month of the deadline for each semester half, 1-indexed month. */
const DEADLINES: Record<"h" | "v", { day: number; month: number; word: string }> = {
  h: { day: 15, month: 9, word: "15. september" },
  v: { day: 1, month: 2, word: "1. februar" },
};

export interface RegistrationDeadline {
  /** The deadline as a local calendar date at midnight. */
  date: Date;
  /** Whole days from `now`'s date to the deadline's. 0 means "today". */
  daysLeft: number;
  /** How the date is spoken: "15. september". */
  word: string;
}

/** Midnight of a date's own day, so a difference counts DAYS and not hours. */
function midnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * The registration deadline for `semesterId` relative to `now`, or `null` when
 * there is nothing honest to say — an unparseable semester, or a deadline that
 * has already passed.
 *
 * A passed deadline is deliberately silent rather than "0 dager igjen": the
 * page is still perfectly useful for planning the term you are already in, and
 * a permanent expired banner is the kind of chrome a student learns to ignore.
 */
export function registrationDeadline(
  semesterId: string,
  now: Date = new Date(),
): RegistrationDeadline | null {
  const year = semesterYear(semesterId);
  if (year === null) return null;
  const half = semesterId.trim().slice(-1).toLowerCase() === "h" ? "h" : "v";
  const spec = DEADLINES[half];
  const date = new Date(year, spec.month - 1, spec.day);
  const daysLeft = Math.round((midnight(date) - midnight(now)) / 86_400_000);
  if (daysLeft < 0) return null;
  return { date, daysLeft, word: spec.word };
}

/**
 * The sentence, with the date marked for emphasis by the caller.
 *
 * Returns the two halves rather than a string with markup in it: the date is
 * the one part set in full ink, and building `<b>` here would put presentation
 * in a module whose job is the calendar.
 */
export function deadlineParts(deadline: RegistrationDeadline): {
  before: string;
  date: string;
  after: string;
} {
  const after =
    deadline.daysLeft === 0
      ? " — i dag"
      : deadline.daysLeft === 1
        ? " — 1 dag igjen"
        : ` — ${deadline.daysLeft} dager igjen`;
  return { before: "Oppmelding stenger ", date: deadline.word, after };
}
