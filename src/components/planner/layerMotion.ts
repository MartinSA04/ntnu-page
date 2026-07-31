/**
 * LAYER MOTION — what happens when the øving/lab layer is switched on or off
 * (REWORK-2026-07-29g).
 *
 * Uke ⇄ Liste has a motion; "vis øvinger og labber" had none, so the same
 * button felt made on one press and broken on the other. It cannot have the
 * *same* motion, though: replaying the strike-in over the whole week because
 * one toggle moved is the entrance choreography DESIGN §6 forbids, and it
 * would claim that lectures which did not change had changed.
 *
 * So the motion says what actually happened — one layer arrived, or one layer
 * left:
 *
 *   - what stays TRAVELS to its new place (it is not redrawn),
 *   - what arrives STRIKES IN, after the space has been made,
 *   - what leaves WIPES OUT first, and the space closes behind it.
 *
 * Nothing crosses. Space opens before anything lands in it; what is leaving is
 * gone before the space closes.
 *
 * The render itself is untouched: `renderGrid`/`renderBoard` still throw the
 * whole subtree away and build a new one. `beginLayerChange` takes a snapshot
 * before that happens and, after it, rewinds the survivors to where they were
 * so CSS can carry them home. That is why this is a wrapper and not a diffing
 * renderer — the renderers stay dumb, and only the one interaction that needs
 * continuity pays for it.
 */
import { el } from "./dom.js";

/** Which direction the layer moved — it decides what goes first. */
export type LayerChange = "reveal" | "hide";

/** Run after the re-render. Always safe to call; may be a no-op. */
export type SettleLayer = () => void;

const NOTHING: SettleLayer = () => {};

/**
 * The longest any stagger here may run, end to end.
 *
 * A week can reveal thirty bars, and thirty × 32 ms is a second of them
 * trickling in — which stops reading as one layer landing and starts reading as
 * a slow page load.
 */
const STAGGER_BUDGET_MS = 620;

/**
 * The step a sequence of `count` things staggers by: its own rhythm, until the
 * sequence is long enough that keeping it would outlast the budget — then the
 * rhythm compresses so everything still lands in time.
 *
 * It replaces a CAP, which is where "Thursday and Friday come in at the same
 * time" came from: capping the INDEX means everything past the ceiling shares
 * one delay, and in a week whose sequence runs day by day that tail is a whole
 * weekday landing on one frame. Squeezing the interval keeps every element's
 * own moment — which is the entire point of a stagger — and bounds the total,
 * which is what the cap was actually for.
 */
export function staggerStep(count: number, base: number): number {
  if (count <= 1) return base;
  return Math.round(Math.min(base, STAGGER_BUDGET_MS / (count - 1)) * 10) / 10;
}

/**
 * When the scaffolding comes down. The CSS owns the real timings (`--dur`);
 * this only has to outlast the longest of them — the last staggered arrival,
 * at roughly `0.8 × dur + STAGGER_BUDGET_MS + 1.6 × dur`.
 */
const CLEANUP_MS = 1100;

/**
 * How long a ghost lives: the last one's staggered wipe, plus a frame or two.
 * Roughly `STAGGER_BUDGET_MS + dur-fast` — see `.planner-motion-ghost`.
 */
const GHOST_MS = 700;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Scripted motion, so `prefers-reduced-motion` has to be asked directly — the
 * duration tokens zero CSS transitions, and there is no token inside
 * `requestAnimationFrame` (the same reasoning as the conflict note's
 * `scrollIntoView`, A5).
 *
 * The `requestAnimationFrame` guard doubles as the test-shim guard: the unit
 * tests render into a hand-rolled DOM that has no frame callbacks, and a
 * choreography is not what those tests are about.
 */
function motionAllowed(): boolean {
  if (typeof requestAnimationFrame !== "function") return false;
  return !(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false);
}

function boxIn(node: HTMLElement, origin: { left: number; top: number }): Box {
  const rect = node.getBoundingClientRect();
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    width: rect.width,
    height: rect.height,
  };
}

/**
 * Places the elements that are no longer in the tree back over the week, at
 * the coordinates they held, so they can leave visibly instead of blinking
 * out. They are a picture of what was there: out of the tab order, out of the
 * accessibility tree, out of the way of the pointer.
 *
 * Coordinates are relative to the week's own box, never the viewport: the
 * margin notes above it can gain a line on the very render this is animating
 * ("EXPH0300 har 9 grupper — velg din" appears exactly when the layer is
 * revealed), which moves the week down the page without moving anything
 * inside it.
 */
function layGhosts(
  host: HTMLElement,
  ghosts: { node: HTMLElement; box: Box }[],
): HTMLElement | null {
  if (ghosts.length === 0) return null;
  const layer = el("div", "planner-motion-ghosts");
  layer.setAttribute("aria-hidden", "true");
  // The departure is the arrival played backwards, and that includes the
  // ORDER: arrivals strike in one after another in reading order, so
  // departures leave one after another in the REVERSE of it — the last bar to
  // land is the first to go. Without this they all vanished on the same frame,
  // which is not a reversed order, it is no order at all.
  host.style.setProperty("--planner-departs", String(ghosts.length - 1));
  ghosts.forEach(({ node, box }, i) => {
    node.style.setProperty("--planner-depart", String(ghosts.length - 1 - i));
    // A bar that arrived on the LAST toggle still wears its arrival mark, and
    // that rule outranks the ghost's: the two bars revealed a moment ago
    // played the entrance again on their way out — clipped away for the first
    // 150 ms, then wiped back in, then cut. Take the mark off before the node
    // is given its exit.
    clearArrival(node);
    node.classList.add("planner-motion-ghost");
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("tabindex", "-1");
    node.style.left = `${box.left}px`;
    node.style.top = `${box.top}px`;
    node.style.width = `${box.width}px`;
    node.style.height = `${box.height}px`;
    layer.append(node);
  });
  host.append(layer);
  return layer;
}

/**
 * Marks an element as arriving and gives it its place in the stagger. Only
 * bars carry a meaningful order — a ruler tick or a newly needed Saturday row
 * just fades in behind them.
 */
function markArrival(node: HTMLElement, index: number): void {
  node.style.setProperty("--planner-arrive", String(index));
  node.classList.add("is-arriving");
}

/** Takes the mark off once it has served — see `layGhosts` for why it must. */
function clearArrival(node: HTMLElement): void {
  node.classList.remove("is-arriving");
  node.style.removeProperty("--planner-arrive");
}

/**
 * The interval this change's arrivals and departures step by.
 *
 * One property for both, from whichever side is longer: a change is one event,
 * and two rhythms inside it would read as two. It is squeezed rather than
 * capped for the reason `staggerStep` gives — a ceiling makes everything past
 * it land together, which in a sequence that runs day by day is a whole
 * weekday arriving on one frame.
 */
function setMotionStep(host: HTMLElement, arrivals: number, departures: number): void {
  host.style.setProperty(
    "--planner-motion-step",
    `${staggerStep(Math.max(arrivals, departures), 32)}ms`,
  );
}

/**
 * Runs the release-and-sweep half of every choreography here: force the
 * rewound state into layout, turn the transitions on, hand the elements their
 * real values one frame later, and take the scaffolding back down.
 */
function release(
  host: HTMLElement,
  change: LayerChange,
  ghosts: HTMLElement | null,
  to: () => void,
): void {
  // Reading a layout property is what commits the rewound values as the
  // transition's starting point. Without it the browser coalesces both writes
  // and nothing moves.
  void host.offsetHeight;
  host.classList.add("is-settling");
  if (change === "hide") host.classList.add("is-closing");
  requestAnimationFrame(to);
  // The ghosts go on their own, much shorter clock. They are `.planner-block`
  // elements sitting inside the week, so anything counting bars — the e2e
  // suite does, by exactly that selector — counts them too for as long as they
  // are there. Their job is over when their wipe is; there is no reason to
  // leave them for the class sweep.
  if (ghosts) setTimeout(() => ghosts.remove(), GHOST_MS);
  setTimeout(() => {
    host.classList.remove("is-settling", "is-closing");
    host.style.removeProperty("--planner-departs");
    host.style.removeProperty("--planner-motion-step");
    host.style.removeProperty("height");
    ghosts?.remove();
    for (const node of Array.from(host.querySelectorAll<HTMLElement>(".is-arriving")))
      clearArrival(node);
  }, CLEANUP_MS);
}

// --- The week ------------------------------------------------------------

/**
 * The custom properties each kind of element keeps its geometry in. These are
 * the same names `buildGridShell`, `positionBlock` and `syncNowMarker` write,
 * and the stylesheet turns them into `left`, `width`, `top` and `min-height`
 * — which is precisely why rewinding a property animates real layout and the
 * type inside a bar never gets scaled.
 */
const BLOCK_PROPS = ["--planner-x", "--planner-w", "--planner-lane"];
const ZONE_PROPS = ["--planner-x", "--planner-w"];
const TICK_PROPS = ["--planner-x"];
/**
 * BOTH of the properties the row's height is computed from.
 *
 * `--planner-bands` arrived with the drop-in strip (REWORK-2026-07-30c) and
 * was never added here, so a row whose height changed only because a strip
 * appeared or left had nothing rewound: the new height was already in place
 * before the transition was switched on, and the row snapped on the first
 * frame while the bars animated around it. That is the whole of "the rows
 * collapse the instant I deselect" (REWORK-2026-07-30h).
 *
 * Anything else the field's `min-height` learns to read has to be listed here
 * too, or it will snap in exactly the same way and for the same reason.
 */
const FIELD_PROPS = ["--planner-lanes", "--planner-bands"];
const NOW_PROPS = ["--planner-x", "--planner-now-top", "--planner-now-height"];
const GRID_PROPS = ["--planner-hours"];

interface Keyed {
  node: HTMLElement;
  props: string[];
  /** Worth re-inserting as a ghost when it leaves. Bars are; ticks are not. */
  ghost: boolean;
}

/**
 * Every element in the week whose place can change, under a key that survives
 * the re-render.
 *
 * A bar's key is its DOM id, which is built from `GridEntry.ordinal` — and
 * that ordinal is assigned in `collectEntries`, BEFORE the øving/lab filter
 * runs. That is what makes it stable here: hiding the layer does not renumber
 * the lectures. (Merged parallels do not disturb it either — the merge key
 * separates lectures from everything else, so a lecture's representative is
 * the same entry in both renders.)
 */
function keyWeek(grid: HTMLElement): Map<string, Keyed> {
  const out = new Map<string, Keyed>();
  out.set("grid", { node: grid, props: GRID_PROPS, ghost: false });

  const now = grid.querySelector<HTMLElement>(".planner-grid-now");
  if (now) out.set("now", { node: now, props: NOW_PROPS, ghost: false });

  for (const tick of Array.from(grid.querySelectorAll<HTMLElement>(".planner-grid-tick")))
    out.set(`tick-${tick.getAttribute("data-hour")}`, {
      node: tick,
      props: TICK_PROPS,
      ghost: false,
    });

  for (const row of Array.from(grid.querySelectorAll<HTMLElement>(".planner-grid-row"))) {
    const day = row.getAttribute("data-day");
    out.set(`row-${day}`, { node: row, props: [], ghost: false });
    const field = row.querySelector<HTMLElement>(".planner-grid-field");
    if (field) out.set(`field-${day}`, { node: field, props: FIELD_PROPS, ghost: false });
    const zone = row.querySelector<HTMLElement>(".planner-clash-zone");
    if (zone) out.set(`zone-${day}`, { node: zone, props: ZONE_PROPS, ghost: false });
  }

  for (const block of Array.from(grid.querySelectorAll<HTMLElement>(".planner-block")))
    out.set(block.id, { node: block, props: BLOCK_PROPS, ghost: true });

  return out;
}

function readProps(node: HTMLElement, props: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const prop of props) out.set(prop, node.style.getPropertyValue(prop));
  return out;
}

function writeProps(node: HTMLElement, values: Map<string, string>): void {
  for (const [prop, value] of values) node.style.setProperty(prop, value);
}

function beginWeekChange(frame: HTMLElement, grid: HTMLElement, change: LayerChange): SettleLayer {
  const origin = grid.getBoundingClientRect();
  const before = new Map<
    string,
    { node: HTMLElement; values: Map<string, string>; box: Box | null }
  >();
  for (const [key, { node, props, ghost }] of keyWeek(grid)) {
    before.set(key, {
      node,
      values: readProps(node, props),
      box: ghost ? boxIn(node, origin) : null,
    });
  }

  return () => {
    const next = frame.querySelector<HTMLElement>(".planner-grid");
    // The re-render can put a message or a card in the frame instead of a
    // week. There is then nothing to travel to and nowhere to hang a ghost.
    if (!next) return;
    const after = keyWeek(next);

    const restore: { node: HTMLElement; values: Map<string, string> }[] = [];
    let arriving = 0;
    for (const [key, { node, props }] of after) {
      const old = before.get(key);
      if (!old) {
        markArrival(node, node.classList.contains("planner-block") ? arriving++ : 0);
        continue;
      }
      // Read the rendered values FIRST — writing the old ones over them is
      // what would otherwise destroy the target.
      restore.push({ node, values: readProps(node, props) });
      writeProps(node, old.values);
    }

    const departing = [...before]
      .filter(([key, entry]) => entry.box !== null && !after.has(key))
      .map(([, entry]) => ({ node: entry.node, box: entry.box as Box }));
    const ghosts = layGhosts(next, departing);
    setMotionStep(next, arriving, departing.length);

    release(next, change, ghosts, () => {
      for (const { node, values } of restore) writeProps(node, values);
    });
  };
}

// --- The columns ---------------------------------------------------------

/**
 * The column grid's geometry properties (`columnGrid.ts`). Time is the vertical
 * axis here, so a session's place is `--planner-y`/`--planner-h` — percentages
 * of the drawn span, exactly as the transposed week's are percentages the other
 * way round — and its share of the column is `--planner-lane`/`--planner-lanes`.
 */
const COL_BLOCK_PROPS = ["--planner-y", "--planner-h", "--planner-lane", "--planner-lanes"];
const COL_BAND_PROPS = ["--planner-y", "--planner-h", "--planner-band"];
const COL_ZONE_PROPS = ["--planner-y", "--planner-h"];
const COL_HOUR_PROPS = ["--planner-y"];
const COL_NOW_PROPS = ["--planner-y"];
/**
 * Everything the COLUMN's own box is computed from: its height (hours × the
 * hour token) and its minimum width (the week's deepest cluster plus the strips
 * it reserves). Revealing the layer usually changes all three at once — a later
 * axis, a deeper day, a new drop-in strip — and a property left out here is a
 * dimension that snaps while everything around it travels.
 */
const COL_GRID_PROPS = ["--planner-hours", "--planner-lanes-max", "--planner-bands-max"];

/**
 * Every element in the column grid whose place can change, under a key that
 * survives the re-render.
 *
 * A session's key is `data-motion-key` — `board.ts`'s `motionKey`, shared so the
 * two views cannot disagree about what "the same session" is. The transposed
 * week keys on `GridEntry.ordinal` instead, which this view has no access to.
 */
function keyColumns(grid: HTMLElement): Map<string, Keyed> {
  const out = new Map<string, Keyed>();
  out.set("grid", { node: grid, props: COL_GRID_PROPS, ghost: false });

  const now = grid.querySelector<HTMLElement>(".planner-cols-now");
  if (now) out.set("now", { node: now, props: COL_NOW_PROPS, ghost: false });

  for (const hour of Array.from(grid.querySelectorAll<HTMLElement>(".planner-cols-hour")))
    out.set(`hour-${hour.getAttribute("data-hour")}`, {
      node: hour,
      props: COL_HOUR_PROPS,
      ghost: false,
    });

  for (const day of Array.from(grid.querySelectorAll<HTMLElement>(".planner-cols-day")))
    out.set(`day-${day.getAttribute("data-day")}`, { node: day, props: [], ghost: false });

  for (const zone of Array.from(grid.querySelectorAll<HTMLElement>(".planner-cols-clash")))
    out.set(`${zone.getAttribute("data-motion-key")}`, {
      node: zone,
      props: COL_ZONE_PROPS,
      ghost: false,
    });

  // ONE pass, in document order — which is the order the week is drawn in, so
  // arrivals stagger the way the view prints: a day's strips, then its
  // sessions, then the next day. Querying blocks and strips separately walked
  // every session in the week before the first strip, and the layer landed in
  // two waves that have nothing to do with the week's own reading order.
  for (const session of Array.from(
    grid.querySelectorAll<HTMLElement>(".planner-cols-block, .planner-cols-band"),
  ))
    out.set(`${session.getAttribute("data-motion-key")}`, {
      node: session,
      props: session.classList.contains("planner-cols-band") ? COL_BAND_PROPS : COL_BLOCK_PROPS,
      ghost: true,
    });

  return out;
}

function beginColumnChange(
  frame: HTMLElement,
  grid: HTMLElement,
  change: LayerChange,
): SettleLayer {
  const origin = grid.getBoundingClientRect();
  const before = new Map<
    string,
    { node: HTMLElement; values: Map<string, string>; box: Box | null }
  >();
  for (const [key, { node, props, ghost }] of keyColumns(grid)) {
    before.set(key, {
      node,
      values: readProps(node, props),
      box: ghost ? boxIn(node, origin) : null,
    });
  }

  return () => {
    const next = frame.querySelector<HTMLElement>(".planner-cols");
    if (!next) return;
    const after = keyColumns(next);

    const restore: { node: HTMLElement; values: Map<string, string> }[] = [];
    let arriving = 0;
    for (const [key, { node, props }] of after) {
      const old = before.get(key);
      if (!old) {
        // Only sessions carry a meaningful order. An hour figure or a newly
        // needed column is not a thing that arrives, it is room being made, and
        // letting one take a stagger number pushes the actual arrivals a step
        // later for nothing.
        const session =
          node.classList.contains("planner-cols-block") ||
          node.classList.contains("planner-cols-band");
        markArrival(node, session ? arriving++ : 0);
        continue;
      }
      restore.push({ node, values: readProps(node, props) });
      writeProps(node, old.values);
    }

    const departing = [...before]
      .filter(([key, entry]) => entry.box !== null && !after.has(key))
      .map(([, entry]) => ({ node: entry.node, box: entry.box as Box }));
    const ghosts = layGhosts(next, departing);
    setMotionStep(next, arriving, departing.length);

    release(next, change, ghosts, () => {
      for (const { node, values } of restore) writeProps(node, values);
    });
  };
}

// --- The list ------------------------------------------------------------

function beginListChange(frame: HTMLElement, board: HTMLElement, change: LayerChange): SettleLayer {
  const origin = board.getBoundingClientRect();
  const wasTall = origin.height;
  const before = new Map<string, { node: HTMLElement; box: Box }>();
  for (const node of Array.from(board.querySelectorAll<HTMLElement>("[data-motion-key]"))) {
    const key = node.getAttribute("data-motion-key");
    if (key) before.set(key, { node, box: boxIn(node, origin) });
  }

  return () => {
    const next = frame.querySelector<HTMLElement>(".planner-board");
    if (!next) return;
    const origin2 = next.getBoundingClientRect();

    // Document order, so a container is always measured before the rows
    // inside it and its delta is known when they need to subtract it.
    const deltas = new Map<HTMLElement, { dx: number; dy: number }>();
    const moved: HTMLElement[] = [];
    const seen = new Set<string>();
    let arriving = 0;

    for (const node of Array.from(next.querySelectorAll<HTMLElement>("[data-motion-key]"))) {
      const key = node.getAttribute("data-motion-key");
      if (key) seen.add(key);
      const old = key ? before.get(key) : undefined;
      if (!old) {
        markArrival(node, node.classList.contains("planner-board-row") ? arriving++ : 0);
        continue;
      }
      const box = boxIn(node, origin2);
      const delta = { dx: old.box.left - box.left, dy: old.box.top - box.top };
      deltas.set(node, delta);
      // A row inside a collision bracket is moved by the bracket already —
      // its own transform has to carry only the difference, or the two would
      // compound and it would travel twice as far as it should.
      const parent = node.parentElement?.closest<HTMLElement>("[data-motion-key]") ?? null;
      const inherited = (parent && deltas.get(parent)) || { dx: 0, dy: 0 };
      const dx = delta.dx - inherited.dx;
      const dy = delta.dy - inherited.dy;
      if (dx === 0 && dy === 0) continue;
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      moved.push(node);
    }

    const departing = [...before]
      .filter(([key]) => !seen.has(key))
      .map(([, entry]) => ({ node: entry.node, box: entry.box }));
    const ghosts = layGhosts(next, departing);
    setMotionStep(next, arriving, departing.length);

    // The list's own height, which FLIP cannot carry (REWORK-2026-07-30i).
    //
    // The week animates `min-height` per row, so its total height follows. A
    // list has no such property: rows are in normal flow, so removing them
    // makes the container short on the same frame the render lands, and the
    // exam list and the course list underneath jump before a single row has
    // moved. `transform` on the survivors cannot fix that — a translated row
    // occupies its original box as far as layout is concerned.
    //
    // So the box is pinned to what it was, released to what it is, and handed
    // back to the stylesheet when the choreography is over. Measured here
    // rather than declared, because a list's height is its content.
    const isTall = next.getBoundingClientRect().height;
    if (Math.round(wasTall) !== Math.round(isTall)) {
      next.style.height = `${wasTall}px`;
    }

    release(next, change, ghosts, () => {
      for (const node of moved) node.style.removeProperty("transform");
      if (next.style.height) next.style.height = `${isTall}px`;
    });
  };
}

// --- Entry point ---------------------------------------------------------

/**
 * Call before the re-render; call the returned function after it.
 *
 * It picks its own mechanism from what is actually in the frame, so the caller
 * does not have to know which view is drawing the week — and gets a no-op for
 * every state (a message, a card, a skeleton) that has no week to move.
 */
export function beginLayerChange(frame: HTMLElement, change: LayerChange): SettleLayer {
  if (!motionAllowed()) return NOTHING;
  // A ghost is a `.planner-block` sitting inside the week, so one left over
  // from a previous toggle would be snapshotted as a real bar and then either
  // travel or be ghosted a second time. Pressing the button twice in a second
  // is not exotic. The newer change supersedes whatever the older one had not
  // finished sweeping up.
  for (const stale of Array.from(frame.querySelectorAll<HTMLElement>(".planner-motion-ghosts")))
    stale.remove();
  const grid = frame.querySelector<HTMLElement>(".planner-grid");
  if (grid) return beginWeekChange(frame, grid, change);
  const columns = frame.querySelector<HTMLElement>(".planner-cols");
  if (columns) return beginColumnChange(frame, columns, change);
  const board = frame.querySelector<HTMLElement>(".planner-board");
  if (board) return beginListChange(frame, board, change);
  return NOTHING;
}
