/**
 * Study-plan island for `/studier/[code]/`: tries `/api/program/:code/plan`
 * at the current cohort year, stepping back on 404 (max 3 tries), then
 * renders cohort-year chips from the response's `publishedYears` and
 * refetches on chip click.
 *
 * Ownership (§3 of REVIEW.md): the planner owns the current semester's
 * plan — prefill, drops, credits, the choice pool. This page owns the
 * browsable *template* and nothing else, so it renders only the cohort's
 * current period (expanded, with a credit subtotal and DR-5's verbatim
 * group/waypoint prose) and the next period (collapsed); every other
 * period is cut — multi-year planning is a §9 non-goal. There are no
 * per-course add controls: adding a course to a semester the student isn't
 * planning is DR-10's bug factory, and the planner is where adds belong.
 *
 * "Bruk som planen min" builds the programme baseline for the current
 * period the same way the landing page's kull-picker does (PRODUCT.md
 * §0) — obligatory-classified courses replace the plan's `source:
 * "program"` set via `setProgramPlan`, preserving existing manual
 * adds/drops, then navigates to `/planlegger/`. It only renders when the
 * period's top-level `courseGroups` are non-empty: when they're empty the
 * whole period hangs off an unresolved `Valg av studieretning` waypoint
 * (U16) and `classifyPeriod`'s cross-direction intersection would commit
 * courses this page never showed on screen. Never move courses the
 * student cannot see — send them to the planner, which has the actual
 * direction-choice UI, instead.
 */
import { semesterYear } from "../../lib/planner/schedule.js";
import { createPlanStore, formatPlanHash, type PlanStore } from "../../lib/planner/store.js";
import { formatCreditNumber, formatCredits } from "../planner/dom.js";
import { classifyPeriod, isSuspiciousPrefill } from "../planner/programPlan.js";

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

/** Cohort chips beyond this many (newest first) fold into "andre kull" (§3.1). */
const VISIBLE_COHORT_COUNT = 6;

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

/**
 * Comma-decimal credit figure ("7,5"), matching DESIGN.md's number convention.
 * Aliased rather than reimplemented: `formatCreditNumber` is the one formatter
 * every credit number on the site goes through (D3). The local name stays
 * because this page shows a bare figure, not the planner's "X av 30 sp".
 */
export const formatCreditFigure = formatCreditNumber;

const MONTH_NAMES = [
  "januar",
  "februar",
  "mars",
  "april",
  "mai",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "desember",
];

/** `"12-05-2026 at 04:53:33"` (the plan API's own format) → `"12. mai 2026"`. */
export function formatUpdatedDate(raw: string): string | null {
  const m = /^(\d{2})-(\d{2})-(\d{4})/.exec(raw.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTH_NAMES[Number(m[2]) - 1];
  if (!month) return null;
  return `${day}. ${month} ${m[3]}`;
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

function renderCourseGroup(group: PlanCourseGroup): HTMLElement {
  const wrap = el("div", "plan-group");
  if (group.name) wrap.append(el("p", "plan-group-name", group.name));
  // Verbatim, never paraphrased — this is the "velg 2 av 5"-style prose
  // DR-5 requires and the old design silently dropped (U17a).
  if (group.description) wrap.append(el("p", "plan-group-description np-hint", group.description));
  for (const course of group.courses) {
    const row = el("div", "plan-course-row");
    if (course.planElement) {
      row.append(el("span", "plan-course-name", course.name ?? course.code));
    } else {
      const link = el("a", "plan-course-code", course.code);
      link.href = `/emne/${course.code}/`;
      row.append(link);
      row.append(el("span", "plan-course-name", course.name ?? ""));
    }
    if (course.credits !== null) {
      row.append(el("span", "plan-course-credits", `${formatCreditFigure(course.credits)} sp`));
    }
    wrap.append(row);
  }
  return wrap;
}

function renderDirection(direction: PlanDirection): HTMLElement {
  const wrap = el("div", "plan-direction");
  if (direction.name) wrap.append(el("p", "plan-direction-name", direction.name));
  for (const group of direction.courseGroups) wrap.append(renderCourseGroup(group));
  for (const waypoint of direction.waypoints) wrap.append(renderWaypoint(waypoint));
  return wrap;
}

function renderWaypoint(waypoint: StudyWaypoint): HTMLElement {
  const details = el("details", "plan-waypoint");
  const summary = document.createElement("summary");
  summary.className = "np-summary";
  summary.append(document.createTextNode(waypoint.name ?? "Valg"));
  details.append(summary);

  const body = el("div", "plan-waypoint-body");
  if (waypoint.description) {
    body.append(el("p", "plan-waypoint-description np-hint", waypoint.description));
  }
  for (const direction of waypoint.directions) body.append(renderDirection(direction));
  details.append(body);

  return details;
}

/** Null-aware credit subtotal for a period's top-level (visible) courses only — U17b. */
export function periodSubtotal(
  direction: PlanDirection,
): { text: string; hasUnknown: boolean } | null {
  if (direction.courseGroups.length === 0) return null;
  let sum = 0;
  let hasUnknown = false;
  for (const group of direction.courseGroups) {
    for (const course of group.courses) {
      if (course.credits === null) {
        hasUnknown = true;
        continue;
      }
      sum += course.credits;
    }
  }
  return { text: formatCredits(sum), hasUnknown };
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

/**
 * Builds one period's header content (heading, subtotal, and — current
 * only — the commit button) as loose nodes so the caller can append them
 * either into a `.plan-period-header` div (current, expanded) or directly
 * into a `<summary>` (next, collapsed) without nesting a block element
 * inside `<summary>`'s phrasing-content model.
 */
function periodHeaderNodes(
  period: StudyPlanPeriod,
  opts: {
    isCurrent: boolean;
    canUseAsPlan: boolean;
    store: PlanStore;
    plan: StudyPlan;
    program: { code: string; name: string; cohort: number };
  },
): Node[] {
  const nodes: Node[] = [
    el(
      "h3",
      `np-kicker${opts.isCurrent ? " plan-period-current" : ""}`,
      period.periodNumber !== null ? `Semester ${period.periodNumber}` : "Semester",
    ),
  ];
  if (opts.isCurrent) nodes.push(el("span", "plan-period-badge", "ditt semester"));

  const subtotal = periodSubtotal(period.direction);
  if (subtotal) {
    const node = el("span", "np-data plan-period-subtotal", subtotal.text);
    if (subtotal.hasUnknown) node.title = "Mangler studiepoeng for ett eller flere emner i dataene";
    nodes.push(node);
  }

  if (opts.isCurrent && opts.canUseAsPlan && period.periodNumber !== null) {
    const periodNumber = period.periodNumber;
    const useBtn = el("button", "np-btn np-press plan-use-as-mine", "Bruk som planen min");
    useBtn.type = "button";
    useBtn.addEventListener("click", () => {
      void useAsMyPlan(opts.store, opts.plan, periodNumber, opts.program);
    });
    nodes.push(useBtn);
  }

  return nodes;
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
    body.append(el("p", "plan-empty np-hint", "ingen perioder publisert for dette kullet ennå"));
    return;
  }

  // §3.1: only the cohort's current period (expanded) and the next one
  // (collapsed) — multi-year planning is a §9 non-goal, so every other
  // period is cut rather than dumped.
  const exact =
    highlightPeriod !== null
      ? plan.periods.find((p) => p.periodNumber === highlightPeriod)
      : undefined;
  const current = exact ?? plan.periods[0];
  if (!current) return;
  const next = plan.periods.find((p) => p.periodNumber === (current.periodNumber ?? 0) + 1);

  if (!exact) {
    body.append(
      el(
        "p",
        "plan-fallback-hint np-hint",
        "Fant ikke perioden som matcher valgt semester for dette kullet — viser første publiserte periode i stedet.",
      ),
    );
  }

  const hasWaypointChoice = current.direction.waypoints.length > 0;
  const canUseAsPlan = current.direction.courseGroups.length > 0;

  const currentSection = el("div", "plan-period");
  const currentHeader = el("div", "plan-period-header");
  currentHeader.append(
    ...periodHeaderNodes(current, { isCurrent: true, canUseAsPlan, store, plan, program }),
  );
  currentSection.append(currentHeader);
  if (!canUseAsPlan && hasWaypointChoice) {
    currentSection.append(
      el(
        "p",
        "plan-gate-hint np-hint",
        "Dette semesteret avhenger av studieretning. Velg i planleggeren for å fylle ut uka automatisk.",
      ),
    );
  }
  currentSection.append(renderDirection(current.direction));
  body.append(currentSection);

  if (next) {
    const nextDetails = el("details", "plan-period plan-period-next");
    const nextSummary = document.createElement("summary");
    nextSummary.className = "np-summary plan-period-header";
    nextSummary.append(
      ...periodHeaderNodes(next, { isCurrent: false, canUseAsPlan: false, store, plan, program }),
    );
    nextDetails.append(nextSummary);
    nextDetails.append(renderDirection(next.direction));
    body.append(nextDetails);
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
  const provenance = document.getElementById("plan-provenance");
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
    const visible = years.slice(0, VISIBLE_COHORT_COUNT);
    const rest = years.slice(VISIBLE_COHORT_COUNT);

    function makeChip(year: number): HTMLButtonElement {
      const chip = el("button", "np-toggle plan-year-chip", String(year));
      chip.type = "button";
      chip.setAttribute("aria-label", `Kull ${year}`);
      chip.setAttribute("aria-pressed", String(year === activeYear));
      chip.addEventListener("click", () => {
        for (const other of Array.from(yearsContainer.querySelectorAll(".plan-year-chip"))) {
          other.setAttribute("aria-pressed", String(other === chip));
        }
        loadExactYear(year);
      });
      return chip;
    }

    const row = el("div", "plan-years-row");
    for (const year of visible) row.append(makeChip(year));
    yearsContainer.append(row);

    if (rest.length > 0) {
      const details = el("details", "plan-years-more");
      if (rest.includes(activeYear)) details.open = true;
      const summary = document.createElement("summary");
      summary.className = "np-summary";
      summary.append(document.createTextNode(`andre kull (${rest.length})`));
      details.append(summary);
      const restRow = el("div", "plan-years-row");
      for (const year of rest) restRow.append(makeChip(year));
      details.append(restRow);
      yearsContainer.append(details);
    }
  }

  function renderProvenance(plan: StudyPlan, steppedBackFrom: number | null): void {
    if (!provenance) return;
    const parts: string[] = [];
    const updated = plan.updated ? formatUpdatedDate(plan.updated) : null;
    parts.push(
      updated ? `Studieplan sist oppdatert ${updated} hos NTNU.` : "Oppdateringsdato ukjent.",
    );
    if (steppedBackFrom !== null && steppedBackFrom !== plan.year) {
      parts.push(
        `Fant ingen studieplan for kull ${steppedBackFrom} ennå — viser nyeste tilgjengelige, kull ${plan.year}.`,
      );
    }
    provenance.textContent = parts.join(" ");
    provenance.hidden = false;
  }

  async function loadExactYear(year: number): Promise<void> {
    statusEl.hidden = false;
    statusEl.textContent = "henter studieplan …";
    bodyEl.hidden = true;
    if (provenance) provenance.hidden = true;

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
    renderProvenance({ ...result, year }, null);
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
  renderProvenance({ ...found.plan, year: found.year }, guessYear);
  if (found.plan.publishedYears.length > 0) {
    renderYearChips(found.plan.publishedYears, found.year);
  }
}
