import { expect, test } from "@playwright/test";

/**
 * What this product assumes about NTNU's own data — the half that a fixture
 * cannot check, because a fixture is a copy of the assumption.
 *
 * `flows.pw.ts` and `cls.pw.ts` replay recorded responses (see `fixtures.ts`),
 * which makes them fast, offline and deterministic. The price is that they no
 * longer notice when upstream changes: a plan reshapes, a lecture moves, a
 * course is retired. This file is that notice. Every assertion below is a fact
 * some behavioural test silently depends on, so when one stops being true the
 * failure names the FACT — "TMA4400 no longer partitions its lectures by
 * programme" — instead of surfacing as a row count being wrong in a test about
 * modals.
 *
 * No browser: these are HTTP assertions through the worker, so the whole file
 * costs about a second. Skipped by default because it needs live upstream —
 * `npm run e2e:live` runs it, and so does the nightly CI schedule.
 *
 * When one fails: check whether the product is wrong or only the recording is.
 * If upstream simply moved, `npm run e2e:record` refreshes the fixtures and the
 * behavioural tests come back green with the new data.
 */

const LIVE = process.env.E2E_LIVE === "1" || process.env.E2E_CONTRACT === "1";

/** The catalog year the shipped index and the seeded plans are built around. */
const YEAR = 2026;

interface Course {
  code: string;
  planElement?: boolean;
  studyChoice?: { code: string };
}
interface Group {
  courses?: Course[];
}
interface Direction {
  code: string;
  courseGroups?: Group[];
  waypoints?: { directions?: Direction[] }[];
}
interface Plan {
  periods?: { periodNumber: number; direction?: Direction }[];
}
interface Entry {
  dayNumber: number;
  startTime: string;
  endTime: string;
  title: string | null;
  name: string | null;
  weeks: string[];
  rooms: { building: string | null; room: string | null }[];
  studyProgramKeys?: string[];
}

function period(plan: Plan, n: number): Direction {
  const found = plan.periods?.find((p) => p.periodNumber === n)?.direction;
  expect(found, `no period ${n} in this plan`).toBeTruthy();
  return found as Direction;
}

/** Obligatory course codes of a period — `planElement` rows are not courses. */
function obligatory(direction: Direction): string[] {
  return (direction.courseGroups ?? [])
    .flatMap((g) => g.courses ?? [])
    .filter((c) => c.studyChoice?.code === "O" && c.planElement !== true)
    .map((c) => c.code);
}

const minutes = (hhmm: string): number => {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
};

test.describe("upstream contract", () => {
  test.skip(!LIVE, "needs live NTNU data — run with `npm run e2e:live`");

  test("MTDT kull 2026 period 1 is the five courses the suite seeds", async ({ request }) => {
    // Every "5 rows" assertion in flows.pw.ts and the whole CLS plan fixture
    // rest on this exact set.
    const res = await request.get(`/api/program/MTDT/plan?year=${YEAR}`);
    expect(res.ok(), "MTDT plan unavailable").toBe(true);
    expect(obligatory(period((await res.json()) as Plan, 1)).sort()).toEqual(
      ["EXPH0300", "HMS0002", "TDT4109", "TMA4400", "TMA4412"].sort(),
    );
  });

  test("TMA4400 still partitions its lectures by programme", async ({ request }) => {
    // The cross-programme parallel pick — an MTDT student choosing a section
    // tagged for MTBYGG — is a documented capability with no other data source.
    const res = await request.get(`/api/course/TMA4400/timetable?year=${YEAR}&version=1`);
    const entries = (await res.json()) as Entry[];
    const tagged = entries.filter((e) => (e.studyProgramKeys ?? []).length > 0);
    expect(tagged.length, "no entry carries studyProgramKeys").toBeGreaterThan(0);

    const forOthers = tagged.filter(
      (e) => !(e.studyProgramKeys ?? []).includes("MTDT") && /forelesning/i.test(e.title ?? ""),
    );
    expect(forOthers.length, "no lecture tagged for a programme other than MTDT").toBeGreaterThan(0);
  });

test("TDT4110 still publishes numbered lecture parallels", async ({ request }) => {
    // The default-parallel rule (`groups.ts`) is exercised through this course.
    const res = await request.get(`/api/course/TDT4110/timetable?year=${YEAR}&version=1`);
    const titles = new Set(
      ((await res.json()) as Entry[])
        .map((e) => e.title ?? "")
        .filter((t) => /forelesningsparallell\s*\d/i.test(t)),
    );
    expect(titles.size, "fewer than two numbered parallels").toBeGreaterThanOrEqual(2);
  });

  test("TMA4401 still publishes complementary lecture sessions", async ({ request }) => {
    // The picker gate — "a lecture layer the week already draws in full is not
    // a choice" — needs a course with two lecture titles that are not
    // alternatives.
    const res = await request.get(`/api/course/TMA4401/timetable?year=${YEAR}&version=1`);
    const titles = new Set(
      ((await res.json()) as Entry[]).map((e) => e.title ?? e.name ?? "").filter(Boolean),
    );
    expect(titles.size, "TMA4401 no longer has two distinct session titles").toBeGreaterThanOrEqual(
      2,
    );
  });

  test("EXPH0300 still spreads its groups over several cities", async ({ request }) => {
    // The picker-narrowing test asserts a count well below what this publishes;
    // if the course stops being a many-city service course, it proves nothing.
    const res = await request.get(`/api/course/EXPH0300/timetable?year=${YEAR}&version=1`);
    const entries = (await res.json()) as Entry[];
    expect(entries.length, "EXPH0300 is no longer a large multi-campus course").toBeGreaterThan(20);
    const buildings = new Set(
      entries.flatMap((e) => e.rooms.map((r) => r.building ?? "")).filter(Boolean),
    );
    expect(buildings.size).toBeGreaterThan(1);
  });

  test("TDT4120 still publishes an all-day drop-in window", async ({ request }) => {
    // `isDropIn`'s five-hour rule, and the strip tests that depend on a day
    // carrying one.
    const res = await request.get(`/api/course/TDT4120/timetable?year=${YEAR}&version=1`);
    const longest = Math.max(
      ...((await res.json()) as Entry[]).map((e) => minutes(e.endTime) - minutes(e.startTime)),
    );
    expect(longest, "no session runs the five hours a drop-in window needs").toBeGreaterThanOrEqual(
      5 * 60,
    );
  });

  test("BSPL kull 2026 is still gated behind a campus choice coded with Ø", async ({ request }) => {
    // Both the nested-waypoint flow and the hash round-trip for a direction
    // code containing Ø are seeded from this one.
    const res = await request.get(`/api/program/BSPL/plan?year=${YEAR}`);
    const codes = (period((await res.json()) as Plan, 1).waypoints ?? []).flatMap((w) =>
      (w.directions ?? []).map((d) => d.code),
    );
    expect(codes.length, "BSPL period 1 has no waypoint to answer").toBeGreaterThan(0);
    expect(codes.some((c) => /[ÆØÅ]/.test(c)), `no Ø in ${codes.join(", ")}`).toBe(true);
  });

  test("a programme code containing Ø resolves rather than 400ing", async ({ request }) => {
    // The worker's `parseCode` decode. 58 programmes and 238 courses depend on
    // it, and it fails closed — a 400 for every one of them.
    const res = await request.get(`/api/program/MTIØT/plan?year=${YEAR}`);
    expect(res.status(), "MTIØT was rejected by our own validator").toBe(200);
  });

  test("the shipped index still carries a course the canonical year dropped", async ({
    request,
  }) => {
    // The two-year union, and the "ikke undervist i {year}" surfaces built on
    // it. Read from the built artifact rather than the API — that is what the
    // pages read.
    const index = (await (await request.get("/data/search-index.json")).json()) as {
      year: number;
      courses: [string, string, string | null, unknown, string | null, number[]][];
    };
    const stale = index.courses.filter((c) => !c[5].includes(index.year));
    expect(stale.length, "every catalog course is offered this year — the union is a no-op").toBeGreaterThan(0);
  });
});
