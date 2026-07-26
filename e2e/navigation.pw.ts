import { expect, type Page, test } from "@playwright/test";

/**
 * Client-side navigation is the failure mode this suite exists for.
 *
 * Under Astro's `ClientRouter`, two things bite and neither is visible to a
 * unit test, because both need a *second* page in the same document:
 *
 * 1. `swapRootAttributes()` removes every attribute from `<html>` and restores
 *    only what the server rendered. `data-theme` is set on the client, so each
 *    navigation dropped it and the site snapped back to light.
 * 2. Hoisted page modules are evaluated once per URL. A module already
 *    evaluated is not re-run on a swap, so every page's mount code stopped
 *    firing after the first in-site navigation — the planner rendered an empty
 *    shell ("the plan is gone"), search returned nothing, course pages sat
 *    blank.
 *
 * The fixes are the `astro:after-swap` re-apply in `Layout.astro` and the
 * `onPage()` wrapper on every page script. These tests fail without them.
 *
 * The rework (2026-07-25) deleted `/studier/` and the plan strip: the site's
 * chrome now offers exactly two nav destinations (`/planlegger/`, `/emner/`),
 * plus a persistent `#studieinfo-chip` naming whose plan this is on every
 * page. The nav circuits below only ever hop between the two real chrome
 * links; `/studier/`'s own test is now a 404 check, not a positive case.
 */

const THEME_KEY = "np:theme";
// Mirror src/lib/planner/store.ts's exported storage keys — duplicated as
// literals rather than imported so this spec has no dependency on Playwright
// resolving a `.js`-suffixed import back to its `.ts` source.
const PROFILE_KEY = "np:profile";
const PLANS_KEY = "np:plans";
const LAST_SEMESTER_KEY = "np:lastSemester";

const courseRows = (page: Page) => page.locator("#planner-course-rows .planner-course-row");

/**
 * Clicks a real in-site link to `href` and waits for the swap to settle.
 *
 * It has to be a *click on an anchor* — `page.goto()` would be a full document
 * load, which is precisely the case these tests do not care about and would
 * make the whole file pass against a broken ClientRouter.
 *
 * The topbar nav and the footer are both sitewide chrome rendered by
 * `Layout.astro`; the selector spans both rather than hardcoding which one a
 * given route currently sits in.
 */
async function navTo(page: Page, href: string): Promise<void> {
  const link = page.locator(`.site-nav a[href="${href}"], .site-footer a[href="${href}"]`).first();
  await expect(link, `no in-site link to ${href}`).toBeAttached();
  await link.click();
  await page.waitForURL(`**${href}`);
  await page.waitForLoadState("networkidle");
}

/** Seeds localStorage for the origin before the first document loads. */
async function seed(page: Page, entries: Record<string, string>): Promise<void> {
  await page.goto("/");
  await page.evaluate((kv) => {
    for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v);
  }, entries);
}

// BIT kull 2025, period 3 (26h — a 2nd-year autumn): obligatory IT1901 +
// TDT4120 + TDT4160, 7,5 sp each = 22,5 sp (verified live against the worker).
// No manual courses stored — `np:plans` is left empty and the programme
// prefill derives them itself, same as a real studieinfo Lagre would.
const BIT_PROFILE = JSON.stringify({
  program: { code: "BIT", name: "Informatikk - bachelor", cohort: 2025 },
});

test.describe("theme survives client-side navigation", () => {
  test("keeps data-theme across every in-site navigation", async ({ page }) => {
    await seed(page, { [THEME_KEY]: "dark" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    for (const href of ["/emner/", "/planlegger/", "/emner/"]) {
      await navTo(page, href);
      await expect(page.locator("html"), `theme lost navigating to ${href}`).toHaveAttribute(
        "data-theme",
        "dark",
      );
    }

    // And a light choice must survive equally — the bug wiped the attribute,
    // which happens to look like "light", so only testing dark would pass on
    // a half-fix that simply forced dark.
    await page.evaluate((key) => localStorage.setItem(key, "light"), THEME_KEY);
    await page.reload();
    await navTo(page, "/planlegger/");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  });

  test("the toggle still works after navigating", async ({ page }) => {
    await seed(page, { [THEME_KEY]: "light" });
    await page.reload();
    await navTo(page, "/emner/");
    await page.click(".theme-toggle");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await navTo(page, "/planlegger/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("the plan survives client-side navigation", () => {
  test("re-renders the planner after navigating away and back", async ({ page }) => {
    await seed(page, { [PROFILE_KEY]: BIT_PROFILE, [LAST_SEMESTER_KEY]: "26h" });
    await page.goto("/planlegger/");
    const rows = courseRows(page);
    await expect(rows).toHaveCount(3, { timeout: 30_000 });
    // Wait for the settled figure: credits arrive with the course bundles, a
    // beat after the rows themselves, so reading the line the moment the rows
    // appear races the fetch and can still catch "0 av 30 sp".
    const credits = page.locator("#planner-credit-line");
    await expect(credits).toHaveText("22,5 av 30 sp", { timeout: 30_000 });

    await navTo(page, "/emner/");
    await navTo(page, "/planlegger/");
    await expect(rows).toHaveCount(3, { timeout: 30_000 });
    await expect(credits).toHaveText("22,5 av 30 sp", { timeout: 30_000 });
  });

  test("stays correct across repeated round trips", async ({ page }) => {
    await seed(page, { [PROFILE_KEY]: BIT_PROFILE, [LAST_SEMESTER_KEY]: "26h" });
    await page.goto("/planlegger/");
    await expect(courseRows(page)).toHaveCount(3, { timeout: 30_000 });

    for (let i = 0; i < 3; i++) {
      await navTo(page, "/emner/");
      await navTo(page, "/planlegger/");
    }
    await expect(courseRows(page)).toHaveCount(3, { timeout: 30_000 });

    // Re-mounting must not duplicate the stored plan (a stacked subscription
    // re-running the programme prefill would show up here as extra courses).
    const stored = await page.evaluate(
      ({ plansKey, semesterId }) => {
        const raw = localStorage.getItem(plansKey);
        if (!raw) return null;
        const plans = JSON.parse(raw) as Record<string, { code: string }[]>;
        return plans[semesterId] ?? null;
      },
      { plansKey: PLANS_KEY, semesterId: "26h" },
    );
    const codes = stored?.map((c) => c.code) ?? [];
    expect(codes).toHaveLength(new Set(codes).size);
  });
});

test.describe("other pages keep working after navigation", () => {
  test("course search still returns results", async ({ page }) => {
    await page.goto("/");
    await navTo(page, "/emner/");
    await page.fill("#emner-search", "algoritmer");
    await expect(page.locator("#emner-results li").first()).toBeVisible({ timeout: 15_000 });
  });

  test("a course page fetches its own course, not the previous one", async ({ page }) => {
    await page.goto("/emne/TDT4120/");
    await expect(page.locator('#details-section [data-role="body"]')).not.toBeEmpty({
      timeout: 20_000,
    });

    // Which course the islands actually ask the API for is the sharp test:
    // with the stale module the second course page re-ran nothing, so no
    // request for the new code was ever made.
    const requested: string[] = [];
    page.on("request", (r) => {
      const m = /\/api\/course\/([A-ZÆØÅ0-9]+)/.exec(r.url());
      if (m?.[1]) requested.push(m[1]);
    });

    await navTo(page, "/emner/");
    await page.fill("#emner-search", "TDT4100");
    const link = page.locator('#emner-results a[href="/emne/TDT4100/"]').first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
    await page.waitForURL("**/emne/TDT4100/");

    await expect.poll(() => requested, { timeout: 20_000 }).toContain("TDT4100");
    expect(requested).not.toContain("TDT4120");
    await expect(page.locator('#details-section [data-role="body"]')).not.toBeEmpty({
      timeout: 20_000,
    });
  });
});

test.describe("the studieinfo chip", () => {
  test("present and identically labeled on every page", async ({ page }) => {
    await seed(page, { [PROFILE_KEY]: BIT_PROFILE, [LAST_SEMESTER_KEY]: "26h" });
    const expectedLabel = "BIT · 2025 · Høst 2026";

    await page.goto("/");
    await expect(page.locator("#studieinfo-chip")).toHaveText(expectedLabel);

    await navTo(page, "/emner/");
    await expect(page.locator("#studieinfo-chip")).toHaveText(expectedLabel);

    await navTo(page, "/planlegger/");
    await expect(page.locator("#studieinfo-chip")).toHaveText(expectedLabel);

    // /emne/[code]/ isn't reachable from the persistent chrome (only via a
    // search result), so this leg is a direct load rather than a swap.
    await page.goto("/emne/TDT4100/");
    await expect(page.locator("#studieinfo-chip")).toHaveText(expectedLabel);
  });
});

test("/studier/ is gone", async ({ page }) => {
  const response = await page.goto("/studier/");
  expect(response?.status()).toBe(404);
});

test("no console or page errors during a full navigation circuit", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });

  await seed(page, { [THEME_KEY]: "dark", [PROFILE_KEY]: BIT_PROFILE, [LAST_SEMESTER_KEY]: "26h" });
  await page.reload();
  for (const href of ["/planlegger/", "/emner/", "/planlegger/", "/emner/"]) {
    await navTo(page, href);
  }
  expect(problems).toEqual([]);
});
