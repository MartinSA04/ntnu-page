/**
 * The plan as a stranger sees it — the shape carried in the account record's
 * `plain` field and served, without any credential, to `/user/<navn>`.
 *
 * It is a SEPARATE shape from `PlanState` on purpose. What travels is what the
 * week needs to draw and what a recipient needs to read; `dropped` courses, the
 * other semesters' plans and the device registry are not in it, and cannot be
 * added by accident because this file names every field that goes out.
 *
 * Pure both ways: `buildPublicPlan` runs in the owner's tab on every push,
 * `parsePublicPlan` runs in the viewer's on load, and neither touches storage.
 */

import { activeCourses, DEFAULT_VERSION, type PlanState } from "./store.js";

/** One course of a shared plan. `name` is always set — the code is the fallback. */
export interface PublicCourse {
  code: string;
  name: string;
  /** `null`/absent means unknown, exactly as in `PlanCourse` (DR-6's honest gap). */
  credits?: number;
  /** DR-4: 293 of 5 470 courses are not version "1" and have a different week. */
  version: string;
  /** The owner's parallel/øving picks, so the viewer sees the week they see. */
  groups?: string[];
}

export interface PublicPlan {
  semesterId: string;
  /** "Høst 2026" — carried so neither the page nor the unfurler has to look it up. */
  semesterLabel?: string;
  /**
   * The programme, for two jobs: `code` narrows multi-section courses to the
   * owner's own lecture parallel (`entriesForProgram`), and `name`/`cohort`
   * let the page say whose week this is. A plan with no programme omits it.
   */
  program?: { code: string; name: string; cohort: number };
  courses: PublicCourse[];
}

/**
 * The public copy of a plan, built fresh on every push while sharing is on.
 *
 * DROPPED COURSES ARE EXCLUDED — `activeCourses` is the same definition of
 * "what actually counts" the week, the credit line and the collision engine
 * use. A course the owner said no to is not part of the plan they are sharing,
 * and shipping it would put a ghost in someone else's copy of their week.
 */
export function buildPublicPlan(
  plan: PlanState,
  options: { semesterLabel?: string; credits?: (code: string) => number | null } = {},
): PublicPlan {
  const courses: PublicCourse[] = activeCourses(plan).map((course) => {
    const credits = options.credits?.(course.code) ?? course.credits ?? null;
    return {
      code: course.code,
      name: course.name === "" ? course.code : course.name,
      version: course.version || DEFAULT_VERSION,
      ...(typeof credits === "number" ? { credits } : {}),
      ...(course.groups && course.groups.length > 0 ? { groups: [...course.groups] } : {}),
    };
  });
  return {
    semesterId: plan.semesterId,
    ...(options.semesterLabel ? { semesterLabel: options.semesterLabel } : {}),
    ...(plan.program
      ? {
          program: {
            code: plan.program.code,
            name: plan.program.name,
            cohort: plan.program.cohort,
          },
        }
      : {}),
    courses,
  };
}

/**
 * Read a published plan back, field by field.
 *
 * Untrusted input: this arrives over the network from a record another student
 * wrote, so nothing is taken on trust and a malformed course row is DROPPED
 * rather than failing the whole plan — one bad row must not turn a shared week
 * into an error page. `null` is returned only when there is no plan at all.
 */
export function parsePublicPlan(raw: string): PublicPlan | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.semesterId !== "string" || !Array.isArray(obj.courses)) return null;

  const courses: PublicCourse[] = [];
  for (const entry of obj.courses) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.code !== "string" || row.code === "") continue;
    courses.push({
      code: row.code,
      name: typeof row.name === "string" && row.name !== "" ? row.name : row.code,
      version:
        typeof row.version === "string" && row.version !== "" ? row.version : DEFAULT_VERSION,
      ...(typeof row.credits === "number" ? { credits: row.credits } : {}),
      ...(Array.isArray(row.groups)
        ? { groups: row.groups.filter((g): g is string => typeof g === "string") }
        : {}),
    });
  }

  const program = parseProgram(obj.program);
  return {
    semesterId: obj.semesterId,
    ...(typeof obj.semesterLabel === "string" ? { semesterLabel: obj.semesterLabel } : {}),
    ...(program ? { program } : {}),
    courses,
  };
}

function parseProgram(value: unknown): PublicPlan["program"] | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.code !== "string" || row.code === "") return null;
  return {
    code: row.code,
    name: typeof row.name === "string" && row.name !== "" ? row.name : row.code,
    cohort: typeof row.cohort === "number" ? row.cohort : 0,
  };
}

/** Study-plan credits of a shared plan; unknown ones simply do not count (DR-6). */
export function publicPlanCredits(plan: PublicPlan): number {
  return plan.courses.reduce((sum, course) => sum + (course.credits ?? 0), 0);
}
