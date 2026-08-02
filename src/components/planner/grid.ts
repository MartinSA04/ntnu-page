/**
 * UKEPLAN — the weekly spread (PRODUCT.md §0/DR-1). **Days are rows and time
 * is the horizontal axis**: one row per weekday, its name in the left spine,
 * its sessions as bars along a labelled hour ruler. A day row is the full page
 * width, so a 1 t 45 lecture is 22 % of it, and overlaps stack downward into
 * lanes where vertical space is free.
 *
 * The axis is labelled and a bar starts at its own minute, so a bar prints
 * `room · activity` rather than repeating its start time.
 *
 * Overlap is a *supported* state. What keeps it readable:
 *   1. each course renders only its selected group set (`applyGroupSelection`);
 *   2. identical parallel slots collapse to one bar ("Lab · 4 grupper");
 *   3. an all-day drop-in window becomes a band behind the day, not a lane;
 *   4. `layoutDay` packs the rest into uncapped lanes.
 *
 * Lectures render by default; `showOthers` adds øving/lab/seminar bars —
 * muted, never red, never fed to the conflict engine. Only lecture×lecture
 * overlaps mark a collision, drawn as ONE zone per day across the overlapping
 * minutes. `renderBoard` (board.ts) is the second view of the same data.
 *
 * The week never answers for teaching it never saw: `planGaps` turns each
 * course's `TimetableOutcome` into a named margin note, so a failed fetch
 * makes the check incomplete (`incompleteCourses`) and a course NTNU publishes
 * nothing for is said out loud instead of vanishing.
 */
import { classifyActivity } from "../../lib/planner/activity.js";
import {
  type ConflictGroup,
  findConflicts,
  groupConflicts,
  mergeParallelSlots,
} from "../../lib/planner/conflicts.js";
import { timetableOutcomeOf } from "../../lib/planner/data.js";
import {
  applyGroupSelection,
  entryGroupKey,
  groupOptions,
  resolveLectureDefaults,
} from "../../lib/planner/groups.js";
import { type LayoutInput, layoutDay } from "../../lib/planner/layout.js";
import { parseWeeks, type ScheduleEntry } from "../../lib/planner/schedule.js";
import { dayName, dot, el, weekLabel } from "./dom.js";
import { staggerStep } from "./layerMotion.js";
import type { PlanCourseState } from "./types.js";

const ROW_MINUTES = 15;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;
/** Hours the loading skeleton reserves, so the real grid lands without a reflow. */
const SKELETON_END_HOUR = 16;
/** Weekdays the skeleton draws before it knows whether Saturday is needed. */
const SKELETON_DAYS = 5;

/** A non-lecture window at least this long is a drop-in band, not a lane (U1). */
const ALL_DAY_MINUTES = 5 * 60;
/**
 * Below this DURATION a bar carries its course code and nothing else — time is
 * the horizontal axis, so 45 minutes is ~100 px on a laptop, a code's worth.
 */
const COMPACT_BLOCK_MINUTES = 60;

/**
 * No cap: a lane is vertical space, which is free, and a bar's width comes
 * from its duration rather than from how many things it collides with. So
 * `layoutDay` can never return `piled`.
 */
const LANE_CAP = Number.POSITIVE_INFINITY;

export interface GridEntry extends ScheduleEntry {
  hueVar: string;
  /** The course's proper name (for the block popover), distinct from `name`. */
  courseName: string;
  /** The activity/group label — `title`, e.g. "Forelesningsparallell 2 Trondheim". */
  name: string;
  rooms: string;
  /**
   * The building(s) those rooms sit in, or "" when upstream gave none or gave
   * one the room label already shows. Bar has no width for it; the popover
   * does, and "F1" alone is not a place you can walk to.
   */
  buildings: string;
  weeksNumbers: number[];
  weeksLabel: string;
  isLecture: boolean;
  /**
   * The student explicitly picked this entry's group (or it has none to pick).
   * False only for an øving/lab group in a course they picked nothing in.
   */
  groupPicked: boolean;
  /** Identical parallel slots this block stands for. 1 = a single session. */
  groupCount: number;
  /** Per-render ordinal. Part of the DOM id, because (code, day, start) is not unique. */
  ordinal: number;
}

/**
 * What a clicked block hands its listener — material for the course-settings
 * modal. A pile's `code` is its courses' codes joined with " · " (plannerApp
 * reads that separator to route the click to the day view).
 */
export interface BlockDetail {
  /** Course code, or the pile's codes joined with " · ". */
  code: string;
  /**
  /**
   * The weekday the block sits in (1 = mandag). A pile carries its cluster's
   * day, which is what routes a pile click to that day's expanded view.
   */
  dayNumber: number;
  /** Course name (the proper name), or joined names for a pile. */
  name: string;
  /** The activity/group label ("Forelesningsparallell 2"), when the block is one entry. */
  entryName: string | null;
  /** Two figures, not a pre-joined sentence: the card derives the duration. */
  startTime: string;
  endTime: string;
  rooms: string;
  /** The building(s) `rooms` sit in, "" when upstream named none (`buildingLabel`). */
  buildings: string;
  weeksLabel: string;
  isLecture: boolean;
  /**
   * The lecture(s) this session collides with and the minutes they share;
   * `null` when it collides with nothing. Red-Is-Collision requires the card
   * to name both things, so the partner codes travel with the detail rather
   * than the card inferring "something clashes" from the zone.
   */
  clash: BlockClash | null;
}

/** A session's collision, as the popover needs it: who, and which minutes. */
export interface BlockClash {
  /** Course codes this session collides with, never its own. */
  partners: string[];
  startTime: string;
  endTime: string;
}

export interface GridRenderOptions {
  /**
   * A bundle fetch is still in flight, so the grid draws a skeleton instead of
   * asserting "Ingen timeplandata" — false, and the reflow when data lands
   * throws the exam ribbon off screen mid-read.
   */
  loading?: boolean;
  /**
   * The plan is waiting on a studieretning/campus answer. The week is not a
   * failure while a question is open, so this replaces the canned recovery
   * copy. It is the *empty* week's message only — see `renderGrid`.
   */
  pendingChoiceMessage?: string | null;
  /**
   * Called when a block, pile or "velg din gruppe" note is clicked, with the
   * detail and the clicked element (the popover's anchor). The one-course
   * `/emne/` reuse passes none, so its blocks are inert.
   */
  onBlockClick?: (detail: BlockDetail, anchor: HTMLElement) => void;
  /**
   * Bypasses `applyGroupSelection` entirely — every parallel and group draws.
   * `/emne/[code]/` is a reference page for the course, not one student's
   * plan: a visitor deciding which parallel to register for needs all of them,
   * and there is no programme context to guess from. `/planlegger/` never sets
   * this.
   */
  showAllGroups?: boolean;
  /**
   * The weekday to mark as today (1 = mandag). `null` marks none — `/emne/`'s
   * reference week is nobody's particular Tuesday.
   */
  todayNumber?: number | null;
  /**
   * A margin note naming a course narrowed on a guess was clicked. Distinct
   * from `onBlockClick`: a bar asks "what is this session", a note asks "which
   * group is mine" — and only the second is an edit.
   */
  onChoiceClick?: (code: string) => void;
  /**
   * Stagger the bars in on this render. Set by a view switch only, never by a
   * re-render from a group pick or plan edit — replaying the whole week
   * because one checkbox moved is the entrance choreography DESIGN §6 forbids.
   */
  animate?: boolean;
}

export interface GridRenderResult {
  /**
   * Distinct collision *slots* — one per (day, overlap window), so a 3-way
   * clash counts once. The number for the page's verdict line.
   */
  conflictCount: number;
  /** Raw pairwise conflicts behind those slots. Diagnostics; not for display. */
  conflictPairCount: number;
  /**
   * The plan's courses have entries but none classify as a lecture, so the
   * muted layer was revealed unasked. The caller must mirror this into the
   * toggle's `aria-pressed`, or the control lies about what is on screen.
   */
  mutedLayerAutoRevealed: boolean;
  /** Cells drawn (after merging and collapsing) — 0 in every message branch. */
  blockCount: number;
  /** Which branch rendered. Only `"grid"` carries meaningful counts. */
  state: "grid" | "empty" | "loading" | "pending-choice";
  /**
   * Courses whose timetable we do not have and could not check: the fetch
   * failed, or was never made. NOT courses NTNU publishes nothing for — those
   * are a known answer (`planGaps`). Non-empty ⇒ `conflictCount` is a floor
   * and the caller must not print a clean verdict.
   */
  incompleteCourses: string[];
  /**
   * The counts are not the whole truth (a fetch in flight, or one without an
   * answer), so the verdict line must stay quiet about "ingen kollisjoner".
   */
  partial: boolean;
  /**
   * How many entries the (lecture-only, DR-1) collision check actually
   * compared. **Zero means nothing was checked**, and `conflictCount: 0` is
   * then the arithmetic of an empty set rather than a verdict — which is how a
   * plan whose courses NTNU never marked as `forelesning` (BSPL kull 2024's
   * period is all of them) drew fifteen overlapping bars under a green "ingen
   * forelesninger kolliderer". The auto-reveal note explaining it was folded
   * 800 px below. `mutedLayerAutoRevealed` is NOT the signal to read here: it
   * is false once the student turns the øving layer on themselves, and the
   * check is just as empty then.
   */
  checkedLectureCount: number;
  /**
   * Courses whose øving/lab layer is revealed but still un-narrowed — the
   * student has not said which group is theirs, so nothing of theirs is drawn.
   *
   * The narrowing is right and stays (drawing every group put 41 blocks in one
   * week — see `visibleLayer`). What was wrong is that it was SILENT: ticking
   * «Øvinger og labber» on a five-course plan added two blocks, and a control
   * that visibly does almost nothing reads as "I have no øvinger" rather than
   * as "four of these are waiting on you". The margin says it per course; the
   * control has to say it too, because the control is what was just pressed.
   */
  pendingGroupCourses: string[];
  /**
   * Courses that published sessions but not one classifiable as a lecture, so
   * the (lecture-only, DR-1) check passed OVER them rather than on them.
   *
   * Distinct from `incompleteCourses`, which is a fetch that failed: this is a
   * fetch that succeeded and returned nothing the engine can compare. The
   * verdict must say so — "Ingen forelesninger kolliderer" over a plan where
   * one course was never in the comparison is a claim about four courses
   * printed as a claim about five, and the note admitting it was 570 px below
   * and, on a phone, collapsed behind a disclosure while the pass itself was
   * hidden by CSS.
   */
  uncheckedCourses: string[];
}

function roomLabel(rooms: { building: string | null; room: string | null }[]): string {
  return rooms
    .map((r) => r.room ?? r.building ?? "")
    .filter(Boolean)
    .join(", ");
}

/**
 * The building(s) behind a session's rooms, deduped. A room with no code of
 * its own already prints its building as its label, and upstream publishes
 * rows where both fields carry the same string — those are skipped rather than
 * joined, or the same string prints twice.
 */
export function buildingLabel(rooms: { building: string | null; room: string | null }[]): string {
  return [
    ...new Set(
      rooms
        .filter((r) => r.room !== null && r.building !== null && r.building !== r.room)
        .map((r) => r.building),
    ),
  ]
    .filter((b): b is string => typeof b === "string" && b !== "")
    .join(", ");
}

/** Spoken week range for aria-labels, e.g. "uke 35 til 41" (PLANNER.md §2's a11y example). */
function spokenWeekRange(weeks: number[]): string {
  if (weeks.length === 0) return "";
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  return first === last ? `uke ${first}` : `uke ${first} til ${last}`;
}

function blockAriaLabel(entry: GridEntry, conflictPartners: string[]): string {
  const time = `${entry.startTime} til ${entry.endTime}`;
  const groups = entry.groupCount > 1 ? `, ${entry.groupCount} parallelle grupper` : "";
  const base = `${entry.courseCode}, ${dayName(entry.dayNumber)} ${time}, ${spokenWeekRange(entry.weeksNumbers)}${groups}`;
  if (conflictPartners.length === 0) return base;
  return `${base}, kolliderer med ${conflictPartners.join(", ")}`;
}

/**
 * Every timetable entry (with course context) for courses with a loaded
 * bundle. Each course's entries pass through `applyGroupSelection` FIRST: the
 * grid never shows a parallel the student did not select. `showAllGroups`
 * bypasses that — see `GridRenderOptions.showAllGroups`.
 */
function collectEntries(courses: PlanCourseState[], showAllGroups: boolean): GridEntry[] {
  const entries: GridEntry[] = [];
  for (const state of courses) {
    const timetable = state.bundle?.timetable;
    if (!timetable) continue;
    const selected = showAllGroups
      ? timetable
      : applyGroupSelection(timetable, state.course.groups, state.programCode);
    const picked = new Set(state.course.groups ?? []);
    // A course offering exactly ONE øving/lab group offers no choice, so it is
    // treated as already picked. Same rule the popover's group picker follows.
    const otherKeys = new Set<string>();
    for (const raw of selected) {
      if (classifyActivity(raw) === "lecture") continue;
      const key = entryGroupKey(raw);
      if (key !== null) otherKeys.add(key);
    }
    const soleGroup = otherKeys.size === 1;
    for (const raw of selected) {
      const weeksNumbers = parseWeeks(raw.weeks);
      const key = entryGroupKey(raw);
      entries.push({
        courseCode: state.course.code,
        dayNumber: raw.dayNumber,
        startTime: raw.startTime,
        endTime: raw.endTime,
        weeks: raw.weeks,
        hueVar: state.hueVar,
        courseName: state.course.name,
        name: raw.title ?? raw.name ?? state.course.name,
        rooms: roomLabel(raw.rooms),
        buildings: buildingLabel(raw.rooms),
        weeksNumbers,
        weeksLabel: weekLabel(weeksNumbers),
        isLecture: classifyActivity(raw) === "lecture",
        // `showAllGroups` is the course page: every group counts as shown.
        groupPicked: showAllGroups || key === null || soleGroup || picked.has(key),
        groupCount: 1,
        ordinal: entries.length,
      });
    }
  }
  return entries;
}

/** Courses the week cannot draw, split by WHY — the four are different sentences. */
export interface PlanGaps {
  /** The timetable fetch failed: we do not know this course's sessions. */
  failed: string[];
  /** No fetch has been made (and none is in flight): the same unknown, other cause. */
  pending: string[];
  /** The fetch succeeded and NTNU published no rows at all for the course. */
  empty: string[];
  /** Rows exist, but none of them fall in the semester the week is showing. */
  offSemester: string[];
}

/**
 * Why each course is missing from the week, from the fetch outcome the bundle
 * carries — never re-derived from the entry array. "Fetched fine, nothing this
 * semester" (`offSemester`) must stay a different sentence from "we never got
 * an answer" (`failed`); only the second makes the collision check incomplete.
 * A fetch still in flight is in no list — the caller's `loading` says so.
 */
export function planGaps(courses: PlanCourseState[]): PlanGaps {
  const gaps: PlanGaps = { failed: [], pending: [], empty: [], offSemester: [] };
  for (const state of courses) {
    const code = state.course.code;
    const outcome = timetableOutcomeOf(state.bundle);
    if (outcome.kind === "failed") gaps.failed.push(code);
    else if (outcome.kind === "pending") {
      if (!state.loading) gaps.pending.push(code);
    } else if (outcome.kind === "empty") gaps.empty.push(code);
    else if ((state.bundle?.timetable ?? []).length === 0) gaps.offSemester.push(code);
  }
  return gaps;
}

/** A course whose lecture layer is a guess, and how many alternatives it is a guess between. */
export interface LectureChoice {
  code: string;
  name: string;
  hueVar: string;
  /** Lecture groups the guess is one of — always ≥ 2 (`resolveLectureDefaults`). */
  count: number;
}

/**
 * Courses whose lecture parallel we could NOT resolve and the student has not
 * picked. `resolveLectureDefaults` draws one provisional session per ambiguous
 * family, which is only honest if the week says so — each becomes a "velg
 * din" note. `showAllGroups` narrows nothing, so the list is empty there.
 */
export function unresolvedLectureChoices(
  courses: PlanCourseState[],
  showAllGroups: boolean,
): LectureChoice[] {
  if (showAllGroups) return [];
  const choices: LectureChoice[] = [];
  for (const state of courses) {
    const timetable = state.bundle?.timetable;
    if (!timetable || timetable.length === 0) continue;
    const resolution = resolveLectureDefaults(timetable, state.programCode);
    if (resolution.resolved) continue;
    // An explicit lecture pick is an answer, even a wrong one.
    const lectureKeys = new Set(
      groupOptions(timetable)
        .filter((o) => o.kind === "lecture")
        .map((o) => o.key),
    );
    if ((state.course.groups ?? []).some((key) => lectureKeys.has(key))) continue;
    choices.push({
      code: state.course.code,
      name: state.course.name,
      hueVar: state.hueVar,
      count: resolution.alternatives.length,
    });
  }
  return choices;
}

/**
 * Collapses a course's identical parallel slots into one block. Kept apart by
 * activity title and by lecture/other, so we never invent a joint label for
 * two things the student reads as different.
 */
function mergeSlots(entries: GridEntry[]): GridEntry[] {
  return mergeParallelSlots(entries, (e) => `${e.isLecture ? "L" : "O"}|${e.name}`).map(
    ({ representative, entries: members }) => {
      if (members.length === 1) return representative;
      const rooms = [...new Set(members.flatMap((m) => m.rooms.split(", ")))]
        .filter(Boolean)
        .join(", ");
      const buildings = [...new Set(members.flatMap((m) => m.buildings.split(", ")))]
        .filter(Boolean)
        .join(", ");
      return { ...representative, rooms, buildings, groupCount: members.length };
    },
  );
}

function timeToMinutes(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "A, B og C" — the Norwegian list separator, not a bare comma join. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} og ${items[items.length - 1]}`;
}

/** Duration in minutes; 0 for a malformed pair rather than a negative height. */
function durationMinutes(entry: GridEntry): number {
  return Math.max(0, timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime));
}

/**
 * An all-day drop-in window (08:00–18:00 lab). Never a lecture.
 *
 * Exported because `columnGrid.ts` must make the same call: a window that is a
 * strip in one view and a lane in the other is two views disagreeing about
 * what the week contains.
 */
export function isDropIn(entry: {
  isLecture: boolean;
  startTime: string;
  endTime: string;
}): boolean {
  return (
    !entry.isLecture &&
    Math.max(0, timeToMinutes(entry.endTime) - timeToMinutes(entry.startTime)) >= ALL_DAY_MINUTES
  );
}

function isBandEntry(entry: GridEntry): boolean {
  return isDropIn(entry);
}

// --- Frame state ----------------------------------------------------------

/*
 * The ruling is an hour hairline on `.planner-grid-rail`/`.planner-grid-day` —
 * children only a drawn week has — so Ruling-Marks-The-Plan holds by
 * construction: a message branch builds no grid, so there is nothing to strip.
 */

/**
 * Renders a message where the week would be. Exported so the page's
 * pre-publish branch (DR-2) can clear the frame through the same door.
 */
export function renderGridMessage(
  frame: HTMLElement,
  notesHost: HTMLElement,
  message?: string | null,
): void {
  notesHost.replaceChildren();
  frame.removeAttribute("aria-busy");
  frame.replaceChildren(...(message ? [el("p", "planner-grid-empty np-hint", message)] : []));
}

/**
 * A week-shaped placeholder while bundles load: the rail, the day names and
 * the height the real grid will need. Claims nothing about the plan.
 */
function renderSkeleton(frame: HTMLElement, notesHost: HTMLElement): void {
  notesHost.replaceChildren();
  frame.setAttribute("aria-busy", "true");

  const minMinutes = DEFAULT_START_HOUR * 60;
  const maxMinutes = SKELETON_END_HOUR * 60;
  const grid = buildGridShell(minMinutes, maxMinutes, SKELETON_DAYS, "Henter ukeplan");
  grid.element.classList.add("is-skeleton");
  frame.replaceChildren(grid.element);
}

// --- Grid shell -----------------------------------------------------------

interface GridShell {
  element: HTMLElement;
  /** One lane container per weekday — where that day's bars are appended. */
  dayFields: Map<number, HTMLElement>;
}

/**
 * The empty week: an hour ruler across the top, then one row per weekday —
 * the day's name in the left spine, its lanes in the field beside it.
 *
 * The spine is load-bearing, not decoration: with the current day at full ink
 * and the rest receding, it is how a student finds their row without reading.
 *
 * `--planner-span` is the axis's length in minutes; every bar's `left`/`width`
 * is a percentage of it, so ticks and bars share one coordinate system.
 */
function buildGridShell(
  minMinutes: number,
  maxMinutes: number,
  dayCount: number,
  ariaLabel: string,
  todayNumber: number | null = null,
): GridShell {
  const span = Math.max(ROW_MINUTES, maxMinutes - minMinutes);
  const grid = el("div", "planner-grid");
  grid.style.setProperty("--planner-span", String(span));
  grid.style.setProperty("--planner-hours", String(Math.round(span / 60)));
  // Read back by the pointer readout and the now marker, which turn a pixel
  // into a time and cannot re-derive the clamp this render chose.
  grid.setAttribute("data-min", String(minMinutes));
  grid.setAttribute("data-span", String(span));
  // role="group", not "img": the grid holds focusable blocks with their own
  // aria-labels, and "img" would strip them from the accessibility tree.
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", ariaLabel);

  // The ruler. Figures sit ON their tick — the tick ties a number to a place.
  const ruler = el("div", "planner-grid-ruler");
  const rulerTrack = el("div", "planner-grid-ruler-track");
  rulerTrack.setAttribute("aria-hidden", "true");
  for (let hour = Math.ceil(minMinutes / 60); hour <= Math.floor(maxMinutes / 60); hour++) {
    // Mark and figure are two elements because they are pinned differently:
    // the hairline sits exactly on the minute, the figure is centred on it —
    // except at the axis ends, where centring puts it under the sticky spine
    // or past the frame. Only the figure moves; the mark never does.
    const tick = el("span", "planner-grid-tick");
    tick.append(el("span", "planner-grid-tick-figure np-data", String(hour).padStart(2, "0")));
    // The hour is the tick's identity across a re-render: when the øving layer
    // The tick's identity across a re-render: when the øving layer stretches
    // the axis, 10:00 travels to its new percentage rather than being replaced
    // by a different element that happens to say "10" (layerMotion.ts).
    tick.setAttribute("data-hour", String(hour));
    tick.style.setProperty("--planner-x", `${((hour * 60 - minMinutes) / span) * 100}%`);
    rulerTrack.append(tick);
  }
  ruler.append(rulerTrack);
  grid.append(ruler);

  const dayFields = new Map<number, HTMLElement>();
  for (let day = 1; day <= dayCount; day++) {
    const row = el("div", "planner-grid-row");
    row.setAttribute("data-day", String(day));
    if (day === todayNumber) row.setAttribute("data-today", "");

    // A real word, not an abbreviation: "mandag" is a sentence fragment, so
    // grotesk, not mono. A phone has no width for it, so the three-letter form
    // rides along `aria-hidden` and CSS shows one or the other — the full word
    // stays in the accessibility tree, since "man" cannot be expanded.
    const spine = el("div", "planner-grid-spine");
    spine.append(el("span", "planner-grid-spine-long", dayName(day)));
    const short = el("span", "planner-grid-spine-short", dayName(day).slice(0, 3));
    short.setAttribute("aria-hidden", "true");
    spine.append(short);
    row.append(spine);

    // Bars position absolutely against this box, so it — not the grid — must
    // be the positioned ancestor, or every day's bars land in the same strip.
    const field = el("div", "planner-grid-field");
    row.append(field);
    grid.append(row);
    dayFields.set(day, field);
  }

  // The readout that makes the axis legible to the minute: the ruler labels
  // whole hours and a bar no longer prints its start time, so without this
  // there is nowhere to learn that a lecture starts 08:15 rather than 08:00.
  const pointer = el("div", "planner-grid-pointer");
  pointer.hidden = true;
  pointer.setAttribute("aria-hidden", "true");
  pointer.append(el("span", "planner-grid-pointer-time np-data"));
  grid.append(pointer);

  // "Now", drawn through the whole week: faint everywhere so the hour reads
  // across every day, solid in today's row where it is literal.
  const now = el("div", "planner-grid-now");
  now.hidden = true;
  now.setAttribute("aria-hidden", "true");
  grid.append(now);

  return { element: grid, dayFields };
}

/** Minutes → "HH:MM", the one place a readout formats a clock. */
function clockLabel(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/**
 * Places the needle, or hides it. Drawn on TODAY'S ROW ONLY and only inside
 * the drawn hours, so there are two states: on the row at a minute, or absent
 * — a mark nobody can find is worse than no mark.
 *
 * Exported because it must re-run on a timer: a line that says "now" and means
 * "an hour ago" is worse than no line.
 */
export function syncNowMarker(frame: HTMLElement, at: Date = new Date()): void {
  const grid = frame.querySelector<HTMLElement>(".planner-grid");
  const marker = grid?.querySelector<HTMLElement>(".planner-grid-now");
  if (!grid || !marker) return;
  const min = Number(grid.getAttribute("data-min"));
  const span = Number(grid.getAttribute("data-span"));
  const jsDay = at.getDay();
  const dayNumber = jsDay === 0 ? 7 : jsDay;
  const minutes = at.getHours() * 60 + at.getMinutes();
  const row = grid.querySelector<HTMLElement>(`.planner-grid-row[data-day="${dayNumber}"]`);
  if (
    !row ||
    !Number.isFinite(min) ||
    !Number.isFinite(span) ||
    minutes < min ||
    minutes > min + span
  ) {
    marker.hidden = true;
    return;
  }
  marker.hidden = false;
  marker.style.setProperty("--planner-x", String(((minutes - min) / span) * 100));
  marker.style.setProperty("--planner-now-top", `${row.offsetTop}px`);
  marker.style.setProperty("--planner-now-height", `${row.offsetHeight}px`);
}

/**
 * Wires the hover readout: a hairline following the pointer across the time
 * axis with the minute under it. Mouse only — a finger covers the very pixel
 * the readout is about, and a line left under a tap reads as a selection.
 */
function wirePointer(grid: HTMLElement, minMinutes: number, span: number): void {
  const pointer = grid.querySelector<HTMLElement>(".planner-grid-pointer");
  const time = pointer?.querySelector<HTMLElement>(".planner-grid-pointer-time");
  const field = grid.querySelector<HTMLElement>(".planner-grid-field");
  if (!pointer || !time || !field) return;

  grid.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const box = field.getBoundingClientRect();
    const gridBox = grid.getBoundingClientRect();
    const ratio = (event.clientX - box.left) / box.width;
    if (ratio < 0 || ratio > 1) {
      pointer.hidden = true;
      return;
    }
    pointer.hidden = false;
    pointer.style.left = `${event.clientX - gridBox.left}px`;
    // Rounded to five minutes: the axis cannot be read more finely at any
    // width, and a jittering unit figure invites precision it does not have.
    time.textContent = clockLabel(Math.round((minMinutes + ratio * span) / 5) * 5);
  });

  grid.addEventListener("pointerleave", () => {
    pointer.hidden = true;
  });
}

// --- Blocks ---------------------------------------------------------------

interface BlockGeometry {
  minMinutes: number;
  /** The axis's length in minutes — every bar's x/width is a fraction of it. */
  span: number;
  /** Overlap window this entry falls inside, in absolute minutes. */
  clashWindow: { start: number; end: number } | null;
}

/**
 * Places a bar on the time axis: `left`/`width` as percentages of the day's
 * span, `--planner-lane` for its stacked lane. Percentages, not pixels,
 * because the axis is fluid from a 22rem phone to a 90rem desktop.
 */
function positionBlock(
  block: HTMLElement,
  startMinutes: number,
  endMinutes: number,
  minMinutes: number,
  span: number,
  lane: number,
): void {
  block.style.setProperty("--planner-x", `${((startMinutes - minMinutes) / span) * 100}%`);
  block.style.setProperty("--planner-w", `${((endMinutes - startMinutes) / span) * 100}%`);
  block.style.setProperty("--planner-lane", String(lane));
}

/**
 * The collision, drawn once per day rather than once per block: a zone through
 * every lane in the row across exactly the overlapping minutes, edged in
 * `--clash`. It is the only element that crosses lanes, which is what a
 * collision is — two things in one moment.
 */
function buildClashZone(
  window: { start: number; end: number },
  minMinutes: number,
  span: number,
): HTMLElement {
  const zone = el("span", "planner-clash-zone");
  zone.setAttribute("aria-hidden", "true");
  zone.style.setProperty("--planner-x", `${((window.start - minMinutes) / span) * 100}%`);
  zone.style.setProperty("--planner-w", `${((window.end - window.start) / span) * 100}%`);
  return zone;
}

/** The activity/group label a block shows — merged parallels count themselves. */
function groupLabel(entry: GridEntry): string {
  return entry.groupCount > 1 ? `${entry.name} · ${entry.groupCount} grupper` : entry.name;
}

/**
 * The block's second line: `start · room`. The start comes FIRST because
 * `.planner-block-meta` is nowrap + ellipsis and a narrow block clips whatever
 * is last — the time is the fact the whole-hour rail cannot give back. The
 * room survives in the block's `title`, aria-label and popover.
 */
export function metaLine(entry: { rooms: string; startTime: string }): string {
  return [entry.startTime, entry.rooms].filter(Boolean).join(" · ");
}

/**
 * Popover material for a block. `clash` comes from the render's own conflict
 * pass, so the card and the red zone can never disagree.
 */
export function blockDetailFor(
  entry: GridEntry,
  clash: { partners: string[]; window: { start: number; end: number } } | null,
): BlockDetail {
  const label = groupLabel(entry);
  return {
    code: entry.courseCode,
    dayNumber: entry.dayNumber,
    name: entry.courseName,
    entryName: label || null,
    startTime: entry.startTime,
    endTime: entry.endTime,
    rooms: entry.rooms,
    buildings: entry.buildings,
    weeksLabel: entry.weeksLabel,
    isLecture: entry.isLecture,
    clash:
      clash && clash.partners.length > 0
        ? {
            partners: clash.partners,
            startTime: minutesToTime(clash.window.start),
            endTime: minutesToTime(clash.window.end),
          }
        : null,
  };
}

function buildBlock(
  entry: GridEntry,
  geometry: BlockGeometry,
  lane: number,
  partnerCodes: string[],
  onBlockClick?: GridRenderOptions["onBlockClick"],
): HTMLButtonElement {
  const block = el("button", "planner-block");
  block.type = "button";
  if (geometry.clashWindow) block.classList.add("is-clash");
  if (!entry.isLecture) block.classList.add("is-muted");
  const isBand = isBandEntry(entry);
  if (isBand) block.classList.add("is-band");
  block.id = blockId(entry);
  block.style.setProperty("--dot", `var(${entry.hueVar})`);

  const startMinutes = timeToMinutes(entry.startTime);
  const endMinutes = timeToMinutes(entry.endTime);
  positionBlock(block, startMinutes, endMinutes, geometry.minMinutes, geometry.span, lane);
  block.setAttribute("aria-label", blockAriaLabel(entry, partnerCodes));

  const label = groupLabel(entry);
  const timeRange = `${entry.startTime}–${entry.endTime}`;
  block.title = [entry.courseCode, label, timeRange, entry.rooms, entry.weeksLabel]
    .filter(Boolean)
    .join(" · ");

  // One line, and the code is the half that may never be cut. The bar prints
  // no start time — the labelled axis already says it — which is what frees
  // the width for `activity · room`.
  block.append(el("span", "planner-block-code np-data", entry.courseCode));
  if (durationMinutes(entry) >= COMPACT_BLOCK_MINUTES) {
    // Room and activity are two facts and get two boxes: joined into one
    // string they shared one ellipsis wider than what it replaced. A room is
    // printed whole or not at all; `fitBlockLabels` decides from real width.
    if (entry.rooms) block.append(el("span", "planner-block-room np-data", entry.rooms));
    if (label) block.append(el("span", "planner-block-what", label));
  }

  if (onBlockClick) {
    const clash = geometry.clashWindow
      ? { partners: partnerCodes, window: geometry.clashWindow }
      : null;
    block.addEventListener("click", () => onBlockClick(blockDetailFor(entry, clash), block));
  }
  return block;
}

/** How far the edge fade reaches once you have dragged at least that far. */
const SCROLL_FADE_PX = 16;

/**
 * The edge fades, as two lengths the mask reads (planner-week.css).
 *
 * Each GROWS with the drag rather than switching on with it: toggled outright,
 * a 40 px veil appeared the instant a finger moved one pixel, which reads as
 * the page flinching. The third length is the scrollbar's own strip — the mask
 * is on the scroll container, so without it the fade greys out the scrollbar.
 */
export function setScrollFade(frame: HTMLElement, left: number, maxScroll: number): void {
  const near = Math.min(Math.max(left, 0), SCROLL_FADE_PX);
  const far = Math.min(Math.max(maxScroll - left, 0), SCROLL_FADE_PX);
  frame.style.setProperty("--planner-fade-start", `${Math.round(near)}px`);
  frame.style.setProperty("--planner-fade-end", `${Math.round(far)}px`);
  const scrollbar = Math.max(0, (frame.offsetHeight || 0) - (frame.clientHeight || 0));
  frame.style.setProperty("--planner-scrollbar", `${scrollbar}px`);
}

/**
 * Decides what each bar has room to SAY — never where it says it.
 *
 * Three facts in the order they may be given up: course code, room, session
 * name. Only the last may be cut, and only where a cut leaves something worth
 * reading. The rule: **an ellipsis must never be wider than the text it
 * replaces.** Purely subtractive — it hides, it never moves anything or
 * changes a bar's width, because a bar's width is its duration.
 *
 * Measure-then-mutate in two passes: reading a box after writing a class is a
 * forced reflow per block, and a week can hold thirty.
 */
export function fitBlockLabels(frame: HTMLElement): void {
  const blocks = Array.from(frame.querySelectorAll<HTMLElement>(".planner-grid .planner-block"));
  const first = blocks[0];
  if (!first) return;
  for (const block of blocks) block.classList.remove("is-roomless", "is-typeless");

  const style = globalThis.getComputedStyle?.(first);
  const padding = style
    ? (Number.parseFloat(style.paddingInlineStart) || 0) +
      (Number.parseFloat(style.paddingInlineEnd) || 0)
    : 0;
  const GAP = 8; // --gap-2, between two facts on a bar
  // Below this an activity name has nothing to say, and it crowds out the
  // room — the fact a student actually walks by.
  const MIN_TYPE = 44;

  const hide: { block: HTMLElement; mode: "is-roomless" | "is-typeless" }[] = [];
  for (const block of blocks) {
    const room = block.querySelector<HTMLElement>(".planner-block-room");
    const what = block.querySelector<HTMLElement>(".planner-block-what");
    if (!room && !what) continue;
    const avail = block.clientWidth - padding;
    const code = block.querySelector<HTMLElement>(".planner-block-code")?.offsetWidth ?? 0;
    const roomWidth = room ? GAP + room.offsetWidth : 0;
    if (code + roomWidth > avail + 1) {
      // The room would be cut, so neither it nor anything after it prints.
      hide.push({ block, mode: "is-roomless" });
      continue;
    }
    if (!what) continue;
    const left = avail - code - roomWidth - GAP;
    // Whole, or long enough that the ellipsis is earning its place.
    if (what.scrollWidth > left && left < MIN_TYPE) hide.push({ block, mode: "is-typeless" });
  }

  for (const { block, mode } of hide) block.classList.add(mode);
}

function blockId(entry: GridEntry): string {
  // The ordinal is load-bearing: (code, day, start) is NOT unique — EXPH0300
  // publishes two parallels at the same Monday 10:15, and duplicate DOM ids
  // made a conflict note flash the wrong block.
  return `planner-block-${entry.ordinal}`;
}

// --- Notes ----------------------------------------------------------------

/**
 * The margin notes, folded behind one line.
 *
 * A fold takes the *explanations* only. It does not take the count, and it
 * does not take the qualification: if any folded note means the collision
 * check does not cover the whole plan, the summary says so, so a fold can
 * never leave a green verdict standing on an incomplete check. Nor anything
 * with a verb in it — collisions and "velg din gruppe" lines stay open,
 * because they are things to act on.
 *
 * Open by default above 40rem. Crossing that boundary re-renders the grid
 * (plannerApp's `change` listener), so a rotation lands on the right state.
 */
function foldNotes(notes: HTMLElement[], count: number, incomplete: boolean): HTMLElement {
  const fold = el("details", "planner-notes-fold");
  fold.open = globalThis.matchMedia?.("(max-width: 40rem)").matches !== true;

  const summary = el("summary", "np-summary planner-notes-summary");
  summary.append(el("span", "np-data", String(count)));
  summary.append(count === 1 ? " merknad" : " merknader");
  // The half of the sentence to act on, said without opening anything. Ink,
  // never red: an incomplete check is a gap, not a clash (DESIGN §2).
  summary.append(incomplete ? " · kollisjonssjekken er ufullstendig" : " om uka");
  fold.append(summary);
  fold.append(...notes);
  return fold;
}

/**
 * Builds the collision sentence into `host` and returns it flat, for the
 * button's accessible name. The day, time, codes and weeks carry `.np-data`.
 */
function fillConflictNote(host: HTMLElement, group: ConflictGroup): string {
  const day = capitalize(dayName(group.dayNumber));
  const time = `${minutesToTime(group.start)}–${minutesToTime(group.end)}`;
  const weeks = weekLabel(group.weeks);

  host.append(el("span", "np-data", day));
  host.append(" ");
  host.append(el("span", "np-data", time));
  host.append(" · ");
  group.codes.forEach((code, i) => {
    if (i > 0) host.append(i === group.codes.length - 1 ? " og " : ", ");
    host.append(el("span", "np-data", code));
  });
  host.append(" kolliderer");
  if (weeks) {
    host.append(" · ");
    host.append(el("span", "np-data", weeks));
  }

  return `${day} ${time} · ${joinList(group.codes)} kolliderer${weeks ? ` · ${weeks}` : ""}`;
}

/** A margin sentence about undrawable courses; codes in `.np-data`. */
function gapNote(lead: string, codes: string[], tail: string): HTMLElement {
  const note = el("p", "planner-grid-note np-hint");
  if (lead) note.append(lead);
  codes.forEach((code, i) => {
    if (i > 0) note.append(i === codes.length - 1 ? " og " : ", ");
    note.append(el("span", "np-data", code));
  });
  note.append(tail);
  return note;
}

// --- Render ---------------------------------------------------------------

/**
 * Which entries the week draws, and whether the muted layer had to reveal
 * itself to have anything to draw. Two guards meet here:
 *
 *  - B7a: 47 programmes have entries and not one that classifies as a lecture.
 *    When that layer is all there is, it is shown and the margin says why.
 *  - The øving/lab layer shows PICKED groups only: EXPH0300 alone ships nine
 *    seminar groups and drawing them all put 41 blocks in one week.
 *
 * Composed naively the second empties the first — in the auto-reveal branch
 * nothing is a lecture by definition, so `isLecture || groupPicked` kept
 * nothing at all under a green verdict. An auto-revealed layer therefore draws
 * every entry it has: narrowing may only remove teaching when something else
 * is left standing.
 */
export function visibleLayer<T extends { isLecture: boolean; groupPicked: boolean }>(
  entries: T[],
  showOthers: boolean,
): { shown: T[]; mutedLayerAutoRevealed: boolean } {
  const lectures = entries.filter((e) => e.isLecture);
  const mutedLayerAutoRevealed = !showOthers && entries.length > 0 && lectures.length === 0;
  if (mutedLayerAutoRevealed) return { shown: entries, mutedLayerAutoRevealed };
  if (!showOthers) return { shown: lectures, mutedLayerAutoRevealed };
  return { shown: entries.filter((e) => e.isLecture || e.groupPicked), mutedLayerAutoRevealed };
}

/**
 * Courses that published sessions but not one this app can call a lecture.
 *
 * `visibleLayer`'s auto-reveal is plan-GLOBAL — it fires only when NOT ONE
 * course has a lecture. Add an ordinary course alongside a lecture-less one
 * and the reveal stops, so the lecture-less course drops out of the week AND
 * out of the (lecture-only, DR-1) collision check silently. ~22% of
 * course-terms cannot be lecture-classified at all and never will be.
 *
 * The fix is to SAY it, not draw it: auto-revealing per course would feed
 * all-day "examn week" rows to the conflict engine and collide every other
 * course against them — mass false reds, which DR-1 exists to prevent.
 */
export function lectureLessCourses<T extends { courseCode: string; isLecture: boolean }>(
  entries: T[],
): string[] {
  const withLecture = new Set<string>();
  const seen: string[] = [];
  for (const e of entries) {
    if (e.isLecture) withLecture.add(e.courseCode);
    else if (!seen.includes(e.courseCode)) seen.push(e.courseCode);
  }
  return seen.filter((code) => !withLecture.has(code));
}

/**
 * Renders the weekly spread + its margin notes into `frame` / `notesHost`.
 * `showOthers` decides whether non-lecture entries draw at all — see
 * `visibleLayer`. Hour clamping follows the SHOWN entries. The margin carries
 * three kinds of sentence: what the week could not draw and why (`planGaps`),
 * which slots collide, and which courses still need a group picked.
 */
export function renderGrid(
  frame: HTMLElement,
  notesHost: HTMLElement,
  courses: PlanCourseState[],
  showOthers: boolean,
  options: GridRenderOptions = {},
): GridRenderResult {
  const loading = options.loading ?? false;
  const rawEntries = collectEntries(courses, options.showAllGroups ?? false);
  // Courses that published sessions but not one this app can call a lecture,
  // computed unconditionally rather than only inside the note branch below:
  // the VERDICT needs it too. A plan where four of five courses were compared
  // and the fifth contributed nothing is not a clean plan, it is a clean
  // comparison of four — and it was printing an unqualified green.
  const uncheckedCourses = lectureLessCourses(rawEntries);
  // What the week has no answer for, from each fetch's own outcome. Only a
  // failed or never-made fetch makes the collision check incomplete.
  const gaps = planGaps(courses);
  const incompleteCourses = [...gaps.failed, ...gaps.pending];
  // Courses whose lecture layer is one provisional pick out of several.
  const lectureChoices = unresolvedLectureChoices(courses, options.showAllGroups ?? false);

  const empty = (state: GridRenderResult["state"], message?: string): GridRenderResult => {
    renderGridMessage(frame, notesHost, message);
    return {
      conflictCount: 0,
      conflictPairCount: 0,
      mutedLayerAutoRevealed: false,
      blockCount: 0,
      state,
      incompleteCourses,
      partial: loading || incompleteCourses.length > 0,
      checkedLectureCount: 0,
      pendingGroupCourses: [],
      uncheckedCourses,
    };
  };

  // An unanswered studieretning/campus question is what the *empty* week says
  // instead of the canned recovery copy — never a curtain over a week that has
  // something true to show. `programPlan.ts` prefills every course obligatory
  // in ALL directions precisely so a gated period still renders real blocks;
  // suppressing them breaks §0.1's "programme + kull → your week, instantly".
  const pending = options.pendingChoiceMessage ?? null;
  if (courses.length === 0) {
    return pending
      ? empty("pending-choice", pending)
      : empty("empty", "Legg til emner for å se ukeplanen.");
  }
  if (loading && rawEntries.length === 0) {
    renderSkeleton(frame, notesHost);
    return {
      conflictCount: 0,
      conflictPairCount: 0,
      mutedLayerAutoRevealed: false,
      blockCount: 0,
      state: "loading",
      incompleteCourses,
      partial: true,
      checkedLectureCount: 0,
      pendingGroupCourses: [],
      uncheckedCourses,
    };
  }
  if (rawEntries.length === 0) {
    // Ordered by severity: a fetch that failed is not a question the student
    // can answer, so telling them to pick a studieretning over it sends them
    // to a control that cannot fix the week.
    if (gaps.failed.length > 0) {
      return empty("empty", `Fikk ikke hentet timeplan for ${joinList(gaps.failed)}.`);
    }
    if (pending) return empty("pending-choice", pending);
    // A claim about NTNU's data, so it may only be made once we got an answer.
    return empty("empty", "Ingen timeplandata for emnene i planen ennå.");
  }

  const { shown, mutedLayerAutoRevealed } = visibleLayer(rawEntries, showOthers);
  const revealOthers = showOthers || mutedLayerAutoRevealed;
  const entries = mergeSlots(shown);

  // Counted from the RAW entries, so the note names what the filter withheld.
  const unpickedGroups = new Map<string, { name: string; hueVar: string; keys: Set<string> }>();
  if (revealOthers) {
    for (const entry of rawEntries) {
      if (entry.isLecture || entry.groupPicked) continue;
      let row = unpickedGroups.get(entry.courseCode);
      if (!row) {
        row = { name: entry.courseName, hueVar: entry.hueVar, keys: new Set() };
        unpickedGroups.set(entry.courseCode, row);
      }
      row.keys.add(entry.name);
    }
  }

  // Hard conflicts are lecture×lecture only (DR-1); øving/lab entries never clash.
  const checkedLectures = entries.filter((e) => e.isLecture);
  const conflicts = findConflicts(checkedLectures);
  const conflictGroups = groupConflicts(conflicts);
  const groupsByEntry = new Map<ScheduleEntry, ConflictGroup[]>();
  for (const group of conflictGroups) {
    for (const entry of group.entries) {
      const list = groupsByEntry.get(entry) ?? [];
      list.push(group);
      groupsByEntry.set(entry, list);
    }
  }
  const clashWindowFor = (members: GridEntry[]): { start: number; end: number } | null => {
    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;
    for (const member of members) {
      for (const group of groupsByEntry.get(member) ?? []) {
        start = Math.min(start, group.start);
        end = Math.max(end, group.end);
      }
    }
    return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null;
  };

  // Clamp displayed hours to the entries actually shown, so a lecture-only
  // week ending 16:00 doesn't drag four empty hours. Toggling øvinger may grow
  // the grid; that reflow is expected.
  let minMinutes = Number.POSITIVE_INFINITY;
  let maxMinutes = Number.NEGATIVE_INFINITY;
  for (const e of entries) {
    minMinutes = Math.min(minMinutes, timeToMinutes(e.startTime));
    maxMinutes = Math.max(maxMinutes, timeToMinutes(e.endTime));
  }
  if (!Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes)) {
    minMinutes = DEFAULT_START_HOUR * 60;
    maxMinutes = DEFAULT_END_HOUR * 60;
  }
  minMinutes = Math.floor(minMinutes / 60) * 60;
  maxMinutes = Math.ceil(maxMinutes / 60) * 60;

  const hasSaturday = entries.some((e) => e.dayNumber === 6);
  const dayCount = hasSaturday ? 6 : 5;
  const span = Math.max(ROW_MINUTES, maxMinutes - minMinutes);

  frame.removeAttribute("aria-busy");
  const shell = buildGridShell(
    minMinutes,
    maxMinutes,
    dayCount,
    "Ukeplan med timeplanblokker for emnene i planen",
    options.todayNumber ?? null,
  );
  if (options.animate) shell.element.classList.add("is-striking");

  // Conflict notes flash through this map rather than through getElementById.
  const nodeByEntry = new Map<ScheduleEntry, HTMLElement>();
  const geometryBase = { minMinutes, span };
  let blockCount = 0;
  /**
   * Stagger index — ONE continuous count across the week, so bars strike in in
   * reading order rather than restarting each row. Every drawn thing takes a
   * number, drop-in strips included: at index 0 they all fire on frame one and
   * the quietest thing in the week arrives first and loudest.
   */
  let strikeIndex = 0;

  for (let day = 1; day <= dayCount; day++) {
    const field = shell.dayFields.get(day);
    if (!field) continue;
    const dayEntries = entries.filter((e) => e.dayNumber === day);

    // A day's collision zone is drawn once, behind its bars, spanning every
    // lane. Appended FIRST so the bars paint over it.
    const dayClash = clashWindowFor(dayEntries);
    if (dayClash) field.append(buildClashZone(dayClash, minMinutes, span));

    // A drop-in window gets a strip along the bottom of the row rather than a
    // lane, which would turn a Monday with an 08:00–18:00 lab into a slab that
    // pushes every real session down a row. The row reserves height for it
    // (`--planner-bands`), so nothing is drawn over its label.
    //
    // `--planner-bands` is the COUNT and each strip carries its own index: a
    // day with two open windows drew both at the same offset, one exactly on
    // top of the other, and the week silently lost a course.
    const bands = dayEntries.filter(isBandEntry);
    field.style.setProperty("--planner-bands", String(bands.length));
    bands.forEach((entry, index) => {
      const block = buildBlock(
        entry,
        { ...geometryBase, clashWindow: null },
        0,
        [],
        options.onBlockClick,
      );
      block.style.setProperty("--planner-band", String(index));
      block.style.setProperty("--planner-strike", String(strikeIndex++));
      nodeByEntry.set(entry, block);
      field.append(block);
      blockCount++;
    });

    // Everything else is lane-packed uncapped — see LANE_CAP.
    const packable = dayEntries.filter((e) => !isBandEntry(e));
    const layoutInput: LayoutInput[] = packable.map((e) => ({
      id: blockId(e),
      start: timeToMinutes(e.startTime),
      end: timeToMinutes(e.endTime),
    }));
    const slotById = new Map(layoutDay(layoutInput, LANE_CAP).map((slot) => [slot.id, slot]));

    // Row height is the deepest cluster in it. Rows are not uniform, and that
    // is the honest shape of a week.
    const laneCount = Math.max(1, ...[...slotById.values()].map((s) => s.col + 1));
    field.style.setProperty("--planner-lanes", String(laneCount));

    for (const entry of [...packable].sort(
      (a, b) =>
        timeToMinutes(a.startTime) - timeToMinutes(b.startTime) ||
        timeToMinutes(a.endTime) - timeToMinutes(b.endTime) ||
        blockId(a).localeCompare(blockId(b)),
    )) {
      const slot = slotById.get(blockId(entry));
      if (!slot) continue;
      const partnerCodes = [
        ...new Set(
          (groupsByEntry.get(entry) ?? [])
            .flatMap((g) => g.codes)
            .filter((code) => code !== entry.courseCode),
        ),
      ];
      const block = buildBlock(
        entry,
        { ...geometryBase, clashWindow: clashWindowFor([entry]) },
        slot.col,
        partnerCodes,
        options.onBlockClick,
      );
      block.style.setProperty("--planner-strike", String(strikeIndex++));
      nodeByEntry.set(entry, block);
      field.append(block);
      blockCount++;
    }
  }

  const flash = (targets: ScheduleEntry[]): void => {
    const nodes = targets
      .map((entry) => nodeByEntry.get(entry))
      .filter((node): node is HTMLElement => node !== undefined);
    const [first] = nodes;
    // A5: the tokens can zero a transition but not a scroll behaviour.
    const reduced = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    first?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    for (const node of nodes) {
      node.classList.remove("np-target-flash");
      // Force reflow so re-adding the class restarts the animation.
      void node.offsetWidth;
      node.classList.add("np-target-flash");
    }
    first?.focus({ preventScroll: true });
  };

  // The rhythm the strike-in prints at, decided once the week's length is
  // known: 55 ms a bar until that would run past the budget, then tighter
  // (`staggerStep`). Computed rather than fixed because capping the INDEX
  // instead lands every bar past the ceiling on one frame — a whole weekday
  // arriving at once.
  shell.element.style.setProperty("--planner-step", `${staggerStep(strikeIndex, 55)}ms`);
  frame.replaceChildren(shell.element);
  fitBlockLabels(frame);
  wirePointer(shell.element, minMinutes, span);
  syncNowMarker(frame);

  // Margin notes: one per collision slot, not one per pair — a 3-way clash is
  // one afternoon to fix, and reporting it thrice buries the actionable fact.
  notesHost.replaceChildren();

  // The notes that EXPLAIN are collected first and folded: on a phone they ran
  // to a third of the week's own height. The count stays on screen, and so does
  // the half of the sentence that qualifies the verdict (`incomplete`).
  //
  // What may NOT be folded is anything asking the student to DO something:
  // collisions (red may never be one tap away) and the "velg din" lines (they
  // are controls, not sentences about the week).
  const folded: HTMLElement[] = [];
  let noteCount = 0;
  // Set by any note saying the check does not cover everything; hoisted into
  // the summary so a folded note can't leave "ingen kollisjoner" unqualified.
  let incomplete = false;

  // The gaps come first: they qualify every sentence below them.
  if (gaps.failed.length > 0) {
    folded.push(
      gapNote(
        "Fikk ikke hentet timeplan for ",
        gaps.failed,
        ". Kollisjonssjekken er ufullstendig.",
      ),
    );
    noteCount += 1;
    incomplete = true;
  }
  if (gaps.pending.length > 0) {
    folded.push(
      gapNote("Mangler timeplan for ", gaps.pending, ". Kollisjonssjekken er ufullstendig."),
    );
    noteCount += 1;
    incomplete = true;
  }
  if (gaps.empty.length > 0) {
    folded.push(gapNote("NTNU har ingen timeplan for ", gaps.empty, "."));
    noteCount += 1;
  }
  if (gaps.offSemester.length > 0) {
    folded.push(gapNote("", gaps.offSemester, " undervises ikke i valgt semester."));
    noteCount += 1;
  }

  if (mutedLayerAutoRevealed) {
    folded.push(
      el(
        "p",
        "planner-grid-note np-hint",
        "Ingen aktiviteter er merket som forelesning i disse emnene. Viser all undervisning.",
      ),
    );
    noteCount += 1;
  } else if (!revealOthers) {
    // The plan-global auto-reveal did not fire because SOME course has a
    // lecture — exactly when a lecture-less course disappears without a word.
    const silent = uncheckedCourses;
    if (silent.length > 0) {
      folded.push(
        gapNote(
          "Ingen aktiviteter er merket som forelesning i ",
          silent,
          ". Timene vises ikke her, og de er ikke med i kollisjonssjekken. Slå på «Øvinger og labber» for å se dem.",
        ),
      );
      noteCount += 1;
      incomplete = true;
    }
  }
  if (conflictGroups.length > 0) {
    const list = el("ul", "planner-notes-list");
    for (const group of conflictGroups) {
      const item = el("li");
      const link = el("button", "np-note-clash planner-note-link");
      link.type = "button";
      link.setAttribute("aria-label", fillConflictNote(link, group));
      link.addEventListener("click", () => flash(group.entries));
      item.append(link);
      list.append(item);
    }
    notesHost.append(list);
  }

  // Nothing a narrowing withheld is hidden silently: one line per course we
  // narrowed on a guess, and clicking it opens that course's picker.
  //
  // Lecture lines come first and are NOT gated on the øving toggle: an
  // unresolved parallel is drawn provisionally, and a provisional pick nobody
  // is told about is a wrong week under a green verdict.
  const choiceNotes = [
    ...lectureChoices.map((choice) => ({
      code: choice.code,
      name: choice.name,
      hueVar: choice.hueVar,
      text: ` har ${choice.count} alternative forelesninger, velg din`,
      aria: `${choice.code} har ${choice.count} alternative forelesninger. Vi viser én av dem, velg din`,
    })),
    ...[...unpickedGroups].map(([code, row]) => {
      const count = row.keys.size;
      const noun = count === 1 ? "gruppe" : "grupper";
      return {
        code,
        name: row.name,
        hueVar: row.hueVar,
        text: ` har ${count} ${noun}, velg din`,
        aria: `${code} har ${count} ${noun} du ikke har valgt. Velg din`,
      };
    }),
  ];
  if (choiceNotes.length > 0) {
    const list = el("ul", "planner-notes-list");
    for (const note of choiceNotes) {
      const item = el("li");
      const link = el("button", "np-hint planner-note-link planner-note-groups");
      link.type = "button";
      link.append(dot(note.hueVar));
      link.append(el("span", "np-data", note.code));
      link.append(note.text);
      link.setAttribute("aria-label", note.aria);
      // A margin note is about a whole COURSE, so it opens the group picker,
      // not the session popover a bar opens.
      if (options.onChoiceClick) {
        const code = note.code;
        link.addEventListener("click", () => options.onChoiceClick?.(code));
      }
      item.append(link);
      list.append(item);
    }
    notesHost.append(list);
  }

  // Last, under the things there is something to do about: the explanations.
  if (folded.length > 0) notesHost.append(foldNotes(folded, noteCount, incomplete));

  return {
    conflictCount: conflictGroups.length,
    conflictPairCount: conflicts.length,
    mutedLayerAutoRevealed,
    blockCount,
    state: "grid",
    incompleteCourses,
    partial: loading || incompleteCourses.length > 0,
    checkedLectureCount: checkedLectures.length,
    pendingGroupCourses: [...unpickedGroups.keys()],
    uncheckedCourses,
  };
}
