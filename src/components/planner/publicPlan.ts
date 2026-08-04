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
 * ## What this module is now
 *
 * A FETCH AND THREE RENDER CALLS. It used to build the whole page — header,
 * tabs, layer box, week frame, course rows — which made it the one surface with
 * runtime copies of the week's controls and its own idea of what a course row
 * looks like. The shell is static now (`pages/user/index.astro`), and every
 * section is drawn by the same function the planner calls: `mountWeekView` for
 * the week, `renderExamList` for the exams, `renderCourseRows` and
 * `renderLoadTrack` for the courses. A change to any of them lands on both
 * pages or on neither.
 *
 * What is genuinely local is below: reading the name out of the path, the
 * fetch's four outcomes, and the two summary lines this page words differently
 * from the planner because it is describing somebody else's plan.
 */

import {
  type CourseBundle,
  fetchCourseBundle,
  loadPlannerIndex,
  type PlannerIndex,
  type TimetableEntry,
} from "../../lib/planner/data.js";
import { assignHues } from "../../lib/planner/hues.js";
import {
  type PublicPlan,
  parsePublicPlan,
  publicPlanCredits,
} from "../../lib/planner/publicPlan.js";
import { entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
import { renderCourseRows, renderLoadTrack } from "./courseRows.js";
import { el, formatCreditNumber } from "./dom.js";
import { renderExamList } from "./examList.js";
import type { PlanCourseState } from "./types.js";
import { mountWeekView } from "./weekView.js";

/** A full semester's load, the figure the planner measures against. */
const FULL_LOAD_CREDITS = 30;

/** The semester rows the page ships from `data/semesters.json` — teaching weeks and a name. */
export interface PublicSemester {
  id: string;
  name: string;
  teachingWeeks: number[];
}

export interface PublicPlanDeps {
  /** The account name, read from the path — the worker serves one shell for all of them. */
  navn: string;
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
 * The line under the name, in the planner's own vocabulary: which programme,
 * how many courses, how many credits. Credits are omitted rather than guessed
 * when nothing published one (DR-6).
 *
 * `formatCredits`'s "X av 30 sp" is the PLANNER's line — it measures a load
 * against a full semester, which is a judgement about the owner's plan that a
 * page for a viewer has no business making. The bare figure states the fact.
 */
export function planSummary(plan: PublicPlan): string {
  const count = plan.courses.length;
  const credits = publicPlanCredits(plan);
  const parts: string[] = [];
  if (plan.program) parts.push(`${plan.program.name}, kull ${plan.program.cohort}`);
  parts.push(`${count} ${count === 1 ? "emne" : "emner"}`);
  if (credits > 0) parts.push(`${formatCreditNumber(credits)} sp`);
  return parts.join(", ");
}

interface PageElements {
  title: HTMLElement;
  context: HTMLElement;
  term: HTMLElement;
  verdict: HTMLElement;
  main: HTMLElement;
  controls: HTMLElement | null;
  frame: HTMLElement;
  notes: HTMLElement;
  exams: HTMLElement;
  load: HTMLElement;
  credits: HTMLElement;
  legend: HTMLElement;
  rows: HTMLElement;
  message: HTMLElement;
}

function getElements(): PageElements | null {
  const byId = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;
  const found = {
    title: byId<HTMLElement>("public-plan-title"),
    context: byId<HTMLElement>("public-plan-context"),
    term: byId<HTMLElement>("public-plan-term"),
    verdict: byId<HTMLElement>("public-plan-verdict"),
    main: byId<HTMLElement>("public-plan-main"),
    frame: byId<HTMLElement>("public-plan-frame"),
    notes: byId<HTMLElement>("public-plan-notes"),
    exams: byId<HTMLElement>("public-plan-exams"),
    load: byId<HTMLElement>("public-plan-load"),
    credits: byId<HTMLElement>("public-plan-credits"),
    legend: byId<HTMLElement>("public-plan-legend"),
    rows: byId<HTMLElement>("public-plan-rows"),
    message: byId<HTMLElement>("public-plan-message"),
  };
  for (const value of Object.values(found)) {
    if (!value) return null;
  }
  return {
    ...(found as Omit<PageElements, "controls">),
    controls: document.querySelector<HTMLElement>('#public-plan-main [data-role="week-controls"]'),
  };
}

/** The one call to action: this page is a week, and the way to get your own is the planner. */
function ctaLink(): HTMLElement {
  const link = el("a", "np-btn np-btn--primary", "Lag din egen plan") as HTMLAnchorElement;
  link.href = "/planlegger/";
  return link;
}

/**
 * Says what happened, in ink, without apology (DESIGN §7), and takes the plan's
 * own sections off the page — a sentence under an empty week frame and two
 * empty section headings is worse than the sentence on its own.
 */
function renderMessage(elements: PageElements, lines: string[], extra?: HTMLElement): void {
  elements.main.hidden = true;
  elements.message.hidden = false;
  elements.message.replaceChildren();
  for (const line of lines) elements.message.append(el("p", "np-hint", line));
  if (extra) elements.message.append(extra);
}

export async function mountPublicPlan(deps: PublicPlanDeps): Promise<void> {
  const elements = getElements();
  if (!elements) return;
  const { navn } = deps;

  if (navn === "") {
    renderMessage(elements, ["Fant ingen delt plan her. Lenken kan være fjernet."], ctaLink());
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
    renderMessage(elements, ["Fant ingen delt plan her. Lenken kan være fjernet."], ctaLink());
    return;
  }
  if (response === null || !response.ok) {
    renderMessage(elements, ["Kunne ikke hente planen."], retryButton(deps));
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
    renderMessage(elements, ["Kunne ikke hente planen."], retryButton(deps));
    return;
  }
  if (plan.courses.length === 0) {
    renderMessage(elements, [`${navn} har ingen emner i planen akkurat nå.`], ctaLink());
    return;
  }

  renderPlan(deps, elements, plan);
}

function retryButton(deps: PublicPlanDeps): HTMLElement {
  const button = el("button", "np-btn", "Prøv igjen") as HTMLButtonElement;
  button.type = "button";
  button.addEventListener(
    "click",
    () => {
      void mountPublicPlan(deps);
    },
    { signal: deps.signal },
  );
  return button;
}

function renderPlan(deps: PublicPlanDeps, elements: PageElements, plan: PublicPlan): void {
  const { navn } = deps;
  elements.message.hidden = true;
  elements.main.hidden = false;
  elements.title.textContent = navn;
  elements.context.textContent = planSummary(plan);
  elements.term.textContent = semesterLabelOf(plan, deps.semesters);

  const year = semesterYear(plan.semesterId);
  const semester = deps.semesters.find((s) => s.id === plan.semesterId);
  const hues = assignHues(plan.courses.map((c) => c.code));

  const states: PlanCourseState[] = plan.courses.map((course) => ({
    course: {
      code: course.code,
      name: course.name,
      version: course.version,
      source: "manual",
      // The published credits, carried through. Without them the list drew no
      // figures and the load track drew nothing at all: the shared payload is
      // the only source here, since no bundle has landed when the rows are
      // written and this plan is never re-rendered from one.
      ...(typeof course.credits === "number" ? { credits: course.credits } : {}),
      ...(course.groups ? { groups: course.groups } : {}),
    },
    hueVar: hues.get(course.code) ?? "--hue-blue",
    bundle: null,
    loading: true,
    programCode: plan.program?.code ?? null,
  }));

  // The courses are known before any bundle lands, so the list and the load
  // track are drawn once, immediately, and never re-drawn: this plan cannot be
  // edited, and a shared payload carries its own credits.
  renderCourseRows(
    elements.rows,
    states.map((state) => ({
      code: state.course.code,
      name: state.course.name,
      hueVar: state.hueVar,
      credits: state.course.credits ?? null,
    })),
  );
  renderLoadTrack(
    elements.load,
    states
      .filter((state) => (state.course.credits ?? 0) > 0)
      .map((state) => ({
        code: state.course.code,
        hueVar: state.hueVar,
        credits: state.course.credits ?? 0,
      })),
    FULL_LOAD_CREDITS,
  );
  const credits = publicPlanCredits(plan);
  elements.credits.textContent = credits > 0 ? `${formatCreditNumber(credits)} sp` : "";
  elements.legend.hidden = credits <= 0;

  /**
   * The same week `/planlegger/` draws, in the same two views, from the owner's
   * own group picks — which is what makes a shared link the week the sharer is
   * looking at rather than a second opinion about it. The three controls stay
   * LIVE: which week, which layers and which shape are the viewer's questions,
   * not the sharer's, and answering them changes nothing about the plan.
   *
   * `onOpenSettings` is null: this plan is not the viewer's, and nothing on
   * this page can change it. The popover still opens, because it answers "what
   * is this session", which a viewer deciding whether to copy the plan wants.
   */
  const week = mountWeekView({
    frame: elements.frame,
    notes: elements.notes,
    controls: elements.controls,
    surface: "user",
    onOpenSettings: null,
    onRerender: () => draw(states.some((s) => s.loading)),
    signal: deps.signal,
  });

  const draw = (loading: boolean): void => {
    const result = week.render(states, {
      teachingWeeks: semester?.teachingWeeks ?? [],
      ...(year !== null ? { year } : {}),
      loading,
    });
    renderVerdict(elements, week, result.conflictCount, loading);
  };

  draw(true);
  if (year === null) return;

  // The exam list needs our own catalog artifact, which is a static file this
  // page can fetch exactly as the planner does. Failing to get it leaves the
  // section empty rather than apologising: a shared plan's exam dates are a
  // bonus, and this page has no retry to offer that is worth a button.
  let index: PlannerIndex | null = null;
  void loadPlannerIndex()
    .then((loaded) => {
      if (deps.signal.aborted) return;
      index = loaded;
      drawExams();
    })
    .catch(() => {
      /* Section stays empty. */
    });

  const drawExams = (): void => {
    if (!index) return;
    renderExamList(elements.exams, states, plan.semesterId, index, null, todayIso(), {
      loading: states.some((s) => s.loading),
    });
  };

  for (const [index_, course] of plan.courses.entries()) {
    void fetchCourseBundle(course.code, year, course.version)
      .then((bundle) => {
        if (deps.signal.aborted) return;
        const state = states[index_];
        if (!state) return;
        state.bundle = narrowToSemester(bundle, semester?.teachingWeeks);
        state.loading = false;
        if (states.every((s) => !s.loading)) {
          draw(false);
          drawExams();
        }
      })
      .catch(() => {
        if (deps.signal.aborted) return;
        const state = states[index_];
        if (!state) return;
        state.loading = false;
        if (states.every((s) => !s.loading)) {
          draw(false);
          drawExams();
        }
      });
  }
}

/** Today in Oslo as "YYYY-MM-DD" — the exam list's "om N dager" is a date, not a moment. */
function todayIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The same verdict the planner shows, and the same rule: it speaks only when
 * there is something to say.
 *
 * A shared plan that holds together says nothing, exactly as the planner's does
 * — the green pass was removed there for spending a line of the first screen to
 * report that nothing is wrong, and it would be no more useful here. A clash is
 * worth saying, and it is worth being able to follow: this is a plan a viewer
 * may be about to copy.
 */
function renderVerdict(
  elements: PageElements,
  week: { jumpToFirstConflict(): void },
  conflictCount: number,
  loading: boolean,
): void {
  elements.verdict.replaceChildren();
  if (loading || conflictCount === 0) return;
  const chip = el("button", "planner-chip np-note-clash is-jump");
  chip.type = "button";
  chip.append(el("span", "np-data", String(conflictCount)));
  chip.append(conflictCount === 1 ? " kollisjon" : " kollisjoner");
  chip.addEventListener("click", () => week.jumpToFirstConflict());
  elements.verdict.append(chip);
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
