/**
 * The planner's seam onto `ntnu-api`'s conflict engine (PLANNER.md §3), and
 * the place this product's two policies are written down:
 *
 * **DR-1: hard conflicts are lecture-only.** `findConflicts` is
 * classification-agnostic; callers pre-filter with `lecturesOnly`
 * (activity.ts). Øving/lab entries render muted by simply not being fed in.
 *
 * **Timetables only.** Exam dates are not analysed here — `examSchedule.ts`'s
 * `buildExamList` owns the sort, gaps, same-day flag and "tett" threshold. Do
 * not add exam logic to this module.
 */

export {
  type Conflict,
  type ConflictGroup,
  findConflicts,
  groupConflicts,
  mergeParallelSlots,
  type ParallelSlotGroup,
} from "ntnu-api";
