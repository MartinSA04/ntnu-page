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
  await phone.getByLabel("Navn").fill(navn);
  await phone.getByLabel("PIN (6 siffer)").fill(pin);
  // Enter, not a click on "Opprett konto": that button is the form's one
  // `type="submit"` control (profilePanel.ts's own comment on `signupBtn`),
  // so this is the real Enter-to-submit path, previously exercised only by
  // unit tests and code inspection — never a running browser. The sibling
  // test below covers a plain button click (Logg inn), so both dispatch
  // paths are driven for real across this file.
  await phone.getByLabel("Gjenta PIN").fill(pin);
  await phone.getByLabel("Gjenta PIN").press("Enter");
  await expect(phone.getByText("Sist synkronisert")).toBeVisible();

  const second = await browser.newContext();
  const laptop = await second.newPage();
  await laptop.goto("/planlegger/");
  await laptop.getByRole("button", { name: "Profil" }).click();
  await laptop.getByLabel("Navn").fill(navn);
  await laptop.getByLabel("PIN (6 siffer)").fill(pin);
  await laptop.getByRole("button", { name: "Logg inn" }).click();

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
  await page.getByRole("button", { name: "Logg inn" }).click();

  await expect(page.getByText("Fant ingen konto med det navnet.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("np:sync"))).toBeFalsy();
});
