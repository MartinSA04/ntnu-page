/**
 * /sitemap.xml is only correct if `site` in astro.config.mjs and the `Sitemap:`
 * line in public/robots.txt name the same host. Both are still the placeholder
 * ntnu.martinsundal.no and have to be changed together, which is exactly the
 * kind of two-file agreement nothing else in this repo would notice breaking.
 *
 * The sitemap used to be the ONLY route into 5 470 course pages, which is what
 * made it load-bearing rather than a formality. Those pages are deleted
 * (PRODUCT D10) and it is down to two URLs; the host agreement is still worth
 * a gate, and the shape assertions are cheap.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSitemap } from "../../src/lib/sitemap.js";

const repo = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");

const SITE = new URL("https://example.test/");

describe("robots.txt / astro.config agreement", () => {
  const config = repo("astro.config.mjs");
  const robots = repo("public/robots.txt");

  const configuredSite = /^\s*site:\s*"([^"]+)"/m.exec(config)?.[1];
  const sitemapLine = /^Sitemap:\s*(\S+)\s*$/m.exec(robots)?.[1];

  it("astro.config.mjs declares a site", () => {
    expect(configuredSite).toMatch(/^https:\/\//);
  });

  it("robots.txt points at the sitemap on that exact host", () => {
    expect(sitemapLine).toBe(`${configuredSite}/sitemap.xml`);
  });

  it("robots.txt lets crawlers in and keeps them off the JSON API", () => {
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
  });
});

describe("buildSitemap", () => {
  it("emits the site's two routes and nothing else", () => {
    const xml = buildSitemap(SITE);
    expect(xml.match(/<url>/g)).toHaveLength(2);
    expect(xml).toContain("<loc>https://example.test/</loc>");
    expect(xml).toContain("<loc>https://example.test/planlegger/</loc>");
  });

  it("names no deleted route", () => {
    // `/emner/` and the 5 470 `/emne/{code}/` pages went with the reduction. A
    // sitemap advertising a 404 is worse than one that is short.
    const xml = buildSitemap(SITE);
    expect(xml).not.toContain("/emne");
    expect(xml).not.toContain("/user/");
  });

  it("is a well-formed urlset with the sitemaps.org namespace", () => {
    const xml = buildSitemap(SITE);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("emits no <lastmod>, so a nightly recrawl does not claim the site changed", () => {
    expect(buildSitemap(SITE)).not.toContain("lastmod");
  });
});
