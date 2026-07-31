import { describe, expect, it } from "vitest";
import { detailsUrl } from "../../src/components/site/courseDetails.js";

// /`/api/course/TMA4100` 404s (the course is not in the 2026
// catalog), `/api/course/TMA4100?year=2025` returns the full payload — 703 of
// 5 470 course pages depended on the year the page already computed.
describe("detailsUrl", () => {
  it("pins the source year for a course carried over from last year's catalog", () => {
    expect(detailsUrl("TMA4100", 2025)).toBe("/api/course/TMA4100?year=2025");
  });

  // The worker keys its cache on ["details", code, year], so a bare call and a
  // ?year=<canonical> call would be two entries for one payload.
  it("stays year-less for a course offered in the canonical year", () => {
    expect(detailsUrl("TDT4100")).toBe("/api/course/TDT4100");
    expect(detailsUrl("TDT4100", null)).toBe("/api/course/TDT4100");
  });

  it("encodes codes carrying Æ/Ø/Å", () => {
    expect(detailsUrl("BØA1100")).toBe(`/api/course/${encodeURIComponent("BØA1100")}`);
  });
});
