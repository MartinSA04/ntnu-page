import { describe, expect, it } from "vitest";
import {
  cohortHint,
  fallbackCohorts,
  publishMonthFor,
} from "../../src/components/planner/studieinfo.js";

/**
 * The modal itself is DOM code and this repo has no jsdom to mount it in — its
 * rendering, focus and Escape behaviour are covered by e2e/flows.pw.ts. What
 * IS testable is the two decisions the audit found wrong: which kull chips a
 * programme with no study plan may offer (modals-2), and what the hint under
 * them is allowed to claim (plan-4/plan-5).
 */

describe("fallbackCohorts", () => {
  it("offers six start years, newest first, for an autumn semester", () => {
    expect(fallbackCohorts("26h")).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });

  it("counts a spring semester against the autumn that started its study year", () => {
    // Vår 2027 is kull 2026's second period, not kull 2027's first — the same
    // rule periodNumberFor documents.
    expect(fallbackCohorts("27v")).toEqual([2026, 2025, 2024, 2023, 2022, 2021]);
  });

  it("is empty for a semester id that does not parse", () => {
    expect(fallbackCohorts("høsten")).toEqual([]);
  });

  it("never offers an empty chip row for a plannable semester", () => {
    // modals-2: a kull row with no chips is a Lagre that cannot be satisfied.
    for (const id of ["26h", "27v", "27h"]) {
      expect(fallbackCohorts(id).length).toBeGreaterThan(0);
    }
  });
});

describe("cohortHint", () => {
  const semesterLabel = "Høst 2027";

  it("says nothing when the cohort's own plan was found and has the period", () => {
    expect(cohortHint({ cohort: 2026, foundYear: 2026, periodMissing: false, semesterLabel })).toBe(
      "",
    );
  });

  it("names the substituted cohort when findProgramPlan stepped back (plan-4)", () => {
    // MPPR kull 2026: 2026 and 2025 both 404, the 2024 document is what the
    // prefill actually comes from. publishedYears listed 2026, so the old gate
    // stayed silent here.
    expect(cohortHint({ cohort: 2026, foundYear: 2024, periodMissing: false, semesterLabel })).toBe(
      "Fant ingen studieplan for kull 2026. Viser kull 2024 i stedet, juster selv.",
    );
  });

  it("does not claim a missing plan when the fetch found the cohort's own (plan-4)", () => {
    // MTDT kull 2027 at Høst 2027 used to read "Fant ingen studieplan for kull
    // 2027" and then hand over a complete 30 sp week from the 2026 document.
    expect(
      cohortHint({ cohort: 2027, foundYear: 2027, periodMissing: false, semesterLabel }),
    ).not.toContain("Fant ingen studieplan");
  });

  it("says the plan is missing entirely when no document was found at all", () => {
    expect(cohortHint({ cohort: 2019, foundYear: null, periodMissing: false, semesterLabel })).toBe(
      "Fant ingen studieplan for kull 2019. Du kan legge til emner selv.",
    );
  });

  it("surfaces the period dead end the modal used to throw away (plan-5)", () => {
    // MTDT kull 2024 at Høst 2027 is period 7; the 2024 document has 1–6.
    expect(cohortHint({ cohort: 2024, foundYear: 2024, periodMissing: true, semesterLabel })).toBe(
      "Studieplanen for kull 2024 har ingen periode for Høst 2027 ennå. Velg et annet kull eller semester.",
    );
  });

  it("reports a substitution and a missing period together", () => {
    const text = cohortHint({
      cohort: 2026,
      foundYear: 2024,
      periodMissing: true,
      semesterLabel,
    });
    expect(text).toContain("Viser kull 2024");
    expect(text).toContain("har ingen periode for Høst 2027");
  });
});

describe("publishMonthFor", () => {
  it("is unchanged by the studieinfo rework", () => {
    expect(publishMonthFor("27v")).toBe("desember");
    expect(publishMonthFor("26h")).toBe("august");
  });
});
