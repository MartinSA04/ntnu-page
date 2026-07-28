import { describe, expect, test } from "vitest";
import {
  awardedBars,
  buildGradeSemesters,
  drawsChart,
  type GradeRowInput,
  type GradeSemester,
  peakPercent,
  peaksByScale,
} from "../../src/lib/planner/grades.js";

const row = (over: Partial<GradeRowInput> = {}): GradeRowInput => ({
  courseCode: "TDT4100-1",
  year: 2024,
  semester: 1,
  semesterName: "Vår",
  grade: "A",
  total: 10,
  ...over,
});

/** A whole spring cohort of `n` candidates split evenly over A/B/C. */
const springCohort = (year: number, n: number): GradeRowInput[] =>
  ["A", "B", "C"].map((grade) => row({ year, semester: 1, semesterName: "Vår", grade, total: n }));

describe("buildGradeSemesters", () => {
  test("groups rows into one bucket per (year, semester) with percentages", () => {
    const model = buildGradeSemesters([
      row({ grade: "A", total: 25 }),
      row({ grade: "B", total: 50 }),
      row({ grade: "F", total: 25 }),
    ]).semesters;
    expect(model).toHaveLength(1);
    expect(model[0]?.label).toBe("Vår 2024");
    expect(model[0]?.candidates).toBe(100);
    expect(model[0]?.bars.map((b) => [b.grade, b.percent])).toEqual([
      ["A", 25],
      ["B", 50],
      ["F", 25],
    ]);
  });

  test("sums counts across DBH course versions rather than overwriting them", () => {
    // The same (year, semester, grade) reported once per version — a candidate
    // sat the course, not a version of it.
    const model = buildGradeSemesters([
      row({ courseCode: "TDT4100-1", grade: "A", total: 30 }),
      row({ courseCode: "TDT4100-2", grade: "A", total: 10 }),
    ]).semesters;
    expect(model[0]?.bars).toHaveLength(1);
    expect(model[0]?.bars[0]?.count).toBe(40);
    expect(model[0]?.candidates).toBe(40);
  });

  test("a privacy-masked count is not a zero — it leaves the percentage base", () => {
    const model = buildGradeSemesters([
      row({ grade: "A", total: 30 }),
      row({ grade: "B", total: 10 }),
      row({ grade: "F", total: null }),
    ]).semesters;
    expect(model[0]?.masked).toBe(1);
    expect(model[0]?.candidates).toBe(40);
    // No F bar at all, rather than an F bar asserting 0 %.
    expect(model[0]?.bars.map((b) => b.grade)).toEqual(["A", "B"]);
    expect(model[0]?.bars[0]?.percent).toBe(75);
  });

  test("a semester whose every cell is masked is dropped, not drawn as empty", () => {
    const model = buildGradeSemesters([
      row({ year: 2023, grade: "A", total: null }),
      row({ year: 2023, grade: "B", total: null }),
    ]);
    expect(model.semesters).toEqual([]);
    expect(model.deferred).toEqual([]);
  });

  test("orders semesters newest first, autumn after spring within a year", () => {
    const model = buildGradeSemesters([
      row({ year: 2023, semester: 1, semesterName: "Vår" }),
      row({ year: 2024, semester: 3, semesterName: "Høst" }),
      row({ year: 2024, semester: 1, semesterName: "Vår" }),
      row({ year: 2023, semester: 3, semesterName: "Høst" }),
    ]).semesters;
    expect(model.map((s) => s.label)).toEqual(["Høst 2024", "Vår 2024", "Høst 2023", "Vår 2023"]);
  });

  test("falls back to DBH's numeric semester codes when the name is absent", () => {
    const model = buildGradeSemesters([
      row({ semesterName: null, semester: 3 }),
      row({ year: 2023, semesterName: null, semester: 1 }),
    ]).semesters;
    expect(model.map((s) => s.label)).toEqual(["Høst 2024", "Vår 2023"]);
  });

  test("sorts A–F in scale order regardless of input order", () => {
    const model = buildGradeSemesters([
      row({ grade: "F" }),
      row({ grade: "C" }),
      row({ grade: "A" }),
      row({ grade: "E" }),
    ]).semesters;
    expect(model[0]?.bars.map((b) => b.grade)).toEqual(["A", "C", "E", "F"]);
  });

  test("a pass/fail course still renders — non-letter codes sort after letters", () => {
    const model = buildGradeSemesters([
      row({ grade: "H", total: 20 }),
      row({ grade: "G", total: 80 }),
    ]).semesters;
    expect(model[0]?.bars.map((b) => b.grade)).toEqual(["G", "H"]);
    expect(model[0]?.bars[0]?.percent).toBe(80);
  });

  test("limit keeps the most recent semesters", () => {
    const rows = [2020, 2021, 2022, 2023, 2024].map((year) => row({ year }));
    const model = buildGradeSemesters(rows, { limit: 2 }).semesters;
    expect(model.map((s) => s.year)).toEqual([2024, 2023]);
  });

  test("empty input returns an empty model", () => {
    expect(buildGradeSemesters([])).toEqual({ semesters: [], deferred: [] });
  });
});

describe("grade scales (course-5/cpc-5)", () => {
  test("labels a letter semester, a pass/fail semester and a mixed one", () => {
    const model = buildGradeSemesters([
      row({ year: 2024, grade: "A", total: 10 }),
      row({ year: 2024, grade: "F", total: 5 }),
      row({ year: 2023, grade: "G", total: 40 }),
      row({ year: 2023, grade: "H", total: 6 }),
      row({ year: 2022, grade: "C", total: 30 }),
      row({ year: 2022, grade: "G", total: 4 }),
    ]).semesters;
    expect(model.map((s) => [s.year, s.scale])).toEqual([
      [2024, "letter"],
      [2023, "passfail"],
      [2022, "mixed"],
    ]);
  });

  test("a pass/fail semester cannot set the y-scale for the letter charts", () => {
    // TMA4100's shape: two covid pass/fail terms at ~83 % G beside four
    // letter terms whose tallest bar is ~25 %. Scaling the letters against
    // 83 % is what flattened them to 4–29 px of a 96 px plot.
    const model = buildGradeSemesters([
      row({ year: 2021, semester: 3, semesterName: "Høst", grade: "G", total: 83 }),
      row({ year: 2021, semester: 3, semesterName: "Høst", grade: "H", total: 17 }),
      row({ year: 2020, semester: 3, semesterName: "Høst", grade: "C", total: 25 }),
      row({ year: 2020, semester: 3, semesterName: "Høst", grade: "D", total: 25 }),
      row({ year: 2020, semester: 3, semesterName: "Høst", grade: "E", total: 25 }),
      row({ year: 2020, semester: 3, semesterName: "Høst", grade: "F", total: 25 }),
    ]).semesters;
    expect(peakPercent(model)).toBe(83);
    const letters = model.filter((s) => s.scale === "letter");
    expect(peakPercent(letters)).toBe(25);
  });
});

describe("deferred sittings (pc-2/cpc-6)", () => {
  const springTaught = [
    ...springCohort(2025, 200),
    ...springCohort(2024, 200),
    // The utsatt cohort DBH files as its own autumn "semester".
    row({ year: 2025, semester: 3, semesterName: "Høst", grade: "E", total: 28 }),
    row({ year: 2025, semester: 3, semesterName: "Høst", grade: "F", total: 42 }),
  ];

  test("without ordinarySeasons nothing is held out — we do not guess", () => {
    const model = buildGradeSemesters(springTaught);
    expect(model.semesters.map((s) => s.label)).toEqual(["Høst 2025", "Vår 2025", "Vår 2024"]);
    expect(model.deferred).toEqual([]);
  });

  test("an off-season re-sit cohort is held out, and no longer leads the figure", () => {
    const model = buildGradeSemesters(springTaught, { ordinarySeasons: ["Vår"] });
    expect(model.semesters.map((s) => s.label)).toEqual(["Vår 2025", "Vår 2024"]);
    expect(model.deferred.map((s) => s.label)).toEqual(["Høst 2025"]);
    // The 60 % F headline is gone from the drawn figure entirely.
    expect(peakPercent(model.semesters)).toBeCloseTo(100 / 3, 10);
  });

  test("a course examined in both terms keeps both", () => {
    const model = buildGradeSemesters(springTaught, { ordinarySeasons: ["Vår", "Høst"] });
    expect(model.semesters).toHaveLength(3);
    expect(model.deferred).toEqual([]);
  });

  test("a full-size off-season cohort is kept — a course may have moved term", () => {
    // Same shape, but the autumn sittings are 300-candidate cohorts. A re-sit
    // population is a fraction of the one it re-sits; this is not one.
    const moved = [
      ...springCohort(2025, 200),
      row({ year: 2023, semester: 3, semesterName: "Høst", grade: "C", total: 300 }),
      row({ year: 2023, semester: 3, semesterName: "Høst", grade: "D", total: 300 }),
    ];
    const model = buildGradeSemesters(moved, { ordinarySeasons: ["Vår"] });
    expect(model.semesters.map((s) => s.label)).toEqual(["Vår 2025", "Høst 2023"]);
    expect(model.deferred).toEqual([]);
  });

  test("holds nothing out when every bucket is off-season", () => {
    // An autumn-only course whose scrape only lists a spring utsatt sitting:
    // emptying the figure would be worse than drawing what DBH published.
    const model = buildGradeSemesters(
      [
        row({ year: 2025, semester: 3, semesterName: "Høst", grade: "A", total: 40 }),
        row({ year: 2024, semester: 3, semesterName: "Høst", grade: "A", total: 40 }),
      ],
      { ordinarySeasons: ["Vår"] },
    );
    expect(model.semesters).toHaveLength(2);
    expect(model.deferred).toEqual([]);
  });

  test("a bucket DBH gave no season name is never held out", () => {
    const model = buildGradeSemesters(
      [
        ...springCohort(2025, 200),
        row({ year: 2022, semester: null, semesterName: null, grade: "B", total: 9 }),
      ],
      { ordinarySeasons: ["Vår"] },
    );
    expect(model.semesters.map((s) => s.label)).toEqual(["Vår 2025", "2022"]);
    expect(model.deferred).toEqual([]);
  });

  test("limit counts ordinary semesters only, so re-sits cannot eat the figure", () => {
    const rows = [2025, 2024, 2023].flatMap((year) => [
      ...springCohort(year, 200),
      row({ year, semester: 3, semesterName: "Høst", grade: "F", total: 20 }),
    ]);
    const model = buildGradeSemesters(rows, { limit: 2, ordinarySeasons: ["Vår"] });
    expect(model.semesters.map((s) => s.label)).toEqual(["Vår 2025", "Vår 2024"]);
    expect(model.deferred.map((s) => s.label)).toEqual(["Høst 2025", "Høst 2024"]);
  });
});

describe("what earns bars (course-4/course-5)", () => {
  const only = (rows: GradeRowInput[]): GradeSemester => {
    const [semester] = buildGradeSemesters(rows).semesters;
    if (!semester) throw new Error("expected one semester");
    return semester;
  };

  test("an explicit DBH zero is not a grade anybody got", () => {
    const semester = only([
      row({ grade: "C", total: 0 }),
      row({ grade: "D", total: 40 }),
      row({ grade: "F", total: 0 }),
    ]);
    expect(semester.bars.map((b) => b.grade)).toEqual(["C", "D", "F"]);
    expect(awardedBars(semester).map((b) => b.grade)).toEqual(["D"]);
  });

  test("a one-grade semester is a sentence, not a chart", () => {
    // /emne/HMS0006/ drew four identical full-width "100,0 % G" slabs.
    expect(drawsChart(only([row({ grade: "G", total: 84 })]))).toBe(false);
  });

  test("a cohort under ten candidates is a sentence, not a chart", () => {
    // HIST1505 "Vår 2023 · 3 kandidater" drew a full-height 100 % D.
    const tiny = only([
      row({ grade: "C", total: 0 }),
      row({ grade: "D", total: 3 }),
      row({ grade: "F", total: 0 }),
    ]);
    expect(tiny.candidates).toBe(3);
    expect(drawsChart(tiny)).toBe(false);
  });

  test("an ordinary cohort with a spread of grades does draw", () => {
    expect(drawsChart(only([row({ grade: "A", total: 30 }), row({ grade: "B", total: 20 })]))).toBe(
      true,
    );
  });
});

describe("peaksByScale", () => {
  test("gives the letter charts their own scale, unset by pass/fail terms", () => {
    const model = buildGradeSemesters([
      row({ year: 2021, semester: 3, semesterName: "Høst", grade: "G", total: 83 }),
      row({ year: 2021, semester: 3, semesterName: "Høst", grade: "H", total: 17 }),
      row({ year: 2020, semester: 3, semesterName: "Høst", grade: "C", total: 25 }),
      row({ year: 2020, semester: 3, semesterName: "Høst", grade: "D", total: 25 }),
      row({ year: 2020, semester: 3, semesterName: "Høst", grade: "E", total: 25 }),
      row({ year: 2020, semester: 3, semesterName: "Høst", grade: "F", total: 25 }),
    ]).semesters;
    const peaks = peaksByScale(model);
    expect(peaks.get("letter")).toBe(25);
    expect(peaks.get("passfail")).toBe(83);
    // Before the split the letter chart drew 25/83 = 29 px of a 96 px plot.
    expect((25 / (peaks.get("letter") ?? 1)) * 100).toBe(100);
  });

  test("a semester that draws no chart cannot set the scale", () => {
    const model = buildGradeSemesters([
      // n=3, so no bars — and its 100 % must not shrink the real chart.
      row({ year: 2024, semester: 3, semesterName: "Høst", grade: "A", total: 3 }),
      row({ year: 2023, semester: 3, semesterName: "Høst", grade: "A", total: 20 }),
      row({ year: 2023, semester: 3, semesterName: "Høst", grade: "B", total: 30 }),
    ]).semesters;
    expect(peaksByScale(model).get("letter")).toBe(60);
  });

  test("is empty when nothing draws, so the caller never divides by a stale peak", () => {
    const model = buildGradeSemesters([row({ grade: "G", total: 84 })]).semesters;
    expect(peaksByScale(model).size).toBe(0);
  });
});

describe("peakPercent", () => {
  test("is the tallest bar across every semester — the shared y-scale", () => {
    const model = buildGradeSemesters([
      row({ year: 2024, grade: "A", total: 90 }),
      row({ year: 2024, grade: "B", total: 10 }),
      row({ year: 2023, grade: "A", total: 50 }),
      row({ year: 2023, grade: "B", total: 50 }),
    ]).semesters;
    expect(peakPercent(model)).toBe(90);
  });

  test("is 0 for an empty model, so the caller never divides by it", () => {
    expect(peakPercent([])).toBe(0);
  });
});
