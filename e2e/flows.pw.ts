import type { Page } from "@playwright/test";
import { expect, test } from "./harness.js";

/**
 * The modal-first flow, end to end against live NTNU data. Every scenario
 * drives the studieinfo `<dialog>` or seeds the plan via the shareable hash —
 * the two ways a plan is ever set. Tests ABOUT the modal drive it for real;
 * tests about something else navigate straight to a hash, since `parsePlanHash`
 * + `loadPeriodCourses` reproduce exactly what Lagre would have written.
 *
 * Live-data facts the assertions lean on (verified against the running worker):
 * MTDT kull 2026 period 1 is 5 rows; TDT4109's only lecture collides with
 * TDT4120's on Friday; TDT4110's three numbered parallels default to parallel 1
 * with no programme; TMA4400's "Forelesning 2 MTBYGG" is a cross-programme
 * parallel an MTDT student can pick; MTDT kull 2024 at 26h is gated behind
 * "Valg av studieretning"; BSPL kull 2026 behind a campus choice coded
 * "BSPL26-V-GJØVIK".
 */

const courseRows = (page: Page) => page.locator("#planner-course-rows .planner-course-row");

/**
 * Opens a course's settings the way the UI does: a bar opens the READ popover,
 * and its one verb is the way through to the editor. The verb is targeted by
 * class, not by text — it names its outcome for the clicked session's layer, so
 * which word it is depends on the course.
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
/**
 * A drawn session in the planner's week. `#planner-grid-frame` is
 * /planlegger/'s own id, and the planner draws Uke — the transposed grid's
 * `.planner-block` survives on /emne/[code]/, whose frame carries the class but
 * no id, and the two course-page tests below address it there directly.
 *
 * A helper rather than a literal because ~45 call sites go through it, and
 * they did once already: as `.planner-block` alone it was 28 of the 46 e2e
 * failures dropping Rader caused.
 */
const gridBlocks = (page: Page) => page.locator("#planner-grid-frame .planner-cols-block");

/** The course code printed on the first drawn session. */
const firstBlockCode = async (page: Page): Promise<string> =>
  (await gridBlocks(page).first().locator(".planner-cols-code").textContent())?.trim() ?? "";

/**
 * The planner names the plan in its own title, so there is no topbar chip
 * there: `#planner-title` is where "whose plan is this" is asserted on this
 * page. The chip is still the assertion on every other page.
 */
const planTitle = (page: Page) => page.locator("#planner-title");
const editPlan = (page: Page) => page.locator("#planner-edit-plan");
const editPlanLabel = (page: Page) => page.locator("#planner-edit-plan-label");

/**
 * Waits for `#planner-grid-status` to settle and returns it, failing loudly if
 * the plan's data never arrived.
 *
 * The verdict has THREE states: a clash count, the green clean state, and a
 * muted "kan ikke sjekkes" when a timetable fetch failed. That third state
 * means an upstream flake shows up as a *missing* verdict rather than a wrong
 * one — a test matching only `/\d+ kollisjon/` would time out and report the
 * clash engine as broken.
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
/**
 * The codes in the course rail. `.planner-course-code`, not the swatch beside
 * it: the hue and the code used to be one printed chip, and are two things now
 * — the same dot the exam list and Liste use, plus the code in ink.
 */
function courseCodesOf(page: Page): Promise<string[]> {
  return page.locator("#planner-course-rows .planner-course-code").allTextContents();
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
  await expect(planTitle(page)).toHaveText("MTDT Kull 24 H26");
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
  // A program-less shared link opened in the SAME context must clear the stored
  // profile — savePlan can only ever WRITE np:profile, never clear it, so
  // without removeProgram the header chip kept naming the old programme.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(planTitle(page)).toContainText("MTDT", { timeout: 30_000 });

  // A different-path hop first guarantees a real document load, so the initial
  // hash-load path runs. The proof the profile is genuinely stored rather than
  // held in memory is the planner reading it back after the hop.
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

test("overlap: two colliding courses take a lane each, both readable", async ({ page }) => {
  // MTDT 2026's obligatory TDT4109 collides with a manually added TDT4120 —
  // the exact clash the old suite's clash-preview (ekstraemne) test verified.
  await page.goto("/planlegger/#26h;MTDT.2026;%2BTDT4120");
  await expect(courseRows(page)).toHaveCount(6, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  // `\d+ kollisjon`, never a bare /kollisjon/ which "ingen kollisjoner" also
  // matches. `settledVerdict` separates that from "kan ikke sjekkes", which
  // says nothing about the engine.
  expect(await settledVerdict(page)).toMatch(/\d+ kollisjon/);

  // Only the two colliding blocks carry "kolliderer med" in their aria-label.
  const clashBlocks = page.locator('.planner-cols-block[aria-label*="kolliderer med"]');
  await expect(clashBlocks).toHaveCount(2, { timeout: 30_000 });

  // A lane each, and neither is drawn on top of the other — the fault this
  // guards is two colliding sessions sharing one lane and hiding one of them.
  // Each still carries its code, which is the floor a split column must clear.
  const blocks = await clashBlocks.all();
  const lanes = new Set<string>();
  for (const block of blocks) {
    lanes.add(await block.evaluate((el) => el.style.getPropertyValue("--planner-lane")));
    const code = block.locator(".planner-cols-code");
    expect(((await code.textContent()) ?? "").trim()).not.toBe("");
    // Readable, which for a split column means the code is not clipped: a lane
    // narrower than the course code on it is the failure THE WIDTH LAW exists
    // to prevent, and a collision is where a column is at its narrowest.
    expect(
      await code.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
  }
  expect(lanes.size).toBe(2);

  // And exactly one mark stands over the minutes they share.
  await expect(page.locator(".planner-cols-clash")).toHaveCount(1);
});

test("verdict: a failed timetable fetch refuses the check instead of clearing it", async ({
  page,
}) => {
  // With 4 of 5 timetables fine and one 503, the week drew a normal grid and
  // the status said "ingen kollisjoner" in Green-Means-Fits accent — a
  // confident answer to PRODUCT §1's only question, computed over data it never
  // had. `--verdict` green is the only thing on the page still coloured by an
  // outcome, so a false green is the loudest lie it can tell.
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
  // the check could not see. It is silent on a clean plan,
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
  // With a programme set, the grid used to pre-narrow every timetable to that
  // programme's sections BEFORE the group filter ran, so an explicit pick of a
  // parallel tagged for ANOTHER programme was stripped and the block vanished
  // silently. TMA4400's "Forelesning 2 MTBYGG" is exactly that parallel.
  const tmaBlocks = () => gridBlocks(page).filter({ hasText: "TMA4400" });
  // The picked session, addressed by its own aria-label rather than by
  // position: since a lecture pick answers only its own session
  // family, so the week keeps two other TMA4400 sessions and blocks are
  // appended day-major, which makes `.first()` the Tuesday block.
  const mtbyggBlock = () =>
    // Two attribute matches rather than one prefix: the column block's
    // accessible name carries the activity between the code and the slot
    // ("TMA4400 Forelesning 2 MTBYGG, onsdag 08:15–…"), which is the point of
    // this test, so the slot cannot be matched as a prefix.
    page.locator(
      '#planner-grid-frame .planner-cols-block[aria-label^="TMA4400"][aria-label*="onsdag 08:15"]',
    );

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
  // lecture whose group the student had not also named.
  expect(await tmaBlocks().count()).toBeGreaterThan(1);

  await page.reload();
  await expect(mtbyggBlock()).toHaveCount(1, { timeout: 45_000 });
  expect(await tmaBlocks().count()).toBeGreaterThan(1);
});

test("groups: the picker lists this semester's groups, not the whole year's", async ({ page }) => {
  // EXPH0300 publishes 36 seminar groups and 5 lecture parallels across three
  // cities over a full year, and the picker listed all 44 — on a phone that put
  // its own actions ~1 000 px below the fold behind another city's seminars.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  const exphBlock = gridBlocks(page).filter({ hasText: "EXPH0300" }).first();
  await expect(exphBlock).toBeVisible({ timeout: 45_000 });
  await settingsFromBlock(page, exphBlock);

  const settings = page.locator("#planner-course-settings");
  const groupRows = settings.locator(".course-settings-group-row");

  // Every Ålesund session of this course is taught in weeks 3-17, so none of it
  // belongs to a Høst plan. The picker is built from the SEMESTER's entries.
  await expect(
    settings.locator(".course-settings-group-row", { hasText: "Ålesund" }),
  ).toHaveCount(0);
  // A bound, not an exact count: the number depends on live tagging, so this
  // pins the order of magnitude — a revert to "every group the course publishes
  // all year" fails it, and the lower bound catches a narrowing that ate the
  // whole picker.
  const rowCount = await groupRows.count();
  expect(rowCount).toBeGreaterThan(0);
  expect(rowCount).toBeLessThan(30);

  // The LECTURE layer is deliberately NOT narrowed by programme: picking a
  // parallel tagged for another programme or campus is a documented capability,
  // and this picker is the only control that can exercise it.
  await expect(
    settings.locator(".course-settings-group-row", { hasText: "Forelesningsparallell 3 Gjøvik" }),
  ).toHaveCount(1);
});

test("course settings: closes from its own button, not just Esc", async ({ page }) => {
  // `showModal()` gives Esc and a backdrop back, but the × stays: on touch
  // there is no Esc, and a backdrop tap is not a gesture to guess at.
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
  // kinds, so a course with one parallel and two øving groups drew a lone dead
  // radio. The invariant is per-kind and data-independent.
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
    // The surface is a real modal now, so its backdrop
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
  // TMA4401 publishes two complementary weekly sessions, both classified as
  // lectures, both drawn. The count-only gate made them two checkboxes,
  // inviting the student to untick teaching they attend. The gate is now "is
  // there anything to switch TO".
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
  // The page used to carry three permanent openers for one modal plus a "Bytt
  // semester" disclosure duplicating the modal's own select. "endre" in the
  // hint line is the one that remains.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });

  await expect(page.locator("#planner-context-change")).toHaveCount(0);
  await expect(page.locator("#planner-semester")).toHaveCount(0);
  await expect(page.locator("#planner-title button")).toHaveCount(0);

  // The banner still STATES the term; it just no longer switches it. It is part
  // of the TITLE now, with the programme's own name demoted to the hint.
  await expect(planTitle(page)).toHaveText("MTDT Kull 26 H26");
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

  // Lanes delete the pile rather than managing it: three simultaneous lectures
  // are three blocks side by side in Monday's column, each still naming itself.
  await expect(gridBlocks(page)).toHaveCount(3, { timeout: 30_000 });
  await expect(page.locator(".planner-block-pile")).toHaveCount(0);
  for (const code of codes) {
    await expect(page.locator(".planner-cols-code", { hasText: code })).toHaveCount(1);
  }

  // All three sit in Monday, each in its own lane — three distinct offsets
  // along the axis the lanes divide, which is the horizontal one here.
  const monday = page.locator('.planner-cols-day[data-day="1"]');
  await expect(monday.locator(".planner-cols-block")).toHaveCount(3);
  const bars = await monday.locator(".planner-cols-block").all();
  const lefts = await Promise.all(bars.map(async (b) => (await b.boundingBox())?.x ?? 0));
  expect(new Set(lefts).size).toBe(3);

  // A three-way collision is ONE mark across the minutes they share, not three
  // competing ones — the mark belongs to the moment, not to any one course.
  await expect(monday.locator(".planner-cols-clash")).toHaveCount(1);

  // Each block opens its own session popover, naming the slot it stands for.
  await gridBlocks(page).first().click();
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
  // The four facts the card used to leave out: how long the session runs, which
  // building the room is in, which minutes it shares with what, and a button
  // that says what pressing it does. Stubbed, because all four have to be true
  // of one specific slot.
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
  const bar = gridBlocks(page).filter({ hasText: "TDT4110" });
  await expect(bar).toBeVisible({ timeout: 30_000 });
  await bar.click();

  const popover = page.locator("#planner-block-popover");
  await expect(popover).toBeVisible();
  // The title names the SESSION: the code, the course beside it, and the
  // activity under it — "which of this course's five sessions is this" is the
  // one thing the block itself has no width to say.
  await expect(popover.locator(".block-popover-code")).toContainText("TDT4110");
  await expect(popover.locator(".block-popover-course")).toHaveText(
    "Informasjonsteknologi, grunnkurs",
  );
  await expect(popover.locator(".np-head-sub")).toHaveText("Forelesning");
  // Labelled rows, so a short string that is a PLACE is not left looking like a
  // short string that is an activity.
  const when = popover.locator(".block-popover-when");
  await expect(when).toContainText("mandag");
  await expect(popover.locator(".block-popover-clock")).toHaveText("14:15–16:00");
  const meta = popover.locator(".block-popover-meta");
  await expect(meta).toContainText("1 t 45 min");
  await expect(meta).toContainText("uke 34–47");
  await expect(popover.locator(".block-popover-row dt").first()).toHaveText("Tid");
  await expect(popover.locator(".block-popover-row dt").nth(1)).toHaveText("Sted");
  // "F1" is not a place you can walk to. The block has no width for the
  // building; the card does.
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

test("week: Uke and Liste show the same week two ways", async ({ page }) => {
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  // Uke is what a cold load draws, so the tab is pressed before anything is
  // clicked — the page and `loadWeekView` have to agree about that or the CLS
  // reservation is for a view the frame is not about to fill.
  await expect(page.locator("#planner-view-kolonner")).toHaveAttribute("aria-pressed", "true");
  const columns = page.locator("#planner-grid-frame .planner-cols");
  await expect(columns).toBeVisible();
  // Blocks AND strips: a drop-in window is a session the list owes the week
  // too, so counting only the lanes would let either view quietly drop every
  // open øvingsvindu and still look equal to the other.
  const sessions = await page.locator(".planner-cols-block, .planner-cols-band").count();
  expect(sessions).toBeGreaterThan(0);
  // The transposed grid is /emne/[code]/'s alone now; the planner never draws
  // it, in either view.
  await expect(page.locator(".planner-grid")).toHaveCount(0);
  // Five weekday columns, each headed by its own day.
  await expect(page.locator(".planner-cols-day")).toHaveCount(5);
  // Three letters on the page, the whole word in the accessibility tree: the
  // column is too narrow for "mandag" and "man" is not a thing a screen reader
  // can expand, so the header carries both.
  const monHead = page.locator(".planner-cols-day-header").first();
  await expect(monHead.locator(".planner-cols-dow")).toHaveText("man");
  await expect(monHead.locator(".planner-cols-dow-long")).toHaveText("mandag");

  // THE WIDTH LAW: no block is ever narrower than the course code it carries.
  // This is the whole reason the view exists; a track that shrank below its
  // `minmax` minimum would break every code in the week at once.
  const narrowest = await page
    .locator(".planner-cols-block")
    .evaluateAll((nodes) => Math.min(...nodes.map((n) => n.getBoundingClientRect().width)));
  // The code's TEXT, measured with a range: the span is a stretched flex item,
  // so `scrollWidth` would hand back the block's own width and the assertion
  // would compare a number to itself.
  const codeWidth = await page.locator(".planner-cols-code").evaluateAll((nodes) =>
    Math.max(
      ...nodes.map((n) => {
        const range = document.createRange();
        range.selectNodeContents(n);
        return range.getBoundingClientRect().width;
      }),
    ),
  );
  // + the block's own 6 px of padding on each side: the floor is the code
  // WITH its air, not the code pressed against two walls.
  expect(narrowest).toBeGreaterThanOrEqual(codeWidth + 12);

  // A block opens the session popover.
  await page.locator(".planner-cols-block").first().click();
  await expect(page.locator("#planner-block-popover")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.click("#planner-view-tavle");
  await expect(page.locator(".planner-board")).toBeVisible();
  await expect(page.locator("#planner-view-tavle")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#planner-view-kolonner")).toHaveAttribute("aria-pressed", "false");
  // Same plan, same group narrowing, same øving toggle — so the same session
  // count. 57 rows against 7 blocks is what shipped when the list ignored the
  // toggle and listed every published lab group.
  await expect(page.locator(".planner-board-row")).toHaveCount(sessions);
  await expect(page.locator(".planner-grid")).toHaveCount(0);
  await expect(page.locator(".planner-cols")).toHaveCount(0);

  // A row opens the same session popover a block does.
  await page.locator(".planner-board-row").first().click();
  await expect(page.locator("#planner-block-popover")).toBeVisible();
  await page.keyboard.press("Escape");

  // The choice survives a reload, because it is a preference rather than plan
  // state — it is deliberately NOT in the shared hash.
  await page.reload();
  await expect(page.locator(".planner-board")).toBeVisible({ timeout: 45_000 });

  await page.click("#planner-view-kolonner");
  await expect(columns).toBeVisible();
  await expect(page.locator(".planner-board")).toHaveCount(0);
});

test("kolonner: the week is dealt out in whole days at every width", async ({ page }) => {
  // THE WIDTH LAW's third clause. `minmax(daymin, 1fr)` got the two ends right
  // and the middle wrong: between "all five fit" and "properly a scroller" the
  // frame closed mid-column and a strip of Friday hung past the edge. The count
  // of days is floored now, so the scroll only ever hides whole ones.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await page.click("#planner-view-kolonner");
  await expect(page.locator("#planner-grid-frame .planner-cols")).toBeVisible();

  /**
   * Where every day column sits against the visible day region, at one scroll
   * offset and one week depth.
   *
   * `--planner-lanes-max` is forced rather than seeded with a deep enough plan:
   * it is the only input the law has, and MTDT's own autumn is one lane deep, so
   * live data would ask the question only on a phone.
   */
  const measure = (toEnd: boolean, lanes: number) =>
    page.evaluate(
      ([end, deep]: [boolean, number]) => {
        const frame = document.getElementById("planner-grid-frame") as HTMLElement;
        const cols = frame.querySelector(".planner-cols") as HTMLElement;
        // Re-applied per measurement: crossing the 40 rem boundary re-renders
        // the week, and the render writes this property itself.
        cols.style.setProperty("--planner-lanes-max", String(deep));
        // A fixed offset rather than whatever `scrollToToday` left behind: the
        // law has to hold at rest AND scrolled, and those are two measurements.
        frame.scrollTo({ left: end ? frame.scrollWidth : 0, behavior: "instant" });
        const rail = frame.querySelector(".planner-cols-rail") as HTMLElement;
        const box = frame.getBoundingClientRect();
        // The rail is pinned, so the days are read in the space left of its
        // right edge; `clientWidth` is the scrollport, which for this view IS
        // the content box (the frame drops its inline padding — planner-week.css).
        const region = {
          left: box.left + rail.getBoundingClientRect().width,
          right: box.left + frame.clientWidth,
        };
        const days = Array.from(frame.querySelectorAll(".planner-cols-day")).map((node) => {
          const rect = node.getBoundingClientRect();
          return { left: rect.left, right: rect.right, width: rect.width };
        });
        return { region, days, maxScroll: frame.scrollWidth - frame.clientWidth };
      },
      [toEnd, lanes] as [boolean, number],
    );

  // Wide enough for the whole week down to a phone, crossing every quantum
  // boundary — the widths BETWEEN the breakpoints are the ones the old law got
  // wrong. Each at three week depths, because the depth decides where those
  // boundaries fall.
  const widths = [1400, 1180, 1040, 960, 880, 820, 760, 700, 640, 560, 480, 414, 360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    for (const lanes of [1, 2, 3]) {
      for (const toEnd of [false, true]) {
        const { region, days, maxScroll } = await measure(toEnd, lanes);
        const at = `${width} px, ${lanes} lanes${toEnd ? ", scrolled to the end" : ""}`;
        expect(days.length, at).toBeGreaterThan(0);

        // Every day is the same width — the fair share of what is on screen,
        // not of what the week would like.
        const track = days[0]?.width ?? 0;
        for (const day of days) expect(Math.abs(day.width - track), at).toBeLessThan(1);

        // …and each one is either wholly inside the visible region or wholly
        // out of it. A day straddling either edge is the regression.
        for (const day of days) {
          const cutRight = day.left < region.right - 1 && day.right > region.right + 1;
          const cutLeft = day.right > region.left + 1 && day.left < region.left - 1;
          expect(cutRight, `${at}: a day is cut by the frame's right edge`).toBe(false);
          expect(cutLeft, `${at}: a day is cut off behind the hour rail`).toBe(false);
        }

        // The same fact stated from the scroll's side: what is hidden is a
        // whole number of days, so there is no scroll at all until one drops.
        const inDays = maxScroll / track;
        expect(Math.abs(inDays - Math.round(inDays)), `${at}: ${maxScroll}px hidden`).toBeLessThan(
          0.05,
        );
      }
    }
  }
});

test("uke: an open øvingsvindu names itself, opens, and stacks", async ({ page }) => {
  // The window shipped as 8 px of colour and nothing else: five slivers that
  // named nothing and could not be opened, and two windows on one day drew one
  // exactly on top of the other. Live 2026: two courses publish drop-in windows
  // over the five-hour threshold on the same days, so every weekday carries
  // two.
  await page.goto(
    "/planlegger/#26h;-;%2BTDT4120~%C3%B8vingsveiledning,%2BTDT4110~ferdighetstrening",
  );
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await page.click("#planner-others-toggle");

  const strips = page.locator(".planner-cols-band");
  await expect(strips.first()).toBeVisible();
  // OUT OF THE HOURS. A window is 08:15–14:00 every weekday, so it is not an
  // appointment at a time and does not belong on the time axis at all — it is
  // in the all-day row, above the grid, and the lanes below never see it.
  await expect(page.locator('.planner-cols-allday[data-day="1"] .planner-cols-band')).toHaveCount(
    2,
  );
  await expect(page.locator(".planner-cols-day .planner-cols-band")).toHaveCount(0);
  // It says what it is, and WHERE: a drop-in window you cannot find the room
  // for is a window you cannot drop into. And its HOURS, because it is the one
  // session in this view whose time the grid does not draw.
  await expect(strips.first()).toContainText("TDT4120");
  await expect(strips.first()).toContainText("A4-156");
  await expect(strips.first()).toContainText("08:15–14:00");
  // The activity is in the accessible name, not on the chip: at this width the
  // room and the hours are what a chip can hold, and they are the two facts you
  // opened the row for.
  await expect(strips.first()).toHaveAttribute("aria-label", /Øvingsveiledning/);

  // Two on Monday, stacked rather than one over the other.
  const monday = page.locator('.planner-cols-allday[data-day="1"] .planner-cols-band');
  const tops = await monday.evaluateAll((nodes) =>
    nodes.map((n) => Math.round(n.getBoundingClientRect().top)),
  );
  expect(new Set(tops).size).toBe(2);

  // And it opens the same session card a block does — a window you can drop
  // into is a session you can ask about.
  await strips.first().click();
  const popover = page.locator("#planner-block-popover");
  await expect(popover).toBeVisible();
  await expect(popover).toContainText("08:15–14:00");
  await page.keyboard.press("Escape");

  // The strip is IN the week's one strike order, not beside it: with no
  // `--planner-strike` at all it took step zero, so every strip fired on the
  // first frame and the sessions trickled in behind them. Out to Liste and
  // back is what re-runs the strike — `setWeekView` ignores a click on the
  // view already showing.
  await page.click("#planner-view-tavle");
  await expect(page.locator(".planner-board")).toBeVisible();
  await page.click("#planner-view-kolonner");
  await expect(strips.first()).toBeVisible();
  const steps = await page
    .locator(".planner-cols-block, .planner-cols-band")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        strip: n.classList.contains("planner-cols-band"),
        step: Number(n.style.getPropertyValue("--planner-strike")),
        delay: getComputedStyle(n).animationDelay,
      })),
    );
  expect(steps.length).toBeGreaterThan(2);
  expect(steps[0]?.strip).toBe(true);
  expect(steps[0]?.step).toBe(0);
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i]?.step).toBe((steps[i - 1]?.step ?? 0) + 1);
  }

  // Every element gets its OWN moment — the interval squeezes on a long week,
  // it does not cap. A ceiling on the index made the tail land on one frame,
  // and since the sequence runs day by day that tail was a whole weekday.
  const delays = steps.map((s) => Number.parseFloat(s.delay));
  expect(new Set(delays).size).toBe(delays.length);
  // …and the whole thing still lands inside the budget.
  expect(Math.max(...delays)).toBeLessThanOrEqual(0.65);
});

test("liste: the collision marks the two sessions, not the day around them", async ({ page }) => {
  // The mark used to be a bracket on a wrapper every row of the day was
  // appended to, so one afternoon overlap drew a rule down the side of that
  // morning's lecture too. Friday from live 2026 data carries one clean lecture
  // and one overlapping pair, so the week has five lecture rows and exactly one
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
  // The implementation is `closedby="any"` on all three, so this is really a
  // test that the attribute is set and that nothing inside the card sits in the
  // dialog's own box swallowing the click.
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
  // Centred, the card re-centred on every keystroke as the result list changed
  // length, so the caret travelled up and down the screen while the student was
  // still typing. It is pinned near the top instead.
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
  //. The plan is seeded through the planner (the store is
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

  // The card is the only way back in; the old "Planen din" resume line is gone.
  await expect(page.locator("#home-resume")).toHaveCount(0);
});

test("week: the øving layer shows picked groups, not the whole cohort's", async ({ page }) => {
  // EXPH0300 publishes 14 seminar groups. Before this, turning the toggle on
  // drew every one of them — 41 blocks in an MTDT week.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  const before = await gridBlocks(page).count();

  await page.click("#planner-others-toggle");
  await expect(page.locator(".planner-note-groups").first()).toBeVisible({ timeout: 15_000 });

  const after = await gridBlocks(page).count();
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
  // picker directly, unlike a block, which asks "what is this session".
  await notes.first().click();
  await expect(page.locator("#planner-course-settings")).toBeVisible();
  await expect(
    page.locator("#planner-course-settings .course-settings-group-row").first(),
  ).toBeVisible();
});

test("week: the øving toggle moves the layer and leaves nothing behind", async ({ page }) => {
  // The toggle travels what stays, strikes in what arrives and wipes out what
  // leaves. What can break in the field is the scaffolding: a stuck
  // `is-settling` freezes every bar's geometry mid-transition, and an orphaned
  // ghost is a bar that is not in the plan.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  // Settled, not merely painted: the bundles land one by one and the block
  // count is still climbing on the frame the first one appears. The verdict is
  // the signal for that — it stays "henter timeplan …" until every bundle is in.
  await expect(page.locator(".planner-cols-day-header").first()).toBeVisible();
  await settledVerdict(page);

  const hosts = {
    kolonner: page.locator("#planner-grid-frame .planner-cols"),
    tavle: page.locator(".planner-board"),
  };
  for (const view of ["kolonner", "tavle"] as const) {
    await page.click(`#planner-view-${view}`);
    const host = hosts[view];
    await expect(host).toBeVisible();
    const lectures = await gridBlocks(page).count();

    await page.click("#planner-others-toggle");
    await expect(host).not.toHaveClass(/is-settling/, { timeout: 5_000 });
    await expect(page.locator(".planner-motion-ghost")).toHaveCount(0);

    await page.click("#planner-others-toggle");
    // Back to exactly the lectures we started from — the ghosts of the layer
    // that just left are gone, not merely invisible.
    await expect(host).not.toHaveClass(/is-settling|is-closing/, { timeout: 5_000 });
    await expect(page.locator(".planner-motion-ghost")).toHaveCount(0);
    if (view === "kolonner") await expect(gridBlocks(page)).toHaveCount(lectures);
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

  // the figure was 39 % of the mobile page. At most three charts are
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
  // TMA4100 and 702 others exist only in last year's catalog. Adding one
  // contributed nothing to the week and left the planner showing a raw English
  // "Not found". The page still exists, so the row keeps its link and loses its
  // verb. They fold into one labelled group instead of interleaving; the group
  // opens itself when there is nothing else to show, which is this query's case.
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

  await expect(planTitle(page)).toContainText("MTIØT Kull 24");
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

  // The city answer resolves its own courses and opens the NEXT waypoint —
  // BSPL26-V-GJØVIK nests a praksisløp choice underneath itself, and
  // `classifyPeriod` descends into it instead of stopping one level down. So
  // the week fills AND keeps asking.
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

  const code = await firstBlockCode(page);
  expect(code).not.toBe("");
  // the row IS the control, and the verb is inside the
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
  // "Dropp" destroys the block that opened the surface, and the old non-modal
  // popover then called focus() on a detached node — a silent no-op that
  // dropped focus to <body>, so the next Tab restarted at the skip link.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  const code = await firstBlockCode(page);
  expect(code).not.toBe("");

  await settingsFromBlock(page);
  const settings = page.locator("#planner-course-settings");
  await settings.locator(".course-settings-action", { hasText: "Dropp" }).click();
  await expect(settings).toBeHidden();

  // Whatever opened the dialog is gone, so the browser's own restore is a
  // no-op. Focus lands on the course row's settings button, which reopens the
  // dialog, so the undo is one keystroke away.
  const row = courseRows(page).filter({ hasText: code }).first();
  await expect(row).toHaveClass(/is-dropped/);
  await expect(courseSettingsBtn(page, code)).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.tagName ?? "")).not.toBe("BODY");
});

test("add dialog: one Escape from the search field closes it", async ({ page }) => {
  // The field was `type="search"`, and Chrome's search input eats the first
  // Escape to clear itself, cancelling the dialog's close request. Typing first
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
 * The clock. A planner is a page people leave open, and everything below is
 * invisible to every other kind of test: the assertions are about what the page
 * says an hour or a day after it was rendered. Europe/Oslo is pinned because
 * the fixtures are wall-clock times in NTNU's timezone and CI runs in UTC.
 */
test.describe("time passing", () => {
  test.use({ timezoneId: "Europe/Oslo" });

  test("the week follows the day across midnight", async ({ page }) => {
    // Wednesday of teaching week 36, mid-morning.
    await page.clock.install({ time: new Date("2026-09-02T10:40:00+02:00") });
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
    const today = page.locator("#planner-grid-frame .planner-cols-day[data-today]");
    const marker = page.locator("#planner-grid-frame .planner-cols-now");
    await expect(today).toHaveAttribute("data-day", "3");

    // The ordinary minute may NOT re-render: the marker moves and nothing
    // else does. Rebuilding the week every 60 s would throw away the layer
    // motion, the scroll position and any open popover.
    const bar = await gridBlocks(page).first().elementHandle();
    await page.clock.runFor("00:05:00");
    expect(await bar?.evaluate((el) => el.isConnected)).toBe(true);

    // `fastForward`, not `runFor`: the assertions below are about the day
    // ROLLING, and runFor fires all 1 440 intervening minute ticks one by one —
    // 6 s of simulated no-ops per call. That the ordinary minute does not
    // re-render is already asserted by the 5-minute runFor above.
    // Left open overnight: this kept yesterday's spine at full ink and its row
    // tinted while the now line had stepped into today, so the marker read as
    // misplaced — the highlight is the louder signal.
    await page.clock.fastForward("24:00:00");
    await expect(today).toHaveAttribute("data-day", "4");
    // The needle lives in today's column or nowhere, so its being visible at
    // all is the assertion that it followed the day — it is drawn as a child of
    // the day it belongs to rather than positioned against the whole week.
    await expect(marker).toBeVisible();
    await expect(
      page.locator('#planner-grid-frame .planner-cols-day[data-day="4"] .planner-cols-now'),
    ).toHaveCount(1);

    // The countdown to the next exam reads the date too, and was a day long
    // with it. It is a segment on the list's rule, not a cell in the row —
    // see the phone test below.
    const away = page.locator(".exam-gap.is-away").first();
    const days = (text: string | null) => Number(text?.match(/\d+/)?.[0] ?? Number.NaN);
    const after = days(await away.textContent());
    expect(Number.isFinite(after)).toBe(true);
    await page.clock.fastForward("24:00:00");
    await expect(away).not.toHaveText(new RegExp(`\\b${after}\\b`));
    expect(days(await away.textContent())).toBe(after - 1);
  });

  test("the landing card counts its own minutes down", async ({ page }) => {
    // Monday of teaching week 36, 15 minutes into TMA4412's 08:15 lecture.
    await page.clock.install({ time: new Date("2026-08-31T08:30:00+02:00") });
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

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
    // As a third cell of the row the countdown had no column at 390 px, so it
    // dropped to a second grid row and made one row two lines tall with a hole
    // beside it. It is a segment on the rule now.
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
  // Two faults, one test, because they share a cause — controls and facts that
  // looked like each other: the plan was named twice 100 px apart, and a radio
  // group and a checkbox were three identical uppercase mono toggles in a row.
  await page.goto("/planlegger/#26h;MTDT.2026;");
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  await expect(planTitle(page)).toHaveText("MTDT Kull 26 H26");
  await expect(page.locator("#studieinfo-chip")).toHaveCount(0);
  // Three topbar children on every page (the ThemeToggle ships a <script>
  // beside its button, which is not one): wordmark, nav, toggle.
  await expect(page.locator(".site-topbar > *:not(script)")).toHaveCount(3);

  // The switch is a segmented control, and its whole state is which word the
  // thumb is under — a thumb that TRAVELS rather than cross-fading.
  const tabs = page.locator(".planner-view-tabs");
  const ruleAt = () =>
    tabs.evaluate((el) => ({
      x: el.style.getPropertyValue("--view-x"),
      w: el.style.getPropertyValue("--view-w"),
    }));
  const atWeek = await ruleAt();
  expect(Number.parseFloat(atWeek.w)).toBeGreaterThan(0);
  // At the first tab, so within the track's own 2px lip.
  expect(Number.parseFloat(atWeek.x)).toBeLessThanOrEqual(2);

  await page.click("#planner-view-tavle");
  await expect(page.locator(".planner-board").first()).toBeVisible();
  const atList = await ruleAt();
  // The rule TRAVELS to the second word rather than appearing under it.
  expect(Number.parseFloat(atList.x)).toBeGreaterThan(Number.parseFloat(atWeek.x));
  // "Liste" is the longer word — the rule is measured, not a fixed half.
  expect(Number.parseFloat(atList.w)).toBeGreaterThan(Number.parseFloat(atWeek.w));

  // …and back, so the travel is not one-way.
  await page.click("#planner-view-kolonner");
  await expect(page.locator(".planner-cols").first()).toBeVisible();
  expect(Number.parseFloat((await ruleAt()).x)).toBe(Number.parseFloat(atWeek.x));

  // And the layer control is a box you tick, not a fourth view: it has a
  // check mark of its own and never takes the pressed FILL the old toggle did.
  const others = page.locator("#planner-others-toggle");
  await expect(others.locator(".planner-check")).toHaveCount(1);
  await expect(others).toHaveAttribute("aria-pressed", "false");
  await others.click();
  await expect(others).toHaveAttribute("aria-pressed", "true");
});

/**
 * The block popover is NON-MODAL by design (`dialog.show()`), so nothing native
 * keeps focus inside it — and tabbing off its last control walked into the
 * document behind, landing on the skip link at the top of the page with the
 * popover still painted over the week.
 *
 * Gated because the fix has now been wrong twice: first reading
 * `relatedTarget === null` as "focus left the document" when Chromium also
 * reports it for focus landing on `body`, then guarding on
 * `document.hasFocus()`, which is false in a headless browser whatever the page
 * is doing — so the handler existed, read correctly, and never ran.
 */
test("the block popover closes when you tab off its end", async ({ page }) => {
  await page.goto("/planlegger/#26h;MTDT.2026;");
  const block = gridBlocks(page).first();
  await expect(block).toBeVisible({ timeout: 45_000 });
  await block.click();
  const popover = page.locator("#planner-block-popover");
  await expect(popover).toBeVisible();

  const stillOpen = () => popover.evaluate((d: HTMLDialogElement) => d.open);
  let tabs = 0;
  while (tabs < 12 && (await stillOpen())) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(60);
    tabs++;
  }
  expect(await stillOpen()).toBe(false);
  // It must close by LEAVING, not immediately: its own controls are still
  // tabbable, so a popover that shut on the first Tab would be unusable by
  // keyboard.
  expect(tabs).toBeGreaterThan(1);
});

test.describe("target sizes", () => {
  /**
   * WCAG 2.5.8 Target Size (Minimum), AA: every pointer target is at least
   * 24x24 CSS px. It shipped with six controls under it — 18 to 22 px tall —
   * and nothing could see them. This can.
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

    /**
     * THE VERDICT'S OWN BUTTON, which the pass above structurally could not
     * see: `button.planner-chip.is-jump` exists only when there is a collision
     * to jump to, and MTDT kull 2026 has none. So the one control on the page
     * that was under the floor — 153x21, the sentence a student is most meant
     * to press, with a source comment claiming it "clears 24px on its own at
     * this size" — sat outside the gate that exists to catch exactly that.
     */
    test(`the clash verdict's jump target clears ${MIN}px — ${label}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/planlegger/#26h;-;%2BTDT4109,%2BTDT4120");
      const jump = page.locator("button.planner-chip.is-jump");
      await expect(jump).toBeVisible({ timeout: 45_000 });
      const box = await jump.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(MIN);
      expect(await undersized(page)).toEqual([]);
    });
  }
});

// The clean-plan half of DR-8 ("the join admits its gaps, and says nothing
// when it has none") is asserted against the same element and the same render
// path by tests/planner/plannerApp.test.ts. The failure half stays here,
// because only the browser can show the week still drawing around the gap.

test.describe("nålen", () => {
  test.use({ timezoneId: "Europe/Oslo" });

  test("is in today's column inside the drawn hours, and nowhere else", async ({ page }) => {
    // Two states, not four: on the minute, or absent. The faint week-wide
    // hairline it replaces was the same KIND of mark as the 1px hour rules it
    // crossed, so off today it could not be found at all.
    const marker = page.locator("#planner-grid-frame .planner-cols-now");

    // Tuesday of teaching week 36, inside EXPH0300's 08:15 lecture.
    await page.clock.install({ time: new Date("2026-09-01T09:05:00+02:00") });
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
    await expect(marker).toBeVisible();

    // It is drawn INSIDE Tuesday's column — a child of the day it names, not a
    // line laid over the week and positioned to look like it.
    await expect(
      page.locator('#planner-grid-frame .planner-cols-day[data-day="2"] .planner-cols-now'),
    ).toHaveCount(1);

    // And at 09:05 of the drawn span, computed from the axis the blocks use, so
    // a needle and a bar can never disagree about what o'clock is where.
    const [min, span] = await page
      .locator("#planner-grid-frame .planner-cols")
      .evaluate((el) => [Number(el.getAttribute("data-min")), Number(el.getAttribute("data-span"))]);
    const y = Number.parseFloat(await marker.evaluate((el) => el.style.getPropertyValue("--planner-y")));
    expect(y).toBeCloseTo(((9 * 60 + 5 - min) / span) * 100, 3);

    // Past the drawn hours: gone. A week clamped to its own sessions has no
    // honest place to put 21:10, and this is not a clock.
    await page.clock.setFixedTime(new Date("2026-09-01T21:10:00+02:00"));
    await page.clock.runFor("01:00");
    await expect(marker).toBeHidden();

    // Saturday: gone. There is no today column to be in.
    await page.clock.setFixedTime(new Date("2026-09-05T11:40:00+02:00"));
    await page.clock.runFor("01:00");
    await expect(marker).toBeHidden();
  });
});

/**
 * The transposed grid's own geometry, on the ONE surface that still draws it.
 * `/emne/[code]/` mounts `renderGrid` into its own `.planner-grid-frame` — the
 * planner stopped offering Rader as a view, so a claim about a day ROW has to
 * be made where a day row still exists.
 */
test("course page: every bar is centred in its row", async ({ page }) => {
  // `--planner-lane-h` is a stride (bar + gap), so N lanes occupy N strides
  // LESS one trailing gap. Without that subtraction every row in the week was
  // off-centre — and the row's real height is max(spine, field), which the
  // spine won, so no amount of padding could have fixed it.
  await page.goto("/emne/TDT4120/");
  await expect(page.locator(".planner-grid-frame .planner-block").first()).toBeVisible({
    timeout: 45_000,
  });

  const gaps = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".planner-grid-frame .planner-grid-row")).flatMap((row) => {
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

test("the layer leaves in the reverse of the order it arrived in", async ({ page }) => {
  // The sequence was already mirrored — space opens, then bars arrive; bars
  // leave, then space closes — but the STAGGER was not: departures all vanished
  // on the same frame, which is not the reverse of an order but the absence of
  // one.
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
  const arrive = await indices(".planner-cols-block.is-arriving, .planner-cols-band.is-arriving", "--planner-arrive");
  expect(arrive.length).toBeGreaterThan(1);
  // Reading order, ascending: 0, 1, 2 …
  expect(arrive).toEqual([...arrive].sort((a, b) => a - b));
  await page.waitForTimeout(1400);

  await page.locator("#planner-others-toggle").click();
  const depart = await indices(".planner-motion-ghost", "--planner-depart");
  expect(depart.length).toBe(arrive.length);
  // The same reading order, DESCENDING: the last block to land is the first to go.
  expect(depart).toEqual([...depart].sort((a, b) => b - a));
  expect(Math.max(...depart)).toBe(depart.length - 1);
});

test("the all-day row opens with the layer instead of snapping", async ({ page }) => {
  // The week GAINS A WHOLE BAND above the hours when the øvinger arrive, and a
  // property the grid's box is sized from that is not in the motion snapshot
  // snaps on the first frame while every block below it animates — dropping the
  // entire grid 34px mid-travel. `--planner-allday-h` is that property, which
  // is also why the row is drawn at zero height rather than not drawn: a row
  // that is absent in one state and present in the next cannot animate at all.
  // TDT4120's weekday-long Øvingsveiledning is exactly this case.
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

  const band = () =>
    page
      .locator("#planner-grid-frame .planner-cols-allday")
      .first()
      .evaluate((el: HTMLElement) => Math.round(el.getBoundingClientRect().height));

  const open = await band();
  expect(open).toBeGreaterThan(0);

  // Hiding: the row must still be open while the chips are wiping out, and
  // closed once everything has settled.
  await page.locator("#planner-others-toggle").click();
  await page.waitForTimeout(120);
  expect(await band()).toBe(open);
  await page.waitForTimeout(1200);
  const shut = await band();
  expect(shut).toBeLessThan(open);

  // Revealing: the space opens FIRST, so the row is already growing at 60 ms —
  // but it has not arrived, which is what proves it is a transition and not a
  // snap.
  await page.locator("#planner-others-toggle").click();
  await page.waitForTimeout(60);
  const midway = await band();
  expect(midway).toBeGreaterThan(shut);
  expect(midway).toBeLessThan(open);
});

test("the list's own height animates too, so nothing under it jumps", async ({ page }) => {
  // The week animates `min-height` per row, so its total height follows. A
  // list's rows are in normal flow, so removing them makes the container short
  // on the frame the render lands and everything underneath jumps. FLIP cannot
  // carry it — a translated row still occupies its original box.
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
    // The code line and the long programme name are one statement said twice,
    // and a wrapping row of controls used to get in between them. They share a
    // box of their own now, so nothing CAN — which is a stronger guarantee than
    // the grid areas it replaced, and it survives any control being added.
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    const box = (sel: string) =>
      page.locator(sel).evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      });
    const title = await box("#planner-title");
    const hint = await box("#planner-context-line");
    const verdict = await box("#planner-grid-status");
    const edit = await box("#planner-edit-plan");
    const tabs = await box(".planner-view-tabs");
    const frame = await box("#planner-grid-frame");

    // Nothing fits between them: the gap is smaller than a line of text at any
    // step on the page's scale, so no sentence can have got in there.
    expect(hint.top - title.bottom).toBeLessThan(20);
    // Every control is below the whole name, never inside it.
    expect(edit.top).toBeGreaterThanOrEqual(hint.bottom);
    expect(tabs.top).toBeGreaterThanOrEqual(hint.bottom);
    // MTDT's pass is QUALIFIED — HMS0002 publishes nothing classifiable as a
    // lecture, so the check went over it rather than on it — and a qualified
    // pass is printed on a phone. The rule that hides a clean verdict was
    // written about the pass that says nothing ("ingen kollisjoner" answers a
    // question nobody asked); it was hiding this one too, so the phone showed
    // "kollisjonssjekken er ufullstendig" in the margin with no verdict on
    // screen for it to qualify — a bare warning about nothing.
    expect(verdict.bottom - verdict.top).toBeGreaterThan(0);
    await expect(page.locator("#planner-grid-status")).toContainText("ikke sjekket");
    // WHAT IS SPENT BEFORE THE WEEK, which is the number that matters and the
    // one the old 138px finding was about. Measured to the frame's top rather
    // than to the banner's bottom: the bar carries the view switch and the
    // layer box now, and they came UP out of the week's own section head — so
    // the banner grew by exactly what the page lost lower down, and a budget on
    // the banner alone would read that move as a regression.
    //
    // Expressed as a FRACTION of the screen rather than a pixel count, because
    // that is the actual claim: the week has to start in the first third-ish,
    // or the thing the page is for is below the fold. From the viewport's top,
    // so the site topbar is inside the budget too. Measured at 277 of 844.
    //
    // Raised 0.35 → 0.37 when the qualified pass started printing on a phone:
    // the verdict and the deadline cannot share one 390px row, so a qualified
    // plan spends 27px more here (304 of 844, 36%) than a plan whose pass says
    // nothing. That is the trade, made deliberately — the alternative was a
    // margin note reading "kollisjonssjekken er ufullstendig" with no verdict
    // on screen for it to qualify. An UNQUALIFIED pass is still hidden and
    // still costs nothing, which is what the sibling test below pins.
    const viewport = page.viewportSize();
    expect(frame.top).toBeLessThan((viewport?.height ?? 844) * 0.37);
  });

  test("the verdict appears on a phone exactly when it has something to report", async ({
    page,
  }) => {
    // "ingen kollisjoner" is the answer to a question nobody asked; a
    // collision is not. TDT4120's Friday lecture collides with TDT4109's, the
    // clash the suite already establishes elsewhere.
    await page.goto("/planlegger/#26h;MTDT.2026;%2BTDT4120");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    const verdict = page.locator("#planner-grid-status");
    await expect(verdict).toBeVisible({ timeout: 30_000 });
    await expect(verdict).toContainText("kollisjon");
  });

  test("an unqualified clean verdict is still not printed on a phone", async ({ page }) => {
    // The other half of the narrowed rule, and the half that was there first.
    // TDT4110 and TDT4120 both publish real lectures and do not collide, so
    // the pass has nothing to qualify — "ingen forelesninger kolliderer" and
    // nothing else, which is the line that spends a row of the first screen
    // saying nothing is wrong.
    await page.goto("/planlegger/#26h;-;%2BTDT4110,%2BTDT4120");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
    const status = page.locator("#planner-grid-status");
    await expect
      .poll(async () => (await status.textContent())?.trim() ?? "", { timeout: 45_000 })
      .toContain("Ingen forelesninger kolliderer");
    await expect(status).not.toContainText("ikke sjekket");
    const height = await status.evaluate((el: HTMLElement) => el.getBoundingClientRect().height);
    expect(height).toBe(0);
  });
});

test.describe("the phone's week", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("a room is printed whole or not printed", async ({ page }) => {
    // One ellipsis standing in for one character, because the room and the
    // activity name shared a box. They are two boxes now and `fitBlockLabels`
    // drops whichever the bar cannot hold — the room whole or not at all.
    //
    // On /emne/[code]/, because `fitBlockLabels` belongs to the transposed grid
    // and that is the one surface still drawing it. The column week's own
    // `.planner-cols-sub` ellipsises ON PURPOSE — a block there is as wide as
    // its share of a weekday, not as long as its session.
    await page.goto("/emne/TDT4120/");
    await expect(page.locator(".planner-grid-frame .planner-block").first()).toBeVisible({
      timeout: 45_000,
    });

    // `Array.from`, not a spread, and no generic type arguments: this file is
    // in the Node typecheck pass, whose `lib` has neither DOM.Iterable nor the
    // typed `querySelector` overloads.
    const cut = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".planner-grid .planner-block-room"))
        .filter((room) => getComputedStyle(room).display !== "none")
        .filter((room) => room.scrollWidth > room.clientWidth + 1)
        .map((room) => room.textContent),
    );
    expect(cut).toEqual([]);
  });

  test("the hours stay put while the week is dragged", async ({ page }) => {
    // Five days and eight hours do not fit a phone, so the axis scrolls — and
    // the one thing that may not scroll with it is the rail saying which hour
    // you are reading.
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    const frame = page.locator("#planner-grid-frame");
    const rail = page.locator(".planner-cols-rail").first();
    const before = await rail.evaluate((el) => Math.round(el.getBoundingClientRect().x));

    await frame.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await page.waitForTimeout(200);
    const after = await rail.evaluate((el) => Math.round(el.getBoundingClientRect().x));
    expect(after).toBe(before);

    // And the fade that says "there is more" is never drawn over it: the left
    // ramp used to veil the column deliberately still on screen while the
    // blocks behind it stayed crisp.
    const mask = await frame.evaluate((el) => getComputedStyle(el).maskImage);
    expect(mask).not.toContain("transparent 0");
  });

  test("the margin notes fold to one line that still qualifies the verdict", async ({ page }) => {
    // mob-D. HMS0002 publishes no lecture-classified activity, so MTDT's week
    // carries exactly one note — 83 px of paragraph under a 233 px week.
    await page.goto("/planlegger/#26h;MTDT.2026;");
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    const fold = page.locator("#planner-grid-notes details.planner-notes-fold");
    await expect(fold).toBeVisible();
    // Closed on a phone, and the line still says the check is incomplete —
    // the fold may take the explanation, never the qualification.
    expect(await fold.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
    await expect(fold.locator("summary")).toContainText("kollisjonssjekken er ufullstendig");
    await expect(fold.locator(".planner-grid-note")).toBeHidden();

    await fold.locator("summary").click();
    await expect(fold.locator(".planner-grid-note")).toBeVisible();
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
