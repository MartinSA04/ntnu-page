import { test as base, expect } from "@playwright/test";
import { installApiFixtures, RECORDING } from "./fixtures.js";

/**
 * A recording run waits, per test, for requests the test itself never waited on
 * — the planner fires one per course and asserts on the first few, and
 * studieinfo's older-cohort lookup can spend three sequential round trips on a
 * 404 ladder. Torn down mid-flight they are never written, so the next replay
 * fetches them live and the gap never closes.
 *
 * `networkidle` rather than a fixed sleep: it IS the drain condition, so it
 * costs nothing when nothing is pending and waits as long as needed when
 * something is. The cap keeps a stuck socket from holding the run.
 */
const DRAIN_TIMEOUT_MS = 15_000;

/**
 * The `test` every spec here imports instead of `@playwright/test`'s, so the
 * `/api/*` record/replay layer is on by default and no spec has to remember it
 * (see `fixtures.ts` for the modes).
 *
 * `auto: true` because a spec that forgot to ask for it would silently go back
 * to hitting live upstream — which is the one failure this layer exists to make
 * impossible.
 */
export const test = base.extend<{ apiFixtures: void }>({
  apiFixtures: [
    async ({ context }, use) => {
      await installApiFixtures(context);
      await use();
      if (RECORDING) {
        await Promise.all(
          context.pages().map(async (page) => {
            if (page.isClosed()) return;
            await page
              .waitForLoadState("networkidle", { timeout: DRAIN_TIMEOUT_MS })
              .catch(() => undefined);
          }),
        );
      }
      // A page can still have a request in flight when the test ends — the
      // planner fires one per course and does not wait for them to be read.
      // Without this the handler is torn down mid-`route.fetch()` and the run
      // reports an error that belongs to no test.
      await context.unrouteAll({ behavior: "ignoreErrors" }).catch(() => undefined);
    },
    { auto: true },
  ],
});

export { expect };
