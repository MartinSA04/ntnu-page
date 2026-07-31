/**
 * The runtime half of the plan probe — see Layout.astro's pre-paint script and
 * `--plan-courses` in tokens.css for the other half and the whole rationale.
 *
 * The inline script answers the question "how much space is this page about to
 * need?" before the first frame; this keeps that answer true for the rest of
 * the visit. It matters because a ClientRouter navigation does NOT reset CLS:
 * a student who adds three courses on /emner/ and then walks to /planlegger/
 * would otherwise arrive with the probe still reading whatever it read when
 * the tab was opened, and the week would open with the shift the reservation
 * exists to remove — charged to the page-load they started on.
 *
 * Writing the same two facts the inline script writes, from the store rather
 * than from raw localStorage, is deliberate: the store is the one place that
 * knows which semester's list is current and how a malformed payload coerces.
 */
import type { PlanState, PlanStore } from "./planner/store.js";

/** Writes the probe onto `<html>`: the course count, and whether a programme is set. */
export function syncPlanProbe(plan: PlanState): void {
  const root = document.documentElement;
  const count = plan.courses.length;
  root.style.setProperty("--plan-courses", String(count));
  if (plan.program) root.setAttribute("data-plan", "program");
  else if (count > 0) root.setAttribute("data-plan", "courses");
  else root.removeAttribute("data-plan");
}

/**
 * Keeps the probe in step with the store for as long as the page lives. Call
 * once per page from inside `onPage`; the teardown rides the page's signal
 * like every other subscription.
 */
export function watchPlanProbe(
  store: Pick<PlanStore, "loadPlan" | "onPlanChange">,
  signal: AbortSignal,
): void {
  const sync = (): void => syncPlanProbe(store.loadPlan());
  sync();
  signal.addEventListener("abort", store.onPlanChange(sync));
}
