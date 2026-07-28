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

/**
 * Waits for `#planner-grid-status` to settle and returns it, failing loudly if
 * the plan's own data never arrived.
 *
 * The verdict has THREE states since pc-3: a clash count, the green clean
 * state, and a muted "kan ikke sjekkes — mangler timeplan for N emne(r)" when a
 * course's timetable fetch failed or was never made. That third state is the
 * fix — the line used to print "ingen kollisjoner" over a week missing a
 * course — but it means an upstream flake no longer shows up as a wrong
 * verdict, it shows up as a *missing* one. A test matching only
 * `/\d+ kollisjon/` would then time out and report the clash engine as broken.
 * So the wait is explicit and the upstream case gets its own message.
 */
async function settledVerdict(page: Page, timeout = 45_000): Promise<string> {
  const status = page.locator("#planner-grid-status");
  await expect
    .poll(async () => (await status.textContent())?.trim() ?? "", { timeout })
    .not.toMatch(/^$|^henter timeplan/);
  const text = (await status.textContent())?.trim() ?? "";
  expect(
    text,
    "a timetable fetch never landed — upstream/CI flake, NOT a clash-engine regression",
  ).not.toContain("kan ikke sjekkes");
  return text;
}

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
  // `settledVerdict` separates that from the third state ("kan ikke sjekkes"),
  // which means the data never arrived and says nothing about the engine.
  expect(await settledVerdict(page)).toMatch(/\d+ kollisjon/);

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

test("verdict: a failed timetable fetch refuses the check instead of clearing it", async ({
  page,
}) => {
  // pc-3, the audit's one blocker: with 4 of 5 timetables fine and TMA4400's
  // 503, the week drew a normal grid and #planner-grid-status said "ingen
  // kollisjoner" in Green-Means-Fits accent — a confident answer to PRODUCT
  // §1's only question, computed over data it never had. The verdict now has a
  // third state, and this is the only place the three are distinguishable.
  await page.route("**/api/course/TMA4400/timetable*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Upstream unavailable" }),
    }),
  );

  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  // The rest of the week still draws — a mixed outcome, which is exactly the
  // case the all-courses-empty fallback card cannot reach.
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await expect(gridBlocks(page).filter({ hasText: "TMA4400" })).toHaveCount(0);

  const status = page.locator("#planner-grid-status");
  await expect(status).toContainText(/kan ikke sjekkes/, { timeout: 45_000 });
  await expect(status).toContainText(/mangler timeplan for \d+ emne/);
  // Not the clean state, and not silence either: `.is-clean` is the accent-green
  // mark, and it must never sit on a verdict we could not compute.
  await expect(status).not.toHaveClass(/is-clean/);
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
  // The picked session itself, addressed by its own aria-label rather than by
  // position. `.first()` used to stand in for it and no longer can: since
  // groups-2 a lecture pick answers only its own session family, so the week
  // keeps "Forelesning 1 MTDT …" (tirsdag 10:15) and "Plenumsregning" (onsdag
  // 14:15) beside the picked "Forelesning 2 MTBYGG" — and blocks are appended
  // day-major, which makes `.first()` the TUESDAY block. blockAriaLabel emits
  // "TMA4400, onsdag 08:15 til 10:00, uke 34 til 47", so the prefix pins the
  // 08:15 session and never the 14:15 plenary.
  const mtbyggBlock = () =>
    page.locator('#planner-grid-frame .planner-block[aria-label^="TMA4400, onsdag 08:15"]');

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
  await expect(mtbyggBlock()).toHaveCount(1);
  expect(page.url()).toMatch(/TMA4400~forelesning-2-mtbygg/i);

  // …and the student's OTHER Matematikk 1 sessions must survive it. A pick is
  // not an allow-list over the whole course: one tick used to delete every
  // lecture whose group the student had not also named (groups-2).
  expect(await tmaBlocks().count()).toBeGreaterThan(1);

  await page.reload();
  await expect(mtbyggBlock()).toHaveCount(1, { timeout: 45_000 });
  expect(await tmaBlocks().count()).toBeGreaterThan(1);
});

test("groups: the picker lists this semester's groups, not the whole year's", async ({ page }) => {
  // groups-3/groups-4: EXPH0300 publishes 36 seminar groups and 5 lecture
  // parallels across Trondheim, Gjøvik and Ålesund over a full year, and the
  // picker listed all 44 — on a phone that put the popover's own Dropp and
  // "Gå til emnesiden" ~1 000 px below the fold behind another city's seminars.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  const exphBlock = gridBlocks(page).filter({ hasText: "EXPH0300" }).first();
  await expect(exphBlock).toBeVisible({ timeout: 45_000 });
  await exphBlock.click();

  const popover = page.locator("#planner-popover");
  await expect(popover).toBeVisible();
  const groupRows = popover.locator(".planner-popover-group-row");

  // Every Ålesund session of this course — the five seminar groups and
  // "Forelesningsparallell 3 Ålesund" — is taught in weeks 3-17, so none of it
  // belongs to a Høst plan. The picker is built from the SEMESTER's entries now
  // (the øving layer additionally narrowed to the programme's own sections).
  await expect(
    popover.locator(".planner-popover-group-row", { hasText: "Ålesund" }),
  ).toHaveCount(0);
  // A bound, not an exact count: the audit measured 44 rows here, of which ~15
  // were drawable. The number depends on live tagging, so this pins the order
  // of magnitude — a revert to "every group the course publishes all year"
  // fails it. The lower bound catches the other way this can go wrong: a pile
  // (or a narrowing that ate the whole picker) has no group section at all.
  const rowCount = await groupRows.count();
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThan(30);

  // The LECTURE layer is deliberately NOT narrowed by programme: picking a
  // parallel tagged for another programme or campus is a documented capability
  // (groups.ts), and this picker is the only control that can exercise it.
  // "Forelesningsparallell 3 Gjøvik" runs weeks 34-45, so it is a real autumn
  // option for a Trondheim student who wants it.
  await expect(
    popover.locator(".planner-popover-group-row", { hasText: "Forelesningsparallell 3 Gjøvik" }),
  ).toHaveCount(1);
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

  // course-4: the figure was 39 % of the mobile page. At most three charts are
  // on screen; everything older stacks inside a collapsed disclosure, so the
  // section stops pushing credits and vurderingsform below y=2438.
  expect(await charts.count()).toBeLessThanOrEqual(3);
  const older = page.locator("#grades-section .grades-older");
  // Guarded, not asserted: whether a course has a fourth ordinary sitting in
  // range is live DBH data. When it does, the disclosure must start closed and
  // still open.
  if ((await older.count()) === 1) {
    await expect(older.locator(".grades-chart").first()).toBeHidden();
    await older.locator("summary").click();
    await expect(older.locator(".grades-chart").first()).toBeVisible();
  }
});

test("catalog: the clash verdict is rendered in the row, not only in a tooltip", async ({
  page,
}) => {
  // search-2: the verdict was written to `title`/`aria-label` only. On touch,
  // the tap that triggers the check is the same tap that commits the add, so a
  // phone user saw nothing before or after pressing "Legg til i planen".
  await page.goto("/planlegger/#26h;-;%2BTDT4160");
  await expect(courseRows(page)).toHaveCount(1, { timeout: 30_000 });

  await page.goto("/emner/?q=TDT4110");
  const row = page.locator("#emner-results li", { hasText: "TDT4110" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const clash = row.locator(".emner-row-clash");
  await expect(clash).toBeEmpty();

  // Hover is a deliberate dwell (200 ms) before the timetable fetch — the same
  // pointerenter a tap fires. Either verdict is the fix; TDT4110 vs TDT4160 is
  // a live clash today ("Kolliderer med TDT4160, mandag 14:15."), but asserting
  // that exact pair would go red on an upstream reshuffle that says nothing
  // about this finding.
  await row.locator(".emner-row-add").hover();
  await expect(clash).toContainText(/kollisjon|kolliderer/i, { timeout: 30_000 });
});

test("catalog: a course that is not taught this year offers no add button", async ({ page }) => {
  // crawler-3: TMA4100 and 702 others exist only in last year's catalog. Adding
  // one contributed nothing to the week and left the planner showing a raw
  // English "fikk ikke hentet detaljer: Not found". The page still exists — the
  // two-year union is why — so only the add control goes.
  await page.goto("/emner/?q=TMA4100");
  const row = page.locator("#emner-results li", { hasText: "TMA4100" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.locator('a[href="/emne/TMA4100/"]')).toHaveCount(1);
  await expect(row).toContainText("ikke undervist i");
  await expect(row.locator(".emner-row-add")).toHaveCount(0);
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

  // The city answer resolves its own courses (EXPH0400, SYG1000, SYG1001) and
  // opens the NEXT waypoint — BSPL26-V-GJØVIK nests "valg av praksisløp,
  // Gjøvik" underneath itself, and since plan-1 `classifyPeriod` descends into
  // it instead of stopping one level down. So the week fills AND keeps asking;
  // the old `expect(question).toBeHidden()` here asserted the one-level
  // behaviour that finding removed.
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  // The direction code itself carries Ø (…GJØVIK) — this is exactly the
  // character `parsePlanHash` used to drop before B10.
  expect(page.url()).toMatch(/BSPL\.2026\.[^;]*GJ(%C3%98|Ø)VIK/i);

  await page.reload();
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });
  expect(page.url()).toMatch(/BSPL\.2026\.[^;]*GJ(%C3%98|Ø)VIK/i);
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

test("dropping from the block popover keeps focus inside the week", async ({ page }) => {
  // a11y-3: "Dropp" destroys the block that opened the popover, and the close
  // handler then called focus() on a detached node — a silent no-op that left
  // focus on <body>, outside a deliberately NON-modal dialog, so the next Tab
  // restarted at the skip link. The course's own row toggle is the honest
  // landing place: it is the same drop, so it also undoes it.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  const code = (await gridBlocks(page).first().locator(".planner-block-code").textContent())?.trim() ?? "";
  expect(code).not.toBe("");

  await gridBlocks(page).first().click();
  const popover = page.locator("#planner-popover");
  await expect(popover).toBeVisible();
  await popover.locator(".planner-popover-action", { hasText: "Dropp" }).click();
  await expect(popover).toBeHidden();

  const row = courseRows(page).filter({ hasText: code }).first();
  await expect(row).toHaveClass(/is-dropped/);
  await expect(row.locator(".planner-course-remove")).toBeFocused();
  // Belt and braces: whatever holds focus, it must not be the document body.
  expect(await page.evaluate(() => document.activeElement?.tagName ?? "")).not.toBe("BODY");
});

test("add dialog: one Escape from the search field closes it", async ({ page }) => {
  // modals-7: the field was `type="search"`, and Chrome's search input eats the
  // first Escape to clear itself, cancelling the dialog's close request — so
  // the dismissal gesture read as broken until the second press. Typing first
  // is the point: an empty search input has nothing to clear and would pass
  // even with the bug.
  await page.goto("/planlegger/");
  await page.click("#planner-add-course-btn");
  const addDialog = page.locator("#planner-add-dialog");
  await expect(addDialog).toBeVisible();

  const input = addDialog.locator("input.add-course-input");
  await input.fill("TDT4100");
  await expect(addDialog.locator(".add-course-row").first()).toBeVisible({ timeout: 15_000 });

  await input.press("Escape");
  await expect(addDialog).toBeHidden();
});
