import { afterEach, describe, expect, it } from "vitest";
import {
  academicYearOf,
  clearCourseBundleMemo,
  clearPlannerIndexMemo,
  courseFetchState,
  decodeEntities,
  examsFromIndex,
  fetchCourseBundle,
  indexCoversSemester,
  indexForSemester,
  loadPlannerIndex,
  type PlannerIndex,
  type PlannerIndexCourse,
  seasonForSemesterId,
  type TimetableEntry,
  timetableOutcomeOf,
} from "../../src/lib/planner/data.js";

describe("seasonForSemesterId", () => {
  it("maps an autumn id to AUTUMN", () => {
    expect(seasonForSemesterId("26h")).toBe("AUTUMN");
  });

  it("maps a spring id to SPRING", () => {
    expect(seasonForSemesterId("27v")).toBe("SPRING");
  });

  it("is case-insensitive", () => {
    expect(seasonForSemesterId("27V")).toBe("SPRING");
    expect(seasonForSemesterId("26H")).toBe("AUTUMN");
  });

  it("returns null for a malformed id", () => {
    expect(seasonForSemesterId("2026h")).toBeNull();
    expect(seasonForSemesterId("26s")).toBeNull(); // summer: not h/v
    expect(seasonForSemesterId("")).toBeNull();
  });
});

/** A search-index row. Elements 4/5 (version, offeredYears) came with the two-year crawl. */
function course(exams: PlannerIndexCourse[3], code = "TDT4100"): PlannerIndexCourse {
  return [code, "Objektorientert programmering", "Trondheim", exams, "1", [2026, 2025]];
}

describe("academicYearOf", () => {
  it("puts an autumn and the following spring in one academic year", () => {
    expect(academicYearOf("26h")).toBe(2026);
    expect(academicYearOf("27v")).toBe(2026);
  });

  it("returns null for a malformed id", () => {
    expect(academicYearOf("banana")).toBeNull();
  });
});

describe("indexCoversSemester", () => {
  const index: PlannerIndex = { year: 2026, courses: [] };

  it("covers the crawl year's own autumn and the following spring", () => {
    expect(indexCoversSemester(index, "26h")).toBe(true);
    expect(indexCoversSemester(index, "27v")).toBe(true);
  });

  it("does not cover the next academic year — that is where borrowed dates came from (C3)", () => {
    expect(indexCoversSemester(index, "27h")).toBe(false);
    expect(indexCoversSemester(index, "28v")).toBe(false);
  });

  it("is false without an index", () => {
    expect(indexCoversSemester(null, "26h")).toBe(false);
  });
});

describe("examsFromIndex", () => {
  it("keeps only exams matching the semester's season", () => {
    const c = course([
      ["AUTUMN", "2026-12-10"],
      ["SPRING", "2027-05-20"],
    ]);
    expect(examsFromIndex(c, "26h")).toEqual([{ code: "TDT4100", date: "2026-12-10" }]);
    expect(examsFromIndex(c, "27v")).toEqual([{ code: "TDT4100", date: "2027-05-20" }]);
  });

  it("keeps an autumn exam dated into the following January/February (season match, not calendar year)", () => {
    // 26h's examLastDate in semesters.json is 2027-02-01 -- autumn exams
    // regularly fall in the next calendar year.
    const c = course([["AUTUMN", "2027-01-15"]]);
    expect(examsFromIndex(c, "26h")).toEqual([{ code: "TDT4100", date: "2027-01-15" }]);
  });

  it("keeps a dateless exam (does not drop it) so callers can render 'dato ikke satt'", () => {
    const c = course([["AUTUMN", null]]);
    expect(examsFromIndex(c, "26h")).toEqual([{ code: "TDT4100", date: null }]);
  });

  it("returns [] when no exam matches the season", () => {
    const c = course([["SPRING", "2027-05-20"]]);
    expect(examsFromIndex(c, "26h")).toEqual([]);
  });

  it("returns [] for a course with no exams", () => {
    expect(examsFromIndex(course([]), "26h")).toEqual([]);
  });

  it("returns [] for a malformed semesterId", () => {
    const c = course([["AUTUMN", "2026-12-10"]]);
    expect(examsFromIndex(c, "not-a-semester")).toEqual([]);
  });

  it("handles multiple exams in the same season (rare but not impossible)", () => {
    const c = course([
      ["AUTUMN", "2026-11-01"],
      ["AUTUMN", "2026-12-15"],
    ]);
    expect(examsFromIndex(c, "26h")).toEqual([
      { code: "TDT4100", date: "2026-11-01" },
      { code: "TDT4100", date: "2026-12-15" },
    ]);
  });

  // exams-4: 68 catalog courses repeat the same (season, date) tuple — FI3202
  // carries three identical {AUTUMN, null}. The tuple holds nothing that could
  // tell them apart, so they render as byte-identical rows.
  it("collapses byte-identical duplicate tuples (exams-4)", () => {
    const c = course(
      [
        ["AUTUMN", null],
        ["AUTUMN", null],
        ["AUTUMN", null],
      ],
      "FI3202",
    );
    expect(examsFromIndex(c, "26h")).toEqual([{ code: "FI3202", date: null }]);
  });

  it("collapses duplicate dated tuples as well", () => {
    const c = course([
      ["AUTUMN", "2026-12-10"],
      ["AUTUMN", "2026-12-10"],
    ]);
    expect(examsFromIndex(c, "26h")).toEqual([{ code: "TDT4100", date: "2026-12-10" }]);
  });

  it("keeps a dated and a dateless exam apart — they are not duplicates", () => {
    const c = course([
      ["AUTUMN", "2026-12-10"],
      ["AUTUMN", null],
    ]);
    expect(examsFromIndex(c, "26h")).toEqual([
      { code: "TDT4100", date: "2026-12-10" },
      { code: "TDT4100", date: null },
    ]);
  });
});

describe("examsFromIndex — the semester's own window (C3)", () => {
  // Straight out of data/semesters.json.
  const window26h = { fromDate: "2026-07-27", examFinalDate: "2027-02-28" };
  const window27h = { fromDate: "2027-07-26", examFinalDate: "2028-02-28" };

  it("keeps an exam inside the window", () => {
    const c = course([["AUTUMN", "2026-12-10"]]);
    expect(examsFromIndex(c, "26h", window26h)).toEqual([{ code: "TDT4100", date: "2026-12-10" }]);
  });

  it("keeps the January spill an autumn semester really has", () => {
    const c = course([["AUTUMN", "2027-01-09"]]);
    expect(examsFromIndex(c, "26h", window26h)).toEqual([{ code: "TDT4100", date: "2027-01-09" }]);
  });

  it("refuses to lend Høst 2026's dates to Høst 2027 — the C3 defect", () => {
    const c = course([["AUTUMN", "2027-01-09"]]);
    // Season matches, so the old season-only filter presented this as 27h's.
    expect(examsFromIndex(c, "27h")).toEqual([{ code: "TDT4100", date: "2027-01-09" }]);
    expect(examsFromIndex(c, "27h", window27h)).toEqual([]);
  });

  it("still keeps a dateless exam: it carries no year to be wrong about", () => {
    const c = course([["AUTUMN", null]]);
    expect(examsFromIndex(c, "27h", window27h)).toEqual([{ code: "TDT4100", date: null }]);
  });
});

describe("indexForSemester", () => {
  const index: PlannerIndex = {
    year: 2026,
    courses: [
      course([["AUTUMN", "2026-12-10"]], "TDT4100"),
      course([["AUTUMN", "2027-01-09"]], "TDT4109"),
      course([["SPRING", "2027-05-20"]], "TMA4100"),
      course([], "EXPH0300"),
    ],
  };
  const window26h = { fromDate: "2026-07-27", examFinalDate: "2027-02-28" };
  const window27h = { fromDate: "2027-07-26", examFinalDate: "2028-02-28" };

  it("narrows every row to the semester's season and window", () => {
    const narrowed = indexForSemester(index, "26h", window26h);
    expect(narrowed.courses.map((c) => [c[0], c[3].length])).toEqual([
      ["TDT4100", 1],
      ["TDT4109", 1],
      ["TMA4100", 0],
      ["EXPH0300", 0],
    ]);
  });

  it("leaves nothing to borrow when the semester is outside the crawl year", () => {
    const narrowed = indexForSemester(index, "27h", window27h);
    expect(narrowed.courses.every((c) => c[3].length === 0)).toBe(true);
  });

  it("preserves code, name, location, version and offeredYears", () => {
    const row = indexForSemester(index, "27v", null).courses[2];
    expect(row).toEqual([
      "TMA4100",
      "Objektorientert programmering",
      "Trondheim",
      [["SPRING", "2027-05-20"]],
      "1",
      [2026, 2025],
    ]);
  });

  it("hands back the original row when nothing was filtered out (no needless copies)", () => {
    const narrowed = indexForSemester(index, "26h", window26h);
    expect(narrowed.courses[0]).toBe(index.courses[0]);
    expect(narrowed.courses[3]).toBe(index.courses[3]);
  });

  it("keeps the index year, so indexCoversSemester still answers correctly", () => {
    expect(indexForSemester(index, "27h", window27h).year).toBe(2026);
  });
});

// --- The fetch layer ------------------------------------------------------

interface StubResponse {
  status?: number;
  body?: unknown;
}

const realFetch = globalThis.fetch;
const calls: { url: string; signal: AbortSignal | null }[] = [];

/**
 * Answers every request from `handler`. Throwing inside `handler` simulates a
 * transport failure (the promise `fetch` itself rejects with).
 */
function stubFetch(handler: (url: string) => StubResponse): void {
  calls.length = 0;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, signal: init?.signal ?? null });
    return (async () => {
      const res = handler(url);
      const status = res.status ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => res.body,
      } as Response;
    })();
  }) as typeof fetch;
}

function entry(overrides: Partial<TimetableEntry> = {}): TimetableEntry {
  return {
    courseCode: "TDT4100",
    courseName: { nob: null, nno: null, eng: null },
    dayNumber: 1,
    startTime: "08:15",
    endTime: "10:00",
    weeks: ["34-40"],
    rooms: [],
    title: "Forelesning",
    name: null,
    ...overrides,
  };
}

const DETAILS = {
  courseCode: "TDT4100",
  courseName: "Objektorientert programmering",
  credits: 7.5,
  location: "Trondheim",
  assessmentScheme: null,
  exams: [],
};

/** A healthy worker: entries for the timetable leg, details for the other. */
function healthy(entries: TimetableEntry[] = [entry()]) {
  return (url: string): StubResponse => ({
    body: url.includes("/timetable") ? entries : DETAILS,
  });
}

const timetableCalls = (): number => calls.filter((c) => c.url.includes("/timetable")).length;
const detailsCalls = (): number => calls.filter((c) => !c.url.includes("/timetable")).length;

afterEach(() => {
  globalThis.fetch = realFetch;
  clearCourseBundleMemo();
  clearPlannerIndexMemo();
});

describe("fetchCourseBundle — the honest per-course outcome", () => {
  it("reports entries with a count", async () => {
    stubFetch(healthy([entry(), entry({ dayNumber: 3 })]));
    const bundle = await fetchCourseBundle("TDT4100", 2026);
    expect(bundle.timetableOutcome).toEqual({ kind: "entries", count: 2 });
    expect(bundle.failures).toEqual([]);
    expect(bundle.errors).toEqual([]);
    expect(bundle.details?.credits).toBe(7.5);
  });

  it("keeps 'succeeded but empty' apart from 'failed' — the audit's #1 conflation", async () => {
    stubFetch(healthy([]));
    const bundle = await fetchCourseBundle("TDT4100", 2026);
    expect(bundle.timetable).toEqual([]);
    expect(bundle.timetableOutcome).toEqual({ kind: "empty" });
    expect(bundle.failures).toEqual([]);
  });

  it("reports a failure with a reason and leaves the timetable null (unknown ≠ empty)", async () => {
    stubFetch(() => ({ status: 500, body: { error: "Internal error" } }));
    const bundle = await fetchCourseBundle("TDT4100", 2026);
    expect(bundle.timetable).toBeNull();
    expect(bundle.timetableOutcome).toEqual({
      kind: "failed",
      reason: "server",
      message: "NTNU svarte ikke",
    });
  });

  it("is retrievable per course code, case-insensitively", async () => {
    expect(courseFetchState("TDT4100")).toBeNull(); // never asked
    stubFetch(healthy());
    const pending = fetchCourseBundle("TDT4100", 2026);
    expect(courseFetchState("TDT4100")).toEqual({ kind: "pending" });
    await pending;
    expect(courseFetchState("tdt4100")).toEqual({ kind: "entries", count: 1 });
  });

  it("derives the same outcome from a bundle, including a hand-built one", async () => {
    stubFetch(healthy([]));
    const bundle = await fetchCourseBundle("TDT4100", 2026);
    expect(timetableOutcomeOf(bundle)).toEqual({ kind: "empty" });
    expect(timetableOutcomeOf(null)).toEqual({ kind: "pending" });
    // courseTimetable.ts hand-builds a bundle without the honest fields.
    expect(timetableOutcomeOf({ timetable: [entry()], details: null, errors: [] })).toEqual({
      kind: "entries",
      count: 1,
    });
    expect(timetableOutcomeOf({ timetable: null, details: null, errors: [] })).toEqual({
      kind: "failed",
      reason: "unknown",
      message: "ukjent feil",
    });
  });
});

describe("fetchCourseBundle — Norwegian failure copy (pd-9/ux-7/ux-fail-6)", () => {
  const cases: [number | Error, string, string][] = [
    [404, "not-found", "finnes ikke i katalogen"],
    [400, "invalid", "ugyldig emnekode"],
    [429, "rate-limited", "for mange forespørsler akkurat nå"],
    [502, "server", "NTNU svarte ikke"],
  ];

  for (const [status, reason, message] of cases) {
    it(`maps HTTP ${String(status)} to "${message}"`, async () => {
      stubFetch(() => ({ status: status as number, body: { error: "Not found" } }));
      const bundle = await fetchCourseBundle("ZZZ9999", 2026);
      expect(bundle.timetableOutcome).toEqual({ kind: "failed", reason, message });
      expect(bundle.errors).toEqual([`timeplan: ${message}`, `detaljer: ${message}`]);
      // The upstream English is kept for debugging, never for rendering.
      expect(bundle.failures[0]?.detail).toBe("Not found");
      expect(bundle.errors.join(" ")).not.toMatch(/Not found/);
    });
  }

  it("maps a rejected fetch (offline) to 'ingen nettforbindelse', not 'Failed to fetch'", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const bundle = await fetchCourseBundle("TDT4100", 2026);
    expect(bundle.timetableOutcome).toEqual({
      kind: "failed",
      reason: "network",
      message: "ingen nettforbindelse",
    });
    expect(bundle.errors.join(" ")).not.toMatch(/Failed to fetch/);
  });

  it("falls back to the status code as detail when the error body is unparseable", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError("Unexpected end of JSON input");
        },
      }) as unknown as Response) as typeof fetch;
    const bundle = await fetchCourseBundle("TDT4100", 2026);
    expect(bundle.timetableOutcome).toEqual({
      kind: "failed",
      reason: "server",
      message: "NTNU svarte ikke",
    });
    expect(bundle.failures[0]?.detail).toBe("HTTP 503");
  });
});

describe("fetchCourseBundle — memoization (pd-5/pd-8)", () => {
  it("memoises a success and dedupes in-flight callers", async () => {
    stubFetch(healthy());
    const [a, b] = await Promise.all([
      fetchCourseBundle("TDT4100", 2026),
      fetchCourseBundle("TDT4100", 2026),
    ]);
    expect(a).toBe(b);
    await fetchCourseBundle("TDT4100", 2026);
    expect(timetableCalls()).toBe(1);
  });

  it("does not memoise a failure — a later call refetches after the network heals (pd-5)", async () => {
    let broken = true;
    stubFetch((url) => (broken ? { status: 500, body: { error: "boom" } } : healthy()(url)));
    const first = await fetchCourseBundle("TDT4100", 2026);
    expect(first.timetableOutcome.kind).toBe("failed");

    broken = false;
    const second = await fetchCourseBundle("TDT4100", 2026);
    expect(second.timetableOutcome).toEqual({ kind: "entries", count: 1 });
    expect(courseFetchState("TDT4100")).toEqual({ kind: "entries", count: 1 });
    expect(timetableCalls()).toBe(2);
  });

  it("does not memoise a details-only failure either", async () => {
    let broken = true;
    stubFetch((url) => {
      if (url.includes("/timetable")) return healthy()(url);
      return broken ? { status: 500, body: { error: "boom" } } : { body: DETAILS };
    });
    await fetchCourseBundle("TDT4100", 2026);
    broken = false;
    const second = await fetchCourseBundle("TDT4100", 2026);
    expect(second.details?.credits).toBe(7.5);
    expect(second.failures).toEqual([]);
  });

  it("fetches the year-less details URL once across a semester switch (pd-8)", async () => {
    stubFetch(healthy());
    await fetchCourseBundle("TDT4100", 2026, "1");
    await fetchCourseBundle("TDT4100", 2027, "1");
    expect(detailsCalls()).toBe(1);
    expect(timetableCalls()).toBe(2);
  });

  it("threads the version into the timetable URL only", async () => {
    stubFetch(healthy());
    await fetchCourseBundle("TDT4100", 2026, "3");
    expect(calls[0]?.url).toBe("/api/course/TDT4100/timetable?year=2026&version=3");
    expect(calls[1]?.url).toBe("/api/course/TDT4100");
  });

  it("percent-encodes an Æ/Ø/Å code (B1)", async () => {
    stubFetch(healthy());
    await fetchCourseBundle("BØA1100", 2026);
    expect(calls[0]?.url.startsWith("/api/course/B%C3%98A1100/timetable")).toBe(true);
  });

  it("clearCourseBundleMemo drops bundles, details and the per-code states", async () => {
    stubFetch(healthy());
    await fetchCourseBundle("TDT4100", 2026);
    clearCourseBundleMemo();
    expect(courseFetchState("TDT4100")).toBeNull();
    await fetchCourseBundle("TDT4100", 2026);
    expect(timetableCalls()).toBe(2);
    expect(detailsCalls()).toBe(2);
  });
});

describe("fetchCourseBundle — abort and timeout (pd-4)", () => {
  it("arms every request with a signal", async () => {
    stubFetch(healthy());
    await fetchCourseBundle("TDT4100", 2026);
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.signal?.aborted).toBe(false);
  });

  it("combines the caller's signal with the timeout cap and captures the abort", async () => {
    const seen: (AbortSignal | null)[] = [];
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        seen.push(init?.signal ?? null);
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      })) as typeof fetch;
    const controller = new AbortController();
    const pending = fetchCourseBundle("TDT4100", 2026, "1", { signal: controller.signal });
    // A composite, not the caller's own signal: the 15 s cap is in there too.
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]).not.toBe(controller.signal);

    controller.abort();
    const bundle = await pending;
    expect(seen[0]?.aborted).toBe(true);
    expect(bundle.timetableOutcome).toEqual({
      kind: "failed",
      reason: "timeout",
      message: "NTNU svarte ikke i tide",
    });
  });
});

describe("decodeEntities (ux-7)", () => {
  it("decodes the numeric ampersand NTNU ships in activity titles", () => {
    expect(decodeEntities("Forelesning 1 MTELSYS &#38; MTTK")).toBe("Forelesning 1 MTELSYS & MTTK");
  });

  it("decodes named and hex entities", () => {
    expect(decodeEntities("A &amp; B &lt;C&gt; &#x26; D")).toBe("A & B <C> & D");
  });

  it("leaves plain text and unknown entities alone", () => {
    expect(decodeEntities("Forelesning 1")).toBe("Forelesning 1");
    expect(decodeEntities("R&D &notanentity; 100 % &#;")).toBe("R&D &notanentity; 100 % &#;");
  });

  it("is applied to fetched entry titles and names", async () => {
    stubFetch(
      healthy([entry({ title: "Forelesning 1 MTELSYS &#38; MTTK", name: "Gruppe &amp; 2" })]),
    );
    const bundle = await fetchCourseBundle("TMA4400", 2026);
    expect(bundle.timetable?.[0]?.title).toBe("Forelesning 1 MTELSYS & MTTK");
    expect(bundle.timetable?.[0]?.name).toBe("Gruppe & 2");
  });
});

describe("loadPlannerIndex (pd-3)", () => {
  const index: PlannerIndex = { year: 2026, courses: [] };

  it("memoises a successful download", async () => {
    stubFetch(() => ({ body: index }));
    await loadPlannerIndex();
    await loadPlannerIndex();
    expect(calls.length).toBe(1);
  });

  it("does not memoise a rejection — a retry can succeed", async () => {
    let broken = true;
    stubFetch(() => (broken ? { status: 500, body: {} } : { body: index }));
    await expect(loadPlannerIndex()).rejects.toThrow();
    broken = false;
    await expect(loadPlannerIndex()).resolves.toEqual(index);
    expect(calls.length).toBe(2);
  });

  it("rejects with a classified, Norwegian failure that does not blame NTNU", async () => {
    stubFetch(() => ({ status: 500, body: {} }));
    const err = await loadPlannerIndex().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as { reason?: string }).reason).toBe("server");
    expect((err as Error).message).toBe("nettstedet svarte ikke");
  });
});
