import { describe, expect, it } from "vitest";
import {
  type CourseTimetableEntry,
  type CourseTimetableOptions,
  termLabel,
  termNote,
} from "../../src/components/site/courseTimetable.js";

const OPTIONS: CourseTimetableOptions = {
  code: "TDT4100",
  name: "Objektorientert programmering",
  version: "1",
  year: 2026,
  semester: { season: "AUTUMN", year: 2026, label: "Høst 2026" },
};

function entry(term: string | null): CourseTimetableEntry {
  return {
    courseCode: "TDT4100",
    courseName: { nob: null, nno: null, eng: null },
    dayNumber: 2,
    startTime: "12:15",
    endTime: "14:00",
    weeks: ["34-40"],
    rooms: [],
    title: "Forelesning",
    name: null,
    term,
  };
}

describe("termLabel", () => {
  it("reads the upstream term key back as Norwegian copy", () => {
    expect(termLabel("2026_HØST")).toBe("Høst 2026");
    expect(termLabel("2026_VÅR")).toBe("Vår 2026");
    expect(termLabel("2026_SOMMER")).toBe("Sommer 2026");
  });

  it("passes an unrecognised key through rather than inventing a season", () => {
    expect(termLabel("2026_XX")).toBe("2026_XX");
    expect(termLabel("høsten")).toBe("høsten");
  });
});

describe("termNote (U14 — one view, honest about which season it is)", () => {
  it("names the season without a caveat when it is the planned one", () => {
    expect(termNote([entry("2026_HØST")], OPTIONS)).toBe("Viser Høst 2026.");
  });

  // The defect U14 describes: TDT4100's only entries are 2026_VÅR, already
  // elapsed, shown under a bare "2026" chip a student would plan around.
  it("says outright when the entries are not the planned semester", () => {
    expect(termNote([entry("2026_VÅR")], OPTIONS)).toBe(
      "Viser Vår 2026 — ikke undervist i Høst 2026.",
    );
  });

  it("lists every term the entries carry, deduped", () => {
    expect(termNote([entry("2026_VÅR"), entry("2026_HØST"), entry("2026_VÅR")], OPTIONS)).toBe(
      "Viser Høst 2026, Vår 2026.",
    );
  });

  it("claims only the fetched year when upstream sends no term key", () => {
    expect(termNote([entry(null)], OPTIONS)).toBe("Viser timeplanen for 2026.");
  });

  // C1: a course carried over from the previous catalog year is fetched for
  // that year, so the line has to name it rather than the canonical one.
  it("names last year's season for a course not offered this year", () => {
    expect(termNote([entry("2025_HØST")], { ...OPTIONS, year: 2025 })).toBe(
      "Viser Høst 2025 — ikke undervist i Høst 2026.",
    );
  });
});
