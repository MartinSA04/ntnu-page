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
  /**
   * NO PLAN and an EMPTY PLAN are two states, and they got one sentence
   * between them. `/emne/[code]/` is the largest cold-traffic surface on the
   * site, so the common reader of this line has never touched the planner and
   * was being told about "planen din" regardless.
   */
  it("reports no plan at all without fetching any partner timetable", async () => {
    globalThis.fetch = (() => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    const verdict = await planClash({ code: "TDT4100", version: "1" }, plan(), SEMESTER, [
      entry("TDT4100"),
    ]);
    expect(verdict).toEqual({ kind: "no-plan" });
    expect(clashSentence(verdict, SEMESTER)).toBe(
      "Du har ingen plan ennå. Legg til emnet, så lages timeplanen din.",
    );
  });

  it("still says 'empty' when a plan exists and holds nothing else", async () => {
    globalThis.fetch = (() => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    // A programme, and no courses yet: the student HAS a plan, so the sentence
    // may talk about it.
    const withProgram: PlanState = {
      ...plan(),
      program: { code: "MTDT", name: "Datateknologi", cohort: 2026 },
    };
    const verdict = await planClash({ code: "TDT4100", version: "1" }, withProgram, SEMESTER, [
      entry("TDT4100"),
    ]);
    expect(verdict).toEqual({ kind: "empty" });
    expect(clashSentence(verdict, SEMESTER)).toBe("Ingen andre emner i planen din for Høst 2026.");
  });

  it("ignores the viewed course's own row in the plan", async () => {
    globalThis.fetch = (() => {
      throw new Error("should not fetch");
    }) as unknown as typeof fetch;
    const verdict = await planClash({ code: "TDT4100", version: "1" }, plan("TDT4100"), SEMESTER, [
      entry("TDT4100"),
    ]);
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

  // / the off-semester notice used to be pre-empted by the
  // empty-plan short-circuit, so a cold visitor's very first add — the one
  // that most needs it — never got it.
  it("still says off-semester when the plan is empty (cold visitor's first add)", async () => {
    stubFetch({ TDT4100: [entry("TDT4100", { weeks: ["2-13"] })] });
    const verdict = await planClash({ code: "TDT4100", version: "1" }, plan(), SEMESTER);
    expect(verdict).toEqual({ kind: "off-semester" });
    expect(clashSentence(verdict, SEMESTER)).toBe(
      "Undervises ikke i Høst 2026, ingen kollisjon å sjekke.",
    );
  });

  // "no entries this semester" and "entries we cannot classify" are
  // different states, and the page used to print "Undervises ikke i Høst 2026"
  // directly above a course's own autumn grid.
  //
  // The fixture is an øving-only autumn course, NOT IIK4100 as originally
  // written: its "Lecture and Lab exercise" title was a valid example of the
  // "other" bucket when this test was written, but later taught the
  // classifier to read joined combined sessions as lectures, so IIK4100 now
  // resolves to a real lecture verdict — a strictly better outcome for that
  // course, and the reason this fixture had to move. A course publishing only
  // øvinger this semester is the case that genuinely cannot be classified, and
  // it is what keeps the "unclassified" branch reachable.
  it("says unclassified, not off-semester, when in-semester entries exist but none is a lecture", async () => {
    stubFetch({ TDT4110: [entry("TDT4110")] });
    const verdict = await planClash({ code: "IIK4100", version: "1" }, plan("TDT4110"), SEMESTER, [
      entry("IIK4100", { title: "Øving", weeks: ["34-46"] }),
    ]);
    expect(verdict).toEqual({ kind: "unclassified" });
    expect(clashSentence(verdict, SEMESTER)).toBe(
      "Kan ikke sjekke kollisjon i Høst 2026. Ingen aktiviteter er merket som forelesning.",
    );
  });

  it("keeps off-semester for a course with no in-semester entries at all", async () => {
    // Same shape as the unclassified case above, but the entries are spring —
    // the two must not collapse back into one verdict.
    stubFetch({ TDT4110: [entry("TDT4110")] });
    const verdict = await planClash({ code: "IIK4100", version: "1" }, plan("TDT4110"), SEMESTER, [
      entry("IIK4100", { title: "Lecture and Lab exercise", weeks: ["2-13"] }),
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

  it("ignores a candidate's non-programme section once scoped to the plan's programme (S7)", async () => {
    // TDT4100 publishes two sections: a Tuesday MTDT-tagged one (the plan's
    // own programme, no overlap with anything) and a Thursday one tagged for
    // an unrelated programme (MTGEORT) that happens to overlap the plan's
    // TMA4100. Unscoped, both sections count and the Thursday one reds a
    // collision the MTDT student was never actually going to have — the
    // false positive study S7 documented (the grid, which already narrows to
    // the plan's programme, disagreed with this preview).
    const candidateEntries: TimetableEntry[] = [
      entry("TDT4100", {
        dayNumber: 2,
        startTime: "10:15",
        endTime: "12:00",
        studyProgramKeys: ["MTDT"],
      }),
      entry("TDT4100", {
        dayNumber: 4,
        startTime: "12:15",
        endTime: "14:00",
        studyProgramKeys: ["MTGEORT"],
      }),
    ];
    stubFetch({
      TMA4100: [entry("TMA4100", { dayNumber: 4, startTime: "12:15", endTime: "14:00" })],
    });
    const withProgram: PlanState = {
      ...plan("TMA4100"),
      program: { code: "MTDT", name: "Datateknologi", cohort: 2024 },
    };

    const unscoped = await planClash(
      { code: "TDT4100", version: "1" },
      withProgram,
      SEMESTER,
      candidateEntries,
    );
    expect(unscoped.kind).toBe("clash");

    const scoped = await planClash(
      { code: "TDT4100", version: "1" },
      withProgram,
      SEMESTER,
      candidateEntries,
      "MTDT",
    );
    expect(scoped).toEqual({ kind: "clear" });
  });

  /**
   *. TDT4110's three lecture parallels carry `studyProgramKeys` that
   * never mention MTDT, so `entriesForProgram` is a documented no-op and only
   * `applyGroupSelection`'s numbered-parallel default (the grid's own rule)
   * narrows them. Parallel 2 sits on top of the plan's TMA4412; the grid draws
   * parallel 1 and shows no conflict, so a red here is the false red DR-1
   * exists to prevent.
   */
  const PARALLELS: TimetableEntry[] = [
    entry("TDT4110", {
      title: "Forelesningsparallell 1",
      dayNumber: 5,
      startTime: "08:15",
      endTime: "10:00",
      studyProgramKeys: ["BMAT", "MTINGGEO", "MTELSYS", "MTBYGG"],
    }),
    entry("TDT4110", {
      title: "Forelesningsparallell 2",
      dayNumber: 3,
      startTime: "08:15",
      endTime: "10:00",
      studyProgramKeys: ["BMAT", "MTNANO"],
    }),
    entry("TDT4110", {
      title: "Forelesningsparallell 3",
      dayNumber: 1,
      startTime: "14:15",
      endTime: "16:00",
      studyProgramKeys: ["MBIOT5"],
    }),
  ];
  const TMA4412 = entry("TMA4412", { dayNumber: 3, startTime: "08:15", endTime: "10:00" });

  it("ignores a lecture parallel the grid's default discards (cpc-1)", async () => {
    stubFetch({ TMA4412: [TMA4412] });
    const verdict = await planClash(
      { code: "TDT4110", version: "1" },
      { ...plan("TMA4412"), program: { code: "MTDT", name: "Datateknologi", cohort: 2026 } },
      SEMESTER,
      PARALLELS,
      "MTDT",
    );
    expect(verdict).toEqual({ kind: "clear" });
  });

  it("reds the parallel the student actually picked for the candidate", async () => {
    stubFetch({ TMA4412: [TMA4412] });
    const withPick: PlanState = {
      semesterId: "26h",
      courses: [
        { code: "TMA4412", name: "TMA4412", version: "1", source: "manual" },
        {
          code: "TDT4110",
          name: "TDT4110",
          version: "1",
          source: "manual",
          groups: ["forelesningsparallell-2"],
        },
      ],
    };
    const verdict = await planClash(
      { code: "TDT4110", version: "1" },
      withPick,
      SEMESTER,
      PARALLELS,
      "MTDT",
    );
    expect(verdict).toEqual({
      kind: "clash",
      partners: [{ code: "TMA4412", dayNumber: 3, start: 8 * 60 + 15 }],
    });
  });

  it("honours a PARTNER course's group pick when diffing against it", async () => {
    stubFetch({ TDT4110: PARALLELS });
    const partnerPicked: PlanState = {
      semesterId: "26h",
      courses: [
        {
          code: "TDT4110",
          name: "TDT4110",
          version: "1",
          source: "manual",
          groups: ["forelesningsparallell-2"],
        },
      ],
    };
    const picked = await planClash(
      { code: "TMA4412", version: "1" },
      partnerPicked,
      SEMESTER,
      [TMA4412],
      "MTDT",
    );
    expect(picked).toEqual({
      kind: "clash",
      partners: [{ code: "TDT4110", dayNumber: 3, start: 8 * 60 + 15 }],
    });

    // Same plan without the pick: the default parallel 1 is on Friday.
    clearCourseBundleMemo();
    stubFetch({ TDT4110: PARALLELS });
    const defaulted = await planClash(
      { code: "TMA4412", version: "1" },
      plan("TDT4110"),
      SEMESTER,
      [TMA4412],
      "MTDT",
    );
    expect(defaulted).toEqual({ kind: "clear" });
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
