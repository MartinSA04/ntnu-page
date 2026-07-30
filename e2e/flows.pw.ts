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

/**
 * Opens a course's settings the way the UI now does it: a bar in the week
 * opens the READ popover for that session, and its one verb is the way through
 * to the editor (REWORK-2026-07-29f). Clicking a bar no longer opens the modal
 * directly. The verb is targeted by class, not by text: it names its outcome
 * for the layer the clicked session belongs to ("Velg parallell" / "Velg
 * gruppe" / "Endre emnet"), so which word it is depends on the course.
 */
async function settingsFromBlock(page: Page, block = gridBlocks(page).first()): Promise<void> {
  await block.click();
  const popover = page.locator("#planner-block-popover");
  await expect(popover).toBeVisible();
  await popover.locator(".block-popover-edit").click();
  await expect(page.locator("#planner-course-settings")).toBeVisible();
}

/** The course list's row is inert; its settings button is the target. */
const courseSettingsBtn = (page: Page, code: string) =>
  page.locator(`#planner-course-rows .planner-course-open[data-code="${code}"]`);
const gridBlocks = (page: Page) => page.locator("#planner-grid-frame .planner-block");

/**
 * The planner names the plan in its own title now, so the topbar chip is not
 * rendered there (REWORK-2026-07-30b) — `#planner-title` is where "whose plan
 * is this" is asserted on this page, and `#planner-edit-plan` is the one
 * control that opens studieinfo from it. The chip is still the assertion on
 * every other page, where it is the only thing naming the plan.
 */
const planTitle = (page: Page) => page.locator("#planner-title");
const editPlan = (page: Page) => page.locator("#planner-edit-plan");
const editPlanLabel = (page: Page) => page.locator("#planner-edit-plan-label");

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

/** The course code of each row, read from its printed chip — never from the
 *  credit column, which is `.np-data` too. */
function courseCodesOf(page: Page): Promise<string[]> {
  return page.locator("#planner-course-rows .planner-course-chip").allTextContents();
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
  await expect(planTitle(page)).toHaveText("MTDT · 2024 · Høst 2026");
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
  await expect(planTitle(page)).toContainText("MTDT", { timeout: 30_000 });

  // A different-path hop first guarantees a real document load, so the initial
  // hash-load path runs. The landing page states nothing about the plan since
  // the chip was deleted, so the proof that the profile is genuinely stored
  // rather than held in memory is the planner reading it back after the hop.
  await page.goto("/");
  await expect(page.locator("#studieinfo-chip")).toHaveCount(0);

  await page.goto("/planlegger/#26h;-;%2BTDT4100");
  await expect(courseRows(page)).toHaveCount(1, { timeout: 30_000 });
  // A program-less plan has no code to be the title, so the page falls back to
  // its own name — and the hint carries the invitation instead of a programme.
  await expect(planTitle(page)).toHaveText("Semesterplan");
  await expect(planTitle(page)).not.toContainText("MTDT");
  await expect(editPlanLabel(page)).toHaveText("Velg studieprogram");
});

test("overlap: two colliding courses stack, both full width and readable", async ({ page }) => {
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

  // REWORK-2026-07-29b D1: they no longer split a column between them — they
  // take a lane each and keep their full width, which is their duration. The
  // old assertion was `--planner-col-count === "2"`, i.e. "each got half".
  const blocks = await clashBlocks.all();
  const lanes = new Set<string>();
  for (const block of blocks) {
    lanes.add(await block.evaluate((el) => el.style.getPropertyValue("--planner-lane")));
    const box = await block.boundingBox();
    // A colliding bar is now as wide as any other bar of the same length —
    // 8 px was the floor when two of them shared one 150 px weekday.
    expect(box?.width ?? 0).toBeGreaterThan(40);
    const codeText = (await block.locator(".planner-block-code").textContent())?.trim() ?? "";
    expect(codeText).not.toBe("");
  }
  expect(lanes.size).toBe(2);

  // And exactly one zone marks the minutes they share.
  await expect(page.locator(".planner-clash-zone")).toHaveCount(1);
});

test("verdict: a failed timetable fetch refuses the check instead of clearing it", async ({
  page,
}) => {
  // pc-3, the audit's one blocker: with 4 of 5 timetables fine and TMA4400's
  // 503, the week drew a normal grid and #planner-grid-status said "ingen
  // kollisjoner" in Green-Means-Fits accent — a confident answer to PRODUCT
  // §1's only question, computed over data it never had. The verdict now has a
  // third state, and this is the only place the three are distinguishable.
  // (`--verdict` green is the ONLY thing on the page still coloured by an
  // outcome — REWORK-2026-07-30 moved every focus ring, fill and link to ink —
  // so a false green here is now the single loudest lie the page can tell.)
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

  // The provenance line is the other half of refusing: it names WHICH course
  // the check could not see. It is silent on a clean plan (REWORK-2026-07-30e),
  // so its presence here is the assertion, not just its text.
  const provenance = page.locator("#planner-provenance");
  await expect(provenance).toBeVisible({ timeout: 45_000 });
  await expect(provenance).toContainText("TMA4400");
  await expect(provenance).not.toContainText("Timeplan hentet direkte fra NTNU");

  const status = page.locator("#planner-grid-status");
  await expect(status).toContainText(/kan ikke sjekkes/, { timeout: 45_000 });
  await expect(status).toContainText(/mangler timeplan for \d+ emne/);
  // Not the clean state, and not silence either: `.is-clean` is the verdict
  // green, and it must never sit on a verdict we could not compute.
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

  await settingsFromBlock(page, block);
  const settings = page.locator("#planner-course-settings");
  const parallel2Row = settings.locator(".course-settings-group-row", {
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

  await settingsFromBlock(page, tmaBlocks().first());
  const settings = page.locator("#planner-course-settings");
  await expect(settings).toBeVisible();
  const foreignRow = settings.locator(".course-settings-group-row", {
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
  await settingsFromBlock(page, exphBlock);

  const settings = page.locator("#planner-course-settings");
  const groupRows = settings.locator(".course-settings-group-row");

  // Every Ålesund session of this course — the five seminar groups and
  // "Forelesningsparallell 3 Ålesund" — is taught in weeks 3-17, so none of it
  // belongs to a Høst plan. The picker is built from the SEMESTER's entries now
  // (the øving layer additionally narrowed to the programme's own sections).
  await expect(
    settings.locator(".course-settings-group-row", { hasText: "Ålesund" }),
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
    settings.locator(".course-settings-group-row", { hasText: "Forelesningsparallell 3 Gjøvik" }),
  ).toHaveCount(1);
});

test("course settings: closes from its own button, not just Esc", async ({ page }) => {
  // Inherited from the popover this replaced, where a non-modal <dialog> got
  // no free dismissal at all. `showModal()` gives Esc and a backdrop back, but
  // the × stays: on touch there is no Esc, and a backdrop tap is not a gesture
  // a student should have to guess at.
  await page.goto("/planlegger/#26h;-;%2BTDT4110");

  await expect(gridBlocks(page)).toHaveCount(1, { timeout: 30_000 });
  const settings = page.locator("#planner-course-settings");

  await settingsFromBlock(page);

  const close = settings.locator(".course-settings-close");
  await expect(close).toBeVisible();
  await close.click();
  await expect(settings).toBeHidden();

  // And it reopens afterwards — closing must not leave the dialog wedged.
  await settingsFromBlock(page);
});

test("course settings: never offers a picker with only one option", async ({ page }) => {
  // The group section used to be gated on `groups.length > 1` across BOTH
  // kinds, so a course with one lecture parallel and two øving groups drew a
  // lone dead radio. The invariant is per-kind and data-independent: a
  // control the student cannot use to choose differently is never rendered.
  const settings = page.locator("#planner-course-settings");
  const radios = settings.locator('.course-settings-group-row input[type="radio"]');
  const checkboxes = settings.locator('.course-settings-group-row input[type="checkbox"]');

  // TDT4110 (3 numbered parallels) and TDT4109 (a single lecture entry) —
  // opposite ends of the gate, both loaded at once.
  await page.goto("/planlegger/#26h;-;%2BTDT4110,%2BTDT4109");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  const blocks = await gridBlocks(page).count();
  expect(blocks).toBeGreaterThan(0);
  for (let i = 0; i < blocks; i++) {
    await settingsFromBlock(page, gridBlocks(page).nth(i));
    // Zero (nothing to choose) or two-plus (a real choice) — never one.
    expect(await radios.count()).not.toBe(1);
    expect(await checkboxes.count()).not.toBe(1);
    // The surface is a real modal now (REWORK-2026-07-29 D1), so its backdrop
    // owns every pointer event until it closes — the next block is not
    // clickable through it the way it was through the old non-modal popover.
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
  }

  // The retired "Vis alle grupper" button called setSelection([]), which is
  // groups.ts's encoding for "apply the programme default" — it narrowed the
  // week instead of widening it, exactly contradicting its label.
  await settingsFromBlock(page);
  await expect(settings.locator("button", { hasText: "Vis alle grupper" })).toHaveCount(0);
});

test("course settings: complementary lecture sessions are not offered as a choice", async ({
  page,
}) => {
  // TMA4401 publishes "Forelesning" (mandag + onsdag) and "Plenumsregning"
  // (fredag): two complementary weekly sessions, both classified as lectures,
  // both drawn. The count-only gate made them two checkboxes, inviting the
  // student to untick teaching they attend. The gate is now "is there anything
  // to switch TO", which is also why TMA4400 above keeps its picker.
  await page.goto("/planlegger/#26h;-;%2BTMA4401");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  await settingsFromBlock(page);
  const settings = page.locator("#planner-course-settings");
  await expect(settings).toBeVisible();
  await expect(settings.locator(".course-settings-groups")).toHaveCount(0);
  await expect(settings.locator(".course-settings-group-row")).toHaveCount(0);
  await expect(settings).not.toContainText("Plenumsregning");
});

test("one control opens studieinfo, and semester lives only inside it", async ({ page }) => {
  // The page used to carry three permanent openers for one modal — the
  // topbar chip, a banner "Endre" button, and the page title (silently a
  // button) — plus a "Bytt semester" disclosure duplicating the modal's own
  // semester select. Since REWORK-2026-07-30b the chip is not on this page at
  // all and "endre" in the hint line is the one that remains.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });

  await expect(page.locator("#planner-context-change")).toHaveCount(0);
  await expect(page.locator("#planner-semester")).toHaveCount(0);
  await expect(page.locator("#planner-title button")).toHaveCount(0);

  // The banner still STATES the term; it just no longer switches it. It is
  // part of the TITLE now — the plan is one string, in the notation a student
  // types — with the programme's own name demoted to the hint beside "endre".
  await expect(planTitle(page)).toHaveText("MTDT · 2026 · Høst 2026");
  await expect(page.locator("#planner-context-line")).toContainText("Datateknologi");

  // With a plan set, the week is a real grid — so no empty-state card is on
  // screen and "endre" is the only thing left that opens the modal.
  await expect(page.locator("#planner-grid-frame .planner-week-card")).toHaveCount(0);

  const dialog = page.locator("#studieinfo-dialog");
  await expect(dialog).toBeHidden();
  await editPlan(page).click();
  await expect(dialog).toBeVisible();
  await expect(page.locator("#studieinfo-semester-select")).toBeVisible();
});

test("week: three overlapping lectures stack into three lanes, no pile", async ({
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

  // REWORK-2026-07-29b D1: transposing the axes deletes the pile rather than
  // managing it. Three simultaneous lectures are three full-width bars stacked
  // in three lanes of Monday's row — vertical space is free, and a bar's width
  // is its duration rather than its share of a 150 px column.
  await expect(page.locator("#planner-grid-frame .planner-block")).toHaveCount(3, {
    timeout: 30_000,
  });
  await expect(page.locator(".planner-block-pile")).toHaveCount(0);
  for (const code of codes) {
    await expect(page.locator(".planner-block-code", { hasText: code })).toHaveCount(1);
  }

  // All three sit in Monday, each in its own lane — three distinct offsets.
  const monday = page.locator(".planner-grid-row").first();
  await expect(monday.locator(".planner-block")).toHaveCount(3);
  const bars = await monday.locator(".planner-block").all();
  const tops = await Promise.all(bars.map(async (b) => (await b.boundingBox())?.y ?? 0));
  expect(new Set(tops).size).toBe(3);

  // A three-way collision is ONE zone across the minutes they share, not three
  // competing marks — the mark belongs to the moment, not to any one course.
  await expect(monday.locator(".planner-clash-zone")).toHaveCount(1);

  // Each bar opens its own session popover, naming the slot it stands for.
  await page.locator("#planner-grid-frame .planner-block").first().click();
  const popover = page.locator("#planner-block-popover");
  await expect(popover).toBeVisible();
  await expect(popover.locator(".block-popover-clock")).toHaveText("08:15–10:00");

  // And the card says what the red zone behind it means: with three courses in
  // one slot the sentence names the OTHER two, and the shared minutes are the
  // whole session, so it does not repeat the clock two lines above it.
  const clash = popover.locator(".block-popover-clash");
  await expect(clash).toContainText("Kolliderer med");
  const clashText = (await clash.textContent()) ?? "";
  const named = codes.filter((code) => clashText.includes(code));
  expect(named).toHaveLength(2);
  expect(clashText).not.toContain("08:15");
});

test("session popover: the card names the building, the length and the collision", async ({
  page,
  context,
}) => {
  // The four facts the card used to leave out (REWORK-2026-07-30 "Kvittering"):
  // how long the session runs, which building the room is in, which minutes it
  // shares with what, and a button that says what pressing it does.
  // Stubbed, because all four have to be true of one specific slot.
  const lecture = (
    code: string,
    start: string,
    end: string,
    room: string,
    building: string,
    title: string,
  ) => ({
    courseCode: code,
    courseName: { nob: `${code} emne`, nno: null, eng: null },
    dayNumber: 1,
    startTime: start,
    endTime: end,
    weeks: ["34-47"],
    rooms: [{ building, room, url: null }],
    title,
    name: title,
  });
  await context.route("**/api/course/TDT4110/timetable*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        lecture("TDT4110", "14:15", "16:00", "F1", "IT-bygget, sydfløy", "Forelesning"),
      ]),
    }),
  );
  await context.route("**/api/course/TDT4120/timetable*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([
        lecture("TDT4120", "15:15", "17:00", "R1", "Realfagbygget", "Forelesning"),
      ]),
    }),
  );

  await page.goto("/planlegger/#26h;-;%2BTDT4110,%2BTDT4120");
  const bar = page.locator("#planner-grid-frame .planner-block", { hasText: "TDT4110" });
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await bar.click();

  const popover = page.locator("#planner-block-popover");
  await expect(popover).toBeVisible();
  await expect(popover.locator(".block-popover-code")).toHaveText("TDT4110");
  // The clock is the card's one large figure; the quiet line under it carries
  // the weekday, the length and the weeks.
  await expect(popover.locator(".block-popover-clock")).toHaveText("14:15–16:00");
  const meta = popover.locator(".block-popover-meta");
  await expect(meta).toContainText("mandag");
  await expect(meta).toContainText("1 t 45 min");
  await expect(meta).toContainText("uke 34–47");
  // "F1" is not a place you can walk to. The bar has no width for the building;
  // the card does.
  await expect(popover).toContainText("IT-bygget, sydfløy");
  // A partial overlap names the minutes the two really share: 15:15, not the
  // session's own 14:15.
  await expect(popover.locator(".block-popover-clash")).toHaveText(
    "Kolliderer med TDT4120 15:15–16:00.",
  );
  // One lecture, one group: there is no parallel to choose, so the verb offers
  // the course rather than promising a picker the modal would not show.
  await expect(popover.locator(".block-popover-edit")).toHaveText("Endre emnet");
});

test("week: Rutenett and Liste show the same week two ways", async ({ page }) => {
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  const bars = await gridBlocks(page).count();
  expect(bars).toBeGreaterThan(0);

  await page.click("#planner-view-tavle");
  await expect(page.locator(".planner-board")).toBeVisible();
  await expect(page.locator("#planner-view-tavle")).toHaveAttribute("aria-pressed", "true");
  // Same plan, same group narrowing, same øving toggle — so the same session
  // count. 57 rows against 7 bars is what shipped when the list ignored the
  // toggle and listed every published lab group.
  await expect(page.locator(".planner-board-row")).toHaveCount(bars);
  await expect(page.locator(".planner-grid")).toHaveCount(0);

  // A row opens the same session popover a bar does.
  await page.locator(".planner-board-row").first().click();
  await expect(page.locator("#planner-block-popover")).toBeVisible();
  await page.keyboard.press("Escape");

  // The choice survives a reload, because it is a preference rather than plan
  // state — it is deliberately NOT in the shared hash.
  await page.reload();
  await expect(page.locator(".planner-board")).toBeVisible({ timeout: 45_000 });

  await page.click("#planner-view-uke");
  await expect(page.locator(".planner-grid")).toBeVisible();
  await expect(page.locator(".planner-board")).toHaveCount(0);
});

test("liste: the collision marks the two sessions, not the day around them", async ({ page }) => {
  // The mark used to be a bracket on a wrapper every row of the day was
  // appended to, so one afternoon overlap drew a rule down the side of that
  // morning's lecture too — the marker claimed the day when it meant two
  // sessions.
  //
  // Friday, from live 2026 data: TDT4110's default parallel at 08:15–10:00
  // (clean), TDT4120's Forelesning at 12:15–15:00 and TMA4401's Plenumsregning
  // at 14:15–16:00 (the overlap). Monday and Wednesday carry TMA4401's two
  // Forelesning slots, so the week has five lecture rows and exactly one
  // collision.
  await page.goto("/planlegger/#26h;-;%2BTDT4110,%2BTDT4120,%2BTMA4401");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  expect(await settledVerdict(page)).toMatch(/1 kollisjon/);

  await page.click("#planner-view-tavle");
  const board = page.locator(".planner-board");
  await expect(board).toBeVisible();

  const rows = page.locator(".planner-board-row");
  const marked = page.locator(".planner-board-row.is-clashing");
  await expect(rows).toHaveCount(5);
  await expect(marked).toHaveCount(2);
  // The clean 08:15 lecture shares Friday with the pair and stays unmarked —
  // under the old wrapper it sat inside the bracket with them.
  await expect(marked.first()).toContainText("12:15");
  await expect(rows.first()).not.toHaveClass(/is-clashing/);

  const note = page.locator(".planner-board-clash-note");
  await expect(note).toHaveCount(1);
  await expect(note).toHaveText(/TDT4120 \/ TMA4401 overlapper|TMA4401 \/ TDT4120 overlapper/);
  // "Velg én" is gone: a student looking at two overlapping sessions does not
  // need to be told that overlapping sessions are a choice.
  await expect(note).not.toContainText("Velg");
});

test("modals: a click on the backdrop dismisses every one of them", async ({ page }) => {
  // Owner's call, 2026-07-30, reversing modals-7 — which had reasoned only
  // that no browser light-dismisses a showModal() dialog *by default*. The
  // implementation is `closedby="any"` on all three, so this is really a test
  // that the attribute is set and that nothing inside the card is sitting in
  // the dialog's own box swallowing the click.
  await page.goto("/planlegger/#26h;-;%2BTDT4110");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  // Well outside every card: all three are pinned near the top and none is
  // wider than 34rem, so the bottom-left corner is backdrop in each case.
  const backdrop = { x: 8, y: 8 };
  const viewport = page.viewportSize();
  if (viewport) backdrop.y = viewport.height - 8;

  for (const [name, open] of [
    ["#planner-add-dialog", () => page.click("#planner-add-course-btn")],
    ["#studieinfo-dialog", () => page.click("#planner-edit-plan")],
    ["#planner-course-settings", () => settingsFromBlock(page)],
  ] as const) {
    await open();
    const dialog = page.locator(name);
    await expect(dialog).toBeVisible();
    await page.mouse.click(backdrop.x, backdrop.y);
    await expect(dialog).toBeHidden();
  }
});

test("add dialog: the search field holds still while the results change", async ({ page }) => {
  // Centred (`margin: auto`), the card re-centred on every keystroke: empty
  // query → one status line, "tma" → twelve rows, "tma41" → three, and the
  // caret travelled up and down the screen while the student was still typing
  // into it. The dialog is pinned near the top instead, so it grows downward.
  await page.goto("/planlegger/");
  await page.click("#planner-add-course-btn");
  const dialog = page.locator("#planner-add-dialog");
  await expect(dialog).toBeVisible();

  const input = dialog.locator("input.add-course-input");
  const topOf = async () => (await input.boundingBox())?.y ?? -1;
  const resting = await topOf();
  expect(resting).toBeGreaterThan(0);

  for (const query of ["tma", "tma41", "tma4400", "x"]) {
    await input.fill(query);
    // Settle whichever branch this query lands on — rows, or a status line
    // over none — before measuring.
    await expect(dialog.locator(".add-course-status")).not.toBeEmpty({ timeout: 15_000 });
    expect(await topOf(), `"${query}" moved the search field`).toBe(resting);
  }
});

test("landing page: Nå answers with the room, not a course count", async ({ page }) => {
  // REWORK-2026-07-29b D3. The plan is seeded through the planner (the store is
  // per-origin localStorage), then the landing page is asked what it shows.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  await page.goto("/");
  const now = page.locator("#home-now");
  await expect(now).toBeVisible({ timeout: 45_000 });

  // A room, set as the display figure — never the old "5 emner" sentence.
  const room = page.locator("#home-now-room");
  await expect(room).not.toBeEmpty();
  const size = await room.evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThan(28);

  // The list under it has real columns. Built in JS, so a scoped Astro rule
  // would never reach it and the row would collapse to "ons 10:15EXPH0300".
  const rows = page.locator("#home-now-next li");
  if ((await rows.count()) > 0) {
    await expect(rows.first()).toHaveCSS("display", "grid");
  }

  // The page stops introducing itself once it has an answer.
  await expect(page.locator("#home-pitch")).toHaveClass(/is-secondary/);

  // The resume line still states whose plan this is. It used to be a
  // descendant of the pitch, which meant the pitch's own demotion set
  // `display: none` on it while its script was setting `hidden = false`: two
  // owners of one element's visibility, and the loser was the only place the
  // landing page names the plan now that the topbar chip is gone.
  const resume = page.locator("#home-resume");
  await expect(resume).toBeVisible();
  await expect(resume).toContainText("MTDT");
  await expect(resume).toContainText("emner");
  // The onward mark is a drawn glyph like every other link-out in the system,
  // not an arrow character sitting on the baseline in whatever face the text
  // fell back to.
  await expect(resume.locator("a svg")).toHaveCount(1);
  await expect(await resume.textContent()).not.toContain("→");
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

  // A note asks "which group is mine", which is an edit — so it opens the
  // picker directly, unlike a bar, which asks "what is this session".
  await notes.first().click();
  await expect(page.locator("#planner-course-settings")).toBeVisible();
  await expect(
    page.locator("#planner-course-settings .course-settings-group-row").first(),
  ).toBeVisible();
});

test("week: the øving toggle moves the layer and leaves nothing behind", async ({ page }) => {
  // REWORK-2026-07-29g. The toggle used to tear the week down and rebuild it
  // on one frame; it now travels what stays, strikes in what arrives and wipes
  // out what leaves. What can actually break in the field is the scaffolding:
  // a stuck `is-settling` freezes every bar's geometry mid-transition, and an
  // orphaned ghost is a bar that is not in the plan.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  const grid = page.locator("#planner-grid-frame .planner-grid");
  await expect(page.locator("#planner-grid-frame .planner-block").first()).toBeVisible({
    timeout: 45_000,
  });
  // Settled, not merely painted: the bundles land one by one and the bar
  // count is still climbing on the frame the first one appears.
  await expect(page.locator(".planner-grid-spine").first()).toBeVisible();
  await page.waitForTimeout(2_000);

  for (const view of ["uke", "tavle"] as const) {
    await page.click(view === "uke" ? "#planner-view-uke" : "#planner-view-tavle");
    const host = view === "uke" ? grid : page.locator(".planner-board");
    await expect(host).toBeVisible();
    const lectures = await page.locator("#planner-grid-frame .planner-block").count();

    await page.click("#planner-others-toggle");
    await expect(host).not.toHaveClass(/is-settling/, { timeout: 5_000 });
    await expect(page.locator(".planner-motion-ghost")).toHaveCount(0);

    await page.click("#planner-others-toggle");
    // Back to exactly the lectures we started from — the ghosts of the layer
    // that just left are gone, not merely invisible.
    await expect(host).not.toHaveClass(/is-settling|is-closing/, { timeout: 5_000 });
    await expect(page.locator(".planner-motion-ghost")).toHaveCount(0);
    if (view === "uke")
      await expect(page.locator("#planner-grid-frame .planner-block")).toHaveCount(lectures);
  }
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

test("catalog: a course that is not taught this year is grouped, not offered", async ({ page }) => {
  // crawler-3: TMA4100 and 702 others exist only in last year's catalog. Adding
  // one contributed nothing to the week and left the planner showing a raw
  // English "fikk ikke hentet detaljer: Not found". The page still exists — the
  // two-year union is why — so the row keeps its link and loses its verb.
  //
  // They now fold into one labelled group instead of interleaving: on
  // "matematikk" they took six of the first twelve rows and were
  // indistinguishable from addable ones. The group opens on its own when
  // there is nothing else to show, which is this query's case.
  await page.goto("/emner/?q=TMA4100");
  const fold = page.locator(".emner-fold-btn");
  await expect(fold).toBeVisible({ timeout: 15_000 });
  await expect(fold).toContainText("Ikke undervist i");
  await expect(fold).toHaveAttribute("aria-expanded", "true");

  const row = page.locator("#emner-results tr.emner-row", { hasText: "TMA4100" }).first();
  await expect(row).toBeVisible();
  await expect(row.locator('a[href="/emne/TMA4100/"]')).toHaveCount(1);
  await expect(row).toContainText("sist undervist");
  await expect(row.locator(".emner-row-add")).toHaveCount(0);

  // Collapsing is what the group is for: the rows go, the count stays.
  await fold.click();
  await expect(fold).toHaveAttribute("aria-expanded", "false");
  await expect(row).toBeHidden();
  await expect(fold).toContainText("Ikke undervist i");
});

test("catalog: the subject chips come from the query's own hits", async ({ page }) => {
  // 360 code prefixes across 5 470 courses is a wall nobody reads; the handful
  // that survive one query is a filter worth having. The counts are computed
  // before the narrowing, so pressing a chip does not renumber the others.
  await page.goto("/emner/?q=matematikk");
  const chips = page.locator("#emner-subjects .np-toggle");
  await expect(chips.first()).toBeVisible({ timeout: 15_000 });
  await expect(chips.first()).toHaveText(/^TMA/);

  const before = await chips.allTextContents();
  await chips.first().click();
  await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
  expect(await chips.allTextContents()).toEqual(before);

  // Every remaining row is a TMA row.
  const codes = await page.locator("#emner-results tr.emner-row .emner-code").allTextContents();
  expect(codes.length).toBeGreaterThan(0);
  for (const code of codes) expect(code).toMatch(/^TMA/);
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
  await editPlan(page).click();
  await expect(dialog).toBeVisible();
  await page.selectOption("#studieinfo-semester-select", "27v");
  await page.click("#studieinfo-save");
  await expect(dialog).toBeHidden();

  await expect(courseRows(page)).toHaveCount(0);

  await editPlan(page).click();
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

  await expect(planTitle(page)).toContainText("MTIØT · 2024");
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
  // REWORK-2026-07-29 D3: the row IS the control, and the verb is inside the
  // settings modal it opens — two taps, which the user explicitly allowed in
  // place of §0.3's one.
  const settings = page.locator("#planner-course-settings");
  const row = courseRows(page).filter({ hasText: code }).first();
  await courseSettingsBtn(page, code).click();
  await expect(settings).toBeVisible();
  await settings.locator(".course-settings-action", { hasText: "Dropp" }).click();

  // Still listed — a dropped programme course never disappears — but off the
  // grid, out of the credits, and marked in the shareable URL.
  await expect(row).toHaveClass(/is-dropped/);
  await expect(courseRows(page)).toHaveCount(5);
  await expect(gridBlocks(page).filter({ hasText: code })).toHaveCount(0);
  expect(page.url()).toContain(`-${code}`);

  await courseSettingsBtn(page, code).click();
  await settings.locator(".course-settings-action", { hasText: "Legg tilbake" }).click();
  await expect(gridBlocks(page).filter({ hasText: code }).first()).toBeVisible({
    timeout: 30_000,
  });
});

test("dropping from a block's settings keeps focus in the document", async ({ page }) => {
  // a11y-3, re-aimed: "Dropp" destroys the block that opened the surface, and
  // the old non-modal popover then called focus() on a detached node — a
  // silent no-op that dropped focus to <body> with nothing to catch it, so the
  // next Tab restarted at the skip link. `showModal()` restores focus to the
  // invoker itself, so the fix is now the platform's; this guards the outcome.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  const code = (await gridBlocks(page).first().locator(".planner-block-code").textContent())?.trim() ?? "";
  expect(code).not.toBe("");

  await settingsFromBlock(page);
  const settings = page.locator("#planner-course-settings");
  await settings.locator(".course-settings-action", { hasText: "Dropp" }).click();
  await expect(settings).toBeHidden();

  // Whatever opened the dialog is gone — the bar was replaced by the re-render
  // and the popover it opened was closed on the way through — so the browser's
  // own restore is a no-op. The course's own row is where focus lands, on the
  // settings button that reopens the dialog, so the undo is one keystroke away.
  const row = courseRows(page).filter({ hasText: code }).first();
  await expect(row).toHaveClass(/is-dropped/);
  await expect(courseSettingsBtn(page, code)).toBeFocused();
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

/**
 * The clock (REWORK-2026-07-30). A planner is a page people leave open, and
 * everything below is invisible to every other kind of test: the assertions
 * are about what the page says an hour or a day after it was rendered.
 *
 * Europe/Oslo is pinned because the fixtures below are wall-clock times in
 * NTNU's own timezone, and the CI container runs in UTC.
 */
test.describe("time passing", () => {
  test.use({ timezoneId: "Europe/Oslo" });

  test("the week follows the day across midnight", async ({ page }) => {
    // Wednesday of teaching week 36, mid-morning.
    await page.clock.install({ time: new Date("2026-09-02T10:40:00+02:00") });
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(page.locator("#planner-grid-frame .planner-block").first()).toBeVisible({
      timeout: 45_000,
    });
    const today = page.locator("#planner-grid-frame .planner-grid-row[data-today]");
    const marker = page.locator("#planner-grid-frame .planner-grid-now");
    await expect(today).toHaveAttribute("data-day", "3");

    // The ordinary minute may NOT re-render: the marker moves and nothing
    // else does. Rebuilding the week every 60 s would throw away the layer
    // motion, the scroll position and any open popover.
    const bar = await page.locator("#planner-grid-frame .planner-block").first().elementHandle();
    await page.clock.runFor("00:05:00");
    expect(await bar?.evaluate((el) => el.isConnected)).toBe(true);

    // Left open overnight. This kept Wednesday's spine at full ink and
    // Wednesday's row tinted while the now line had already stepped down into
    // Thursday — so the marker read as misplaced, because the highlight is
    // the louder signal and it was pointing at the wrong day.
    await page.clock.runFor("24:00:00");
    await expect(today).toHaveAttribute("data-day", "4");
    // The needle is on today's row or nowhere (REWORK-2026-07-30f), so its
    // being visible at all is the assertion that it followed the day.
    await expect(marker).toBeVisible();
    const rowTop = await page
      .locator('#planner-grid-frame .planner-grid-row[data-day="4"]')
      .evaluate((el: HTMLElement) => el.offsetTop);
    expect(await marker.evaluate((el) => el.style.getPropertyValue("--planner-now-top"))).toBe(
      `${rowTop}px`,
    );

    // The countdown to the next exam reads the date too, and was a day long
    // with it. It is a segment on the list's rule, not a cell in the row —
    // see the phone test below.
    const away = page.locator(".exam-gap.is-away").first();
    const days = (text: string | null) => Number(text?.match(/\d+/)?.[0] ?? Number.NaN);
    const after = days(await away.textContent());
    expect(Number.isFinite(after)).toBe(true);
    await page.clock.runFor("24:00:00");
    await expect(away).not.toHaveText(new RegExp(`\\b${after}\\b`));
    expect(days(await away.textContent())).toBe(after - 1);
  });

  test("the landing card counts its own minutes down", async ({ page }) => {
    // Monday of teaching week 36, 15 minutes into TMA4412's 08:15 lecture.
    await page.clock.install({ time: new Date("2026-08-31T08:30:00+02:00") });
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(page.locator("#planner-grid-frame .planner-block").first()).toBeVisible({
      timeout: 45_000,
    });

    await page.goto("/");
    const label = page.locator("#home-now-label");
    // A card labelled "Nå" was computed once and then left: it claimed the
    // minute it was rendered in for as long as the tab stayed open.
    await expect(label).toHaveText("Nå · 90 min igjen", { timeout: 45_000 });
    await page.clock.runFor("00:10:00");
    await expect(label).toHaveText("Nå · 80 min igjen");

    // And it hands over when the session ends rather than counting past it.
    await page.clock.runFor("02:00:00");
    await expect(label).toHaveText("Neste");
    await expect(page.locator("#home-now-bar")).toBeHidden();
  });
});

test.describe("the exam list on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("no exam row is taller than its neighbours", async ({ page }) => {
    // The countdown used to be a third cell of the row. At 390 px there is no
    // third column for it, so it dropped to a second grid row under the date:
    // exactly one row in the list stood two lines tall with a hole beside it
    // where the course would have been. It is a segment on the rule now — the
    // first link in the same chain the reading-day connectors continue.
    await page.goto("/planlegger/#26h;MTDT.2026;");
    const rows = page.locator(".exam-list .exam-row");
    await expect(rows.first()).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".exam-gap.is-away")).toHaveCount(1);

    // The countdown is a SIBLING of the rows, not inside one.
    expect(
      await page.locator(".exam-gap.is-away").evaluate((el) => el.closest(".exam-row") !== null),
    ).toBe(false);

    const heights = await rows.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().height)),
    );
    expect(heights.length).toBeGreaterThan(1);
    expect(new Set(heights).size, `exam rows differ in height: ${heights.join(", ")}`).toBe(1);

    // And the vurderingsform still shares the code's line — dropping the row's
    // unused third column is what gives it back the 16 px of gap it needs.
    const whatHeights = await page
      .locator(".exam-list .exam-what")
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(new Set(whatHeights).size).toBe(1);
  });
});

test("ett navn: the plan is named once, and the switch is not a third toggle", async ({ page }) => {
  // REWORK-2026-07-30b. Two faults, one test, because they share a cause —
  // controls and facts that looked like each other:
  //   01 the plan was named twice, 100 px apart (topbar chip + page title);
  //   02 Rutenett/Liste (a radio group) and Øvinger (a checkbox) were three
  //      identical uppercase mono `.np-toggle`s in a row.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  await expect(planTitle(page)).toHaveText("MTDT · 2026 · Høst 2026");
  await expect(page.locator("#studieinfo-chip")).toHaveCount(0);
  // Three topbar children on every page now (the ThemeToggle ships a <script>
  // beside its button, which is not one): wordmark, nav, toggle. The chip that
  // used to be the fourth, and to truncate against the wordmark at 390 px, is
  // deleted.
  await expect(page.locator(".site-topbar > *:not(script)")).toHaveCount(3);

  // The switch carries no fill and no box — its whole state is the rule under
  // the live word, and that rule MOVES rather than cross-fading.
  const tabs = page.locator(".planner-view-tabs");
  const ruleAt = () =>
    tabs.evaluate((el) => ({
      x: el.style.getPropertyValue("--view-x"),
      w: el.style.getPropertyValue("--view-w"),
    }));
  const atGrid = await ruleAt();
  expect(Number.parseFloat(atGrid.w)).toBeGreaterThan(0);
  // At the first tab, so at the container's own inline start (the tab carries
  // a negative inline margin, which is how its 24px target is bought without
  // widening the head — see a11y-8).
  expect(Number.parseFloat(atGrid.x)).toBeLessThanOrEqual(0);

  await page.click("#planner-view-tavle");
  await expect(page.locator(".planner-board").first()).toBeVisible();
  const atList = await ruleAt();
  expect(Number.parseFloat(atList.x)).toBeGreaterThan(0);
  // "Liste" is the shorter word — the rule is measured, not a fixed half.
  expect(Number.parseFloat(atList.w)).toBeLessThan(Number.parseFloat(atGrid.w));

  // And the layer control is a box you tick, not a fourth view: it has a
  // check mark of its own and never takes the pressed FILL the old toggle did.
  const others = page.locator("#planner-others-toggle");
  await expect(others.locator(".planner-check")).toHaveCount(1);
  await expect(others).toHaveAttribute("aria-pressed", "false");
  await others.click();
  await expect(others).toHaveAttribute("aria-pressed", "true");
});

test.describe("target sizes", () => {
  /**
   * WCAG 2.5.8 Target Size (Minimum), AA: every pointer target is at least
   * 24x24 CSS px. It shipped with six controls under it — the view switch and
   * the layer tickbox at 21px tall, "endre" at 22, the margin notes at 21, the
   * modal's course-page link at 21 and the footer's catalog link at 18 — and
   * nothing could see them (a11y-8). This can.
   */
  const MIN = 24;

  const undersized = (page: Page) =>
    page.evaluate((min) => {
      const SEL =
        'a[href], button, input:not([type="hidden"]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), [role="button"]';
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll(SEL))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") continue;
        if (r.width >= min && r.height >= min) continue;
        out.push(
          `${Math.round(r.width)}x${Math.round(r.height)} ${el.tagName.toLowerCase()}.${(el.className || "").toString().split(/\s+/)[0]}#${el.id}`,
        );
      }
      return out;
    }, MIN);

  for (const [label, width, height] of [
    ["desktop", 1440, 900],
    ["phone", 390, 844],
  ] as const) {
    test(`every target on the planner clears ${MIN}px — ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/planlegger/#26h;MTDT.2026;");
      await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
      expect(await undersized(page)).toEqual([]);

      // The øving layer brings the margin notes with it, and the list view
      // swaps the whole week for rows — both add targets the grid has not.
      await page.locator("#planner-others-toggle").click();
      await expect(page.locator(".planner-note-groups").first()).toBeVisible();
      expect(await undersized(page)).toEqual([]);

      await page.locator("#planner-view-tavle").click();
      await expect(page.locator(".planner-board").first()).toBeVisible();
      expect(await undersized(page)).toEqual([]);
    });
  }
});

test("a clean plan says nothing about provenance", async ({ page }) => {
  // The counterpart to the failure test above. This line used to read
  // "Timeplan hentet direkte fra NTNU nå · eksamensdatoer fra katalogen
  // (hentet 28. jul 2026) · studieplan for kull 2026. Uoffisiell." on every
  // render — under a week that visibly worked, on a page whose footer already
  // carries the crawl date and the caveat. DR-8 asks the join to admit its
  // gaps, not to announce that it has none (REWORK-2026-07-30e).
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await expect(settledVerdict(page)).resolves.toMatch(/kollisjon/);
  await expect(page.locator("#planner-provenance")).toBeHidden();
});

test.describe("nålen", () => {
  test.use({ timezoneId: "Europe/Oslo" });

  test("is on today's row inside the drawn hours, and nowhere else", async ({ page }) => {
    // REWORK-2026-07-30f. Two states, not four: on the row at a minute, or
    // absent. The faint week-wide hairline it replaces was a 1px line among
    // 1px hour rules — the same KIND of mark as the ruling it crossed — so on
    // any day that was not today it could not be found at all.
    const marker = page.locator("#planner-grid-frame .planner-grid-now");

    // Tuesday of teaching week 36, inside EXPH0300's 08:15 lecture.
    await page.clock.install({ time: new Date("2026-09-01T09:05:00+02:00") });
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
    await expect(marker).toBeVisible();

    // It spans exactly today's row, so the head lands on that row's top border.
    const row = page.locator('#planner-grid-frame .planner-grid-row[data-day="2"]');
    const [top, height] = await row.evaluate((el: HTMLElement) => [el.offsetTop, el.offsetHeight]);
    const style = await marker.evaluate((el) => ({
      t: el.style.getPropertyValue("--planner-now-top"),
      h: el.style.getPropertyValue("--planner-now-height"),
    }));
    expect(style).toEqual({ t: `${top}px`, h: `${height}px` });

    // Past the drawn hours: gone. A week clamped to its own sessions has no
    // honest place to put 21:10, and this is not a clock.
    await page.clock.setFixedTime(new Date("2026-09-01T21:10:00+02:00"));
    await page.clock.runFor("01:00");
    await expect(marker).toBeHidden();

    // Saturday: gone. There is no today row to be on.
    await page.clock.setFixedTime(new Date("2026-09-05T11:40:00+02:00"));
    await page.clock.runFor("01:00");
    await expect(marker).toBeHidden();
  });

  test("every bar is centred in its row", async ({ page }) => {
    // `--planner-lane-h` is a stride (bar + gap), so N lanes occupy N strides
    // LESS one trailing gap. Without that subtraction a one-lane row measured
    // 46px around a 28px bar sitting 6px down: 6 above, 12 below, every row in
    // the week off-centre — and the row's real height is max(spine, field),
    // which the spine won, so no amount of padding could have fixed it.
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    const gaps = await page.evaluate(() =>
      Array.from(document.querySelectorAll("#planner-grid-frame .planner-grid-row")).flatMap((row) => {
        const field = row.querySelector(".planner-grid-field") as HTMLElement;
        const fr = field.getBoundingClientRect();
        return Array.from(field.querySelectorAll(".planner-block")).map((bar) => {
          const r = bar.getBoundingClientRect();
          return {
            band: bar.classList.contains("is-band"),
            above: Math.round(r.top - fr.top),
            below: Math.round(fr.bottom - r.bottom),
          };
        });
      }),
    );
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      // A lane bar sits one pad from the top; a band sits one pad from the
      // bottom. Whichever it is, its own side must be the pad exactly.
      expect(g.band ? g.below : g.above).toBe(8);
    }
    // And with one lane and no band the two ends match, which is the claim.
    const single = gaps.filter((g) => !g.band && g.below === 8);
    expect(single.length).toBeGreaterThan(0);
  });
});

test("the layer leaves in the reverse of the order it arrived in", async ({ page }) => {
  // REWORK-2026-07-30g. The sequence was already mirrored — space opens, then
  // bars arrive; bars leave, then space closes — but the STAGGER was not:
  // arrivals struck in one after another in reading order while departures all
  // vanished on the same frame. That is not the reverse of an order, it is the
  // absence of one.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  const indices = (selector: string, prop: string) =>
    page.evaluate(
      ([sel, p]) =>
        Array.from(document.querySelectorAll(`#planner-grid-frame ${sel}`)).map((el) =>
          Number((el as HTMLElement).style.getPropertyValue(p)),
        ),
      [selector, prop] as const,
    );

  await page.locator("#planner-others-toggle").click();
  const arrive = await indices(".planner-block.is-arriving", "--planner-arrive");
  expect(arrive.length).toBeGreaterThan(1);
  // Reading order, ascending: 0, 1, 2 …
  expect(arrive).toEqual([...arrive].sort((a, b) => a - b));
  await page.waitForTimeout(1400);

  await page.locator("#planner-others-toggle").click();
  const depart = await indices(".planner-motion-ghost", "--planner-depart");
  expect(depart.length).toBe(arrive.length);
  // The same reading order, DESCENDING: the last bar to land is the first to go.
  expect(depart).toEqual([...depart].sort((a, b) => b - a));
  expect(Math.max(...depart)).toBe(depart.length - 1);
});

test("the row height animates with the layer instead of snapping", async ({ page }) => {
  // REWORK-2026-07-30h. `--planner-bands` feeds the field's min-height and was
  // never added to the motion snapshot, so a row whose height changed only
  // because a drop-in strip appeared or left had nothing rewound: the new
  // height was already in place before the transition was switched on. The row
  // snapped on the first frame while every bar around it animated.
  //
  // TDT4120 publishes Øvingsveiledning 08:15-14:00 every weekday, which is
  // exactly that case: revealing the layer adds a strip and grows the row.
  await page.goto("/planlegger/#26h;-;%2BTDT4120,%2BTMA4412");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await page.locator("#planner-others-toggle").click();
  await expect(page.locator(".planner-note-groups").first()).toBeVisible({ timeout: 20_000 });
  await page.locator(".planner-note-groups").first().click();
  const groups = page.locator("#planner-course-settings .course-settings-group-row");
  await expect(groups.first()).toBeVisible();
  for (const row of await groups.all()) await row.locator("input").check();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);

  const rowH = () =>
    page
      .locator("#planner-grid-frame .planner-grid-row")
      .first()
      .evaluate((el: HTMLElement) => Math.round(el.getBoundingClientRect().height));

  const tall = await rowH();

  // Hiding: the row must still be tall while the bars are wiping out, and
  // short once everything has settled.
  await page.locator("#planner-others-toggle").click();
  await page.waitForTimeout(120);
  expect(await rowH()).toBe(tall);
  await page.waitForTimeout(1200);
  const short = await rowH();
  expect(short).toBeLessThan(tall);

  // Revealing: the space opens FIRST, so the row is already growing at 120 ms
  // — but it has not arrived, which is what proves it is a transition and not
  // a snap.
  await page.locator("#planner-others-toggle").click();
  await page.waitForTimeout(60);
  const midway = await rowH();
  expect(midway).toBeGreaterThan(short);
  expect(midway).toBeLessThan(tall);
});

test("the list's own height animates too, so nothing under it jumps", async ({ page }) => {
  // REWORK-2026-07-30i. The week animates `min-height` per row, so its total
  // height follows. A list has no such property: rows are in normal flow, so
  // removing them makes the container short on the frame the render lands, and
  // the exam list and the course list underneath jump before a single row has
  // moved. FLIP cannot carry it — a translated row still occupies its original
  // box as far as layout is concerned.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await page.locator("#planner-view-tavle").click();
  const board = page.locator("#planner-grid-frame .planner-board");
  await expect(board).toBeVisible();
  await page.waitForTimeout(900);

  const h = () => board.evaluate((el: HTMLElement) => Math.round(el.getBoundingClientRect().height));
  const short = await h();

  // Revealing: the space opens first, so the box is already growing but has
  // not arrived. Both halves matter — "already growing" rules out a stall,
  // "not arrived" rules out the snap.
  await page.locator("#planner-others-toggle").click();
  await page.waitForTimeout(70);
  const growing = await h();
  expect(growing).toBeGreaterThan(short);
  await page.waitForTimeout(1200);
  const tall = await h();
  expect(growing).toBeLessThan(tall);

  // Hiding: the box holds while the rows wipe out, then closes behind them.
  await page.locator("#planner-others-toggle").click();
  await page.waitForTimeout(70);
  expect(await h()).toBe(tall);
  await page.waitForTimeout(1200);
  expect(await h()).toBe(short);

  // And the pin comes off, or the list would stop growing with its own content.
  await expect
    .poll(() => board.evaluate((el: HTMLElement) => el.style.height), { timeout: 3000 })
    .toBe("");
});

test.describe("the banner's pair", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the code and the programme name stay adjacent on a phone", async ({ page }) => {
    // REWORK-2026-07-30j. `MTDT · 2026 · Høst 2026` and `Datateknologi –
    // master (5-årig)` are one statement said twice, short then long. The
    // wrapping flex row put the verdict and the Endre button between them, so
    // the plan's name was separated from its own code by a green sentence and
    // a button. Grid areas keep the pair together at every width.
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    const box = (sel: string) =>
      page.locator(sel).evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      });
    const title = await box("#planner-title");
    const hint = await box("#planner-context-line");
    const verdict = await box("#planner-grid-status");
    const edit = await box("#planner-edit-plan");

    // Nothing fits between them.
    expect(hint.top - title.bottom).toBeLessThan(16);
    // And both of the things that used to are below the pair, not inside it.
    expect(verdict.top).toBeGreaterThanOrEqual(hint.bottom);
    expect(edit.top).toBeGreaterThanOrEqual(verdict.bottom);
  });
});

test("the week is not labelled 'Uke', but the region still has that name", async ({ page }) => {
  // A grid of weekdays under an hour ruler does not need to be told it is a
  // week. The heading stays in the tree because the section is named by it.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  const heading = page.locator("#planner-week-heading");
  await expect(heading).toHaveText("Uke");
  expect(await heading.evaluate((el: HTMLElement) => el.getBoundingClientRect().width)).toBeLessThan(
    2,
  );
  await expect(page.locator("#planner-region-week")).toHaveAttribute(
    "aria-labelledby",
    "planner-week-heading",
  );
});
