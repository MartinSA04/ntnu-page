# Kalender, stage 2 — remove Rader, remove cards

Working paper for finishing the direction change that landed in `4e2737b`
("The paper is gone, and the type is the platform's own"). Everything below
was **attempted and verified once** in the session that wrote this, then
reverted because the e2e port could not be finished and landed green in the
same sitting. The edits are known-good; the test work is the open part.

Read `docs/DESIGN.md` §9 first — it records what stage 1 did and did not do.

---

## Where stage 1 left things

Landed and green on both gates:

- `tokens.css` remapped: white ground that IS the content surface, system ink
  ramp, `--ui` stays ink, a separate `--accent` with one job, six course hues
  held clear of the accent / verdict / clash, `--block-mix` 100 % both themes.
- Type is the platform UI face. `--font-mono` is an alias of `--font-sans`, so
  `.np-data` survives at every call site and the distinction moved to
  `font-variant-numeric: tabular-nums`.
- Deleted: `scripts/fetch-fonts.mjs`, `scripts/woff2-tables.mjs`,
  `src/styles/fonts.css`, `src/styles/fonts/*.woff2`, `tests/fonts.test.ts`,
  both `<link rel="preload">` tags.
- `--exam-date-col` 6.5rem → 5.5rem (a proportional face sets the date string
  narrower than the mono it was measured for).

Still true of the component layer, and why this paper exists: **cards are
still page structure and the planner still has three week views.**

---

## 2a. Remove Rader as a planner view

Rader = `WeekView "uke"` = the transposed grid in `grid.ts`. **Do not delete
`grid.ts`.** `/emne/[code]/` draws a single course's week through it and
always has; only the planner's *third tab* goes.

### Source edits (all verified working)

`src/components/planner/plannerApp.ts`
- `export type WeekView = "kolonner" | "tavle";`
- `const WEEK_VIEWS: readonly WeekView[] = ["kolonner", "tavle"];`
- `loadWeekView()` fallback `"uke"` → `"kolonner"`, both the `find(...) ??`
  and the `catch`.
- Delete `viewUke: byId<HTMLButtonElement>("planner-view-uke"),` from the
  elements map.
- Delete `elements.viewUke.addEventListener("click", () => setWeekView("uke"));`
- `renderViewTabs()`: drop the `[elements.viewUke, "uke"]` tuple, and retarget
  `const tabs = elements.viewUke.parentElement` → `elements.viewKolonner.parentElement`.
  **This one bites if missed** — it throws `Cannot read properties of
  undefined (reading 'setAttribute')` and takes 25 unit tests with it.
- Render dispatch: `} else if (weekView === "tavle") {` → `} else {`, then
  delete the now-unreachable trailing `else` block that called `renderGrid`
  into `elements.gridFrame`.

`src/layouts/Layout.astro` (the pre-paint probe)
- `var view = "uke";` → `"kolonner"`, and the `catch`'s `view = "uke";` too.
  If the probe's default disagrees with `loadWeekView`'s, a cold load reserves
  the wrong view's height and the CLS budget goes.

`src/pages/planlegger/index.astro`
- Drop the Rader button; relabel Kolonner → **"Uke"**, give it
  `aria-pressed="true"`. Liste keeps its label.
- Rewrite the comment above the tabs: it explains a naming rule for *two
  grids* that no longer both exist.

### Open decision: which view is the default

Stage 2 as attempted kept `"kolonner"` because it is the closest heir to the
old default and it kept the unit suite honest. **The owner prefers Liste** and
said so repeatedly; the artifact defaults to it. Making `"tavle"` the default
is a one-line change in three places (`loadWeekView` ×2, the probe) but it
broke 7 further unit tests that assert grid content by default, so it wants
doing deliberately with those tests updated — and `--planner-box` re-measured
for whichever view now loads first (`planner-week.css`, `#planner-grid-frame`).

---

## 2b. The e2e port — the actual work

Baseline: removing Rader fails **46** e2e tests. One change fixes 28 of them.

### The leverage

`e2e/flows.pw.ts:39`

```ts
const gridBlocks = (page: Page) => page.locator("#planner-grid-frame .planner-block");
```

45 call sites go through this. Point it at whichever week is mounted:

```ts
const gridBlocks = (page: Page) =>
  page.locator("#planner-grid-frame .planner-block, #planner-grid-frame .planner-cols-block");
```

Also `tests/planner/plannerApp.test.ts`: `.planner-block` → `.planner-cols-block`
(app-5) and `.planner-grid` → `.planner-cols` (mob-5). With those three edits
`mise run check` is green (825/825) and e2e drops to **18** failures.

### The remaining 18, triaged

**Delete, or move to `/emne/[code]/` — they assert transposed-grid geometry the
planner no longer has:**

- `every bar is centred in its row`
- `the days stay put while the week is dragged`
- the `nålen` group (`is on today's row inside the drawn hours, and nowhere else`)
- `the row height animates with the layer instead of snapping`
- `the layer leaves in the reverse of the order it arrived in`
- `overlap: two colliding courses stack, both full width and readable`
- `week: three overlapping lectures stack into three lanes, no pile`

Two of these are the **layer-motion** tests. The motion itself still exists —
`columnGrid.ts` has its own path through `layerMotion.ts` and the list half is
a plain FLIP — so port rather than drop if there is appetite, otherwise the
øving toggle ships with its choreography untested on the planner.

**Reword (they name three views):**

- `week: Rader, Kolonner and Liste show the same week three ways`
- `ett navn: the plan is named once, and the switch is not a third toggle`

**Diagnose — 9 tests, one suspected root cause.** They time out at ~45 s,
which reads as waiting on something Kolonner renders differently rather than
nine separate faults. Start with
`week: the øving toggle moves the layer and leaves nothing behind` (flows.pw.ts:958):

- `drop and restore a programme course`
- `dropping from a block's settings keeps focus in the document`
- `groups: a non-default parallel renders with a programme set`
- `kolonner: an open øvingsvindu names itself, opens, and stacks`
- `session popover: the card names the building, the length and the collision`
- `the landing card counts its own minutes down`
- `the week follows the day across midnight`
- `week: the øving layer shows picked groups, not the whole cohort's`
- `week: the øving toggle moves the layer and leaves nothing behind`

`e2e/cls.pw.ts` also holds 8 Rader selectors; check its budgets after the
default view settles.

---

## 2c. Remove cards as page structure

Independent of 2a and lower risk — it touches `primitives.css` and the
planner page's own styles, not the week's behaviour.

The rule: **cards are a container for content whose count and shape you do not
know at build time.** This page knows both — one week, one exam list, one
course list. Structure comes from type, hairlines and space instead.

- Drop the card treatment from the planner's Eksamener and Emner sections and
  from the week's frame. Two columns split by a single hairline, not two
  bordered boxes on a grey page.
- `--bg` is already white and IS the surface; `--card` survives only for
  things that genuinely float (popovers, the three `<dialog>`s).
- Section heads carry the structure: heading + a muted qualifier, then rows
  separated by hairlines.
- The exam date badge becomes typography (`**21.** nov`), not a bordered chip.
- Watch specificity: `.np-panel` and `.np-frame` both carry surface + border +
  radius, and `.np-frame` sets `overflow: hidden` — see the warning in
  `planner-week.css` about why the week's frame is deliberately not one.

### Two things the artifact learned that belong here

- **`isRoomCode` is too strict** (`board.ts`). `/^[A-ZÆØÅ]{1,4}\d{1,3}[A-ZÆØÅ]?$/`
  rejects `A4-156` — a real Realfagbygget room, and where TDT4120's
  øvingsveiledning sits five days a week — purely for the hyphen, so it renders
  in the small `is-long` style meant for "Digital undervisning". What separates
  a code from a sentence is whitespace and a digit, not punctuation:
  `t.length <= 8 && !/\s/.test(t) && /\d/.test(t)`.
- **The week header is heading-sized for a label.** 34 px circle around a 20 px
  numeral costs vertical space the week needs, worst on a phone where the grid
  already scrolls sideways.

---

## Gates

`mise run check` and `mise run e2e` must both be green before this lands.
`e2e` gates `release.yml` directly, so a tag push re-runs it regardless of the
tagged diff's paths.

Reference artifact for the target design (Liste + Uke, no cards, verdict line,
deadline, provenance, session popover):
<https://claude.ai/code/artifact/96e27231-46ed-4af6-9f66-0a5a6d0563a0>
