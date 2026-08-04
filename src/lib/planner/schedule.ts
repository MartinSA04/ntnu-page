/**
 * Time/week math for the planner engine.
 *
 * `parseWeeks`/`toMinutes` live in `ntnu-api/schedule` now. They are pure and
 * the package is `sideEffects: false`, so Rollup drops everything the planner
 * does not call and the built client bundle carries no upstream URL — which
 * `tests/planner/schedule.test.ts` asserts. They stay re-exported from here
 * because the planner's ~15 call sites already point at this seam.
 *
 * What is genuinely local is below: semester-id arithmetic and the two "which
 * entries count for this student" filters are planner product rules, not facts
 * about NTNU's payloads.
 */

import { parseWeeks, type WeeklySlot } from "ntnu-api";

export { parseWeeks, toMinutes } from "ntnu-api";

/**
 * A recurring weekly slot — `ntnu-api`'s own `WeeklySlot`, kept under this name
 * because the planner names it in ~40 places.
 */
export type ScheduleEntry = WeeklySlot;

/** The calendar year encoded in a `Semester.id` like `"26h"`/`"27v"` (2-digit year + season letter). */
export function semesterYear(semesterId: string): number | null {
  const m = /^(\d{2})[hv]$/i.exec(semesterId.trim());
  if (!m) return null;
  return 2000 + Number(m[1]);
}

/**
 * The subset of `entries` actually taught in a semester with the given teaching
 * weeks. An empty intersection is "not taught this semester" and is dropped.
 */
export function entriesInSemester<T extends ScheduleEntry>(
  entries: T[],
  teachingWeeks: number[],
): T[] {
  const teaching = new Set(teachingWeeks);
  return entries.filter((entry) => parseWeeks(entry.weeks).some((w) => teaching.has(w)));
}

/**
 * The subset of `entries` taught in ONE week.
 *
 * The week the planner draws is a mønsteruke: every session of the semester,
 * collapsed into one week. That is right for choosing courses and wrong for
 * reading a particular Monday — a course taught weeks 34 to 40 and one taught
 * 41 to 48 are drawn in the same slot, so the grid shows an overlap that never
 * happens. `findConflicts` already knows better (it computes the pairs' shared
 * weeks), which is exactly why the DRAWING has to be able to say it too.
 *
 * A no-op away from `entriesInSemester`: same shape, one week instead of a set.
 */
export function entriesInWeek<T extends ScheduleEntry>(entries: T[], week: number): T[] {
  return entries.filter((entry) => parseWeeks(entry.weeks).includes(week));
}

/**
 * Filter multi-section entries to the sections relevant for a study programme.
 * Big service courses publish parallel lecture sections per programme cluster,
 * carried in `studyProgramKeys`. When `programCode` is set and at least one
 * entry names it, entries naming only OTHER programmes are dropped (entries
 * with no keys are for everyone and stay). When no entry names the programme,
 * all entries are kept — the filter must never fabricate an empty week.
 */
export function entriesForProgram<T extends { studyProgramKeys?: string[] | null }>(
  entries: T[],
  programCode: string | null | undefined,
): T[] {
  if (!programCode) return entries;
  const mentionsProgram = entries.some((e) => e.studyProgramKeys?.includes(programCode));
  if (!mentionsProgram) return entries;
  return entries.filter(
    (e) =>
      !e.studyProgramKeys ||
      e.studyProgramKeys.length === 0 ||
      e.studyProgramKeys.includes(programCode),
  );
}
