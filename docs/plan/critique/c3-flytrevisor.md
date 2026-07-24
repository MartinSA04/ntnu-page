# c3 — Flytrevisor: adversarial critique of PRODUCT-draft.md

I walked each core flow as a skeptical user who does not already know the product. The draft is strong on *what* the product is; it is weakest on *state continuity between screens* and *temporal awareness*. Bugs are out of scope. Below: the dead ends, state losses, first-visit walls, empty states that teach nothing, and the deadline blindness — each quoted, each with a concrete fix.

---

## A. The deadline moments — the draft's biggest hole

The brief says the entire positioning is "the thinking tool **upstream of Studentweb**" and success is "**did the student leave sure — before the registration deadline**." The draft names the deadlines exactly once, in the persona list ("kont dates + deadlines"), and once in MUST ("kont + deadline surfacing"). **Nowhere in the six core flows (§3) does a deadline appear.** A tool whose whole reason to exist is a deadline that never shows the deadline is incoherent.

**F1 — The site does not KNOW what time of year it is, in the flows.**
`semesters.json` carries `phase` (`initial`/`final`), `fromDate`, `toDate`, `examLastDate`, `timetablePublished`. That is enough to compute, for the plannable term: "opptak/registration closes ~Feb 1 or ~Sep 15", "we are N days out", "timetables published / not yet", "we are mid-semester / pre-semester / exam window / kont window". The draft computes none of it into a visible artifact.

*Fix:* Add a **temporal banner as first-class furniture on `/planlegger/`** (and a one-line echo on `/`), driven by a single `semesterPhase(now, semesters)` helper — extend the proposed `semesterYear()` into a `termContext()`. It emits one Ruteark mono margin line, e.g.:
- pre-deadline: `Oppmelding for Høst 2026 stenger ~15. sep · 24 dager igjen · bekreft i Studentweb`
- timetables not out: `Timeplan for Vår 2027 er ikke publisert ennå — eksamensdatoer og emnevalg funker`
- post-deadline / mid-semester: `Undervisning pågår · planlegg Vår 2027` (auto-advances the default term)
This makes §8.4 ("next plannable term") *provable to the user* instead of an invisible internal default. It is the single highest-leverage addition and it uses only data we already have.

**F2 — "next plannable term" is asserted but never disambiguated at the deadline seam.**
§8.4: *"next plannable term (p6), not 'current' — the site is provably forward-looking."* On 2026-07-24 (today), `current` is `26h` in `final` phase, teaching hasn't started (fromDate 07-27). Is the plannable term `26h` (registration for it may be closed) or `27v`? The draft gives no rule. A first-time visitor in late August planning kont, and a visitor in October planning spring, must land on *different* defaults, and the draft's "next plannable" is undefined across the Sep-15 boundary.

*Fix:* Define plannable term explicitly in §6 domain rules: `plannableTerm = first semester whose registration window is still open OR not yet started`, derived from `phase` + `fromDate` + the Feb-1/Sep-15 constants. Show it in the F1 banner so the choice is legible and overridable via the existing semester chips. Add to §9 open questions only the *constant source* (are Feb 1/Sep 15 hardcoded or in metadata?), not the rule itself.

---

## B. State continuity — does the basket survive every navigation?

The draft leans hard on the plan strip as "connective tissue turning add-from-anywhere into aware-from-anywhere" (§4). I chased the state across every hop.

**F3 — The two-tier state (committed + shortlist) is promised, but only `#26h;committed;shortlist` is a hash sketch — the shortlist's survival across pages is an OPEN QUESTION, which means the core loop can silently lose state.**
§9: *"candidates-in-hash from day one"* and *"plan strip suppressed on /planlegger/ or not"* are listed as unresolved. But the **core flow (§3.2)** is: choice group → add-all-to-shortlist (on `/studier/[code]/`) → ghost blocks **on the planner grid**. That is a *cross-page* handoff: the shortlist is populated on the study-plan page and consumed on the planner. If shortlist is not in the hash/localStorage from day one, **the elective loop — the product's center of gravity — loses its candidates on the very navigation it depends on.** This cannot be an open question; it is load-bearing.

*Fix:* Resolve §9 now: **shortlist lives in `PlanState` (localStorage) AND the hash, same as committed, from v2.** The draft already bumps `PlanState → v:2` (§8.1); make shortlist a peer array `courses[]` with a `tier: 'committed'|'shortlist'` field, not a separate lifecycle. Then every add-from-anywhere writes it and every page reads it — no special case.

**F4 — Bulk-add from a study plan writes shortlist, but the user is on `/studier/[code]/`, and the payoff (ghost blocks on the grid) is on `/planlegger/`. Nothing in the flow navigates them there.**
§3.2 lists the steps as one arrow chain but skips the page transition. A skeptical user clicks "legg alle til vurdering" on the study-plan page and… sees what? If the answer is "the plan strip count ticks up", that is not the promised feedback ("ghost blocks on the grid · compare table"). They must *know* to go to the planner.

*Fix:* After a bulk-add on `/studier/[code]/`, the plan strip must surface a **direct, labeled affordance**: `5 emner til vurdering · Se på ukeplanen →`. And the study-plan page should render an **inline mini-consequence** (credit total + "kolliderer med 2 av dine" count) so the user isn't blind-shipped to another page. Add this as an explicit step in §3.2 and a MUST ("cross-page continuation affordance in plan strip").

**F5 — The plan strip is "non-empty only" (§4). That means on an empty plan it is invisible — so on `/emne/[code]/` (largest traffic, §3.4), a search-engine visitor with no plan has NO on-screen signal that a planner even exists** until they read the one-time intro. The draft acknowledges "one-time planner intro for empty-plan visitors" (§3.4) but the *strip itself* is suppressed, so after they dismiss the intro once, the only cross-page thread (the strip) is gone whenever their plan is empty. First-add discoverability rests entirely on a single dismissible element.

*Fix:* Keep the strip suppressed when empty, but make **"Legg til i planen" on `/emne/[code]/` always visible and self-explanatory** (it is in MUST already — good), and have the *first successful add anywhere* trigger a one-time inline mono line at the add site: `Lagt i planen · Se ukeplan →`, not a separate intro that competes. Collapse §3.4's "one-time intro" and this into one first-add confirmation so there is exactly one teaching moment, at the point of action.

**F6 — Semester mismatch on add is unaddressed: the plan has a `semesterId`, but "add from anywhere" can add a course taught in the OTHER semester.**
PLANNER.md already anticipates "Undervises ikke i valgt semester" as a row note. But in the draft's add-from-anywhere model, a user on `/emne/[code]/` whose plan is set to `27v` clicks "Legg til" on a course only taught in `26h`. Does it silently join and then show grey? Does the plan strip's credit total include it? The draft's `notices[]` at add-time (MUST) is the right hook but its content isn't specified for this case.

*Fix:* Specify the notice: adding an off-semester course emits `notices[]` = `TDT4100 undervises i Høst — bytt semester eller behold som notat`. Decide (and state in §6) whether off-semester courses count toward the 30-sp total (they should NOT — it would corrupt the "reach a full load" signal). Add to §6 MUST.

---

## C. First-visit walls & empty states that teach nothing

**F7 — The `/` dispatcher's first-year on-ramp requires the student to already know their program.**
§3.1: *"name-based program+kull picker → pre-fills /planlegger/."* A brand-new first-year (persona B, "turn 5 codes into where I walk in") often knows their program's *marketing name* ("Datateknologi"), not the code (MTDT) — the draft's "name-based" picker handles that, good. But a large slice of first-years received **an email with 5 course codes and no program name they recognize**, or are on a program whose name they'd spell three ways. If the name-search returns nothing, the on-ramp is a wall with no exit.

*Fix:* The program picker's empty/no-match state must offer the escape hatch already in the IA: `Fant du ikke programmet? Legg inn emnekodene direkte →` linking to `/planlegger/` add field. Persona B's actual artifact is *the code list*, so the code-first path must be a peer of the program-first path on the dispatcher, not buried. Add to §3.1.

**F8 — The planner empty state (from PLANNER.md) still requires the user to know a code or a program to proceed.** Its three exits are: add field (type a code you must know), "Søk i emnekatalogen" (search you must have a term for), "Start fra et studieprogram" (know your program). For persona A (elective chooser) mid-flow this is fine, but for a cold first visit with no code and no program in mind, the empty state teaches nothing about *what a good starting move is*.

*Fix:* The draft's §3.1 on-ramp partially fixes this by routing first-years through the picker before they hit the empty planner. Make the empty-state's **primary** exit the program picker (persona A and B both have a program), demote the raw add field to secondary, and add one concrete example line: `f.eks. TDT4100, TMA4100 — eller start fra studieprogrammet ditt`. An empty state should show the shape of a filled one.

**F9 — `/emner/` merges program search as `?type=studier` (§4) but the empty/initial state of a merged search is ambiguous: am I searching courses or programs?** Killing `/studier/` standalone index (§4) is defensible, but a user arriving at `/emner/` with an empty query and a mixed result space has no model of what the two `?type=` values mean until they toggle.

*Fix:* Default `?type=emner`, make the type a visible two-pill toggle (`Emner | Studieprogram`) with the count under each, and seed the empty state with the *most-relevant-right-now* content: if `termContext()` says pre-deadline, show "Populære valgemner denne uka" is fabricated (KILLED — good), so instead show `Søk etter emnekode, emnenavn eller studieprogram`. State the merged-search's default type and toggle explicitly in §4.

---

## D. Dead ends & missing return paths

**F10 — The compare view has two entry points (planner component + `/emne/?mot=`, §8.2) but the draft never states the RETURN path from the deep-linked compare.** A user lands on `/emne/TDT4100/?mot=TDT4102` from a shared link with an *empty local plan*. They compare, decide — then what? There is no plan to promote into, and the draft's promote step (§3.2) assumes shortlist state that a cold deep-link visitor doesn't have.

*Fix:* `?mot=` compare must offer `Legg begge i planen` / `Legg X i planen` directly from the compare view, seeding the plan for a cold visitor. State in §3.4/§8.2 that the compare view is itself an add surface, not just a read surface — otherwise the deep-link is a dead end.

**F11 — The shared-plan handoff interstitial (§3.6) protects the *receiver's* existing plan, but there is no "merge" option and no preview of what's being overwritten.** *"Bruk denne / Behold min egen"* is binary destruction: a persona-A student who has spent an hour building a shortlist and pastes a friend's link either nukes their own work or ignores the friend's entirely.

*Fix:* Add a third option and a diff: `Bruk denne (X emner) · Behold min (Y emner) · Slå sammen`, and show the incoming plan's course codes + semester before the choice. The merge case is cheap (union of `courses[]`) and prevents the most painful state loss on the site.

**F12 — The livability week-scrubber (§3.5) "flagging atypical weeks" implies navigation through weeks, but the plan strip/credit total/exam ribbon are computed for the *whole* semester — the draft doesn't say whether scrubbing a week re-scopes conflict marks or only annotates.** If scrubbing changes the grid but a conflict only occurs in week 40, does the margin note appear only when you're on week 40? A user could scrub past a real clash and never see it.

*Fix:* State in §3.5/§6 that **conflict detection is always whole-semester** (the margin notes list every colliding pair regardless of scrubbed week, per PLANNER.md's "uke 35–41" week-scoping already in the note text); the scrubber only changes which *ghost/instance* blocks render, never suppresses a conflict note. Otherwise livability actively hides the primary signal.

---

## E. Smaller but concrete

**F13 — §3.2 "commit at ~30 sp → Studentweb" has no defined commit artifact.** "Commit" flips shortlist→committed internally, but the promised "fast, certain exit to Studentweb" (§1 success metric) needs an actual **hand-off screen**: the committed course codes as a copyable list + `bekreft i Studentweb` (no integration, just the codes ready to paste). Without it, the success moment — the whole point — has no UI. Add as MUST: "commit summary: copyable code list + Studentweb reminder."

**F14 — Version threading (§6 MUST) surfaces course versions, but no flow step tells the user WHEN a version matters.** A skeptical elective chooser comparing two courses won't know one has a newer version with different assessment. The draft threads it through data but never into a visible moment.

*Fix:* Only surface version as a `notices[]` line when the plan's semester falls outside the course's published years, e.g. `Emnet er ikke bekreftet for Vår 2027 ennå (viser 2026-versjonen)`. Otherwise keep it invisible. Tie to `publishedYears` gating already in SHOULD.

---

## Top findings, ranked

1. **F1/F2 — Deadline blindness.** The upstream-of-Studentweb tool never shows the deadline or the term phase in any flow. Add a `termContext()`-driven temporal banner; define "plannable term" as a rule, not an invisible default. Data exists (`phase`/`fromDate`/`examLastDate`).
2. **F3 — Shortlist state survival is filed as an open question but is load-bearing for the core elective loop.** Resolve now: shortlist lives in `PlanState` + hash as a `tier` field from v2. No separate lifecycle.
3. **F4 — Cross-page handoff gap:** bulk-add happens on `/studier/`, payoff is on `/planlegger/`, nothing carries the user across. Add a plan-strip continuation affordance + inline consequence on the study-plan page.
4. **F13 — The success moment has no UI.** "Commit → Studentweb" needs a copyable committed-code list + Studentweb reminder, or the product's own success metric has no screen.
5. **F11 — Shared-plan handoff is binary destruction.** Add a "Slå sammen" (merge) option + preview of incoming codes; prevents the worst state loss.
6. **F7/F8 — First-visit walls:** program picker with no code-first escape hatch; empty planner that teaches no starting move. Add code-first peer path + example-seeded empty states.
7. **F10 — Deep-linked `?mot=` compare is a dead end for cold visitors** with no plan to promote into. Make the compare view an add surface.
8. **F6 — Add-from-anywhere can add off-semester courses** with unspecified behavior. Define the `notices[]` message and exclude off-semester credits from the 30-sp total.
9. **F12 — Week-scrubber must not suppress whole-semester conflict notes.** State conflicts are always whole-semester.
