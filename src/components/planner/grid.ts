/**
 * UKEPLAN — the weekly spread (PLANNER.md §2). `.np-frame.np-ruled` surface,
 * CSS grid Mon–Fri (+Sat only if data demands), 15-min rows clamped to the
 * data's actual time range. Overlapping blocks (2-way; 3+ stacks by width)
 * split side-by-side; colliding blocks get the red hatch + wavy underline;
 * `.np-note-clash` margin notes below link to and flash the blocks.
 */
import { findConflicts } from "../../lib/planner/conflicts.js";
import { parseWeeks, type ScheduleEntry } from "../../lib/planner/schedule.js";
import { dayName, dot, el, weekLabel } from "./dom.js";
import type { PlanCourseState } from "./types.js";

const ROW_MINUTES = 15;
const DEFAULT_START_HOUR = 8;
const DEFAULT_END_HOUR = 20;

interface GridEntry extends ScheduleEntry {
  hueVar: string;
  name: string;
  rooms: string;
  weeksNumbers: number[];
  weeksLabel: string;
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

function blockAriaLabel(entry: GridEntry, weeks: number[], conflictPartners: string[]): string {
  const time = `${entry.startTime} til ${entry.endTime}`;
  const base = `${entry.courseCode}, ${dayName(entry.dayNumber)} ${time}, ${spokenWeekRange(weeks)}`;
  if (conflictPartners.length === 0) return base;
  return `${base}, kolliderer med ${conflictPartners.join(", ")}`;
}

/** Collects every timetable entry (with course context) for courses that have a loaded bundle. */
function collectEntries(courses: PlanCourseState[]): GridEntry[] {
  const entries: GridEntry[] = [];
  for (const state of courses) {
    const timetable = state.bundle?.timetable;
    if (!timetable) continue;
    for (const raw of timetable) {
      const startTime = raw.startTime;
      const endTime = raw.endTime;
      const weeksNumbers = parseWeeks(raw.weeks);
      entries.push({
        courseCode: state.course.code,
        dayNumber: raw.dayNumber,
        startTime,
        endTime,
        weeks: raw.weeks,
        hueVar: state.hueVar,
        name: raw.title ?? raw.name ?? state.course.name,
        rooms: roomLabel(raw.rooms),
        weeksNumbers,
        weeksLabel: weekLabel(weeksNumbers),
      });
    }
  }
  return entries;
}

function timeToMinutes(time: string): number {
  const [h = "0", m = "0"] = time.split(":");
  return Number(h) * 60 + Number(m);
}

/** Renders the empty ukeplan placeholder (no courses with loaded timetables yet). */
function renderEmpty(frame: HTMLElement, message: string): void {
  frame.replaceChildren(el("p", "planner-grid-empty np-note", message));
}

export interface GridRenderResult {
  /** Number of detected timetable conflicts, for the section's summary line. */
  conflictCount: number;
}

/**
 * Renders the weekly spread + its margin conflict notes into `frame` /
 * `notesHost`. Returns the conflict count so the caller can fold it into
 * the page's overview line.
 */
export function renderGrid(
  frame: HTMLElement,
  notesHost: HTMLElement,
  courses: PlanCourseState[],
): GridRenderResult {
  const entries = collectEntries(courses);
  notesHost.replaceChildren();

  if (courses.length === 0) {
    renderEmpty(frame, "Legg til emner for å se ukeplanen.");
    return { conflictCount: 0 };
  }
  if (entries.length === 0) {
    renderEmpty(frame, "Ingen timeplandata for emnene i planen ennå.");
    return { conflictCount: 0 };
  }

  const conflicts = findConflicts(entries);

  // Clamp displayed hours to the data, falling back to the 08–20 default window.
  let minMinutes = DEFAULT_START_HOUR * 60;
  let maxMinutes = DEFAULT_END_HOUR * 60;
  for (const e of entries) {
    minMinutes = Math.min(minMinutes, timeToMinutes(e.startTime));
    maxMinutes = Math.max(maxMinutes, timeToMinutes(e.endTime));
  }
  minMinutes = Math.floor(minMinutes / 60) * 60;
  maxMinutes = Math.ceil(maxMinutes / 60) * 60;
  const totalRows = Math.ceil((maxMinutes - minMinutes) / ROW_MINUTES);

  const hasSaturday = entries.some((e) => e.dayNumber === 6);
  const dayCount = hasSaturday ? 6 : 5;

  const grid = el("div", "planner-grid");
  grid.style.setProperty("--planner-rows", String(totalRows));
  grid.style.setProperty("--planner-days", String(dayCount));
  // role="group", not "img": the grid holds focusable blocks (each with its own
  // aria-label), and "img" would strip them from the accessibility tree.
  grid.setAttribute("role", "group");
  grid.setAttribute("aria-label", "Ukeplan med timeplanblokker for emnene i planen");

  // Hour labels down the left rail.
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

  // Day columns with headers.
  for (let day = 1; day <= dayCount; day++) {
    const col = el("div", "planner-grid-day");
    col.style.setProperty("--planner-day", String(day));
    const header = el("div", "planner-grid-day-header np-kicker", dayName(day).slice(0, 3));
    col.append(header);
    grid.append(col);
  }

  // Lay out blocks per day, splitting overlaps side-by-side.
  for (let day = 1; day <= dayCount; day++) {
    const dayEntries = entries.filter((e) => e.dayNumber === day);
    const columns = assignColumns(dayEntries);
    for (const { entry, column, columnCount } of columns) {
      const startRow = Math.round((timeToMinutes(entry.startTime) - minMinutes) / ROW_MINUTES) + 1;
      const endRow = Math.round((timeToMinutes(entry.endTime) - minMinutes) / ROW_MINUTES) + 1;

      const entryConflicts = conflicts.filter((c) => c.a === entry || c.b === entry);
      const isColliding = entryConflicts.length > 0;
      const partnerCodes = [
        ...new Set(entryConflicts.map((c) => (c.a === entry ? c.b : c.a).courseCode)),
      ];

      const block = el("button", "planner-block");
      block.type = "button";
      if (isColliding) block.classList.add("is-clash");
      block.id = blockId(entry);
      block.style.setProperty("--dot", `var(${entry.hueVar})`);
      block.style.setProperty("--planner-day", String(day));
      block.style.setProperty("--planner-row-start", String(startRow));
      block.style.setProperty("--planner-row-end", String(endRow));
      block.style.setProperty("--planner-col", String(column));
      block.style.setProperty("--planner-col-count", String(columnCount));
      block.setAttribute("aria-label", blockAriaLabel(entry, entry.weeksNumbers, partnerCodes));

      const head = el("span", "planner-block-head");
      head.append(dot(entry.hueVar));
      head.append(el("span", "planner-block-code np-data", entry.courseCode));
      block.append(head);
      block.append(el("span", "planner-block-name", entry.name));
      if (entry.rooms) block.append(el("span", "planner-block-rooms np-data", entry.rooms));
      block.append(el("span", "planner-block-weeks np-data", entry.weeksLabel));

      block.addEventListener("click", () => flashBlock(entry));

      grid.append(block);
    }
  }

  frame.replaceChildren(grid);

  // Margin notes: one per colliding pair, mono, linking to + flashing both blocks.
  if (conflicts.length > 0) {
    const list = el("ul", "planner-notes-list");
    for (const conflict of conflicts) {
      const item = el("li");
      const link = el("button", "np-note-clash planner-note-link", conflictNoteText(conflict));
      link.type = "button";
      link.addEventListener("click", () => {
        flashBlock(conflict.a);
        flashBlock(conflict.b);
      });
      item.append(link);
      list.append(item);
    }
    notesHost.append(list);
  }

  return { conflictCount: conflicts.length };
}

function blockId(entry: GridEntry): string {
  return `planner-block-${entry.courseCode}-${entry.dayNumber}-${entry.startTime.replace(":", "")}`;
}

function conflictNoteText(conflict: ReturnType<typeof findConflicts>[number]): string {
  const time = `${conflict.a.startTime}–${conflict.a.endTime}`;
  const weeksText = weekLabel(conflict.weeks);
  return `${conflict.a.courseCode} kolliderer med ${conflict.b.courseCode} · ${dayName(conflict.dayNumber)} ${time} · ${weeksText}`;
}

function flashBlock(entry: ScheduleEntry): void {
  const node = document.getElementById(blockId(entry as GridEntry));
  if (!node) return;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  node.classList.remove("np-target-flash");
  // Force reflow so re-adding the class restarts the animation.
  void node.offsetWidth;
  node.classList.add("np-target-flash");
  node.focus({ preventScroll: true });
}

interface ColumnAssignment {
  entry: GridEntry;
  column: number;
  columnCount: number;
}

/**
 * Greedy interval-graph coloring: entries overlapping in time on the same
 * day get distinct columns; the column count for a block is the max
 * concurrency across the whole cluster it belongs to (so all blocks in an
 * overlapping cluster share equal width).
 */
function assignColumns(dayEntries: GridEntry[]): ColumnAssignment[] {
  const sorted = [...dayEntries].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );

  const active: { entry: GridEntry; column: number; end: number }[] = [];
  const assignments = new Map<GridEntry, number>();
  const clusters: GridEntry[][] = [];
  let currentCluster: GridEntry[] = [];
  let clusterMaxEnd = -1;

  for (const entry of sorted) {
    const start = timeToMinutes(entry.startTime);
    const end = timeToMinutes(entry.endTime);

    // Drop active entries that have ended before this one starts.
    for (let i = active.length - 1; i >= 0; i--) {
      const a = active[i];
      if (a && a.end <= start) active.splice(i, 1);
    }

    if (active.length === 0 && currentCluster.length > 0 && start >= clusterMaxEnd) {
      clusters.push(currentCluster);
      currentCluster = [];
      clusterMaxEnd = -1;
    }

    const usedColumns = new Set(active.map((a) => a.column));
    let column = 0;
    while (usedColumns.has(column)) column++;

    active.push({ entry, column, end });
    assignments.set(entry, column);
    currentCluster.push(entry);
    clusterMaxEnd = Math.max(clusterMaxEnd, end);
  }
  if (currentCluster.length > 0) clusters.push(currentCluster);

  const result: ColumnAssignment[] = [];
  for (const cluster of clusters) {
    const columnCount = Math.max(...cluster.map((e) => (assignments.get(e) ?? 0) + 1));
    for (const entry of cluster) {
      result.push({ entry, column: assignments.get(entry) ?? 0, columnCount });
    }
  }
  return result;
}
