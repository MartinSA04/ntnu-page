import { describe, expect, it } from "vitest";
import { collectExamInputs, isDeferredOccasion } from "../../src/components/planner/examList.js";
import type { PlanCourseState } from "../../src/components/planner/types.js";
import type {
  CourseDetails,
  CourseExam,
  PlannerIndex,
  PlannerIndexCourse,
} from "../../src/lib/planner/data.js";

/** `26h`'s real window from data/semesters.json — the autumn exam period spills into February. */
const WINDOW_26H = { fromDate: "2026-08-17", examFinalDate: "2027-02-01" };

function indexRow(
  code: string,
  exams: [season: string, date: string | null][],
): PlannerIndexCourse {
  return [code, `${code} navn`, "Trondheim", exams, "1", [2026]];
}

function index(...rows: PlannerIndexCourse[]): PlannerIndex {
  return { year: 2026, courses: rows };
}

function exam(occasion: string, date: string | null): CourseExam {
  return {
    date,
    dateText: null,
    season: null,
    form: null,
    occasion,
    time: null,
    duration: null,
  };
}

function state(code: string, exams: CourseExam[] | null): PlanCourseState {
  const details: CourseDetails | null =
    exams === null
      ? null
      : {
          courseCode: code,
          courseName: `${code} navn`,
          credits: 7.5,
          location: "Trondheim",
          assessmentScheme: null,
          exams,
        };
  return {
    course: { code, name: `${code} navn`, version: "1", source: "manual" },
    hueVar: "--hue-blue",
    bundle: { timetable: [], details, errors: [] },
    loading: false,
    programCode: null,
  };
}

describe("isDeferredOccasion", () => {
  it("reads the two real NTNU labels", () => {
    expect(isDeferredOccasion("Ordinær eksamen")).toBe(false);
    expect(isDeferredOccasion("Utsatt eksamen")).toBe(true);
  });

  it("fails open on anything it does not recognise", () => {
    expect(isDeferredOccasion(null)).toBe(false);
    expect(isDeferredOccasion("")).toBe(false);
    expect(isDeferredOccasion("Avsluttende vurdering")).toBe(false);
  });

  it("catches kontinuasjon spellings and ignores case", () => {
    expect(isDeferredOccasion("KONTINUASJONSEKSAMEN")).toBe(true);
    expect(isDeferredOccasion("ny og utsatt eksamen")).toBe(true);
    expect(isDeferredOccasion("ordinær eksamen")).toBe(false);
  });
});

describe("collectExamInputs — the kont join (exams-1)", () => {
  it("drops HBIOT2030's utsatt sitting and keeps its ordinary one", () => {
    // Both catalog rows are {season: AUTUMN, continuation: false} — the flag
    // upstream never sets. Only `occasion` tells them apart.
    const inputs = collectExamInputs(
      [
        state("HBIOT2030", [
          exam("Ordinær eksamen", "2026-09-24"),
          exam("Utsatt eksamen", "2026-12-01"),
        ]),
      ],
      "26h",
      index(
        indexRow("HBIOT2030", [
          ["AUTUMN", "2026-09-24"],
          ["AUTUMN", "2026-12-01"],
        ]),
      ),
      WINDOW_26H,
    );
    expect(inputs).toEqual([{ code: "HBIOT2030", date: "2026-09-24" }]);
  });

  it("keeps ENG1102's January ordinary sitting and drops its October utsatt one", () => {
    const inputs = collectExamInputs(
      [
        state("ENG1102", [
          exam("Ordinær eksamen", "2027-01-08"),
          exam("Utsatt eksamen", "2026-10-06"),
        ]),
      ],
      "26h",
      index(
        indexRow("ENG1102", [
          ["AUTUMN", "2026-10-06"],
          ["AUTUMN", "2027-01-08"],
        ]),
      ),
      WINDOW_26H,
    );
    expect(inputs).toEqual([{ code: "ENG1102", date: "2027-01-08" }]);
  });

  it("renders MGLU1106 as dateless rather than as no exam at all", () => {
    // Its only dated Høst 2026 sittings are utsatt; the real Vår 2027 ordinary
    // sitting carries no date. Dropping both must not delete the course.
    const inputs = collectExamInputs(
      [
        state("MGLU1106", [
          exam("Utsatt eksamen", "2026-11-30"),
          exam("Utsatt eksamen", "2026-12-07"),
          exam("Ordinær eksamen", null),
        ]),
      ],
      "26h",
      index(
        indexRow("MGLU1106", [
          ["AUTUMN", "2026-11-30"],
          ["AUTUMN", "2026-12-07"],
        ]),
      ),
      WINDOW_26H,
    );
    expect(inputs).toEqual([{ code: "MGLU1106", date: null }]);
  });

  it("keeps a day the scrape lists as both ordinary and utsatt", () => {
    const inputs = collectExamInputs(
      [
        state("X1000", [
          exam("Ordinær eksamen", "2026-12-01"),
          exam("Utsatt eksamen", "2026-12-01"),
        ]),
      ],
      "26h",
      index(indexRow("X1000", [["AUTUMN", "2026-12-01"]])),
      WINDOW_26H,
    );
    expect(inputs).toEqual([{ code: "X1000", date: "2026-12-01" }]);
  });

  it("keeps every catalog date when the scrape is missing (details 404 / not loaded)", () => {
    const noDetails = collectExamInputs(
      [state("HBIOT2030", null)],
      "26h",
      index(
        indexRow("HBIOT2030", [
          ["AUTUMN", "2026-09-24"],
          ["AUTUMN", "2026-12-01"],
        ]),
      ),
      WINDOW_26H,
    );
    expect(noDetails).toEqual([
      { code: "HBIOT2030", date: "2026-09-24" },
      { code: "HBIOT2030", date: "2026-12-01" },
    ]);

    const noBundle: PlanCourseState = { ...state("HBIOT2030", null), bundle: null };
    expect(
      collectExamInputs(
        [noBundle],
        "26h",
        index(indexRow("HBIOT2030", [["AUTUMN", "2026-12-01"]])),
        WINDOW_26H,
      ),
    ).toEqual([{ code: "HBIOT2030", date: "2026-12-01" }]);
  });

  it("keeps a catalog date the scrape says nothing about", () => {
    const inputs = collectExamInputs(
      [state("X1000", [exam("Utsatt eksamen", "2026-11-02")])],
      "26h",
      index(indexRow("X1000", [["AUTUMN", "2026-12-01"]])),
      WINDOW_26H,
    );
    expect(inputs).toEqual([{ code: "X1000", date: "2026-12-01" }]);
  });

  it("leaves an already-dateless catalog exam alone", () => {
    const inputs = collectExamInputs(
      [state("X1000", [exam("Utsatt eksamen", "2026-11-02")])],
      "26h",
      index(indexRow("X1000", [["AUTUMN", null]])),
      WINDOW_26H,
    );
    expect(inputs).toEqual([{ code: "X1000", date: null }]);
  });

  it("emits nothing for a course the catalog lists no exam for this semester", () => {
    const inputs = collectExamInputs(
      [state("X1000", [exam("Ordinær eksamen", "2027-05-20")])],
      "26h",
      index(indexRow("X1000", [["SPRING", "2027-05-20"]])),
      WINDOW_26H,
    );
    expect(inputs).toEqual([]);
  });

  it("returns nothing without an index", () => {
    expect(collectExamInputs([state("X1000", [])], "26h", null, WINDOW_26H)).toEqual([]);
  });
});
