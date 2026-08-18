import type { Page } from "@playwright/test";
import { expect, test } from "./harness.js";

/**
 * Client-side navigation is the failure mode this suite exists for.
 *
 * Under Astro's `ClientRouter`, two things bite and neither is visible to a
 * unit test, because both need a *second* page in the same document:
 *
 * 1. `swapRootAttributes()` removes every attribute from `<html>` and restores
 *    only what the server rendered. `data-theme` is set on the client, so each
 *    navigation dropped it and the site snapped back to light.
 * 2. Hoisted page modules are evaluated once per URL, so every page's mount
 *    code stopped firing after the first in-site navigation — the planner
 *    rendered an empty shell, search returned nothing, course pages sat blank.
 *
 * The fixes are the `astro:after-swap` re-apply in `Layout.astro` and the
 * `onPage()` wrapper on every page script. These tests fail without them.
 *
 * The site's chrome offers exactly two nav destinations and carries no plan
 * state, so the circuits below only hop between those two.
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
 * It has to be a *click on an anchor* — `page.goto()` is a full document load,
 * which would make the whole file pass against a broken ClientRouter.
 *
 * The selector spans the topbar nav and the footer rather than hardcoding
 * which one a given route currently sits in.
 */
async function navTo(page: Page, href: string): Promise<void> {
  // The brand mark is the only in-site link to `/` now that the nav is one
  // item; it is a real ClientRouter navigation like any other.
  const link = page
    .locator(`.site-brand[href="${href}"], .site-nav a[href="${href}"], .site-footer a[href="${href}"]`)
    .first();
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

// BIT kull 2025, period 3 (26h): obligatory IT1901 + TDT4120 + TDT4160, 7,5 sp
// each = 22,5 sp (verified live). No manual courses stored — the programme
// prefill derives them itself, as a real studieinfo Lagre would.
const BIT_PROFILE = JSON.stringify({
  program: { code: "BIT", name: "Informatikk - bachelor", cohort: 2025 },
});

test.describe("theme survives client-side navigation", () => {
  test("keeps data-theme across every in-site navigation", async ({ page }) => {
    await seed(page, { [THEME_KEY]: "dark" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    for (const href of ["/", "/planlegger/", "/"]) {
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
    await navTo(page, "/");
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
    // Wait for the settled figures: credits arrive with the course bundles, a
    // beat after the rows themselves, so reading them the moment the rows
    // appear races the fetch. The per-row figure is what is left of credits —
    // the 30 sp total went with the verdict (PRODUCT D17).
    const rail = page.locator("#planner-course-rows");
    await expect(rail).toContainText("7,5 sp", { timeout: 30_000 });

    await navTo(page, "/");
    await navTo(page, "/planlegger/");
    await expect(rows).toHaveCount(3, { timeout: 30_000 });
    await expect(rail).toContainText("7,5 sp", { timeout: 30_000 });
  });

  test("stays correct across repeated round trips", async ({ page }) => {
    await seed(page, { [PROFILE_KEY]: BIT_PROFILE, [LAST_SEMESTER_KEY]: "26h" });
    await page.goto("/planlegger/");
    await expect(courseRows(page)).toHaveCount(3, { timeout: 30_000 });

    for (let i = 0; i < 3; i++) {
      await navTo(page, "/");
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

test("the footer states provenance and the caveat, and links nowhere", async ({ page }) => {
  await page.goto("/planlegger/");
  const footer = page.locator(".site-footer");
  await expect(footer).toContainText("Data hentet");
  await expect(footer).toContainText("Uoffisiell, med forbehold om feil");
  await expect(footer.locator("a")).toHaveCount(0);
});

test("every route carries the security headers (sec-3)", async ({ page }) => {
  // A dropped header, or an inline script added under a hash-based CSP, has to
  // fail somewhere. The worker sets these on the ASSETS branch and on every
  // JSON route; nothing below the browser sees the real pipeline.
  for (const path of ["/", "/api/health"]) {
    const response = await page.goto(path);
    const headers = response?.headers() ?? {};
    const csp = headers["content-security-policy"] ?? "";
    expect(csp, `no CSP on ${path}`).toContain("default-src 'self'");
    expect(csp, `framing not denied on ${path}`).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
    expect(headers["referrer-policy"], path).toBe("strict-origin-when-cross-origin");
  }
});

test("no console or page errors during a full navigation circuit", async ({ page }) => {
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });

  await seed(page, { [THEME_KEY]: "dark", [PROFILE_KEY]: BIT_PROFILE, [LAST_SEMESTER_KEY]: "26h" });
  await page.reload();
  for (const href of ["/planlegger/", "/", "/planlegger/", "/"]) {
    await navTo(page, href);
  }
  expect(problems).toEqual([]);
});
