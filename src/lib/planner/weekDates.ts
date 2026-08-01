/**
 * WHICH WEEK YOU ARE LOOKING AT.
 *
 * The planner draws a PATTERN week — a block says "uke 34–47" and stands for
 * every one of them — but the page is opened in exactly one of those weeks, and
 * every calendar a student already uses says which. Without it the grid is a
 * diagram; with it, it is this week.
 *
 * The honesty problem this creates is real and is answered elsewhere: a block
 * whose weeks read "uke 34–40, 42–47" is drawn under a date in week 41 where it
 * does not occur. That is what the margin notes and the provenance line are
 * for — they name the course and the week it skips. A date numeral is not a
 * claim that every block under it happens; it is a claim about which Monday
 * this column is, which is true.
 *
 * ISO 8601 throughout, because that is the week numbering NTNU's own timetable
 * data is published in.
 */

/** Midnight of a date's own day, so arithmetic counts days and not hours. */
function midnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * `date`'s ISO 8601 week number.
 *
 * The ISO rule is "the week containing the year's first Thursday is week 1", so
 * the algorithm is: step to this week's Thursday, then count weeks from the
 * Thursday of the first week of THAT Thursday's year. Anchoring on Thursday is
 * what makes 1 January and 31 December land in the right year's numbering
 * without a special case for either.
 */
export function isoWeekNumber(date: Date): number {
  const thursday = midnight(date);
  // getDay(): 0 = Sunday. ISO counts Monday as 1, so Sunday is 7.
  const isoDay = thursday.getDay() === 0 ? 7 : thursday.getDay();
  thursday.setDate(thursday.getDate() + 4 - isoDay);
  const yearStart = new Date(thursday.getFullYear(), 0, 1);
  return Math.ceil(((thursday.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/**
 * The day-of-month for each weekday of `date`'s own week, keyed the way the
 * grid keys its columns: 1 = Monday … 6 = Saturday.
 */
export function weekdayDates(date: Date): Map<number, number> {
  const start = midnight(date);
  const isoDay = start.getDay() === 0 ? 7 : start.getDay();
  start.setDate(start.getDate() - (isoDay - 1));
  const out = new Map<number, number>();
  for (let i = 0; i < 6; i++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    out.set(i + 1, day.getDate());
  }
  return out;
}
