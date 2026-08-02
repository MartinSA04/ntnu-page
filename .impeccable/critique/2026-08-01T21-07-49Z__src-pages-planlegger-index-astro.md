---
target: /planlegger/ (the planner)
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
timestamp: 2026-08-01T21-07-49Z
slug: src-pages-planlegger-index-astro
---
Method: dual-agent (A: design review, isolated · B: detector + browser evidence, isolated). Target: `/planlegger/` — the planner, re-run after the fix pass. Both drove the rebuilt site on `wrangler dev` with recorded `/api/*` fixtures; neither saw the other's output, the earlier critique, or the fix rationale.

## Design Health Score

| # | Heuristic | Score | Δ | Key Issue |
|---|-----------|-------|---|-----------|
| 1 | Visibility of System Status | 3 | +1 | Loading is well handled, but a *total* timetable failure prints **no verdict at all** — `renderVerdict` returns early on `state !== "grid"`, so the product's one answer silently disappears. |
| 2 | Match System / Real World | 3 | — | Bokmål, sp, kull, lesedager, ISO weeks all correct. Undercut by a week dated `MAN 27` whose every block runs `uke 34–47`, and by raw NTNU parallel strings shown unmediated. |
| 3 | User Control and Freedom | 3 | — | Escape closes all four dialogs on one press; Dropp/Legg tilbake reversible. A shared link still replaces the plan — now with an inline "Behold min egen", not the specified merge/replace/keep. |
| 4 | Consistency and Standards | 2 | — | Same session identified by code in Uke and by name in Liste, content measure moving 224px between them. Primary is `#1a73e8` on the page and ink in the studieinfo modal. The loading skeleton is a different grid geometry from the week it precedes. |
| 5 | Error Prevention | 2 | — | 17 unlabelled parallel checkboxes with no "yours" mark. `TMA4110 Matematikk 3` and `TMA4111 Matematikk 3` are indistinguishable in the add dialog. |
| 6 | Recognition Rather Than Recall | 2 | — | Picking a parallel means recalling your own programme code and matching it against 17 strings the app could mark. Reading the week means holding "uke 34–47" against a header saying "MAN 27". |
| 7 | Flexibility and Efficiency | 3 | +1 | 24 tab stops, no traps, URL is state, Enter now adds. But the keyboard add path loses the confirmation the mouse path shows. |
| 8 | Aesthetic and Minimalist Design | 3 | — | Week and exam list excellent. Against: first run centres one sentence in ~470px of reserved height; the bar shows five controls of which three are inert on an empty plan; the exam band spends 93 grey cells on what the dated list states exactly. |
| 9 | Error Recovery | 3 | — | `Fikk ikke hentet timeplanen.` + `Prøv igjen` is a proper error with recovery. But the provenance line reads "timeplan for" five times, and the verdict goes blank rather than saying `kan ikke sjekkes`. |
| 10 | Help and Documentation | 2 | — | One sentence explains a 17-option decision. `se detaljer` appears identically on all five course rows. The central honesty claim sits behind a disclosure collapsed on a phone. |
| **Total** | | **26/40** | **+2** | **Acceptable — the P0s are gone, the structural issues are not** |

## Design Specificity Verdict

**Authored in the data layer, stock in the control layer — and the seam is visible at the top of every screen.** Sharper than last time, because the fix pass moved the data layer and not the chrome.

The week is provably *disciplined restraint*, not default: 52px an hour (a deliberate step down from 72), a 3px left inset so a block doesn't sit on the day's own rule, a 6px right channel so the hour ruling runs unbroken past it, 2px off the bottom so the line a session *ends* on is never covered, 4px corners so two touching blocks don't fuse. Five hand-set decisions in one shape. The exam list remains the strongest product-specific design on the site, and the verdict now has a genuine third state — `kan ikke sjekkes, ingen forelesninger i planen` — carrying **no mark at all**, because both signal colours are spoken for.

Against that: the top bar is a stock SaaS toolbar (checkbox, segmented control, two ghost buttons, one blue primary) that could belong to a CRM; the add dialog is a generic search-list modal with no field from this domain; and the studieinfo modal's uppercase tracked labels (`STUDIEPROGRAM` / `KULL` / `SEMESTER`) are the one institutional-form idiom on the site — the exact register DESIGN §1 rejects by name. The two grammars are visible side by side: the block popover uses labelled rows (`Tid` / `Sted`), the course-settings modal on the same page uses unlabelled lines.

**Deterministic scan**: exit 0, **zero findings** on the planner page and on `src/pages src/components src/layouts` — and this time the harness was proven real three ways (a bad full document → exit 2 with `overused-font` + `bounce-easing`; a bad `.astro` file → exit 2; identical results with `--no-config`, so nothing is being suppressed).

**In-page detector**, six states: 4–5 findings per planner state against 10 on `/emne/TDT4120/`. Planner-specific and unchanged from last time: `cramped-padding` on `div.planner-view-tabs`, `line-length` on `.np-hint` at ~90ch.

**Visual overlays**: none — headless, no human-viewable tab. External injection was blocked by the worker's CSP exactly as before (`script-src 'self' 'unsafe-inline'`); the inline fallback ran the detector in-page and its return value was read programmatically. That is the whole of the evidence.

**False positives, three of them proven false rather than argued away**: `marquee` and `gradient-text` fire on `body` in every state including the control, and `grep` finds no `<marquee>` and no `background-clip` anywhere in `src/` or `dist/` — detector bugs. `overused-font` ("roboto, 100%") is the system stack resolving on a Linux container. `gpt-thin-border-wide-shadow` scored both dialogs while closed (0×0).

## Overall Impression

**24 → 26.** The three P0s are gone and independently confirmed: the phone week now lands on the collision (`scrollLeft 1186` of a 1529px week, both blocks fully inside the visible box), no target is under the 24px floor, and all four dialogs place initial focus inside themselves. Nothing regressed into a P0.

But +2 is a fair score, and the reason is worth stating plainly: **two of my fixes were incomplete, one was inert, and two introduced small regressions.** The structural issues that outlive them — a week dated to a week nothing happens in, a 17-checkbox picker, a collision that is a full stop — are the ones now holding the score down, and they are the ones that need product decisions rather than patches.

## What's Working

1. **The week's own surface**, unchanged and still the best thing here — and now with legible rooms on every printed block (B measured 4.56–7.04 light, 7.39–9.01 dark, all six hues passing on both the code and the room).
2. **The three-state verdict.** `renderVerdict` refuses green when `checkedLectureCount === 0`, and the "we don't know" chip deliberately carries no sign. Building an honest third state for your own headline answer is rare, and it is the moat PRODUCT §1 claims.
3. **The a11y floor is genuinely solid now**: 24 tab stops, every one with a visible 2px ink ring; no unlabeled controls; no click-only elements; no heading skips; four `aria-live` regions; no horizontal overflow at 390/360/320; clean 200% reflow; and **zero console errors or warnings** in any state.

## Priority Issues

### [P1] The muted øving layer's room text fails AA on all six hues — the half of my own fix I missed
`.planner-cols-block.is-muted .planner-cols-room` (`planner-week.css:1212–1215`) is `--muted` on the hue tint: purple **3.76**, indigo 3.86, orange 3.90, green 3.92, cyan 3.94, blue 3.96 — at 11.52px, so AA's 4.5 applies. It sits **four lines below** the printed-block rule that was fixed, and the same block's *code* passes at 6.04–8.05. Separately, `.planner-cols-band .planner-cols-sub` (`:1319–1322`) carries `opacity: 0.78` and fails on 4 of 6 hues (blue 3.90, cyan 3.92, orange 4.04, green 4.05) — an alpha on block text, which is precisely what the new DESIGN §9 entry forbids, already in the tree and not found. Dark passes in both cases.
**Fix**: take both onto the tinted block's own ink ramp (the `--block-ink-mix` pair `tokens.test.ts:154` already gates), delete the 0.78, and extend the token test to the two pairs it never covered — `--muted` against the hue *tint*, and the band's alpha.

### [P1] The block popover's tab-off fix is inert
The `focusout` handler added to close a non-modal popover you have tabbed out of never fires: Chromium reports **`relatedTarget: null`** when focus moves to `BODY`, and the guard `if (next === null || dialog.contains(next)) return` — written for "focus leaving the document entirely (a tab switch, devtools)" — swallows exactly the case the fix exists for. B walked it live: last control → `BODY` (popover open) → `a.skip-link` (open) → `a.site-brand` (open), with the popover still painted over the week.
**Fix**: distinguish the two cases by what the document has, not by `relatedTarget` alone — close on the next frame if `document.activeElement` is outside the dialog and `document.hasFocus()`, so a real tab-switch is left alone.

### [P1] The green verdict still covers a course nothing was checked in, and the phone shows the caveat instead of the answer
On `#26h;MTDT.2026;` the chip reads `Ingen forelesninger kolliderer` while the margin 570px below reads `1 merknad · kollisjonssjekken er ufullstendig — Ingen aktiviteter er merket som forelesning i HMS0002`. The fix only withholds green when **zero** lectures were checked; four-of-five still prints an unqualified pass. Compounding it: at ≤46rem `.planner-verdict:has(.is-clean) { display: none }` hides the pass — so **a phone shows the caveat and never the answer it qualifies.**
**Fix**: qualify rather than suppress — `Ingen forelesninger kolliderer · 1 emne ikke sjekket` — and change the phone rule to hide only an *unqualified* clean verdict.

### [P1] The week is dated to a calendar week in which nothing on it happens
`weekdayDates(new Date())` is called unconditionally and never checked against `semester.teachingWeeks`. On 2026-08-01 the header reads `MAN 27 … FRE 31` and the context line `Uke 31`, while the first block's popover reads `uke 34–47`. Every block on screen is false under its date, and this is the **default state for the entire planning window** — the window this product positions itself in.
**Fix**: when today's ISO week is outside `teachingWeeks`, either drop the day-of-month numerals and call it `mønsteruke`, or date the columns to the first teaching week and label it (`Uke 34 · første undervisningsuke`).

### [P2] Two regressions from the fix pass
- **The share button reflows the toolbar.** `Del` → `Kopiert` changes the button's width and nudges the Uke/Liste switch ~22px left; the confirmation is one word that never says a *link* was copied.
- **The keyboard add path loses its confirmation.** Type → Enter clears the query and re-renders, and `render()` overwrites the status with `Skriv for å søke i 4767 emner.` — indistinguishable from a cancelled search, though the plan did update.
**Fix**: reserve the button's width for its longest label (or put the confirmation in the existing `aria-live` status instead of the label); and set the status *after* the re-render.

## Persona Red Flags

**Jordan (first-timer ≈ persona B)** — four buttons, two destinations, four labels: the bar carries `Velg studieprogram` and `Legg til emne` while the card carries `Velg studieprogram` (blue) and `Jeg har emnekodene`; Jordan cannot know that two of those are the same door. The empty frame still centres one sentence in ~470px of reserved white, reading as a failed load. Three of the bar's five controls are inert with no plan. On a phone the merknad is collapsed and the green verdict suppressed — **a caveat with no answer**. The group picker offers `Forelesning 1 MTGEORT, MTINGGEO, …` as a peer of Jordan's own row with nothing saying they are MTDT. And the week says 27–31 July when the first lecture is in week 34.

**Casey (one-handed mobile ≈ persona C)** — the P0 is fixed and confirmed: the collision plan opens with both sessions in view. On the full MTDT plan two of seven sessions still sit off-screen with only a soft edge fade as cue, and no clipped-days hint. Every target is under the 44px PRODUCT §6 commits to (tabs 48×32 and 52×32, four px apart; `#planner-edit-plan` 36×36 icon-only) though **nothing is under the 24px floor**. The bar wrap splits siblings: `Del` lands on the switch's row while `Endre` and `Legg til emne` wrap below. The exam band is three rows of 31 cells at 13px on a 358px row — unreadable and untappable.

**Alex (power user ≈ persona A)** — fast and keyboard-clean: deep link to painted week in under a second, no traps, visible rings. But the keyboard add loses its confirmation; the add dialog ranks `FO001321 / TFOR0111 / TFOR0116 / TRES0412` above `TMA4110` for "matematikk" and shows same-named courses with no credits, campus or level to choose between; `Del` reflows the toolbar; a received link still replaces a curated plan by default; and after the diagnosis there is still **no instrument** — no swap, no route to alternatives, no Studentweb handoff.

## Minor Observations

- **`index.astro:1225` puts `box-shadow: inset 0 0 0 1px var(--border-strong)` back on the dropped-course chip** — DESIGN §5 says "No inset shadows, anywhere" and names *this exact element* among the three removed on 2026-07-30. Pre-existing, and it measures 1.45:1.
- The loading skeleton draws the **retired Rader geometry** (days as rows, hours as columns, lowercase day names) and flips 90° into the column week, changing geometry, day-label form and hour-label form at once. Every cold load advertises a view this product deleted.
- `--verdict` `#177334` and `--hue-green` `#0b8043` are both on screen at once in a default MTDT week; `--clash` `#c62828` sits beside `--hue-orange` `#d93c0b`, and the orange block is the largest, most saturated shape in that week. The hues clear the signal colours by *value* and not by perception.
- Three blues on one page: `--accent` `#1a73e8`, `--hue-blue` `#027cb8`, `--hue-indigo` `#3f51b5`.
- Course rows render in insertion order, so two people opening the same shared link see the same colours (fixed) in a different order (not).
- The all-day drop-in row prints `MH2000 08:15–16:00` — a time on the row whose entire rationale is that a window has no honest place on the time axis.
- The provenance line on a total failure reads `Fikk ikke hentet timeplan for HMS0002, timeplan for TDT4109, …` — "timeplan for" five times.
- Liste is strictly more informative than Uke (it carries the activity name), yet Uke is the default and the only one most students will see.
- Weekend columns are omitted, so on a Saturday the today marker has nowhere to land.
- `.planner-cols-clash`'s fill is 1.30:1 but carries a 2px `--clash` border at 5.62:1 — the border is the mark, not a failure. The now-needle likewise clears via its page-coloured halo (4.56–7.04 light), not on its own.
- `#planner-direction-title` is now correctly hidden when empty, so it is out of the accessibility tree.

## Questions to Consider

1. If the week the page opens on is a **pattern**, why is it dated — and if it must be dated, why to a week the semester has not reached?
2. The job is *"kan jeg ta disse emnene sammen — og hvis ikke, hva bytter jeg?"* The first clause answers in 200ms. Where is the second? A collision is still a full stop.
3. The app knows the student is MTDT, and shows `Forelesning 1 MTDT, MTIØT, MTKOM` as row 2 of 17, unmarked and unsorted. What is the argument for not marking it?
4. If green may not be printed when *nothing* was checked, why may it be printed when four of five were — and why is that the one chip a phone deletes?
5. Uke names a session by code, Liste by name, and the content's left edge moves 224px between them. Which one is right?
6. Shared-link creations are the north-star metric. `Del` is a 52px paper button wedged between the view switch and `Endre`, and its confirmation never mentions a link. Is that the weight of the metric?
7. The task ends at `30 av 30 sp`, and the student then opens Studentweb and retypes five codes from memory. What is the last thing this page should say?
8. The loading skeleton is the geometry of a deleted view. What else in that frame is still holding the shape of something nothing draws any more?
