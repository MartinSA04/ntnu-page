/**
 * Time/week math for the planner engine. Week parsing is reimplemented here
 * (rather than importing `ntnu-api`'s `weekNumbers`) so this module stays
 * framework-free and safe to bundle into the browser: see PLANNER.md §3.
 */

/** A recurring weekly slot, shaped like `ntnu-api`'s `TimetableEntry` (structural subset). */
export interface ScheduleEntry {
  courseCode: string;
  dayNumber: number;
  startTime: string;
  endTime: string;
  weeks: string[];
}

/**
 * Expand week-range strings (`"2-13"`, `"36"`) into a flat, deduplicated,
 * ascending list of ISO week numbers. Malformed entries (non-numeric,
 * reversed ranges, empty strings) are skipped rather than thrown — upstream
 * data is not guaranteed clean.
 */
export function parseWeeks(weeks: string[]): number[] {
  const result = new Set<number>();
  for (const raw of weeks) {
    const token = raw.trim();
    if (token === "") continue;
    const rangeMatch = /^(\d+)-(\d+)$/.exec(token);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start > end) continue;
      for (let w = start; w <= end; w++) result.add(w);
      continue;
    }
    if (/^\d+$/.test(token)) {
      result.add(Number(token));
    }
    // anything else (e.g. "abc") is silently skipped
  }
  return [...result].sort((a, b) => a - b);
}

/** Parse `"HH:MM"` into minutes since midnight, or `null` if malformed. */
export function toMinutes(time: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

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
