import type { APIContext } from "astro";
import { buildSitemap } from "../lib/sitemap.js";

/**
 * The site's two routes, as a sitemap.
 *
 * It used to be the only way into 5 470 statically generated course pages,
 * which is why it exists at all; those are deleted (PRODUCT D10) and this is
 * now a two-line document. It stays because a sitemap is what `robots.txt`
 * points at, and because the alternative is explaining its absence.
 *
 * Written by hand rather than pulled in via `@astrojs/sitemap`: a prerendered
 * endpoint costs one build-time pass and no dependency. Composition is in
 * `src/lib/sitemap.ts` so it can be unit-tested.
 */
export function GET(context: APIContext): Response {
  const site = context.site;
  if (!site) {
    // `site` is set in astro.config.mjs; a sitemap of relative URLs is invalid,
    // so fail the build rather than deploy one.
    throw new Error("astro.config.mjs must set `site` for /sitemap.xml to be generated.");
  }
  return new Response(buildSitemap(site), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
