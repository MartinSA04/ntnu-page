import { expect, type Page, test } from "@playwright/test";

/**
 * The rework's modal-first flow, end to end against live NTNU data
 * (REWORK-2026-07-25 task 14). The homepage picker, the plan strip and
 * `/studier/` are all gone (tasks 9–13); every scenario here drives the
 * studieinfo `<dialog>` or seeds the plan via the shareable hash directly —
 * the two ways a plan is ever set now.
 *
 * Two seeding styles on purpose:
 * - Tests ABOUT the modal (onboarding, semester switch, BSPL's campus
 *   question) drive `#studieinfo-dialog` for real.
 * - Tests about something else (overlap, groups, sharing, failure honesty)
 *   seed the plan by navigating straight to its hash — `parsePlanHash` +
 *   `loadPeriodCourses` reproduce exactly what Lagre would have written,
 *   without paying for a modal round trip the test isn't about.
 *
 * Live-data facts this file leans on (verified against the running worker
 * before writing the assertions, not guessed):
 * - MTDT kull 2026 period 1 (26h) = HMS0002, TDT4109, TMA4400, TMA4412,
 *   EXPH0300 (SIVINGPRA is a `planElement`, never a course row) — 5 rows.
 * - TDT4109's only lecture-classified entry ("Digital forelesning …", Friday
 *   12:15–13:00, weeks 34-35+45-46) collides with TDT4120's "Forelesning"
 *   (Friday 12:15–15:00, weeks 34-47) — the known clash the old suite's
 *   ekstraemne test already established via the add-dialog's clash preview.
 * - TDT4110 publishes three numbered lecture parallels with no campus
 *   suffix ("Forelesningsparallell 1/2/3"): parallel 1 is Friday 08:15–10:00,
 *   parallel 2 is Wednesday 08:15–10:00. With no programme to narrow by, the
 *   numbered-parallel fallback in groups.ts defaults to parallel 1.
 * - MTDT kull 2024 at 26h (a 3rd-year autumn) is gated behind "Valg av
 *   studieretning" — the same waypoint the pre-rework suite exercised.
 * - BSPL kull 2026 period 1 is gated behind a campus choice whose own code
 *   is "BSPL26-V-GJØVIK" (B10).
 */

const courseRows = (page: Page) => page.locator("#planner-course-rows .planner-course-row");
const gridBlocks = (page: Page) => page.locator("#planner-grid-frame .planner-block");

/** The course code of each row, read from the row's own `.np-data` head span (never its meta/credits spans). */
function courseCodesOf(page: Page): Promise<string[]> {
  return page.locator("#planner-course-rows .planner-course-row-head .np-data").allTextContents();
}

test("onboarding: modal → programme + kull + retning → a full week", async ({ page }) => {
  await page.goto("/planlegger/");

  // The empty state is a card in the week frame, not a dead end (§0/B5) —
  // its own "Velg studieprogram" button is the one this scenario starts from,
  // distinct from the banner's identically-labeled control.
  const card = page.locator("#planner-grid-frame .planner-week-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.locator("button", { hasText: "Velg studieprogram" }).click();

  const dialog = page.locator("#studieinfo-dialog");
  await expect(dialog).toBeVisible();

  await page.fill("#studieinfo-program-input", "Datateknologi");
  // "Datateknologi" alone matches MIDT/MTDT/PHCOS too (B6) — the code span
  // pins this to the one row this scenario means.
  const mtdt = page.locator("#studieinfo-program-listbox .studieinfo-program-option", {
    hasText: "MTDT",
  });
  await expect(mtdt).toBeVisible({ timeout: 15_000 });
  await mtdt.click();

  const kullChips = page.locator("#studieinfo-kull-chips button");
  await expect(kullChips.first()).toBeVisible({ timeout: 20_000 });
  expect(await kullChips.count()).toBeGreaterThanOrEqual(4);

  // An older kull: MTDT 2024 at 26h is a 3rd-year autumn, gated behind
  // studieretning — the retning select must appear before Lagre resolves it.
  await page.locator("#studieinfo-kull-chips button", { hasText: "2024" }).click();

  const retningSelect = page.locator("#studieinfo-retning-select");
  await expect(retningSelect).toBeVisible({ timeout: 20_000 });
  await retningSelect.selectOption({ index: 1 }); // index 0 is the "Ikke valgt ennå" placeholder

  await page.click("#studieinfo-save");
  await expect(dialog).toBeHidden();

  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await expect(page.locator("#studieinfo-chip")).toContainText("MTDT · 2024");
  expect(page.url()).toMatch(/#26h;MTDT\.2024/);
});

test("share: the hash reproduces the plan in a fresh context", async ({ page, browser }) => {
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });
  const codes = (await courseCodesOf(page)).sort();
  expect(codes).toContain("TDT4109");

  const url = page.url();
  const freshContext = await browser.newContext();
  try {
    const freshPage = await freshContext.newPage();
    await freshPage.goto(url);
    await expect(courseRows(freshPage)).toHaveCount(5, { timeout: 30_000 });
    const freshCodes = (await courseCodesOf(freshPage)).sort();
    expect(freshCodes).toEqual(codes);
  } finally {
    await freshContext.close();
  }
});

test("overlap: two colliding courses render side by side, both readable", async ({ page }) => {
  // MTDT 2026's obligatory TDT4109 collides with a manually added TDT4120 —
  // the exact clash the old suite's clash-preview (ekstraemne) test verified.
  await page.goto("/planlegger/#26h;MTDT.2026;%2BTDT4120");
  await expect(courseRows(page)).toHaveCount(6, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  await expect(page.locator("#planner-grid-status")).toContainText(/kollisjon/, {
    timeout: 30_000,
  });

  // Only the two colliding blocks carry "kolliderer med" in their aria-label.
  const clashBlocks = page.locator('.planner-block[aria-label*="kolliderer med"]');
  await expect(clashBlocks).toHaveCount(2, { timeout: 30_000 });

  const blocks = await clashBlocks.all();
  for (const block of blocks) {
    const colCount = await block.evaluate((el) => el.style.getPropertyValue("--planner-col-count"));
    expect(colCount).toBe("2");
    const box = await block.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(8);
    const codeText = (await block.locator(".planner-block-code").textContent())?.trim() ?? "";
    expect(codeText).not.toBe("");
  }
});

test("groups: switching parallel updates the grid and survives the URL", async ({ page }) => {
  // A bare manual add, no programme — TDT4110's own numbered-parallel
  // fallback (groups.ts) is what decides the default here, not any
  // programme narrowing.
  await page.goto("/planlegger/#26h;-;%2BTDT4110");

  await expect(gridBlocks(page)).toHaveCount(1, { timeout: 30_000 });
  const block = gridBlocks(page).first();
  // Default: Forelesningsparallell 1, Friday 08:15–10:00.
  await expect(block).toHaveAttribute("aria-label", /fredag/i);

  await block.click();
  const popover = page.locator("#planner-popover");
  await expect(popover).toBeVisible();
  const parallel2Row = popover.locator(".planner-popover-group-row", {
    hasText: "Forelesningsparallell 2",
  });
  await expect(parallel2Row).toBeVisible();
  await parallel2Row.locator("input").check();

  // Forelesningsparallell 2 is Wednesday 08:15–10:00 — the Friday slot's
  // block count drops to zero, replaced by exactly one Wednesday block.
  await expect(gridBlocks(page)).toHaveCount(1);
  await expect(gridBlocks(page).first()).toHaveAttribute("aria-label", /onsdag/i);
  expect(page.url()).toMatch(/~forelesningsparallell-2/);

  await page.reload();
  await expect(gridBlocks(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toHaveAttribute("aria-label", /onsdag/i);
  expect(page.url()).toMatch(/~forelesningsparallell-2/);
});

test("manual adds stay in their semester", async ({ page }) => {
  await page.goto("/planlegger/");

  await page.click("#planner-add-course-btn");
  const addDialog = page.locator("#planner-add-dialog");
  await expect(addDialog).toBeVisible();
  await addDialog.locator("input.add-course-input").fill("TDT4100");
  const row = addDialog.locator(".add-course-row", { hasText: "TDT4100" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator(".add-course-add").click();
  await expect(row.locator(".add-course-added")).toBeVisible();
  await addDialog.locator(".add-course-close").click();
  await expect(addDialog).toBeHidden();

  await expect(courseRows(page)).toHaveCount(1);
  await expect(courseRows(page)).toContainText("TDT4100");

  // Switching semester lives inside the studieinfo modal now (no inline
  // toggle-and-add): manual adds are scoped per semester in `np:plans`, so a
  // switch away must drop this course from view without deleting it.
  const dialog = page.locator("#studieinfo-dialog");
  await page.click("#studieinfo-chip");
  await expect(dialog).toBeVisible();
  await page.selectOption("#studieinfo-semester-select", "27v");
  await page.click("#studieinfo-save");
  await expect(dialog).toBeHidden();

  await expect(courseRows(page)).toHaveCount(0);

  await page.click("#studieinfo-chip");
  await expect(dialog).toBeVisible();
  await page.selectOption("#studieinfo-semester-select", "26h");
  await page.click("#studieinfo-save");
  await expect(dialog).toBeHidden();

  await expect(courseRows(page)).toHaveCount(1);
  await expect(courseRows(page)).toContainText("TDT4100");
});

test("failure honesty: API down shows retry, not 'publiseres'", async ({ page, context }) => {
  await context.route("**/api/**", (route) => route.abort());
  await page.goto("/planlegger/#26h;-;%2BTDT4109");

  const card = page.locator("#planner-grid-frame .planner-week-card");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText("Fikk ikke hentet timeplanen");
  await expect(card.locator("button", { hasText: "Prøv igjen" })).toBeVisible();
  // Scoped to the grid frame: the studieinfo dialog's own (closed, so
  // invisible but still present) semester options legitimately say
  // "publiseres" for unpublished terms — that is not this failure.
  await expect(page.locator("#planner-grid-frame")).not.toContainText("publiseres");
});

test("MTIØT: a programme code containing Æ/Ø/Å resolves, not a 400 (B1)", async ({ page }) => {
  // Before B1's decode fix, /api/program/MTI%C3%98T/plan?year=… 400'd from
  // the worker and this exact hash produced a silent blank week.
  const hash = `#26h;${encodeURIComponent("MTIØT")}.2024;`;
  await page.goto(`/planlegger/${hash}`);

  await expect(page.locator("#planner-title")).toContainText("MTIØT", { timeout: 15_000 });

  // Whichever shape this kull's period turns out to be (prefilled, or gated
  // behind a studieretning question), it must be a real resolution — a cold
  // worker cache takes longer than the load event does.
  await expect
    .poll(
      async () =>
        (await courseRows(page).count()) > 0 || (await page.locator("#planner-direction").isVisible()),
      { timeout: 30_000 },
    )
    .toBe(true);

  await expect(page.locator("#studieinfo-chip")).toContainText("MTIØT · 2024");
});

test("BSPL: a campus choice whose own code contains Ø survives a reload (B10)", async ({
  page,
}) => {
  await page.goto("/planlegger/#26h;BSPL.2026;");

  const question = page.locator("#planner-direction");
  await expect(question).toBeVisible({ timeout: 30_000 });
  // The inline week question no longer carries its own chips — choosing a
  // direction now happens in the studieinfo modal it opens into.
  await page.click("#planner-direction-btn");

  const dialog = page.locator("#studieinfo-dialog");
  await expect(dialog).toBeVisible();
  const retningSelect = page.locator("#studieinfo-retning-select");
  await expect(retningSelect).toBeVisible({ timeout: 20_000 });
  const gjovikOption = retningSelect.locator("option", { hasText: "Gjøvik" }).first();
  await expect(gjovikOption).toHaveCount(1);
  const gjovikValue = await gjovikOption.getAttribute("value");
  expect(gjovikValue).toBeTruthy();
  await retningSelect.selectOption(gjovikValue ?? "");
  await page.click("#studieinfo-save");
  await expect(dialog).toBeHidden();

  await expect(question).toBeHidden();
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  // The direction code itself carries Ø (…GJØVIK) — this is exactly the
  // character `parsePlanHash` used to drop before B10.
  expect(page.url()).toMatch(/BSPL\.2026\.[^;]*GJ(%C3%98|Ø)VIK/i);

  await page.reload();
  await expect(page.locator("#planner-direction")).toBeHidden();
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });
});

test("drop and restore a programme course", async ({ page }) => {
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  const code = (await gridBlocks(page).first().locator(".planner-block-code").textContent())?.trim() ?? "";
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
