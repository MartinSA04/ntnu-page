/**
 * The conflict engine (PLANNER.md §3): pairwise timetable clash detection
 * over a selected set of courses.
 *
 * The engine itself now lives in `ntnu-api`'s `conflicts` module — same
 * implementation, moved rather than rewritten, because "two weekly slots
 * collide when they share a weekday, overlap in time, and share a teaching
 * week" is a fact about NTNU's timetable format and not a property of this
 * planner. `ntnu-mcp` had grown its own weaker copy (no parallel-group dedupe,
 * no grouping), which is exactly the drift a shared module prevents. The
 * findings that shaped it — the entry-span dedupe key, the three-way grouping,
 * the parallel-slot merge — travelled with it; read that module's header.
 *
 * This file stays as the planner's seam, and as the place the two *policies*
 * that are this product's are written down:
 *
 * **DR-1 (PRODUCT.md): hard conflicts are lecture-only.** `findConflicts`
 * itself is classification-agnostic — the simpler of the two APIs described in
 * the brief (a `classify` option vs. a pre-filtered input) — and callers
 * filter with `lecturesOnly`/`classifyActivity` (activity.ts) before calling
 * it: `findConflicts(lecturesOnly(entries))`. Øving/lab entries are still
 * rendered (muted, non-clashing) by simply not being fed into this function.
 *
 * **Timetables only.** Exam dates are NOT analysed here — `examSchedule.ts`'s
 * `buildExamList` is the single owner of the sort, the whole-day gaps, the
 * same-day flag and the "tett" threshold. This module used to export a second
 * `analyzeExams` that no caller ever ran and that disagreed with the live one
 * on both the threshold (1 day vs 2) and the date math (`Date.parse` vs
 * examSchedule's deliberate `Date.UTC` differencing); it was deleted rather
 * than reconciled (conf-7/exams-6). Do not re-add exam logic here — `ntnu-api`
 * deliberately keeps exams out of its conflict module for the same reason.
 */

export {
  type Conflict,
  type ConflictGroup,
  findConflicts,
  groupConflicts,
  mergeParallelSlots,
  type ParallelSlotGroup,
} from "ntnu-api";
