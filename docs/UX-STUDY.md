# UX-STUDY.md — user-friendliness study, 2026-07-25

**Method.** Eight independent auditors (personas/lenses: førsteklassing,
velgeren, planner-editing, mobile, a11y, copy, edge-states, visual-IA) drove
the **live local build** (`wrangler dev`, real NTNU data) with Playwright —
interacting, screenshotting, and measuring the DOM, not reading intentions
from source. Findings were consolidated across lenses, and the top 12 were
each re-run by an independent skeptical verifier told to *refute* them.
**All 12 reproduced.** Verifiers moved severities in both directions (one up
to blocker, three down to minor) and rejected two suggested fixes as
over-apparatus under §0 — those notes are kept below so we don't overbuild.

**Headline.** The §0 mandate core — programme + kull → weekly schedule,
trivially editable, shareable — is *genuinely good when reached via the
homepage*. The craftsmanship is real: honest empty states, precise
plain-language collision sentences, working share round-trips, strong a11y,
complete dark mode. What makes the site "not very user friendly" is not the
core design; it is that **the front door of `/planlegger/` itself is broken**
(one apparent regression producing three blocker symptoms), **most
non-freshman cohorts are locked out of the picker**, and **courses with
parallel lecture/seminar groups render as an unreadable stack that
manufactures false collisions**. Around that: a handful of trust cracks
(a lying fallback message, a false-positive clash preview, a
self-contradicting course page, a sabotaged 404) that are individually small
but corrosive, because this product's whole moat is "the join that admits
its gaps."

---

## 1. What is good (keep, and don't dilute)

**The homepage on-ramp.** Value prop lands in one screen: one headline
("Se timeplanen din for høsten."), one input, and a live mini-schedule that
demonstrates a red collision before the user does anything. Typing
"Datateknologi" disambiguates MIDT / MTDT / PHCOS with level, duration and
city — the easy mixup is headed off at the source. Kull defaults to the
current year with "kull = året du startet" exactly where the jargon appears.
Cold visitor → real MTDT week in **3 interactions**.

**The week itself.** Rooms, week ranges, exam timeline with countdowns,
null-aware credit total, and collision verdicts as precise sentences
("Tirsdag 10:15–12:00 · TMA4400 og IT2805 kolliderer · uke 34–47") — honest
and specific, not a vague red flag.

**Editing.** Drop is one click, visibly reversible ("droppet — fortsatt en
del av programmet" / "Legg tilbake"); manual adds are labelled "lagt til
selv" and hard-removable; overload is called out ("37,5 av 30 sp · over
normal semesterbelastning"); semester switch re-derives with zero stale
state; the URL hash survives reload, silently restores a session on bare
`/planlegger/`, and a share URL reproduced a plan (with drop + manual add +
active collision) pixel-for-pixel in a fresh browser context.

**Honest states, where they were designed.** Unpublished Vår 2027 is a real
designed state ("publiseres vanligvis i desember — kom tilbake da", courses
still listed); PHCOS-without-plan names the gap and the next action; garbage
input degrades to a calm "Ingen treff."; throttled network shows per-section
"henter …" labels with no layout jump. The provenance line composes what
actually happened this render.

**Accessibility.** Proper ARIA comboboxes with working
`aria-activedescendant`; skip link is the first Tab stop; grid blocks are
real `<button>`s with descriptive aria-labels; collision status is
`aria-live`; `prefers-reduced-motion` zeroes the duration tokens; focus
outline measures ~4.4:1; muted øving layer and provenance line measure
6–7:1 in both themes.

**Visual system.** All pages read as one product in both themes; the filled
planner is dense but clearly zoned; primary actions are visually loudest on
`/studier/[code]/` and the planner.

---

## 2. What needs to change

IDs T1–T14 are the consolidated study findings; severity shown is the
**verifier's**, after independent reproduction.

### P0 — the front door (one likely regression, three symptoms)

- **S1 · blocker (T1).** On `/planlegger/` itself, picking Datateknologi →
  MTDT → kull 2026 leaves "Ingen emner i planen ennå" and an empty grid —
  while the plan API call visibly returns 200, and both the
  "Velg fra studieplanen" gap-prompt and the "Fra studieplanen" toggle exist
  in the DOM but stay hidden/disabled. The only working route is the
  non-discoverable detour via `/studier/MTDT/` → "Bruk som planen min". The
  page's own copy promises "…så vises ukeplanen med en gang."
- **S2 · blocker (T3).** The same selection writes the hash as
  `#v2;26h;-;` — a literal `-` where the programme code belongs. Reload
  fires zero API calls and wipes everything, so the URL a user would copy
  right after picking their programme breaks the "del planen med en lenke"
  promise. (Reproduced with two different programmes.)
- **S3 · major (T6).** The picker gives no confirmation of what was picked:
  input clears to placeholder, no chip, header stays "Velg studieprogram".
  With MIDT/MTDT both named "Datateknologi", a misclick is invisible.

The homepage picker path works and populates a correct plan, so S1–S3 look
like **one wiring regression in the in-page picker's commit-to-store step**,
not missing features — the hidden affordances are already built. Fix the
commit + hash write, and add the round-trip test T3's verifier suggested
(select → copy hash → reload → assert same state).

### P0 — cohort lockout

- **S4 · blocker (T2).** The `/planlegger/` kull picker offers **only
  "2026"** for MTDT, while `/studier/MTDT/` correctly offers 2021–2026 +
  "Andre kull (14)" (and BIT gets three chips in the planner). Hand-editing
  the hash to `MTDT.2024` works perfectly — and reveals the fully-built
  "Valg av studieretning" panel that the UI never exposes a path to. Most
  non-freshman MTDT students cannot reach their own schedule through the
  advertised UI at all. Likely cause: the B3 chip filter treats
  direction-gated periods as nonexistent. Port the `/studier/` chip set; if
  a kull truly has no data, say so instead of omitting the chip.

### P0 — parallel groups make real schedules unreadable

- **S5 · blocker (T8, raised from major by the verifier).** TDT4110 renders
  "Forelesningsparallell 1/2/3" as three simultaneous weekly slots for a
  course a student attends once; clicking a block does nothing. Toggling
  "Vis øvinger og labber" with EXPH0300 stacks 10+ seminar groups
  (Trondheim/Gjøvik/Ålesund simultaneously) into illegible slivers — while
  the verdict line still reads "ingen kollisjoner". This defeats "glance at
  your actual week" for any multi-parallel course, which is common, and
  manufactures false collisions against other courses. The førsteklassing
  journey: *"that's the kind of thing that would make me double-check with a
  classmate before trusting the grid on day one."*
  **Scope note:** DR-1 cut øving-group clustering *for the conflict engine*
  (no `activityCode` in the data) — that stands. This is a narrower
  *display/selection* problem using names that already render: a per-course
  group picker (default parallel 1, "alle" opt-in) or at minimum one line
  under the toggle — "Flere alternative grupper vises samtidig — du følger
  bare én av dem." The mandate-minimal fix is the sentence + a picker for
  *lecture parallels only*.

### P1 — trust cracks (small fixes, outsized damage)

- **S6 · major (T10 + copy audit, independently).** One fallback message
  covers three different causes. `showFallback = !published || allEmpty`
  conflates (a) genuinely unpublished, (b) **API/network failure**, and
  (c) **your courses simply don't run this term** — all three render
  "Timeplan for Høst 2026 publiseres vanligvis i august — kom tilbake da",
  which is confidently false for (b) and (c): Høst 2026 *is* published. A
  student hit by a network blip is told to come back next month for a
  schedule that exists. Split the copy per cause; give fetch-failure a retry.
- **S7 · major (T4).** The per-course clash preview on `/emne/TDT4173/`
  showed a red "Kolliderer med TMA4400, torsdag 08:15" that the real
  planner then contradicted ("ingen kollisjoner") — the preview compares
  against **all** of a course's sections (that Thursday slot belongs to
  TMA4400's MTGEORT parallel, not the MTDT sections in the plan), while the
  planner filters to plan-relevant sections. The velgeren journey: *"the
  false clash is the kind of bug that would make me stop trusting the
  site's answers."* Share the section-matching logic between the two paths;
  add a regression test comparing them on the same plan+candidate.
- **S8 · major (T7).** `/emne/TDT4100/` disagrees with itself three ways:
  "Viser Vår 2026 — ikke undervist i Høst 2026" vs. Nøkkeltall
  "Undervises: Vår 2027" vs. "Ordinær eksamen · Vår 2027" — and the stale
  grid has no historical framing. Label the fallback timetable consistently
  with the key-facts semester.
- **S9 · major (T5 + copy audit).** The 404 page's only recovery action is
  pre-broken: `<input type="search" name="q" value="404" …>` — every 404
  funnels into `/?q=404` → "Ingen treff." Remove the stray `value`.
- **S10 · major (copy audit).** "26. nov · TMA4412 · **5 dager til neste**"
  reads as a countdown from today (it's the gap to the next exam). Name the
  target instead: "5 dager til TMA4400 (1. des)".
- **S11 · major, unverified (T13/T14 — measured, not re-verified).** Light
  mode drops the per-course block tint dark mode has (identical gray-beige
  fills, only a 6px marker square differs), so the default theme can't be
  read by color at a glance; dark-mode clash text measures 3.62:1 against
  its `is-clash` background (AA needs 4.5:1). Both are token-level CSS.

### P2 — polish (one-liners and copy)

- **S12 · minor (T9, downgraded).** Grid chips truncate (clientWidth ~40px
  vs. scrollWidth 64–74px): TMA4400/TMA4412 both render "TMA44", EXPH0300 as
  "EXPH0". Desktop has three existing disambiguators (title tooltip, color
  dots, the collision sentences) the finding under-credited; mobile has no
  tap fallback. Fix the tag legibility (wrap/shrink or front-truncate
  "…4412"); **do not** build the suggested popover/bottom-sheet — the
  verifier flagged it as over-apparatus.
- **S13 · minor (T12).** Planner row leaks "lagt til selv · fikk ikke hentet
  detaljer: Not found" while `/emne/TMA4100/` already has the friendly copy
  ("kun eksamen · ikke undervist i 2026 · sist undervist 2025"). Reuse it.
- **S14 · minor (T11, downgraded).** A bare course code in the homepage
  input dead-ends at "Ingen treff." with the "Søk i emner" link at y=858 of
  a 900px viewport. One line of copy in the empty state ("Ser du etter et
  emne? Søk i emner →") — **not** the suggested code-pattern detection
  (over-apparatus per verifier).
- **S15 · minor (copy audit).** The mobile scroll hint's DOM text is
  literally "dra sidelengs for fre" — reads as a truncation bug even if
  intentional shorthand for fredag. Make it a sentence: "Dra sidelengs for å
  se hele uken."
- **Remainder (unverified minors):** TDT4109/TDT4110 share a displayed name
  in the sidebar; footer status sticks on present-tense "henter …" after a
  deep-link load completes; add-field typeahead fires 404 spam; "Endre"
  reopens an empty search instead of the current selection; `/studier/PHCOS/`
  dead-ends without a CTA back to the planner; `/emner/` + `/studier/` read
  as broken from the whitespace below minimal content; catalog entry points
  are footer-only (deliberate per D11 — revisit only with evidence).

---

## 3. Suggested order

1. **S1–S3** — the in-page picker regression (find the one commit-to-store
   break; the affordances already exist). Add the hash round-trip test.
2. **S4** — kull chips + the hidden studieretning panel: this is the
   difference between serving freshmen and serving the whole student body.
3. **S6, S7** — the two "confidently wrong" surfaces; both are targeted
   condition/logic fixes, and honesty is the product's stated moat.
4. **S9, S10, S13, S15, S8** — copy/label one-liners; batch them.
5. **S11** — two CSS token changes (light-mode tints, dark clash contrast).
6. **S5** — the one item needing actual design: minimum viable version is
   the explainer sentence + a lecture-parallel picker per course row.
   Respect DR-1's boundary (display selection, not conflict clustering).
7. **S12, S14** + remainder as ride-alongs.

What this study deliberately does *not* recommend: popovers/bottom-sheets
for grid blocks, course-code pattern detection on the homepage, or any
decide-loop apparatus ahead of ROADMAP Phase 4 — verifiers checked every
suggested fix against §0 and these were the ones that failed it.

---

*Method note: 22 subagents total (8 auditors + 1 consolidator + 12
verifiers + 1 copy re-run), all driving http://127.0.0.1:8788 against live
NTNU data. Screenshots and DOM measurements were session-local; the
evidence text above is self-contained. Verification: 12/12 reproduced,
0 refuted.*
