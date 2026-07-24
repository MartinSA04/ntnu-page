# F1 — Første gang, og program → forhåndsutfylt plan

UX blueprint for two entry flows into Semesterplan: **F1a cold first visit**
(no context, no plan) and **F1b program/kull entry** (name/code known,
resolves to a prefilled plan). Base: `PRODUCT-v2.md`. Where this document
gives on-screen copy it is illustrative Norwegian bokmål per DESIGN.md §7,
not final strings.

Scope boundary: this is the on-ramp. The elective decide-loop (choice-group
rows, swap-delta sentence) is F2's blueprint; this document stops at "plan
exists, courses are in it, credits are ticking up."

---

## 0. Shared building blocks referenced throughout

**`termContext()`** (DR-9) resolves, from `semesters.json`
(`phase`/`fromDate`/`toDate`/`examLastDate`/`timetablePublished`), three
things every screen below depends on:
- **`plannableSemesterId`** — the semester a fresh visitor should default
  into. Not always "current": if today is inside an exam window or past a
  registration deadline for the current semester, the next semester is the
  plannable one. Concretely: Sep 15 (fall reg. deadline) → Feb 1 (spring reg.
  deadline) → next fall's opening is the seam; the banner and the semester
  toggle both read this, never "today's calendar semester."
- **`marginText`** — the temporal margin banner string, e.g. *"Oppmelding for
  Høst 2026 stenger ~15. sep · 24 dager igjen."*
- **`timetablePublished: boolean`** for `plannableSemesterId` — gates DR-2
  pre-publish mode everywhere below.

**Provenance line (DR-8)** — appears wherever a composed verdict is shown
(grid, exam ribbon, credit total): one mono `.np-note` line, never removed,
never collapsed behind a disclosure: *"Timeplan sist hentet 22. jul ·
eksamensdato ikke publisert."* First-time visitors see this on their very
first render, not after some "advanced" threshold — it is load-bearing for
trust on a page a stranger just landed on.

**Pre-fill labeling rule (DR-7, D4)** — any courses placed into the plan by
something *other* than the user's own click (kull suggestion) render with a
visible `.np-toggle`-style "foreslått" mark until the user has explicitly
kept, edited, or removed them once. This mark is not decorative — it is the
honesty seam between "the site is guessing" and "the user chose this,"
carried through to §6's merge/replace/keep semantics for shared plans (same
underlying pattern, different vocabulary).

---

## F1a — Cold first visit (no context)

### Actors
Any of persona A/B/C on a phone or laptop, zero prior localStorage, arriving
either from a search engine (landing on `/emne/[code]`, see F4-adjacent —
out of scope here) or directly on `/`. This blueprint covers the direct-to-`/`
case, which is the one the homepage rewrite (§5 of PRODUCT-v2) targets.

### Screen 1 — `/` (homepage)

**On screen:**
- H1, verb-first: **"Kan du ta disse emnene sammen?"**
- Sub-copy: *"Sjekk kollisjoner og eksamensklynger — og se hva du bytter —
  før oppmeldingen."*
- **Above-the-fold proof fragment**: a small `.np-frame.np-ruled` snippet,
  not interactive, showing two real-looking course blocks on a Monday with
  the red-ink collision treatment already applied (wavy underline on the
  code, hatch overlay, a `.np-note-clash` line: *"TDT4100 kolliderer med
  TMA4100 · mandag 10:15–12:00"*). This is static/decorative (no fetch, no
  island) — its only job is to make the product's one differentiator
  legible in under two seconds, before any click.
- Below the proof fragment, the share affordance is *named*, not just
  implied: a small mono line under the fragment — *"Del planen med en lenke
  — ingen innlogging."* (Text only at this stage; the actual share button
  lives on `/planlegger/`. This is priming, per §5's "name the share as a
  visible action.")
- **Two doorways, not one CTA** (this supersedes PRODUCT-v2 §5's single-CTA
  language with the resolution the first-year persona forces — see decision
  log below): 
  - Primary `.np-btn`: **"Lag en plan"** → `/planlegger/`.
  - Secondary, visually subordinate but present without scrolling: **"Har du
    fått emnekodene? Lim dem inn"** → same destination, `/planlegger/`, but
    focuses the add-field and pre-opens paste-mode (see Screen 2 variant).
  - A third, quiet line only for program-entry (persona B, first-years
    specifically, and returning program students): **"Eller finn
    studieprogrammet ditt"** → inline-expands a program name search (not a
    page nav) — this is F1b's Screen 1, reachable from here without leaving
    `/`.
- If `localStorage["ntnu:plan:v1"]` (or v2 key) is non-empty: the mono resume
  line replaces neither CTA but sits between them: **"Planen din: 4 emner ·
  22,5 sp →"** linking straight to `/planlegger/`. This is the *returning*
  visitor's actual primary action in practice, even though it's visually
  third — a returning user's eye finds their own data.
- Footer: quiet mono, unchanged from current shell.

**Primary action:** click one of the two/three doorways.

**What changes after:**
- "Lag en plan" / "Lim dem inn" → `/planlegger/`, empty-plan state (Screen
  2) or paste-focused variant.
- "Finn studieprogrammet ditt" → inline expansion, still on `/`, revealing
  F1b's program-name search field (no navigation, no reload) so a first-year
  who clicked the wrong doorway first doesn't lose place.
- Resume line → `/planlegger/` with existing plan rendered (not this
  document's concern — that's steady-state planner, not onboarding).

**Empty-state teaching moment:** none needed here — the proof fragment *is*
the teaching moment, shown before any action, not gated behind interaction.

---

### Screen 2 — `/planlegger/`, empty plan, cold (Persona A/C default path)

**On screen** (this is the current empty state, kept, with one addition):
- Kicker "Planlegger," title "Semesterplanen din," credit line **"0 av 30
  sp"** in muted ink (not accent — accent is reserved for a fit verdict, and
  zero courses has no verdict yet).
- Semester toggle (`.np-toggle` row) pre-selected to `termContext().
  plannableSemesterId` — **never "today's semester" naively**. Concretely:
  a visitor arriving Aug 20 (mid fall semester, past the Sep 15 deadline
  logic doesn't apply yet since fall hasn't closed) defaults to the current
  fall semester with pre-publish mode likely already resolved
  (timetablePublished=true by then). A visitor arriving Oct 10 (fall
  underway, spring electives are the live decision) defaults to the
  **next** semester, spring, because that's the one still open to decide —
  DR-9's explicit rule, not a guess. The toggle itself still lets the user
  pick either of the two/three offered semesters manually.
- **Temporal margin banner**, directly under the toggle, mono `.np-note`:
  *"Oppmelding for Vår 2027 stenger ~1. feb · 41 dager igjen."* Present on
  first render, not just for returning users — a cold visitor benefits most
  from knowing a clock is running.
- Empty basket panel: add field ("+ legg til emne …"), placeholder invites
  typing a code or name.
- **Empty-state invitation** (`.np-note`), rewritten to make the program
  path co-equal rather than third-listed (this revises PLANNER.md §2's
  literal copy per the first-year critique in `perspectives/
  p1-forsteklassing.md`, which found the program path "visually
  subordinate... when for this persona it should be the primary path"):
  ```
  Ingen emner i planen ennå.
  [Legg til emne] — søk på kode eller navn
  eller
  [Finn studieprogrammet ditt] — får du et forslag basert på studieplanen
  ```
  Two real affordances at equal visual weight (both `.np-field`/`.np-btn`
  weight, not link-in-prose), not a sentence with two blue links buried in
  it. "Søk i emnekatalogen" as a tertiary text link remains for the
  power-searcher who lands here directly (e.g. via a bookmarked
  `/planlegger/` URL), demoted below the two primary affordances.
- Grid/exam/course-row sections do not render at all yet (not "rendered
  empty" — literally absent, per current empty-state pattern) until at
  least one course exists. This avoids a jarring empty `.np-frame.np-ruled`
  grid with nothing on it, which would look broken rather than inviting.

**Primary action:** either add a course (free path, not detailed further
here — F3's territory) or click "Finn studieprogrammet ditt" (F1b entry
point, Screen 3 below).

**What changes after:** clicking the program affordance reveals the
program-name search inline (same component as `/`'s inline expansion,
reused) — no navigation, the empty-plan panel is still visible above it so
the user never loses the option to just type a code instead.

---

## F1b — Program / kull entry → prefilled plan

This is the flow PRODUCT-v2 §3.1 calls "the program+kull picker is the
secondary path" and DR-7 constrains hard: **the pre-fill is a labeled,
editable suggestion, never an authoritative plan** (c1-4, c2-F5 — period
math is fragile, `publishedYears` can gap, `studyChoice.code` "O" is
unreliable). Every screen below carries that constraint visibly.

### Screen 1 — Lightweight program picker (inline, not `/studier/`)

**Where it lives:** inline-expanded from `/` or from `/planlegger/`'s empty
state (both call the same component — one build, two entry points). It is
**not** a navigation to `/studier/` (that page still exists per IA §4 as the
study-plan template/host of the elective decide-loop, reached later, not as
the on-ramp).

**On screen:**
- A single `.np-field`: **"Skriv studieprogrammet ditt (f.eks.
  Datateknologi)"** — matches on program *name*, not code. This directly
  answers the first-year critique: nobody arrives already knowing "MTDT."
  Autocompletes against `programs.json` (already fetched/available;
  build-time data, no new endpoint) filtering on name substring,
  diacritic-insensitive, same matching discipline as `/emner/`'s search.
- As the user types, a dropdown listbox (same `.np-field` + listbox pattern
  as the planner's add-field) shows matching program names with their level
  as a trailing mono tag: *"Datateknologi — 5-årig master"* / *"Datateknologi
  — årsstudium"* (disambiguates same-name programs at different levels,
  which exist in the 403-program catalog).
- No cohort/kull-year picker on *this* screen for the common case — see
  cohort resolution below. It only surfaces if resolution is ambiguous.

**Primary action:** select a program from the dropdown (click or
keyboard-enter).

**What changes after:** immediately resolves a cohort year and period
without a second screen for the common case (a true first-year arriving in
Aug/Sep of their first year) — jumps straight to Screen 3 (prefilled
planner). The critique's "four decisions before a room number" is
collapsed to one decision (pick program) precisely because cohort and
period are *inferable* for the dominant case:

**Cohort resolution logic** (DR-7-compliant, no confident wrong guess):
- If `termContext().plannableSemesterId` is a **fall** semester and the
  program has a published plan for **the current calendar year's intake**
  → assume cohort = current year, period = 1. This is the true first-year
  case and needs zero further input.
- Otherwise (spring semester, or a returning student who is not a
  first-year using this same picker for semester 3/5/7) → **Screen 2
  appears**: a cohort-year chip row, exactly the pattern already built in
  `studyPlan.ts` (`renderYearChips`, sorted descending, from
  `publishedYears`), captioned **"Hvilket kull startet du i?"** rather than
  assuming. This screen is skipped, not removed, for the unambiguous
  first-year case — it is the fallback, not the default.
- If `publishedYears` doesn't include the year implied by "current calendar
  year" (a genuine gap — DR-7's "unpublished cohorts return null" case) →
  fall back to nearest published year and show Screen 2's chips with a mono
  note: **"Fant ikke kullet ditt — velg nærmeste."** Never silently
  substitute without telling the user a substitution happened.

### Screen 2 — Cohort chips (conditional, not shown for the common first-year case)

**On screen:**
- Program name/code as a small kicker (confirms what was picked, with a
  "bytt program" text link back to Screen 1).
- Year chips (`.np-toggle` row), one per `publishedYears` entry, e.g. `2024`
  `2023` `2022`, most recent first. This reuses the exact chip component
  `/studier/[code]` already renders — no new visual language.
- One line of help copy under the chips: **"Kullet ditt er året du startet
  på programmet."** — the plainest possible gloss, since "kull" is jargon a
  first-year hasn't internalized yet (per perspectives/p1, "kull" needs
  implicit teaching, not an explainer page).

**Primary action:** click a year chip.

**What changes after:** → Screen 3, plan resolves for that cohort.

### Screen 3 — `/planlegger/`, prefilled from program+kull

This is the payoff screen. It reuses `/planlegger/`'s existing layout
(PLANNER.md §2) with additions specific to the pre-fill's provisional
status.

**On screen:**
- Everything from the normal planner layout, but the basket panel now
  contains the resolved period's obligatory courses as tags — **each tag
  carries a "foreslått" mark** (a small mono suffix or distinct `.np-toggle`
  state, not just the normal `.np-tag`) until touched. Concretely: tag reads
  `▪TDT4110 · foreslått ×` instead of plain `▪TDT4110 ×`. This is the DR-7
  labeling requirement made pixel-concrete — the draft's mistake was
  presenting kull pre-fill as fact; v2's fix must be *visible on the tag
  itself*, not just in a one-time toast that scrolls away.
- Program context note under the basket, existing pattern: *"Fra
  Datateknologi, kull 2024 · 1. semester"* — but for a first-year this reads
  as jargon on first contact, so it is paired with the plain gloss inline
  the first time: *"Fra Datateknologi, kull 2024 · 1. semester (ditt første
  semester)."* The parenthetical drops itself on subsequent visits (once
  `localStorage` shows the user has seen this program context before —
  simple, no new infra).
- A one-line banner above the grid, distinct from the per-tag marks, stating
  the aggregate honesty claim once: **"Dette er et forslag basert på
  studieplanen for kull 2024 — ikke en bekreftet plan. Sjekk mot
  Studentweb."** This is the single mandatory disclosure; per-tag marks are
  the persistent reminder, this banner is the one-time-loud version. It is
  dismissible (×) but dismissing it does **not** remove the per-tag
  "foreslått" marks — those persist until each course is individually
  touched (kept/edited/removed), because dismissing a banner is not the
  same speech-act as vouching for a specific course.
- Course names paired with codes throughout, not code-only — this generally
  matches PLANNER.md's existing block spec but is called out because
  first-years specifically distrust bare codes ("TDT4100" and
  "Objektorientert programmering" haven't yet fused into one concept for
  them). No new work: `catalog.json` already carries names, so every tag,
  row, and grid block already renders `name` — the ask is a discipline
  check, not new data plumbing.
- **Grid renders immediately** with rooms/times if `timetablePublished` for
  this semester; if not (common for a true first-year in Aug landing on a
  fall semester whose timetable *is* published, but also common for the
  Screen-2 branch resolving into a not-yet-published future semester) →
  DR-2 pre-publish mode: no blank grid, instead exam ribbon + credits +
  assessment carry the screen, with the note *"Timeplan publiseres ~12.
  aug — kom tilbake da for å sjekke kollisjoner"* — same return-trigger
  string as the shared-artifact case (§3 flow-agnostic rules), reused
  verbatim so the product has one voice for "come back later."
- Credit total ticks up live as period-1 courses populate: **"22,5 av 30
  sp"** — if the period's obligatory total is short of 30 (common — some
  first semesters aren't a clean 30), it just shows the true number, no
  fabricated padding.
- Low-key, persistent link near the program-context note: **"Er dette feil?
  Se hele studieplanen din →"** to `/studier/[code]` (the full plan, all
  periods, all groups) — this is the verification path the careful/
  suspicious student takes, per perspectives/p1's explicit ask. Not
  prominent, but always present, never buried behind a disclosure.

**Primary action:** none forced — the screen is now steady-state planner.
The expected next actions, in likely order for a first-year: skim the grid
for "where do I go," maybe remove/keep-confirm a course, maybe click
through to `/studier/[code]` to cross-check. For a returning program
student using this same on-ramp for a later semester, the expected action
is closer to F2 territory (review the period's *choice* groups, which start
appearing from semester 3+ onward for many programs).

**What changes after any single course is touched** (removed, or its
"foreslått" mark is explicitly acknowledged — e.g. a small inline "behold"
affirmation the first time a user interacts with a suggested tag at all,
even just clicking it):
- That course's tag drops the "foreslått" mark permanently for this plan
  (it is now the user's own choice, confirmed or replaced) — matches the
  merge/replace/keep vocabulary's underlying idea that provisional state
  resolves to owned state through an explicit user action, not through
  passive time or navigation.
- Once **every** course in the prefilled set has been touched at least
  once, the one-time aggregate banner auto-dismisses (in addition to being
  manually dismissible) — the site stops nagging once it has evidence the
  student looked at every line.

---

## First-year vs. 4th-year divergence

Both personas can enter through the *same* F1b screens above — the branch
point is **what happens once the plan is prefilled**, not a different UI
earlier. This is deliberate: building two separate on-ramps would be the
kind of apparatus PRODUCT-v2 explicitly cuts (c1-2 discipline extended to
onboarding, not just the elective loop).

| | **First-year (persona B)** | **4th/5th-year (persona A, using F1b for a later semester)** |
|---|---|---|
| **Screen 1 input** | Program name, typed uncertainly, first guess often wrong (autocomplete saves them). | Program name or — more often in practice — they skip F1b entirely and use the free add-field (F1's "Lag en plan" doorway), because by year 4 they know their course codes cold. F1b is still reachable if they want the full-plan cross-check. |
| **Cohort resolution** | Auto-resolves silently (current year + fall + period 1) — Screen 2 never appears. | Screen 2 (year chips) almost always appears, since "which kull" is genuinely ambiguous for anyone not brand-new — no auto-guess attempted past year 1. |
| **Period content** | Period 1: all-obligatory, zero choice groups. The prefilled set *is* the semester — nothing left to decide. Plan is "done" the moment it's prefilled. | Period 5, 7, etc: mixes obligatory + **choice groups** (valgbare emner). The prefill only ever inserts the obligatory rows (DR-5 — no cardinality data, so the app never auto-picks from a choice group). Choice-group courses are surfaced but **not pre-added** — they render as an inline "velg fra denne gruppen" affordance that hands off into F2's decide-loop, not this document's scope. |
| **"Foreslått" marks** | Every tag carries the mark; near-100% of the semester is suggested content, so the marks dominate the basket panel visually — appropriate, since near-100% of this student's semester genuinely is NTNU's pre-decision, not theirs. | Marks apply only to the smaller obligatory subset; the choice-group courses never got a mark because they were never auto-added — the visual balance naturally shifts toward "mostly the user's own choices," which is accurate to their actual agency level. |
| **Grid trust** | Grid is the entire payoff — "where do I walk in" is top task #1 (perspectives/p1). Pre-publish mode is especially costly here: a blank/degraded grid in week 1 is the worst possible moment for it, so DR-2's exam+credits+assessment fallback content must be genuinely legible, not a consolation screen. | Grid matters, but exam spacing and credit total matter comparably — a 4th-year already trusts their obligatory courses' logistics from past semesters; what's new to them each time is whichever elective they haven't taken before. |
| **"Se hele studieplanen" link** | High-value: this is the Studentweb cross-check per top-task #3 in perspectives/p1 — "am I signed up for the right things." | Lower-value on first prefill (they already know their own obligatory courses); regains value only when they reach a choice-group period and want to see the full group prose (DR-5's "verbatim quote," not this doc's territory). |
| **Return trigger relevance** | High — timetable-publish flip in week -2/-1 is exactly the moment this persona needs to come back and re-check rooms. | Lower for logistics, higher for the Sep-15/Feb-1 registration-deadline margin banner — a 4th-year's return is deadline-driven, a first-year's is publish-driven. Both banners exist simultaneously; which one "pulls" differs by persona, not by build. |

**One structural implication worth flagging explicitly:** because the choice
groups are never auto-added for the 4th-year case, **the credit total for a
prefilled later-semester plan will visibly and correctly read short of 30
sp** the moment it lands (e.g. "17,5 av 30 sp" if the period is 4 obligatory
courses + one unfilled 10 sp elective slot). This is not a bug state to
smooth over — it is the null-aware credit total (DR-6) doing its job,
and it is also the plan's honest invitation into F2 ("you're not done —
here's the gap the elective loop fills"). The gap should read as an
open door, not an error: no red, no warning icon, just the plain mono
number falling short of 30, exactly per DR-6's existing "22,5 av 30 sp
(+2 emner uten oppgitt sp)" pattern extended to "short because a slot is
genuinely unfilled."

---

## Semester-picker defaults by time of year (concrete table)

DR-9 requires this be an explicit rule, not an invisible default. Table for
`termContext().plannableSemesterId`, assuming standard fall (uke 33–~50,
reg. deadline Sep 15) / spring (uke 2–~24, reg. deadline Feb 1) NTNU
calendar:

| Visit date | `plannableSemesterId` resolves to | Why | Banner text (illustrative) |
|---|---|---|---|
| Jan 5 (before spring start, before deadline) | Vår (current) | Spring hasn't started, deadline hasn't passed — it's still the live decision. | "Oppmelding for Vår 2027 stenger 1. feb · 27 dager igjen." |
| Jan 20 (spring imminent, deadline close) | Vår (current) | Same reasoning, margin tightens — banner urgency (still ink, never red per DR-8/Red-Is-Collision — margin isn't a clash) increases only via the shrinking day count, not a color change. | "…stenger 1. feb · 12 dager igjen." |
| Feb 5 (just past spring deadline) | Høst (next) | Spring registration closed; spring's plan is now Studentweb's problem, not this tool's. The *next* plannable term is fall. | "Oppmelding for Høst 2026 stenger 15. sep · 222 dager igjen." (Long lead is fine — the banner's job is presence, not urgency, this far out.) |
| Apr–Jun (deep in spring semester) | Høst (next) | Same as above — spring is running, not planning. | Same pattern, shrinking count. |
| Aug 20 (fall just started, timetable published) | Høst (current) | Fall hasn't hit its own deadline yet (that's next spring's electives' deadline logic — fall itself has no forward deadline once it's running, but courses *for* fall are still worth checking against the just-published grid). | Banner de-emphasizes to a past-tense note once the deadline has no forward meaning for the current semester: **"Høst 2026 er i gang."** No countdown once there's nothing left to count down to for the current term. |
| Sep 20 (just past fall deadline) | Vår (next) | Fall closed; spring is next. | "Oppmelding for Vår 2027 stenger 1. feb · 133 dager igjen." |

**Rule stated plainly for implementation:** the plannable semester is
**"the nearest semester whose registration deadline has not yet passed,"**
falling through to **"the next semester after the one currently running"**
once a deadline has passed with no further forward deadline logic to apply.
This single rule drives both the toggle's pre-selected chip and the banner
text — one function (`termContext()`), read in two places, never two
separate guesses that could disagree.

---

## Empty states that teach (inventory, this flow only)

| Screen | Empty/edge state | Teaching content | Why it's not just "no data" |
|---|---|---|---|
| `/planlegger/`, zero courses, cold | Two equal-weight affordances (add field / program picker) | Implicitly teaches "there are two ways in" without a tutorial overlay | The critique this fixes: PLANNER.md's original copy buried the program path third in a sentence; a first-year's correct path was there but visually subordinate. |
| Program picker, cohort ambiguous | "Fant ikke kullet ditt — velg nærmeste" + chips | Teaches that the site sometimes can't be sure, and shows what it did instead of silently substituting | Directly serves DR-8's provenance discipline at the one moment a first-time program-entry user would otherwise never know a guess happened. |
| Cohort chips screen | "Kullet ditt er året du startet på programmet" | One-line jargon gloss, no glossary page (non-goal, §9) | Teaches "kull" exactly once, exactly where it's needed, then never again. |
| Prefilled planner, aggregate banner | "Dette er et forslag... Sjekk mot Studentweb" | Teaches the plan/basket metaphor doesn't mean "you chose this" — resolves perspectives/p1's "shopping-cart language for something NTNU put there" friction | This is the single highest-value teaching moment in the whole flow: it's the moment the "add to plan" verb could otherwise mislead a passive receiver into thinking they made an active choice. |
| Prefilled planner, pre-publish grid | "Timeplan publiseres ~12. aug — kom tilbake da…" | Teaches that a blank-looking grid isn't broken, and gives a reason to return | Reuses the exact string from the shared-artifact return trigger (§3) — one voice for "nothing to show yet, here's when there will be." |
| Prefilled planner, credits short of 30 | Plain "17,5 av 30 sp," no warning styling | Teaches (implicitly, via the null-aware DR-6 number) that the gap is an elective slot to fill, not an error | Sets up F2 without this document needing to build F2's UI — the gap itself is the hand-off. |

---

## Decision log for this blueprint (things this document had to resolve or extend beyond PRODUCT-v2's letter)

1. **"Two doorways, not one CTA" on `/`** extends PRODUCT-v2 §5's literal
   "One CTA" language. §5 was written primarily against the homepage
   triptych-cut critique (removing three redundant tiles); it did not
   directly address the first-year on-ramp's need for a program-entry path
   from the very first screen (perspectives/p1's core finding, which
   PRODUCT-v2 §3.1 separately endorses: "the program+kull picker is the
   secondary path"). Resolution: keep §5's kill of the *three-tile
   triptych* and the *single primary CTA* discipline, but the primary CTA
   is paired with one clearly secondary program-entry doorway — this is a
   weight distinction (one loud, one quiet), not a reintroduction of three
   equal tiles.
2. **Program picker is a new lightweight inline component**, not a
   navigation to `/studier/`. PRODUCT-v2 keeps `/studier/[code]` as "study
   plan as template, host of the elective decide-loop" (§4) and kills the
   `/studier/` *index* — it does not specify an onboarding-weight
   program-name search. This blueprint adds it as the F1b Screen 1
   component, reusing `programs.json` (already available, zero new data
   dependency) and the existing autocomplete/listbox pattern from the
   planner's add-field (zero new interaction pattern).
3. **"Foreslått" per-tag marking** is this document's concrete rendering of
   DR-7's "labeled, editable suggestion" requirement — PRODUCT-v2 states
   the rule, this blueprint pins it to the tag component so it survives
   contact with implementation (a one-time toast would satisfy the letter
   of DR-7 and fail its spirit).
4. **First-year vs. 4th-year is one flow with a data-driven branch**, not
   two flows, per PRODUCT-v2's general discipline against building
   persona-specific apparatus (c1-6's fold of persona D applies in spirit
   here too — don't build two on-ramps when one branching on period content
   suffices).
