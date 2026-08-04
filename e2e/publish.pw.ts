import { expect, gotoPlanner, test } from "./harness.js";

/**
 * Sharing, end to end, over the real worker and wrangler's local KV — the same
 * carve-out `sync.pw.ts` runs under, and for the same reason: `/api/sync/*` and
 * `/api/plan/*` are our own surface, so replaying them would assert against a
 * recording of ourselves.
 *
 * The load-bearing claim is the last one in the first test: the viewer's own
 * plan is untouched. That is the whole of what changed when the `#v2;…` hash
 * was deleted — a link used to overwrite the recipient's storage and offer it
 * back, and now it shows you a page.
 */

/** A fresh account per run: KV is real and outlives the test. */
function freshName(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}`;
}

const PIN = "482913";

test("a shared plan is viewable by a stranger and changes nothing for them", async ({
  browser,
}) => {
  const navn = freshName("e2e-pub");

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await gotoPlanner(ownerPage, { courses: ["TDT4120"] });

  await ownerPage.getByRole("button", { name: "Profil" }).click();
  // The panel opens on login; creating the account is the other form.
  await ownerPage.locator("#profile-panel-switch").click();
  await ownerPage.getByLabel("Navn").fill(navn);
  await ownerPage.getByLabel("PIN (6 siffer)").fill(PIN);
  await ownerPage.getByLabel("Gjenta PIN").fill(PIN);
  await ownerPage.getByRole("button", { name: "Opprett konto" }).click();
  await expect(ownerPage.getByText("Sist synkronisert")).toBeVisible({ timeout: 45_000 });

  // The switch is a standing state on the account, so it lives in the panel
  // next to the device list rather than behind the planner's Del button.
  await ownerPage.getByRole("button", { name: "Del planen min" }).click();
  await expect(ownerPage.getByRole("button", { name: "Ikke del lenger" })).toBeVisible({
    timeout: 30_000,
  });
  await ownerPage.locator(".profile-panel-close").click();

  const viewer = await browser.newContext();
  const viewerPage = await viewer.newPage();
  // The viewer arrives with a plan of their own, which is the case that used
  // to be destroyed.
  await viewerPage.addInitScript(() => {
    localStorage.setItem(
      "np:plans",
      '{"26h":[{"code":"MIN-EGEN","name":"Min egen","version":"1","source":"manual"}]}',
    );
  });
  await viewerPage.goto(`/user/${navn}`);

  await expect(viewerPage.getByText("TDT4120").first()).toBeVisible({ timeout: 45_000 });
  await expect(viewerPage.getByRole("link", { name: "Lag din egen plan" })).toBeVisible();
  // The owner's name is what the page is about.
  await expect(viewerPage.locator(".public-plan-title")).toHaveText(navn);

  // THE POINT: the viewer's own plan is untouched, and nothing asked them
  // about it.
  expect(await viewerPage.evaluate(() => localStorage.getItem("np:plans"))).toBe(
    '{"26h":[{"code":"MIN-EGEN","name":"Min egen","version":"1","source":"manual"}]}',
  );
  await expect(viewerPage.getByText("Behold min egen")).toHaveCount(0);

  await owner.close();
  await viewer.close();
});

test("the shared page is live: an edit by the owner reaches it", async ({ browser }) => {
  const navn = freshName("e2e-live");

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await gotoPlanner(ownerPage, { courses: ["TDT4120"] });

  await ownerPage.getByRole("button", { name: "Profil" }).click();
  // The panel opens on login; creating the account is the other form.
  await ownerPage.locator("#profile-panel-switch").click();
  await ownerPage.getByLabel("Navn").fill(navn);
  await ownerPage.getByLabel("PIN (6 siffer)").fill(PIN);
  await ownerPage.getByLabel("Gjenta PIN").fill(PIN);
  await ownerPage.getByRole("button", { name: "Opprett konto" }).click();
  await expect(ownerPage.getByText("Sist synkronisert")).toBeVisible({ timeout: 45_000 });
  await ownerPage.getByRole("button", { name: "Del planen min" }).click();
  await expect(ownerPage.getByRole("button", { name: "Ikke del lenger" })).toBeVisible({
    timeout: 30_000,
  });
  await ownerPage.locator(".profile-panel-close").click();

  // An ordinary edit, through the ordinary push. Nothing re-publishes by hand.
  await ownerPage.click("#planner-add-course-btn");
  const addDialog = ownerPage.locator("#planner-add-dialog");
  await expect(addDialog).toBeVisible();
  await addDialog.locator("input.add-course-input").fill("TDT4110");
  const row = addDialog.locator(".add-course-row", { hasText: "TDT4110" }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.locator(".add-course-add").click();
  await expect(row.locator(".add-course-added")).toBeVisible();
  await addDialog.locator(".add-course-close").click();

  // Past `schedulePush`'s 1s debounce, then read the public copy back.
  await expect
    .poll(
      async () => {
        const res = await ownerPage.request.get(`/api/plan/${navn}`);
        if (!res.ok()) return "";
        return String(((await res.json()) as { plain?: string }).plain ?? "");
      },
      { timeout: 30_000 },
    )
    .toContain("TDT4110");

  await owner.close();
});

test("turning sharing off takes the page down", async ({ browser }) => {
  const navn = freshName("e2e-off");

  const context = await browser.newContext();
  const page = await context.newPage();
  await gotoPlanner(page, { courses: ["TDT4120"] });

  await page.getByRole("button", { name: "Profil" }).click();
  // The panel opens on login; creating the account is the other form.
  await page.locator("#profile-panel-switch").click();
  await page.getByLabel("Navn").fill(navn);
  await page.getByLabel("PIN (6 siffer)").fill(PIN);
  await page.getByLabel("Gjenta PIN").fill(PIN);
  await page.getByRole("button", { name: "Opprett konto" }).click();
  await expect(page.getByText("Sist synkronisert")).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "Del planen min" }).click();
  const off = page.getByRole("button", { name: "Ikke del lenger" });
  await expect(off).toBeVisible({ timeout: 30_000 });
  expect((await page.request.get(`/api/plan/${navn}`)).status()).toBe(200);

  await off.click();
  await expect(page.getByRole("button", { name: "Del planen min" })).toBeVisible({
    timeout: 30_000,
  });
  expect((await page.request.get(`/api/plan/${navn}`)).status()).toBe(404);

  await context.close();
});

test("an unshared name is a plain not-found, not an error page", async ({ page }) => {
  await page.goto("/user/finnes-ikke-i-det-hele-tatt");
  await expect(page.getByText("Fant ingen delt plan her.")).toBeVisible({ timeout: 30_000 });
  // A name that exists but is not shared must be indistinguishable from one
  // that does not — the page cannot become a name-enumeration oracle either.
  await expect(page.getByRole("link", { name: "Lag din egen plan" })).toBeVisible();
});

test("a shared plan refuses indexing by header", async ({ request }) => {
  const res = await request.get("/user/whoever");
  expect(res.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  // Belt and braces, for a crawler that reads the document but not the headers.
  expect(await res.text()).toContain('name="robots" content="noindex, nofollow"');
});

test("…and still unfurls richly, because those are different crawlers", async ({ browser }) => {
  const navn = freshName("e2e-unfurl");

  const context = await browser.newContext();
  const page = await context.newPage();
  await gotoPlanner(page, { courses: ["TDT4120"] });

  await page.getByRole("button", { name: "Profil" }).click();
  // The panel opens on login; creating the account is the other form.
  await page.locator("#profile-panel-switch").click();
  await page.getByLabel("Navn").fill(navn);
  await page.getByLabel("PIN (6 siffer)").fill(PIN);
  await page.getByLabel("Gjenta PIN").fill(PIN);
  await page.getByRole("button", { name: "Opprett konto" }).click();
  await expect(page.getByText("Sist synkronisert")).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "Del planen min" }).click();
  await expect(page.getByRole("button", { name: "Ikke del lenger" })).toBeVisible({
    timeout: 30_000,
  });

  // What an unfurler sees: raw HTML, no JavaScript run.
  const html = await (await page.request.get(`/user/${navn}`)).text();
  expect(html).toContain(`content="${navn} deler en plan"`);
  expect(html).toMatch(/property="og:description" content="1 emne, /);

  // The card is a real image, not a 404 wearing a PNG name — it is hand-encoded
  // (no rendering dependency in this repo), so something has to open it.
  const card = await page.request.get("/og-card.png");
  expect(card.status()).toBe(200);
  const size = await page.evaluate(
    () =>
      new Promise<[number, number]>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve([img.naturalWidth, img.naturalHeight]);
        img.onerror = () => reject(new Error("og-card.png did not decode"));
        img.src = "/og-card.png";
      }),
  );
  expect(size).toEqual([1200, 630]);

  await context.close();
});
