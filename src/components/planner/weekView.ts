/**
 * THE WEEK, as one thing a page mounts.
 *
 * Three surfaces draw a week — `/planlegger/`, `/emne/[code]/` and
 * `/user/<navn>` — and for a while they drew two different ones: the planner
 * moved to KOLONNER and LISTE while the other two stayed on the transposed
 * geometry, which had been deleted as a view but kept alive as a module. This
 * is where that ends. One controller owns the view state, the tab pair, the
 * scroll edge, the now marker, the session popover and the choice between the
 * two renderers; a page hands it states and gets a week.
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
 * course page. Three surfaces share two views now, so the guard moved into the
 * KEY: a height measured on a five-course plan is not evidence about a
 * one-course page, and the selector no longer has to say so.
 */
import type { ConflictGroup } from "../../lib/planner/conflicts.js";
import { isoWeekNumber, weekdayDates } from "../../lib/planner/weekDates.js";
import { type BlockPopoverHandle, mountBlockPopover, type SessionChoice } from "./blockPopover.js";
import { renderBoard, syncBoardNow } from "./board.js";
import { renderColumnGrid, syncColumnNow } from "./columnGrid.js";
import { el } from "./dom.js";
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
export type WeekSurface = "planner" | "emne" | "user";

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

export interface WeekViewOptions {
  /** The scroll container the week is drawn into. */
  frame: HTMLElement;
  /** Where the margin notes go. */
  notes: HTMLElement;
  /** The Uke/Liste pair the page server-rendered, or null where it has none. */
  tabs: { kolonner: HTMLButtonElement; tavle: HTMLButtonElement } | null;
  surface: WeekSurface;
  /**
   * The popover's way out to the editor. `null` on a surface with no editor to
   * open — `/emne/[code]/` is one course's reference page and `/user/<navn>` is
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
   * tab press, `"viewport"` the column cap's boundary, `"day"` the date rolling
   * under a page left open.
   */
  onRerender?: (reason: "view" | "viewport" | "day") => void;
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
  showOthers: boolean;
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
  /** A sentence where the week would be. `null` clears the frame entirely. */
  message(text: string | null): void;
  /** A centred card where the week would be, for the states that carry a verb. */
  card(build: (card: HTMLElement) => void): void;
  /** Ends the frame's reservation and files what the week measured. */
  settle(): void;
  readonly view: WeekView;
}

export function mountWeekView(options: WeekViewOptions): WeekViewHandle {
  const { frame, notes, tabs, surface, signal } = options;
  const onOpenSettings = options.onOpenSettings ?? null;

  let view: WeekView = loadWeekView();
  /**
   * Set by a view switch and consumed by the next render, the only one allowed
   * to play the strike-in. A plan edit re-renders the week too, and replaying
   * the animation there would be entrance choreography (DESIGN §7).
   */
  let pendingViewAnimation = false;
  /** The states the last render drew, so a conflict note can find their hues. */
  let drawnStates: PlanCourseState[] = [];

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

  // --- The collision note's target -----------------------------------------

  /**
   * Flashes the sessions a margin note names.
   *
   * The note is built by `weekNotes`, which never sees a DOM node, so the
   * resolution happens here against whatever is actually mounted. Blocks carry
   * `data-motion-key` — `code|day|start|end|label#n` — in both views, and a
   * conflict group knows the first four, so the prefix is the join.
   */
  function flashConflict(group: ConflictGroup): void {
    const wanted = new Set(
      group.entries.map((e) => `${e.courseCode}|${e.dayNumber}|${e.startTime}|${e.endTime}|`),
    );
    const nodes = Array.from(frame.querySelectorAll<HTMLElement>("[data-motion-key]")).filter(
      (node) => {
        const key = node.dataset.motionKey ?? "";
        for (const prefix of wanted) if (key.startsWith(prefix)) return true;
        return false;
      },
    );
    const [first] = nodes;
    // Asked directly: the duration tokens can zero a CSS transition, but they
    // cannot reach a scripted scroll (DESIGN §7).
    first?.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
    for (const node of nodes) {
      node.classList.remove("np-target-flash");
      // Force reflow so re-adding the class restarts the animation.
      void node.offsetWidth;
      node.classList.add("np-target-flash");
    }
    first?.focus({ preventScroll: true });
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
    if (!tabs) return;
    let active: HTMLElement | null = null;
    for (const [button, name] of [
      [tabs.kolonner, "kolonner"],
      [tabs.tavle, "tavle"],
    ] as const) {
      const on = view === name;
      button.setAttribute("aria-pressed", String(on));
      if (on) active = button;
    }
    const host = tabs.kolonner.parentElement;
    if (!host || !active || typeof active.offsetWidth !== "number" || active.offsetWidth === 0) {
      return;
    }
    host.style.setProperty("--view-w", `${active.offsetWidth}px`);
    host.style.setProperty("--view-x", `${active.offsetLeft}px`);
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

  if (tabs) {
    tabs.kolonner.addEventListener("click", () => setWeekView("kolonner"), { signal });
    tabs.tavle.addEventListener("click", () => setWeekView("tavle"), { signal });
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
    const dated = inTeachingWeek(input.teachingWeeks);
    const weekday = new Date().getDay();
    todayNumber = dated && weekday >= 1 && weekday <= 6 ? weekday : null;

    const result = weekNotes(notes, states, input.showOthers, {
      loading: input.loading ?? false,
      pendingChoiceMessage: input.pendingChoiceMessage ?? null,
      showAllGroups: input.showAllGroups ?? false,
      ...(options.onChoiceClick ? { onChoiceClick: options.onChoiceClick } : {}),
      onConflictClick: flashConflict,
    });

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
    };
    const blockCount =
      view === "tavle"
        ? renderBoard(frame, states, input.teachingWeeks, input.showOthers, shared).rowCount
        : renderColumnGrid(frame, states, input.teachingWeeks, input.showOthers, {
            ...shared,
            // Undefined leaves the columns drawing bare weekday names, which is
            // what a pattern week is.
            ...(dated ? { dates: weekdayDates(new Date()) } : {}),
          }).blockCount;

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
