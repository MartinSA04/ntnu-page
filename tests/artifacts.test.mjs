/**
 * Contract tests over the REAL crawled artifacts.
 *
 * `crawler.test.mjs` proves the transforms against fixtures whose largest
 * catalog is two courses, so every invariant docs/SPEC.md states was asserted
 * nowhere and `npm test` stayed green on a zero-course catalog. `prebuild` runs
 * `crawler/ensure-data.mjs`, so CI has all four files before vitest starts.
 *
 * They complement the in-crawler floors: `crawl.yml` runs crawl → build →
 * deploy with no test step, so nothing here protects the nightly deploy path.
 *
 * The artifacts are gitignored build output; this SKIPS when they are absent.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MIN_PROGRAMS, MIN_SEMESTERS } from "../crawler/transform.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Same list, same order as crawler/ensure-data.mjs's `required`. */
const REQUIRED = [
  "data/catalog.json",
  "data/programs.json",
  "data/semesters.json",
  "public/data/search-index.json",
];

const missing = REQUIRED.filter((rel) => !existsSync(join(ROOT, rel)));
if (missing.length > 0) {
  console.warn(`artifacts: skipping contract tests, missing ${missing.join(", ")}`);
}

/** @param {string} rel */
function read(rel) {
  return JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
}

const artifacts =
  missing.length === 0
    ? {
        catalog: read("data/catalog.json"),
        programs: read("data/programs.json"),
        semesters: read("data/semesters.json"),
        index: read("public/data/search-index.json"),
      }
    : null;

/**
 * A real catalog year is ~4 767 courses; the union of two is ~5 470. Well
 * below the smallest plausible number, so it only fires on a broken crawl.
 */
const MIN_ROWS = 3000;

/** Mirrors worker/src/routes.ts's `CODE_RE` — the gate every /api/* course path has to pass. */
const COURSE_CODE_RE = /^[A-ZÆØÅ0-9_-]{2,16}$/i;

/**
 * Programme codes need a wider class than course codes: `EMNE/HF`, `MSECT+OH`
 * and `MSØK/5` are real. This asserts the grammar the data actually uses, so a
 * *new* kind of upstream code cannot slip in unnoticed.
 */
const PROGRAM_CODE_RE = /^[A-ZÆØÅ0-9_+/-]{2,16}$/i;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

describe.skipIf(artifacts === null)("crawled artifacts", () => {
  describe("data/catalog.json", () => {
    it("carries a plausible number of courses", () => {
      expect(artifacts.catalog.courses.length).toBeGreaterThan(MIN_ROWS);
    });

    it("unions at least two catalog years, newest first, with the newest canonical", () => {
      const { year, years } = artifacts.catalog;
      expect(years.length).toBeGreaterThanOrEqual(2);
      expect([...years].sort((a, b) => b - a)).toEqual(years);
      expect(new Set(years).size).toBe(years.length);
      expect(year).toBe(years[0]);
    });

    it("keeps courses the canonical year dropped — the reason the union exists", () => {
      const carriedOver = artifacts.catalog.courses.filter(
        (c) => !c.offeredYears.includes(artifacts.catalog.year),
      );
      expect(carriedOver.length).toBeGreaterThan(0);
    });

    it("gives every course a non-empty, strictly descending offeredYears drawn from years", () => {
      const years = new Set(artifacts.catalog.years);
      for (const course of artifacts.catalog.courses) {
        expect(course.offeredYears.length, course.code).toBeGreaterThan(0);
        for (const year of course.offeredYears) expect(years.has(year), course.code).toBe(true);
        for (let i = 1; i < course.offeredYears.length; i += 1) {
          expect(course.offeredYears[i - 1], course.code).toBeGreaterThan(course.offeredYears[i]);
        }
      }
    });

    it("has no duplicate codes and is sorted by code", () => {
      const codes = artifacts.catalog.courses.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
      expect([...codes].sort((a, b) => a.localeCompare(b))).toEqual(codes);
    });

    it("gives every course a code the worker's /api/* validator accepts", () => {
      const bad = artifacts.catalog.courses
        .map((c) => c.code)
        .filter((c) => !COURSE_CODE_RE.test(c));
      expect(bad).toEqual([]);
    });

    it("emits exams as SPEC's {season, date, continuation} with ISO dates", () => {
      for (const course of artifacts.catalog.courses) {
        for (const exam of course.exams) {
          expect(Object.keys(exam).sort(), course.code).toEqual(["continuation", "date", "season"]);
          expect(typeof exam.continuation, course.code).toBe("boolean");
          if (exam.date !== null) expect(exam.date, course.code).toMatch(ISO_DATE_RE);
        }
      }
    });
  });

  describe("public/data/search-index.json", () => {
    it("has one row per catalog course, in the same order", () => {
      expect(artifacts.index.courses.length).toBe(artifacts.catalog.courses.length);
      expect(artifacts.index.courses.length).toBeGreaterThan(MIN_ROWS);
      expect(artifacts.index.courses.map((r) => r[0])).toEqual(
        artifacts.catalog.courses.map((c) => c.code),
      );
    });

    it("reports the catalog's canonical year", () => {
      expect(artifacts.index.year).toBe(artifacts.catalog.year);
    });

    it("is a six-element positional tuple in every row (no position renumbered)", () => {
      const arities = new Set(artifacts.index.courses.map((row) => row.length));
      expect([...arities]).toEqual([6]);
    });

    it("projects [code, name, location, exams, version, offeredYears] from the catalog", () => {
      const byCode = new Map(artifacts.catalog.courses.map((c) => [c.code, c]));
      for (const [code, name, location, exams, version, offeredYears] of artifacts.index.courses) {
        const course = byCode.get(code);
        expect(course, code).toBeDefined();
        expect(name, code).toBe(course.name);
        expect(location, code).toBe(course.location);
        expect(version, code).toBe(course.version);
        expect(offeredYears, code).toEqual(course.offeredYears);
        expect(exams, code).toEqual(
          course.exams.filter((e) => !e.continuation).map((e) => [e.season, e.date]),
        );
      }
    });

    it("emits exams as [season, dateOrNull] pairs", () => {
      for (const [code, , , exams] of artifacts.index.courses) {
        for (const exam of exams) {
          expect(exam.length, code).toBe(2);
          const [season, date] = exam;
          expect(season === null || typeof season === "string", code).toBe(true);
          if (date !== null) expect(date, code).toMatch(ISO_DATE_RE);
        }
      }
    });

    it("carries the non-default versions DR-4 needs, and no duplicate codes", () => {
      const codes = artifacts.index.courses.map((r) => r[0]);
      expect(new Set(codes).size).toBe(codes.length);
      expect(artifacts.index.courses.filter((r) => r[4] !== "1").length).toBeGreaterThan(0);
    });
  });

  describe("data/programs.json", () => {
    it("carries a plausible number of programmes, deduped and sorted by code", () => {
      const codes = artifacts.programs.programs.map((p) => p.code);
      expect(codes.length).toBeGreaterThanOrEqual(MIN_PROGRAMS);
      expect(new Set(codes).size).toBe(codes.length);
      expect([...codes].sort((a, b) => a.localeCompare(b))).toEqual(codes);
    });

    it("gives every programme a code inside the grammar the data uses", () => {
      const bad = artifacts.programs.programs
        .map((p) => p.code)
        .filter((c) => !PROGRAM_CODE_RE.test(c));
      expect(bad).toEqual([]);
    });
  });

  describe("data/semesters.json", () => {
    it("carries a plausible number of semesters", () => {
      expect(artifacts.semesters.semesters.length).toBeGreaterThanOrEqual(MIN_SEMESTERS);
    });
  });

  it("stamps every file with an ISO crawledAt", () => {
    for (const file of [artifacts.catalog, artifacts.programs, artifacts.semesters]) {
      expect(Number.isFinite(Date.parse(file.crawledAt))).toBe(true);
    }
  });
});
