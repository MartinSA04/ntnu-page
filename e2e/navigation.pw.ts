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
 */

const THEME_KEY = "np:theme";
const PLAN_KEY = "ntnu:plan:v1";

/** Clicks a topbar link and waits for the swap to settle. */
async function navTo(page: Page, href: string): Promise<void> {
  await page.click(`.site-nav a[href="${href}"]`);
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

const BIT_PLAN = JSON.stringify({
  v: 1,
  semesterId: "26h",
  courses: [],
  program: { code: "BIT", cohort: 2025, name: "Informatikk - bachelor" },
});

test.describe("theme survives client-side navigation", () => {
  test("keeps data-theme across every in-site navigation", async ({ page }) => {
    await seed(page, { [THEME_KEY]: "dark" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    for (const href of ["/emner/", "/studier/", "/planlegger/", "/emner/"]) {
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
    await navTo(page, "/studier/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  });
});

test.describe("the plan survives client-side navigation", () => {
  test("re-renders the planner after navigating away and back", async ({ page }) => {
    await seed(page, { [PLAN_KEY]: BIT_PLAN });
    await page.goto("/planlegger/");
    const rows = page.locator("#planner-course-rows .planner-course-row");
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
    await seed(page, { [PLAN_KEY]: BIT_PLAN });
    await page.goto("/planlegger/");
    await expect(page.locator("#planner-course-rows .planner-course-row")).toHaveCount(3, {
      timeout: 30_000,
    });

    for (let i = 0; i < 3; i++) {
      await navTo(page, "/emner/");
      await navTo(page, "/planlegger/");
    }
    await expect(page.locator("#planner-course-rows .planner-course-row")).toHaveCount(3, {
      timeout: 30_000,
    });

    // Re-mounting must not duplicate the stored plan (a stacked subscription
    // re-running the programme prefill would show up here as extra courses).
    const stored = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { courses: { code: string }[] }) : null;
    }, PLAN_KEY);
    const codes = stored?.courses.map((c) => c.code) ?? [];
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

  test("programme filter still responds", async ({ page }) => {
    await page.goto("/");
    await navTo(page, "/studier/");
    const status = page.locator("#studier-status");
    await page.fill("#studier-search", "datateknologi");
    await expect(status).not.toHaveText("", { timeout: 15_000 });
    const filtered = await status.textContent();
    await page.fill("#studier-search", "");
    await expect(status).not.toHaveText(filtered ?? "", { timeout: 15_000 });
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

test("no console or page errors during a full navigation circuit", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });

  await seed(page, { [THEME_KEY]: "dark", [PLAN_KEY]: BIT_PLAN });
  await page.reload();
  for (const href of ["/planlegger/", "/emner/", "/studier/", "/planlegger/"]) {
    await navTo(page, href);
  }
  expect(problems).toEqual([]);
});
