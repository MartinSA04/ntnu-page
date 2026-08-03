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
import { deadlineParts, registrationDeadline } from "../../lib/planner/deadline.js";
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
  DEFAULT_VERSION,
  formatPlanHash,
  type PlanCourse,
  type PlanProgram,
  type PlanState,
  parsePlanHash,
} from "../../lib/planner/store.js";
import type { SyncResult, SyncSession } from "../../lib/planner/syncClient.js";
import { isoWeekNumber, weekdayDates } from "../../lib/planner/weekDates.js";
import { syncPlanProbe } from "../../lib/planProbe.js";
import { account, accountPanel, setAccountRepaint } from "../account.js";
import { type AddCourseDeps, type AddCourseHandle, mountAddCourse } from "./addCourse.js";
import { mountBlockPopover, type SessionChoice } from "./blockPopover.js";
import { renderBoard, syncBoardNow } from "./board.js";
import { renderColumnGrid, syncColumnNow } from "./columnGrid.js";
import { type CourseSettingsContext, mountCourseSettings } from "./courseSettings.js";
import {
  el,
  formatCreditNumber,
  formatCredits,
  formatShortDate,
  icon,
  settingsIcon,
} from "./dom.js";
import {
  collectExamInputs,
  type ExamRenderResult,
  renderExamList,
  renderExamMessage,
} from "./examList.js";
import {
  type BlockDetail,
  fitBlockLabels,
  type GridRenderResult,
  renderGrid,
  renderGridMessage,
  setScrollFade,
  syncNowMarker,
  unresolvedLectureChoices,
} from "./grid.js";
import { beginLayerChange } from "./layerMotion.js";
import {
  type ClassifiedCourse,
  findProgramPlan,
  isSuspiciousPrefill,
  type PeriodCourses,
  prefillCredits,
  resolvePeriodFor,
} from "./programPlan.js";
import { publishMonthFor } from "./studieinfo.js";
import { mountStudieinfoDialog, type StudieinfoFocus } from "./studieinfoDialog.js";
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
const FULL_LOAD_CREDITS = 30;

/** The grid's hour rail, in px (`3rem` in the page's `.planner-grid`). Kept in view when scrolling to today. */
const RAIL_WIDTH_PX = 48;

/**
 * The two week views: the column grid (days as columns — the timetable shape)
 * and Tavla (no geometry). Views of one plan, never two plans.
 *
 * The value stays `"kolonner"` rather than becoming `"uke"` alongside its
 * label: it is a localStorage key's value, and a student who last picked the
 * column grid would otherwise come back to an unrecognised string. `"uke"` is
 * also still spelled by the transposed grid on `/emne/[code]/`, which is the
 * one place that geometry survives.
 */
export type WeekView = "kolonner" | "tavle";

const WEEK_VIEWS: readonly WeekView[] = ["kolonner", "tavle"];

const WEEK_VIEW_KEY = "np:weekView";

/**
 * The remembered view. A preference, not plan state: localStorage rather than
 * the hash, so it follows the student without riding along on a shared link.
 *
 * Storage can throw (Safari private mode) and can hold anything, so both
 * directions are total: an unrecognised value reads as the grid.
 */
function loadWeekView(): WeekView {
  try {
    const stored = localStorage.getItem(WEEK_VIEW_KEY);
    return WEEK_VIEWS.find((view) => view === stored) ?? "kolonner";
  } catch {
    return "kolonner";
  }
}

function saveWeekView(view: WeekView): void {
  try {
    localStorage.setItem(WEEK_VIEW_KEY, view);
  } catch {
    // A student who cannot persist the choice still gets to make it.
  }
  // The reservation for the NEXT load reads this off `<html>`; a soft
  // navigation away and back would otherwise arrive holding the old view's
  // height (planner-week.css, `#planner-grid-frame`).
  const root = document.documentElement;
  root.setAttribute("data-view", view);
  // `--planner-box` is the height of the view we are LEAVING. Belt to
  // `settleWeekBox`'s braces: that releases on the first drawn week, but a
  // view switch while bundles are in flight would otherwise reserve the old
  // view's height around the new one until they land.
}

const WEEK_BOX_KEY = "np:weekBox";

/**
 * How tall this browser's week actually came out, per view, with the width it
 * was measured at: `{ "tavle": [390, 891] }`.
 *
 * The views have unrelated geometries — Uke is drawn hours × 4.5rem, Liste is
 * a session count — so the frame cannot reserve one height for both, and
 * reserving the other view's is worse than reserving nothing (0.14 CLS when
 * that was measured). Uke can be computed; Liste cannot, because nothing
 * before the fetch knows the session count.
 *
 * So the page measures itself and Layout.astro's pre-paint probe hands the
 * number back as `--planner-box` before the next first frame. Sound because a
 * load in Liste is by construction a return visit — the only way into it is
 * the tab that put you there.
 *
 * The width rides along because it is what makes the height meaningful (a list
 * measured in 390px wraps differently at 1440); the probe discards the entry
 * outside a small tolerance.
 */
function saveWeekBox(view: WeekView, width: number, height: number): void {
  if (!(height > 0)) return;
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(WEEK_BOX_KEY) ?? "{}");
    const boxes: Record<string, [number, number]> =
      raw !== null && typeof raw === "object" ? (raw as Record<string, [number, number]>) : {};
    const previous = boxes[view];
    const next: [number, number] = [Math.round(width), Math.round(height)];
    // Nothing to write on most renders — the week is re-rendered on every plan
    // edit, group pick and layer toggle.
    if (previous && previous[0] === next[0] && previous[1] === next[1]) return;
    boxes[view] = next;
    localStorage.setItem(WEEK_BOX_KEY, JSON.stringify(boxes));
  } catch {
    // A student who cannot persist it still gets the page, just without the
    // reservation on the next load.
  }
}

interface PlannerElements {
  title: HTMLElement;
  contextLine: HTMLElement;
  semesterSelect: HTMLSelectElement;
  linkNote: HTMLElement;
  creditLine: HTMLElement;
  loadLegend: HTMLElement;
  deadline: HTMLElement;
  creditNote: HTMLElement;
  creditStrip: HTMLElement;
  direction: HTMLElement;
  directionTitle: HTMLElement;
  directionNote: HTMLElement;
  directionActions: HTMLElement;
  directionButton: HTMLButtonElement;
  othersToggle: HTMLButtonElement;
  othersPending: HTMLElement;
  share: HTMLButtonElement;
  shareLabel: HTMLElement;
  viewKolonner: HTMLButtonElement;
  viewTavle: HTMLButtonElement;
  gridFrame: HTMLElement;
  gridNotes: HTMLElement;
  gridStatus: HTMLElement;
  examList: HTMLElement;
  examStatus: HTMLElement;
  courseRows: HTMLElement;
  gapLine: HTMLElement;
  gapText: HTMLElement;
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
    semesterSelect: byId<HTMLSelectElement>("planner-semester-select"),
    linkNote: byId<HTMLElement>("planner-link-note"),
    creditLine: byId<HTMLElement>("planner-credit-line"),
    loadLegend: byId<HTMLElement>("planner-load-legend"),
    deadline: byId<HTMLElement>("planner-deadline"),
    creditNote: byId<HTMLElement>("planner-credit-note"),
    creditStrip: byId<HTMLElement>("planner-credit-strip"),
    direction: byId<HTMLElement>("planner-direction"),
    directionTitle: byId<HTMLElement>("planner-direction-title"),
    directionNote: byId<HTMLElement>("planner-direction-note"),
    directionActions: byId<HTMLElement>("planner-direction-actions"),
    directionButton: byId<HTMLButtonElement>("planner-direction-btn"),
    othersToggle: byId<HTMLButtonElement>("planner-others-toggle"),
    othersPending: byId<HTMLElement>("planner-others-pending"),
    share: byId<HTMLButtonElement>("planner-share"),
    shareLabel: byId<HTMLElement>("planner-share-label"),
    viewKolonner: byId<HTMLButtonElement>("planner-view-kolonner"),
    viewTavle: byId<HTMLButtonElement>("planner-view-tavle"),
    gridFrame: byId<HTMLElement>("planner-grid-frame"),
    gridNotes: byId<HTMLElement>("planner-grid-notes"),
    gridStatus: byId<HTMLElement>("planner-grid-status"),
    examList: byId<HTMLElement>("planner-exam-list-host"),
    examStatus: byId<HTMLElement>("planner-exam-status"),
    courseRows: byId<HTMLElement>("planner-course-rows"),
    gapLine: byId<HTMLElement>("planner-gap-line"),
    gapText: byId<HTMLElement>("planner-gap-text"),
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

/* `semesterShort` — the `H26` / `V27` form — is DELETED with its one caller.
   It existed for the plan title's third part, and the title stopped carrying a
   semester when the bar grew a `<select>` for it (DESIGN §9). Everything that
   still names a term does it in full through `semesterLabel` ("Høst 2026"),
   including the share sheet's title, which is the one string that leaves this
   page and therefore the one that cannot lean on the control beside it. */

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
 * The stale-tab guard, and the only reason `visibilitychange` is wired at all.
 * An iPad left open for a week holds a plan the server has moved past; pulling
 * on the way back in is what stops the next edit writing over the newer copy.
 * Not an optimisation — do not remove it as one.
 */
export function shouldPullOnVisible(session: SyncSession | null, hidden: boolean): boolean {
  return session !== null && !hidden;
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

  // --- The account: shared with the topbar, not owned here -----------------
  //
  // The store and the sync client come from `account.ts`, which the topbar's
  // profile button also mounts against. Sharing the CLIENT is not tidiness:
  // `createSyncClient` keeps its session in memory, so a second client would
  // still answer `session() === null` after the panel signed in, and every
  // push below would report "no_session" until the page reloaded.
  //
  // Three sync triggers, and no polling loop: on plan change (debounced 1s),
  // on `visibilitychange` → visible, and on load. The visibility pull is
  // load-bearing, not an optimisation — see `shouldPullOnVisible`'s own
  // comment for why. There is no offline queue and there must never be one:
  // this is a webpage with no service worker, so a push either lands or it
  // reports that it did not.
  const { store, sync } = account(defaultSemesterId);
  // A fresh `login` writes straight to `localStorage` the same way a pull does
  // and needs the same repaint — see `onAuthenticated`'s doc comment in
  // `profilePanel.ts`. The panel lives in the layout and cannot know about
  // this page, so the page hands its repaint over for as long as it is here.
  // Forward reference is safe: `onAuthenticated` is a hoisted declaration and
  // the callback only ever runs after a click.
  setAccountRepaint(() => onAuthenticated());
  lifeSignal.addEventListener("abort", () => setAccountRepaint(null));

  const studieinfoDialog = mountStudieinfoDialog(store, lifeSignal);

  /**
   * Opens the programme picker, with the caret on whichever control asked for
   * it. It is the planner's OWN dialog now — the topbar's door leads to the
   * account, which is a different room: a programme is a fact about the plan,
   * and sign-in is a fact about the person.
   */
  function openStudieinfo(focus?: StudieinfoFocus): void {
    studieinfoDialog.open(focus);
  }

  const courseSettings = mountCourseSettings(store, lifeSignal);
  // A click in the week asks "what is this session", not "let me edit this
  // course" — so it opens a read popover anchored to the bar, carrying a way
  // through to the editor rather than being it.
  const blockPopover = mountBlockPopover(openCourseSettings, lifeSignal);

  /**
   * The one fact everything below is built on: has the plan changed since
   * the server last confirmed it has this tab's copy? A generation counter,
   * not a flag or a timer's presence. Two earlier attempts here inferred
   * "unsaved work exists" from `pushTimer !== null` and "this write was
   * mine" from a time-scoped `suppressPush` boolean — both are lies under
   * concurrency (an edit racing a pull, or racing the push's own network
   * round trip), which is why each patched one race and opened another.
   * `planGen` is bumped, unconditionally, by `store.onPlanChange`'s
   * subscriber (further down) for every change it sees — a real edit and a
   * pull's own re-derive (`setProgramPlan` inside `loadPeriodCourses`)
   * alike; there is no attempt to tell them apart, because a snapshot of
   * "who caused this" is exactly the kind of state that goes stale under
   * concurrency. `syncedGen` is `planGen` as of the last push this tab
   * confirmed landed; the two being equal is what "clean" means.
   *
   * The converse invariant matters as much as the counter itself: EVERY write
   * to `np:plans` has to move `planGen`, or a pull already on the wire still
   * satisfies `planGen === sentGen` and writes its stale snapshot over it.
   * Two writes bypass `store.savePlan` and so have to bump it by hand — the
   * shared link far below, and `applySyncable` inside a login
   * (`onAuthenticated`).
   */
  let planGen = 0;
  let syncedGen = 0;
  const isDirty = () => planGen !== syncedGen;

  /**
   * This tab is showing a plan it only OPENED — a shared link whose content
   * differed from what this device had stored — and the student has not acted
   * on it. Set a few hundred lines below, where the link is applied.
   *
   * While it is true the tab is a VIEWER: it neither sends (`schedulePush`)
   * nor receives (`handleVisibilityPull`). Sending is the data loss: opening a
   * link writes it straight into `np:plans` (§7's "hash wins over storage"),
   * and a signed-in tab then pushed the friend's plan into the student's own
   * account and over their plan on every device — a link they merely looked
   * at, adopted account-wide, with no action of theirs anywhere in the chain.
   * Not receiving is the other half of the same rule: the account's own plan
   * arriving mid-visit would silently repaint the link away (`applyPulledPlan`
   * → `applyPlanUpdate` also clears `replacedPlan` and rewrites the URL),
   * which is a worse answer to "here is my week" than showing it.
   *
   * A flag rather than a one-line settle at the write itself, because a link
   * does not stop there: the search-index name backfill (`loadIndex`) fires
   * for every link — a hash carries codes, not names — and a link carrying a
   * programme reaches `loadPeriodCourses`' own `savePlan`/`setProgramPlan` a
   * few hundred ms later. Each of those goes through the ordinary subscriber
   * and would have armed exactly the push this exists to prevent.
   *
   * Cleared by "Behold min egen" (`renderLinkNote`), the one gesture the UI
   * offers for settling a link. There is deliberately nothing else: PRODUCT §4
   * flow 5's adoption half ("bruk denne") is unbuilt, and the sync design's §5
   * deletes this branch outright — a viewed link stops touching the
   * recipient's storage at all, which is the durable form of this rule. The
   * known limit until then: this page writes its own plan back into the hash
   * on every change, so RELOADING a link the student kept re-enters the branch
   * with hash and storage agreeing and the flag off, i.e. the ordinary path.
   * That is the same "a link you keep becomes your plan" this branch has
   * always had; what is fixed here is the visit where the student chose
   * nothing at all.
   */
  let viewingSharedLink = false;

  /**
   * What a successful pull needs that a same-tab edit gets for free through
   * `store.onPlanChange`: `applySyncable` (syncClient.ts) writes straight
   * through `storage.setItem`, never through `store.savePlan`, so no
   * `PLAN_CHANGE_EVENT` fires and nothing here re-renders on its own. Without
   * this, the iPad-left-open-for-a-week scenario the visibility trigger
   * exists for only "works" up to a reload: the pulled plan sits correctly in
   * `localStorage` while the screen keeps drawing the week from before the
   * pull.
   *
   * Deliberately does NOT bump `planGen` itself: the pulled content, by
   * definition, is what the server already has, so the pull alone creates
   * nothing new to send. If applying it moves the derivation key and that
   * kicks off `loadPeriodCourses()`, and THAT calls `setProgramPlan`, that
   * goes through `store.onPlanChange` like any other write and bumps
   * `planGen` there — correctly: the derived courses are real local content
   * the server does not have yet. Pushing them is not a bug (see `planGen`'s
   * own comment on why nothing suppresses that here any more) — the other
   * device pulls the same enrichment, re-derives the identical result,
   * `formatPlanHash` matches, and nothing repaints or pushes again. It
   * converges rather than ping-ponging.
   *
   * Repaints only when the pulled plan actually differs: `formatPlanHash` is
   * the same identity check the `hashchange` handler below already uses for
   * "is this actually different" — a pull that came back identical to what
   * is already on screen must not spend the week's layer-motion animation or
   * CLS budget on a no-op.
   */
  function applyPulledPlan(): void {
    const next = store.loadPlan();
    if (formatPlanHash(next) === formatPlanHash(plan)) return;
    applyPlanUpdate(next);
  }

  /**
   * A `signup`/`login`/`resolveLogin` that just landed — the other write to
   * `np:plans` that does not go through `store.savePlan`.
   *
   * `applySyncable` (syncClient.ts) replaced the whole map a moment ago, so
   * this needs the repaint a pull gets AND, unlike a pull, a bump of
   * `planGen`. A pull deliberately does not bump: its content is by definition
   * the server's, and its own `sentGen` check is what makes it safe. A login
   * is not that — it is a write from OUTSIDE the pull's guard, and without the
   * bump a GET already on the wire still satisfied `planGen === sentGen` and
   * wrote its pre-login snapshot on top. For the same account that self-corrects
   * on the next 409; log out and into a DIFFERENT account inside one round trip
   * and it was the other account's plan landing in `np:plans`, under a session
   * carrying this account's version and device registry.
   *
   * `schedulePush` pairs with the bump for the same reason every other bump in
   * this file does: a tab left dirty with nothing armed is the shape that gets
   * flushed at some arbitrary later moment by the visibility trigger. What it
   * sends is the account's own content at the account's own version, so the
   * push is a no-op for the plan — but it is how this device's registry row
   * (written locally by `login`, never yet uploaded) reaches the other devices.
   */
  function onAuthenticated(): void {
    planGen++;
    applyPulledPlan();
    schedulePush();
  }

  /**
   * A pull, guarded against its OWN round trip.
   *
   * `sync.pull()` used to fetch and overwrite `np:plans` in one call, so an
   * edit made between the GET going out and the answer coming back was
   * destroyed by a response that predated it — and then REPORTED AS SAVED:
   * `applySyncable` had resynced `session.version` to the server's, so the
   * debounced push that followed re-read the clobbered storage, landed a
   * clean 200 with no 409, and set "Sist synkronisert nå". Gone from screen,
   * storage and server, under a green light. A guard placed after
   * `await sync.pull()` cannot fix that; storage is already overwritten.
   *
   * Hence `sync.fetchRemote()` (writes nothing) + an explicit
   * `sync.applyRemote()`: `planGen` is snapshotted BEFORE the request and the
   * answer is refused if it moved. Refusing is safe and self-healing — every
   * bump of `planGen` comes from `store.onPlanChange`, which also arms
   * `schedulePush`, so the newer local edit is already on its way out and the
   * next pull (visibility, or the stale-retry inside `pushOnce`) sees a
   * settled tab. `"superseded"` is deliberately NOT reported as a sync
   * failure: nothing is wrong, this answer was simply about an older plan.
   *
   * Returns a `SyncResult` so `pushOnce`'s stale-retry branch can still
   * branch on `.ok`.
   */
  async function pullAndRefresh(): Promise<SyncResult> {
    const sentGen = planGen;
    const fetched = await sync.fetchRemote();
    if (!fetched.ok) {
      // A pull that failed used to say nothing at all, so a session revoked by
      // a PIN change on another device kept reading "Sist synkronisert nå"
      // while every request 401'd.
      accountPanel()?.setSyncState(fetched.reason === "unauthorised" ? "unauthorised" : "failed");
      return { ok: false, reason: fetched.reason };
    }
    if (planGen !== sentGen) return { ok: false, reason: "superseded" };
    sync.applyRemote(fetched.snapshot);
    applyPulledPlan();
    accountPanel()?.setSyncState("ok");
    return { ok: true };
  }

  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Debounced so a fast run of edits (adding five courses in a row) pushes
   *  once. Purely a batching delay now — nothing reads `pushTimer` as a
   *  signal for "is there unsynced work" any more; `isDirty()` is that
   *  signal, and it is correct whether or not this timer happens to be
   *  armed at the moment it is asked. */
  function schedulePush(): void {
    if (sync.session() === null) return;
    // A plan this device only opened is not this device's to send — see
    // `viewingSharedLink`. Every write that follows a link (the name backfill,
    // a programme derive, an edit on top of it) arrives here through the same
    // subscriber, so this one line covers all of them.
    if (viewingSharedLink) return;
    if (pushTimer !== null) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void ensurePush();
    }, 1000);
  }
  lifeSignal.addEventListener("abort", () => {
    if (pushTimer !== null) clearTimeout(pushTimer);
  });

  /**
   * One push attempt, including the existing stale-conflict recovery: pull
   * the server's newer copy, then push once more on top of it. `syncClient.ts`
   * (Task 6) is explicit that there is no merge — a genuine cross-device
   * conflict is last-write-wins there, unchanged by this file. What this
   * file owns is a narrower problem: keeping ONE tab's own debounce/pull
   * timing from destroying ITS OWN unsent edit, which is `ensurePush`'s job,
   * below.
   */
  async function pushOnce(): Promise<SyncResult> {
    let result = await sync.push();
    if (!result.ok && result.reason === "stale") {
      const pulled = await pullAndRefresh();
      if (pulled.ok) result = await sync.push();
      // A session revoked between the PUT and the recovery GET is a more
      // useful answer than the `stale` that sent us here — otherwise the
      // panel says "prøv igjen" over a session that is already gone.
      else if (pulled.reason === "unauthorised") result = pulled;
    }
    return result;
  }

  /**
   * At most one push in flight: a caller that arrives while one is already
   * running is handed that SAME promise rather than starting a second —
   * this is what actually stops a stale-retry pull (inside `pushOnce`) from
   * stacking a second push on one already on the wire. Loops on `planGen`
   * moving DURING the send: `sentGen` is read fresh at the top of each pass,
   * so an edit that lands mid-flight (this push's own `collectSyncable` read
   * already missed it) gets picked up by another pass rather than left
   * dirty with nothing scheduled. `isDirty()` is checked going in — nothing
   * to send is a plain no-op, not a wasted round trip.
   */
  let pushInFlight: Promise<boolean> | null = null;
  function ensurePush(): Promise<boolean> {
    if (pushInFlight) return pushInFlight;
    if (!isDirty()) return Promise.resolve(true);
    pushInFlight = (async () => {
      let ok = true;
      // The third `SyncUiState` was unreachable until now — nothing ever set
      // it, so `syncStatusLine`/`syncSuffix`'s "Synkroniserer …" branches were
      // dead copy. This is the one window it describes.
      accountPanel()?.setSyncState("syncing");
      /** The reason the LAST failing attempt gave, so the panel can tell a
       *  revoked session ("Logg inn på nytt") from a retryable one. */
      let reason = "";
      try {
        for (;;) {
          if (sync.session() === null) {
            ok = true;
            break;
          }
          const sentGen = planGen;
          const result = await pushOnce();
          if (!result.ok) {
            ok = false;
            reason = result.reason;
            break;
          }
          syncedGen = sentGen;
          if (planGen === sentGen) break; // nothing moved while that send was in flight
        }
      } finally {
        pushInFlight = null;
      }
      accountPanel()?.setSyncState(
        ok ? "ok" : reason === "unauthorised" ? "unauthorised" : "failed",
      );
      return ok;
    })();
    return pushInFlight;
  }

  /**
   * The stale-tab guard's real entry point. A tab holding unsynced work is
   * NOT the stale tab the guard exists for: pulling first would overwrite
   * that work's `localStorage` with the server's older copy (`applySyncable`
   * is unconditional). Flush first — cancelling any armed debounce timer,
   * which would otherwise fire later and redo work `ensurePush` is about to
   * do anyway — and only pull once nothing is left dirty. Re-checked AFTER
   * the flush, not just before it starts, because an edit can land during
   * the flush's OWN network round trip too; `ensurePush`'s loop already
   * catches that internally, but this is what decides whether it is safe to
   * pull once the flush call returns. If the flush failed, or something is
   * dirty again by the time it settles, skip the pull for this cycle
   * entirely — do not retry, do not pull anyway. A tab with unsaved work is
   * not stale, and skipping one pull costs nothing next to losing an edit.
   * The common case (nothing dirty) falls straight through exactly as
   * before: `isDirty()` is false and this reaches the pull immediately.
   */
  async function handleVisibilityPull(): Promise<void> {
    // A tab viewing a shared link is neither stale nor dirty in the sense
    // either half of this function means: there is nothing of the student's to
    // flush (`schedulePush` never armed one) and nothing to correct, since
    // what is on screen is a link and not this account's plan.
    if (viewingSharedLink) return;
    if (isDirty()) {
      if (pushTimer !== null) {
        clearTimeout(pushTimer);
        pushTimer = null;
      }
      if (!(await ensurePush())) return;
      if (isDirty()) return;
    }
    void pullAndRefresh();
  }

  document.addEventListener(
    "visibilitychange",
    () => {
      // The stale-tab guard: an iPad left open for a week pulls the server's
      // copy the moment it is looked at again, before the next edit can push
      // a week-old plan over it. Do not remove this or "simplify" it into the
      // debounced push above — a tab that has been hidden for a week has no
      // pending edit to debounce, only a stale read to correct. (A tab that
      // DOES have one is `handleVisibilityPull`'s own job, immediately above.)
      if (shouldPullOnVisible(sync.session(), document.hidden)) void handleVisibilityPull();
    },
    { signal: lifeSignal },
  );

  // On load: a signed-in student's other device may have moved since this
  // tab's `localStorage` copy was written.
  //
  // This used to carry a comment claiming nothing can be dirty this early. It
  // is not true, and the two ways it is false are the two ways this pull could
  // destroy work: the shared-link branch a few hundred lines below runs
  // SYNCHRONOUSLY after this call is made but before its GET resolves, and
  // `loadPeriodCourses()` reaches `store.setProgramPlan` a few hundred ms into
  // the same mount while the studieretning buttons have been live since first
  // paint. `pullAndRefresh`'s own `planGen` guard covers all of it — which is
  // why there is no separate check here.
  if (sync.session() !== null) void pullAndRefresh();

  /** Opens the session popover for a clicked bar or board row. */
  function openBlockPopover(detail: BlockDetail, anchor: HTMLElement): void {
    const state = courseStates.get(detail.code);
    const course = plan.courses.find((c) => c.code === detail.code);

    // What the card's verb may promise comes from the editor's OWN material,
    // so a layer with one option (or none) cannot offer a choice the modal
    // would not show.
    const layerOptions = (buildCourseSettingsContext(detail.code)?.groups ?? []).filter(
      (option) => (option.kind === "lecture") === detail.isLecture,
    );
    const choice: SessionChoice =
      layerOptions.length > 1 ? (detail.isLecture ? "parallel" : "group") : "course";
    // Whether the drawn lecture is a guess is the same question the margin
    // note answers, so it is the same function — a second rule here is how the
    // note and the card start disagreeing.
    const guess = state ? unresolvedLectureChoices([state], false)[0] : undefined;

    blockPopover.showFor(
      {
        detail,
        hueVar: state?.hueVar ?? "--muted",
        courseName: state?.bundle?.details?.courseName ?? course?.name ?? detail.name,
        choice,
        lectureAlternatives: guess?.count ?? 0,
      },
      anchor,
    );
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

  /** One line explaining what we did with a link we could not honour (C4). */
  let linkNote: string | null = null;

  /**
   * Only a semester this build ships plannable data for may enter the state.
   * A verbatim `#v2;25h;…` filtered 2025 entries against 26h's teaching weeks,
   * and `#v2;banana;…` produced a permanently empty grid with no error — then
   * `syncHash()` wrote the bad id straight back.
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
      linkNote = `Lenken pekte på et semester vi ikke kan planlegge ennå. Viser ${semesterLabel(fallback)}.`;
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
        // A shared link's group picks must survive the hash → plan hop.
        ...(c.groups.length > 0 ? { groups: c.groups } : {}),
      })),
      ...(program ? { program } : {}),
    };
  }

  /**
   * Carries the two facts the hash grammar cannot hold — `credits` and the
   * course's real `name` — from the plan already on disk onto the hash-derived
   * one.
   *
   * The page writes its own hash on every render, so a plain F5 goes through
   * the hash-wins branch below; replacing outright *persisted* `{name: code}`
   * with no credits, losing the 7,5 sp only the study plan knows.
   *
   * Only same-semester storage is read (`np:plans` is keyed by semester).
   * Everything the hash *does* carry still wins outright.
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

  // Hash wins over storage on load (PRODUCT.md §6) — but only a hash that
  // carries a plan. Every load ends by writing the current plan back into the
  // hash, so a trivially-empty hash (`#v2;26h;-;`) is indistinguishable from
  // "no hash was ever set" and must defer to localStorage instead of wiping it.
  const hashPlan = parsePlanHash(location.hash);
  const hashHasPlan =
    hashPlan !== null && (hashPlan.program !== null || hashPlan.courses.length > 0);
  let plan: PlanState = store.loadPlan();
  /**
   * The plan a shared link overwrote, kept so the student can have it back.
   *
   * Opening a link REPLACES local state (§7's "hash wins over storage"), which
   * is right — a link that did not show its own plan would be pointless — but
   * it was doing so silently and irreversibly, over a plan the recipient may
   * have spent the evening on. PRODUCT §4 flow 5 asks for three actions here
   * (bruk denne / slå sammen / behold min egen); the merge half is Phase 3 and
   * unbuilt, but the destructive half is live TODAY, so the way back is what
   * ships now. Null whenever there was nothing to lose, or the link carries
   * what is already stored — which is every ordinary reload, since this page
   * writes its own plan into the hash on every change.
   */
  let replacedPlan: PlanState | null = null;
  if (hashPlan && hashHasPlan) {
    const storedHadPlan = plan.program !== undefined || plan.courses.length > 0;
    const incoming = withStoredFacts(planFromHash(hashPlan), plan);
    // `differs` is the whole question for BOTH flags: identical hash and
    // storage is every ordinary reload (this page writes its own plan into the
    // hash on every change), which must keep behaving exactly as before —
    // including staying dirty, since that is how an edit whose push failed in
    // a previous session is recovered by the next flush.
    const differs = formatPlanHash(plan) !== formatPlanHash(incoming);
    if (storedHadPlan && differs) replacedPlan = plan;
    // A link that brought something else is a plan this device is VIEWING, and
    // sync stops in both directions until the student settles it — see
    // `viewingSharedLink` up in the sync block.
    viewingSharedLink = differs;
    plan = incoming;
    // A program-less link must CLEAR any stored profile, not just omit one:
    // `savePlan` can only ever write `np:profile`, never clear it, so the
    // header chip would keep naming the old programme.
    if (hashPlan.program === null) store.removeProgram();
    store.savePlan(plan);
    // A shared link is a write to `np:plans`, and this one is invisible to the
    // counter otherwise: `store.onPlanChange`'s subscriber is not registered
    // until the very end of this function, so the `savePlan` above fires an
    // event nobody is listening to and `planGen` would stay 0. The on-load
    // pull was fired a few hundred lines above and its GET is on the wire
    // right now — with the tab reading as clean, its answer overwrote the
    // friend's plan, `applyPlanUpdate` cleared `replacedPlan` and `syncHash()`
    // rewrote the URL, so the link, the plan and the way back all vanished
    // after a ~200 ms flash. Bumping the counter is what makes
    // `pullAndRefresh`'s guard see the generation move and refuse that answer.
    // It cannot also arm a push — `schedulePush` needs the subscriber that is
    // registered at the end of this function — which left the tab dirty with
    // nothing scheduled; `viewingSharedLink` (above) is what stops the first
    // visibility flip from flushing that as the student's own work.
    planGen++;
  } else if (!knownSemester(plan.semesterId)) {
    // Stored state can outlive a semester too — silently, since no link lied.
    plan = { ...plan, semesterId: defaultSemesterId };
    store.savePlan(plan);
    // Same reason as the branch above: nothing is subscribed yet, and this
    // write is real local content the server has not seen.
    planGen++;
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
  let showOthers = false;
  /**
   * Which week view is on screen. Deliberately NOT in the hash: it is how you
   * are looking at the plan, not what you are looking at, and a link that
   * forced the recipient into a list because the sender was on a phone is a
   * worse answer to "here is my week" than the week. It IS remembered in
   * localStorage.
   */
  let weekView: WeekView = loadWeekView();
  /**
   * Set by a view switch and consumed by the next render, the only one allowed
   * to play the strike-in. A plan edit re-renders the week too, and replaying
   * the animation there would be entrance choreography.
   */
  let pendingViewAnimation = false;
  /**
   * Where `renderGrid` builds a grid nobody will see, while another view is on
   * screen. The grid is still the single owner of the margin notes, the
   * conflict count and the honest-verdict logic; only its geometry is
   * redundant, and eight detached bars is cheaper than a second implementation.
   */
  const discardHost = document.createElement("div");
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
   * `onPopState` returns early on a null state, so writing `null` here leaves
   * this entry dead — Back onto it changes the URL and never swaps the page.
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
    syncPlanProbe(plan);

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

    elements.contextLine.replaceChildren();
    const line = elements.contextLine;
    const append = (node: Node | string): void => {
      if (line.childNodes.length > 0) line.append(" · ");
      line.append(node);
    };
    // WHICH WEEK the grid's dates belong to, FIRST in the line. The week is a
    // pattern, but the page is open in one of them and the day headers carry
    // its dates, so the number that names it has to be visible — and on a phone
    // this line is clamped to one, so anything at its end is the thing that
    // gets cut. A 42-character programme name is the right thing to lose there.
    // Inside the teaching period this names the week the day headers are dated
    // to. Outside it there are no dates to name, so it names what the week IS
    // instead — and says when the dates start meaning something.
    if (inTeachingWeek()) {
      append(el("span", "np-data", `Uke ${isoWeekNumber(new Date())}`));
    } else {
      const first = currentSemester()?.teachingWeeks?.[0];
      append(
        first === undefined
          ? "Mønsteruke"
          : (() => {
              const span = el("span", undefined, "Mønsteruke · undervisning fra ");
              span.append(el("span", "np-data", `uke ${first}`));
              return span;
            })(),
      );
    }
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
    // mount: a shared link carries its own semester, and the control has to
    // agree with the week beside it.
    renderSemesterOptions();
    // ONE ACCENT ON SCREEN, AND ON THE RIGHT ACTION (§8's One-Job-Accent).
    // "Legg til emne" is the primary action of a plan that EXISTS. With no plan
    // it is the secondary route — PRODUCT §1.1 ranks programme + kull first — and while
    // it kept the accent there, the loudest thing on the empty page was the
    // path the mandate ranks second, over an empty-state card whose own primary
    // was grey paper. The card takes the accent back for that one state.
    const hasPlan = plan.program !== undefined || plan.courses.length > 0;
    elements.addCourseBtn.classList.toggle("np-btn--primary", hasPlan);
    elements.share.hidden = !hasPlan;
  }

  /**
   * Hand the plan over. `syncHash` has kept `location` current all along, so
   * this is only the missing verb — the Web Share sheet where the platform has
   * one (a phone, which is where a plan actually gets sent), the clipboard
   * everywhere else.
   *
   * The button reports what happened and then goes back to what it does, which
   * is the whole of the feedback: a copy has no other visible consequence, and
   * a student who does not see one presses again.
   */
  let shareResetTimer: ReturnType<typeof setTimeout> | undefined;
  let shareWidthReserved = false;

  /**
   * Pins the button at its RESTING width, once, before the label ever changes.
   *
   * A label swap that changes the box shoves the controls beside it at the exact
   * moment the student presses one — `Del` → `Lenke kopiert` moved the Uke/Liste
   * switch ~22px sideways. The old fix measured both labels and pinned the
   * wider, which stopped the jump and bought a permanent slab of dead space
   * after the short one.
   *
   * The pair is `Del lenke` → `Kopiert` now, so the RESTING state is the widest
   * and the pin costs nothing at rest: the button never grows, and it is only
   * stopped from shrinking while it holds the shorter word. Measured on the real
   * element rather than guessed, because the label is set in whatever UI face
   * this device has and the measurement includes the mark and the padding.
   */
  function reserveShareWidth(): void {
    if (shareWidthReserved) return;
    // The measured width verbatim, not rounded up: `Math.ceil` on 104.03 pins
    // 105 and the button grows a pixel on the first press — small, but it is
    // the exact class of movement this function exists to stop.
    elements.share.style.minWidth = `${elements.share.getBoundingClientRect().width}px`;
    shareWidthReserved = true;
  }

  async function sharePlan(): Promise<void> {
    const url = location.href;
    // The plan's own name plus the term it is for. The title element stopped
    // carrying the semester when the bar grew a control for it, and the share
    // sheet is the one place that reads this string with no such control beside
    // it — a plan handed over as "MTDT Kull 26" alone would not say which term.
    const name = elements.title.textContent?.trim() || "Semesterplan";
    const term = semesterLabel(currentSemester());
    const title = term === "" ? name : `${name} · ${term}`;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // A dismissed sheet is not a failure and must not fall through to a
        // silent clipboard write the student did not ask for.
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // The failure goes to the line that is already about the link, not into
      // the button: it needs a sentence, and a sentence in a toolbar button is
      // what made this control resize its neighbours in the first place.
      // States what failed and what to do next, in ink, without apology (§7).
      linkNote = "Kunne ikke kopiere lenken. Den står i adressefeltet.";
      renderLinkNote();
      return;
    }
    // The mark answers before the word does, and the word says what happened to
    // the thing the resting label already named. "Kopiert" under a button that
    // reads "Del lenke" the rest of the time is not ambiguous about what went to
    // the clipboard — which is the whole objection "Lenke kopiert" was answering
    // when it was the label that could not name its own object.
    reserveShareWidth();
    elements.share.classList.add("is-copied");
    elements.shareLabel.textContent = "Kopiert";
    clearTimeout(shareResetTimer);
    shareResetTimer = setTimeout(() => {
      elements.share.classList.remove("is-copied");
      elements.shareLabel.textContent = "Del lenke";
    }, 2400);
  }

  /**
   * The credit total. Study-plan credits count, off-semester courses do not, an
   * overload is not painted the same green as a full load, and a >30 sp prefill
   * is not thrown away. `null` credits stay `null` — DR-6's honest gap — but
   * "not fetched yet" is a spinner, not a gap.
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

  /**
   * The load strip: the semester's 30 credits as a track, each counted course a
   * segment in its own printed hue, its width its own credits. It does for
   * credits what the exam band does for the exam period, so a colour means one
   * thing in three places.
   *
   * Only what the TOTAL counts: an off-semester course is excluded (DR-10), or
   * the segments and the number disagree. A 0 sp course cannot be drawn in a
   * strip about credits — it is real and it is in the list, it is not a load.
   */
  function renderCreditStrip(): void {
    const counted = orderedActiveStates().filter(
      (state) => !isOffSemester(state) && (creditsOf(state) ?? 0) > 0,
    );
    // Emptied, never hidden: `[hidden]` takes the track's 15px out of the flow
    // and every row under it moves when the first segment is drawn.
    elements.creditStrip.replaceChildren();
    if (counted.length === 0) return;

    const track = el("div", "planner-load-track");
    let total = 0;
    for (const state of counted) {
      const credits = creditsOf(state) ?? 0;
      total += credits;
      const seg = el("span", "planner-load-seg");
      seg.style.flexGrow = String(credits);
      seg.style.setProperty("--dot", `var(${state.hueVar})`);
      seg.title = `${state.course.code} · ${formatCreditNumber(credits)} sp`;
      track.append(seg);
    }
    // The gap to a full load is empty track, not a segment: it is the absence
    // of a course and must not read as one.
    if (total < FULL_LOAD_CREDITS) {
      const rest = el("span", "planner-load-rest");
      rest.style.flexGrow = String(FULL_LOAD_CREDITS - total);
      track.append(rest);
    }
    // Over a full load, the track no longer says where full IS: the segments
    // fill it edge to edge whether the plan is 30 sp or 45. The mark is where
    // 30 lands, so the overload is a length you can see rather than a number
    // you have to subtract.
    if (total > FULL_LOAD_CREDITS) {
      const mark = el("span", "planner-load-mark");
      mark.style.insetInlineStart = `${(FULL_LOAD_CREDITS / total) * 100}%`;
      mark.title = `${FULL_LOAD_CREDITS} sp`;
      track.append(mark);
    }
    elements.creditStrip.append(track);
  }

  function renderCreditLine(): void {
    renderCreditStrip();
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
    // Green means it *fits*: exactly a full load. Painting 37,5 the same green
    // spends Green-Means-Fits on the opposite of the truth.
    elements.creditLine.classList.toggle(
      "is-full",
      Math.abs(summary.total - FULL_LOAD_CREDITS) < 0.05,
    );
    // The legend only when there is a mark to explain: the track draws one
    // exactly when the plan has run past 30 sp (`renderCreditStrip`).
    elements.loadLegend.hidden = summary.total <= FULL_LOAD_CREDITS;

    const notes: string[] = [];
    if (summary.offSemester > 0) {
      const emner = summary.offSemester === 1 ? "emne" : "emner";
      notes.push(
        `${summary.offSemester} ${emner} undervises ikke i ${semesterLabel(currentSemester())} og teller ikke med.`,
      );
    }
    // No "X sp over normal semesterbelastning" line: "37,5 av 30 sp" sits
    // directly above and already says it. The two notes that remain each carry
    // something the numbers cannot.
    if (suspiciousPrefillCredits !== null) {
      // "Fjern det du ikke tar" needs something to remove. A single mandatory
      // 60 sp masteroppgave — the study plan hangs a multi-semester course's
      // whole credit on its final period — is not a defective study plan.
      const single = (periodCourses?.obligatory.length ?? 0) === 1;
      notes.push(
        single
          ? `Studieplanen fører opp hele emnet (${formatCreditNumber(suspiciousPrefillCredits)} sp) i dette semesteret, men det går over flere semestre.`
          : `Studieplanen oppgir ${formatCreditNumber(suspiciousPrefillCredits)} sp dette semesteret, mer enn et normalt semester. Fjern det du ikke tar.`,
      );
    }
    elements.creditNote.textContent = notes.join(" ");
    elements.creditNote.hidden = notes.length === 0;
  }

  /**
   * How far this plan is from a full load, or `0` when the arithmetic is not
   * settled enough to say. One source for the gap sentence and for whether the
   * add dialog opens scoped to the study plan, so the two cannot disagree about
   * what "short of credits" means.
   */
  function creditGap(): number {
    const summary = creditSummary();
    if (summary.loading) return 0;
    // An *empty* plan still counts as short as long as a programme is set —
    // that is the 3rd-year bachelor whose period prefills nothing at all.
    const hasContext = plan.program !== undefined || plan.courses.length > 0;
    if (!hasContext) return 0;
    return Math.max(0, FULL_LOAD_CREDITS - summary.total);
  }

  /**
   * The gap sentence under the course list. Phrased as remaining credits, never
   * "velg 2 av 5": the study plan carries no cardinality (DR-5), but the credit
   * arithmetic is real.
   *
   * A SENTENCE AND NOTHING ELSE. It used to carry "Velg fra studieplanen (8)"
   * beside it — a second, conditional entrance to picking courses, competing
   * with the standing "Legg til emne" one row below and, worse, opening the very
   * same unfiltered dialog: the pool it named was nowhere on the surface it
   * opened. The pool is a facet inside that dialog now, engaged on open in
   * exactly this state, so the one press this line used to cost still lands on
   * the study plan's courses — and this line is left doing the half a modal
   * cannot do, which is telling you there is a gap before you go looking.
   */
  function renderGapLine(): void {
    const gap = creditGap();
    if (gap <= 0) {
      elements.gapLine.hidden = true;
      return;
    }
    elements.gapLine.hidden = false;
    elements.gapText.textContent = `Mangler ${formatCreditNumber(gap)} sp`;
  }

  // --- The clock ----------------------------------------------------------
  //
  // A planner is a page people leave open. The now marker was nudged every
  // minute, but WHICH DAY IT IS was read once, at render — so a page left open
  // overnight kept yesterday's spine bold and its row tinted while the marker
  // had stepped into today, and every "om N dager" was a day long.
  //
  // The tick therefore has two jobs, and the expensive one only runs when the
  // date has actually rolled.
  let dayStamp = todayStamp();

  function tickNow(): void {
    const stamp = todayStamp();
    if (stamp === dayStamp) {
      // The ordinary minute: one element moves, nothing re-renders. All three
      // views are asked; each no-ops when it is not the one on screen.
      syncNowMarker(elements.gridFrame);
      syncColumnNow(elements.gridFrame);
      syncBoardNow(elements.gridFrame, todayWeekday());
      return;
    }
    dayStamp = stamp;
    // Both dates are read again inside, and this places the marker itself.
    renderGridAndExams();
    // The countdown is a number of days, so the day rolling is exactly when it
    // is wrong. A page left open over midnight said "45 dager igjen" forever.
    renderDeadline();
  }

  const nowTimer = setInterval(tickNow, 60_000);
  lifeSignal.addEventListener("abort", () => clearInterval(nowTimer));
  // A sleeping laptop runs no timers, and returning to the tab is exactly when
  // a stale day gets looked at.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "visible") tickNow();
    },
    { signal: lifeSignal },
  );

  elements.viewKolonner.addEventListener("click", () => setWeekView("kolonner"));
  elements.viewTavle.addEventListener("click", () => setWeekView("tavle"));
  // The travelling rule is measured, so re-measure whenever the measurement
  // could change: a resize, and the frame after font loading settles (there is
  // no webfont to swap any more, but the promise is still the cheapest hook
  // onto "layout has run once").
  window.addEventListener("resize", renderViewTabs, { passive: true, signal });
  document.fonts?.ready.then(() => renderViewTabs());

  // --- Uke ⇄ Liste ----------

  /**
   * Switches which of the two views draws the week. Only the week re-renders:
   * the exam list, credit line and course rows say the same thing in either
   * view, and rebuilding them would throw away the student's scroll position
   * for a change they did not ask those surfaces to make.
   */
  function setWeekView(view: WeekView): void {
    if (weekView === view) return;
    weekView = view;
    saveWeekView(view);
    pendingViewAnimation = true;
    renderGridAndExams();
  }

  /**
   * The pressed state, and the rule that travels to it.
   *
   * Offsets are measured rather than declared because the labels are
   * different widths in every face and at every zoom step. `offsetLeft` is
   * relative to the tabs container, which is the rule's positioned ancestor.
   *
   * Guarded on `offsetWidth` because the unit suite renders into a DOM with no
   * layout: there the tabs still get `aria-pressed` and the decoration with
   * nothing to measure is skipped.
   */
  function renderViewTabs(): void {
    let active: HTMLElement | null = null;
    for (const [button, view] of [
      [elements.viewKolonner, "kolonner"],
      [elements.viewTavle, "tavle"],
    ] as const) {
      const on = weekView === view;
      button.setAttribute("aria-pressed", String(on));
      if (on) active = button;
    }
    const tabs = elements.viewKolonner.parentElement;
    if (!tabs || !active || typeof active.offsetWidth !== "number" || active.offsetWidth === 0) {
      return;
    }
    tabs.style.setProperty("--view-w", `${active.offsetWidth}px`);
    tabs.style.setProperty("--view-x", `${active.offsetLeft}px`);
  }

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
    openScoped: () => creditGap() > 0,
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
  elements.share.addEventListener("click", () => {
    void sharePlan();
  });

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
    // The rows come straight out of the store, so this pass ends the gap the
    // reservation was bridging (paint → mount).
    delete elements.courseRows.dataset.reserve;
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
      // A row is not a control: as a full-width `<button>` it had a pointer
      // cursor and a hover wash while showing nothing pressable. It is inert
      // now and carries ONE explicit target: a settings button at its end.
      const row = el("div", `planner-course-row${isDropped ? " is-dropped" : ""}`);
      row.dataset.code = course.code;
      const details = state?.bundle?.details;
      const name = details?.courseName ?? course.name;

      // A SWATCH AND THE CODE, not the code printed inside the hue. The dot is
      // already what carries a course's identity in the exam list, in Liste's
      // rows and in the session card — this rail was the one place that fused
      // the two, which made the same course two different shapes on one page.
      // A dropped course keeps the swatch and loses its fill, so the row reads
      // as switched off rather than as missing.
      const chip = el("span", "planner-course-chip");
      if (state) chip.style.setProperty("--dot", `var(${state.hueVar})`);
      row.append(chip);

      const nameCell = el("span", "planner-course-name");
      const title = el("span", "planner-course-title");
      title.append(el("b", "planner-course-code np-data", course.code));
      title.append(` ${name}`);
      nameCell.append(title);
      row.append(nameCell);

      // Right-aligned in its own column so the figures stack into something a
      // student can add up by eye.
      if (isDropped) {
        // The one status a row still says for itself: a dropped course is out
        // of the week, the credits and the exams, so a grayed row with no
        // explanation looks broken (PRODUCT §1.3).
        row.append(el("span", "planner-course-sp np-data", "droppet"));
      } else {
        // A course the week cannot draw gets ONE mark; the sentence is in the
        // modal this row opens. It goes UNDER THE NAME, not in the credit
        // column — there it ate the figure, so the one course whose credits you
        // might question was the one that would not quote them.
        const needsAttention =
          notTaughtIn(course.code) !== null ||
          (state !== undefined && isOffSemester(state)) ||
          (state?.bundle?.errors.length ?? 0) > 0;
        if (needsAttention) {
          nameCell.append(el("span", "planner-course-flag np-data", "se detaljer"));
        }
        const credits = state ? creditsOf(state) : (course.credits ?? null);
        if (credits != null) {
          row.append(el("span", "planner-course-sp np-data", `${formatCreditNumber(credits)} sp`));
        } else {
          // The column still has to exist, or the settings button jumps left.
          row.append(el("span", "planner-course-sp"));
        }
      }

      // The row's ONE target.
      const open = el("button", "np-icon-btn planner-course-open");
      open.type = "button";
      open.dataset.code = course.code;
      open.setAttribute("aria-label", `Innstillinger for ${course.code} ${name}`);
      open.append(settingsIcon());
      open.addEventListener("click", () => openCourseSettings(course.code));
      row.append(open);

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

  // --- The week's horizontal scroll (A4) -----------------------------------

  function prefersReducedMotion(): boolean {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  }

  /**
   * Below ~370 px the week frame is narrower than the grid and its rounded
   * border closes mid-column — no fade, no arrow, no visible scrollbar — so the
   * clip reads as an edge and a student can conclude they have no Friday
   * lecture. `data-scroll` drives the edge mask.
   *
   * What is hidden is measured from the GRID's own box, not the frame's
   * `scrollWidth`: the frame's 24 px padding counts as scrollable content, so
   * both edges faded on a week the student could already see in full.
   */
  function syncGridScroll(): void {
    const frame = elements.gridFrame;
    // Whichever week is mounted: the transposed grid or the column grid.
    // Asking for `.planner-grid` alone left the view that scrolls sideways by
    // design with no edge mask and no `data-scroll`.
    const week =
      frame.querySelector<HTMLElement>(".planner-grid") ??
      frame.querySelector<HTMLElement>(".planner-cols");
    const maxScroll = frame.scrollWidth - frame.clientWidth;
    // No week mounted (a message or fallback card) — nothing to scroll to.
    const hidden = week ? week.getBoundingClientRect().width - frame.clientWidth : 0;
    if (hidden <= 1) {
      delete frame.dataset.scroll;
      return;
    }
    const left = frame.scrollLeft;
    frame.dataset.scroll = left <= 1 ? "start" : left >= maxScroll - 1 ? "end" : "middle";
    setScrollFade(frame, left, maxScroll);
  }

  /**
   * Once per mount: put something WORTH SEEING in view rather than always
   * Monday's column. Only the column view has columns to scroll to; it no-ops
   * in the other two, which have no day headers to find.
   *
   * It scrolled to today, and had two holes that met on a phone. At 390 px the
   * frame is 343 px over a 1529 px week — 4.4 screens — so whatever this lands
   * on is the whole of what the student sees. (a) It returned early on a
   * weekend, and (b) it scrolled to today's column whether or not that column
   * held anything. Through the entire pre-semester planning window — which is
   * when this tool is used at all — today is not in the drawn week in the first
   * place, so it did nothing and the week opened parked on Monday. A plan whose
   * only two sessions are on Friday therefore opened as an EMPTY GRID.
   *
   * So: today when today has sessions (a student mid-semester is asking about
   * today), otherwise the first day that has any, otherwise leave it alone —
   * there is nothing to prefer in a week with nothing in it.
   */
  let didScrollWeek = false;

  function scrollWeekIntoView(): void {
    if (didScrollWeek) return;
    const frame = elements.gridFrame;
    if (frame.scrollWidth - frame.clientWidth <= 1) return;
    // `Array.from`, not a spread: this module is reachable from the Node
    // typecheck pass (tsconfig.test.json), whose `lib` has no `DOM.Iterable`.
    const columns = Array.from(frame.querySelectorAll<HTMLElement>(".planner-cols-day[data-day]"));
    const withSessions = columns
      .filter((column) => column.querySelector(".planner-cols-block") !== null)
      .map((column) => Number(column.dataset.day))
      .filter((day) => Number.isFinite(day))
      .sort((a, b) => a - b);
    if (withSessions.length === 0) return;
    const weekday = new Date().getDay(); // 0 = Sunday
    const today = weekday === 0 ? 7 : weekday;
    const target = withSessions.includes(today) ? today : (withSessions[0] as number);
    const header = frame.querySelector<HTMLElement>(
      `.planner-cols-day-header[data-day="${target}"]`,
    );
    if (!header) return;
    didScrollWeek = true;
    const offset = header.getBoundingClientRect().left - frame.getBoundingClientRect().left;
    frame.scrollTo({
      left: Math.max(0, frame.scrollLeft + offset - RAIL_WIDTH_PX),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  elements.gridFrame.addEventListener("scroll", syncGridScroll, { passive: true, signal });
  // A resize changes what an hour is worth in pixels, so it changes both
  // whether the week is off-frame and what each bar has room to say.
  window.addEventListener(
    "resize",
    () => {
      syncGridScroll();
      fitBlockLabels(elements.gridFrame);
    },
    { passive: true, signal },
  );

  // The week's column cap is viewport-dependent, and crossing that boundary — a
  // rotation, a window drag — changes no plan state, so nothing else would
  // redraw the grid. Only the boundary fires, not every resize frame.
  globalThis
    .matchMedia?.("(max-width: 40rem)")
    .addEventListener("change", () => renderGridAndExams(), { signal });

  /**
   * The verdict beside the Ukeplan kicker — PRODUCT §2's primary job, *kan jeg
   * ta disse emnene sammen?*, answered on the page. Counts are grouped slots,
   * so a three-way clash is one problem, and nothing is asserted while a fetch
   * could still change it.
   *
   * When a course's timetable never arrived the check is INCOMPLETE and the
   * line says so rather than going quiet: silence reads as "nothing to report"
   * beside a drawn week. It is a gap, not a clash, so it keeps the muted ink —
   * neither Green-Means-Fits nor Red-Is-Collision may be spent on "we do not
   * know".
   */
  function renderVerdict(grid: GridRenderResult | null, loading: boolean): void {
    const host = elements.gridStatus;
    host.replaceChildren();
    // `planner-verdict` is the layout class and must survive: this used to
    // assign `className` outright, which meant the page's own rule for the
    // element applied for exactly as long as it took the first render to run.
    host.className = "planner-verdict";
    if (loading) {
      host.append(el("span", "planner-chip", "henter timeplan …"));
      return;
    }
    if (grid?.state !== "grid") return;
    if (grid.incompleteCourses.length > 0) {
      const n = grid.incompleteCourses.length;
      // A gap, not a clash: neither Green-Means-Fits nor Red-Is-Collision may
      // be spent on "we do not know", so this chip carries no mark at all.
      host.append(
        el(
          "span",
          "planner-chip is-unknown",
          `kan ikke sjekkes, mangler timeplan for ${n} ${n === 1 ? "emne" : "emner"}`,
        ),
      );
      renderLoadChip(host);
      return;
    }
    // Anything still in flight (`partial` without an incomplete course).
    if (grid.partial) return;
    // NOTHING WAS CHECKED. `conflictCount: 0` over an empty lecture set is
    // arithmetic, not a verdict, and printing Green-Means-Fits over it is the
    // one failure this whole surface cannot afford: a plan NTNU marks no
    // `forelesning` in drew its week and answered "ingen forelesninger
    // kolliderer" over bars that visibly overlap. The margin already explains
    // WHY (the auto-reveal note, or the unpicked-group notes) — the verdict's
    // job is only to stop claiming a check it never ran.
    if (grid.checkedLectureCount === 0) {
      host.append(
        el("span", "planner-chip is-unknown", "kan ikke sjekkes, ingen forelesninger i planen"),
      );
      renderLoadChip(host);
      return;
    }
    if (grid.conflictCount === 0) {
      const chip = el("span", "planner-chip is-clean");
      chip.append(icon("circleCheck"));
      chip.append("Ingen forelesninger kolliderer");
      // A PASS THAT SAYS WHAT IT PASSED ON. Some courses publish sessions but
      // nothing this app can call a lecture, so the DR-1 check goes over them
      // rather than on them — and an unqualified green then claims five
      // courses on the strength of four. The admission existed only as a
      // margin note 570 px below, which on a phone was collapsed behind a
      // disclosure while a CSS rule hid the pass itself: the small screen
      // showed the caveat and never the answer it qualifies. `.is-qualified`
      // is what that rule now tests, so a pass carrying a caveat survives.
      const unchecked = grid.uncheckedCourses.length;
      if (unchecked > 0) {
        chip.classList.add("is-qualified");
        chip.append(
          el(
            "span",
            "planner-chip-caveat",
            ` · ${unchecked} ${unchecked === 1 ? "emne" : "emner"} ikke sjekket`,
          ),
        );
      }
      host.append(chip);
      renderLoadChip(host);
      return;
    }
    // A VERDICT YOU CAN FOLLOW. The one thing a student does after reading
    // "2 kollisjoner denne uka" is look for them, and the week is a scroller —
    // so the sentence is the shortcut to the place it is about. A button rather
    // than a link: it moves the page, it does not go anywhere.
    const chip = el("button", "planner-chip np-note-clash is-jump");
    chip.type = "button";
    chip.append(icon("circleAlert"));
    chip.append(el("span", "np-data", String(grid.conflictCount)));
    chip.append(grid.conflictCount === 1 ? " kollisjon denne uka" : " kollisjoner denne uka");
    chip.addEventListener("click", jumpToFirstClash);
    host.append(chip);
    renderLoadChip(host);
  }

  /**
   * Scrolls the week to its first collision, in whichever view is drawing it.
   *
   * Every view marks a clash with something: the column grid a zone over the
   * shared minutes, the transposed grid the same, the list a rule in the
   * margin of the rows involved. Whichever exists is the target — no view
   * needs to be switched to, because the student chose the one they are in.
   */
  function jumpToFirstClash(): void {
    const mark = elements.gridFrame.querySelector(
      ".planner-cols-clash, .planner-clash-zone, .planner-board-row.is-clashing",
    );
    mark?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
  }

  /**
   * What the øving layer is still waiting on, said ON the control that reveals
   * it.
   *
   * The layer draws PICKED groups only, and that narrowing is right — drawing
   * every group of every course put 41 blocks in one week (`visibleLayer`). But
   * it made the control dishonest: on a five-course plan, ticking «Øvinger og
   * labber» added two blocks, because the four courses with a real choice in
   * them drew nothing at all. A toggle that visibly does nothing reads as "I
   * have no øvinger", which is the opposite of true.
   *
   * So the control carries the count, and the margin keeps naming the courses
   * and staying clickable. Only while the layer is ON: beside an unticked box
   * "3 mangler gruppe" would be a fact about something not on screen.
   */
  function renderOthersPending(codes: string[]): void {
    const host = elements.othersPending;
    const on = elements.othersToggle.getAttribute("aria-pressed") === "true";
    if (!on || codes.length === 0) {
      host.replaceChildren();
      host.hidden = true;
      return;
    }
    host.replaceChildren(el("span", "np-data", String(codes.length)), " mangler gruppe");
    host.hidden = false;
  }

  /**
   * The load, said where the verdict is said.
   *
   * Only when it is over 30 sp: "37,5 av 30 sp" is a thing to look at, "22,5 av
   * 30 sp" is not — a student mid-assembly does not need to be told on every
   * render that they are not finished. The full figure lives under the load
   * track in the Emner column either way, so nothing is only here.
   */
  function renderLoadChip(host: HTMLElement): void {
    const summary = creditSummary();
    // `creditSummary`, not a second sum: the strip, the foot line and this chip
    // must never be able to disagree about what the load is, and DR-10's
    // off-semester exclusion lives in there.
    if (summary.loading || summary.total <= FULL_LOAD_CREDITS) return;
    const chip = el("span", "planner-chip is-over");
    chip.append(icon("circleAlert"));
    chip.append(
      el("span", "np-data", `${formatCreditNumber(summary.total)} av ${FULL_LOAD_CREDITS} sp`),
    );
    host.append(chip);
  }

  /**
   * PRODUCT D13's deadline, which had been on screen in zero of the six flows.
   *
   * It is the whole positioning — "before the registration deadline" — and a
   * standing NTNU date rather than a crawled one (`deadline.ts` says why). Past
   * the date it says nothing at all rather than "utløpt": the page still plans
   * the term you are in.
   */
  function renderDeadline(): void {
    const host = elements.deadline;
    host.replaceChildren();
    const deadline = registrationDeadline(plan.semesterId);
    if (!deadline) {
      host.hidden = true;
      return;
    }
    const parts = deadlineParts(deadline);
    host.append(parts.before);
    host.append(el("b", undefined, parts.date));
    host.append(parts.after);
    host.hidden = false;
  }

  /**
   * The same verdict for the exam head. C3's "we cannot speak for that year" is
   * NOT repeated here — it is the frame's sentence (`examUncovered`), and
   * printing it twice within 40 px is noise.
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

  /**
   * A centered card where the week would be, for the empty/fallback states that
   * carry an action button rather than a sentence. Resets the frame the way
   * `renderGridMessage` does, then mounts the card `build` fills.
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

    const noProfile = plan.program === undefined && plan.courses.length === 0;
    const showFallback = noProfile || (states.length > 0 && !anyLoading && (!published || empty));

    let gridResult: GridRenderResult | null = null;
    if (noProfile) {
      // State 1: no plan at all.
      renderWeekCard((card) => {
        // DESIGN §8: an empty state is an invitation to act. "Ingen plan ennå."
        // is a STATUS — it named the absence and left the page saying nothing
        // about what the tool is for, on the one screen where the student has
        // no other evidence. This is PRODUCT §1.1's mandate in one sentence.
        card.append(
          el(
            "p",
            "np-hint planner-week-card-hint",
            "Velg studieprogram og kull, så tegner vi uka di — med forelesninger, kollisjoner og eksamensdatoer.",
          ),
        );
        // THE ACCENT GOES ON THE MANDATE'S OWN PATH. This was a paper button
        // while "Legg til emne" wore the accent — so on the empty state the
        // loudest thing on the page was the SECONDARY route, and the primary
        // one read as its footnote. `renderBanner` demotes "Legg til emne"
        // while there is no plan, so there is still exactly one accent on
        // screen (§8's One-Job-Accent).
        //
        // FIRST RUN GOES STRAIGHT TO THE FIELD. The panel opens with the
        // caret in the programme search, so this button and the next keystroke
        // are one continuous action — the panel's account half is below the
        // fold of the student's attention, which is where an opt-in thing
        // belongs.
        const primary = el("button", "np-btn np-btn--primary", "Velg studieprogram");
        primary.type = "button";
        primary.addEventListener("click", () => openStudieinfo("program"));
        card.append(primary);
        // The panel is the way in; the dialog is the "I already know a code"
        // escape hatch. A paper button rather than `.np-navlink`, which at
        // --muted with no underline did not read as pressable at all.
        const secondary = el("button", "np-btn planner-week-card-secondary", "Jeg har emnekodene");
        secondary.type = "button";
        secondary.addEventListener("click", () => openAddFromQuestion());
        card.append(secondary);
      });
    } else if (showFallback && semester) {
      // Ordered by severity, not by narrative. A question used to win over both
      // branches below, so a student who lost connectivity was told to pick a
      // studieretning with no "Prøv igjen" anywhere. Neither is answerable by
      // the student. The question is not lost: `#planner-direction` renders it
      // in its own panel directly above this frame.
      if (failed) {
        // State 3: a fetch failed. NEVER the "publiseres" copy — offer a retry.
        renderWeekCard((card) => {
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
        renderGridMessage(
          elements.gridFrame,
          elements.gridNotes,
          `Timeplan for ${semesterLabel(semester)} publiseres vanligvis i ${publishMonthFor(semester.id)}. Kom tilbake da.`,
        );
      } else if (question) {
        // A studieretning/elective/period question owns the empty week — its
        // sentence, not a fallback card, is what the student acts on.
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
    } else if (weekView === "kolonner") {
      // The column grid draws into the same frame from the same states, on the
      // same terms as Tavla below: `renderGrid` still owns the margin notes and
      // the conflict count, because which courses we could not draw is a fact
      // about the WEEK, not about which way round it is drawn.
      //
      // `onChoiceClick` rides along with the notes, NOT with the week: a note
      // that says "EXPH0300 har 14 grupper" is a link into the picker, and it
      // is inert without this. It used to be passed only by the branch that
      // drew Rader into the real frame, so deleting that view took the notes'
      // click with it.
      gridResult = renderGrid(discardHost, elements.gridNotes, filteredStates, showOthers, {
        loading: anyLoading,
        pendingChoiceMessage: question?.weekMessage ?? null,
        onChoiceClick: openCourseSettings,
      });
      const columns = renderColumnGrid(
        elements.gridFrame,
        filteredStates,
        currentSemester()?.teachingWeeks ?? [],
        showOthers,
        {
          todayNumber: todayWeekday(),
          animate: pendingViewAnimation,
          onBlockClick: openBlockPopover,
          // Only inside the teaching period — see `inTeachingWeek`. Undefined
          // leaves `columnGrid` drawing bare weekday names, which is what a
          // pattern week is.
          dates: inTeachingWeek() ? weekdayDates(new Date()) : undefined,
        },
      );
      // Nothing to draw is a message branch, not an empty frame. The messages
      // live in `renderGrid` and only there, so the fallback is to let it draw
      // them into the real frame.
      if (columns.blockCount === 0 && gridResult.state !== "grid") {
        gridResult = renderGrid(
          elements.gridFrame,
          elements.gridNotes,
          filteredStates,
          showOthers,
          {
            loading: anyLoading,
            pendingChoiceMessage: question?.weekMessage ?? null,
            onChoiceClick: openCourseSettings,
          },
        );
      }
    } else {
      // Tavla renders into the same frame from the same states — a view of the
      // plan, not a second plan. `renderGrid` still owns the margin notes —
      // and their click into the picker — for the same reason as the column
      // branch above.
      gridResult = renderGrid(discardHost, elements.gridNotes, filteredStates, showOthers, {
        loading: anyLoading,
        pendingChoiceMessage: question?.weekMessage ?? null,
        onChoiceClick: openCourseSettings,
      });
      renderBoard(
        elements.gridFrame,
        filteredStates,
        currentSemester()?.teachingWeeks ?? [],
        showOthers,
        {
          todayNumber: todayWeekday(),
          animate: pendingViewAnimation,
          onBlockClick: openBlockPopover,
        },
      );
    }
    // The strike-in plays once, on the render a view switch caused — never on
    // the re-render a group pick or a plan edit causes.
    pendingViewAnimation = false;
    renderViewTabs();

    // B7a: the grid can reveal the muted øving layer on its own when nothing
    // classifies as a lecture, and the toggle has to say so. This is not the
    // student's `showOthers` — not persisted, only mirrored.
    elements.othersToggle.setAttribute(
      "aria-pressed",
      String(showOthers || gridResult?.mutedLayerAutoRevealed === true),
    );
    renderOthersPending(gridResult?.pendingGroupCourses ?? []);

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
    // The exam list's lease, handed back the moment the list stops waiting —
    // whichever branch answered, including the two that answer with one
    // sentence. Held longer, an apology sits atop five courses of reserved air.
    if (!examLoading) delete elements.examList.dataset.reserve;
    syncGridScroll();
    // Only once the bundles are in. A week drawn while a fetch is still in
    // flight is drawn on PROVISIONAL geometry — and worse, the re-render when
    // the rest lands replaces the grid's DOM, which resets `scrollLeft` and
    // strands a smooth scroll part-way. Measured: it left the phone at 198 px
    // of a 1529 px week whose only sessions start at 1035.
    if (gridResult?.state === "grid" && !anyLoading) scrollWeekIntoView();
    if (!anyLoading) settleWeekBox();
  }

  /**
   * Ends the frame's reservation, and files what the week actually measured for
   * the next load to reserve from (`saveWeekBox`).
   *
   * The lease is the important half: every reserved number is an estimate of a
   * week that has not been drawn, and leaving it standing is how loading in
   * Liste and then pressing the other tab left 600px of white paper for the
   * rest of the visit.
   *
   * Three states are deliberately neither released nor remembered: a skeleton,
   * an apology and an onboarding card are all shorter than the week they stand
   * in for, so releasing collapses the frame just before the real week fills it
   * and remembering under-reserves the next load. A week mid-`is-settling` is
   * not evidence either — measuring it files a frame of an animation.
   */
  function settleWeekBox(): void {
    const inner = elements.gridFrame.firstElementChild as HTMLElement | null;
    if (!inner) return;
    if (
      inner.classList.contains("is-skeleton") ||
      inner.classList.contains("is-settling") ||
      inner.classList.contains("planner-grid-empty") ||
      inner.classList.contains("planner-week-card")
    ) {
      return;
    }
    // Synchronously, in the frame the week landed in: the content is at least
    // as tall as the reservation except in the cases this releases ON PURPOSE,
    // and those should collapse now rather than a paint later.
    delete elements.gridFrame.dataset.reserve;
    // The measurement waits for layout, and only counts if this is still the
    // element that was drawn.
    requestAnimationFrame(() => {
      if (!inner.isConnected) return;
      saveWeekBox(weekView, window.innerWidth, inner.getBoundingClientRect().height);
    });
  }

  // --- Provenance line -----------------------------------------------------

  /**
   * DR-8's provenance line, reduced to the half worth reading: **what we could
   * not verify**. It is silent when the join is clean and speaks only when it
   * is not — "the join admits its gaps" is the MUST; stating that it has none
   * is not part of it, and boilerplate printed every time carried the failure
   * clauses down with it.
   *
   * RE-COMPOSED whenever anything it describes changes: `loadBundles` used to
   * re-render four things and not this one, which made the per-course failure
   * clause structurally unreachable.
   */
  function renderProvenance(): void {
    const semester = currentSemester();
    const states = orderedActiveStates();
    const notes: string[] = [];

    // Nothing to be provenance about, or the answer is still arriving.
    const settled = states.length > 0 && !states.some((s) => s.loading);

    if (settled && semester) {
      const indexCovers = indexCoversSemester(plannerIndex, plan.semesterId);
      if (plannerIndexFailed) {
        // Our own artifact, not NTNU's: "ikke publisert" here would be a
        // statement about NTNU derived from our own failed download.
        notes.push("Fikk ikke hentet eksamensdatoene.");
      } else if (!indexCovers) {
        notes.push(`Eksamensdatoer ikke publisert for ${semesterLabel(semester)}.`);
      }
    }

    // Which study plan we actually read, but ONLY when it is not the one asked
    // for. The 404 step-back walks back up to two cohorts and used to be
    // invisible: kull 2026 got a confident 30 sp week off the 2024 curriculum
    // under the words "studieplan for kull 2026". Silent while in flight.
    const program = plan.program;
    if (program) {
      if (studyPlanOutcome.kind === "found" && studyPlanOutcome.year !== program.cohort) {
        notes.push(
          `Studieplan for kull ${studyPlanOutcome.year}, det finnes ingen egen plan for kull ${program.cohort}.`,
        );
      } else if (studyPlanOutcome.kind === "not-found") {
        notes.push(`Fant ingen studieplan for ${program.code}.`);
      } else if (studyPlanOutcome.kind === "error") {
        notes.push(`Fikk ikke hentet studieplanen for ${program.code}.`);
      }
    }

    // The per-course gaps, named. Silence over a course whose timetable 404'd
    // is what makes the whole verdict untrustworthy.
    const failures: string[] = [];
    for (const state of states) {
      for (const error of state.bundle?.errors ?? []) {
        const what = error.split(":")[0]?.trim() ?? "data";
        failures.push(`${what} for ${state.course.code}`);
      }
    }
    if (failures.length > 0) notes.push(`Fikk ikke hentet ${failures.join(", ")}.`);

    // Only when the index can speak for this semester. Otherwise the count came
    // from last catalog year's dateless rows (which survive the window by
    // design) inside a sentence that had just said we have no exam data at all.
    const dateless =
      settled && indexCoversSemester(plannerIndex, plan.semesterId) && !plannerIndexFailed
        ? countDatelessExams()
        : 0;
    if (dateless > 0) {
      notes.push(
        `${dateless} ${dateless === 1 ? "eksamen har" : "eksamener har"} ingen dato ennå.`,
      );
    }

    elements.provenance.textContent = notes.join(" ");
    elements.provenance.hidden = notes.length === 0;
  }

  /**
   * Exams the catalog lists for this semester but has set no date for
   * (DR-3/U9). Built through the exam list's own `collectExamInputs` so the
   * number and the rows can never disagree.
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
        renderProvenance();
      })
      .catch(() => {
        // Not swallowed: the exam column used to spin forever, the add dialog
        // forever said "Henter emner …", and the provenance line claimed NTNU
        // had published no exam dates.
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

  /**
   * The line above the week that is about the LINK rather than about the plan:
   * a semester we substituted (C4), or a plan this link replaced.
   *
   * The second carries a verb, because it is the only way back to something the
   * page took away without asking. It is not "Angre" — nothing the student did
   * is being undone — and not "Fjern", which §7 reserves for an outright
   * removal. It names the thing you get: your own plan.
   */
  function renderLinkNote(): void {
    const host = elements.linkNote;
    host.replaceChildren();
    if (linkNote !== null) host.append(linkNote);
    if (replacedPlan !== null) {
      if (linkNote !== null) host.append(" ");
      host.append("Denne delte planen erstattet din egen. ");
      const restore = el("button", "np-navlink planner-link-restore", "Behold min egen");
      restore.type = "button";
      restore.addEventListener("click", () => {
        const mine = replacedPlan;
        if (!mine) return;
        // Cleared FIRST: `savePlan` re-enters through `onPlanChange` → renderAll
        // → here, and a note still offering the plan it just restored would
        // hand the shared one back on a second press.
        replacedPlan = null;
        linkNote = null;
        // The link is settled, and settled toward the student's own plan: this
        // tab stops being a viewer and syncs again from the write below. The
        // only gesture that clears this — there is no "Bruk denne" yet, and §5
        // of the sync design deletes the whole branch rather than adding one.
        viewingSharedLink = false;
        if (mine.program === undefined) store.removeProgram();
        store.savePlan(mine);
      });
      host.append(restore);
    }
    host.hidden = linkNote === null && replacedPlan === null;
  }

  function renderAll(): void {
    syncCourseStates();
    // An empty plan is not a dead end: the week frame shows the onboarding card
    // and the Emner rail keeps its "Legg til emne" button mounted.
    renderLinkNote();
    renderBanner();
    renderDeadline();
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
      renderCreditLine();
      renderCourseRows();
      renderGapLine();
      renderGridAndExams();
      // The one that was missing, and the reason DR-8's line used to freeze
      // while its failure clause could never fire.
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
    const obligatory = resolved.courses?.obligatory ?? [];
    suspiciousPrefillCredits = isSuspiciousPrefill(obligatory) ? prefillCredits(obligatory) : null;

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

  elements.othersToggle.addEventListener("click", () => {
    showOthers = !showOthers;
    elements.othersToggle.setAttribute("aria-pressed", String(showOthers));
    // One layer arriving or leaving, not a new week: what was already on screen
    // travels, what changed is what moves. The snapshot has to be taken before
    // the re-render tears the subtree down, hence the two calls around it.
    const settle = beginLayerChange(elements.gridFrame, showOthers ? "reveal" : "hide");
    renderGridAndExams();
    settle();
  });

  /**
   * Skipped when nothing the study plan depends on changed: `onPlanChange` used
   * to refetch unconditionally, so picking a kull cost three sequential round
   * trips and every Dropp/Legg tilbake cost another.
   */
  let lastDerivationKey: string | null = null;

  /**
   * Paints `next` onto the page: the in-memory `plan`, the address bar, both
   * rendered views, and — if the derivation key moved — a re-fetch of the
   * study plan. The one shared step between a same-tab plan write (below)
   * and a successful sync pull (`applyPulledPlan`, near the sync setup
   * above).
   */
  function applyPlanUpdate(next: PlanState): void {
    // C4's note only explains a semester we SUBSTITUTED for the link's own, so
    // a deliberate switch is when it stops being true. Nothing else clears it:
    // studieinfo's Lagre goes through `savePlan` and `syncHash`'s replaceState,
    // which fires no `hashchange`.
    if (next.semesterId !== plan.semesterId) linkNote = null;
    // Once the student edits the arrived plan they have chosen it, and an offer
    // to "keep my own" would by then throw away the shared plan AND the edits
    // they just made on top of it — a destructive action wearing the word
    // recovery. The restore path clears this itself before saving.
    replacedPlan = null;
    plan = next;
    syncHash();
    renderAll();
    void loadBundles();
    const key = derivationKey();
    if (key !== lastDerivationKey) {
      lastDerivationKey = key;
      void loadPeriodCourses();
    }
  }

  const unsubscribe = store.onPlanChange((next) => {
    // The one fact `isDirty()` (near the sync setup, above) is asked
    // against — bumped for every change this subscriber sees, a real edit
    // or a pull-driven re-derive (`setProgramPlan` inside
    // `loadPeriodCourses`) alike, unconditionally. See `planGen`'s own
    // comment for why nothing here tries to tell the two apart any more.
    planGen++;
    applyPlanUpdate(next);
    // The debounced push trigger: every plan write (add/drop a course, change
    // a group, edit studieinfo) reaches the store through here, so wiring it
    // once at the top of the fan-out covers all of them.
    schedulePush();
  });
  signal?.addEventListener("abort", unsubscribe);

  /**
   * The hash is re-read on every change, or pasting a shared plan into an
   * already-open planner would change the address bar and nothing else — and
   * the next edit would rewrite the hash from local state. Our own
   * `replaceState` writes are ignored by comparing against the exact string we
   * last wrote (pure ASCII, so the browser does not re-normalise it).
   */
  window.addEventListener(
    "hashchange",
    () => {
      if (location.hash === lastWrittenHash) return;
      const parsed = parsePlanHash(location.hash);
      if (!parsed) return;
      if (parsed.program === null && parsed.courses.length === 0) return;
      linkNote = null;
      // Same merge as the initial load: a pasted link re-stating courses
      // already in the plan must not strip their credits.
      const incoming = withStoredFacts(planFromHash(parsed), plan);
      // …and the same rescue. Pasting a link into an ALREADY-OPEN planner
      // replaces the plan exactly as arriving on one does, so it owes the same
      // way back — `onPlanChange` below clears this, so it is captured here and
      // re-set after the save that triggers it.
      const displaced =
        plan.program !== undefined || plan.courses.length > 0
          ? formatPlanHash(plan) !== formatPlanHash(incoming)
            ? plan
            : null
          : null;
      // Same as the initial load: a program-less link clears the stored profile
      // (savePlan cannot), so the chip stops naming the old programme.
      if (parsed.program === null) store.removeProgram();
      store.savePlan(incoming);
      if (displaced) {
        replacedPlan = displaced;
        renderLinkNote();
      }
    },
    { signal },
  );

  loadIndex();

  // First paint from the initial (hash-or-storage) plan, then kick off fetches.
  syncHash();
  renderAll();

  lastDerivationKey = derivationKey();
  await Promise.all([loadBundles(), loadPeriodCourses()]);
}
