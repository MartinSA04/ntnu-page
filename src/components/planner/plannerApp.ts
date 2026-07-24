/**
 * `/planlegger/` orchestrator (PRODUCT.md §0 — the mandate). Schedule-first:
 * programme + kull picked once → the weekly schedule for the chosen semester
 * renders immediately, prefilled with the courses the study plan says the
 * student has (NTNU auto-enrolls programme students — DR-7's pre-fill IS the
 * default plan, not a hedged suggestion).
 *
 * The page is **two regions**, not four tabs: *Uke* (grid + exam ribbon —
 * both answer "when") and *Emner* (what's in the plan + how to change it).
 * Side by side on wide screens, tab-switched below 60rem. They stay
 * co-visible where there is room because the product's core loop is
 * add/drop → watch the collision appear or vanish; splitting cause from
 * effect would put a click in the middle of the one interaction that matters.
 *
 * Two things the study plan forces, both handled here (see programPlan.ts):
 * - **The studieretning question.** Later-year sivilingeniør periods have no
 *   top-level courses at all. The cross-direction obligatory intersection is
 *   prefilled so the week is never blank, and the question is asked *on the
 *   Uke region* — an empty grid with "velg studieretning" is a complete
 *   screen; the same question hidden behind a tab is a dead end.
 * - **The choice pool.** A 4th/5th-year period offers 30–60+ courses. That is
 *   not a list — it is a filter on search, so it lives inside the add field's
 *   "Fra studieplanen / Alle emner" scope toggle rather than on the surface.
 *
 * Render work is delegated to grid.ts/examRibbon.ts.
 */

import { lecturesOnly } from "../../lib/planner/activity.js";
import { findConflicts } from "../../lib/planner/conflicts.js";
import {
  type CourseBundle,
  examsFromIndex,
  fetchCourseBundle,
  loadPlannerIndex,
  type PlannerIndex,
  type PlannerIndexCourse,
  type TimetableEntry,
} from "../../lib/planner/data.js";
import { hueForIndex } from "../../lib/planner/hues.js";
import { entriesForProgram, entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
import {
  type AddCourseInput,
  activeCourses,
  createPlanStore,
  formatPlanHash,
  type PlanCourse,
  type PlanProgram,
  type PlanState,
  type PlanStore,
  parsePlanHash,
} from "../../lib/planner/store.js";
import { el, fold, formatCredits, formatShortDate } from "./dom.js";
import { renderExamRibbon } from "./examRibbon.js";
import { renderGrid } from "./grid.js";
import {
  classifyPeriod,
  type DirectionOption,
  findProgramPlan,
  isSuspiciousPrefill,
  type PeriodCourses,
  periodNumberFor,
} from "./programPlan.js";
import type { PlanCourseState } from "./types.js";

export interface SemesterSummary {
  id: string;
  name: string;
  teachingWeeks: number[];
  timetablePublished: boolean;
  fromDate: string | null;
  toDate: string | null;
  examLastDate: string | null;
  examFinalDate: string | null;
}

export interface SemestersFile {
  crawledAt: string;
  current: SemesterSummary | null;
  semesters: SemesterSummary[];
}

/** `[code, name]` — the trimmed programme catalog passed in from the page (see index.astro). */
export type ProgramOption = [code: string, name: string];

/** Which corpus the add field searches. */
type PickerScope = "plan" | "all";

/** One selectable row in the add field's listbox. */
interface PickerRow {
  code: string;
  name: string;
  version: string;
  credits: number | null;
  groupName: string | null;
}

/**
 * Rows rendered at once. Bounds both the visual list and the number of
 * candidate timetables fetched for clash previews — a period's pool can run
 * to 60+ courses, and previewing all of them would be dozens of requests for
 * rows the student never looks at.
 */
const MAX_PICKER_ROWS = 12;

/**
 * Above this, "Fra studieplanen" stops being a recommendation. MTDT period 8
 * offers ~330 course entries coded `V` — effectively "any course at NTNU",
 * which is what "Alle emner" already is. Presenting that as a curated pool
 * would be a fabricated signal, so the scope flips and says so.
 */
const UNCURATED_POOL_SIZE = 60;

/** Full credit load for one semester — the denominator in "X av 30 sp". */
const FULL_LOAD_CREDITS = 30;

interface PlannerElements {
  contextLine: HTMLElement;
  contextChange: HTMLButtonElement;
  toggleHost: HTMLElement;
  creditLine: HTMLElement;
  picker: HTMLElement;
  pickerField: HTMLElement;
  pickerInput: HTMLInputElement;
  pickerListbox: HTMLUListElement;
  pickerKull: HTMLElement;
  pickerKullChips: HTMLElement;
  pickerStatus: HTMLElement;
  emptyState: HTMLElement;
  main: HTMLElement;
  tabWeek: HTMLButtonElement;
  tabCourses: HTMLButtonElement;
  regions: HTMLElement;
  direction: HTMLElement;
  directionTitle: HTMLElement;
  directionNote: HTMLElement;
  directionChips: HTMLElement;
  othersToggle: HTMLButtonElement;
  gridFrame: HTMLElement;
  gridNotes: HTMLElement;
  gridStatus: HTMLElement;
  prepublishNote: HTMLElement;
  examFrame: HTMLElement;
  examList: HTMLElement;
  examStatus: HTMLElement;
  examWindow: HTMLElement;
  courseRows: HTMLElement;
  gapLine: HTMLElement;
  gapText: HTMLElement;
  gapButton: HTMLButtonElement;
  addBlock: HTMLElement;
  addField: HTMLElement;
  addInput: HTMLInputElement;
  addListbox: HTMLUListElement;
  scopePlan: HTMLButtonElement;
  scopeAll: HTMLButtonElement;
  scopeNote: HTMLElement;
  provenance: HTMLElement;
}

function getElements(): PlannerElements | null {
  const byId = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;

  const found = {
    contextLine: byId<HTMLElement>("planner-context-line"),
    contextChange: byId<HTMLButtonElement>("planner-context-change"),
    toggleHost: byId<HTMLElement>("planner-semester-toggle"),
    creditLine: byId<HTMLElement>("planner-credit-line"),
    picker: byId<HTMLElement>("planner-picker"),
    pickerField: byId<HTMLElement>("planner-picker-field"),
    pickerInput: byId<HTMLInputElement>("planner-picker-input"),
    pickerListbox: byId<HTMLUListElement>("planner-picker-listbox"),
    pickerKull: byId<HTMLElement>("planner-picker-kull"),
    pickerKullChips: byId<HTMLElement>("planner-picker-kull-chips"),
    pickerStatus: byId<HTMLElement>("planner-picker-status"),
    emptyState: byId<HTMLElement>("planner-empty-state"),
    main: byId<HTMLElement>("planner-main"),
    tabWeek: byId<HTMLButtonElement>("planner-tab-week"),
    tabCourses: byId<HTMLButtonElement>("planner-tab-courses"),
    regions: byId<HTMLElement>("planner-regions"),
    direction: byId<HTMLElement>("planner-direction"),
    directionTitle: byId<HTMLElement>("planner-direction-title"),
    directionNote: byId<HTMLElement>("planner-direction-note"),
    directionChips: byId<HTMLElement>("planner-direction-chips"),
    othersToggle: byId<HTMLButtonElement>("planner-others-toggle"),
    gridFrame: byId<HTMLElement>("planner-grid-frame"),
    gridNotes: byId<HTMLElement>("planner-grid-notes"),
    gridStatus: byId<HTMLElement>("planner-grid-status"),
    prepublishNote: byId<HTMLElement>("planner-prepublish-note"),
    examFrame: byId<HTMLElement>("planner-exam-frame"),
    examList: byId<HTMLElement>("planner-exam-list-host"),
    examStatus: byId<HTMLElement>("planner-exam-status"),
    examWindow: byId<HTMLElement>("planner-exam-window"),
    courseRows: byId<HTMLElement>("planner-course-rows"),
    gapLine: byId<HTMLElement>("planner-gap-line"),
    gapText: byId<HTMLElement>("planner-gap-text"),
    gapButton: byId<HTMLButtonElement>("planner-gap-btn"),
    addBlock: byId<HTMLElement>("planner-add-block"),
    addField: byId<HTMLElement>("planner-add-field"),
    addInput: byId<HTMLInputElement>("planner-add-input"),
    addListbox: byId<HTMLUListElement>("planner-add-listbox"),
    scopePlan: byId<HTMLButtonElement>("planner-scope-plan"),
    scopeAll: byId<HTMLButtonElement>("planner-scope-all"),
    scopeNote: byId<HTMLElement>("planner-scope-note"),
    provenance: byId<HTMLElement>("planner-provenance"),
  };

  for (const value of Object.values(found)) {
    if (!value) return null;
  }
  return found as PlannerElements;
}

/** Current + next two non-summer semesters, ordered chronologically. */
function candidateSemesters(file: SemestersFile): SemesterSummary[] {
  const teaching = file.semesters.filter((s) => s.id.endsWith("h") || s.id.endsWith("v"));
  teaching.sort((a, b) => (a.fromDate ?? "").localeCompare(b.fromDate ?? ""));
  const currentIndex = file.current
    ? teaching.findIndex((s) => s.id === file.current?.id)
    : teaching.findIndex((s) => (s.fromDate ?? "") >= new Date().toISOString().slice(0, 10));
  const start = currentIndex >= 0 ? currentIndex : 0;
  return teaching.slice(start, start + 3);
}

/** "publiseres vanligvis i <måned>" — desember for vår, august for høst. */
function publishMonthFor(semesterId: string): string {
  return /v$/i.test(semesterId.trim()) ? "desember" : "august";
}

function semesterLabel(semester: SemesterSummary | undefined): string {
  if (!semester) return "";
  const season = /h$/i.test(semester.id) ? "Høst" : "Vår";
  const year = semesterYear(semester.id);
  return year !== null ? `${season} ${year}` : semester.name;
}

/**
 * Obligatory courses of a classified period, shaped as `AddCourseInput`s for
 * `setProgramPlan` — with the DR-5/DR-7 bug-signal guard: a >30 sp obligatory
 * prefill would hand the student a confidently wrong "reality", so it falls
 * back to no prefill at all rather than truncating.
 */
function obligatoryToAdd(classified: PeriodCourses | null): AddCourseInput[] {
  let obligatory = classified?.obligatory ?? [];
  if (isSuspiciousPrefill(obligatory)) obligatory = [];
  return obligatory.map((c) => ({
    code: c.code,
    name: c.name,
    version: c.version,
    source: "program" as const,
  }));
}

/** "22. jul 2026" style date for the provenance line, from an ISO timestamp. */
function formatCrawledAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const MONTHS = [
    "jan",
    "feb",
    "mar",
    "apr",
    "mai",
    "jun",
    "jul",
    "aug",
    "sep",
    "okt",
    "nov",
    "des",
  ];
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Formats a credit figure on its own ("7,5"), for the gap sentence. */
function formatCreditNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}

/**
 * Mounts the planner page. `semestersFile` is `data/semesters.json`,
 * `programOptions` is the trimmed `[code, name]` catalog from
 * `data/programs.json` (both build-time crawler artifacts imported by the
 * caller, not fetched at runtime — see SPEC.md's crawled-data contracts).
 *
 * Called once per `astro:page-load` (see the page's `onPage` wrapper), so it
 * runs again after every client-side navigation back to `/planlegger/`.
 * `signal` aborts just before the next swap: element listeners die with the
 * DOM, but the plan-store subscription lives on `window` and would otherwise
 * accumulate one stale re-render per visit.
 */
export async function mountPlannerApp(
  semestersFile: SemestersFile,
  programOptions: ProgramOption[],
  signal?: AbortSignal,
): Promise<void> {
  const found = getElements();
  if (!found) return;
  const elements = found;

  const defaultSemesterId = semestersFile.current?.id ?? "26h";
  const store: PlanStore = createPlanStore(defaultSemesterId);

  // Hash wins over storage on load (frozen v2 grammar, PRODUCT.md §7) — but
  // only a hash that actually carries a plan. Every load ends by writing the
  // *current* plan back into the hash (syncHash below), so on a later visit
  // a trivially-empty hash (`#v2;26h;-;`, no program, no courses) is
  // indistinguishable from "no hash was ever set" and must defer to
  // localStorage instead of silently wiping it.
  const hashPlan = parsePlanHash(location.hash);
  const hashHasPlan =
    hashPlan !== null && (hashPlan.program !== null || hashPlan.courses.length > 0);
  let plan: PlanState = store.loadPlan();
  if (hashPlan && hashHasPlan) {
    let program: PlanProgram | undefined;
    if (hashPlan.program) {
      // Names (programme and studieretning alike) aren't in the hash — the
      // code stands in until loadPeriodCourses backfills them from the plan.
      program = {
        code: hashPlan.program.code,
        name: hashPlan.program.code,
        cohort: hashPlan.program.cohort,
      };
      if (hashPlan.program.direction) {
        program.direction = {
          code: hashPlan.program.direction,
          name: hashPlan.program.direction,
        };
      }
    }
    plan = {
      v: 1,
      semesterId: hashPlan.semesterId,
      courses: hashPlan.courses.map((c) => ({
        code: c.code,
        name: c.code,
        version: c.version,
        source: c.source,
        ...(c.dropped ? { dropped: true } : {}),
      })),
      ...(program ? { program } : {}),
    };
    store.savePlan(plan);
  }

  const semesters = candidateSemesters(semestersFile);
  let plannerIndex: PlannerIndex | null = null;
  let indexByCode = new Map<string, PlannerIndexCourse>();
  let showOthers = false;
  let periodCourses: PeriodCourses | null = null;
  let studyPlanFetchToken = 0;

  function currentSemester(): SemesterSummary | undefined {
    return semesters.find((s) => s.id === plan.semesterId) ?? semestersFile.current ?? undefined;
  }

  function syncHash(): void {
    history.replaceState(null, "", formatPlanHash(plan));
  }

  /** A bundle's timetable, narrowed to this programme's sections and this semester's weeks. */
  function semesterEntries(bundle: CourseBundle | null): TimetableEntry[] {
    const semester = currentSemester();
    if (!bundle?.timetable || !semester) return [];
    return entriesInSemester(
      entriesForProgram(bundle.timetable, plan.program?.code),
      semester.teachingWeeks,
    );
  }

  // --- Semester toggle + banner ------------------------------------------

  function renderSemesterToggle(): void {
    elements.toggleHost.replaceChildren();
    for (const semester of semesters) {
      const chip = el("button", "np-toggle", semester.name.toUpperCase());
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(semester.id === plan.semesterId));
      chip.addEventListener("click", () => {
        if (semester.id === plan.semesterId) return;
        store.setSemester(semester.id);
      });
      elements.toggleHost.append(chip);
    }
  }

  /**
   * The banner: programme · kull · studieretning · semester. The
   * studieretning is here because it is the *answer* the student gave to the
   * one question the study plan forced — if it isn't visible and re-openable,
   * a wrong pick can never be corrected.
   */
  function renderContextLine(): void {
    elements.contextLine.replaceChildren();
    const program = plan.program;
    if (program) {
      elements.contextLine.append(
        document.createTextNode(`${program.code} · kull ${program.cohort} · `),
      );
      if (program.direction) {
        elements.contextLine.append(
          el("span", "planner-context-direction", program.direction.name),
        );
        elements.contextLine.append(document.createTextNode(" · "));
      }
    }
    elements.contextLine.append(document.createTextNode(semesterLabel(currentSemester())));
  }

  function totalCredits(): number {
    let sum = 0;
    for (const state of orderedActiveStates()) {
      sum += state.bundle?.details?.credits ?? 0;
    }
    return sum;
  }

  function unpricedActiveCount(): number {
    return orderedActiveStates().filter((s) => (s.bundle?.details?.credits ?? null) === null)
      .length;
  }

  function renderCreditLine(): void {
    const total = totalCredits();
    const unpriced = unpricedActiveCount();
    let text = formatCredits(total);
    if (unpriced > 0) {
      text += ` (+${unpriced} ${unpriced === 1 ? "emne" : "emner"} uten oppgitt sp)`;
    }
    elements.creditLine.textContent = text;
    elements.creditLine.classList.toggle("is-full", total >= FULL_LOAD_CREDITS);
  }

  /**
   * The gap sentence under the course list, and the door into the picker.
   * Deliberately phrased as remaining credits, never "velg 2 av 5": the study
   * plan carries no cardinality (DR-5), but the credit arithmetic is real.
   */
  function renderGapLine(): void {
    const total = totalCredits();
    const gap = FULL_LOAD_CREDITS - total;
    const anyLoading = orderedActiveStates().some((s) => s.loading);
    // An *empty* plan still gets the gap sentence as long as a programme is
    // set — that is exactly the 3rd-year bachelor whose period prefills
    // nothing at all (BIT period 5: zero `O` courses, eight electives). For
    // them "Mangler 30 sp · velg fra studieplanen (8)" is the whole flow.
    const hasContext = plan.program !== undefined || plan.courses.length > 0;
    if (gap <= 0 || anyLoading || !hasContext) {
      elements.gapLine.hidden = true;
      return;
    }
    elements.gapLine.hidden = false;
    elements.gapText.textContent = `Mangler ${formatCreditNumber(gap)} sp`;
    const pool = availablePool();
    elements.gapButton.textContent =
      pool.length > 0 ? `Velg fra studieplanen (${pool.length})` : "Legg til emne";
  }

  // --- Region tabs (narrow screens only) ---------------------------------

  let activeRegion: "week" | "courses" = "week";

  function renderRegions(): void {
    elements.regions.dataset.region = activeRegion;
    elements.tabWeek.setAttribute("aria-pressed", String(activeRegion === "week"));
    elements.tabCourses.setAttribute("aria-pressed", String(activeRegion === "courses"));
    const count = activeCourses(plan).length;
    elements.tabCourses.textContent = count > 0 ? `Emner (${count})` : "Emner";
  }

  function setRegion(region: "week" | "courses"): void {
    activeRegion = region;
    renderRegions();
  }

  elements.tabWeek.addEventListener("click", () => setRegion("week"));
  elements.tabCourses.addEventListener("click", () => setRegion("courses"));

  // --- Programme + kull picker -------------------------------------------

  let pickerActiveIndex = -1;
  let pickerMatches: ProgramOption[] = [];

  function closePicker(): void {
    elements.pickerListbox.replaceChildren();
    elements.pickerListbox.hidden = true;
    pickerActiveIndex = -1;
    pickerMatches = [];
    elements.pickerInput.setAttribute("aria-expanded", "false");
  }

  function setPickerActive(index: number): void {
    pickerActiveIndex = index;
    for (const [i, opt] of [...elements.pickerListbox.children].entries()) {
      opt.classList.toggle("is-active", i === index);
    }
  }

  async function pickProgram(option: ProgramOption): Promise<void> {
    const [code, name] = option;
    elements.pickerInput.value = "";
    closePicker();
    elements.pickerKull.hidden = true;
    elements.pickerKullChips.replaceChildren();
    elements.pickerStatus.textContent = "henter studieplan …";

    const currentYear = semesterYear(plan.semesterId) ?? new Date().getFullYear();
    const result = await findProgramPlan(code, currentYear);
    if ("kind" in result) {
      elements.pickerStatus.textContent =
        result.kind === "not-found"
          ? "ingen studieplan funnet for dette programmet"
          : "klarte ikke å hente studieplan";
      return;
    }

    elements.pickerStatus.textContent = "";
    const years = [...result.plan.publishedYears].sort((a, b) => b - a);
    if (years.length === 0) {
      elements.pickerStatus.textContent = "ingen kull publisert for dette programmet ennå";
      return;
    }
    elements.pickerKull.hidden = false;
    elements.pickerKullChips.replaceChildren();
    for (const year of years) {
      const chip = el("button", "np-toggle", String(year));
      chip.type = "button";
      chip.setAttribute("aria-label", `Kull ${year}`);
      chip.addEventListener("click", () => {
        void applyProgramCohort(code, name, year);
      });
      elements.pickerKullChips.append(chip);
    }
  }

  async function applyProgramCohort(code: string, name: string, cohort: number): Promise<void> {
    elements.pickerStatus.textContent = "henter studieplan …";
    const result = await findProgramPlan(code, cohort);
    if ("kind" in result) {
      elements.pickerStatus.textContent = "klarte ikke å hente studieplan";
      return;
    }
    // A fresh programme/kull answers no studieretning question yet — the
    // period classifies without one, prefilling the intersection if gated.
    const program: PlanProgram = { code, name, cohort };
    const periodNumber = periodNumberFor(plan.semesterId, cohort);
    const classified = periodNumber !== null ? classifyPeriod(result.plan, periodNumber) : null;

    store.setProgramPlan(program, obligatoryToAdd(classified));
    elements.picker.hidden = true;
    elements.pickerStatus.textContent = "";
  }

  function renderPickerOptions(): void {
    const query = fold(elements.pickerInput.value.trim());
    if (query === "") {
      closePicker();
      return;
    }
    pickerMatches = programOptions
      .filter(([code, name]) => fold(code).includes(query) || fold(name).includes(query))
      .slice(0, 12);

    elements.pickerListbox.replaceChildren();
    if (pickerMatches.length === 0) {
      elements.pickerListbox.append(el("li", "planner-typeahead-empty np-note", "Ingen treff."));
      elements.pickerListbox.hidden = false;
      pickerActiveIndex = -1;
      elements.pickerInput.setAttribute("aria-expanded", "true");
      return;
    }
    pickerMatches.forEach((option) => {
      const [code, name] = option;
      const item = el("li", "planner-picker-option");
      item.setAttribute("role", "option");
      item.append(el("span", "np-data planner-picker-code", code));
      item.append(el("span", "planner-picker-name", name));
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        void pickProgram(option);
      });
      elements.pickerListbox.append(item);
    });
    elements.pickerListbox.hidden = false;
    elements.pickerInput.setAttribute("aria-expanded", "true");
    setPickerActive(0);
  }

  elements.pickerInput.addEventListener("input", renderPickerOptions);
  elements.pickerInput.addEventListener("keydown", (event) => {
    if (elements.pickerListbox.hidden || pickerMatches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPickerActive((pickerActiveIndex + 1) % pickerMatches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setPickerActive((pickerActiveIndex - 1 + pickerMatches.length) % pickerMatches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = pickerMatches[pickerActiveIndex] ?? pickerMatches[0];
      if (picked) void pickProgram(picked);
    } else if (event.key === "Escape") {
      closePicker();
    }
  });
  elements.pickerField.addEventListener("focusout", (event) => {
    if (!elements.pickerField.contains(event.relatedTarget as Node | null)) closePicker();
  });

  elements.contextChange.addEventListener("click", () => {
    elements.picker.hidden = !elements.picker.hidden;
    if (!elements.picker.hidden) elements.pickerInput.focus();
  });

  // --- Studieretning question --------------------------------------------

  /**
   * Applies a chosen studieretning: re-classifies the period *through* that
   * direction and replaces the programme course set in one store write (so
   * the grid never flashes an intermediate state). Manual adds and existing
   * drop flags survive — see `setProgramPlan`.
   */
  async function applyDirection(option: DirectionOption): Promise<void> {
    const program = plan.program;
    if (!program) return;
    elements.directionNote.textContent = "henter studieplan …";
    const result = await findProgramPlan(program.code, program.cohort);
    if ("kind" in result) {
      elements.directionNote.textContent = "klarte ikke å hente studieplan";
      return;
    }
    const periodNumber = periodNumberFor(plan.semesterId, program.cohort);
    const classified =
      periodNumber !== null ? classifyPeriod(result.plan, periodNumber, option.code) : null;
    store.setProgramPlan({ ...program, direction: option }, obligatoryToAdd(classified));
  }

  function renderDirectionQuestion(): void {
    const pending = periodCourses?.pendingChoice ?? null;
    if (!pending || pending.directions.length === 0) {
      elements.direction.hidden = true;
      return;
    }
    elements.direction.hidden = false;
    elements.directionTitle.textContent = pending.name;
    elements.directionNote.textContent = pending.deadlineDate
      ? `Studieplanen viser frist ${formatShortDate(pending.deadlineDate)}. Velg den du følger — ukeplanen fylles ut med en gang.`
      : "Velg den du følger — ukeplanen fylles ut med en gang.";

    elements.directionChips.replaceChildren();
    for (const option of pending.directions) {
      const chip = el("button", "np-toggle", option.name);
      chip.type = "button";
      chip.addEventListener("click", () => {
        void applyDirection(option);
      });
      elements.directionChips.append(chip);
    }
  }

  // --- Add field: the scoped course picker --------------------------------

  let pickerScope: PickerScope = "plan";
  let scopeChosenByUser = false;
  let addOpen = false;
  let addActiveIndex = -1;
  let addRows: PickerRow[] = [];

  /** Candidate bundles fetched purely to preview a clash before adding. */
  const previewBundles = new Map<string, CourseBundle>();
  const previewPending = new Set<string>();

  /** The study plan's choice pool for this period, minus what's already in the plan. */
  function availablePool(): PickerRow[] {
    const inPlan = new Set(plan.courses.map((c) => c.code));
    return (periodCourses?.choice ?? [])
      .filter((c) => !inPlan.has(c.code))
      .map((c) => ({
        code: c.code,
        name: c.name,
        version: c.version,
        credits: c.credits,
        groupName: c.groupName,
      }));
  }

  function poolIsUncurated(): boolean {
    return availablePool().length > UNCURATED_POOL_SIZE;
  }

  /** Scope falls back to "Alle emner" whenever the study plan offers nothing usable. */
  function effectiveScope(): PickerScope {
    if (scopeChosenByUser) return pickerScope;
    if (availablePool().length === 0 || poolIsUncurated()) return "all";
    return "plan";
  }

  function openAdd(scope?: PickerScope): void {
    if (scope) {
      pickerScope = scope;
      scopeChosenByUser = true;
    }
    addOpen = true;
    renderAddOptions();
  }

  function closeAddListbox(): void {
    addOpen = false;
    elements.addListbox.replaceChildren();
    elements.addListbox.hidden = true;
    addActiveIndex = -1;
    addRows = [];
    elements.addInput.setAttribute("aria-expanded", "false");
  }

  function setAddActive(index: number): void {
    addActiveIndex = index;
    const options = [...elements.addListbox.querySelectorAll(".planner-typeahead-option")];
    for (const [i, opt] of options.entries()) {
      opt.classList.toggle("is-active", i === index);
    }
  }

  function addRow(row: PickerRow): void {
    store.addCourse({
      code: row.code,
      name: row.name,
      version: row.version,
      source: "manual",
    });
    elements.addInput.value = "";
    closeAddListbox();
  }

  /** Kicks off a candidate's bundle fetch so its clash verdict can fill in. */
  function ensurePreview(row: PickerRow): void {
    if (previewBundles.has(row.code) || previewPending.has(row.code)) return;
    const year = semesterYear(plan.semesterId);
    if (year === null) return;
    previewPending.add(row.code);
    void fetchCourseBundle(row.code, year, row.version).then((bundle) => {
      previewPending.delete(row.code);
      previewBundles.set(row.code, bundle);
      // Only the facts line changes; re-render if the list is still open.
      if (addOpen) renderAddOptions();
    });
  }

  /** Exam dates already committed in the plan, for the same-day check. */
  function plannedExamDates(): Set<string> {
    const dates = new Set<string>();
    for (const state of orderedActiveStates()) {
      const row = indexByCode.get(state.course.code);
      if (!row) continue;
      for (const exam of examsFromIndex(row, plan.semesterId)) {
        if (exam.date) dates.add(exam.date);
      }
    }
    return dates;
  }

  /**
   * The facts a decision actually turns on, for one candidate row: does it
   * clash with what's already committed, and when is its exam. The clash
   * verdict is lecture-only (DR-1) and appears once the candidate's timetable
   * has loaded; the exam date is free (it's already in the search index).
   */
  function candidateFacts(row: PickerRow, examDates: Set<string>): HTMLElement | null {
    const facts = el("span", "planner-typeahead-facts");
    let any = false;

    const bundle = previewBundles.get(row.code);
    if (bundle) {
      const candidate = semesterEntries(bundle);
      const mine = orderedActiveStates().flatMap((s) => semesterEntries(s.bundle));
      const conflicts = findConflicts(lecturesOnly([...mine, ...candidate]));
      const others = [
        ...new Set(
          conflicts
            .filter((c) => c.a.courseCode === row.code || c.b.courseCode === row.code)
            .map((c) => (c.a.courseCode === row.code ? c.b.courseCode : c.a.courseCode)),
        ),
      ];
      if (others.length > 0) {
        facts.append(el("span", "is-clash", `kolliderer med ${others.join(", ")}`));
      } else if (candidate.length === 0) {
        facts.append(el("span", undefined, "ingen timeplan i dette semesteret"));
      } else {
        facts.append(el("span", undefined, "ingen kollisjon"));
      }
      any = true;
    }

    const indexRow = indexByCode.get(row.code);
    if (indexRow) {
      const exam = examsFromIndex(indexRow, plan.semesterId).find((e) => e.date);
      if (exam?.date) {
        const sameDay = examDates.has(exam.date);
        facts.append(
          el(
            "span",
            sameDay ? "is-clash" : undefined,
            sameDay
              ? `eksamen ${formatShortDate(exam.date)} — samme dag som en annen`
              : `eksamen ${formatShortDate(exam.date)}`,
          ),
        );
        any = true;
      }
    }

    return any ? facts : null;
  }

  function renderScopeControls(): void {
    const scope = effectiveScope();
    const pool = availablePool();
    elements.scopePlan.setAttribute("aria-pressed", String(scope === "plan"));
    elements.scopeAll.setAttribute("aria-pressed", String(scope === "all"));
    elements.scopePlan.textContent =
      pool.length > 0 ? `Fra studieplanen (${pool.length})` : "Fra studieplanen";
    elements.scopePlan.disabled = pool.length === 0;

    if (poolIsUncurated()) {
      elements.scopeNote.hidden = false;
      elements.scopeNote.textContent = `Studieplanen åpner for ${pool.length} emner dette semesteret — det er i praksis hele katalogen, så søk heller i alle emner.`;
    } else {
      elements.scopeNote.hidden = true;
      elements.scopeNote.textContent = "";
    }
  }

  function renderAddOptions(): void {
    renderScopeControls();
    if (!addOpen) {
      elements.addListbox.replaceChildren();
      elements.addListbox.hidden = true;
      elements.addInput.setAttribute("aria-expanded", "false");
      return;
    }

    const query = fold(elements.addInput.value.trim());
    const scope = effectiveScope();
    const inPlan = new Set(plan.courses.map((c) => c.code));

    let matched: PickerRow[];
    if (scope === "plan") {
      matched = availablePool().filter(
        (row) => query === "" || fold(row.code).includes(query) || fold(row.name).includes(query),
      );
    } else if (query === "") {
      matched = [];
    } else {
      matched = (plannerIndex?.courses ?? [])
        .filter(
          ([code, name]) =>
            !inPlan.has(code) && (fold(code).includes(query) || fold(name).includes(query)),
        )
        .map(([code, name]) => ({ code, name, version: "1", credits: null, groupName: null }));
    }

    const total = matched.length;
    const shown = matched.slice(0, MAX_PICKER_ROWS);
    addRows = shown;

    const previousActive = addActiveIndex;
    elements.addListbox.replaceChildren();

    if (shown.length === 0) {
      const message =
        scope === "all" && query === ""
          ? "Skriv for å søke i alle emner ved NTNU."
          : "Ingen treff.";
      elements.addListbox.append(el("li", "planner-typeahead-empty np-note", message));
      elements.addListbox.hidden = false;
      addActiveIndex = -1;
      elements.addInput.setAttribute("aria-expanded", "true");
      return;
    }

    const examDates = plannedExamDates();
    let lastGroup: string | null | undefined;
    for (const row of shown) {
      // Group headers quote the study plan verbatim — that free text is the
      // only place a "velg 2 av 5" rule is ever written down (DR-5).
      if (scope === "plan" && row.groupName !== lastGroup) {
        lastGroup = row.groupName;
        if (row.groupName) {
          const header = el("li", "np-kicker planner-pool-group", row.groupName);
          header.setAttribute("role", "presentation");
          elements.addListbox.append(header);
        }
      }

      ensurePreview(row);

      const item = el("li", "planner-typeahead-option");
      item.setAttribute("role", "option");
      const head = el("span", "planner-typeahead-head");
      head.append(el("span", "np-data planner-typeahead-code", row.code));
      head.append(el("span", "planner-typeahead-name", row.name));
      item.append(head);
      if (row.credits != null) {
        item.append(el("span", "np-data planner-typeahead-credits", `${row.credits} sp`));
      }
      const facts = candidateFacts(row, examDates);
      if (facts) item.append(facts);

      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        addRow(row);
      });
      elements.addListbox.append(item);
    }

    if (total > shown.length) {
      elements.addListbox.append(
        el(
          "li",
          "planner-typeahead-empty np-note",
          `… og ${total - shown.length} til — skriv for å filtrere.`,
        ),
      );
    }

    elements.addListbox.hidden = false;
    elements.addInput.setAttribute("aria-expanded", "true");
    setAddActive(previousActive >= 0 && previousActive < shown.length ? previousActive : 0);
  }

  elements.addInput.addEventListener("focus", () => {
    addOpen = true;
    renderAddOptions();
  });
  elements.addInput.addEventListener("input", () => {
    addOpen = true;
    addActiveIndex = -1;
    renderAddOptions();
  });
  elements.addInput.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAddListbox();
      return;
    }
    if (!addOpen || addRows.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAddActive((addActiveIndex + 1) % addRows.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAddActive((addActiveIndex - 1 + addRows.length) % addRows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = addRows[addActiveIndex] ?? addRows[0];
      if (picked) addRow(picked);
    }
  });
  elements.addField.addEventListener("submit", (event) => event.preventDefault());
  // The whole block (field + scope toggle + listbox) is one focus scope, so
  // clicking "Alle emner" or scrolling the list doesn't dismiss the picker.
  elements.addBlock.addEventListener("focusout", (event) => {
    if (!elements.addBlock.contains(event.relatedTarget as Node | null)) closeAddListbox();
  });

  elements.scopePlan.addEventListener("click", () => {
    pickerScope = "plan";
    scopeChosenByUser = true;
    openAdd();
    elements.addInput.focus();
  });
  elements.scopeAll.addEventListener("click", () => {
    pickerScope = "all";
    scopeChosenByUser = true;
    openAdd();
    elements.addInput.focus();
  });

  elements.gapButton.addEventListener("click", () => {
    openAdd(availablePool().length > 0 ? "plan" : "all");
    setRegion("courses");
    elements.addInput.focus();
  });

  // --- Course bundle state (timetable + details per active course) -------

  const courseStates = new Map<string, PlanCourseState>();

  function syncCourseStates(): void {
    const seen = new Set<string>();
    const active = activeCourses(plan);
    active.forEach((course, index) => {
      seen.add(course.code);
      const existing = courseStates.get(course.code);
      if (existing) {
        existing.hueVar = hueForIndex(index);
        existing.course = course;
      } else {
        courseStates.set(course.code, {
          course,
          hueVar: hueForIndex(index),
          // A course previewed in the picker is already fetched — reuse it so
          // adding it renders the grid without a second round trip.
          bundle: previewBundles.get(course.code) ?? null,
          loading: false,
        });
      }
    });
    for (const code of [...courseStates.keys()]) {
      if (!seen.has(code)) courseStates.delete(code);
    }
  }

  function orderedActiveStates(): PlanCourseState[] {
    return activeCourses(plan)
      .map((c) => courseStates.get(c.code))
      .filter((s): s is PlanCourseState => !!s);
  }

  // --- Render: EMNER course rows ------------------------------------------

  /**
   * The plan itself, and nothing else: courses being taken, plus programme
   * courses the student dropped (grayed, one tap back — §0.3). The study
   * plan's choice pool deliberately does *not* live here; at 30–60 rows it
   * would bury the six courses this list exists to show.
   */
  function renderCourseRows(): void {
    elements.courseRows.replaceChildren();
    if (plan.courses.length === 0) {
      elements.courseRows.append(el("p", "np-note", "Ingen emner i planen ennå."));
      return;
    }

    const ordered = [...plan.courses].sort((a, b) => {
      if (a.source !== b.source) return a.source === "program" ? -1 : 1;
      return 0;
    });

    for (const course of ordered) {
      const state = courseStates.get(course.code);
      const isDropped = course.source === "program" && course.dropped === true;
      const row = el("div", `planner-course-row${isDropped ? " is-dropped" : ""}`);

      const head = el("span", "planner-course-row-head");
      if (state && !isDropped) {
        const dotEl = el("span", "np-dot");
        dotEl.style.setProperty("--dot", `var(${state.hueVar})`);
        head.append(dotEl);
      }
      head.append(el("span", "np-data", course.code));
      row.append(head);

      const details = state?.bundle?.details;
      row.append(el("span", "planner-course-row-name", details?.courseName ?? course.name));

      const action = el(
        "button",
        "np-btn planner-course-remove",
        isDropped ? "Legg tilbake" : "Fjern",
      );
      action.type = "button";
      if (course.source === "program") {
        action.addEventListener("click", () =>
          isDropped ? store.restoreCourse(course.code) : store.dropCourse(course.code),
        );
      } else {
        action.addEventListener("click", () => store.removeCourse(course.code));
      }
      row.append(action);

      const meta = el("span", "planner-course-row-meta");
      if (isDropped) {
        meta.append(el("span", undefined, "fjernet — fortsatt en del av programmet"));
      } else {
        if (details?.credits != null) meta.append(el("span", "np-data", `${details.credits} sp`));
        meta.append(
          el("span", undefined, course.source === "program" ? "fra programmet" : "lagt til selv"),
        );
        if (details?.assessmentScheme) {
          meta.append(el("span", undefined, details.assessmentScheme));
        }
        if (state?.bundle) {
          const timetable = entriesForProgram(state.bundle.timetable ?? [], plan.program?.code);
          if (timetable.length > 0 && semesterEntries(state.bundle).length === 0) {
            meta.append(el("span", undefined, "undervises ikke i valgt semester"));
          }
        }
        for (const error of state?.bundle?.errors ?? []) {
          meta.append(el("span", undefined, `fikk ikke hentet ${error}`));
        }
      }
      row.append(meta);

      elements.courseRows.append(row);
    }
  }

  // --- Render: grid + exams + pre-publish fallback ------------------------

  function renderGridAndExams(): void {
    const semester = currentSemester();
    const states = orderedActiveStates();
    const anyLoading = states.some((s) => s.loading);

    elements.gridStatus.textContent = anyLoading ? "henter timeplan …" : "";
    elements.examStatus.textContent = anyLoading ? "henter eksamensdatoer …" : "";

    const filteredStates: PlanCourseState[] = states.map((s) => {
      if (!s.bundle?.timetable) return s;
      return { ...s, bundle: { ...s.bundle, timetable: semesterEntries(s.bundle) } };
    });

    // Pre-publish fallback (DR-2): timetable not published, or every loaded
    // bundle came back with zero entries — never a blank grid, always the
    // course list + exams + a graceful note naming when to come back.
    const published = semester?.timetablePublished ?? true;
    const anyBundlesLoaded = states.some((s) => s.bundle !== null);
    const allEmpty =
      anyBundlesLoaded && filteredStates.every((s) => (s.bundle?.timetable ?? []).length === 0);
    const showFallback = states.length > 0 && !anyLoading && (!published || allEmpty);

    if (showFallback && semester) {
      elements.gridFrame.replaceChildren();
      elements.gridNotes.replaceChildren();
      elements.prepublishNote.hidden = false;
      elements.prepublishNote.textContent = `Timeplan for ${semesterLabel(semester)} publiseres vanligvis i ${publishMonthFor(semester.id)} — kom tilbake da.`;
    } else {
      elements.prepublishNote.hidden = true;
      renderGrid(elements.gridFrame, elements.gridNotes, filteredStates, showOthers);
    }

    const examResult = renderExamRibbon(
      elements.examFrame,
      elements.examList,
      states,
      plan.semesterId,
      plannerIndex,
    );
    elements.examWindow.textContent = examResult.windowLabel ?? "";
  }

  // --- Provenance line -----------------------------------------------------

  function renderProvenance(): void {
    elements.provenance.textContent = `Data hentet ${formatCrawledAt(semestersFile.crawledAt)} fra NTNU · uoffisiell`;
  }

  // --- Top-level render orchestration --------------------------------------

  function renderAll(): void {
    syncCourseStates();
    // A programme+kull earns the full page shell even with zero prefilled
    // courses: the studieretning question and the choice pool are exactly
    // what that student came for.
    const hasContent = plan.courses.length > 0 || plan.program !== undefined;
    elements.emptyState.hidden = hasContent;
    elements.main.hidden = !hasContent;
    renderContextLine();
    renderRegions();
    renderCreditLine();
    renderDirectionQuestion();
    renderCourseRows();
    renderGapLine();
    renderAddOptions();
    renderGridAndExams();
    renderProvenance();
  }

  async function loadBundles(): Promise<void> {
    const year = semesterYear(plan.semesterId);
    if (year === null) return;

    const toLoad = orderedActiveStates().filter((s) => s.bundle === null && !s.loading);
    if (toLoad.length === 0) return;

    for (const state of toLoad) state.loading = true;
    renderGridAndExams();

    await Promise.all(
      toLoad.map(async (state) => {
        const bundle = await fetchCourseBundle(state.course.code, year, state.course.version);
        const current = courseStates.get(state.course.code);
        if (!current) return; // removed/dropped while loading
        current.bundle = bundle;
        current.loading = false;
      }),
    );

    renderCreditLine();
    renderCourseRows();
    renderGapLine();
    renderGridAndExams();
  }

  /**
   * (Re)fetches the study plan for `plan.program` and rebuilds `periodCourses`
   * (DR-5/DR-7), classifying through the chosen studieretning when there is
   * one. Also backfills display names the hash couldn't carry, and self-heals
   * a `program`-tagged plan with zero `source: "program"` courses (e.g. a
   * hash-seeded link naming a programme+kull but no course list) — "programme
   * → kull → your week, instantly" must hold however the programme got set.
   */
  async function loadPeriodCourses(): Promise<void> {
    const program = plan.program;
    if (!program) {
      periodCourses = null;
      renderDirectionQuestion();
      renderAddOptions();
      renderGapLine();
      return;
    }
    const token = ++studyPlanFetchToken;
    const result = await findProgramPlan(program.code, program.cohort);
    if (token !== studyPlanFetchToken) return; // superseded by a newer programme/kull pick
    if ("kind" in result) {
      periodCourses = null;
      renderDirectionQuestion();
      renderAddOptions();
      renderGapLine();
      return;
    }
    const periodNumber = periodNumberFor(plan.semesterId, program.cohort);
    const classified =
      periodNumber !== null
        ? classifyPeriod(result.plan, periodNumber, program.direction?.code)
        : null;
    periodCourses = classified;

    // Backfill names a hash could not carry (programme, studieretning).
    const planName = result.plan.name;
    const applied = classified?.appliedDirection;
    const needsProgramName = planName !== null && program.name === program.code;
    const needsDirectionName =
      applied !== undefined &&
      applied !== null &&
      program.direction !== undefined &&
      program.direction.name === program.direction.code;
    if (needsProgramName || needsDirectionName) {
      const nextProgram: PlanProgram = {
        ...program,
        ...(needsProgramName && planName ? { name: planName } : {}),
        ...(needsDirectionName && applied ? { direction: applied } : {}),
      };
      store.savePlan({ ...plan, program: nextProgram });
      return; // the change listener re-enters with the corrected plan
    }

    const hasProgramCourses = plan.courses.some((c) => c.source === "program");
    if (!hasProgramCourses && classified) {
      const toAdd = obligatoryToAdd(classified);
      if (toAdd.length > 0) {
        store.setProgramPlan(program, toAdd); // triggers onPlanChange -> re-render
        return;
      }
    }
    renderDirectionQuestion();
    renderAddOptions();
    renderGapLine();
  }

  elements.othersToggle.addEventListener("click", () => {
    showOthers = !showOthers;
    elements.othersToggle.setAttribute("aria-pressed", String(showOthers));
    renderGridAndExams();
  });

  const unsubscribe = store.onPlanChange((next) => {
    plan = next;
    syncHash();
    renderSemesterToggle();
    renderAll();
    void loadBundles();
    void loadPeriodCourses();
  });
  signal?.addEventListener("abort", unsubscribe);

  loadPlannerIndex()
    .then((index) => {
      plannerIndex = index;
      indexByCode = new Map(index.courses.map((c) => [c[0], c]));
      // Backfill real course names for any hash-sourced courses that only had their code.
      let changed = false;
      const nextCourses: PlanCourse[] = plan.courses.map((c) => {
        if (c.name !== c.code) return c;
        const found = indexByCode.get(c.code);
        if (!found) return c;
        changed = true;
        return { ...c, name: found[1] };
      });
      if (changed) store.savePlan({ ...plan, courses: nextCourses });
      renderGridAndExams(); // exam ribbon needed the index to render its catalog data
      renderAddOptions();
    })
    .catch(() => {
      // Typeahead search + exam ribbon will simply show no results; the rest of the page still works.
    });

  // First paint from the initial (hash-or-storage) plan, then kick off fetches.
  syncHash();
  renderSemesterToggle();
  renderAll();
  await Promise.all([loadBundles(), loadPeriodCourses()]);
}
