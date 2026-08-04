/**
 * What the frame holds while the bundles are in flight.
 *
 * It exists for the same reason the frame's `min-height` does: the step from
 * "nothing" to "a week" is the largest layout shift on any page that draws one,
 * and `/user/<navn>` renders with `loading: true` for the whole of its first
 * round-trip — it has to fetch every course in a plan it just parsed out of the
 * URL before it knows a single session.
 *
 * The shapes are deliberately dumb. The point is that the box is the right size
 * and visibly pending, not that it predicts the week. Both skeletons are built
 * out of the REAL view's classes, so the geometry comes from the one stylesheet
 * rather than from a second set of numbers here.
 *
 * No shimmer, no pulse: DESIGN §7 has no entrance choreography, and a breathing
 * week is exactly that.
 */
import { el } from "./dom.js";

/** Hours the column skeleton draws. Also what the reservation computes from. */
export const SKELETON_HOURS = 8;
/** Weekdays it draws, before it knows whether Saturday is needed. */
export const SKELETON_DAYS = 5;
/** Rows the list skeleton draws — one per weekday, same as the real Liste. */
const SKELETON_ROWS = 5;

/**
 * Draws a pending week of `view` into `frame`, replacing whatever is there.
 *
 * `aria-busy` rather than a live-region message: the status line above the
 * frame is what announces the fetch, and a second announcement from the box
 * behind it says the same thing twice.
 */
export function renderWeekSkeleton(frame: HTMLElement, view: "kolonner" | "tavle"): void {
  frame.setAttribute("aria-busy", "true");
  frame.replaceChildren(view === "tavle" ? buildListSkeleton() : buildColumnSkeleton());
}

function buildColumnSkeleton(): HTMLElement {
  const grid = el("div", "planner-cols is-skeleton");
  grid.setAttribute("data-days", String(SKELETON_DAYS));
  grid.setAttribute("aria-hidden", "true");
  grid.style.setProperty("--planner-hours", String(SKELETON_HOURS));
  // One lane, no drop-in strips: the narrowest honest column, so the real week
  // can only ever grow into this box rather than out of it.
  grid.style.setProperty("--planner-lanes-max", "1");
  grid.style.setProperty("--planner-allday-h", "0px");

  // The corner above the rail carries nothing, but it has to exist or every
  // header lands one track to the left of its own column.
  grid.append(el("div", "planner-cols-corner"));
  for (let day = 1; day <= SKELETON_DAYS; day++) {
    grid.append(el("div", "planner-cols-day-header"));
  }
  grid.append(el("div", "planner-cols-allday-corner"));
  for (let day = 1; day <= SKELETON_DAYS; day++) {
    grid.append(el("div", "planner-cols-allday"));
  }
  grid.append(el("div", "planner-cols-rail"));
  for (let day = 1; day <= SKELETON_DAYS; day++) {
    const column = el("div", "planner-cols-day");
    column.append(el("div", "planner-cols-lanes"));
    grid.append(column);
  }
  return grid;
}

function buildListSkeleton(): HTMLElement {
  const board = el("div", "planner-board is-skeleton");
  board.setAttribute("aria-hidden", "true");
  for (let row = 0; row < SKELETON_ROWS; row++) {
    board.append(el("div", "planner-skeleton-row"));
  }
  return board;
}
