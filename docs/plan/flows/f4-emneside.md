# F4 — `/emne/[code]/` as a decision page

Blueprint for the single-course page under PRODUCT-v2. Supersedes PLANNER.md
§5's course-page bullet and the current build wherever they read the page as
an encyclopedia entry. Design system (Ruteark, DESIGN.md) is law and not
restated; this file is layout, hierarchy, state and copy on top of it.

**The reframe in one sentence (PRODUCT-v2 §3.4, D11, DR-8):** this page is not
"everything ntnu.no knows about TDT4100, plus a button" — it is the moment a
looked-up code becomes a *candidate*, evaluated against the plan the visitor
already has (or doesn't). Every element on the page either answers **"does
this fit?"** or feeds the visitor toward answering it. Content that does
neither (prose, contacts, materials) is real, kept, and demoted below the
fold — we are not competing with ntnu.no on encyclopedic depth, we compete on
being the one place the entry is actionable against *your* semester.

---

## 0. Who lands here, and in what state

Three arrival shapes, each needing a different first five seconds. The page
is one template but must read correctly cold.

| Arrival | Plan state | What they actually want first |
| --- | --- | --- |
| **(a) Google/search-engine, cold** (largest volume, c1-1, c4) | Empty plan, no cookie/localStorage plan yet | Confirm this is the right course (name/credits/campus) fast, then be told *this site does something ntnu.no doesn't* — within one screen, or they bounce like any other landing page |
| **(b) Internal, from `/emner/` or a choice-group row** | Plan usually non-empty | Skip the confirm step, go straight to "does it fit" — they already decided to look closer |
| **(c) Shared link / `?mot=`** (c3-7) | Plan may be a *different* person's, via hash | Needs the plan-context line to say *whose* plan and be honest that it's not necessarily theirs yet |

The template does not branch structurally per arrival — it branches on **plan
state** (empty vs. non-empty vs. course-already-in-plan), which is a strict
subset of the above and is what the DOM can actually observe. Arrival shape
(a) is what makes the empty-plan variant of the hero non-optional (§2).

---

## 1. Information hierarchy — what a chooser needs above the fold

Ranked by what a real elective decision (persona A, Velgeren) turns on,
per PRODUCT-v2 §2: **does it clash with what I've committed, is it
project- or exam-assessed, and is the grade distribution brutal** — plus the
two facts everyone needs regardless of persona: what course is this, and
does it run when I need it to.

Above the fold, in order:

1. **Identity strip** — code (mono kicker) + name (display grotesk) + campus
   + credits. Static, from `catalog.json`, renders with zero JS.
2. **The verdict line** — the single most important sentence on the page,
   plan-aware, present even with an empty plan (see §3). This is new
   relative to the current build and is the page's whole reason to exist.
2a. **Primary CTA** — "Legg til i planen" / "I planen · Fjern", `.np-btn`,
    directly under the verdict line, not floated far away in a sidebar.
3. **Exam facts** — season(s), catalog-sourced date or "dato ikke satt"
   (DR-3), ordinary vs. kont labeled distinctly (p4). This is what "when do
   I need to be free" turns on and belongs above the fold because exam
   clustering is a top-tier decision fact.
4. **Assessment form** — one line: "Skriftlig skoleeksamen" /
   "Hjemmeeksamen" / "Mappevurdering" etc., verbatim from
   `assessmentScheme` — the "project or exam" fact persona A names
   explicitly.
5. **Grade shape** — collapsed by default outside a decision context (see
   §5), but a *one-line* teaser sits above the fold ("Strykprosent 18 %
   (vår, n=612) · se fordeling ↓") because "brutal grade distribution" is a
   named top-tier decision fact and hiding it entirely below the fold would
   contradict persona A's own priority list. The *chart* is below the fold;
   the *headline number* is not.

Below the fold, in this order: timetable grid (own section, §4), prose
(content/learning outcome/assessment details), mandatory activities, credit
reductions, contacts, links, facts table catch-all.

This inverts the current build's order (facts panel → prose → exams table →
grades chart → timetable), because the current order is organized like a
university's own page (identity → bureaucracy → content), while a chooser's
order is organized like a decision (identity → does it fit → what does
taking it cost me → prove it → learn more if still undecided).

---

## 2. Screen: cold arrival, empty plan (arrival shape a)

```
EMNE (np-kicker)                                          [Legg til i planen]  ← .np-btn, accent on hover
TDT4100 (np-data, mono kicker)
Objektorientert programmering (display grotesk)
Trondheim · 7,5 sp · Norsk                                            ← .np-data line

┌ .np-panel ───────────────────────────────────────────────────────────────┐
│ Ingen plan ennå.                                                          │
│ Legg til dette emnet for å se om det kolliderer med resten av             │
│ semesteret ditt — ingen innlogging.                          [Legg til →]│
└────────────────────────────────────────────────────────────────────────────┘

EKSAMEN (np-kicker)
Ordinær · Vår 2026 · 18. mai (np-data)                     ← catalog ExamDate
Skriftlig skoleeksamen · 4 timer                            ← assessmentScheme + exam.duration

Strykprosent 18 % (vår, n=612)                              se fordeling ↓   ← anchor to §5
──────────────────────────────────────────────────────────────────────────
[ prose, timetable, mandatory activities, etc. — below fold, per §1 order ]
```

This is the empty-plan variant of the verdict line: it cannot say "fits" or
"collides" (nothing to compare against), so it says what the product *is* —
one sentence, one CTA, done. This doubles as the one-time planner pitch for
first-time visitors (c3 F5's fix: no separate dismissible intro banner
competing with this — the empty-plan panel *is* the pitch, always present,
never dismissed-and-gone). No `.np-frame.np-ruled` here — the ruling is
reserved for planning surfaces (DESIGN.md "Ruling-Marks-The-Plan"); this
panel is plain `.np-panel`, not a grid.

If the plan strip is suppressed on empty plans sitewide, this panel is the
*only* on-screen signal a planner exists on this page (c3 F5) — it must
never be allowed to regress to a smaller/quieter treatment than shown here.

---

## 3. Screen: non-empty plan, course not yet in it — the verdict line

This is the page's central new mechanic (PRODUCT-v2 §3.4, §6 "plan-aware
clash preview before add"): **compute and show the clash preview without
requiring the add.** The visitor should never have to click "legg til" just
to find out it collides — that is the current build's dead-end pattern
(p6 F14) inverted into a fork.

```
EMNE (np-kicker)                                          [Legg til i planen]
TDT4100 (np-data)
Objektorientert programmering (display grotesk)
Trondheim · 7,5 sp · Norsk

┌ .np-panel, verdict states below ──────────────────────────────────────────┐
│ (a) clean fit:                                                            │
│   ▪ Passer i planen din for Høst 2026 — ingen kollisjon.        (ink,     │
│                                                                   not      │
│                                                                   green —  │
│                                                                   see note)│
│                                                                            │
│ (b) collision:                                                            │
│   ▪ TDT4100 kolliderer med TMA4100 · mandag 10:15–12:00 · uke 35–41       │
│     (mono, wavy-red underline on both codes, .np-note-clash treatment)    │
│                                                                            │
│ (c) exam clash / tight spacing:                                           │
│   ▪ Eksamen kolliderer med TMA4100 · begge 18. mai                       │
│     — or —                                                               │
│   ▪ Eksamen ligger tett inntil TMA4100 · 1 dag mellom                    │
│                                                                            │
│ (d) off-semester:                                                         │
│   ▪ Undervises ikke i Høst 2026 (planen din) — vises som opplysning,     │
│     ikke feil; add still allowed, notice fires per DR-10                 │
│                                                                            │
│ (e) pre-publish (DR-2):                                                   │
│   ▪ Timeplan ikke publisert ennå for Høst 2026 · eksamen og vurdering    │
│     under er likevel gyldig grunnlag                                     │
└────────────────────────────────────────────────────────────────────────────┘
[Legg til i planen — se på ukeplanen →]     ← CTA copy varies by verdict, §3a
```

**Verdict color discipline, adjudicated:** collision states use red ink
exactly as DESIGN.md specifies (Red-Is-Collision — real, concrete, named
clash). The clean-fit state (a) does **not** get green, deliberately: green
is reserved for "I planen" membership state and the 30-sp completion signal
(Green-Means-Fits, DESIGN.md §8) — *before* the course is actually added it
is not yet "fitting," it is "would fit," a weaker claim that stays plain ink.
Green appears only after the click, on the membership badge (§3b). This
keeps the rule bright-line: green never predicts, it confirms.

**3a. CTA copy threads the verdict.** Default "Legg til i planen." When a
collision is shown, the button becomes secondary/quiet and the copy adds the
consequence: "Legg til likevel" (add anyway) sits next to a clearer link to
the planner ("Se i ukeplanen →") so the visitor can inspect before
committing rather than the page hiding the collision behind a click.

**3b. After add — membership state.** Button flips to `.np-btn.is-active`
(accent fill) reading "I planen · Fjern" (PLANNER.md vocabulary, unchanged).
The verdict panel re-renders from "would fit" to a green-ink confirmation
line only now: "Lagt i planen · ingen kollisjon" or, if a collision existed,
it stays in red ink post-add too — adding a colliding course does not erase
the collision, it just moves the decision to "now go resolve it," with the
link "Se i ukeplanen →" now reading as the next step, not a preview.

**3c. First-add teaching moment (c3 F5 fix, folds the "one-time intro"
into this).** The *first* successful add from *any* page in the session
fires one inline mono confirmation line directly under the button:
`Lagt i planen · Se ukeplanen →`. This replaces a separate dismissible
banner entirely — there is exactly one teaching moment, at the point of
action, not a competing modal.

**3d. Shortlist tier.** A second, quieter action sits beside "Legg til":
"Legg til vurdering" (add to shortlist, `tier: "shortlist"`) for the
elective-comparison case — this is how a course arrived at from a
choice-group row without full commitment gets tracked (feeds the decide-loop
in `/studier/[code]/`, not primarily driven from here, but the state must be
reachable from this page since search-engine and shared-link arrivals land
here directly with no other entry to shortlist state).

---

## 4. Screen: timetable section (below fold)

Grid, not flat list — this is an explicit product decision (PRODUCT-v2 §3.4:
"Shows the timetable as a grid (not a flat list)"), because a grid is
scannable for "what does my Monday look like" in a way a table of rows
is not, and it previews the exact visual grammar the planner itself uses so
the transition from course page to planner is not a format change.

```
UKEPLAN (np-kicker) — år 2026 [◂ year chips, from availableYears ▸]
[ .np-frame.np-ruled, single-course mini-grid: Mon–Fri, same 08–20 scale as
  the planner, this course's own blocks only, own hue (or neutral —
  see note below), room + weeks mono under each block ]
Undervises ikke i valgt semester — mono note if entriesInSemester() is empty for
  the plan's chosen semester specifically (distinct from "no data this year")
```

**Hue note:** the planner assigns hues by *selection order in the plan*; a
single course viewed pre-add has no selection order yet. Render its blocks
in a neutral ink-on-paper style (no hue dot) until added — assigning a hue
speculatively would misrepresent state the plan doesn't hold yet, and would
have to silently reflow if a different hue is later assigned on actual add.
Post-add, this section can adopt the real hue (nice-to-have, not required —
the grid's job here is "what does this course's week look like," not
re-deriving the planner's exact chrome).

**Pre-publish variant (DR-2):** when `timetablePublished` is false for the
relevant year, this section does not render blank — it renders the
`availableYears`-fallback grid **labeled non-authoritative**: "Timeplan for
2025 vist som referanse — 2026 er ikke publisert ennå" in mono, so the
visitor still gets a shape-of-the-week signal instead of an empty frame,
which matters because persona A plans mostly in the pre-publish window
(DR-2, c2-F8).

---

## 5. Grades: presentation, and where it lives

Grade data on this page is **demoted from MUST to SHOULD/COULD** per
PRODUCT-v2 §6 differentiation note and D12 — it is not a browsable feature
here, because standalone grade browsing is DBH-mirror parasitism (c4-cut
#3). What survives on `/emne/[code]/` is exactly two things:

1. **The one-line headline teaser above the fold** (§1 item 5): strykprosent
   + n, season-labeled, anchor-linking down to —
2. **The full distribution below the fold**, collapsed under a
   `.np-summary` disclosure ("Se karakterfordeling ▾"), which then follows
   the p4 discipline in full when expanded:
   - **Split by season, always** — Vår/Høst as separate small distributions,
     never blended, each with its own "n=X kandidater" mono caption
     (p4 §1). If only one season has data, show that one unlabeled.
   - **Small-N visually damped, not hidden**: n<20 renders at reduced
     opacity with "lite grunnlag (n=14) — store utslag mellom år."
   - **Trend, not snapshot**: last 5 years as a multi-year stacked-bar
     strip, mono year labels, `years?: number[]` slice with "vis alle" to
     expand.
   - **Two derived headline stats per season**: "Strykprosent" (F ÷ total,
     or fail ÷ total for pass/fail) and a median/spread indicator — never a
     single blended score, never rendered as a sortable value anywhere else
     on the site (no leaderboard, ever — p4 §1, PRODUCT-v2 §9 non-goals).
   - **Static caveat line, always visible when expanded, not dismissible**:
     "Tall fra DBH, per årskull. Høstkull er ofte kontinuasjon/omtak og kan
     gi et skjevt bilde av vanlig eksamen." (p4 §1 — this sentence carries
     the anti-toxicity work; it is permanent, mono, not a modal.)
   - **Bars use the six categorical hues A→F**, never green/red (those are
     reserved for the plan-verdict vocabulary — DESIGN.md "Course hues …
     never as text color"; grade bars are the one sanctioned use of the
     categoricals as fills, per PLANNER.md/DESIGN.md precedent, and must not
     bleed into `--accent`/`--clash`).

**Why the teaser survives above the fold despite the demotion:** persona A's
own top-three decision facts (§1) explicitly include grade brutality: cutting
it entirely below a disclosure the visitor must think to open would silently
re-break the thing D12 was trying to preserve — grade data *doing work in a
decision*, just not *browsable as trivia*. One line above the fold answers
"is this a dealbreaker" without offering a browsable chart to idle through;
the disclosure is where browsing-shaped behavior is deliberately gated behind
one extra click.

---

## 6. Provenance — every composed fact admits its source (DR-8)

Not a separate section; a mono line threaded under each composed fact,
consistent with "the join admits its gaps" being the moat (PRODUCT-v2 §1,
§6). Concretely on this page:

- Under the exam facts block: `Eksamensdato: NTNU sin emnekatalog · hentet
  22. jul` when catalog-sourced, or `Eksamensdato ikke satt` when neither
  catalog `ExamDate.date` nor scraped `CourseExam.date` resolves (DR-3 —
  never re-parse `dateText` free text into a date to fill this gap).
- Under the timetable grid: `Timeplan sist hentet 22. jul` always; add
  `· ikke publisert ennå` when `timetablePublished` is false for the
  relevant year (ties into §4's pre-publish label, same fact stated once,
  not duplicated).
- Under the grades disclosure: the static DBH caveat line (§5) *is* this
  page's provenance line for that block — no second one needed.
- The verdict line itself (§3) inherits provenance implicitly through the
  timetable's own line — it does not need a third repetition of "as of
  today," since a conflict computed from a stale timetable is only as good
  as the timetable line already discloses.

Provenance lines are always mono, always `--faint`/`--muted` ink, never a
tooltip-only affordance (a screen reader and a scanning eye must get it for
free, matching p4's "not a dismissible modal" principle applied generally).

---

## 7. Below the fold — what stays, demoted, and why

Everything currently on the page stays; only the order and the visual
weight change (§1). No content is cut — ntnu.no depth is not something we
try to out-write, but a visitor who scrolls past the verdict and grades
still deserves the full picture, because sometimes the decision genuinely
does turn on a prerequisite sentence or a mandatory-activity list this page
is the only place composing next to the plan-fit answer:

- **Prose** (`content`, `learningOutcome`, `learningMethods`,
  `assessmentDetails`, `specialConditions`, `requiredKnowledge`,
  `recommendedKnowledge`, `courseMaterials`) — rendered as-is, grotesk body
  text, `--measure` width (not full column — this is reading, not data).
- **Mandatory activities** — list, unchanged.
- **Credit reductions** — table, unchanged; still useful for a student
  checking double-counting.
- **Contacts** — role groups, unchanged; lowest-priority block, last on
  page.
- **Links / facts catch-all** — unchanged, last.
- **Alert banners** (`alerts` on `CourseDetails`, e.g. "tilbys ikke lenger
  undervisning") — these are an exception to the fold ordering: if present,
  they render **above everything**, including the verdict line, in ink (not
  red — this is information, not a collision) because a course no longer
  taught invalidates the whole verdict computation and must be seen first.

---

## 8. Loading & error states

Per PLANNER.md's existing vocabulary, applied to this page's islands
(details, grades, timetable each fetch independently and degrade
independently — one failing does not block the others, consistent with
`data.ts`'s per-course fault tolerance):

- Verdict line while plan-aware computation is pending (needs this course's
  own timetable *and* every committed course's timetable): quiet mono
  "sjekker kollisjoner …" in place of the panel content, panel shell already
  visible so layout doesn't jump.
- Grades disclosure, unopened: no fetch until expanded (lazy — no reason to
  spend a request on a decision teaser that only needs the pre-computed
  headline figure, which can ship in `search-index.json` or a cheap
  aggregate, not the full per-year rows).
- Any island error: one mono line, what failed + what to do — "Fikk ikke
  hentet timeplanen. Prøv igjen om litt." — never blocks the other islands
  or the static shell (code/name/credits/exam-season always render, being
  build-time data from `catalog.json`).
- Unknown code: existing 404 page, unchanged.

---

## 9. What this page explicitly does NOT do (guardrails against regression)

Restated here because course pages are exactly where scope creep toward
"encyclopedia" or "leaderboard" re-enters quietly:

- No compare matrix on this page. `?mot=` (COULD, evidence-gated) is at most
  a two-course "legg begge til"-capable add surface, never a multi-axis
  table (D2, §9 non-goals).
- No sortable/rankable grade figure anywhere this page links to; the
  strykprosent teaser is a fact about *this course*, never a percentile
  against other courses.
- No day-load / free-day / week-scrubber content — those are properties of
  the *combined plan*, meaningless for a single course, and explicitly
  reserved for the planner page and the livability lens (persona C,
  PRODUCT-v2 §3.5, §9).
- No workload/difficulty score, no thesis-relevance, no seat/capacity data
  (none of it exists in `ntnu-api`) — the fabrication guardrail from
  PRODUCT-v2 §9 applies here as much as anywhere.
- No `.np-ruled` squared background outside the timetable grid — the prose
  and facts sections stay plain paper (DESIGN.md "Ruling-Marks-The-Plan").
- No auto-navigation to the planner on add — the add is instant, in place,
  membership badge flips, verdict re-renders; leaving the page is the
  visitor's choice via the "Se ukeplanen →" link, never forced.

---

## 10. Summary table — section-by-section fold placement

| Order | Section | Fold | Plan-aware? | MUST/SHOULD (PRODUCT-v2 §6) |
| --- | --- | --- | --- | --- |
| 1 | Identity strip (code/name/campus/credits) | above | no | MUST (static) |
| 2 | Verdict line + CTA | above | **yes** | MUST |
| 3 | Exam facts (catalog-sourced) | above | no | MUST (DR-3) |
| 4 | Assessment form | above | no | MUST |
| 5 | Grade headline teaser | above | no | SHOULD (teaser only) |
| 6 | Timetable grid | below | partial (hue post-add) | MUST |
| 7 | Grade full distribution (disclosure) | below | no | SHOULD/COULD |
| 8 | Prose (content/outcomes/etc.) | below | no | kept, demoted |
| 9 | Mandatory activities | below | no | kept, demoted |
| 10 | Credit reductions | below | no | kept, demoted |
| 11 | Contacts / links / facts catch-all | below | no | kept, demoted |
| — | Alert banners | **top of page, overrides fold order** | no | MUST when present |
| — | Provenance lines | threaded under 3, 6, 7 | no | MUST (DR-8) |
