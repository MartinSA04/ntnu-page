/**
 * Study-plan island for `/studier/[code]/`: tries `/api/program/:code/plan`
 * at the current cohort year, stepping back on 404 (max 3 tries), then
 * renders cohort-year chips from the response's `publishedYears` and
 * refetches on chip click. Plan body: periods → course groups → course rows
 * (mono code linking to `/emne/CODE/` + manual add control), waypoints/
 * directions as nested `.np-summary` disclosures. Each course row's add
 * control is a manual add (`source: "manual"`); the period matching the
 * plan's chosen semester for the cohort is auto-highlighted ("ditt
 * semester") and carries a "Bruk som planen min" button that builds the
 * programme baseline for that period the same way the landing page's
 * kull-picker does (PRODUCT.md §0) — obligatory-classified courses replace
 * the plan's `source: "program"` set via `setProgramPlan`, preserving
 * existing manual adds/drops, then navigates to `/planlegger/`.
 */
import { semesterYear } from "../../lib/planner/schedule.ts";
import { createPlanStore, formatPlanHash, type PlanStore } from "../../lib/planner/store.ts";
import { classifyPeriod, isSuspiciousPrefill } from "../planner/programPlan.ts";

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

interface StudyPlan {
  code: string;
  name: string | null;
  year: number | null;
  startTerm: string | null;
  updated: string | null;
  periods: StudyPlanPeriod[];
  publishedYears: number[];
}

const MAX_STEP_BACK_TRIES = 3;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

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

/** Steps back from `guessYear` up to MAX_STEP_BACK_TRIES times on 404. */
async function findPlan(
  code: string,
  guessYear: number,
): Promise<{ plan: StudyPlan; year: number } | "not-found" | "error"> {
  let year = guessYear;
  for (let attempt = 0; attempt < MAX_STEP_BACK_TRIES; attempt++) {
    const result = await fetchPlan(code, year);
    if (result === "error") return "error";
    if (result !== null) return { plan: result, year };
    year -= 1;
  }
  return "not-found";
}

/**
 * The plan period number matching the store's chosen semester for a cohort
 * admitted in `cohort` (PLANNER.md §5): period 1 is the cohort's first
 * autumn, counting up two per calendar year (autumn = odd, spring = even).
 */
function currentPeriodNumber(semesterId: string, cohort: number): number | null {
  const semYear = semesterYear(semesterId);
  if (semYear === null) return null;
  const isAutumn = /h$/i.test(semesterId.trim());
  return (semYear - cohort) * 2 + (isAutumn ? 1 : 2);
}

/** A manual add/remove toggle for one course row (source: "manual" — PRODUCT.md §0.3). */
function addButton(store: PlanStore, code: string, name: string): HTMLButtonElement {
  const btn = el("button", "np-icon-btn np-press plan-add-btn");
  btn.type = "button";

  function sync(): void {
    const inPlan = store.hasCourse(code);
    btn.setAttribute("aria-pressed", String(inPlan));
    btn.setAttribute(
      "aria-label",
      inPlan ? `Fjern ${code} fra planen` : `Legg til ${code} i planen`,
    );
    btn.textContent = inPlan ? "✓" : "+";
  }

  btn.addEventListener("click", () => {
    if (store.hasCourse(code)) {
      store.removeCourse(code);
    } else {
      store.addCourse({ code, name, source: "manual" });
    }
    sync();
  });

  store.onPlanChange(sync);
  sync();
  return btn;
}

function renderCourseGroup(group: PlanCourseGroup, store: PlanStore): HTMLElement {
  const wrap = el("div", "plan-group");
  if (group.name) wrap.append(el("p", "plan-group-name", group.name));
  for (const course of group.courses) {
    const row = el("div", "plan-course-row");
    if (course.planElement) {
      row.append(el("span", "plan-course-name", course.name ?? course.code));
    } else {
      const link = el("a", "plan-course-code", course.code);
      link.href = `/emne/${course.code}/`;
      row.append(link);
      row.append(el("span", "plan-course-name", course.name ?? ""));
      row.append(addButton(store, course.code, course.name ?? course.code));
    }
    if (course.credits !== null) {
      row.append(el("span", "plan-course-credits", `${course.credits} sp`));
    }
    wrap.append(row);
  }
  return wrap;
}

function renderDirection(direction: PlanDirection, store: PlanStore): HTMLElement {
  const wrap = el("div", "plan-direction");
  if (direction.name) wrap.append(el("p", "plan-direction-name", direction.name));
  for (const group of direction.courseGroups) wrap.append(renderCourseGroup(group, store));
  for (const waypoint of direction.waypoints) wrap.append(renderWaypoint(waypoint, store));
  return wrap;
}

function renderWaypoint(waypoint: StudyWaypoint, store: PlanStore): HTMLElement {
  const details = el("details", "plan-waypoint");
  const summary = document.createElement("summary");
  summary.className = "np-summary";
  summary.append(document.createTextNode(waypoint.name ?? "Valg"));
  details.append(summary);

  const body = el("div", "plan-waypoint-body");
  for (const direction of waypoint.directions) body.append(renderDirection(direction, store));
  details.append(body);

  return details;
}

/**
 * Builds the programme baseline for `periodNumber` the same way the landing
 * page's kull-picker does (PRODUCT.md §0): obligatory-classified courses
 * (DR-5 heuristic in programPlan.ts, validated against real MTDT + a
 * bachelor programme) replace the plan's `source: "program"` set via
 * `setProgramPlan` — preserving existing manual adds/drops per store
 * semantics — then navigates to `/planlegger/` with the resulting plan
 * seeded into the hash.
 */
async function useAsMyPlan(
  store: PlanStore,
  plan: StudyPlan,
  periodNumber: number,
  program: { code: string; name: string; cohort: number },
): Promise<void> {
  const classified = classifyPeriod(plan, periodNumber);
  let obligatory = classified?.obligatory ?? [];
  if (isSuspiciousPrefill(obligatory)) obligatory = [];
  const toAdd = obligatory.map((c) => ({
    code: c.code,
    name: c.name,
    version: c.version,
    source: "program" as const,
  }));
  const next = store.setProgramPlan(program, toAdd);
  location.href = `/planlegger/${formatPlanHash(next)}`;
}

function renderPlan(
  body: HTMLElement,
  plan: StudyPlan,
  store: PlanStore,
  program: { code: string; name: string; cohort: number },
  highlightPeriod: number | null,
): void {
  body.replaceChildren();

  if (plan.periods.length === 0) {
    body.append(el("p", "plan-empty np-note", "ingen perioder publisert for dette kullet ennå"));
    return;
  }

  for (const period of plan.periods) {
    const section = el("div", "plan-period");
    const header = el("div", "plan-period-header");
    const isCurrent = highlightPeriod !== null && period.periodNumber === highlightPeriod;
    header.append(
      el(
        "p",
        `np-kicker${isCurrent ? " plan-period-current" : ""}`,
        period.periodNumber !== null ? `Semester ${period.periodNumber}` : "Semester",
      ),
    );
    if (isCurrent) header.append(el("span", "np-note plan-period-current", "ditt semester"));

    if (period.periodNumber !== null) {
      const periodNumber = period.periodNumber;
      const useBtn = el("button", "np-btn np-press plan-use-as-mine", "Bruk som planen min");
      useBtn.type = "button";
      useBtn.addEventListener("click", () => {
        void useAsMyPlan(store, plan, periodNumber, program);
      });
      header.append(useBtn);
    }

    section.append(header);
    section.append(renderDirection(period.direction, store));
    body.append(section);
  }
}

export async function mountStudyPlan(
  code: string,
  name: string,
  guessYear: number,
  defaultSemesterId: string,
): Promise<void> {
  const section = document.getElementById("plan-section");
  const status = section?.querySelector<HTMLElement>('[data-role="status"]');
  const body = section?.querySelector<HTMLElement>('[data-role="body"]');
  const yearsEl = document.getElementById("plan-years");
  const yearsKicker = document.getElementById("plan-years-kicker");
  if (!section || !status || !body || !yearsEl || !code || !guessYear) return;
  // Rebind as non-optional locals: TS doesn't narrow captured outer bindings
  // inside nested function declarations below.
  const statusEl = status;
  const bodyEl = body;
  const yearsContainer = yearsEl;

  const store = createPlanStore(defaultSemesterId);

  function renderYearChips(publishedYears: number[], activeYear: number): void {
    yearsContainer.replaceChildren();
    yearsContainer.setAttribute("role", "group");
    yearsContainer.setAttribute("aria-label", "Velg kull");
    if (yearsKicker) yearsKicker.hidden = false;
    const years = [...publishedYears].sort((a, b) => b - a);
    for (const year of years) {
      const chip = el("button", "np-toggle plan-year-chip", String(year));
      chip.type = "button";
      chip.setAttribute("aria-label", `Kull ${year}`);
      chip.setAttribute("aria-pressed", String(year === activeYear));
      chip.addEventListener("click", () => {
        for (const other of yearsContainer.querySelectorAll(".plan-year-chip")) {
          other.setAttribute("aria-pressed", String(other === chip));
        }
        loadExactYear(year);
      });
      yearsContainer.append(chip);
    }
  }

  async function loadExactYear(year: number): Promise<void> {
    statusEl.hidden = false;
    statusEl.textContent = "henter studieplan …";
    bodyEl.hidden = true;

    const result = await fetchPlan(code, year);
    if (result === "error") {
      statusEl.textContent = "klarte ikke å hente studieplan";
      return;
    }
    if (result === null) {
      statusEl.textContent = "ingen studieplan funnet for dette kullet";
      return;
    }
    statusEl.hidden = true;
    bodyEl.hidden = false;
    const program = { code, name, cohort: year };
    const highlightPeriod = currentPeriodNumber(store.loadPlan().semesterId, year);
    renderPlan(bodyEl, result, store, program, highlightPeriod);
    if (result.publishedYears.length > 0) renderYearChips(result.publishedYears, year);
  }

  const found = await findPlan(code, guessYear);
  if (found === "error") {
    statusEl.textContent = "klarte ikke å hente studieplan";
    return;
  }
  if (found === "not-found") {
    statusEl.textContent = "ingen studieplan funnet";
    return;
  }

  statusEl.hidden = true;
  bodyEl.hidden = false;
  const program = { code, name, cohort: found.year };
  const highlightPeriod = currentPeriodNumber(store.loadPlan().semesterId, found.year);
  renderPlan(bodyEl, found.plan, store, program, highlightPeriod);
  if (found.plan.publishedYears.length > 0) {
    renderYearChips(found.plan.publishedYears, found.year);
  }
}
