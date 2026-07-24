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
}

const MAX_STEP_BACK_TRIES = 3;

async function fetchPlan(code: string, year: number): Promise<StudyPlan | null | "error"> {
  try {
    const res = await fetch(`/api/program/${code}/plan?year=${year}`);
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
export async function findProgramPlan(code: string, guessYear: number): Promise<FindPlanResult> {
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

/**
 * A grossly-over-30-sp obligatory prefill is a bug signal — surfaced as a
 * boolean rather than silently truncating, so the caller can guard without
 * inventing a truncation rule the product never asked for.
 */
const SUSPICIOUS_CREDIT_CEILING = 30;

function toClassified(course: PlannedCourse, groupName: string | null): ClassifiedCourse {
  return {
    code: course.code,
    name: course.name ?? course.code,
    version: course.version ?? "1",
    credits: course.credits,
    groupName,
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
      const classified = toClassified(course, group.name);
      if (isObligatory(course)) obligatory.push(classified);
      else choice.push(classified);
    }
  }
}

/** The obligatory courses shared by *every* direction — see "the intersection rule" above. */
function obligatoryIntersection(directions: PlanDirection[]): ClassifiedCourse[] {
  if (directions.length === 0) return [];

  const perDirection = directions.map((direction) => {
    const byCode = new Map<string, ClassifiedCourse>();
    for (const group of direction.courseGroups ?? []) {
      for (const course of group.courses ?? []) {
        if (!isRealCourse(course) || !isObligatory(course)) continue;
        if (!byCode.has(course.code)) byCode.set(course.code, toClassified(course, group.name));
      }
    }
    return byCode;
  });

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
 * Nested waypoints *inside* a chosen direction are not descended into. No
 * programme in the crawled data has them (every `Valg av studieretning` in
 * MTDT's ten periods is top-level and its directions carry none), and
 * guessing past a second unanswered choice would reintroduce exactly the
 * wrong-30-sp failure the intersection rule exists to prevent.
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

  const waypoint = gatingWaypoint(period.direction);
  if (!waypoint) {
    return { obligatory, choice, pendingChoice: null, appliedDirection: null };
  }

  const directions = waypoint.directions ?? [];
  const only = directions.length === 1 ? directions[0] : undefined;
  const chosen =
    only ?? (directionCode ? directions.find((d) => d.code === directionCode) : undefined);

  if (chosen) {
    collectGroups(chosen, seen, obligatory, choice);
    return {
      obligatory,
      choice,
      pendingChoice: null,
      appliedDirection: directionOption(chosen),
    };
  }

  for (const course of obligatoryIntersection(directions)) {
    if (seen.has(course.code)) continue;
    seen.add(course.code);
    obligatory.push(course);
  }

  return {
    obligatory,
    choice,
    pendingChoice: {
      name: waypoint.name ?? "Valg av studieretning",
      deadlineDate: waypoint.deadlineDate,
      directions: directions.map(directionOption).filter((d): d is DirectionOption => d !== null),
    },
    appliedDirection: null,
  };
}

/** Sum of `credits` (nulls treated as 0) — used only for the bug-signal guard, never shown as-is. */
export function isSuspiciousPrefill(courses: ClassifiedCourse[]): boolean {
  const total = courses.reduce((sum, c) => sum + (c.credits ?? 0), 0);
  return total > SUSPICIOUS_CREDIT_CEILING;
}
