import { describe, expect, test } from "vitest";
import { durationLabel, editVerb } from "../../src/components/planner/blockPopover.js";

/**
 * The pure half of the session popover — mounting it needs a DOM this repo does
 * not ship, so the card's assembly is covered by `e2e/flows.pw.ts`.
 */

describe("durationLabel", () => {
  test("names hours and minutes for the ordinary 1 t 45 min slot", () => {
    expect(durationLabel("14:15", "16:00")).toBe("1 t 45 min");
  });

  test("drops the minutes when the slot is whole hours", () => {
    expect(durationLabel("12:15", "15:15")).toBe("3 t");
  });

  test("names minutes alone under the hour", () => {
    expect(durationLabel("08:15", "09:00")).toBe("45 min");
  });

  /* The card omits what it cannot state: a zero or reversed pair is upstream
     nonsense, and "0 min" printed next to a real clock reads as a fact. */
  test("says nothing about a zero-length or reversed slot", () => {
    expect(durationLabel("10:15", "10:15")).toBe("");
    expect(durationLabel("12:00", "10:00")).toBe("");
  });
});

describe("editVerb", () => {
  /* "Innstillinger" was the system's word for the same button. A verb names
     its outcome (DESIGN §8), and which outcome depends on what the course
     offers on the layer the clicked session belongs to. */
  test("a lecture layer with parallels offers the parallel", () => {
    expect(editVerb("parallel")).toBe("Velg parallell");
  });

  test("an øving/lab layer with groups offers the group", () => {
    expect(editVerb("group")).toBe("Velg gruppe");
  });

  test("a course with no choice to make on this layer offers the course", () => {
    expect(editVerb("course")).toBe("Endre emnet");
  });
});
