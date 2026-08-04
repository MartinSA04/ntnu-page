/**
 * KOLONNER — the week as a timetable: days across, time down. The third view of
 * one plan, beside `grid.ts` and `board.ts`, from the same states through the
 * same narrowing, engine and popover.
 *
 * ## The law: the day grows, the code never shrinks, whole days only
 *
 *   `dager = maks(1, min(ukedager, gulv(plass / dagminimum)))`
 *   `dagbredde = maks(dagminimum, plass / dager)`
 *
 * Expressed in **CSS**, not in a measuring pass here (see THE WIDTH LAW in
 * planner-week.css) — hence no resize listener and no `getBoundingClientRect`.
 * Flooring the count keeps the week honest at the edges: a narrower window
 * drops a whole day and widens the rest.
 *
 * This module writes only what CSS cannot know: the deepest cluster
 * (`--planner-lanes-max`), how many drop-in strips to reserve
 * (`--planner-allday-h`), and each session's place on the time axis.
 *
 * ## Kept from the transposed week, deliberately
 *
 *  - **Lanes are per CLUSTER, not per day** — dividing by the day's worst
 *    moment makes unrelated sessions half-width for nothing.
 *  - **A drop-in window is not a session you attend at a time** (`isDropIn`):
 *    it gets a strip along the column's edge that lanes never overlap.
 *  - **Red-Is-Collision, crossing the lanes.** One zone per conflict group, not
 *    one per day.
 *  - **The code may never be cut.** Room and activity are added only when the
 *    block is tall enough, by duration.
 *
 * The layer change is choreographed through `beginColumnChange`
 * (layerMotion.ts). Add a property the column's box is sized from and you must
 * add it to `COL_GRID_PROPS`, or that dimension snaps while the rest travels.
 */
import { findConflicts, groupConflicts, mergeParallelSlots } from "../../lib/planner/conflicts.js";
import type { LayoutInput } from "../../lib/planner/layout.js";
import { layoutDay } from "../../lib/planner/layout.js";
import { collectSessions, motionKey, type SessionEntry } from "./board.js";
import { dayName, el } from "./dom.js";
import { type BlockDetail, blockDetailFor, isDropIn, visibleLayer } from "./grid.js";
import { staggerStep } from "./layerMotion.js";
import type { PlanCourseState } from "./types.js";

/** Whole hours the axis falls back to when there is nothing to clamp it to. */
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 16;

/**
 * Duration below which a block sets its two lines a step smaller. Height is
 * duration here, so this is the vertical twin of the transposed bar's width
 * rule — but nothing is DROPPED at this threshold any more: the code and the
 * room are both facts the grid's geometry cannot state, so the type gives way
 * instead of the content.
 */
const ROOM_MINUTES = 45;

export interface ColumnRenderOptions {
  /** Same contract as the grid's and the board's: a click opens the session. */
  onBlockClick?: (detail: BlockDetail, anchor: HTMLElement) => void;
  /** Weekday (1 = mandag) to set at full ink; `null` marks none. */
  todayNumber?: number | null;
  /** Strike the blocks in on this render — set by a view switch only. */
  animate?: boolean;
  /**
   * Day-of-month per weekday (1 = mandag) for the week the page is open in.
   * Passed rather than derived: the caller owns "what day is it", and a second
   * reading of the clock here is a second chance to disagree with the column
   * that drew today's wash.
   */
  dates?: Map<number, number>;
  /** Every parallel and every group — see `CollectOptions` in board.ts. */
  showAllGroups?: boolean;
}

export interface ColumnRenderResult {
  /** Blocks drawn. 0 means the caller shows its own message instead. */
  blockCount: number;
}

/** A session in its column: which of its cluster's lanes, and how many there are. */
export interface ColumnSlot {
  entry: SessionEntry;
  /** 0-based lane inside the cluster. */
  lane: number;
  /** Lanes the cluster splits into — the divisor for this block's width. */
  lanes: number;
}

export interface ColumnDay {
  dayNumber: number;
  /** Lane-packed sessions. */
  slots: ColumnSlot[];
  /** Drop-in windows, which take strips rather than lanes. */
  bands: SessionEntry[];
}

export interface WeekGeometry {
  /** Drawn range, clamped to whole hours. */
  minMinutes: number;
  maxMinutes: number;
  span: number;
  hours: number;
  dayCount: number;
  days: ColumnDay[];
  /** The week's deepest cluster — what a column has to be wide enough for. */
  lanesMax: number;
  /** The most drop-in strips any one day carries. */
  bandsMax: number;
}

const minutesOf = (time: string): number => {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
};

const durationOf = (entry: SessionEntry): number =>
  Math.max(0, minutesOf(entry.endTime) - minutesOf(entry.startTime));

/**
 * The week's shape before any element exists: the drawn hours, each day's lanes
 * and strips, and the two maxima the column width is computed from. Pure and
 * exported so the decision this view rests on is testable without a DOM.
 */
export function columnGeometry(entries: SessionEntry[]): WeekGeometry {
  let minMinutes = Number.POSITIVE_INFINITY;
  let maxMinutes = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    minMinutes = Math.min(minMinutes, minutesOf(entry.startTime));
    maxMinutes = Math.max(maxMinutes, minutesOf(entry.endTime));
  }
  if (!Number.isFinite(minMinutes) || !Number.isFinite(maxMinutes)) {
    minMinutes = DEFAULT_START_HOUR * 60;
    maxMinutes = DEFAULT_END_HOUR * 60;
  }
  // Whole hours, so `--planner-hours` is an integer and the hour ruling tiles
  // the column exactly — the same clamp the transposed grid makes.
  minMinutes = Math.floor(minMinutes / 60) * 60;
  maxMinutes = Math.ceil(maxMinutes / 60) * 60;
  const span = Math.max(60, maxMinutes - minMinutes);

  const dayCount = entries.some((e) => e.dayNumber === 6) ? 6 : 5;
  const days: ColumnDay[] = [];
  let lanesMax = 1;
  let bandsMax = 0;

  for (let day = 1; day <= dayCount; day++) {
    const items = entries.filter((e) => e.dayNumber === day);
    const bands = items.filter((e) => isDropIn(e));
    const packable = items.filter((e) => !isDropIn(e));
    const input: LayoutInput[] = packable.map((entry, index) => ({
      id: String(index),
      start: minutesOf(entry.startTime),
      end: minutesOf(entry.endTime),
    }));
    // Uncapped: no pile in this view either. The pile existed because a 150 px
    // column could not be divided — a column that GROWS never has that problem.
    const packed = new Map(
      layoutDay(input, Number.POSITIVE_INFINITY).map((slot) => [slot.id, slot]),
    );
    const slots: ColumnSlot[] = packable.map((entry, index) => {
      const slot = packed.get(String(index));
      return { entry, lane: slot?.col ?? 0, lanes: Math.max(1, slot?.cols ?? 1) };
    });
    for (const slot of slots) lanesMax = Math.max(lanesMax, slot.lanes);
    bandsMax = Math.max(bandsMax, bands.length);
    days.push({ dayNumber: day, slots, bands });
  }

  return {
    minMinutes,
    maxMinutes,
    span,
    hours: Math.round(span / 60),
    dayCount,
    days,
    lanesMax,
    bandsMax,
  };
}

/**
 * The same parallel-slot merge the transposed grid makes: one session published
 * in two rooms is one block with both rooms, not two blocks that make the day
 * look twice as deep. In a view whose subject is column width, that doubling
 * would be the expensive kind of wrong.
 */
function mergeSessions(entries: SessionEntry[]): SessionEntry[] {
  return mergeParallelSlots(entries, (e) => `${e.isLecture ? "L" : "O"}|${e.label}`).map(
    ({ representative, entries: members }) => {
      if (members.length === 1) return representative;
      const join = (values: string[]): string =>
        [...new Set(values.flatMap((v) => v.split(", ")))].filter(Boolean).join(", ");
      return {
        ...representative,
        rooms: join(members.map((m) => m.rooms)),
        buildings: join(members.map((m) => m.buildings)),
      };
    },
  );
}

/** One collision, as both the zone and the popover need it. */
interface ClashGroup {
  dayNumber: number;
  start: number;
  end: number;
  codes: string[];
}

/**
 * Marks every entry that collides and returns the incidents. Lecture × lecture
 * only (DR-1), through the same engine both other views use;
 * `mergeParallelSlots` first, or a course publishing eleven identical groups
 * reports ten collisions with itself.
 */
function markClashes(entries: SessionEntry[]): ClashGroup[] {
  const lectures = mergeParallelSlots(entries.filter((e) => e.isLecture)).map(
    (group) => group.representative,
  );
  const groups = groupConflicts(findConflicts(lectures));
  for (const group of groups) {
    for (const entry of entries) {
      if (
        !entry.isLecture ||
        entry.dayNumber !== group.dayNumber ||
        minutesOf(entry.startTime) >= group.end ||
        minutesOf(entry.endTime) <= group.start
      ) {
        continue;
      }
      // Widened across every group a session falls in, exactly as the other
      // two views do it, because one session can sit in two incidents.
      const partners = group.codes.filter((code) => code !== entry.courseCode);
      const prev = entry.clash;
      entry.clash = prev
        ? {
            partners: [...new Set([...prev.partners, ...partners])],
            window: {
              start: Math.min(prev.window.start, group.start),
              end: Math.max(prev.window.end, group.end),
            },
          }
        : { partners, window: { start: group.start, end: group.end } };
    }
  }
  return groups.map((g) => ({
    dayNumber: g.dayNumber,
    start: g.start,
    end: g.end,
    codes: g.codes,
  }));
}

/** Where a minute sits on the axis, as a percentage of the drawn span. */
const percent = (minutes: number, min: number, span: number): string =>
  `${((minutes - min) / span) * 100}%`;

/**
 * The half every drawn session shares: its hue, its hover text, what a screen
 * reader hears, its place on the time axis, and the click that opens it.
 *
 * A drop-in window goes through this too. As a bare `<div>` with a colour it
 * was a sliver that named nothing and could not be opened — a mark a student
 * can only read as damage. A session you can attend is one you can ask about.
 */
function sessionButton(
  entry: SessionEntry,
  className: string,
  geo: WeekGeometry,
  onBlockClick?: ColumnRenderOptions["onBlockClick"],
): HTMLButtonElement {
  const node = el("button", className);
  node.type = "button";
  if (!entry.isLecture) node.classList.add("is-muted");
  if (entry.clash) node.classList.add("is-clash");
  node.style.setProperty("--dot", `var(${entry.hueVar})`);
  node.style.setProperty(
    "--planner-y",
    percent(minutesOf(entry.startTime), geo.minMinutes, geo.span),
  );
  node.style.setProperty("--planner-h", `${(durationOf(entry) / geo.span) * 100}%`);

  const timeRange = `${entry.startTime}–${entry.endTime}`;
  node.title = [entry.courseCode, entry.label, timeRange, entry.rooms, entry.weeksLabel]
    .filter(Boolean)
    .join(", ");
  node.setAttribute(
    "aria-label",
    [
      `${entry.courseCode}${entry.label ? ` ${entry.label}` : ""}`,
      `${dayName(entry.dayNumber)} ${timeRange}`,
      entry.rooms,
      entry.clash && entry.clash.partners.length > 0
        ? `kolliderer med ${entry.clash.partners.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join(", "),
  );

  if (onBlockClick) {
    node.addEventListener("click", () =>
      onBlockClick(
        blockDetailFor(
          { ...entry, name: entry.label, weeksNumbers: [], groupCount: 1, ordinal: 0 },
          entry.clash,
        ),
        node,
      ),
    );
  }
  return node;
}

function buildBlock(
  slot: ColumnSlot,
  geo: WeekGeometry,
  strike: number,
  onBlockClick?: ColumnRenderOptions["onBlockClick"],
): HTMLButtonElement {
  const { entry } = slot;
  const block = sessionButton(entry, "planner-cols-block", geo, onBlockClick);
  block.style.setProperty("--planner-lane", String(slot.lane));
  block.style.setProperty("--planner-lanes", String(slot.lanes));
  block.style.setProperty("--planner-strike", String(strike));

  block.append(el("span", "planner-cols-code np-data", entry.courseCode));
  // THE COURSE AND THE ROOM, AND NOTHING ELSE. The clock is already drawn —
  // it IS the block's place in the grid — and the activity is one tap away in
  // the session card. The room is the only fact here that position cannot
  // state, so it never drops out however narrow the lane gets: the type
  // shrinks instead (`.is-tight` below).
  if (entry.rooms) block.append(el("span", "planner-cols-room np-data", entry.rooms));
  // A block shorter than a lecture cannot hold two lines at full size.
  if (durationOf(entry) < ROOM_MINUTES) block.classList.add("is-tight");
  return block;
}

/**
 * A drop-in window: the same session, standing up.
 *
 * The strip is narrow because it must not take a lane from sessions that have a
 * time — but narrow is not anonymous. The type turns 90° and reads down it. A
 * window is at least five hours by definition, so the one axis this label is
 * never short of is the one it runs along.
 */
function buildBand(
  entry: SessionEntry,
  index: number,
  geo: WeekGeometry,
  strike: number,
  onBlockClick?: ColumnRenderOptions["onBlockClick"],
): HTMLButtonElement {
  const band = sessionButton(entry, "planner-cols-band", geo, onBlockClick);
  band.style.setProperty("--planner-strike", String(strike));
  // Two windows on one day stack in flow now rather than side by side in a
  // reserved margin; the index survives only so a key can tell them apart.
  band.setAttribute("data-band", String(index));
  band.append(el("span", "planner-cols-code np-data", entry.courseCode));
  // Room first, then the hours: this is the one session whose time the grid
  // does NOT draw, so the chip has to say it — and where you have to walk is
  // still the fact you opened the row for, so it is what survives the ellipsis.
  const what = [entry.rooms, `${entry.startTime}–${entry.endTime}`].filter(Boolean).join(", ");
  band.append(el("span", "planner-cols-sub", what));
  return band;
}

/**
 * Draws the week into `frame`. Returns how many blocks it drew so the caller
 * can fall back to its own message branch at zero, as it does for both other
 * views.
 */
export function renderColumnGrid(
  frame: HTMLElement,
  courses: PlanCourseState[],
  teachingWeeks: number[],
  showOthers: boolean,
  options: ColumnRenderOptions = {},
): ColumnRenderResult {
  const entries = mergeSessions(
    visibleLayer(
      collectSessions(courses, teachingWeeks, { showAllGroups: options.showAllGroups ?? false }),
      showOthers,
    ).shown,
  );
  frame.replaceChildren();
  if (entries.length === 0) return { blockCount: 0 };

  const clashes = markClashes(entries);
  const geo = columnGeometry(entries);

  const grid = el("div", "planner-cols");
  if (options.animate) grid.classList.add("is-striking");
  // An attribute, not a custom property: the column template is written out per
  // day count in the stylesheet, so a Saturday is a second template.
  grid.setAttribute("data-days", String(geo.dayCount));
  grid.style.setProperty("--planner-hours", String(geo.hours));
  grid.style.setProperty("--planner-lanes-max", String(geo.lanesMax));
  // Read back by the now marker, which turns a clock into a percentage and
  // cannot re-derive the clamp this render chose.
  grid.setAttribute("data-min", String(geo.minMinutes));
  grid.setAttribute("data-span", String(geo.span));
  // role="group", not "img": the columns hold focusable blocks, each with its
  // own label, and "img" would strip them from the accessibility tree.
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Ukeplan med timeplanblokker for emnene i planen");

  // The corner above the hour rail. It carries nothing — but it has to exist,
  // or the headers land one track to the left of their own columns.
  grid.append(el("div", "planner-cols-corner"));

  for (const day of geo.days) {
    // Three letters, uppercase, and the full word still in the accessibility
    // tree — the same trade the transposed grid's spine makes, for the same
    // reason: "man" cannot be expanded by a screen reader, and a column this
    // narrow cannot hold "mandag" at any size worth reading. Every calendar
    // sets its weekday row this way; it is the one place micro-type earns it.
    const header = el("div", "planner-cols-day-header");
    header.append(el("span", "planner-cols-dow-long", dayName(day.dayNumber)));
    const short = el("span", "planner-cols-dow", dayName(day.dayNumber).slice(0, 3));
    short.setAttribute("aria-hidden", "true");
    header.append(short);
    // WHICH Monday this column is. The week the grid draws is a pattern — a
    // block stands for every week in its own range — but the page is open in
    // exactly one of them, and every calendar a student already uses says which.
    // The date is not a claim that everything under it happens this week; the
    // margin notes and the provenance line are what name the weeks a course
    // skips.
    const date = options.dates?.get(day.dayNumber);
    if (date !== undefined) header.append(el("span", "planner-cols-dom np-data", String(date)));
    header.setAttribute("data-day", String(day.dayNumber));
    if (day.dayNumber === options.todayNumber) header.setAttribute("data-today", "");
    grid.append(header);
  }

  // THE ALL-DAY ROW. A drop-in window is not an appointment at a time — it is
  // 08:15–14:00 every weekday — so it does not belong on the time axis at all,
  // and a six-hour block put in the lanes drags the whole day into one cluster
  // and squeezes every real session to a quarter of its width. It used to be a
  // rotated strip down the column's edge, which kept it out of the lane
  // accounting but spent horizontal width the days need and set its own label
  // sideways. This is the row every calendar reserves for exactly this.
  let strike = 0;
  let blockCount = 0;
  // Occurrence counter behind `motionKey` — a session's identity has to outlive
  // the re-render for the layer change to know what merely moved.
  const keySeen = new Map<string, number>();

  // ALWAYS drawn, even with nothing in it: its height is a custom property the
  // layer change can travel (`--planner-allday-h`), and a row that is absent in
  // one state and present in the next cannot animate at all — the whole grid
  // under it would jump 34px on the frame the øvinger arrive.
  grid.style.setProperty("--planner-allday-h", geo.bandsMax === 0 ? "0px" : "34px");
  grid.append(el("div", "planner-cols-allday-corner"));
  for (const day of geo.days) {
    const cell = el("div", "planner-cols-allday");
    cell.setAttribute("data-day", String(day.dayNumber));
    if (day.dayNumber === options.todayNumber) cell.setAttribute("data-today", "");
    day.bands.forEach((entry, index) => {
      const band = buildBand(entry, index, geo, strike++, options.onBlockClick);
      band.setAttribute("data-motion-key", motionKey(entry, keySeen));
      cell.append(band);
      blockCount++;
    });
    grid.append(cell);
  }

  const rail = el("div", "planner-cols-rail");
  rail.setAttribute("aria-hidden", "true");
  for (let hour = Math.ceil(geo.minMinutes / 60); hour <= Math.floor(geo.maxMinutes / 60); hour++) {
    // "08:00", not "08". The rail is the axis a student reads a time OFF, and a
    // bare two-digit column is a set of numbers you have to be told are hours.
    const label = el("span", "planner-cols-hour np-data", `${String(hour).padStart(2, "0")}:00`);
    // The hour is the figure's identity across a re-render: when the øving
    // layer stretches the axis, 10:00 must TRAVEL to its new percentage rather
    // than be replaced by a different element that happens to say "10".
    label.setAttribute("data-hour", String(hour));
    label.style.setProperty("--planner-y", percent(hour * 60, geo.minMinutes, geo.span));
    rail.append(label);
  }
  grid.append(rail);

  // `strike` runs on from the all-day row, so the week prints in reading order
  // — the windows first, because they are the field the day's appointments are
  // printed on, then the days themselves.
  for (const day of geo.days) {
    const column = el("div", "planner-cols-day");
    column.setAttribute("data-day", String(day.dayNumber));
    if (day.dayNumber === options.todayNumber) column.setAttribute("data-today", "");

    // The lanes still live in their own box: it is what a block's percentage is
    // a percentage OF, and the clash marks have to share its coordinates.
    const lanes = el("div", "planner-cols-lanes");
    clashes
      .filter((c) => c.dayNumber === day.dayNumber)
      .forEach((zone, index) => {
        const mark = el("div", "planner-cols-clash");
        mark.setAttribute("aria-hidden", "true");
        mark.setAttribute("data-motion-key", `clash-${day.dayNumber}-${index}`);
        mark.style.setProperty("--planner-y", percent(zone.start, geo.minMinutes, geo.span));
        mark.style.setProperty("--planner-h", `${((zone.end - zone.start) / geo.span) * 100}%`);
        lanes.append(mark);
      });
    for (const slot of [...day.slots].sort(
      (a, b) => minutesOf(a.entry.startTime) - minutesOf(b.entry.startTime) || a.lane - b.lane,
    )) {
      const block = buildBlock(slot, geo, strike++, options.onBlockClick);
      block.setAttribute("data-motion-key", motionKey(slot.entry, keySeen));
      lanes.append(block);
      blockCount++;
    }
    column.append(lanes);

    if (day.dayNumber === options.todayNumber) {
      const now = el("div", "planner-cols-now");
      now.hidden = true;
      now.setAttribute("aria-hidden", "true");
      column.append(now);
    }

    grid.append(column);
  }

  // The rhythm this week prints at — see `staggerStep`. Written after the
  // build, because it is a function of how much there turned out to be.
  grid.style.setProperty("--planner-step", `${staggerStep(strike, 45)}ms`);
  frame.append(grid);
  syncColumnNow(frame);
  return { blockCount };
}

/**
 * Places the needle in today's column, or hides it.
 *
 * Exported because it must re-run on a timer. Silently does nothing when this
 * view is not on screen, so the caller may simply call both.
 */
export function syncColumnNow(frame: HTMLElement, at: Date = new Date()): void {
  const grid = frame.querySelector<HTMLElement>(".planner-cols");
  const marker = frame.querySelector<HTMLElement>(".planner-cols-now");
  if (!grid || !marker) return;
  const min = Number(grid.getAttribute("data-min"));
  const span = Number(grid.getAttribute("data-span"));
  const minutes = at.getHours() * 60 + at.getMinutes();
  if (!Number.isFinite(min) || !Number.isFinite(span) || minutes < min || minutes > min + span) {
    marker.hidden = true;
    return;
  }
  marker.hidden = false;
  marker.style.setProperty("--planner-y", `${((minutes - min) / span) * 100}%`);
}
