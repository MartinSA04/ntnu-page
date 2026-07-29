/**
 * UKEPLAN — the weekly spread (PRODUCT.md §0/DR-1). **Days are rows and time
 * is the horizontal axis** (REWORK-2026-07-29b D1): one row per weekday, its
 * name in the left spine, its sessions as bars along a labelled hour ruler.
 *
 * That orientation is the whole design, and it is arithmetic rather than
 * taste. A day COLUMN is ~150 px and cannot get wider — there are five of
 * them. A day ROW is the full page width, so a 1 t 45 lecture is 22 % of it
 * instead of a sliver, and overlapping sessions stack downward into lanes
 * where vertical space is free. Every rule the old vertical grid needed to
 * survive its own narrowness — the two-column cap, the phone cap, the pile
 * block that swallowed anything deeper — is deleted rather than tuned.
 *
 * It also relocates what a bar has to say. The axis above it is labelled and
 * the bar starts at its own minute, so a start time printed inside the bar
 * would be the same fact twice; the width that frees goes to `room ·
 * activity` — what it is, rather than when it is.
 *
 * Legibility is a correctness property here, not polish (REVIEW.md U1/U3, and
 * the REWORK mandate's "render simultaneous courses properly"). Overlap is a
 * *supported* state — people deliberately take colliding courses — and what
 * keeps it readable is now:
 *
 *   1. each course renders only its *selected* group set — the programme's
 *      own lecture parallel by default (`applyGroupSelection`), so the week
 *      is what the student actually attends, not every section overlaid;
 *   2. identical parallel slots that survive that filter collapse to one
 *      bar ("Lab · 4 grupper") — DR-1 concedes they are indistinguishable;
 *   3. an all-day non-lecture drop-in window becomes a band behind the day
 *      rather than a lane that pushes every real session down a row;
 *   4. `layoutDay` packs the rest into lanes, uncapped (`LANE_CAP`). A bar
 *      opens that course's settings via `onBlockClick`.
 *
 * Lectures render by default; `showOthers` (the page's "Vis øvinger og
 * labber" toggle) additionally renders øving/lab/seminar bars — muted, never
 * red, never fed to the conflict engine. Only lecture×lecture overlaps mark a
 * collision, and it is drawn as ONE zone per day across the minutes that
 * actually overlap; `.np-note-clash` margin notes below link to and flash the
 * bars.
 *
 * `renderBoard` (board.ts) is the second view of this same data, for the
 * widths and the media where a bar whose meaning is its width says nothing.
 *
 * The øving/lab layer additionally shows only groups the student has PICKED —
 * a service course publishes a dozen, and drawing them all made the toggle a
 * switch between "my week" and "the cohort's week" (`visibleLayer`, which
 * board.ts shares so the two views can never disagree about what is in the
 * week).
 *
 * What the week does NOT do is answer for teaching it never saw. Every course
 * carries a `TimetableOutcome` from the fetch (data.ts), and `planGaps` turns
 * the ones the grid cannot draw into named margin notes: a fetch we never got
 * an answer for makes the collision check incomplete (`incompleteCourses`, so
 * the caller must not print a clean verdict), while a course NTNU publishes
 * nothing for — or nothing in this semester — is drawn nowhere and said out
 * loud instead of vanishing (audit §1 / pc-3 / ux-4).
 *
 * The frame's ruling is owned here, not by the markup: it is stripped in
 * every empty/message branch (Ruling-Marks-The-Plan — the ruling appears
 * exactly where planning happens, never around an apology) and restored when
 * a grid is drawn.
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
 * Below this DURATION a bar carries its course code and nothing else.
 *
 * Time is the horizontal axis now (REWORK-2026-07-29b D1), so a session's
 * minutes are its *width*: 45 minutes is ~9 % of an eight-hour axis, about
 * 100 px on a laptop, which holds a seven-character code and no more. Above an
 * hour there is room for the activity and the room beside it. This used to be
 * a height rule at 90 minutes, back when a block was a narrow vertical sliver
 * and the extra lines clipped mid-word.
 */
const COMPACT_BLOCK_MINUTES = 60;

/**
 * Lanes a day's row may stack before … nothing. There is no cap.
 *
 * The old cap existed because a cluster deeper than two could not be split
 * across a ~150 px day column without breaking course codes one character per
 * line (grid-3), so anything deeper collapsed into a pile. Transposing the
 * axes deletes the problem rather than managing it: a lane is a row of
 * vertical space, vertical space is free, and a session's *width* now comes
 * from its duration instead of from how many things it collides with. So
 * `layoutDay` is called uncapped and can never return `piled` — the pile block
 * and every rule that fed it are gone (REWORK-2026-07-29b D1).
 */
const LANE_CAP = Number.POSITIVE_INFINITY;

interface GridEntry extends ScheduleEntry {
  hueVar: string;
  /** The course's proper name (for the block popover), distinct from `name`. */
  courseName: string;
  /** The activity/group label — `title`, e.g. "Forelesningsparallell 2 Trondheim". */
  name: string;
  rooms: string;
  weeksNumbers: number[];
  weeksLabel: string;
  isLecture: boolean;
  /**
   * The student explicitly picked this entry's group (or it has none to
   * pick). False only for an øving/lab group in a course where they have
   * picked nothing — see `renderGrid`'s øving layer.
   */
  groupPicked: boolean;
  /** Identical parallel slots this block stands for. 1 = a single session. */
  groupCount: number;
  /** Per-render ordinal. Part of the DOM id, because (code, day, start) is not unique. */
  ordinal: number;
}

/**
 * What a clicked block (or pile) hands its listener — the material for the
 * course-settings modal (REWORK-2026-07-29 D1). A pile's `code` is its
 * courses' codes joined with " · " (plannerApp reads that separator to route
 * the click to the day view instead); a single block's is one course code.
 */
export interface BlockDetail {
  /** Course code, or the pile's codes joined with " · ". */
  code: string;
  /**
   * The weekday the block sits in (1 = mandag). A pile carries its cluster's
   * day, which is what lets the caller route a pile click to that day's
   * expanded view — a pile has no single course to open settings for (D5).
   */
  dayNumber: number;
  /** Course name (the proper name), or joined names for a pile. */
  name: string;
  /** The activity/group label ("Forelesningsparallell 2"), when the block is one entry. */
  entryName: string | null;
  /** Spoken slot, e.g. "mandag 08:15–10:00". */
  timeLabel: string;
  rooms: string;
  weeksLabel: string;
  isLecture: boolean;
}

export interface GridRenderOptions {
  /**
   * A bundle fetch is still in flight. With nothing to draw yet the grid
   * renders a skeleton instead of asserting "Ingen timeplandata" — a loud
   * false statement, and the 500 px reflow when the data lands throws the
   * exam ribbon off screen mid-read (U5).
   */
  loading?: boolean;
  /**
   * The plan is waiting on a studieretning/campus answer. The week is not a
   * failure while a question is open, so this message replaces the canned
   * "Ingen forelesninger funnet" recovery copy, which points the wrong way
   * (B2). It is the *empty* week's message only — see `renderGrid`.
   */
  pendingChoiceMessage?: string | null;
  /**
   * Called when a block, a pile or a "velg din gruppe" margin note is
   * clicked, with the detail and the clicked element (the popover's anchor).
   * Optional: the one-course `/emne/` reuse passes none, so its blocks are
   * inert.
   */
  onBlockClick?: (detail: BlockDetail, anchor: HTMLElement) => void;
  /**
   * Bypasses `applyGroupSelection` entirely — every entry (every lecture
   * parallel, every øving/lab group) draws, not just the programme's own
   * default or the student's explicit pick. `/emne/[code]/` is a reference
   * page for the course itself, not for one student's plan (Task 7 ruling):
   * a visitor deciding *which* parallel to register for needs to see all of
   * them, not the one `entriesForProgram`/`defaultLectureKeys` happens to
   * guess is theirs (`/emne/` has no programme context to guess from at
   * all). `/planlegger/`'s own render never sets this.
   */
  showAllGroups?: boolean;
  /**
   * The weekday to mark as today (1 = mandag), so its row carries the spine at
   * full ink while the rest of the week recedes. `null`/omitted marks none —
   * `/emne/[code]/`'s reference week is nobody's particular Tuesday.
   */
  todayNumber?: number | null;
  /**
   * A margin note naming a course whose groups were narrowed on a guess was
   * clicked. Distinct from `onBlockClick` because the two ask different
   * questions: a bar asks "what is this session", a note asks "which group is
   * mine" — and only the second is an edit.
   */
  onChoiceClick?: (code: string) => void;
  /**
   * Stagger the bars in left-to-right on this render (REWORK-2026-07-29b D4).
   * Set by a view switch, never by a re-render caused by a group pick or a
   * plan edit: replaying the whole week because one checkbox moved is exactly
   * the entrance choreography DESIGN §6 forbids.
   */
  animate?: boolean;
}

export interface GridRenderResult {
  /**
   * Distinct collision *slots* — one per (day, overlap window), so a 3-way
   * clash counts once. This is the number for the page's verdict line.
   */
  conflictCount: number;
  /** Raw pairwise conflicts behind those slots. Diagnostics; not for display. */
  conflictPairCount: number;
  /**
   * The plan's courses have timetable entries but none classify as a lecture,
   * so the muted øving/lab layer was revealed without being asked for (B7a).
   * The caller must mirror this into the "Vis øvinger og labber" toggle's
   * `aria-pressed`, or the control lies about what is on screen.
   */
  mutedLayerAutoRevealed: boolean;
  /** Cells drawn (after merging and collapsing) — 0 in every message branch. */
  blockCount: number;
  /** Which branch rendered. Only `"grid"` carries meaningful counts. */
  state: "grid" | "empty" | "loading" | "pending-choice";
  /**
   * The plan's courses whose timetable we do not have and therefore could
   * not check: the fetch failed, or it was never made. NOT the courses NTNU
   * publishes nothing for — those are a known, drawable-as-nothing answer
   * (see `planGaps`). Non-empty ⇒ `conflictCount` is a floor, not the truth,
   * and the caller must not print a clean verdict (pc-3).
   */
  incompleteCourses: string[];
  /**
   * The counts are not the whole truth: a fetch is still in flight, or one
   * came back without an answer (`incompleteCourses`). Either way the verdict
   * line must stay quiet about "ingen kollisjoner".
   */
  partial: boolean;
}

function roomLabel(rooms: { building: string | null; room: string | null }[]): string {
  return rooms
    .map((r) => r.room ?? r.building ?? "")
    .filter(Boolean)
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
 * Collects every timetable entry (with course context) for courses that have
 * a loaded bundle. Each course's raw entries pass through
 * `applyGroupSelection` FIRST (§5 mandate point 1): the grid never shows a
 * parallel the student did not select — the programme's own lecture parallel
 * is the default, unpicked øving/lab groups stay all-muted until chosen. The
 * programme code and any explicit selection ride on the course state.
 *
 * `showAllGroups` bypasses that narrowing entirely (Task 7 ruling) — see
 * `GridRenderOptions.showAllGroups`.
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
    // A course offering exactly ONE øving/lab group offers no choice, so it
    // is treated as already picked and simply drawn. Same rule the popover's
    // group picker follows: a control that cannot change anything is noise,
    // and "HMS0002 har 1 gruppe — velg din" is that noise as a sentence.
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
        weeksNumbers,
        weeksLabel: weekLabel(weeksNumbers),
        isLecture: classifyActivity(raw) === "lecture",
        // `showAllGroups` is the course page, which is a reference for the
        // course rather than one student's plan — every group counts as
        // shown there.
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
 * carries — never re-derived from the entry array. The semester-narrowed
 * clone plannerApp hands us keeps the *fetch's* outcome (data.ts), so
 * "fetched fine, nothing this semester" (`offSemester`) stays a different
 * sentence from "we never got an answer" (`failed`). Only the second kind
 * makes the collision check incomplete; the first two are answers.
 *
 * A course whose fetch is still in flight is in none of the lists — the
 * caller's `loading` flag already says so, and "mangler timeplan" about a
 * request that is running is not true yet.
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
 * picked (audit edit-4/ux-1/groups-5/week-5). `resolveLectureDefaults` draws
 * one provisional session per ambiguous family rather than all nine of
 * TMA4400's — which is only honest if the week says so, so each of these
 * becomes the same "velg din" note the øving layer already gets, in the
 * lecture-only view too.
 *
 * `showAllGroups` (the `/emne/` reuse) narrows nothing, so nothing there is a
 * guess and the list is empty.
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
    // An explicit lecture pick is an answer, even a wrong one — the picker is
    // where it gets changed, not a margin note repeating the question.
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
 * Collapses a course's identical parallel slots into one block (U1). Kept
 * apart by activity title and by lecture/other, so we never have to invent a
 * joint label for two things the student would read as different — the
 * EXPH0300 "Forelesningsparallell 2 Trondheim" / "…3 Gjøvik" pair stays two
 * blocks, the four byte-identical "Lab" rows become one.
 */
function mergeSlots(entries: GridEntry[]): GridEntry[] {
  return mergeParallelSlots(entries, (e) => `${e.isLecture ? "L" : "O"}|${e.name}`).map(
    ({ representative, entries: members }) => {
      if (members.length === 1) return representative;
      const rooms = [...new Set(members.flatMap((m) => m.rooms.split(", ")))]
        .filter(Boolean)
        .join(", ");
      return { ...representative, rooms, groupCount: members.length };
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

/** An all-day drop-in window (08:00–18:00 lab). Never a lecture — see the module docs. */
function isBandEntry(entry: GridEntry): boolean {
  return !entry.isLecture && durationMinutes(entry) >= ALL_DAY_MINUTES;
}

// --- Frame state ----------------------------------------------------------

/*
 * There is no `setFrameRuled` any more. The ruling used to be a spreadsheet
 * tiling on the FRAME (`np-ruled`/`np-ruled--hours`), which every branch here
 * had to remember to strip so the ruling never framed an apology (D5). It is
 * now a single hour hairline on `.planner-grid-rail`/`.planner-grid-day`
 * (planner-week.css) — children only a drawn week has — so
 * Ruling-Marks-The-Plan holds by construction: a message branch builds no
 * grid, so there is nothing to strip. The skeleton is the one case that
 * builds a shell without a plan, and `.planner-grid.is-skeleton` drops its
 * lines in CSS.
 */

/**
 * Renders a message where the week would be, in `.np-hint` (a sentence, so
 * grotesk). Exported so the page's pre-publish branch (DR-2) can clear the
 * frame through the same door.
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
 * A week-shaped placeholder while the bundles load: the rail, the day names
 * and the height the real grid will need. Nothing here claims anything about
 * the plan — the caller's status line already says "henter timeplan …".
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
 * the day's name in the left spine, its lanes in the field beside it
 * (REWORK-2026-07-29b D1).
 *
 * The spine is the signature and it is load-bearing, not decoration: at
 * display size with the current day at full ink and the rest of the week
 * receding, it is how a student finds their row without reading. Three
 * letters of `.np-kicker` in a 3rem column did not do that.
 *
 * `--planner-span` is the axis's own length in minutes. Every bar's `left` and
 * `width` are percentages of it, so the ruler's ticks and the bars share one
 * coordinate system by construction — there is no second place where a time
 * becomes a position.
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
  // Read back by the pointer readout and the now marker, which have to turn a
  // pixel into a time and cannot re-derive the clamp the render chose.
  grid.setAttribute("data-min", String(minMinutes));
  grid.setAttribute("data-span", String(span));
  // role="group", not "img": the grid holds focusable blocks (each with its own
  // aria-label), and "img" would strip them from the accessibility tree.
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", ariaLabel);

  // The ruler. Its figures sit ON their tick rather than floating above the
  // field — the tick is what ties a number to a position.
  const ruler = el("div", "planner-grid-ruler");
  const rulerTrack = el("div", "planner-grid-ruler-track");
  rulerTrack.setAttribute("aria-hidden", "true");
  for (let hour = Math.ceil(minMinutes / 60); hour <= Math.floor(maxMinutes / 60); hour++) {
    const tick = el("span", "planner-grid-tick np-data", String(hour).padStart(2, "0"));
    // The hour is the tick's identity across a re-render: when the øving layer
    // stretches the axis, 10:00 has to travel to its new percentage rather
    // than be replaced by a different element that happens to say "10"
    // (layerMotion.ts).
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

    // A real word, not an abbreviation: the spine has the width for it, and
    // "mandag" is a sentence fragment, so it is the grotesk, not the mono
    // (Data-Is-Mono cuts the other way here).
    row.append(el("div", "planner-grid-spine", dayName(day)));

    // Bars are absolutely positioned against this box, so it — not the grid —
    // has to be the positioned ancestor, or every day's bars would resolve
    // their percentages against the whole week and land in the same strip.
    const field = el("div", "planner-grid-field");
    row.append(field);
    grid.append(row);
    dayFields.set(day, field);
  }

  // The readout that makes the axis legible to the minute. The ruler labels
  // whole hours only, and a bar no longer prints its own start time — which is
  // the trade that bought the bar its width — so without this there is nowhere
  // on the surface to learn that a lecture starts 08:15 rather than 08:00.
  const pointer = el("div", "planner-grid-pointer");
  pointer.hidden = true;
  pointer.setAttribute("aria-hidden", "true");
  pointer.append(el("span", "planner-grid-pointer-time np-data"));
  grid.append(pointer);

  // "Now", drawn once through the whole week: faint everywhere so the hour
  // reads across every day, solid in today's row where it is literal.
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
 * Places the "now" marker, or hides it when the moment is outside the drawn
 * week. Exported because it has to be re-run on a timer: a line that says
 * "now" and means "an hour ago" is worse than no line, and re-rendering the
 * whole week every minute to move one element would be absurd.
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
  if (!Number.isFinite(min) || !Number.isFinite(span) || minutes < min || minutes > min + span) {
    marker.hidden = true;
    return;
  }
  marker.hidden = false;
  marker.style.setProperty("--planner-x", String(((minutes - min) / span) * 100));
  // Solid only where it is literally true. A weekend, or a day the week does
  // not draw, still gets the faint line — the hour is the same hour.
  marker.classList.toggle("is-today", row !== null);
  if (row) {
    marker.style.setProperty("--planner-now-top", `${row.offsetTop}px`);
    marker.style.setProperty("--planner-now-height", `${row.offsetHeight}px`);
  }
}

/**
 * Wires the hover readout: a hairline that follows the pointer across the time
 * axis with the minute under it.
 *
 * Mouse only. A finger covers the very pixel the readout is about, and a line
 * that appears under a tap and stays there reads as a selection nobody made.
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
    // Rounded to five minutes: the axis cannot be read more finely than that
    // at any width the week is drawn at, and a jittering unit figure invites a
    // precision the geometry does not have.
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
 * own span, `--planner-lane` for which stacked lane it sits in.
 *
 * Percentages, not pixels, because the axis is fluid — the same grid has to
 * hold up from a 22rem phone to a 90rem desktop, and a bar that resolved its
 * position against a fixed cell size would drift off its own hour tick at
 * every width but the one it was measured at.
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
 * The collision, drawn once per day rather than once per block: a zone cut
 * through every lane in the row across exactly the minutes that overlap,
 * edged in `--clash` on both sides (REWORK-2026-07-29b D4).
 *
 * It is the only element in the week that crosses lanes, which is precisely
 * what a collision is — two things in one moment. The old per-block band
 * could only shade its own bar, so a three-way clash read as three unrelated
 * stripes; and on a solid printed bar a translucent red wash just muddies the
 * hue instead of out-shouting it, which Red-Is-Collision requires.
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
 * The block's second line: `start · room` (just the start when there is no
 * room). The start time comes FIRST because `.planner-block-meta` is
 * `nowrap` + ellipsis and a 73 px block clips whatever is last — with the
 * room first, the time was the one fact a student copies into a calendar and
 * the only one the hour rail (whole hours) cannot give back (week-4). The
 * room survives in the block's `title`, its aria-label and the popover.
 */
export function metaLine(entry: { rooms: string; startTime: string }): string {
  return [entry.startTime, entry.rooms].filter(Boolean).join(" · ");
}

/** The course-settings material for a single block. */
function blockDetailFor(entry: GridEntry): BlockDetail {
  const label = groupLabel(entry);
  return {
    code: entry.courseCode,
    dayNumber: entry.dayNumber,
    name: entry.courseName,
    entryName: label || null,
    timeLabel: `${dayName(entry.dayNumber)} ${entry.startTime}–${entry.endTime}`,
    rooms: entry.rooms,
    weeksLabel: entry.weeksLabel,
    isLecture: entry.isLecture,
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

  // One line, and the code is the half that may never be cut. The bar no
  // longer prints its own start time: the axis above it is labelled and the
  // bar begins at its own minute, so a time inside the bar would be the same
  // fact said twice. That is what frees the width for `activity · room` —
  // what it is, rather than when it is (REWORK-2026-07-29b D1).
  block.append(el("span", "planner-block-code np-data", entry.courseCode));
  if (durationMinutes(entry) >= COMPACT_BLOCK_MINUTES) {
    // Room FIRST: the bar has room for one of the two and the ellipsis eats
    // whatever is last, so the fact a student is walking somewhere to find out
    // survives and the activity label is what gets cut (the same reasoning as
    // week-4, re-aimed now that the axis carries the time).
    const what = [entry.rooms, label].filter(Boolean).join(" · ");
    if (what) block.append(el("span", "planner-block-what", what));
  }

  if (onBlockClick)
    block.addEventListener("click", () => onBlockClick(blockDetailFor(entry), block));
  return block;
}

function blockId(entry: GridEntry): string {
  // The ordinal is load-bearing: (code, day, start) is NOT unique — EXPH0300
  // publishes "Forelesningsparallell 2 Trondheim" and "…3 Gjøvik" at the same
  // Monday 10:15, and duplicate DOM ids made a conflict note flash the wrong
  // block (REVIEW.md C5b).
  return `planner-block-${entry.ordinal}`;
}

// --- Notes ----------------------------------------------------------------

/**
 * Builds the collision sentence into `host` and returns the same text flat,
 * for the button's accessible name. `.np-note-clash` is grotesk now, so the
 * day, time, codes and weeks it quotes carry `.np-data` (Data-Is-Mono).
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

/**
 * A margin sentence about courses the week could not draw: grotesk (it has a
 * verb) with the course codes in `.np-data` (Data-Is-Mono), same idiom as the
 * conflict note above.
 */
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
 * Which entries the week actually draws, and whether the muted layer had to
 * reveal itself to have anything to draw at all.
 *
 * Two guards meet here and their COMPOSITION is what broke (ux-fail-1):
 *
 *  - B7a: 47 programmes have timetable entries and not one that classifies as
 *    a lecture. DR-1 accepts under-classification *because* the toggle layer
 *    still shows the entry, so when that layer is all there is, it is shown
 *    and the margin says why — rather than shipping a blank week.
 *  - The øving/lab layer shows the groups the student PICKED, not every group
 *    the course publishes: EXPH0300 alone ships nine seminar groups at nine
 *    different times and drawing them all put 41 blocks in an MTDT week.
 *
 * Applied together, the second emptied the first: in the auto-reveal branch
 * nothing is a lecture *by definition*, so `isLecture || groupPicked` kept
 * exactly nothing for a student who had picked no group — BI1006's eleven
 * real sessions rendered as a blank, green-verdict week. An auto-revealed
 * layer therefore draws every entry it has; the "har N grupper — velg din"
 * note is the narrowing invitation, and narrowing is only allowed to remove
 * teaching when something else is left standing.
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
 * Courses that published sessions but not one this app can call a lecture, in
 * plan order.
 *
 * `visibleLayer`'s B7a auto-reveal is plan-GLOBAL: it fires only when NOT ONE
 * course in the plan has a lecture. Add an ordinary course alongside a
 * lecture-less one and the reveal stops firing, so the lecture-less course
 * drops out of the drawn week AND out of the (lecture-only, DR-1) collision
 * check with nothing said about it. That silence is the defect — TFY4220's
 * autumn hit it before its bucket-titles were classified (activity.ts), and a
 * measured ~22% of course-terms still cannot be lecture-classified at all and
 * never will be: Kunstakademiet publishes "allmøte" and "atelierflyt/rydding",
 * the conservatory "Gehør gruppe 1".
 *
 * The fix is to SAY it, not to draw it. Auto-revealing these per-course was
 * considered and rejected on the data: BK1151 alone would add 36 blocks
 * including four all-day "examn week" rows, and feeding those to the conflict
 * engine would collide every other course in the plan against them — mass
 * false reds, the precise failure DR-1 exists to prevent.
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
 * `showOthers` (the page's "Vis øvinger og labber" toggle) decides whether
 * non-lecture entries are drawn at all — see `visibleLayer` for that rule and
 * its auto-reveal. Hour clamping follows the SHOWN entries so the default
 * view stays compact. The margin carries three kinds of sentence: what the
 * week could not draw and why (`planGaps`), which slots collide, and which
 * courses are still waiting for the student to pick a group.
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
  // What the week has no answer for, straight from each fetch's own outcome
  // (pc-3/ux-4). A failed or never-made fetch is the only kind that makes the
  // collision check incomplete; the other two gaps are answers, and get said
  // out loud in the margin instead of vanishing.
  const gaps = planGaps(courses);
  const incompleteCourses = [...gaps.failed, ...gaps.pending];
  // Courses whose lecture layer is one provisional pick out of several — the
  // week draws it, the margin says so (edit-4/ux-1/groups-5/week-5).
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
    };
  };

  // An unanswered studieretning/campus question is what the *empty* week says
  // instead of the canned recovery copy (B2) — it is not a curtain drawn over
  // a week that already has something true to show. `programPlan.ts`'s
  // intersection rule prefills every course that is obligatory in *all*
  // directions precisely so a gated period still renders the student's real
  // blocks before they answer; suppressing them re-created B2's symptom from
  // the other side (a primary surface that says nothing while the data is
  // there) and broke §0.1's "programme + kull → your week, instantly". The
  // question panel sits directly above the frame and already says the week
  // fills in on answering, so a partial week is read as partial.
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
    };
  }
  if (rawEntries.length === 0) {
    // Ordered by severity, the same way the caller's own fallback chain is
    // (ux-3): a fetch that failed is not a question the student can answer, so
    // telling them to pick a studieretning over it sends them to a control
    // that cannot fix the week. The question is not lost — `#planner-direction`
    // keeps its own panel above the frame.
    if (gaps.failed.length > 0) {
      return empty("empty", `Fikk ikke hentet timeplan for ${joinList(gaps.failed)}.`);
    }
    if (pending) return empty("pending-choice", pending);
    // "Ingen timeplandata … ennå" is a claim about NTNU's data. It may only
    // be made when we actually got an answer; a failed fetch says so instead
    // (pc-3).
    return empty("empty", "Ingen timeplandata for emnene i planen ennå.");
  }

  const { shown, mutedLayerAutoRevealed } = visibleLayer(rawEntries, showOthers);
  const revealOthers = showOthers || mutedLayerAutoRevealed;
  const entries = mergeSlots(shown);

  // Courses with øving/lab groups and no pick, with how many they offer.
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
  const conflicts = findConflicts(entries.filter((e) => e.isLecture));
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

  // Clamp displayed hours to the entries actually shown — the grid is as
  // tall as the visible week needs, not a fixed 08–20 canvas (a lecture-only
  // week ending 16:00 shouldn't drag four empty hours). Toggling øvinger may
  // grow the grid; that reflow is expected.
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

  // Every rendered entry resolves to the element that represents it.
  // Conflict notes flash through this map rather than through
  // getElementById (C5b).
  const nodeByEntry = new Map<ScheduleEntry, HTMLElement>();
  const geometryBase = { minMinutes, span };
  let blockCount = 0;
  /** Stagger index — one continuous count across the week, so the bars strike
   *  in reading order rather than restarting on every row. */
  let strikeIndex = 0;

  for (let day = 1; day <= dayCount; day++) {
    const field = shell.dayFields.get(day);
    if (!field) continue;
    const dayEntries = entries.filter((e) => e.dayNumber === day);

    // A day's collision zone is drawn once, behind its bars, spanning every
    // lane. Appended FIRST so the bars paint over it — the zone marks the
    // minutes, the bars stay legible.
    const dayClash = clashWindowFor(dayEntries);
    if (dayClash) field.append(buildClashZone(dayClash, minMinutes, span));

    // All-day drop-in windows sit behind the day as a band; letting one take a
    // lane is what turns a Monday with an 08:00–18:00 lab into a slab that
    // pushes every real session down a row.
    const bands = dayEntries.filter(isBandEntry);
    for (const entry of bands) {
      const block = buildBlock(entry, { ...geometryBase, clashWindow: null }, 0, [], undefined);
      nodeByEntry.set(entry, block);
      field.append(block);
      blockCount++;
    }

    // Everything else is lane-packed by layoutDay, uncapped: overlapping
    // sessions stack downward and every one of them stays full width and
    // readable. There is no pile any more — see LANE_CAP.
    const packable = dayEntries.filter((e) => !isBandEntry(e));
    const layoutInput: LayoutInput[] = packable.map((e) => ({
      id: blockId(e),
      start: timeToMinutes(e.startTime),
      end: timeToMinutes(e.endTime),
    }));
    const slotById = new Map(layoutDay(layoutInput, LANE_CAP).map((slot) => [slot.id, slot]));

    // How tall this row has to be: the deepest cluster in it. Rows are not a
    // uniform height, and that is the honest shape of a week — a Monday with a
    // collision genuinely occupies more of the page than an empty Friday.
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

  // Blocks own their click now (a single block opens the course-settings
  // modal — see `GridRenderOptions.onBlockClick`); the conflict-note links
  // below are what drive `flash`, resolving each entry to its bar through
  // `nodeByEntry`.
  frame.replaceChildren(shell.element);
  wirePointer(shell.element, minMinutes, span);
  syncNowMarker(frame);

  // Margin notes: one per collision slot, not one per pair — a 3-way clash is
  // one Thursday afternoon to fix, and reporting it three times inflates the
  // damage and buries the actionable fact (U3).
  notesHost.replaceChildren();

  // The gaps come first: they qualify every sentence below them. A course we
  // could not fetch makes the whole collision check incomplete; a course NTNU
  // publishes nothing for — or nothing in this semester — is a real answer,
  // but it is one the week cannot draw, so it is said instead of vanishing
  // (pc-3/ux-4).
  if (gaps.failed.length > 0) {
    notesHost.append(
      gapNote(
        "Fikk ikke hentet timeplan for ",
        gaps.failed,
        " — kollisjonssjekken er ufullstendig.",
      ),
    );
  }
  if (gaps.pending.length > 0) {
    notesHost.append(
      gapNote("Mangler timeplan for ", gaps.pending, " — kollisjonssjekken er ufullstendig."),
    );
  }
  if (gaps.empty.length > 0) {
    notesHost.append(gapNote("NTNU har ingen timeplan for ", gaps.empty, "."));
  }
  if (gaps.offSemester.length > 0) {
    notesHost.append(gapNote("", gaps.offSemester, " undervises ikke i valgt semester."));
  }

  if (mutedLayerAutoRevealed) {
    notesHost.append(
      el(
        "p",
        "planner-grid-note np-hint",
        "Ingen aktiviteter er merket som forelesning i disse emnene — viser all undervisning.",
      ),
    );
  } else if (!revealOthers) {
    // The plan-global auto-reveal above did not fire because SOME course has a
    // lecture — which is exactly when a lecture-less course disappears without
    // a word. Name it rather than draw it (`lectureLessCourses`).
    const silent = lectureLessCourses(rawEntries);
    if (silent.length > 0) {
      notesHost.append(
        gapNote(
          "Ingen aktiviteter er merket som forelesning i ",
          silent,
          " — timene vises ikke her, og de er ikke med i kollisjonssjekken. Slå på «vis øvinger og labber» for å se dem.",
        ),
      );
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
  // narrowed on a guess or on nothing, and clicking it opens that course's
  // picker (the same settings modal a block opens).
  //
  // The lecture lines come first and are NOT gated on the øving toggle: an
  // unresolved lecture parallel is drawn provisionally (groups.ts picks one
  // per session family), and a provisional pick the student is never told
  // about is how MTIØT's week showed one of TMA4400's nine alternatives — or,
  // before that, all nine — under a green verdict (edit-4/ux-1/week-5).
  const choiceNotes = [
    ...lectureChoices.map((choice) => ({
      code: choice.code,
      name: choice.name,
      hueVar: choice.hueVar,
      text: ` har ${choice.count} alternative forelesninger — velg din`,
      aria: `${choice.code} har ${choice.count} alternative forelesninger — vi viser én av dem, velg din`,
    })),
    ...[...unpickedGroups].map(([code, row]) => {
      const count = row.keys.size;
      const noun = count === 1 ? "gruppe" : "grupper";
      return {
        code,
        name: row.name,
        hueVar: row.hueVar,
        text: ` har ${count} ${noun} — velg din`,
        aria: `${code} har ${count} ${noun} du ikke har valgt — velg din`,
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
      // A margin note is about a whole COURSE — "TMA4400 har fire parallellar,
      // vel di" — so it opens the group picker, not the session popover a bar
      // opens. They used to share `onBlockClick`, which sent a note asking you
      // to choose a group to a read-only card about one session.
      if (options.onChoiceClick) {
        const code = note.code;
        link.addEventListener("click", () => options.onChoiceClick?.(code));
      }
      item.append(link);
      list.append(item);
    }
    notesHost.append(list);
  }

  return {
    conflictCount: conflictGroups.length,
    conflictPairCount: conflicts.length,
    mutedLayerAutoRevealed,
    blockCount,
    state: "grid",
    incompleteCourses,
    partial: loading || incompleteCourses.length > 0,
  };
}
