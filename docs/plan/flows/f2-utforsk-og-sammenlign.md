# F2 — Utforsk og sammenlign (elective exploration + comparison)

UX blueprint for the differentiating core of Semesterplan: how a student holds several
elective candidates against a committed plan, previews them on the grid, weighs them on the
few facts that decide, and narrows to a valid ~30 sp — the *what-if loop*.

**Authority.** Based strictly on `PRODUCT-v2.md`; where PLANNER.md or the p8 interaction-designer
perspective differ, **v2 wins**. The two biggest v2 overrides this flow enforces against p8's
draft:

1. **No compare *matrix / tray / table*.** v2 D2 cut it. p8's "compare tray" (§5) becomes
   **inline decision-cell facts + one plain-language swap-delta sentence** — that sentence *is*
   the product. This blueprint reshapes the comparison, it does not build a spreadsheet.
2. **No parallel `candidates[]` array; no substitution engine.** v2 §7 stores one `courses[]`
   with a `tier: "committed" | "shortlist"` field and a first-class `version`. p8's §4b
   "suggest substitutes / vis alternativer" auto-suggestion engine is **cut** (D2); the
   resolution affordance degrades to "show the freed slot + open the add field pre-filtered" —
   no auto-picked siblings, because DR-5 forbids the app asserting a group is satisfiable.

What survives from p8 (v2 kept it): the **two-tier committed/shortlist model**, the
**click-to-promote gesture**, **hover-preview-on-grid**, tier-typed conflicts, mobile
day-agenda, progressive disclosure. This flow specifies those against v2's state shape and rules.

---

## 0. Where this flow lives, and where it starts

The what-if loop runs **on `/planlegger/`** — the one page that shows the grid, the credit meter,
the exam ribbon, and the plan strip together. Candidates enter it from three doors:

- **A. From a study plan** (`/studier/[code]/`, persona B/master) — the highest-value door.
  A `velg 2 av 5` choice group is bulk-added *as shortlist* ("legg gruppen til vurdering"),
  landing the student on `/planlegger/` with 5 pencil candidates against a committed core.
- **B. From free search** (`/emner/` inline, or the planner's own add field, persona master's
  "foraged wildcards") — one course at a time, added as shortlist.
- **C. From a single course page** (`/emne/[code]/` fork point) — "legg til og se" adds as
  shortlist and deep-links to the planner scrolled to that course's first block.

The committed set is assumed to already hold the obligatory courses (they arrived via F1 /
the study-plan pre-fill). **This flow is about the elective slots only** — the 1–3 open
positions where the real planning pain lives.

**Temporal frame is always on screen** (DR-9): the planner's margin banner
(*"Oppmelding for Høst 2026 stenger ~15. sep · 24 dager igjen"*) sits above everything below,
because this whole loop is "decide before the deadline." During most of the elective window
**timetables are unpublished** (DR-2) — so this flow is specified **pre-publish-first**; the
grid-dependent steps degrade gracefully and say so, they do not go blank.

---

## 1. The core model the student manipulates

Two tiers, one plan, expressed in `PlanState.courses[].tier` (v2 §7):

| Tier | Meaning | On the grid | Credits | Exam ribbon | In the hash |
| --- | --- | --- | --- | --- | --- |
| **committed** | "jeg tar dette" | full hue, solid block | counts toward `X av 30 sp` | solid course-hue dot | segment 3 |
| **shortlist** | "jeg vurderer dette" | ghost: hue *outline*, ~40% ink, no fill | **excluded** from the 30-sp total; shown in a quieter `+ N sp under vurdering` | hollow/ringed dot | segment 4 |

Three depths of certainty, three visual weights (kept from p8 §2):

```
preview (dashed outline, transient — hover)
   → shortlist (ghost, persistent — one click / one tap)
      → committed (ink, persistent — promote)
```

**Vocabulary (bokmål, sentence case, consistent verbs):**

- Add to shortlist: **"Legg til vurdering"** → row state **"Til vurdering · Fjern"**.
- Add straight to committed (student already sure): **"Legg rett i planen"** → **"I planen · Fjern"**.
- Promote shortlist→committed: **"Ta inn i planen"**.
- Demote committed→shortlist: **"Flytt til vurdering"**.
- Remove entirely: explicit **"Fjern"** / **×** — never a gesture (p8 §7; swipe-delete is a footgun on a planning artifact).
- Clash copy stays **"kolliderer med"** (committed↔committed) vs. **"ville kollidert med"** (hypothetical, involving a candidate).

**The promotion gesture is the heart of the loop.** One click on a ghost block, or on its list
row's primary area, toggles `tier`. The block inks in (40%→100% fill over `--dur`, hue dot squares
up), the credit meter rolls up (tabular-nums, no bounce), and any of its conflicts *harden* from
hypothetical outline to full red hatch. One click back demotes. This is direct manipulation of a
**status**, not of time — NTNU sets the times, so drag is wrong here (p8 §7); click is the honest
gesture and it keeps keyboard parity.

**Why shortlist is unbounded but the plan is not** (p8 §3): a student weighing 4 electives for 2
slots carries 60 sp of candidates against a 30 sp plan. The shortlist has **no credit ceiling**
and, by default, **shows no red among its own members** — two candidates that clash *with each
other* is fine, you'll pick one; drawing that clash is noise. A muted toggle **"vis kollisjoner
mellom kandidater"** turns it on for the student genuinely trying to fit two candidates together
(e.g. an over-normert semester).

---

## 2. Screen: `/planlegger/` in exploration mode — the anatomy

Stacked editorial sections in the wide column (per PLANNER.md §2), extended for two tiers. Reading
top → bottom:

```
[ margin banner ]  Oppmelding for Høst 2026 stenger ~15. sep · 24 dager igjen      (DR-9)

PLANLEGGER                                          [HØST 2026][VÅR 2027]  ← .np-toggle
Semesterplanen din                    22,5 av 30 sp   ·  + 15 sp under vurdering
                                      (.np-data, accent)    (.np-data, --muted, quieter)

┌ kurv (.np-panel) ───────────────────────────────────────────────────────────────┐
│ I PLANEN                                                                          │
│ [▪TDT4100 ×] [▪TMA4100 ×] [▪TFE4146 ×]                                            │
│ TIL VURDERING  (pencil dot ◇)                                                     │
│ [◇TTM4100 ⇄ ↑] [◇IT2805 ⇄ ↑] [◇TDT4145 ⇄ ↑] [◇TFY4125 ⇄ ↑]   [ + legg til ]      │
│ Fra MTDT, kull 2024 · valgemner, 7. semester            (np-note, program context)│
│ "Velg 2 av 5 fra teknologiledelse-gruppen"   ← verbatim group prose (DR-5)        │
└──────────────────────────────────────────────────────────────────────────────────┘

UKEPLAN  ─ uke 34–47              [ pre-publish state, or grid ]        (provenance line)
[ .np-frame.np-ruled : committed = solid hue blocks; shortlist = ghost outline blocks;
  hypothetical clashes = red outline on the affected committed block ]
[ margin notes: committed↔committed = red-ink correction; committed↔candidate = grey consequence ]

EKSAMENER  ─ 25. nov – 18. des                                         (provenance line)
[ ribbon: solid dots = committed exams, hollow dots = shortlist exams; same-day → red ring ]

BESLUTNING  (decide-loop — only present when a choice group or ≥2 shortlist courses exist)
[ per-candidate decision rows with inline facts + swap-delta sentence — §4 ]

EMNER  [ committed rows, then a divider, then shortlist rows ]
```

Two credit figures live in the header, always (p8 §3, DR-6):
`22,5 av 30 sp` (accent, committed, green at exactly 30) **·** `+ 15 sp under vurdering` (muted).
Null-hole aware: `22,5 av 30 sp (+2 emner uten oppgitt sp)`. Off-semester shortlist courses are
excluded from *both* figures (DR-10) and carry a `notices[]` line instead.

---

## 3. Adding candidates and hover-preview-on-grid (desktop)

**The invert:** today "add" is a blind write — you add, then look. Wherever the grid is visible,
we let the student *look while still asking* (p8 §2). Two sub-flows:

### 3a. From the planner's add field (door B)
1. Focus the **"+ legg til"** field → live `.np-field` dropdown of search results (search-index,
   instant), each row: `▪code  name · sp · campus · eksamensform`.
2. **Hover / arrow-key-focus a result** → the course's blocks **preview-render on the grid as
   ghosts immediately** — dashed hue outline, no fill, in a **reserved grid region so the layout
   never jumps**. If a preview block would overlap a committed block, the affected *committed*
   block lights with a **red outline** (not the full hatch — this is hypothetical), and a
   transient margin line reads *"ville kollidert med TDT4100 · man 10:15"*.
3. **Prefetch on hover-intent** (150ms dwell) fires the `/api/course/:code/timetable?version=`
   fetch (version threaded, DR-4). Until it resolves, the reserved region shows the dashed
   skeleton + mono *"henter timeplan …"* — no layout shift.
4. **Enter / click** → commits to **shortlist**; the dashed preview solidifies into a persistent
   ghost. A secondary affordance on the same row — **"Legg rett i planen"** — jumps straight to
   committed for the sure case.

### 3b. From a study-plan choice group (door A — the master's real entry)
The single highest-value add path. On `/studier/[code]/`, a choice group (`PlanCourseGroup`)
renders its verbatim prose (DR-5, e.g. *"Velg 2 av 5"*) and a group-level action
**"Legg gruppen til vurdering"**. One click bulk-adds all 5 courses as **shortlist** and routes
to `/planlegger/`, scrolled to the new candidates, `np-target-flash`ed. This is p2's "bring the
whole comparison set in one action, not five individual adds." The group's prose is carried into
the planner's kurv panel as the quoted line (§2) so the student never loses *"velg 2 av 5"* —
**but the app never asserts the group is satisfied** (DR-5); it only tallies credits and shows the
quote.

### Preview data budget
Preview needs the candidate's timetable + exam dates. Exam dates are already in the search index
(instant, DR-3 catalog-sourced). Timetable is the one fetch, prefetched on hover-intent. During
**pre-publish** (DR-2), `timetable()` is `[]` — so there is *no grid preview*; hover instead
previews **exam-clash + campus-spread**: the exam ribbon shows a hollow ghost dot at the
candidate's exam date (red ring if it lands on a committed exam), and a margin line reads
*"samme dag som TMA4100-eksamen · 5. des"*. The preview affordance never dead-ends into blank.

---

## 4. The decide section — inline facts, not a matrix

This is where v2 most sharply overrides p8. A twice-a-year student choosing 2 of 5 decides on
**1–2 facts**, not a 6-row spreadsheet. So instead of a compare tray, the **BESLUTNING** section
renders one **decision row per shortlist candidate**, each carrying the few facts that decide,
inline, in the decision context (v2 D12: grade stats live *only* here):

```
BESLUTNING — Velg 2 av 5 · teknologiledelse           "velg 2 av 5" (verbatim, DR-5)

◇ TTM4100  Kommunikasjon – tjenester og nett          7,5 sp
   man 10:15–12:00 · tor 14:15–16:00      ← møtetider (mono)
   Eksamen 8. des · skriftlig skoleeksamen · 4 t       (catalog ExamDate + scraped form, DR-3)
   ✓ kolliderer ikke med planen din                    ← the verdict, ink (green check)
   Karaktersnitt siste 3 år: C · ~9 % stryk            ← grade SHAPE, not a score (§5, DR-8/DR-12)
   [ Ta inn i planen ]                                  ← promote

◇ IT2805  Webteknologi                                7,5 sp
   tir 12:15–14:00 · fre 08:15–10:00
   Eksamen 12. des · mappevurdering · ingen sluttdato   (dateless → "dato ikke satt", DR-3)
   ⚠ ville kollidert med TDT4100 · man 10:15            ← red, the only red in this section
   Karaktersnitt siste 3 år: B · ~4 % stryk
   [ Ta inn i planen ]

  Provenance: Timeplan sist hentet 22. jul · eksamensdato fra emnekatalogen   (DR-8)
```

**Dimensions shown (all from data we actually have):**

1. **Møtetider** — condensed from the timetable (lecture entries only, DR-1). *Pre-publish:*
   replaced by *"timeplan ikke publisert ennå"*, not omitted.
2. **Eksamen** — date + form + duration, catalog-sourced date (DR-3) + scraped form for the popover.
   Dateless → *"dato ikke satt"*.
3. **Kolliderer med planen din** — the verdict, computed against the *committed* set (lecture-only
   hard conflicts, DR-1). ✓ green ink when clear, ⚠ red when it would clash. **This is the only
   place red appears in the decide section.**
4. **Karaktersnitt / strykprosent (shape)** — see §5; responsible rendering only.
5. **sp** — credits, null-aware.

**What we deliberately do NOT render:** a difficulty score, a workload count, a
recommendation, a "best 2 of 5" auto-pick, a sortable ranking. v2 §9 forbids all fabricated
signals; DR-5 forbids the group-satisfied assertion. The row informs; the student decides.

### The swap-delta sentence — *this is the product* (v2 D2)
The moment that differentiates Semesterplan from five open `/emne/` tabs: **on hovering the
"Ta inn i planen" button of a candidate, the planner computes and shows one plain-language
sentence describing what promoting it changes** — before the click:

> **"Tar du inn IT2805: fjerner ingen kollisjon, men legger til 1 (mot TDT4100), og sprer
> eksamen fra 4 til 5 dager. 30 av 30 sp."**

> **"Tar du inn TTM4100: ingen ny kollisjon, eksamen fortsatt spredt over 5 dager, 30 av 30 sp —
> full plan."**

The sentence is assembled from three deltas we can compute honestly: **collision count change**,
**exam-cluster spread change** (min gap between exam dates), **credit total after**. No fiction.
It answers *"hva bytter jeg?"* in the student's own terms, which the p8 comparison matrix answered
in a table the student then had to read across. One sentence beats one spreadsheet for a
1–2-fact decision. On commit, the sentence's prediction becomes the new reality (the grid hardens,
the meter rolls), closing the loop visibly.

**Progressive disclosure** (p8 §6): the BESLUTNING section is **absent** until either a study-plan
choice group is present *or* ≥2 shortlist courses exist. It never greets an empty or single-course
plan. First time it appears, a one-time mono note (localStorage flag, shown once):
*"Kandidater vises som blyant — sammenlign her, klikk for å ta dem inn i planen."*

---

## 5. Grade stats, responsibly (DR-8, DR-12, p4 discipline)

Grades appear **only in the decision cell** — never as browsable course-page decoration, never as
a sortable column, never hue-tinted (DESIGN §8; a grade is not a course-identity hue and red is
reserved for collisions). What we render, and the rules:

- **Season-split shape, not a single number out of context.** The DBH distribution is A–F (or
  pass/fail). We derive **two honest facts**: a **central tendency** ("Karaktersnitt siste 3 år:
  C") and a **fail signal** ("~9 % stryk"), each trend-aware across the last ~3 years, split by
  season where the data supports it. No composite score, no leaderboard, no cross-course ranking
  (v2 §9).
- **Join is bare-prefix aggregation across versions** (DR-4/§7): `GradeRow.courseCode` is suffixed
  (`"TTM4100-1"`), a different string space than the bare code; we aggregate all versions under
  the bare prefix, never string-equal on the bare code.
- **GDPR small-count masking is surfaced, not hidden.** When a cohort's `n` is masked/too small,
  the cell reads *"for få kandidater til å vise fordeling"* — a provenance admission, not a blank.
- **Pass/fail courses** render *"bestått/ikke bestått — ingen karakterfordeling"*, never a faked A–F.
- Every decide section carries the **provenance line** (DR-8): last-crawl date, and any
  *"eksamensdato ikke publisert" / "timeplan ikke publisert ennå"*. A grade fact next to a stale-data
  admission is the honest join that is the moat — a confident wrong number would be worse than none.

---

## 6. Conflicts that guide, not just report (tier-typed)

Conflicts are **typed by the tiers involved** (p8 §4a, honored within v2's lecture-only engine DR-1):

- **committed ↔ committed** — the real red-ink correction: full hatch + `underline wavy` on the
  code + margin note *"TDT4100 kolliderer med TMA4100 · man 10:15–12:00 · uke 35–41"* (PLANNER.md
  signature). You told the tool you want both; it can't happen.
- **committed ↔ shortlist** — softer, a *consequence not an error*: the candidate's ghost block
  and the affected committed block take a **red outline** (no hatch), margin note *"IT2805 ville
  kollidert med TDT4100 · man 10:15"*. This shows the **cost of promoting before you promote**.
- **shortlist ↔ shortlist** — hidden by default (mutually exclusive by intent), revealed by the
  *"vis kollisjoner mellom kandidater"* toggle (§1).

**The resolution affordance — reshaped from p8 §4b to fit v2 (substitution engine cut, D2).**
On any *committed↔committed* margin note, a mono action **"vis ledig tid"** does the one thing we
can honestly deliver:

- **Grays the clashing pair to preview-ghost and shows the hole** — the empty ruled cells where a
  replacement could go. Direct: *"her er de 2 timene du får igjen."*
- Then offers **"søk erstatning"**, which opens the add field **pre-filtered** to
  same-credits · taught-this-semester · conflict-free-with-the-rest courses. We have credits,
  teaching semester, and (when published) timetables for every course, so this filter is buildable.
- **We do NOT auto-suggest siblings from the study-plan group.** DR-5 forbids asserting a group is
  satisfiable, and the substitution engine was cut. If the plan has program context, the pre-filter
  can *scope* the search to that group's courses (a filter, not an assertion) — but the student
  picks; the app never says "try TTM4105 instead."

The red ink becomes a fork in the road, and accepting a replacement is the **same promote gesture**
as everywhere else — one interaction vocabulary throughout.

---

## 7. Narrowing to a valid 30 sp — the terminal state

The loop ends when the student has committed a set that reads as *done*. What "done" looks like,
and how the UI signals it **without ever asserting a study-plan rule** (DR-5):

- **Credit meter hits 30** → the `X av 30 sp` figure inks **accent green** (Green-Means-Fits). This
  is the one unambiguous "full load" signal we own. Over-normert is legitimate: promoting past ~32,5
  annotates *"over normert — 37,5 av 30 sp"* in **ink, not red** (overload isn't a collision, p8 §3).
- **Group prose stays a quote, not a checkmark.** Because `PlanCourseGroup` has no cardinality
  (DR-5), the kurv shows the verbatim *"velg 2 av 5"* and a credit tally, and **never** renders
  "✓ gruppe oppfylt." The student reads the quote and their own committed count and concludes; we
  refuse to conclude for them.
- **Commit summary** (v2 MUST): once satisfied, a copyable committed-code list + *"bekreft i
  Studentweb"* — the explicit handoff to the system that actually registers. We are the thinking
  tool *upstream* of Studentweb, and we say so at the exit.
- **Leftover shortlist is fine.** Demoted/unused candidates persist as pencil until the student
  clears them (**"Fjern"**). They ride along in hash segment 4, so a shared link still says
  *"here's my plan, and here's what I was choosing between"* — the exact artifact pasted to an advisor.
- **Share is the exit action too** (v2 growth loop): *"del planen med en lenke — ingen innlogging."*
  The shortlist travels in the link; the recipient sees both tiers and can fork/merge (F6 territory).

---

## 8. The what-if loop, as a state cycle

```
        ┌─────────────────────────────────────────────────────┐
        │                                                     │
   hover a candidate  ──►  preview on grid (dashed) + delta preview
        │                          │
   leave hover ◄──────────────────┘
        │
   click ──► shortlist (pencil ghost, in hash seg 4, no credit)
        │
   read decide row: møtetider · eksamen · kolliderer? · karakter-shape
        │
   hover "Ta inn i planen" ──► swap-delta sentence ("fjerner 0, legger til 1, 30/30 sp")
        │
   promote ──► committed (ink, credit +, conflicts harden, meter rolls)
        │                                    │
        │                              over 30 / new clash?
        │                                    │
   demote ◄──── "Flytt til vurdering" ◄──────┘  (or "vis ledig tid" → søk erstatning)
        │
   credits = 30, green ──► commit summary + "bekreft i Studentweb" + del lenke
```

Every arrow is **reversible and non-destructive** — the student can feel toward a set and back out
of any dead end without losing work. That reversibility is what makes it a *thinking* tool rather
than a form.

---

## 9. Mobile variant (the grid is a viewport problem — p8 §8)

A Mon–Fri × 08–20 grid does not fit a phone; pinch-zoom is misery. Below the breakpoint we change
the representation, not shrink it:

- **Default view is a day-agenda**, not a week-grid: vertical scroll of days, each a mono header
  (*"Mandag"*) with its blocks stacked full-width in time order. Committed = solid, shortlist =
  ghost outline. Collisions render as **overlapping stacked blocks with the red hatch on the
  overlap band** + margin note beneath — which reads *better* than the desktop side-by-side split
  on a narrow screen. A **"uke / dag" `.np-toggle`** flips to a horizontally-scrollable mini
  week-grid for students who want the shape; agenda is the default because it answers "what's my
  Monday" without zooming.
- **No hover, so preview = the first tap.** The two-tier model earns its keep here: **tap a search
  result → it lands as a shortlist candidate** (ghost), grid/agenda scrolls to its first block and
  `np-target-flash`es → **tap "Ta inn i planen" → committed.** First tap is the "preview," second
  is the commit, neither is destructive. The swap-delta sentence appears **on the shortlist row
  itself** (there is no hover), as a muted line the student reads before the promote tap.
- **The decide section is card-per-candidate, stacked** — the §4 decision row is already a card,
  so it transposes cleanly; no table to reflow (and there was never a matrix to transpose — the
  v2 override pays off on mobile). Swipe is not used for delete (footgun); **"Fjern"** is explicit.
- **44px touch targets** on every promote/demote/remove control (v2 MUST, p10). Grid/agenda scroll
  inside their own `overflow-x` container; the **page body never scrolls sideways**.
- Provenance and the temporal banner stay pinned/visible on mobile — the deadline and the
  data-freshness admission are not desktop-only luxuries.

---

## 10. Accessibility & interaction vocabulary (one grammar)

- **Promote/demote = click / tap**, `aria-pressed` on the block and the row toggles committed.
  The workhorse gesture; instant; keyboard-operable (Enter/Space on the focused block).
- **Preview = hover / focus** (desktop only); the ghost is announced to SR as
  *"forhåndsvisning, ikke lagt til"* so it isn't mistaken for a committed block.
- **Remove = explicit "Fjern" / ×** — never a gesture.
- **No drag in v1.** (Reserved, flagged-not-scoped, for choosing among parallel lab groups only
  if that data ever becomes distinguishable — DR-1 says it currently isn't.)
- **Grid blocks are focusable** with a tier-aware `aria-label`:
  *"IT2805, til vurdering, tirsdag 12:15 til 14:00, ville kollidert med TDT4100."*
- **Conflict notes are real links** to their block anchors; clicking scrolls + `np-target-flash`es.
- **SR conflict summary** (v2 SHOULD) reads the committed collisions as a list independent of the
  visual grid, so a non-visual user gets the verdict without the spread.
- The whole loop — add, preview, promote, demote, resolve, commit — is **keyboard-only complete**.

---

## 11. What this flow deliberately excludes (traceable to v2 cuts)

| Excluded | Why | Ref |
| --- | --- | --- |
| Compare matrix / tray / side-by-side table | Twice-a-year user decides on 1–2 facts; the sentence carries it | D2, §9 |
| Auto "best 2 of 5" / "gruppe oppfylt" assertion | `PlanCourseGroup` has no cardinality; free-text only | DR-5 |
| Substitution engine (auto-suggest siblings) | Cut with the matrix; degrades to pre-filtered search | D2, §6 |
| Difficulty / workload / assessment-mix score | Fabricated signal, wrong side of the honesty line | §9, D14 |
| Candidate-candidate clashes by default | Noise; mutually exclusive by intent (opt-in toggle) | p8 §3 |
| Week-scrubber, personal fixed blocks | During-semester concern; breaks shared-URL parity | D14 |
| Grade stats as browsable page decoration | DBH-mirror parasitism; grades only in the decision cell | D12 |
| Confident grid during pre-publish window | `timetable()` is `[]`; degrade to exam-clash + campus-spread, labeled | DR-2 |

---

## 12. Build notes for the flow (order follows v2 §11)

Correctness floor first, because a wrong composite lies:

1. **Version threading (DR-4)** through every preview/promote fetch, and the **frozen `#v2;` hash
   with `tier`** — before shortlist ships, or shared links silently drop candidates (D15).
2. **Lecture-only conflict engine (DR-1)** driving both the hypothetical (candidate) outline and the
   hard (committed) hatch — keyword-classify lectures; øving/lab is a muted, non-clashing label.
3. **Catalog-sourced exam ribbon (DR-3)** so the exam-clash preview and the swap-delta's spread
   figure are structured, never re-parsed prose.
4. **Provenance line (DR-8)** on the decide section and the ribbon — ship it with the facts, not after.
5. **Pre-publish-primary preview (DR-2)** — the exam-clash/campus-spread degrade path is not an edge
   case; it is the mode the elective-window student actually meets.
6. Then: the two-tier store + promote gesture + hover-preview + swap-delta sentence + decide rows.

The swap-delta sentence is the single highest-leverage build in this flow — it is the differentiator
made legible in one line, and it is cheap (three deltas over data we already fetch for the grid).
