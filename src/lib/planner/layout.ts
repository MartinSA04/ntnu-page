/**
 * Day-column layout engine for the week grid. Pure and dependency-free: given
 * a day's items it decides how many side-by-side columns overlapping items
 * need, and which column each sits in.
 *
 * Items group into clusters — maximal runs where each item starts before the
 * running end of the cluster so far. A touching boundary (`start === prevEnd`)
 * is NOT an overlap and starts a new cluster, matching the conflict engine's
 * own rule. Within a cluster, items greedily take the lowest-indexed column
 * whose last occupant has ended, so a chain A-B-C (A and C disjoint) reuses
 * A's column for C.
 *
 * A cluster needing more columns than `maxColumns` is not split at all: every
 * member is marked `piled` and the renderer draws one block listing every
 * session in it. Splitting further breaks course codes one character per line,
 * and the pile at least names its sessions.
 *
 * `LayoutSlot.cluster` is the renderer's partition too — grid.ts groups by it
 * rather than re-deriving the rule, so there is one implementation of "what
 * overlaps what".
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
 * Side-by-side columns a cluster may use before it collapses into a pile.
 *
 * A *default*, not a constant: the readable width is not the same on every
 * viewport. On a phone a day column is ~56 px, and half of that fits no
 * 7-character mono code at any type step, so the caller passes 1 there and a
 * 2-deep cluster piles instead of splitting.
 */
export const MAX_COLUMNS = 2;

/**
 * Lays out one day's items into clusters, columns and overflow flags.
 * `maxColumns` below 1 is treated as 1 — a cluster always draws somewhere.
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
 * `maxColumns` columns collapses whole, at `col: 0, cols: 1`. Partial collapse
 * is deliberately NOT offered — showing two of five and hiding three is how
 * the "+N til" chip lost the courses it was counting.
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
