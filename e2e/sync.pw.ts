import { expect } from "@playwright/test";
import { test } from "./harness.js";

/**
 * Sync over the REAL worker and wrangler's local KV — deliberately not
 * fixture-replayed. The `/api/*` record/replay layer exists to make upstream
 * NTNU deterministic; `/api/sync/*` is our own surface, and replaying it would
 * assert against a recording of ourselves.
 */
test("a plan reaches a second browser context through an account", async ({ browser }) => {
  const navn = `e2e-${Date.now().toString(36)}`;
  const pin = "482913";

  const first = await browser.newContext();
  const phone = await first.newPage();
  await phone.goto("/planlegger/");
  // Cast to a tuple, not left as the inferred `string[]`: this repo's
  // `tsconfig.test.json` sets `noUncheckedIndexedAccess`, which would
  // otherwise widen `key`/`value` in the destructure below to `string |
  // undefined` and fail `localStorage.setItem`'s signature. Type-only; the
  // runtime value and the test's intent are unchanged.
  await phone.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    ["np:plans", '{"26h":[{"code":"TDT4120","name":"Algoritmer og datastrukturer"}]}'] as [
      string,
      string,
    ],
  );
  await phone.reload();

  await phone.getByRole("button", { name: "Profil" }).click();
  // The panel opens on LOGIN. Creating an account is the other form, one link
  // below the button — so a new student takes that link, and this is the press
  // that gets them there.
  await phone.locator("#profile-panel-switch").click();
  await phone.getByLabel("Navn").fill(navn);
  await phone.getByLabel("PIN (6 siffer)").fill(pin);
  // Enter, not a click on the submit: it is the form's one `type="submit"`
  // control, so this is the real Enter-to-submit path, and with a mode it now
  // lands somewhere unambiguous rather than on whichever of two co-equal
  // buttons the engine picked. The sibling test below covers a plain click.
  await phone.getByLabel("Gjenta PIN").fill(pin);
  await phone.getByLabel("Gjenta PIN").press("Enter");
  await expect(phone.getByText("Sist synkronisert")).toBeVisible();

  // The topbar starts saying who you are the moment the session exists — and
  // keeps saying it BEFORE first paint on the next load, from the pre-paint
  // script under the button. Without that, a signed-in student watched
  // "Profil" turn into their own name on every page they opened.
  await expect(phone.locator("#site-account-name")).toHaveText(navn);
  await phone.locator(".profile-panel-close").click();
  await phone.goto("/emner/");
  expect(
    await phone.locator("#site-account-name").evaluate((el) => el.textContent),
  ).toBe(navn);

  const second = await browser.newContext();
  const laptop = await second.newPage();
  await laptop.goto("/planlegger/");
  await laptop.getByRole("button", { name: "Profil" }).click();
  await laptop.getByLabel("Navn").fill(navn);
  await laptop.getByLabel("PIN (6 siffer)").fill(pin);
  await laptop.locator("#profile-panel-submit").click();

  // `.first()`: a landed plan prints TDT4120 three times over (the week grid,
  // the exam list, the course rail) — once the pulled plan actually repaints,
  // a bare `getByText` is a Playwright strict-mode violation, not a failure.
  await expect(laptop.getByText("TDT4120").first()).toBeVisible({ timeout: 45_000 });

  await first.close();
  await second.close();
});

test("a wrong PIN is refused and changes nothing locally", async ({ page }) => {
  await page.goto("/planlegger/");
  await page.getByRole("button", { name: "Profil" }).click();
  await page.getByLabel("Navn").fill("finnes-ikke-heller");
  await page.getByLabel("PIN (6 siffer)").fill("000000");
  await page.locator("#profile-panel-submit").click();

  await expect(page.getByText("Fant ingen konto med det navnet.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("np:sync"))).toBeFalsy();
});

/**
 * Some fresh visitors are returning ones. The mechanism: the two cold surfaces
 * offer a way into the account in LOGIN mode, and neither of them gates the
 * thing the student came for.
 */
test("a returning student can log in from first run and from the landing page", async ({
  page,
}) => {
  await page.goto("/planlegger/");
  await expect(page.locator("#planner-firstrun")).toBeVisible({ timeout: 15_000 });
  await page.locator("#planner-firstrun-login").click();
  await expect(page.locator("#profile-panel-submit")).toHaveText("Logg inn");

  // Nothing was gated: dismissing leaves the screen exactly where it was, with
  // its own path still the loudest thing on it.
  await page.keyboard.press("Escape");
  await expect(page.locator("#planner-firstrun")).toBeVisible();
  await expect(page.locator("#studieinfo-program-input")).toBeVisible();

  await page.goto("/");
  await page.locator("#home-login").click();
  await expect(page.locator("#profile-panel-submit")).toHaveText("Logg inn");
});

/**
 * Login and register are two paths, not two buttons over one set of fields.
 * The mechanism, not the look: which action a submit means, what each form
 * asks for, and whether a wrong guess strands the student.
 */
test("login and register are separate forms, and the switch keeps the name", async ({ page }) => {
  await page.goto("/planlegger/");
  await page.getByRole("button", { name: "Profil" }).click();

  // Login: one submit, and no PIN confirmation, because there is nothing to
  // confirm against — the server says whether the PIN is right.
  const submit = page.locator("#profile-panel-submit");
  await expect(submit).toHaveText("Logg inn");
  await expect(page.getByLabel("Gjenta PIN")).toHaveCount(0);

  await page.getByLabel("Navn").fill("kari");
  await page.getByLabel("PIN (6 siffer)").fill("123456");
  await page.locator("#profile-panel-switch").click();

  // Register asks for the PIN twice, and the switch carried the name across
  // but NOT the PIN: it means a different thing on this side.
  await expect(submit).toHaveText("Opprett konto");
  await expect(page.getByLabel("Gjenta PIN")).toBeVisible();
  await expect(page.getByLabel("Navn")).toHaveValue("kari");
  await expect(page.getByLabel("PIN (6 siffer)")).toHaveValue("");

  // A wrong guess is never a dead end: the refusal names the other form, and
  // that form is one press away.
  await page.getByLabel("PIN (6 siffer)").fill("123456");
  await page.getByLabel("Gjenta PIN").fill("654321");
  await submit.click();
  await expect(page.getByText("PIN-ene er ikke like.")).toBeVisible();
  await expect(page.locator("#profile-panel-switch")).toHaveText("Logg inn");
});
