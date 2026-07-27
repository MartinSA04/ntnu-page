# Planner simplification — 2026-07-27

Mandate from the user, verbatim in substance: the planner is still bad. Three
buttons open one modal; semester switching is duplicated on the main surface;
the block popover cannot be closed and its group picker is broken; the schedule
looks like a spreadsheet; there is text on screen that restates the line above
it. The design ethos is **as simple as possible — this is a utility, not a
portfolio or a SaaS site.**

This spec is a subtraction pass. It adds one control (a close button) and
removes everything else on the list.

## 1. One opener for the studieinfo modal

`/planlegger/` currently offers three permanent controls that all call
`studieinfo.open()`:

1. `#studieinfo-chip` — the sitewide topbar chip (`Layout.astro`).
2. `#planner-context-change` — the banner's "Endre" / "Velg studieprogram".
3. `button.planner-title-name` — the page title, silently a button.

**Decision: the topbar chip is the only persistent opener.** It already states
`CODE · kull · semester`, it works from every page, and `e2e/flows.pw.ts`
already drives it as the canonical way in.

- `index.astro`: delete `.planner-banner-controls` and `#planner-context-change`.
- `plannerApp.ts` `renderBanner()`: render the programme name as a plain
  `<span>`; drop the click handler and the `contextChange` element ref.
- `index.astro` styles: delete `button.planner-title-name` and
  `.planner-banner-controls`.

**Deliberately kept:** the contextual openers *inside* the week — the no-plan
onboarding card, the studieretning question's "Endre studieinfo"
(`#planner-direction-btn`), and the state-4 "none of your courses are taught
this term" card. These are mutually exclusive, appear only when the week is
otherwise empty, and are the one next action on an empty screen. The complaint
was three simultaneous permanent openers; that becomes one.

## 2. Semester switching lives only in the modal

The modal's `#studieinfo-semester-select` already owns the semester and commits
it unconditionally and first (`studieinfo.ts` `commit()`).

Remove from `/planlegger/`:

- the `<details id="planner-semester">` disclosure and its `.planner-semester*`
  styles;
- `renderSemesterToggle()` and both its calls;
- the `semesterDisclosure` / `toggleHost` element refs.

The semester stays **stated** in the banner context line ("kull 2024 · Høst
2026") as a fact. It is simply no longer switchable from there.

## 3. Block popover

### 3.1 It must be closable

`popover.ts` wires Esc and an outside `pointerdown`, and nothing else. Below
60rem the dialog is a full-bleed bottom sheet, so "click outside" is a sliver
of screen and there is no visible affordance at any width.

Add a `×` close button pinned to the top-right of the dialog, present in both
the `course` and `info` contexts, `aria-label="Lukk"`. Esc and outside-click
stay.

### 3.2 "Vis alle grupper" is deleted, not fixed

`showAllGroups()` calls `setSelection([])`. In `applyGroupSelection`
(`groups.ts`), `[]` is the encoding for *"no explicit pick — apply the
programme default"*, so the button **narrows** the grid to the default parallel.
Its label promises the opposite. The radios and checkboxes already express
every selection the student needs, so the button and its
`.planner-popover-showall` style are removed.

### 3.3 No picker for a choice that does not exist

The group section is gated on `ctx.groups.length > 1`, which counts lecture
parallels and øving/lab groups together. A course with one parallel and two
øving groups therefore renders a single dead radio.

New rule, per kind:

- lecture radios render only when there are **≥2** `kind === "lecture"` options;
- øving/lab checkboxes render only when there are **≥2** non-lecture options;
- if neither qualifies, the whole `Grupper` section is omitted and the popover
  is facts + actions.

Selection semantics are unchanged: `pickLecture` / `toggleOther` /
`setSelection` and their store writes stay exactly as they are.

## 4. The schedule stops looking like a spreadsheet

Today `#planner-grid-frame` carries `np-frame np-ruled np-ruled--hours`: a
bordered, rounded, tiled surface with a 1px line every 15 minutes in both axes
and a heavier line every hour.

**Target: hour hairlines only.** No 15-minute squares, no vertical column
rules, no border, no rounded box.

- `index.astro`: the frame element keeps only `planner-grid-frame`.
- `planner-week.css`: `.planner-grid-frame` owns its own background —
  a single `linear-gradient` hairline at `calc(var(--cell) * 4)`.
- `grid.ts`: the `np-ruled` toggling in the message/empty branches becomes a
  `.is-empty` toggle on the same element (Ruling-Marks-The-Plan is preserved —
  the hour lines still vanish behind an apology, they just aren't a grid).

Day headers, the hour rail, per-course tints, clash edges and clash bands are
all unchanged.

**Watch item.** `overflow-x: auto` is currently authored as
`.np-frame.planner-grid-frame`, deliberately qualified — a CLAUDE.md note warns
that `np-frame`'s `overflow: hidden` would otherwise win on stylesheet order
and silently kill the week's horizontal scroll (A4). Dropping `np-frame` from
the element removes the conflict; the rule and its comment must be rewritten,
not left stale.

## 5. Text removed

### 5.1 The overload note

`"7,5 sp over normal semesterbelastning."` sits directly under `37,5 av 30 sp`.
Delete that branch of `renderCreditLine()`.

The other two notes stay, because neither is derivable from a number on screen:
the off-semester note ("N emner undervises ikke i Høst 2026 og teller ikke
med") explains why the arithmetic excludes a visible row, and the suspicious-
prefill note names a study-plan defect.

### 5.2 The exam summary box

`"5 eksamener over 26 dager"` is `model.summary` rendered into its own ruled
`#planner-exam-frame`. Remove:

- the `#planner-exam-frame` element and its styles;
- every `frame` write in `examList.ts` — messages move into the list host;
- `summary` from `ExamListModel` and the arithmetic that builds it
  (`examSchedule.ts`), plus the two tests that assert it.

The chronological list is unchanged: dated rows, **all** gap connectors
("3 dager mellomrom", "1 dag mellomrom · tett", "samme dag"), the countdown on
the first upcoming exam, and dateless rows.

### 5.3 Explicitly kept

- The collision verdict beside the Ukeplan kicker ("ingen kollisjoner" /
  "2 kollisjoner denne uka"). It is the answer to PRODUCT §1's primary
  question — the reason the page exists.
- The provenance line. `docs/PRODUCT.md` DR-8 makes provenance binding, and a
  general "remove unnecessary text" instruction is not a licence to delete a
  documented domain rule.

## Testing

- `mise run check` — unit pass. `examSchedule.test.ts` loses its two summary
  assertions; `groups.test.ts` is untouched (selection semantics unchanged).
- `mise run e2e` — the browser suite is the only place the removals are
  visible. Existing specs already drive `#studieinfo-chip` for programme and
  semester changes, so they should pass unmodified; the popover specs
  (`flows.pw.ts:171`, `:206`) target `.planner-popover-group-row` on TDT4110 /
  EXPH0300, both genuinely multi-parallel, so the new per-kind gate must not
  hide their radios.
- New e2e coverage: the popover closes via its `×`, and `/planlegger/` exposes
  exactly one element that opens `#studieinfo-dialog`.

## Out of scope

Anything not on the list above. No new features, no re-layout of the two
regions, no changes to the store, the hash grammar, the crawler or the worker.
