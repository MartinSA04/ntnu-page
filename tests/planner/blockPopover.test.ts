import { describe, expect, test } from "vitest";
import { clashClock, durationLabel, editVerb } from "../../src/components/planner/blockPopover.js";

/**
 * The pure half of the session popover. Mounting it needs a DOM (this suite
 * runs in vitest's default Node environment — the repo has no jsdom), so the
 * card's assembly is covered by `e2e/flows.pw.ts` and what lives here is the
 * two decisions it makes before rendering anything: how long the session is,
 * and what its one button is called.
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
     its outcome (DESIGN §7), and which outcome depends on what the course
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

describe("clashClock", () => {
  const session = { startTime: "14:15", endTime: "16:00" };

  /* The card already sets the session's own clock as its largest figure, so a
     collision that covers the whole slot would print the same pair twice. */
  test("says nothing when the collision covers the whole session", () => {
    expect(
      clashClock(session, { partners: ["TDT4160"], startTime: "14:15", endTime: "16:00" }),
    ).toBe("");
  });

  test("names the shared minutes when only part of the session collides", () => {
    expect(
      clashClock(session, { partners: ["TMA4400"], startTime: "15:15", endTime: "16:00" }),
    ).toBe("15:15–16:00");
  });
});
