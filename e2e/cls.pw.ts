import { expect, type Page, test } from "@playwright/test";

/**
 * Layout stability, as a budget per surface.
 *
 * Every page here is client-rendered over a static shell, which is the shape
 * that produces layout shift by default: the server paints a page with no
 * week, no register and no card in it, and a second later the islands grow
 * one. Measured on a 1.6 Mbit link the site scored 0.61 on /planlegger/ and
 * 0.43 on /emner/?q= on a phone — "poor" is 0.25 — and because a ClientRouter
 * navigation does not reset the metric, one four-page visit accumulated 0.98
 * in a single page-load's score.
 *
 * The fixes are reservations, and reservations are exactly the kind of thing
 * that rots silently: they are invisible when they work, they are numbers
 * measured against a layout that keeps changing, and nothing about a page that
 * has drifted 40px looks wrong in a screenshot. Hence a gate. What each one
 * guards, and the shift it would let back in:
 *
 *   - `.planner-grid-frame`'s `min-height` (planner-week.css) — the week's own
 *     height, held from first paint. Removing it was 0.52 on a phone, the
 *     largest single shift the site had.
 *   - The plan probe (Layout.astro's pre-paint script, `--plan-courses` in
 *     tokens.css) — the landing card's space, the planner title's face, and
 *     the row counts the exam and course lists reserve.
 *   - /emner/'s build-time facts (the scale line, the city chips, the resting
 *     status sentence) and its two leases.
 *   - The metric-matched fallback faces (fonts.css) — without them the webfont
 *     swap relaid every page at ~875ms.
 *
 * These budgets are geometry, not timing: a slow CI runner moves *when* the
 * islands land, not *how far* anything travels, so a cold worker cache makes
 * this suite slower rather than redder. They are set ~3x over the measured
 * value, and every regression listed above blows through its own budget by an
 * order of magnitude.
 *
 * Desktop only, deliberately. Playwright's device here has no network
 * throttling, and against a warm local worker a phone-sized viewport paints
 * *after* the islands have already landed — which scores a truthful 0.000 and
 * would gate nothing. The desktop viewport still catches every regression
 * above because it paints first and grows second, which is the whole failure.
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
 * How long to let a page settle before reading its score. Long enough for the
 * timetable bundles — the last thing to land on any of these surfaces — plus
 * room for a cold worker cache going straight to ntnu.no.
 */
const SETTLE_MS = 12_000;

declare global {
  interface Window {
    __cls: number;
  }
}

/**
 * Installs the Layout Instability observer into every document this context
 * opens, before any of the page's own script runs. `buffered: true` is what
 * makes it retroactive to the first frame — without it the observer would miss
 * every shift that happens before it is constructed, which is most of them.
 *
 * `hadRecentInput` entries are dropped, exactly as the metric does: a shift
 * within 500ms of a keystroke or a tap is the page answering the student, and
 * the search-as-you-type reflows on /emner/ and in the add dialog are all of
 * that kind.
 */
async function observeCls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const shift = entry as PerformanceEntry & { value: number; hadRecentInput: boolean };
        if (!shift.hadRecentInput) window.__cls += shift.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
}

/** Loads `url` as a fresh document, lets it settle, and returns its CLS. */
async function clsOf(page: Page, url: string): Promise<number> {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(SETTLE_MS);
  return await page.evaluate(() => window.__cls);
}

/**
 * Seeds a real plan the way flows.pw.ts does — through the shareable hash,
 * which reproduces exactly what Lagre would have written. The plan has to be
 * *stored* rather than faked, because half of what is being tested is the
 * pre-paint probe reading it out of localStorage.
 */
async function seedPlan(page: Page): Promise<void> {
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(page.locator("#planner-grid-frame .planner-block").first()).toBeVisible({
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
    // The residual this budget deliberately still admits is
    // `#planner-grid-notes`: how many margin notes a week grows ("velg din
    // gruppe", an incomplete conflict check) is a fact about the fetched
    // timetables, so there is nothing honest to reserve for it — a plan with no
    // notes would collapse whatever we guessed. Everything else on this page is
    // held from first paint.
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
   * The other two views, from cold.
   *
   * Rader's height is five day rows; Kolonner's is the drawn hours at 4.5rem
   * each; Liste's is however many sessions the week has. Reserving Rader's for
   * all three is what the first version of this work did, and it left 0.14 CLS
   * on a first load in Liste and 0.08 in Kolonner — worse, in Liste, than any
   * page on the site had before the reservations existed.
   *
   * `np:weekView` is set WITHOUT a matching `np:weekBox`, on purpose: that
   * exercises the formula fallback in planner-week.css rather than the
   * remembered height, and the formula is the half that can silently rot as the
   * hour token or the board's row height changes. The remembered path is
   * covered by its own test below.
   */
  for (const [view, label] of [
    ["kolonner", "Kolonner"],
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
   * LOADED in, so a reservation that never ends kept Liste's 829px around
   * Rader's 247px week the moment the student pressed the other tab — six
   * hundred pixels of white paper between the week and the exam list, for the
   * rest of the visit. The same trap without a view switch: a plan whose
   * Kolonner week draws three hours under an eight-hour reservation.
   *
   * Measured as slack — frame height minus what it contains — because that is
   * the thing the student sees, and it is zero in every view or the lease has
   * stopped being handed back somewhere.
   *
   * ONE course, not the seeded five, and that is the whole point of the
   * fixture. A full plan draws a week taller than every reservation, so slack
   * is zero whether or not the lease is ever released and the test proves
   * nothing — the first version of it passed with both halves of the fix
   * disabled. A single course draws three hours in Kolonner against an
   * eight-hour reservation and 247px in Rader against RADER's own 242px floor,
   * so the frame is only honest here if the reservation really has ended.
   */
  test("the week gives its reserved space back when the view changes", async ({ page }) => {
    await page.goto("/planlegger/#26h;-;%2BTDT4120");
    await expect(page.locator("#planner-grid-frame .planner-block").first()).toBeVisible({
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
      ["#planner-view-uke", "Rader"],
      ["#planner-view-kolonner", "Kolonner"],
      ["#planner-view-tavle", "Liste"],
    ] as const) {
      await page.click(id);
      // Let the layer/strike animation finish before measuring a height.
      await page.waitForTimeout(1200);
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
 * server from `data/catalog.json`; `search-index.json` is generated from that
 * same catalog by the same crawl. If the two ever stop agreeing, the chips
 * visibly re-flow on mount and the CLS budget above catches it — but only on
 * the seeded catalog. This says the server printed them at all, which is the
 * thing a refactor would quietly drop.
 */
test("the catalog page ships its own scale, chips and invitation", async ({ page }) => {
  // No JS needed for any of these — they are in the document.
  await page.goto("/emner/");
  await expect(page.locator("#emner-scale")).toContainText("katalog");
  await expect(page.locator("#emner-facets .np-toggle")).not.toHaveCount(0);
  await expect(page.locator("#emner-status")).toContainText("Skriv for å søke");
});
