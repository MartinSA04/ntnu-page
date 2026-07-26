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
 * A cluster that needs more columns than `MAX_COLUMNS` doesn't grow the grid;
 * columns `>= MAX_COLUMNS` are marked `overflow: true` and dropped from the
 * rendered grid. The renderer lists them behind a "+N til" chip instead of
 * drawing an ever-narrower block.
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
  overflow: boolean; // true = not rendered as a block; listed behind the "+N til" chip
}

export const MAX_COLUMNS = 3;

/** Lays out one day's items into clusters, columns and overflow flags. */
export function layoutDay(items: LayoutInput[]): LayoutSlot[] {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );

  const slots: LayoutSlot[] = [];
  let cluster: LayoutInput[] = [];
  let clusterMaxEnd = -Infinity;

  const flush = () => {
    if (cluster.length > 0) slots.push(...layoutCluster(cluster));
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

/** Column-packs one cluster (already sorted) and applies the overflow cutoff. */
function layoutCluster(cluster: LayoutInput[]): LayoutSlot[] {
  const columnEnds: number[] = []; // last occupant's end time, per column
  const colByItem: number[] = []; // parallel to `cluster`

  for (const item of cluster) {
    let col = columnEnds.findIndex((end) => end <= item.start);
    if (col === -1) col = columnEnds.length;
    columnEnds[col] = item.end;
    colByItem.push(col);
  }

  const rawCols = columnEnds.length;
  const cols = Math.min(rawCols, MAX_COLUMNS);

  return cluster.map((item, i) => {
    const col = colByItem[i] ?? 0;
    return { id: item.id, col, cols, overflow: col >= MAX_COLUMNS };
  });
}
