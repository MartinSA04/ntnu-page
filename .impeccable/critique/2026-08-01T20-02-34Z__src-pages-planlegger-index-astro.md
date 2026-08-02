---
target: /planlegger/ (the planner)
total_score: 24
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 2
timestamp: 2026-08-01T20-02-34Z
slug: src-pages-planlegger-index-astro
---
Method: dual-agent (A: design review, isolated · B: detector + browser evidence, isolated). Target: `/planlegger/` — the planner. Both assessments drove the real build on `wrangler dev` with recorded `/api/*` fixtures; neither saw the other's output.

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `#planner-provenance` is `display:none` with empty text on every *successful* load — DR-8's provenance MUST fires only on failure. The green pass verdict is CSS-hidden on phone (`index.astro:464`). |
| 2 | Match System / Real World | 3 | Bokmål, lesedager, kull, oppmelding all correct. But `1 kollisjon denne uka` prints over uke 31, a week in which the clash (`uke 34–35, 45–46`) does not occur. |
| 3 | User Control and Freedom | 3 | All four dialogs close on one Escape and return focus to the opener (both assessments verified independently). `Dropp`/`Legg tilbake` is correctly reversible. No undo after a drop, and the drop silently repaints the palette. |
| 4 | Consistency and Standards | 2 | `45 av 30 sp` wears `--clash` red (`index.astro:317–319`) — the exact case `--warn` was created for. Uke and Liste show different facts for the same session. Course hues reassign on every add or drop. |
| 5 | Error Prevention | 2 | `#26h;BSPL.2024;` prints a green "Ingen forelesninger kolliderer" over 15 visibly overlapping blocks, and the same green over a plan with zero drawable courses. The correct string (`kan ikke sjekkes`) already exists and isn't reached for. |
| 6 | Recognition Rather Than Recall | 2 | The add dialog's rows are code + name only: TDT4109/4110/4111 are three consecutive rows all reading "Informasjonsteknologi, grunnkurs". The group picker asks you to find your own programme code inside `Forelesning 2 MTIØT, MTKOM, MTDT`. |
| 7 | Flexibility and Efficiency | 2 | 22 tab stops, every one with a visible focus ring; hash-as-state is genuinely powerful. But no bulk code paste, the query doesn't clear after adding, Enter on a single exact match does nothing, and there is no share affordance at all. |
| 8 | Aesthetic and Minimalist Design | 3 | The Uke grid is excellent. Against it: ~120px of dead vertical space (notes bottom 799 → `.planner-below` top 918) puts both lower panes below a 900px fold, plus ~90 unlabelled 16×13px exam-band cells. |
| 9 | Error Recovery | 3 | The best thing on the surface — a failed fetch produces three coordinated honest statements. Zero console errors across every state. Against it: `0 treff.` is the entire no-results state. |
| 10 | Help and Documentation | 2 | `streken er 30 sp` and the øving caption are model in-context help. But the studieinfo modal — now the *only* programme picker — lost the `kull = året du startet` caption the deleted homepage picker shipped. |
| **Total** | | **24/40** | **Acceptable — significant improvements needed** |

## Design Specificity Verdict

**Split, and the split is diagnostic: authored in the copy and the exam list, category-interchangeable in the chrome and every empty state.** This is mostly *disciplined restraint* rather than absent authorship — "play the calendar straight" is a defensible, well-executed position, and the Uke grid earns it. But the absence is real, and it sits exactly where a Norwegian university semester planner should be least generic.

**Authored** — things no other product could ship unchanged: the exam list's **lesedager gap lines**, drawn as hairlines running from their own words to the edge between typographic dates; the **uncertainty vocabulary** (`kan ikke sjekkes, mangler timeplan for 1 emne`, and a verdict that says **"Ingen forelesninger kolliderer"** rather than "no conflicts" — a smaller, more defensible claim that states what DR-1 actually checked); the reversibility verb pair `Dropp` → `Droppet, ikke med i uka eller i sp` → `Legg tilbake`; `streken er 30 sp`; `Eksamensrom tildeles noen dager før.`

**Interchangeable**: `.planner-head` is a generic SaaS toolbar — checkbox + segmented control + icon button + accent primary, right-aligned; relabel it and it's Linear or Notion, and it is the loudest structure on the page. The exam band is a GitHub contribution graph carrying no readable information. The empty state is any product's default "no data yet": a centred sentence, a grey button, 700px of white.

**Deterministic scan**: the CLI detector returns **exit 0, zero findings** on `src/pages/planlegger/index.astro`, on `src/pages src/components src/layouts`, and on the nine planner island modules individually. That is a verified clean, not a skip — a planted control file (`color:#eee` on `#fff`, 9px text, `font-family:Inter`) returned exit 2 with `[overused-font]`. The static engine resolves inline and `<style>` CSS only, so the planner's ink in external `src/styles/*.css` is out of its reach, which is why the in-page pass finds what the CLI cannot.

**In-page detector**, injected across six states: 4–5 findings per planner state versus 10 on `/emne/TDT4120/` (the non-planner control). Planner-specific and real: `cramped-padding` on `div.planner-view-tabs`, and `edge-flush-cards` on `#planner-grid-frame` at 390px only — `div.planner-cols-day-header` sits flush at 0px against the scroller's right edge, which independently corroborates the mobile finding below. Site-wide, not planner: `line-length` on `.np-hint` at ~90ch.

**Visual overlays**: no user-visible overlay exists. External script injection is **blocked by the worker's real CSP** on every state (`script-src 'self' 'unsafe-inline'`, `script-src-elem` not set); the inline `content:` fallback succeeded and the detector genuinely ran in the page (7–19 overlay nodes created, `window.impeccableDetect` present), but this environment is headless with no human-viewable tab. Findings above are the detector's own return value read out of the page, not a screenshot of highlights.

**Detector false positives, confirmed against `CLAUDE.md` and `DESIGN.md`**: `overused-font` ("roboto, 100% of text") is headless Linux Chromium falling through the platform UI stack — there is no webfont, deliberately. `text-occlusion` is the detector's own overlay badges colliding with page text. `gpt-thin-border-wide-shadow` on the two dialogs was scored while they were closed (`rect: 0×0`). The 34 controls "under 44×44" are the system's deliberate 36px `--control-h`. `data-reserve` on `#planner-grid-frame` in the empty state is the documented lease with `--plan-courses: 0`, reserving exactly nothing.

## Overall Impression

The week itself is the best thing here and I would not touch it: solid hue blocks with mass, one hour hairline, 52px/hour, the room as the only fact position can't state. That is Google Calendar executed properly, and the honesty layer wrapped around it — a verdict that names what it checked, a provenance line that names the course it couldn't fetch — is a genuine competitive asset rendered as type rather than documented as intent.

What undermines it is that **the verdict is not yet trustworthy in every state it can reach, and on a phone the week can render blank.** Both are failures of the one thing the product exists to do. Underneath those, the surface's own character never reaches its chrome, its onboarding, or the moment a student learns their term collides.

**The single biggest opportunity is the end of the journey.** Peak-end says half the memory of this product is currently "…and then the page stopped." Shared-link creations are the declared north-star metric, the URL genuinely *is* the plan — and there is no share button on `/planlegger/`, no line telling anyone the URL carries state, and `#planner-link-note` exists but is always empty, so arriving on a shared link is completely silent. Separately, the stated primary job has two halves — *"Kan jeg ta disse emnene sammen — og hvis ikke, hva bytter jeg?"* — and only the first is built, even though the app already knows TDT4110 has three lecture parallels and could say which one avoids the collision it just reported.

## What's Working

1. **The uncertainty vocabulary, and the fact that it is rendered rather than documented.** Kill one timetable fetch and three statements coordinate: the verdict downgrades to `kan ikke sjekkes, mangler timeplan for 1 emne`, `#planner-provenance` names TDT4120, and the merknad panel names it again with the consequence. It works because the copy states *what was checked* instead of a boolean — which is the entire positioning ("we own the row, and the row admits where it's thin") turned into type.
2. **The exam list's lesedager gap lines.** The number a student actually wants isn't in the data — it's derived — and it's drawn as the *space between* two exams rather than as a column. Form matches the fact. This is the one element on the site nothing else on the internet draws.
3. **Dialog discipline, verified twice independently.** All four floating surfaces close on a single Escape and return focus to their invoker. The block popover has no scrim (it's a popover, `dialog.show()`); course settings, add-course and studieinfo do (they're modals). That distinction is load-bearing and correctly drawn. Supporting it: 22 tab stops with zero missing focus indicators, no unlabeled controls anywhere, no heading-level jumps, no horizontal overflow at 390/360/320, clean reflow at 200% zoom, and zero console errors or warnings across every state and interaction.

## Priority Issues

### [P0] The week on a phone is a blind horizontal scroll, and for a common plan it renders empty

**What**: at 390px, `#planner-grid-frame` measures `scrollWidth 1529`, `clientWidth 343`, `scrollLeft 0` — 4.4 screens wide, parked on Monday. With `#26h;-;+TDT4109,+TDT4120` (both sessions on Friday) the student opens their plan and sees an empty grid. The mechanism is precise, and neither assessment alone had it: `scrollToToday()` (`plannerApp.ts:1640`) is the only auto-scroll, and it has two holes — it returns early when `dayNumber > 5`, so it does nothing on a weekend, and it scrolls to *today's weekday column whether or not that day holds any sessions*. Throughout the entire pre-semester planning window, which is when this tool is used, today is not in the drawn week at all. An edge fade and `data-scroll` state do ship (`syncGridScroll`, `setScrollFade`) — so it is not cueless — but a fade says "there is more", not "Friday is where your day is". PRODUCT.md:271 records a shipped mitigation of "edge fade + scroll-to-today + **a hint naming the clipped days**"; the third is absent from the DOM, verified against `#planner-main`'s full innerText. The detector independently flags `edge-flush-cards` on this frame at 390 only.

**Why it matters**: persona C (Logistikeren) is the mobile lens on both primary personas, and this makes the primary surface silently blank at the moment of the primary job.

**Fix**: scroll to the first day that *has* sessions, falling back to today, falling back to Monday. Add a persistent five-pip day strip above the grid marking which days carry sessions and scrolling to them. Restore the clipped-days hint.

**Suggested command**: `/impeccable adapt`

### [P0] The green verdict lies in two reachable states

**What**: (a) `#26h;BSPL.2024;` prints `Ingen forelesninger kolliderer` with a green check over 15 visibly overlapping MH2000 blocks — DR-1-true, human-false — while the note that qualifies it sits ~800px below, collapsed behind a `<summary>`. (b) The same green appears over a plan with zero drawable courses, while `.planner-direction` is still asking which studieby you're in.

**Why it matters**: the verdict is the entire product. One false green destroys the trust the provenance work built, and it destroys it for exactly the user with no basis to catch it (persona B).

**Fix**: when lecture-less courses cover every course in the plan, or the plan draws no courses at all, emit the `kan ikke sjekkes` string the app already owns. Never emit `.is-clean` for an unchecked plan.

**Suggested command**: `/impeccable harden`

### [P0] «Øvinger og labber» is a promise the toggle does not keep

**What**: toggling it on with the MTDT plan adds 2 blocks (HMS0002) and four notes — `TDT4109 har 3 grupper`, `TMA4400 har 5`, `TMA4412 har 3`, `EXPH0300 har 14 grupper, velg din`. Any course with more than one group draws nothing until you open its settings modal and tick a box. Four modal visits is the price of the feature. This is §0 mandate item 4 ("lecture-based by default with one simple toggle"); the toggle exists, the promise doesn't land.

**Why it matters**: the student pressed the one control the mandate promises, and almost nothing happened. The failure is silent — it reads as "I have no øvinger", not "you have four choices to make".

**Fix**: when the layer is on, draw *all* of a course's groups muted-and-hatched with a "5 grupper — velg din" control on the blocks themselves, or pre-select the programme-matched group exactly as lectures already are. At minimum, put the count on the toggle: `Øvinger og labber — 4 emner trenger valg`.

**Suggested command**: `/impeccable shape`

### [P1] Three measured failures sit in the gaps your own token test doesn't assert

**What**: all three are outside `tests/site/tokens.test.ts`'s coverage, which is why they drifted.
- **Block secondary text fails AA on all six hues in light theme.** `.planner-cols-room` / `.planner-cols-sub` is `color-mix(in srgb, var(--on-block) 72%, transparent)` (`planner-week.css:1191–1199`) at 11.52px/400 — the **room number**, the one fact position can't state. Measured: orange 3.01, blue 3.12, cyan 3.16, green 3.38, purple 4.36, indigo 4.43. Dark theme: cyan 4.39, green 4.48, purple 4.43. The knocked-out course *code* passes everywhere (4.56–9.01) — and it is the half `tokens.test.ts:154,162` asserts.
- **`--faint` fails AA as body text**: `.planner-course-sp` (the credit figure — a `.np-data` figure a student copies) at **2.87:1** light, 3.99 dark; `.exam-band-name` the same; a dropped course's title at 2.87:1. `tokens.test.ts:143` covers only `--fg` and `--muted`.
- **`button.planner-chip.is-jump` — the clash verdict, the page's primary jump control — measures 153×20.8 with 0px vertical padding**, identical at 1440 and 390, and is the only element in the surface below WCAG 2.5.8's 24px floor. Its own source comment at `index.astro:330–331` reads *"The target is the whole sentence, which clears 24px on its own at this size."* It does not.

Related and separate: the muted øving block fill measures **1.29:1** against paper with no border and no shadow — the *shape* of a calendar block is non-text content and owes 3:1 under WCAG 1.4.11, even though its label passes.

**Why it matters**: the room number is what persona B came for, the credit figure is what persona A is counting, and the clash chip is the one control on the page you most want pressed.

**Fix**: raise the 72% mix (or drop the mix and use a solid `--on-block` at reduced weight), take `.planner-course-sp` off `--faint`, give the jump chip vertical padding to 24px, and extend `tokens.test.ts` to assert the block-secondary pair on all six hues and `--faint` wherever it carries text — the gate is what keeps this from recurring.

**Suggested command**: `/impeccable audit`

### [P1] Course hues are assigned by position, so every edit repaints the plan

**What**: `hueForIndex(i)` cycles `PLAN_HUES` over *active* courses. Drop TMA4400 and TMA4412 goes indigo→purple, EXPH0300 orange→indigo. Adding does the same.

**Why it matters**: colour identity is the calendar's memory. Persona A compares electives by add → read → drop → add, and the palette resets on all four steps. Two people opening the same shared link can see different colours, which quietly breaks the shareable plan as a shared object.

**Fix**: derive the hue from the course code (stable hash into six buckets, one-pass collision nudge at assign time) and carry it in the plan state.

**Suggested command**: `/impeccable harden`

## Persona Red Flags

**Jordan (Confused First-Timer — PRODUCT persona B, five codes and one question)**
- Cold `/planlegger/`: 700px of white, `Ingen plan ennå.`, a grey `Velg studieprogram`, and `Eller legg til emner med emnekode` in `--muted` with no underline — it doesn't read as pressable. Nothing on screen says what the tool answers.
- **Two competing primaries, and the loud one is wrong.** The accent-blue `#planner-add-course-btn` is the loudest element on every screen including the empty state, where it is the *secondary* path; the mandate's #1 path (`#planner-edit-plan`) is a grey button on desktop and an **`sr-only`-labelled 36×36 glyph on phone**.
- The studieinfo modal shows five bare year chips (`2026 2025 2024 2023 2022`) — the `kull = året du startet` caption shipped on the homepage picker that was deleted, and did not move with the function.
- Code route: one code at a time, the field **does not clear after adding**, and **Enter on a single exact match does nothing**. Five codes = five select-all/retype/click cycles.
- The week Jordan then reads is dated `MAN 27` (uke 31) while every block in it runs `uke 34–47`. Nothing says teaching starts in three weeks. Jordan's literal question — "where do I walk in at 10:15" — is answered under a wrong date.
- On phone the green pass verdict is deliberately suppressed. The persona most in need of "det holder" never sees it.

**Casey (Distracted Mobile User — PRODUCT persona C, one-handed)**
- The empty-grid failure above: a two-course Friday plan renders as a blank week.
- The smallest and most-pressed controls are the view tabs at 48×32 and 52×32; `#planner-edit-plan` is 36×36 and unlabelled; the clash chip is 20.8px tall. PRODUCT.md:271 lists "mobile day-agenda + 44px touch targets" as explicitly **not yet built**, so this is a known open item rather than a regression — but the 20.8px chip is below even the 24px floor the codebase claims in its own comment.
- The exam list's weekday abbreviations (`to`, `ti`, `ma`, `lø`) are pinned right and clip at 390px.
- Working correctly, and the best mobile moment on the surface: the block popover becomes a proper bottom sheet with `Tid / Sted / Merk` and a `Velg parallell` action.

**Alex (Impatient Power User — PRODUCT persona A, comparing electives twice a year)**
- **"Hva bytter jeg?" has no answer anywhere.** The collision note names the pair, the time and the weeks, and stops — while the app already knows `TDT4110 har 3 alternative forelesninger` and never connects that to the collision it just reported.
- The palette repaints on every step of a comparison (above), so the visual memory resets each time.
- The add dialog gives nothing to decide on: `algoritmer` returns TDT4120 **third**, behind IDATA2302 and IDATT2101 carrying the identical name and no campus label; `fysikk` returns 95 hits, 12 shown, seven literally named "Fysikk". No sp, no campus, no assessment form, no exam date.
- No share button, no commit summary, no `bekreft i Studentweb`, and `#planner-link-note` is always empty — arriving on a shared link is silent, with no merge/replace/keep.

**Sam (Accessibility-Dependent User)** — the strongest persona result, with two specific breaks:
- Passing: 22 tab stops with zero missing focus indicators, no unlabeled controls (every icon button carries a real name, e.g. "Endre studieinfo for MTDT"), clean landmarks, no heading jumps, four `aria-live` regions with the verdict correctly `polite`, no overflow at 320px, clean 200% reflow.
- Breaking: **`#studieinfo-dialog` opens with focus on `<body>`** — the only one of four that doesn't place initial focus inside itself, and it's the programme picker the mandate calls path #1. **`#planner-block-popover` is non-modal by design, so tabbing past its last control leaves the popover entirely and lands on `a.skip-link` at the top of the document.** And the contrast failures above are his failures first: the room number inside a block is the fact he can least afford to lose.

## Minor Observations

- `#planner-provenance` is `display:none` with empty text on every *successful* load. DR-8 says every composed verdict carries a freshness line; today only failures get one. The footer's `Data hentet 28. jul 2026` is the crawl date, not the timetable fetch.
- `.exam-band-day` cells are 16×13px with no `title` and no `aria-label`, ~90 per plan — decoration priced as data. Label it or delete it. `om 117 dager` beneath it borrows the lesedager gap-line idiom for something that is not a gap.
- Uke shows `MAN 27`, Liste shows only `mandag`; Liste shows the activity name (`Plenumsregning`), Uke hides it. Two views, two information sets, one dataset. The loading skeleton's rail prints `08 09 10` / `mandag`, the settled rail prints `08:00` / `MAN 27` — both swap on arrival.
- `#planner-others-toggle` is a `<button aria-pressed>` drawn as a checkbox; the Uke/Liste switch is a `role="group"` of two `aria-pressed` buttons, so arrow keys do nothing.
- `0 treff.` plus a `Lukk` button is the entire no-results state — no suggestion, no route to `/emner/`.
- `#planner-direction-title` renders as an empty, invisible `<h2>` when unfilled.
- Detector, real: `cramped-padding` on `div.planner-view-tabs` (children flush top and bottom against the 2px track lip); `line-length` on `.np-hint` at ~90ch, site-wide.
- Dark theme: `--hue-orange #ff8a65` and `--clash #ff6369` are the same coral. Light: `--hue-orange #d93c0b` reads as red beside the collision ring, `--hue-green #0b8043` reads as the verdict green. The tokens pass contrast; the *semantics* don't survive being 250px wide.
- Dropping a course changes the drawn hour range (08–16 → 08–13), so the page below jumps up ~170px the instant the modal closes.
- Upstream's typo `Øvingsforelesing` renders verbatim in the group picker.
- The now/today marker could not be measured in any state: the fixture date puts the planner in uke 31, outside term, so `.planner-grid-now` never renders and the accent's second job is unspent on the default view.

## Questions to Consider

1. The week is a **pattern**, not a week — every block stands for "some subset of uke 34–47" — yet it's dated `MAN 27`. What if the header read *"typisk uke · undervisning fra uke 34"*, and date numerals only appeared once the semester actually contains today?
2. A partial collision (`uke 34–35, 45–46` = 4 of 14 weeks) is the common case. Is one binary red ring the right mark, or should the mark carry a *weight*?
3. The primary job has two halves and only one is built. What is the smallest thing that answers "hva bytter jeg?" — is it one sentence under the collision note naming the parallel that avoids it, from data already fetched?
4. The north-star metric is shared-link creations, and `/planlegger/` has no share button. Is hash-as-state a growth object, or an implementation detail, until something on the page says "del denne"?
5. If a course's colour is the calendar's memory, should the hue be part of the plan's *identity* — derived from the code, carried in the hash — so sender and recipient see the same week?
6. Google Calendar draws a full day even when it's empty; this week crops to its content, so two plans are drawn at two vertical scales. Is the crop worth losing "08 to 16 is the day, and mine has three holes in it" — which is exactly persona C's question?
7. The empty state owns onboarding by decree (§4) and says nothing. What if it drew a real, greyed, labelled example week — what the killed homepage proof fragment was reaching for, but built from real MTDT data instead of two invented courses?
8. If «Øvinger og labber» can only ever reveal one course's labs, is it a layer toggle at all — or five per-course questions the bar is pretending is one switch?
