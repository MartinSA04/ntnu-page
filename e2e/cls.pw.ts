import type { Page } from "@playwright/test";
import { expect, gotoPlanner, test } from "./harness.js";

/**
 * Layout stability, as a budget per surface.
 *
 * Every page here is client-rendered over a static shell, which produces layout
 * shift by default. On a 1.6 Mbit link the site scored 0.61 on /planlegger/ and
 * 0.43 on /emner/?q= on a phone ("poor" is 0.25), and because a ClientRouter
 * navigation does not reset the metric one four-page visit accumulated 0.98.
 *
 * The fixes are reservations, which rot silently — invisible when they work,
 * measured against a layout that keeps changing. Hence a gate over: the week's
 * `min-height` (removing it was 0.52 on a phone), the plan probe, /emner/'s
 * build-time facts and leases, and the metric-matched fallback faces.
 *
 * These budgets are geometry, not timing — a slow runner moves *when* the
 * islands land, not *how far* anything travels — and are set ~3x over measured.
 *
 * Desktop only: against a warm local worker a phone-sized viewport paints
 * *after* the islands have landed, which scores a truthful 0.000 and gates
 * nothing.
 */

/** Per-surface ceilings. Measured values are in the comment beside each. */
const BUDGETS = {
  home: 0.02, // 0.006 — the "Nå" card's hold, and the pitch's predicted demotion
  planner: 0.06, // 0.028 — residual is `#planner-grid-notes`, see below
  plannerEmpty: 0.02, // 0.000
  plannerView: 0.03, // 0.000 in both — the per-view reservations, cold (no remembered box)
  catalogQuery: 0.02, // 0.000
  catalogPlan: 0.02, // 0.002
  course: 0.02, // 0.000
} as const;

/**
 * A page is settled when it has stopped moving — so that is what is waited on,
 * rather than a fixed sleep long enough for the slowest imaginable fetch. The
 * score is read once no shift has been recorded for `QUIET_MS`, which is the
 * same condition a blanket sleep was standing in for and costs a second instead
 * of twelve.
 *
 * `CAP_MS` is a backstop, not a budget: a page that never goes quiet is read
 * anyway, and its score fails the assertion on its own merits. It is generous
 * because a cold worker cache goes straight to ntnu.no.
 */
const QUIET_MS = 1_000;
const CAP_MS = 12_000;

declare global {
  interface Window {
    __cls: number;
    /** `performance.now()` of the last shift — the quiescence clock. */
    __clsAt: number;
  }
}

/**
 * Installs the Layout Instability observer into every document this context
 * opens, before any page script runs. `buffered: true` is what makes it
 * retroactive to the first frame — without it the observer misses every shift
 * that happens before it is constructed, which is most of them.
 *
 * `hadRecentInput` entries are dropped, exactly as the metric does: a shift
 * within 500ms of an input is the page answering the student.
 */
async function observeCls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__clsAt = performance.now();
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (shift.hadRecentInput) continue;
        window.__cls += shift.value;
        window.__clsAt = performance.now();
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** Loads `url` as a fresh document, waits for it to stop moving, returns its CLS. */
async function clsOf(page: Page, url: string): Promise<number> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page
    .waitForFunction((quiet) => performance.now() - window.__clsAt > quiet, QUIET_MS, {
      timeout: CAP_MS,
      polling: 100,
    })
    // The cap expiring means the page is still moving, which the score then
    // says out loud. Failing here instead would report it as a timeout.
    .catch(() => undefined);
  return await page.evaluate(() => window.__cls);
}

/**
 * Seeds a real plan through the shareable hash, which reproduces what Lagre
 * would have written. The plan has to be *stored* rather than faked, because
 * half of what is tested is the pre-paint probe reading it out of localStorage.
 */
async function seedPlan(page: Page): Promise<void> {
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(page.locator("#planner-grid-frame .planner-cols-block").first()).toBeVisible({
    timeout: 45_000,
  });
  // The probe reads `np:plans`, so the derived programme courses have to have
  // been written before the pages under test are asked what they reserve.
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          try {
            const plans = JSON.parse(localStorage.getItem("np:plans") ?? "{}");
            const last = localStorage.getItem("np:lastSemester") ?? "";
            return Array.isArray(plans[last]) ? plans[last].length : 0;
          } catch {
            return 0;
          }
        }),
      { timeout: 45_000 },
    )
    .toBeGreaterThan(0);
}

test.describe("layout stability", () => {
  test("the planner holds its shape while the week loads", async ({ page }) => {
    await observeCls(page);
    await seedPlan(page);

    const cls = await clsOf(page, "/planlegger/");
    // The residual this budget still admits is `#planner-grid-notes`: how many
    // margin notes a week grows is a fact about the fetched timetables, so
    // there is nothing honest to reserve for it.
    expect(cls, `/planlegger/ CLS ${cls.toFixed(4)}`).toBeLessThan(BUDGETS.planner);
  });

  test("the planner holds its shape with no plan at all", async ({ page }) => {
    await observeCls(page);
    // No seed: the empty week, whose card centres in the space the frame is
    // already holding, and whose title is the grotesk from the first frame
    // rather than after `renderBanner` swaps the face.
    const cls = await clsOf(page, "/planlegger/");
    expect(cls, `/planlegger/ (no plan) CLS ${cls.toFixed(4)}`).toBeLessThan(BUDGETS.plannerEmpty);
  });

  /**
   * Both views, from cold. Reserving one height for both left 0.14 CLS on a
   * first load in Liste and 0.08 in Uke — worse, in Liste, than any page had
   * before the reservations existed.
   *
   * `np:weekView` is set WITHOUT a matching `np:weekBox`, on purpose: that
   * exercises the formula fallback rather than the remembered height, and the
   * formula is the half that can silently rot. The remembered path has its own
   * test below.
   */
  for (const [view, label] of [
    ["kolonner", "Uke"],
    ["tavle", "Liste"],
  ] as const) {
    test(`the week holds its shape in ${label}, cold`, async ({ page }) => {
      await observeCls(page);
      await seedPlan(page);
      await page.evaluate((v) => {
        localStorage.setItem("np:weekView", v);
        localStorage.removeItem("np:weekBox");
      }, view);

      const cls = await clsOf(page, "/planlegger/");
      expect(cls, `/planlegger/ (${label}) CLS ${cls.toFixed(4)}`).toBeLessThan(
        BUDGETS.plannerView,
      );
    });
  }

  test("the week remembers how tall it was, per view and per width", async ({ page }) => {
    await observeCls(page);
    await seedPlan(page);

    // Switch the way a student does. Liste is the view whose height no formula
    // can derive, so it is the one whose memory is load-bearing.
    await page.click("#planner-view-tavle");
    await expect(page.locator("#planner-grid-frame .planner-board")).toBeVisible();
    await expect
      .poll(async () => await page.evaluate(() => localStorage.getItem("np:weekBox")), {
        timeout: 15_000,
      })
      .toContain("tavle");

    const width = await page.evaluate(() => window.innerWidth);
    const cls = await clsOf(page, "/planlegger/");
    expect(cls, `/planlegger/ (Liste, remembered) CLS ${cls.toFixed(4)}`).toBeLessThan(
      BUDGETS.plannerView,
    );
    // The probe really did hand the number back before paint — a green budget
    // alone would not distinguish that from the formula happening to be close.
    const box = await page.evaluate(() =>
      document.documentElement.style.getPropertyValue("--planner-box"),
    );
    expect(box, "the remembered box never reached <html>").toMatch(/^\d+px$/);
    // And the height is filed under the width it was measured at, so a rotated
    // phone or a dragged window falls back to the formula instead of reserving
    // for a layout that no longer exists.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("np:weekBox") ?? "{}"));
    expect(stored.tavle?.[0]).toBe(width);
  });

  /**
   * The other half of a reservation: giving it back.
   *
   * `--planner-box` is one variable holding the height of the view the page
   * LOADED in, so a reservation that never ends kept Liste's 829px around the
   * other view's much shorter week for the rest of the visit.
   *
   * Measured as slack — frame height minus what it contains — because that is
   * what the student sees, and it is zero in every view or the lease has
   * stopped being handed back.
   *
   * ONE course, not the seeded five, and that is the whole point of the
   * fixture: a full plan draws a week taller than every reservation, so slack
   * is zero whether or not the lease is released and the test proves nothing.
   * The first version of it passed with both halves of the fix disabled.
   */
  test("the week gives its reserved space back when the view changes", async ({ page }) => {
    await gotoPlanner(page, { courses: ["TDT4120"] });
    await expect(page.locator("#planner-grid-frame .planner-cols-block").first()).toBeVisible({
      timeout: 45_000,
    });
    await page.click("#planner-view-tavle");
    await expect(page.locator("#planner-grid-frame .planner-board")).toBeVisible();

    // Reload IN Liste: this is the reported case, and the one where the probe
    // hands a remembered height to a frame that is about to draw a third thing.
    await page.goto("/planlegger/");
    await expect(page.locator("#planner-grid-frame .planner-board")).toBeVisible({
      timeout: 45_000,
    });

    const slack = async (): Promise<number> =>
      await page.evaluate(() => {
        const frame = document.querySelector("#planner-grid-frame");
        const inner = frame?.firstElementChild;
        if (!frame || !inner) return -1;
        const style = getComputedStyle(frame);
        const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
        return Math.round(
          frame.getBoundingClientRect().height - inner.getBoundingClientRect().height - padding,
        );
      });

    for (const [id, label] of [
      ["#planner-view-kolonner", "Uke"],
      ["#planner-view-tavle", "Liste"],
      // Back to Uke: the reported case is a lease held across a switch, and one
      // switch each way is what proves it is handed back in both directions.
      ["#planner-view-kolonner", "Uke"],
    ] as const) {
      await page.click(id);
      // A height measured mid-transition is a frame of an animation, not the
      // week's size — so wait for the animations themselves rather than for a
      // duration guessed to outlast them.
      await page
        .waitForFunction(
          () => document.getAnimations().every((a) => a.playState !== "running"),
          undefined,
          { timeout: 5_000, polling: 50 },
        )
        .catch(() => undefined);
      expect(await slack(), `${label} is holding empty space it does not need`).toBeLessThanOrEqual(
        1,
      );
    }
  });

  test("the landing card lands in space that was already held", async ({ page }) => {
    await observeCls(page);
    await seedPlan(page);

    const cls = await clsOf(page, "/");
    // The card is 253px and it is inserted ABOVE the pitch: unreserved, this
    // page moved its own first paragraph from y=96 to y=395.
    expect(cls, `/ CLS ${cls.toFixed(4)}`).toBeLessThan(BUDGETS.home);
    // And the reservation really was released rather than left holding.
    await expect(page.locator("#home-now-hold")).toHaveClass(/is-released/);
  });

  test("the catalog is printed at the size it will be", async ({ page }) => {
    await observeCls(page);
    // A `?q=` link is the shared-link and Back-from-a-course case, and the one
    // where the register arrives full-grown.
    const cls = await clsOf(page, "/emner/?q=matematikk");
    expect(cls, `/emner/?q= CLS ${cls.toFixed(4)}`).toBeLessThan(BUDGETS.catalogQuery);
  });

  test("the catalog's resting page is the plan, at the plan's size", async ({ page }) => {
    await observeCls(page);
    await seedPlan(page);

    const cls = await clsOf(page, "/emner/");
    expect(cls, `/emner/ (plan) CLS ${cls.toFixed(4)}`).toBeLessThan(BUDGETS.catalogPlan);
  });

  test("a course page keeps its islands' places", async ({ page }) => {
    await observeCls(page);
    const cls = await clsOf(page, "/emne/TDT4120/");
    expect(cls, `/emne/ CLS ${cls.toFixed(4)}`).toBeLessThan(BUDGETS.course);
  });
});

/**
 * The build-time facts, asserted as facts rather than through their shift.
 *
 * The scale line, the city chips and the resting sentence are printed by the
 * server from `data/catalog.json`, which is the same source
 * `search-index.json` is generated from. This says the server printed them at
 * all, which is the thing a refactor would quietly drop.
 */
test("the catalog page ships its own scale, chips and invitation", async ({ page }) => {
  // No JS needed for any of these — they are in the document.
  await page.goto("/emner/");
  await expect(page.locator("#emner-scale")).toContainText("katalog");
  await expect(page.locator("#emner-facets .np-toggle")).not.toHaveCount(0);
  await expect(page.locator("#emner-status")).toContainText("Skriv for å søke");
});
