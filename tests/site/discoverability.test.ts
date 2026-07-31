/**
 * the 5 470 course pages are only discoverable through /sitemap.xml,
 * and /sitemap.xml is only correct if `site` in astro.config.mjs and the
 * `Sitemap:` line in public/robots.txt name the same host. Both are still the
 * placeholder ntnu.martinsundal.no and have to be changed together, which is
 * exactly the kind of two-file agreement nothing else in this repo would
 * notice breaking.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSitemap, courseLoc } from "../../src/lib/sitemap.js";

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
  it("emits one <url> per course plus the three static routes", () => {
    const xml = buildSitemap(SITE, ["TDT4100", "TMA4100"]);
    expect(xml.match(/<url>/g)).toHaveLength(5);
    expect(xml).toContain("<loc>https://example.test/</loc>");
    expect(xml).toContain("<loc>https://example.test/planlegger/</loc>");
    expect(xml).toContain("<loc>https://example.test/emner/</loc>");
    expect(xml).toContain("<loc>https://example.test/emne/TDT4100/</loc>");
  });

  it("is a well-formed urlset with the sitemaps.org namespace", () => {
    const xml = buildSitemap(SITE, ["TDT4100"]);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
  });

  it("percent-encodes Æ/Ø/Å codes, so no raw non-ASCII reaches a <loc>", () => {
    // 238 catalog codes carry these letters; a raw one is an invalid sitemap
    // location and the worker's parseCode expects the encoded form anyway.
    expect(courseLoc("BØA1100", SITE)).toBe("https://example.test/emne/B%C3%98A1100/");
    const xml = buildSitemap(SITE, ["MTIØT", "ÅSOS", "BØA1100"]);
    expect(xml).not.toMatch(/[ÆØÅæøå]/);
  });

  it("keeps every course code, including the ones that only differ in case-folding", () => {
    const xml = buildSitemap(SITE, ["AAR1025", "AAR1026"]);
    expect(xml).toContain("/emne/AAR1025/");
    expect(xml).toContain("/emne/AAR1026/");
  });

  it("emits no <lastmod>, so a nightly recrawl does not claim 5470 changes", () => {
    expect(buildSitemap(SITE, ["TDT4100"])).not.toContain("lastmod");
  });
});
