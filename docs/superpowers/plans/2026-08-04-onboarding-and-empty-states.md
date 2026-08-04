# Onboarding and Empty States Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Turn `/planlegger/` with no plan from the product's weakest screen into a first-run screen that reaches a drawn week in two decisions, give a returning student a way to log in from that screen, and separate login from register everywhere they appear.

**Architecture:** Nothing new is introduced. The first-run predicate is `html:not([data-plan])`, which `Layout.astro`'s existing pre-paint probe already writes; the first-run screen is static markup revealed by that selector, hosting the *same* `buildStudieinfoSection` unit the studieinfo dialog hosts, under a new commit policy. The account panel gains a `mode` and is opened from anywhere by a `np:account-open` CustomEvent, mirroring the `PLAN_CHANGE_EVENT` idiom already in `store.ts`.

**Tech Stack:** Astro 5 + TypeScript, vanilla DOM (`el()` from `components/planner/dom.ts`), hand-authored CSS tokens, Vitest (`mise run check`), Playwright against `wrangler dev` (`mise run e2e`), Biome.

**Source spec:** `docs/superpowers/specs/2026-08-03-onboarding-and-empty-state-design.md`. Its Prerequisite section is satisfied — publish-and-share landed at `0d45f35`. This plan implements that spec's §1–§5 and adds three requirements agreed on 2026-08-04:

- **A1** A returning student must be able to log in from the first-run screen and from the homepage, without the account ever gating the planner.
- **A2** Login and register must be visibly separate paths, not two buttons on one form.
- **A3** `/emne/[code]/` must not address a plan that does not exist.

## Global Constraints

Every task's requirements implicitly include this section.

- **Language:** Norwegian bokmål, sentence case, no exclamation marks, comma decimals (`7,5 sp`). Credits always `X av 30 sp`.
- **Banned marks:** no `—` (em dash) and no `·` (middle dot) in any string a student can read, in `src/` or `worker/`, and **no substitute mark** (no `–`, no `|`, no `-` standing in for one). The rewrite rule is: **prose becomes sentences; data rows become spaced fields.** Code comments and the four `docs/` files keep their existing em-dashed register.
- **Banned vocabulary:** **name what shows up, never announce that it is finished.** "tegne uka" is struck in every inflection, and so is "så er uka klar" / "uka er klar" and the same shape around *timeplanen*/*ukeplanen* (that second ban landed on 2026-08-04, after this plan was executed with "så er uka klar" as its replacement; the sweep below therefore reads one revision behind). Write the visible outcome: **"så lages timeplanen din"**.
- **Verbs stay consistent through a flow:** `Legg til i planen` → `I planen`; `kolliderer med` for clashes; `Dropp` → `Legg tilbake` for a programme course; `Fjern` only for an outright irreversible removal.
- **ClientRouter:** every page/component setup goes through `onPage(setup)` from `src/lib/pageLifecycle.ts`, with listeners bound `{ signal }`. Hoisted module scripts run once per module and do **not** re-execute after a view-transition swap.
- **`[hidden]`:** `primitives.css` makes it `display: none !important` on purpose. Anything that must stay laid out while hidden needs its own state class, not this attribute.
- **Search fields are `type="text"`, never `type="search"`** (Chrome's search input eats the first Escape).
- **Tests:** mechanism only. No DOM child counts, no exact visual treatments, no "control X lives inside surface Y". Adjudicated design lives in `docs/DESIGN.md`.
- **Accent budget:** at most one `.np-btn--primary` visible per surface (DESIGN §5), and it wears the surface's primary action.
- **Gates:** `mise run check` and `mise run e2e` must both be green at the end of every task.
- **Git:** work directly on `main`, commit at the end of each task.
- **Node:** the shell has no bare `node` on PATH. Use `mise run <task>`, or `/home/vscode/.local/share/mise/installs/node/22/bin/node` for a direct invocation.

---

### Task 1: The copy gate, then the punctuation sweep

The gate goes in first so every string written by Tasks 2–7 lands under a green test rather than needing a second sweep later.

**Files:**
- Create: `tests/copy.test.ts`
- Modify: the 22 files listed in Step 3 (all under `src/` and `worker/src/`)

**Interfaces:**
- Consumes: nothing.
- Produces: `tests/copy.test.ts` — a repo-wide gate later tasks must keep green. No exported symbols.

- [x] **Step 1: Write the failing test**

Create `tests/copy.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { globSync } from "tinyglobby";
import { describe, expect, it } from "vitest";

/**
 * The copy gate (spec §5). Its failure means "someone reintroduced a banned
 * mark or a struck word", which is a real regression rather than a change of
 * mind — the distinction CLAUDE.md draws between a mechanism test and a
 * design-assertion test.
 *
 * Comments are stripped first: the four docs and the code comments keep their
 * heavily em-dashed register on purpose, and only strings a student can read
 * are in scope.
 */
const ROOT = join(fileURLToPath(new URL("..", import.meta.url)));

/** Banned in user-facing strings, with no substitute mark permitted. */
const BANNED_MARKS = /[—·]/g;
/** "Tegne uka" and every inflection of it. */
const BANNED_PHRASE = /tegn\w*\s+uk[ae]/gi;

/**
 * Removes block and line comments so the scan sees only code and strings.
 * `//` is left alone when preceded by `:` so a `https://` inside a string
 * literal does not swallow the rest of its line.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function sourceFiles(): string[] {
  return globSync(["src/**/*.{ts,astro}", "worker/src/**/*.ts"], { cwd: ROOT, absolute: true });
}

describe("user-facing copy", () => {
  it("uses no em dash and no middle dot", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      for (const line of stripped.split("\n")) {
        if (BANNED_MARKS.test(line)) offenders.push(`${file.slice(ROOT.length)}: ${line.trim()}`);
        BANNED_MARKS.lastIndex = 0;
      }
    }
    expect(offenders).toEqual([]);
  });

  it("never says tegne uka", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      if (BANNED_PHRASE.test(stripped)) offenders.push(file.slice(ROOT.length));
      BANNED_PHRASE.lastIndex = 0;
    }
    expect(offenders).toEqual([]);
  });
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `mise run check -- tests/copy.test.ts`

Expected: FAIL. The first case lists ~57 offending lines across 22 files; the second lists `src/components/planner/plannerApp.ts`.

If `tinyglobby` is not already a dependency, check `package.json` first and use whichever glob helper the existing tests use (`tests/bundle.test.mjs` and `tests/artifacts.test.mjs` both walk the tree — copy their approach rather than adding a dependency).

- [x] **Step 3: Sweep the 22 files**

Rewrite by the rule **prose becomes sentences; data rows become spaced fields**. The adjudicated rewrites, from the spec's table:

| now | becomes |
| --- | --- |
| `Velg studieprogram og kull, så tegner vi uka di — med forelesninger, kollisjoner og eksamensdatoer.` | `Velg studieprogrammet og kullet ditt, så er uka klar med forelesninger, kollisjoner og eksamensdatoer.` |
| `Oppmelding stenger 15. september — 43 dager igjen` | `Oppmelding stenger om 43 dager, 15. september` |
| `Ingen forelesninger kolliderer · 1 emne ikke sjekket` | `Ingen forelesninger kolliderer. 1 emne er ikke sjekket.` |
| `Data hentet 28. jul 2026 fra NTNU · uoffisiell, …` | `Data hentet 28. jul 2026 fra NTNU. Uoffisiell, …` |
| `Mønsteruke · undervisning fra uke 34 · Høst 2026` | three spaced fields, no mark: `Høst 2026` `Mønsteruke` `Undervisning fra uke 34` |
| `5 470 emner · katalog 2026` | `5 470 emner i katalogen for 2026` |
| `Denne enheten — 2 emner · 15 sp` | `Denne enheten, 2 emner og 15 sp` |
| `Åpent vindu — du kan stikke innom når du vil.` | `Åpent vindu. Du kan stikke innom når du vil.` |
| `Nå · 37 min igjen` | `Nå, 37 min igjen` |
| `Profil · Kari` | `Profil for Kari` |
| `Ikke synkronisert · prøv igjen` | `Ikke synkronisert. Prøv igjen.` |

Three of these are **not** string literals and need a different treatment:

- `.course-settings-group-own` and `.planner-others-pending` carry `content: "· "` in CSS. Delete the `content` rule and express the separation as spacing plus quieter ink (`color: var(--muted)`) instead.
- `Layout.astro`'s `.site-footer-sep` `<span>` is a mark in markup. Remove the span and give the footer items margin.
- `src/components/account.ts:122` builds `aria-label` as `` `Profil · ${navn}` `` — becomes `` `Profil for ${navn}` ``. `src/components/AccountButton.astro:75`'s pre-paint script writes the *same* label and must be changed with it, or the label flips between the two forms on load.

`<title>` tags use the dot as a brand separator. Rather than substituting a mark, subpages **drop the brand suffix**: `Planlegger`, `Emner`, `TDT4120 Algoritmer og datastrukturer`, `Fant ikke siden`. The homepage stays `Semesterplan`. Both calendars this project benchmarks against name the page and nothing else in the tab.

- [x] **Step 4: Run the copy gate and the full unit pass**

Run: `mise run check`

Expected: PASS, including `tests/copy.test.ts`. Other suites may fail where they assert old copy — fix those assertions to the new strings; do **not** relax the gate.

- [x] **Step 5: Run the browser suite**

Run: `mise run e2e`

Expected: PASS. `e2e/*.pw.ts` asserts some visible copy; update those assertions to the new strings.

- [x] **Step 6: Commit**

```bash
git add tests/copy.test.ts src worker e2e
git commit -m "refactor(copy): no em dash, no middle dot, no tegne uka

A gate test, then the sweep it fails against. Prose becomes sentences and
data rows become spaced fields; subpage titles drop the brand suffix rather
than substitute a mark."
```

---

### Task 2: A commit policy for the studieinfo section

The first-run screen hosts the same picker the dialog hosts. The only thing they disagree on is when a pick is written, so that is the only thing the shared unit learns.

**Files:**
- Modify: `src/components/planner/studieinfo.ts:52-60` (deps), `:233-237` (heading and hint), `:331-343` (save button), `renderKull`'s chip handler
- Modify: `src/components/planner/studieinfoDialog.ts:54-60` (pass the policy)
- Test: `tests/planner/studieinfo.test.ts`

**Interfaces:**
- Consumes: `buildStudieinfoSection(deps)`, `StudieinfoSectionHandle` (`element`, `reset()`, `focusProgram()`, `focusDirection()`) — all unchanged.
- Produces: `StudieinfoSectionDeps` gains one required field:
  ```ts
  commit: "explicit" | "on-kull";
  ```
  `"explicit"` is today's behaviour. `"on-kull"` renders no save button, no section heading and no section hint, and writes as soon as programme and kull are both known, calling `deps.onSaved()` on success. Task 3 passes `"on-kull"`; `studieinfoDialog.ts` passes `"explicit"`.

- [x] **Step 1: Write the failing test**

Append to `tests/planner/studieinfo.test.ts`, following the mount helpers already in that file:

```ts
describe("commit policy", () => {
  it("on-kull writes the programme without a save press", async () => {
    const store = testStore();
    const saved: string[] = [];
    const section = buildStudieinfoSection({
      store,
      commit: "on-kull",
      onSaved: () => saved.push("saved"),
    });
    document.body.append(section.element);

    await pickProgram(section, "MTDT");
    await pickCohort(section, 2024);

    expect(store.loadProfile()?.program?.code).toBe("MTDT");
    expect(store.loadProfile()?.program?.cohort).toBe(2024);
    expect(saved).toEqual(["saved"]);
  });

  it("on-kull renders no save button", async () => {
    const section = buildStudieinfoSection({
      store: testStore(),
      commit: "on-kull",
      onSaved: () => {},
    });
    expect(section.element.querySelector("#studieinfo-save")).toBeNull();
  });

  it("explicit still requires a save press", async () => {
    const store = testStore();
    const section = buildStudieinfoSection({
      store,
      commit: "explicit",
      onSaved: () => {},
    });
    document.body.append(section.element);

    await pickProgram(section, "MTDT");
    await pickCohort(section, 2024);

    expect(store.loadProfile()?.program).toBeUndefined();
  });
});
```

`testStore`, `pickProgram` and `pickCohort` are helpers — if the file does not already have equivalents, write them from the existing tests' setup rather than inventing a new fixture shape.

- [x] **Step 2: Run the test to verify it fails**

Run: `mise run check -- tests/planner/studieinfo.test.ts`

Expected: FAIL — TypeScript rejects the unknown `commit` property, and `#studieinfo-save` is present.

- [x] **Step 3: Add the policy**

In `studieinfo.ts`, extend the deps:

```ts
export interface StudieinfoSectionDeps {
  store: PlanStore;
  /**
   * When a pick is written.
   *
   * `"explicit"` is the dialog's: it edits a plan that already exists, where a
   * stray chip press must not rewrite it, so Lagre is the write.
   *
   * `"on-kull"` is the first-run screen's: the sentence above the field
   * promises the week is ready once programme and kull are given, and a third
   * press would make that false. The save button, the section heading and the
   * section hint are not rendered at all in this variant — the screen's own
   * <h1> and sentence already carry them.
   */
  commit: "explicit" | "on-kull";
  onSaved: () => void;
}
```

Gate the heading and hint at `:233-237`:

```ts
if (deps.commit === "explicit") {
  const heading = el("h3", "profile-panel-heading", "Studieinfo");
  heading.id = "studieinfo-heading";
  section.setAttribute("aria-labelledby", heading.id);
  section.append(heading);
  section.append(el("p", "np-hint", "Programmet og kullet ditt fyller ukeplanen."));
}
```

Gate the actions row at `:331-345` on the same condition, so `saveBtn` and `actions` are built and appended only for `"explicit"`. Hoist `saveBtn` to a `HTMLButtonElement | null` in the enclosing scope so the existing enable/disable calls keep compiling; guard each with `saveBtn?.`.

In `renderKull`'s chip handler, commit after the cohort's plan has landed:

```ts
chip.addEventListener("click", () => {
  void loadCohort(year, false).then(() => {
    // The screen promised a ready week for two facts. This is the second.
    if (deps.commit === "on-kull") void commit();
  });
});
```

`commit()` is declared later in the same closure and hoisted, so the call site is fine where it stands.

- [x] **Step 4: Pass the policy from the dialog**

In `studieinfoDialog.ts:54-60`:

```ts
const section: StudieinfoSectionHandle = buildStudieinfoSection({
  store,
  // The dialog edits a plan that already exists: nothing is written until
  // Lagre, so a stray backdrop click discards a half-picked programme rather
  // than committing one.
  commit: "explicit",
  onSaved: () => close(),
});
```

- [x] **Step 5: Trim the dialog's titles and its Lagre**

While the file is open (spec §3): the dialog prints "Studieprogram" (dialog head), "Studieinfo" (section heading) and "STUDIEPROGRAM" (field label) inside 300 px. Step 3 already removes the section heading and hint for `"on-kull"` — remove them for `"explicit"` too, leaving the dialog title and the field label. That means the `if (deps.commit === "explicit")` block from Step 3 goes away again; `section.setAttribute("aria-labelledby", …)` must then point at the dialog's own `#studieinfo-dialog-title` instead, set by `studieinfoDialog.ts` rather than by the section.

Also: `saveBtn` starts `disabled` and is enabled only once a programme **and** a kull are staged, and drops `np-btn--primary` for plain `np-btn` — an accent-blue enabled button before anything is picked invites a press that does nothing.

- [x] **Step 6: Run the tests to verify they pass**

Run: `mise run check -- tests/planner/studieinfo.test.ts`

Expected: PASS. Adjust the "on-kull renders no save button" and heading expectations if Step 5 changed what `"explicit"` renders.

- [x] **Step 7: Commit**

```bash
git add src/components/planner/studieinfo.ts src/components/planner/studieinfoDialog.ts tests/planner/studieinfo.test.ts
git commit -m "feat(studieinfo): a commit policy, so one picker can host two screens

on-kull writes as soon as programme and kull are known and renders no Lagre;
explicit stays the dialog's. The dialog also loses its second and third title
and stops offering an enabled accent button before anything is picked."
```

---

### Task 3: The first-run screen

**Files:**
- Modify: `src/pages/planlegger/index.astro` (static section before `.planner-banner`; CSS gate; styles)
- Modify: `src/components/planner/plannerApp.ts:2554-2595` (delete the `noProfile` week-card branch), and its mount path (host the section)
- Test: `tests/planner/plannerApp.test.ts`, `e2e/flows.pw.ts`, `e2e/cls.pw.ts`

**Interfaces:**
- Consumes: `buildStudieinfoSection({ store, commit: "on-kull", onSaved })` from Task 2.
- Produces: `#planner-firstrun` — the static section. Task 6 appends its login line to `#planner-firstrun-alt`.

- [x] **Step 1: Write the failing e2e test**

Add to `e2e/flows.pw.ts`:

```ts
test("first run reaches a drawn week without a dialog", async ({ page }) => {
  await page.goto("/planlegger/");
  await expect(page.locator("#planner-firstrun")).toBeVisible();
  await expect(page.locator("#planner-main")).toBeHidden();

  await page.locator("#studieinfo-program").fill("MTDT");
  await page.locator("#studieinfo-typeahead li").first().click();
  await page.locator(".studieinfo-kull-chip").first().click();

  // Committing on the kull clears `data-plan`'s absence without a reload.
  await expect(page.locator("#planner-firstrun")).toBeHidden();
  await expect(page.locator(".planner-grid-frame")).toBeVisible();
  // No modal was ever in the path.
  await expect(page.locator("#planner-studieinfo")).toBeHidden();
});
```

Use the ids the page actually renders — read `studieinfo.ts`'s typeahead markup for the real `#studieinfo-program` / list ids and correct the selectors before running.

- [x] **Step 2: Run it to verify it fails**

Run: `mise run e2e -- --grep "first run reaches a drawn week"`

Expected: FAIL — `#planner-firstrun` does not exist.

- [x] **Step 3: Add the static screen and the gate**

In `src/pages/planlegger/index.astro`, before `.planner-banner` (line 21):

```astro
{/* First run. The predicate is `html:not([data-plan])`, which Layout's
    pre-paint probe already writes: it sets `data-plan` when a programme or a
    course is stored and REMOVES it otherwise, so its absence is exactly "no
    plan", known before the first frame and kept true by `planProbe.ts`.
    A CSS-gated static panel therefore paints WITH the document: no mount
    flash, no reserved void, and no reservation to lease and release.

    That predicate is complete because the `#v2;…` hash is gone (PRODUCT §6):
    localStorage is now the only way a plan can reach this page. */}
<section class="planner-firstrun" id="planner-firstrun" aria-labelledby="planner-firstrun-title">
  {/* The <h1> is the invitation, not "Semesterplan". The wordmark says that
      100px above, and a page title that repeats the wordmark spends the
      largest type on the screen saying nothing. */}
  <h1 class="planner-firstrun-title" id="planner-firstrun-title">Lag timeplanen for semesteret</h1>
  <p class="np-hint planner-firstrun-lead">
    Velg studieprogrammet og kullet ditt, så er uka klar med forelesninger, kollisjoner og
    eksamensdatoer.
  </p>
  {/* The picker mounts here. No autofocus: the field is the only control on
      the screen, and an autofocus opens a phone keyboard over the sentence
      that explains why the field is there. */}
  <div class="planner-firstrun-picker" id="planner-firstrun-picker"></div>
  <p class="np-hint planner-firstrun-alt" id="planner-firstrun-alt">
    Har du emnekodene? <button type="button" class="np-navlink" id="planner-firstrun-add">Legg dem til direkte.</button>
  </p>
</section>
```

Add the gate to the page's `<style>`:

```css
/* First run owns the page: no bar, no tools, no deadline, no verdict, no week
   frame, no Eksamener, no Emner. Everything on those surfaces presupposes the
   content that is missing. */
.planner-firstrun {
  display: none;
}
html:not([data-plan]) .planner-firstrun {
  display: block;
}
html:not([data-plan]) .planner-banner,
html:not([data-plan]) #planner-main {
  display: none;
}
```

- [x] **Step 4: Host the picker and delete the old branch**

In `plannerApp.ts`, mount the section into `#planner-firstrun-picker` from the same place the studieinfo dialog is mounted:

```ts
// The same unit the dialog hosts, under the screen's own commit policy. The
// screen owns PRESENTATION of the first run; `studieinfo.ts` owns the
// picking. The only thing they agree on is when a pick is written.
const firstRunHost = document.getElementById("planner-firstrun-picker");
if (firstRunHost) {
  const firstRun = buildStudieinfoSection({
    store,
    commit: "on-kull",
    onSaved: () => {
      // `planProbe.ts` clears `html:not([data-plan])` on the store write, so
      // the screen goes and the planner arrives without a reload.
      redrawEverything();
    },
  });
  firstRunHost.append(firstRun.element);
}
```

Use the planner's real repaint entry point rather than the placeholder `redrawEverything()` — read `plannerApp.ts` for the function the studieinfo dialog's `onSaved` path already triggers, and call that.

Wire `#planner-firstrun-add` to the same `openAddFromQuestion()` the deleted card's secondary button used.

Then **delete** the `noProfile` branch at `plannerApp.ts:2554-2595` entirely, along with the now-unused `noProfile` const, and let `showFallback` be computed from the remaining three states. The first-run screen replaces it; leaving both means two answers to the same question.

- [x] **Step 5: Run the e2e test to verify it passes**

Run: `mise run e2e -- --grep "first run reaches a drawn week"`

Expected: PASS.

- [x] **Step 6: Add the first-run CLS budget**

The existing planner budgets in `e2e/cls.pw.ts` are measured **with** a plan and do not cover this state. Add a `/planlegger/` first-run entry with an empty `localStorage`. Measure the real number first, then set the budget just above it — do not copy a neighbouring budget.

Run: `mise run e2e -- --grep cls`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/pages/planlegger/index.astro src/components/planner/plannerApp.ts e2e/flows.pw.ts e2e/cls.pw.ts
git commit -m "feat(planner): a first-run screen, gated on the probe's own predicate

html:not([data-plan]) is already written pre-paint, so the screen paints with
the document. Programme and kull commit on the kull press and the planner
arrives without a reload. The noProfile week card it replaces is deleted."
```

---

### Task 4: Sections appear with their rows

Inside the planner, a section goes absent rather than printing an apology over placeholder copy. This is a real state, not a transitional one: a programme whose study plan is missing (`PROGRAM_MISSING_HINT`) lands in it.

**Files:**
- Modify: `src/components/planner/plannerApp.ts` (the Eksamener render path, the load-track render path, the Emner empty line)
- Test: `tests/planner/plannerApp.test.ts`

**Interfaces:**
- Consumes: the plan state `plannerApp.ts` already holds.
- Produces: nothing exported.

- [x] **Step 1: Write the failing test**

Add to `tests/planner/plannerApp.test.ts`, using the mount helper already in that file:

```ts
describe("zero-course sections", () => {
  it("omits Eksamener and the load track entirely at zero courses", async () => {
    const app = await mountPlanner({ program: { code: "MTDT", cohort: 2024 }, courses: [] });
    expect(app.query("#planner-exams")).toBeNull();
    expect(app.query(".planner-load")).toBeNull();
    // Emner stays: it is where the first course is added.
    expect(app.query("#planner-courses")).not.toBeNull();
    expect(app.text()).not.toContain("Legg til emner for å se eksamensdatoer");
    expect(app.text()).not.toContain("Ingen emner i planen ennå");
    expect(app.text()).not.toContain("0 av 30 sp");
  });
});
```

Correct the ids and the helper name against what `plannerApp.test.ts` and the page actually use before running.

- [x] **Step 2: Run it to verify it fails**

Run: `mise run check -- tests/planner/plannerApp.test.ts`

Expected: FAIL — the placeholder strings are present.

- [x] **Step 3: Gate the three sections**

- **Eksamener** — heading, status line and list are all absent when the plan has zero active courses. Delete the `"Legg til emner for å se eksamensdatoer."` string.
- **The 30 sp load track** — the track, its figure and its legend are absent at zero courses. Delete the `"0 av 30 sp"` zero rendering. A load track over no load is ruling that has stopped dividing anything.
- **Emner** — stays whenever there is a programme, because that is where the first course is added. Its `"Ingen emner i planen ennå."` goes; the section becomes its heading and the "Legg til emne" button.

Watch the layout-shift reservations: `planner-week.css`'s `.planner-grid-frame` `min-height` and every `calc(var(--plan-courses) * …)` are computed from the plan, which is zero here, so a removed section reserves nothing and releases nothing. Do not touch those numbers.

- [x] **Step 4: Run the tests to verify they pass**

Run: `mise run check -- tests/planner/plannerApp.test.ts`

Expected: PASS.

- [x] **Step 5: Run the full gates**

Run: `mise run check && mise run e2e`

Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add src/components/planner/plannerApp.ts tests/planner/plannerApp.test.ts
git commit -m "feat(planner): sections appear with their rows

Eksamener and the load track are absent at zero courses rather than printing
a heading over an apology. Emner keeps its heading and its add button, because
that is where the first course comes from."
```

---

### Task 5: Login and register become two paths (A2)

Today `profilePanel.ts:470-619` is one form carrying Navn, PIN and Gjenta PIN with two equal buttons, and the comment at `:531-542` concedes that Enter routes arbitrarily and that `reasonCopy` naming the other action is the mitigation. That is a mitigation for a defect. Gjenta PIN also sits in the login path doing nothing.

**Files:**
- Modify: `src/components/planner/profilePanel.ts:110-120` (handle), `:154-180` (`reasonCopy`), `:470-619` (`renderSignedOut`)
- Test: `tests/planner/profilePanel.test.ts`

**Interfaces:**
- Consumes: `attemptAuth`, `pinIsValid`, `deviceLabel`, `SyncClient` — unchanged.
- Produces:
  ```ts
  export type AuthMode = "login" | "signup";
  export interface ProfilePanelHandle {
    show(mode?: AuthMode): void;   // was show(): void
    setSyncState(state: SyncUiState): void;
  }
  ```
  `show()` with no argument opens **login** when signed out. Task 6 calls `show("login")` and `show("signup")` explicitly.

- [x] **Step 1: Write the failing test**

Add to `tests/planner/profilePanel.test.ts`:

```ts
describe("login and register are separate paths", () => {
  it("login mode asks for name and PIN only", () => {
    const panel = mountPanel();
    panel.show("login");
    expect(document.getElementById("profile-panel-repeat-pin")).toBeNull();
    expect(document.querySelectorAll("#profile-panel-submit").length).toBe(1);
    expect(document.getElementById("profile-panel-submit")?.textContent).toBe("Logg inn");
  });

  it("signup mode asks for the PIN twice", () => {
    const panel = mountPanel();
    panel.show("signup");
    expect(document.getElementById("profile-panel-repeat-pin")).not.toBeNull();
    expect(document.getElementById("profile-panel-submit")?.textContent).toBe("Opprett konto");
  });

  it("switching modes carries the name and clears the PIN", () => {
    const panel = mountPanel();
    panel.show("login");
    (document.getElementById("profile-panel-navn") as HTMLInputElement).value = "kari";
    (document.getElementById("profile-panel-pin") as HTMLInputElement).value = "123456";
    (document.getElementById("profile-panel-switch") as HTMLButtonElement).click();
    expect((document.getElementById("profile-panel-navn") as HTMLInputElement).value).toBe("kari");
    expect((document.getElementById("profile-panel-pin") as HTMLInputElement).value).toBe("");
  });

  it("defaults to login when signed out", () => {
    const panel = mountPanel();
    panel.show();
    expect(document.getElementById("profile-panel-submit")?.textContent).toBe("Logg inn");
  });
});
```

`mountPanel` is the helper already in that file — reuse it rather than writing a second fixture.

- [x] **Step 2: Run it to verify it fails**

Run: `mise run check -- tests/planner/profilePanel.test.ts`

Expected: FAIL — `show` takes no argument, and `#profile-panel-submit` / `#profile-panel-switch` do not exist.

- [x] **Step 3: Rewrite `renderSignedOut` around a mode**

```ts
export type AuthMode = "login" | "signup";

/** Which form the signed-out panel is showing. Login is the default, because
 *  the two callers that KNOW the student has no account (the first-run screen's
 *  line, and Del on an account-less plan) pass "signup" explicitly. */
let authMode: AuthMode = "login";

function renderSignedOut(): void {
  dialog.replaceChildren(renderHead());
  const body = el("div", "profile-panel-body");
  const signup = authMode === "signup";

  const account = el("form", "profile-panel-account") as HTMLFormElement;
  account.autocomplete = "off";
  account.append(el("h3", "profile-panel-heading", signup ? "Opprett konto" : "Logg inn"));
  account.append(
    el(
      "p",
      "np-hint",
      signup
        ? "Da følger planen med på telefon, PC og nettbrett."
        : "Hent planen din på denne enheten.",
    ),
  );

  const navn = buildField("Navn", "profile-panel-navn");
  const pin = buildField("PIN (6 siffer)", "profile-panel-pin", {
    inputmode: "numeric",
    maxlength: "6",
  });
  account.append(navn.wrapper, pin.wrapper);

  // Gjenta PIN catches a typo before it round-trips as the encryption key's
  // own input — syncClient never sees the second value, so the check happens
  // here or not at all. It has nothing to catch on login.
  const repeat = signup
    ? buildField("Gjenta PIN", "profile-panel-repeat-pin", {
        inputmode: "numeric",
        maxlength: "6",
      })
    : null;
  if (repeat) account.append(repeat.wrapper);

  if (signup) {
    account.append(el("p", "np-hint", "Planen lagres kryptert. Vi kan ikke lese den."));
    account.append(
      el("p", "np-hint", "Husk PIN-en. Du trenger den for å logge inn på en ny enhet."),
    );
  }

  const hint = el("p", "np-hint profile-panel-hint", syncState === "unauthorised" ? REAUTH_COPY : "");
  hint.id = "profile-panel-hint";
  hint.setAttribute("aria-live", "polite");
  account.append(hint);

  // ONE submit. Enter and a click land on the same listener, and which action
  // they mean is no longer a coin flip — which is why the old form's apology
  // about arbitrary Enter routing is deleted rather than moved.
  //
  // It is the panel's one accent: studieinfo left this surface for the
  // planner's own dialog, so the auth submit is the only action here and §5's
  // one-accent-per-surface rule is satisfied by it wearing the accent.
  const submitBtn = el(
    "button",
    "np-btn np-btn--primary",
    signup ? "Opprett konto" : "Logg inn",
  ) as HTMLButtonElement;
  submitBtn.id = "profile-panel-submit";
  submitBtn.type = "submit";
  submitBtn.setAttribute("aria-describedby", "profile-panel-hint");
  account.append(el("div", "profile-panel-actions")).lastElementChild?.append(submitBtn);

  // The returning-or-new choice is a link BELOW the form, not a second button
  // beside it. Two co-equal buttons is what made the two paths confusable.
  const switchLine = el("p", "np-hint profile-panel-switch-line");
  switchLine.append(
    document.createTextNode(signup ? "Har du konto fra før? " : "Har du ikke konto? "),
  );
  const switchBtn = el("button", "np-navlink", signup ? "Logg inn" : "Opprett konto");
  switchBtn.id = "profile-panel-switch";
  (switchBtn as HTMLButtonElement).type = "button";
  switchBtn.addEventListener("click", () => {
    // The name survives the switch; the PIN does not, because it means a
    // different thing on the other side (a secret to prove versus one to set).
    const carried = navn.input.value;
    authMode = signup ? "login" : "signup";
    renderSignedOut();
    const nextNavn = document.getElementById("profile-panel-navn") as HTMLInputElement | null;
    if (nextNavn) {
      nextNavn.value = carried;
      nextNavn.focus();
    }
  });
  switchLine.append(switchBtn);
  account.append(switchLine);

  body.append(account);
  dialog.append(body);

  async function submit(): Promise<void> { /* as before, with `kind` = authMode */ }

  account.addEventListener("submit", (event) => {
    event.preventDefault();
    void submit();
  });
}
```

Carry the existing validation into `submit()` unchanged, with `kind` taken from `authMode` and the repeat check guarded on `repeat !== null`.

- [x] **Step 4: Make `reasonCopy` switch the mode**

`taken` and `no_account` currently name the other action in prose because there was no mode to move to. Now there is. Keep the sentence — an automatic flip would silently discard the typed PIN — but make the named action the switch link itself, and leave the typed name in place.

Update `:174-178` so the two cases read as sentences without a banned mark, then have the failure path re-point `#profile-panel-switch` as the way out:

```ts
case "taken":
  return "Det navnet er tatt. Har du kontoen alt? Logg inn i stedet.";
case "no_account":
  return "Fant ingen konto med det navnet. Opprett konto i stedet.";
```

- [x] **Step 5: Widen the handle**

```ts
return {
  show(mode?: AuthMode): void {
    if (mode) authMode = mode;
    // …existing show body…
  },
  setSyncState(state: SyncUiState): void { /* unchanged */ },
};
```

Delete the `:531-542` comment block about arbitrary Enter routing — it documents a defect this task removes, and a stale confession is worse than none.

- [x] **Step 6: Run the tests to verify they pass**

Run: `mise run check -- tests/planner/profilePanel.test.ts`

Expected: PASS.

- [x] **Step 7: Run the sync round-trip**

Run: `mise run e2e -- --grep sync`

Expected: PASS. `e2e/sync.pw.ts` drives real signup and login against `wrangler dev`'s local KV and will exercise both modes; update its selectors from the two old buttons to `#profile-panel-submit` plus `#profile-panel-switch`.

- [x] **Step 8: Commit**

```bash
git add src/components/planner/profilePanel.ts tests/planner/profilePanel.test.ts e2e/sync.pw.ts
git commit -m "feat(account): login and register are two paths, not two buttons

One form, one mode, one submit, and a link below it to the other path. Gjenta
PIN leaves the login path, Enter stops being a coin flip, and the comment that
apologised for that is deleted with the defect."
```

---

### Task 6: A returning student can log in from the first screen (A1)

Some fresh visitors are returning ones: a student on a new browser has a plan on their account and no local trace of it. The account must never gate the planner (mandate 8, PRODUCT §4 flow 1), so this is a quiet line, not a wall.

**Files:**
- Modify: `src/components/account.ts` (listen for the open event)
- Modify: `src/pages/planlegger/index.astro` (`#planner-firstrun-alt` gains the line)
- Modify: `src/pages/index.astro:43-52` (the pitch gains the line)
- Modify: `src/components/site/now.ts` (reveal it when signed out)
- Test: `tests/site/now.test.ts`, `e2e/flows.pw.ts`

**Interfaces:**
- Consumes: `accountPanel()` and `ProfilePanelHandle.show(mode)` from Task 5.
- Produces: in `src/components/account.ts`
  ```ts
  export const ACCOUNT_OPEN_EVENT = "np:account-open";
  /** `document.dispatchEvent(new CustomEvent(ACCOUNT_OPEN_EVENT, { detail: { mode: "login" } }))` */
  export interface AccountOpenDetail { mode?: AuthMode }
  ```

- [x] **Step 1: Write the failing test**

Add to `e2e/flows.pw.ts`:

```ts
test("a returning student can log in from the first-run screen", async ({ page }) => {
  await page.goto("/planlegger/");
  await page.locator("#planner-firstrun-login").click();
  await expect(page.locator("#profile-panel-submit")).toHaveText("Logg inn");
  // The planner was never gated: dismissing leaves the first-run screen intact.
  await page.keyboard.press("Escape");
  await expect(page.locator("#planner-firstrun")).toBeVisible();
});
```

- [x] **Step 2: Run it to verify it fails**

Run: `mise run e2e -- --grep "returning student can log in"`

Expected: FAIL — `#planner-firstrun-login` does not exist.

- [x] **Step 3: Add the open event**

In `src/components/account.ts`, inside `mountAccount`, beside the existing button listener:

```ts
/**
 * Opening the panel from anywhere, in a named mode. A CustomEvent rather than
 * an exported function because the panel is per page-load and the callers are
 * static markup on three different pages — the same shape `store.ts` uses for
 * `PLAN_CHANGE_EVENT`. It also works below 480px, where the topbar button is
 * folded into the menu and cannot simply be clicked.
 */
document.addEventListener(
  ACCOUNT_OPEN_EVENT,
  (event) => {
    const detail = (event as CustomEvent<AccountOpenDetail>).detail;
    panel?.show(detail?.mode);
  },
  { signal },
);
```

- [x] **Step 4: Add the line to the first-run screen**

In `planlegger/index.astro`, inside `#planner-firstrun-alt`, after the existing "Legg til direkte" line:

```astro
{/* Some fresh visitors are returning ones: a plan on the account and no local
    trace of it. A text link, not a button, so the screen keeps one accent and
    the account stays strictly opt-in (mandate 8). Nothing here gates the
    planner. */}
<p class="np-hint planner-firstrun-login-line" id="planner-firstrun-login-line">
  Har du plan fra før? <button type="button" class="np-navlink" id="planner-firstrun-login">Logg inn.</button>
</p>
```

Wire it in `plannerApp.ts`, beside the `#planner-firstrun-add` wiring from Task 3:

```ts
document.getElementById("planner-firstrun-login")?.addEventListener(
  "click",
  () => {
    document.dispatchEvent(
      new CustomEvent(ACCOUNT_OPEN_EVENT, { detail: { mode: "login" } }),
    );
  },
  { signal },
);
```

Hide the line when there is already a session — "Har du plan fra før?" is wrong for someone signed in. Read `sync.session()` at render and drop the element when it is non-null.

- [x] **Step 5: Add the line to the homepage**

`#home-now` needs a **local** plan, so a returning student on a new device gets the cold pitch with one CTA and no way back to their account.

In `src/pages/index.astro`, after the CTA at line 51:

```astro
{/* Rendered hidden and revealed by `now.ts` when there is no session. It is
    the LAST node in the pitch, so revealing it shifts nothing above or below
    it and costs no CLS — which is why it needs none of the pre-paint
    machinery `#home-now` needs. */}
<p class="np-hint home-login-line" id="home-login-line" hidden>
  Har du plan fra før? <button type="button" class="np-navlink" id="home-login">Logg inn.</button>
</p>
```

In `src/components/site/now.ts`, in the branch that decides between `#home-now` and `#home-pitch`, reveal `#home-login-line` when `sync.session()` is null and leave it hidden otherwise, and dispatch `ACCOUNT_OPEN_EVENT` with `mode: "login"` from `#home-login`.

- [x] **Step 6: Run the tests to verify they pass**

Run: `mise run check && mise run e2e -- --grep "returning student can log in"`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/components/account.ts src/pages/planlegger/index.astro src/pages/index.astro src/components/site/now.ts src/components/planner/plannerApp.ts e2e/flows.pw.ts tests/site/now.test.ts
git commit -m "feat(account): a way in for the returning student on a new browser

A quiet line on the first-run screen and under the homepage CTA, opening the
panel already in login mode through a np:account-open event. Nothing is gated:
dismissing leaves the planner exactly where it was."
```

---

### Task 7: The cold arrival stops hearing about a plan it does not have (A3)

`planClash.ts:186` tells a student who has never touched the site *"Ingen andre emner i planen din for Høst 2026."* `/emne/[code]/` is the largest cold-traffic surface on the site and the funnel PRODUCT §2 names as a success metric, so the sentence under its CTA is the highest-leverage string in the product.

**Files:**
- Modify: `src/components/site/planClash.ts:45-52` (verdict union), `:117-180` (`planClash`), `:182-202` (`clashSentence`)
- Modify: `src/components/planner/addCourse.ts:416`
- Test: `tests/site/planClash.test.ts`, `tests/planner/addCourse.test.ts`

**Interfaces:**
- Consumes: `PlanStore` reads already in `planClash`.
- Produces: `ClashVerdict` gains one member:
  ```ts
  | { kind: "no-plan" }
  ```
  Ordered before `empty` in the union. `clashSentence` and `clashNode` both handle it. `empty` keeps its existing meaning and copy.

- [x] **Step 1: Write the failing test**

Add to `tests/site/planClash.test.ts`:

```ts
describe("no plan versus an empty plan", () => {
  it("says there is no plan yet when nothing is stored", () => {
    const sentence = clashSentence({ kind: "no-plan" }, semester);
    expect(sentence).toBe("Du har ingen plan ennå. Legg til emnet, så er uka klar.");
  });

  it("keeps the empty-plan sentence when a plan exists with no other courses", () => {
    const sentence = clashSentence({ kind: "empty" }, semester);
    expect(sentence).toBe("Ingen andre emner i planen din for Høst 2026.");
  });

  it("returns no-plan when there is no stored plan and no programme", async () => {
    const verdict = await planClash(course, year, semesterWithNoStoredPlan, null);
    expect(verdict.kind).toBe("no-plan");
  });
});
```

Match `planClash`'s real signature from the file before running — the fourth argument is the programme code, and the store read may need a fixture.

- [x] **Step 2: Run it to verify it fails**

Run: `mise run check -- tests/site/planClash.test.ts`

Expected: FAIL — `"no-plan"` is not assignable to `ClashVerdict`.

- [x] **Step 3: Split the verdict**

```ts
export type ClashVerdict =
  /** No stored plan at all: this student has never used the planner. The
   *  sentence under the CTA is the reason to press it, not a report about a
   *  plan that does not exist. */
  | { kind: "no-plan" }
  /** A plan exists for this semester and holds no other courses. */
  | { kind: "empty" }
  | { kind: "off-semester" }
  | { kind: "unclassified" }
  | { kind: "clear" }
  | { kind: "clash"; partners: ClashPartner[] }
  | { kind: "error" };
```

In `clashSentence`:

```ts
case "no-plan":
  return "Du har ingen plan ennå. Legg til emnet, så er uka klar.";
case "empty":
  return `Ingen andre emner i planen din for ${term}.`;
```

In `planClash`, return `{ kind: "no-plan" }` when the store holds no courses for the semester **and** no programme, and `{ kind: "empty" }` when a plan exists but contributes no other courses. `clashNode` needs no branch of its own: `no-plan` is not `clash`, so it already falls to the `.np-hint` path.

- [x] **Step 4: Give the bare zero-result a recovery**

`addCourse.ts:416` renders `"0 treff."` with nothing to do next. The scoped and not-taught-this-year branches beside it are already specific and stay untouched.

```ts
: "0 treff. Prøv emnekode eller navn.";
```

- [x] **Step 5: Run the tests to verify they pass**

Run: `mise run check -- tests/site/planClash.test.ts tests/planner/addCourse.test.ts`

Expected: PASS.

- [x] **Step 6: Run the full gates**

Run: `mise run check && mise run e2e`

Expected: PASS.

- [x] **Step 7: Commit**

```bash
git add src/components/site/planClash.ts src/components/planner/addCourse.ts tests/site/planClash.test.ts tests/planner/addCourse.test.ts
git commit -m "feat(emne): the cold arrival stops hearing about a plan it has not made

no-plan splits from empty: a student who has never used the planner gets the
reason to press the button above the sentence, not a report on a plan that
does not exist. The bare 0 treff gains a recovery."
```

---

### Task 8: Record the decisions, and prove the whole thing green

**Files:**
- Modify: `docs/PRODUCT.md` (§4 flow 1, §11 killed list)
- Modify: `docs/DESIGN.md` (§8 voice, §9 adjudicated decisions)
- Modify: `docs/ROADMAP.md` (move the shipped items)
- Modify: `CLAUDE.md` (the copy gate is a rule a reasonable person would undo)

**Interfaces:**
- Consumes: everything Tasks 1–7 built.
- Produces: no code.

- [x] **Step 1: PRODUCT.md**

- §4 flow 1: the on-ramp is now the first-run screen, not the planner's week card. Programme and kull commit on the kull press; there is no Lagre on that screen. Record that the returning student's login line sits there and on the homepage, and that **neither gates the planner** — mandate 8's "strictly opt-in" is unchanged.
- §11 killed list, so they do not come back: **no welcome modal, no guided tour, no coach marks, no progress stepper, no sample or demo plan, no illustrations in empty states.** The week is the demo and it is real. Record the reason: onboarding's job here is time-to-value, and the value is two decisions away.

- [x] **Step 2: DESIGN.md**

- §8 (Voice and copy): the banned marks and the struck vocabulary, with the rewrite rule and the note that `tests/copy.test.ts` gates them.
- §9 (Adjudicated decisions): a new entry for the login/register split — one mode, one submit, a link to the other path, name carried and PIN cleared across the switch, login the default because the two callers that know pass `signup` explicitly. State that this supersedes the deleted comment about arbitrary Enter routing.
- §9: a second entry for the first-run screen — the predicate is the probe's existing `data-plan` absence, the picker is the same unit as the dialog's under a different commit policy, and the bar is gated on the **plan** rather than on drawn sessions so no control appears or vanishes after a fetch lands.

- [x] **Step 3: ROADMAP.md**

Move the onboarding and empty-state items into Shipped. Leave the spec's three out-of-scope items in Known-minor: the homepage's thin below-fold layout, `astro dev` shadowing `/data/programs.json` (the crawler record at the project root is served in place of the tuple endpoint, so the typeahead throws `programOptions.filter is not a function` under `npm run dev`), and the typeahead's lowercase `trondheim`.

- [x] **Step 4: CLAUDE.md**

Add the copy gate to the list of non-obvious rules: `tests/copy.test.ts` bans `—` and `·` in user-facing strings across `src/` and `worker/`, and bans "tegne uka". It strips comments before scanning, so the docs' and comments' em-dashed register is untouched. Do not relax it to land a string; rewrite the string.

- [x] **Step 5: Run everything**

Run: `mise run check && mise run e2e`

Expected: PASS, both.

- [x] **Step 6: Commit**

```bash
git add docs CLAUDE.md
git commit -m "docs: record the onboarding decisions and the copy gate

PRODUCT gains the first-run on-ramp and a killed list that keeps tours,
steppers and demo plans out. DESIGN records the login/register split and the
first-run predicate. CLAUDE.md gains the copy gate."
```

---

## Self-review

**Spec coverage.** §1 first-run predicate → Task 3 Step 3. §2 first-run screen → Task 3. §3 one picker two hosts, plus the dialog's title trim and its Lagre → Task 2. §4 chrome and section gates → Tasks 3 (bar) and 4 (sections). §5 punctuation sweep → Task 1. A1 login entry → Task 6. A2 login/register split → Task 5. A3 cold-arrival copy → Task 7. Spec testing §: copy gate (Task 1), first-run e2e (Task 3 Step 1), CLS budget (Task 3 Step 6). The spec's "probe predicate unit test over empty / courses-only / programme-only / malformed storage" is **not** separately covered — `planProbe.ts` already has tests; verify during Task 3 and add the missing cases there if they are absent.

**Type consistency.** `commit: "explicit" | "on-kull"` is named identically in Tasks 2 and 3. `AuthMode` is defined in Task 5 and consumed in Task 6. `ProfilePanelHandle.show(mode?: AuthMode)` widens one signature, used by `account.ts`'s existing `panel?.show()` call (still valid) and by the new event listener. `ACCOUNT_OPEN_EVENT` and `AccountOpenDetail` are exported from `account.ts` in Task 6 and imported by `plannerApp.ts` and `now.ts` in the same task. `ClashVerdict`'s `no-plan` is added in Task 7 and handled in both `clashSentence` and `clashNode`.

**Known imprecision, to resolve while implementing rather than guess now.** Three places name a selector or helper this plan could not verify without opening a file mid-write: the typeahead ids in Task 3 Step 1, the planner's real repaint entry point in Task 3 Step 4, and `planClash`'s exact argument list in Task 7 Step 1. Each step says to read the file and correct the reference before running. That is a reading step, not a design decision.
