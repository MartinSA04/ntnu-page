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
 *   not a list — its count/copy surfaces in the gap line and the "period is
 *   elective" question, and the actual picking happens in the add-course
 *   dialog's flat catalog search (`addCourse.ts`, Task 12), not on the surface.
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
import { groupOptions, resolveLectureDefaults } from "../../lib/planner/groups.js";
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
import { type AddCourseDeps, type AddCourseHandle, mountAddCourse } from "./addCourse.js";
import { type CourseSettingsContext, mountCourseSettings } from "./courseSettings.js";
import { dayName, el, formatCreditNumber, formatCredits, formatShortDate } from "./dom.js";
import {
  collectExamInputs,
  type ExamRenderResult,
  renderExamList,
  renderExamMessage,
} from "./examList.js";
import { type GridRenderResult, renderGrid, renderGridMessage } from "./grid.js";
import {
  type ClassifiedCourse,
  findProgramPlan,
  isSuspiciousPrefill,
  type PeriodCourses,
  prefillCredits,
  resolvePeriodFor,
} from "./programPlan.js";
import { mountStudieinfo, publishMonthFor } from "./studieinfo.js";
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

/**
 * One row of the study plan's own choice pool (`availablePool` below) — used
 * only for the gap line's/question's counts and copy now. The actual add
 * surface is the add-course dialog's flat catalog search (Task 12).
 */
interface PickerRow {
  code: string;
  name: string;
  version: string;
  credits: number | null;
  groupName: string | null;
}

/** Full credit load for one semester — the denominator in "X av 30 sp". */
const FULL_LOAD_CREDITS = 30;

/** The grid's hour rail, in px (`3rem` in the page's `.planner-grid`). Kept in view when scrolling to today. */
const RAIL_WIDTH_PX = 48;

interface PlannerElements {
  title: HTMLElement;
  contextLine: HTMLElement;
  linkNote: HTMLElement;
  creditLine: HTMLElement;
  creditNote: HTMLElement;
  tabWeek: HTMLButtonElement;
  tabCourses: HTMLButtonElement;
  regions: HTMLElement;
  direction: HTMLElement;
  directionTitle: HTMLElement;
  directionNote: HTMLElement;
  directionActions: HTMLElement;
  directionButton: HTMLButtonElement;
  othersToggle: HTMLButtonElement;
  dayStrip: HTMLElement;
  scrollHint: HTMLElement;
  gridFrame: HTMLElement;
  gridNotes: HTMLElement;
  gridStatus: HTMLElement;
  examList: HTMLElement;
  examStatus: HTMLElement;
  courseRows: HTMLElement;
  gapLine: HTMLElement;
  gapText: HTMLElement;
  gapButton: HTMLButtonElement;
  addCourseBtn: HTMLButtonElement;
  planPanel: HTMLDetailsElement;
  planPanelBody: HTMLElement;
  provenance: HTMLElement;
}

function getElements(): PlannerElements | null {
  const byId = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;

  const found = {
    title: byId<HTMLElement>("planner-title"),
    contextLine: byId<HTMLElement>("planner-context-line"),
    linkNote: byId<HTMLElement>("planner-link-note"),
    creditLine: byId<HTMLElement>("planner-credit-line"),
    creditNote: byId<HTMLElement>("planner-credit-note"),
    tabWeek: byId<HTMLButtonElement>("planner-tab-week"),
    tabCourses: byId<HTMLButtonElement>("planner-tab-courses"),
    regions: byId<HTMLElement>("planner-regions"),
    direction: byId<HTMLElement>("planner-direction"),
    directionTitle: byId<HTMLElement>("planner-direction-title"),
    directionNote: byId<HTMLElement>("planner-direction-note"),
    directionActions: byId<HTMLElement>("planner-direction-actions"),
    directionButton: byId<HTMLButtonElement>("planner-direction-btn"),
    othersToggle: byId<HTMLButtonElement>("planner-others-toggle"),
    dayStrip: byId<HTMLElement>("planner-day-strip"),
    scrollHint: byId<HTMLElement>("planner-scroll-hint"),
    gridFrame: byId<HTMLElement>("planner-grid-frame"),
    gridNotes: byId<HTMLElement>("planner-grid-notes"),
    gridStatus: byId<HTMLElement>("planner-grid-status"),
    examList: byId<HTMLElement>("planner-exam-list-host"),
    examStatus: byId<HTMLElement>("planner-exam-status"),
    courseRows: byId<HTMLElement>("planner-course-rows"),
    gapLine: byId<HTMLElement>("planner-gap-line"),
    gapText: byId<HTMLElement>("planner-gap-text"),
    gapButton: byId<HTMLButtonElement>("planner-gap-btn"),
    addCourseBtn: byId<HTMLButtonElement>("planner-add-course-btn"),
    planPanel: byId<HTMLDetailsElement>("planner-plan-panel"),
    planPanelBody: byId<HTMLElement>("planner-plan-body"),
    provenance: byId<HTMLElement>("planner-provenance"),
  };

  for (const value of Object.values(found)) {
    if (!value) return null;
  }
  return found as PlannerElements;
}

/**
 * Today in Oslo as "YYYY-MM-DD". `new Date().toISOString().slice(0, 10)` is
 * the UTC date, which is *yesterday* between local midnight and 01:00 CET /
 * 02:00 CEST — long enough to put "i dag" on the exam the student sat
 * yesterday and leave this morning's exam with no countdown (exams-2). The
 * week already uses local time (`new Date().getDay()`), so the two surfaces
 * also disagreed with each other in that window.
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
  // One AbortSignal for everything this page mounts (studieinfo + popover) and
  // binds, so it all tears down together on the next `astro:before-swap`. In
  // the no-signal path (some tests) it is a controller that never aborts.
  const lifeSignal = signal ?? new AbortController().signal;

  // The studieinfo modal owns all four plan choices (programme/kull/retning/
  // semester); the course-settings modal owns everything per-course — group
  // selection AND drop/remove (REWORK-2026-07-29 D1/D3). Both hang off the
  // single store this app owns — one mount each. Studieinfo opens from the
  // banner "Endre" button, the week's studieretning question, every empty-state
  // button, the OPEN_STUDIEINFO event (Layout chip) and the `?studieinfo` query
  // param handled at the end of mount; course settings from a course row and
  // from any block in the week or day view.
  const studieinfo = mountStudieinfo(
    { store, semesters, programOptions, defaultSemesterId },
    lifeSignal,
  );
  const courseSettings = mountCourseSettings(store, lifeSignal);

  /**
   * The material the course-settings modal opens on, for one course code.
   *
   * Keyed by CODE, not by a clicked block: both entrances — a course row in
   * the Emner list and a block in the week/day grid — reach the same course
   * the same way, and the row has no block to hand over (REWORK-2026-07-29
   * D1). That is the point of the rewrite: a course whose sessions were
   * swallowed by a pile, or which has no timetable at all, is now reachable.
   *
   * A course with no timetable yet still opens: it has no group picker, but it
   * does have credits, its status notes and its drop/remove action, and those
   * are exactly what a student wants from a course the week cannot draw. So
   * does a DROPPED programme course, which has no `PlanCourseState` at all
   * (`syncCourseStates` tracks the active courses only) — and it has to, since
   * "Legg tilbake" is now the modal's job (D3). `null` comes back only for a
   * code that is not in the plan at all.
   *
   * The picker lists the groups this student could plausibly be in, not every
   * group the course publishes all year: this semester's weeks, and — for the
   * øving/lab layer — the programme's own sections. EXPH0300 for an MTTK
   * student listed 44 rows across Trondheim, Gjøvik and Ålesund, which on a
   * phone put the Dropp/emneside actions ~1 000 px below the fold behind
   * seminar groups in another city; it now lists 17 (groups-4/groups-3).
   * `entriesForProgram` is a no-op for a course that never names the
   * programme, so an ordinary course still lists everything it has.
   *
   * A key the student picked *explicitly* is kept in the list whatever the
   * narrowing says — an explicit pick beats the programme filter in
   * `applyGroupSelection` (groups.ts), so the control that unticks it has to
   * stay reachable.
   */
  function buildCourseSettingsContext(code: string): CourseSettingsContext | null {
    const course = plan.courses.find((c) => c.code === code);
    if (!course) return null;
    const state = courseStates.get(code) ?? null;

    // The status sentences the course row used to concatenate into one
    // run-on meta line (D2). They live here now, one per line.
    const notes: string[] = [];
    const stale = notTaughtIn(code);
    if (stale) {
      notes.push(`Ikke undervist i ${stale.year} — sist undervist ${stale.lastYear}.`);
    } else if (state) {
      if (isOffSemester(state)) notes.push("Undervises ikke i valgt semester.");
      // `errors` is Norwegian on both sides of the colon (data.ts's
      // `failureMessage`); the raw upstream English lives on `.detail` and is
      // never rendered (copy-2).
      for (const error of state.bundle?.errors ?? []) notes.push(`Fikk ikke hentet ${error}.`);
    }
    const failed = !stale && (state?.bundle?.errors.length ?? 0) > 0;

    const base = {
      code,
      name: state?.bundle?.details?.courseName ?? course.name,
      // A dropped course has no state and therefore no assigned hue — it is
      // excluded from the week, the credit total and the exam list, which is
      // what the hue ramp indexes. The dot still has to resolve to a colour.
      hueVar: state?.hueVar ?? "--muted",
      credits: state ? creditsOf(state) : (course.credits ?? null),
      source: course.source,
      dropped: course.dropped === true,
      notes,
      onRetry: failed ? () => retryCourse(code) : null,
    };

    const timetable = state?.bundle?.timetable;
    if (!state || !timetable) {
      return { ...base, groups: [], selected: course.groups ?? [], defaults: [] };
    }

    // `defaults` is read off exactly the set the GRID narrows — the week's
    // entries, programme narrowing left to `applyGroupSelection` (groups.ts) —
    // so the picker's ticked default is the block on screen. Its LENGTH also
    // decides radios vs checkboxes, so it must stay
    // `resolveLectureDefaults(...).keys` verbatim (groups-2/groups-3).
    // `resolved` travels with it so the picker can stop labelling a
    // provisional pick "(din parallell)" — for BDIGSEC/EXPH0300 the week draws
    // one of two campus parallels and neither is the student's own until they
    // say so (groups-5).
    const week = semesterWeekEntries(state.bundle);
    const lectures = resolveLectureDefaults(week, state.programCode);
    const selected = state.course.groups ?? [];
    const inWeek = new Set(groupOptions(week).map((o) => o.key));
    // Programme narrowing on the ØVING/LAB layer only. That is where the flood
    // is (39 of EXPH0300's 44 rows are seminar groups, most of them another
    // campus's) and it is the layer `applyGroupSelection`'s default branch
    // already narrows the same way. The lecture layer keeps every parallel the
    // semester publishes: picking a parallel tagged for ANOTHER programme is a
    // documented capability (groups.ts, tests/planner/groups.test.ts) and this
    // picker is the only place it can be exercised — narrowing it away would
    // make an MTDT student unable to choose TMA4400's "Forelesning 2 MTBYGG",
    // which e2e/flows.pw.ts's "a non-default parallel renders with a programme
    // set" ticks by hand.
    const ownOther = new Set(
      groupOptions(entriesForProgram(week, state.programCode))
        .filter((o) => o.kind !== "lecture")
        .map((o) => o.key),
    );
    return {
      ...base,
      // From the YEAR's options, so a pick made for another semester (or one
      // upstream has since retitled) is still listed and can be unticked.
      groups: groupOptions(timetable).filter(
        (o) =>
          (o.kind === "lecture" ? inWeek.has(o.key) : ownOther.has(o.key)) ||
          selected.includes(o.key),
      ),
      selected,
      defaults: lectures.keys,
      resolved: lectures.resolved,
    };
  }

  /** Opens the settings modal for one course, from either entrance. */
  function openCourseSettings(code: string): void {
    const ctx = buildCourseSettingsContext(code);
    if (ctx) courseSettings.showFor(ctx);
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
        // A shared link's group picks (`~groupKey`) must survive the hash → plan
        // hop, or the recipient loses the sender's parallel/øving selections.
        ...(c.groups.length > 0 ? { groups: c.groups } : {}),
      })),
      ...(program ? { program } : {}),
    };
  }

  /**
   * Carries the two facts the hash grammar cannot hold — `credits` and the
   * course's real `name` — from the plan already on disk onto the hash-derived
   * one (store-4).
   *
   * The page writes its own hash on every render (`syncHash`), so a plain F5
   * goes through the hash-wins branch below, and replacing outright used to
   * *persist* `{name: code}` with no credits: an elective added from the study
   * plan panel — the only path that supplies `credits` at all — lost the 7,5 sp
   * only the study plan could know, on disk, permanently. That is B9.1's
   * fallback destroyed by its own reload.
   *
   * Only same-semester storage is read: `np:plans` is keyed by semester and
   * another semester's row says nothing about this one. Everything the hash
   * *does* carry (version, source, dropped, groups) still wins outright.
   */
  function withStoredFacts(next: PlanState, stored: PlanState): PlanState {
    if (stored.semesterId !== next.semesterId) return next;
    const byCode = new Map(stored.courses.map((c) => [c.code, c]));
    return {
      ...next,
      courses: next.courses.map((course) => {
        const previous = byCode.get(course.code);
        if (!previous) return course;
        return {
          ...course,
          ...(course.name === course.code && previous.name !== "" ? { name: previous.name } : {}),
          ...(previous.credits != null ? { credits: previous.credits } : {}),
        };
      }),
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
    plan = withStoredFacts(planFromHash(hashPlan), plan);
    // A program-less link (`#…;-;…courses`) must clear any stored profile, not
    // just omit one: `savePlan` can only ever *write* `np:profile`, never clear
    // it (store.ts), so the header chip would keep naming the old programme
    // while the planner shows none (finding 2). `removeProgram` clears it first;
    // `savePlan` then writes exactly the hash's own courses.
    if (hashPlan.program === null) store.removeProgram();
    store.savePlan(plan);
  } else if (!knownSemester(plan.semesterId)) {
    // Stored state can outlive a semester too — silently, since no link lied.
    plan = { ...plan, semesterId: defaultSemesterId };
    store.savePlan(plan);
  }

  let plannerIndex: PlannerIndex | null = null;
  /**
   * The `/data/search-index.json` download failed. Kept apart from
   * `plannerIndex === null` ("still in flight"): conflating the two left the
   * exam column spinning forever and made the provenance line state that NTNU
   * had published no exam dates — a failed download of our *own* build
   * artifact reported as an upstream fact (pd-3/ux-fail-7).
   */
  let plannerIndexFailed = false;
  /** Lazy by-code lookup over the raw index (`offeredYears` etc.). Reset with the index. */
  let indexByCodeMemo: Map<string, PlannerIndexCourse> | null = null;
  let showOthers = false;
  /**
   * The weekday the grid expands to full width, or `null` for the whole week
   * (REWORK-2026-07-29 D4). Deliberately NOT persisted — not in the hash, not
   * in storage: it is a way of looking at the plan, not part of it, and a
   * shared link that opened on someone else's Thursday would be a worse
   * answer to "here is my week" than the week itself.
   */
  let focusDay: number | null = null;
  /**
   * What the grid on screen is currently showing, so the next render can
   * animate from it (`GridRenderOptions.previousFocusDay`). Distinct from
   * `focusDay`, which is already the *target* by the time a render runs.
   */
  let renderedFocusDay: number | null = null;
  let periodCourses: PeriodCourses | null = null;
  let studyPlanFetchToken = 0;
  /** `true` once a study plan is loaded but has no period for this semester (B4). */
  let periodMissing = false;
  /**
   * What actually happened to the study-plan fetch, so the provenance line can
   * stop asserting "studieplan for kull N" over a 404, an error, or another
   * cohort's document silently substituted by the step-back (plan-3/ux-fail-4).
   */
  let studyPlanOutcome:
    | { kind: "pending" }
    | { kind: "found"; year: number }
    | { kind: "not-found" }
    | { kind: "error" } = { kind: "pending" };
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

  /**
   * `history.state` is carried through, never replaced with `null`: Astro's
   * ClientRouter seeds every entry with `{index, scrollX, scrollY}` and its
   * `onPopState` returns early on a null state, so writing `null` here left
   * the planner's own entry dead — Back (and Forward) onto it changed the URL
   * and never swapped the page (app-1, CLAUDE.md's ClientRouter rule).
   */
  function syncHash(): void {
    lastWrittenHash = formatPlanHash(plan);
    history.replaceState(history.state, "", lastWrittenHash);
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

  /**
   * A bundle's timetable narrowed to this semester's teaching weeks ONLY — not
   * to the programme's own sections. This is what the grid draws, because the
   * grid's `applyGroupSelection` (groups.ts) is the single owner of programme
   * narrowing: its default branch runs `entriesForProgram` for the programme's
   * parallel, but an *explicit* group pick wins over the programme filter.
   * Pre-narrowing by programme here too stripped a cross-programme parallel the
   * student had explicitly selected before the grid ever saw it — the course's
   * lecture block vanished silently (finding 1). `semesterEntries` keeps the
   * programme narrowing where it belongs: the off-semester/credit accounting.
   */
  function semesterWeekEntries(bundle: CourseBundle | null): TimetableEntry[] {
    const semester = currentSemester();
    if (!bundle?.timetable || !semester) return [];
    return entriesInSemester(bundle.timetable, semester.teachingWeeks);
  }

  // --- Banner ------------------------------------------------------------

  // The on-page "Bytt semester" disclosure is gone. It was the second surface
  // offering the same choice as the studieinfo modal's own semester select,
  // which already commits unconditionally and first (studieinfo.ts's
  // `commit`). The resolved term is still *stated* in the context line below
  // — DR-9/U6's point was that the tool resolves the term itself and says so;
  // it never required a switcher on the fold.

  /**
   * The banner — facts, no controls. The programme is a *title* with its code
   * beside it in mono (D2/D10): it is the only thing that tells MIDT from
   * MTDT. Below it the supporting line: kull · studieretning · the resolved
   * semester. The studieretning is there because it is the *answer* the
   * student gave to the one question the study plan forced.
   *
   * Nothing here opens the studieinfo modal any more. The title was a button
   * and the banner carried an "Endre" button beside it, which together with
   * Layout's topbar chip made three permanent controls for one modal. The
   * chip is the single opener now.
   */
  function renderBanner(): void {
    const program = plan.program;
    const semester = currentSemester();

    elements.title.replaceChildren();
    if (program) {
      const named = program.name !== "" && program.name !== program.code;
      elements.title.append(el("span", undefined, named ? program.name : program.code));
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
    // No "X sp over normal semesterbelastning" line: "37,5 av 30 sp" sits
    // directly above it and already says exactly that. The two notes that
    // remain both carry something the numbers cannot — a row excluded from
    // the arithmetic, and a defect in the study plan itself.
    if (suspiciousPrefillCredits !== null) {
      // "Fjern det du ikke tar" needs something to remove. MSCHEM kull 2025 at
      // Vår 2027 is one mandatory 60 sp masteroppgave — the study plan hangs a
      // multi-semester course's whole credit on its final period — so the
      // imperative told a student to prune a semester holding exactly one
      // course they cannot drop (plan-6). Over 30 sp on a single course is a
      // course spanning several semesters, not a defective study plan.
      const single = (periodCourses?.obligatory.length ?? 0) === 1;
      notes.push(
        single
          ? `Studieplanen fører opp hele emnet (${formatCreditNumber(suspiciousPrefillCredits)} sp) i dette semesteret — det går over flere semestre.`
          : `Studieplanen oppgir ${formatCreditNumber(suspiciousPrefillCredits)} sp dette semesteret — mer enn et normalt semester. Fjern det du ikke tar.`,
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
    // The button is only worth showing when it goes somewhere the standing
    // "Legg til emne" button (right below it) does not. With an empty study
    // plan pool it fell back to that same label and opened that same dialog,
    // so the rail carried two identical buttons a line apart — the sentence
    // alone is what's left in that case.
    const pool = availablePool();
    const noPool = pool.length === 0;
    elements.gapButton.hidden = noPool;
    // `hidden` alone does not hide it: `.np-btn { display: inline-flex }`
    // (primitives.css) is an author rule and beats the UA's `[hidden]`, so on a
    // programme+kull whose period offers no electives the rail kept a
    // count-less "Velg fra studieplanen" promising the study plan and opening
    // the whole catalog (plan-8). Belt and braces until `[hidden]` is enforced
    // for `.np-btn` in the stylesheets — clearing it back to "" restores
    // whatever the sheet says.
    elements.gapButton.style.display = noPool ? "none" : "";
    if (!noPool) elements.gapButton.textContent = `Velg fra studieplanen (${pool.length})`;
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

  // --- Week ⇄ day (REWORK-2026-07-29 D4) ----------------------------------

  /**
   * Switches the week between the five-day spread and one expanded day.
   *
   * Only the grid is re-rendered: the exam list, the credit line and the
   * course rows are the same whichever day is on screen, and rebuilding them
   * would throw away the student's scroll position for a change they did not
   * ask those surfaces to make.
   */
  function setFocusDay(day: number | null): void {
    if (focusDay === day) return;
    focusDay = day;
    renderGridAndExams();
  }

  /**
   * `Uke · Man · Tir …` above the grid — the entrance the day headers
   * duplicate for a student already looking at a day, and the only way *back*
   * to the week that does not require finding the header of the day you
   * happen to be on.
   *
   * `dayCount` is the grid's OWN count (`GridRenderResult.dayCount`), not a
   * second copy of its Saturday rule here, so the strip can never offer a day
   * the grid has no column for. A message branch reports 0 — the week has
   * nothing to look at one day of, so the strip goes away entirely rather than
   * offering six buttons over a sentence.
   */
  function renderDayStrip(dayCount: number): void {
    elements.dayStrip.replaceChildren();
    elements.dayStrip.hidden = dayCount === 0;
    if (dayCount === 0) return;
    const makeButton = (label: string, ariaLabel: string, target: number | null): void => {
      const button = el("button", "np-toggle planner-day-btn", label);
      button.type = "button";
      button.setAttribute("aria-label", ariaLabel);
      button.setAttribute("aria-pressed", String(focusDay === target));
      button.addEventListener("click", () => setFocusDay(target));
      elements.dayStrip.append(button);
    };
    makeButton("Uke", "Vis hele uka", null);
    for (let day = 1; day <= dayCount; day++) {
      makeButton(dayName(day).slice(0, 3), `Vis bare ${dayName(day)}`, day);
    }
  }

  // --- Programme / kull / retning / semester: the studieinfo modal --------
  //
  // All four plan choices live in the one studieinfo modal, and exactly one
  // persistent control opens it: Layout's topbar `#studieinfo-chip`, via the
  // OPEN_STUDIEINFO event `mountStudieinfo` listens for. The banner's own
  // "Endre" button and the clickable page title were two more doors to the
  // same room and are gone. What remains below are the *contextual* openers —
  // the week's studieretning question and the empty-state cards — which only
  // ever appear when the week has nothing else in it.

  // --- Studieretning question --------------------------------------------

  /**
   * The one open question the week is waiting on, whatever its shape.
   *
   * All three shapes get the same treatment for the same reason: the answer
   * belongs *on* the primary surface. A studieretning question in a quiet
   * side panel while the grid renders as a failure is B2; an elective-only
   * period whose next step sits in the other column — behind a tab on mobile
   * — is U8, the identical shape with the opposite treatment; and a semester
   * the study plan has no period for is B4's honest dead end. The
   * studieretning is now *chosen in the studieinfo modal* (its select), so its
   * question renders as a sentence + "Endre studieinfo" button, not inline
   * chips.
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

    // NTNU publishes no study plan for this programme at all — KNOAND, MTPROD
    // and 5 of 31 sampled programmes have none at 2026, 2025 or 2024. Reachable
    // in normal use since studieinfo stopped refusing to save such a programme
    // (ux-fail-5): before this the banner named the programme, the week said
    // the generic "Legg til emner for å se ukeplanen." and nothing anywhere
    // explained why the prefill was empty. Only the `not-found` outcome —
    // `error` is a fetch that failed, which the provenance line names as such
    // and which is not NTNU's publication fact.
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

    // The period exists and names nothing at all (MPPR kull 2026 at Høst 2026:
    // `{courseGroups: [], waypoints: []}`). Without this it rendered exactly
    // like a normal period — "0 av 30 sp", no rows, no sentence — and looked
    // identical to a network failure (plan-2). `empty` comes from
    // `classifyPeriod`; nothing here re-derives it.
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
      const prompt = "Velg studieretning i studieinfo — ukeplanen fylles ut med en gang.";
      return {
        title: pending.name,
        note: `${deadline}${prompt}`,
        action: { label: "Endre studieinfo", run: () => studieinfo.open() },
        weekMessage: prompt,
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

    questionAction = question.action?.run ?? null;
    elements.directionActions.hidden = question.action === null;
    if (question.action) elements.directionButton.textContent = question.action.label;
  }

  elements.directionButton.addEventListener("click", () => questionAction?.());

  // --- Add-course dialog ---------------------------------------------------
  //
  // The inline add field + typeahead is gone (Task 12): one button opens
  // `addCourse.ts`'s dialog, which searches the whole catalog (not just the
  // study plan's own choice pool below) and stays open for multiple adds.
  //
  // `addCourseDeps` is mutated in place rather than re-passed whenever the
  // semester, the programme, or the catalog index (still loading at mount)
  // change — see addCourse.ts's own header for why that's safe without
  // re-mounting the dialog.
  const addCourseDeps: AddCourseDeps = {
    store,
    index: null,
    semester: currentSemester() ??
      semesters[0] ?? {
        id: defaultSemesterId,
        name: "",
        teachingWeeks: [],
        timetablePublished: false,
        fromDate: null,
        toDate: null,
        examLastDate: null,
        examFinalDate: null,
      },
    programCode: plan.program?.code ?? null,
  };
  const addCourseDialog: AddCourseHandle = mountAddCourse(addCourseDeps, lifeSignal);

  /**
   * The study plan's own choice pool for this period, minus what's already
   * in the plan — feeds only the gap line's/question's counts and copy now
   * (Task 12 moved the actual add surface to the dialog's flat catalog
   * search). Memoised on (period, plan courses): half a dozen callers ask
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

  /** The gap line's/question's button: opens the add-course dialog. */
  function openAddFromQuestion(): void {
    addCourseDialog.open();
  }

  elements.addCourseBtn.addEventListener("click", () => addCourseDialog.open());
  elements.gapButton.addEventListener("click", openAddFromQuestion);

  // --- Course bundle state (timetable + details per active course) -------

  const courseStates = new Map<string, PlanCourseState>();
  /** Which semester the held bundles were fetched for — they are year-scoped. */
  let bundlesForSemester = plan.semesterId;

  function syncCourseStates(): void {
    // Bundles are dropped on a semester switch because the ENTRIES are
    // filtered against the new semester's teaching weeks — not because the
    // fetch is year-scoped. It is not: `?year=` is a documented no-op upstream
    // (byte-identical responses for 2023/2025/2026/2027, pd-8), so a switch
    // costs one timetable request per course for data we may already hold. The
    // details leg is memoised by code alone in data.ts and is genuinely free.
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
    active.forEach((course, index) => {
      seen.add(course.code);
      const existing = courseStates.get(course.code);
      if (existing) {
        existing.hueVar = hueForIndex(index);
        existing.course = course;
        // The programme can change under a persisted state (switch/clear), so
        // its code is refreshed here too — grid group-narrowing depends on it.
        existing.programCode = programCode;
      } else {
        courseStates.set(course.code, {
          course,
          hueVar: hueForIndex(index),
          // A course previewed in the add-course dialog already has its
          // bundle in `fetchCourseBundle`'s own module-level memo (data.ts) —
          // this fetch (loadBundles, below) is free, not a second round trip.
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
   * The plan itself, and nothing else: courses being taken, plus programme
   * courses the student dropped (grayed — §0.3). The study plan's choice pool
   * deliberately does *not* live here; at 30–60 rows it would bury the six
   * courses this list exists to show.
   *
   * A row is identity and nothing else — hue dot, code, name, credits
   * (REWORK-2026-07-29 D2). What it used to also carry has moved:
   * vurderingsform to the exam list (D6), and the run-on status line, the
   * retry and the Dropp/Fjern button into the settings modal the whole row now
   * opens (D1/D3). "Which parallel am I in" was considered for this line and
   * cut by the user: once it is set, nobody looks at it again.
   *
   * The row is a `<button>`, so it is one tab stop with one action, and
   * `pendingFocusCode` — the dance that put focus back on a row action the
   * rebuild had just destroyed (app-4) — is gone with the action itself. A
   * drop now happens inside a modal that closes onto its own invoker.
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
      const row = el("button", `planner-course-row${isDropped ? " is-dropped" : ""}`);
      row.type = "button";
      row.dataset.code = course.code;
      const details = state?.bundle?.details;
      const name = details?.courseName ?? course.name;
      row.setAttribute("aria-label", `Innstillinger for ${course.code} ${name}`);
      row.addEventListener("click", () => openCourseSettings(course.code));

      const head = el("span", "planner-course-row-head");
      if (state && !isDropped) {
        const dotEl = el("span", "np-dot");
        dotEl.style.setProperty("--dot", `var(${state.hueVar})`);
        head.append(dotEl);
      }
      head.append(el("span", "np-data", course.code));
      row.append(head);

      row.append(el("span", "planner-course-row-name", name));

      const meta = el("span", "planner-course-row-meta");
      if (isDropped) {
        // The one status a row still says for itself: a dropped course is
        // excluded from the week, the credits and the exams, so a grayed row
        // with no explanation is a course that looks broken (§0.3).
        meta.append(el("span", "np-note", "droppet"));
      } else {
        const credits = state ? creditsOf(state) : (course.credits ?? null);
        if (credits != null) {
          meta.append(el("span", "np-data", `${formatCreditNumber(credits)} sp`));
        }
        // A course the week cannot draw gets ONE mark here, not the sentence —
        // the sentence is in the modal this row opens. Without the mark a
        // course that is silently missing from the week looks like every other
        // row (crawler-3/S13/pd-5).
        const needsAttention =
          notTaughtIn(course.code) !== null ||
          (state !== undefined && isOffSemester(state)) ||
          (state?.bundle?.errors.length ?? 0) > 0;
        if (needsAttention) {
          meta.append(el("span", "np-note planner-course-row-flag", "se detaljer"));
        }
      }
      row.append(meta);

      elements.courseRows.append(row);
    }
  }

  // --- Render: "Fra studieplanen" panel (design §8) -----------------------

  interface PlanPanelGroup {
    name: string | null;
    /** Verbatim study-plan prose (DR-5) — never paraphrased. */
    description: string | null;
    courses: ClassifiedCourse[];
  }

  /**
   * The study plan's choice courses (`periodCourses.choice`) grouped by their
   * verbatim group title, preserving order. Obligatory courses are prefilled
   * into the plan already and never surface here — this panel is the *offered*
   * pool with the group prose that says how to choose (DR-5), nothing more.
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
   *  affordance (the add-dialog's row pattern, simplified — reuses the store).
   *  The in-plan word is DESIGN §7's mandated half of the pair, spelled the
   *  same way on every surface — this row said "I planen ✓" while /emner/
   *  said "Lagt til" and the add dialog "Lagt til ✓" (copy-6). */
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
   * each with its verbatim prose (DR-5) and its courses. Shown only when a
   * programme is set AND the resolved period actually has choice groups —
   * otherwise there is nothing to offer and the panel stays hidden.
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
   * The planner index with every row's exams narrowed to the planned
   * semester's own `fromDate`…`examFinalDate` window (C3). Memoised because
   * it is one pass over ~5 500 rows and the semester only changes when the
   * student says so — but the exam list reaches into the index itself, so
   * the filter has to be baked in rather than passed per call.
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
   * (element 5) is readable. Used to tell "we could not fetch this" from "this
   * course is simply not taught this year" in the course rail (crawler-3).
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
   * catalog does not carry the course at all — the same test `/emner/` and
   * `/emne/[code]/` make (`!offeredYears.includes(index.year)`), against the
   * CATALOG's canonical year, not the plan semester's. `null` while the index
   * has not landed: "ikke undervist" is not something to guess at.
   */
  function notTaughtIn(code: string): { year: number; lastYear: number } | null {
    const catalogYear = plannerIndex?.year;
    const offered = indexRowFor(code)?.[5];
    const lastYear = offered?.[0];
    if (catalogYear === undefined || !offered || lastYear === undefined) return null;
    if (offered.includes(catalogYear)) return null;
    return { year: catalogYear, lastYear };
  }

  // --- The week's horizontal scroll (A4) -----------------------------------

  function prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  /**
   * Below ~370 px the week frame is narrower than the grid and its own rounded
   * border closes mid-column — no fade, no arrow, no visible scrollbar, and the
   * page itself does not scroll horizontally, so the clip reads as an edge and
   * a student can conclude they have no Friday lecture. `data-scroll` drives the
   * edge mask; the hint is one fixed sentence (S15).
   *
   * What is hidden is measured from the GRID's own box, not the frame's
   * `scrollWidth`: the frame's 24 px padding counts as scrollable content, so
   * `scrollWidth - clientWidth` stayed ~26 px at 390 px where all five days are
   * on screen (the 21rem `min-width` in planner-week.css fixed the overflow the
   * old comment here described). The result was a sentence telling the student
   * to drag sideways to see a week they could already see in full, both edges
   * faded, and the left ramp washing out the hour rail's own labels (mob-5).
   */
  function syncGridScroll(): void {
    const frame = elements.gridFrame;
    const grid = frame.querySelector<HTMLElement>(".planner-grid");
    const maxScroll = frame.scrollWidth - frame.clientWidth;
    // No grid mounted (a message or fallback card) — nothing to scroll to.
    const hidden = grid ? grid.getBoundingClientRect().width - frame.clientWidth : 0;
    if (hidden <= 1) {
      delete frame.dataset.scroll;
      elements.scrollHint.hidden = true;
      return;
    }
    const left = frame.scrollLeft;
    frame.dataset.scroll = left <= 1 ? "start" : left >= maxScroll - 1 ? "end" : "middle";
    elements.scrollHint.hidden = false;
    elements.scrollHint.textContent = "Dra sidelengs for å se hele uken.";
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
    // `Array.from`, not a spread: this module is now reachable from the Node
    // typecheck pass (tsconfig.test.json), whose `lib` has no `DOM.Iterable`.
    const headers = Array.from(frame.querySelectorAll<HTMLElement>(".planner-grid-day-header"));
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

  // The week's column cap is viewport-dependent since grid-3 (a 2-deep cluster
  // is 27 px wide on a phone, so it piles instead of splitting), and crossing
  // that boundary — a rotation, a desktop window drag — changes no plan state,
  // so nothing else would redraw the grid. Only the boundary fires, not every
  // resize frame, which is why this is a `change` listener and not more work
  // on the `resize` above.
  globalThis
    .matchMedia?.("(max-width: 40rem)")
    .addEventListener("change", () => renderGridAndExams(), { signal });

  /**
   * The verdict beside the Ukeplan kicker — PRODUCT §1's primary job, *kan
   * jeg ta disse emnene sammen?*, answered on the page. `renderGrid` has
   * always computed and returned this number and the caller has always
   * thrown it away (U4). Counts are grouped slots, so a three-way clash is
   * one problem, and nothing is asserted while a fetch could still change it.
   *
   * When a course's timetable never arrived the check is INCOMPLETE, and the
   * line says so out loud rather than going quiet: silence still reads as
   * "nothing to report" beside a drawn week (pc-3, audit §1). It is a gap, not
   * a clash, so it keeps `.planner-section-sub`'s muted ink — neither
   * Green-Means-Fits nor Red-Is-Collision may be spent on "we do not know".
   */
  function renderVerdict(grid: GridRenderResult | null, loading: boolean): void {
    const host = elements.gridStatus;
    host.replaceChildren();
    host.className = "planner-section-sub";
    if (loading) {
      host.textContent = "henter timeplan …";
      return;
    }
    if (grid?.state !== "grid") return;
    if (grid.incompleteCourses.length > 0) {
      const n = grid.incompleteCourses.length;
      host.textContent = `kan ikke sjekkes — mangler timeplan for ${n} ${n === 1 ? "emne" : "emner"}`;
      return;
    }
    // Anything still in flight (`partial` without an incomplete course).
    if (grid.partial) return;
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

  /**
   * Reloads every course bundle from scratch. The module-level fetch memo is
   * cleared first (so a real refetch happens, not a cached failure replayed)
   * and each state reset to "not loaded" before `loadBundles` runs again.
   * Wired to the "Prøv igjen" fallback — the honest recovery from a timetable
   * fetch that came back `null`.
   */
  function retryBundles(): void {
    clearCourseBundleMemo();
    for (const state of courseStates.values()) {
      state.bundle = null;
      state.loading = false;
    }
    // loadBundles flips the reset states to loading and paints the skeleton
    // itself, so there is no need to render the (momentarily empty) grid first.
    void loadBundles();
  }

  /**
   * Reloads ONE course's bundle — the recovery a partial failure needs, and
   * the one `retryBundles` could never offer because it is mounted in a
   * fallback branch that requires every bundle to be empty (pd-5). No memo
   * clear: `fetchCourseBundle` drops a bundle carrying failures as it settles,
   * so this really refetches.
   */
  function retryCourse(code: string): void {
    const state = courseStates.get(code);
    if (!state) return;
    state.bundle = null;
    state.loading = false;
    renderCourseRows();
    void loadBundles();
  }

  /**
   * A centered card where the week would be, for the empty/fallback states
   * that carry an action button rather than just a sentence. Resets the frame
   * the same way `renderGridMessage` does (unruled, cleared) so the ruling
   * never frames an apology (D5), then mounts the card `build` fills.
   */
  function renderWeekCard(build: (card: HTMLElement) => void): void {
    renderGridMessage(elements.gridFrame, elements.gridNotes, null);
    const card = el("div", "planner-week-card");
    build(card);
    elements.gridFrame.append(card);
  }

  function renderGridAndExams(): void {
    const semester = currentSemester();
    const states = orderedActiveStates();
    const anyLoading = states.some((s) => s.loading);
    const question = weekQuestion();

    // Week-only narrowing (NOT programme-narrowed): the grid's own
    // `applyGroupSelection` owns programme narrowing so an explicit
    // cross-programme parallel pick still draws (finding 1). See
    // `semesterWeekEntries`.
    const filteredStates: PlanCourseState[] = states.map((s) => {
      if (!s.bundle?.timetable) return s;
      return { ...s, bundle: { ...s.bundle, timetable: semesterWeekEntries(s.bundle) } };
    });

    // The four empty/fallback states (REWORK §3). Never a blank grid: always
    // the course list + exams + a card that names the one next action.
    const published = semester?.timetablePublished ?? true;
    const anyBundlesLoaded = states.some((s) => s.bundle !== null);
    // A *failed* timetable fetch leaves the raw bundle `timetable === null`;
    // a successful-but-empty one leaves `[]`. The old `?? []` coalesce erased
    // that difference and showed the "publiseres" copy over a network failure
    // (S6/T10). Checked on the RAW states, before semester/programme narrowing.
    const failed = states.some((s) => s.bundle !== null && s.bundle.timetable === null);
    // Every loaded bundle has zero entries for this programme this semester —
    // the grid would be blank. Computed from the programme-narrowed
    // `semesterEntries` (NOT the grid's week-only `filteredStates`), so the
    // fallback-card decision is unchanged by the grid path no longer
    // pre-narrowing by programme (finding 1).
    const empty =
      anyBundlesLoaded &&
      states.every((s) => s.bundle === null || semesterEntries(s.bundle).length === 0);

    const noProfile = plan.program === undefined && plan.courses.length === 0;
    const showFallback = noProfile || (states.length > 0 && !anyLoading && (!published || empty));

    let gridResult: GridRenderResult | null = null;
    if (noProfile) {
      // State 1: no plan at all. The onboarding card — the modal is the way in;
      // the add field is the "I already know a code" escape hatch.
      renderWeekCard((card) => {
        card.append(el("p", "np-hint planner-week-card-hint", "Ingen plan ennå."));
        const primary = el("button", "np-btn", "Velg studieprogram");
        primary.type = "button";
        primary.addEventListener("click", () => studieinfo.open());
        card.append(primary);
        // The modal is the way in; the add-course dialog is the "I already
        // know a code" escape hatch (Task 12).
        const secondary = el(
          "button",
          "np-navlink planner-week-card-secondary",
          "…eller legg til emner med emnekode",
        );
        secondary.type = "button";
        secondary.addEventListener("click", () => openAddFromQuestion());
        card.append(secondary);
      });
    } else if (showFallback && semester) {
      // Ordered by severity, not by narrative (ux-3/ux-fail-2). A question used
      // to win over both branches below it, so an MTDT student who lost
      // connectivity was told to pick a studieretning — with no mention of the
      // failure and no "Prøv igjen" anywhere on the page — and an MTDT student
      // planning an unpublished term was promised the week "fylles ut med en
      // gang". Neither is answerable by the student. The question is not lost:
      // `#planner-direction` renders it in its own panel directly above this
      // frame on every render where `weekQuestion()` is non-null.
      if (failed) {
        // State 3: a fetch failed. NEVER the "publiseres" copy — offer a retry.
        renderWeekCard((card) => {
          // `.np-hint`, like the card's three other branches: DESIGN §3 gives
          // sentences to `.np-hint` and mono fragments to `.np-note`, and this
          // one rendered the only explanation of an empty week as the smallest,
          // most label-like text on the page (ds-5).
          card.append(el("p", "np-hint planner-week-card-hint", "Fikk ikke hentet timeplanen."));
          const retry = el("button", "np-btn", "Prøv igjen");
          retry.type = "button";
          retry.addEventListener("click", retryBundles);
          card.append(retry);
        });
      } else if (!published) {
        // State 2: timetable not published yet (unchanged copy).
        renderGridMessage(
          elements.gridFrame,
          elements.gridNotes,
          `Timeplan for ${semesterLabel(semester)} publiseres vanligvis i ${publishMonthFor(semester.id)} — kom tilbake da.`,
        );
      } else if (question) {
        // A studieretning/elective/period question owns the empty week — its
        // sentence, not a fallback card, is what the student acts on. Rendered
        // through renderGridMessage (D5), same as the pre-publish note.
        renderGridMessage(elements.gridFrame, elements.gridNotes, question.weekMessage);
      } else {
        // State 4: published, courses exist, none taught this term.
        renderWeekCard((card) => {
          card.append(
            el(
              "p",
              "np-hint planner-week-card-hint",
              `Ingen av emnene dine undervises i ${semesterLabel(semester)}.`,
            ),
          );
          const change = el("button", "np-btn", "Endre studieinfo");
          change.type = "button";
          change.addEventListener("click", () => studieinfo.open());
          card.append(change);
        });
      }
    } else {
      gridResult = renderGrid(elements.gridFrame, elements.gridNotes, filteredStates, showOthers, {
        loading: anyLoading,
        pendingChoiceMessage: question?.weekMessage ?? null,
        focusDay,
        previousFocusDay: renderedFocusDay,
        onDayFocus: (day) => setFocusDay(focusDay === day ? null : day),
        onBlockClick: (detail) => {
          // A pile has no single course to open settings for — its `code` is
          // the cluster's codes joined " · ". It is also the grid saying "too
          // dense to read here", so it expands its own day, where the column
          // is wide enough to split the cluster into real blocks (D5).
          if (detail.code.includes(" · ")) {
            setFocusDay(detail.dayNumber);
            return;
          }
          openCourseSettings(detail.code);
        },
      });
    }
    // What the NEXT render animates from — set on every path, including the
    // message branches. A frame replaced by a sentence has no columns to
    // expand, so the grid that comes back after it should simply appear in
    // whatever state it is in rather than animating out of one the student
    // never saw.
    renderedFocusDay = focusDay;
    // A focus the grid refused (a Saturday that is no longer taught) is not a
    // state the strip may keep asserting — `renderGrid` fell back to the week,
    // so the strip has to say the week too.
    const drawnDays = gridResult?.dayCount ?? 0;
    if (focusDay !== null && drawnDays > 0 && focusDay > drawnDays) {
      focusDay = null;
      renderedFocusDay = null;
    }
    renderDayStrip(drawnDays);

    // B7a: the grid can reveal the muted øving layer on its own when nothing
    // classifies as a lecture. The toggle has to say so, or it lies about
    // what is on screen. This is not the student's `showOthers` — it is not
    // persisted, only mirrored.
    elements.othersToggle.setAttribute(
      "aria-pressed",
      String(showOthers || gridResult?.mutedLayerAutoRevealed === true),
    );

    // `anyLoading` stays in: since the kont join (exams-1) the list reads
    // `bundle.details.exams` to tell an ordinary sitting from an "Utsatt" one,
    // so a list painted before the bundles land really is provisional — and
    // exactly the deferred rows and the false "tett" connector the join
    // removes. `plannerIndexFailed` is the half that had to come out: with the
    // index download dead, waiting is not a state that ever ends (pd-3).
    const examLoading =
      anyLoading || (states.length > 0 && plannerIndex === null && !plannerIndexFailed);

    // C3: the shipped index only carries this academic year's exam dates. For
    // a semester beyond it the list's own "Ingen eksamensdatoer funnet ennå"
    // is a finding reported by something that never looked — say what is
    // actually true instead, in the frame where the student is looking.
    // A *failed download* is not that: it is our own artifact, and saying NTNU
    // has published nothing would report our network as an upstream fact
    // (pd-3/ux-fail-7), so it takes its own branch below.
    const examUncovered =
      !examLoading &&
      !plannerIndexFailed &&
      activeCourses(plan).length > 0 &&
      !indexCoversSemester(plannerIndex, plan.semesterId);

    const examIndex = examIndexForSemester();
    let examResult: ExamRenderResult;
    if (plannerIndexFailed && states.length > 0) {
      examResult = renderExamMessage(elements.examList, "Fikk ikke hentet eksamensdatoene.", {
        label: "Prøv igjen",
        run: retryIndex,
      });
    } else if (examUncovered) {
      examResult = renderExamMessage(
        elements.examList,
        `Eksamensdatoer er ikke publisert for ${semesterLabel(currentSemester())} ennå.`,
      );
    } else {
      examResult = renderExamList(
        elements.examList,
        states,
        plan.semesterId,
        examIndex,
        currentExamWindow(),
        todayInOslo(),
        { loading: examLoading },
      );
    }

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
   *
   * It has to be RE-COMPOSED whenever any of that changes, which is the half
   * that was missing: `loadBundles` re-rendered four things and not this one,
   * so the line froze at "Henter timeplan fra NTNU nå" on every passive visit
   * and the per-course failure clause below was structurally unreachable
   * (copy-4/pd-2/ux-2/ux-fail-3/pc-4/edit-5 — six findings, one missing call).
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

    const indexCovers = indexCoversSemester(plannerIndex, plan.semesterId);
    if (states.length > 0) {
      if (plannerIndexFailed) {
        // Our own artifact, not NTNU's: "ikke publisert" here was a statement
        // about NTNU derived from our own failed download (pd-3/ux-fail-7).
        sources.push("fikk ikke hentet eksamensdatoene");
      } else {
        sources.push(
          indexCovers
            ? `eksamensdatoer fra katalogen (hentet ${crawled})`
            : `eksamensdatoer ikke publisert for ${semesterLabel(semester)}`,
        );
      }
    }
    // Which study plan we actually read. The 404 step-back walks back up to
    // two cohorts and used to be invisible: 184BG/MTMT kull 2026 got a
    // confident full 30 sp week off the 2024 curriculum under the words
    // "studieplan for kull 2026" (plan-3/ux-fail-4). Silent while the fetch is
    // in flight — a plan we have not received yet is not a source.
    const program = plan.program;
    if (program) {
      if (studyPlanOutcome.kind === "found") {
        sources.push(
          studyPlanOutcome.year === program.cohort
            ? `studieplan for kull ${program.cohort}`
            : `studieplan for kull ${studyPlanOutcome.year} (ingen egen plan for kull ${program.cohort})`,
        );
      } else if (studyPlanOutcome.kind === "not-found") {
        sources.push(`fant ingen studieplan for ${program.code}`);
      } else if (studyPlanOutcome.kind === "error") {
        sources.push(`fikk ikke hentet studieplanen for ${program.code}`);
      }
    }

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
    // Only when the index can actually speak for this semester. Otherwise the
    // count came from last catalog year's dateless rows (which survive the
    // window by design — a dateless exam carries no year to be wrong about)
    // and was stated inside a sentence that had just said we have no exam data
    // for the semester at all (exams-3).
    const dateless = indexCovers && !plannerIndexFailed ? countDatelessExams() : 0;

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

  /**
   * Exams the catalog lists for this semester but has set no date for
   * (DR-3/U9). Built through the exam list's own `collectExamInputs` so the
   * number and the rows can never disagree — that also makes the kont join
   * (exams-1) count once: a course whose only sittings this semester are
   * deferred contributes exactly the one "dato ikke satt" row it renders.
   */
  function countDatelessExams(): number {
    return collectExamInputs(
      orderedActiveStates(),
      plan.semesterId,
      examIndexForSemester(),
      currentExamWindow(),
    ).filter((e) => e.date === null).length;
  }

  // --- Top-level render orchestration --------------------------------------

  /**
   * Loads `/data/search-index.json` — our own build artifact, so a failure is
   * never worded as an NTNU fact. A rejection is no longer memoised in
   * `data.ts`, so `retryIndex` genuinely refetches (pd-3/ux-fail-7).
   */
  function loadIndex(): void {
    loadPlannerIndex()
      .then((index) => {
        plannerIndex = index;
        plannerIndexFailed = false;
        indexByCodeMemo = null;
        // The add-course dialog searches this same index (mutated in place —
        // see its mount call above); it renders "henter emner …" until it's set.
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
        renderProvenance();
      })
      .catch(() => {
        // Not swallowed any more: the exam column used to spin forever, the
        // add dialog forever said "Henter emner …", and the provenance line
        // claimed NTNU had published no exam dates (pd-3).
        plannerIndexFailed = true;
        addCourseDeps.indexFailed = true;
        renderGridAndExams();
        renderProvenance();
      });
  }

  /** The exam panel's "Prøv igjen" — back to the loading state, then refetch. */
  function retryIndex(): void {
    plannerIndexFailed = false;
    addCourseDeps.indexFailed = false;
    renderGridAndExams();
    loadIndex();
  }

  function renderAll(): void {
    syncCourseStates();
    // An empty plan (no programme, no courses) is not a dead end: the week
    // frame shows the onboarding card (renderGridAndExams' state 1), and the
    // Emner rail keeps its "Legg til emne" button mounted for a student who
    // knows a code.
    elements.linkNote.textContent = linkNote ?? "";
    elements.linkNote.hidden = linkNote === null;
    renderBanner();
    renderRegions();
    renderCreditLine();
    renderDirectionQuestion();
    renderCourseRows();
    renderPlanPanel();
    renderGapLine();
    renderGridAndExams();
    renderProvenance();
  }

  async function loadBundles(): Promise<void> {
    const year = semesterYear(plan.semesterId);
    if (year === null) return;
    // The generation token `loadPeriodCourses` has had all along
    // (`studyPlanFetchToken`). Bundles are year- and week-scoped, the memo key
    // includes the year, and `syncCourseStates` clears every held bundle on a
    // switch — so without this a 26h fetch still in flight when the student
    // switches to 27h lands afterwards and writes 2026 rooms and times into the
    // 27h state. `bundle !== null` then hides it from the `toLoad` filter below,
    // so nothing refetches it for the rest of the page load (app-5).
    const forSemester = plan.semesterId;

    const toLoad = orderedActiveStates().filter((s) => s.bundle === null && !s.loading);
    if (toLoad.length === 0) return;

    for (const state of toLoad) state.loading = true;
    renderGridAndExams();

    await Promise.all(
      toLoad.map(async (state) => {
        // `lifeSignal` (plus data.ts's own 15 s cap) so a stalled socket does
        // not hold the page, and so a page swap cancels what is in flight. It
        // is the PAGE's signal, not the semester's, so it cannot stand in for
        // the token above.
        const bundle = await fetchCourseBundle(state.course.code, year, state.course.version, {
          signal: lifeSignal,
        });
        if (forSemester !== plan.semesterId) return; // superseded by a semester switch
        const current = courseStates.get(state.course.code);
        if (!current) return; // removed/dropped while loading
        current.bundle = bundle;
        current.loading = false;
        // Per course, not after `Promise.all`: one slow course used to withhold
        // the whole page — skeleton and three "henter …" spinners — even when
        // every other bundle had landed in under a second (pd-4).
        scheduleBundleRender();
      }),
    );

    scheduleBundleRender();
  }

  /** Coalesces the post-fetch re-renders that land in the same tick (pd-4). */
  let bundleRenderQueued = false;

  function scheduleBundleRender(): void {
    if (bundleRenderQueued) return;
    bundleRenderQueued = true;
    queueMicrotask(() => {
      bundleRenderQueued = false;
      renderCreditLine();
      renderCourseRows();
      renderGapLine();
      renderGridAndExams();
      // The one that was missing, and the reason DR-8's moat sentence froze at
      // "Henter timeplan fra NTNU nå" on every passive load while its failure
      // clause could never fire (copy-4/pd-2/ux-2/ux-fail-3/pc-4/edit-5).
      renderProvenance();
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
    renderDirectionQuestion();
    renderPlanPanel();
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
      // The token is bumped HERE too, or an in-flight fetch for the programme
      // we just cleared still passes its own `token !== studyPlanFetchToken`
      // guard and resurrects it — profile, prefilled courses, title and hash
      // all flipping back seconds after a program-less shared link was opened
      // (store-2). `findProgramPlan` can spend three sequential round trips on
      // a 404 ladder, so the window is real.
      ++studyPlanFetchToken;
      periodCourses = null;
      periodMissing = false;
      suspiciousPrefillCredits = null;
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
      suspiciousPrefillCredits = null;
      studyPlanOutcome = result.kind === "not-found" ? { kind: "not-found" } : { kind: "error" };
      renderPlanDependents();
      return;
    }
    // The year the 404 step-back actually landed on — MTMT/184BG kull 2026
    // resolve to the 2024 document. The provenance line says which (plan-3).
    studyPlanOutcome = { kind: "found", year: result.year };

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
    // C4's note only ever explains a semester we SUBSTITUTED for the link's
    // own, so a deliberate switch is exactly when it stops being true. Nothing
    // else clears it on this path: studieinfo's Lagre goes through savePlan and
    // `syncHash`'s replaceState, which fires no `hashchange` (app-3) — so the
    // banner said Høst 2027 while a line above it insisted on Høst 2026.
    if (next.semesterId !== plan.semesterId) linkNote = null;
    plan = next;
    // The add-course dialog's deps are mutated in place (not re-passed) —
    // see its mount call above — so a semester switch or a programme
    // change/clear is picked up on the dialog's very next open or lazy
    // clash check, with no re-mount.
    addCourseDeps.semester = currentSemester() ?? addCourseDeps.semester;
    addCourseDeps.programCode = plan.program?.code ?? null;
    syncHash();
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
      // Same as the initial load: a program-less link clears the stored profile
      // (savePlan cannot), so the chip stops naming the old programme (finding 2).
      if (parsed.program === null) store.removeProgram();
      // Same merge as the initial load: a pasted link that re-states courses
      // already in the plan must not strip their credits either (store-4).
      store.savePlan(withStoredFacts(planFromHash(parsed), plan));
    },
    { signal },
  );

  loadIndex();

  // First paint from the initial (hash-or-storage) plan, then kick off fetches.
  syncHash();
  renderAll();

  // `?studieinfo` (the Layout chip navigating in from another page): open the
  // modal once, then strip the param via replaceState so a reload or Back does
  // not re-open it. The fragment carries the plan grammar and must survive
  // untouched — syncHash above already wrote it, and it is preserved here.
  const params = new URLSearchParams(location.search);
  if (params.has("studieinfo")) {
    params.delete("studieinfo");
    const query = params.toString();
    history.replaceState(
      history.state, // never null — see syncHash (app-1)
      "",
      `${location.pathname}${query ? `?${query}` : ""}${location.hash}`,
    );
    studieinfo.open();
  }

  lastDerivationKey = derivationKey();
  await Promise.all([loadBundles(), loadPeriodCourses()]);
}
