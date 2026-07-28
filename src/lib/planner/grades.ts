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
 *   still renders a truthful two-bar figure instead of an empty one. Each
 *   bucket carries the `scale` it is measured on so the figure never sizes a
 *   letter chart against a two-bucket pass/fail one (course-5/cpc-5).
 * - **Not every sitting is a semester.** DBH reports the utsatt/kont sitting
 *   as its own (year, semester) row, so a spring-taught course grows an
 *   autumn "semester" made entirely of candidates who already failed once.
 *   Drawn as a peer it manufactures a difficulty signal (pc-2/cpc-6): TMA4115
 *   reads 54 % F on n=26 beside 6 % F on n=697. `ordinarySeasons` — derived
 *   by the caller from the scraped exam `occasion`, the same signal
 *   `examList.ts` uses for DR-3 — separates those buckets out.
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
 * rare — a re-versioned course can change its grade rule mid-year, and DBH
 * then reports A–F and G/H rows for the same (year, semester).
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
   * exam, from the scraped `occasion` (see `gradeChart.ts`). Null or empty
   * means we do not know, and then nothing is held out — the same fail-open
   * stance `examList.ts` takes, for the same reason: hiding a real cohort is
   * worse than showing one too many.
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
 * The season test alone would misread a course that moved term: the scrape
 * only knows this year's exam rhythm, so a course now examined in spring
 * would have every one of its real 600-candidate autumn cohorts relabelled
 * "utsatt". A re-sit cohort is by construction a fraction of the cohort it
 * re-sits (TDT4100: 62–85 against 508–596), so anything at least half the
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
 * `limit` keeps the figure to the most recent N ordinary semesters; pass
 * `Infinity` for all of them. Semesters whose every cell was masked
 * (candidates === 0) are dropped — there is no distribution to draw, and a
 * row of six 0 % bars asserts something DBH explicitly declined to publish.
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
 * makes small multiples comparable. Returns 0 for an empty list (the caller
 * draws nothing rather than dividing by it).
 *
 * Feed it ONE grade scale at a time. A pass/fail semester peaks near 100 %
 * by construction, so measuring letter charts against it flattens them to
 * 4–29 px of a 96 px plot (cpc-5) — the comparability this exists to give.
 */
export function peakPercent(semesters: GradeSemester[]): number {
  let peak = 0;
  for (const semester of semesters) {
    for (const bar of semester.bars) peak = Math.max(peak, bar.percent);
  }
  return peak;
}

/**
 * Under this many published candidates a semester has no share worth drawing.
 * HIST1505's "Vår 2023 · 3 kandidater" rendered a full-height 100 % D — the
 * loudest mark in the whole figure, made by one candidate (course-5).
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
 * too small for a share to mean anything, and a single grade at 100 %
 * (course-4 measured four identical full-width "100,0 % G" slabs on
 * /emne/HMS0006/). Both are rendered as a sentence instead — and neither may
 * set the shared y-scale.
 */
export function drawsChart(semester: GradeSemester): boolean {
  return semester.candidates >= MIN_CHART_CANDIDATES && awardedBars(semester).length > 1;
}

/**
 * One peak per grade scale, over the semesters that actually draw bars.
 *
 * This is the whole of the cpc-5 fix: a pass/fail term peaks near 100 % by
 * construction, and measuring A–F charts against it left them 4–29 px tall
 * with their value labels stranded 70 px above their own bars.
 */
export function peaksByScale(semesters: GradeSemester[]): Map<GradeScale, number> {
  const peaks = new Map<GradeScale, number>();
  for (const semester of semesters) {
    if (!drawsChart(semester)) continue;
    peaks.set(semester.scale, Math.max(peaks.get(semester.scale) ?? 0, peakPercent([semester])));
  }
  return peaks;
}
