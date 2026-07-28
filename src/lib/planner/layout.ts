/**
 * Day-column layout engine for the week grid (Task 7 consumes this). Pure
 * and dependency-free: given a day's items, it decides how many side-by-side
 * columns overlapping items need and which column each item sits in.
 *
 * Items are grouped into clusters — maximal runs where each item starts
 * before the running end of the cluster so far. A touching boundary
 * (`start === prevEnd`) is NOT an overlap and starts a new cluster, matching
 * the conflict engine's own touching-boundary rule (conflicts.ts). Within a
 * cluster, items greedily take the lowest-indexed column whose last occupant
 * has already ended — the classic calendar-column-packing algorithm — so a
 * chain like A-B-C (A and C disjoint) reuses A's column for C instead of
 * spreading everything out.
 *
 * A cluster that would need MORE columns than the caller's cap (`maxColumns`,
 * default `MAX_COLUMNS`) is not split at all: every member is marked `piled`,
 * and the renderer draws the whole cluster as ONE block listing every session
 * in it — code and start–end time (grid.ts). Three columns in a ~106 px
 * weekday is ~35 px per block, at which width `.planner-block-code`'s
 * `overflow-wrap: anywhere` broke course codes one character per line —
 * "T D T 4 1 0 9" stacked down a sliver. Two readable blocks, or one readable
 * pile, beats three unreadable slivers; the pile names its sessions, which
 * the old "+N til" overflow chip did not. The same arithmetic is why the cap
 * is lower on a phone — see `MAX_COLUMNS` below.
 *
 * `LayoutSlot.cluster` is the renderer's partition too: grid.ts groups a
 * day's entries by it rather than re-deriving the clustering rule, so there
 * is exactly one implementation of "what overlaps what" and these tests are
 * on it (audit tests-6).
 */

export interface LayoutInput {
  id: string;
  start: number; // minutes since midnight
  end: number; // exclusive
}

export interface LayoutSlot {
  id: string;
  col: number; // 0-based visible column, < cols
  cols: number; // total visible columns in this slot's cluster (1..MAX_COLUMNS)
  /** Index of the cluster this slot belongs to — piled members share one. */
  cluster: number;
  /** True = this cluster draws as a single pile block, not as columns. */
  piled: boolean;
}

/**
 * Side-by-side columns a cluster may use before it collapses into a pile —
 * the default, and the number a desktop day column can carry.
 *
 * It is a *default*, not a constant, because the readable width the paragraph
 * above reasons about is not the same on every viewport. Below 40rem
 * `.planner-grid` drops to `min-width: 21rem` (REVIEW A4's adjudicated fix, so
 * five day headers fit), which makes a day column ~56 px — and half of that is
 * 27 px, at which "FRA1010" rendered one character per line down seven lines
 * (grid-3, measured at 390x844). No type step fits a 7-character mono code in
 * 27 px, so the caller passes 1 there and a 2-deep cluster piles instead of
 * splitting. See `maxColumnsForViewport` in grid.ts for where that is decided.
 */
export const MAX_COLUMNS = 2;

/**
 * Lays out one day's items into clusters, columns and overflow flags.
 *
 * `maxColumns` is the cap a cluster may reach before it piles whole; values
 * below 1 are treated as 1, since a cluster always has to draw somewhere.
 */
export function layoutDay(items: LayoutInput[], maxColumns: number = MAX_COLUMNS): LayoutSlot[] {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );

  const cap = Math.max(1, maxColumns);
  const slots: LayoutSlot[] = [];
  let cluster: LayoutInput[] = [];
  let clusterMaxEnd = -Infinity;
  let clusterIndex = 0;

  const flush = () => {
    if (cluster.length > 0) {
      slots.push(...layoutCluster(cluster, clusterIndex, cap));
      clusterIndex += 1;
    }
    cluster = [];
    clusterMaxEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.start >= clusterMaxEnd) flush();
    cluster.push(item);
    clusterMaxEnd = Math.max(clusterMaxEnd, item.end);
  }
  flush();

  return slots;
}

/**
 * Column-packs one cluster (already sorted). A cluster needing more than
 * `maxColumns` columns collapses whole: every member comes back `piled`, at
 * `col: 0, cols: 1`, so the renderer can draw one full-width block for it.
 * Partial collapse is deliberately NOT offered — showing two of five and
 * hiding three is how the "+N til" chip lost the courses it was counting.
 */
function layoutCluster(
  cluster: LayoutInput[],
  clusterIndex: number,
  maxColumns: number,
): LayoutSlot[] {
  const columnEnds: number[] = []; // last occupant's end time, per column
  const colByItem: number[] = []; // parallel to `cluster`

  for (const item of cluster) {
    let col = columnEnds.findIndex((end) => end <= item.start);
    if (col === -1) col = columnEnds.length;
    columnEnds[col] = item.end;
    colByItem.push(col);
  }

  const rawCols = columnEnds.length;
  if (rawCols > maxColumns) {
    return cluster.map((item) => ({
      id: item.id,
      col: 0,
      cols: 1,
      cluster: clusterIndex,
      piled: true,
    }));
  }

  return cluster.map((item, i) => ({
    id: item.id,
    col: colByItem[i] ?? 0,
    cols: rawCols,
    cluster: clusterIndex,
    piled: false,
  }));
}
