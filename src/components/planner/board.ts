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
import { entriesInSemester, parseWeeks, type ScheduleEntry } from "../../lib/planner/schedule.js";
import { dayName, dot, el, weekLabel } from "./dom.js";
import { type BlockDetail, blockDetailFor, buildingLabel, visibleLayer } from "./grid.js";
import { staggerStep } from "./layerMotion.js";
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

/**
 * One session of the plan's week, after the student's group selection.
 *
 * Exported because Tavla is no longer the only view built from it: the column
 * grid (`columnGrid.ts`) reads the same rows through `collectSessions` below,
 * so there is exactly one answer to "what is in this week" behind both.
 */
export interface SessionEntry extends ScheduleEntry {
  hueVar: string;
  courseName: string;
  /** The activity/group label. */
  label: string;
  rooms: string;
  /** The building(s) behind those rooms, for the popover rather than the row. */
  buildings: string;
  weeksLabel: string;
  isLecture: boolean;
  /** The student picked this entry group (or it had none to pick). */
  groupPicked: boolean;
  /**
   * The lectures this session overlaps and the minutes they share, `null` when
   * it overlaps nothing. The row itself only needs to know THAT it
   * clashes (it carries its own margin rule); the popover a row opens needs to
   * name the partner, and it is the same card a bar opens, so the facts behind
   * it cannot be thinner here.
   */
  clash: { partners: string[]; window: { start: number; end: number } } | null;
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
 * so the views can never disagree about what is in the week.
 *
 * Exported for `columnGrid.ts`, which needs precisely these rows and must not
 * grow a third copy of this pipeline.
 */
export function collectSessions(
  courses: PlanCourseState[],
  teachingWeeks: number[],
): SessionEntry[] {
  const out: SessionEntry[] = [];
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
        buildings: buildingLabel(raw.rooms),
        weeksLabel: weekLabel(parseWeeks(raw.weeks)),
        // Same classifier as the grid's, not a second guess at what counts as
        // a lecture — the two views must agree about which sessions can clash.
        isLecture: classifyActivity(raw) === "lecture",
        groupPicked: key === null || soleGroup || picked.has(key),
        clash: null,
      });
    }
  }
  return out;
}

/** One collision incident within a day: the sessions in it and the codes involved. */
interface ClashSegment {
  members: Set<SessionEntry>;
  /** Distinct course codes, in the order the sessions start. */
  codes: string[];
}

/**
 * A day's collisions, split into the separate incidents they actually are.
 *
 * Two sessions belong to the same incident when their clash windows overlap —
 * directly, or through a third session that overlaps both (10:15–12:00 against
 * 11:15–13:00 against 12:15–14:00 is one running incident, and three notes
 * would read as three unrelated ones). The sweep is over `clash.window`, which
 * `renderBoard` has already widened across every conflict group a session
 * falls in.
 *
 * A segment naming one course only is dropped: `mergeParallelSlots` already
 * collapses a course's parallel sections before the engine sees them, so a
 * single-code segment would be a course reported as colliding with itself.
 */
function clashSegments(items: SessionEntry[]): ClashSegment[] {
  const clashing = items
    .filter((e) => e.clash !== null)
    .sort((a, b) => (a.clash?.window.start ?? 0) - (b.clash?.window.start ?? 0));

  const segments: ClashSegment[] = [];
  let reach = Number.NEGATIVE_INFINITY;
  for (const entry of clashing) {
    const window = entry.clash?.window;
    if (!window) continue;
    const open = segments.at(-1);
    if (!open || window.start >= reach) {
      segments.push({ members: new Set([entry]), codes: [entry.courseCode] });
      reach = window.end;
      continue;
    }
    open.members.add(entry);
    if (!open.codes.includes(entry.courseCode)) open.codes.push(entry.courseCode);
    reach = Math.max(reach, window.end);
  }
  return segments.filter((s) => s.codes.length > 1);
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
  const entries = visibleLayer(collectSessions(courses, teachingWeeks), showOthers).shown;

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
        // Widened across every group this session falls in, exactly as the
        // grid's `clashWindowFor` does it, because a session can sit in two.
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

    // The mark rides on the clashing rows THEMSELVES, not on a wrapper around
    // the day. It used to be a bracket in the margin of a `<div>` that every
    // row of the day was appended to, so one 10:15 overlap drew a rule down
    // the side of Monday's 16:00 øving as well — the marker claimed the day
    // when it meant two sessions. Adjacent marked rows still join into one
    // continuous rule (planner-week.css bridges the row hairline), so a pair
    // reads as a pair without either row being tinted; a filled row reads as
    // an error state rather than as two things you have to choose between.
    const segments = clashSegments(items);
    const marked = new Set(segments.flatMap((s) => [...s.members]));
    // Each incident's note sits directly under the last row it applies to,
    // rather than one note per day at the bottom: a day with two unrelated
    // overlaps had them concatenated into a single sentence naming four
    // courses, none of which actually clashed with all the others.
    const noteAfter = new Map<SessionEntry, ClashSegment>();
    for (const segment of segments) {
      const last = items.filter((e) => segment.members.has(e)).at(-1);
      if (last) noteAfter.set(last, segment);
    }

    for (const entry of items) {
      const row = buildRow(entry, strike++, motionKey(entry, keySeen), options.onBlockClick);
      if (marked.has(entry)) row.classList.add("is-clashing");
      board.append(row);

      const segment = noteAfter.get(entry);
      if (!segment) continue;
      // No "Velg én": a student looking at two overlapping sessions does not
      // need to be told that overlapping sessions are a choice. The fact is
      // the whole message.
      const note = el(
        "p",
        "planner-board-clash-note np-data",
        `${segment.codes.join(" / ")} overlapper`,
      );
      note.setAttribute("data-motion-key", `clash-note-${day}-${segment.codes.join("-")}`);
      board.append(note);
    }
  }

  // The rhythm the rows strike in at, tightened on a long week so the list
  // still lands inside the budget (`staggerStep`) — a 40-session list at a flat
  // 45 ms a row is nearly two seconds of rows appearing.
  board.style.setProperty("--planner-step", `${staggerStep(strike, 45)}ms`);
  host.append(board);
  return { rowCount: entries.length };
}

/**
 * The identity a session keeps across a re-render, so `layerMotion` can tell a
 * session that MOVED from one that arrived.
 *
 * Exported for `columnGrid.ts`, whose blocks need exactly this and cannot use
 * the transposed grid's `GridEntry.ordinal` — it is assigned in a pipeline this
 * view does not run. One definition of "the same session", or the two views
 * disagree about what travelled.
 *
 * It has to be built from the session itself rather than from its position:
 * revealing the øving layer inserts rows between the lectures, so every index
 * below the first insertion changes while the sessions do not. The occurrence
 * counter covers the one case the facts do not separate — a course publishing
 * two identical parallels at the same hour — and is stable because the layer
 * filter removes rows without reordering them.
 */
export function motionKey(entry: SessionEntry, seen: Map<string, number>): string {
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
  entry: SessionEntry,
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

  // No em dash standing in for "nothing": an empty cell says it without
  // spending a glyph on it, and the column already right-aligns.
  const room = entry.rooms;
  if (room) {
    row.append(el("span", `planner-board-room np-data${isRoomCode(room) ? "" : " is-long"}`, room));
  }

  row.setAttribute(
    "aria-label",
    `${entry.courseCode}, ${dayName(entry.dayNumber)} ${entry.startTime} til ${entry.endTime}${
      entry.rooms ? `, ${entry.rooms}` : ""
    }`,
  );

  if (onBlockClick) {
    // Built by the grid's own `blockDetailFor`, not by a second hand-rolled
    // literal: the card a row opens IS the card a bar opens, and the last
    // version of this literal quietly shipped an empty week label.
    row.addEventListener("click", () =>
      onBlockClick(
        blockDetailFor(
          { ...entry, name: entry.label, weeksNumbers: [], groupCount: 1, ordinal: 0 },
          entry.clash,
        ),
        row,
      ),
    );
  }
  return row;
}
