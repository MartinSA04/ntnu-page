/**
 * The conflict engine (PLANNER.md §3): pairwise timetable clash detection
 * and exam-date collision/gap analysis over a selected set of courses.
 *
 * DR-1 (PRODUCT.md): hard conflicts are lecture-only. `findConflicts` itself
 * stays classification-agnostic — the simpler of the two APIs described in
 * the brief (a `classify` option vs. a pre-filtered input) — and callers
 * filter with `lecturesOnly`/`classifyActivity` (activity.ts) before calling
 * it: `findConflicts(lecturesOnly(entries))`. Øving/lab entries are still
 * rendered (muted, non-clashing) by simply not being fed into this function.
 */
import { parseWeeks, type ScheduleEntry, toMinutes } from "./schedule.js";

/** One detected timetable clash between two entries of different courses. */
export interface Conflict {
  a: ScheduleEntry;
  b: ScheduleEntry;
  dayNumber: number;
  /** Overlap start, minutes since midnight. */
  start: number;
  /** Overlap end, minutes since midnight. */
  end: number;
  /** Week numbers both entries share. */
  weeks: number[];
}

/**
 * Pairwise conflicts across `entries`. Two entries conflict when: different
 * courses, same `dayNumber`, overlapping `[startTime, endTime)` (a shared
 * boundary instant — e.g. one ending 12:00 while the other starts 12:00 — is
 * NOT an overlap), and at least one shared teaching week. Entries from the
 * same course never conflict with each other (parallel groups/labs of one
 * course are not a "clash" in this product's sense).
 */
export function findConflicts(entries: ScheduleEntry[]): Conflict[] {
  const conflicts: Conflict[] = [];
  // Parallel groups (øvinger/labs) of a course repeat the same slot many
  // times; identical (course-pair, day, span, weeks) collisions are one
  // conflict, not one per group pairing.
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i];
      const b = entries[j];
      if (!a || !b) continue;
      if (a.courseCode === b.courseCode) continue;
      if (a.dayNumber !== b.dayNumber) continue;

      const aStart = toMinutes(a.startTime);
      const aEnd = toMinutes(a.endTime);
      const bStart = toMinutes(b.startTime);
      const bEnd = toMinutes(b.endTime);
      if (aStart === null || aEnd === null || bStart === null || bEnd === null) continue;

      const start = Math.max(aStart, bStart);
      const end = Math.min(aEnd, bEnd);
      if (start >= end) continue; // touching boundary or disjoint: not a conflict

      const aWeeks = new Set(parseWeeks(a.weeks));
      const bWeeks = parseWeeks(b.weeks);
      const weeks = bWeeks.filter((w) => aWeeks.has(w));
      if (weeks.length === 0) continue;

      const [codeX, codeY] = [a.courseCode, b.courseCode].sort();
      const key = `${codeX}|${codeY}|${a.dayNumber}|${start}|${end}|${weeks.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      conflicts.push({ a, b, dayNumber: a.dayNumber, start, end, weeks });
    }
  }
  return conflicts;
}

/** One course's exam occasion as input to `analyzeExams`. */
export interface ExamInput {
  code: string;
  date: string | null;
}

/** One row of the sorted exam timeline, annotated with spacing to the next exam. */
export interface ExamRow {
  code: string;
  date: string;
  /** Days until the next row's exam (by date order); `null` for the last row. */
  dayGap: number | null;
  /** Another exam falls on the exact same date. */
  collision: boolean;
  /** Next exam is within 1 day (but not a same-day collision) — "tett". */
  tight: boolean;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Sort exams by date and annotate day-gaps, same-date collisions and
 * 1-day-gap "tight" spacing warnings. Entries with a `null` date are
 * skipped (not scheduled yet). Multiple exams can share a course code
 * (multi-part/continuation exams).
 */
export function analyzeExams(exams: ExamInput[]): ExamRow[] {
  const dated = exams.filter(
    (e): e is ExamInput & { date: string } => e.date !== null && e.date !== "",
  );
  const sorted = [...dated].sort((x, y) => x.date.localeCompare(y.date));

  const rows: ExamRow[] = sorted.map((e) => ({
    code: e.code,
    date: e.date,
    dayGap: null,
    collision: false,
    tight: false,
  }));

  for (let i = 0; i < rows.length; i++) {
    const current = rows[i];
    const next = rows[i + 1];
    if (!current) continue;
    if (!next) continue;

    const gapDays = Math.round((Date.parse(next.date) - Date.parse(current.date)) / MS_PER_DAY);
    current.dayGap = gapDays;

    if (gapDays === 0) {
      current.collision = true;
      next.collision = true;
    } else if (gapDays === 1) {
      current.tight = true;
      next.tight = true;
    }
  }

  return rows;
}
