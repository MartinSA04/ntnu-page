import { defineConfig, devices } from "@playwright/test";

/**
 * Browser suite for the things unit tests structurally cannot see: what
 * survives a ClientRouter navigation. `*.pw.ts` rather than `*.spec.ts` so
 * vitest's default include never picks these up — `mise run check` stays a
 * fast, server-free unit run, and `mise run e2e` is the browser pass.
 */
const PORT = 8788;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Serves the built dist/ plus the cached /api layer — the same worker the
    // deploy runs, so the suite exercises real NTNU data end to end.
    command: `npm run build && npx wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: true,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
