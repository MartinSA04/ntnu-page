# Planner Chrome Re-cut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move programme/kull/studieretning off the site header and back onto `/planlegger/` behind the plan's own title, collapse both chrome bars into menus on a phone, and make `/emne/[code]/` state that its week is every parallel with a switch to narrow it.

**Architecture:** Three phases, shippable in order. (A) extracts `buildStudieinfoSection` out of the profile panel into its own planner-owned `<dialog>`, opened from the plan title. (B) adds one shared menu controller (`src/lib/menuPanel.ts`) driving two collapsible wrappers — the wrapper is `display: contents` above its breakpoint and an absolutely-positioned panel below it, so there is one DOM and no duplicated ids. (C) adds two pure helpers to `courseTimetable.ts` plus a second `.np-toggle`.

**Tech Stack:** Astro 5 + ClientRouter, vanilla TS islands, hand-written CSS with custom properties, vitest (no jsdom — hand-rolled shim), Playwright (`*.pw.ts`) over recorded `/api` fixtures.

**Spec:** `docs/superpowers/specs/2026-08-03-planner-chrome-recut-design.md`

## Global Constraints

- UI copy is **Norwegian bokmål, sentence case**, comma decimals ("7,5 sp").
- `mise run check` and `mise run e2e` must both stay green.
- Every per-page setup goes through `onPage(setup)` (`src/lib/pageLifecycle.ts`) and binds listeners with `{ signal }`. Top-level mounting leaves the page dead after a ClientRouter swap.
- Never use `[hidden]` for a state that must stay laid out — `primitives.css`'s `[hidden] { display: none !important }` beats every author `display`, including `display: contents`.
- Unit tests (`tests/**`) cover **pure exported functions only**; the repo ships no jsdom. Anything visual, focus-related or CSS-dependent belongs in `e2e/*.pw.ts`.
- Upstream NTNU knowledge stays in the `ntnu-api` package; this repo holds product policy only.
- `data/*.json` and `public/data/search-index.json` are gitignored crawler output — never commit them.
- Biome runs with `--error-on-warnings`. Run `npm run fmt` before committing.

## Running tests

- Unit: `npx vitest run tests/site/courseTimetable.test.ts` (or `mise run check` for the full fast pass).
- Browser, full: `mise run e2e`.
- Browser, iterating: start the server once with `npm run build && npx wrangler dev --port 8788 --ip 127.0.0.1`, then `npx playwright test e2e/flows.pw.ts -g "menu"` in another shell. `webServer.reuseExistingServer` picks up the running one.

---

# Phase A — Studieinfo returns to the planner

### Task 1: The studieinfo dialog, and the profile panel loses its section

**Files:**
- Create: `src/components/planner/studieinfoDialog.ts`
- Modify: `src/components/planner/profilePanel.ts` (remove the section: import at :58, the `buildStudieinfoSection` block at :484-495, both `body.append(studieinfo.element, renderDivider())` at :505 and :657, and `studieinfo.reset()` / `focusDirection()` / `focusProgram()` in `show()` at :902-913)
- Modify: `src/components/planner/plannerApp.ts` (`openProfile` at :456, call sites at :1794 and :2605)
- Modify: `tests/planner/plannerApp.test.ts` (:2599 `vi.doUnmock`, comments at :239, :1054, :1405)
- Test: `e2e/flows.pw.ts`

**Interfaces:**
- Consumes: `buildStudieinfoSection(deps: StudieinfoSectionDeps): StudieinfoSectionHandle` from `./studieinfo.js`, where `StudieinfoSectionHandle` is `{ element: HTMLElement; reset(): void; focusProgram(): void; focusDirection(): void }` and `StudieinfoSectionDeps` is `{ store: PlanStore; onSaved: () => void }`.
- Produces:
  - `export type StudieinfoFocus = "program" | "direction"`
  - `export interface StudieinfoDialogHandle { open(focus?: StudieinfoFocus): void; close(): void }`
  - `export function mountStudieinfoDialog(store: PlanStore, signal: AbortSignal): StudieinfoDialogHandle`
  - `ProfileFocus` and `ProfilePanelHandle.show(focus?)` in `profilePanel.ts` lose their parameter: `show(): void`.

- [ ] **Step 1: Write the failing e2e test**

Add to `e2e/flows.pw.ts`:

```ts
test.describe("the programme picker lives on the planner", () => {
  test("the plan's title opens it, and the profile panel no longer carries it", async ({ page }) => {
    await page.goto("/planlegger/");
    // The empty state's own primary route still lands in the programme field.
    await page.getByRole("button", { name: "Velg studieprogram" }).click();
    const dialog = page.locator("#planner-studieinfo");
    await expect(dialog).toBeVisible();
    await expect(page.locator("#studieinfo-program-input")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The account's door opens a room with no programme field in it.
    await page.locator("#site-account-btn").click();
    await expect(page.locator(".profile-panel-dialog")).toBeVisible();
    await expect(page.locator("#studieinfo-program-input")).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/flows.pw.ts -g "programme picker lives on the planner"`
Expected: FAIL — `#planner-studieinfo` never appears (the empty state opens the profile panel today).

- [ ] **Step 3: Create the dialog module**

Create `src/components/planner/studieinfoDialog.ts`:

```ts
/**
 * Studieinfo — programme, kull, studieretning — as the planner's own dialog.
 *
 * It was a SECTION of the profile panel, which the topbar opened from every
 * page. That put the picker behind the account's door on all four surfaces;
 * this puts it behind the plan's own name on the one surface the plan lives
 * on. The account keeps the topbar, because sign-in governs `np:plans`
 * synchronisation and is genuinely site-wide; a programme is a fact about the
 * plan you are building here.
 *
 * The section itself is unchanged and unmoved — `buildStudieinfoSection`
 * already returns a self-contained handle, so this file is only the room it
 * stands in. Same modal pattern as `courseSettings.ts`: built with `el`,
 * `showModal()`, `closedby="any"`, appended to `document.body`, idempotent
 * against a stale dialog left by a previous mount.
 *
 * Built ONCE per mount rather than per open: the section stages edits and holds
 * in-flight study-plan fetches, so rebuilding it would throw away a half-picked
 * programme. `reset()` on every open is what discards one deliberately.
 */
import type { PlanStore } from "../../lib/planner/store.js";
import { el, icon } from "./dom.js";
import { buildStudieinfoSection, type StudieinfoSectionHandle } from "./studieinfo.js";

/** Which control the caller sent the student here to answer. */
export type StudieinfoFocus = "program" | "direction";

export interface StudieinfoDialogHandle {
  open(focus?: StudieinfoFocus): void;
  close(): void;
}

export function mountStudieinfoDialog(
  store: PlanStore,
  signal: AbortSignal,
): StudieinfoDialogHandle {
  document.getElementById("planner-studieinfo")?.remove();

  const dialog = el("dialog", "np-frame studieinfo-dialog");
  dialog.id = "planner-studieinfo";
  dialog.setAttribute("aria-labelledby", "studieinfo-dialog-title");
  // Light dismiss: Esc and a backdrop click. Nothing is written until Lagre, so
  // a stray click discards a half-picked programme rather than committing one —
  // which is the same contract the section had inside the profile panel.
  dialog.setAttribute("closedby", "any");
  document.body.append(dialog);

  function close(): void {
    if (dialog.open) dialog.close();
  }

  const section: StudieinfoSectionHandle = buildStudieinfoSection({
    store,
    // A saved studieinfo is a finished errand: the week behind the dialog has
    // already redrawn, so staying open would leave the student looking at the
    // form they just submitted instead of at the answer.
    onSaved: () => close(),
  });

  const head = el("div", "np-head studieinfo-dialog-head");
  const ident = el("div", "np-head-ident");
  const title = el("h2", "np-head-title", "Studieprogram");
  title.id = "studieinfo-dialog-title";
  ident.append(title);
  const closeBtn = el("button", "np-icon-btn studieinfo-dialog-close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Lukk");
  closeBtn.append(icon("x"));
  closeBtn.addEventListener("click", close, { signal });
  head.append(ident, closeBtn);

  const body = el("div", "studieinfo-dialog-body");
  body.append(section.element);
  dialog.append(head, body);

  signal.addEventListener("abort", () => dialog.remove());

  return {
    open(focus?: StudieinfoFocus): void {
      // Re-staged from the store on every open, so a programme abandoned last
      // time is gone rather than resurrected.
      section.reset();
      dialog.scrollTop = 0;
      if (!dialog.open) dialog.showModal();
      if (focus === "direction") section.focusDirection();
      else if (focus === "program") section.focusProgram();
    },
    close,
  };
}
```

- [ ] **Step 4: Add the dialog's styles**

Append to `src/styles/site.css`, after the `.profile-panel-dialog::backdrop` rule:

```css
/* --- Studieinfo, the planner's own dialog --------------------------------
   Same surface grammar as the profile panel it came out of: a `.np-frame`
   `<dialog>` centred by `showModal()`, capped so a long programme list scrolls
   inside the card rather than growing it past the viewport. */
.studieinfo-dialog {
  width: min(34rem, calc(100vw - var(--space-6)));
  max-height: min(44rem, calc(100dvh - var(--space-6)));
  padding: 0;
  overflow-y: auto;
}

.studieinfo-dialog::backdrop {
  background: color-mix(in srgb, var(--fg) 45%, transparent);
}

.studieinfo-dialog-head {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: var(--space-4) var(--space-4) var(--space-3);
  background: var(--bg);
}

.studieinfo-dialog-body {
  padding: 0 var(--space-4) var(--space-4);
}
```

- [ ] **Step 5: Rewire `plannerApp.ts`**

At `src/components/planner/plannerApp.ts`, replace the `openProfile` helper (:456) and its doc comment with:

```ts
  const studieinfoDialog = mountStudieinfoDialog(store, lifeSignal);

  /**
   * Opens the programme picker, with the caret on whichever control asked for
   * it. It is the planner's own dialog now — the topbar's door leads to the
   * account, which is a different room.
   */
  function openStudieinfo(focus?: StudieinfoFocus): void {
    studieinfoDialog.open(focus);
  }
```

Add the import beside the other `./studieinfo.js` import:

```ts
import {
  mountStudieinfoDialog,
  type StudieinfoFocus,
} from "./studieinfoDialog.js";
```

Rename both call sites: `openProfile("direction")` → `openStudieinfo("direction")` (:1794) and `openProfile("program")` → `openStudieinfo("program")` (:2605). Delete the now-unused `ProfileFocus` import if `plannerApp.ts` imported it. Leave every `accountPanel()?.setSyncState(...)` call untouched.

- [ ] **Step 6: Strip the section out of `profilePanel.ts`**

- Delete the `buildStudieinfoSection` import (:58) and the `const studieinfo: StudieinfoSectionHandle = buildStudieinfoSection({...})` block with its doc comment (:476-495).
- In `renderSignedOut` (:505) and `renderSignedIn` (:657), change `body.append(studieinfo.element, renderDivider());` to append nothing — delete the line in both. Check whether `renderDivider` still has a caller; if not, delete it too.
- In `show()` (:902-913): delete the `studieinfo.reset()` call and the two `focus` branches, and change the signature to `show(): void`.
- Delete `export type ProfileFocus` (:115) and change `ProfilePanelHandle.show` to `show(): void`.
- Update the module doc comment: the panel is the account's room only; studieinfo moved to `studieinfoDialog.ts` because a programme describes the plan, and the plan lives on `/planlegger/`.

- [ ] **Step 7: Fix the unit test's module mock**

In `tests/planner/plannerApp.test.ts`, the `vi.doUnmock("../../src/components/planner/profilePanel.js")` at :2599 pairs with a `vi.doMock` earlier in the file. Find that mock and add the same treatment for `../../src/components/planner/studieinfoDialog.js`, stubbing `mountStudieinfoDialog` to return `{ open() {}, close() {} }`. Update the stale comments at :239, :1054 and :1405 to say the picker is the planner's dialog rather than the topbar's panel.

- [ ] **Step 8: Run the unit suite**

Run: `npx vitest run tests/planner/`
Expected: PASS. If `profilePanel.test.ts` referenced `ProfileFocus`, drop that reference.

- [ ] **Step 9: Run the e2e test**

Run: `npx playwright test e2e/flows.pw.ts -g "programme picker lives on the planner"`
Expected: PASS.

- [ ] **Step 10: Format, lint, commit**

```bash
npm run fmt
npx biome check --error-on-warnings .
git add src/components/planner/studieinfoDialog.ts src/components/planner/profilePanel.ts src/components/planner/plannerApp.ts src/styles/site.css tests/planner/plannerApp.test.ts e2e/flows.pw.ts
git commit -m "feat(planner): studieinfo is the planner's own dialog again

A programme describes the plan, and the plan lives on /planlegger/. The
account keeps the topbar because sign-in governs np:plans and is
genuinely site-wide; the picker does not.

buildStudieinfoSection already returned a self-contained handle, so the
move is the room around it, not the section."
```

---

### Task 2: The plan's title is the door

**Files:**
- Modify: `src/pages/planlegger/index.astro` (`.planner-name` markup ~:37-45, scoped styles after `.planner-title` ~:482-498)
- Modify: `src/components/planner/plannerApp.ts` (`elements` map ~:272, `renderBanner` ~:1223)
- Test: `e2e/flows.pw.ts`

**Interfaces:**
- Consumes: `openStudieinfo(focus?: StudieinfoFocus): void` from Task 1.
- Produces: `#planner-name-btn`, a `<button>` wrapping the title and context line.

- [ ] **Step 1: Write the failing e2e test**

Add to the `test.describe` from Task 1 in `e2e/flows.pw.ts`:

```ts
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
  // At rest it is a name, not a button: no underline until the pointer is on it.
  expect(
    await door.evaluate((n) => getComputedStyle(n).textDecorationLine),
  ).toBe("none");
  await door.click();
  await expect(page.locator("#planner-studieinfo")).toBeVisible();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/flows.pw.ts -g "way back into the picker"`
Expected: FAIL — `#planner-name-btn` does not exist.

- [ ] **Step 3: Change the markup**

In `src/pages/planlegger/index.astro`, replace the `.planner-name` block:

```astro
      {/* THE NAME IS THE DOOR. The title states the plan's programme and kull;
          pressing it is how you change them. That costs no width in the bar —
          which is why the picker's entrance is here rather than a fifth
          control in the action run that a phone would then have to fold into
          the ⋯ menu.

          Underlined on HOVER only, the grammar `.planner-chip.is-jump`
          already sets for the collision verdict: at rest this is the plan's
          name and has to read as one. The chevron is what carries the
          affordance while nothing is hovering it. */}
      <button type="button" class="planner-name" id="planner-name-btn">
        <span class="planner-name-text">
          <h1 class="planner-title" id="planner-title">Semesterplan</h1>
          {/* Always filled by `renderBanner` — the programme's long name, or the
              semester the empty week is for — so the one line it will occupy is
              held from first paint rather than appearing at mount and pushing
              the whole page down 21px. */}
          <p class="np-hint planner-context-line" id="planner-context-line"></p>
        </span>
        <svg
          class="planner-name-mark"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
          focusable="false"><path d="m6 9 6 6 6-6"></path></svg>
      </button>
```

- [ ] **Step 4: Style it**

In the same file's `<style>` block, replace the `.planner-name` rule with:

```css
  /* Pushes everything else to the far end, and is allowed to shrink first: a
     42-character programme name may ellipsise, a control may not.

     A button that does not look like one — no paper, no border, no padding
     beyond the text. `text-align: start` because a `<button>` centres its
     content by default, which would have moved the whole identity block. */
  .planner-name {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    margin-inline-end: auto;
    min-width: 0;
    padding: 0;
    background: none;
    border: 0;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: pointer;
  }

  .planner-name-text {
    min-width: 0;
  }

  /* The affordance at rest. It does not turn: this opens a modal, not a
     disclosure under itself, so there is no open state for it to reflect. */
  .planner-name-mark {
    flex: none;
    width: 18px;
    height: 18px;
    color: var(--muted);
    transition: color var(--dur-fast) var(--ease);
  }

  .planner-name:hover .planner-title,
  .planner-name:focus-visible .planner-title {
    text-decoration: underline;
    text-underline-offset: 4px;
  }

  .planner-name:hover .planner-name-mark {
    color: var(--fg);
  }
```

- [ ] **Step 5: Register the element and keep the a11y name honest**

In `src/components/planner/plannerApp.ts`, add to the `elements` map beside `title` (:272):

```ts
    nameBtn: byId<HTMLElement>("planner-name-btn"),
```

and to the interface beside `contextLine` (:234):

```ts
  nameBtn: HTMLElement;
```

At the end of `renderBanner`, after the context line is filled, add:

```ts
    // The button's accessible name is the plan it opens the picker for, not
    // the two child elements read end to end — "MTDT Kull 26 Uke 34 ·
    // Datateknologi" is the whole banner spoken as one control's label.
    elements.nameBtn.setAttribute(
      "aria-label",
      program
        ? `Endre studieprogram · ${program.code} kull ${program.cohort}`
        : "Velg studieprogram",
    );
```

and wire the click once, near where the other static controls are bound:

```ts
  elements.nameBtn.addEventListener("click", () => openStudieinfo("program"), {
    signal: lifeSignal,
  });
```

- [ ] **Step 6: Run the e2e tests**

Run: `npx playwright test e2e/flows.pw.ts -g "programme picker lives on the planner"`
Expected: PASS (both tests in the describe).

- [ ] **Step 7: Commit**

```bash
npm run fmt
git add src/pages/planlegger/index.astro src/components/planner/plannerApp.ts e2e/flows.pw.ts
git commit -m "feat(planner): the plan's name is the door into the picker

Press the fact to change the fact. It costs no width in the bar, which
is why the entrance is here rather than a fifth control in the action
run that a phone would have to fold into the menu.

Underlined on hover only, on .planner-chip.is-jump's grammar: at rest
this is the plan's name and has to read as one."
```

---

### Task 3: Amend PRODUCT for the mandate change

**Files:**
- Modify: `docs/PRODUCT.md` (mandate 8 at :41-47, §5 on-ramp at :158-163, §6 note at :260-264)
- Modify: `docs/DESIGN.md` (§9's plan-bar bullet — the "Two of the bar's original five left" paragraph)

**Interfaces:** none — documentation only.

- [ ] **Step 1: Rewrite mandate 8**

Replace mandate 8's "Delivered" clause. It currently names the topbar profile panel as its own answer; it now reads that programme/kull/retning editing is delivered as the planner's own dialog, opened from the plan's name, and that the account is a separate site-wide door in the topbar. Keep the mandate's first sentence ("because people have webpage patterns they are used to") verbatim — that is the standing instruction; only the delivery note changes.

- [ ] **Step 2: Correct §5's on-ramp paragraph**

The line "its 'Velg studieprogram' opens the profile panel with the caret already in the programme field, and that panel's studieinfo section is the only picker on the site" becomes: opens the planner's studieinfo dialog with the caret already in the programme field, and that dialog is the only picker on the site.

- [ ] **Step 3: Correct §6's deletion note**

"kull relevance and plan fetch into the studieinfo section of the profile panel" becomes "into the planner's studieinfo dialog". Same for D14's row in §10's decision table.

- [ ] **Step 4: Amend DESIGN §9's plan-bar bullet**

The paragraph beginning "Two of the bar's original five left on 2026-08-03" records **Profil** going to the site topbar. Add that studieinfo came back on the same day, behind the plan's own name, and that what stayed in the topbar is the account alone. State the reason in one line: a programme is a fact about the plan, sign-in is a fact about the person.

- [ ] **Step 5: Commit**

```bash
git add docs/PRODUCT.md docs/DESIGN.md
git commit -m "docs: the picker is the planner's, the account is the site's

Mandate 8's instruction is unchanged; its delivery note is not. A real
settings surface for programme/kull/retning now means the planner's own
dialog behind the plan's name, with the account left in the topbar as a
separate site-wide door."
```

---

# Phase B — Both bars collapse to a menu on a phone

### Task 4: The shared menu controller

**Files:**
- Create: `src/lib/menuPanel.ts`
- Modify: `src/styles/primitives.css` (append the scrim)
- Test: none of its own — Tasks 5 and 6 are its tests.

**Interfaces:**
- Produces:
  - `export interface MenuPanelOptions { bar: HTMLElement; trigger: HTMLElement; panel: HTMLElement; query: string; signal: AbortSignal }`
  - `export interface MenuPanelHandle { close(): void; isOpen(): boolean }`
  - `export function mountMenuPanel(options: MenuPanelOptions): MenuPanelHandle`

- [ ] **Step 1: Write the module**

Create `src/lib/menuPanel.ts`:

```ts
/**
 * One collapsible chrome menu, driven from a wrapper that changes clothes.
 *
 * ABOVE its breakpoint the wrapper is `display: contents` and its children lay
 * out as direct children of the bar, exactly as they would with no menu at all;
 * BELOW it the wrapper is an absolutely-positioned panel, drawn only while the
 * bar carries `data-menu="open"`. That is the whole mechanism, and it is why
 * this is a positioned `div` rather than a `<dialog>` or a `[popover]`: neither
 * of those can be switched back to inline layout by CSS, and switching is the
 * entire point. One DOM means one set of ids, which matters because every
 * control involved is bound by identity somewhere else.
 *
 * The open state lives on the BAR as `data-menu`, never as `[hidden]` on the
 * wrapper: `primitives.css`'s `[hidden] { display: none !important }` beats any
 * author `display`, `display: contents` included, so hiding the wrapper that
 * way would delete the controls at every width.
 *
 * A non-`<dialog>` surface gets no free dismissal, so Esc, the scrim and
 * `focusout` are wired here — the same hand-rolled set `blockPopover.ts`
 * carries, for the same reason. The scrim doubles as the outside-click target:
 * one element to hit-test beats document-level geometry.
 */
export interface MenuPanelOptions {
  /** Carries `data-menu="open"`; also the positioning context for the panel. */
  bar: HTMLElement;
  /** The button that opens it. Gets `aria-expanded`. */
  trigger: HTMLElement;
  /** The wrapper: `display: contents` above the breakpoint, a panel below it. */
  panel: HTMLElement;
  /** The width range in which the panel IS a panel, e.g. `"(max-width: 480px)"`. */
  query: string;
  signal: AbortSignal;
}

export interface MenuPanelHandle {
  close(): void;
  isOpen(): boolean;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])';

export function mountMenuPanel(options: MenuPanelOptions): MenuPanelHandle {
  const { bar, trigger, panel, query, signal } = options;
  const media = window.matchMedia(query);
  let scrim: HTMLElement | null = null;

  const isOpen = (): boolean => bar.dataset.menu === "open";

  function close(): void {
    if (!isOpen()) return;
    delete bar.dataset.menu;
    trigger.setAttribute("aria-expanded", "false");
    scrim?.remove();
    scrim = null;
    // Only reclaim focus if it is still inside the panel we are closing —
    // otherwise a click on something else would be yanked back to the trigger.
    if (panel.contains(document.activeElement)) trigger.focus();
  }

  function open(): void {
    if (isOpen() || !media.matches) return;
    bar.dataset.menu = "open";
    trigger.setAttribute("aria-expanded", "true");
    scrim = document.createElement("div");
    scrim.className = "np-menu-scrim";
    scrim.addEventListener("pointerdown", close);
    document.body.append(scrim);
    panel.querySelector<HTMLElement>(FOCUSABLE)?.focus();
  }

  trigger.addEventListener(
    "click",
    () => {
      if (isOpen()) close();
      else open();
    },
    { signal },
  );

  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape" && isOpen()) {
        event.preventDefault();
        close();
      }
    },
    { signal },
  );

  // Tabbing out of a menu is being done with it — the same rule `blockPopover`
  // applies. `relatedTarget` is null when focus leaves the document entirely
  // (a tab switch, devtools), which is NOT a dismissal.
  panel.addEventListener(
    "focusout",
    (event) => {
      const next = (event as FocusEvent).relatedTarget;
      if (!(next instanceof Node)) return;
      if (panel.contains(next) || trigger.contains(next)) return;
      close();
    },
    { signal },
  );

  // Crossing the breakpoint while open would leave `data-menu` set on a bar
  // whose wrapper is inline again — a scrim over a menu that is not there.
  media.addEventListener("change", () => close(), { signal });

  signal.addEventListener("abort", () => {
    scrim?.remove();
    scrim = null;
  });

  return { close, isOpen };
}
```

- [ ] **Step 2: Add the scrim primitive**

Append to `src/styles/primitives.css`, after the `.np-frame` rule:

```css
/* --- Chrome menus --------------------------------------------------
   The dim behind an open `☰`/`⋯` panel, and the surface that catches the click
   that closes it. Below the panel (which raises its own bar to 21) and above
   everything else. 32 % matches `.course-settings::backdrop` — a dropdown is a
   lighter surface than a modal, and these two are the same idiom. */
.np-menu-scrim {
  position: fixed;
  inset: 0;
  z-index: 19;
  background: color-mix(in srgb, var(--fg) 32%, transparent);
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
npm run fmt
git add src/lib/menuPanel.ts src/styles/primitives.css
git commit -m "feat(chrome): one controller for a bar that folds into a menu

The wrapper is display:contents above its breakpoint and a positioned
panel below it, so there is one DOM and one set of ids. Not a <dialog>
and not [popover]: neither can be switched back to inline layout by CSS,
and switching is the entire point.

The open state is data-menu on the bar, never [hidden] on the wrapper —
that rule beats display:contents and would delete the controls at every
width."
```

---

### Task 5: The shell topbar's `☰`

**Files:**
- Modify: `src/layouts/Layout.astro` (the `<header class="site-topbar">` block ~:257-276)
- Modify: `src/components/ThemeToggle.astro` (add the label span; change the default `label` prop)
- Modify: `src/styles/site.css` (the two `@media (max-width: 480px)` blocks ~:119-160)
- Test: `e2e/flows.pw.ts` (rewrite "the account on a phone" at ~:2048)

**Interfaces:**
- Consumes: `mountMenuPanel` from Task 4.
- Produces: `#site-menu-btn`, `#site-menu-panel`.

- [ ] **Step 1: Rewrite the superseded test**

In `e2e/flows.pw.ts`, the `test.describe("the account on a phone", …)` block asserts the account is a 44 px mark alone in the bar. Replace its first test with:

```ts
  test("lives in the menu, where it can say who you are", async ({ page }) => {
    await seedSession(page);
    await page.goto("/planlegger/");

    // Closed: the bar is the wordmark and one control.
    const btn = page.locator("#site-account-btn");
    await expect(btn).toBeHidden();
    await expect(page.locator(".site-brand-suffix")).toBeVisible();

    const menu = page.locator("#site-menu-btn");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");

    // Open: the name is VISIBLE here. That is the whole reason this beats the
    // bare mark it replaced — at 6ch the mark said "you" and nothing else.
    await expect(btn).toBeVisible();
    await expect(page.locator("#site-account-name")).toHaveText("Kari Nordmann");
    await expect(btn).toHaveAttribute("aria-label", "Profil · Kari Nordmann");

    // ONE ROW still. §6's phone gate measures the week's top from the
    // viewport's top, so a topbar that wrapped would come out of the week.
    const bar = await page.locator(".site-topbar").boundingBox();
    expect(bar?.height).toBeLessThanOrEqual(64);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
  });
```

Replace the second test ("signed out it is the same control") with the same shape minus the seed, asserting `#site-account-name` reads `Profil` and `aria-label` is `Profil`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/flows.pw.ts -g "the account on a phone"`
Expected: FAIL — `#site-menu-btn` does not exist.

- [ ] **Step 3: Wrap the topbar's controls**

In `src/layouts/Layout.astro`, replace the nav/account/theme run inside `<header class="site-topbar">`:

```astro
        {/* THE RUN THAT FOLDS. Above 480px this wrapper is `display: contents`
            and these are ordinary children of the bar; below it, it is the
            menu's panel. One DOM either way — every control in here is bound
            by id somewhere else, so a duplicated phone copy would collide. */}
        <div class="site-menu-panel" id="site-menu-panel">
          <nav class="site-nav" aria-label="Hovednavigasjon">
            {
              NAV.map((item) => (
                <a
                  class="np-navlink"
                  href={item.href}
                  aria-current={isCurrentSection(item.sections) ? "page" : undefined}
                >
                  {item.label}
                </a>
              ))
            }
          </nav>
          {/* Links go somewhere; the two below change something. */}
          <hr class="site-menu-sep" />
          <AccountButton defaultSemesterId={DEFAULT_SEMESTER_ID} />
          <ThemeToggle storageKey={THEME_KEY} />
        </div>
        <button
          type="button"
          class="np-icon-btn site-menu-btn"
          id="site-menu-btn"
          aria-controls="site-menu-panel"
          aria-expanded="false"
          aria-label="Meny"
        >
          <Icon name="menu" size={20} />
        </button>
```

Add `import Icon from "../components/Icon.astro";` to the frontmatter.

- [ ] **Step 4: Mount the controller**

Add a `<script>` block at the end of `Layout.astro`'s `<body>`, after the footer:

```astro
    <script>
      import { mountMenuPanel } from "../lib/menuPanel.ts";
      import { onPage } from "../lib/pageLifecycle.ts";

      // Per page-load: the topbar is re-rendered by the server on every
      // ClientRouter swap, so a top-level mount would leave the button dead
      // after any in-site navigation.
      onPage((signal) => {
        const bar = document.querySelector<HTMLElement>(".site-topbar");
        const trigger = document.getElementById("site-menu-btn");
        const panel = document.getElementById("site-menu-panel");
        if (!bar || !trigger || !panel) return;
        mountMenuPanel({ bar, trigger, panel, query: "(max-width: 480px)", signal });
      });
    </script>
```

- [ ] **Step 5: Give the theme toggle a visible label**

In `src/components/ThemeToggle.astro`, change the default prop from `label = "Bytt tema"` to `label = "Mørkt tema"` (so the accessible name matches the visible text inside the panel — WCAG 2.5.3) and add the span as the button's last child:

```astro
  <span class="theme-toggle-label">Mørkt tema</span>
```

Do **not** style it in the component's scoped `<style>` — scoped rules outrank global ones, and site.css needs to switch it per width.

- [ ] **Step 6: Rewrite the topbar's phone CSS**

In `src/styles/site.css`, replace both `@media (max-width: 480px)` blocks (~:119-160) with:

```css
/* The run that folds. Above the breakpoint the wrapper is not a box at all —
   its children are the bar's own flex children, laid out exactly as they were
   before the menu existed. */
.site-menu-panel {
  display: contents;
}

.site-menu-btn,
.site-menu-sep,
.theme-toggle-label {
  display: none;
}

/* Narrow phones: the bar is the wordmark and one control, and everything else
   is a panel under it.

   The wordmark comes back WHOLE. It used to step down a size and ellipsise to
   buy room for two nav links and two icon buttons; with those in the menu the
   bar spends ~148px on the brand and 44 on the trigger out of 360, so the
   step-down, the ellipsis and the dropped mono suffix are all repealed. */
@media (max-width: 480px) {
  .site-topbar {
    gap: var(--gap-2);
  }

  /* Raised above the scrim (19) while open, so the trigger stays visible and
     hittable. The panel is a child, so it stacks inside this context. */
  .site-topbar[data-menu="open"] {
    z-index: 21;
  }

  .site-menu-btn {
    display: inline-flex;
    margin-left: auto;
  }

  .site-menu-panel {
    position: absolute;
    top: calc(var(--topbar-h) - var(--space-2));
    right: var(--gutter);
    z-index: 1;
    display: none;
    flex-direction: column;
    align-items: stretch;
    min-width: 13rem;
    max-width: calc(100vw - var(--gutter) * 2);
    padding: var(--space-2);
    background: var(--bg);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow);
  }

  .site-topbar[data-menu="open"] .site-menu-panel {
    display: flex;
  }

  /* The two links become two panel rows rather than a row inside a column. */
  .site-menu-panel .site-nav {
    display: contents;
  }

  .site-menu-sep {
    display: block;
    height: 1px;
    margin: var(--space-2) 0;
    background: var(--border);
    border: 0;
  }

  /* Every row is a phone target and reads left-aligned. `.site-account` and
     `.theme-toggle` are otherwise a bare navlink and an icon square. */
  .site-menu-panel .np-navlink,
  .site-menu-panel .site-account,
  .site-menu-panel .theme-toggle {
    justify-content: flex-start;
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-2);
  }

  /* Stacked in one grid cell at desktop because it is icon-only there; a row
     here, with the label beside the mark. Only one glyph is ever displayed,
     so flex is safe. */
  .site-menu-panel .theme-toggle {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
  }

  .theme-toggle-label {
    display: inline;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }

  /* The name is the point of the row — it is what the bare mark could not say.
     No 10ch cap here: a menu row has the width for a person's name. */
  .site-account-name {
    max-width: none;
  }
}
```

Delete the old `.site-account { justify-content: center; min-width: 44px; … }`, `.site-account-name { display: none }`, `.site-brand-suffix { display: none }` and `.site-brand { … font-size: var(--text-base) }` phone rules — all four are repealed by the menu.

- [ ] **Step 7: Run the e2e tests**

Run: `npx playwright test e2e/flows.pw.ts -g "the account on a phone"`
Expected: PASS.

- [ ] **Step 8: Check the desktop path did not move**

Run: `npx playwright test e2e/navigation.pw.ts`
Expected: PASS — it drives `.site-nav a` and `.theme-toggle` at `devices["Desktop Chrome"]`, above the breakpoint, so `display: contents` must have left them exactly where they were.

- [ ] **Step 9: Commit**

```bash
npm run fmt
git add src/layouts/Layout.astro src/components/ThemeToggle.astro src/styles/site.css e2e/flows.pw.ts
git commit -m "feat(chrome): the topbar folds into a menu on a phone

Nav, account and theme go behind one ☰ below 480px, which buys the
wordmark back whole — the size step-down, the ellipsis and the dropped
mono suffix were all paying for controls that are now in the panel.

The account's name is VISIBLE in the menu. That reverses this morning's
mark-alone decision and is the reason to make the change: at 6ch the
mark said 'you' and nothing else.

Theme toggle's accessible name becomes 'Mørkt tema' so it matches the
visible label the panel gives it (WCAG 2.5.3)."
```

---

### Task 6: The planner bar's `⋯`, and the reorder

**Files:**
- Modify: `src/pages/planlegger/index.astro` (`.planner-head` markup ~:47-151 and its scoped styles ~:296-571)
- Modify: `src/components/planner/plannerApp.ts` (mount the controller)
- Modify: `src/components/Icon.astro` (add `more`)
- Test: `e2e/flows.pw.ts`

**Interfaces:**
- Consumes: `mountMenuPanel` from Task 4.
- Produces: `#planner-tools-btn`, `#planner-tools`.

- [ ] **Step 1: Write the failing e2e test**

Add to `e2e/flows.pw.ts`:

```ts
test.describe("the plan bar on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("folds to the view switch and one menu, and the week keeps the room", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "np:profile",
        JSON.stringify({ program: { code: "MTDT", cohort: 2026, name: "Datateknologi" } }),
      );
    });
    await page.goto("/planlegger/");

    await expect(page.locator(".planner-view-tabs")).toBeVisible();
    await expect(page.locator("#planner-others-toggle")).toBeHidden();
    await expect(page.locator("#planner-semester-select")).toBeHidden();

    const menu = page.locator("#planner-tools-btn");
    await menu.click();
    await expect(page.locator("#planner-others-toggle")).toBeVisible();
    await expect(page.locator("#planner-semester-select")).toBeVisible();

    // A control that REDRAWS THE WEEK closes the menu, because the redraw is
    // animated on purpose and you cannot follow it under a scrim.
    await page.locator("#planner-others-toggle").click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");

    // A control that only confirms ITSELF does not — the "Kopiert" swap is the
    // whole point of the button and closing would throw it away.
    await menu.click();
    const share = page.locator("#planner-share");
    if (await share.isVisible()) {
      await share.click();
      await expect(menu).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#planner-share-label")).toHaveText("Kopiert");
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/flows.pw.ts -g "the plan bar on a phone"`
Expected: FAIL — `#planner-tools-btn` does not exist.

- [ ] **Step 3: Add the `more` glyph**

In `src/components/Icon.astro`'s `PATHS`, beside `menu`:

```ts
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
```

- [ ] **Step 4: Reorder and wrap the plan bar**

In `src/pages/planlegger/index.astro`, inside `.planner-head`, move the markup into this order — the layer toggle, the share button and the semester select go **inside** a new wrapper, and the view tabs move to **after** it:

```astro
      {/* THE RUN THAT FOLDS, and it is ordered so that folding needs no
          `order:` tricks: the three controls that collapse come first, the
          switch that stays comes last. DOM order, visual order and tab order
          agree at both widths. It also lands the view switch at the far right,
          where Google Calendar and Apple Calendar put theirs. */}
      <div class="planner-tools" id="planner-tools">
        … the existing `#planner-others-toggle` button, unchanged …
        … the existing `#planner-share` button, unchanged …
        … the existing `.np-select-shell.planner-semester` div, unchanged …
      </div>
      … the existing `.planner-view-tabs` div, unchanged, now AFTER the wrapper …
      <button
        type="button"
        class="np-icon-btn planner-tools-btn"
        id="planner-tools-btn"
        aria-controls="planner-tools"
        aria-expanded="false"
        aria-label="Flere valg for planen"
      >
        <Icon name="more" size={20} />
      </button>
```

Keep every id, class and comment on the three moved controls exactly as they are.

- [ ] **Step 5: Style the wrapper and the trigger**

In the same file's `<style>`, add after `.planner-semester`:

```css
  /* Above 46rem this is not a box: its three children are the bar's own flex
     children, in the order they are written. */
  .planner-tools {
    display: contents;
  }

  .planner-tools-btn {
    display: none;
  }

  @media (max-width: 46rem) {
    /* The bar is the plan's name, the view switch and one menu. Two rows of
       controls come off the top of the page, which is the week's budget under
       DESIGN §6's phone gate. */
    .planner-head {
      position: relative;
    }

    .planner-head[data-menu="open"] {
      z-index: 21;
    }

    .planner-tools-btn {
      display: inline-flex;
    }

    .planner-tools {
      position: absolute;
      top: calc(100% + var(--space-2));
      right: 0;
      z-index: 1;
      display: none;
      flex-direction: column;
      align-items: stretch;
      gap: var(--space-2);
      min-width: 14rem;
      max-width: calc(100vw - var(--gutter) * 2);
      padding: var(--space-2);
      background: var(--bg);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-lg);
      box-shadow: var(--shadow);
    }

    .planner-head[data-menu="open"] .planner-tools {
      display: flex;
    }

    /* Every row is a phone target and reads left-aligned. */
    .planner-tools > * {
      justify-content: flex-start;
      width: 100%;
      min-height: 44px;
    }
  }
```

- [ ] **Step 6: Mount the controller and wire the close rule**

In `src/components/planner/plannerApp.ts`, after the other static bindings:

```ts
  // THE MENU'S ONE RULE: a control that redraws the week closes it; a control
  // that only confirms itself stays open. The layer and the semester are
  // animated switches (DESIGN §7) and a student who threw one has to be able
  // to follow it — which they cannot do under a scrim. "Del lenke" swaps to
  // "Kopiert" in place, and closing would throw that confirmation away.
  const toolsBar = document.querySelector<HTMLElement>(".planner-head");
  const toolsTrigger = document.getElementById("planner-tools-btn");
  const toolsPanel = document.getElementById("planner-tools");
  if (toolsBar && toolsTrigger && toolsPanel) {
    const tools = mountMenuPanel({
      bar: toolsBar,
      trigger: toolsTrigger,
      panel: toolsPanel,
      query: "(max-width: 46rem)",
      signal: lifeSignal,
    });
    elements.othersToggle.addEventListener("click", () => tools.close(), {
      signal: lifeSignal,
    });
    elements.semesterSelect.addEventListener("change", () => tools.close(), {
      signal: lifeSignal,
    });
  }
```

Import `mountMenuPanel` from `../../lib/menuPanel.js`. Use whatever the `elements` map already calls the layer toggle and the semester select; if they are not in it, reach them by id.

- [ ] **Step 7: Run the e2e tests**

Run: `npx playwright test e2e/flows.pw.ts -g "the plan bar on a phone"`
Expected: PASS.

- [ ] **Step 8: Re-measure the phone gate and record the real number**

Run: `npx playwright test e2e/flows.pw.ts -g "37"` (the gate assertion near `flows.pw.ts:1858`).
Expected: PASS with more slack than before. Then read the actual measured top:

```bash
npx playwright test e2e/flows.pw.ts -g "37" --reporter=list 2>&1 | tail -20
```

If the test does not print the figure, add a temporary `console.log(frame.top)` inside it, run, record the number, and remove the log. Put the measured value into DESIGN §6 in Task 7 — **do not estimate it**.

- [ ] **Step 9: Commit**

```bash
npm run fmt
git add src/pages/planlegger/index.astro src/components/planner/plannerApp.ts src/components/Icon.astro e2e/flows.pw.ts
git commit -m "feat(planner): the plan bar folds into a menu on a phone

The layer box, Del lenke and the semester go behind one ⋯ below 46rem —
the width at which this bar actually stops wrapping. The view switch
stays out, because it is the control a student throws while reading.

The bar's order changes at EVERY width: the run that collapses now comes
before the switch that stays, so the phone layout is literally 'the
first three fold up' with no order: tricks and no divergence between
visual and focus order.

One rule for the menu: a control that redraws the week closes it, a
control that only confirms itself stays open."
```

---

### Task 7: Record the menu idiom in DESIGN

**Files:**
- Modify: `docs/DESIGN.md` (§6's phone-gate paragraph, §9's topbar and plan-bar bullets)
- Modify: `CLAUDE.md` (the layout-shift bullet's account of the topbar)

- [ ] **Step 1: Update §6's measured figure**

Replace the recorded "304 px of 844 at 390 px" with the number measured in Task 6 Step 8, and note that the bar no longer wraps to three rows.

- [ ] **Step 2: Supersede §9's mark-alone bullet**

The bullet "**Below the site's mobile breakpoint (480 px) it is the mark alone**" is superseded. Rewrite it: below 480 px the account is a row in the topbar's menu, where the name is visible — which is what the bare mark could not do. Keep the `aria-label` rule ("Profil · {navn}" at every width) and the 44 px target, both of which still hold. Note that the wordmark comes back whole because the controls it was competing with are in the panel.

- [ ] **Step 3: Add the menu idiom as a named rule**

Add a §9 bullet: **A bar that runs out of room folds into a menu, and the wrapper is what folds.** State the mechanism in three lines — `display: contents` above the breakpoint, a positioned panel below it, open state as `data-menu` on the bar and never `[hidden]` on the wrapper — plus the close rule (a control that redraws the week closes the menu; one that only confirms itself stays open), and that each bar collapses at its own width (480 px for the shell, 46 rem for the plan bar) because each runs out of room at a different one.

- [ ] **Step 4: Correct CLAUDE.md**

The layout-shift bullet describes the topbar. Add one sentence: below 480 px the topbar's controls live in a menu panel, and the wrapper mechanism is `display: contents`/positioned-panel with the state on the bar — the `[hidden]` trap is exactly why.

- [ ] **Step 5: Commit**

```bash
git add docs/DESIGN.md CLAUDE.md
git commit -m "docs: record the fold, and the measured gate

§6 carries the re-measured number rather than the old one; §9 gains the
menu idiom as a named rule and loses the mark-alone bullet the menu
supersedes."
```

---

# Phase C — `/emne/[code]/` states its scope

### Task 8: The pure helpers

**Files:**
- Modify: `src/components/site/courseTimetable.ts` (add two exports)
- Test: `tests/site/courseTimetable.test.ts`

**Interfaces:**
- Consumes: `applyGroupSelection(entries, selected, programCode)` from `src/lib/planner/groups.js`.
- Produces:
  - `export type TimetableScope = "all" | "mine"`
  - `export interface ScopeState { programCode: string | null; inPlan: boolean; scope: TimetableScope }`
  - `export function scopeNote(state: ScopeState): string`
  - `export function narrowingChangesWeek(entries: CourseTimetableEntry[], selected: string[] | undefined, programCode: string | null): boolean`

- [ ] **Step 1: Write the failing unit tests**

Add to `tests/site/courseTimetable.test.ts`:

```ts
import { narrowingChangesWeek, scopeNote } from "../../src/components/site/courseTimetable.js";

describe("scopeNote", () => {
  it("with no programme, says what the week is and where to fix it", () => {
    expect(scopeNote({ programCode: null, inPlan: false, scope: "all" })).toBe(
      "Uka viser alle paralleller og grupper for emnet. Velg studieprogram i planleggeren for å se din egen undervisning.",
    );
  });

  it("with a programme but no plan entry, names the thing a plan would add", () => {
    expect(scopeNote({ programCode: "MTDT", inPlan: false, scope: "all" })).toBe(
      "Uka viser alle paralleller og grupper for emnet. Legg emnet i planen for å velge øvingsgruppe.",
    );
  });

  it("drops the nudge once the course is in the plan", () => {
    expect(scopeNote({ programCode: "MTDT", inPlan: true, scope: "all" })).toBe(
      "Uka viser alle paralleller og grupper for emnet.",
    );
  });

  it("narrowed, it names the programme it narrowed to", () => {
    expect(scopeNote({ programCode: "MTDT", inPlan: true, scope: "mine" })).toBe(
      "Viser undervisningen for MTDT.",
    );
    expect(scopeNote({ programCode: "MTDT", inPlan: false, scope: "mine" })).toBe(
      "Viser undervisningen for MTDT. Legg emnet i planen for å velge øvingsgruppe.",
    );
  });
});

describe("narrowingChangesWeek", () => {
  const entry = (title: string, name: string | null) =>
    ({ title, name, weeks: "34-40", dayOfWeek: 1, start: "08:00", end: "10:00" }) as never;

  it("is false with no programme — there is nothing to narrow to", () => {
    expect(narrowingChangesWeek([entry("Forelesning", "MTDT")], undefined, null)).toBe(false);
  });

  it("is false when the course names no programme, so the control would do nothing", () => {
    const entries = [entry("Forelesning", null), entry("Øving", null)];
    expect(narrowingChangesWeek(entries, undefined, "MTDT")).toBe(false);
  });

  it("is true when the programme filter actually drops an entry", () => {
    const entries = [entry("Forelesning MTDT", "MTDT"), entry("Forelesning MTFYMA", "MTFYMA")];
    expect(narrowingChangesWeek(entries, undefined, "MTDT")).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run tests/site/courseTimetable.test.ts`
Expected: FAIL — `scopeNote is not a function`.

- [ ] **Step 3: Implement**

Add to `src/components/site/courseTimetable.ts`:

```ts
/** Which slice of the course's teaching the week is drawing. */
export type TimetableScope = "all" | "mine";

export interface ScopeState {
  /** The stored programme, or null when the student has not said. */
  programCode: string | null;
  /** Whether this course is in the plan — the only thing that can hold a group pick. */
  inPlan: boolean;
  scope: TimetableScope;
}

/**
 * The line under the week: what it is showing, and what would change it.
 *
 * This page draws EVERY parallel and every group by default, deliberately — it
 * is the course's own reference page, not one student's plan — and until now
 * nothing said so. Three rungs, and they differ in what the student can
 * actually do next: with no programme stored nothing can be narrowed at all;
 * with one, lectures narrow to that programme's section and other programmes'
 * øving groups drop; only a plan entry can carry the student's own group pick,
 * which is what the nudge is for.
 */
export function scopeNote(state: ScopeState): string {
  const nudge = state.inPlan ? "" : " Legg emnet i planen for å velge øvingsgruppe.";
  if (state.programCode === null) {
    return "Uka viser alle paralleller og grupper for emnet. Velg studieprogram i planleggeren for å se din egen undervisning.";
  }
  if (state.scope === "mine") return `Viser undervisningen for ${state.programCode}.${nudge}`;
  return `Uka viser alle paralleller og grupper for emnet.${nudge}`;
}

/**
 * Would narrowing actually change this week?
 *
 * `entriesForProgram` is a no-op for a course that names no programme, so on
 * most courses the switch would be a control that visibly does nothing —
 * exactly the failure the layer box was fixed for. Render it only when this is
 * true.
 */
export function narrowingChangesWeek(
  entries: CourseTimetableEntry[],
  selected: string[] | undefined,
  programCode: string | null,
): boolean {
  if (!programCode) return false;
  return applyGroupSelection(entries, selected, programCode).length !== entries.length;
}
```

Add the import: `import { applyGroupSelection } from "../../lib/planner/groups.js";`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/site/courseTimetable.test.ts`
Expected: PASS. If the `entry()` fixture's shape does not satisfy `classifyActivity`/`rawGroupName`, read `src/lib/planner/groups.ts`'s `rawGroupName` and give the fixture the field it actually reads.

- [ ] **Step 5: Commit**

```bash
npm run fmt
git add src/components/site/courseTimetable.ts tests/site/courseTimetable.test.ts
git commit -m "feat(emne): name the week's scope, and know when narrowing would matter

Two pure helpers. scopeNote is the three-rung line — what the week is
showing and what the student can do next, which differs by whether a
programme is stored and whether the course is in the plan.

narrowingChangesWeek is the guard on the switch: entriesForProgram is a
no-op for a course that names no programme, so without it most courses
would carry a control that visibly does nothing."
```

---

### Task 9: Wire the line and the switch into the week

**Files:**
- Modify: `src/components/site/courseTimetable.ts` (`mountCourseTimetable` ~:189-285)
- Modify: `src/pages/emne/[code].astro` (pass the plan's programme and plan-membership in)
- Modify: `src/styles/site.css` (a row for the two toggles)
- Test: `e2e/flows.pw.ts`

**Interfaces:**
- Consumes: `scopeNote`, `narrowingChangesWeek`, `TimetableScope` from Task 8.
- Produces: `.timetable-scope` (the line), `.timetable-mine` (the switch).

- [ ] **Step 1: Write the failing e2e test**

Add to `e2e/flows.pw.ts`:

```ts
test.describe("the course page says what its week is showing", () => {
  test("states the scope, and offers to narrow it once a programme is stored", async ({ page }) => {
    await page.goto("/emne/TDT4120/");
    const line = page.locator(".timetable-scope");
    await expect(line).toContainText("Uka viser alle paralleller og grupper");
    // No programme stored: nothing to narrow to, so no control.
    await expect(line).toContainText("Velg studieprogram i planleggeren");
    await expect(page.locator(".timetable-mine")).toHaveCount(0);
  });

  test("resets to all on the next course page", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        "np:profile",
        JSON.stringify({ program: { code: "MTDT", cohort: 2026, name: "Datateknologi" } }),
      );
    });
    await page.goto("/emne/TDT4120/");
    const mine = page.locator(".timetable-mine");
    // Only rendered when narrowing would actually change the week.
    if ((await mine.count()) === 0) test.skip();
    await expect(mine).toHaveAttribute("aria-pressed", "false");
    await mine.click();
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".timetable-scope")).toContainText("Viser undervisningen for MTDT");

    await page.goto("/emne/TDT4109/");
    const next = page.locator(".timetable-mine");
    if ((await next.count()) > 0) {
      await expect(next).toHaveAttribute("aria-pressed", "false");
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx playwright test e2e/flows.pw.ts -g "says what its week is showing"`
Expected: FAIL — `.timetable-scope` does not exist.

- [ ] **Step 3: Extend the mount options**

In `src/components/site/courseTimetable.ts`, add to `CourseTimetableOptions`:

```ts
  /** The stored programme, for the "bare min" narrowing. Null when unknown. */
  programCode?: string | null;
  /** The student's group picks for this course, when it is in the plan. */
  selectedGroups?: string[];
  /** Whether the course is in the plan — only a plan entry can carry a group pick. */
  inPlan?: boolean;
```

- [ ] **Step 4: Render the line and the switch**

In `mountCourseTimetable`, replace the single-toggle block (~:191-194) with a row holding both controls plus the scope line, and thread the scope through `draw`:

```ts
  const programCode = options.programCode ?? null;
  const inPlan = options.inPlan ?? false;
  let scope: TimetableScope = "all";

  const controls = el("div", "timetable-controls");
  const toggle = el("button", "np-toggle timetable-others", "Vis øvinger og labber");
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", "false");
  controls.append(toggle);

  // Only when it would change something. `entriesForProgram` is a no-op for a
  // course that names no programme, and a control that visibly does nothing is
  // worse than no control.
  const canNarrow = narrowingChangesWeek(shown, options.selectedGroups, programCode);
  const mine = el("button", "np-toggle np-toggle--text timetable-mine", "Bare min undervisning");
  mine.type = "button";
  mine.setAttribute("aria-pressed", "false");
  if (canNarrow) controls.append(mine);

  body.append(controls);

  const scopeLine = el("p", "np-hint timetable-scope");
  body.append(scopeLine);

  function syncScopeLine(): void {
    scopeLine.textContent = scopeNote({ programCode, inPlan, scope });
  }
  syncScopeLine();
```

In `draw(showOthers)`, narrow the state's bundle before rendering:

```ts
  function draw(showOthers: boolean): void {
    const drawn =
      scope === "mine" ? applyGroupSelection(shown, options.selectedGroups, programCode) : shown;
    state.bundle = bundleFromEntries(drawn);
    // showAllGroups: this is the course's own reference page, not one student's
    // plan. The "bare min" switch is the student ASKING for their own slice —
    // it narrows the entries handed in, not this flag.
    const result = renderGrid(frame, notes, [state], showOthers, { showAllGroups: true });
    …unchanged…
  }
```

and wire the switch, on the same `beginLayerChange` grammar the layer toggle uses:

```ts
  mine.addEventListener("click", () => {
    scope = scope === "mine" ? "all" : "mine";
    mine.setAttribute("aria-pressed", String(scope === "mine"));
    syncScopeLine();
    const settle = beginLayerChange(frame, scope === "mine" ? "hide" : "reveal");
    draw(toggle.getAttribute("aria-pressed") === "true");
    settle();
  });
```

- [ ] **Step 5: Style the control row**

Append to `src/styles/site.css`:

```css
/* The week's two switches share a row: what is drawn (øvinger/labber) and how
   much of it (alle/bare min). They wrap on a narrow phone rather than
   compressing — a `.np-toggle` at its min-height is already a phone target. */
.timetable-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--gap-2);
  margin-bottom: var(--space-2);
}

.timetable-scope {
  margin-bottom: var(--space-3);
}
```

- [ ] **Step 6: Pass the plan's facts in from the page**

In `src/pages/emne/[code].astro`, at the `mountCourseTimetable(...)` call inside `mountWeek`, add the three new options from the store's current plan:

```ts
      const planNow = store.loadPlan();
      const entryNow = planNow.courses.find((c) => c.code === code);
      …
        programCode: planNow.program?.code ?? null,
        selectedGroups: entryNow?.groups,
        inPlan: !!entryNow && !entryNow.dropped,
```

`mountWeek` already re-runs on a plan change through `syncSemester`; if it does not re-run on an ordinary add/remove, leave that alone — the line is correct for the load and the plan button's own state line already reports membership.

- [ ] **Step 7: Run the tests**

Run: `npx vitest run tests/site/ && npx playwright test e2e/flows.pw.ts -g "says what its week is showing"`
Expected: PASS.

- [ ] **Step 8: Full gate**

Run: `mise run check && mise run e2e`
Expected: both green.

- [ ] **Step 9: Record it and commit**

Add a DESIGN §9 bullet: the course page's week is every parallel by default and says so, with the switch rendered only when narrowing would change the week, and the choice deliberately not persisted — one URL shows two people the same week, and no new state needs a pre-paint probe read.

```bash
npm run fmt
git add src/components/site/courseTimetable.ts "src/pages/emne/[code].astro" src/styles/site.css docs/DESIGN.md e2e/flows.pw.ts
git commit -m "feat(emne): the week says it is every parallel, and can narrow

The course page draws every parallel and every group on purpose — it is
the course's reference page, not one student's plan — and nothing said
so. Now a line does, and a stored programme buys a switch to the
student's own slice.

Default is all, per visit, not persisted: one URL shows two people the
same week, and there is no new state to read before paint.

The switch renders only when narrowing would change the week."
```

---

## Self-review

**Spec coverage.** §1 studieinfo move → Tasks 1-3. §2 mechanism → Task 4; shell menu → Task 5; planner menu and the reorder → Task 6; the close rule → Task 6 Step 6. §3 ladder, guard, default, shape → Tasks 8-9. Testing section → the failing-test step of every task, plus Task 6 Step 8's re-measure. Doc amendments → Tasks 3, 7 and 9 Step 9.

**Known soft spots, flagged rather than hidden.**

- Task 6 Step 4 describes the markup move with `…unchanged…` placeholders for three blocks that already exist in the file. That is a *move*, not new content — the instruction is to relocate them verbatim, and reproducing 60 lines of existing comments here would invite them being retyped and drifting.
- Task 8's `entry()` test fixture guesses which field `rawGroupName` reads. Step 4 says to read `groups.ts` and correct it rather than fight the assertion.
- Task 9 Step 6 assumes the emne page's `mountWeek` can see the plan. If `store` is not in scope there, hoist the read to where `syncPlanBtn` already reads it.
- The e2e tests in Task 9 use `test.skip()` when the fixture course turns out not to partition by programme. `TDT4400` is the known partitioning course per `e2e/contract.pw.ts`; if `TDT4120` does not narrow, switch the fixture to that.
