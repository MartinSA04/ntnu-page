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
    await expect(page.locator("#emner-results tr.emner-row").first()).toBeVisible({ timeout: 15_000 });
  });

  test("the catalog query survives Back from a course page", async ({ page }) => {
    // `?q=` was read on setup but never written, so Back from a course page
    // restored /emner/ with an empty field and zero rows — comparing three
    // candidates meant retyping the query three times.
    await page.goto("/emner/");
    await page.fill("#emner-search", "algoritmer");
    await expect(page.locator("#emner-results tr.emner-row").first()).toBeVisible({ timeout: 15_000 });
    // The write is debounced behind the last keystroke, so
    // this is a wait, not a read.
    await expect(page).toHaveURL(/\?q=algoritmer/, { timeout: 15_000 });

    const link = page.locator("#emner-results a.emner-row-link").first();
    const href = await link.getAttribute("href");
    expect(href).toBeTruthy();
    await link.click();
    await page.waitForURL(`**${href}`);

    await page.goBack();
    await page.waitForURL(/\/emner\/\?q=algoritmer/);
    await expect(page.locator("#emner-search")).toHaveValue("algoritmer");
    await expect(page.locator("#emner-results tr.emner-row").first()).toBeVisible({ timeout: 15_000 });
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

test.describe("the topbar carries the account, and no plan state", () => {
  test("every page opens the profile panel, and none of them shows a plan chip", async ({
    page,
  }) => {
    await seed(page, { [PROFILE_KEY]: BIT_PROFILE, [LAST_SEMESTER_KEY]: "26h" });

    // The chip is deleted (2026-07-30) and stays deleted: the bar says nothing
    // about the plan — no semester, no course count, no programme code. It has
    // to be gone after a client-side swap as well as on a cold load, since it
    // was server-rendered per page and a ClientRouter navigation is exactly
    // where a stale one would linger.
    //
    // What the bar DOES carry is the account's own door, on all four pages,
    // reading "Profil" while signed out — because the state behind it is read
    // by all four, and /emne/[code]/ is the cold-traffic surface where a
    // student has to be able to sign in without navigating away first.
    const account = page.locator("#site-account-btn");
    const panel = page.locator("#planner-profile-panel");

    for (const [go, where] of [
      [() => page.goto("/"), "/"],
      [() => navTo(page, "/emner/"), "/emner/"],
      [() => navTo(page, "/planlegger/"), "/planlegger/"],
      [() => page.goto("/emne/TDT4100/"), "/emne/TDT4100/"],
    ] as const) {
      await go();
      await expect(page.locator("#studieinfo-chip"), where).toHaveCount(0);
      await expect(account, where).toHaveText("Profil");
      // The panel is mounted from the layout, so it survives a soft swap —
      // mounting at module top level would leave it dead here.
      await expect(panel, where).toBeHidden();
      await account.click();
      await expect(panel, where).toBeVisible();
      // Studieinfo IS the panel now: programme and kull are in it, not behind
      // a second door.
      await expect(panel.locator("#studieinfo-heading"), where).toBeVisible();
      await panel.locator(".profile-panel-close").click();
      await expect(panel, where).toBeHidden();
    }

    // The planner still names whose plan it is, in its own title — programme
    // and kull, and NOT the semester. That third part came off when the bar
    // grew a `<select>` for the term: the title stating `H26` two controls away
    // from the control that sets it was one statement said twice, and the
    // control is the authority (DESIGN §9). The assertion is exact rather than
    // a `toContainText`, because the point is what the title no longer says.
    await navTo(page, "/planlegger/");
    await expect(page.locator("#planner-title")).toHaveText("BIT Kull 25", {
      timeout: 30_000,
    });
    // The term is still on screen — it moved to the control, it did not vanish.
    await expect(page.locator("#planner-semester-select")).toHaveValue("26h");
  });
});

test("the footer states provenance and the caveat, and links nowhere", async ({ page }) => {
  await page.goto("/planlegger/");
  const footer = page.locator(".site-footer");
  await expect(footer).toContainText("Data hentet");
  await expect(footer).toContainText("uoffisiell, med forbehold om feil");
  await expect(footer.locator("a")).toHaveCount(0);
});

test("a lowercase course URL lands on the course page, not a 404 (astro-7)", async ({ page }) => {
  // `getStaticPaths` emits the catalog's own casing, so /emne/tdt4100/ 404s on
  // a page that exists one casing change away. The worker 301s to the uppercased
  // path after ASSETS has said 404; uppercasing is idempotent, so no loop.
  const response = await page.goto("/emne/tdt4100/");
  expect(response?.status()).toBe(200);
  expect(page.url()).toMatch(/\/emne\/TDT4100\/$/);
  await expect(page.locator(".emne-code")).toHaveText("TDT4100");
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
  for (const href of ["/planlegger/", "/emner/", "/planlegger/", "/emner/"]) {
    await navTo(page, href);
  }
  expect(problems).toEqual([]);
});
