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
    expect(slot(r, "a")).toMatchObject({ col: 0, cols: 1, overflow: false });
    expect(slot(r, "b")).toMatchObject({ col: 0, cols: 1, overflow: false });
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
    expect(slot(r, "a")).toMatchObject({ col: 0, cols: 2 });
    expect(slot(r, "b")).toMatchObject({ col: 1, cols: 2 });
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
    for (const id of ["a", "b", "c"]) expect(slot(r, id).cols).toBe(2);
  });

  test("three simultaneous items use three columns", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 480, end: 600 },
      { id: "c", start: 480, end: 600 },
    ]);
    const cols = ["a", "b", "c"].map((id) => slot(r, id).col).sort();
    expect(cols).toEqual([0, 1, 2]);
    expect(slot(r, "a").cols).toBe(3);
  });

  test("a fourth simultaneous item overflows past MAX_COLUMNS", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 480, end: 600 },
      { id: "c", start: 480, end: 600 },
      { id: "d", start: 480, end: 600 },
    ]);
    const overflowing = r.filter((s) => s.overflow);
    expect(overflowing).toHaveLength(1);
    const visible = r.filter((s) => !s.overflow);
    expect(visible).toHaveLength(3);
    for (const s of visible) expect(s.cols).toBe(MAX_COLUMNS);
  });

  test("clusters are independent: a crowded morning doesn't split the afternoon", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 480, end: 600 },
      { id: "c", start: 840, end: 960 },
    ]);
    expect(slot(r, "c")).toMatchObject({ col: 0, cols: 1 });
  });

  test("empty input returns empty output", () => {
    expect(layoutDay([])).toEqual([]);
  });
});
