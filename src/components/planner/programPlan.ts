/**
 * Programme study-plan → period classification (DR-5, DR-7). Fetches
 * `/api/program/:code/plan`, finds the period matching the chosen semester for
 * a cohort, and resolves it into the courses the student has plus the one
 * question the data forces.
 *
 * The shape of a period changes completely across a degree, and the design
 * follows from that: early years are 4–5 all-`O` courses (a pure lookup); a
 * 3rd-year bachelor period can carry zero `O` courses and one elective group;
 * later sivilingeniør periods have EMPTY top-level `courseGroups` with every
 * course behind a `Valg av studieretning` waypoint; and profesjonsstudier NEST
 * those waypoints up to three levels with the courses at the bottom.
 *
 * So a period resolves in three parts: `obligatory` (prefilled), `choice`
 * (offered, never prefilled — DR-5) and `pendingChoice` (the open question).
 *
 * **The intersection rule.** With no direction chosen we still prefill every
 * course that is `O` in *all* directions — the honest floor, never blank when
 * the data has anything, and it keeps "programme + kull → your week, instantly"
 * true without guessing a direction (which would prefill a confidently wrong
 * 30 sp).
 *
 * DR-5: the only structured signal is `studyChoice.code`. `"O"` reliably marks
 * what NTNU auto-enrolls; everything else is some flavour of choice. We never
 * assert cardinality — `groupName` carries the verbatim title so the UI can
 * quote where "velg 2 av 5" is written down.
 */
import type {
  PlanCourseGroup,
  PlanDirection,
  PlannedCourse,
  StudyPlan,
  StudyWaypoint,
} from "ntnu-api";
import { semesterYear } from "../../lib/planner/schedule.js";

/**
 * The study-plan document shape, straight from `ntnu-api` — copies of a type
 * that is not ours only drift. Type-only imports are erased at build.
 * `PlanDirection`'s recursion (waypoints → directions → waypoints) is the
 * upstream document's own; everything below walks it.
 */
export type { StudyPlan };

export interface ClassifiedCourse {
  code: string;
  name: string;
  version: string;
  credits: number | null;
  /** Verbatim study-plan group title — never paraphrased (DR-5). */
  groupName: string | null;
  /**
   * Verbatim group description prose — never paraphrased (DR-5). This is where
   * "velg 2 av 5" is written down, and the planner quotes it unmodified.
   */
  groupDescription: string | null;
}

/** One selectable studieretning under a waypoint. */
export interface DirectionOption {
  code: string;
  name: string;
}

/** An unanswered `Valg av studieretning` gating this period's courses. */
export interface DirectionChoice {
  /** The waypoint's verbatim name, e.g. "Valg av studieretning". */
  name: string;
  deadlineDate: string | null;
  directions: DirectionOption[];
}

export interface PeriodCourses {
  /** Prefilled as the programme's plan for this semester. */
  obligatory: ClassifiedCourse[];
  /** Offered by the study plan — never prefilled (DR-5). */
  choice: ClassifiedCourse[];
  /** Non-null when a studieretning must be picked before this period resolves. */
  pendingChoice: DirectionChoice | null;
  /** The direction whose courses were folded in, when one applied. */
  appliedDirection: DirectionOption | null;
  /**
   * The period exists but names nothing at all: no obligatory course, no
   * offered course, no question. Distinguishable from a missing period
   * (`classifyPeriod` returns `null`) and from an ordinary one, so the caller
   * can say *why* the week is blank.
   */
  empty: boolean;
}

const MAX_STEP_BACK_TRIES = 3;

async function fetchPlan(code: string, year: number): Promise<StudyPlan | null | "error"> {
  try {
    // The code stays encoded until the worker's own parseCode decodes it —
    // Æ/Ø/Å and codes carrying a literal "/" would otherwise 400.
    const res = await fetch(`/api/program/${encodeURIComponent(code)}/plan?year=${year}`);
    if (res.status === 404) return null;
    if (!res.ok) return "error";
    return (await res.json()) as StudyPlan;
  } catch {
    return "error";
  }
}

export type FindPlanResult =
  | { plan: StudyPlan; year: number }
  | { kind: "not-found" }
  | { kind: "error" };

/** Steps back from `guessYear` up to MAX_STEP_BACK_TRIES times on 404 (unpublished cohort, DR-7). */
async function findProgramPlanUncached(code: string, guessYear: number): Promise<FindPlanResult> {
  let year = guessYear;
  for (let attempt = 0; attempt < MAX_STEP_BACK_TRIES; attempt++) {
    const result = await fetchPlan(code, year);
    if (result === "error") return { kind: "error" };
    if (result !== null) return { plan: result, year };
    year -= 1;
  }
  return { kind: "not-found" };
}

/**
 * Memo keyed `CODE:year`. A study plan is a build-time-stable document every
 * re-render asks for again. Errors are evicted after they settle so a transient
 * failure stays retryable; 404-ladder misses are not, being a property of the
 * data rather than the network.
 */
const planMemo = new Map<string, Promise<FindPlanResult>>();

export function findProgramPlan(code: string, guessYear: number): Promise<FindPlanResult> {
  const key = `${code.toUpperCase()}:${guessYear}`;
  const cached = planMemo.get(key);
  if (cached) return cached;
  const promise = findProgramPlanUncached(code, guessYear).then((result) => {
    if ("kind" in result && result.kind === "error") planMemo.delete(key);
    return result;
  });
  planMemo.set(key, promise);
  return promise;
}

/** Clears the in-memory study-plan memo. Exposed for tests only. */
export function clearProgramPlanMemo(): void {
  planMemo.clear();
}

/**
 * The plan period number for a cohort's semester (DR-7). Period 1 is the
 * cohort's first autumn and periods count up two per study year:
 *
 *     kull 2026 → 26h = 1, 27v = 2, 27h = 3, 28v = 4 …
 *
 * A **spring** semester belongs to the study year that started the *previous*
 * autumn, so its year offset is `semYear - 1 - cohort`; `semYear - cohort`
 * overshoots by a full year every spring.
 *
 * Assumes an autumn intake; the caller treats the result as a suggestion.
 * `null` when the semester id does not parse.
 */
export function periodNumberFor(semesterId: string, cohort: number): number | null {
  const semYear = semesterYear(semesterId);
  if (semYear === null) return null;
  const isAutumn = /h$/i.test(semesterId.trim());
  return isAutumn ? (semYear - cohort) * 2 + 1 : (semYear - 1 - cohort) * 2 + 2;
}

/** How many cohorts back of the current one a chip row considers. */
const MAX_COHORTS_BACK = 7;

/** The highest non-null `periods[].periodNumber` in the plan; `null` when none exists. */
export function maxPeriodNumber(plan: Pick<StudyPlan, "periods">): number | null {
  let max: number | null = null;
  for (const period of plan.periods) {
    if (period.periodNumber !== null && (max === null || period.periodNumber > max)) {
      max = period.periodNumber;
    }
  }
  return max;
}

/**
 * Descending cohort years whose `periodNumberFor` falls within
 * `[1, maxPeriodNumber]` for `semesterId` — the cohorts this plan has a period
 * for at this point in the calendar. A period RANGE test, never whether that
 * period's `courseGroups` are non-empty: a direction-gated period has empty
 * top-level groups by design and is exactly as relevant as any other.
 */
export function relevantCohorts(plan: Pick<StudyPlan, "periods">, semesterId: string): number[] {
  const max = maxPeriodNumber(plan);
  if (max === null) return [];
  const semYear = semesterYear(semesterId);
  if (semYear === null) return [];

  const cohorts: number[] = [];
  for (let cohort = semYear; cohort >= semYear - MAX_COHORTS_BACK; cohort--) {
    const period = periodNumberFor(semesterId, cohort);
    if (period !== null && period >= 1 && period <= max) cohorts.push(cohort);
  }
  return cohorts;
}

/** Above this an obligatory prefill is a bug signal, not a semester (see `isSuspiciousPrefill`). */
const SUSPICIOUS_CREDIT_CEILING = 30;

function toClassified(
  course: PlannedCourse,
  group: Pick<PlanCourseGroup, "name" | "description">,
): ClassifiedCourse {
  return {
    code: course.code,
    name: course.name ?? course.code,
    version: course.version ?? "1",
    credits: course.credits,
    groupName: group.name,
    groupDescription: group.description ?? null,
  };
}

/** True for the administrative markers (e.g. "krav om arbeidslivserfaring") that aren't courses. */
function isRealCourse(course: PlannedCourse): boolean {
  return !course.planElement;
}

function isObligatory(course: PlannedCourse): boolean {
  return course.studyChoice?.code === "O";
}

/** Splits one direction's own course groups into obligatory/choice, honouring `seen`. */
function collectGroups(
  direction: PlanDirection,
  seen: Set<string>,
  obligatory: ClassifiedCourse[],
  choice: ClassifiedCourse[],
): void {
  for (const group of direction.courseGroups ?? []) {
    for (const course of group.courses ?? []) {
      if (!isRealCourse(course)) continue;
      if (seen.has(course.code)) continue;
      seen.add(course.code);
      const classified = toClassified(course, group);
      if (isObligatory(course)) obligatory.push(classified);
      else choice.push(classified);
    }
  }
}

/**
 * How many waypoint levels any walk descends. Real plans reach three; the
 * ceiling is a fail-safe. It doubles as the recursion guard — `JSON.parse`
 * cannot produce a cycle, but a hand-built value that did would bottom out
 * here instead of spinning.
 */
const MAX_DIRECTION_DEPTH = 6;

/**
 * Everything a direction offers that is not already accounted for, into the
 * pool. Used only on the gated path: with the question still open the
 * intersection is all we can prefill, so without this the pool is empty exactly
 * when it is the student's only way forward. Group names stay verbatim (DR-5);
 * `seen` keeps a course two directions share from being listed twice.
 *
 * Descends into nested waypoints: a direction carrying no courses of its own
 * but whose sub-directions do would otherwise contribute nothing.
 */
function collectPool(
  direction: PlanDirection,
  seen: Set<string>,
  choice: ClassifiedCourse[],
  depth = 0,
): void {
  for (const group of direction.courseGroups ?? []) {
    for (const course of group.courses ?? []) {
      if (!isRealCourse(course)) continue;
      if (seen.has(course.code)) continue;
      seen.add(course.code);
      choice.push(toClassified(course, group));
    }
  }
  if (depth >= MAX_DIRECTION_DEPTH) return;
  for (const waypoint of direction.waypoints ?? []) {
    for (const nested of waypoint.directions ?? []) {
      collectPool(nested, seen, choice, depth + 1);
    }
  }
}

/**
 * The obligatory courses a direction leaves no way out of: its own, plus the
 * ones every branch of its next waypoint agrees on — the intersection rule
 * applied one level down.
 */
function effectiveObligatory(
  direction: PlanDirection,
  depth: number,
): Map<string, ClassifiedCourse> {
  const byCode = new Map<string, ClassifiedCourse>();
  for (const group of direction.courseGroups ?? []) {
    for (const course of group.courses ?? []) {
      if (!isRealCourse(course) || !isObligatory(course)) continue;
      if (!byCode.has(course.code)) byCode.set(course.code, toClassified(course, group));
    }
  }
  if (depth >= MAX_DIRECTION_DEPTH) return byCode;
  const waypoint = gatingWaypoint(direction);
  if (!waypoint) return byCode;
  for (const course of obligatoryIntersection(waypoint.directions ?? [], depth + 1)) {
    if (!byCode.has(course.code)) byCode.set(course.code, course);
  }
  return byCode;
}

/** The obligatory courses shared by *every* direction — see "the intersection rule" above. */
function obligatoryIntersection(directions: PlanDirection[], depth = 0): ClassifiedCourse[] {
  if (directions.length === 0) return [];

  const perDirection = directions.map((direction) => effectiveObligatory(direction, depth));

  const [first, ...rest] = perDirection;
  if (!first) return [];
  const shared: ClassifiedCourse[] = [];
  for (const [code, course] of first) {
    if (rest.every((other) => other.has(code))) shared.push(course);
  }
  return shared;
}

/** The first waypoint that actually offers alternatives to choose between. */
function gatingWaypoint(direction: PlanDirection): StudyWaypoint | null {
  for (const waypoint of direction.waypoints ?? []) {
    if ((waypoint.directions ?? []).length > 0) return waypoint;
  }
  return null;
}

/** True when `code` names this direction or any direction nested under it. */
function containsDirection(direction: PlanDirection, code: string, depth: number): boolean {
  if (direction.code === code) return true;
  if (depth >= MAX_DIRECTION_DEPTH) return false;
  for (const waypoint of direction.waypoints ?? []) {
    for (const nested of waypoint.directions ?? []) {
      if (containsDirection(nested, code, depth + 1)) return true;
    }
  }
  return false;
}

/**
 * The direction a waypoint resolves to, or `undefined` while it is still a
 * question. A waypoint offering exactly one direction is applied without
 * asking.
 *
 * The stored answer is matched against this level's own codes first and only
 * then against levels whose subtree contains it: a profile carries ONE
 * direction code, so a deep answer is the only record of the chain leading to
 * it, and without the subtree match answering a nested question would silently
 * unanswer its parent.
 */
function pickDirection(
  directions: PlanDirection[],
  directionCode: string | null | undefined,
): PlanDirection | undefined {
  if (directions.length === 1) return directions[0];
  if (!directionCode) return undefined;
  return (
    directions.find((d) => d.code === directionCode) ??
    directions.find((d) => containsDirection(d, directionCode, 0))
  );
}

function directionOption(direction: PlanDirection): DirectionOption | null {
  if (!direction.code) return null;
  return { code: direction.code, name: direction.name ?? direction.code };
}

/**
 * Resolves one period into prefilled courses, offered courses and (when the
 * data demands one) the studieretning question.
 *
 * `directionCode` is the student's previously answered studieretning. When it
 * matches one of the waypoint's directions, that direction's groups fold in as
 * if they were the period's own. When it does not, the cross-direction
 * obligatory intersection is prefilled instead and `pendingChoice` carries the
 * question. A waypoint offering exactly one direction is applied without asking.
 *
 * Returns `null` when the period itself does not exist (DR-7 fallback).
 *
 * **Waypoints nest, and the descent follows them all the way down.** Stopping
 * after one level resolved CMED period 1 to literally zero courses and lost
 * BSPL period 3's 15 sp praksis half. The loop applies each answered level in
 * turn and stops at the first waypoint that is still a question, so a nested
 * question is asked with the same shape as a top-level one. Guessing past an
 * open choice is never done.
 */
export function classifyPeriod(
  plan: StudyPlan,
  periodNumber: number,
  directionCode?: string | null,
): PeriodCourses | null {
  const period = plan.periods.find((p) => p.periodNumber === periodNumber);
  if (!period) return null;

  const obligatory: ClassifiedCourse[] = [];
  const choice: ClassifiedCourse[] = [];
  const seen = new Set<string>();

  collectGroups(period.direction, seen, obligatory, choice);

  // The answered chain: fold in every level already resolved. `applied` is the
  // outermost, `explicit` the one the stored code names — the caller backfills
  // the display name from `appliedDirection`, so a nested answer must not be
  // rewritten to its parent.
  let waypoint = gatingWaypoint(period.direction);
  let applied: PlanDirection | null = null;
  let explicit: PlanDirection | null = null;
  for (let depth = 0; waypoint !== null && depth < MAX_DIRECTION_DEPTH; depth++) {
    const chosen = pickDirection(waypoint.directions ?? [], directionCode);
    if (!chosen) break;
    collectGroups(chosen, seen, obligatory, choice);
    if (applied === null) applied = chosen;
    if (chosen.code !== null && chosen.code === directionCode) explicit = chosen;
    waypoint = gatingWaypoint(chosen);
  }

  const resolved = explicit ?? applied;
  const appliedDirection = resolved === null ? null : directionOption(resolved);

  if (!waypoint) {
    return {
      obligatory,
      choice,
      pendingChoice: null,
      appliedDirection,
      empty: obligatory.length === 0 && choice.length === 0,
    };
  }

  const directions = waypoint.directions ?? [];
  for (const course of obligatoryIntersection(directions)) {
    if (seen.has(course.code)) continue;
    seen.add(course.code);
    obligatory.push(course);
  }

  // Everything else the directions offer becomes the pool (U7). It is offered,
  // never prefilled — which is what `choice` already means everywhere else.
  for (const direction of directions) {
    collectPool(direction, seen, choice);
  }

  return {
    obligatory,
    choice,
    pendingChoice: {
      name: waypoint.name ?? "Valg av studieretning",
      deadlineDate: waypoint.deadlineDate,
      directions: directions.map(directionOption).filter((d): d is DirectionOption => d !== null),
    },
    // Non-null when an outer level was already answered and only a nested
    // question is left (CMED: city chosen, klasse still open).
    appliedDirection,
    // A pending question is itself something to show, so this branch is never
    // the silent-blank state `empty` exists to name.
    empty: false,
  };
}

/** Sum of `credits` (nulls treated as 0). The study plan's own figure, not the catalog's. */
export function prefillCredits(courses: ClassifiedCourse[]): number {
  return courses.reduce((sum, c) => sum + (c.credits ?? 0), 0);
}

/**
 * A grossly-over-30-sp obligatory prefill is a bug signal — surfaced as a
 * boolean rather than silently truncated. The caller must *say so* rather than
 * drop the courses: CMEDFORSK period 1 legitimately sums to 42,5 sp, and
 * discarding it produced "0 av 30 sp" with no rows and no explanation.
 */
export function isSuspiciousPrefill(courses: ClassifiedCourse[]): boolean {
  return prefillCredits(courses) > SUSPICIOUS_CREDIT_CEILING;
}

/** What one semester of one cohort's study plan resolves to — see `resolvePeriodFor`. */
export interface ResolvedPeriod {
  /** Period number derived from semester + cohort; `null` when the id doesn't parse. */
  periodNumber: number | null;
  /** The classified period, or `null` when the plan has no such period (DR-7). */
  courses: PeriodCourses | null;
  /** Shorthand for `courses?.pendingChoice` — the open studieretning/campus question. */
  pendingChoice: DirectionChoice | null;
}

/**
 * `semesterId` + cohort → the courses that semester's period resolves to.
 *
 * The one entry point for "what does this programme mean for this semester",
 * so the planner and the homepage picker cannot drift. `periodNumberFor` and
 * `classifyPeriod` stay exported for tests and for callers holding a period
 * number already.
 */
export function resolvePeriodFor(
  plan: StudyPlan,
  semesterId: string,
  cohort: number,
  directionCode?: string | null,
): ResolvedPeriod {
  const periodNumber = periodNumberFor(semesterId, cohort);
  const courses = periodNumber === null ? null : classifyPeriod(plan, periodNumber, directionCode);
  return { periodNumber, courses, pendingChoice: courses?.pendingChoice ?? null };
}
