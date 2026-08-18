/**
 * Sitemap composition — the pure half of `src/pages/sitemap.xml.ts`.
 *
 * It used to enumerate 5 470 `/emne/{code}/` pages, which was the whole reason
 * the file existed: nothing server-rendered linked to them, so without a
 * sitemap a crawler entering at `/` reached three pages and none of the ones
 * the build was for. Those pages are deleted (PRODUCT D10), so what is left is
 * two static routes and the string work around them.
 *
 * Two URLs do not need a generator. It stays one because the endpoint has to
 * resolve them against `site` and escape the result, and a hand-written XML
 * literal in an `.astro` endpoint is not unit-testable.
 */

/** Every page the build emits, in the order a reader meets them. */
const STATIC_PATHS = ["/", "/planlegger/"] as const;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * The site's routes, as a sitemap.
 *
 * Deliberately no `<lastmod>`: the crawl runs nightly (crawl.yml) and would
 * stamp today's date on every URL every night, claiming the site changed when
 * nothing did. `<changefreq>`/`<priority>` are omitted for the same reason —
 * they are assertions we cannot back, and Google ignores them.
 */
export function buildSitemap(site: URL): string {
  const urls = STATIC_PATHS.map(
    (path) => `  <url><loc>${xmlEscape(new URL(path, site).href)}</loc></url>`,
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}
