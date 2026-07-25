import { expect, type Page, test } from "@playwright/test";

/**
 * The student situations the study plan actually produces, end to end
 * against live NTNU data. Each one resolves a period into a different shape
 * (see programPlan.ts), and most were broken before REVIEW.md's Wave 1:
 *
 * - 1. år            — every course `O`; a pure lookup, zero questions.
 * - 3. år bachelor   — zero `O` courses; a pool of interchangeable electives.
 * - 3. år siving     — no top-level courses at all; gated behind studieretning.
 * - ekstraemne       — a course outside the programme entirely.
 * - MTIØT            — a programme code containing Æ/Ø/Å (B1: the worker
 *   404/400'd every such code before `decodeURIComponent` landed).
 * - BSPL             — a campus split whose own direction code contains Ø
 *   (B10: the hash silently dropped it and reopened the question every load).
 * - semester switch  — B4: the programme plan must re-derive per semester,
 *   never keep showing the previously-resolved period as a confident "30 av
 *   30 sp".
 * - empty planner    — B5: `/planlegger/` with no stored plan is the picker,
 *   not a dead end.
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
  // The programme code lives in the title (D2/D10); the kull/semester line
  // is the separate context line below it.
  await expect(page.locator("#planner-title")).toContainText("MTDT");
  await expect(page.locator("#planner-context-line")).toContainText("kull 2026");
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

  // U8: this period is elective by design, so there is no studieretning to
  // answer — but the question panel is reused to name the next step rather
  // than leaving an empty week beside a silent "0 av 30 sp".
  await expect(page.locator("#planner-direction-title")).toContainText("er valgfri", {
    timeout: 30_000,
  });
  await expect(page.locator("#planner-direction-btn")).toContainText("Velg emner");
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

test("MTIØT: a programme code containing Æ/Ø/Å resolves, not a 400 (B1)", async ({ page }) => {
  await seedProgram(page, {
    code: "MTIØT",
    cohort: 2024,
    name: "Industriell økonomi og teknologiledelse",
  });

  // Before B1's decode fix, /api/program/MTI%C3%98T/plan?year=… 400'd from
  // the worker and this exact status line never cleared.
  await expect(page.locator("#planner-picker-status")).not.toContainText(
    "Klarte ikke å hente studieplanen",
    { timeout: 30_000 },
  );
  await expect(page.locator("#planner-title")).toContainText("MTIØT", { timeout: 30_000 });

  // Whichever shape this kull's period turns out to be (prefilled, or gated
  // behind a studieretning question), it must be a real resolution — not the
  // silent failure the 400 used to produce (blank week, no question, no rows).
  // Polled, not sampled once: resolving the period is two live fetches, and a
  // cold worker cache takes longer than the load event does.
  await expect
    .poll(
      async () =>
        (await courseRows(page).count()) > 0 ||
        (await page.locator("#planner-direction").isVisible()),
      { timeout: 30_000 },
    )
    .toBe(true);
});

test("BSPL: a campus choice whose own code contains Ø survives a reload (B10)", async ({
  page,
}) => {
  await seedProgram(page, { code: "BSPL", cohort: 2026, name: "Sykepleie" });

  const question = page.locator("#planner-direction");
  await expect(question).toBeVisible({ timeout: 30_000 });
  const gjovik = page.locator("#planner-direction-chips button", { hasText: "Gjøvik" });
  await expect(gjovik).toBeVisible({ timeout: 15_000 });
  await gjovik.click();

  await expect(question).toBeHidden();
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  // The direction code itself carries Ø (…GJØVIK) — this is exactly the
  // character `parsePlanHash` used to drop before B10, which reopened the
  // question on every reload instead of remembering the answer.
  expect(page.url()).toMatch(/BSPL\.2026\.[^;]*GJ(%C3%98|Ø)VIK/i);

  await page.reload();
  await expect(page.locator("#planner-direction")).toBeHidden();
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });
});

test("switching semester re-derives the programme plan (B4)", async ({ page }) => {
  await seedProgram(page, { code: "MTDT", cohort: 2026, name: "Datateknologi" });
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator("#planner-course-rows")).toContainText("TDT4109");

  await page.click("#planner-semester summary");
  await page
    .locator("#planner-semester-toggle button", { hasText: "Vår 2027" })
    .click();

  // MTDT kull 2026's real period 2 (verified live) is TDT4100, TDT4180,
  // TMA4422, TTT4203 — a different set, not a byte-identical copy of period
  // 1 relabelled "Vår 2027" and still shown as a confident "30 av 30 sp".
  await expect(courseRows(page)).toHaveCount(4, { timeout: 30_000 });
  await expect(page.locator("#planner-course-rows")).toContainText("TDT4100");
  await expect(page.locator("#planner-course-rows")).not.toContainText("TDT4109");
  await expect(page.locator("#planner-context-line")).toContainText("Vår 2027");
});

test("an empty /planlegger/ opens the picker, not a dead end (B5)", async ({ page }) => {
  await page.goto("/planlegger/");

  await expect(page.locator("#planner-picker")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#planner-main")).toHaveClass(/is-empty/);
  // The add field is the code-paste escape hatch and must stay mounted, not
  // merely referenced by copy that points at something hidden.
  await expect(page.locator("#planner-add-input")).toBeVisible();
  await expect(page.locator("#planner-course-rows")).toBeHidden();
});
