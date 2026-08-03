# Planner chrome, re-cut — design

**Date:** 2026-08-03
**Status:** approved, not yet planned

Three changes to the chrome around the week. They are separable, but they touch
the same two bars, the same four test files and the same doc sections, so they
are specified together and shipped in the order below.

1. **Studieinfo comes back to `/planlegger/`**, out of the site header, with the
   plan's own title as its door.
2. **Both bars collapse to a menu on a phone** — the shell's `☰` and the
   planner's `⋯`.
3. **`/emne/[code]/` states that its week is every parallel**, and offers to
   narrow it when a programme is stored.

(3) exists because of (1): moving the programme picker off every page is what
takes away a cold arrival's ability to say who they are, and (3) is where that
is paid back.

---

## 1. Studieinfo comes back to the planner

### What moves

The whole studieinfo chain — **programme, kull, studieretning** — leaves the
profile panel and becomes the planner's own `<dialog>`. Not programme alone:
`studieinfo.ts` stages all three and commits them on one **Lagre**, programme
decides which kull are relevant, and kull decides which studieretning exist.
Splitting the chain across two surfaces is a rewrite, not a layout choice.

**The account stays in the header.** Sign-in, the device registry and Bytt PIN
govern `np:plans` synchronisation, which is genuinely site-wide, and a cold
`/emne/[code]/` arrival must still be able to sign in without navigating away.
`AccountButton`, `account.ts` and `profilePanel.ts` all survive; the panel loses
its studieinfo section, the divider under it, and the accent that section
carried.

`src/pages/data/programs.json.ts` **stays a fetched static file.** It became one
because the picker stood on 5 470 documents; inlining 27 KB back into the
planner's HTML would be a regression whatever the picker's address.

### The door is the plan's title

`MTFYMA Kull 24` and the context line under it become the control that opens the
picker. Press the fact to change the fact.

- **Underlined on hover only**, never at rest — the grammar
  `button.planner-chip.is-jump` already establishes for the collision verdict:
  at rest it is a name and must read as one.
- A `chevron-down` mark after the title carries the affordance at rest.
- It costs **zero bar width**, so it does not compete with §2's `⋯` menu and
  behaves identically at every viewport. This is why it was chosen over an
  explicit button in the action run, which on a phone would have put programme
  selection two taps behind a menu.
- Empty state is unchanged in shape: the title reads `Semesterplan`, and the
  existing "Velg studieprogram" affordance opens the same dialog with the caret
  in the programme field.

### Code shape

The extraction is surgical because the section is already decoupled —
`buildStudieinfoSection({ store, onSaved })` returns
`{ element, reset, focusProgram, focusDirection }` and nothing else.

| file | change |
|---|---|
| `src/components/planner/studieinfoDialog.ts` | **new.** Wraps `buildStudieinfoSection` in a `<dialog>` on `courseSettings.ts`'s modal pattern — built with `el`, `showModal()`, `closedby="any"`, appended to `document.body`, idempotent against a stale dialog. Mounted from `plannerApp.ts` via `onPage`. |
| `src/components/planner/profilePanel.ts` | drops the `studieinfo.js` import, both `body.append(studieinfo.element, renderDivider())` calls, `studieinfo.reset()`, and the `focus` parameter that routed to `focusProgram`/`focusDirection`. |
| `src/components/planner/plannerApp.ts` | `openProfile(focus?)` (:456) becomes `openStudieinfo(focus?)` against the new dialog. Two call sites: `"direction"` (:1794, the "Velg studieretning" action) and `"program"` (:2605). The `accountPanel()?.setSyncState(...)` calls are untouched. |
| `src/components/planner/studieinfo.ts` | unmoved and largely unedited; it already lives under `components/planner/`. |

A layering win falls out: `studieinfo.ts` imports
`type ProgramOption` from `./plannerApp.js`, so today a site-wide module
(`account.ts` → `profilePanel.ts` → `studieinfo.ts`) reaches into planner types.
After this, nothing site-wide imports it.

### Doc amendments

**PRODUCT mandate 8 currently names the arrangement being removed as its own
delivery** — "one room, holding studieinfo *and* the optional account, opened by
one door — the topbar's account button". The mandate text changes, not only
DESIGN. Rewrite it to: a real settings surface for programme/kull/retning, on
the planner, opened from the plan's own name; the account is a separate
site-wide door. PRODUCT §5's on-ramp paragraph ("opens the profile panel with
the caret already in the programme field") needs the same correction.

### The cost, stated

`/emne/[code]/` loses the only place a student could say which programme they
are on. That page reads `plan.program?.code` for the clash verdict
(`[code].astro:701`), and `now.ts:139` reads it for the homepage's next session.
Section 3 is the mitigation and ships with this.

---

## 2. Both bars collapse to a menu on a phone

### Mechanism: one DOM, a wrapper that changes clothes

Every control involved is bound by identity — `#site-account-btn`,
`#site-account-name`, `#planner-others-toggle`, `#planner-share`,
`#planner-share-label`, `#planner-semester-select` — plus `.theme-toggle`'s
`aria-pressed` sync. So neither obvious approach is available: **duplicated
markup** collides those ids (the pre-paint name script would correct the wrong
`#site-account-name`), and **`matchMedia` node-moving** relocates a live
`<select>` and a focused button across resizes on top of ClientRouter swaps.

Instead each bar gets **one wrapper** around the controls that collapse:

```
≥ breakpoint    .site-menu-panel { display: contents }
                → children are direct flex kids of the bar, laid out
                  exactly as today. The trigger is display: none.

< breakpoint    .site-menu-panel { position: absolute; … }
                → an .np-frame panel under the trigger, hidden unless
                  the bar carries data-menu="open".
```

Three consequences:

**The closed state is `data-menu="open"` on the bar, never `[hidden]` on the
wrapper.** `primitives.css`'s `[hidden] { display: none !important }` would beat
the desktop `display: contents` too and delete the controls at every width.
This is exactly the trap that rule exists to catch.

**Not a `<dialog>`, not `[popover]`.** Neither can be switched back to inline
layout by CSS, which is the whole premise. So it is a positioned `div` with
dismissal wired by hand — Escape, the scrim, `focusout` — which is what
`blockPopover.ts` already does for the same reason. `aria-expanded` +
`aria-controls` on the trigger, focus returns to the trigger on close, and a
`matchMedia` listener closes the menu if the viewport crosses the breakpoint
while it is open.

**Mounted through `onPage(setup)` with `{ signal }`.** Mounting at top level
leaves the menu dead after any in-site navigation.

The scrim doubles as the outside-click target — one element to hit-test instead
of document-level geometry. `color-mix(in srgb, var(--fg) 32%, transparent)`,
matching `.course-settings::backdrop`. No new token, and the three existing
`::backdrop` rules are **not** refactored onto one.

**CLS is zero by construction**: the triggers are server-rendered static markup
and the panel is out of flow. Nothing here needs a reservation.

### DOM order == visual order == tab order

The planner bar's order changes at **every** width, not only on a phone: today
`layer · Uke|Liste · Del lenke · semester`, after this `layer · Del lenke ·
semester · Uke|Liste`. Deliberate — it puts the run that collapses *before* the
switch that stays, so the phone layout is literally "the first three fold up",
with no `order:` tricks and no divergence between visual and focus order. It
also lands the view switch at the far right, where Google Calendar and Apple
Calendar put theirs.

### The shell menu — `☰`, below 480 px

The bar becomes `Semesterplan NTNU` + `☰`. The wordmark **stops truncating**:
brand ≈ 148 px + a 44 px target + gutters ≈ 224 px of 360, so `.site-brand`'s
`--text-base` step-down, its `text-overflow: ellipsis`, and
`.site-brand-suffix { display: none }` all come off.

Panel rows, 44 px each, in DOM order:

| row | note |
|---|---|
| Planlegger | `aria-current="page"` still marks the section |
| Emner | |
| — | 1 px `--border` rule: links go somewhere, the two below change something |
| ◉ *account name* | **the name is visible here** — the reason this beats a bare mark |
| ☾ Mørkt tema | |

Two markup consequences. `.site-account-name`'s `display: none` at 480 px is
**deleted** and its `max-width: 10ch` relaxes inside the panel. And
`ThemeToggle` grows a visible `<span>` label, hidden ≥ 480 px, which forces its
accessible name to change: `aria-label="Bytt tema"` → **`"Mørkt tema"`**, so
visible text and accessible name agree (WCAG 2.5.3) while `aria-pressed` keeps
carrying the state.

### The planner menu — `⋯`, below 46 rem

46 rem, not 480 px, because that is where this bar actually stops wrapping
(title 150 + layer 170 + tabs 120 + share 110 + semester 120 + gaps ≈ 734 px)
and where its existing phone rules already live. Each bar collapses when *it*
runs out of room, so a 700 px tablet gets `⋯` while the shell bar stays
expanded.

Panel rows: `☑ Øvinger og labber` (carrying `.planner-others-pending` as today),
`⇪ Del lenke` (still `[hidden]` until a plan exists — that attribute works
unchanged inside the panel), and the semester `<select>` on its own row.

**The semester stays label-less.** DESIGN's reason — every option names itself,
so a "Semester" caption spends a row restating the option — holds as well in a
vertical list as in the bar.

### One rule for whether a press closes the menu

> **A control that redraws the week closes the menu. A control that only
> confirms itself stays open.**

The layer checkbox and the semester select close it: DESIGN §7 says those two
animate *specifically* so "a student who pressed one of them… needs to be able
to follow it there", and you cannot follow it under a scrim. «Del lenke» does
not close — it swaps mark and word to `Kopiert` in place, which is the
confirmation §9's pinned-width decision exists to protect.

### New assets

A `more` glyph in `Icon.astro`. `menu` already exists.

---

## 3. `/emne/[code]/` states its scope, and can narrow it

### Today

`courseTimetable.ts` draws `renderGrid(..., { showAllGroups: true })`
deliberately — "this is the course's own reference page, not one student's
plan". So "every parallel" is already true; it is simply never said, and there
is no way to ask for anything else.

### The ladder

`applyGroupSelection(entries, selected, programCode)` is the narrowing, already
called this way by `now.ts`. Three states:

| state | narrowed week is | the line adds |
|---|---|---|
| no programme stored | *(no switch)* | «Velg studieprogram i planleggeren for å se din egen undervisning.» |
| programme, course not in plan | your programme's lecture section; other programmes' øving groups dropped | «Legg emnet i planen for å velge øvingsgruppe.» |
| programme, course in plan with picks | also honours the picked group (`course.groups`) | — |

### The switch renders only when it would change the week

`entriesForProgram` is a no-op for a course that names no programme, so on most
courses narrowing changes nothing. Render the control only when
`applyGroupSelection(entries, …, programCode).length !== entries.length`.
A control that visibly does nothing is the exact failure DESIGN §9 records
against the layer box.

### Default: all, per visit

Every course page opens showing everything. The choice is **not persisted** —
the next course page opens on "all" again. This keeps "the course's own
reference page" true, keeps one URL showing two people the same week, and adds
no state that would need a pre-paint probe read to avoid shifting the week in.

### Shape

A second `.np-toggle` beside the existing `timetable-others` ("Vis øvinger og
labber"), which means wrapping the two in a row rather than appending the first
straight to `body`. The line is a `p.np-hint`, after the existing
`.np-hint.timetable-term`.

**Copy is proposed, not settled** — the narrowing covers lecture *parallels*
**and** øving groups, so «Bare min parallell» names half of what it does while
«Bare mitt program» is wrong once a picked group is involved:

- switch label — **«Bare min undervisning»** (alternates: «Bare mitt program»,
  «Bare min parallell»)
- off — «Uka viser alle paralleller og grupper for emnet.» + the ladder's line
- on — «Viser undervisningen for {PROGRAMKODE}.» + the ladder's line

Bokmål, sentence case.

---

## Testing

### Existing tests that change

- **`e2e/flows.pw.ts:2048`, "the account on a phone" — superseded, rewritten not
  deleted.** It asserts `#site-account-name` is hidden and the button is a 44 px
  square alone in the bar. It becomes: the button is inside the menu, the name
  *is* visible there, the bar is still one row ≤ 64 px.
- **`e2e/flows.pw.ts:1858`** asserts DESIGN §6's 37 % phone gate directly. It
  should pass with more slack. **Re-measure and update §6's recorded "304 px of
  844" with the real number** rather than assert an unverified improvement.
- `e2e/navigation.pw.ts` (:44 `.site-nav a`, :93 `.theme-toggle`) runs at
  `devices["Desktop Chrome"]`, above both breakpoints — unaffected, but confirm.
- **`e2e/sync.pw.ts` is unaffected**, and the reason is worth writing down
  because the file reads as though it were not: its `phone` and `laptop` are two
  browser *contexts* standing for two devices, not two viewports. Both inherit
  `devices["Desktop Chrome"]`, so its `getByRole("button", { name: "Profil" })`
  clicks land on the expanded topbar. The account button survives §1 intact.
- **`tests/planner/plannerApp.test.ts` is affected by §1, not §2**: it
  `vi.doUnmock`s `profilePanel.js` (:2599), so the module mock reroutes to the
  new studieinfo dialog, and three comments go stale (:239, :1054, :1405).
- `e2e/cls.pw.ts` budgets should improve; they are a floor, not a target.

### New coverage

**Menus, at phone width:** open and close by Escape, by the scrim, and by
`focusout`; focus returns to the trigger; each control still works from inside
its panel; the layer and semester close the menu while «Del lenke» does not;
**the menu survives a ClientRouter navigation** (the `onPage` rule — the one
that rots silently); and at desktop width the triggers are absent with every
control in its bar.

**Studieinfo:** the plan title opens the picker; a save writes and closes; the
profile panel no longer contains a programme field; the "Velg studieretning"
action still lands with the caret in the right field.

**Course-page scope:** the line states the right rung for each of the three
states; the switch is absent for a course narrowing cannot change; flipping it
redraws; and it resets on the next course page.

---

## Doc amendments, collected

- **PRODUCT mandate 8** — rewritten (§1 above). **PRODUCT §5** on-ramp paragraph
  — the planner's empty state opens the planner's own picker.
- **DESIGN §9** — the topbar's "below 480 px it is the mark alone" bullet is
  superseded; the plan bar's enumeration takes the new order; the plan title
  gains its door; the phone-menu idiom gets a named rule.
- **DESIGN §6** — the 37 % gate's recorded measurement, re-measured.
- **CLAUDE.md** — the layout-shift bullet's account of the topbar, and the
  studieinfo-door history, both need a line.

Nothing here is on PRODUCT §11's killed list. "The topbar studieinfo *chip*" is
a plan-state display, not a door, and stays killed.
