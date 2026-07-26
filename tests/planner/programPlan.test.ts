import { describe, expect, it } from "vitest";
import {
  classifyPeriod,
  isSuspiciousPrefill,
  maxPeriodNumber,
  periodNumberFor,
  prefillCredits,
  relevantCohorts,
  resolvePeriodFor,
  type StudyPlan,
} from "../../src/components/planner/programPlan.js";

/**
 * Fixtures mirror the real shapes `/api/program/:code/plan` returns (probed
 * against MTDT and BIT for cohort 2024, autumn 2026 → period 5):
 *
 * - MTDT period 5: `courseGroups` is EMPTY; every course hangs off a
 *   `Valg av studieretning` waypoint. TDT4136 + TMA4135 are `O` in all
 *   directions; each direction adds one more `O` plus its own electives.
 * - BIT period 5: one group, zero `O`, eight interchangeable `M2A` courses.
 * - Period 1: five `O` courses plus a `planElement` marker.
 */

interface CourseInput {
  code: string;
  choice: string | null;
  credits?: number | null;
  planElement?: boolean;
}

function course(input: CourseInput) {
  return {
    code: input.code,
    version: "1",
    name: `Emne ${input.code}`,
    credits: input.credits === undefined ? 7.5 : input.credits,
    planElement: input.planElement ?? false,
    studyChoice: { code: input.choice, name: null, description: null },
  };
}

function group(name: string, courses: CourseInput[]) {
  return { code: null, name, description: null, courses: courses.map(course) };
}

function direction(
  code: string | null,
  name: string | null,
  courseGroups: ReturnType<typeof group>[],
) {
  return { code, name, courseGroups, waypoints: [] };
}

function planWith(periods: StudyPlan["periods"]): StudyPlan {
  return {
    code: "TEST",
    name: "Testprogram",
    year: 2024,
    startTerm: "HØST",
    updated: null,
    periods,
    publishedYears: [2024],
  };
}

const MTDT_DIRECTIONS = [
  direction("MTDTDS-24", "Databaser og søk", [
    group("Obligatoriske og valgbare emner - 3. år", [
      { code: "TDT4117", choice: "O" },
      { code: "TDT4136", choice: "O" },
      { code: "TMA4135", choice: "O" },
      { code: "IT2810", choice: "VA" },
      { code: "TDT4165", choice: "VA" },
    ]),
  ]),
  direction("MTDTKI-24", "Kunstig intelligens", [
    group("Obligatoriske og valgbare emner - 3. år", [
      { code: "TDT4136", choice: "O" },
      { code: "TDT4172", choice: "O" },
      { code: "TMA4135", choice: "O" },
      { code: "IT2810", choice: "VA" },
    ]),
  ]),
];

/** MTDT period 5: no top-level courses at all, everything behind the waypoint. */
function directionGatedPlan(): StudyPlan {
  return planWith([
    {
      periodNumber: 5,
      direction: {
        code: null,
        name: null,
        courseGroups: [],
        waypoints: [
          {
            code: "WP1",
            name: "Valg av studieretning",
            description: null,
            deadlineDate: "2026-05-15",
            directions: MTDT_DIRECTIONS,
          },
        ],
      },
    },
  ]);
}

describe("periodNumberFor", () => {
  it("maps a cohort's first autumn to period 1 and counts two per year", () => {
    expect(periodNumberFor("26h", 2026)).toBe(1);
    expect(periodNumberFor("26h", 2024)).toBe(5);
    expect(periodNumberFor("26h", 2022)).toBe(9);
  });

  it("keeps a spring semester in the study year that began the previous autumn", () => {
    // kull 2026: 26h = 1, 27v = 2, 27h = 3, 28v = 4.
    expect(periodNumberFor("27v", 2026)).toBe(2);
    expect(periodNumberFor("27h", 2026)).toBe(3);
    expect(periodNumberFor("28v", 2026)).toBe(4);
    // kull 2024 in spring 2027 is 3rd year spring, i.e. period 6.
    expect(periodNumberFor("27v", 2024)).toBe(6);
  });

  it("returns null for a malformed semester id", () => {
    expect(periodNumberFor("høst", 2024)).toBeNull();
  });
});

describe("classifyPeriod — plain periods", () => {
  it("prefills every obligatory course and skips planElement markers", () => {
    const plan = planWith([
      {
        periodNumber: 1,
        direction: direction(null, null, [
          group("Obligatoriske emner", [
            { code: "EXPH0300", choice: "O" },
            { code: "HMS0002", choice: "O", credits: 0 },
            { code: "TDT4109", choice: "O" },
          ]),
          group("Krav om arbeidslivserfaring", [
            { code: "SIVINGPRA", choice: "O", credits: 0, planElement: true },
          ]),
        ]),
      },
    ]);
    const result = classifyPeriod(plan, 1);
    expect(result?.obligatory.map((c) => c.code)).toEqual(["EXPH0300", "HMS0002", "TDT4109"]);
    expect(result?.choice).toEqual([]);
    expect(result?.pendingChoice).toBeNull();
  });

  it("treats every non-O choice code as a choice, carrying the group name verbatim", () => {
    // BIT period 5: zero obligatory courses, eight interchangeable electives.
    const plan = planWith([
      {
        periodNumber: 5,
        direction: direction(null, null, [
          group("Valgbare IT-emner", [
            { code: "IT2810", choice: "M2A" },
            { code: "TDT4136", choice: "M2A" },
          ]),
          group("Områdeemne", [{ code: "ØKO1001", choice: "M" }]),
        ]),
      },
    ]);
    const result = classifyPeriod(plan, 5);
    expect(result?.obligatory).toEqual([]);
    expect(result?.choice.map((c) => [c.code, c.groupName])).toEqual([
      ["IT2810", "Valgbare IT-emner"],
      ["TDT4136", "Valgbare IT-emner"],
      ["ØKO1001", "Områdeemne"],
    ]);
  });

  it("returns null when the period doesn't exist (unpublished cohort / off-by-one math)", () => {
    expect(classifyPeriod(planWith([]), 5)).toBeNull();
  });
});

describe("classifyPeriod — studieretning waypoints", () => {
  it("asks the question and prefills the cross-direction obligatory intersection", () => {
    const result = classifyPeriod(directionGatedPlan(), 5);
    // TDT4136 + TMA4135 are obligatory in BOTH directions; TDT4117/TDT4172
    // belong to one each and must not be prefilled.
    expect(result?.obligatory.map((c) => c.code).sort()).toEqual(["TDT4136", "TMA4135"]);
    expect(result?.pendingChoice?.name).toBe("Valg av studieretning");
    expect(result?.pendingChoice?.deadlineDate).toBe("2026-05-15");
    expect(result?.pendingChoice?.directions).toEqual([
      { code: "MTDTDS-24", name: "Databaser og søk" },
      { code: "MTDTKI-24", name: "Kunstig intelligens" },
    ]);
    expect(result?.appliedDirection).toBeNull();
  });

  it("never leaves a direction-gated period empty", () => {
    const result = classifyPeriod(directionGatedPlan(), 5);
    expect(result?.obligatory.length).toBeGreaterThan(0);
  });

  it("folds in the chosen direction's courses and stops asking", () => {
    const result = classifyPeriod(directionGatedPlan(), 5, "MTDTDS-24");
    expect(result?.obligatory.map((c) => c.code)).toEqual(["TDT4117", "TDT4136", "TMA4135"]);
    expect(result?.choice.map((c) => c.code)).toEqual(["IT2810", "TDT4165"]);
    expect(result?.pendingChoice).toBeNull();
    expect(result?.appliedDirection).toEqual({
      code: "MTDTDS-24",
      name: "Databaser og søk",
    });
  });

  it("falls back to the intersection when the stored direction isn't in this plan", () => {
    const result = classifyPeriod(directionGatedPlan(), 5, "MTDTVD-22");
    expect(result?.obligatory.map((c) => c.code).sort()).toEqual(["TDT4136", "TMA4135"]);
    expect(result?.pendingChoice).not.toBeNull();
  });

  it("applies a single-option waypoint without asking", () => {
    const plan = planWith([
      {
        periodNumber: 5,
        direction: {
          code: null,
          name: null,
          courseGroups: [],
          waypoints: [
            {
              code: "WP1",
              name: "Valg av studieretning",
              description: null,
              deadlineDate: null,
              directions: [MTDT_DIRECTIONS[0] as (typeof MTDT_DIRECTIONS)[number]],
            },
          ],
        },
      },
    ]);
    const result = classifyPeriod(plan, 5);
    expect(result?.pendingChoice).toBeNull();
    expect(result?.appliedDirection?.code).toBe("MTDTDS-24");
    expect(result?.obligatory.map((c) => c.code)).toEqual(["TDT4117", "TDT4136", "TMA4135"]);
  });

  it("merges top-level courses with the chosen direction's, without duplicating", () => {
    const plan = planWith([
      {
        periodNumber: 5,
        direction: {
          code: null,
          name: null,
          courseGroups: [group("Fellesemner", [{ code: "TDT4136", choice: "O" }])],
          waypoints: [
            {
              code: "WP1",
              name: "Valg av studieretning",
              description: null,
              deadlineDate: null,
              directions: MTDT_DIRECTIONS,
            },
          ],
        },
      },
    ]);
    const result = classifyPeriod(plan, 5, "MTDTKI-24");
    expect(result?.obligatory.map((c) => c.code)).toEqual(["TDT4136", "TDT4172", "TMA4135"]);
    expect(result?.obligatory.filter((c) => c.code === "TDT4136")).toHaveLength(1);
    expect(result?.obligatory[0]?.groupName).toBe("Fellesemner");
  });
});

describe("isSuspiciousPrefill", () => {
  it("flags an obligatory prefill over a full semester load", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({
      code: `C${i}`,
      name: "x",
      version: "1",
      credits: 7.5,
      groupName: null,
      groupDescription: null,
    }));
    expect(isSuspiciousPrefill(many)).toBe(true);
    expect(isSuspiciousPrefill(many.slice(0, 4))).toBe(false);
  });

  it("treats null credits as zero rather than throwing", () => {
    expect(
      isSuspiciousPrefill([
        {
          code: "A",
          name: "x",
          version: "1",
          credits: null,
          groupName: null,
          groupDescription: null,
        },
      ]),
    ).toBe(false);
  });
});

describe("classifyPeriod — the gated pool (U7)", () => {
  it("collects every direction's non-intersection courses into the pool", () => {
    // In the gated branch only the intersection used to be collected and
    // `choice` was never populated, so "Fra studieplanen" was disabled
    // exactly when it was the student's only way forward and
    // `effectiveScope()` handed them the whole 5 470-course catalog.
    const result = classifyPeriod(directionGatedPlan(), 5);
    expect(result?.choice.map((c) => c.code).sort()).toEqual([
      "IT2810",
      "TDT4117",
      "TDT4165",
      "TDT4172",
    ]);
  });

  it("keeps intersection courses out of the pool — they are already prefilled", () => {
    const result = classifyPeriod(directionGatedPlan(), 5);
    const pool = result?.choice.map((c) => c.code) ?? [];
    expect(pool).not.toContain("TDT4136");
    expect(pool).not.toContain("TMA4135");
  });

  it("dedupes a course two directions both offer", () => {
    const result = classifyPeriod(directionGatedPlan(), 5);
    // IT2810 is `VA` in both MTDT directions.
    expect(result?.choice.filter((c) => c.code === "IT2810")).toHaveLength(1);
  });

  it("quotes the study plan's own group title verbatim (DR-5)", () => {
    const result = classifyPeriod(directionGatedPlan(), 5);
    expect(
      result?.choice.every((c) => c.groupName === "Obligatoriske og valgbare emner - 3. år"),
    ).toBe(true);
  });

  it("still empties the pool of a chosen direction's obligatory courses", () => {
    const result = classifyPeriod(directionGatedPlan(), 5, "MTDTDS-24");
    expect(result?.choice.map((c) => c.code)).toEqual(["IT2810", "TDT4165"]);
  });
});

describe("resolvePeriodFor", () => {
  it("derives the period from semester + cohort and classifies it in one call", () => {
    const resolved = resolvePeriodFor(directionGatedPlan(), "26h", 2024);
    expect(resolved.periodNumber).toBe(5);
    expect(resolved.courses?.obligatory.map((c) => c.code).sort()).toEqual(["TDT4136", "TMA4135"]);
    expect(resolved.pendingChoice?.name).toBe("Valg av studieretning");
  });

  it("threads a chosen studieretning through", () => {
    const resolved = resolvePeriodFor(directionGatedPlan(), "26h", 2024, "MTDTKI-24");
    expect(resolved.pendingChoice).toBeNull();
    expect(resolved.courses?.obligatory.map((c) => c.code)).toEqual([
      "TDT4136",
      "TDT4172",
      "TMA4135",
    ]);
  });

  it("reports a semester the plan has no period for (B4's honest dead end)", () => {
    // Kull 2024 in 27v is period 6, which this fixture does not have.
    const resolved = resolvePeriodFor(directionGatedPlan(), "27v", 2024);
    expect(resolved.periodNumber).toBe(6);
    expect(resolved.courses).toBeNull();
    expect(resolved.pendingChoice).toBeNull();
  });

  it("reports a malformed semester id as no period at all", () => {
    const resolved = resolvePeriodFor(directionGatedPlan(), "banana", 2024);
    expect(resolved.periodNumber).toBeNull();
    expect(resolved.courses).toBeNull();
  });
});

describe("prefillCredits", () => {
  it("sums the study plan's own figures, treating null as zero", () => {
    const courses = [
      {
        code: "MD4071",
        name: "",
        version: "1",
        credits: 30,
        groupName: null,
        groupDescription: null,
      },
      {
        code: "SMED8008",
        name: "",
        version: "1",
        credits: 7.5,
        groupName: null,
        groupDescription: null,
      },
      {
        code: "SMED8004",
        name: "",
        version: "1",
        credits: 5,
        groupName: null,
        groupDescription: null,
      },
    ];
    // CMEDFORSK period 1: legitimately 42,5 sp, and it must reach the page
    // with a note rather than being discarded into "0 av 30 sp" (B9.4).
    expect(prefillCredits(courses)).toBe(42.5);
    expect(isSuspiciousPrefill(courses)).toBe(true);
  });
});

/** `n` bare periods numbered 1..n, direction empty — only `periodNumber` matters here. */
function periodsCount(n: number): StudyPlan["periods"] {
  return Array.from({ length: n }, (_, i) => ({
    periodNumber: i + 1,
    direction: direction(null, null, []),
  }));
}

describe("maxPeriodNumber", () => {
  it("returns the highest non-null period number", () => {
    expect(maxPeriodNumber(planWith(periodsCount(10)))).toBe(10);
    expect(maxPeriodNumber(planWith(periodsCount(4)))).toBe(4);
    expect(maxPeriodNumber(planWith(periodsCount(2)))).toBe(2);
  });

  it("returns null when every period number is null", () => {
    const plan = planWith([
      { periodNumber: null, direction: direction(null, null, []) },
      { periodNumber: null, direction: direction(null, null, []) },
    ]);
    expect(maxPeriodNumber(plan)).toBeNull();
  });
});

describe("relevantCohorts", () => {
  // This replaces the homepage's old periodExists() chip filter, which
  // checked whether a period's courseGroups were non-empty and locked out
  // most cohorts (the S4 bug). Relevance is purely the period-range test.
  it("returns 5 descending cohorts for a 10-period (5-year) plan", () => {
    const plan = planWith(periodsCount(10));
    expect(relevantCohorts(plan, "26h")).toEqual([2026, 2025, 2024, 2023, 2022]);
  });

  it("returns 2 descending cohorts for a 4-period (2-year) plan", () => {
    const plan = planWith(periodsCount(4));
    expect(relevantCohorts(plan, "26h")).toEqual([2026, 2025]);
  });

  it("returns 1 cohort for a 2-period (årsstudium) plan", () => {
    const plan = planWith(periodsCount(2));
    expect(relevantCohorts(plan, "26h")).toEqual([2026]);
  });

  it("uses the spring branch of periodNumberFor for a spring semester", () => {
    const plan = planWith(periodsCount(10));
    expect(relevantCohorts(plan, "27v")).toEqual([2026, 2025, 2024, 2023, 2022]);
  });

  it("is empty when the plan has no period numbers at all", () => {
    const plan = planWith([{ periodNumber: null, direction: direction(null, null, []) }]);
    expect(relevantCohorts(plan, "26h")).toEqual([]);
  });
});
