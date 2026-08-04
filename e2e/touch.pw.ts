import { devices, type Page } from "@playwright/test";
import { expect, gotoPlanner, test } from "./harness.js";

/**
 * What a dismissing TAP must not do: reach whatever was underneath.
 *
 * A touch produces its compatibility mouse burst — `mousedown`, `mouseup`,
 * `click` — only AFTER `touchend`, which is after `pointerup`. Any surface that
 * dismisses itself at or before `pointerup` is therefore gone by the time the
 * click is dispatched, and the browser hit-tests that click against the page it
 * left behind. One tap dismissed the sheet AND pressed the control under it:
 * a semester changed, a layer toggled, a link navigated.
 *
 * It is not one surface's bug and it is not always ours — Chrome's own
 * `closedby="any"` light dismiss closes at `pointerup`, so a modal whose whole
 * contract is that the document behind it is inert leaks the click anyway.
 * Hence one spec over all three dismissal idioms rather than three assertions
 * living beside three implementations.
 *
 * The only project is Desktop Chrome, so the phone is asked for here: below
 * 480px the topbar folds into a menu and below 60rem the session card is a
 * bottom sheet, and neither shape exists at the desktop width the rest of the
 * suite runs at.
 */
test.use({ ...devices["Pixel 7"] });

/**
 * Records every click that reaches the document, in the CAPTURE phase so a
 * leaked click is still seen when the thing it landed on stops propagation.
 *
 * A dismissal absorbing its own click is the fix working, not a leak: the scrim
 * IS the element the tap hit, and a modal still open at click time retargets the
 * tap to itself. So a target inside the dismissing surface is filtered out, and
 * anything else reaching the document is the page underneath being pressed.
 */
async function watchForLeaks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const leaks: string[] = [];
    (window as unknown as { __leaks: string[] }).__leaks = leaks;
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as Element | null;
        if (target?.closest("dialog, .np-menu-scrim, .block-popover-scrim")) return;
        leaks.push(target?.id || target?.className || target?.tagName || "?");
      },
      true,
    );
  });
}

const leaks = (page: Page): Promise<string[]> =>
  page.evaluate(() => (window as unknown as { __leaks: string[] }).__leaks);

/** Taps a point clear of an open surface: under it when there is room, else over it. */
async function tapOutside(page: Page, surface: string): Promise<void> {
  const box = await page.locator(surface).boundingBox();
  if (!box) throw new Error(`${surface} is not on screen`);
  const view = page.viewportSize();
  if (!view) throw new Error("no viewport");
  const below = box.y + box.height + 48;
  const y = below < view.height - 8 ? below : Math.max(8, box.y - 32);
  await page.touchscreen.tap(Math.round(view.width / 2), Math.round(y));
}

test("a tap that dismisses the add-course modal does not press the page under it", async ({
  page,
}) => {
  await gotoPlanner(page, { courses: ["TDT4109"] });
  await page.click("#planner-add-course-btn");
  const dialog = page.locator("#planner-add-dialog");
  await expect(dialog).toBeVisible();

  await watchForLeaks(page);
  await tapOutside(page, "#planner-add-dialog");

  await expect(dialog).toBeHidden();
  expect(await leaks(page)).toEqual([]);
});

test("a tap that dismisses the topbar menu does not press the page under it", async ({ page }) => {
  await gotoPlanner(page, { courses: ["TDT4109"] });
  await page.click("#site-menu-btn");
  const bar = page.locator(".site-topbar");
  await expect(bar).toHaveAttribute("data-menu", "open");

  await watchForLeaks(page);
  const view = page.viewportSize();
  if (!view) throw new Error("no viewport");
  await page.touchscreen.tap(Math.round(view.width / 2), Math.round(view.height * 0.6));

  await expect(bar).not.toHaveAttribute("data-menu", "open");
  expect(await leaks(page)).toEqual([]);
});

/**
 * The other half, and the one the guard could plausibly get wrong: a cancelled
 * click that is never spent must not sit there waiting to eat the next real
 * one. Both directions are checked from a dismissal, since that is the only
 * state in which anything is ever armed.
 */
test("the tap after a dismissal is still a tap", async ({ page }) => {
  await gotoPlanner(page, { courses: ["TDT4109"] });
  const dialog = page.locator("#planner-add-dialog");
  const openBtn = page.locator("#planner-add-course-btn");

  await openBtn.tap();
  await expect(dialog).toBeVisible();
  await tapOutside(page, "#planner-add-dialog");
  await expect(dialog).toBeHidden();

  await openBtn.tap();
  await expect(dialog).toBeVisible();
  // And a control INSIDE the modal still answers, so the guard is not eating
  // the modal's own clicks on the way in.
  await dialog.locator(".add-course-close").tap();
  await expect(dialog).toBeHidden();
});

/**
 * The property `closedby="any"` was chosen for and had to survive losing it: a
 * text selection dragged from inside the card and released on the backdrop is
 * not a dismissal. The click's target is the dialog either way — it is the
 * common ancestor of where the drag began and ended — so only requiring the
 * gesture to START outside can tell the two apart.
 */
test("a drag released on the backdrop is not a dismissal", async ({ page }) => {
  await gotoPlanner(page, { courses: ["TDT4109"] });
  await page.click("#planner-add-course-btn");
  const dialog = page.locator("#planner-add-dialog");
  await expect(dialog).toBeVisible();

  const field = await dialog.locator("input.add-course-input").boundingBox();
  const box = await dialog.boundingBox();
  if (!field || !box) throw new Error("dialog is not on screen");
  await page.mouse.move(field.x + 8, field.y + field.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 60, { steps: 8 });
  await page.mouse.up();

  await expect(dialog).toBeVisible();
});

test("a tap that dismisses the session sheet does not press the page under it", async ({ page }) => {
  await gotoPlanner(page, { courses: ["TDT4109"] });
  const block = page.locator("#planner-grid-frame .planner-cols-block").first();
  await expect(block).toBeVisible({ timeout: 45_000 });
  await block.click();
  const popover = page.locator("#planner-block-popover");
  await expect(popover).toBeVisible();

  await watchForLeaks(page);
  await tapOutside(page, "#planner-block-popover");

  await expect(popover).toBeHidden();
  expect(await leaks(page)).toEqual([]);
});
