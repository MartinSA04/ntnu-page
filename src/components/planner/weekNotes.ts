/**
 * WHAT A WEEK MEANS, as distinct from how it is drawn.
 *
 * All of this used to live in `grid.ts` beside the transposed renderer, which
 * is why `plannerApp` built a complete week into a detached `discardHost` on
 * every render just to collect the margin notes. The notes, the conflict count,
 * the honest-gap reporting (DR-8) and the message branches are facts about the
 * WEEK, not about which way round it is drawn — they belong to neither view.
 *
 * `weekNotes()` is the single entry point. It writes the margin and hands back
 * everything the page's verdict, its layer toggle and its message branches
 * need, without building a grid.
 *
 * ## The one thing it cannot do
 *
 * A collision note is a BUTTON that flashes the sessions it names, and the
 * nodes to flash belong to whichever view is mounted. So the note calls
 * `onConflictClick` and the caller resolves the group to live elements. This is
 * also a repair: with the notes coming from a render into `discardHost`, every
 * collision note in the planner has been flashing detached nodes — a click that
 * scrolled nothing and focused nothing, on both views.
 *
 * ## Known duplication, and why it is still here
 *
 * `collectEntries` below and `collectSessions` in board.ts are the same
 * pipeline over the same fields, with one difference: the latter also filters
 * to the semester's teaching weeks, because it feeds a view and this feeds a
 * count. Merging them would change which entries the conflict count is computed
 * over — a course taught only outside the semester currently contributes to the
 * count and not to the drawn week — so it is a decision about what a collision
 * MEANS, not a tidy-up. Make it deliberately, with a test, or leave it.
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
import { parseWeeks, type ScheduleEntry } from "../../lib/planner/schedule.js";
import { dayName, dot, el, weekLabel } from "./dom.js";
import type { PlanCourseState } from "./types.js";

/** A non-lecture window at least this long is a drop-in band, not a lane (U1). */
const ALL_DAY_MINUTES = 5 * 60;

/**
 * One course's session, with the course context the margin and the popover
 * need. The shape `collectEntries` produces.
 */
export interface WeekEntry extends ScheduleEntry {
  hueVar: string;
  /** The course's proper name (for the block popover), distinct from `name`. */
  courseName: string;
  /** The activity/group label — `title`, e.g. "Forelesningsparallell 2 Trondheim". */
  name: string;
  rooms: string;
  /**
   * The building(s) those rooms sit in, or "" when upstream gave none or gave
   * one the room label already shows. A block has no width for it; the popover
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
  /** Per-render ordinal, because (code, day, start) is not unique. */
  ordinal: number;
}

/**
 * What a clicked block hands its listener — material for the session popover.
 */
export interface BlockDetail {
  /** Course code. */
  code: string;
  /** The weekday the block sits in (1 = mandag). */
  dayNumber: number;
  /** Course name (the proper name). */
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
  clash: BlockClash | null;
}

export interface BlockClash {
  /** The other courses in the collision, never including this block's own. */
  partners: string[];
  /** The overlapping minutes, as clock times. */
  startTime: string;
  endTime: string;
}

/** The fields `blockDetailFor` actually reads — both views adapt to this. */
export interface BlockSource {
  courseCode: string;
  dayNumber: number;
  courseName: string;
  name: string;
  groupCount: number;
  startTime: string;
  endTime: string;
  rooms: string;
  buildings: string;
  weeksLabel: string;
  isLecture: boolean;
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

/**
 * Every timetable entry (with course context) for courses with a loaded
 * bundle. Each course's entries pass through `applyGroupSelection` FIRST: the
 * week never shows a parallel the student did not select. `showAllGroups`
 * bypasses that — see `CollectOptions` in board.ts.
 */
function collectEntries(courses: PlanCourseState[], showAllGroups: boolean): WeekEntry[] {
  const entries: WeekEntry[] = [];
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
function mergeSlots(entries: WeekEntry[]): WeekEntry[] {
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

/**
 * An all-day drop-in window (08:00–18:00 lab). Never a lecture.
 *
 * Both views must make the same call: a window that is a strip in one and a
 * lane in the other is two views disagreeing about what the week contains.
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

/**
 * Renders a message where the week would be. Exported so the page's
 * pre-publish branch (DR-2) can clear the frame through the same door.
 */
export function renderWeekMessage(
  frame: HTMLElement,
  notesHost: HTMLElement,
  message?: string | null,
): void {
  notesHost.replaceChildren();
  frame.removeAttribute("aria-busy");
  frame.replaceChildren(...(message ? [el("p", "planner-grid-empty np-hint", message)] : []));
}

/** The activity/group label a block shows — merged parallels count themselves. */
function groupLabel(entry: { name: string; groupCount: number }): string {
  return entry.groupCount > 1 ? `${entry.name}, ${entry.groupCount} grupper` : entry.name;
}

/**
 * The block's second line: `start · room`. The start comes FIRST because
 * a block's meta line is nowrap + ellipsis and a narrow block clips whatever
 * is last — the time is the fact the whole-hour rail cannot give back. The
 * room survives in the block's `title`, aria-label and popover.
 */
export function metaLine(entry: { rooms: string; startTime: string }): string {
  return [entry.startTime, entry.rooms].filter(Boolean).join(", ");
}

/**
 * Popover material for a block. `clash` comes from the render's own conflict
 * pass, so the card and the red zone can never disagree.
 */
export function blockDetailFor(
  entry: BlockSource,
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
 * Open by default above 40rem. Crossing that boundary re-renders the week
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
  summary.append(incomplete ? ". Kollisjonssjekken er ufullstendig" : " om uka");
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
  host.append(", ");
  group.codes.forEach((code, i) => {
    if (i > 0) host.append(i === group.codes.length - 1 ? " og " : ", ");
    host.append(el("span", "np-data", code));
  });
  host.append(" kolliderer");
  if (weeks) {
    host.append(", ");
    host.append(el("span", "np-data", weeks));
  }

  return `${day} ${time}, ${joinList(group.codes)} kolliderer${weeks ? `, ${weeks}` : ""}`;
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

export interface WeekNotesOptions {
  /**
   * A bundle fetch is still in flight, so the caller draws a skeleton instead
   * of asserting "Ingen timeplandata" — false, and the reflow when data lands
   * throws the exam ribbon off screen mid-read.
   */
  loading?: boolean;
  /**
   * The plan is waiting on a studieretning/campus answer. The week is not a
   * failure while a question is open, so this replaces the canned recovery
   * copy. It is the *empty* week's message only.
   */
  pendingChoiceMessage?: string | null;
  /** Bypasses `applyGroupSelection` entirely — every parallel and group counts. */
  showAllGroups?: boolean;
  /**
   * A margin note naming a course narrowed on a guess was clicked. A bar asks
   * "what is this session", a note asks "which group is mine" — and only the
   * second is an edit.
   */
  onChoiceClick?: (code: string) => void;
  /**
   * A collision note was clicked. The sessions to flash are in whichever view
   * is mounted, which this module cannot see — see the header.
   */
  onConflictClick?: (group: ConflictGroup) => void;
}

export interface WeekNotesResult {
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
  /** Courses drawing an unpicked øving/lab layer — the "velg din gruppe" notes. */
  pendingGroupCourses: string[];
  /** Courses whose timetable failed or never arrived. */
  incompleteCourses: string[];
  /** The check is not the whole plan: loading, or something incomplete. */
  partial: boolean;
  /** Lecture sessions the conflict engine actually compared. */
  checkedLectureCount: number;
  /** Published sessions, but nothing classifiable as a lecture. */
  uncheckedCourses: string[];
  /** Which branch the week is in. "grid" means there is one to draw. */
  state: "grid" | "empty" | "loading" | "pending-choice";
  /** What the caller should put where the week would be, when state is not "grid". */
  message: string | null;
}

/**
 * Writes the margin for one plan and reports what the week means.
 *
 * The branch ladder's ORDER is load-bearing: a fetch that failed is not a
 * question the student can answer, so telling them to pick a studieretning
 * over it sends them to a control that cannot fix the week.
 */
export function weekNotes(
  notesHost: HTMLElement,
  courses: PlanCourseState[],
  showOthers: boolean,
  options: WeekNotesOptions = {},
): WeekNotesResult {
  const loading = options.loading ?? false;
  const showAllGroups = options.showAllGroups ?? false;
  const rawEntries = collectEntries(courses, showAllGroups);
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
  const lectureChoices = unresolvedLectureChoices(courses, showAllGroups);

  const branch = (state: WeekNotesResult["state"], message: string | null): WeekNotesResult => {
    notesHost.replaceChildren();
    return {
      conflictCount: 0,
      conflictPairCount: 0,
      mutedLayerAutoRevealed: false,
      pendingGroupCourses: [],
      incompleteCourses,
      partial: loading || incompleteCourses.length > 0,
      checkedLectureCount: 0,
      uncheckedCourses,
      state,
      message,
    };
  };

  // An unanswered studieretning/campus question is what the *empty* week says
  // instead of the canned recovery copy — never a curtain over a week that has
  // something true to show. `programPlan.ts` prefills every course obligatory
  // in ALL directions precisely so a gated period still renders real blocks;
  // suppressing them breaks PRODUCT §1.1's "programme + kull → your week, instantly".
  const pending = options.pendingChoiceMessage ?? null;
  if (courses.length === 0) {
    return pending
      ? branch("pending-choice", pending)
      : branch("empty", "Legg til emner for å se ukeplanen.");
  }
  if (loading && rawEntries.length === 0) return branch("loading", null);
  if (rawEntries.length === 0) {
    if (gaps.failed.length > 0) {
      return branch("empty", `Fikk ikke hentet timeplan for ${joinList(gaps.failed)}.`);
    }
    if (pending) return branch("pending-choice", pending);
    // A claim about NTNU's data, so it may only be made once we got an answer.
    return branch("empty", "Ingen timeplandata for emnene i planen ennå.");
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
      if (options.onConflictClick) {
        link.addEventListener("click", () => options.onConflictClick?.(group));
      }
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
    pendingGroupCourses: [...unpickedGroups.keys()],
    incompleteCourses,
    partial: loading || incompleteCourses.length > 0,
    checkedLectureCount: checkedLectures.length,
    uncheckedCourses,
    state: "grid",
    message: null,
  };
}
