import { describe, expect, test } from "vitest";
import { layoutDay, MAX_COLUMNS } from "../../src/lib/planner/layout.js";

const slot = (r: ReturnType<typeof layoutDay>, id: string) => {
  const s = r.find((x) => x.id === id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
};

describe("layoutDay", () => {
  test("disjoint items each get a full-width column", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 615, end: 720 },
    ]);
    expect(slot(r, "a")).toMatchObject({ col: 0, cols: 1, piled: false });
    expect(slot(r, "b")).toMatchObject({ col: 0, cols: 1, piled: false });
  });

  test("touching boundaries (end === next start) do NOT overlap", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 600, end: 720 },
    ]);
    expect(slot(r, "a").cols).toBe(1);
    expect(slot(r, "b").cols).toBe(1);
  });

  test("a simple pair splits into two columns", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 540, end: 660 },
    ]);
    expect(slot(r, "a")).toMatchObject({ col: 0, cols: 2, piled: false });
    expect(slot(r, "b")).toMatchObject({ col: 1, cols: 2, piled: false });
  });

  test("a chain A-B-C where A and C don't overlap reuses column 0", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 540, end: 660 },
      { id: "c", start: 600, end: 720 },
    ]);
    expect(slot(r, "a").col).toBe(0);
    expect(slot(r, "b").col).toBe(1);
    expect(slot(r, "c").col).toBe(0); // reuses a's column
    for (const id of ["a", "b", "c"]) {
      expect(slot(r, id).cols).toBe(2);
      // Two columns is the cap, not the trigger — this cluster still draws
      // as columns, not as a pile.
      expect(slot(r, id).piled).toBe(false);
    }
  });

  test("MAX_COLUMNS is 2 — three slivers were never readable at a weekday's width", () => {
    expect(MAX_COLUMNS).toBe(2);
  });

  test("three simultaneous items pile instead of splitting into thirds", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 480, end: 600 },
      { id: "c", start: 480, end: 600 },
    ]);
    // All-or-nothing: the whole cluster piles, so nothing is hidden behind a
    // count the way the old "+N til" chip hid it.
    for (const id of ["a", "b", "c"]) {
      expect(slot(r, id)).toMatchObject({ col: 0, cols: 1, piled: true });
    }
    // One cluster, so the renderer draws exactly one pile block for them.
    expect(new Set(r.map((s) => s.cluster)).size).toBe(1);
  });

  test("a piled cluster keeps every member — none is dropped", () => {
    const ids = ["a", "b", "c", "d", "e"];
    const r = layoutDay(ids.map((id) => ({ id, start: 480, end: 600 })));
    expect(r).toHaveLength(ids.length);
    expect(r.every((s) => s.piled)).toBe(true);
  });

  test("clusters are independent: a crowded morning doesn't pile the afternoon", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 480, end: 600 },
      { id: "c", start: 480, end: 600 },
      { id: "d", start: 840, end: 960 },
    ]);
    expect(slot(r, "a").piled).toBe(true);
    expect(slot(r, "d")).toMatchObject({ col: 0, cols: 1, piled: false });
    expect(slot(r, "d").cluster).not.toBe(slot(r, "a").cluster);
  });

  test("each cluster gets its own index, so two piles never merge", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 480, end: 600 },
      { id: "c", start: 480, end: 600 },
      { id: "d", start: 840, end: 960 },
      { id: "e", start: 840, end: 960 },
      { id: "f", start: 840, end: 960 },
    ]);
    expect(slot(r, "a").cluster).toBe(0);
    expect(slot(r, "d").cluster).toBe(1);
    expect(slot(r, "d").piled).toBe(true);
  });

  test("empty input returns empty output", () => {
    expect(layoutDay([])).toEqual([]);
  });
});
