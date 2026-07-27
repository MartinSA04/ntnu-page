/**
 * Pure grade-distribution model for `/emne/[code]/`'s Karakterer figure.
 *
 * Source is the worker's `/api/course/:code/grades`, which passes DBH table
 * 308 through `ntnu-api` unchanged: **one row per (course version, year,
 * semester, grade)**. A course taught in both terms of four years with six
 * letter grades is ~48 rows, and the figure wants eight buckets.
 *
 * Three upstream facts this module exists to absorb:
 *
 * - **Versions double up.** DBH keys courses as `TDT4100-1`, and a course that
 *   has been re-versioned reports the same (year, semester, grade) once per
 *   version. Counts are summed across versions — a candidate sat the course,
 *   not a version of it.
 * - **Counts are privacy-masked.** `total` is `null` where DBH suppresses a
 *   small cell. A masked cell is NOT a zero: it is folded into `masked` and
 *   left out of the percentage base, so a bar never claims 0 % for something
 *   that merely could not be published.
 * - **Not every course uses letters.** Pass/fail courses report `G`/`H`
 *   (bestått/ikke bestått), not `A`–`F`. Ordering puts the letter scale first
 *   in its own order, then anything else alphabetically, so a pass/fail course
 *   still renders a truthful two-bar figure instead of an empty one.
 *
 * No DOM and no fetch — `gradeChart.ts` renders `GradeSemester[]`.
 */

/** One row exactly as the worker relays it from DBH. */
export interface GradeRowInput {
  courseCode: string;
  year: number;
  semester: number | null;
  semesterName: string | null;
  grade: string;
  total: number | null;
}

/** One grade's share within a semester. */
export interface GradeBar {
  grade: string;
  count: number;
  /** Share of that semester's *published* candidates, 0–100. */
  percent: number;
}

/** One semester's distribution, richest-first in `buildGradeSemesters`. */
export interface GradeSemester {
  year: number;
  /** "Vår" / "Høst" as DBH names it, or null when it does not. */
  season: string | null;
  /** "Vår 2024" — what the figure labels the chart. */
  label: string;
  /** Published candidates this semester (the percentage base). */
  candidates: number;
  /** How many rows were privacy-masked, i.e. counted by DBH but not published. */
  masked: number;
  bars: GradeBar[];
}

/** The A–F scale, in the order a figure reads left to right. */
const LETTER_ORDER = ["A", "B", "C", "D", "E", "F"];

/** DBH's `semester` codes: 1 = spring, 3 = autumn. */
function seasonOf(row: GradeRowInput): string | null {
  const name = row.semesterName?.trim();
  if (name) return name;
  if (row.semester === 1) return "Vår";
  if (row.semester === 3) return "Høst";
  return null;
}

/**
 * Grade sort: the letter scale in its own order first, then every other code
 * alphabetically. A course mixing letters and pass/fail codes (it happens —
 * a re-versioned course can change its grade rule) stays readable either way.
 */
function compareGrades(a: string, b: string): number {
  const ia = LETTER_ORDER.indexOf(a);
  const ib = LETTER_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b, "nb");
}

/** Newest first — the semester a student is choosing against is this one. */
function compareSemesters(a: GradeSemester, b: GradeSemester): number {
  if (a.year !== b.year) return b.year - a.year;
  const rank = (s: string | null): number => (s === "Høst" ? 1 : s === "Vår" ? 0 : -1);
  return rank(b.season) - rank(a.season);
}

/**
 * Folds raw DBH rows into one bucket per (year, semester), newest first.
 *
 * `limit` keeps the figure to the most recent N semesters; pass `Infinity`
 * for all of them. Semesters whose every cell was masked (candidates === 0)
 * are dropped — there is no distribution to draw, and a row of six 0 % bars
 * asserts something DBH explicitly declined to publish.
 */
export function buildGradeSemesters(rows: GradeRowInput[], limit = 6): GradeSemester[] {
  const buckets = new Map<
    string,
    { year: number; season: string | null; grades: Map<string, number>; masked: number }
  >();

  for (const row of rows) {
    const grade = row.grade?.trim();
    if (!grade) continue;
    const season = seasonOf(row);
    const key = `${row.year}|${season ?? ""}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { year: row.year, season, grades: new Map(), masked: 0 };
      buckets.set(key, bucket);
    }
    if (row.total === null) {
      bucket.masked += 1;
      continue;
    }
    // Summed, not overwritten: two DBH course versions report the same
    // (year, semester, grade) separately.
    bucket.grades.set(grade, (bucket.grades.get(grade) ?? 0) + row.total);
  }

  const semesters: GradeSemester[] = [];
  for (const bucket of buckets.values()) {
    let candidates = 0;
    for (const count of bucket.grades.values()) candidates += count;
    if (candidates === 0) continue;

    const bars = [...bucket.grades.entries()]
      .sort(([a], [b]) => compareGrades(a, b))
      .map(([grade, count]) => ({
        grade,
        count,
        percent: (count / candidates) * 100,
      }));

    semesters.push({
      year: bucket.year,
      season: bucket.season,
      label: bucket.season ? `${bucket.season} ${bucket.year}` : String(bucket.year),
      candidates,
      masked: bucket.masked,
      bars,
    });
  }

  semesters.sort(compareSemesters);
  return Number.isFinite(limit) ? semesters.slice(0, limit) : semesters;
}

/**
 * The tallest bar across every shown semester — the shared y-scale that makes
 * small multiples comparable. Returns 0 for an empty model (the caller draws
 * nothing rather than dividing by it).
 */
export function peakPercent(semesters: GradeSemester[]): number {
  let peak = 0;
  for (const semester of semesters) {
    for (const bar of semester.bars) peak = Math.max(peak, bar.percent);
  }
  return peak;
}
