/**
 * Catalog search: folding, tokenising and relevance ranking for `/emner/`.
 *
 * It lives here rather than inside the page because the page's own logic is
 * an inline `<script>` in an `.astro` file, which vitest cannot import — and
 * ranking is exactly the kind of pure logic that has to be pinned by tests.
 */

/**
 * One row of `public/data/search-index.json`, positional. New fields are only
 * ever appended — see docs/SPEC.md's crawled-data-contracts section.
 */
export type CatalogRow = [
  code: string,
  name: string,
  location: string | null,
  exams: [season: string, date: string | null][],
  version: string | null,
  offeredYears: number[],
];

/**
 * Case/diacritic-insensitive folding, applied to *both* sides so it stays
 * symmetric. NFD decomposes Å but not Æ/Ø, so those two are pre-mapped — 238
 * course codes contain Ø or Æ. The digraph pass after the diacritic strip
 * closes the other direction: "maskinlaering"/"oekonomi"/"aalesund" must reach
 * the same rows. Folding both sides means it can only ever add matches.
 */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/æ/g, "a")
    .replace(/ø/g, "o")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ae/g, "a")
    .replace(/oe/g, "o")
    .replace(/aa/g, "a");
}

/**
 * The letters a course code opens with — `"TMA4100"` → `"TMA"` — or `""` for
 * the 325 catalog codes that do not start with any.
 *
 * A *grouping* rule for this product's result list, not a fact about NTNU's
 * catalog, which is why it lives here rather than in `ntnu-api`: no claim is
 * made about what a prefix means, only that rows sharing one belong together.
 */
export function codePrefix(code: string): string {
  return /^[A-ZÆØÅa-zæøå]+/.exec(code.trim())?.[0].toUpperCase() ?? "";
}

/** One subject chip: the prefix and how many of the rows carry it. */
export interface PrefixFacet {
  prefix: string;
  count: number;
}

/**
 * Subject facets for a *result set*, biggest first.
 *
 * Computed from the rows a query already matched rather than from the whole
 * catalog: 360 prefixes in 5 470 courses is a wall nobody reads, while the 6
 * that survive "matematikk" are a filter worth having. Prefix-less codes
 * contribute no chip. Ties break on the prefix so the chip row cannot reshuffle
 * under the pointer.
 */
export function prefixFacets(rows: readonly CatalogRow[]): PrefixFacet[] {
  const counts = new Map<string, number>();
  for (const [code] of rows) {
    const prefix = codePrefix(code);
    if (prefix === "") continue;
    counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
  }
  return [...counts]
    .map(([prefix, count]) => ({ prefix, count }))
    .sort((a, b) => b.count - a.count || a.prefix.localeCompare(b.prefix, "nb"));
}

/** A parsed query: the folded tokens plus the two joined forms ranking needs. */
export interface CatalogQuery {
  /** Whitespace-separated folded tokens; every one must appear in a row. */
  tokens: string[];
  /** Tokens joined with no separator — a code typed as "TDT 4100". */
  compact: string;
  /** Tokens joined by single spaces — the normalised query as prose. */
  joined: string;
}

/**
 * Splits on whitespace and folds. Matching every token independently is what
 * makes "TDT 4100" and "datastrukturer algoritmer" find their courses; a single
 * `includes` of the whole trimmed string returned 0 treff for both.
 */
export function parseQuery(raw: string): CatalogQuery {
  const tokens = fold(raw.trim())
    .split(/\s+/)
    .filter((t) => t !== "");
  return { tokens, compact: tokens.join(""), joined: tokens.join(" ") };
}

/**
 * WHAT STUDENTS TYPE, mapped to what the catalog is called. Keys are already
 * folded; values are expanded into tokens and matched like any other query.
 *
 * This exists because substring matching is a statement about spelling and a
 * search box is asked a question about meaning. "matte" is what a Norwegian
 * student types for matematikk and it is not a substring of "matematikk" — so
 * `/emner/` answered it with five food-technology courses and one about
 * fatigue, and the planner's add dialog did the same. The nickname is not a
 * near-miss the folding could have caught; no amount of diacritic work or edit
 * distance turns "matte" into "matematikk" without also turning it into
 * "matteknologi".
 *
 * THE BAR FOR ADDING ONE: it must be what students actually say, and the
 * expansion must be a real catalog phrase — every entry here was run against
 * the index and lands on the course it claims. It stays short on purpose. A
 * synonym list is a maintenance surface, and each entry silently outranks
 * whatever the literal string would have found.
 */
const NICKNAMES: Readonly<Record<string, string>> = {
  matte: "matematikk",
  algdat: "algoritmer og datastrukturer",
  itgk: "informasjonsteknologi grunnkurs",
};

/**
 * The query as typed, plus the nickname-expanded reading of it when there is
 * one. Both are searched and a row keeps its BEST score, so expansion can only
 * ever add rows and lift them — "matteknologi" still answers "matte", below the
 * mathematics the student meant rather than instead of it.
 */
export function expandQuery(raw: string): CatalogQuery[] {
  const literal = parseQuery(raw);
  if (literal.tokens.length === 0) return [];
  const expanded = literal.tokens.flatMap((t) => (NICKNAMES[t] ?? t).split(" "));
  const alias: CatalogQuery = {
    tokens: expanded,
    compact: expanded.join(""),
    joined: expanded.join(" "),
  };
  return alias.joined === literal.joined ? [literal] : [literal, alias];
}

/** True when `token` starts a word in `hay` (both already folded). */
function startsWord(hay: string, token: string): boolean {
  for (let from = 0; ; ) {
    const at = hay.indexOf(token, from);
    if (at === -1) return false;
    if (at === 0 || !/[a-z0-9]/.test(hay.charAt(at - 1))) return true;
    from = at + 1;
  }
}

/**
 * Match quality, higher is better. Ranking exists because the index is
 * crawler-ordered, so an unranked `filter().slice()` put TMA4100 at row 77 of
 * 112 for "matematikk".
 */
export function scoreFolded(code: string, name: string, query: CatalogQuery): number {
  if (code === query.compact) return 4;
  if (code.startsWith(query.compact)) return 3;
  if (name.startsWith(query.joined)) return 2;
  if (query.tokens.every((t) => startsWord(name, t))) return 1;
  return 0;
}

/**
 * Filters and ranks in one pass (one fold per row, not two).
 *
 * Ties inside a code tier keep code order — "TDT41" expects TDT4100, TDT4102,
 * TDT4105. Ties inside a name tier go to the shorter name, which lifts
 * "Matematikk 1" above "Matematikk for økonomer".
 *
 * Deliberately NOT demoted: `offeredYears`-stale rows. TMA4100 is itself stale
 * in the 2026 catalog, so demoting them would bury the exact course the ranking
 * exists to surface.
 */
export function searchCatalog(rows: readonly CatalogRow[], raw: string): CatalogRow[] {
  const queries = expandQuery(raw);
  if (queries.length === 0) return [];

  const scored: { row: CatalogRow; score: number }[] = [];
  for (const row of rows) {
    const code = fold(row[0]);
    const name = fold(row[1]);
    let best = -1;
    for (const query of queries) {
      // A token never spans the code/name boundary, so testing the two
      // separately is the same predicate as one joined haystack.
      if (!query.tokens.every((t) => code.includes(t) || name.includes(t))) continue;
      best = Math.max(best, scoreFolded(code, name, query));
    }
    if (best < 0) continue;
    scored.push({ row, score: best });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.score < 3 && a.row[1].length !== b.row[1].length)
      return a.row[1].length - b.row[1].length;
    return a.row[0].localeCompare(b.row[0], "nb");
  });
  return scored.map((s) => s.row);
}
