/**
 * Shared types passed between the planner's orchestrator and its focused
 * render modules (grid, exam ribbon). Kept separate from `src/lib/planner/*`
 * (the tested engine) — these are DOM-facing view shapes only.
 */

import type { CourseBundle } from "../../lib/planner/data.js";
import type { PlanCourse } from "../../lib/planner/store.js";

/** One selected course's full state: identity, hue, and its fetched bundle (once loaded). */
export interface PlanCourseState {
  course: PlanCourse;
  hueVar: string;
  bundle: CourseBundle | null;
  /** True while the course's bundle fetch is in flight. */
  loading: boolean;
  /**
   * The plan's programme code, so the grid can narrow multi-section courses
   * to the programme's own lecture parallel (`applyGroupSelection` →
   * `entriesForProgram`). plannerApp sets it from `plan.program?.code`;
   * one-course reuses (courseTimetable) leave it unset — no programme means
   * "keep the parallel-1 default", which is exactly `entriesForProgram`'s
   * behaviour with a null code.
   */
  programCode?: string | null;
}
