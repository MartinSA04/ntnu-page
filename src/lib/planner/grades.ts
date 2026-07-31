/**
 * Pure grade-distribution model for `/emne/[code]/`'s Karakterer figure. Source
 * is DBH table 308 unchanged: **one row per (course version, year, semester,
 * grade)**. Four upstream facts this module absorbs:
 *
 * - **Versions double up** — a re-versioned course reports the same tuple once
 *   per version; counts are summed, because a candidate sat the course.
 * - **Counts are privacy-masked** — `total` is `null` where DBH suppresses a
 *   small cell. A masked cell is NOT a zero: it is folded into `masked` and
 *   left out of the percentage base.
 * - **Not every course uses letters** — pass/fail courses report `G`/`H`, so
 *   each bucket carries the `scale` it is measured on.
 * - **Not every sitting is a semester** — the utsatt/kont sitting is its own
 *   (year, semester) row, and drawn as a peer it manufactures a difficulty
 *   signal. `ordinarySeasons` separates those out.
 *
 * No DOM and no fetch — `gradeChart.ts` renders the `GradeModel`.
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

/**
 * Which grade scale a semester's bars are measured on. `mixed` is real and
 * rare — a re-versioned course can change its grade rule mid-year.
 */
export type GradeScale = "letter" | "passfail" | "mixed";

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
  /** Never compare a bar across two of these — the denominators differ. */
  scale: GradeScale;
  bars: GradeBar[];
}

/**
 * What the figure draws, and what it left out. `deferred` is never silently
 * dropped: `gradeChart.ts` names those terms in a note under the charts.
 */
export interface GradeModel {
  /** Ordinary sittings, newest first, capped at `limit`. */
  semesters: GradeSemester[];
  /** Utsatt/kont sittings held out of the figure, newest first. */
  deferred: GradeSemester[];
}

export interface GradeModelOptions {
  /** Ordinary semesters drawn at once; `Infinity` for all of them. */
  limit?: number;
  /**
   * Season words ("Vår" / "Høst") in which this course holds an **ordinary**
   * exam, from the scraped `occasion`. Null or empty means we do not know, and
   * then nothing is held out — hiding a real cohort is worse than showing one
   * too many.
   */
  ordinarySeasons?: readonly string[] | null;
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
 * alphabetically, so a course mixing letters and pass/fail codes stays
 * readable.
 */
function compareGrades(a: string, b: string): number {
  const ia = LETTER_ORDER.indexOf(a);
  const ib = LETTER_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b, "nb");
}

/** Which scale a bucket's grade codes belong to. */
function scaleOf(grades: Iterable<string>): GradeScale {
  let letters = false;
  let others = false;
  for (const grade of grades) {
    if (LETTER_ORDER.includes(grade)) letters = true;
    else others = true;
  }
  if (letters && others) return "mixed";
  return others ? "passfail" : "letter";
}

/**
 * A deferred bucket must be *small* as well as off-season.
 *
 * The season test alone misreads a course that moved term: the scrape only
 * knows this year's rhythm, so a course now examined in spring would have every
 * real 600-candidate autumn cohort relabelled "utsatt". A re-sit cohort is by
 * construction a fraction of the one it re-sits, so anything at least half the
 * size of the biggest ordinary cohort is kept and drawn.
 */
const DEFERRED_MAX_SHARE = 0.5;

function splitDeferred(
  semesters: GradeSemester[],
  ordinarySeasons: readonly string[] | null | undefined,
): GradeModel {
  if (!ordinarySeasons || ordinarySeasons.length === 0) return { semesters, deferred: [] };
  const ordinary = new Set(ordinarySeasons);
  // A bucket DBH gave no season name to is never held out — we cannot place it.
  const offSeason = (s: GradeSemester): boolean => s.season !== null && !ordinary.has(s.season);

  const inSeason = semesters.filter((s) => !offSeason(s));
  if (inSeason.length === 0) return { semesters, deferred: [] };
  let ceiling = 0;
  for (const s of inSeason) ceiling = Math.max(ceiling, s.candidates);
  ceiling *= DEFERRED_MAX_SHARE;

  const kept: GradeSemester[] = [];
  const deferred: GradeSemester[] = [];
  for (const s of semesters) {
    if (offSeason(s) && s.candidates < ceiling) deferred.push(s);
    else kept.push(s);
  }
  return { semesters: kept, deferred };
}

/** Newest first — the semester a student is choosing against is this one. */
function compareSemesters(a: GradeSemester, b: GradeSemester): number {
  if (a.year !== b.year) return b.year - a.year;
  const rank = (s: string | null): number => (s === "Høst" ? 1 : s === "Vår" ? 0 : -1);
  return rank(b.season) - rank(a.season);
}

/**
 * Folds raw DBH rows into one bucket per (year, semester), newest first, and
 * separates the utsatt/kont sittings from the ordinary ones.
 *
 * `limit` keeps the figure to the most recent N ordinary semesters. Semesters
 * whose every cell was masked are dropped — a row of six 0 % bars asserts
 * something DBH explicitly declined to publish.
 */
export function buildGradeSemesters(
  rows: GradeRowInput[],
  options: GradeModelOptions = {},
): GradeModel {
  const limit = options.limit ?? 6;
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
      scale: scaleOf(bucket.grades.keys()),
      bars,
    });
  }

  semesters.sort(compareSemesters);
  const model = splitDeferred(semesters, options.ordinarySeasons);
  if (!Number.isFinite(limit)) return model;
  return { semesters: model.semesters.slice(0, limit), deferred: model.deferred.slice(0, limit) };
}

/**
 * The tallest bar across the semesters handed in — the shared y-scale that
 * makes small multiples comparable. 0 for an empty list.
 *
 * Feed it ONE grade scale at a time: a pass/fail semester peaks near 100 % by
 * construction, so measuring letter charts against it flattens them to 4–29 px
 * of a 96 px plot.
 */
export function peakPercent(semesters: GradeSemester[]): number {
  let peak = 0;
  for (const semester of semesters) {
    for (const bar of semester.bars) peak = Math.max(peak, bar.percent);
  }
  return peak;
}

/**
 * Under this many published candidates a semester has no share worth drawing:
 * "3 kandidater" rendered a full-height 100 % D, the loudest mark in the
 * figure, made by one candidate.
 */
export const MIN_CHART_CANDIDATES = 10;

/**
 * The grades this cohort actually received. DBH publishes explicit zeros, and
 * a 0-count bar is not a grade anybody got.
 */
export function awardedBars(semester: GradeSemester): GradeBar[] {
  return semester.bars.filter((bar) => bar.count > 0);
}

/**
 * Does this semester earn bars at all? Two facts do not need a plot: a cohort
 * too small for a share to mean anything, and a single grade at 100 %. Both
 * render as a sentence instead — and neither may set the shared y-scale.
 */
export function drawsChart(semester: GradeSemester): boolean {
  return semester.candidates >= MIN_CHART_CANDIDATES && awardedBars(semester).length > 1;
}

/**
 * One peak per grade scale, over the semesters that actually draw bars: a
 * pass/fail term peaks near 100 % by construction, and measuring A–F charts
 * against it left them 4–29 px tall with their labels stranded above them.
 */
export function peaksByScale(semesters: GradeSemester[]): Map<GradeScale, number> {
  const peaks = new Map<GradeScale, number>();
  for (const semester of semesters) {
    if (!drawsChart(semester)) continue;
    peaks.set(semester.scale, Math.max(peaks.get(semester.scale) ?? 0, peakPercent([semester])));
  }
  return peaks;
}
