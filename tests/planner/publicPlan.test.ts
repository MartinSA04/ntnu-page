import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildPublicPlan,
  parsePublicPlan,
  publicPlanCredits,
} from "../../src/lib/planner/publicPlan.js";
import type { PlanState } from "../../src/lib/planner/store.js";

const PLAN: PlanState = {
  semesterId: "26h",
  program: { code: "MTDT", name: "Datateknologi", cohort: 2026 },
  courses: [
    {
      code: "TDT4120",
      name: "Algoritmer og datastrukturer",
      version: "1",
      source: "program",
      credits: 7.5,
      groups: ["FOR-1"],
    },
    { code: "TMA4100", name: "Matematikk 1", version: "3", source: "program", credits: 7.5 },
    { code: "IT2805", name: "Webteknologi", version: "1", source: "program", dropped: true },
  ],
};

describe("buildPublicPlan", () => {
  it("carries what the week needs to draw", () => {
    const published = buildPublicPlan(PLAN, { semesterLabel: "Høst 2026" });
    expect(published.semesterId).toBe("26h");
    expect(published.semesterLabel).toBe("Høst 2026");
    expect(published.program).toEqual({ code: "MTDT", name: "Datateknologi", cohort: 2026 });
    // The version threads through (DR-4) and so do the owner's group picks —
    // without them the viewer is shown a different week from the sharer's.
    expect(published.courses.map((c) => [c.code, c.version])).toEqual([
      ["TDT4120", "1"],
      ["TMA4100", "3"],
    ]);
    expect(published.courses[0]?.groups).toEqual(["FOR-1"]);
  });

  it("leaves dropped courses out — they are not part of the plan being shared", () => {
    expect(buildPublicPlan(PLAN).courses.map((c) => c.code)).not.toContain("IT2805");
  });

  it("prefers live catalog credits over the study plan's own figure", () => {
    const published = buildPublicPlan(PLAN, {
      credits: (code) => (code === "TDT4120" ? 10 : null),
    });
    expect(published.courses[0]?.credits).toBe(10);
    expect(published.courses[1]?.credits).toBe(7.5);
  });
});

describe("parsePublicPlan", () => {
  it("round-trips a built plan", () => {
    const published = buildPublicPlan(PLAN, { semesterLabel: "Høst 2026" });
    expect(parsePublicPlan(JSON.stringify(published))).toEqual(published);
  });

  it("returns null for junk rather than throwing", () => {
    expect(parsePublicPlan("not json")).toBeNull();
    expect(parsePublicPlan("{}")).toBeNull();
    expect(parsePublicPlan(JSON.stringify({ semesterId: "26h" }))).toBeNull();
    expect(parsePublicPlan(JSON.stringify([1, 2]))).toBeNull();
  });

  it("drops malformed course rows instead of failing the whole plan", () => {
    const plan = parsePublicPlan(
      JSON.stringify({ semesterId: "26h", courses: [{ code: "TDT4120" }, { nope: true }, 7] }),
    );
    expect(plan?.courses).toHaveLength(1);
    // A row with nothing but a code still renders: the name falls back to it
    // and the version to the catalog default.
    expect(plan?.courses[0]).toMatchObject({ code: "TDT4120", name: "TDT4120", version: "1" });
  });

  it("ignores a programme it cannot read rather than inventing one", () => {
    const plan = parsePublicPlan(JSON.stringify({ semesterId: "26h", program: 5, courses: [] }));
    expect(plan?.program).toBeUndefined();
  });
});

describe("publicPlanCredits", () => {
  it("adds what is known and does not guess at what is not (DR-6)", () => {
    expect(
      publicPlanCredits({
        semesterId: "26h",
        courses: [
          { code: "A", name: "A", version: "1", credits: 7.5 },
          { code: "B", name: "B", version: "1" },
        ],
      }),
    ).toBe(7.5);
  });
});

/**
 * The whole point of the change: a shared link SHOWS you someone else's plan.
 * A single `savePlan` reaching this module would put the silent-replace bug
 * back, so the rule is asserted against the source rather than left as a
 * comment on it.
 */
describe("the viewer never writes", () => {
  it("does not reference localStorage or the plan store", () => {
    // Comments stripped first: the rule is about what the module CALLS, and
    // the file's own header explains the rule in the words this asserts on.
    const source = readFileSync("src/components/planner/publicPlan.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|\s)\/\/.*$/gm, "");
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/createPlanStore|PlanStore|savePlan/);
  });
});
