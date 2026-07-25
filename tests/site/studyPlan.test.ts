import { describe, expect, it } from "vitest";
import {
  formatCreditFigure,
  formatUpdatedDate,
  periodSubtotal,
} from "../../src/components/site/studyPlan.js";

describe("formatCreditFigure", () => {
  it("uses a comma decimal, not a dot (DESIGN.md number convention)", () => {
    expect(formatCreditFigure(7.5)).toBe("7,5");
  });

  it("drops the decimal for whole numbers", () => {
    expect(formatCreditFigure(0)).toBe("0");
    expect(formatCreditFigure(30)).toBe("30");
  });
});

describe("formatUpdatedDate", () => {
  it("parses the plan API's DD-MM-YYYY-at-HH:MM:SS shape into a Norwegian date", () => {
    expect(formatUpdatedDate("12-05-2026 at 04:53:33")).toBe("12. mai 2026");
  });

  it("returns null (not the raw string) when the shape is unexpected", () => {
    expect(formatUpdatedDate("not a date")).toBeNull();
  });
});

function course(
  code: string,
  credits: number | null,
): {
  code: string;
  version: string | null;
  name: string | null;
  credits: number | null;
  planElement: boolean;
  studyChoice: null;
} {
  return { code, version: "1", name: code, credits, planElement: false, studyChoice: null };
}

describe("periodSubtotal", () => {
  // Real MTDT period 1 shape (probed against /api/program/MTDT/plan?year=2026):
  // four 7.5 sp courses plus a 0 sp HMS course and a 0 sp planElement marker.
  it("sums a period's top-level courses — the '0 + 7,5×4 = 30' sanity number (U17b)", () => {
    const direction = {
      code: null,
      name: null,
      courseGroups: [
        {
          code: null,
          name: null,
          description: null,
          courses: [
            course("HMS0002", 0),
            course("TDT4109", 7.5),
            course("TMA4400", 7.5),
            course("TMA4412", 7.5),
            course("EXPH0300", 7.5),
          ],
        },
      ],
      waypoints: [],
    };
    const result = periodSubtotal(direction);
    expect(result?.text).toBe("30 av 30 sp");
    expect(result?.hasUnknown).toBe(false);
  });

  it("is null when courseGroups is empty — a direction-gated period (U16) has no visible total", () => {
    const direction = {
      code: null,
      name: null,
      courseGroups: [],
      waypoints: [
        {
          code: null,
          name: "Valg av studieretning",
          description: null,
          deadlineDate: null,
          directions: [],
        },
      ],
    };
    expect(periodSubtotal(direction)).toBeNull();
  });

  it("flags courses with unknown credits rather than silently treating them as 0", () => {
    const direction = {
      code: null,
      name: null,
      courseGroups: [
        {
          code: null,
          name: null,
          description: null,
          courses: [course("TDT4109", 7.5), course("SIVINGPRA", null)],
        },
      ],
      waypoints: [],
    };
    const result = periodSubtotal(direction);
    expect(result?.text).toBe("7,5 av 30 sp");
    expect(result?.hasUnknown).toBe(true);
  });
});
