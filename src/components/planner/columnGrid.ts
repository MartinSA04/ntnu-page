/**
 * KOLONNER — the week as a timetable: days across, time down (REWORK-2026-07-30h).
 *
 * The third view of one plan, beside the transposed week (`grid.ts`, days as
 * rows) and Tavla (`board.ts`, no geometry at all). It is the shape every
 * student already owns — school, NTNU's own timeplan, every calendar app — and
 * it exists because that familiarity is worth something the arithmetic cannot
 * price. It is a *view*: same `PlanCourseState[]`, same group narrowing
 * (`collectSessions`), same conflict engine, same popover.
 *
 * ## The law: the day grows, the code never shrinks, and the week is dealt out
 * in whole days
 *
 * Transposing solved the width problem by giving the day the whole page. Here
 * a day is a column again, so the pressure comes back — two overlapping
 * lectures split the column, and at five equal columns each half is narrower
 * than the seven characters that identify the course. The rule this view is
 * built on is the opposite of squeezing:
 *
 *   `dager = maks(1, min(ukedager, gulv(plass / dagminimum)))`
 *   `dagbredde = maks(dagminimum, plass / dager)`
 *
 * — and it is expressed in **CSS**, not in a measuring pass here (see THE WIDTH
 * LAW in `src/styles/planner-week.css` for the declarations). `dagminimum` is
 * the deepest cluster's lanes at the width a course code needs; `plass` is the
 * scrollport minus the hour rail. Flooring the count is what keeps the week
 * honest at the edges: the days always divide the visible width exactly, so
 * either the whole week is on screen or the days that are on screen are WHOLE
 * and the rest are wholly off-frame — a strip of Friday hanging past the frame
 * is an overflow someone forgot, and reads like one. A slightly narrower window
 * therefore drops a whole day and makes the remaining ones wider.
 *
 * That is still arithmetic the browser does before paint, which is why there is
 * no resize listener and no `getBoundingClientRect` in this module — the law
 * holds at every width.
 *
 * What this module writes is only what CSS cannot know: how deep the week's
 * deepest cluster is (`--planner-lanes-max`), how many drop-in strips to
 * reserve room for (`--planner-bands-max`), and where each session sits on the
 * time axis (percentages of the drawn span, exactly as the transposed grid
 * does it, so a block and an hour line can never disagree).
 *
 * ## What it keeps from the transposed week, deliberately
 *
 *  - **Lanes are per CLUSTER, not per day.** A block in a 2-deep overlap takes
 *    half the column; a lone 16:00 øving in the same day still takes all of
 *    it. Dividing the whole column by the day's worst moment is how a Tuesday
 *    with one clash makes four unrelated sessions half-width for nothing.
 *  - **A drop-in window is not a session you attend at a time** (`isDropIn`,
 *    the grid's own rule): an 08:15–20:00 øvingsvindu drawn as a block would
 *    be a slab down the whole column with a lecture buried in it. It gets a
 *    strip along the column's edge, and the lanes never overlap it because the
 *    column reserves that width for every day.
 *  - **Red-Is-Collision, and it crosses the lanes.** One zone per conflict
 *    group — not one per day: two unrelated overlaps on a Thursday are two
 *    incidents, and a single merged zone would claim the hours between them.
 *  - **The code is the half that may never be cut.** Room and activity are
 *    added only when the block is tall enough to carry them, by duration, the
 *    same way the transposed bar decides (`COMPACT_BLOCK_MINUTES` there).
 *
 * ## The layer change
 *
 * "Vis øvinger og labber" is choreographed here as in the other two views —
 * `beginColumnChange` in `layerMotion.ts`, through the same snapshot/rewind/
 * release wrapper. What this module owes it is identity and geometry in
 * properties: every session carries `data-motion-key` (`board.ts`'s, shared, so
 * the two views cannot disagree about what "the same session" is), every hour
 * figure carries `data-hour`, and every position is a custom property the
 * stylesheet turns into a real length. Add a property the column's box is sized
 * from and you must add it to `COL_GRID_PROPS` too, or that dimension snaps
 * while everything around it travels.
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
 * Duration a block needs before it carries more than its code.
 *
 * Height is duration here, so these are the vertical twin of the transposed
 * bar's width rule: at `--planner-hour-h` (4.5rem) a 45-minute session is
 * ~54 px and holds the code and the room; 90 minutes holds the activity too.
 * Below 45 minutes only the code is drawn, and the code is never dropped.
 */
const ROOM_MINUTES = 45;
const LABEL_MINUTES = 90;

export interface ColumnRenderOptions {
  /** Same contract as the grid's and the board's: a click opens the session. */
  onBlockClick?: (detail: BlockDetail, anchor: HTMLElement) => void;
  /** Weekday (1 = mandag) to set at full ink; `null` marks none. */
  todayNumber?: number | null;
  /** Strike the blocks in on this render — set by a view switch only. */
  animate?: boolean;
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
 * The week's shape, before any element exists: the drawn hours, each day's
 * lanes and strips, and the two maxima the column width is computed from.
 *
 * Pure and exported so the decision this view rests on is testable without a
 * DOM — the assembly around it is covered by `e2e/flows.pw.ts`.
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
    // Uncapped: there is no pile in this view either. The pile existed because
    // a 150 px column could not be divided — a column that GROWS never has
    // that problem, which is the whole point of the width law above.
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
 * The same parallel-slot merge the transposed grid makes before drawing: one
 * session published in two rooms is one block with both rooms, not two blocks
 * that make the day look twice as deep as it is. In a view whose whole subject
 * is column width, that doubling would be the expensive kind of wrong.
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
 * Marks every entry that collides and returns the incidents themselves.
 *
 * Lecture × lecture only (DR-1), through the same engine both other views use;
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
 * The half every drawn session shares: its hue, what it says on hover, what a
 * screen reader hears, its place on the time axis, and the click that opens it.
 *
 * A drop-in window goes through this too. It used to be a bare `<div>` with a
 * colour and nothing else — five 8 px slivers down the week that named nothing,
 * answered nothing and could not be opened, which is a mark a student can only
 * read as damage. A session you can attend is a session you can ask about,
 * whether it takes a lane or a strip.
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
    .join(" · ");
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
  const duration = durationOf(entry);
  // The room before the activity, the same order the transposed bar settled
  // on: where you have to walk survives, the label is what gets cut.
  if (duration >= ROOM_MINUTES && entry.rooms) {
    block.append(el("span", "planner-cols-sub", entry.rooms));
  }
  if (duration >= LABEL_MINUTES && entry.label) {
    block.append(el("span", "planner-cols-sub", entry.label));
  }
  return block;
}

/**
 * A drop-in window: the same session, standing up.
 *
 * The strip is narrow because it must not take a lane from the sessions that
 * have a time — but narrow is not the same as anonymous. The type turns 90°
 * with the strip (`writing-mode: vertical-rl`, planner-week.css) and reads down
 * it: the code, then what it is. A window is at least five hours by definition,
 * so at `--planner-hour-h` there is always more than enough length for both —
 * the one axis this label is never short of is the one it now runs along.
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
  // Its own place in the reserved strip margin, counted from the column's edge,
  // so a day with three open windows draws three strips instead of one on top
  // of another.
  band.style.setProperty("--planner-band", String(index));
  band.append(el("span", "planner-cols-code np-data", entry.courseCode));
  // Room before activity, the same order the bars use: where you have to walk
  // to find the veiledning is the fact you are reading the strip for, and a
  // window is long enough that neither has to give way to the other.
  const what = [entry.rooms, entry.label].filter(Boolean).join(" · ");
  if (what) band.append(el("span", "planner-cols-sub", what));
  return band;
}

/**
 * Draws the week into `frame`. Returns how many blocks it drew so the caller
 * can fall back to its own message branch at zero, exactly as it does for the
 * other two views.
 */
export function renderColumnGrid(
  frame: HTMLElement,
  courses: PlanCourseState[],
  teachingWeeks: number[],
  showOthers: boolean,
  options: ColumnRenderOptions = {},
): ColumnRenderResult {
  const entries = mergeSessions(
    visibleLayer(collectSessions(courses, teachingWeeks), showOthers).shown,
  );
  frame.replaceChildren();
  if (entries.length === 0) return { blockCount: 0 };

  const clashes = markClashes(entries);
  const geo = columnGeometry(entries);

  const grid = el("div", "planner-cols");
  if (options.animate) grid.classList.add("is-striking");
  // An attribute, not a custom property: the column template is written out
  // per day count in the stylesheet (see planner-week.css), so a Saturday is a
  // second template rather than a `repeat()` counting a `var()`.
  grid.setAttribute("data-days", String(geo.dayCount));
  grid.style.setProperty("--planner-hours", String(geo.hours));
  grid.style.setProperty("--planner-lanes-max", String(geo.lanesMax));
  grid.style.setProperty("--planner-bands-max", String(geo.bandsMax));
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
    const header = el("div", "planner-cols-day-header", dayName(day.dayNumber));
    header.setAttribute("data-day", String(day.dayNumber));
    if (day.dayNumber === options.todayNumber) header.setAttribute("data-today", "");
    grid.append(header);
  }

  const rail = el("div", "planner-cols-rail");
  rail.setAttribute("aria-hidden", "true");
  for (let hour = Math.ceil(geo.minMinutes / 60); hour <= Math.floor(geo.maxMinutes / 60); hour++) {
    const label = el("span", "planner-cols-hour np-data", String(hour).padStart(2, "0"));
    // The hour is the figure's identity across a re-render: when the øving
    // layer stretches the axis, 10:00 has to TRAVEL to its new percentage
    // rather than be replaced by a different element that happens to say "10"
    // (layerMotion.ts).
    label.setAttribute("data-hour", String(hour));
    label.style.setProperty("--planner-y", percent(hour * 60, geo.minMinutes, geo.span));
    rail.append(label);
  }
  grid.append(rail);

  let blockCount = 0;
  // One continuous count across the week, so the blocks strike in in reading
  // order rather than restarting in every column.
  let strike = 0;
  // Occurrence counter behind `motionKey` — a session's identity has to outlive
  // the re-render for the layer change to know what merely moved.
  const keySeen = new Map<string, number>();

  for (const day of geo.days) {
    const column = el("div", "planner-cols-day");
    column.setAttribute("data-day", String(day.dayNumber));
    if (day.dayNumber === options.todayNumber) column.setAttribute("data-today", "");

    // The strips go down FIRST, and take the first numbers in the day's share
    // of the strike order: an open window is the field the day's appointments
    // are printed on, so it is laid before them and never after. (Paint order
    // is settled by z-index, not by this, so nothing is drawn over.)
    day.bands.forEach((entry, index) => {
      const band = buildBand(entry, index, geo, strike++, options.onBlockClick);
      band.setAttribute("data-motion-key", motionKey(entry, keySeen));
      column.append(band);
      blockCount++;
    });

    // The lanes live in their own box, inset by the width the strips reserve,
    // so a block's percentage width is a percentage of the space it may
    // actually use — and a drop-in strip can never be drawn over.
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
 * Places the needle in today's column, or hides it (the column view's half of
 * REWORK-2026-07-30f's rule).
 *
 * Exported because it has to be re-run on a timer: a line that says "now" and
 * means "an hour ago" is worse than no line, and re-rendering the whole week
 * every minute to move one element would be absurd. Silently does nothing when
 * this view is not the one on screen, so the caller may simply call both.
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
