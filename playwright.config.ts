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
  // Playwright's default is 30 s, which is BELOW the budgets the specs
  // themselves write: several assertions pass `{ timeout: 45_000 }` for a cold
  // worker cache (a GitHub runner has no KV binding, so the first plan load
  // goes straight to ntnu.no). Summed per test, the longest chains are BSPL's
  // ~155 s and the onboarding flow's ~115 s; capped at 30 s those tests died
  // before their own allowance could expire — a red run on a healthy build,
  // reported against the grid rather than against the clock (tests-2). 180 s
  // clears the largest of them. The suite is 1 worker, serial, so this bounds
  // a hang; a healthy run is nowhere near it.
  timeout: 180_000,
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
    // Reuse is a LOCAL convenience only. `handleHealth` returns a constant, so
    // any wrangler answering on this port satisfies the probe — and when it
    // does, Playwright skips the whole `command`, `npm run build` never runs
    // and the suite certifies whatever `dist/` happened to be lying there. A
    // leaked server from an interrupted run was enough to make `mise run e2e`
    // report a pass for code it never loaded (tests-4). In CI that must be
    // impossible; locally, an explicit `wrangler dev` on :8788 is still the
    // fast inner loop — rebuild it yourself when you change src/.
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
