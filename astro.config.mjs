// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  // THE hostname the site publishes at, confirmed 2026-08-18 — no longer a
  // placeholder waiting on a decision. /sitemap.xml emits absolute URLs against
  // it and public/robots.txt names it in its `Sitemap:` line, so the two must
  // change together if it ever moves; tests/site/discoverability.test.ts
  // asserts they agree. The matching custom-domain route in wrangler.jsonc is
  // the third place, and it is the one still to be turned on.
  site: "https://ntnu.martinsundal.no",
  build: {
    // Astro's default is `inlineStylesheets: "auto"`, which inlined the same
    // 4 043 B of course-page CSS into all 5 470 /emne/ pages — 33 % of each
    // document, 812 B brotli re-downloaded per course viewed, and 22 MB of
    // the built site (perf-6). As a hashed /_astro/ file it is fetched once
    // and then served `immutable` by public/_headers, which is why this and
    // perf-2's file belong in the same change.
    inlineStylesheets: "never",
  },
  vite: {
    server: {
      // `astro dev` serves only the static site; API calls are proxied to a
      // locally running worker (`npm run preview`, port 8787).
      proxy: { "/api": "http://localhost:8787" },
    },
  },
});
