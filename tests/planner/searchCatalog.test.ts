import { describe, expect, it } from "vitest";
import {
  type CatalogRow,
  fold,
  parseQuery,
  searchCatalog,
} from "../../src/lib/planner/searchCatalog.js";

/** Positional rows, same shape as `public/data/search-index.json`. */
function row(code: string, name: string, location: string | null = "Trondheim"): CatalogRow {
  return [code, name, location, [], "1", [2026]];
}

const codes = (rows: CatalogRow[]): string[] => rows.map((r) => r[0]);

describe("fold", () => {
  it("maps Æ/Ø/Å to their base letters", () => {
    expect(fold("Økonomi")).toBe("okonomi");
    expect(fold("Ålesund")).toBe("alesund");
    expect(fold("Maskinlæring")).toBe("maskinlaring");
  });

  // the pre-fix fold only went one way, so a non-Norwegian keyboard
  // could not reach a Norwegian title at all.
  it("folds the ae/oe/aa digraphs the same way, so both spellings meet", () => {
    expect(fold("maskinlaering")).toBe(fold("maskinlæring"));
    expect(fold("oekonomi")).toBe(fold("økonomi"));
    expect(fold("Aalesund")).toBe(fold("Ålesund"));
  });
});

describe("parseQuery", () => {
  it("splits on whitespace and keeps both joined forms", () => {
    expect(parseQuery("  TDT  4100 ")).toEqual({
      tokens: ["tdt", "4100"],
      compact: "tdt4100",
      joined: "tdt 4100",
    });
  });

  it("has no tokens for an empty or blank query", () => {
    expect(parseQuery("   ").tokens).toEqual([]);
  });
});

describe("searchCatalog — matching (search-5)", () => {
  const rows = [
    row("TDT4100", "Objektorientert programmering"),
    row("TDT4120", "Algoritmer og datastrukturer"),
    row("TDT4173", "Maskinlæring"),
    row("IE500618", "Maskinlæring"),
  ];

  it("finds a code typed with a space in it", () => {
    expect(codes(searchCatalog(rows, "TDT 4100"))).toEqual(["TDT4100"]);
  });

  it("finds a Norwegian title typed with digraphs", () => {
    expect(codes(searchCatalog(rows, "maskinlaering"))).toEqual(["IE500618", "TDT4173"]);
  });

  it("matches tokens in any order", () => {
    expect(codes(searchCatalog(rows, "datastrukturer algoritmer"))).toEqual(["TDT4120"]);
  });

  it("requires every token, not just one", () => {
    expect(searchCatalog(rows, "algoritmer kjemi")).toEqual([]);
  });

  it("returns nothing for a blank query", () => {
    expect(searchCatalog(rows, "   ")).toEqual([]);
  });
});

describe("searchCatalog — ranking (search-1 / astro-5)", () => {
  it("puts an exact code first, then code prefixes in code order", () => {
    const rows = [
      row("TDT4102", "Prosedyre- og objektorientert programmering"),
      row("TDT4100", "Objektorientert programmering"),
      row("XTDT4100", "Et emne som bare nevner TDT4100"),
      row("TDT4105", "Informasjonsteknologi, grunnkurs"),
    ];
    expect(codes(searchCatalog(rows, "tdt4100"))).toEqual([
      "TDT4100",
      "XTDT4100",
      // ^ substring-only, but nothing else scores above tier 0 here
    ]);
    expect(codes(searchCatalog(rows, "tdt41"))).toEqual([
      "TDT4100",
      "TDT4102",
      "TDT4105",
      "XTDT4100",
    ]);
  });

  it("lifts the title the query nearly is above longer titles that contain it", () => {
    const rows = [
      row("AR100919", "Matematikk for økonomer"),
      row("BMA1010", "Matematikk for ingeniørfag"),
      row("TMA4100", "Matematikk 1"),
      row("TMA4115", "Matematikk 3"),
      row("IMAA2012", "Diskret matematikk"),
    ];
    // Before ranking this was raw index order: AR100919, BMA1010, IMAA2012,
    // TMA4100, TMA4115 — the course the query means was fourth.
    expect(codes(searchCatalog(rows, "matematikk"))).toEqual([
      "TMA4100",
      "TMA4115",
      "AR100919",
      "BMA1010",
      "IMAA2012",
    ]);
  });

  it("ranks a word-boundary hit above a mid-word substring", () => {
    const rows = [
      row("AAA1000", "Materialteknologi og produksjon"),
      row("ZZZ9000", "Teknologi og samfunn"),
    ];
    expect(codes(searchCatalog(rows, "teknologi"))).toEqual(["ZZZ9000", "AAA1000"]);
  });

  /* WHAT STUDENTS TYPE vs WHAT THE CATALOG IS CALLED. Substring matching is a
     statement about spelling; a search box is asked a question about meaning.
     "matte" is not a substring of "matematikk", so against the real index it
     returned five food-technology courses and one about fatigue — and no
     amount of folding or edit distance fixes that without also turning it into
     "matteknologi". */
  it("answers a nickname with the course it means", () => {
    const rows = [row("TMAT3020", "Matteknologi prosjekt 1"), row("TMA4100", "Matematikk 1")];
    expect(codes(searchCatalog(rows, "matte"))).toEqual(["TMA4100", "TMAT3020"]);
  });

  /* Expansion ADDS a reading, it does not replace the one that was typed:
     "matteknologi" is still what "matte" literally matches, and it is still
     found — under the mathematics rather than instead of it. A student who
     wants meat technology types the word and gets it. */
  it("keeps the literal reading of a nickname, ranked below the expansion", () => {
    const rows = [row("TMAT3020", "Matteknologi prosjekt 1")];
    expect(codes(searchCatalog(rows, "matte"))).toEqual(["TMAT3020"]);
    expect(codes(searchCatalog(rows, "matteknologi"))).toEqual(["TMAT3020"]);
  });

  /* A multi-word expansion has to survive tokenisation: "algdat" becomes three
     tokens, and every one of them still has to be present in the row. */
  it("expands a nickname that stands for a whole phrase", () => {
    const rows = [
      row("TDT4120", "Algoritmer og datastrukturer"),
      row("TDT4100", "Objektorientert programmering"),
    ];
    expect(codes(searchCatalog(rows, "algdat"))).toEqual(["TDT4120"]);
  });

  // The appendix offered stale demotion as optional; TMA4100 is itself stale
  // in the 2026 catalog, so demoting would bury the finding's own example.
  it("does not demote a row that is not taught this year", () => {
    const stale: CatalogRow = ["TMA4100", "Matematikk 1", "Trondheim", [], "1", [2025]];
    const live = row("BMA1010", "Matematikk for ingeniørfag");
    expect(codes(searchCatalog([live, stale], "matematikk"))).toEqual(["TMA4100", "BMA1010"]);
  });
});
