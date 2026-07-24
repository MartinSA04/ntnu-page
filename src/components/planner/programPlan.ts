/**
 * Programme study-plan → prefill classification for `/planlegger/` (DR-5,
 * DR-7, PRODUCT.md §0). Fetches `/api/program/:code/plan`, finds the period
 * matching the chosen semester for a cohort, and splits its top-level
 * courses into "obligatory" (prefilled as `source: "program"`) vs "choice"
 * (rendered as a one-tap add list, never prefilled).
 *
 * DR-5: `PlanCourseGroup` carries no min/max/choose-N — the only structured
 * signal is each course's `studyChoice.code`. Validated against real data
 * (MTDT + a bachelor programme, see engine/UI probe notes): `"O"` means
 * "Obligatorisk emne" and reliably marks the courses NTNU auto-enrolls the
 * student in; every other code (`"VA"` "Valgbart emne", etc.) is a choice.
 * Courses reached only through a waypoint's sibling `directions` (e.g.
 * MTDT's 3rd-year "velg studieretning") are deliberately **not** descended
 * into for the obligatory prefill — the student hasn't told us which
 * direction they chose, so guessing one would prefill a wrong 30 sp. Their
 * courses surface only as an (unlabeled-by-direction) choice list would be
 * misleading too, so they are simply omitted from period course discovery;
 * the waypoint's existence doesn't currently need its own UI (kept lean per
 * the mandate — DO NOT OVERCOMPLICATE).
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

interface PlanDirection {
  code: string | null;
  name: string | null;
  courseGroups: PlanCourseGroup[];
  // Sibling directions under a waypoint are intentionally not typed further
  // here — see module doc: we never descend into them for prefill purposes.
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
}

export interface PeriodCourses {
  /** Prefilled as the programme's plan for this semester. */
  obligatory: ClassifiedCourse[];
  /** Rendered as "Valgemner i studieplanen" — never prefilled (DR-5). */
  choice: ClassifiedCourse[];
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
 * The plan period number for a cohort's semester (PLANNER.md/DR-7): period 1
 * is the cohort's first autumn, counting up two per calendar year (autumn =
 * odd, spring = even). `null` when the semester id doesn't parse.
 */
export function periodNumberFor(semesterId: string, cohort: number): number | null {
  const semYear = semesterYear(semesterId);
  if (semYear === null) return null;
  const isAutumn = /h$/i.test(semesterId.trim());
  return (semYear - cohort) * 2 + (isAutumn ? 1 : 2);
}

/**
 * A grossly-over-30-sp obligatory prefill is a bug signal (mandate note in
 * the task brief) — surfaced here as a boolean rather than silently
 * truncating, so the caller can log/guard without inventing a truncation
 * rule the product never asked for.
 */
const SUSPICIOUS_CREDIT_CEILING = 30;

/**
 * Splits one period's top-level (non-waypoint) courses into obligatory vs.
 * choice, skipping `planElement` rows (administrative markers like "krav om
 * arbeidslivserfaring", not real courses) per DR-10-adjacent bulk-add
 * filtering. Returns `null` if the period itself doesn't exist (DR-7
 * fallback: null `periodNumber`/absent period → caller shows no prefill).
 */
export function classifyPeriod(plan: StudyPlan, periodNumber: number): PeriodCourses | null {
  const period = plan.periods.find((p) => p.periodNumber === periodNumber);
  if (!period) return null;

  const obligatory: ClassifiedCourse[] = [];
  const choice: ClassifiedCourse[] = [];
  const seen = new Set<string>();

  for (const group of period.direction.courseGroups) {
    for (const course of group.courses) {
      if (course.planElement) continue;
      if (seen.has(course.code)) continue;
      seen.add(course.code);
      const classified: ClassifiedCourse = {
        code: course.code,
        name: course.name ?? course.code,
        version: course.version ?? "1",
        credits: course.credits,
      };
      if (course.studyChoice?.code === "O") {
        obligatory.push(classified);
      } else {
        choice.push(classified);
      }
    }
  }

  return { obligatory, choice };
}

/** Sum of `credits` (nulls treated as 0) — used only for the bug-signal guard, never shown as-is. */
export function isSuspiciousPrefill(courses: ClassifiedCourse[]): boolean {
  const total = courses.reduce((sum, c) => sum + (c.credits ?? 0), 0);
  return total > SUSPICIOUS_CREDIT_CEILING;
}
