import { describe, expect, it } from "vitest";
import { toCatalog, toPrograms, toSearchIndex, toSemesters } from "../crawler/transform.mjs";

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
    });
  });

  it("returns an empty course list for empty input", () => {
    const catalog = toCatalog([], 2026, "2026-07-24T00:00:00.000Z");
    expect(catalog).toEqual({ year: 2026, crawledAt: "2026-07-24T00:00:00.000Z", courses: [] });
  });
});

describe("toSearchIndex", () => {
  it("projects catalog courses to compact tuples", () => {
    const catalog = {
      year: 2026,
      courses: [
        { code: "TDT4100", name: "Objektorientert programmering", location: "Trondheim" },
        { code: "TDT4120", name: "Algoritmer og datastrukturer", location: "Trondheim" },
      ],
    };
    expect(toSearchIndex(catalog)).toEqual({
      year: 2026,
      courses: [
        ["TDT4100", "Objektorientert programmering", "Trondheim"],
        ["TDT4120", "Algoritmer og datastrukturer", "Trondheim"],
      ],
    });
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
