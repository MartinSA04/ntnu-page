/**
 * Catalog search: folding, tokenising and relevance ranking for `/emner/`.
 *
 * It lives here rather than inside the page because the page's own logic is
 * an inline `<script>` in an `.astro` file, which vitest cannot import — and
 * ranking is exactly the kind of pure logic that has to be pinned by tests.
 */

/**
 * One row of `public/data/search-index.json`, positional. Elements 4 and 5
 * were appended by the two-year crawl (C1/C2): the catalog course version
 * that has to ride along on every timetable call, and the catalog years the
 * course is actually offered in. New fields are only ever appended — see
 * docs/SPEC.md's crawled-data-contracts section.
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
 * symmetric. NFD decomposes Å but not Æ/Ø, so those two are pre-mapped —
 * "okonomi" has to find "Økonomi" on a Norwegian site, and 238 course codes
 * contain Ø or Æ. The digraph pass after the diacritic strip closes the
 * other direction (search-5): a student on a non-Norwegian keyboard types
 * "maskinlaering"/"oekonomi"/"aalesund" and those have to reach the same
 * rows as "maskinlæring"/"økonomi"/"Ålesund". Folding both sides means the
 * pass can only ever add matches, never remove one.
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
 * The letters a course code opens with — `"TMA4100"` → `"TMA"`, `"MGLU1101"`
 * → `"MGLU"` — or `""` for the 325 catalog codes that do not start with any
 * (`"6MP4210"` and friends).
 *
 * This is a *grouping* rule for this product's result list, not a fact about
 * NTNU's catalog, which is why it lives here rather than in `ntnu-api`: no
 * claim is made about what a prefix means, only that rows sharing one belong
 * together under it. Students already talk this way ("et TMA-emne"), so it
 * makes a subject filter out of a field the index already has.
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
 * Deliberately computed from the rows a query already matched rather than
 * from the whole catalog: there are 360 prefixes in 5 470 courses, so a
 * standing index of them is a wall nobody reads, while the 6 that survive
 * "matematikk" are a filter worth having. Prefix-less codes contribute no
 * chip — a chip labelled "" filters nothing a student could have meant.
 *
 * Ties break on the prefix so the order is stable across renders; without it
 * the chip row reshuffled under the pointer whenever two subjects drew level.
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
  /** Tokens joined with no separator — a code typed as "TDT 4100" (search-5). */
  compact: string;
  /** Tokens joined by single spaces — the normalised query as prose. */
  joined: string;
}

/**
 * Splits on whitespace and folds. Matching every token independently is what
 * makes "TDT 4100" and "datastrukturer algoritmer" find their courses; a
 * single `includes` of the whole trimmed string returned 0 treff for both
 * (search-5).
 */
export function parseQuery(raw: string): CatalogQuery {
  const tokens = fold(raw.trim())
    .split(/\s+/)
    .filter((t) => t !== "");
  return { tokens, compact: tokens.join(""), joined: tokens.join(" ") };
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
 * crawler-ordered (alphabetical by code), so an unranked `filter().slice()`
 * put TMA4100 at row 77 of 112 for "matematikk" and pushed 42 mostly-
 * Trondheim rows off the end of the 200-cap for "teknologi" (search-1).
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
 * Ties inside a code tier keep code order — a student typing "TDT41" expects
 * TDT4100, TDT4102, TDT4105. Ties inside a name tier go to the shorter name,
 * which is what lifts "Matematikk 1" above "Matematikk for økonomer": the
 * query covers more of the title, so it is the closer match.
 *
 * Deliberately NOT demoted: `offeredYears`-stale rows. The appendix offered
 * that as optional, but TMA4100 — the canonical example the finding is
 * written around — is itself stale in the 2026 catalog, so demoting stale
 * rows would bury the exact course the ranking exists to surface.
 */
export function searchCatalog(rows: readonly CatalogRow[], raw: string): CatalogRow[] {
  const query = parseQuery(raw);
  if (query.tokens.length === 0) return [];

  const scored: { row: CatalogRow; score: number }[] = [];
  for (const row of rows) {
    const code = fold(row[0]);
    const name = fold(row[1]);
    // A token never spans the code/name boundary, so testing the two
    // separately is the same predicate as one joined haystack.
    if (!query.tokens.every((t) => code.includes(t) || name.includes(t))) continue;
    scored.push({ row, score: scoreFolded(code, name, query) });
  }

  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    if (a.score < 3 && a.row[1].length !== b.row[1].length)
      return a.row[1].length - b.row[1].length;
    return a.row[0].localeCompare(b.row[0], "nb");
  });
  return scored.map((s) => s.row);
}
