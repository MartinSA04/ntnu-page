/**
 * `/planlegger/` orchestrator (PRODUCT.md §0 — the mandate). Schedule-first:
 * programme + kull picked once → the weekly schedule for the chosen semester
 * renders immediately, prefilled with the courses the study plan says the
 * student has (NTNU auto-enrolls programme students — DR-7's pre-fill IS the
 * default plan, not a hedged suggestion).
 *
 * The page is **two regions**, not four tabs: *Uke* (grid + exam list —
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
 * Render work is delegated to grid.ts/examList.ts.
 */

import { lecturesOnly } from "../../lib/planner/activity.js";
import { findConflicts } from "../../lib/planner/conflicts.js";
import {
  type CourseBundle,
  type ExamWindow,
  examsFromIndex,
  fetchCourseBundle,
  indexCoversSemester,
  indexForSemester,
  loadPlannerIndex,
  type PlannerIndex,
  type PlannerIndexCourse,
  type TimetableEntry,
} from "../../lib/planner/data.js";
import { defaultLectureKeys, groupOptions } from "../../lib/planner/groups.js";
import { hueForIndex } from "../../lib/planner/hues.js";
import { entriesForProgram, entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
import {
  type AddCourseInput,
  activeCourses,
  createPlanStore,
  DEFAULT_VERSION,
  formatPlanHash,
  type PlanCourse,
  type PlanProgram,
  type PlanState,
  type PlanStore,
  parsePlanHash,
} from "../../lib/planner/store.js";
import { programHref } from "../../lib/programUrl.js";
import { el, fold, formatCreditNumber, formatCredits, formatShortDate } from "./dom.js";
import { type ExamRenderResult, renderExamList, renderExamMessage } from "./examList.js";
import { type BlockDetail, type GridRenderResult, renderGrid, renderGridMessage } from "./grid.js";
import { type BlockPopoverContext, mountBlockPopover } from "./popover.js";
import {
  type DirectionOption,
  findProgramPlan,
  isSuspiciousPrefill,
  type PeriodCourses,
  periodNumberFor,
  prefillCredits,
  resolvePeriodFor,
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

/**
 * The trimmed programme catalog passed in from the page (see index.astro).
 * `studyLevel`/`cities` are what separate two identically-named rows — MIDT
 * and MTDT are both "Datateknologi" and lead to opposite outcomes (B6).
 */
export type ProgramOption = [code: string, name: string, studyLevel: string, cities: string[]];

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

/** The grid's hour rail, in px (`3rem` in the page's `.planner-grid`). Kept in view when scrolling to today. */
const RAIL_WIDTH_PX = 48;

interface PlannerElements {
  title: HTMLElement;
  contextLine: HTMLElement;
  contextChange: HTMLButtonElement;
  linkNote: HTMLElement;
  semesterDisclosure: HTMLDetailsElement;
  toggleHost: HTMLElement;
  creditLine: HTMLElement;
  creditNote: HTMLElement;
  picker: HTMLElement;
  pickerField: HTMLElement;
  pickerInput: HTMLInputElement;
  pickerListbox: HTMLUListElement;
  pickerKull: HTMLElement;
  pickerKullChips: HTMLElement;
  pickerStatus: HTMLElement;
  main: HTMLElement;
  tabWeek: HTMLButtonElement;
  tabCourses: HTMLButtonElement;
  regions: HTMLElement;
  direction: HTMLElement;
  directionTitle: HTMLElement;
  directionNote: HTMLElement;
  directionChips: HTMLElement;
  directionActions: HTMLElement;
  directionButton: HTMLButtonElement;
  othersToggle: HTMLButtonElement;
  scrollHint: HTMLElement;
  gridFrame: HTMLElement;
  gridNotes: HTMLElement;
  gridStatus: HTMLElement;
  examFrame: HTMLElement;
  examList: HTMLElement;
  examStatus: HTMLElement;
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
    title: byId<HTMLElement>("planner-title"),
    contextLine: byId<HTMLElement>("planner-context-line"),
    contextChange: byId<HTMLButtonElement>("planner-context-change"),
    linkNote: byId<HTMLElement>("planner-link-note"),
    semesterDisclosure: byId<HTMLDetailsElement>("planner-semester"),
    toggleHost: byId<HTMLElement>("planner-semester-toggle"),
    creditLine: byId<HTMLElement>("planner-credit-line"),
    creditNote: byId<HTMLElement>("planner-credit-note"),
    picker: byId<HTMLElement>("planner-picker"),
    pickerField: byId<HTMLElement>("planner-picker-field"),
    pickerInput: byId<HTMLInputElement>("planner-picker-input"),
    pickerListbox: byId<HTMLUListElement>("planner-picker-listbox"),
    pickerKull: byId<HTMLElement>("planner-picker-kull"),
    pickerKullChips: byId<HTMLElement>("planner-picker-kull-chips"),
    pickerStatus: byId<HTMLElement>("planner-picker-status"),
    main: byId<HTMLElement>("planner-main"),
    tabWeek: byId<HTMLButtonElement>("planner-tab-week"),
    tabCourses: byId<HTMLButtonElement>("planner-tab-courses"),
    regions: byId<HTMLElement>("planner-regions"),
    direction: byId<HTMLElement>("planner-direction"),
    directionTitle: byId<HTMLElement>("planner-direction-title"),
    directionNote: byId<HTMLElement>("planner-direction-note"),
    directionChips: byId<HTMLElement>("planner-direction-chips"),
    directionActions: byId<HTMLElement>("planner-direction-actions"),
    directionButton: byId<HTMLButtonElement>("planner-direction-btn"),
    othersToggle: byId<HTMLButtonElement>("planner-others-toggle"),
    scrollHint: byId<HTMLElement>("planner-scroll-hint"),
    gridFrame: byId<HTMLElement>("planner-grid-frame"),
    gridNotes: byId<HTMLElement>("planner-grid-notes"),
    gridStatus: byId<HTMLElement>("planner-grid-status"),
    examFrame: byId<HTMLElement>("planner-exam-frame"),
    examList: byId<HTMLElement>("planner-exam-list-host"),
    examStatus: byId<HTMLElement>("planner-exam-status"),
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
 * `setProgramPlan`. `credits` and the plan's own course name travel with them
 * (B9.1): 39 of 1 383 period-1 obligatory references are absent from the
 * catalog, and without the study plan's figure each one silently
 * under-reported the semester's load.
 *
 * A >30 sp prefill is **kept**, not discarded. It is a bug signal, but
 * CMEDFORSK period 1 legitimately sums to 42,5 sp and MJORM to 45 — dropping
 * them produced "0 av 30 sp" with zero rows and no explanation. The caller
 * says so instead (see `suspiciousPrefillCredits`).
 */
function obligatoryToAdd(classified: PeriodCourses | null): AddCourseInput[] {
  return (classified?.obligatory ?? []).map((c) => ({
    code: c.code,
    name: c.name,
    version: c.version,
    credits: c.credits,
    source: "program" as const,
  }));
}

/**
 * Does the plan's programme course set already equal `next`? Guards the B4
 * re-derive against a write (and therefore a render) that changes nothing.
 * Compares credits too, so a plan stored before B9.1 picks them up on the
 * next visit rather than staying priceless forever.
 */
function sameProgramSet(courses: PlanCourse[], next: AddCourseInput[]): boolean {
  const current = courses.filter((c) => c.source === "program");
  if (current.length !== next.length) return false;
  return next.every((candidate, index) => {
    const existing = current[index];
    if (!existing) return false;
    return (
      existing.code === candidate.code &&
      existing.version === (candidate.version ?? DEFAULT_VERSION) &&
      (existing.credits ?? null) === (candidate.credits ?? null)
    );
  });
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
  const semesters = candidateSemesters(semestersFile);

  // TEMPORARY wiring (Task 8): mounts the block popover and hands it a
  // context built from this render's own course states, just enough to
  // browser-verify the component before Task 10 owns the real integration
  // (which also needs to cover the "+N til" overflow chip's joined codes —
  // out of scope here, so a chip click is silently skipped below).
  const popover = mountBlockPopover(store, signal ?? new AbortController().signal);
  function buildPopoverContext(
    detail: BlockDetail,
    states: PlanCourseState[],
  ): BlockPopoverContext | null {
    const state = states.find((s) => s.course.code === detail.code);
    const timetable = state?.bundle?.timetable;
    if (!state || !timetable) return null;
    return {
      detail,
      groups: groupOptions(timetable),
      selected: state.course.groups ?? [],
      defaults: defaultLectureKeys(timetable, state.programCode),
      source: state.course.source,
      dropped: state.course.dropped === true,
    };
  }

  /** One line explaining what we did with a link we could not honour (C4). */
  let linkNote: string | null = null;

  /**
   * Only a semester this build ships plannable data for is allowed into the
   * state. `#v2;25h;…` used to be taken verbatim: `currentSemester()` fell
   * back to 26h for teaching weeks while `loadBundles` fetched 2025, so 2025
   * entries were filtered against 26h's weeks; `#v2;banana;…` produced a
   * course list with a permanently empty grid, no spinner and no error — and
   * then `syncHash()` wrote the bad id straight back (C4).
   */
  function knownSemester(id: string): boolean {
    return semesters.some((s) => s.id === id);
  }

  /** Hash → plan. Names aren't in the hash; loadPeriodCourses backfills them. */
  function planFromHash(parsed: NonNullable<ReturnType<typeof parsePlanHash>>): PlanState {
    let program: PlanProgram | undefined;
    if (parsed.program) {
      program = {
        code: parsed.program.code,
        name: parsed.program.code,
        cohort: parsed.program.cohort,
      };
      if (parsed.program.direction) {
        program.direction = { code: parsed.program.direction, name: parsed.program.direction };
      }
    }
    let semesterId = parsed.semesterId;
    if (!knownSemester(semesterId)) {
      const fallback = semesters.find((s) => s.id === defaultSemesterId) ?? semesters[0];
      linkNote = `Lenken pekte på et semester vi ikke kan planlegge ennå — viser ${semesterLabel(fallback)}.`;
      semesterId = fallback?.id ?? defaultSemesterId;
    }
    return {
      semesterId,
      courses: parsed.courses.map((c) => ({
        code: c.code,
        name: c.code,
        version: c.version,
        source: c.source,
        ...(c.dropped ? { dropped: true } : {}),
      })),
      ...(program ? { program } : {}),
    };
  }

  // Hash wins over storage on load (PRODUCT.md §7) — but only a hash that
  // actually carries a plan. Every load ends by writing the *current* plan
  // back into the hash (syncHash below), so on a later visit a trivially-empty
  // hash (`#v2;26h;-;`, no program, no courses) is indistinguishable from "no
  // hash was ever set" and must defer to localStorage instead of wiping it.
  const hashPlan = parsePlanHash(location.hash);
  const hashHasPlan =
    hashPlan !== null && (hashPlan.program !== null || hashPlan.courses.length > 0);
  let plan: PlanState = store.loadPlan();
  if (hashPlan && hashHasPlan) {
    plan = planFromHash(hashPlan);
    store.savePlan(plan);
  } else if (!knownSemester(plan.semesterId)) {
    // Stored state can outlive a semester too — silently, since no link lied.
    plan = { ...plan, semesterId: defaultSemesterId };
    store.savePlan(plan);
  }

  let plannerIndex: PlannerIndex | null = null;
  let showOthers = false;
  let periodCourses: PeriodCourses | null = null;
  let studyPlanFetchToken = 0;
  /** `true` once a study plan is loaded but has no period for this semester (B4). */
  let periodMissing = false;
  /** Study-plan credits of the current prefill, when it exceeds a semester (B9.4). */
  let suspiciousPrefillCredits: number | null = null;
  /** The last hash this page wrote, so its own `replaceState` isn't read back as a paste. */
  let lastWrittenHash = "";

  function currentSemester(): SemesterSummary | undefined {
    return semesters.find((s) => s.id === plan.semesterId) ?? semestersFile.current ?? undefined;
  }

  /** `fromDate`…`examFinalDate` of the planned semester — the window C3 filters exams to. */
  function currentExamWindow(): ExamWindow | null {
    const semester = currentSemester();
    if (!semester) return null;
    return { fromDate: semester.fromDate, examFinalDate: semester.examFinalDate };
  }

  function syncHash(): void {
    lastWrittenHash = formatPlanHash(plan);
    history.replaceState(null, "", lastWrittenHash);
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

  /**
   * DR-9/U6: switching semester lives inside a disclosure, not on the fold.
   * Two of the three terms offered have no published timetable, so each chip
   * carries that fact inline — choosing one is then informed rather than a
   * way to break the primary surface.
   */
  function renderSemesterToggle(): void {
    elements.toggleHost.replaceChildren();
    for (const semester of semesters) {
      const choice = el("span", "planner-semester-choice");
      // `semesterLabel`, not the raw upstream `name`: NTNU ships "2027 Vår"
      // and every other surface here (the context line right above these
      // chips, /emne/, /emner/) says "Vår 2027". Two spellings of the same
      // term within one viewport read as two different things.
      const chip = el("button", "np-toggle", semesterLabel(semester));
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(semester.id === plan.semesterId));
      chip.addEventListener("click", () => {
        if (semester.id === plan.semesterId) return;
        store.setSemester(semester.id);
        elements.semesterDisclosure.open = false;
      });
      choice.append(chip);
      if (!semester.timetablePublished) {
        choice.append(
          el(
            "span",
            "np-note planner-semester-note",
            `timeplan publiseres ~${publishMonthFor(semester.id)}`,
          ),
        );
      }
      elements.toggleHost.append(choice);
    }
  }

  /**
   * The banner. The programme is a *title* with its code beside it in mono
   * (D2/D10) — it is the only thing that tells MIDT from MTDT, and it was set
   * as a 0.72 rem muted kicker, i.e. as chrome. Below it the supporting line:
   * kull · studieretning · the resolved semester. The studieretning is there
   * because it is the *answer* the student gave to the one question the study
   * plan forced — if it isn't visible and re-openable, a wrong pick can never
   * be corrected. The name links to /studier/[code]/, which owns the
   * browsable template the planner deliberately doesn't show.
   */
  function renderBanner(): void {
    const program = plan.program;
    const semester = currentSemester();

    elements.title.replaceChildren();
    if (program) {
      const named = program.name !== "" && program.name !== program.code;
      const link = el("a", "planner-title-name", named ? program.name : program.code);
      link.href = programHref(program.code);
      elements.title.append(link);
      if (named) elements.title.append(el("span", "np-data planner-title-code", program.code));
    } else {
      elements.title.textContent = "Semesterplan";
    }

    elements.contextLine.replaceChildren();
    const line = elements.contextLine;
    const append = (node: Node | string): void => {
      if (line.childNodes.length > 0) line.append(" · ");
      line.append(node);
    };
    if (program) {
      append(el("span", "np-data", `kull ${program.cohort}`));
      if (program.direction) {
        append(el("span", "planner-context-direction", program.direction.name));
      }
    }
    if (semester) append(el("span", "np-data", semesterLabel(semester)));
    if (semester && !semester.timetablePublished) {
      append(`timeplan publiseres ~${publishMonthFor(semester.id)}`);
    }

    elements.contextChange.textContent = program ? "Endre" : "Velg studieprogram";
  }

  /**
   * The credit total, and the four ways it used to be wrong (B9):
   * study-plan credits were discarded, off-semester courses were counted,
   * an overload was painted the same green as a full load, and a >30 sp
   * prefill was silently thrown away. `null` credits stay `null` — DR-6's
   * honest gap — but "not fetched yet" is not a gap, it is a spinner (U5).
   */
  interface CreditSummary {
    total: number;
    unpriced: number;
    offSemester: number;
    loading: boolean;
  }

  /** Live catalog credits win; the study plan's own figure is the fallback (B9.1). */
  function creditsOf(state: PlanCourseState): number | null {
    const live = state.bundle?.details?.credits;
    if (live != null) return live;
    return state.course.credits ?? null;
  }

  /**
   * The course has a timetable, that timetable has entries for this
   * programme, and none of them fall in the planned semester — so the row
   * already says "undervises ikke i valgt semester" and DR-10 excludes it
   * from the total. An *absent* timetable is unknown, not off-semester.
   */
  function isOffSemester(state: PlanCourseState): boolean {
    const timetable = state.bundle?.timetable;
    if (!timetable) return false;
    if (entriesForProgram(timetable, plan.program?.code).length === 0) return false;
    return semesterEntries(state.bundle).length === 0;
  }

  function creditSummary(): CreditSummary {
    const states = orderedActiveStates();
    const counted = states.filter((s) => !isOffSemester(s));
    let total = 0;
    let unpriced = 0;
    for (const state of counted) {
      const credits = creditsOf(state);
      if (credits === null) unpriced += 1;
      else total += credits;
    }
    return {
      total,
      unpriced,
      offSemester: states.length - counted.length,
      loading: states.some((s) => s.loading),
    };
  }

  function renderCreditLine(): void {
    const summary = creditSummary();
    if (summary.loading) {
      elements.creditLine.textContent = "henter …";
      elements.creditLine.classList.remove("is-full");
      elements.creditNote.hidden = true;
      return;
    }

    let text = formatCredits(summary.total);
    if (summary.unpriced > 0) {
      const emner = summary.unpriced === 1 ? "emne" : "emner";
      text += ` (+${summary.unpriced} ${emner} uten oppgitt sp)`;
    }
    elements.creditLine.textContent = text;
    // Green means it *fits*: exactly a full load. Painting 37,5 the same
    // green as 30 spends Green-Means-Fits on the opposite of the truth.
    elements.creditLine.classList.toggle(
      "is-full",
      Math.abs(summary.total - FULL_LOAD_CREDITS) < 0.05,
    );

    const notes: string[] = [];
    if (summary.offSemester > 0) {
      const emner = summary.offSemester === 1 ? "emne" : "emner";
      notes.push(
        `${summary.offSemester} ${emner} undervises ikke i ${semesterLabel(currentSemester())} og teller ikke med.`,
      );
    }
    if (suspiciousPrefillCredits !== null) {
      notes.push(
        `Studieplanen oppgir ${formatCreditNumber(suspiciousPrefillCredits)} sp dette semesteret — mer enn et normalt semester. Fjern det du ikke tar.`,
      );
    } else if (summary.total > FULL_LOAD_CREDITS + 0.05) {
      notes.push(
        `${formatCreditNumber(summary.total - FULL_LOAD_CREDITS)} sp over normal semesterbelastning.`,
      );
    }
    elements.creditNote.textContent = notes.join(" ");
    elements.creditNote.hidden = notes.length === 0;
  }

  /**
   * The gap sentence under the course list, and the door into the picker.
   * Deliberately phrased as remaining credits, never "velg 2 av 5": the study
   * plan carries no cardinality (DR-5), but the credit arithmetic is real.
   */
  function renderGapLine(): void {
    const summary = creditSummary();
    const gap = FULL_LOAD_CREDITS - summary.total;
    const anyLoading = summary.loading;
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

  /** The picker is the empty planner's whole page (B5), so its state is explicit. */
  function setPickerOpen(open: boolean): void {
    elements.picker.hidden = !open;
    elements.contextChange.setAttribute("aria-expanded", String(open));
  }

  function closePicker(): void {
    elements.pickerListbox.replaceChildren();
    elements.pickerListbox.hidden = true;
    pickerActiveIndex = -1;
    pickerMatches = [];
    elements.pickerInput.setAttribute("aria-expanded", "false");
    elements.pickerInput.removeAttribute("aria-activedescendant");
  }

  /**
   * A2: the highlight has to be an accessible *state*, not a CSS class.
   * Arrowing through twelve options was silent, because nothing carried an
   * id, `aria-selected` or `aria-activedescendant`.
   */
  function setPickerActive(index: number): void {
    pickerActiveIndex = index;
    let activeId: string | null = null;
    for (const [i, opt] of [...elements.pickerListbox.children].entries()) {
      if (opt.getAttribute("role") !== "option") continue;
      const isActive = i === index;
      opt.classList.toggle("is-active", isActive);
      opt.setAttribute("aria-selected", String(isActive));
      if (isActive) activeId = opt.id;
    }
    if (activeId) elements.pickerInput.setAttribute("aria-activedescendant", activeId);
    else elements.pickerInput.removeAttribute("aria-activedescendant");
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
          ? "Vi fant ingen studieplan for dette programmet. Du kan fortsatt legge til emnene dine selv."
          : "Klarte ikke å hente studieplanen. Prøv igjen.";
      return;
    }

    elements.pickerStatus.textContent = "";
    const years = [...result.plan.publishedYears].sort((a, b) => b - a);
    if (years.length === 0) {
      elements.pickerStatus.textContent = "Ingen kull er publisert for dette programmet ennå.";
      return;
    }

    // B3: `publishedYears` is every year the programme has a plan document
    // for, not every year that has a period for the semester being planned —
    // offering all of them made ~88% of the chips dead ends. One plan's
    // `periods` is the same shape across cohorts, so it is enough to test
    // each candidate cohort's computed period against it.
    const periods = new Set(result.plan.periods.map((p) => p.periodNumber));
    const plannable = years.filter((year) => {
      const period = periodNumberFor(plan.semesterId, year);
      return period !== null && periods.has(period);
    });
    // Never a dead end: if the filter leaves nothing, show every kull and say
    // what the student is looking at.
    const shown = plannable.length > 0 ? plannable : years;
    if (plannable.length === 0) {
      elements.pickerStatus.textContent = `Ingen av kullene har en periode i ${semesterLabel(currentSemester())}. Velg likevel, så viser vi det studieplanen har.`;
    }

    elements.pickerKull.hidden = false;
    elements.pickerKullChips.replaceChildren();
    for (const year of shown) {
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
      elements.pickerStatus.textContent = "Klarte ikke å hente studieplanen. Prøv igjen.";
      return;
    }
    // A fresh programme/kull answers no studieretning question yet — the
    // period classifies without one, prefilling the intersection if gated.
    const program: PlanProgram = { code, name, cohort };
    const resolved = resolvePeriodFor(result.plan, plan.semesterId, cohort);

    store.setProgramPlan(program, obligatoryToAdd(resolved.courses));
    setPickerOpen(false);
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
      elements.pickerListbox.append(el("li", "planner-typeahead-empty np-hint", "Ingen treff."));
      elements.pickerListbox.hidden = false;
      pickerActiveIndex = -1;
      elements.pickerInput.setAttribute("aria-expanded", "true");
      elements.pickerInput.removeAttribute("aria-activedescendant");
      return;
    }
    pickerMatches.forEach((option, index) => {
      const [code, name, studyLevel, cities] = option;
      const item = el("li", "np-popover-option planner-picker-option");
      item.id = `planner-picker-option-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.append(el("span", "np-data planner-picker-code", code));
      item.append(el("span", "planner-picker-name", name));
      // The field that tells MIDT from MTDT (B6).
      if (studyLevel !== "") {
        const detail = cities.length > 0 ? `${studyLevel}, ${cities.join(", ")}` : studyLevel;
        item.append(el("span", "planner-picker-level", detail.toLowerCase()));
      }
      // `mousedown` only suppresses the blur that would close the list first;
      // selection is on `click`, which is what VoiceOver/TalkBack double-tap
      // and switch access actually dispatch (A2).
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => {
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
    const open = elements.picker.hidden;
    setPickerOpen(open);
    if (open) elements.pickerInput.focus();
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
      elements.directionNote.textContent = "Klarte ikke å hente studieplanen. Prøv igjen.";
      return;
    }
    const resolved = resolvePeriodFor(result.plan, plan.semesterId, program.cohort, option.code);
    store.setProgramPlan({ ...program, direction: option }, obligatoryToAdd(resolved.courses));
  }

  /**
   * The one open question the week is waiting on, whatever its shape.
   *
   * All three shapes get the same treatment for the same reason: the answer
   * belongs *on* the primary surface. A studieretning question in a quiet
   * side panel while the grid renders as a failure is B2; an elective-only
   * period whose next step sits in the other column — behind a tab on mobile
   * — is U8, the identical shape with the opposite treatment; and a semester
   * the study plan has no period for is B4's honest dead end.
   */
  interface WeekQuestion {
    title: string;
    note: string;
    directions: DirectionOption[];
    action: { label: string; run: () => void } | null;
    /** What the week frame shows in place of a grid. */
    weekMessage: string;
  }

  function weekQuestion(): WeekQuestion | null {
    const program = plan.program;
    const label = semesterLabel(currentSemester());

    if (program && periodMissing) {
      const note = `Studieplanen for kull ${program.cohort} har ingen periode for ${label} ennå. Legg til emnene du tar selv, eller bytt semester.`;
      return {
        title: "Ingen periode i studieplanen",
        note,
        directions: [],
        action: { label: "Legg til emne", run: () => openAddFromQuestion() },
        weekMessage: note,
      };
    }

    const pending = periodCourses?.pendingChoice ?? null;
    if (pending && pending.directions.length > 0) {
      const deadline = pending.deadlineDate
        ? `Studieplanen viser frist ${formatShortDate(pending.deadlineDate)}. `
        : "";
      return {
        title: pending.name,
        note: `${deadline}Velg den du følger — ukeplanen fylles ut med en gang.`,
        directions: pending.directions,
        action: null,
        weekMessage: "Svar på spørsmålet over — ukeplanen fylles ut med en gang.",
      };
    }

    // U8: a period that is elective by design (BIT kull 2024, period 5: zero
    // `O` courses, eight electives). Nothing is wrong and nothing is missing
    // — the student simply has not chosen yet, and that is a question.
    const pool = availablePool();
    const noCourses = activeCourses(plan).length === 0;
    if (program && noCourses && periodCourses !== null && pool.length > 0) {
      return {
        title: `Studieplanen din for ${label} er valgfri`,
        note: `${pool.length} ${pool.length === 1 ? "emne" : "emner"} å velge mellom.`,
        directions: [],
        action: { label: "Velg emner", run: () => openAddFromQuestion() },
        weekMessage: "Velg emner fra studieplanen over — ukeplanen fylles ut med en gang.",
      };
    }

    return null;
  }

  /** The current question's button action, rebound on every render. */
  let questionAction: (() => void) | null = null;

  function renderDirectionQuestion(): void {
    const question = weekQuestion();
    if (!question) {
      elements.direction.hidden = true;
      questionAction = null;
      return;
    }
    elements.direction.hidden = false;
    elements.directionTitle.textContent = question.title;
    elements.directionNote.textContent = question.note;

    elements.directionChips.replaceChildren();
    for (const option of question.directions) {
      // `.np-toggle--text`, not the bare uppercase tracked mono tag: these are
      // multi-word Norwegian proper names ("Databaser og søk"), and at 11.5 px
      // uppercase they wrapped to two rows and read as machine codes (D10).
      const chip = el("button", "np-toggle np-toggle--text", option.name);
      chip.type = "button";
      chip.addEventListener("click", () => {
        void applyDirection(option);
      });
      elements.directionChips.append(chip);
    }

    questionAction = question.action?.run ?? null;
    elements.directionActions.hidden = question.action === null;
    if (question.action) elements.directionButton.textContent = question.action.label;
  }

  elements.directionButton.addEventListener("click", () => questionAction?.());

  // --- Add field: the scoped course picker --------------------------------

  let pickerScope: PickerScope = "plan";
  let scopeChosenByUser = false;
  let addOpen = false;
  let addActiveIndex = -1;
  let addRows: PickerRow[] = [];

  /** Candidate bundles fetched purely to preview a clash before adding. */
  const previewBundles = new Map<string, CourseBundle>();
  const previewPending = new Set<string>();

  /**
   * The study plan's choice pool for this period, minus what's already in the
   * plan. Memoised on (period, plan courses) because half a dozen callers ask
   * for it per render and a late-year period's pool runs to 300+ entries.
   */
  let poolMemo: { period: PeriodCourses | null; codes: string; rows: PickerRow[] } | null = null;

  function availablePool(): PickerRow[] {
    const codes = plan.courses.map((c) => c.code).join(",");
    if (poolMemo && poolMemo.period === periodCourses && poolMemo.codes === codes) {
      return poolMemo.rows;
    }
    const inPlan = new Set(plan.courses.map((c) => c.code));
    const rows = (periodCourses?.choice ?? [])
      .filter((c) => !inPlan.has(c.code))
      .map((c) => ({
        code: c.code,
        name: c.name,
        version: c.version,
        credits: c.credits,
        groupName: c.groupName,
      }));
    poolMemo = { period: periodCourses, codes, rows };
    return rows;
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

  /** The question panel's button: open the pool and put the cursor in it. */
  function openAddFromQuestion(): void {
    openAdd(availablePool().length > 0 ? "plan" : "all");
    setRegion("courses");
    elements.addInput.focus();
  }

  function closeAddListbox(): void {
    addOpen = false;
    elements.addListbox.replaceChildren();
    elements.addListbox.hidden = true;
    addActiveIndex = -1;
    addRows = [];
    elements.addInput.setAttribute("aria-expanded", "false");
    elements.addInput.removeAttribute("aria-activedescendant");
  }

  function setAddActive(index: number): void {
    addActiveIndex = index;
    const options = [...elements.addListbox.querySelectorAll(".planner-typeahead-option")];
    let activeId: string | null = null;
    for (const [i, opt] of options.entries()) {
      const isActive = i === index;
      opt.classList.toggle("is-active", isActive);
      opt.setAttribute("aria-selected", String(isActive));
      if (isActive) activeId = opt.id;
    }
    if (activeId) elements.addInput.setAttribute("aria-activedescendant", activeId);
    else elements.addInput.removeAttribute("aria-activedescendant");
  }

  function addRow(row: PickerRow): void {
    store.addCourse({
      code: row.code,
      name: row.name,
      version: row.version,
      source: "manual",
      // The study plan's own figure, so a course the catalog has no entry for
      // still contributes to the total instead of "uten oppgitt sp" (B9.1).
      credits: row.credits,
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
      const row = examRowFor(state.course.code);
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

    const indexRow = examRowFor(row.code);
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
        // Element 4 is the catalog version (C2/DR-4). 293 of 5 470 rows are
        // not "1", and the default-version timetable for those is a different
        // payload for the same slot — hardcoding "1" showed the wrong grid.
        .map(([code, name, , , version]) => ({
          code,
          name,
          version: version && version !== "" ? version : DEFAULT_VERSION,
          credits: null,
          groupName: null,
        }));
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
      elements.addListbox.append(el("li", "planner-typeahead-empty np-hint", message));
      elements.addListbox.hidden = false;
      addActiveIndex = -1;
      elements.addInput.setAttribute("aria-expanded", "true");
      elements.addInput.removeAttribute("aria-activedescendant");
      return;
    }

    const examDates = plannedExamDates();
    let lastGroup: string | null | undefined;
    let optionIndex = 0;
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

      const item = el("li", "np-popover-option planner-typeahead-option");
      item.id = `planner-add-option-${optionIndex}`;
      optionIndex += 1;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      const head = el("span", "planner-typeahead-head");
      head.append(el("span", "np-data planner-typeahead-code", row.code));
      head.append(el("span", "planner-typeahead-name", row.name));
      item.append(head);
      if (row.credits != null) {
        item.append(
          el("span", "np-data planner-typeahead-credits", `${formatCreditNumber(row.credits)} sp`),
        );
      }
      const facts = candidateFacts(row, examDates);
      if (facts) item.append(facts);

      // See the picker: mousedown only holds focus, click selects (A2).
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => addRow(row));
      elements.addListbox.append(item);
    }

    if (total > shown.length) {
      elements.addListbox.append(
        el(
          "li",
          "planner-typeahead-empty np-hint",
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

  elements.gapButton.addEventListener("click", openAddFromQuestion);

  // --- Course bundle state (timetable + details per active course) -------

  const courseStates = new Map<string, PlanCourseState>();
  /** Which semester the held bundles were fetched for — they are year-scoped. */
  let bundlesForSemester = plan.semesterId;

  function syncCourseStates(): void {
    // A bundle fetched for 26h is 2026 data; keeping it across a switch to
    // 27v would filter 2026 entries against 2027's teaching weeks. The
    // per-`code:year:version` memo in data.ts makes a same-year refetch free.
    if (bundlesForSemester !== plan.semesterId) {
      bundlesForSemester = plan.semesterId;
      for (const state of courseStates.values()) {
        state.bundle = null;
        state.loading = false;
      }
      previewBundles.clear();
    }
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
      elements.courseRows.append(el("p", "np-hint", "Ingen emner i planen ennå."));
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

      // "Fjern" used to label both a reversible programme drop and an outright
      // delete. §0.3's verb for the reversible one is "Dropp" (D3).
      const isProgram = course.source === "program";
      const label = isProgram ? (isDropped ? "Legg tilbake" : "Dropp") : "Fjern";
      const action = el("button", "np-btn planner-course-remove", label);
      action.type = "button";
      action.setAttribute("aria-label", `${label} ${course.code}`);
      if (isProgram) {
        action.addEventListener("click", () =>
          isDropped ? store.restoreCourse(course.code) : store.dropCourse(course.code),
        );
      } else {
        action.addEventListener("click", () => store.removeCourse(course.code));
      }
      row.append(action);

      const meta = el("span", "planner-course-row-meta");
      if (isDropped) {
        meta.append(el("span", undefined, "droppet — fortsatt en del av programmet"));
      } else {
        const credits = state ? creditsOf(state) : (course.credits ?? null);
        if (credits != null) {
          meta.append(el("span", "np-data", `${formatCreditNumber(credits)} sp`));
        }
        meta.append(el("span", undefined, isProgram ? "fra programmet" : "lagt til selv"));
        if (details?.assessmentScheme) {
          meta.append(el("span", undefined, details.assessmentScheme));
        }
        if (state && isOffSemester(state)) {
          meta.append(el("span", undefined, "undervises ikke i valgt semester"));
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

  /**
   * The planner index with every row's exams narrowed to the planned
   * semester's own `fromDate`…`examFinalDate` window (C3). Memoised because
   * it is one pass over ~5 500 rows and the semester only changes when the
   * student says so — but the exam list reaches into the index itself, so
   * the filter has to be baked in rather than passed per call.
   */
  let examIndexMemo: {
    semesterId: string;
    index: PlannerIndex;
    byCode: Map<string, PlannerIndexCourse>;
  } | null = null;

  function examIndexForSemester(): PlannerIndex | null {
    if (!plannerIndex) return null;
    if (examIndexMemo?.semesterId === plan.semesterId) return examIndexMemo.index;
    const index = indexForSemester(plannerIndex, plan.semesterId, currentExamWindow());
    examIndexMemo = {
      semesterId: plan.semesterId,
      index,
      byCode: new Map(index.courses.map((c) => [c[0], c])),
    };
    return index;
  }

  /**
   * One course's index row with its exams already narrowed to this semester
   * — so the add field's "eksamen 9. des" preview cannot quote a date from a
   * year it was not asked about either (C3).
   */
  function examRowFor(code: string): PlannerIndexCourse | undefined {
    examIndexForSemester();
    return examIndexMemo?.byCode.get(code);
  }

  // --- The week's horizontal scroll (A4) -----------------------------------

  function prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  /** Day names whose column is (partly) outside the frame's visible box. */
  function clippedDayNames(): string[] {
    const frame = elements.gridFrame;
    const frameRect = frame.getBoundingClientRect();
    const headers = [...frame.querySelectorAll<HTMLElement>(".planner-grid-day-header")];
    return headers
      .filter((header) => {
        const rect = header.getBoundingClientRect();
        return rect.right > frameRect.right + 1 || rect.left < frameRect.left - 1;
      })
      .map((header) => header.textContent ?? "")
      .filter((name) => name !== "");
  }

  /**
   * At 390 px the week frame is ~200 px narrower than its content and its own
   * rounded border closes right after ONS — no fade, no arrow, no visible
   * scrollbar, and the page itself does not scroll horizontally, so the clip
   * reads as an edge and a student can conclude they have no Thursday
   * lecture. `data-scroll` drives the edge mask; the hint names the days.
   */
  function syncGridScroll(): void {
    const frame = elements.gridFrame;
    const overflow = frame.scrollWidth - frame.clientWidth;
    if (overflow <= 1) {
      delete frame.dataset.scroll;
      elements.scrollHint.hidden = true;
      return;
    }
    const left = frame.scrollLeft;
    frame.dataset.scroll = left <= 1 ? "start" : left >= overflow - 1 ? "end" : "middle";

    const clipped = clippedDayNames();
    elements.scrollHint.hidden = clipped.length === 0;
    if (clipped.length > 0) {
      const names =
        clipped.length === 1
          ? clipped[0]
          : `${clipped.slice(0, -1).join(", ")} og ${clipped[clipped.length - 1]}`;
      elements.scrollHint.textContent = `dra sidelengs for ${names}`;
    }
  }

  /** Once per mount: put today's column in view rather than always Monday's. */
  let didScrollToToday = false;

  function scrollToToday(): void {
    if (didScrollToToday) return;
    const frame = elements.gridFrame;
    if (frame.scrollWidth - frame.clientWidth <= 1) return;
    const weekday = new Date().getDay(); // 0 = Sunday
    const dayNumber = weekday === 0 ? 7 : weekday;
    if (dayNumber > 5) return;
    const headers = [...frame.querySelectorAll<HTMLElement>(".planner-grid-day-header")];
    const header = headers[dayNumber - 1];
    if (!header) return;
    didScrollToToday = true;
    const offset = header.getBoundingClientRect().left - frame.getBoundingClientRect().left;
    frame.scrollTo({
      left: Math.max(0, frame.scrollLeft + offset - RAIL_WIDTH_PX),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  elements.gridFrame.addEventListener("scroll", syncGridScroll, { passive: true, signal });
  window.addEventListener("resize", syncGridScroll, { passive: true, signal });

  /**
   * The verdict beside the Ukeplan kicker — PRODUCT §1's primary job, *kan
   * jeg ta disse emnene sammen?*, answered on the page. `renderGrid` has
   * always computed and returned this number and the caller has always
   * thrown it away (U4). Counts are grouped slots, so a three-way clash is
   * one problem, and nothing is asserted while a fetch could still change it.
   */
  function renderVerdict(grid: GridRenderResult | null, loading: boolean): void {
    const host = elements.gridStatus;
    host.replaceChildren();
    host.className = "planner-section-sub";
    if (loading) {
      host.textContent = "henter timeplan …";
      return;
    }
    if (grid?.state !== "grid" || grid.partial) return;
    if (grid.conflictCount === 0) {
      host.classList.add("is-clean");
      host.textContent = "ingen kollisjoner";
      return;
    }
    host.classList.add("np-note-clash");
    host.append(el("span", "np-data", String(grid.conflictCount)));
    host.append(grid.conflictCount === 1 ? " kollisjon denne uka" : " kollisjoner denne uka");
  }

  /**
   * The same verdict for the exam head. C3's "we cannot speak for that year"
   * is NOT repeated here — it is the frame's sentence now (see
   * `examUncovered` below), and printing it twice within 40 px is noise. When
   * the index cannot cover the semester there is simply no verdict to give.
   */
  function renderExamVerdict(exam: ExamRenderResult, loading: boolean): void {
    const host = elements.examStatus;
    host.replaceChildren();
    host.className = "planner-section-sub";
    if (loading) {
      host.textContent = "henter eksamensdatoer …";
      return;
    }
    if (exam.state !== "list" || exam.collisionCount === 0) return;
    host.classList.add("np-note-clash");
    host.append(el("span", "np-data", String(exam.collisionCount)));
    host.append(exam.collisionCount === 1 ? " eksamen samme dag" : " eksamener samme dag");
  }

  function renderGridAndExams(): void {
    const semester = currentSemester();
    const states = orderedActiveStates();
    const anyLoading = states.some((s) => s.loading);
    const question = weekQuestion();

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

    let gridResult: GridRenderResult | null = null;
    if (showFallback && semester) {
      // Through renderGridMessage, not replaceChildren: the ruling means "the
      // plan lives here", and an empty ruled rectangle holding an apology is
      // the opposite of what Ruling-Marks-The-Plan says (D5).
      const prepublish = `Timeplan for ${semesterLabel(semester)} publiseres vanligvis i ${publishMonthFor(semester.id)} — kom tilbake da.`;
      renderGridMessage(
        elements.gridFrame,
        elements.gridNotes,
        question?.weekMessage ?? prepublish,
      );
    } else {
      gridResult = renderGrid(elements.gridFrame, elements.gridNotes, filteredStates, showOthers, {
        loading: anyLoading,
        pendingChoiceMessage: question?.weekMessage ?? null,
        // TEMPORARY (Task 8, see buildPopoverContext above).
        onBlockClick: (detail, anchor) => {
          const ctx = buildPopoverContext(detail, filteredStates);
          if (ctx) popover.showFor(ctx, anchor);
        },
      });
    }

    // B7a: the grid can reveal the muted øving layer on its own when nothing
    // classifies as a lecture. The toggle has to say so, or it lies about
    // what is on screen. This is not the student's `showOthers` — it is not
    // persisted, only mirrored.
    elements.othersToggle.setAttribute(
      "aria-pressed",
      String(showOthers || gridResult?.mutedLayerAutoRevealed === true),
    );

    const examLoading = anyLoading || (states.length > 0 && plannerIndex === null);

    // C3: the shipped index only carries this academic year's exam dates. For
    // a semester beyond it the list's own "Ingen eksamensdatoer funnet ennå"
    // is a finding reported by something that never looked — say what is
    // actually true instead, in the frame where the student is looking.
    const examUncovered =
      !examLoading &&
      activeCourses(plan).length > 0 &&
      !indexCoversSemester(plannerIndex, plan.semesterId);

    const examIndex = examIndexForSemester();
    const examResult = examUncovered
      ? renderExamMessage(
          elements.examFrame,
          elements.examList,
          `Eksamensdatoer er ikke publisert for ${semesterLabel(currentSemester())} ennå.`,
        )
      : renderExamList(
          elements.examFrame,
          elements.examList,
          states,
          plan.semesterId,
          examIndex,
          currentExamWindow(),
          new Date().toISOString().slice(0, 10),
          {
            loading: examLoading,
          },
        );

    renderVerdict(gridResult, anyLoading);
    renderExamVerdict(examResult, examLoading);
    syncGridScroll();
    if (gridResult?.state === "grid") scrollToToday();
  }

  // --- Provenance line -----------------------------------------------------

  /**
   * DR-8 makes provenance the moat, so it has to describe *this* render.
   * "Data hentet 24. jul 2026 fra NTNU · uoffisiell" came solely from
   * `semesters.json`'s build-time `crawledAt` while the grid, names, credits
   * and exam enrichment all came live from `/api` — and it said exactly the
   * same thing when the timetable was unpublished, when an exam had no date,
   * and when a bundle came back with `errors[]` (U9).
   */
  function renderProvenance(): void {
    const semester = currentSemester();
    const states = orderedActiveStates();
    const crawled = formatCrawledAt(semestersFile.crawledAt);
    const sources: string[] = [];

    if (states.length === 0) {
      sources.push(`Emnekatalogen hentet ${crawled} fra NTNU`);
    } else if (semester && !semester.timetablePublished) {
      sources.push(`Timeplan ikke publisert for ${semesterLabel(semester)}`);
    } else if (states.some((s) => s.loading)) {
      sources.push("Henter timeplan fra NTNU nå");
    } else if (states.some((s) => s.bundle?.timetable)) {
      sources.push("Timeplan hentet direkte fra NTNU nå");
    }

    if (states.length > 0) {
      sources.push(
        indexCoversSemester(plannerIndex, plan.semesterId)
          ? `eksamensdatoer fra katalogen (hentet ${crawled})`
          : `eksamensdatoer ikke publisert for ${semesterLabel(semester)}`,
      );
    }
    if (plan.program) sources.push(`studieplan for kull ${plan.program.cohort}`);

    // The gaps, named. Both counts are already computed elsewhere; saying
    // "hentet fra NTNU" over a course whose timetable 404'd is the failure
    // mode that makes the whole line untrustworthy.
    const failures: string[] = [];
    for (const state of states) {
      for (const error of state.bundle?.errors ?? []) {
        const what = error.split(":")[0]?.trim() ?? "data";
        failures.push(`${what} for ${state.course.code}`);
      }
    }
    const dateless = countDatelessExams();

    const parts = [`${sources.join(" · ")}.`];
    if (failures.length > 0) parts.push(`Fikk ikke hentet ${failures.join(", ")}.`);
    if (dateless > 0) {
      parts.push(
        `${dateless} ${dateless === 1 ? "eksamen har" : "eksamener har"} ingen dato ennå.`,
      );
    }
    parts.push("Uoffisiell.");
    elements.provenance.textContent = parts.join(" ");
  }

  /** Exams the catalog lists for this semester but has set no date for (DR-3/U9). */
  function countDatelessExams(): number {
    let count = 0;
    for (const state of orderedActiveStates()) {
      const row = examRowFor(state.course.code);
      if (!row) continue;
      count += examsFromIndex(row, plan.semesterId).filter((e) => e.date === null).length;
    }
    return count;
  }

  // --- Top-level render orchestration --------------------------------------

  function renderAll(): void {
    syncCourseStates();
    // B5: an empty plan is not a dead end, it is the picker. The week has
    // nothing to show yet, but the add field stays mounted — the copy used to
    // point at a hidden picker and at an unmounted field, i.e. at two
    // impossible actions.
    const isEmpty = plan.courses.length === 0 && plan.program === undefined;
    elements.main.classList.toggle("is-empty", isEmpty);
    if (isEmpty) setPickerOpen(true);
    elements.linkNote.textContent = linkNote ?? "";
    elements.linkNote.hidden = linkNote === null;
    renderBanner();
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

  /** Everything the programme course set is derived from — see `loadPeriodCourses`. */
  function derivationKey(): string {
    const program = plan.program;
    if (!program) return `-|${plan.semesterId}`;
    return `${plan.semesterId}|${program.code}|${program.cohort}|${program.direction?.code ?? ""}`;
  }

  /** Which derivation the current `source: "program"` courses belong to (B4). */
  let programDerivedFor: string | null = null;

  /** Re-renders everything that depends on the study plan but not on the grid. */
  function renderPlanDependents(): void {
    renderDirectionQuestion();
    renderAddOptions();
    renderGapLine();
    renderCreditLine();
    renderGridAndExams();
    renderProvenance();
  }

  /**
   * (Re)fetches the study plan for `plan.program` and rebuilds `periodCourses`
   * (DR-5/DR-7), classifying through the chosen studieretning when there is
   * one. Also backfills display names the hash couldn't carry.
   *
   * **B4.** The programme course set is derived from (semester, programme,
   * kull, studieretning) and is re-derived whenever any of those change. The
   * old guard was `if (!hasProgramCourses)`, which froze the prefill at
   * whatever semester it was first built in: switching MTDT kull 2026 to
   * "2027 VÅR" kept all five autumn courses, each tagged "undervises ikke i
   * valgt semester", with the credit line still reading "30 av 30 sp" in
   * accent green — a confident, full, green plan of courses the student is
   * not taking, in a semester whose unpublished timetable cannot contradict
   * it. When the new period doesn't resolve the set is *cleared* and the week
   * says so, because an empty honest state beats a wrong confident one.
   */
  async function loadPeriodCourses(): Promise<void> {
    const program = plan.program;
    if (!program) {
      periodCourses = null;
      periodMissing = false;
      suspiciousPrefillCredits = null;
      programDerivedFor = null;
      renderPlanDependents();
      return;
    }
    const token = ++studyPlanFetchToken;
    const result = await findProgramPlan(program.code, program.cohort);
    if (token !== studyPlanFetchToken) return; // superseded by a newer programme/kull pick
    if ("kind" in result) {
      periodCourses = null;
      periodMissing = false;
      suspiciousPrefillCredits = null;
      renderPlanDependents();
      return;
    }

    const resolved = resolvePeriodFor(
      result.plan,
      plan.semesterId,
      program.cohort,
      program.direction?.code,
    );
    periodCourses = resolved.courses;
    periodMissing = resolved.courses === null;
    const obligatory = resolved.courses?.obligatory ?? [];
    suspiciousPrefillCredits = isSuspiciousPrefill(obligatory) ? prefillCredits(obligatory) : null;

    // Backfill names a hash could not carry (programme, studieretning). This
    // deliberately does *not* return: the derivation key does not include the
    // display names, so the change listener would skip the re-entry (C5d) and
    // the prefill below would never run. `savePlan` dispatches synchronously,
    // so `plan` is already the corrected state when it returns.
    const planName = result.plan.name;
    const applied = resolved.courses?.appliedDirection;
    const needsProgramName = planName !== null && program.name === program.code;
    const needsDirectionName =
      applied !== undefined &&
      applied !== null &&
      program.direction !== undefined &&
      program.direction.name === program.direction.code;
    const namedProgram: PlanProgram =
      needsProgramName || needsDirectionName
        ? {
            ...program,
            ...(needsProgramName && planName ? { name: planName } : {}),
            ...(needsDirectionName && applied ? { direction: applied } : {}),
          }
        : program;
    if (namedProgram !== program) store.savePlan({ ...plan, program: namedProgram });

    const key = derivationKey();
    if (programDerivedFor !== key) {
      programDerivedFor = key;
      const toAdd = obligatoryToAdd(resolved.courses);
      if (!sameProgramSet(plan.courses, toAdd)) {
        store.setProgramPlan(namedProgram, toAdd); // triggers onPlanChange -> re-render
        return;
      }
    }
    renderPlanDependents();
  }

  elements.othersToggle.addEventListener("click", () => {
    showOthers = !showOthers;
    elements.othersToggle.setAttribute("aria-pressed", String(showOthers));
    renderGridAndExams();
  });

  /**
   * Skipped when nothing the study plan depends on changed: `onPlanChange`
   * used to refetch unconditionally, so picking a kull cost three sequential
   * round trips and every Dropp/Legg tilbake cost another (C5d). Combined
   * with the memo in programPlan.ts, a repeat is now free *and* not made.
   */
  let lastDerivationKey: string | null = null;

  const unsubscribe = store.onPlanChange((next) => {
    plan = next;
    syncHash();
    renderSemesterToggle();
    renderAll();
    void loadBundles();
    const key = derivationKey();
    if (key !== lastDerivationKey) {
      lastDerivationKey = key;
      void loadPeriodCourses();
    }
  });
  signal?.addEventListener("abort", unsubscribe);

  /**
   * B10.3: the hash was read once at mount, so pasting a shared plan into an
   * already-open planner changed the address bar and nothing else — and the
   * next edit rewrote the hash from local state, destroying what was pasted.
   * Our own `replaceState` writes are ignored by comparing against the exact
   * string we last wrote (which is pure ASCII, so the browser does not
   * re-normalise it behind our back).
   */
  window.addEventListener(
    "hashchange",
    () => {
      if (location.hash === lastWrittenHash) return;
      const parsed = parsePlanHash(location.hash);
      if (!parsed) return;
      if (parsed.program === null && parsed.courses.length === 0) return;
      linkNote = null;
      store.savePlan(planFromHash(parsed));
    },
    { signal },
  );

  loadPlannerIndex()
    .then((index) => {
      plannerIndex = index;
      const indexByCode = new Map(index.courses.map((c) => [c[0], c]));
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
      examIndexMemo = null;
      renderGridAndExams(); // exam list needed the index to render its catalog data
      renderAddOptions();
      renderProvenance();
    })
    .catch(() => {
      // Typeahead search + exam list will simply show no results; the rest of the page still works.
    });

  // First paint from the initial (hash-or-storage) plan, then kick off fetches.
  syncHash();
  renderSemesterToggle();
  renderAll();
  lastDerivationKey = derivationKey();
  await Promise.all([loadBundles(), loadPeriodCourses()]);
}
