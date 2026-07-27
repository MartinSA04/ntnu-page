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
 * A cluster that would need MORE than `MAX_COLUMNS` columns is not split at
 * all: every member is marked `piled`, and the renderer draws the whole
 * cluster as ONE block listing every session in it — code and start–end time
 * (grid.ts). Three columns in a ~106 px weekday is ~35 px per block, at which
 * width `.planner-block-code`'s `overflow-wrap: anywhere` broke course codes
 * one character per line — "T D T 4 1 0 9" stacked down a sliver. Two
 * readable blocks, or one readable pile, beats three unreadable slivers; the
 * pile names its sessions, which the old "+N til" overflow chip did not.
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

/** Side-by-side columns a cluster may use before it collapses into a pile. */
export const MAX_COLUMNS = 2;

/** Lays out one day's items into clusters, columns and overflow flags. */
export function layoutDay(items: LayoutInput[]): LayoutSlot[] {
  const sorted = [...items].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.id.localeCompare(b.id),
  );

  const slots: LayoutSlot[] = [];
  let cluster: LayoutInput[] = [];
  let clusterMaxEnd = -Infinity;
  let clusterIndex = 0;

  const flush = () => {
    if (cluster.length > 0) {
      slots.push(...layoutCluster(cluster, clusterIndex));
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
 * `MAX_COLUMNS` columns collapses whole: every member comes back `piled`, at
 * `col: 0, cols: 1`, so the renderer can draw one full-width block for it.
 * Partial collapse is deliberately NOT offered — showing two of five and
 * hiding three is how the "+N til" chip lost the courses it was counting.
 */
function layoutCluster(cluster: LayoutInput[], clusterIndex: number): LayoutSlot[] {
  const columnEnds: number[] = []; // last occupant's end time, per column
  const colByItem: number[] = []; // parallel to `cluster`

  for (const item of cluster) {
    let col = columnEnds.findIndex((end) => end <= item.start);
    if (col === -1) col = columnEnds.length;
    columnEnds[col] = item.end;
    colByItem.push(col);
  }

  const rawCols = columnEnds.length;
  if (rawCols > MAX_COLUMNS) {
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
