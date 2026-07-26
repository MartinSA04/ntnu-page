import { afterEach, describe, expect, it } from "vitest";
import {
  type ClashSemester,
  clashSentence,
  planClash,
  semesterLabel,
} from "../../src/components/site/planClash.js";
import { clearCourseBundleMemo, type TimetableEntry } from "../../src/lib/planner/data.js";
import type { PlanState } from "../../src/lib/planner/store.js";

const SEMESTER: ClashSemester = {
  id: "26h",
  name: "2026 Høst",
  teachingWeeks: [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47],
};

function entry(courseCode: string, overrides: Partial<TimetableEntry> = {}): TimetableEntry {
  return {
    courseCode,
    courseName: { nob: null, nno: null, eng: null },
    dayNumber: 2,
    startTime: "12:15",
    endTime: "14:00",
    weeks: ["34-40"],
    rooms: [],
    title: "Forelesning",
    name: null,
    ...overrides,
  };
}

function plan(...codes: string[]): PlanState {
  return {
    semesterId: "26h",
    courses: codes.map((code) => ({ code, name: code, version: "1", source: "manual" as const })),
  };
}

/** Stubs the worker API: every course's timetable comes from `timetables`. */
function stubFetch(timetables: Record<string, TimetableEntry[]>): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const match = /\/api\/course\/([^/?]+)\/timetable/.exec(url);
    const body = match ? (timetables[decodeURIComponent(match[1] ?? "")] ?? []) : {};
    return { ok: true, json: async () => body } as Response;
  }) as typeof fetch;
}

afterEach(() => {
  clearCourseBundleMemo();
});

describe("semesterLabel", () => {
  it("moves the year behind the season", () => {
    expect(semesterLabel("2026 Høst")).toBe("Høst 2026");
    expect(semesterLabel("2027 Vår")).toBe("Vår 2027");
  });

  it("passes through anything that is not '<year> <season>'", () => {
    expect(semesterLabel("Høst")).toBe("Høst");
  });
});

describe("planClash", () => {
  it("reports an empty plan without fetching anything", async () => {
    globalThis.fetch = (() => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    const verdict = await planClash({ code: "TDT4100", version: "1" }, plan(), SEMESTER);
    expect(verdict).toEqual({ kind: "empty" });
  });

  it("ignores the viewed course's own row in the plan", async () => {
    globalThis.fetch = (() => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    const verdict = await planClash({ code: "TDT4100", version: "1" }, plan("TDT4100"), SEMESTER);
    expect(verdict).toEqual({ kind: "empty" });
  });

  it("says off-semester when the course has no entries in the semester's weeks", async () => {
    stubFetch({ TDT4110: [entry("TDT4110")] });
    // Spring weeks against an autumn semester: nothing to collide with.
    const verdict = await planClash({ code: "TDT4100", version: "1" }, plan("TDT4110"), SEMESTER, [
      entry("TDT4100", { weeks: ["2-13"] }),
    ]);
    expect(verdict).toEqual({ kind: "off-semester" });
  });

  it("finds an overlapping lecture in the plan and names the slot", async () => {
    stubFetch({ TDT4110: [entry("TDT4110", { startTime: "13:15", endTime: "15:00" })] });
    const verdict = await planClash({ code: "TDT4100", version: "1" }, plan("TDT4110"), SEMESTER, [
      entry("TDT4100"),
    ]);
    expect(verdict).toEqual({
      kind: "clash",
      partners: [{ code: "TDT4110", dayNumber: 2, start: 13 * 60 + 15 }],
    });
    expect(clashSentence(verdict, SEMESTER)).toBe("Kolliderer med TDT4110, tirsdag 13:15.");
  });

  it("is clear when the plan's lecture is on another day", async () => {
    stubFetch({ TDT4110: [entry("TDT4110", { dayNumber: 4 })] });
    const verdict = await planClash({ code: "TDT4100", version: "1" }, plan("TDT4110"), SEMESTER, [
      entry("TDT4100"),
    ]);
    expect(verdict).toEqual({ kind: "clear" });
    expect(clashSentence(verdict, SEMESTER)).toBe("Ingen kollisjon i planen din for Høst 2026.");
  });

  it("does not report conflicts that are between two OTHER plan courses", async () => {
    stubFetch({
      TDT4110: [entry("TDT4110")],
      TMA4100: [entry("TMA4100")],
    });
    const verdict = await planClash(
      { code: "TDT4100", version: "1" },
      plan("TDT4110", "TMA4100"),
      SEMESTER,
      [entry("TDT4100", { dayNumber: 5 })],
    );
    expect(verdict).toEqual({ kind: "clear" });
  });

  it("never reds an øving overlap (DR-1: lecture×lecture only)", async () => {
    stubFetch({ TDT4110: [entry("TDT4110", { title: "Øving" })] });
    const verdict = await planClash({ code: "TDT4100", version: "1" }, plan("TDT4110"), SEMESTER, [
      entry("TDT4100"),
    ]);
    expect(verdict).toEqual({ kind: "clear" });
  });

  it("counts extra collisions rather than listing them all", () => {
    expect(
      clashSentence(
        {
          kind: "clash",
          partners: [
            { code: "TDT4110", dayNumber: 2, start: 735 },
            { code: "TMA4100", dayNumber: 3, start: 480 },
          ],
        },
        SEMESTER,
      ),
    ).toBe("Kolliderer med TDT4110, tirsdag 12:15 og 1 til.");
  });
});
