/**
 * `/planlegger/` orchestrator (PRODUCT.md §1). Schedule-first: programme +
 * kull picked once → the week for the chosen semester renders immediately,
 * prefilled with the courses the study plan says the student has (DR-7's
 * pre-fill IS the default plan, not a hedged suggestion).
 *
 * The page is **two regions**, not four tabs: *Uke* (grid + exam list) and
 * *Emner* (the plan and how to change it), side by side above 60rem. They stay
 * co-visible because the core loop is add/drop → watch the collision appear or
 * vanish, and splitting cause from effect puts a click in the middle of it.
 *
 * Two things the study plan forces (see programPlan.ts):
 * - **The studieretning question.** Later-year sivilingeniør periods have no
 *   top-level courses. The cross-direction obligatory intersection is
 *   prefilled so the week is never blank, and the question is asked *on the
 *   Uke region* — the same question behind a tab is a dead end.
 * - **The choice pool.** A 4th/5th-year period offers 30–60+ courses. Its
 *   count surfaces in the gap line; the picking happens in the add-course
 *   dialog's flat catalog search (`addCourse.ts`).
 *
 * Render work is delegated to grid.ts/examList.ts.
 */

import {
  type CourseBundle,
  clearCourseBundleMemo,
  type ExamWindow,
  fetchCourseBundle,
  indexCoversSemester,
  indexForSemester,
  loadPlannerIndex,
  type PlannerIndex,
  type PlannerIndexCourse,
  type TimetableEntry,
} from "../../lib/planner/data.js";
import {
  applyGroupSelection,
  groupOptions,
  resolveLectureDefaults,
} from "../../lib/planner/groups.js";
import { assignHues } from "../../lib/planner/hues.js";
import { entriesForProgram, entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
import {
  type AddCourseInput,
  activeCourses,
  createPlanStore,
  DEFAULT_VERSION,
  type PlanCourse,
  type PlanProgram,
  type PlanState,
} from "../../lib/planner/store.js";
import { isoWeekNumber } from "../../lib/planner/weekDates.js";
import { syncPlanProbe } from "../../lib/planProbe.js";
import { type AddCourseDeps, type AddCourseHandle, mountAddCourse } from "./addCourse.js";
import type { SessionChoice } from "./blockPopover.js";
import { renderCourseRows as sharedCourseRows } from "./courseRows.js";
import { type CourseSettingsContext, mountCourseSettings } from "./courseSettings.js";
import { el, formatCreditNumber, formatShortDate } from "./dom.js";
import { renderExamList, renderExamMessage } from "./examList.js";
import {
  type ClassifiedCourse,
  findProgramPlan,
  type PeriodCourses,
  resolvePeriodFor,
} from "./programPlan.js";
import {
  buildStudieinfoSection,
  publishMonthFor,
  type StudieinfoSectionHandle,
} from "./studieinfo.js";
import {
  mountStudieinfoDialog,
  type StudieinfoDialogHandle,
  type StudieinfoFocus,
} from "./studieinfoDialog.js";
import type { PlanCourseState } from "./types.js";
import { type BlockDetail, unresolvedLectureChoices } from "./weekNotes.js";
import { mountWeekView, type WeekRenderResult, type WeekViewHandle } from "./weekView.js";

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
 * `studyLevel`/`cities` separate two identically-named rows — MIDT and MTDT
 * are both "Datateknologi" and lead to opposite outcomes.
 */
export type ProgramOption = [code: string, name: string, studyLevel: string, cities: string[]];

/**
 * One row of the study plan's own choice pool (`availablePool`) — feeds the
 * gap line's counts and copy only. The add surface is the dialog's catalog
 * search.
 */
interface PickerRow {
  code: string;
  name: string;
  version: string;
  credits: number | null;
  groupName: string | null;
}

/** Full credit load for one semester — the denominator in "X av 30 sp". */

/* The two week views, the view state, the tab pair and the frame's reservation
   all live in `weekView.ts` now: three surfaces draw a week and they must draw
   the same one. This page keeps only what is its own — the exam list, the
   verdict, the credit line and the course rows. */

interface PlannerElements {
  title: HTMLElement;
  /** The identity block, which is also the door into the programme picker. */
  nameBtn: HTMLButtonElement;
  contextLine: HTMLElement;
  semesterSelect: HTMLSelectElement;
  planNote: HTMLElement;
  examsSection: HTMLElement;
  direction: HTMLElement;
  directionTitle: HTMLElement;
  directionNote: HTMLElement;
  directionActions: HTMLElement;
  directionButton: HTMLButtonElement;
  weekControls: HTMLElement;
  gridFrame: HTMLElement;
  gridNotes: HTMLElement;
  gridStatus: HTMLElement;
  examList: HTMLElement;
  courseRows: HTMLElement;

  addCourseBtn: HTMLButtonElement;
  planPanel: HTMLDetailsElement;
  planPanelBody: HTMLElement;
}

function getElements(): PlannerElements | null {
  const byId = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;

  const found = {
    title: byId<HTMLElement>("planner-title"),
    nameBtn: byId<HTMLButtonElement>("planner-name-btn"),
    contextLine: byId<HTMLElement>("planner-context-line"),
    semesterSelect: byId<HTMLSelectElement>("planner-semester-select"),
    planNote: byId<HTMLElement>("planner-plan-note"),
    examsSection: byId<HTMLElement>("planner-region-exams"),
    direction: byId<HTMLElement>("planner-direction"),
    directionTitle: byId<HTMLElement>("planner-direction-title"),
    directionNote: byId<HTMLElement>("planner-direction-note"),
    directionActions: byId<HTMLElement>("planner-direction-actions"),
    directionButton: byId<HTMLButtonElement>("planner-direction-btn"),
    weekControls: document.querySelector<HTMLElement>(
      '#planner-region-week [data-role="week-controls"]',
    ),
    gridFrame: byId<HTMLElement>("planner-grid-frame"),
    gridNotes: byId<HTMLElement>("planner-grid-notes"),
    gridStatus: byId<HTMLElement>("planner-grid-status"),
    examList: byId<HTMLElement>("planner-exam-list-host"),
    courseRows: byId<HTMLElement>("planner-course-rows"),

    addCourseBtn: byId<HTMLButtonElement>("planner-add-course-btn"),
    planPanel: byId<HTMLDetailsElement>("planner-plan-panel"),
    planPanelBody: byId<HTMLElement>("planner-plan-body"),
  };

  for (const value of Object.values(found)) {
    if (!value) return null;
  }
  return found as PlannerElements;
}

/**
 * Today in Oslo as "YYYY-MM-DD". `toISOString().slice(0, 10)` is the UTC date,
 * which is *yesterday* between local midnight and 01:00 CET / 02:00 CEST —
 * long enough to put "i dag" on yesterday's exam. The week uses local time
 * (`getDay()`), so the two surfaces disagreed with each other in that window.
 */
function todayInOslo(): string {
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

/** Current + next two non-summer semesters, ordered chronologically. */
function candidateSemesters(file: SemestersFile): SemesterSummary[] {
  const teaching = file.semesters.filter((s) => s.id.endsWith("h") || s.id.endsWith("v"));
  teaching.sort((a, b) => (a.fromDate ?? "").localeCompare(b.fromDate ?? ""));
  const currentIndex = file.current
    ? teaching.findIndex((s) => s.id === file.current?.id)
    : teaching.findIndex((s) => (s.fromDate ?? "") >= todayInOslo());
  const start = currentIndex >= 0 ? currentIndex : 0;
  return teaching.slice(start, start + 3);
}

function semesterLabel(semester: SemesterSummary | undefined): string {
  if (!semester) return "";
  const season = /h$/i.test(semester.id) ? "Høst" : "Vår";
  const year = semesterYear(semester.id);
  return year !== null ? `${season} ${year}` : semester.name;
}

/**
 * "Is this the same plan?" — the gate on the pull's repaint.
 *
 * `formatPlanHash` used to answer this, as a second job beside being the URL,
 * and it went with the hash. What replaces it is deliberately NOT
 * `JSON.stringify(plan)`: display names and credits arrive asynchronously (the
 * search-index backfill, a study-plan fetch), and a plan that differs only by
 * a name the other device happened to have resolved first is the SAME plan —
 * repainting on it is the gratuitous-repaint problem the sync work spent a
 * round closing. So the key is what the student actually chose: the semester,
 * the programme, and each course's code, version, source, dropped state and
 * group picks.
 */
export function planIdentity(plan: PlanState): string {
  const program = plan.program
    ? `${plan.program.code}.${plan.program.cohort}.${plan.program.direction?.code ?? ""}`
    : "-";
  const courses = plan.courses
    .map(
      (c) =>
        `${c.code}.${c.version}.${c.source}.${c.dropped ? 1 : 0}.${(c.groups ?? []).join("~")}`,
    )
    .join(",");
  return `${plan.semesterId};${program};${courses}`;
}

/* `semesterShort` — the `H26` / `V27` form — is DELETED with its one caller.
   It existed for the plan title's third part, and the title stopped carrying a
   semester when the bar grew a `<select>` for it (DESIGN §9). Everything that
   still names a term does it in full through `semesterLabel` ("Høst 2026"). */

/**
 * Obligatory courses of a classified period, shaped for `setProgramPlan`.
 * `credits` and the plan's own course name travel with them: 39 of 1 383
 * period-1 obligatory references are absent from the catalog, and without the
 * study plan's figure each silently under-reported the semester's load.
 *
 * A >30 sp prefill is **kept**, not discarded — CMEDFORSK period 1 legitimately
 * sums to 42,5 sp. The caller says so instead (`suspiciousPrefillCredits`).
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
 * Does the plan's programme course set already equal `next`? Guards the
 * re-derive against a write (and therefore a render) that changes nothing.
 * Compares credits too, so a plan stored without them picks them up.
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

/**
 * Mounts the planner page. `semestersFile` is `data/semesters.json`, a
 * build-time crawler artifact imported by the caller rather than fetched.
 *
 * Called once per `astro:page-load`, so it runs again after every client-side
 * navigation back to `/planlegger/`. `signal` aborts just before the next
 * swap: element listeners die with the DOM, but the plan-store subscription
 * lives on `window` and would accumulate one stale re-render per visit.
 */
export async function mountPlannerApp(
  semestersFile: SemestersFile,
  signal?: AbortSignal,
): Promise<void> {
  const found = getElements();
  if (!found) return;
  const elements = found;

  const defaultSemesterId = semestersFile.current?.id ?? "26h";
  const semesters = candidateSemesters(semestersFile);
  // One AbortSignal for everything this page mounts and binds, so it all tears
  // down together on the next `astro:before-swap`.
  const lifeSignal = signal ?? new AbortController().signal;

  // THE STORE IS THE WHOLE OF PERSISTENCE (PRODUCT mandate 11). It reads and
  // writes `localStorage` and nothing else — there is no account, no sync
  // client, no push, no pull, and no generation counter guarding a round trip
  // that no longer happens. All of that was deleted 2026-08-18; a plan lives in
  // one browser, and the planner says so rather than promising more.
  const store = createPlanStore(defaultSemesterId);

  /**
   * ONE STUDIEINFO SECTION ON THE PAGE AT A TIME, and that is a hard constraint
   * rather than a preference: `buildStudieinfoSection` hard-codes its ids
   * (`studieinfo-program-input`, `studieinfo-kull-chips`, `studieinfo-hint`,
   * the listbox its combobox owns through `aria-controls`), so two live
   * instances would duplicate every one of them and break the label, the
   * combobox wiring and every `getElementById` that reaches into it.
   *
   * The two hosts are mutually exclusive states, so they are mounted that way:
   * the first-run screen's section exists only while there is no plan, and the
   * dialog is built on its first open — which cannot happen before a plan
   * exists, because both of its openers (the plan's own name, and the
   * studieretning question) require one.
   */
  let studieinfoDialog: StudieinfoDialogHandle | null = null;

  /**
   * Opens the programme picker, with the caret on whichever control asked for
   * it. It is the planner's own dialog and the only one on the site: the
   * topbar's door led to an account, and there is no account (mandate 11).
   */
  function openStudieinfo(focus?: StudieinfoFocus): void {
    studieinfoDialog ??= mountStudieinfoDialog(store, lifeSignal);
    studieinfoDialog.open(focus);
  }

  const firstRunHost = document.getElementById("planner-firstrun-picker");
  let firstRun: StudieinfoSectionHandle | null = null;

  /**
   * The first-run screen's picker: the SAME unit the dialog hosts, under the
   * other commit policy. The screen owns the presentation of a first run and
   * `studieinfo.ts` owns the picking; the only thing they agree on is when a
   * pick is written.
   *
   * Nothing repaints from here. `setProgramPlan` writes through the store, the
   * `onPlanChange` subscription at the foot of this file turns that into a
   * `renderAll()`, and `planProbe.ts` puts `data-plan` on `<html>` — which is
   * what takes this screen down and brings the planner up. All of it off the
   * one write, with no reload.
   */
  function syncFirstRun(): void {
    if (!firstRunHost) return;
    // The SAME predicate the probe writes `data-plan` from, so the CSS gate and
    // this mount can never disagree: a programme, or a course in any semester.
    // `plan.courses` alone would be wrong in both directions — it throws a
    // student who switched to an empty term back to onboarding, and it leaves
    // the onboarding screen off for one who has just emptied their plan.
    if (plan.program !== undefined || store.hasAnyCourses()) {
      firstRun?.element.remove();
      firstRun = null;
      return;
    }
    if (firstRun) return;
    // RETURNING to first run, which happens when the last course is removed.
    // The dialog holds a second studieinfo section with the same hard-coded
    // ids, so it has to go before this one is built; `openStudieinfo` rebuilds
    // it on demand.
    studieinfoDialog?.destroy();
    studieinfoDialog = null;
    firstRun = buildStudieinfoSection({ store, commit: "on-kull", onSaved: () => {} });
    firstRunHost.append(firstRun.element);
    // `reset()` is what requests the programme catalogue — the dialog gets it
    // from every open, and this section has no open to hook. Paying for it up
    // front is right here and only here: on this screen the picker IS the
    // screen, so the student is by definition about to search it.
    firstRun.reset();
  }

  document
    .getElementById("planner-firstrun-add")
    ?.addEventListener("click", () => openAddFromQuestion(), { signal: lifeSignal });

  const courseSettings = mountCourseSettings(store, lifeSignal);
  // A click in the week asks "what is this session", not "let me edit this
  // course" — so it opens a read popover anchored to the bar, carrying a way
  // through to the editor rather than being it.
  /**
   * The week itself: both views, the tab pair, the scroll edge, the now marker
   * and the session popover. This page supplies what only it knows — the way
   * out to the editor, what that verb may promise, and what to redraw when
   * something outside the week changes.
   */
  const week: WeekViewHandle = mountWeekView({
    frame: elements.gridFrame,
    notes: elements.gridNotes,
    controls: elements.weekControls,
    surface: "planner",
    onOpenSettings: openCourseSettings,
    popoverContext,
    onChoiceClick: openCourseSettings,
    onRerender: (_reason) => {
      renderGridAndExams();
    },
    // BOTH dates are in the stamp: the week's column comes from the local
    // weekday and the exam countdowns from the calendar date in Oslo. In Norway
    // they roll together; elsewhere they do not, and this fires on whichever
    // moves first.
    dayStamp: () => todayStamp(),
    signal: lifeSignal,
  });

  /**
   * What the popover's verb may promise, for a clicked bar or board row.
   *
   * `weekView` mounts and positions the card; only this half is the planner's,
   * because it comes from the editor's OWN material — a layer with one option
   * (or none) cannot offer a choice the modal would not show. The two surfaces
   * with no editor supply nothing and get no verb.
   */
  function popoverContext(detail: BlockDetail): {
    choice: SessionChoice;
    lectureAlternatives: number;
  } {
    const state = courseStates.get(detail.code);
    const layerOptions = (buildCourseSettingsContext(detail.code)?.groups ?? []).filter(
      (option) => (option.kind === "lecture") === detail.isLecture,
    );
    const choice: SessionChoice =
      layerOptions.length > 1 ? (detail.isLecture ? "parallel" : "group") : "course";
    // Whether the drawn lecture is a guess is the same question the margin
    // note answers, so it is the same function — a second rule here is how the
    // note and the card start disagreeing.
    const guess = state ? unresolvedLectureChoices([state], false)[0] : undefined;
    return { choice, lectureAlternatives: guess?.count ?? 0 };
  }

  /**
   * The material the course-settings modal opens on, for one course code.
   *
   * Keyed by CODE, not by a clicked block: both entrances — a course row and a
   * block in the week — reach the same course the same way, and the row has no
   * block to hand over. A course with no timetable still opens (credits, status
   * notes, drop/remove), and so does a DROPPED programme course, which has no
   * `PlanCourseState` at all. `null` only for a code not in the plan.
   *
   * The picker lists groups this student could plausibly be in — this
   * semester's weeks, and for øving/lab the programme's own sections — because
   * EXPH0300 otherwise listed 44 rows across three cities. A key picked
   * *explicitly* stays listed whatever the narrowing says, or the control that
   * unticks it is unreachable.
   */
  function buildCourseSettingsContext(code: string): CourseSettingsContext | null {
    const course = plan.courses.find((c) => c.code === code);
    if (!course) return null;
    const state = courseStates.get(code) ?? null;

    // The status sentences, one per line (they used to run on in the row).
    const notes: string[] = [];
    const stale = notTaughtIn(code);
    if (stale) {
      notes.push(`Ikke undervist i ${stale.year}. Sist undervist ${stale.lastYear}.`);
    } else if (state) {
      if (isOffSemester(state)) notes.push("Undervises ikke i valgt semester.");
      // `errors` is Norwegian on both sides of the colon (data.ts's
      // `failureMessage`); the raw upstream English lives on `.detail`.
      for (const error of state.bundle?.errors ?? []) notes.push(`Fikk ikke hentet ${error}.`);
    }
    const failed = !stale && (state?.bundle?.errors.length ?? 0) > 0;

    const base = {
      code,
      name: state?.bundle?.details?.courseName ?? course.name,
      // A dropped course has no state and no assigned hue — it is out of the
      // week, the total and the exam list. The dot still needs a colour.
      hueVar: state?.hueVar ?? "--muted",
      credits: state ? creditsOf(state) : (course.credits ?? null),
      source: course.source,
      dropped: course.dropped === true,
      // For the modal's `ntnu.no` link. A semester id with no year in it leaves
      // the field off, and NTNU then answers with the current year.
      ...(semesterYear(plan.semesterId) !== null
        ? { year: semesterYear(plan.semesterId) as number }
        : {}),
      notes,
      onRetry: failed ? () => retryCourse(code) : null,
    };

    const timetable = state?.bundle?.timetable;
    if (!state || !timetable) {
      return {
        ...base,
        groups: [],
        selected: course.groups ?? [],
        defaults: [],
        drawnLectures: [],
      };
    }

    // `defaults` is read off exactly the set the GRID narrows, so the picker's
    // ticked default is the block on screen. Its LENGTH decides radios vs
    // checkboxes, so it must stay `resolveLectureDefaults(...).keys` verbatim.
    // `resolved` travels with it so the picker can stop labelling a provisional
    // pick "(din parallell)" when neither campus parallel is the student's own.
    const week = semesterWeekEntries(state.bundle);
    const lectures = resolveLectureDefaults(week, state.programCode);
    const selected = state.course.groups ?? [];
    const inWeek = new Set(groupOptions(week).map((o) => o.key));
    // Programme narrowing on the ØVING/LAB layer only. That is where the flood
    // is (39 of EXPH0300's 44 rows are seminar groups, mostly another campus's)
    // and it is the layer `applyGroupSelection`'s default branch narrows the
    // same way. The lecture layer keeps every parallel the semester publishes:
    // picking a parallel tagged for ANOTHER programme is a documented capability
    // and this picker is the only place to exercise it.
    const ownOther = new Set(
      groupOptions(entriesForProgram(week, state.programCode))
        .filter((o) => o.kind !== "lecture")
        .map((o) => o.key),
    );
    return {
      ...base,
      // From the YEAR's options, so a pick made for another semester (or one
      // upstream has retitled) is still listed and can be unticked.
      groups: groupOptions(timetable).filter(
        (o) =>
          (o.kind === "lecture" ? inWeek.has(o.key) : ownOther.has(o.key)) ||
          selected.includes(o.key),
      ),
      selected,
      defaults: lectures.keys,
      resolved: lectures.resolved,
      programCode: state.programCode,
      // What the week actually draws, through the SAME call the grid and board
      // render from — not `lectures.keys`, which is empty both for a course
      // with nothing to switch to and for one whose other parallels are another
      // programme's. `pickableGroups` must tell those apart.
      drawnLectures: groupOptions(applyGroupSelection(week, selected, state.programCode))
        .filter((o) => o.kind === "lecture")
        .map((o) => o.key),
    };
  }

  /** Opens the settings modal for one course, from either entrance. */
  function openCourseSettings(code: string): void {
    const ctx = buildCourseSettingsContext(code);
    if (ctx) courseSettings.showFor(ctx);
  }

  /** Only a semester this build ships plannable data for may enter the state. */
  function knownSemester(id: string): boolean {
    return semesters.some((s) => s.id === id);
  }

  let plan: PlanState = store.loadPlan();
  if (!knownSemester(plan.semesterId)) {
    // Stored state can outlive a semester. Nothing lied — the plan was made
    // for a term this build no longer ships data for — so it is corrected
    // silently rather than explained.
    plan = { ...plan, semesterId: defaultSemesterId };
    store.savePlan(plan);
  }

  let plannerIndex: PlannerIndex | null = null;
  /**
   * The `/data/search-index.json` download failed. Kept apart from
   * `plannerIndex === null` ("still in flight"): conflating them left the exam
   * column spinning forever and reported a failed download of our own build
   * artifact as an upstream fact.
   */
  let plannerIndexFailed = false;
  /** Lazy by-code lookup over the raw index (`offeredYears` etc.). Reset with the index. */
  let indexByCodeMemo: Map<string, PlannerIndexCourse> | null = null;
  /* Which view is on screen, and whether the next render may play the
     strike-in, both belong to `week` — it is how you are looking at the plan
     rather than what you are looking at, and every surface shares it. */
  let periodCourses: PeriodCourses | null = null;
  let studyPlanFetchToken = 0;
  /** `true` once a study plan is loaded but has no period for this semester (B4). */
  let periodMissing = false;
  /**
   * What actually happened to the study-plan fetch, so the provenance line can
   * stop asserting "studieplan for kull N" over a 404, an error, or another
   * cohort's document silently substituted by the step-back.
   */
  let studyPlanOutcome:
    | { kind: "pending" }
    | { kind: "found"; year: number }
    | { kind: "not-found" }
    | { kind: "error" } = { kind: "pending" };

  function currentSemester(): SemesterSummary | undefined {
    return semesters.find((s) => s.id === plan.semesterId) ?? semestersFile.current ?? undefined;
  }

  /** `fromDate`…`examFinalDate` of the planned semester — the window C3 filters exams to. */
  function currentExamWindow(): ExamWindow | null {
    const semester = currentSemester();
    if (!semester) return null;
    return { fromDate: semester.fromDate, examFinalDate: semester.examFinalDate };
  }

  /* `syncHash` is DELETED with the grammar it wrote. THE URL IS NOT THE PLAN:
     `/planlegger/` is one address whatever is in the plan, and there is nothing
     to hand over — the shared-plan page went with the account. So bookmarking
     and browser tab-sync do not carry the plan, and nothing else does either:
     the plan is in this browser's storage or it is nowhere (mandate 11). */

  /** A bundle's timetable, narrowed to this programme's sections and this semester's weeks. */
  function semesterEntries(bundle: CourseBundle | null): TimetableEntry[] {
    const semester = currentSemester();
    if (!bundle?.timetable || !semester) return [];
    return entriesInSemester(
      entriesForProgram(bundle.timetable, plan.program?.code),
      semester.teachingWeeks,
    );
  }

  /**
   * A bundle's timetable narrowed to this semester's teaching weeks ONLY — not
   * to the programme's sections. This is what the grid draws, because
   * `applyGroupSelection` (groups.ts) is the single owner of programme
   * narrowing and an *explicit* group pick wins over it. Pre-narrowing here too
   * stripped a cross-programme parallel the student had selected before the
   * grid saw it. `semesterEntries` keeps the programme narrowing where it
   * belongs: off-semester/credit accounting.
   */
  function semesterWeekEntries(bundle: CourseBundle | null): TimetableEntry[] {
    const semester = currentSemester();
    if (!bundle?.timetable || !semester) return [];
    return entriesInSemester(bundle.timetable, semester.teachingWeeks);
  }

  // --- The semester, which belongs to the PLAN ---------------------------

  /**
   * The one control on this page that says which term is being planned.
   *
   * It used to be a `<select>` inside the studieinfo modal, staged alongside
   * programme, kull and studieretning and committed by that modal's Lagre.
   * Those three describe the STUDENT and moved into the profile panel; this
   * one describes the PLAN, so it stayed — and it commits immediately, which
   * the studieinfo version already effectively did (it wrote the semester
   * first and unconditionally, before anything else it staged).
   *
   * The options print only "Høst 2026" / "Vår 2027" — the "timeplan publiseres
   * ~august" qualifier belongs to the term you are actually on and is already
   * in the context line under the title, so repeating it in every option would
   * spend most of a 390 px row saying it about terms you are not planning.
   */
  function renderSemesterOptions(): void {
    const select = elements.semesterSelect;
    select.replaceChildren();
    for (const semester of semesters) {
      const option = el("option", undefined, semesterLabel(semester)) as HTMLOptionElement;
      option.value = semester.id;
      select.append(option);
    }
    select.value = plan.semesterId;
  }

  elements.semesterSelect.addEventListener(
    "change",
    () => {
      store.setSemester(elements.semesterSelect.value);
    },
    { signal: lifeSignal },
  );

  // The plan's name is the way back into the picker that set it. Always
  // `"program"`: the door is the title, the title states programme and kull,
  // and the caret belongs on the first of the two. The studieretning prompt
  // has its own control and asks for `"direction"` instead.
  elements.nameBtn.addEventListener("click", () => openStudieinfo("program"), {
    signal: lifeSignal,
  });

  // --- Banner ------------------------------------------------------------

  /**
   * The banner — ETT NAVN.
   *
   * The title is the plan as a student writes it on a timetable: `MTFYMA Kull
   * 24` — the two facts that say WHOSE plan this is.
   *
   * THE SEMESTER IS NOT ONE OF THEM ANY MORE. It was, until it became a
   * `<select>` four controls along the same bar: two statements of `H26` on one
   * row, one of them a control you can act on and one of them not. A title
   * restating the setting beside it is redundancy, not reinforcement — the
   * control is the authority, so the title stops competing with it (DESIGN §9).
   *
   * The programme's full name is not lost, it is demoted to the hint line: it
   * is a 42-character database field.
   *
   * With no programme there is nothing to name and the title falls back to the
   * product's own — the one moment the wordmark and the page title may agree,
   * because until you pick a plan the page really is only Semesterplan.
   */
  function renderBanner(): void {
    const program = plan.program;
    const semester = currentSemester();

    // Not the title's face — that swap is gone, the title is one size and one
    // family. This keeps `--plan-courses` and `data-plan` true for the
    // reservations, and it is the one function that runs on every later change.
    syncPlanProbe(plan, store.hasAnyCourses());

    const title = elements.title;
    title.replaceChildren();
    if (program) {
      // `MTFYMA Kull 24`, in unbreakable parts separated by a space and nothing
      // else: at this size the facts already read as two.
      const parts = [program.code, `Kull ${String(program.cohort).slice(-2)}`].filter(Boolean);
      // Each part is unbreakable, so a wrapping title breaks between facts.
      title.append(
        ...parts.flatMap((part, i) => [
          ...(i > 0 ? [" "] : []),
          el("span", "planner-title-part", String(part)),
        ]),
      );
    } else {
      title.textContent = "Semesterplan";
    }

    // PRESS THE FACT TO CHANGE THE FACT — so with no fact there is nothing to
    // press. Disabled rather than merely unstyled: the empty state's own card
    // already carries a "Velg studieprogram" button, and an enabled door here
    // put two controls with that same accessible name on one screen, which is
    // the two-doors-into-one-room shape the bar was cleaned of. Disabling
    // takes it out of the tab order and out of the a11y tree's interactive
    // set, and the title keeps its ink and its place either way.
    const nameBtn = elements.nameBtn;
    // ALWAYS A DOOR, now that the bar is only ever on screen at all when there
    // is something to name. It used to go inert on "no programme and no
    // courses", because the week's own card was saying "Velg studieprogram" in
    // the accent right below it and two controls with one accessible name is
    // the two-doors-into-one-room shape the bar was cleaned of. That card is
    // gone: the first-run SCREEN replaced it, and the bar is hidden underneath
    // it, so there is nothing left to yield to.
    //
    // Leaving the old rule in place was a dead end. The first-run gate is
    // one-way per page-load, so a student with manual adds and no programme who
    // switches to an empty term keeps the bar — and that is exactly the state
    // the rule disabled, with no card to fall back on and no other route to the
    // picker anywhere on the page.
    nameBtn.disabled = false;
    // The accessible name is the ERRAND, not the button's two children read
    // end to end: without this a screen reader announced the whole banner —
    // "MTFYMA Kull 24 Uke 34 · Master i fysikk og matematikk" — as one
    // control's label, naming everything except what pressing it does.
    if (program) {
      nameBtn.setAttribute(
        "aria-label",
        `Endre studieprogram, ${program.code} kull ${program.cohort}`,
      );
    } else {
      nameBtn.removeAttribute("aria-label");
    }

    elements.contextLine.replaceChildren();
    const line = elements.contextLine;
    // Each fact is its own field, separated by space rather than by a mark.
    // Wrapped rather than appended bare so the spacing is a margin between
    // SIBLINGS: the line is `white-space: nowrap` with an ellipsis on a phone,
    // which a flex container would break.
    const append = (node: Node | string): void => {
      const field = el("span", "planner-context-field");
      field.append(node);
      line.append(field);
    };
    // WHICH WEEK IS NOT ON THIS LINE ANY MORE. It used to lead it — "Uke 34" or
    // "Undervisning fra uke 34" — because the grid's day headers carried dates
    // and nothing else said which Monday they were. The week's own picker says
    // it now, in the section it is about, and as something the student chooses
    // rather than something the title's caption tells them. A fact that has
    // become a control does not also stay a caption.
    if (program) {
      const named = program.name !== "" && program.name !== program.code;
      if (named) append(program.name);
      if (program.direction) {
        append(el("span", "planner-context-direction", program.direction.name));
      }
    } else if (semester) {
      // No plan yet: the hint carries the semester the empty week is for.
      append(el("span", "np-data", semesterLabel(semester)));
    }
    if (semester && !semester.timetablePublished) {
      append(`timeplan publiseres ~${publishMonthFor(semester.id)}`);
    }
    // The select is rebuilt from the plan on every render rather than only at
    // mount: the stored plan may name a term this build has dropped, and the
    // control has to agree with the week beside it.
    renderSemesterOptions();
    // ONE ACCENT ON SCREEN, AND ON THE RIGHT ACTION (§8's One-Job-Accent).
    // "Legg til emne" is the primary action of a plan that EXISTS. With no plan
    // it is the secondary route — PRODUCT §1.1 ranks programme + kull first — and while
    // it kept the accent there, the loudest thing on the empty page was the
    // path the mandate ranks second, over an empty-state card whose own primary
    // was grey paper. The card takes the accent back for that one state.
    const hasPlan = plan.program !== undefined || plan.courses.length > 0;
    elements.addCourseBtn.classList.toggle("np-btn--primary", hasPlan);
  }

  /** Live catalog credits win; the study plan's own figure is the fallback (B9.1). */
  function creditsOf(state: PlanCourseState): number | null {
    const live = state.bundle?.details?.credits;
    if (live != null) return live;
    return state.course.credits ?? null;
  }

  /**
   * The course has a timetable with entries for this programme, and none fall
   * in the planned semester — so DR-10 excludes it from the total. An *absent*
   * timetable is unknown, not off-semester.
   */
  function isOffSemester(state: PlanCourseState): boolean {
    const timetable = state.bundle?.timetable;
    if (!timetable) return false;
    if (entriesForProgram(timetable, plan.program?.code).length === 0) return false;
    return semesterEntries(state.bundle).length === 0;
  }

  /* --- The clock ---------------------------------------------------------
     The minute tick, the now marker and the Uke/Liste pair all belong to
     `week` now. What stays here is the STAMP it watches: both dates are in it,
     because the week's column comes from the local weekday and the exam
     countdowns from the calendar date in Oslo. In Norway they roll together;
     elsewhere they do not, and the tick fires on whichever moves first. */

  /** Today as a weekday number (1 = mandag), or `null` at the weekend. */
  function todayWeekday(): number | null {
    if (!inTeachingWeek()) return null;
    const day = new Date().getDay();
    return day >= 1 && day <= 6 ? day : null;
  }

  /**
   * Is the page open inside a week the semester actually teaches?
   *
   * This is the question the drawn week's dates depend on, and nothing asked
   * it. `weekdayDates(new Date())` ran unconditionally, so through the whole
   * planning window — from the moment a student can plan until teaching starts,
   * which is precisely when this tool is used — the header read `MAN 27 … FRE
   * 31` over blocks that every one of them runs `uke 34–47`. Every block on
   * screen was false under its own date, and the page said nothing.
   *
   * `weekDates.ts` defends dating the week for the case where one block skips
   * one week; a date numeral is a claim about which Monday a column is, and
   * that claim is true *inside* the teaching period. Outside it there is no
   * Monday to name — the week is a pattern and nothing else — so the numerals
   * come off and the context line says which thing you are looking at.
   */
  function inTeachingWeek(): boolean {
    const weeks = currentSemester()?.teachingWeeks;
    if (!weeks || weeks.length === 0) return false;
    return weeks.includes(isoWeekNumber(new Date()));
  }

  /**
   * What "today" the page is drawn for — what `tickNow` watches for a change.
   *
   * BOTH dates are in it: the week's row comes from the local weekday and the
   * exam countdowns from the calendar date in Oslo. In Norway they roll
   * together; elsewhere they do not, and this fires on whichever moves first.
   */
  function todayStamp(): string {
    return `${todayInOslo()}|${todayWeekday()}`;
  }

  // --- Programme / kull / retning: the profile panel ----------------------
  //
  // Those three describe the STUDENT and live in the profile panel, which the
  // topbar opens from every page. The semester describes the PLAN and is this
  // page's own control, a few lines up. What follows are the *contextual*
  // openers — the week's studieretning question and the empty-state cards —
  // which appear only when the week has nothing else in it; each one sends the
  // student to the panel with focus already on the control that answers it,
  // rather than to a settings surface they then have to read.

  // --- Studieretning question --------------------------------------------

  /**
   * The one open question the week is waiting on, whatever its shape.
   *
   * All shapes get the same treatment for the same reason: the answer belongs
   * *on* the primary surface, not in a side panel while the grid renders as a
   * failure. The studieretning is chosen in the profile panel, so its question
   * renders as a sentence + a button that opens it, not inline chips.
   */
  interface WeekQuestion {
    title: string;
    note: string;
    action: { label: string; run: () => void } | null;
    /** What the week frame shows in place of a grid. */
    weekMessage: string;
  }

  function weekQuestion(): WeekQuestion | null {
    const program = plan.program;
    const label = semesterLabel(currentSemester());

    // NTNU publishes no study plan for this programme at all — 5 of 31 sampled
    // programmes have none at 2026, 2025 or 2024. Only the `not-found` outcome:
    // `error` is a fetch that failed, which is not NTNU's publication fact.
    if (program && studyPlanOutcome.kind === "not-found") {
      const note = `NTNU publiserer ingen studieplan for ${program.name}. Legg til emnene du tar selv.`;
      return {
        title: "Fant ingen studieplan",
        note,
        action: { label: "Legg til emne", run: () => openAddFromQuestion() },
        weekMessage: note,
      };
    }

    if (program && periodMissing) {
      const note = `Studieplanen for kull ${program.cohort} har ingen periode for ${label} ennå. Legg til emnene du tar selv, eller bytt semester.`;
      return {
        title: "Ingen periode i studieplanen",
        note,
        action: { label: "Legg til emne", run: () => openAddFromQuestion() },
        weekMessage: note,
      };
    }

    // The period exists and names nothing at all. Without this it rendered like
    // a normal period — "0 av 30 sp", no rows, no sentence — indistinguishable
    // from a network failure. `empty` comes from `classifyPeriod`.
    if (program && periodCourses?.empty === true) {
      const note = `Studieplanen for kull ${program.cohort} oppgir ingen emner for ${label}. Legg til emnene du tar selv.`;
      return {
        title: "Ingen emner i studieplanen",
        note,
        action: { label: "Legg til emne", run: () => openAddFromQuestion() },
        weekMessage: note,
      };
    }

    const pending = periodCourses?.pendingChoice ?? null;
    if (pending && pending.directions.length > 0) {
      const deadline = pending.deadlineDate
        ? `Studieplanen viser frist ${formatShortDate(pending.deadlineDate)}. `
        : "";
      const prompt = "Velg studieretning i profilen, så fylles ukeplanen ut med en gang.";
      return {
        title: pending.name,
        note: `${deadline}${prompt}`,
        // The button names the ANSWER, not the surface it lives on, and the
        // panel opens with focus on the select — so the student presses one
        // control and the next thing under their hand is the one that closes
        // the question.
        action: { label: "Velg studieretning", run: () => openStudieinfo("direction") },
        weekMessage: prompt,
      };
    }

    // A period that is elective by design (zero `O` courses, eight electives).
    // Nothing is wrong and nothing is missing — the student has not chosen yet.
    const pool = availablePool();
    const noCourses = activeCourses(plan).length === 0;
    if (program && noCourses && periodCourses !== null && pool.length > 0) {
      return {
        title: `Studieplanen din for ${label} er valgfri`,
        note: `${pool.length} ${pool.length === 1 ? "emne" : "emner"} å velge mellom.`,
        action: { label: "Velg emner", run: () => openAddFromQuestion() },
        weekMessage: "Velg emner fra studieplanen over, så fylles ukeplanen ut med en gang.",
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
    // An `<h2>` with no text is still a heading to a screen reader, announced
    // as an empty level-2 landmark in the middle of the page. Some questions
    // carry only a note, so the heading has to be able to not exist.
    elements.directionTitle.textContent = question.title;
    elements.directionTitle.hidden = question.title.trim() === "";
    elements.directionNote.textContent = question.note;

    questionAction = question.action?.run ?? null;
    elements.directionActions.hidden = question.action === null;
    if (question.action) elements.directionButton.textContent = question.action.label;
  }

  elements.directionButton.addEventListener("click", () => questionAction?.());

  // --- Add-course dialog ---------------------------------------------------
  //
  // ONE ADD SURFACE. Every route into adding a course — the standing button at
  // the foot of the Emner column, the week's empty-state cards, the elective
  // period's "Velg emner" — opens `addCourse.ts`'s dialog, which searches the
  // whole catalog and stays open for multiple adds. The study plan is a FACET
  // inside it rather than a door of its own beside it; the two callbacks below
  // are the whole of what this page tells it about the study plan.
  //
  // `addCourseDeps` is mutated in place rather than re-passed when the catalog
  // index (still loading at mount) arrives — see addCourse.ts's header for why
  // that is safe without re-mounting the dialog. The callbacks are read at call
  // time for the same reason, so a study plan that lands after the dialog was
  // built is picked up on its next open.
  const addCourseDeps: AddCourseDeps = {
    store,
    index: null,
    // The WHOLE choice pool, not `availablePool()`'s pool-minus-plan: a facet's
    // count names what it shows, and a row must not disappear from under the
    // button that was just pressed. Obligatory courses are left out — the
    // student is already enrolled in those, and the gap is what this is for.
    studyPlanCodes: () => (periodCourses?.choice ?? []).map((c) => c.code),
    // Scoped to the study plan whenever there IS one. It used to open scoped
    // only while the plan was short of 30 sp; the credit total is deleted
    // (PRODUCT D17), and a programme's own courses are the right first offer
    // whether or not the student has reached a full load.
    openScoped: () => plan.program !== undefined,
  };
  const addCourseDialog: AddCourseHandle = mountAddCourse(addCourseDeps, lifeSignal);

  /**
   * The study plan's choice pool for this period, minus what is already in the
   * plan — feeds the week question's count and copy only ("8 emner å velge
   * mellom"), where what is left to choose from is the whole point. The add
   * dialog's facet reads the pool WHOLE, a few lines up. Memoised on (period,
   * plan courses): a late-year pool runs to 300+ entries.
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

  /** The week question's button: opens the add-course dialog. */
  function openAddFromQuestion(): void {
    addCourseDialog.open();
  }

  elements.addCourseBtn.addEventListener("click", () => addCourseDialog.open());

  // --- Course bundle state (timetable + details per active course) -------

  const courseStates = new Map<string, PlanCourseState>();
  /** Which semester the held bundles were fetched for — they are year-scoped. */
  let bundlesForSemester = plan.semesterId;

  function syncCourseStates(): void {
    // Bundles are dropped on a semester switch because the ENTRIES are filtered
    // against the new semester's teaching weeks — not because the fetch is
    // year-scoped. It is not: `?year=` is a documented no-op upstream.
    if (bundlesForSemester !== plan.semesterId) {
      bundlesForSemester = plan.semesterId;
      for (const state of courseStates.values()) {
        state.bundle = null;
        state.loading = false;
      }
    }
    const seen = new Set<string>();
    const active = activeCourses(plan);
    const programCode = plan.program?.code ?? null;
    // One assignment for the whole plan, from the SET of codes — see hues.ts.
    // Per-course `hueForIndex(index)` here is what made every add and drop
    // repaint the courses after it.
    const hues = assignHues(active.map((course) => course.code));
    active.forEach((course) => {
      seen.add(course.code);
      const hueVar = hues.get(course.code) ?? "--muted";
      const existing = courseStates.get(course.code);
      if (existing) {
        existing.hueVar = hueVar;
        existing.course = course;
        // The programme can change under a persisted state, and grid group
        // narrowing depends on its code.
        existing.programCode = programCode;
      } else {
        courseStates.set(course.code, {
          course,
          hueVar,
          // A course previewed in the add dialog already has its bundle in
          // `fetchCourseBundle`'s module-level memo — this fetch is free.
          bundle: null,
          loading: false,
          programCode,
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
   * The plan itself and nothing else: courses being taken, plus programme
   * courses the student dropped (grayed — PRODUCT §1.3). The study plan's choice pool
   * deliberately does not live here; at 30–60 rows it would bury the six
   * courses this list exists to show.
   *
   * A row is identity and nothing else — hue dot, code, name, credits.
   * Vurderingsform lives in the exam list; the status line, the retry and the
   * Dropp/Fjern button live in the settings modal the row opens.
   */
  function renderCourseRows(): void {
    const ordered = [...plan.courses].sort((a, b) => {
      if (a.source !== b.source) return a.source === "program" ? -1 : 1;
      return 0;
    });

    sharedCourseRows(
      elements.courseRows,
      ordered.map((course) => {
        const state = courseStates.get(course.code);
        return {
          code: course.code,
          name: state?.bundle?.details?.courseName ?? course.name,
          hueVar: state?.hueVar ?? "--muted",
          credits: state ? creditsOf(state) : (course.credits ?? null),
          dropped: course.source === "program" && course.dropped === true,
          // A course the week cannot draw gets ONE mark; the sentence is in the
          // modal this row opens.
          needsAttention:
            notTaughtIn(course.code) !== null ||
            (state !== undefined && isOffSemester(state)) ||
            (state?.bundle?.errors.length ?? 0) > 0,
        };
      }),
      { onOpenSettings: openCourseSettings },
    );
  }

  // --- Render: "Fra studieplanen" panel (design §8) -----------------------

  interface PlanPanelGroup {
    name: string | null;
    /** Verbatim study-plan prose (DR-5) — never paraphrased. */
    description: string | null;
    courses: ClassifiedCourse[];
  }

  /**
   * The study plan's choice courses grouped by their verbatim group title,
   * preserving order. Obligatory courses are prefilled already and never
   * surface here — this panel is the *offered* pool with the group prose that
   * says how to choose (DR-5).
   */
  function planPanelGroups(): PlanPanelGroup[] {
    const groups: PlanPanelGroup[] = [];
    const byKey = new Map<string, PlanPanelGroup>();
    for (const course of periodCourses?.choice ?? []) {
      const key = course.groupName ?? "";
      let group = byKey.get(key);
      if (!group) {
        group = { name: course.groupName, description: course.groupDescription, courses: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.courses.push(course);
    }
    return groups;
  }

  /** One offered course row: code · name · credits + a "Legg til"/"I planen"
   *  affordance. The in-plan word is DESIGN §8's mandated half of the pair and
   *  must be spelled the same way on every surface. */
  function buildPlanPanelRow(course: ClassifiedCourse): HTMLElement {
    const row = el("div", "planner-plan-row");

    const head = el("span", "planner-plan-row-head");
    head.append(el("span", "np-data", course.code));
    head.append(el("span", "planner-plan-row-name", course.name));
    row.append(head);

    const inPlan = store.hasCourse(course.code);
    const action = el("button", "np-btn planner-plan-add", inPlan ? "I planen" : "Legg til");
    action.type = "button";
    action.disabled = inPlan;
    if (!inPlan) {
      action.setAttribute("aria-label", `Legg til ${course.code} i planen`);
      action.addEventListener("click", () =>
        store.addCourse({
          code: course.code,
          name: course.name,
          version: course.version,
          credits: course.credits,
        }),
      );
    }
    row.append(action);

    const meta = el("span", "planner-plan-row-meta");
    if (course.credits != null) {
      meta.append(el("span", "np-data", `${formatCreditNumber(course.credits)} sp`));
    }
    row.append(meta);

    return row;
  }

  /**
   * The collapsible "Fra studieplanen" panel: the study plan's choice groups,
   * each with its verbatim prose (DR-5) and courses. Shown only when a
   * programme is set AND the resolved period has choice groups.
   */
  function renderPlanPanel(): void {
    const groups = plan.program ? planPanelGroups() : [];
    if (groups.length === 0) {
      elements.planPanel.hidden = true;
      elements.planPanelBody.replaceChildren();
      return;
    }
    elements.planPanel.hidden = false;
    elements.planPanelBody.replaceChildren();
    for (const group of groups) {
      const groupEl = el("div", "planner-plan-group");
      if (group.name) groupEl.append(el("p", "np-kicker planner-plan-group-name", group.name));
      if (group.description) {
        groupEl.append(el("p", "np-note planner-plan-group-desc", group.description));
      }
      for (const course of group.courses) groupEl.append(buildPlanPanelRow(course));
      elements.planPanelBody.append(groupEl);
    }
  }

  // --- Render: grid + exams + pre-publish fallback ------------------------

  /**
   * The planner index with every row's exams narrowed to the planned semester's
   * `fromDate`…`examFinalDate` window. Memoised: it is one pass over ~5 500
   * rows. The exam list reaches into the index itself, so the filter has to be
   * baked in rather than passed per call.
   */
  let examIndexMemo: { semesterId: string; index: PlannerIndex } | null = null;

  function examIndexForSemester(): PlannerIndex | null {
    if (!plannerIndex) return null;
    if (examIndexMemo?.semesterId === plan.semesterId) return examIndexMemo.index;
    const index = indexForSemester(plannerIndex, plan.semesterId, currentExamWindow());
    examIndexMemo = { semesterId: plan.semesterId, index };
    return index;
  }

  /**
   * One course's row in the RAW index — the un-narrowed one, so `offeredYears`
   * (element 5) is readable. Tells "we could not fetch this" from "not taught
   * this year".
   */
  function indexRowFor(code: string): PlannerIndexCourse | undefined {
    if (!plannerIndex) return undefined;
    if (!indexByCodeMemo) {
      indexByCodeMemo = new Map(plannerIndex.courses.map((c) => [c[0], c]));
    }
    return indexByCodeMemo.get(code);
  }

  /**
   * The catalog year and the course's last taught year, when this year's
   * catalog does not carry the course — the same test `/emner/` makes, against
   * the CATALOG's canonical year, not the plan semester's. `null` while the
   * index has not landed: "ikke undervist" is not something to guess at.
   */
  function notTaughtIn(code: string): { year: number; lastYear: number } | null {
    const catalogYear = plannerIndex?.year;
    const offered = indexRowFor(code)?.[5];
    const lastYear = offered?.[0];
    if (catalogYear === undefined || !offered || lastYear === undefined) return null;
    if (offered.includes(catalogYear)) return null;
    return { year: catalogYear, lastYear };
  }

  /* --- The week's horizontal scroll (A4) ----------------------------------
     The edge mask, the resize pair and the once-per-mount scroll to the first
     day that HAS something all belong to `week`. They are properties of a
     drawn week rather than of a plan, and three surfaces draw one. */

  /**
   * WHAT THE WEEK COULD NOT DRAW, and nothing else.
   *
   * This slot used to hold the verdict — a collision count, a load chip, and
   * three flavours of "the check could not run". The verdict is deleted
   * (PRODUCT D17): the week is drawn, it is not judged.
   *
   * What survives is DR-8's floor, and it is not decoration. A course whose
   * timetable never arrived is simply ABSENT from the drawn week, which is
   * pixel-identical to a course with no teaching — so the week has to say how
   * many of the plan's courses it is missing. Deleting this line would make a
   * failed fetch look like a free Tuesday.
   */
  function renderWeekGaps(grid: WeekRenderResult | null, loading: boolean): void {
    const host = elements.gridStatus;
    host.replaceChildren();
    // `planner-verdict` is the layout class and must survive: this used to
    // assign `className` outright, which meant the page's own rule for the
    // element applied for exactly as long as it took the first render to run.
    host.className = "planner-verdict";
    // NOTHING WHILE LOADING. The week's own skeleton is directly below this and
    // already says a timetable is being fetched.
    if (loading) return;
    if (grid?.state !== "grid") return;
    const missing = grid.incompleteCourses.length;
    if (missing === 0) return;
    // Muted, not red: a gap is not a collision, and there is no collision ink
    // left on this page to confuse it with.
    host.append(
      el(
        "span",
        "planner-chip is-unknown",
        `mangler timeplan for ${missing} ${missing === 1 ? "emne" : "emner"}`,
      ),
    );
  }

  /**
   * Reloads every course bundle from scratch. The module-level fetch memo is
   * cleared first, so a real refetch happens rather than a cached failure
   * replayed. Wired to the "Prøv igjen" fallback.
   */
  function retryBundles(): void {
    clearCourseBundleMemo();
    for (const state of courseStates.values()) {
      state.bundle = null;
      state.loading = false;
    }
    // loadBundles flips the reset states to loading and paints the skeleton
    // itself, so there is no need to render the empty grid first.
    void loadBundles();
  }

  /**
   * Reloads ONE course's bundle — the recovery a partial failure needs, which
   * `retryBundles` cannot offer because it is mounted in a branch requiring
   * every bundle to be empty. No memo clear: `fetchCourseBundle` drops a bundle
   * carrying failures as it settles, so this really refetches.
   */
  function retryCourse(code: string): void {
    const state = courseStates.get(code);
    if (!state) return;
    state.bundle = null;
    state.loading = false;
    renderCourseRows();
    void loadBundles();
  }

  function renderGridAndExams(): void {
    const semester = currentSemester();
    const states = orderedActiveStates();
    // "NOTHING IS IN FLIGHT" IS NOT "EVERY COURSE HAS ANSWERED", and the
    // second question is the one everything downstream is really asking: the
    // skeleton, the exam list's provisional state, and `weekView`'s `settle`,
    // which releases the frame's height reservation on it. This answered the
    // first, and so missed two windows on every cold load with a programme.
    //
    //   - A course the study plan just added has `bundle === null` AND
    //     `loading === false` until `loadBundles` reaches it.
    //   - A programme's courses are not states at all until its plan resolves,
    //     so "every course has answered" is trivially true of an empty set and
    //     stays true of a half-derived one.
    //
    // Both told the week it was final while most of it had not been asked for,
    // and the lease came off over a provisional grid. `bundle === null` is
    // exactly "no answer yet" and cannot be wedged true by an upstream that
    // said no: a failed fetch leaves a bundle whose `timetable` is null (see
    // `failed` below). The programme guard on the second is what keeps a plan
    // with no programme settling at all, since `loadPeriodCourses` leaves the
    // outcome pending forever in that case.
    const derivationPending = plan.program !== undefined && studyPlanOutcome.kind === "pending";
    const anyLoading = derivationPending || states.some((s) => s.loading || s.bundle === null);
    const question = weekQuestion();

    // Week-only narrowing (NOT programme-narrowed): the grid's own
    // `applyGroupSelection` owns that, so an explicit cross-programme parallel
    // pick still draws. See `semesterWeekEntries`.
    const filteredStates: PlanCourseState[] = states.map((s) => {
      if (!s.bundle?.timetable) return s;
      return { ...s, bundle: { ...s.bundle, timetable: semesterWeekEntries(s.bundle) } };
    });

    // The four empty/fallback states (REWORK §3). Never a blank grid: always
    // the course list + exams + a card naming the one next action.
    const published = semester?.timetablePublished ?? true;
    const anyBundlesLoaded = states.some((s) => s.bundle !== null);
    // A *failed* fetch leaves `timetable === null`; a successful-but-empty one
    // leaves `[]`. Coalescing the two showed the "publiseres" copy over a
    // network failure. Checked on the RAW states, before any narrowing.
    const failed = states.some((s) => s.bundle !== null && s.bundle.timetable === null);
    // Every loaded bundle has zero entries for this programme this semester.
    // Computed from the programme-narrowed `semesterEntries` (NOT the grid's
    // week-only `filteredStates`), so the fallback-card decision is unchanged
    // by the grid path no longer pre-narrowing by programme.
    const empty =
      anyBundlesLoaded &&
      states.every((s) => s.bundle === null || semesterEntries(s.bundle).length === 0);

    // NO `noProfile` BRANCH. A plan-less planner is not a planner with a card
    // in the middle of it any more: the page's own first-run screen replaces
    // this whole surface, gated on `html:not([data-plan])` before the first
    // frame. Keeping a week card for the same state would be a second answer to
    // the same question, drawn under a bar the gate has already hidden.
    const showFallback = states.length > 0 && !anyLoading && (!published || empty);

    let gridResult: WeekRenderResult | null = null;
    if (showFallback && semester) {
      // Ordered by severity, not by narrative. A question used to win over both
      // branches below, so a student who lost connectivity was told to pick a
      // studieretning with no "Prøv igjen" anywhere. Neither is answerable by
      // the student. The question is not lost: `#planner-direction` renders it
      // in its own panel directly above this frame.
      if (failed) {
        // State 3: a fetch failed. NEVER the "publiseres" copy — offer a retry.
        week.card((card) => {
          // `.np-hint`, like the card's other branches: DESIGN §3 gives
          // sentences to `.np-hint` and mono fragments to `.np-note`.
          card.append(el("p", "np-hint planner-week-card-hint", "Fikk ikke hentet timeplanen."));
          const retry = el("button", "np-btn", "Prøv igjen");
          retry.type = "button";
          retry.addEventListener("click", retryBundles);
          card.append(retry);
        });
      } else if (!published) {
        // State 2: timetable not published yet (unchanged copy).
        week.message(
          `Timeplan for ${semesterLabel(semester)} publiseres vanligvis i ${publishMonthFor(semester.id)}. Kom tilbake da.`,
        );
      } else if (question) {
        // A studieretning/elective/period question owns the empty week — its
        // sentence, not a fallback card, is what the student acts on.
        week.message(question.weekMessage);
      } else {
        // State 4: published, courses exist, none taught this term.
        week.card((card) => {
          card.append(
            el(
              "p",
              "np-hint planner-week-card-hint",
              `Ingen av emnene dine undervises i ${semesterLabel(semester)}.`,
            ),
          );
          // The recovery is the SEMESTER, and the semester is a control on
          // this page now — so the button hands the student to it rather than
          // opening a settings panel that no longer holds the answer. (It used
          // to read "Endre studieinfo" and open the modal the semester select
          // then lived inside.)
          const change = el("button", "np-btn", "Bytt semester");
          change.type = "button";
          change.addEventListener("click", () => {
            elements.semesterSelect.focus();
          });
          card.append(change);
        });
      }
    } else {
      // ONE call, whichever view is on screen. Which courses could not be drawn
      // and why, the conflict count and the "velg din gruppe" links are facts
      // about the WEEK rather than about which way round it is drawn, so
      // `weekView` collects them through `weekNotes` and hands them back with
      // the block count.
      //
      // `onChoiceClick` is wired at the mount, not here: a note saying
      // "EXPH0300 har 14 grupper" is a link into the picker, and it used to be
      // passed by one branch only.
      gridResult = week.render(filteredStates, {
        teachingWeeks: currentSemester()?.teachingWeeks ?? [],
        // Which calendar year those week numbers belong to, so the picker can
        // name each week's Monday and a chosen week can date its own columns.
        ...(semesterYear(plan.semesterId) !== null
          ? { year: semesterYear(plan.semesterId) as number }
          : {}),
        loading: anyLoading,
        pendingChoiceMessage: question?.weekMessage ?? null,
      });
    }

    // `anyLoading` stays in: the list reads `bundle.details.exams` to tell an
    // ordinary sitting from an "Utsatt" one, so a list painted before the
    // bundles land really is provisional. `plannerIndexFailed` is the half that
    // had to come out: with the index dead, waiting never ends.
    const examLoading =
      anyLoading || (states.length > 0 && plannerIndex === null && !plannerIndexFailed);

    // The shipped index only carries this academic year's exam dates. For a
    // semester beyond it, the list's "Ingen eksamensdatoer funnet ennå" is a
    // finding reported by something that never looked. A *failed download* is
    // not that — it is our own artifact, and saying NTNU published nothing
    // would report our network as an upstream fact, so it takes its own branch.
    const examUncovered =
      !examLoading &&
      !plannerIndexFailed &&
      activeCourses(plan).length > 0 &&
      !indexCoversSemester(plannerIndex, plan.semesterId);

    // Nothing reads what these return any more: the exam head's own verdict
    // ("2 eksamener samme dag") went with the rest (PRODUCT D17), so what is
    // left is the list itself and the two sentences that stand in for it.
    if (plannerIndexFailed && states.length > 0) {
      renderExamMessage(elements.examList, "Fikk ikke hentet eksamensdatoene.", {
        label: "Prøv igjen",
        run: retryIndex,
      });
    } else if (examUncovered) {
      renderExamMessage(
        elements.examList,
        `Eksamensdatoer er ikke publisert for ${semesterLabel(currentSemester())} ennå.`,
      );
    } else {
      renderExamList(
        elements.examList,
        states,
        plan.semesterId,
        examIndexForSemester(),
        currentExamWindow(),
        todayInOslo(),
        { loading: examLoading },
      );
    }

    renderWeekGaps(gridResult, anyLoading);
    // The exam list's lease, handed back the moment the list stops waiting —
    // whichever branch answered, including the two that answer with one
    // sentence. Held longer, an apology sits atop five courses of reserved air.
    if (!examLoading) delete elements.examList.dataset.reserve;
    // The week's own edge fade, once-per-mount scroll and reservation lease are
    // released by `week.render`. The three message branches above draw no week,
    // so they release the lease here instead — a card or a sentence is shorter
    // than the week it stands in for, and a reservation left over one is a
    // permanent hole.
    if (gridResult === null && !anyLoading) week.settle();
  }

  // --- Top-level render orchestration --------------------------------------

  /**
   * Loads `/data/search-index.json` — our own build artifact, so a failure is
   * never worded as an NTNU fact. A rejection is not memoised, so `retryIndex`
   * genuinely refetches.
   */
  function loadIndex(): void {
    loadPlannerIndex()
      .then((index) => {
        plannerIndex = index;
        plannerIndexFailed = false;
        indexByCodeMemo = null;
        // The add-course dialog searches this same index (mutated in place);
        // it renders "henter emner …" until it is set.
        addCourseDeps.index = index;
        addCourseDeps.indexFailed = false;
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
        renderCourseRows(); // "ikke undervist i {year}" needs `offeredYears`
      })
      .catch(() => {
        // Not swallowed: the exam column used to spin forever and the add dialog
        // forever said "Henter emner …".
        plannerIndexFailed = true;
        addCourseDeps.indexFailed = true;
        renderGridAndExams();
      });
  }

  /** The exam panel's "Prøv igjen" — back to the loading state, then refetch. */
  function retryIndex(): void {
    plannerIndexFailed = false;
    addCourseDeps.indexFailed = false;
    renderGridAndExams();
    loadIndex();
  }

  /**
   * A SECTION APPEARS WITH ITS ROWS. At zero courses Eksamener printed its
   * heading over "Legg til emner for å se eksamensdatoer." and the load track
   * printed "0 av 30 sp" over an empty rail — two headings and two apologies
   * for content the student has not created yet.
   *
   * This is a real state rather than a transitional one: a programme whose
   * study plan has no published period lands in it (`PROGRAM_MISSING_HINT`)
   * and stays there until courses are added by hand.
   *
   * Emner is the exception and stays whenever the page is up, because it is
   * where the first course is added — it keeps its heading and its button, and
   * lost only its own "Ingen emner i planen ennå." line.
   *
   * `hidden` is right here, unlike on `.planner-load` itself: these must NOT
   * stay laid out. The strip's own emptiness is a state class for the opposite
   * reason (it has to keep occupying its 15px so the rows below it do not move
   * when the first segment lands), so it is hidden as a whole here and left
   * alone the rest of the time.
   */
  /**
   * WHICH STUDY PLAN THE PREFILL CAME FROM, when it is not the one asked for.
   *
   * The rest of DR-8's provenance line is deleted with the verdict (PRODUCT
   * D17). This clause is not decoration and stays for the same reason the
   * week's own gap line does: `findProgramPlanUncached` walks back up to two
   * cohorts on a 404, so kull 2026 could be handed a confident five-course
   * week off the 2024 curriculum under a title reading «Kull 2026». A prefill
   * from a different cohort's plan has to say so or it is a wrong answer
   * delivered as a right one.
   *
   * Silent while the fetch is in flight, and silent when the plan asked for is
   * the plan that came back — which is the overwhelming majority of loads.
   */
  function renderPlanNote(): void {
    const host = elements.planNote;
    const program = plan.program;
    let text = "";
    if (program) {
      if (studyPlanOutcome.kind === "found" && studyPlanOutcome.year !== program.cohort) {
        text = `Studieplan for kull ${studyPlanOutcome.year}, det finnes ingen egen plan for kull ${program.cohort}.`;
      } else if (studyPlanOutcome.kind === "error") {
        text = `Fikk ikke hentet studieplanen for ${program.code}.`;
      }
    }
    host.textContent = text;
    host.hidden = text === "";
  }

  function renderSectionPresence(): void {
    elements.examsSection.hidden = activeCourses(plan).length === 0;
  }

  function renderAll(): void {
    syncCourseStates();
    // First, because it decides whether the rest of this is even on screen: a
    // plan-less load is the first-run screen and nothing else.
    syncFirstRun();
    renderSectionPresence();
    renderBanner();
    renderPlanNote();
    renderDirectionQuestion();
    renderCourseRows();
    renderPlanPanel();
    renderGridAndExams();
  }

  async function loadBundles(): Promise<void> {
    const year = semesterYear(plan.semesterId);
    if (year === null) return;
    // The same generation token `loadPeriodCourses` has. Bundles are year- and
    // week-scoped and `syncCourseStates` clears every held bundle on a switch,
    // so without this a 26h fetch in flight when the student switches to 27h
    // lands afterwards and writes 2026 rooms into the 27h state — and
    // `bundle !== null` then hides it from `toLoad` for the rest of the load.
    const forSemester = plan.semesterId;

    const toLoad = orderedActiveStates().filter((s) => s.bundle === null && !s.loading);
    if (toLoad.length === 0) return;

    for (const state of toLoad) state.loading = true;
    renderGridAndExams();

    await Promise.all(
      toLoad.map(async (state) => {
        // `lifeSignal` (plus data.ts's 15 s cap) so a stalled socket does not
        // hold the page and a page swap cancels what is in flight. It is the
        // PAGE's signal, not the semester's, so it cannot replace the token.
        const bundle = await fetchCourseBundle(state.course.code, year, state.course.version, {
          signal: lifeSignal,
        });
        if (forSemester !== plan.semesterId) return; // superseded by a semester switch
        const current = courseStates.get(state.course.code);
        if (!current) return; // removed/dropped while loading
        current.bundle = bundle;
        current.loading = false;
        // Per course, not after `Promise.all`: one slow course used to withhold
        // the whole page even when every other bundle had landed.
        scheduleBundleRender();
      }),
    );

    scheduleBundleRender();
  }

  /** Coalesces the post-fetch re-renders that land in the same tick. */
  let bundleRenderQueued = false;

  function scheduleBundleRender(): void {
    if (bundleRenderQueued) return;
    bundleRenderQueued = true;
    queueMicrotask(() => {
      bundleRenderQueued = false;
      renderCourseRows();
      renderGridAndExams();
    });
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
    renderPlanNote();
    renderDirectionQuestion();
    renderPlanPanel();
    renderGridAndExams();
  }

  /**
   * (Re)fetches the study plan for `plan.program` and rebuilds `periodCourses`
   * (DR-5/DR-7), classifying through the chosen studieretning when there is
   * one. Also backfills display names the hash could not carry.
   *
   * The programme course set is derived from (semester, programme, kull,
   * studieretning) and MUST be re-derived whenever any of those change. Guarded
   * on "has program courses" instead, the prefill froze at whatever semester it
   * was first built in: a switch to spring kept all five autumn courses under a
   * green "30 av 30 sp". When the new period does not resolve the set is
   * *cleared* — an empty honest state beats a wrong confident one.
   */
  async function loadPeriodCourses(): Promise<void> {
    const program = plan.program;
    if (!program) {
      // Bumped HERE too, or an in-flight fetch for the programme we just
      // cleared still passes its own token guard and resurrects it — profile,
      // courses, title and hash all flipping back seconds after a program-less
      // link was opened. `findProgramPlan` can spend three round trips on a 404
      // ladder, so the window is real.
      ++studyPlanFetchToken;
      periodCourses = null;
      periodMissing = false;
      programDerivedFor = null;
      studyPlanOutcome = { kind: "pending" };
      renderPlanDependents();
      return;
    }
    const token = ++studyPlanFetchToken;
    studyPlanOutcome = { kind: "pending" };
    const result = await findProgramPlan(program.code, program.cohort);
    if (token !== studyPlanFetchToken) return; // superseded by a newer programme/kull pick
    // Belt and braces on the same race: the plan may have moved on without the
    // token changing (a store write that did not come through here).
    const live = plan.program;
    if (
      !live ||
      live.code !== program.code ||
      live.cohort !== program.cohort ||
      (live.direction?.code ?? null) !== (program.direction?.code ?? null)
    ) {
      return;
    }
    if ("kind" in result) {
      periodCourses = null;
      periodMissing = false;
      studyPlanOutcome = result.kind === "not-found" ? { kind: "not-found" } : { kind: "error" };
      renderPlanDependents();
      return;
    }
    // The year the 404 step-back actually landed on; the provenance line says
    // which.
    studyPlanOutcome = { kind: "found", year: result.year };

    const resolved = resolvePeriodFor(
      result.plan,
      plan.semesterId,
      program.cohort,
      program.direction?.code,
    );
    periodCourses = resolved.courses;
    periodMissing = resolved.courses === null;

    // Backfill names a hash could not carry. Deliberately does *not* return:
    // the derivation key excludes display names, so the change listener would
    // skip the re-entry and the prefill below would never run. `savePlan`
    // dispatches synchronously, so `plan` is already corrected when it returns.
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

  /**
   * Skipped when nothing the study plan depends on changed: `onPlanChange` used
   * to refetch unconditionally, so picking a kull cost three sequential round
   * trips and every Dropp/Legg tilbake cost another.
   */
  let lastDerivationKey: string | null = null;

  /**
   * Paints `next` onto the page: the in-memory `plan`, both rendered views,
   * and — if the derivation key moved — a re-fetch of the study plan.
   */
  function applyPlanUpdate(next: PlanState): void {
    plan = next;
    renderAll();
    void loadBundles();
    const key = derivationKey();
    if (key !== lastDerivationKey) {
      lastDerivationKey = key;
      void loadPeriodCourses();
    }
  }

  const unsubscribe = store.onPlanChange((next) => {
    applyPlanUpdate(next);
  });
  signal?.addEventListener("abort", unsubscribe);

  loadIndex();

  // First paint from the stored plan, then kick off fetches.
  renderAll();

  lastDerivationKey = derivationKey();
  await Promise.all([loadBundles(), loadPeriodCourses()]);
}
