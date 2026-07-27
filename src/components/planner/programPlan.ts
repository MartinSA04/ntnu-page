/**
 * Programme study-plan → period classification for `/planlegger/` (DR-5,
 * DR-7, PRODUCT.md §0). Fetches `/api/program/:code/plan`, finds the period
 * matching the chosen semester for a cohort, and resolves it into the
 * courses the student actually has plus the one question the data forces.
 *
 * The shape of a period changes completely across a degree, and the whole
 * design follows from that (measured on real plans, MTDT + BIT):
 *
 * - **1.–2. år**: 4–5 courses, every one `studyChoice.code === "O"`. A pure
 *   lookup — no question, full prefill.
 * - **3. år bachelor**: a period can carry *zero* `O` courses and a single
 *   group of interchangeable electives (BIT period 5: 8 × `M2A`).
 * - **3.–5. år sivilingeniør**: the period's own `courseGroups` are **empty**
 *   and every course hangs off a `Valg av studieretning` waypoint (MTDT
 *   period 5). Classifying only top-level groups yields nothing at all.
 * - **profesjonsstudier**: the waypoints *nest*, and the courses sit at the
 *   bottom. CMED period 1 is by → klasse (2 levels; both klasse groups carry
 *   the same EXPH0400 + MD4012), BSPL period 3 is by → praksisløp, and
 *   MGLU1-7 period 5 is fag A → masterstudieretning → fag B (3 levels, 441
 *   leaves). Stopping after the first waypoint yields nothing at all here too.
 *
 * So a period resolves in three parts: `obligatory` (prefilled), `choice`
 * (offered, never prefilled — DR-5), and `pendingChoice` (the studieretning
 * question, when it hasn't been answered yet).
 *
 * **The intersection rule.** With no direction chosen we still prefill every
 * course that is `O` in *all* directions — for MTDT period 5 that is TDT4136
 * + TMA4135, obligatory whichever specialization you pick. This keeps §0.1's
 * "programme + kull → your week, instantly" true for later-year students
 * without guessing a direction (the D4/DR-7 sin: a guessed direction would
 * prefill a confidently wrong 30 sp). It is the honest floor — courses the
 * student provably has — and it is never blank when the data has anything.
 *
 * DR-5: `PlanCourseGroup` carries no min/max/choose-N — the only structured
 * signal is each course's `studyChoice.code`. Validated against real data:
 * `"O"` ("Obligatorisk emne") reliably marks the courses NTNU auto-enrolls
 * the student in; every other code seen in the wild (`VA`, `VB`, `V`, `M`,
 * `M2A`, `MAX1A`) is some flavour of choice. We never assert cardinality;
 * `groupName` carries the group's verbatim title so the UI can quote the
 * place where "velg 2 av 5" is actually written down.
 */
import { semesterYear } from "../../lib/planner/schedule.js";

interface StudyChoice {
  code: string | null;
  name: string | null;
  description: string | null;
}

interface PlannedCourse {
  code: string;
  version: string | null;
  name: string | null;
  credits: number | null;
  planElement: boolean;
  studyChoice: StudyChoice | null;
}

interface PlanCourseGroup {
  code: string | null;
  name: string | null;
  description: string | null;
  courses: PlannedCourse[];
}

interface StudyWaypoint {
  code: string | null;
  name: string | null;
  description: string | null;
  deadlineDate: string | null;
  directions: PlanDirection[];
}

interface PlanDirection {
  code: string | null;
  name: string | null;
  courseGroups: PlanCourseGroup[];
  waypoints: StudyWaypoint[];
}

interface StudyPlanPeriod {
  periodNumber: number | null;
  direction: PlanDirection;
}

export interface StudyPlan {
  code: string;
  name: string | null;
  year: number | null;
  startTerm: string | null;
  updated: string | null;
  periods: StudyPlanPeriod[];
  publishedYears: number[];
}

export interface ClassifiedCourse {
  code: string;
  name: string;
  version: string;
  credits: number | null;
  /** Verbatim study-plan group title — never paraphrased (DR-5). */
  groupName: string | null;
  /**
   * Verbatim study-plan group description prose — never paraphrased or
   * summarized (DR-5). This is where "velg 2 av 5" is actually written down;
   * the planner's "Fra studieplanen" panel quotes it unmodified. `null` when
   * the group carried none.
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
   * The period exists in the study plan but names nothing at all: no
   * obligatory course, no offered course and no question (MPPR 2024 period 1
   * is literally `{courseGroups: [], waypoints: []}`). Distinguishable from a
   * missing period (`classifyPeriod` returns `null`) and from an ordinary
   * period, so the caller can say *why* the week is blank instead of leaving
   * "0 av 30 sp" standing next to no rows and no explanation.
   */
  empty: boolean;
}

const MAX_STEP_BACK_TRIES = 3;

async function fetchPlan(code: string, year: number): Promise<StudyPlan | null | "error"> {
  try {
    // The code stays encoded until the worker's own parseCode decodes it —
    // Æ/Ø/Å and the handful of codes carrying a literal "/" ("MSØK/5") would
    // otherwise become a 400 or a wrong route (B1).
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
 * Memo keyed `CODE:year`, mirroring `fetchCourseBundle`'s. A study plan is a
 * build-time-stable document that every re-render of the page asks for again:
 * picking a kull used to cost three sequential round trips and every
 * Dropp/Legg tilbake another one (C5d). Errors are evicted after they settle
 * so a transient failure stays retryable; 404-ladder misses are not (they are
 * a property of the data, not of the network).
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
 * The plan period number for a cohort's semester (PLANNER.md/DR-7). Period 1
 * is the cohort's first autumn and periods count up two per study year:
 *
 *     kull 2026 → 26h = 1, 27v = 2, 27h = 3, 28v = 4 …
 *
 * A **spring** semester belongs to the study year that started the *previous*
 * autumn, so its year offset is `semYear - 1 - cohort` — not `semYear -
 * cohort`, which overshoots by a full year and would show a first-year
 * student their second year's courses every spring.
 *
 * Assumes an autumn intake (DR-7: `startTerm` is nullable and spring intakes
 * break the arithmetic); the caller treats the result as a suggestion and
 * shows nothing when the period turns out not to exist.
 *
 * `null` when the semester id doesn't parse.
 */
export function periodNumberFor(semesterId: string, cohort: number): number | null {
  const semYear = semesterYear(semesterId);
  if (semYear === null) return null;
  const isAutumn = /h$/i.test(semesterId.trim());
  return isAutumn ? (semYear - cohort) * 2 + 1 : (semYear - 1 - cohort) * 2 + 2;
}

/** How many cohorts back of the current one a chip row considers (PLANNER.md). */
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
 * Descending cohort years, most recent first, whose `periodNumberFor` falls
 * within `[1, maxPeriodNumber]` for `semesterId` — i.e. the cohorts this plan
 * actually has a period for at this point in the calendar. This is the whole
 * relevance rule: a period RANGE test, never whether that period's own
 * `courseGroups` happen to be non-empty (the S4 lockout bug — a
 * direction-gated period like MTDT's has empty top-level groups by design
 * and is exactly as relevant as any other).
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
 * How many waypoint levels any walk over a period descends. Real plans reach
 * three (MGLU1-7 period 5: fag A → masterstudieretning → fag B); the ceiling
 * is a fail-safe, not a claim about the data. It is also the recursion guard:
 * `fetchPlan` builds every production value with `JSON.parse`, which cannot
 * produce a cycle, but a hand-built or future value that did would simply
 * bottom out here instead of spinning.
 */
const MAX_DIRECTION_DEPTH = 6;

/**
 * Everything a direction offers that isn't already accounted for, into the
 * pool. Used only on the gated path: with the question still open the
 * intersection is all we can prefill, so without this the pool is empty
 * exactly when it is the student's only way forward — "Fra studieplanen"
 * disabled, `effectiveScope()` falling back to the whole 5 470-course
 * catalog (U7). Group names stay verbatim (DR-5); `seen` keeps a course that
 * two directions share from being listed twice.
 *
 * Descends into nested waypoints: a direction that carries no courses of its
 * own but whose sub-directions do (CMED's cities, MGLU1-7's fag A) would
 * otherwise contribute nothing to the pool.
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
 * The obligatory courses a direction leaves the student no way out of: its
 * own, plus the ones every branch of its next waypoint agrees on. CMED's city
 * directions carry no courses themselves and both nested Klasse groups carry
 * EXPH0400 + MD4012, so the student provably has those whichever class they
 * end up in — the intersection rule applied one level down.
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
 * asking — a question with one answer isn't a question.
 *
 * The stored answer is matched against this level's own codes first and only
 * then against the levels whose subtree contains it. A profile carries ONE
 * direction code, so the deeper answer (`CMED26-V-T-V-G1`) is the only record
 * of the whole chain that leads to it; without the subtree match, answering a
 * nested question would silently unanswer its parent.
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
 * matches one of the waypoint's directions, that direction's groups are
 * folded in as if they were the period's own. When it doesn't (unanswered, or
 * a direction from a different cohort's plan), the cross-direction obligatory
 * intersection is prefilled instead and `pendingChoice` carries the question.
 *
 * A waypoint offering exactly one direction is applied without asking — a
 * question with one answer isn't a question.
 *
 * Returns `null` if the period itself doesn't exist (DR-7 fallback: unpublished
 * cohort or off-by-one period math → caller shows no prefill).
 *
 * **Waypoints nest, and the descent follows them all the way down.** An
 * earlier version stopped after one level on the (false) premise that no
 * crawled programme nested them: CMED period 1 is by → klasse and resolved to
 * literally zero courses once the city was answered, and BSPL period 3 lost
 * the 15 sp praksis half of the semester. The loop below applies each answered
 * level in turn and stops at the first waypoint that is still a question — so
 * a nested question is asked with the same shape as a top-level one, and the
 * intersection rule keeps prefilling only what every remaining branch agrees
 * on. Guessing past an open choice is still never done.
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

  // The answered chain: fold in every level the student has already resolved.
  // `applied` is the outermost of them, `explicit` the one the stored code
  // names — the caller backfills the stored direction's display name from
  // `appliedDirection`, so a nested answer must not be rewritten to its parent.
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
 * boolean rather than silently truncating, so the caller can guard without
 * inventing a truncation rule the product never asked for. Note the caller
 * must *say so* rather than drop the courses: CMEDFORSK period 1 legitimately
 * sums to 42,5 sp and MJORM to 45, and discarding them silently produced "0
 * av 30 sp" with no rows and no explanation (B9.4).
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
 * The one entry point for "what does this programme mean for this semester":
 * the planner calls it on every semester change and on every studieretning
 * answer, and the homepage picker asks the same question before it navigates
 * (B2 — the question is asked in the picker, and the planner must be able to
 * answer it identically or the two surfaces drift). Keeping the period
 * arithmetic and the classification behind one call is what makes that
 * cheap; `periodNumberFor` and `classifyPeriod` stay exported for the tests
 * and for callers that already hold a period number.
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
