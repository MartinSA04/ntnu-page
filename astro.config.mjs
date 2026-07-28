// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  // Placeholder hostname until the site is wired to Cloudflare (the route in
  // wrangler.jsonc is commented out the same way). MUST be set to the real
  // hostname before the first real deploy: /sitemap.xml emits 5473 absolute
  // URLs against it and public/robots.txt names it in its `Sitemap:` line, so
  // a wrong value here publishes a sitemap for a host that does not exist.
  // Change both together — tests/site/discoverability.test.ts asserts they
  // agree.
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
