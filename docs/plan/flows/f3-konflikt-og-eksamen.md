# F3 — Konflikt og eksamen: UX blueprint

Screen-by-screen blueprint for the two decision surfaces PRODUCT-v2 makes
load-bearing: **how a clash is discovered, honestly explained, and
resolved**, and **the exam timeline as a decision surface** (spread, gaps,
kont, deadlines). Strictly downstream of `PRODUCT-v2.md` — every rule cited
below (DR-1…DR-10) is binding; where this file specifies pixels/copy beyond
PRODUCT-v2, DESIGN.md's Ruteark system is law and is assumed, not restated.

This is not a new page. It is the behavior of `/planlegger/`'s two `.np-
frame.np-ruled` spreads (UKEPLAN, EKSAMENER) plus the clash-preview
component that PRODUCT-v2 §6 says must appear "everywhere" (`/emner/` rows,
`/emne/[code]`, the elective decide-loop). One engine, several mount points.

---

## 0. The one honesty rule this whole file exists to enforce

DR-1 killed øving-group clustering as unbuildable. That does **not** mean
"pretend the noise doesn't exist" — it means the UI must say, in the copy
itself, what class of thing it did and did not check. The failure mode this
file is designed against is p9's warning made concrete: a CS student adds
two lab-heavy courses, sees 8 red blocks that are actually "pick one of 8
identical rooms," stops trusting red ink, and then misses the one real
lecture clash three courses later.

**The fix is not a smarter engine. It is honest labeling of what the engine
is confident about.** Two visually distinct marks exist from here on:

- **Red ink (`--clash`)** — a lecture-classified entry that hard-overlaps
  another lecture-classified entry. The engine is confident. This is the
  only thing "kolliderer med" is allowed to describe.
- **Muted flag (ink, not red — `.np-note`, not `.np-note-clash`)** — a
  non-lecture entry (øving/lab/seminar, classified by keyword or unclassified)
  that overlaps something. The copy never says "kolliderer." It says "kan
  overlappe" and explains why the tool can't be sure, in one clause, every
  time it appears.

This single distinction is the answer to "how is a clash discovered and
understood" — discovery must arrive pre-sorted into "act on this" and "check
this yourself," never as an undifferentiated wall of red.

---

## 1. The conflict engine's two output classes (interaction contract)

Before screens: the shape every mount point renders against.

```ts
type ClassifiedEntry = {
  entry: TimetableEntry;
  class: "lecture" | "exercise" | "unclassified";
  // classified by Norwegian keyword match on name/title/acronym:
  // lecture   → /forelesning/i
  // exercise  → /øving|øv\.|gruppe|lab|seminar|kollokvi/i
  // unclassified → no match, treated as exercise for conflict purposes
  //   (DR-1: conservative default — never silently promote an
  //   unclassified entry to a hard conflict)
};

type Clash =
  | { kind: "hard"; a: ClassifiedEntry; b: ClassifiedEntry; dayNumber; start; end; weeks }
  //   both entries classified "lecture" — the only kind red ink marks
  | { kind: "soft"; a: ClassifiedEntry; b: ClassifiedEntry; dayNumber; start; end; weeks };
  //   at least one entry is "exercise" or "unclassified"
```

**Naming, deliberately not neutral:** "hard" clashes are what PLANNER.md's
existing `Conflict` type described — keep that name in code, but the UI verb
is "kolliderer med" only for `kind: "hard"`. "Soft" clashes get "kan
overlappe" and always carry the reason clause: **"vises fordi vi ikke kan
skille øvingsgrupper — velg en gruppe som ikke overlapper."**

This is the DR-1 contract made literal: the engine still computes overlaps
for exercise-classified entries (cheap, same pairwise pass), it just never
calls them a conflict.

---

## 2. Screen: `/planlegger/` — UKEPLAN spread (primary discovery surface)

### 2.1 Layout (extends PLANNER.md §2's block, unchanged frame)

```
UKEPLAN (np-kicker) ─ uke 34–47 (np-data)
┌ .np-frame.np-ruled ──────────────────────────────────────────────┐
│         Man        Tir        Ons        Tor        Fre          │
│ 08:15   ...                                                       │
│ 10:15   [▪TDT4100 forelesning     ]  [▪TMA4100 forelesning]      │
│         wavy-red underline, red hatch fill, both blocks           │
│ 12:15   [▪TDT4100 øving gr.3][▪TDT4100 øving gr.7]  ← greyed,    │
│           muted ink outline, no hatch, small "±" glyph            │
│ 14:15   [▪TFE4146 lab        ]                                    │
└─────────────────────────────────────────────────────────────────┘
[ margin: .np-note-clash — hard clashes, red ink, one line per pair ]
[ margin: .np-note — soft overlaps, ink, collapsed under a disclosure ]
```

**Block-level rule (new vs. PLANNER.md's flat "overlapping blocks split
side-by-side"):** entries classified `exercise`/`unclassified` that overlap
each other (parallel groups of the *same* course) are **not** split
side-by-side and are **not** flagged at all against each other — same-course
parallel sections are always mutually non-conflicting by construction (a
student picks one). Only overlaps **across different courses** ever produce
a `Clash`. This is a cheap, always-safe filter that removes the single
noisiest false-signal case (8 øving rooms of one course "conflicting" with
each other) without needing the clustering DR-1 ruled out.

Exercise/unclassified blocks that *do* overlap a different course render
with a **thin ink outline, no fill hatch, no wavy underline**, and a small
`±` glyph in the corner (mono, `--muted`) — visually quiet on purpose. They
sit on the grid (unlike the old "muted, non-clashing display label" reading,
which could be misread as "hide it") because a lab session is still a real
time commitment a student needs to see, just not a verdict.

### 2.2 Margin notes — the two-tier disclosure

```
[ .np-note-clash, always expanded, one per hard pair: ]
  "TDT4100 kolliderer med TMA4100 · mandag 10:15–12:00 · uke 35–41"
  → click scrolls + np-target-flash both blocks (unchanged from PLANNER.md)

[ .np-summary disclosure, collapsed by default, chevron + count: ]
  "3 mulige overlapp med øvingsgrupper ▸"
  → expands to:
  "TDT4100 øving kan overlappe TFE4146 lab · tirsdag 12:15–14:00 · uke 36–40
   — vi kan ikke skille grupper her; sjekk hvilken gruppe du får i Studentweb."
```

Collapsed-by-default is deliberate: hard clashes are always-visible because
they are the actionable verdict; soft overlaps are demoted to opt-in so the
count of "3 mulige overlapp" reads as informational texture, not alarm — it
never competes visually with red ink. If there are zero hard clashes and one
or more soft ones, the collapsed line still shows (don't let "no red ink"
read as "definitely fine" when there's a real caveat available).

### 2.3 Empty-slate honesty: the pre-publish primary mode (DR-2)

When `timetablePublished` is false for the chosen semester (true for most of
the elective-planning window per DR-2), the UKEPLAN block does not render
blank-with-a-spinner. It renders a **calm alternate state**, because this is
the primary mode, not a fallback:

```
UKEPLAN (np-kicker)
┌ .np-frame.np-ruled (ruling still present — this is still a planning surface) ┐
│  Timeplanen for Høst 2026 er ikke publisert ennå (np-note).                  │
│  Forventet: uke [n], per historikk. (np-data, if a prior year exists)        │
│                                                                                │
│  Det vi kan sjekke nå: eksamensdatoer og pensumbelastning — se ned. (np-note)│
│  [ toggle, off by default: "Vis timeplan fra Høst 2025 (forrige år)" ]       │
│    → renders last published year's grid, entirely in --muted tone,          │
│      every block carries "ikke gyldig for dette semesteret" as a fixed      │
│      corner label, never in course hue, never clash-checked against red ink │
└────────────────────────────────────────────────────────────────────────────┘
```

The clash engine itself **degrades in lockstep** (DR-2): with no real grid,
"conflict" collapses to what's still knowable — **exam-date collisions**
(§3 below) and **campus-spread** (a mono note: "TDT4100 (Gløshaugen) og
TFE4146 (Kalvskinnet) samme dag — sjekk reisetid" — ink, never red, this is
a logistics note not a coexistence failure). This keeps the pre-publish mode
a genuine decision surface instead of an apology.

### 2.4 Provenance line (DR-8) — always present, always at the bottom of the spread

```
(np-note, small, bottom of the .np-frame, every render)
"Timeplan sist hentet 22. jul · [n] emner uten fastsatt gruppe/rom vises umerket"
```

The second clause only appears when `unclassified` entries exist in the
current plan — it's the concrete admission that the keyword classifier
missed something, tied to DR-1's open question (classifier precision on
non-English names) rather than hidden behind a generic disclaimer.

---

## 3. Screen: `/planlegger/` — EKSAMENER ribbon (the exam timeline as a decision surface)

This is where PRODUCT-v2's "spread, gaps, kont" requirement lives, and where
DR-3 (catalog-sourced ribbon, never scraped-text dates) and DR-9 (deadline
awareness) surface.

### 3.1 Layout

```
EKSAMENER (np-kicker) ─ 25. nov – 18. des (np-data)
┌ .np-frame.np-ruled — horizontal date axis ────────────────────────────────┐
│  NOV                              DES                                     │
│  25   28   1    4    7   10  13  16   18                                  │
│  ▪            ▪▪(red ring)      ▪        ▪(muted, "?" badge)             │
│  TDT4100      TMA4100                TFE4146                              │
│              IT2805  ← same date, stacked, red ring + red-ink note        │
└─────────────────────────────────────────────────────────────────────────┘
[ .np-note-clash: "TMA4100 og IT2805 har eksamen samme dag · 1. des" ]
[ list, one row per exam, sorted by date: ]
  25. nov — ▪TDT4100 — skriftlig skoleeksamen — "9 dager til neste"
  1. des  — ▪TMA4100 — skriftlig skoleeksamen — SAMME DAG som IT2805 (red)
  1. des  — ▪IT2805  — hjemmeeksamen (levering) — SAMME DAG som TMA4100 (red)
  4. des  — ▪—       — (gap, no entry, rendered as thin dead space, no label)
  16. des — ▪TFE4146 — dato ikke satt — "eksamensform: skriftlig skoleeksamen"
```

### 3.2 Data source discipline (DR-3, binding)

The ribbon's date axis and every dot position is driven **exclusively** by
catalog `ExamDate.date` (structured, already in the search index per
PLANNER.md §4 — instant, no per-course fetch needed for the axis itself).
Scraped `CourseExam` (from `/api/course/:code`) is fetched in parallel and
used **only** to enrich the popover/list-row detail (form, duration,
aid code) once available — **never** to compute the date or gap math. If
`CourseExam.date` is null but `dateText` carries prose ("Utlevering
07.11.2025"), that prose is shown verbatim in the row's detail, never
re-parsed into a second candidate date (p9 §8's rule, restated as a hard
constraint here because the exam ribbon is exactly where the temptation to
re-parse "helpfully" would show up).

**Continuation (kont) filtering is unconditional and silent-by-default**:
`ExamDate` / `CourseExam` rows with `continuation: true` never appear on the
main ribbon or in the gap math, full stop — a kont exam is next semester's
August window for a course taught the semester before, and mixing it into
"how spread is my December" is a wrong answer, not a judgment call. Kont
rows are reachable only via an explicit, collapsed disclosure per course
(§3.5 below) — a student who specifically needs kont goes looking for it;
the tool doesn't guess who that is.

**Multi-part assessment collapsing:** `CourseExam` rows sharing a course
code + `continuation: false` where `weighting` indicates a multi-part scheme
(e.g. "2/3" + "1/3") collapse into **one** ribbon dot per distinct date —
if both parts share a date, one dot; if they land on different dates, two
dots, both under the same course hue, connected by a thin ink tie-line in
the list view with the label "del 1/2" / "del 2/2," never treated as two
independent exams for gap or clash purposes (they cannot clash with
themselves).

### 3.3 Dateless state (DR-3's "dato ikke satt" bucket)

An exam with no structured date renders as a **muted dot at the right edge
of the ribbon**, outside the date axis proper, in a fixed "dato ikke satt"
lane rather than silently omitted — p9's point that a dateless home-exam
still consumes real semester time. List-row detail carries whatever
`dateText`/`form` prose exists, verbatim, plus one clause: **"dato
publiseres normalt [n] uker før" (if historical pattern is knowable from
prior years' `publishedYears`) or, if not, just "ikke publisert ennå."**
This dot never participates in gap-annotation math ("2 dager til neste") —
gaps are only computed between dated exams.

### 3.4 Gap annotation — the actual decision surface

Per PRODUCT-v2 "spread" and "gaps": every dated, non-kont, list row carries
a trailing mono clause computed against the *next* dated exam chronologically
(across the whole plan, not per-course):

- `≥ 3` days to next → **"X dager til neste"** (ink, neutral, no verdict — 3+
  days is fine and the copy doesn't editorialize about it)
- `1–2` days to next, different course → **"tett: X dag(er) til neste"**
  (ink, `.np-note`, not red — tight but not impossible, this is the one
  place PLANNER.md's "1-day gap ⇒ tett warning" survives verbatim)
- `0` days (same date) → the hard clash case, red ink, `.np-note-clash`,
  already shown in §3.1

This is the "exam timeline as a decision surface" requirement made concrete:
a student scanning the list top to bottom reads their whole exam period's
shape in one pass — where it's fine, where it's tight, where it's broken —
without having to do the date math themselves.

### 3.5 Kont disclosure (opt-in, per course)

```
[ row detail, collapsed .np-summary per course with a kont record: ]
  "Kontinuasjonseksamen (august) ▸"
  → expands: "Kont: [date or 'dato ikke satt'] · teller ikke i planen din for
     dette semesteret · gjelder om du stryker/trekker deg fra ordinær"
```

Never on the main ribbon, never contributing to gap math, exactly as DR-3
specifies. This satisfies "kont" from the brief's flow list without
polluting the primary decision surface — it's a fact a student looks up,
not one pushed at them.

### 3.6 Provenance line (DR-8)

```
(np-note, bottom of the EKSAMENER frame, always present)
"Eksamensdatoer fra emnekatalogen · [n] eksamener uten fastsatt dato ·
 sist oppdatert med katalogen"
```

---

## 4. Screen: clash preview *before* add (the "discovery" moment, everywhere)

PRODUCT-v2 §6 MUST: "plan-aware clash preview before add — the verb,
everywhere." This is the actual discovery moment for most users (they don't
watch the ribbon build course-by-course; they hit "legg til" from `/emner/`,
`/emne/[code]`, or a choice-group row and need the answer *before* the click
commits).

### 4.1 Component contract (one component, multiple mounts)

Renders inline, directly under/beside the add control, computed against the
**committed** tier of the current plan (shortlist candidates don't gate
each other's preview — only committed courses are "what you've already
decided," per PRODUCT-v2 §3.2's decide-loop framing):

```
[ /emner/ search row, before add ]
  ▪TDT4256  Fjernstyrte systemer  7,5 sp  Gløshaugen
  ⚠ kolliderer med TDT4100 · mandag 10:15–12:00     ← red ink, .np-note-clash
  [ + legg til ]  ← button still enabled; preview informs, never blocks

[ /emner/ search row, soft-overlap case ]
  ▪TFE4146  Sensorer  7,5 sp  Kalvskinnet
  kan overlappe TDT4100 øving · vi skiller ikke grupper   ← ink, .np-note
  [ + legg til ]

[ /emner/ search row, exam-only signal (pre-publish mode, DR-2) ]
  ▪IT2805  Sikker programvare  7,5 sp  Gløshaugen
  eksamen 1. des · samme dag som TMA4100 i planen din      ← red ink
  [ + legg til ]

[ /emner/ search row, clean case — no note at all, not even a green one ]
  ▪TMA4245  Statistikk  7,5 sp  Gløshaugen
  [ + legg til ]
```

**Deliberate non-decision, stated explicitly:** a clean course gets **no**
positive confirmation line ("passer fint!" or similar). Green is reserved
for the credit total hitting 30 sp and the "I planen" membership state per
DESIGN.md's Green-Means-Fits rule — sprinkling green/checkmarks on every
non-colliding search row would dilute the one signal that's supposed to
mean something. Silence *is* the "fits" signal at the row level.

**Never blocking:** the add button is never disabled by a clash. This is a
"thinking tool upstream of Studentweb," not a gatekeeper — the real
authority is Studentweb, and a soft-overlap course might genuinely be the
right pick once a group assignment is known. The preview informs the click,
it doesn't prevent it.

### 4.2 On `/emne/[code]` — the fork-point framing (PRODUCT-v2 §3.4)

Per PRODUCT-v2, the course page's primary CTA is **"Vil dette kollidere for
deg? Legg til og se."** — the clash preview here is elevated from a
secondary row note to the actual hook of the page:

```
[ /emne/[code], above the fold, replacing prose-first layout ]
TDT4256 (np-kicker)
Fjernstyrte systemer (headline)
7,5 sp · Gløshaugen · Høst (np-data)

┌ .np-panel ─────────────────────────────────────────────────┐
│ Vil dette kollidere for deg?                                 │
│                                                                │
│ [ if plan non-empty: ]                                        │
│   ⚠ kolliderer med TDT4100 · mandag 10:15–12:00 · uke 35–41  │
│   (red ink if hard, ink if soft, silence if clean —           │
│    same three-state contract as §4.1)                         │
│   [ Legg til og se i ukeplanen → ]  → /planlegger/#...        │
│                                                                │
│ [ if plan empty: ]                                            │
│   "Legg til i en tom plan for å se om dette passer med        │
│    resten av semesteret ditt."                                │
│   [ Legg til i planen ]                                       │
└───────────────────────────────────────────────────────────┘

[ below fold: exam block — season-split date, form, gap-to-nearest-plan-exam
  if plan non-empty, else just the catalog date; grade shape in decision
  context per §6's differentiation note; prose (description, learning
  outcomes) demoted below all of this ]
```

The "Legg til og se" click routes to `/planlegger/` with the course already
committed via hash update (not shortlist — a direct course-page add is a
decision, not a maybe, consistent with §2's elective-loop shortlist being
the *only* place "considering" lives) and the page arrives with
`np-target-flash` on the new block so the "see" half of "add and see" is
literal, not a promise.

---

## 5. Screen: elective decide-loop's inline clash fact (DR-5-safe)

This is the conflict/exam surface *inside* PRODUCT-v2's co-primary flow 2,
scoped narrowly here to the clash/exam-facing half (the swap-delta sentence
and shortlist mechanics belong to the elective-flow blueprint proper; this
file only specifies the clash-fact cell since it's this file's engine).

```
[ choice-group row on /studier/[code], one row per course in the group ]
▪TDT4258  Lys og sensorer  7,5 sp
kolliderer med planen din · mandag 10:15–12:00 (TDT4100)     ← red ink
prosjekt · karakterfordeling: bred spredning                 ← ink, two facts
[ + vurder ]  (shortlist tier — not "legg til")

▪TDT4200  Parallelle beregninger  7,5 sp
(no clash line — clean against committed courses)
skoleeksamen · karakterfordeling: mot A/B                    ← ink, two facts
[ + vurder ]
```

Same three-state contract as §4.1 (red / muted ink / silence), same
never-blocking rule. The row **never** asserts the choice group itself is
satisfied (DR-5 — no min/max data exists) — this component only ever speaks
about the single row's clash-and-fact state, never about group completeness.

---

## 6. Screen: temporal margin banner intersecting the clash surface (DR-9)

Not a separate screen — a fixed element above UKEPLAN, specified here
because it's the deadline-awareness requirement and it must be visible in
the same glance as the clash surface it's giving urgency to:

```
┌ .np-panel, top of /planlegger/, below the semester toggle ─────────┐
│ Oppmelding for Høst 2026 stenger ~15. sep · 24 dager igjen (np-data)│
└──────────────────────────────────────────────────────────────────┘
```

**Behavior across the DR-9 seam:** driven by `semesters.json`'s
`phase`/`fromDate`/`toDate`/`examLastDate`/`timetablePublished`, never an
implicit "current semester" default. Three states:

1. **Before the deadline for the chosen semester** — the banner above,
   counting down. Days-remaining recomputed client-side from a fixed date,
   not re-fetched.
2. **Deadline passed for the chosen semester, next term not yet open** —
   banner reads: **"Oppmelding for Høst 2026 er stengt. Planlegger du Vår
   2027? Bytt semester ovenfor."** — ink, not red (a missed window isn't a
   clash, it's information), with the semester toggle visually cued
   (`np-target-flash` once, on banner render, not looping).
3. **Deep pre-publish, both clash types degraded (DR-2 active)** — banner
   gains a second line: **"Timeplan ikke publisert — eksamensdatoer og
   kollisjonssjekk basert på pensum og eksamen inntil videre."** — ties the
   deadline urgency directly to *why* the clash surface below looks the way
   it does (§2.3), so the degraded mode never reads as broken, only as
   early.

This is the one place in the file where "deadline awareness surfacing" and
"conflict resolution" touch directly: the banner is what explains *why* the
student should care about resolving a red mark now rather than later, and
*why* the grid might be quiet on facts today.

---

## 7. Resolution: what alternatives are offered when a clash is found

PRODUCT-v2 killed the substitution engines (D2) — there is no "here are 3
courses that fix this" recommender; the data doesn't support ranking
alternatives (no seat data, no structured "equivalent course" relation).
Resolution is **navigational, not generative**:

- **From a hard clash's margin note** (§2.2): click scrolls + flashes both
  colliding blocks — the resolution UI *is* seeing both courses side by
  side on the grid, at which point the student's own judgment (which one
  matters more) is the actual resolution mechanism. No auto-suggestion.
- **From the elective decide-loop** (§5): the clash fact sits in the same
  row as the alternatives that already exist by construction — the whole
  choice group is the candidate set. Dropping the clashing course and
  promoting a clean one from the same group *is* the resolution, and
  PRODUCT-v2's swap-delta sentence (owned by the elective-flow blueprint,
  not this file) narrates that specific transition in plain language.
- **From a soft overlap** (§2.2, §4.1): resolution is explicitly deferred
  to Studentweb — the copy says so ("velg en gruppe som ikke overlapper"),
  because group assignment isn't decided here and pretending otherwise
  would be exactly the confidently-wrong answer DR-1 exists to prevent.
- **No clash found**: nothing to resolve — silence, per §4.1.

**What is deliberately never offered:** a ranked "alternatives" list, a
"courses like this one" widget, or an automatic swap suggestion. All three
would require either seat/capacity data (don't have it) or a structured
equivalence/substitutability relation (don't have it) — building any of
them would mean fabricating a signal, which §9's non-goals forbid outright.

---

## 8. State transitions (how these screens connect)

```
/emner/ row preview  ──┐
/emne/[code] fork CTA ─┼─→ add (hash + localStorage write) ─→ /planlegger/
choice-group row ──────┘        (committed or shortlist tier)      │
                                                                     ▼
                                          UKEPLAN renders new block,
                                          np-target-flash on arrival,
                                          hard/soft clash recomputed
                                          against the whole committed set
                                                                     │
                                                                     ▼
                                          EKSAMENER re-sorts, gap math
                                          recomputed, kont still hidden
                                                                     │
                                          margin note / list row click
                                          scrolls + flashes the pair ─┘
                                          (resolution = comparison, not
                                          generation — §7)
```

One engine pass (§1's `Clash[]`) feeds both UKEPLAN and every clash-preview
mount point — computed once per plan-state change, memoized, never
recomputed per-row independently (keeps the "same course, same verdict
everywhere" guarantee that makes the three-state contract in §4.1 trustworthy
across pages).

---

## 9. What this file deliberately does not specify

- The swap-delta sentence's exact copy generator and the shortlist-tier
  promote/drop mechanics — owned by the elective-decide-loop blueprint;
  this file only specifies the clash-fact cell that sentence reacts to.
- The shared-plan merge/replace/keep interstitial — owned by the
  shared-plan-handoff blueprint; this file's engine is what re-runs once a
  merged plan lands, nothing more.
- Visual token values, exact CSS — DESIGN.md is law, not restated.
- The lecture/exercise keyword table itself — an implementation detail
  behind the `ClassifiedEntry` contract in §1; PRODUCT-v2 §13 already flags
  its precision as a kept-open question with a benign failure mode (degrades
  to a muted flag, never a false hard clash), which this file's two-tier
  system is built to make true by construction.

---

## 10. Key decisions, restated compactly

1. **Two-tier clash, not one.** Red ink only for lecture-vs-lecture hard
   overlaps; everything else is a muted "kan overlappe" flag with an
   explicit reason clause. This is how DR-1's unbuildable-clustering
   decision stays honest instead of becoming silent noise or silent hiding.
2. **Same-course parallel sections never flag against each other** — a
   cheap, always-correct filter that removes the worst false-signal case
   (p9 §1) without needing group clustering.
3. **Exam ribbon's axis is catalog-only** (DR-3); scraped exam data is
   enrichment, never a second date source. Kont is unconditionally excluded
   from the primary ribbon and gap math, reachable only via per-course
   opt-in disclosure.
4. **Gap annotation is the exam timeline's actual decision content** —
   every dated exam carries a computed "X dager til neste" / "tett" /
   same-day clause; this is what makes the ribbon a decision surface
   instead of a calendar sticker sheet.
5. **Clash preview is one component, several mounts, one shared engine
   pass** — same verdict, same copy contract, everywhere a course can be
   added, never blocking the add.
6. **No positive confirmation on clean rows.** Silence means "fits." Green
   stays reserved for credits-at-30 and membership state per DESIGN.md.
7. **Pre-publish is not a blank state** (DR-2) — the UKEPLAN frame stays
   present with a labeled non-authoritative prior-year toggle, and the
   clash engine degrades to exam-date + campus-spread, narrated by the
   temporal banner so the degradation reads as "early," not "broken."
8. **Resolution is navigational, never generative** — no alternatives
   engine, no ranked substitutes; seeing both colliding courses together
   (grid scroll+flash, or the choice-group's own candidate set) is the
   entire resolution mechanism, matching what the data actually supports.
9. **Deadline banner sits directly above the clash surface it motivates**,
   with a third state that explicitly ties pre-publish degradation to the
   calendar reason for it (DR-9).
10. **Provenance line on both spreads, always rendered**, not a fallback —
    the last-crawled date and the count of unclassified/dateless entries
    are load-bearing copy, not a footnote (DR-8).
