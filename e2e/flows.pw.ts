import type { Page } from "@playwright/test";
import { expect, gotoPlanner, seedSharingAccount, test } from "./harness.js";

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
 * A drawn session in the planner's week. Scoped to `#planner-grid-frame`,
 * /planlegger/'s own id, because /emne/[code]/ and /user/<navn> now draw the
 * same two views into frames of their own and a bare class would match theirs.
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
/** The topbar's account door — on every page, not just this one. */
const profileBtn = (page: Page) => page.locator("#site-account-btn");
const profilePanel = (page: Page) => page.locator("#planner-profile-panel");

/** The picker's own dialog, opened from the plan's name in the planner's bar. */
const studieinfoDialog = (page: Page) => page.locator("#planner-studieinfo");

/**
 * Opens studieinfo. Still one click, but from the PLAN'S NAME rather than the
 * topbar: programme, kull and studieretning describe the plan, so they came
 * back to the planner on 2026-08-03 and the topbar kept the account alone.
 *
 * With no programme stored the title is inert (there is no fact to press, and
 * the empty state's card already says "Velg studieprogram"), so that card is
 * the door on a fresh plan and the title is the door once one exists.
 */
async function openStudieinfo(page: Page): Promise<void> {
  const door = page.locator("#planner-name-btn");
  if (await door.isEnabled()) await door.click();
  else await page.getByRole("button", { name: "Velg studieprogram" }).click();
  await expect(studieinfoDialog(page)).toBeVisible();
  await expect(studieinfoDialog(page).locator("#studieinfo-dialog-title")).toBeVisible();
}

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

test("onboarding: first run → programme + kull + retning → a full week", async ({ page }) => {
  await page.goto("/planlegger/");

  // FIRST RUN OWNS THE PAGE. It is not a card in the middle of a drawn planner
  // any more: the bar and everything under it are gated off by
  // `html:not([data-plan])`, which the pre-paint probe already writes, so a
  // student with no plan never sees four controls that act on nothing.
  await expect(page.locator("#planner-firstrun")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".planner-banner")).toBeHidden();
  await expect(page.locator("#planner-main")).toBeHidden();

  // The picker is ON THE SCREEN, not behind a press. There is no dialog in this
  // path at all, and no Lagre in it: the sentence above promises a ready week
  // for two facts, so a third press would make that false.
  await expect(page.locator("#planner-studieinfo")).toHaveCount(0);
  await expect(page.locator("#studieinfo-save")).toHaveCount(0);

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

  // THE KULL PRESS IS THE COMMIT. An older kull: MTDT 2024 at 26h is a 3rd-year
  // autumn, gated behind studieretning — which first run does NOT ask, because
  // `#planner-direction` asks it afterwards, when the study plan has landed and
  // it knows whether it matters.
  await page.locator("#studieinfo-kull-chips button", { hasText: "2024" }).click();

  // The screen gives way to the planner off that one write: the store change
  // repaints, and the probe puts `data-plan` back on `<html>`. No reload.
  await expect(page.locator("#planner-firstrun")).toBeHidden({ timeout: 20_000 });
  await expect(page.locator(".planner-banner")).toBeVisible();
  await expect(planTitle(page)).toHaveText("MTDT Kull 24");

  // …and the dialog still works after first run, which is the half of the
  // lazy mount that could silently break: it is built on this first open,
  // because two live studieinfo sections would collide on every id.
  const direction = page.locator("#planner-direction");
  await expect(direction).toBeVisible({ timeout: 30_000 });
  await direction.locator("#planner-direction-btn").click();

  const dialog = page.locator("#planner-studieinfo");
  await expect(dialog).toBeVisible();
  const retningSelect = page.locator("#studieinfo-retning-select");
  await expect(retningSelect).toBeVisible({ timeout: 20_000 });
  await retningSelect.selectOption({ index: 1 }); // index 0 is the "Ikke valgt ennå" placeholder
  await page.click("#studieinfo-save");
  await expect(dialog).toBeHidden();

  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
});

/* "share: the hash reproduces the plan in a fresh context" is DELETED with the
   grammar it was about — a URL no longer carries a plan, and `e2e/publish.pw.ts`
   covers what replaced it: publish, then open `/user/<navn>` as a stranger.

   "share: a program-less link clears the profile chip" goes with it. Its defect
   — `savePlan` can write `np:profile` but never clear it, so the header kept
   naming a programme the incoming link did not have — needed a link that
   overwrites local state, and nothing does that any more. `store.removeProgram`
   is still the only way to clear it and is still covered by unit tests. */

test("a stored programme is read back after a real document load", async ({ page }) => {
  // The half of the deleted test that still has a subject: the profile is
  // genuinely in storage rather than held in memory, proven by leaving the page
  // and coming back to a planner that still knows the programme.
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(planTitle(page)).toContainText("MTDT", { timeout: 30_000 });

  await page.goto("/");
  await page.goto("/planlegger/");
  await expect(planTitle(page)).toContainText("MTDT", { timeout: 30_000 });
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
});

test("overlap: two colliding courses take a lane each, both readable", async ({ page }) => {
  // MTDT 2026's obligatory TDT4109 collides with a manually added TDT4120 —
  // the exact clash the old suite's clash-preview (ekstraemne) test verified.
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 }, courses: ["TDT4120"] });
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
  // confident answer to PRODUCT §2's only question, computed over data it never
  // had. `--verdict` green is the only thing on the page still coloured by an
  // outcome, so a false green is the loudest lie it can tell.
  await page.route("**/api/course/TMA4400/timetable*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Upstream unavailable" }),
    }),
  );

  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
  await gotoPlanner(page, { courses: ["TDT4110"] });

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

  await page.reload();
  await expect(gridBlocks(page)).toHaveCount(1, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toHaveAttribute("aria-label", /onsdag/i);
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

  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
  await gotoPlanner(page, { courses: ["TDT4110"] });

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
  await gotoPlanner(page, { courses: ["TDT4110", "TDT4109"] });
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
  await gotoPlanner(page, { courses: ["TMA4401"] });
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
  // semester" disclosure duplicating the modal's own select. What remains is
  // the PLAN'S OWN NAME: press the fact to change the fact. (The topbar briefly
  // held this door on 2026-08-03; it kept the account and gave the picker back,
  // because a programme is a fact about the plan and sign-in is not.)
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });

  await expect(page.locator("#planner-context-change")).toHaveCount(0);
  await expect(page.locator("#planner-semester")).toHaveCount(0);
  await expect(page.locator("#planner-title button")).toHaveCount(0);

  // The title names the plan, not the term. It carried `H26` for as long as the
  // term had no control of its own; once the bar grew a `<select>` for it the
  // page stated the same fact twice, once as a label and once as something you
  // can act on, and the label is the one that went (DESIGN §9). The term is
  // still on screen — asserted on the control, a few lines down.
  await expect(planTitle(page)).toHaveText("MTDT Kull 26");
  await expect(page.locator("#planner-semester-select")).toHaveValue("26h");
  await expect(page.locator("#planner-context-line")).toContainText("Datateknologi");

  // With a plan set, the week is a real grid — so no empty-state card is on
  // screen and the plan's own name is the only thing left that opens
  // studieinfo. The topbar's door leads to the account, a different room.
  await expect(page.locator("#planner-grid-frame .planner-week-card")).toHaveCount(0);

  const dialog = studieinfoDialog(page);
  await expect(dialog).toBeHidden();
  await openStudieinfo(page);
  await expect(dialog).toBeVisible();
  // …and the SEMESTER is not in it. It is a control on the page itself now,
  // beside the plan whose term it names.
  await expect(dialog.locator("#planner-semester-select")).toHaveCount(0);
  await expect(page.locator("#planner-semester-select")).toBeVisible();
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

  await gotoPlanner(page, { courses: codes });

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

  await gotoPlanner(page, { courses: ["TDT4110", "TDT4120"] });
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
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  // Uke is what a cold load draws, so the tab is pressed before anything is
  // clicked — the page and `loadWeekView` have to agree about that or the CLS
  // reservation is for a view the frame is not about to fill.
  await expect(page.locator('[data-role="view-tabs"] [data-view="kolonner"]')).toHaveAttribute("aria-pressed", "true");
  const columns = page.locator("#planner-grid-frame .planner-cols");
  await expect(columns).toBeVisible();
  // Blocks AND strips: a drop-in window is a session the list owes the week
  // too, so counting only the lanes would let either view quietly drop every
  // open øvingsvindu and still look equal to the other.
  const sessions = await page.locator(".planner-cols-block, .planner-cols-band").count();
  expect(sessions).toBeGreaterThan(0);
  // Rader is deleted, not relocated: no surface draws a transposed week.
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

  await page.click('[data-role="view-tabs"] [data-view="tavle"]');
  await expect(page.locator(".planner-board")).toBeVisible();
  await expect(page.locator('[data-role="view-tabs"] [data-view="tavle"]')).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('[data-role="view-tabs"] [data-view="kolonner"]')).toHaveAttribute("aria-pressed", "false");
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

  await page.click('[data-role="view-tabs"] [data-view="kolonner"]');
  await expect(columns).toBeVisible();
  await expect(page.locator(".planner-board")).toHaveCount(0);
});

test("kolonner: the week is dealt out in whole days at every width", async ({ page }) => {
  // THE WIDTH LAW's third clause. `minmax(daymin, 1fr)` got the two ends right
  // and the middle wrong: between "all five fit" and "properly a scroller" the
  // frame closed mid-column and a strip of Friday hung past the edge. The count
  // of days is floored now, so the scroll only ever hides whole ones.
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await page.click('[data-role="view-tabs"] [data-view="kolonner"]');
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

        /* AND AT LEAST TWO OF THEM ARE ON SCREEN, which is the clause this
           whole sweep was missing. Everything above asks whether the columns
           are TIDY — same width, whole days, no strip hanging past the edge —
           and every one of those assertions passed while a phone showed ONE day
           of five: the day minimum multiplied the deepest cluster in the week
           by every column, so a single 45-minute Friday overlap gave Monday a
           two-lane minimum and pushed the week to 1560px at 390px wide. A week
           you can only read one day at a time is not a week, and no measurement
           here could see it. Two is the floor because it is the smallest number
           that still shows a NEXT day; at 3 lanes and 360px the cap is what
           makes it hold. */
        const onScreen = (region.right - region.left) / track;
        expect(onScreen, `${at}: only ${onScreen.toFixed(2)} days fit on screen`).toBeGreaterThan(
          1.99,
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
  await gotoPlanner(page, {
    courses: [
      { code: "TDT4120", groups: ["øvingsveiledning"] },
      { code: "TDT4110", groups: ["ferdighetstrening"] },
    ],
  });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await page.click('[data-role="layer-toggle"]');

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
  await page.click('[data-role="view-tabs"] [data-view="tavle"]');
  await expect(page.locator(".planner-board")).toBeVisible();
  await page.click('[data-role="view-tabs"] [data-view="kolonner"]');
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
  await gotoPlanner(page, { courses: ["TDT4110", "TDT4120", "TMA4401"] });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  expect(await settledVerdict(page)).toMatch(/1 kollisjon/);

  await page.click('[data-role="view-tabs"] [data-view="tavle"]');
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
  await gotoPlanner(page, { courses: ["TDT4110"] });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  // Well outside every card: all three are pinned near the top and none is
  // wider than 34rem, so the bottom-left corner is backdrop in each case.
  const backdrop = { x: 8, y: 8 };
  const viewport = page.viewportSize();
  if (viewport) backdrop.y = viewport.height - 8;

  for (const [name, open] of [
    ["#planner-add-dialog", () => page.click("#planner-add-course-btn")],
    ["#planner-studieinfo", () => openStudieinfo(page)],
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
  // From a plan-less planner the route into the add dialog is the first-run
  // screen's own quiet line: the bar that carries "Legg til emne" is gated off
  // until there is a plan for it to act on.
  await page.click("#planner-firstrun-add");
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
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  const before = await gridBlocks(page).count();

  await page.click('[data-role="layer-toggle"]');
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
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
    await page.click(`[data-role="view-tabs"] [data-view="${view}"]`);
    const host = hosts[view];
    await expect(host).toBeVisible();
    const lectures = await gridBlocks(page).count();

    await page.click('[data-role="layer-toggle"]');
    await expect(host).not.toHaveClass(/is-settling/, { timeout: 5_000 });
    await expect(page.locator(".planner-motion-ghost")).toHaveCount(0);

    await page.click('[data-role="layer-toggle"]');
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

  // The bar that carries "Legg til emne" is gated off until there is a plan, so
  // the first-run screen's own line is the way in.
  await page.click("#planner-firstrun-add");
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

  // The semester is a control ON THE PAGE — it describes the plan, not the
  // student, so it did not follow programme and kull into the profile panel.
  // Manual adds are scoped per semester in `np:plans`, so a switch away must
  // drop this course from view without deleting it.
  await page.selectOption("#planner-semester-select", "27v");
  await expect(courseRows(page)).toHaveCount(0);

  await page.selectOption("#planner-semester-select", "26h");
  await expect(courseRows(page)).toHaveCount(1);
  await expect(courseRows(page)).toContainText("TDT4100");
});

/**
 * Emptying the plan is a return to first run, and it has to be, because every
 * surface left behind presupposes the courses that are gone: a week frame with
 * one grey sentence floating in ~500px of white, a layer box and a view switch
 * acting on nothing, and a countdown to registering courses the student no
 * longer has. That is the exact screen the first-run design replaced.
 */
test("removing the last course returns to first run", async ({ page }) => {
  await page.goto("/planlegger/");
  await page.click("#planner-firstrun-add");
  const addDialog = page.locator("#planner-add-dialog");
  await expect(addDialog).toBeVisible();
  await addDialog.locator("input.add-course-input").fill("TDT4100");
  const row = addDialog.locator(".add-course-row", { hasText: "TDT4100" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator(".add-course-add").click();
  await addDialog.locator(".add-course-close").click();
  await expect(page.locator("#planner-firstrun")).toBeHidden();

  await page.locator('#planner-course-rows .planner-course-open[data-code="TDT4100"]').click();
  const settings = page.locator("#planner-course-settings");
  await expect(settings).toBeVisible();
  await settings.getByRole("button", { name: /Fjern/ }).click();

  await expect(page.locator("#planner-firstrun")).toBeVisible();
  await expect(page.locator(".planner-banner")).toBeHidden();
  // ONE studieinfo section in the document. The dialog holds a second copy of
  // the same unit with the same hard-coded ids, so coming back here has to
  // destroy it — two live copies break the label, the combobox wiring and every
  // getElementById that reaches into either.
  await expect(page.locator("#studieinfo-program-input")).toHaveCount(1);
  await expect(page.locator("#studieinfo-program-input")).toBeVisible();
});

/**
 * The other direction, and the reason the gate is not simply "this term is
 * empty". A student sitting in a term they have not filled yet still has a
 * plan; greeting them as a first-time visitor would hide the semester control
 * that is their way back to it.
 */
test("an empty semester keeps the planner, and every way out of it", async ({ page }) => {
  await page.goto("/planlegger/");
  await page.click("#planner-firstrun-add");
  const addDialog = page.locator("#planner-add-dialog");
  await expect(addDialog).toBeVisible();
  await addDialog.locator("input.add-course-input").fill("TDT4100");
  const row = addDialog.locator(".add-course-row", { hasText: "TDT4100" }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await row.locator(".add-course-add").click();
  await addDialog.locator(".add-course-close").click();

  await page.selectOption("#planner-semester-select", "27v");
  await expect(courseRows(page)).toHaveCount(0);

  // Still the planner, not the onboarding screen…
  await expect(page.locator("#planner-firstrun")).toBeHidden();
  await expect(page.locator("#planner-semester-select")).toBeVisible();
  // …and the plan's name is still a working door into the picker, which is the
  // only route to a programme from here now that the week's card is gone.
  await openStudieinfo(page);
  await expect(studieinfoDialog(page)).toBeVisible();

  // EXACTLY ONE studieinfo section in the document, and this is the assertion
  // that actually bites. The CSS gate reads `data-plan`, so if `syncFirstRun`
  // decided on a different predicate than the probe does, the planner would
  // still LOOK right while a second copy of the same unit was mounted into the
  // hidden first-run host — duplicating every id it hard-codes, silently.
  await expect(page.locator("#studieinfo-program-input")).toHaveCount(1);
});

test("failure honesty: API down shows retry, not 'publiseres'", async ({ page, context }) => {
  await context.route("**/api/**", (route) => route.abort());
  await gotoPlanner(page, { courses: ["TDT4109"] });

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
  // Before B1's decode fix, /api/program/MTI%C3%98T/plan?year=… 400'd from the
  // worker and this programme produced a silent blank week. The code still
  // travels percent-encoded — it is `encodeURIComponent`'d into the request
  // path by `programPlan.ts` — which is the half this exercises.
  await gotoPlanner(page, { program: { code: "MTIØT", name: "MTIØT", cohort: 2024 } });

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
  await gotoPlanner(page, { program: { code: "BSPL", name: "BSPL", cohort: 2026 } });

  const question = page.locator("#planner-direction");
  await expect(question).toBeVisible({ timeout: 30_000 });
  // The inline week question no longer carries its own chips — choosing a
  // direction happens in the studieinfo dialog, and the question's button
  // opens it with focus already on that select.
  await expect(question.locator("#planner-direction-btn")).toHaveText("Velg studieretning");
  await page.click("#planner-direction-btn");

  const dialog = studieinfoDialog(page);
  await expect(dialog).toBeVisible();
  const retningSelect = page.locator("#studieinfo-retning-select");
  await expect(retningSelect).toBeVisible({ timeout: 20_000 });
  await expect(retningSelect).toBeFocused();
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

  await page.reload();
  await expect(courseRows(page).first()).toBeVisible({ timeout: 30_000 });
});

test("drop and restore a programme course", async ({ page }) => {
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(courseRows(page)).toHaveCount(5, { timeout: 30_000 });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 30_000 });

  const code = await firstBlockCode(page);
  expect(code).not.toBe("");
  // the row IS the control, and the verb is inside the
  // settings modal it opens — two taps, which the user explicitly allowed in
  // place of PRODUCT §1.3's one.
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
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
  // From a plan-less planner the route into the add dialog is the first-run
  // screen's own quiet line: the bar that carries "Legg til emne" is gated off
  // until there is a plan for it to act on.
  await page.click("#planner-firstrun-add");
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
    await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
    await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    await page.goto("/");
    const label = page.locator("#home-now-label");
    // A card labelled "Nå" was computed once and then left: it claimed the
    // minute it was rendered in for as long as the tab stayed open.
    await expect(label).toHaveText("Nå, 90 min igjen", { timeout: 45_000 });
    await page.clock.runFor("00:10:00");
    await expect(label).toHaveText("Nå, 80 min igjen");

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
    await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  // ETT NAVN, and one statement of each fact in it: programme and kull here,
  // the term on its own control in the same bar (DESIGN §9).
  await expect(planTitle(page)).toHaveText("MTDT Kull 26");
  await expect(page.locator("#studieinfo-chip")).toHaveCount(0);
  // The topbar's child COUNT used to be asserted here as a proxy for "no plan
  // state up there". It was never that: it broke when a wrapper was added and
  // would have passed if a plan chip had replaced a nav link. `#studieinfo-chip`
  // above is the assertion that actually means it, and `navigation.pw.ts` makes
  // it on all four pages.
  await expect(page.locator("#site-account-btn")).toHaveText("Profil");

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

  await page.click('[data-role="view-tabs"] [data-view="tavle"]');
  await expect(page.locator(".planner-board").first()).toBeVisible();
  const atList = await ruleAt();
  // The rule TRAVELS to the second word rather than appearing under it.
  expect(Number.parseFloat(atList.x)).toBeGreaterThan(Number.parseFloat(atWeek.x));
  // "Liste" is the longer word — the rule is measured, not a fixed half.
  expect(Number.parseFloat(atList.w)).toBeGreaterThan(Number.parseFloat(atWeek.w));

  // …and back, so the travel is not one-way.
  await page.click('[data-role="view-tabs"] [data-view="kolonner"]');
  await expect(page.locator(".planner-cols").first()).toBeVisible();
  expect(Number.parseFloat((await ruleAt()).x)).toBe(Number.parseFloat(atWeek.x));

  // And the layer control is a box you tick, not a fourth view: it has a
  // check mark of its own and never takes the pressed FILL the old toggle did.
  const others = page.locator('[data-role="layer-toggle"]');
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
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
      await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
      await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
      expect(await undersized(page)).toEqual([]);

      // The øving layer brings the margin notes with it, and the list view
      // swaps the whole week for rows — both add targets the grid has not.
      //
      // Nothing on this bar folds any more: the week's controls went down to
      // the week's own section, where they fit 390px on one row, so the sweep
      // sees every control at every width with nothing to open first.
      await page.locator('[data-role="layer-toggle"]').click();
      await expect(page.locator(".planner-note-groups").first()).toBeVisible();
      expect(await undersized(page)).toEqual([]);

      await page.locator('[data-role="view-tabs"] [data-view="tavle"]').click();
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
      await gotoPlanner(page, { courses: ["TDT4109", "TDT4120"] });
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
    await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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

test("the layer leaves in the reverse of the order it arrived in", async ({ page }) => {
  // The sequence was already mirrored — space opens, then bars arrive; bars
  // leave, then space closes — but the STAGGER was not: departures all vanished
  // on the same frame, which is not the reverse of an order but the absence of
  // one.
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  const indices = (selector: string, prop: string) =>
    page.evaluate(
      ([sel, p]) =>
        Array.from(document.querySelectorAll(`#planner-grid-frame ${sel}`)).map((el) =>
          Number((el as HTMLElement).style.getPropertyValue(p)),
        ),
      [selector, prop] as const,
    );

  await page.locator('[data-role="layer-toggle"]').click();
  const arrive = await indices(".planner-cols-block.is-arriving, .planner-cols-band.is-arriving", "--planner-arrive");
  expect(arrive.length).toBeGreaterThan(1);
  // Reading order, ascending: 0, 1, 2 …
  expect(arrive).toEqual([...arrive].sort((a, b) => a - b));
  await page.waitForTimeout(1400);

  await page.locator('[data-role="layer-toggle"]').click();
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
  await gotoPlanner(page, { courses: ["TDT4120", "TMA4412"] });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await page.locator('[data-role="layer-toggle"]').click();
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
  await page.locator('[data-role="layer-toggle"]').click();
  await page.waitForTimeout(120);
  expect(await band()).toBe(open);
  await page.waitForTimeout(1200);
  const shut = await band();
  expect(shut).toBeLessThan(open);

  // Revealing: the space opens FIRST, so the row is already growing at 60 ms —
  // but it has not arrived, which is what proves it is a transition and not a
  // snap.
  await page.locator('[data-role="layer-toggle"]').click();
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
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
  await page.locator('[data-role="view-tabs"] [data-view="tavle"]').click();
  const board = page.locator("#planner-grid-frame .planner-board");
  await expect(board).toBeVisible();
  await page.waitForTimeout(900);

  const h = () => board.evaluate((el: HTMLElement) => Math.round(el.getBoundingClientRect().height));
  const short = await h();

  // Revealing: the space opens first, so the box is already growing but has
  // not arrived. Both halves matter — "already growing" rules out a stall,
  // "not arrived" rules out the snap.
  await page.locator('[data-role="layer-toggle"]').click();
  await page.waitForTimeout(70);
  const growing = await h();
  expect(growing).toBeGreaterThan(short);
  await page.waitForTimeout(1200);
  const tall = await h();
  expect(growing).toBeLessThan(tall);

  // Hiding: the box holds while the rows wipe out, then closes behind them.
  await page.locator('[data-role="layer-toggle"]').click();
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
    await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    const box = (sel: string) =>
      page.locator(sel).evaluate((el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      });
    const title = await box("#planner-title");
    const hint = await box("#planner-context-line");
    const verdict = await box("#planner-grid-status");
    const frame = await box("#planner-grid-frame");

    // Nothing fits between them: the gap is smaller than a line of text at any
    // step on the page's scale, so no sentence can have got in there. This is
    // the one geometric claim worth pinning — a control wrapping INTO the name
    // is the defect, and it is invisible in any DOM assertion.
    //
    // Where each individual control sits relative to the name is NOT asserted:
    // that is layout policy, it moved twice in one day, and its failures are
    // things you can see by looking.
    expect(hint.top - title.bottom).toBeLessThan(20);
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
    // so the site topbar is inside the budget too.
    //
    // Raised 0.35 → 0.37 when the qualified pass started printing on a phone:
    // the verdict and the deadline cannot share one 390px row, so a qualified
    // plan spends 27px more here than a plan whose pass says nothing. That is
    // the trade, made deliberately — the alternative was a margin note reading
    // "kollisjonssjekken er ufullstendig" with no verdict on screen for it to
    // qualify. An UNQUALIFIED pass is still hidden and still costs nothing,
    // which is what the sibling test below pins.
    //
    // History of this measurement, all at 390×844 on this same qualified plan:
    // 277 → 304 when the qualified pass started printing → **260** when the
    // bar folded into the ⋯ menu (2026-08-03). The fold bought back one row of
    // controls, 44px, not the two the plan estimated: the title's block and the
    // view switch still take a row each. The budget stays at 0.37 rather than
    // being tightened to the new number — it is the claim, not the reading.
    const viewport = page.viewportSize();
    expect(frame.top).toBeLessThan((viewport?.height ?? 844) * 0.37);
  });

  test("the verdict appears on a phone exactly when it has something to report", async ({
    page,
  }) => {
    // "ingen kollisjoner" is the answer to a question nobody asked; a
    // collision is not. TDT4120's Friday lecture collides with TDT4109's, the
    // clash the suite already establishes elsewhere.
    await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 }, courses: ["TDT4120"] });
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    const verdict = page.locator("#planner-grid-status");
    await expect(verdict).toBeVisible({ timeout: 30_000 });
    await expect(verdict).toContainText("kollisjon");
  });

  test("a clean plan spends no row on saying so, at any width", async ({ page }) => {
    // "Ingen forelesninger kolliderer" is gone: it answered a question a
    // student only asks when something might be wrong, and it spent a line of
    // the first screen on every load reporting that nothing is. A phone rule
    // used to hide it there, which was half of this admission already.
    //
    // What is tested is the MECHANISM, not the absence of a string: the line
    // takes no vertical space when it has nothing to say. TDT4110 and TDT4120
    // both publish real lectures and do not collide, so there is nothing.
    await gotoPlanner(page, { courses: ["TDT4110", "TDT4120"] });
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });
    const status = page.locator("#planner-grid-status");
    await expect
      .poll(async () => (await status.textContent())?.trim() ?? "", { timeout: 45_000 })
      .toBe("");
    const height = await status.evaluate((el: HTMLElement) => el.getBoundingClientRect().height);
    expect(height).toBe(0);
  });
});

test.describe("the phone's week", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the hours stay put while the week is dragged", async ({ page }) => {
    // Five days and eight hours do not fit a phone, so the axis scrolls — and
    // the one thing that may not scroll with it is the rail saying which hour
    // you are reading.
    await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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
    await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
    await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

    const fold = page.locator("#planner-grid-notes details.planner-notes-fold");
    await expect(fold).toBeVisible();
    // Closed on a phone, and the line still says the check is incomplete —
    // the fold may take the explanation, never the qualification.
    expect(await fold.evaluate((el: HTMLDetailsElement) => el.open)).toBe(false);
    await expect(fold.locator("summary")).toContainText("Kollisjonssjekken er ufullstendig");
    await expect(fold.locator(".planner-grid-note")).toBeHidden();

    await fold.locator("summary").click();
    await expect(fold.locator(".planner-grid-note")).toBeVisible();
  });
});

test("the week is not labelled 'Uke', but the region still has that name", async ({ page }) => {
  // A grid of weekdays under an hour ruler does not need to be told it is a
  // week. The heading stays in the tree because the section is named by it.
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
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

/**
 * "Del lenke" — the mark.
 *
 * The mark was an inline `<svg>` with no width, no height and no CSS of its
 * own. `base.css` gives every svg `display: block; max-width: 100%`, and as a
 * flex child that resolves to **0×0** — the button painted a hole where the
 * icon should be. Nothing below the browser could see it: the element was
 * there, the paths were right, and the layout is what was wrong.
 *
 * The control is an icon square now, pinned to the trailing edge of the plan's
 * row at every width, so the width half of this test is gone with the label it
 * was about: there is nothing left that can change size. What remains is that
 * the mark HAS a size, and that confirming swaps it rather than adding to it.
 */
test("del: the mark has a size, and confirming swaps it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Del hands over `/user/<navn>`, so it needs an account that is already
  // sharing; without one the button opens signup instead of copying, which is
  // its own behaviour and covered in publish.pw.ts.
  await seedSharingAccount(page);
  await gotoPlanner(page, { program: { code: "MTDT", name: "MTDT", cohort: 2026 } });
  await expect(gridBlocks(page).first()).toBeVisible({ timeout: 45_000 });

  const share = page.locator("#planner-share");
  await expect(share).toBeVisible();
  // The failure this guards is 0×0, not a particular figure — pinning the exact
  // px would just be transcribing whatever `size` says today.
  const mark = await share.locator(".planner-share-mark").boundingBox();
  expect(mark?.width ?? 0).toBeGreaterThan(8);
  expect(mark?.height ?? 0).toBeGreaterThan(8);
  const restBox = await share.boundingBox();

  await share.click();
  // The mark answers, and it is a swap, not an addition.
  await expect(share.locator(".planner-share-check")).toBeVisible();
  await expect(share.locator(".planner-share-mark")).toBeHidden();
  expect((await share.boundingBox())?.width).toBe(restBox?.width);

  // …and back.
  await expect(share.locator(".planner-share-mark")).toBeVisible({ timeout: 5000 });
  expect((await share.boundingBox())?.width).toBe(restBox?.width);
});

test.describe("the topbar's phone menu", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  /** A session shaped as `isValidSession` demands, so `renderName` sees it. */
  const seedSession = (page: Page) =>
    page.addInitScript(() => {
      localStorage.setItem(
        "np:sync",
        JSON.stringify({
          navn: "Kari Nordmann",
          authKey: "a",
          encKeyRaw: "b".repeat(64),
          version: 1,
          deviceId: "d1",
          label: "Chrome",
          devices: [{ id: "d1", label: "Chrome", lastSeen: "2026-08-01" }],
        }),
      );
    });

  /**
   * MECHANISM ONLY. What this describe used to assert — that the account is a
   * 44 px mark, that its text is hidden, that the bar has N children — was the
   * design restated in Playwright. It failed the moment the design changed and
   * had never caught a defect. DESIGN §9 is where the treatment is decided and
   * recorded; a test that only re-states it is transcription, not verification.
   *
   * What is left is what you cannot see by looking: the controls are still
   * REACHABLE at this width, the menu dismisses by every gesture it claims, and
   * it survives a soft navigation.
   */
  test("everything the bar holds is still reachable, and the menu dismisses", async ({ page }) => {
    await seedSession(page);
    await page.goto("/planlegger/");

    const menu = page.locator("#site-menu-btn");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");

    // The account, the toggle and both nav links are all operable from here.
    const btn = page.locator("#site-account-btn");
    await expect(btn).toBeVisible();
    await expect(page.locator("#site-account-name")).toHaveText("Kari Nordmann");
    await expect(page.locator(".theme-toggle")).toBeVisible();
    await expect(page.locator('#site-menu-panel a[href="/emner/"]')).toBeVisible();
    // Whoever you are is still on the accessible name, at every width.
    await expect(btn).toHaveAttribute("aria-label", "Profil for Kari Nordmann");

    // Esc, and focus returns to the control that opened it.
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();

    // The scrim is the outside-click target, and it goes with the menu.
    await menu.click();
    await page.locator(".np-menu-scrim").click({ position: { x: 10, y: 700 } });
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator(".np-menu-scrim")).toHaveCount(0);

    // And it is still the door.
    await menu.click();
    await btn.click();
    await expect(page.locator("#planner-profile-panel")).toBeVisible();
  });

  test("the menu survives a ClientRouter navigation", async ({ page }) => {
    // The failure that rots silently: hoisted scripts run ONCE per module, so a
    // top-level mount leaves this button dead after any in-site navigation.
    await page.goto("/planlegger/");
    const menu = page.locator("#site-menu-btn");
    await menu.click();
    await page.locator('#site-menu-panel a[href="/emner/"]').click();
    await expect(page).toHaveURL(/\/emner\/$/);
    const after = page.locator("#site-menu-btn");
    await after.click();
    await expect(after).toHaveAttribute("aria-expanded", "true");
  });

  test("above the breakpoint the same controls are operable without the menu", async ({ page }) => {
    // `display: contents` has to leave them ordinary children of the bar — the
    // wrapper must not become a box that reflows or hides anything.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/planlegger/");
    await expect(page.locator("#site-menu-btn")).toBeHidden();
    await expect(page.locator("#site-account-btn")).toBeVisible();
    await expect(page.locator(".theme-toggle")).toBeVisible();
    await expect(page.locator('.site-nav a[href="/emner/"]')).toBeVisible();
  });
});

test.describe("the programme picker lives on the planner", () => {
  test("the plan's title opens it, and the profile panel no longer carries it", async ({
    page,
  }) => {
    await page.goto("/planlegger/");
    // With no programme there is no title to be a door: the whole bar is gated
    // off and the picker is the screen instead, so the question "where do I say
    // which programme I am on" has exactly one answer on this page.
    await expect(page.locator("#planner-name-btn")).toBeHidden();
    await expect(page.locator("#planner-firstrun #studieinfo-program-input")).toBeVisible();

    // The account's door opens a room with no programme field IN it. Scoped to
    // the panel, not to the document: the picker holds that input the whole
    // time — it is just somewhere else now, which is the entire point of the
    // change.
    await page.locator("#site-account-btn").click();
    await expect(page.locator("#planner-profile-panel")).toBeVisible();
    await expect(page.locator("#planner-profile-panel #studieinfo-program-input")).toHaveCount(0);
  });

  test("a stored programme makes the title the way back into the picker", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "np:profile",
        JSON.stringify({ program: { code: "MTDT", cohort: 2026, name: "Datateknologi" } }),
      );
    });
    await page.goto("/planlegger/");
    const door = page.locator("#planner-name-btn");
    await expect(door).toContainText("MTDT");
    // At rest it is a NAME, not a button: no underline until the pointer is on
    // it, the same grammar `.planner-chip.is-jump` sets for the verdict.
    expect(
      await door.locator(".planner-title").evaluate((n) => getComputedStyle(n).textDecorationLine),
    ).toBe("none");
    // The accessible name is the errand, not the whole banner read end to end.
    await expect(door).toHaveAttribute("aria-label", "Endre studieprogram, MTDT kull 2026");
    await door.click();
    await expect(page.locator("#planner-studieinfo")).toBeVisible();
  });
});

/**
 * THE TWO BARS FIT, AND NOTHING GETS BETWEEN THE TWO TOGGLES.
 *
 * This replaces the fold tests. The planner's `⋯` menu is gone: the week's
 * controls went down to the week's own section, which left the plan's row
 * carrying a name, a term and a mark — about 250px of the 358px a 390px phone
 * has. What is worth testing is no longer "does it fold" but "does it still
 * fit", because that is the thing a future control silently breaks.
 *
 * The second assertion is the rule the whole arrangement rests on: the layer
 * box is the first thing in the week's control row and the view switch is the
 * last, with no element between them, at every width.
 */
test.describe("the plan's two bars", () => {
  const seedProgram = (page: Page) =>
    page.addInitScript(() => {
      localStorage.setItem(
        "np:profile",
        JSON.stringify({ program: { code: "MTDT", cohort: 2026, name: "Datateknologi" } }),
      );
    });

  for (const [label, width, height] of [
    ["390px", 390, 844],
    ["1280px", 1280, 800],
  ] as const) {
    test(`the plan's row is one row and its controls are reachable — ${label}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await seedProgram(page);
      await page.goto("/planlegger/");

      // ONE ROW: the head is no taller than the name block inside it, which is
      // what wrapping would change. Everything in it is on screen, so nothing
      // is a tap deep any more.
      const head = await page.locator(".planner-head").boundingBox();
      const name = await page.locator(".planner-name-text").boundingBox();
      expect(head?.height ?? 0).toBeLessThanOrEqual((name?.height ?? 0) + 4);
      await expect(page.locator("#planner-semester-select")).toBeVisible();
      await expect(page.locator('[data-role="week-select"]')).toBeVisible();
      await expect(page.locator('[data-role="layer-toggle"]')).toBeVisible();
      await expect(page.locator(".planner-view-tabs")).toBeVisible();
    });

    test(`nothing comes between the layer box and the view switch — ${label}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await seedProgram(page);
      await page.goto("/planlegger/");

      // The bar's own children, in DOM order: exactly two, in this order.
      const roles = await page.$$eval(".week-bar > *", (nodes) =>
        nodes.map((n) => n.getAttribute("data-role")),
      );
      expect(roles).toEqual(["layer-toggle", "view-tabs"]);

      // …and they sit at opposite ends of it.
      const bar = await page.locator(".week-bar").boundingBox();
      const layer = await page.locator('[data-role="layer-toggle"]').boundingBox();
      const tabs = await page.locator('[data-role="view-tabs"]').boundingBox();
      expect(layer?.x).toBeCloseTo(bar?.x ?? -1, 0);
      expect((tabs?.x ?? 0) + (tabs?.width ?? 0)).toBeCloseTo(
        (bar?.x ?? 0) + (bar?.width ?? 0),
        0,
      );
    });
  }

  test("the hand-over confirms in place and the plan's row does not move", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width: 390, height: 844 });
    await seedSharingAccount(page);
    await seedProgram(page);
    await page.goto("/planlegger/");

    const share = page.locator("#planner-share");
    await expect(share).toBeVisible({ timeout: 45_000 });
    const before = await share.boundingBox();
    await share.click();
    await expect(share.locator(".planner-share-check")).toBeVisible();
    // An icon square cannot change width, which is what the labelled version
    // needed a measured `minWidth` to guarantee.
    expect((await share.boundingBox())?.x).toBe(before?.x);
  });
});

test.describe("the course page says what its week is showing", () => {
  test("with no programme it states the scope and offers no switch", async ({ page }) => {
    await page.goto("/emne/TMA4400/");
    const line = page.locator(".timetable-scope");
    await expect(line).toContainText("Uka viser alle paralleller og grupper", {
      timeout: 45_000,
    });
    await expect(line).toContainText("Velg studieprogram i planleggeren");
    // Nothing to narrow TO, so the control would be one that does nothing.
    await expect(page.locator(".timetable-mine")).toHaveCount(0);
  });

  test("a stored programme buys a switch to your own slice, and it resets per course", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "np:profile",
        JSON.stringify({ program: { code: "MTDT", cohort: 2026, name: "Datateknologi" } }),
      );
    });
    // TMA4400 partitions its lectures by programme cluster — 21 entries down to
    // 8 for MTDT — which is the fact `contract.pw.ts` pins against live NTNU.
    await page.goto("/emne/TMA4400/");
    const mine = page.locator(".timetable-mine");
    await expect(mine).toBeVisible({ timeout: 45_000 });
    await expect(mine).toHaveAttribute("aria-pressed", "false");

    // View-agnostic on purpose: the claim is that narrowing DRAWS FEWER
    // sessions, which is true in Uke and in Liste, and the student's view
    // choice is shared across surfaces now.
    const blocks = page.locator(
      "#timetable-section .planner-cols-block, #timetable-section .planner-board-row",
    );
    const before = await blocks.count();
    expect(before).toBeGreaterThan(0);

    await mine.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".timetable-scope")).toContainText("Viser undervisningen for MTDT");
    await expect.poll(() => blocks.count()).toBeLessThan(before);

    // Per visit, never persisted: the same URL has to show two people the same
    // week, so the next course page opens on "all" again.
    await page.goto("/emne/TDT4160/");
    const next = page.locator(".timetable-mine");
    await expect(next).toBeVisible({ timeout: 45_000 });
    await expect(next).toHaveAttribute("aria-pressed", "false");
  });
});

/**
 * ONE WEEK, THREE SURFACES.
 *
 * `/planlegger/`, `/emne/[code]/` and `/user/<navn>` draw the same two views
 * through the same controller. For a while they did not: the planner moved to
 * Uke and Liste while the course page stayed on the transposed geometry, which
 * had been deleted as a view but kept alive as a module for it.
 *
 * These test the MECHANISM rather than the look — that the choice travels, and
 * that a course taught in another term still draws something. Neither is
 * visible by looking at one page.
 */
test.describe("the course page draws the week the planner draws", () => {
  test("the view choice is one fact, and it crosses surfaces", async ({ page }) => {
    // `np:weekView` is a preference about how you read a week, not about which
    // week you are reading — so a student who chose a list on a phone chose it
    // for weeks, not for one page.
    await page.addInitScript(() => localStorage.setItem("np:weekView", "tavle"));
    await page.goto("/emne/TDT4120/");
    await expect(page.locator("#timetable-section .planner-board")).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.locator('#timetable-section [data-view="tavle"]')).toHaveAttribute("aria-pressed", "true");

    // And the pair on this page really switches it, rather than being decoration
    // beside a week only the planner can change.
    await page.click('#timetable-section [data-view="kolonner"]');
    await expect(page.locator("#timetable-section .planner-cols")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("np:weekView"))).toBe("kolonner");
  });

  test("a course taught in the other term still draws its own week", async ({ page }) => {
    // TDT4100's only entries are 2026_VÅR while the canonical semester is Høst
    // 2026, so `entriesForSemester` falls back to the term the response
    // actually carries. Both views then filter through `entriesInSemester`, and
    // handing them the PLANNED semester's teaching weeks filters that fallback
    // straight back out — an empty week where last term's honest timetable
    // belongs. `weeksOf` is what stops it.
    await page.goto("/emne/TDT4100/");
    const week = page.locator("#timetable-section .planner-cols, #timetable-section .planner-board");
    await expect(week).toBeVisible({ timeout: 45_000 });
    const sessions = await page
      .locator("#timetable-section .planner-cols-block, #timetable-section .planner-board-row")
      .count();
    expect(sessions, "an off-term course drew an empty week").toBeGreaterThan(0);
    // And it says which term that is, rather than passing spring off as autumn.
    await expect(page.locator(".timetable-term")).toContainText("Ikke undervist i Høst 2026");
  });

  test("«Vis øvinger og labber» actually adds øvinger", async ({ page }) => {
    // A control that visibly does nothing is the failure this page has been
    // fixed for twice. Here it was two filters meeting: `showAllGroups` selected
    // every group, and `visibleLayer` then dropped each one again on
    // `isLecture || groupPicked` — right for a plan, where it stops nine
    // unpicked seminar groups flooding one week, and wrong for a surface that
    // has no picks to make.
    await page.goto("/emne/TDT4120/");
    const sessions = page.locator(
      "#timetable-section .planner-cols-block, #timetable-section .planner-cols-band",
    );
    await expect(sessions.first()).toBeVisible({ timeout: 45_000 });
    const lecturesOnly = await sessions.count();

    const toggle = page.locator('#timetable-section [data-role="layer-toggle"]');
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => sessions.count()).toBeGreaterThan(lecturesOnly);

    // And back: the layer leaves as visibly as it arrived.
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => sessions.count()).toBe(lecturesOnly);
  });

  test("a block opens the session, and offers no editor this page does not have", async ({
    page,
  }) => {
    // The popover is a READ card, which is exactly what a visitor deciding
    // between five parallels needs. What it must NOT carry here is the verb:
    // there is no course-settings modal on this page to send them to.
    await page.goto("/emne/TDT4120/");
    const block = page.locator("#timetable-section .planner-cols-block").first();
    await expect(block).toBeVisible({ timeout: 45_000 });
    await block.click();
    const popover = page.locator("#planner-block-popover");
    await expect(popover).toBeVisible();
    await expect(popover.locator(".block-popover-edit")).toHaveCount(0);
    // The way OUT is the course itself, which every popover carries.
    await expect(popover.locator(".np-link-out")).toBeVisible();
  });
});
