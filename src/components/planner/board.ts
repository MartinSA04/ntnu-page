/**
 * TAVLA — the week's second view (REWORK-2026-07-29b D2).
 *
 * A departure board: one row per session, the start time set large in tabular
 * mono, the room the same size in the opposite margin, the course name between
 * them. No geometry at all — nothing here is positioned by its duration, so
 * nothing here gets narrower as the viewport does.
 *
 * That is the whole point. The grid is at its weakest exactly where this is at
 * its strongest: at 390 px, in print, and in a screen reader, where a bar
 * whose meaning is its width says nothing. The two are views of one plan, not
 * two plans — both render from the same `PlanCourseState[]` through the same
 * `applyGroupSelection` narrowing the grid uses, so a parallel picked in one
 * is a parallel shown in the other.
 *
 * What it deliberately does NOT show: duration as form. "til 10:00" is a
 * fact you read, not a shape you see, and a student asking "have I got a gap
 * on Wednesday" is asking the grid, not this.
 */
import { classifyActivity } from "../../lib/planner/activity.js";
import { findConflicts, groupConflicts, mergeParallelSlots } from "../../lib/planner/conflicts.js";
import { applyGroupSelection, entryGroupKey } from "../../lib/planner/groups.js";
import { entriesInSemester, type ScheduleEntry } from "../../lib/planner/schedule.js";
import { dayName, dot, el } from "./dom.js";
import { type BlockDetail, visibleLayer } from "./grid.js";
import type { PlanCourseState } from "./types.js";

export interface BoardRenderOptions {
  /** Same contract as the grid's: a click opens that course's settings. */
  onBlockClick?: (detail: BlockDetail, anchor: HTMLElement) => void;
  /** Weekday (1 = mandag) to set at full ink; `null` marks none. */
  todayNumber?: number | null;
  /** Stagger the rows in on this render — set by a view switch only. */
  animate?: boolean;
}

export interface BoardRenderResult {
  /** Sessions listed. 0 means the caller should show a message instead. */
  rowCount: number;
}

interface BoardEntry extends ScheduleEntry {
  hueVar: string;
  courseName: string;
  /** The activity/group label. */
  label: string;
  rooms: string;
  isLecture: boolean;
  /** The student picked this entry group (or it had none to pick). */
  groupPicked: boolean;
  /** This session overlaps another lecture — the pair is bracketed. */
  clash: boolean;
}

const minutesOf = (time: string): number => {
  const [h, m] = time.split(":");
  return Number(h) * 60 + Number(m);
};

const roomLabel = (rooms: { building: string | null; room: string | null }[]): string =>
  rooms
    .map((r) => r.room ?? r.building ?? "")
    .filter(Boolean)
    .join(", ");

/**
 * A room worth setting in the display figure is a real room code — "R1",
 * "EL5", "F1". "Digital undervisning" and "Realfagbygget A" are sentences
 * wearing a room's clothes; blown up to 1.4rem they wrap and knock the row's
 * two numeral columns out of alignment, which is the one thing this view
 * cannot afford.
 */
export function isRoomCode(room: string): boolean {
  return /^[A-ZÆØÅ]{1,4}\d{1,3}[A-ZÆØÅ]?$/.test(room.trim());
}

/**
 * The sessions this semester's week actually contains, per course, after the
 * student's own group selection — the identical narrowing `renderGrid` does,
 * so the two views can never disagree about what is in the week.
 */
function collect(courses: PlanCourseState[], teachingWeeks: number[]): BoardEntry[] {
  const out: BoardEntry[] = [];
  for (const state of courses) {
    const timetable = state.bundle?.timetable;
    if (!timetable) continue;
    const selected = applyGroupSelection(timetable, state.course.groups, state.programCode);
    const picked = new Set(state.course.groups ?? []);
    // A course offering exactly ONE øving/lab group offers no choice, so it
    // counts as picked — the same rule the grid and the group picker follow.
    const otherKeys = new Set<string>();
    for (const raw of selected) {
      if (classifyActivity(raw) === "lecture") continue;
      const key = entryGroupKey(raw);
      if (key !== null) otherKeys.add(key);
    }
    const soleGroup = otherKeys.size === 1;
    for (const raw of entriesInSemester(selected, teachingWeeks)) {
      const key = entryGroupKey(raw);
      out.push({
        courseCode: state.course.code,
        dayNumber: raw.dayNumber,
        startTime: raw.startTime,
        endTime: raw.endTime,
        weeks: raw.weeks,
        hueVar: state.hueVar,
        courseName: state.bundle?.details?.courseName ?? state.course.name,
        label: raw.title?.trim() || raw.name?.trim() || "",
        rooms: roomLabel(raw.rooms),
        // Same classifier as the grid's, not a second guess at what counts as
        // a lecture — the two views must agree about which sessions can clash.
        isLecture: classifyActivity(raw) === "lecture",
        groupPicked: key === null || soleGroup || picked.has(key),
        clash: false,
      });
    }
  }
  return out;
}

/**
 * Renders the board into `host`. Returns how many sessions it listed so the
 * caller can fall back to its own message branch at zero, exactly as it does
 * for the grid.
 */
export function renderBoard(
  host: HTMLElement,
  courses: PlanCourseState[],
  teachingWeeks: number[],
  showOthers: boolean,
  options: BoardRenderOptions = {},
): BoardRenderResult {
  // The øving/lab layer obeys the SAME toggle here as in the grid, through the
  // same function. Listing every published lab group because this view has
  // room for them would make the two views disagree about what the week is —
  // 57 rows against 7 bars, which is what shipped for exactly one build.
  const entries = visibleLayer(collect(courses, teachingWeeks), showOthers).shown;

  // Collision marking runs through the SAME engine as the grid's — lecture ×
  // lecture only, touching boundaries excluded (conflicts.ts). A second
  // implementation here is how two surfaces start disagreeing about whether a
  // week is clean.
  // `mergeParallelSlots` returns groups, not slots — the representative is the
  // one the engine should see, or a course publishing eleven identical øvings-
  // groups would report ten collisions with itself.
  const lectures = mergeParallelSlots(entries.filter((e) => e.isLecture)).map(
    (group) => group.representative,
  );
  for (const group of groupConflicts(findConflicts(lectures))) {
    for (const entry of entries) {
      if (
        entry.isLecture &&
        entry.dayNumber === group.dayNumber &&
        minutesOf(entry.startTime) < group.end &&
        minutesOf(entry.endTime) > group.start
      ) {
        entry.clash = true;
      }
    }
  }

  host.replaceChildren();
  if (entries.length === 0) return { rowCount: 0 };

  const board = el("div", "planner-board");
  if (options.animate) board.classList.add("is-striking");
  board.setAttribute("role", "group");
  board.setAttribute("aria-label", "Ukeplan som liste");

  const dayCount = entries.some((e) => e.dayNumber === 6) ? 6 : 5;
  let strike = 0;
  // Occurrence counter behind `motionKey` — see there for why a session needs
  // an identity that outlives the re-render.
  const keySeen = new Map<string, number>();

  for (let day = 1; day <= dayCount; day++) {
    const items = entries
      .filter((e) => e.dayNumber === day)
      .sort((a, b) => minutesOf(a.startTime) - minutesOf(b.startTime));

    const head = el("div", "planner-board-day");
    head.setAttribute("data-motion-key", `day-${day}`);
    if (day === options.todayNumber) head.setAttribute("data-today", "");
    head.append(el("h3", "planner-board-dayname", dayName(day)));
    const minutes = items.reduce(
      (sum, e) => sum + (minutesOf(e.endTime) - minutesOf(e.startTime)),
      0,
    );
    head.append(
      el(
        "span",
        "planner-board-sum np-data",
        items.length === 0 ? "fri" : `${(minutes / 60).toFixed(1).replace(".", ",")} t`,
      ),
    );
    board.append(head);

    if (items.length === 0) {
      const free = el("p", "planner-board-free np-hint", "Ingen undervisning.");
      free.setAttribute("data-motion-key", `free-${day}`);
      board.append(free);
      continue;
    }

    // A day's clashing sessions are bracketed together in the margin rather
    // than each being tinted: the mark belongs to the pair, not to either one
    // of them, and a filled row reads as an error state rather than as two
    // things you have to choose between.
    const clashing = items.filter((e) => e.clash);
    const group = clashing.length > 1 ? el("div", "planner-board-clash") : board;
    if (group !== board) {
      group.setAttribute("data-motion-key", `clash-${day}`);
      board.append(group);
    }

    for (const entry of items) {
      group.append(buildRow(entry, strike++, motionKey(entry, keySeen), options.onBlockClick));
    }

    if (clashing.length > 1) {
      const codes = [...new Set(clashing.map((e) => e.courseCode))];
      const note = el(
        "p",
        "planner-board-clash-note np-data",
        `${codes.join(" / ")} overlapper — velg én`,
      );
      note.setAttribute("data-motion-key", `clash-note-${day}`);
      group.append(note);
    }
  }

  host.append(board);
  return { rowCount: entries.length };
}

/**
 * The identity a row keeps across a re-render, so `layerMotion` can tell a
 * session that MOVED from one that arrived.
 *
 * It has to be built from the session itself rather than from its position:
 * revealing the øving layer inserts rows between the lectures, so every index
 * below the first insertion changes while the sessions do not. The occurrence
 * counter covers the one case the facts do not separate — a course publishing
 * two identical parallels at the same hour — and is stable because the layer
 * filter removes rows without reordering them.
 */
function motionKey(entry: BoardEntry, seen: Map<string, number>): string {
  const base = [
    entry.courseCode,
    entry.dayNumber,
    entry.startTime,
    entry.endTime,
    entry.label,
  ].join("|");
  const nth = seen.get(base) ?? 0;
  seen.set(base, nth + 1);
  return `${base}#${nth}`;
}

function buildRow(
  entry: BoardEntry,
  strike: number,
  key: string,
  onBlockClick?: BoardRenderOptions["onBlockClick"],
): HTMLElement {
  const row = el(onBlockClick ? "button" : "div", "planner-board-row");
  row.setAttribute("data-motion-key", key);
  row.style.setProperty("--planner-strike", String(strike));
  if (row instanceof HTMLButtonElement) row.type = "button";

  const time = el("span", "planner-board-time");
  time.append(el("span", "planner-board-from np-data", entry.startTime));
  time.append(el("span", "planner-board-to np-data", `til ${entry.endTime}`));
  row.append(time);

  const what = el("span", "planner-board-what");
  const name = el("span", "planner-board-name");
  name.append(dot(entry.hueVar));
  name.append(el("span", "planner-board-course", entry.courseName));
  what.append(name);
  const sub = [entry.courseCode, entry.label].filter(Boolean).join(" · ");
  what.append(el("span", "planner-board-sub np-data", sub));
  row.append(what);

  const room = entry.rooms || "—";
  const roomEl = el(
    "span",
    `planner-board-room np-data${isRoomCode(room) ? "" : " is-long"}`,
    room,
  );
  row.append(roomEl);

  row.setAttribute(
    "aria-label",
    `${entry.courseCode}, ${dayName(entry.dayNumber)} ${entry.startTime} til ${entry.endTime}${
      entry.rooms ? `, ${entry.rooms}` : ""
    }`,
  );

  if (onBlockClick) {
    row.addEventListener("click", () =>
      onBlockClick(
        {
          code: entry.courseCode,
          dayNumber: entry.dayNumber,
          name: entry.courseName,
          entryName: entry.label || null,
          timeLabel: `${dayName(entry.dayNumber)} ${entry.startTime}–${entry.endTime}`,
          rooms: entry.rooms,
          weeksLabel: "",
          isLecture: entry.isLecture,
        },
        row,
      ),
    );
  }
  return row;
}
