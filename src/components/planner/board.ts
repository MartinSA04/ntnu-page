/**
 * TAVLA — the week's second view.
 *
 * A departure board: one row per session, the start time set large in tabular
 * mono, the room the same size in the opposite margin, the course name between
 * them. No geometry at all, so nothing here narrows as the viewport does —
 * which is the point: the grid is weakest exactly where this is strongest, at
 * 390 px, in print, and in a screen reader.
 *
 * Both views render from the same `PlanCourseState[]` through the same
 * `applyGroupSelection`, so a parallel picked in one is shown in the other.
 */
import { classifyActivity } from "../../lib/planner/activity.js";
import { findConflicts, groupConflicts, mergeParallelSlots } from "../../lib/planner/conflicts.js";
import { applyGroupSelection, entryGroupKey } from "../../lib/planner/groups.js";
import {
  entriesInSemester,
  entriesInWeek,
  parseWeeks,
  type ScheduleEntry,
} from "../../lib/planner/schedule.js";
import { dayName, dot, el, weekLabel } from "./dom.js";
import { staggerStep } from "./layerMotion.js";
import type { PlanCourseState } from "./types.js";
import { type BlockDetail, blockDetailFor, buildingLabel, visibleLayer } from "./weekNotes.js";

export interface BoardRenderOptions {
  /** Same contract as the grid's: a click opens that course's settings. */
  onBlockClick?: (detail: BlockDetail, anchor: HTMLElement) => void;
  /** Weekday (1 = mandag) to set at full ink; `null` marks none. */
  todayNumber?: number | null;
  /** Stagger the rows in on this render — set by a view switch only. */
  animate?: boolean;
  /** Every parallel and every group — see `CollectOptions`. */
  showAllGroups?: boolean;
  /** One ISO week instead of the mønsteruke — see `CollectOptions`. */
  week?: number | null;
}

export interface BoardRenderResult {
  /** Sessions listed. 0 means the caller should show a message instead. */
  rowCount: number;
}

/**
 * One session of the plan's week, after the student's group selection. Exported
 * because `columnGrid.ts` reads the same rows through `collectSessions`, so
 * there is exactly one answer to "what is in this week" behind both.
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
   * it overlaps nothing. The row only needs to know THAT it clashes; the
   * popover it opens must name the partner, and it is the same card a bar
   * opens, so the facts behind it cannot be thinner here.
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
 * A room worth setting in the display figure is a real room code. "Digital
 * undervisning" is a sentence wearing a room's clothes; at 1.4rem it wraps and
 * knocks the row's two numeral columns out of alignment.
 *
 * What separates a code from a sentence is whitespace and a digit, not
 * punctuation: a shape test spelled out in letters and digits rejected
 * `A4-156` — a real Realfagbygget room, where TDT4120's øvingsveiledning sits
 * five days a week — purely for its hyphen, and demoted it to the small style
 * meant for the sentence.
 */
export function isRoomCode(room: string): boolean {
  const t = room.trim();
  return t.length <= 8 && !/\s/.test(t) && /\d/.test(t);
}

export interface CollectOptions {
  /**
   * Draw every parallel and every group, bypassing `applyGroupSelection`.
   *
   * That call is NOT a no-op with no picks and no programme — it still applies
   * `resolveLectureDefaults`, which keeps one lecture parallel and drops the
   * rest. Right for a plan; wrong for `/emne/[code]/`, which is the course's
   * own reference page rather than one student's plan, and whose visitor is
   * deciding which parallel to register for. Both views read their entries
   * through this one function, so without the bypass neither can say it.
   *
   * `/planlegger/` and `/user/<navn>` never set it: one is the student's own
   * plan and the other is somebody else's, and both are picks already made.
   */
  showAllGroups?: boolean;
  /**
   * Draw ONE ISO week instead of the mønsteruke.
   *
   * The pattern week is every session of the semester collapsed into one, which
   * is right for choosing courses and wrong for reading a particular Monday: a
   * course taught weeks 34 to 40 and one taught 41 to 48 land in the same slot,
   * so the grid shows an overlap that never happens. Narrowing here rather than
   * in each view is what stops the two disagreeing about what a week contains —
   * the same reason `applyGroupSelection` is called here and nowhere else.
   */
  week?: number | null;
}

/**
 * The sessions this semester's week contains, per course, after the student's
 * group selection. Exported for `columnGrid.ts`, which must not grow a second
 * copy of this pipeline — the two views can never disagree about what is in a
 * week.
 */
export function collectSessions(
  courses: PlanCourseState[],
  teachingWeeks: number[],
  options: CollectOptions = {},
): SessionEntry[] {
  const out: SessionEntry[] = [];
  for (const state of courses) {
    const timetable = state.bundle?.timetable;
    if (!timetable) continue;
    const selected = options.showAllGroups
      ? timetable
      : applyGroupSelection(timetable, state.course.groups, state.programCode);
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
    const inSemester = entriesInSemester(selected, teachingWeeks);
    const drawn =
      typeof options.week === "number" ? entriesInWeek(inSemester, options.week) : inSemester;
    for (const raw of drawn) {
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
        // `showAllGroups` is the course page: every group counts as shown, or
        // `visibleLayer`'s `isLecture || groupPicked` drops each one again the
        // moment the layer is revealed — which is the same as the toggle doing
        // nothing, on a surface with no picks to make.
        groupPicked: options.showAllGroups || key === null || soleGroup || picked.has(key),
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
 * directly or through a third that overlaps both, so a running chain is one
 * incident rather than three unrelated notes. The sweep is over `clash.window`,
 * already widened across every conflict group a session falls in.
 *
 * A segment naming one course only is dropped: `mergeParallelSlots` collapses a
 * course's parallel sections first, so it would be a course colliding with
 * itself.
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
 * caller can fall back to its own message branch at zero, as it does for the
 * grid.
 */
export function renderBoard(
  host: HTMLElement,
  courses: PlanCourseState[],
  teachingWeeks: number[],
  showOthers: boolean,
  options: BoardRenderOptions = {},
): BoardRenderResult {
  // The øving/lab layer obeys the SAME toggle as the grid, through the same
  // function. Listing every published lab group because this view has room for
  // them would make the two views disagree about what the week is.
  const entries = visibleLayer(
    collectSessions(courses, teachingWeeks, {
      showAllGroups: options.showAllGroups ?? false,
      week: options.week ?? null,
    }),
    showOthers,
  ).shown;

  // Collision marking runs through the SAME engine as the grid's — lecture ×
  // lecture only, touching boundaries excluded. A second implementation is how
  // two surfaces start disagreeing about whether a week is clean.
  // `mergeParallelSlots` returns groups, not slots, and the representative is
  // what the engine should see.
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
  // Read once for the whole render: two rows must never disagree about whether
  // it is 09:59 or 10:00.
  const now = new Date();
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
    // WHEN THE DAY STARTS AND ENDS, not how many hours are inside it. "7,5 t"
    // is a number you cannot plan around — two hours of that could be at 08:15
    // or at 19:00 — while "08:15–17:00" is the shape of the day, which is the
    // thing a student is deciding about. `fri` still says the day is empty.
    const last = items.reduce(
      (latest, e) => (minutesOf(e.endTime) > minutesOf(latest) ? e.endTime : latest),
      items[0]?.endTime ?? "",
    );
    head.append(
      el(
        "span",
        "planner-board-sum np-data",
        items.length === 0 ? "fri" : `${items[0]?.startTime}–${last}`,
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
    // the day: bracketing the day drew a rule down the side of unrelated
    // sessions. Adjacent marked rows still join into one continuous rule
    // (planner-week.css bridges the hairline), so a pair reads as a pair
    // without either row being tinted.
    const segments = clashSegments(items);
    const marked = new Set(segments.flatMap((s) => [...s.members]));
    // Each incident's note sits under the last row it applies to, rather than
    // one per day: two unrelated overlaps were concatenated into a sentence
    // naming four courses, none of which clashed with all the others.
    const noteAfter = new Map<SessionEntry, ClashSegment>();
    for (const segment of segments) {
      const last = items.filter((e) => segment.members.has(e)).at(-1);
      if (last) noteAfter.set(last, segment);
    }

    for (const entry of items) {
      const row = buildRow(entry, strike++, motionKey(entry, keySeen), options.onBlockClick);
      if (marked.has(entry)) row.classList.add("is-clashing");
      // The first frame's answer; `syncBoardNow` keeps it true on the minute
      // without rebuilding the week.
      if (isLive(entry.dayNumber, entry.startTime, entry.endTime, options.todayNumber ?? null, now))
        row.classList.add("is-now");
      board.append(row);

      const segment = noteAfter.get(entry);
      if (!segment) continue;
      // No "Velg én": a student looking at two overlapping sessions does not
      // need to be told that overlapping sessions are a choice.
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
  // still lands inside the budget (`staggerStep`).
  board.style.setProperty("--planner-step", `${staggerStep(strike, 45)}ms`);
  host.append(board);
  return { rowCount: entries.length };
}

/** Is `at` inside this session, on this session's day? */
function isLive(
  dayNumber: number,
  startTime: string,
  endTime: string,
  todayNumber: number | null,
  at: Date,
): boolean {
  if (dayNumber !== todayNumber || startTime === "" || endTime === "") return false;
  const minutes = at.getHours() * 60 + at.getMinutes();
  return minutesOf(startTime) <= minutes && minutes < minutesOf(endTime);
}

/**
 * Marks the row you are inside right now, or none.
 *
 * Exported because it must re-run on a timer: an ordinary minute may NOT
 * re-render the week — that would throw away the layer motion, the scroll
 * position and any open popover — so this is Liste's half of what
 * `syncColumnNow` does for the grid. Silently does nothing when this view is
 * not the one on screen, so the caller may simply call all of them.
 *
 * `todayNumber` is passed rather than derived: the caller owns "what day is
 * it", and a second reading of the clock here is a second chance to disagree
 * with the column that drew today's wash.
 */
export function syncBoardNow(
  frame: HTMLElement,
  todayNumber: number | null,
  at: Date = new Date(),
): void {
  // `Array.from`, not a spread: the Node typecheck pass's lib has no
  // DOM.Iterable, so a NodeList is not iterable there.
  const rows = Array.from(frame.querySelectorAll<HTMLElement>(".planner-board-row[data-day]"));
  for (const row of rows) {
    row.classList.toggle(
      "is-now",
      isLive(
        Number(row.getAttribute("data-day")),
        row.getAttribute("data-start") ?? "",
        row.getAttribute("data-end") ?? "",
        todayNumber,
        at,
      ),
    );
  }
}

/**
 * The identity a session keeps across a re-render, so `layerMotion` can tell a
 * session that MOVED from one that arrived.
 *
 * Exported for `columnGrid.ts`, whose blocks cannot use the transposed grid's
 * a positional index — one definition of "the same session", or the two views
 * disagree about what travelled.
 *
 * Built from the session itself rather than its position: revealing the øving
 * layer inserts rows between the lectures, so every index below the first
 * insertion changes while the sessions do not. The occurrence counter covers
 * the one case the facts do not separate — two identical parallels at the same
 * hour — and is stable because the layer filter removes rows without
 * reordering them.
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

  // What the needle is in the grid: the row you are inside right now. Placed
  // by `syncBoardNow` on a timer rather than by this render, for the same
  // reason the needle is — an ordinary minute may not rebuild the week.
  row.setAttribute("data-day", String(entry.dayNumber));
  row.setAttribute("data-start", entry.startTime);
  row.setAttribute("data-end", entry.endTime);

  const what = el("span", "planner-board-what");
  const name = el("span", "planner-board-name");
  name.append(dot(entry.hueVar));
  name.append(el("span", "planner-board-course", entry.courseName));
  // Present on every row and `display: none` until the row is live, which
  // takes it out of the accessibility tree too — so nothing announces "nå"
  // about a session at four o'clock this afternoon.
  name.append(el("span", "planner-board-now-tag", "nå"));
  what.append(name);
  const sub = [entry.courseCode, entry.label].filter(Boolean).join(", ");
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
    // Built by the grid's own `blockDetailFor`, not a second hand-rolled
    // literal: the card a row opens IS the card a bar opens.
    row.addEventListener("click", () =>
      onBlockClick(
        blockDetailFor({ ...entry, name: entry.label, groupCount: 1 }, entry.clash),
        row,
      ),
    );
  }
  return row;
}
