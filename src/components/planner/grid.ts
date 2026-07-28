/**
 * UKEPLAN — the weekly spread (PRODUCT.md §0/DR-1). An unboxed surface ruled
 * only at the hour, CSS grid Mon–Fri (+Sat only if data demands), 15-min rows clamped
 * to the data's actual time range. Lectures render by default; the caller
 * passes `showOthers` (driven by the page's "Vis øvinger og labber" toggle)
 * to additionally render øving/lab/seminar blocks — muted (reduced ink, hue
 * dot only, never red) and never considered for collisions. Only
 * lecture×lecture overlaps get the clash edge; `.np-note-clash` margin notes
 * below link to and flash the blocks.
 *
 * Legibility is a correctness property here, not polish (REVIEW.md U1/U3, and
 * the REWORK mandate's "render simultaneous courses properly"). Overlap is a
 * *supported* state — people deliberately take colliding courses — so the
 * surface stays readable at the week's ~106 px weekday width by these rules,
 * in this order:
 *
 *   1. each course renders only its *selected* group set — the programme's
 *      own lecture parallel by default (`applyGroupSelection`), so the pile
 *      is what the student actually attends, not every section overlaid;
 *   2. identical parallel slots that survive that filter collapse to one
 *      block ("Lab · 4 grupper") — DR-1 concedes they are indistinguishable;
 *   3. an all-day non-lecture drop-in window becomes a band behind the day
 *      rather than a full-height column that squeezes everything else;
 *   4. `layoutDay` packs the rest into side-by-side columns; a cluster deeper
 *      than `MAX_COLUMNS` (2) collapses whole into ONE pile block naming each
 *      of its courses, instead of splitting into unreadable slivers. Both a
 *      block and a pile open the popover via `onBlockClick`.
 *
 * The øving/lab layer additionally shows only groups the student has PICKED —
 * a service course publishes a dozen, and drawing them all made the toggle a
 * switch between "my week" and "the cohort's week". See `renderGrid`.
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

/** A non-lecture window at least this long is a drop-in band, not a column (U1). */
const ALL_DAY_MINUTES = 5 * 60;
/** Below this height a block only has room for its code + room·time — name/weeks move to the popover. */
const COMPACT_BLOCK_MINUTES = 90;

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
 * block popover (§5). A pile's `code` is its courses' codes joined with
 * " · " (plannerApp reads that separator to pick the whole-pile popover);
 * a single block's is one course code.
 */
export interface BlockDetail {
  /** Course code, or the pile's codes joined with " · ". */
  code: string;
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
  dayColumns: Map<number, HTMLElement>;
}

/**
 * The empty week: hour rail, day headers, day columns. Headers are children
 * of the *grid* on their own first row, not of the day columns (U2) — a block
 * is absolutely positioned from its column's top, so a header inside the
 * column is painted over by any entry starting at the grid's first hour, and
 * a week grid without day names is not a week grid.
 */
function buildGridShell(
  minMinutes: number,
  maxMinutes: number,
  dayCount: number,
  ariaLabel: string,
): GridShell {
  const totalRows = Math.ceil((maxMinutes - minMinutes) / ROW_MINUTES);
  const grid = el("div", "planner-grid");
  grid.style.setProperty("--planner-rows", String(totalRows));
  grid.style.setProperty("--planner-days", String(dayCount));
  // role="group", not "img": the grid holds focusable blocks (each with its own
  // aria-label), and "img" would strip them from the accessibility tree.
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", ariaLabel);

  for (let day = 1; day <= dayCount; day++) {
    const header = el("div", "planner-grid-day-header np-kicker", dayName(day).slice(0, 3));
    header.style.setProperty("--planner-day", String(day));
    grid.append(header);
  }

  const rail = el("div", "planner-grid-rail");
  for (let hour = minMinutes / 60; hour <= maxMinutes / 60; hour++) {
    const label = el("div", "planner-grid-hour np-data", `${String(hour).padStart(2, "0")}:00`);
    label.style.setProperty(
      "--planner-row-start",
      String((hour * 60 - minMinutes) / ROW_MINUTES + 1),
    );
    rail.append(label);
  }
  grid.append(rail);

  // Blocks are appended *inside* their own day's column — `.planner-block` is
  // absolutely positioned relative to its nearest positioned ancestor, and
  // `.planner-grid-day` is that ancestor. Appending them straight onto
  // `.planner-grid` (as a former version of this code did) makes every day's
  // blocks position against the whole grid's width, collapsing all weekdays
  // into the same horizontal strip.
  const dayColumns = new Map<number, HTMLElement>();
  for (let day = 1; day <= dayCount; day++) {
    const col = el("div", "planner-grid-day");
    col.style.setProperty("--planner-day", String(day));
    grid.append(col);
    dayColumns.set(day, col);
  }

  return { element: grid, dayColumns };
}

// --- Blocks ---------------------------------------------------------------

interface BlockGeometry {
  minMinutes: number;
  /** Overlap window to paint the clash band over, in absolute minutes. */
  clashWindow: { start: number; end: number } | null;
}

function positionBlock(
  block: HTMLElement,
  startMinutes: number,
  endMinutes: number,
  minMinutes: number,
  column: number,
  columnCount: number,
): void {
  const startRow = Math.round((startMinutes - minMinutes) / ROW_MINUTES) + 1;
  const endRow = Math.round((endMinutes - minMinutes) / ROW_MINUTES) + 1;
  block.style.setProperty("--planner-row-start", String(startRow));
  block.style.setProperty("--planner-row-end", String(endRow));
  block.style.setProperty("--planner-col", String(column));
  block.style.setProperty("--planner-col-count", String(columnCount));
}

/**
 * The overlap band (D9): `--clash-bg` over the minutes that actually collide,
 * with the solid `--clash-edge` rule down the block's inline start. A hatch
 * over the whole block reads at the same weight as a hue wash; a solid edge
 * plus a filled band is categorically different ink, which is what
 * Red-Is-Collision is for.
 */
function appendClashBand(
  block: HTMLElement,
  blockStart: number,
  blockEnd: number,
  window: { start: number; end: number },
): void {
  const start = Math.max(blockStart, window.start);
  const end = Math.min(blockEnd, window.end);
  if (end <= start) return;
  const band = el("span", "planner-block-clash-band");
  band.setAttribute("aria-hidden", "true");
  band.style.setProperty("--planner-band-start", String((start - blockStart) / ROW_MINUTES));
  band.style.setProperty("--planner-band-end", String((end - blockStart) / ROW_MINUTES));
  block.prepend(band);
}

/** The course chip every block wears — DESIGN §5's `.np-tag`, at the in-grid size. */
function courseTag(hueVar: string, code: string): HTMLElement {
  const tag = el("span", "np-tag np-tag--sm planner-block-tag");
  tag.append(dot(hueVar));
  tag.append(el("span", "planner-block-code np-data", code));
  return tag;
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

/** The popover material for a single block. */
function blockDetailFor(entry: GridEntry): BlockDetail {
  const label = groupLabel(entry);
  return {
    code: entry.courseCode,
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
  column: number,
  columnCount: number,
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
  positionBlock(block, startMinutes, endMinutes, geometry.minMinutes, column, columnCount);
  block.setAttribute("aria-label", blockAriaLabel(entry, partnerCodes));

  const label = groupLabel(entry);
  const timeRange = `${entry.startTime}–${entry.endTime}`;
  block.title = [entry.courseCode, label, timeRange, entry.rooms, entry.weeksLabel]
    .filter(Boolean)
    .join(" · ");

  // Two-line minimum (§5): the FULL course code, never truncated, then
  // `room · start`. The activity name and week range are extra lines the
  // block only earns above ~90 min — below that they clip mid-word, and the
  // popover carries them anyway.
  block.append(courseTag(entry.hueVar, entry.courseCode));
  block.append(el("span", "planner-block-meta np-data", metaLine(entry)));
  if (durationMinutes(entry) >= COMPACT_BLOCK_MINUTES) {
    block.append(el("span", "planner-block-name", label));
    if (entry.weeksLabel) block.append(el("span", "planner-block-weeks np-data", entry.weeksLabel));
  }

  if (geometry.clashWindow) {
    appendClashBand(block, startMinutes, endMinutes, geometry.clashWindow);
  }
  if (onBlockClick)
    block.addEventListener("click", () => onBlockClick(blockDetailFor(entry), block));
  return block;
}

/** The structural subset of a pile member its labels are built from. */
interface PileMember {
  courseCode: string;
  startTime: string;
  endTime: string;
}

/** Everything a pile says about itself, in one place so the block and the popover agree. */
export interface PileSummary {
  /** Distinct course codes, first-session-first. */
  codes: string[];
  /** "5 aktiviteter" — sessions, not courses. */
  activities: string;
  /** The block's caption: "2 emner · 5 aktiviteter", or just the activities for one course. */
  meta: string;
  /** Every session timed: "ETT1101 08:15–10:00 og 09:15–10:00; ETT1102 08:15–11:00". */
  sessions: string;
  /** The same, grouped: one row per course, its times in start order. */
  byCourse: { code: string; times: string[] }[];
}

/**
 * What a pile is allowed to claim. Three findings meet here:
 *
 *  - grid-1: the pile printed one row per distinct COURSE and the cluster's
 *    earliest start, so four of five days on a prefilled BERGO week were
 *    identical featureless slabs reading "2 emner · 08:15" over nine real
 *    sessions. Every session is named and timed now.
 *  - copy-1/grid-5: the two counts wore each other's nouns — "1 emner",
 *    "1 aktiviteter samtidig". Courses count as emner, sessions as
 *    aktiviteter, and a single-course pile drops the course count entirely:
 *    it is one course's own overlapping sessions, not a pile of courses.
 *  - grid-2: nothing says "samtidig" any more. A cluster is a *chain* of
 *    overlaps (A–B, B–C, with A and C free of each other) and the week is a
 *    composite of every teaching week, so two members can be a month apart —
 *    ETT1101's Tuesday lectures run weeks 33-34, 37-42, ETT1102's 35-36. What
 *    the pile can honestly say is that they share one rute; the times say the
 *    rest.
 *
 * `sessions` names the course on every row only when there is more than one —
 * a single-course pile has its code above the list already.
 */
export function pileSummary(members: PileMember[]): PileSummary {
  const byCourse: { code: string; times: string[] }[] = [];
  for (const member of members) {
    const time = `${member.startTime}–${member.endTime}`;
    const row = byCourse.find((r) => r.code === member.courseCode);
    if (row) row.times.push(time);
    else byCourse.push({ code: member.courseCode, times: [time] });
  }
  const codes = byCourse.map((r) => r.code);
  const activities = `${members.length} ${members.length === 1 ? "aktivitet" : "aktiviteter"}`;
  const single = codes.length === 1;
  return {
    codes,
    activities,
    // The plural of "emne" needs no branch in the multi-course arm: one
    // course takes the other one.
    meta: single ? activities : `${codes.length} emner · ${activities}`,
    sessions: single
      ? joinList(byCourse[0]?.times ?? [])
      : byCourse.map((r) => `${r.code} ${joinList(r.times)}`).join("; "),
    byCourse,
  };
}

/**
 * ONE block for a whole cluster that would need more than `MAX_COLUMNS`
 * columns — the pile. It spans the cluster's own start→end at full day width
 * and lists every session it holds, so nothing is hidden and no code is
 * squeezed into a 35 px sliver.
 *
 * This replaces the "+N til" chip, which showed the first two columns and
 * reduced everything behind them to a count. A count is the one thing a
 * student cannot act on: "+3 til" does not say whether the pile contains the
 * lecture they came for. Clicking still opens the popover with every entry.
 *
 * Each course's code sits on its own row and its session times on the rows
 * below it: a ~106 px weekday has no room for a code and a start–end range
 * side by side, and the code is the one thing that must never be clipped.
 */
function buildPileBlock(
  entries: GridEntry[],
  geometry: BlockGeometry,
  onBlockClick?: GridRenderOptions["onBlockClick"],
): HTMLButtonElement {
  const start = Math.min(...entries.map((e) => timeToMinutes(e.startTime)));
  const end = Math.max(...entries.map((e) => timeToMinutes(e.endTime)));

  const block = el("button", "planner-block planner-block-pile");
  block.type = "button";
  block.id = `planner-pile-${entries[0]?.ordinal ?? 0}`;
  positionBlock(block, start, end, geometry.minMinutes, 0, 1);

  // A pile is only muted when every entry in it is: one lecture in the pile
  // means the pile carries a session the student is expected to attend.
  if (entries.every((e) => !e.isLecture)) block.classList.add("is-muted");
  if (geometry.clashWindow) {
    block.classList.add("is-clash");
    appendClashBand(block, start, end, geometry.clashWindow);
  }

  const summary = pileSummary(entries);
  const hueByCode = new Map(entries.map((e) => [e.courseCode, e.hueVar]));
  const single = summary.codes.length === 1;
  const soleCode = single ? summary.codes[0] : undefined;

  // One course's own overlapping sessions are not a pile of courses: the
  // block wears that course's tag exactly like a single block does (grid-5).
  if (soleCode) block.append(courseTag(hueByCode.get(soleCode) ?? "", soleCode));
  block.append(el("span", "planner-block-meta np-data", summary.meta));

  const list = el("span", "planner-pile-list");
  for (const row of summary.byCourse) {
    if (!single) {
      const head = el("span", "planner-pile-row");
      head.append(dot(hueByCode.get(row.code) ?? ""));
      head.append(el("span", "planner-block-code np-data", row.code));
      list.append(head);
    }
    for (const time of row.times) list.append(el("span", "planner-block-meta np-data", time));
  }
  block.append(list);

  const detail = pileDetail(entries);
  block.title = [detail.timeLabel, detail.rooms, detail.weeksLabel].filter(Boolean).join(" · ");
  block.setAttribute(
    "aria-label",
    `${soleCode ? `${soleCode}, ` : ""}${summary.activities} i samme rute, ${dayName(entries[0]?.dayNumber ?? 1)}: ${summary.sessions}`,
  );
  if (onBlockClick) block.addEventListener("click", () => onBlockClick(detail, block));
  return block;
}

/**
 * Synthetic popover material for a pile: its entries, codes joined " · "
 * (plannerApp keys the whole-pile popover off that separator). `timeLabel`
 * lists every session rather than the cluster's outer span — the popover was
 * the pile's only escape hatch and it answered "tirsdag 08:15–12:00" for nine
 * different sessions (grid-1).
 */
function pileDetail(entries: GridEntry[]): BlockDetail {
  const first = entries[0];
  const codes = [...new Set(entries.map((e) => e.courseCode))].join(" · ");
  const names = [...new Set(entries.map((e) => e.courseName))].join(" · ");
  const rooms = [...new Set(entries.flatMap((e) => e.rooms.split(", ")))]
    .filter(Boolean)
    .join(", ");
  const weeks = [...new Set(entries.flatMap((e) => e.weeksNumbers))].sort((a, b) => a - b);
  return {
    code: codes,
    name: names,
    entryName: null,
    timeLabel: `${dayName(first?.dayNumber ?? 1)} · ${pileSummary(entries).sessions}`,
    rooms,
    weeksLabel: weekLabel(weeks),
    isLecture: entries.some((e) => e.isLecture),
  };
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

  frame.removeAttribute("aria-busy");
  const shell = buildGridShell(
    minMinutes,
    maxMinutes,
    dayCount,
    "Ukeplan med timeplanblokker for emnene i planen",
  );

  // Every rendered entry resolves to the element that represents it — a
  // piled entry resolves to its pile. Conflict notes flash through this map
  // rather than through getElementById (C5b).
  const nodeByEntry = new Map<ScheduleEntry, HTMLElement>();
  const geometryBase = { minMinutes };
  let blockCount = 0;

  for (let day = 1; day <= dayCount; day++) {
    const column = shell.dayColumns.get(day);
    if (!column) continue;
    const dayEntries = entries.filter((e) => e.dayNumber === day);

    // All-day drop-in windows sit behind the day as a band; letting them take
    // a column is what turns a Monday with one 08:00–18:00 lab into slivers.
    const bands = dayEntries.filter(isBandEntry);
    for (const entry of bands) {
      const block = buildBlock(
        entry,
        { ...geometryBase, clashWindow: null },
        0,
        1,
        [],
        options.onBlockClick,
      );
      nodeByEntry.set(entry, block);
      column.append(block);
      blockCount++;
    }

    // Everything else is column-packed by layoutDay: up to MAX_COLUMNS
    // overlapping sessions get distinct side-by-side columns (overlap is
    // supported, both stay readable), and a cluster that would need more
    // collapses whole into ONE pile block naming its courses.
    const packable = dayEntries.filter((e) => !isBandEntry(e));
    const layoutInput: LayoutInput[] = packable.map((e) => ({
      id: blockId(e),
      start: timeToMinutes(e.startTime),
      end: timeToMinutes(e.endTime),
    }));
    const slotById = new Map(layoutDay(layoutInput).map((slot) => [slot.id, slot]));

    // The cluster partition comes from `layoutDay`'s own `slot.cluster`, not
    // from a second copy of its clustering rule here: the two agreed
    // character for character, but only one of them had tests, and the day
    // one edit made them disagree two entries would draw at identical
    // geometry with one hiding the other (tests-6). Members keep start order
    // so the pile lists its sessions in the order they happen.
    const clusters = new Map<number, GridEntry[]>();
    for (const entry of [...packable].sort(
      (a, b) =>
        timeToMinutes(a.startTime) - timeToMinutes(b.startTime) ||
        timeToMinutes(a.endTime) - timeToMinutes(b.endTime) ||
        blockId(a).localeCompare(blockId(b)),
    )) {
      const slot = slotById.get(blockId(entry));
      if (!slot) continue;
      const members = clusters.get(slot.cluster);
      if (members) members.push(entry);
      else clusters.set(slot.cluster, [entry]);
    }

    for (const cluster of [...clusters.entries()].sort(([a], [b]) => a - b).map(([, m]) => m)) {
      // `layoutDay` piles a cluster all-or-nothing, so the first member's
      // verdict is the cluster's.
      const first = cluster[0];
      const piled = first !== undefined && slotById.get(blockId(first))?.piled === true;

      if (piled) {
        const pile = buildPileBlock(
          cluster,
          { ...geometryBase, clashWindow: clashWindowFor(cluster) },
          options.onBlockClick,
        );
        // Every entry resolves to the pile (C5b), so a conflict note still
        // flashes the block its courses are actually drawn in.
        for (const entry of cluster) nodeByEntry.set(entry, pile);
        column.append(pile);
        blockCount++;
        continue;
      }

      for (const entry of cluster) {
        const slot = slotById.get(blockId(entry));
        if (!slot) continue;
        const entryClash = clashWindowFor([entry]);
        const partnerCodes = [
          ...new Set(
            (groupsByEntry.get(entry) ?? [])
              .flatMap((g) => g.codes)
              .filter((code) => code !== entry.courseCode),
          ),
        ];
        const block = buildBlock(
          entry,
          { ...geometryBase, clashWindow: entryClash },
          slot.col,
          slot.cols,
          partnerCodes,
          options.onBlockClick,
        );
        nodeByEntry.set(entry, block);
        column.append(block);
        blockCount++;
      }
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

  // Blocks own their click now (it opens the popover via onBlockClick); the
  // conflict-note links below are what drive `flash`, resolving each entry to
  // its block or overflow chip through `nodeByEntry`.
  frame.replaceChildren(shell.element);

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
  // picker (the same popover a block opens).
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
      if (options.onBlockClick) {
        const detail: BlockDetail = {
          code: note.code,
          name: note.name,
          entryName: null,
          timeLabel: "",
          rooms: "",
          weeksLabel: "",
          isLecture: false,
        };
        link.addEventListener("click", () => options.onBlockClick?.(detail, link));
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
