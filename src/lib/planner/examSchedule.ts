/**
 * Pure exam-list model: sorts a course selection's exam occasions
 * chronologically and annotates each dated row with the whole-day gap to the
 * next, a "tight" flag, a `sameDay` flag and a countdown on the first upcoming
 * exam. Undated exams are kept separately, in input order, and never enter the
 * gap math.
 *
 * This is the ONE exam engine — do not add a second "tett" rule elsewhere.
 *
 * No DOM, no dependencies. Date math is `Date.UTC` day-differencing over
 * hand-parsed "YYYY-MM-DD" strings, never `Date.parse`, so behaviour does not
 * depend on the runtime's locale or timezone.
 */

/** One course's exam occasion, as supplied by the caller. */
export interface ExamListInput {
  code: string;
  date: string | null;
}

/** One dated row of the sorted exam timeline. */
export interface ExamListRow {
  code: string;
  /** ISO "YYYY-MM-DD". */
  date: string;
  /** 2-letter Norwegian weekday, lowercase (e.g. "to" for Thursday). */
  weekday: string;
  /** Whole days to the NEXT row; `null` on the last dated row. */
  gapToNext: number | null;
  /**
   * **Lesedager** — the free days BETWEEN two exams, both exam days excluded.
   * `null` on the last dated row, never negative.
   *
   * This, not `gapToNext`, is what a student is asking: exams on the 15th and
   * the 17th give exactly **one** day to revise, so "2 dager" overstates the
   * room by a whole day. `gapToNext` stays because the distance between the
   * dates is what the band and any date arithmetic want.
   */
  readingDays: number | null;
  /**
   * One reading day or none — the same threshold as before (`gapToNext <= 2`),
   * re-expressed in the unit the list now quotes.
   */
  tight: boolean;
  /** Shares its date with another row (their connector gap is 0). */
  sameDay: boolean;
  /** Set ONLY on the first row with `date >= todayIso`; every other row `null`. */
  daysFromToday: number | null;
  /**
   * Already sat — `date < todayIso`, strictly, so a sitting today is NOT past.
   * Lets the list de-emphasise history and stop painting clash ink on spacing
   * that is over. Rendering is the caller's; this only states the fact.
   */
  past: boolean;
}

/** The full exam-list model for a course selection. */
export interface ExamListModel {
  /** Date-ascending. */
  rows: ExamListRow[];
  /** Codes with a `null` date, in input order. */
  dateless: string[];
}

const WEEKDAYS = ["sø", "ma", "ti", "on", "to", "fr", "lø"];
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Parses a "YYYY-MM-DD" ISO date string into a UTC-midnight timestamp. */
function toUtcTime(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

/** Whole days from `fromIso` to `toIso` (positive when `toIso` is later). */
function dayDiff(fromIso: string, toIso: string): number {
  return Math.round((toUtcTime(toIso) - toUtcTime(fromIso)) / MS_PER_DAY);
}

/**
 * Builds the exam-list model: sorts dated exams by date, annotates each row
 * with its gap to the next, tight/sameDay flags and (on the first upcoming
 * row only) a countdown from `todayIso`, and reports dateless codes
 * separately.
 */
export function buildExamList(exams: ExamListInput[], todayIso: string): ExamListModel {
  const dateless: string[] = [];
  const dated: { code: string; date: string }[] = [];
  for (const exam of exams) {
    // A blank date is "not scheduled", exactly like `null`: without the guard
    // an "" date parses to NaN and renders as "NaN dagers mellomrom".
    if (exam.date === null || exam.date === "") {
      dateless.push(exam.code);
    } else {
      dated.push({ code: exam.code, date: exam.date });
    }
  }

  const sorted = [...dated].sort((a, b) => a.date.localeCompare(b.date));

  const rows: ExamListRow[] = sorted.map((exam) => ({
    code: exam.code,
    date: exam.date,
    weekday: WEEKDAYS[new Date(toUtcTime(exam.date)).getUTCDay()] ?? "",
    gapToNext: null,
    readingDays: null,
    tight: false,
    sameDay: false,
    daysFromToday: null,
    past: exam.date < todayIso,
  }));

  for (let i = 0; i < rows.length; i++) {
    const current = rows[i];
    const next = rows[i + 1];
    if (!current || !next) continue;

    const gap = dayDiff(current.date, next.date);
    current.gapToNext = gap;
    // Both exam days come off the distance: a gap of 1 is zero reading days, a
    // gap of 2 is one. Clamped at zero so a same-day pair reports none.
    current.readingDays = Math.max(0, gap - 1);
    current.tight = gap <= 2;
    if (gap === 0) {
      current.sameDay = true;
      next.sameDay = true;
    }
  }

  for (const row of rows) {
    if (row.date >= todayIso) {
      row.daysFromToday = dayDiff(todayIso, row.date);
      break;
    }
  }

  return { rows, dateless };
}
