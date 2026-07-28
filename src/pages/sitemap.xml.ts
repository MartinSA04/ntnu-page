import type { APIContext } from "astro";
import catalogData from "../../data/catalog.json";
import { buildSitemap } from "../lib/sitemap.js";

/**
 * The site's only route into the 5 470 statically generated course pages.
 *
 * Nothing server-rendered links to `/emne/` — `/emner/` ships an empty `<ul>`
 * and fills it from the search index in the browser, deliberately (a 5 470-row
 * anchor list would be 440 KB of blocking HTML on the page whose own problem is
 * phone weight). So without this file a crawler entering at `/` reaches three
 * pages and none of the 5 470 the build exists to produce (astro-2).
 *
 * Written by hand rather than pulled in via `@astrojs/sitemap`: a prerendered
 * endpoint over the catalog we already import costs one build-time pass and no
 * dependency. Composition is in `src/lib/sitemap.ts` so it can be unit-tested.
 */
export function GET(context: APIContext): Response {
  const site = context.site;
  if (!site) {
    // `site` is set in astro.config.mjs; a sitemap of relative URLs is invalid,
    // so fail the build rather than deploy one.
    throw new Error("astro.config.mjs must set `site` for /sitemap.xml to be generated.");
  }
  const body = buildSitemap(
    site,
    catalogData.courses.map((course) => course.code),
  );
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
