/**
 * Render-level lock on the Karakterer figure's four audited defects
 * (pc-2/cpc-6, course-4, course-5/cpc-5). The model itself is covered by
 * tests/planner/grades.test.ts; what is asserted here is what actually
 * reaches the page — which chart leads, which semesters get bars at all, and
 * how tall those bars end up.
 *
 * This repo deliberately ships no jsdom/happy-dom, so `mountGradeChart` runs
 * against the ~50-line stand-in below. It implements only what the module
 * touches: createElement/append/replaceChildren, `[data-role]` lookup, a
 * `style.height` field and a textContent that concatenates. It is not a DOM —
 * no layout, no CSS, no real selector engine.
 */
import { beforeEach, describe, expect, test } from "vitest";
import { mountGradeChart } from "../../src/components/site/gradeChart.js";

class FakeEl {
  className = "";
  children: FakeEl[] = [];
  attrs = new Map<string, string>();
  style = { height: "", setProperty(_key: string, _value: string) {} };
  title = "";
  hidden = false;
  private ownText = "";

  set textContent(value: string) {
    this.ownText = value;
    this.children = [];
  }
  get textContent(): string {
    return this.ownText + this.children.map((child) => child.textContent).join(" ");
  }
  append(...nodes: FakeEl[]): void {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: FakeEl[]): void {
    this.children = [...nodes];
    this.ownText = "";
  }
  setAttribute(key: string, value: string): void {
    this.attrs.set(key, value);
  }
  querySelector(selector: string): FakeEl | null {
    const role = selector.match(/^\[data-role="(.+)"\]$/)?.[1];
    if (!role) return null;
    return this.walk().find((node) => node.attrs.get("data-role") === role) ?? null;
  }
  walk(): FakeEl[] {
    return this.children.flatMap((child) => [child, ...child.walk()]);
  }
}

type GradeSpec = { year: number; season: "Vår" | "Høst"; grades: [string, number][] };
type ExamSpec = { occasion: string | null; season: string | null };

let section: FakeEl;

const byClass = (cls: string): FakeEl[] =>
  section.walk().filter((node) => node.className.split(" ").includes(cls));
const textsOf = (cls: string): string[] => byClass(cls).map((node) => node.textContent);
/** Bar heights as whole percentages of the plot, in DOM order. */
const barHeights = (): number[] =>
  byClass("grades-bar").map((node) => Math.round(Number.parseFloat(node.style.height)));

const rowsOf = (specs: GradeSpec[]) =>
  specs.flatMap((spec) =>
    spec.grades.map(([grade, total]) => ({
      courseCode: "X-1",
      year: spec.year,
      semester: spec.season === "Vår" ? 1 : 3,
      semesterName: spec.season,
      grade,
      total,
    })),
  );

/** `exams: null` stands for a details fetch that did not answer. */
function stubFetch(specs: GradeSpec[], exams: ExamSpec[] | null): void {
  const globals = globalThis as unknown as { fetch: unknown };
  globals.fetch = async (url: string) => {
    if (String(url).endsWith("/grades"))
      return { ok: true, json: async () => ({ rows: rowsOf(specs) }) };
    if (exams === null) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ exams }) };
  };
}

beforeEach(() => {
  section = new FakeEl();
  const status = new FakeEl();
  status.setAttribute("data-role", "status");
  const body = new FakeEl();
  body.setAttribute("data-role", "body");
  body.hidden = true;
  section.append(status, body);
  const globals = globalThis as unknown as { document: unknown };
  globals.document = {
    getElementById: (id: string) => (id === "grades-section" ? section : null),
    createElement: () => new FakeEl(),
  };
});

/** A spring cohort of ~3n candidates spread over A/B/C plus some F. */
const spring = (year: number, n: number): GradeSpec => ({
  year,
  season: "Vår",
  grades: [
    ["A", n],
    ["B", n],
    ["C", n],
    ["F", Math.round(n / 4)],
  ],
});
/** The utsatt cohort DBH files as an autumn "semester" of its own. */
const resit = (year: number): GradeSpec => ({
  year,
  season: "Høst",
  grades: [
    ["E", 28],
    ["F", 42],
  ],
});
const SPRING_TAUGHT: ExamSpec[] = [
  { occasion: "Ordinær eksamen", season: "Vår 2027" },
  { occasion: "Utsatt eksamen", season: "Sommer 2027" },
];

describe("deferred sittings (pc-2/cpc-6)", () => {
  test("a re-sit cohort no longer leads the figure, and the omission is named", async () => {
    stubFetch(
      [
        resit(2025),
        resit(2024),
        resit(2023),
        spring(2025, 200),
        spring(2024, 200),
        spring(2023, 200),
      ],
      SPRING_TAUGHT,
    );
    await mountGradeChart("TDT4100");

    const terms = textsOf("grades-chart-term");
    expect(terms).toEqual(["Vår 2025", "Vår 2024", "Vår 2023"]);
    expect(textsOf("grades-source")[0]).toBe(
      "Utsatt eksamen er ikke tatt med (Høst 2025, Høst 2024, Høst 2023). Det er kandidater som tar eksamen på nytt, ikke et ordinært kull.",
    );
  });

  test("an unanswered exam scrape holds nothing out", async () => {
    stubFetch([resit(2025), spring(2025, 200)], null);
    await mountGradeChart("TDT4100");
    expect(textsOf("grades-chart-term")).toEqual(["Høst 2025", "Vår 2025"]);
    expect(textsOf("grades-source")).toHaveLength(1);
  });
});

describe("figure height (course-4)", () => {
  test("a semester everybody passed is one sentence, not a full-width slab", async () => {
    stubFetch(
      [
        { year: 2025, season: "Høst", grades: [["G", 84]] },
        { year: 2024, season: "Høst", grades: [["G", 91]] },
        {
          year: 2021,
          season: "Høst",
          grades: [
            ["G", 75],
            ["H", 25],
          ],
        },
      ],
      [{ occasion: "Ordinær eksamen", season: "Høst 2026" }],
    );
    await mountGradeChart("HMS0006");

    expect(textsOf("grades-masked")).toEqual([
      "Alle kandidatene fikk G.",
      "Alle kandidatene fikk G.",
    ]);
    // Only the two-grade semester keeps a plot.
    expect(byClass("grades-bar")).toHaveLength(2);
  });

  test("only the newest three semesters are drawn up front", async () => {
    stubFetch(
      [2025, 2024, 2023, 2022, 2021].map((year) => spring(year, 200)),
      null,
    );
    await mountGradeChart("TMA4100");

    // e2e/flows.pw.ts locates `#grades-section .grades-grid` strictly, so the
    // disclosure must NOT introduce a second one.
    expect(byClass("grades-grid")).toHaveLength(1);
    expect(byClass("grades-grid")[0]?.children).toHaveLength(3);
    expect(textsOf("np-summary")).toEqual(["Eldre semestre (2)"]);
    expect(byClass("grades-older-list")[0]?.children).toHaveLength(2);
  });
});

describe("y-scales (course-5/cpc-5)", () => {
  test("a pass/fail term does not set the scale for the letter charts", async () => {
    stubFetch(
      [
        {
          year: 2025,
          season: "Høst",
          grades: [
            ["A", 4],
            ["B", 9],
            ["C", 24],
            ["D", 25],
            ["E", 17],
            ["F", 21],
          ],
        },
        {
          year: 2021,
          season: "Høst",
          grades: [
            ["G", 83],
            ["H", 17],
          ],
        },
      ],
      null,
    );
    await mountGradeChart("TMA4100");

    // The tallest letter bar fills its own plot; before the split it was
    // 25/83 = 30 % of it, measured live at 28 px of 96.
    expect(barHeights()).toEqual([16, 36, 96, 100, 68, 84, 100, 20]);
    expect(textsOf("grades-chart-count")).toEqual([
      "100 kandidater",
      "100 kandidater · bestått/ikke bestått",
    ]);
  });

  test("a three-candidate cohort draws no bar and cannot own the scale", async () => {
    stubFetch(
      [
        {
          year: 2025,
          season: "Vår",
          grades: [
            ["C", 61],
            ["D", 50],
            ["E", 42],
          ],
        },
        {
          year: 2023,
          season: "Vår",
          grades: [
            ["C", 0],
            ["D", 3],
            ["F", 0],
          ],
        },
      ],
      null,
    );
    await mountGradeChart("HIST1505");

    expect(textsOf("grades-masked")).toEqual(["For få kandidater til å vise andeler: D 3."]);
    // 100 % of the plot belongs to the 153-candidate cohort's tallest bar,
    // not to one candidate's D.
    expect(barHeights()).toEqual([100, 82, 69]);
  });
});
