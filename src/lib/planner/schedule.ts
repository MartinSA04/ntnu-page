/**
 * Time/week math for the planner engine.
 *
 * `parseWeeks`/`toMinutes` were reimplemented here for years, on the grounds
 * that importing `ntnu-api` would drag its `HttpClient` into a browser bundle
 * (PLANNER.md §3). That reasoning no longer applies: they now live in
 * `ntnu-api/schedule`, are pure, and the package is `sideEffects: false`, so
 * Rollup drops everything the planner does not call — the built client bundle
 * carries no upstream URL, which `tests/planner/schedule.test.ts` asserts. The
 * hardened behaviour (dedupe, sort, skip reversed/multi-dash/non-numeric
 * tokens) went upstream with them, so `ntnu-api`'s own `weekNumbers` no longer
 * disagrees with what the planner does.
 *
 * They stay re-exported from this module rather than being imported directly
 * everywhere: the planner has ~15 call sites and this is the seam they already
 * point at.
 *
 * What remains genuinely local is below — semester-id arithmetic and the two
 * "which entries count for this student" filters are planner product rules,
 * not facts about NTNU's payloads.
 */

import { parseWeeks, type WeeklySlot } from "ntnu-api";

export { parseWeeks, toMinutes } from "ntnu-api";

/**
 * A recurring weekly slot, shaped like `ntnu-api`'s `TimetableEntry`
 * (structural subset). Now `ntnu-api`'s own `WeeklySlot` — kept under this
 * name because the planner names it in ~40 places and the two are identical.
 */
export type ScheduleEntry = WeeklySlot;

/** The calendar year encoded in a `Semester.id` like `"26h"`/`"27v"` (2-digit year + season letter). */
export function semesterYear(semesterId: string): number | null {
  const m = /^(\d{2})[hv]$/i.exec(semesterId.trim());
  if (!m) return null;
  return 2000 + Number(m[1]);
}

/**
 * The subset of `entries` that are actually taught in a semester with the
 * given teaching weeks — i.e. whose week list intersects `teachingWeeks`.
 * Entries with an empty intersection ("not taught this semester") are
 * dropped, matching the "Undervises ikke i valgt semester" note in PLANNER.md.
 */
export function entriesInSemester<T extends ScheduleEntry>(
  entries: T[],
  teachingWeeks: number[],
): T[] {
  const teaching = new Set(teachingWeeks);
  return entries.filter((entry) => parseWeeks(entry.weeks).some((w) => teaching.has(w)));
}

/**
 * Filter multi-section timetable entries to the sections relevant for a
 * study programme (PRODUCT.md §0: "your week"). Big service courses
 * (e.g. TMA4400) publish parallel lecture sections per programme cluster,
 * carried in `studyProgramKeys`. When `programCode` is set and at least one
 * entry explicitly names it, entries naming only OTHER programmes are
 * dropped (entries with no programme keys are for everyone and stay).
 * When no entry names the programme (course outside the programme, or
 * upstream stopped sending keys), all entries are kept — the filter must
 * never fabricate an empty week.
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
