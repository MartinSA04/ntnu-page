import { describe, expect, it } from "vitest";
import {
  mergeCatalogs,
  toCatalog,
  toPrograms,
  toSearchIndex,
  toSemesters,
} from "../crawler/transform.mjs";

/** Minimal catalog search hit; override the fields a test is about. */
function hit(overrides) {
  return {
    courseCode: "TDT4100",
    courseName: "Objektorientert programmering",
    courseUrl: null,
    courseVersion: "1",
    exams: [],
    examOnly: false,
    hasMultimedia: false,
    location: "Trondheim",
    ...overrides,
  };
}

describe("toCatalog", () => {
  it("sorts courses by code", () => {
    const hits = [
      {
        courseCode: "TDT4120",
        courseName: "B",
        courseUrl: null,
        courseVersion: "1",
        exams: [],
        examOnly: false,
        hasMultimedia: false,
        location: "Trondheim",
      },
      {
        courseCode: "TDT4100",
        courseName: "A",
        courseUrl: null,
        courseVersion: "1",
        exams: [],
        examOnly: false,
        hasMultimedia: false,
        location: "Trondheim",
      },
    ];
    const catalog = toCatalog(hits, 2026, "2026-07-24T00:00:00.000Z");
    expect(catalog.courses.map((c) => c.code)).toEqual(["TDT4100", "TDT4120"]);
  });

  it("dedupes verbatim duplicate hits by course code", () => {
    const hit = {
      courseCode: "TDT4100",
      courseName: "Objektorientert programmering",
      courseUrl: null,
      courseVersion: "1",
      exams: [],
      examOnly: false,
      hasMultimedia: false,
      location: "Trondheim",
    };
    const catalog = toCatalog([hit, { ...hit }], 2026, "2026-07-24T00:00:00.000Z");
    expect(catalog.courses).toHaveLength(1);
  });

  it("keeps only the SPEC-listed fields, including mapped exams", () => {
    const hits = [
      {
        courseCode: "TDT4100",
        courseName: "Objektorientert programmering",
        courseUrl: "https://ntnu.no/emner/TDT4100",
        courseVersion: "1",
        exams: [
          {
            date: "2026-12-05",
            season: "AUTUMN",
            continuation: false,
            submissionDate: "2026-11-01",
            withdrawalDate: "2026-11-20",
          },
        ],
        examOnly: false,
        hasMultimedia: true,
        location: "Trondheim",
      },
    ];
    const catalog = toCatalog(hits, 2026, "2026-07-24T00:00:00.000Z");
    expect(catalog.courses[0]).toEqual({
      code: "TDT4100",
      name: "Objektorientert programmering",
      url: "https://ntnu.no/emner/TDT4100",
      version: "1",
      location: "Trondheim",
      examOnly: false,
      exams: [{ season: "AUTUMN", date: "2026-12-05", continuation: false }],
      offeredYears: [2026],
    });
  });

  it("returns an empty course list for empty input", () => {
    const catalog = toCatalog([], 2026, "2026-07-24T00:00:00.000Z");
    expect(catalog).toEqual({
      year: 2026,
      years: [2026],
      crawledAt: "2026-07-24T00:00:00.000Z",
      courses: [],
    });
  });
});

describe("mergeCatalogs", () => {
  const CRAWLED_AT = "2026-07-24T00:00:00.000Z";

  /** Two adjacent catalog years sharing TDT4100; TMA4100 only in the older one. */
  function twoYears() {
    return [
      toCatalog(
        [hit({ courseName: "OOP 2026" }), hit({ courseCode: "TDT4120" })],
        2026,
        CRAWLED_AT,
      ),
      toCatalog(
        [hit({ courseName: "OOP 2025" }), hit({ courseCode: "TMA4100", courseName: "Matte 1" })],
        2025,
        CRAWLED_AT,
      ),
    ];
  }

  it("keeps courses that only exist in the older year", () => {
    const merged = mergeCatalogs(twoYears());
    expect(merged.courses.map((c) => c.code)).toEqual(["TDT4100", "TDT4120", "TMA4100"]);
    expect(merged.courses.find((c) => c.code === "TMA4100").offeredYears).toEqual([2025]);
  });

  it("records every year a course is offered in, newest first", () => {
    const merged = mergeCatalogs(twoYears());
    expect(merged.courses.find((c) => c.code === "TDT4100").offeredYears).toEqual([2026, 2025]);
    expect(merged.courses.find((c) => c.code === "TDT4120").offeredYears).toEqual([2026]);
  });

  it("keeps the newest year's metadata for a course present in both", () => {
    const merged = mergeCatalogs(twoYears());
    expect(merged.courses.find((c) => c.code === "TDT4100").name).toBe("OOP 2026");
  });

  it("reports the newest year as canonical and lists all crawled years", () => {
    const merged = mergeCatalogs(twoYears());
    expect(merged.year).toBe(2026);
    expect(merged.years).toEqual([2026, 2025]);
    expect(merged.crawledAt).toBe(CRAWLED_AT);
  });

  it("does not mutate the input catalogs", () => {
    const catalogs = twoYears();
    mergeCatalogs(catalogs);
    expect(catalogs[0].courses[0].offeredYears).toEqual([2026]);
  });

  it("passes a single catalog through with its year list intact", () => {
    const only = toCatalog([hit({})], 2026, CRAWLED_AT);
    expect(mergeCatalogs([only])).toEqual({ ...only, years: [2026] });
  });

  it("throws on an empty input list rather than emitting a yearless catalog", () => {
    expect(() => mergeCatalogs([])).toThrow(/at least one/);
  });
});

describe("toSearchIndex", () => {
  it("projects catalog courses to compact tuples, including exams", () => {
    const catalog = {
      year: 2026,
      courses: [
        {
          code: "TDT4100",
          name: "Objektorientert programmering",
          location: "Trondheim",
          version: "1",
          offeredYears: [2026, 2025],
          exams: [{ season: "AUTUMN", date: "2026-12-05", continuation: false }],
        },
        {
          code: "TDT4120",
          name: "Algoritmer og datastrukturer",
          location: "Trondheim",
          version: "1",
          offeredYears: [2026],
          exams: [],
        },
      ],
    };
    expect(toSearchIndex(catalog)).toEqual({
      year: 2026,
      courses: [
        [
          "TDT4100",
          "Objektorientert programmering",
          "Trondheim",
          [["AUTUMN", "2026-12-05"]],
          "1",
          [2026, 2025],
        ],
        ["TDT4120", "Algoritmer og datastrukturer", "Trondheim", [], "1", [2026]],
      ],
    });
  });

  it("carries a non-default course version through (DR-4)", () => {
    const catalog = {
      year: 2026,
      courses: [
        {
          code: "BBOA2010",
          name: "Innføring i skatterett",
          location: "Trondheim",
          version: "A",
          offeredYears: [2026],
          exams: [],
        },
      ],
    };
    expect(toSearchIndex(catalog).courses[0][4]).toBe("A");
  });

  it("marks a course that is no longer offered by its years alone", () => {
    const catalog = {
      year: 2026,
      courses: [
        {
          code: "TMA4100",
          name: "Matematikk 1",
          location: "Trondheim",
          version: "1",
          offeredYears: [2025],
          exams: [],
        },
      ],
    };
    expect(toSearchIndex(catalog).courses[0][5]).toEqual([2025]);
  });

  it("filters out continuation (kont) exams", () => {
    const catalog = {
      year: 2026,
      courses: [
        {
          code: "TDT4100",
          name: "Objektorientert programmering",
          location: "Trondheim",
          version: "1",
          offeredYears: [2026],
          exams: [
            { season: "AUTUMN", date: "2026-12-05", continuation: false },
            { season: "SPRING", date: "2027-04-10", continuation: true },
          ],
        },
      ],
    };
    expect(toSearchIndex(catalog).courses[0][3]).toEqual([["AUTUMN", "2026-12-05"]]);
  });

  it("emits an empty exams array when all exams are continuation", () => {
    const catalog = {
      year: 2026,
      courses: [
        {
          code: "TDT4100",
          name: "Objektorientert programmering",
          location: "Trondheim",
          version: "1",
          offeredYears: [2026],
          exams: [{ season: "SPRING", date: "2027-04-10", continuation: true }],
        },
      ],
    };
    expect(toSearchIndex(catalog).courses[0][3]).toEqual([]);
  });

  it("handles an empty catalog", () => {
    expect(toSearchIndex({ year: 2026, courses: [] })).toEqual({ year: 2026, courses: [] });
  });
});

describe("toPrograms", () => {
  it("sorts and dedupes programs by code", () => {
    const programs = [
      { code: "MTDT", name: "Datateknologi" },
      { code: "MLREAL", name: "Lektor" },
      { code: "MTDT", name: "Datateknologi (dup)" },
    ];
    const result = toPrograms(programs, "2026-07-24T00:00:00.000Z");
    expect(result.programs.map((p) => p.code)).toEqual(["MLREAL", "MTDT"]);
    expect(result.crawledAt).toBe("2026-07-24T00:00:00.000Z");
  });

  it("returns an empty program list for empty input", () => {
    expect(toPrograms([], "2026-07-24T00:00:00.000Z")).toEqual({
      crawledAt: "2026-07-24T00:00:00.000Z",
      programs: [],
    });
  });
});

describe("toSemesters", () => {
  it("passes semesters and current through unchanged", () => {
    const semesters = [{ id: "26h", year: 2026 }];
    const current = { id: "26h", year: 2026 };
    expect(toSemesters(semesters, current, "2026-07-24T00:00:00.000Z")).toEqual({
      crawledAt: "2026-07-24T00:00:00.000Z",
      current,
      semesters,
    });
  });

  it("handles a null current semester and empty list", () => {
    expect(toSemesters([], null, "2026-07-24T00:00:00.000Z")).toEqual({
      crawledAt: "2026-07-24T00:00:00.000Z",
      current: null,
      semesters: [],
    });
  });
});
