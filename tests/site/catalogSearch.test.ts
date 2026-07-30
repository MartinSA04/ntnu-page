import { describe, expect, it } from "vitest";
import {
  type CatalogRow,
  codePrefix,
  fold,
  parseQuery,
  prefixFacets,
  searchCatalog,
} from "../../src/components/site/catalogSearch.js";

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

  // search-5: the pre-fix fold only went one way, so a non-Norwegian keyboard
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

  // The appendix offered stale demotion as optional; TMA4100 is itself stale
  // in the 2026 catalog, so demoting would bury the finding's own example.
  it("does not demote a row that is not taught this year", () => {
    const stale: CatalogRow = ["TMA4100", "Matematikk 1", "Trondheim", [], "1", [2025]];
    const live = row("BMA1010", "Matematikk for ingeniørfag");
    expect(codes(searchCatalog([live, stale], "matematikk"))).toEqual(["TMA4100", "BMA1010"]);
  });
});

describe("codePrefix", () => {
  it("takes the leading letters of a course code, uppercased", () => {
    expect(codePrefix("TMA4100")).toBe("TMA");
    expect(codePrefix("MGLU1101")).toBe("MGLU");
    expect(codePrefix("imag2012")).toBe("IMAG");
  });

  it("keeps Æ/Ø/Å, which 58 programme and 238 course codes contain", () => {
    expect(codePrefix("SØK1000")).toBe("SØK");
    expect(codePrefix("TIØ4258")).toBe("TIØ");
  });

  // 325 of 5 470 catalog codes open with a digit ("6MP4210"). They are not an
  // error, they just cannot carry a subject chip.
  it("returns an empty prefix for a code that does not start with letters", () => {
    expect(codePrefix("6MP4210")).toBe("");
    expect(codePrefix("")).toBe("");
  });
});

describe("prefixFacets", () => {
  it("counts the prefixes in a result set, biggest first", () => {
    const rows = [
      row("TMA4100", "Matematikk 1"),
      row("TMA4110", "Matematikk 3"),
      row("TMA4120", "Matematikk 4K"),
      row("MA0001", "Brukerkurs i matematikk A"),
      row("MA1101", "Grunnkurs i analyse"),
      row("IMAG2012", "Matematikk for ingeniørfag"),
    ];
    expect(prefixFacets(rows)).toEqual([
      { prefix: "TMA", count: 3 },
      { prefix: "MA", count: 2 },
      { prefix: "IMAG", count: 1 },
    ]);
  });

  // Without a tie-break the chip row reshuffled between renders whenever two
  // subjects drew level, moving a chip out from under the pointer.
  it("breaks ties on the prefix so the chip order is stable", () => {
    const rows = [row("TDT4100", "Objektorientert"), row("IMAG2012", "Matematikk")];
    expect(prefixFacets(rows).map((f) => f.prefix)).toEqual(["IMAG", "TDT"]);
  });

  it("contributes no chip for a code with no letter prefix", () => {
    const rows = [row("6MP4210", "Matematikk"), row("TMA4100", "Matematikk 1")];
    expect(prefixFacets(rows)).toEqual([{ prefix: "TMA", count: 1 }]);
  });

  it("is empty for an empty result set", () => {
    expect(prefixFacets([])).toEqual([]);
  });
});
