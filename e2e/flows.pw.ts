import { expect, type Page, test } from "@playwright/test";

/**
 * The four student situations the study plan actually produces, end to end
 * against live NTNU data. Each one resolves a period into a different shape
 * (see programPlan.ts), and three of the four were broken before:
 *
 * - 1. år            — every course `O`; a pure lookup, zero questions.
 * - 3. år bachelor   — zero `O` courses; a pool of interchangeable electives.
 * - 3. år siving     — no top-level courses at all; gated behind studieretning.
 * - ekstraemne       — a course outside the programme entirely.
 */

const PLAN_KEY = "ntnu:plan:v1";

async function seedProgram(
  page: Page,
  program: { code: string; cohort: number; name: string },
): Promise<void> {
  await page.goto("/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [PLAN_KEY, JSON.stringify({ v: 1, semesterId: "26h", courses: [], program })] as const,
  );
  await page.goto("/planlegger/");
}

const courseRows = (page: Page) => page.locator("#planner-course-rows .planner-course-row");
const gridBlocks = (page: Page) => page.locator("#planner-grid-frame .planner-block-code");

test("1. klassing: programme + kull on the homepage lands a full week", async ({ page }) => {
  await page.goto("/");
  await page.fill("#home-input", "datateknologi");
  const option = page.locator(".home-option", { hasText: "MTDT" }).first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();

  const kull = page.locator("#home-kull-chips button", { hasText: "2026" }).first();
  await expect(kull).toBeVisible({ timeout: 20_000 });
  await kull.click();

  await page.waitForURL("**/planlegger/**", { timeout: 30_000 });
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  // The work-experience marker is a planElement, never a course.
  await expect(page.locator("#planner-course-rows")).not.toContainText("SIVINGPRA");
  await expect(page.locator("#planner-credit-line")).toHaveText("30 av 30 sp", {
    timeout: 30_000,
  });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#planner-context-line")).toContainText("MTDT · kull 2026");
  // No question to answer for a first-year.
  await expect(page.locator("#planner-direction")).toBeHidden();
});

test("3. år siving: asks for studieretning, never shows a blank week", async ({ page }) => {
  await seedProgram(page, { code: "MTDT", cohort: 2024, name: "Datateknologi" });

  // Courses obligatory in EVERY direction are prefilled before any answer, so
  // the week is real immediately.
  await expect(courseRows(page)).toHaveCount(2, { timeout: 30_000 });
  await expect(page.locator("#planner-course-rows")).toContainText("TDT4136");
  await expect(page.locator("#planner-course-rows")).toContainText("TMA4135");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  const question = page.locator("#planner-direction");
  await expect(question).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#planner-direction-title")).toHaveText("Valg av studieretning");
  await expect(page.locator("#planner-direction-chips button")).toHaveCount(5);
  await expect(page.locator("#planner-direction-note")).toContainText("frist");

  await page.locator("#planner-direction-chips button", { hasText: "Databaser" }).click();

  await expect(courseRows(page)).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator("#planner-course-rows")).toContainText("TDT4117");
  await expect(question).toBeHidden();
  await expect(page.locator("#planner-context-line")).toContainText("Databaser og søk");
  await expect(page.locator("#planner-credit-line")).toHaveText("22,5 av 30 sp", {
    timeout: 30_000,
  });
  expect(page.url()).toContain("MTDT.2024.MTDTDS-24");

  // The remaining 7,5 sp come from that direction's own electives.
  await expect(page.locator("#planner-gap-line")).toContainText("Mangler 7,5 sp");
  await expect(page.locator("#planner-scope-plan")).toContainText("(5)");
});

test("3. år bachelor: no obligatory courses, a scoped pool instead", async ({ page }) => {
  await seedProgram(page, { code: "BIT", cohort: 2024, name: "Informatikk - bachelor" });

  await expect(page.locator("#planner-direction")).toBeHidden();
  await expect(page.locator("#planner-gap-line")).toContainText("Mangler 30 sp", {
    timeout: 30_000,
  });
  await expect(page.locator("#planner-scope-plan")).toContainText("(8)");

  await page.click("#planner-gap-btn");
  const options = page.locator("#planner-add-listbox .planner-typeahead-option");
  await expect(options.first()).toBeVisible({ timeout: 15_000 });
  // Group headers quote the study plan verbatim — the only place a
  // "velg N herfra" rule is ever written down.
  await expect(page.locator("#planner-add-listbox .planner-pool-group").first()).toContainText(
    "Valgbare IT-emner",
  );
  // Every row carries the facts a choice turns on.
  await expect(options.first().locator(".planner-typeahead-facts")).toContainText(/kollisjon/, {
    timeout: 30_000,
  });

  await options.first().click();
  await expect(courseRows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });
});

test("ekstraemne: previews the clash before adding, from all of NTNU", async ({ page }) => {
  await seedProgram(page, { code: "MTDT", cohort: 2026, name: "Datateknologi" });
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  await page.click("#planner-scope-all");
  await page.fill("#planner-add-input", "TDT4120");
  const row = page.locator("#planner-add-listbox .planner-typeahead-option").first();
  await expect(row).toContainText("TDT4120", { timeout: 15_000 });
  // TDT4120 genuinely collides with the first-year week — red ink, named.
  await expect(row.locator(".planner-typeahead-facts")).toContainText("kolliderer med", {
    timeout: 30_000,
  });

  await row.click();
  await expect(courseRows(page)).toHaveCount(6, { timeout: 30_000 });
  expect(page.url()).toContain("+TDT4120");
});

test("drop and restore a programme course", async ({ page }) => {
  await seedProgram(page, { code: "MTDT", cohort: 2026, name: "Datateknologi" });
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  const code = (await gridBlocks(page).first().textContent())?.trim() ?? "";
  expect(code).not.toBe("");
  const row = courseRows(page).filter({ hasText: code }).first();
  await row.locator(".planner-course-remove").click();

  // Still listed — a dropped programme course never disappears — but off the
  // grid, out of the credits, and marked in the shareable URL.
  await expect(row).toHaveClass(/is-dropped/);
  await expect(courseRows(page)).toHaveCount(5);
  await expect(gridBlocks(page).filter({ hasText: code })).toHaveCount(0);
  expect(page.url()).toContain(`-${code}`);

  const restore = row.locator(".planner-course-remove");
  await expect(restore).toHaveText("Legg tilbake");
  await restore.click();
  await expect(gridBlocks(page).filter({ hasText: code }).first()).toBeVisible({
    timeout: 30_000,
  });
});
