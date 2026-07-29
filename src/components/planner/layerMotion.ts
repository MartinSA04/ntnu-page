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
 * How many arrivals get their own stagger step before they all share the last
 * one. A week can reveal thirty øving bars, and thirty × 35 ms is a second of
 * bars trickling in — which stops reading as one layer landing and starts
 * reading as a slow page load.
 */
const STAGGER_CAP = 12;

/**
 * When the scaffolding comes down. The CSS owns the real timings (`--dur`);
 * this only has to outlast the longest of them — the last staggered arrival,
 * at roughly `0.8 × dur + cap × 32 ms + 1.6 × dur`.
 */
const CLEANUP_MS = 1100;

/** How long a ghost lives: its wipe (`--dur-fast`), plus a frame or two. */
const GHOST_MS = 200;

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
  for (const { node, box } of ghosts) {
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
  }
  host.append(layer);
  return layer;
}

/**
 * Marks an element as arriving and gives it its place in the stagger. Only
 * bars carry a meaningful order — a ruler tick or a newly needed Saturday row
 * just fades in behind them.
 */
function markArrival(node: HTMLElement, index: number): void {
  node.style.setProperty("--planner-arrive", String(Math.min(index, STAGGER_CAP)));
  node.classList.add("is-arriving");
}

/** Takes the mark off once it has served — see `layGhosts` for why it must. */
function clearArrival(node: HTMLElement): void {
  node.classList.remove("is-arriving");
  node.style.removeProperty("--planner-arrive");
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
const FIELD_PROPS = ["--planner-lanes"];
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

    const ghosts = layGhosts(
      next,
      [...before]
        .filter(([key, entry]) => entry.box !== null && !after.has(key))
        .map(([, entry]) => ({ node: entry.node, box: entry.box as Box })),
    );

    release(next, change, ghosts, () => {
      for (const { node, values } of restore) writeProps(node, values);
    });
  };
}

// --- The list ------------------------------------------------------------

function beginListChange(frame: HTMLElement, board: HTMLElement, change: LayerChange): SettleLayer {
  const origin = board.getBoundingClientRect();
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

    const ghosts = layGhosts(
      next,
      [...before]
        .filter(([key]) => !seen.has(key))
        .map(([, entry]) => ({ node: entry.node, box: entry.box })),
    );

    release(next, change, ghosts, () => {
      for (const node of moved) node.style.removeProperty("transform");
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
  const board = frame.querySelector<HTMLElement>(".planner-board");
  if (board) return beginListChange(frame, board, change);
  return NOTHING;
}
