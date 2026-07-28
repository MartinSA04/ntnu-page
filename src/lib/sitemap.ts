/**
 * Sitemap composition — the pure half of `src/pages/sitemap.xml.ts`.
 *
 * Lives here, not in the endpoint, because the endpoint statically imports
 * `data/catalog.json` (a 1.9 MB gitignored build artifact) and pulling that
 * into the vitest pass to assert a string is the wrong trade. Everything below
 * is string work over an array of codes.
 */

/** Every non-course page the build emits, in the order a reader meets them. */
const STATIC_PATHS = ["/", "/planlegger/", "/emner/"] as const;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * `"BØA1100"` → `"https://…/emne/B%C3%98A1100/"`. 238 course codes carry Æ/Ø/Å;
 * sitemaps.org requires locations to be URL-escaped *and* entity-escaped, and
 * the worker decodes the segment before validating it (CLAUDE.md), so the
 * percent-encoded form is the one every client already sends.
 */
export function courseLoc(code: string, site: URL): string {
  return new URL(`/emne/${encodeURIComponent(code)}/`, site).href;
}

/**
 * The three static routes followed by one `/emne/{code}/` per catalog course.
 *
 * Deliberately no `<lastmod>`: the crawl runs nightly (crawl.yml) and would
 * stamp today's date on all 5 470 URLs every night, claiming the whole catalog
 * changed when almost none of it did. `<changefreq>`/`<priority>` are omitted
 * for the same reason — they are assertions we cannot back, and Google ignores
 * them.
 */
export function buildSitemap(site: URL, codes: readonly string[]): string {
  const locs = [
    ...STATIC_PATHS.map((path) => new URL(path, site).href),
    ...codes.map((code) => courseLoc(code, site)),
  ];
  const urls = locs.map((loc) => `  <url><loc>${xmlEscape(loc)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
