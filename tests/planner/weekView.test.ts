import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { loadWeekBox, saveWeekBox } from "../../src/components/planner/weekView.js";

/**
 * The reservation key.
 *
 * `--planner-box` used to hold one height per view, guarded by an id selector
 * so the planner's remembered Liste height could never reach the course page's
 * frame. Three surfaces share the two views now, so that guard had to move out
 * of the selector and into the key: a height measured on a five-course planner
 * is not evidence about a one-course course page, and a frame that reserves
 * another surface's number is worse off than one that reserves nothing.
 *
 * The width has always been part of it for the same reason — a list measured at
 * 390 px wraps differently at 1440 — and that half is re-checked here because
 * adding a dimension to a key is exactly when the other dimensions get dropped.
 */

let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  (globalThis as unknown as Record<string, unknown>).localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
});

afterEach(() => {
  (globalThis as unknown as Record<string, unknown>).localStorage = undefined;
});

describe("the week box is keyed by surface", () => {
  test("two surfaces' heights for the same view do not overwrite each other", () => {
    saveWeekBox("planner", "tavle", 390, 907);
    saveWeekBox("emne", "tavle", 390, 240);
    expect(loadWeekBox("planner", "tavle", 390)).toBe(907);
    expect(loadWeekBox("emne", "tavle", 390)).toBe(240);
  });

  test("the two views stay apart within one surface", () => {
    saveWeekBox("emne", "kolonner", 390, 487);
    saveWeekBox("emne", "tavle", 390, 240);
    expect(loadWeekBox("emne", "kolonner", 390)).toBe(487);
    expect(loadWeekBox("emne", "tavle", 390)).toBe(240);
  });

  test("a surface that has never been measured reserves nothing", () => {
    saveWeekBox("planner", "kolonner", 390, 651);
    expect(loadWeekBox("emne", "kolonner", 390)).toBeNull();
  });
});

describe("a height is only evidence at the width it was measured at", () => {
  test("a small drift is still the same layout", () => {
    saveWeekBox("emne", "kolonner", 390, 487);
    expect(loadWeekBox("emne", "kolonner", 402)).toBe(487);
  });

  test("a different layout is not evidence about this one", () => {
    saveWeekBox("emne", "kolonner", 390, 487);
    expect(loadWeekBox("emne", "kolonner", 1200)).toBeNull();
  });
});

describe("storage is total in both directions", () => {
  test("a zero or negative height is never filed", () => {
    saveWeekBox("emne", "kolonner", 390, 0);
    expect(loadWeekBox("emne", "kolonner", 390)).toBeNull();
  });

  test("a corrupted store reads as no reservation rather than throwing", () => {
    store.set("np:weekBox", "{not json");
    expect(loadWeekBox("planner", "kolonner", 390)).toBeNull();
  });
});
