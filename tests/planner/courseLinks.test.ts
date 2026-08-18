/**
 * The two outbound destinations, which are the whole of PRODUCT mandate 3: this
 * site does not answer questions about a course, it links to the sites that do.
 *
 * Worth pinning rather than eyeballing because both URL shapes are somebody
 * else's contract — a wrong one is a 404 on their site, from our page, and
 * nothing in this repo would notice.
 */
import { describe, expect, it } from "vitest";
import { courseLinks } from "../../src/lib/planner/courseLinks.js";

describe("courseLinks", () => {
  it("points at the NTNU course page and at karakterweb, in that order", () => {
    const [ntnu, karakter] = courseLinks("TDT4120", "Algoritmer og datastrukturer", 2026);
    expect(ntnu?.href).toBe("https://www.ntnu.no/studier/emner/TDT4120/2026");
    expect(karakter?.href).toBe("https://karakterweb.no/ntnu/tdt4120");
  });

  it("omits the year segment when the caller has none", () => {
    // NTNU redirects a bare code to the current year, which is the right answer
    // when we cannot say better — a guessed year would point at a real page for
    // the wrong term.
    const [ntnu] = courseLinks("TDT4120", "Algoritmer", undefined);
    expect(ntnu?.href).toBe("https://www.ntnu.no/studier/emner/TDT4120");
  });

  it("uppercases for NTNU and lowercases for karakterweb", () => {
    // The two sites disagree about casing, and a stored plan can hold either:
    // the catalog is uppercase, a hand-typed add is whatever was typed.
    const [ntnu, karakter] = courseLinks("tdt4120", "Algoritmer", 2026);
    expect(ntnu?.href).toContain("/TDT4120/");
    expect(karakter?.href).toBe("https://karakterweb.no/ntnu/tdt4120");
  });

  it("percent-encodes Æ/Ø/Å, which 238 course codes carry", () => {
    const [ntnu, karakter] = courseLinks("BØA1100", "Bedriftsøkonomi", 2026);
    expect(ntnu?.href).toBe("https://www.ntnu.no/studier/emner/B%C3%98A1100/2026");
    expect(karakter?.href).toBe("https://karakterweb.no/ntnu/b%C3%B8a1100");
  });

  it("names the course in the accessible name, not just the destination", () => {
    // "ntnu.no" repeated down a five-course list is five identical link names.
    const [ntnu, karakter] = courseLinks("TDT4120", "Algoritmer", 2026);
    expect(ntnu?.ariaLabel).toContain("TDT4120 Algoritmer");
    expect(karakter?.ariaLabel).toContain("TDT4120 Algoritmer");
  });

  it("falls back to the code alone when the name is not known yet", () => {
    // The bundle may not have landed; an aria-label reading "for TDT4120 " with
    // a trailing space is worse than one naming only the code.
    const [ntnu] = courseLinks("TDT4120", "", 2026);
    expect(ntnu?.ariaLabel).toBe("Emnesiden for TDT4120 på ntnu.no");
  });
});
