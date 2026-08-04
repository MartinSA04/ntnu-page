/**
 * The read-only view behind `/user/<navn>`.
 *
 * A shared link SHOWS you someone else's plan. It never writes to yours — no
 * store, no `localStorage`, no prompt about replacing anything, which is the
 * whole of what changed when the `#v2;…` hash was deleted. If a viewer wants
 * this plan they build their own, which is five clicks, and the CTA at the foot
 * of the page is where that starts. `tests/planner/publicPlan.test.ts` asserts
 * the rule against this file's source rather than trusting this paragraph.
 *
 * The week is drawn by the planner's own `renderGrid` — one renderer for three
 * surfaces (`/planlegger/`, `/emne/[code]/`, here), so a shared week is the
 * same week the sharer is looking at, including their parallel and øving picks.
 */

import {
  type CourseBundle,
  fetchCourseBundle,
  type TimetableEntry,
} from "../../lib/planner/data.js";
import { assignHues } from "../../lib/planner/hues.js";
import {
  type PublicPlan,
  parsePublicPlan,
  publicPlanCredits,
} from "../../lib/planner/publicPlan.js";
import { entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
import { el, formatCreditNumber } from "./dom.js";
import { fitBlockLabels, renderGrid, setScrollFade } from "./grid.js";
import type { PlanCourseState } from "./types.js";

/** The semester rows the page ships from `data/semesters.json` — teaching weeks and a name. */
export interface PublicSemester {
  id: string;
  name: string;
  teachingWeeks: number[];
}

export interface PublicPlanDeps {
  /** The account name, read from the path — the worker serves one shell for all of them. */
  navn: string;
  root: HTMLElement;
  semesters: PublicSemester[];
  fetch: typeof fetch;
  signal: AbortSignal;
}

/** `/user/martin` → `"martin"`. The page is static, so the path is the only source. */
export function nameFromPath(pathname: string): string {
  const match = /^\/user\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function semesterLabelOf(plan: PublicPlan, semesters: PublicSemester[]): string {
  if (plan.semesterLabel) return plan.semesterLabel;
  const season = /h$/i.test(plan.semesterId) ? "Høst" : "Vår";
  const year = semesterYear(plan.semesterId);
  if (year !== null) return `${season} ${year}`;
  return semesters.find((s) => s.id === plan.semesterId)?.name ?? "";
}

/**
 * One line of facts under the name, in the planner's own vocabulary: how many
 * courses, how many credits, which term. Credits are omitted rather than
 * guessed when nothing published one (DR-6).
 */
export function planSummary(plan: PublicPlan, label: string): string {
  const count = plan.courses.length;
  const credits = publicPlanCredits(plan);
  const parts = [`${count} ${count === 1 ? "emne" : "emner"}`];
  // `formatCredits`'s "X av 30 sp" is the PLANNER's line — it measures a load
  // against a full semester, which is a judgement about the owner's plan that a
  // page for a viewer has no business making. The bare figure states the fact.
  if (credits > 0) parts.push(`${formatCreditNumber(credits)} sp`);
  if (label !== "") parts.push(label);
  return parts.join(" · ");
}

/** The one call to action: this page is a week, and the way to get your own is the planner. */
function ctaLink(): HTMLElement {
  const link = el("a", "np-btn np-btn--primary", "Lag din egen plan") as HTMLAnchorElement;
  link.href = "/planlegger/";
  return link;
}

/**
 * Says what happened, in ink, without apology (DESIGN §7) — and RELEASES the
 * height reservation, because a sentence under 24 rem of held-open white paper
 * is worse than the shift the reservation exists to prevent (CLAUDE.md's lease
 * idiom, the same one `/emne/[code]/` documents).
 */
function renderMessage(root: HTMLElement, lines: string[], extra?: HTMLElement): void {
  root.removeAttribute("data-reserve");
  root.replaceChildren();
  const box = el("div", "public-plan-empty");
  for (const line of lines) box.append(el("p", "np-hint", line));
  if (extra) box.append(extra);
  root.append(box);
}

export async function mountPublicPlan(deps: PublicPlanDeps): Promise<void> {
  const { root, navn } = deps;

  if (navn === "") {
    renderMessage(root, ["Fant ingen delt plan her. Lenken kan være fjernet."], ctaLink());
    return;
  }

  let response: Response | null = null;
  try {
    response = await deps.fetch(`/api/plan/${encodeURIComponent(navn)}`, { signal: deps.signal });
  } catch {
    response = null;
  }
  if (deps.signal.aborted) return;

  // 404 is the ONE answer for "no such account" and "not shared" alike — the
  // worker refuses to tell them apart, and neither must this page.
  if (response !== null && response.status === 404) {
    renderMessage(root, ["Fant ingen delt plan her. Lenken kan være fjernet."], ctaLink());
    return;
  }
  if (response === null || !response.ok) {
    renderMessage(root, ["Kunne ikke hente planen."], retryButton(deps));
    return;
  }

  let plan: PublicPlan | null = null;
  try {
    const body = (await response.json()) as { plain?: unknown };
    plan = typeof body.plain === "string" ? parsePublicPlan(body.plain) : null;
  } catch {
    plan = null;
  }
  if (deps.signal.aborted) return;
  if (plan === null) {
    renderMessage(root, ["Kunne ikke hente planen."], retryButton(deps));
    return;
  }
  if (plan.courses.length === 0) {
    renderMessage(root, [`${navn} har ingen emner i planen akkurat nå.`], ctaLink());
    return;
  }

  renderPlan(deps, plan);
}

function retryButton(deps: PublicPlanDeps): HTMLElement {
  const button = el("button", "np-btn", "Prøv igjen") as HTMLButtonElement;
  button.type = "button";
  button.addEventListener(
    "click",
    () => {
      deps.root.replaceChildren();
      void mountPublicPlan(deps);
    },
    { signal: deps.signal },
  );
  return button;
}

function renderPlan(deps: PublicPlanDeps, plan: PublicPlan): void {
  const { root, navn } = deps;
  const label = semesterLabelOf(plan, deps.semesters);
  root.replaceChildren();

  const head = el("header", "public-plan-head");
  head.append(el("p", "np-kicker", "Delt plan"));
  head.append(el("h1", "public-plan-title", navn));
  if (plan.program) {
    head.append(
      el("p", "np-hint public-plan-program", `${plan.program.name} · Kull ${plan.program.cohort}`),
    );
  }
  head.append(el("p", "np-data public-plan-summary", planSummary(plan, label)));
  root.append(head);

  const frame = el("div", "planner-grid-frame");
  // Same withdrawal as `/emne/[code]/`'s week: `renderGrid` emits a `<button>`
  // per block and wires a click only when the caller passes `onBlockClick`.
  // This surface has nothing to hand it — the popover edits a plan, and this
  // plan is not the viewer's — so the affordance is withdrawn rather than faked.
  frame.dataset.static = "true";
  const notes = el("div", "planner-grid-notes");
  root.append(frame, notes);

  const list = el("ul", "public-plan-courses");
  for (const course of plan.courses) {
    const row = el("li", "public-plan-course");
    row.append(el("span", "np-data public-plan-code", course.code));
    const link = el("a", "np-navlink public-plan-name", course.name) as HTMLAnchorElement;
    link.href = `/emne/${encodeURIComponent(course.code)}/`;
    row.append(link);
    if (typeof course.credits === "number") {
      row.append(
        el("span", "np-data public-plan-credits", `${formatCreditNumber(course.credits)} sp`),
      );
    }
    list.append(row);
  }
  root.append(list);

  const foot = el("div", "public-plan-foot");
  foot.append(
    el("p", "np-hint", "Dette er en kopi du kan se på. Den endrer ingenting i din egen plan."),
  );
  foot.append(ctaLink());
  root.append(foot);

  drawWeek(deps, plan, frame, notes);
}

/**
 * Fetches every course's timetable and draws the week.
 *
 * The states are the planner's, minus the ones this page cannot have: it draws
 * a skeleton while the bundles land (`loading: true`), then the week. A course
 * whose fetch failed carries its own outcome into the margin notes through
 * `renderGrid`'s `planGaps` — the honest join (DR-8) is the renderer's, not
 * re-implemented here.
 */
function drawWeek(
  deps: PublicPlanDeps,
  plan: PublicPlan,
  frame: HTMLElement,
  notes: HTMLElement,
): void {
  const year = semesterYear(plan.semesterId);
  const semester = deps.semesters.find((s) => s.id === plan.semesterId);
  const hues = assignHues(plan.courses.map((c) => c.code));

  const states: PlanCourseState[] = plan.courses.map((course) => ({
    course: {
      code: course.code,
      name: course.name,
      version: course.version,
      source: "manual",
      ...(course.groups ? { groups: course.groups } : {}),
    },
    hueVar: hues.get(course.code) ?? "--hue-blue",
    bundle: null,
    loading: true,
    programCode: plan.program?.code ?? null,
  }));

  const draw = (loading: boolean): void => {
    renderGrid(frame, notes, states, false, { loading });
    for (const block of Array.from(frame.querySelectorAll<HTMLElement>(".planner-block"))) {
      block.tabIndex = -1;
    }
    fitBlockLabels(frame);
    syncScroll();
  };

  /** Mirrors plannerApp's `syncGridScroll`: the edge fades only when a day really is off-frame. */
  function syncScroll(): void {
    const grid = frame.querySelector<HTMLElement>(".planner-grid");
    const hiddenPx = grid ? grid.getBoundingClientRect().width - frame.clientWidth : 0;
    if (hiddenPx <= 1) {
      delete frame.dataset.scroll;
      return;
    }
    const maxScroll = frame.scrollWidth - frame.clientWidth;
    const left = frame.scrollLeft;
    frame.dataset.scroll = left <= 1 ? "start" : left >= maxScroll - 1 ? "end" : "middle";
    setScrollFade(frame, left, maxScroll);
  }

  frame.addEventListener("scroll", syncScroll, { passive: true, signal: deps.signal });
  window.addEventListener(
    "resize",
    () => {
      syncScroll();
      fitBlockLabels(frame);
    },
    { passive: true, signal: deps.signal },
  );

  draw(true);
  if (year === null) return;

  for (const [index, course] of plan.courses.entries()) {
    void fetchCourseBundle(course.code, year, course.version)
      .then((bundle) => {
        if (deps.signal.aborted) return;
        const state = states[index];
        if (!state) return;
        state.bundle = narrowToSemester(bundle, semester?.teachingWeeks);
        state.loading = false;
        if (states.every((s) => !s.loading)) draw(false);
      })
      .catch(() => {
        if (deps.signal.aborted) return;
        const state = states[index];
        if (!state) return;
        state.loading = false;
        if (states.every((s) => !s.loading)) draw(false);
      });
  }
}

/**
 * The fetched year carries BOTH terms; the week may only draw one of them.
 * Keeps the fetch's own `timetableOutcome`, so "fetched 12 entries, none this
 * semester" stays distinct from "the fetch failed" (DR-8).
 */
function narrowToSemester(bundle: CourseBundle, teachingWeeks: number[] | undefined): CourseBundle {
  if (!bundle.timetable || !teachingWeeks) return bundle;
  const timetable: TimetableEntry[] = entriesInSemester(bundle.timetable, teachingWeeks);
  return { ...bundle, timetable };
}
