// @ts-check
import { defineConfig } from "astro/config";

export default defineConfig({
  // Placeholder hostname until the site is wired to Cloudflare (the route in
  // wrangler.jsonc is commented out the same way).
  site: "https://ntnu.martinsundal.no",
  vite: {
    server: {
      // `astro dev` serves only the static site; API calls are proxied to a
      // locally running worker (`npm run preview`, port 8787).
      proxy: { "/api": "http://localhost:8787" },
    },
  },
});
