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
 *      than `MAX_COLUMNS` renders the first columns as blocks and the rest as
 *      one "+N til" chip that opens the block popover (via `onBlockClick`),
 *      instead of splitting into unreadable slivers.
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
import { applyGroupSelection } from "../../lib/planner/groups.js";
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
  /** Identical parallel slots this block stands for. 1 = a single session. */
  groupCount: number;
  /** Per-render ordinal. Part of the DOM id, because (code, day, start) is not unique. */
  ordinal: number;
}

/**
 * What a clicked block (or "+N til" chip) hands its listener — the material
 * for the block popover (§5). A chip's `code` is the hidden entries' codes
 * joined with " · "; a single block's is one course code.
 */
export interface BlockDetail {
  /** Course code, or joined codes for a "+N til" chip. */
  code: string;
  /** Course name (the proper name), or joined names for a chip. */
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
   * Called when a block or a "+N til" chip is clicked, with the block's
   * detail and the clicked element (the popover's anchor). Optional: the
   * one-course `/emne/` reuse passes none, so its blocks are inert.
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
  /** A grid was drawn while bundles were still loading: the counts may still grow. */
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
    for (const raw of selected) {
      const weeksNumbers = parseWeeks(raw.weeks);
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
        groupCount: 1,
        ordinal: entries.length,
      });
    }
  }
  return entries;
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
function joinCodes(codes: string[]): string {
  if (codes.length <= 1) return codes[0] ?? "";
  return `${codes.slice(0, -1).join(", ")} og ${codes[codes.length - 1]}`;
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

// --- Clustering -----------------------------------------------------------

/**
 * Partitions a day's entries into overlap clusters — a maximal run where each
 * entry starts before the running end of the cluster so far (a touching
 * `start === prevEnd` boundary is NOT an overlap and starts a new cluster,
 * matching conflicts.ts / layout.ts). The sort mirrors `layoutDay`'s, so the
 * clusters here line up one-to-one with the columns `layoutDay` assigns — the
 * renderer needs the cluster only to place one "+N til" chip over the pile's
 * overflow, since column packing itself lives in `layoutDay` now.
 */
function dayClusters(dayEntries: GridEntry[]): GridEntry[][] {
  const sorted = [...dayEntries].sort(
    (a, b) =>
      timeToMinutes(a.startTime) - timeToMinutes(b.startTime) ||
      timeToMinutes(a.endTime) - timeToMinutes(b.endTime) ||
      blockId(a).localeCompare(blockId(b)),
  );

  const clusters: GridEntry[][] = [];
  let current: GridEntry[] = [];
  let maxEnd = Number.NEGATIVE_INFINITY;

  for (const entry of sorted) {
    const start = timeToMinutes(entry.startTime);
    if (current.length > 0 && start >= maxEnd) {
      clusters.push(current);
      current = [];
      maxEnd = Number.NEGATIVE_INFINITY;
    }
    current.push(entry);
    maxEnd = Math.max(maxEnd, timeToMinutes(entry.endTime));
  }
  if (current.length > 0) clusters.push(current);

  return clusters;
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

/** The block's second line: `room · start` (just the start when there is no room). */
function metaLine(entry: GridEntry): string {
  return [entry.rooms, entry.startTime].filter(Boolean).join(" · ");
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

/**
 * The "+N til" chip for a cluster's overflow (the entries `layoutDay` marked
 * `overflow`, i.e. beyond `MAX_COLUMNS`). One chip per cluster, pinned to the
 * pile's inline-end at the hidden window's top so it never paints over a
 * visible block's code. Clicking hands the hidden entries to `onBlockClick`.
 */
function buildOverflowChip(
  hidden: GridEntry[],
  minMinutes: number,
  onBlockClick?: GridRenderOptions["onBlockClick"],
): HTMLButtonElement {
  const start = Math.min(...hidden.map((e) => timeToMinutes(e.startTime)));
  const chip = el("button", "planner-block-overflow np-data", `+${hidden.length} til`);
  chip.type = "button";
  const startRow = Math.round((start - minMinutes) / ROW_MINUTES) + 1;
  chip.style.setProperty("--planner-row-start", String(startRow));

  const detail = overflowDetail(hidden);
  chip.title = `${detail.code} · ${detail.timeLabel}`;
  chip.setAttribute("aria-label", `${hidden.length} flere aktiviteter: ${detail.code}`);
  if (onBlockClick) chip.addEventListener("click", () => onBlockClick(detail, chip));
  return chip;
}

/** Synthetic popover material for a "+N til" chip: the hidden entries, codes joined " · ". */
function overflowDetail(hidden: GridEntry[]): BlockDetail {
  const first = hidden[0];
  const codes = [...new Set(hidden.map((e) => e.courseCode))].join(" · ");
  const names = [...new Set(hidden.map((e) => e.courseName))].join(" · ");
  const start = Math.min(...hidden.map((e) => timeToMinutes(e.startTime)));
  const end = Math.max(...hidden.map((e) => timeToMinutes(e.endTime)));
  const rooms = [...new Set(hidden.flatMap((e) => e.rooms.split(", ")))].filter(Boolean).join(", ");
  const weeks = [...new Set(hidden.flatMap((e) => e.weeksNumbers))].sort((a, b) => a - b);
  return {
    code: codes,
    name: names,
    entryName: null,
    timeLabel: `${dayName(first?.dayNumber ?? 1)} ${minutesToTime(start)}–${minutesToTime(end)}`,
    rooms,
    weeksLabel: weekLabel(weeks),
    isLecture: hidden.some((e) => e.isLecture),
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

  return `${day} ${time} · ${joinCodes(group.codes)} kolliderer${weeks ? ` · ${weeks}` : ""}`;
}

// --- Render ---------------------------------------------------------------

/**
 * Renders the weekly spread + its margin conflict notes into `frame` /
 * `notesHost`. `showOthers` (the page's "Vis øvinger og labber" toggle)
 * decides whether non-lecture entries are drawn at all — when off, only
 * lectures render, matching DR-1's lecture-based-by-default rule, *unless*
 * the plan has no lecture-classified entry at all, in which case the muted
 * layer is revealed anyway rather than showing a blank week (B7a). Hour
 * clamping follows the SHOWN entries so the default view stays compact.
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

  const empty = (state: GridRenderResult["state"], message?: string): GridRenderResult => {
    renderGridMessage(frame, notesHost, message);
    return {
      conflictCount: 0,
      conflictPairCount: 0,
      mutedLayerAutoRevealed: false,
      blockCount: 0,
      state,
      partial: loading,
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
      partial: true,
    };
  }
  if (rawEntries.length === 0) {
    return pending
      ? empty("pending-choice", pending)
      : empty("empty", "Ingen timeplandata for emnene i planen ennå.");
  }

  // B7a: 47 programmes have timetable entries and not one that classifies as
  // a lecture. DR-1 accepts under-classification *because* the toggle layer
  // still shows the entry — so when that layer is the only thing there is,
  // show it and say why, rather than shipping a blank week.
  const lectureEntries = rawEntries.filter((e) => e.isLecture);
  const mutedLayerAutoRevealed = !showOthers && lectureEntries.length === 0;
  const shown = showOthers || mutedLayerAutoRevealed ? rawEntries : lectureEntries;
  const entries = mergeSlots(shown);

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

  // Every rendered entry resolves to the element that represents it — an
  // overflow entry stands behind the "+N til" chip. Conflict notes flash
  // through this map rather than through getElementById (C5b).
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

    // Everything else is column-packed by layoutDay: overlapping sessions get
    // distinct side-by-side columns (overlap is supported, both stay readable),
    // and a pile deeper than MAX_COLUMNS keeps its first columns and folds the
    // rest into one "+N til" chip rather than splitting into slivers.
    const packable = dayEntries.filter((e) => !isBandEntry(e));
    const layoutInput: LayoutInput[] = packable.map((e) => ({
      id: blockId(e),
      start: timeToMinutes(e.startTime),
      end: timeToMinutes(e.endTime),
    }));
    const slotById = new Map(layoutDay(layoutInput).map((slot) => [slot.id, slot]));

    for (const cluster of dayClusters(packable)) {
      const hidden: GridEntry[] = [];
      for (const entry of cluster) {
        const slot = slotById.get(blockId(entry));
        if (!slot) continue;
        if (slot.overflow) {
          hidden.push(entry);
          continue;
        }
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
      // One chip stands in for the overflow; every entry it hides resolves to
      // it (C5b) so a conflict note can still flash the pile it belongs to.
      if (hidden.length > 0) {
        const chip = buildOverflowChip(hidden, minMinutes, options.onBlockClick);
        for (const entry of hidden) nodeByEntry.set(entry, chip);
        column.append(chip);
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

  return {
    conflictCount: conflictGroups.length,
    conflictPairCount: conflicts.length,
    mutedLayerAutoRevealed,
    blockCount,
    state: "grid",
    partial: loading,
  };
}
