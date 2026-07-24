/**
 * Study-plan island for `/studier/[code]/`: tries `/api/program/:code/plan`
 * at the current cohort year, stepping back on 404 (max 3 tries), then
 * renders cohort-year chips from the response's `publishedYears` and
 * refetches on chip click. Plan body: periods → course groups → course rows
 * (mono code linking to `/emne/CODE/`), waypoints/directions as nested
 * `.sc-summary` disclosures.
 */

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

function renderCourseGroup(group: PlanCourseGroup): HTMLElement {
  const wrap = el("div", "plan-group");
  if (group.name) wrap.append(el("p", "plan-group-name", group.name));
  for (const course of group.courses) {
    const row = el("div", "plan-course-row");
    if (course.planElement) {
      row.append(el("span", "plan-course-name", course.name ?? course.code));
    } else {
      const link = el("a", "plan-course-code mono", course.code);
      link.href = `/emne/${course.code}/`;
      row.append(link);
      row.append(el("span", "plan-course-name", course.name ?? ""));
    }
    if (course.credits !== null) {
      row.append(el("span", "plan-course-credits mono", `${course.credits} sp`));
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
  summary.className = "sc-summary";
  const chev = el("span", "sc-chev", "▸");
  summary.append(chev, document.createTextNode(waypoint.name ?? "Valg"));
  details.append(summary);

  const body = el("div", "plan-waypoint-body");
  for (const direction of waypoint.directions) body.append(renderDirection(direction));
  details.append(body);

  return details;
}

function renderPlan(body: HTMLElement, plan: StudyPlan): void {
  body.replaceChildren();

  if (plan.periods.length === 0) {
    body.append(el("p", "plan-empty mono", "ingen perioder publisert for dette kullet ennå"));
    return;
  }

  for (const period of plan.periods) {
    const section = el("div", "plan-period");
    section.append(
      el(
        "p",
        "sc-kicker plan-period-header",
        period.periodNumber !== null ? `Semester ${period.periodNumber}` : "Semester",
      ),
    );
    section.append(renderDirection(period.direction));
    body.append(section);
  }
}

export async function mountStudyPlan(code: string, guessYear: number): Promise<void> {
  const section = document.getElementById("plan-section");
  const status = section?.querySelector<HTMLElement>('[data-role="status"]');
  const body = section?.querySelector<HTMLElement>('[data-role="body"]');
  const yearsEl = document.getElementById("plan-years");
  if (!section || !status || !body || !yearsEl || !code || !guessYear) return;
  // Rebind as non-optional locals: TS doesn't narrow captured outer bindings
  // inside nested function declarations below.
  const statusEl = status;
  const bodyEl = body;
  const yearsContainer = yearsEl;

  function renderYearChips(publishedYears: number[], activeYear: number): void {
    yearsContainer.replaceChildren();
    const years = [...publishedYears].sort((a, b) => b - a);
    for (const year of years) {
      const chip = el("button", "sc-chip plan-year-chip mono", String(year));
      chip.type = "button";
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
    renderPlan(bodyEl, result);
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
  renderPlan(bodyEl, found.plan);
  if (found.plan.publishedYears.length > 0) {
    renderYearChips(found.plan.publishedYears, found.year);
  }
}
