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

/**
 * Writes the probe onto `<html>`.
 *
 * The two facts have DIFFERENT SCOPES, and that is the point:
 *
 *  - `--plan-courses` is **this semester's** count, because every reservation
 *    is `calc(var(--plan-courses) * …)` and a row that is not being drawn must
 *    not be reserved for.
 *  - `data-plan`'s presence is **"does this student have a plan at all"**,
 *    across every semester and the programme profile. `/planlegger/` gates its
 *    first-run screen on the absence of it, and a manual add sitting in another
 *    term is still a plan — someone who switched to an empty semester has not
 *    become a first-time visitor. The `"elsewhere"` value names exactly that
 *    case: a plan, but not in the term on screen.
 */
export function syncPlanProbe(plan: PlanState, hasAnyCourses: boolean): void {
  const root = document.documentElement;
  const count = plan.courses.length;
  root.style.setProperty("--plan-courses", String(count));
  if (plan.program) root.setAttribute("data-plan", "program");
  else if (count > 0) root.setAttribute("data-plan", "courses");
  else if (hasAnyCourses) root.setAttribute("data-plan", "elsewhere");
  else root.removeAttribute("data-plan");
}

/**
 * Keeps the probe in step with the store for as long as the page lives. Call
 * once per page from inside `onPage`; the teardown rides the page's signal
 * like every other subscription.
 */
export function watchPlanProbe(
  store: Pick<PlanStore, "loadPlan" | "onPlanChange" | "hasAnyCourses">,
  signal: AbortSignal,
): void {
  const sync = (): void => syncPlanProbe(store.loadPlan(), store.hasAnyCourses());
  sync();
  signal.addEventListener("abort", store.onPlanChange(sync));
}
