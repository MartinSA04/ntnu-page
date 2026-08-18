/**
 * THE WEEK, as one thing a page mounts.
 *
 * Three surfaces used to draw a week, and for a while they drew two different
 * ones: the planner moved to KOLONNER and LISTE while the other two stayed on
 * the transposed geometry, which had been deleted as a view but kept alive as
 * a module. This is where that ends. One controller owns the view state, the
 * tab pair, the scroll edge, the now marker, the session popover and the
 * choice between the two renderers; a page hands it states and gets a week.
 *
 * ## What the page keeps
 *
 * The MESSAGE branches' content. `/planlegger/`'s empty week can be a
 * studieretning question, an unpublished semester, a failed fetch with a retry,
 * or "none of your courses are taught this term" — every one of those depends
 * on plan state no shared controller should learn. `message()` and `card()` are
 * where the page puts its own sentence; this module decides only where it
 * stands and that the reservation is released under it.
 *
 * ## One rule for dating, derived rather than passed
 *
 * `todayNumber` and the day-of-month numerals both come from
 * `input.teachingWeeks` here, not from the caller. The rule is DESIGN §9's:
 * inside the teaching period a column header carries its date and today gets
 * its disc, outside it the numerals come off and the week is a MØNSTERUKE. Three
 * callers computing that separately is three chances to disagree about whether
 * the week on screen is a particular one.
 *
 * ## The reservation is a lease, and its key is (surface, view, width)
 *
 * `--planner-box` used to hold one height per view, guarded by an id selector
 * so the planner's remembered Liste height could never reach a one-course
 * course page. The guard is in the KEY instead: a height measured on a
 * five-course plan is not evidence about a one-course surface, and the
 * selector no longer has to say so.
 */
import { isoWeekNumber, isoWeekStart, weekdayDates } from "../../lib/planner/weekDates.js";
import { type BlockPopoverHandle, mountBlockPopover, type SessionChoice } from "./blockPopover.js";
import { renderBoard, syncBoardNow } from "./board.js";
import { renderColumnGrid, syncColumnNow } from "./columnGrid.js";
import { el, MONTH_ABBR } from "./dom.js";
import { beginLayerChange } from "./layerMotion.js";
import type { PlanCourseState } from "./types.js";
import {
  type BlockDetail,
  renderWeekMessage,
  setScrollFade,
  type WeekNotesResult,
  weekNotes,
} from "./weekNotes.js";
import { renderWeekSkeleton } from "./weekSkeleton.js";

/**
 * Which way the week is drawn.
 *
 * The stored values stay as they are: that is what a student's localStorage
 * already holds and what the pre-paint probe must agree with. "kolonner" is the
 * calendar; "tavle" is the list.
 */
export type WeekView = "kolonner" | "tavle";

/** Which page is drawing. The reservation key's first component. */
export type WeekSurface = "planner" | "emne";

const WEEK_VIEWS: readonly WeekView[] = ["kolonner", "tavle"];

const WEEK_VIEW_KEY = "np:weekView";
const WEEK_BOX_KEY = "np:weekBox";

/**
 * How far a remembered height may be from the width it was measured at before
 * it stops being evidence. Mirrored in `Layout.astro`'s probe.
 */
const WEEK_BOX_TOLERANCE = 32;

/** Left inset the column view's sticky hour rail occupies, in px. */
const RAIL_WIDTH_PX = 48;

/**
 * The remembered view. A preference, not plan state: localStorage rather than
 * the URL, so it follows the student without riding along on a shared link.
 *
 * Storage can throw (Safari private mode) and can hold anything, so both
 * directions are total: an unrecognised value reads as the calendar.
 */
export function loadWeekView(): WeekView {
  try {
    const stored = localStorage.getItem(WEEK_VIEW_KEY);
    return WEEK_VIEWS.find((view) => view === stored) ?? "kolonner";
  } catch {
    return "kolonner";
  }
}

function saveWeekView(view: WeekView): void {
  try {
    localStorage.setItem(WEEK_VIEW_KEY, view);
  } catch {
    // A student who cannot persist the choice still gets to make it.
  }
  // The reservation for the NEXT load reads this off `<html>`; a soft
  // navigation away and back would otherwise arrive holding the old view's
  // height (planner-week.css).
  document.documentElement.setAttribute("data-view", view);
}

type WeekBoxes = Record<string, Record<string, [number, number]>>;

function readBoxes(): WeekBoxes {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(WEEK_BOX_KEY) ?? "{}");
    return raw !== null && typeof raw === "object" ? (raw as WeekBoxes) : {};
  } catch {
    return {};
  }
}

/**
 * How tall this browser's week actually came out, per surface and per view,
 * with the width it was measured at:
 * `{ "planner": { "tavle": [390, 891] } }`.
 *
 * The views have unrelated geometries — Uke is drawn hours × an hour's height,
 * Liste is a session count — so a frame cannot reserve one height for both, and
 * reserving the other view's is worse than reserving nothing (0.14 CLS when
 * that was measured). Uke can be computed; Liste cannot, because nothing before
 * the fetch knows the session count. So the page measures itself and
 * `Layout.astro`'s pre-paint probe hands the number back as `--planner-box`
 * before the next first frame.
 *
 * The SURFACE is in the key because a five-course planner and a one-course
 * course page are not evidence about each other. The WIDTH is in it because a
 * list measured at 390 px wraps differently at 1440.
 */
export function saveWeekBox(
  surface: WeekSurface,
  view: WeekView,
  width: number,
  height: number,
): void {
  if (!(height > 0)) return;
  try {
    const boxes = readBoxes();
    const forSurface = boxes[surface] ?? {};
    const previous = forSurface[view];
    const next: [number, number] = [Math.round(width), Math.round(height)];
    // Nothing to write on most renders — the week is re-rendered on every plan
    // edit, group pick and layer toggle.
    if (previous && previous[0] === next[0] && previous[1] === next[1]) return;
    forSurface[view] = next;
    boxes[surface] = forSurface;
    localStorage.setItem(WEEK_BOX_KEY, JSON.stringify(boxes));
  } catch {
    // A student who cannot persist it still gets the page, just without the
    // reservation on the next load.
  }
}

/** The remembered height, or `null` when there is none this width can use. */
export function loadWeekBox(surface: WeekSurface, view: WeekView, width: number): number | null {
  const entry = readBoxes()[surface]?.[view];
  if (!Array.isArray(entry) || !(entry[1] > 0)) return null;
  return Math.abs(entry[0] - width) <= WEEK_BOX_TOLERANCE ? entry[1] : null;
}

/**
 * WHICH WEEKS ARE DRAWN.
 *
 * `"alle"` is the mønsteruke — every session of the semester collapsed into one
 * week, which is what this page has always drawn and what the before-semester
 * job wants. `"denne"` follows the calendar rather than pinning a number, so a
 * page left open overnight rolls with the date the way the now marker already
 * does. A number is one ISO week, chosen.
 *
 * NOT PERSISTED and not in the URL, unlike the view: one link has to show two
 * people the same week, and a remembered scope would need a fourth fact in the
 * pre-paint probe to avoid drawing the wrong height for a frame.
 */
export type WeekScope = "alle" | "denne" | number;

export interface WeekViewOptions {
  /** The scroll container the week is drawn into. */
  frame: HTMLElement;
  /** Where the margin notes go. */
  notes: HTMLElement;
  /**
   * The `WeekControls.astro` block this week's controls live in, or null on a
   * surface that draws a week with no controls at all.
   *
   * All three are owned here rather than by each page: the state, the clicks,
   * the layer choreography, the count and the auto-reveal mirroring were
   * written out twice and had already diverged in look. One control, one
   * behaviour, wherever a week is drawn. The block is found by `data-role`
   * inside it, so nothing here depends on an id and three surfaces can carry
   * three copies.
   */
  controls: HTMLElement | null;
  surface: WeekSurface;
  /**
   * The popover's way out to the editor. `null` on a surface with no editor to
   * open — `/emne/[code]/` is one course's reference page and it is
   * somebody else's plan — and the card then carries facts and no button.
   */
  onOpenSettings?: ((code: string) => void) | null;
  /**
   * What the edit button may promise, from the editor's own material. Only a
   * surface that HAS an editor can answer, so the default is the weakest true
   * answer: the course itself, and no claim about alternatives.
   */
  popoverContext?: (detail: BlockDetail) => { choice: SessionChoice; lectureAlternatives: number };
  /** A margin note naming a course narrowed on a guess was clicked. */
  onChoiceClick?: (code: string) => void;
  /**
   * Something changed that this module cannot redraw on its own. `"view"` is a
   * tab press, `"layer"` the øving box, `"viewport"` the column cap's boundary,
   * `"week"` the week picker, `"day"` the date rolling under a page left open.
   *
   * The caller re-renders SYNCHRONOUSLY here — the layer change snapshots the
   * week before this call and settles it after, and a re-render that happens
   * later than that travels nothing.
   */
  onRerender?: (reason: "view" | "layer" | "week" | "viewport" | "day") => void;
  /**
   * What "today" the week is drawn for. The default is the local weekday, which
   * is what the week itself depends on; `/planlegger/` overrides it because its
   * exam countdowns roll on the calendar date in Oslo and the two can differ.
   */
  dayStamp?: () => string;
  signal: AbortSignal;
}

export interface WeekRenderInput {
  /** The semester's weeks. Also what decides whether the week is dated. */
  teachingWeeks: number[];
  /**
   * The calendar year those weeks belong to, so a chosen week can name its own
   * Monday. Defaults to this year, which is right for every caller that has not
   * got a semester yet — they have no teaching weeks either, so nothing is
   * dated.
   */
  year?: number;
  /** Every parallel and every group — `/emne/[code]/`'s rule. */
  showAllGroups?: boolean;
  /** A bundle fetch is in flight: draw a pending week, not an empty one. */
  loading?: boolean;
  /** The plan is waiting on a studieretning/campus answer. */
  pendingChoiceMessage?: string | null;
}

export interface WeekRenderResult extends WeekNotesResult {
  /** Sessions drawn. 0 with `state === "grid"` means the layer hid everything. */
  blockCount: number;
}

export interface WeekViewHandle {
  render(states: PlanCourseState[], input: WeekRenderInput): WeekRenderResult;
  /** Whether the øving/lab layer is on. The page's own copy of this is gone. */
  readonly showOthers: boolean;

  /** A sentence where the week would be. `null` clears the frame entirely. */
  message(text: string | null): void;
  /** A centred card where the week would be, for the states that carry a verb. */
  card(build: (card: HTMLElement) => void): void;
  /** Ends the frame's reservation and files what the week measured. */
  settle(): void;
  readonly view: WeekView;
}

export function mountWeekView(options: WeekViewOptions): WeekViewHandle {
  const { frame, notes, surface, signal } = options;
  const onOpenSettings = options.onOpenSettings ?? null;

  // The three controls, found once inside the block the page rendered. A
  // surface with no controls (none today, but the week itself does not require
  // any) simply gets nulls and every handler below no-ops.
  const controls = options.controls;
  const pick = <T extends HTMLElement>(role: string): T | null =>
    controls?.querySelector<T>(`[data-role="${role}"]`) ?? null;

  const weekSelect = pick<HTMLSelectElement>("week-select");
  const layerToggle = pick<HTMLButtonElement>("layer-toggle");
  const tabsHost = pick<HTMLElement>("view-tabs");
  const tabButtons = tabsHost
    ? Array.from(tabsHost.querySelectorAll<HTMLButtonElement>(".planner-view-tab[data-view]"))
    : [];

  let view: WeekView = loadWeekView();
  /**
   * Set by a view switch and consumed by the next render, the only one allowed
   * to play the strike-in. A plan edit re-renders the week too, and replaying
   * the animation there would be entrance choreography (DESIGN §7).
   */
  let pendingViewAnimation = false;
  /** The states the last render drew, so the popover can find their hues. */
  let drawnStates: PlanCourseState[] = [];
  /**
   * The year the last render's weeks belong to, so the popover's `ntnu.no` link
   * points at the page for the term being drawn rather than at whatever NTNU
   * considers current. Undefined until the first render, which is before any
   * block exists to press.
   */
  let drawnYear: number | undefined;

  // The popover is mounted on every surface: it is a READ card — the facts of
  // the session you pointed at — and a reference page owes a visitor exactly
  // that. Only the way OUT of it is conditional.
  const popover: BlockPopoverHandle = mountBlockPopover(onOpenSettings, signal);

  function openBlockPopover(detail: BlockDetail, anchor: HTMLElement): void {
    const state = drawnStates.find((s) => s.course.code === detail.code);
    const extra = options.popoverContext?.(detail) ?? {
      choice: "course" as SessionChoice,
      lectureAlternatives: 0,
    };
    popover.showFor(
      {
        detail,
        hueVar: state?.hueVar ?? "--muted",
        courseName: state?.bundle?.details?.courseName ?? state?.course.name ?? detail.name,
        year: drawnYear,
        ...extra,
      },
      anchor,
    );
  }

  // --- The scroll edge ------------------------------------------------------

  /** The edge fades only when a day really is off-frame. */
  function syncScroll(): void {
    const week =
      frame.querySelector<HTMLElement>(".planner-cols") ??
      frame.querySelector<HTMLElement>(".planner-board");
    const hidden = week ? week.getBoundingClientRect().width - frame.clientWidth : 0;
    if (hidden <= 1) {
      delete frame.dataset.scroll;
      return;
    }
    const maxScroll = frame.scrollWidth - frame.clientWidth;
    const left = frame.scrollLeft;
    frame.dataset.scroll = left <= 1 ? "start" : left >= maxScroll - 1 ? "end" : "middle";
    setScrollFade(frame, left, maxScroll);
  }

  frame.addEventListener("scroll", syncScroll, { passive: true, signal });
  window.addEventListener("resize", syncScroll, { passive: true, signal });

  // The week's column cap is viewport-dependent, and crossing that boundary — a
  // rotation, a window drag — changes no plan state, so nothing else would
  // redraw the week. Only the boundary fires, not every resize frame.
  globalThis
    .matchMedia?.("(max-width: 40rem)")
    .addEventListener("change", () => options.onRerender?.("viewport"), { signal });

  function prefersReducedMotion(): boolean {
    return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }

  /**
   * Once per mount: put something WORTH SEEING in view rather than always
   * Monday's column.
   *
   * Today when today has sessions (a student mid-semester is asking about
   * today), otherwise the first day that has any, otherwise leave it alone.
   * Scrolling to today unconditionally opened a plan whose only sessions are on
   * Friday as an empty grid through the whole pre-semester planning window,
   * which is when this tool is used at all.
   */
  let didScrollWeek = false;

  function scrollWeekIntoView(): void {
    if (didScrollWeek) return;
    if (frame.scrollWidth - frame.clientWidth <= 1) return;
    // `Array.from`, not a spread: this module is reachable from the Node
    // typecheck pass (tsconfig.test.json), whose `lib` has no `DOM.Iterable`.
    const columns = Array.from(frame.querySelectorAll<HTMLElement>(".planner-cols-day[data-day]"));
    const withSessions = columns
      .filter((column) => column.querySelector(".planner-cols-block") !== null)
      .map((column) => Number(column.dataset.day))
      .filter((day) => Number.isFinite(day))
      .sort((a, b) => a - b);
    if (withSessions.length === 0) return;
    const weekday = new Date().getDay(); // 0 = Sunday
    const today = weekday === 0 ? 7 : weekday;
    const target = withSessions.includes(today) ? today : (withSessions[0] as number);
    const header = frame.querySelector<HTMLElement>(
      `.planner-cols-day-header[data-day="${target}"]`,
    );
    if (!header) return;
    didScrollWeek = true;
    const offset = header.getBoundingClientRect().left - frame.getBoundingClientRect().left;
    frame.scrollTo({
      left: Math.max(0, frame.scrollLeft + offset - RAIL_WIDTH_PX),
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  // --- Uke ⇄ Liste ----------------------------------------------------------

  /**
   * The pressed state, and the rule that travels to it.
   *
   * Offsets are measured rather than declared because the labels are different
   * widths in every face and at every zoom step. Guarded on `offsetWidth`
   * because the unit suite renders into a DOM with no layout: there the tabs
   * still get `aria-pressed` and the decoration with nothing to measure is
   * skipped.
   */
  function renderTabs(): void {
    if (!tabsHost) return;
    let active: HTMLElement | null = null;
    for (const button of tabButtons) {
      const on = button.dataset.view === view;
      button.setAttribute("aria-pressed", String(on));
      if (on) active = button;
    }
    if (!active || typeof active.offsetWidth !== "number" || active.offsetWidth === 0) return;
    tabsHost.style.setProperty("--view-w", `${active.offsetWidth}px`);
    tabsHost.style.setProperty("--view-x", `${active.offsetLeft}px`);
  }

  function setWeekView(next: WeekView): void {
    if (view === next) return;
    view = next;
    saveWeekView(next);
    pendingViewAnimation = true;
    // The lease is released on the way OUT of a view: `--planner-box` holds the
    // height of the view the page LOADED in, and leaving it standing over the
    // other view's much shorter week is 600px of white paper for the rest of
    // the visit.
    delete frame.dataset.reserve;
    options.onRerender?.("view");
  }

  // --- Which weeks ----------------------------------------------------------

  /**
   * The chosen scope, and whether the student chose it.
   *
   * The default is not a constant: it is `inTeachingWeek`, the SAME predicate
   * that already decides whether the drawn week carries dates. Inside the
   * teaching period the page is open in a particular week and should show it;
   * outside there is no such week, and the pattern is the only honest answer.
   * Deriving both from one predicate is what stops the picker and the column
   * headers disagreeing about whether this is a real Monday.
   */
  let scope: WeekScope = "alle";
  /** The option set the select currently holds, so a re-render is not a reset. */
  let scopeKey = "";

  /** The scope as a week number, or null for the mønsteruke. */
  function resolvedWeek(): number | null {
    if (scope === "alle") return null;
    if (scope === "denne") return isoWeekNumber(new Date());
    return scope;
  }

  /** "Uke 36, 31. aug" — the number a student reads and the Monday it is. */
  function weekOptionLabel(week: number, year: number): string {
    const monday = isoWeekStart(year, week);
    const month = MONTH_ABBR[monday.getMonth()] ?? "";
    return `Uke ${week}, ${monday.getDate()}. ${month}`;
  }

  /**
   * Fills the picker from the semester on screen.
   *
   * Rebuilt only when the option set actually changes, because `render` runs on
   * every plan edit and every group pick — rewriting the `<select>` there would
   * throw away the student's choice mid-interaction. A change of option set IS
   * a change of semester, and a week number from the term you just left is not
   * a choice worth carrying, so that case resets the scope to the default.
   */
  function renderWeekOptions(teachingWeeks: number[], year: number): void {
    if (!weekSelect) return;
    const key = `${year}:${teachingWeeks.join(",")}`;
    if (key === scopeKey) return;
    scopeKey = key;
    scope = inTeachingWeek(teachingWeeks) ? "denne" : "alle";

    const options: HTMLOptionElement[] = [];
    const add = (value: string, label: string): void => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      options.push(option);
    };
    // «Denne uka» first while there is one: it is the default then, and a
    // select's first row is where a student looks for the state it is in.
    if (inTeachingWeek(teachingWeeks)) add("denne", "Denne uka");
    add("alle", "Alle uker");
    for (const week of [...teachingWeeks].sort((a, b) => a - b)) {
      add(String(week), weekOptionLabel(week, year));
    }
    weekSelect.replaceChildren(...options);
    weekSelect.value = String(scope);
  }

  function setWeekScope(next: WeekScope): void {
    if (scope === next) return;
    scope = next;
    if (weekSelect) weekSelect.value = String(next);
    // The same lease rule the view switch obeys, for the same reason: a week
    // with three sessions in it is not the height the frame is holding for a
    // week with eleven, and in Liste the difference is hundreds of pixels.
    delete frame.dataset.reserve;
    options.onRerender?.("week");
  }

  if (weekSelect) {
    weekSelect.addEventListener(
      "change",
      () => {
        const raw = weekSelect.value;
        const week = Number(raw);
        setWeekScope(Number.isFinite(week) && raw !== "" ? week : (raw as WeekScope));
      },
      { signal },
    );
  }

  // --- The øving layer ------------------------------------------------------

  /**
   * Whether the muted layer is drawn. NOT persisted: it is a question about the
   * week in front of you rather than a preference, and a remembered one would
   * open every future week already flooded.
   */
  let showOthers = false;

  if (layerToggle) {
    layerToggle.addEventListener(
      "click",
      () => {
        showOthers = !showOthers;
        layerToggle.setAttribute("aria-pressed", String(showOthers));
        // One layer arriving or leaving, not a new week: what was already on
        // screen travels, what changed is what moves. The snapshot has to be
        // taken before the re-render tears the subtree down, hence the two
        // calls around it.
        const settle = beginLayerChange(frame, showOthers ? "reveal" : "hide");
        options.onRerender?.("layer");
        settle();
      },
      { signal },
    );
  }

  /**
   * The control's whole state: pressed, and what the layer is still waiting on.
   *
   * The layer draws PICKED groups only, and that narrowing is right — drawing
   * every group of every course put 41 blocks in one week (`visibleLayer`). But
   * it made the control dishonest: on a five-course plan, ticking «Øvinger og
   * labber» added two blocks, because the four courses with a real choice in
   * them drew nothing at all. A toggle that visibly does nothing reads as "I
   * have no øvinger", which is the opposite of true.
   *
   * So the control carries the count, and the margin keeps naming the courses
   * and staying clickable. Only while the layer is ON: beside an unticked box
   * "3 mangler gruppe" would be a fact about something not on screen.
   */
  function renderLayerState(result: WeekNotesResult): void {
    if (!layerToggle) return;
    // B7a: the week can reveal the muted layer on its own when nothing
    // classifies as a lecture, and the control has to describe what is on
    // screen. Not the student's `showOthers` — mirrored, never persisted.
    layerToggle.setAttribute("aria-pressed", String(showOthers || result.mutedLayerAutoRevealed));
    const host = layerToggle.querySelector<HTMLElement>('[data-role="layer-pending"]');
    if (!host) return;
    const codes = result.pendingGroupCourses;
    if (!showOthers || codes.length === 0) {
      host.replaceChildren();
      host.hidden = true;
      return;
    }
    host.replaceChildren(el("span", "np-data", String(codes.length)), " mangler gruppe");
    host.hidden = false;
  }

  if (tabsHost) {
    for (const button of tabButtons) {
      const next = button.dataset.view;
      if (next !== "kolonner" && next !== "tavle") continue;
      button.addEventListener("click", () => setWeekView(next), { signal });
    }
    // The travelling rule is measured, so re-measure whenever the measurement
    // could change.
    window.addEventListener("resize", renderTabs, { passive: true, signal });
    document.fonts?.ready.then(() => renderTabs());
    renderTabs();
  }

  // --- The clock ------------------------------------------------------------
  //
  // A week is something people leave open. The now marker is nudged every
  // minute, but WHICH DAY IT IS has to be re-read too, or a page left open
  // overnight keeps yesterday's column washed while the marker has stepped into
  // today.

  let todayNumber: number | null = null;

  const stampOf = options.dayStamp ?? (() => String(new Date().getDay()));
  /**
   * Read on the first TICK, never at the mount. A caller's stamp may depend on
   * state it is still building when it mounts the week — `/planlegger/`'s reads
   * the plan's semester — and a controller that forces a caller to mount it in
   * one particular order is a controller with an invisible contract.
   */
  let dayStamp: string | null = null;

  function tickNow(): void {
    const stamp = stampOf();
    if (dayStamp !== null && stamp !== dayStamp) {
      dayStamp = stamp;
      options.onRerender?.("day");
      return;
    }
    dayStamp = stamp;
    // The ordinary minute: one element moves, nothing re-renders. Both views
    // are asked; each no-ops when it is not the one on screen.
    syncColumnNow(frame);
    syncBoardNow(frame, todayNumber);
  }

  const nowTimer = setInterval(tickNow, 60_000);
  signal.addEventListener("abort", () => clearInterval(nowTimer));
  // A sleeping laptop runs no timers, and returning to the tab is exactly when
  // a stale day gets looked at.
  document.addEventListener(
    "visibilitychange",
    () => {
      if (document.visibilityState === "visible") tickNow();
    },
    { signal },
  );

  // --- The lease ------------------------------------------------------------

  /**
   * Ends the frame's reservation, and files what the week actually measured for
   * the next load to reserve from.
   *
   * The lease is the important half: every reserved number is an estimate of a
   * week that has not been drawn, and leaving it standing is how loading in
   * Liste and then pressing the other tab left 600px of white paper.
   *
   * Three states are deliberately neither released nor remembered: a skeleton,
   * an apology and a card are all shorter than the week they stand in for, so
   * releasing collapses the frame just before the real week fills it and
   * remembering under-reserves the next load. A week mid-`is-settling` is not
   * evidence either — measuring it files a frame of an animation.
   */
  function settle(): void {
    const inner = frame.firstElementChild as HTMLElement | null;
    if (!inner) return;
    if (
      inner.classList.contains("is-skeleton") ||
      inner.classList.contains("is-settling") ||
      inner.classList.contains("planner-grid-empty") ||
      inner.classList.contains("planner-week-card")
    ) {
      return;
    }
    // Synchronously, in the frame the week landed in: the content is at least
    // as tall as the reservation except in the cases this releases ON PURPOSE,
    // and those should collapse now rather than a paint later.
    delete frame.dataset.reserve;
    // Only a frame the SERVER rendered can be handed a remembered height before
    // paint. `/planlegger/` has one — the planner's
    // shell became static when it stopped building its own page — so both file.
    // `/emne/[code]/` builds its frame after a fetch, so what holds its space is
    // a placeholder standing in for the whole section: a different box, with its
    // own measured per-view numbers in that page, and filing a number here for
    // it would be filing one nothing reads.
    //
    // The SURFACE in the key is what keeps the two honest about each other: a
    // five-course planner's Liste height is not evidence about a shared
    // one-course plan, and that failure is exactly what the key replaced.
    if (surface === "emne") return;
    // The measurement waits for layout, and only counts if this is still the
    // element that was drawn.
    requestAnimationFrame(() => {
      if (!inner.isConnected) return;
      saveWeekBox(surface, view, window.innerWidth, inner.getBoundingClientRect().height);
    });
  }

  // --- Drawing --------------------------------------------------------------

  /**
   * Is the page open inside a week the semester actually teaches?
   *
   * The drawn week's dates depend on this. A date numeral is a claim about
   * which Monday a column is, and that claim is true INSIDE the teaching
   * period. Outside it there is no Monday to name — the week is a pattern and
   * nothing else — so the numerals come off.
   */
  function inTeachingWeek(weeks: number[]): boolean {
    return weeks.length > 0 && weeks.includes(isoWeekNumber(new Date()));
  }

  function render(states: PlanCourseState[], input: WeekRenderInput): WeekRenderResult {
    drawnStates = states;
    const year = input.year ?? new Date().getFullYear();
    drawnYear = year;
    renderWeekOptions(input.teachingWeeks, year);

    const week = resolvedWeek();
    const thisWeek = isoWeekNumber(new Date());
    // A CHOSEN WEEK IS ALWAYS A REAL ONE, so it carries its Monday's numerals
    // whether or not today falls inside the teaching period — that is the whole
    // of what choosing it means. The mønsteruke keeps the old rule: dated only
    // while the page is open inside the period it is a pattern for.
    const dated = week !== null || inTeachingWeek(input.teachingWeeks);
    const dates =
      week !== null
        ? weekdayDates(isoWeekStart(year, week))
        : dated
          ? weekdayDates(new Date())
          : null;
    // The disc marks TODAY, so it only appears in the week today is in.
    const weekday = new Date().getDay();
    const showsToday = week === null ? dated : week === thisWeek;
    todayNumber = showsToday && weekday >= 1 && weekday <= 6 ? weekday : null;

    // The notes read the WHOLE semester, never the drawn week. A collision in
    // week 40 is a fact about the plan, and narrowing the notes with the grid
    // would hide it from a student looking at week 36 — while the note itself
    // already names the weeks it happens in, which is what makes it safe to
    // leave standing beside a week that does not show it.
    const result = weekNotes(notes, states, showOthers, {
      loading: input.loading ?? false,
      pendingChoiceMessage: input.pendingChoiceMessage ?? null,
      showAllGroups: input.showAllGroups ?? false,
      ...(options.onChoiceClick ? { onChoiceClick: options.onChoiceClick } : {}),
    });

    renderLayerState(result);

    if (result.state === "loading") {
      renderWeekSkeleton(frame, view);
      pendingViewAnimation = false;
      renderTabs();
      return { ...result, blockCount: 0 };
    }
    if (result.state !== "grid") {
      renderWeekMessage(frame, notes, result.message);
      pendingViewAnimation = false;
      renderTabs();
      return { ...result, blockCount: 0 };
    }

    frame.removeAttribute("aria-busy");
    const shared = {
      todayNumber,
      animate: pendingViewAnimation,
      showAllGroups: input.showAllGroups ?? false,
      onBlockClick: openBlockPopover,
      // Both views read their entries through `collectSessions`, so the
      // narrowing is one option on one function rather than a second filter
      // each view could implement differently.
      ...(week !== null ? { week } : {}),
    };
    // The layer the grid may have revealed on its own counts as shown, or the
    // week and the control disagree about what is on screen.
    const drawOthers = showOthers || result.mutedLayerAutoRevealed;
    const blockCount =
      view === "tavle"
        ? renderBoard(frame, states, input.teachingWeeks, drawOthers, shared).rowCount
        : renderColumnGrid(frame, states, input.teachingWeeks, drawOthers, {
            ...shared,
            // Undefined leaves the columns drawing bare weekday names, which is
            // what a pattern week is.
            ...(dates ? { dates } : {}),
          }).blockCount;

    // A CHOSEN WEEK CAN BE EMPTY, and that is an answer rather than a failure.
    // The reservation goes with it: this is terminal, unlike the skeleton and
    // the apologies `settle` deliberately holds the frame open under, so a
    // one-line sentence must not sit below 500px of held paper.
    if (blockCount === 0 && week !== null) {
      delete frame.dataset.reserve;
      frame.replaceChildren(
        el("p", "planner-grid-empty np-hint", `Ingen undervisning i uke ${week}.`),
      );
      pendingViewAnimation = false;
      renderTabs();
      return { ...result, blockCount: 0 };
    }

    pendingViewAnimation = false;
    renderTabs();
    syncScroll();
    if (!input.loading) {
      // Only once the bundles are in. A week drawn mid-fetch is drawn on
      // PROVISIONAL geometry, and the re-render when the rest lands replaces
      // the DOM, which resets `scrollLeft` and strands a smooth scroll.
      scrollWeekIntoView();
      settle();
    }
    return { ...result, blockCount };
  }

  return {
    render,
    get showOthers(): boolean {
      return showOthers;
    },

    message(text: string | null): void {
      renderWeekMessage(frame, notes, text);
    },
    card(build: (card: HTMLElement) => void): void {
      renderWeekMessage(frame, notes, null);
      const node = el("div", "planner-week-card");
      build(node);
      frame.append(node);
    },
    settle,
    get view(): WeekView {
      return view;
    },
  };
}

/**
 * The layer change, choreographed. Exported so a surface's own "vis øvinger"
 * switch runs the same animation the planner's does — it is one control and it
 * cannot behave two ways per page.
 */
export { beginLayerChange };
