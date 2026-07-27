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
 * - TMA4400 partitions its lectures by programme cluster (studyProgramKeys):
 *   MTDT's own parallels are "Forelesning 1 MTDT …" (Tue 10:15) and "Forelesning
 *   2 … MTDT" (Thu 10:15); "Forelesning 2 MTBYGG" (Wed 08:15–10:00) is tagged
 *   for MTBYGG only — a cross-programme parallel an MTDT student can still pick.
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

  // The empty state is a card in the week frame, not a dead end (§0/B5).
  // Its button is now the only "Velg studieprogram" on the page besides the
  // topbar chip — the banner's identically-labeled control is gone.
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

test("share: a program-less link clears the profile chip", async ({ page }) => {
  // Finding 2: an MTDT plan writes np:profile. A program-less shared link opened
  // in the SAME context (localStorage persists that profile) must clear it —
  // savePlan can only ever WRITE np:profile, never clear it, so without
  // removeProgram the header chip kept naming MTDT while the planner showed none.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(page.locator("#studieinfo-chip")).toContainText("MTDT", { timeout: 30_000 });

  // A different-path hop first guarantees a real document load (so the initial
  // hash-load path runs), and proves the profile is genuinely stored: the chip
  // still reads MTDT on /emner/.
  await page.goto("/emner/");
  await expect(page.locator("#studieinfo-chip")).toContainText("MTDT");

  await page.goto("/planlegger/#26h;-;%2BTDT4100");
  await expect(courseRows(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator("#studieinfo-chip")).toContainText("Velg studieprogram");
  await expect(page.locator("#studieinfo-chip")).not.toContainText("MTDT");
});

test("overlap: two colliding courses render side by side, both readable", async ({ page }) => {
  // MTDT 2026's obligatory TDT4109 collides with a manually added TDT4120 —
  // the exact clash the old suite's clash-preview (ekstraemne) test verified.
  await page.goto("/planlegger/#26h;MTDT.2026;%2BTDT4120");
  await expect(courseRows(page)).toHaveCount(6, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  // `\d+ kollisjon` (never a bare /kollisjon/, which "ingen kollisjoner" also
  // matches): assert the verdict actually counts a clash, not its clean state.
  await expect(page.locator("#planner-grid-status")).toContainText(/\d+ kollisjon/, {
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

test("groups: a non-default parallel renders with a programme set", async ({ page }) => {
  // Finding 1: with a programme set, the grid used to pre-narrow every course's
  // timetable to that programme's own sections BEFORE the group filter ran, so
  // an explicit pick of a parallel tagged for ANOTHER programme was stripped and
  // the course's block vanished silently. TMA4400 partitions its lectures by
  // programme cluster: MTDT sees "Forelesning 1 MTDT …" (Tue) and "Forelesning 2
  // … MTDT" (Thu); "Forelesning 2 MTBYGG" (Wed 08:15) is tagged for MTBYGG only —
  // exactly the cross-programme parallel the pre-narrow used to drop.
  const tmaBlocks = () => page.locator("#planner-grid-frame .planner-block").filter({ hasText: "TMA4400" });

  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(tmaBlocks().first()).toBeVisible({ timeout: 45_000 });

  await tmaBlocks().first().click();
  const popover = page.locator("#planner-popover");
  await expect(popover).toBeVisible();
  const foreignRow = popover.locator(".planner-popover-group-row", {
    hasText: "Forelesning 2 MTBYGG",
  });
  await expect(foreignRow).toBeVisible();
  await foreignRow.locator("input").check();

  // The picked MTBYGG parallel (Wednesday) must now draw — pre-fix it drew
  // nothing at all for TMA4400.
  await expect(tmaBlocks().first()).toBeVisible();
  await expect(tmaBlocks().first()).toHaveAttribute("aria-label", /onsdag/i);
  expect(page.url()).toMatch(/TMA4400~forelesning-2-mtbygg/i);

  await page.reload();
  await expect(tmaBlocks().first()).toBeVisible({ timeout: 45_000 });
  await expect(tmaBlocks().first()).toHaveAttribute("aria-label", /onsdag/i);
});

test("popover: closes from its own button, not just Esc", async ({ page }) => {
  // A non-modal <dialog> gets no free dismissal, and below 60rem the popover
  // is a full-bleed bottom sheet where the outside-click target is a sliver
  // of screen. Before the × existed there was no visible way out at all.
  await page.goto("/planlegger/#26h;-;%2BTDT4110");

  await expect(gridBlocks(page)).toHaveCount(1, { timeout: 30_000 });
  const popover = page.locator("#planner-popover");

  await gridBlocks(page).first().click();
  await expect(popover).toBeVisible();

  const close = popover.locator(".planner-popover-close");
  await expect(close).toBeVisible();
  await close.click();
  await expect(popover).toBeHidden();

  // And it reopens afterwards — closing must not leave the dialog wedged.
  await gridBlocks(page).first().click();
  await expect(popover).toBeVisible();
});

test("popover: never offers a picker with only one option", async ({ page }) => {
  // The group section used to be gated on `groups.length > 1` across BOTH
  // kinds, so a course with one lecture parallel and two øving groups drew a
  // lone dead radio. The invariant is per-kind and data-independent: a
  // control the student cannot use to choose differently is never rendered.
  const popover = page.locator("#planner-popover");
  const radios = popover.locator('.planner-popover-group-row input[type="radio"]');
  const checkboxes = popover.locator('.planner-popover-group-row input[type="checkbox"]');

  // TDT4110 (3 numbered parallels) and TDT4109 (a single lecture entry) —
  // opposite ends of the gate, both loaded at once.
  await page.goto("/planlegger/#26h;-;%2BTDT4110,%2BTDT4109");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  const blocks = await gridBlocks(page).count();
  expect(blocks).toBeGreaterThan(0);
  for (let i = 0; i < blocks; i++) {
    await gridBlocks(page).nth(i).click();
    await expect(popover).toBeVisible();
    // Zero (nothing to choose) or two-plus (a real choice) — never one.
    expect(await radios.count()).not.toBe(1);
    expect(await checkboxes.count()).not.toBe(1);
  }

  // The retired "Vis alle grupper" button called setSelection([]), which is
  // groups.ts's encoding for "apply the programme default" — it narrowed the
  // week instead of widening it, exactly contradicting its label.
  await expect(popover.locator("button", { hasText: "Vis alle grupper" })).toHaveCount(0);
});

test("one control opens studieinfo, and semester lives only inside it", async ({ page }) => {
  // The page used to carry three permanent openers for one modal — the
  // topbar chip, a banner "Endre" button, and the page title (silently a
  // button) — plus a "Bytt semester" disclosure duplicating the modal's own
  // semester select.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });

  await expect(page.locator("#planner-context-change")).toHaveCount(0);
  await expect(page.locator("#planner-semester")).toHaveCount(0);
  await expect(page.locator("#planner-title button")).toHaveCount(0);

  // The banner still STATES the term; it just no longer switches it.
  await expect(page.locator("#planner-context-line")).toContainText("Høst 2026");

  // With a plan set, the week is a real grid — so no empty-state card is on
  // screen and the topbar chip is the only thing left that opens the modal.
  await expect(page.locator("#planner-grid-frame .planner-week-card")).toHaveCount(0);

  const dialog = page.locator("#studieinfo-dialog");
  await expect(dialog).toBeHidden();
  await page.click("#studieinfo-chip");
  await expect(dialog).toBeVisible();
  await expect(page.locator("#studieinfo-semester-select")).toBeVisible();
});

test("week: three overlapping lectures draw one pile, not three slivers", async ({
  page,
  context,
}) => {
  // Stubbed, not seeded from live data: whether any real MTDT-style plan
  // happens to triple-book a slot this term is not something a regression
  // test should depend on. The three courses below overlap exactly.
  const entry = (code: string, room: string) => ({
    courseCode: code,
    courseName: { nob: `${code} emne`, nno: null, eng: null },
    dayNumber: 1,
    startTime: "08:15",
    endTime: "10:00",
    weeks: ["34-47"],
    rooms: [{ building: room, room, url: null }],
    title: "Forelesning",
    name: "Forelesning",
  });
  const codes = ["TDT4109", "TDT4120", "TDT4110"];
  for (const code of codes) {
    await context.route(`**/api/course/${code}/timetable*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([entry(code, `R${code.slice(-1)}`)]),
      }),
    );
  }

  await page.goto(`/planlegger/#26h;-;${codes.map((c) => `%2B${c}`).join(",")}`);

  const pile = page.locator(".planner-block-pile");
  await expect(pile).toHaveCount(1, { timeout: 30_000 });
  // Every course is NAMED in the pile — the retired "+N til" chip reduced the
  // ones it hid to a bare count, which is the one thing you cannot act on.
  for (const code of codes) await expect(pile).toContainText(code);
  await expect(pile).toContainText("3 emner");

  // And no sliver: the three are not split into ~35px columns.
  await expect(page.locator("#planner-grid-frame .planner-block")).toHaveCount(1);

  // The pile opens the popover, so its contents stay reachable.
  await pile.click();
  await expect(page.locator("#planner-popover")).toBeVisible();
});

test("week: the øving layer shows picked groups, not the whole cohort's", async ({ page }) => {
  // EXPH0300 publishes 14 seminar groups. Before this, turning the toggle on
  // drew every one of them — 41 blocks in an MTDT week.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(page.locator("#planner-grid-frame .planner-block").first()).toBeVisible({
    timeout: 45_000,
  });
  const before = await page.locator("#planner-grid-frame .planner-block").count();

  await page.click("#planner-others-toggle");
  await expect(page.locator(".planner-note-groups").first()).toBeVisible({ timeout: 15_000 });

  const after = await page.locator("#planner-grid-frame .planner-block").count();
  // A handful of ungrouped/sole-group activities may appear; a flood may not.
  expect(after).toBeLessThan(before + 12);

  // Nothing is hidden silently — each withheld course gets a note that opens
  // its picker, and a note never asks you to choose between fewer than two.
  const notes = page.locator(".planner-note-groups");
  expect(await notes.count()).toBeGreaterThan(0);
  for (const text of await notes.allTextContents()) {
    expect(text).not.toContain("har 1 gruppe");
  }

  await notes.first().click();
  await expect(page.locator("#planner-popover")).toBeVisible();
  await expect(page.locator("#planner-popover .planner-popover-group-row").first()).toBeVisible();
});

test("course page: the grade figure renders from DBH", async ({ page }) => {
  await page.goto("/emne/TDT4100/");
  const grid = page.locator("#grades-section .grades-grid");
  await expect(grid).toBeVisible({ timeout: 45_000 });

  // Small multiples, newest first, one bar per grade with its own label.
  const charts = grid.locator(".grades-chart");
  expect(await charts.count()).toBeGreaterThan(0);
  const first = charts.first();
  await expect(first.locator(".grades-bar-grade").first()).toHaveText("A");
  await expect(first).toContainText("kandidater");
  expect(await first.locator(".grades-bar").count()).toBeGreaterThan(1);
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
