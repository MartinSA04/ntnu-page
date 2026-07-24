# PRODUCT-draft.md — Semesterplan: what this site should be

Synthesis of twelve viewpoint analyses (`docs/plan/perspectives/p1…p12`) into one
product definition. This is the input to the next phase. Conflicts between
viewpoints are resolved with reasoning inline, not averaged. Design system
"Ruteark" (DESIGN.md) is assumed law, not re-argued here.

---

## 1. Positioning & the one primary job

**Positioning.** Semesterplan is the *thinking tool upstream of Studentweb* — the
one place a NTNU student assembles a candidate set of courses and finds out,
before the registration deadline, whether that semester actually works:
lectures don't collide, exams aren't stacked, credits reach a full load, and the
electives are chosen deliberately. It is unofficial, free, account-less, and
composes data no official tool composes together (catalog + timetable + exam +
study-plan + grade history as one object).

Every incumbent (p11) owns exactly one column of this problem — description
(ntnu.no/emnesøk), timetable-merge (ntnu.1024.no, 2008-era), reviews (emnr.no),
grade stats (grades.no), or the staff scheduling engine (TP, Feide-gated). None
owns the *row*. Our differentiated position is the join, plus a single
shareable stateful URL with no login — architecturally trivial for us,
architecturally absent everywhere else.

**The one primary job:**

> **"Kan jeg ta disse emnene sammen — og hvis ikke, hva bytter jeg?"**
> Assemble a set of courses for a specific semester and see immediately whether
> it fits (no lecture clashes, sane exam spread, ~30 sp), and when it doesn't,
> resolve it — substitute an elective, not just be told "no".

This is a deliberate sharpening of PLANNER.md's current job ("kan jeg ta disse
emnene sammen?"). The current phrasing describes a **read/verify** tool: assemble
elsewhere, look at the verdict here. The synthesis of p2/p6/p8/p12 is unanimous
that the real pain — electives, choice groups, "velg 2 av 5" — is a
**comparison-and-substitution** problem, not a display problem. The word "hva
bytter jeg?" is load-bearing: it commits the product to helping the student
*decide*, not just *check*. The verb "sammen" keeps the core loop (the merged
week + exam view) as the beating heart.

**Success metric (from p6): "did the student leave sure?"** — a fast, certain
exit to Studentweb, not time-on-site. Design for confident departure.

---

## 2. Personas & their top jobs

Four sharply-drawn personas. Ordered by how much of the product's shape they
determine, not by headcount.

### A. Velgeren — the elective chooser (the product's center of gravity)
*3rd–5th-year program student with 1–2 obligatory + 2 elective slots pulled from
overlapping choice groups. Currently uses ntnu.no + TP + a spreadsheet.*
(p2, p6, p8, p12)

The spreadsheet is the tell: the missing artifact is a **comparison table and a
"considering" state**, not another search page. This persona is a *set-narrowing*
problem — candidates come from two sources (a study-plan choice group "velg 2 av
5", and free-elective wildcards foraged via search) and both need to land in one
working set distinct from the committed plan.

**Top jobs:** (1) pull a choice group into a candidate set wider than the slot
count; (2) compare candidates on schedule-fit-against-*locked*-courses, exam
clustering, grade-history *shape*, assessment mix; (3) provisionally swap a
candidate into the real timetable/exam view without losing the rest of the set;
(4) commit survivors, with a visible reason for each elimination.

### B. Førsteklassingen — the week-1 receiver (the onboarding shape)
*Brand-new student, semester 1, week 1. NTNU already assigned the courses.*
(p1, p6, p9)

Not a chooser — a *decoder*. Turning 5 cryptic codes into "where do I walk in
tomorrow at 10:15." The entire product voice ("Planlegger", "Legg til i planen",
shopping-cart language) assumes an active chooser and misfits this persona.

**Top jobs:** (1) see this week's schedule with rooms/times without assembling it
by hand; (2) translate a course code into a name + one-sentence sense of what it
is; (3) confirm pre-assigned courses match Studentweb (verification, not
planning); (4) find a room fast on a phone; (5) absorb jargon (kull, emnekode,
periode) through consistent pairing, not a glossary. **The gap is specifically
the week-1-of-semester-1 on-ramp**; by semester 2 this persona becomes Velgeren
and the steady-state toolset already fits.

### C. Logistikeren — the constrained-week student (the "is it livable" lens)
*Has a job, a commute, training, or caring duties. Needs the week to be livable,
not just non-colliding.* (p5, p10)

The current planner proves courses don't *collide*; this persona needs it to
prove the week is *livable*. Their questions: which weekdays are free, how *this*
week differs from a typical week (uke 35 vs uke 40), how long/useful the gaps
are, and where the semester's real edges are (incl. the August kont tail). All
derivable from data already fetched — a rendering/computation gap, not a data
gap. This persona also forces the mobile-first floor (p10): the phone is where
"what's my Monday" gets asked.

**Top jobs:** (1) see per-weekday load and free days at a glance; (2) scrub weeks
to spot the atypical ones; (3) know real semester edges; (4) optionally overlay
personal fixed commitments (job/training) as context.

### D. Strategen — grade-aware & kont-planning student (the honest-signals lens)
*Deciding kont-vs-wait, or shopping electives with an eye on difficulty.*
(p3, p4)

Wants grade history and assessment signals to inform choices, and needs kont
(continuation) exams modeled — a real gap today. This persona is where the
product's integrity is tested: the same data that informs can become a toxic
leaderboard. The exchange/international student (p3) is a close cousin here —
same "build from zero, no kull to lean on" posture, but constrained by *language
of instruction, campus, assessment form* rather than grades. Their needs are
filters, not translation.

**Top jobs:** (1) read grade history as a season-split, cohort-sized *trend*, not
a single number; (2) see kont dates and registration deadlines for the plan; (3)
filter/scan by language, campus, assessment form (p3); (4) judge workload from
honest proxies (assessment mix, mandatory-activity count, exam clustering) — never
a fabricated score.

**Deliberately not a persona:** the multi-year degree planner. Multiple
viewpoints (p8, p2 implicitly) reject planning a whole program across years *in
this surface* — it's a different instrument (a longer timeline) and would drown
the one-semester "does this fit" job. The `/studier/[code]/` study-plan page
already carries the multi-year view.

---

## 3. Core flows (screen-level, numbered)

### Flow 1 — First-year on-ramp (Persona B)
1. Land on `/` (from search engine, poster QR, or word of mouth).
2. One prominent path: **"Jeg er ny — start fra programmet mitt"** → a
   name-based program + kull picker (not a code lookup).
3. Pick program by name → pick kull → the picker **pre-fills `/planlegger/`
   directly** with period-1 obligatory courses and sets program context. (This
   collapses the current 4-step path `/studier/[code]` → find kull → find period
   → add one by one into one on-ramp. Resolves p1's core structural gap.)
4. Planner shows this week's grid with rooms/times. If timetables aren't
   published yet, a calm mono state — "timeplan ikke publisert ennå" — with the
   exam window + credit total + program context still shown (p6's *designed*
   pre-publish mode, never an apology).
5. Codes are paired with full names everywhere; a room is legible on a phone.

### Flow 2 — The elective decision loop (Persona A — the core loop)
1. From `/studier/[code]/` a choice group ("velg 2 av 5") → **"Legg alle 5 til
   vurdering"** bulk-pulls the group into the plan as *candidates* (shortlist),
   wider than the slot count.
2. `/planlegger/` renders candidates as **ghost blocks** on the same grid as the
   committed courses — pencil, not ink; they don't count toward "X av 30 sp".
3. **Compare** the candidates on one mono table (times · exam date+form ·
   credits · fail-rate shape · clashes-with-your-plan y/n · taught-this-semester).
4. **Provisional swap:** hover/select a candidate → its blocks preview against
   the *locked* committed set; a red *outline* (not full hatch) shows the
   hypothetical clash cost *before* committing.
5. **Promote** the survivor with one click → ghost inks in, credits tick up.
   **Eliminate** the rest (remove or leave shortlisted with a note).
6. Commit set reaches ~30 sp, no red → exit to Studentweb to register.

### Flow 3 — Free-search add & clash-check (all personas)
1. `/emner/` search (or the planner's own add field) → filter by location,
   language, semester-relevance.
2. Each row shows a **plan-aware preview**: "ville kollidert med TDT4100" or
   "passer inn" *before* the add (p12's single highest-leverage build item —
   the engine already computes this pairwise and cheaply).
3. Quick-add "+" → lands as a candidate (first tap/click) or straight-to-plan.
4. The **plan strip** (see §4) updates sitewide, so the student stays aware of
   credits + collisions while still browsing.

### Flow 4 — Single-course research → fork into planning (highest raw traffic)
1. Land on `/emne/[code]/` directly (search engine — the largest traffic
   source, p7).
2. Read facts, timetable-as-grid (not a flat list — a student must be able to
   eyeball a clash here, p12), season-split grade *shape*, exam occasions.
3. **Plan-context line** if program context is set: "Obligatorisk i MTDT, kull
   2024, 5. semester" (free — data already crawled).
4. **Fork into planning:** "Legg til i planen" *and*, when a grid is
   reconstructable, a plan-aware line "ville lagt til en dag med 2 andre emner /
   ville kollidert med X". A first-visit visitor with an empty plan sees a
   one-time thin line telling them the planner exists (p7's acquisition funnel).

### Flow 5 — Livability check (Persona C)
1. In `/planlegger/`, a **day-load strip**: per-weekday hours/first-last/fill,
   mono, clickable to scroll to that grid column; plus a plain sentence
   ("Fredag er ledig").
2. A **week scrubber** over teaching weeks, defaulting to the modal "typisk uke",
   flagging which specific weeks deviate.
3. One sentence stating real semester edges incl. the August kont tail.
4. Optional: overlay personal fixed-commitment blocks (job/training) from
   localStorage — **excluded from the shareable URL** (personal, not
   plan-defining).

### Flow 6 — Shared-plan handoff (all personas)
1. A friend/advisor pastes a plan URL (`#26h;committed;shortlist`).
2. Recipient lands on `/planlegger/` and hits an **interstitial** before any
   overwrite: "Dette er en delt plan. [Bruk denne] [Behold min egen]" (p7 — fixes
   the current "hash wins unconditionally" silent-clobber bug).

---

## 4. Information architecture / sitemap

Resolved from p7 (the IA lens), reconciled with p1 and p8.

```
/                     Dispatcher, not a hero. Pitch the plan; route to
                      Planlegger or Emner; if plan non-empty, show status line;
                      prominent "start fra programmet mitt" first-year on-ramp.
/planlegger/          THE APP. The only object the site persists. Read + edit
                      the plan: merged week grid, exam ribbon, credits, course
                      list, candidates/shortlist, compare, day-load, week scrub.
/emner/               Find courses (and, merged, programs) to add. Plan-aware
                      quick-add + preview; filters: location, language,
                      assessment form, semester-relevance. URL-encoded state.
/emne/[code]/         Research one course fully; plan-aware (context line +
                      clash preview + fork-to-planner); compare via ?mot=CODE,CODE.
/studier/[code]/      A program's study plan as a plan *template*: periods →
                      groups → courses, obligatoriske + valgfri, retninger,
                      "ditt semester" highlight, per-period + per-group bulk-add.
```

**Nav: two pills — `Planlegger | Emner`.** (p7). `/studier/` as a *standalone
index* is killed: it is a second flat-catalog search page duplicating `/emner/`'s
job, forcing a first-year to pick which catalog their query belongs to before
typing. Program search folds into `/emner/` as a `?type=studier` facet.
`/studier/[code]/` (the study *plan* — genuinely unique content) stays. The plan
is **never** a nav item ("Min plan" as a third pill re-introduces the account-y
"my stuff" pattern this site correctly avoids).

**The plan strip (p7 — the connective tissue).** A slim sticky strip under the
topbar, on all pages, rendering only when the plan is non-empty:

```
▪▪▪▪ 4 emner · 22,5 av 30 sp · 1 kollisjon    [Planlegger →]
```

Built once in the shell (Layout.astro) reading `store.ts`'s `onPlanChange`. This
is what turns "add from anywhere" (already spec'd) into "aware from anywhere"
(currently unspec'd) — a student browsing for a 5th elective finds out mid-browse
that it collides, no round trip. Empty plan → strip absent (no permanent "0
emner" nag), except a **one-time** session-first-load intro line on `/emne/` and
`/emner/` for the search-engine visitor who's never seen the planner pitched.

**URL is the state.** Everything a student built by clicking is recoverable from
the address bar: `#26h;committed;shortlist` for the plan (p8), `?q=&sted=&språk=&type=`
for search (p7), `?mot=` for compare (p7), `?kull=` for cohort (p7 — a query
param, never a `/kull/` path segment). No accounts, no `/sok/`, no
`/sammenlign/`, no `/logg-inn/` (p7 deliberate absences).

---

## 5. Feature list — MoSCoW

Each line names the *student value*, not the mechanism. Features that only mirror
ntnu.no with no decision value are killed at the bottom.

### MUST

| Feature | Why (student value) |
|---|---|
| Merged weekly grid with room/time blocks per course | The core "what's my week" artifact no incumbent composes; the reason førsteklassing and logistiker come at all. |
| Conflict engine **with øving-group clustering** (§6) | Without clustering the red ink lies on every lab-heavy course and the whole trust signal collapses (p9 P0). This is the single highest-priority correctness fix. |
| Exam ribbon + collision/gap analysis, **ordinary-only, kont bucketed out** | Nobody else shows multiple exam dates together, let alone flags clashes (p11); mixing kont in poisons it (p4/p9). |
| Credit total "X av 30 sp" (half-point integer summation) | The "is this a full load" question, every planning session. Float-drift bug is cheap to prevent (p9). |
| Program + kull on-ramp that pre-fills the planner | Collapses the 4-step first-year path into one; the missing on-ramp is the biggest førsteklassing gap (p1). |
| Two-tier plan: **committed + shortlist/candidates** | Lets the chooser hold "considering" separate from "taking" — the artifact the spreadsheet stands in for (p8/p2). See §8 conflict resolution. |
| Plan-aware clash **preview** before add (search rows, course page, study-plan rows) | Answers "if I add this, what happens" *before* committing — highest-leverage build the audit surfaced (p12/p8). |
| Compare view for 2–4 candidates | Where the elective decision is actually made; replaces opening five `/emne/` tabs (p2/p8/p11). |
| Course code **always paired with full name** wherever it appears | Decodes cryptic codes for the week-1 receiver; costs nothing (p1). |
| Season-split grade distribution, cohort-`n` shown, multi-year **trend** default | Autumn sittings are tiny retaker cohorts with volatile F-rates; blending them misleads badly (p4). Inform, never rank. |
| Kont/re-sit exam visibility + Feb 1 / Sep 15 deadline surfaced as computed facts | A real gap today; determines whether a course is completable within a window (p4/p3/p9). |
| Language-of-instruction + campus + assessment-form filters/badges on `/emner/` | The exchange student's three hard constraints, currently only detail-page prose (p3). |
| Plan strip (status, sitewide, non-empty only) | Makes browsing and planning one glance instead of a round trip (p7). |
| Shared-plan interstitial before overwrite | Prevents silently clobbering a student's own saved plan (p7 — real bug). |
| Timetable-as-**grid** on `/emne/[code]/` (not a flat list) | Lets a student eyeball a clash on the research page (p12). |
| Designed pre-publish planner mode | Timetables are unpublished for most of the planning window — the state the tool sits in *most*, not an edge case (p6). |
| Mobile day-agenda (not a shrunk week grid); `--control-h` → 44px on coarse pointers | Mobile is currently unbuilt, not shrunk; "what's my Monday" on a phone (p10/p8). |
| Course `notices[]` (discontinued / subject-to-change) surfaced at add-time | Stops a dead course silently sitting in a basket from an old kull's plan (p9). |
| Version threading through the plan for re-versioned courses | Prevents silently fetching wrong-version timetable data (p9 — needs `version` on `PlanState.courses[]`). |
| Dateless-exam explicit "dato ikke satt" state | Home-exam releases consume the busiest weeks even without a ribbon dot; don't silently drop them (p9). |

### SHOULD

| Feature | Why |
|---|---|
| Day-load strip + free-day sentence | Turns "doesn't collide" into "is livable" for the constrained student (p5). |
| Week scrubber over teaching weeks, flagging atypical weeks | Uke 35 ≠ uke 40; a modal-week template hides the deviations that break a schedule (p5 — needs new deviation function). |
| Conflict **resolution** ("vis alternativer" → freed slot + choice-group substitute chips) | Turns red ink from a verdict into a fork in the road; the highest-value use of unused study-plan data (p8). |
| Semester default = **next plannable term**, not "current" | The site is always a next-semester tool used during the current one; wrong default taxes every job at the door (p6). |
| `/emne/[code]/` plan-context line ("Obligatorisk i MTDT, 5. sem") | Answers "does this belong in *my* plan", not just "what is this course" (p7). Free. |
| Study-plan page: bulk-add above the descriptive prose | The prose is pure ntnu.no mirroring; the plan template is the decision content (p7/p12). |
| Waypoint/retning `deadlineDate` surfaced at the choice point | The reversible-until deadline students lose track of (p9). |
| Recursive retning rendering (hovedprofil → fordypning nesting) | Real in 5-year siving programs; a two-level assumption mis-renders them (p9). |
| `publishedYears` gating → "ikke publisert ennå for dette kullet" | Young kulls legitimately have empty future periods — don't render as an empty program (p9). |
| Screen-reader conflict summary before the grid + focus-moving conflict notes | The audio equivalent of "red ink catches your eye" before tabbing 15+ cells (p10). |
| Assessment-mix / mandatory-activity-count workload signals (plain counts) | Honest workload proxy — "3 skriftlig eksamen, 1 mappe" — never a fabricated score (p4). |

### COULD

| Feature | Why |
|---|---|
| Personal fixed-commitment blocks (job/training) overlaid, localStorage-only | Livability context; explicitly not in the shareable hash (p5). |
| Grade/difficulty data joined into elective rows on the study-plan page | Where difficulty matters most, at the choice point (p12) — guard against becoming a leaderboard (p4). |
| English course-name display where the crawl has it | Small exchange-student win; a crawler-cost question, not a UI toggle (p3). |
| Par/odde alternating-week rendering as one cell w/ week annotation | Correctness polish so alternating-week courses don't look like a permanent clash (p9). |

### WON'T (this phase — see also §7 non-goals)
Synthesized difficulty/workload scores; computed thesis-relevance ranking;
auto-"best 2 of 5" recommender; multi-year program planning in the planner
surface; drag-to-pick lab groups (v2+); advisor annotations on shared plans
(needs server state).

### KILLED — mirror ntnu.no with no decision value
- **Department/program marketing prose as primary page content** on
  `/studier/[code]/` — demote below the plan or into a disclosure (p7/p12).
- **The `/studier/` standalone index** — redundant second search page (p7).
- **Bilingual/i18n UI chrome** — the data already carries English; the gap is
  surfacing language/campus/assessment as *scannable data*, not translating
  Norwegian voice that would bit-rot and fight the design system (p3).
- **A glossary/FAQ/"international students" info page** — solve via better
  defaults and real filters, not a static explainer (p1/p3).
- **Cross-course sortable strykprosent column / grade leaderboard** — the one
  interaction that turns "inform" into "toxic" (p4).

---

## 6. Domain rules that must be modeled (from p9)

These are correctness requirements. The naive version looks right in a 2-course
demo and lies on a real plan. Priority order:

**MUST model before the planner is trustworthy:**

1. **The øving-group problem (P0).** `TimetableEntry` has no field distinguishing
   a lecture (attend-all) from one of N parallel exercise-group sections
   (attend-one). Naive pairwise conflict-checking reports 8 collisions for a
   non-issue and buries the one real lecture clash.
   - **Cluster** entries by `courseCode + dayNumber + startTime + endTime`
     (ignoring room) before conflict-checking; same-time same-duration repeats
     with ≥2 rooms are parallel sections of one activity, not additions.
   - **Only hard-flag** a conflict when *no* alternative in a cluster avoids it.
     If ≥1 group slot doesn't collide, it's "pick group 2/4/7", not red.
   - **Classify** lecture vs. group by Norwegian keyword heuristic
     (forelesning / øving / gruppe / lab / seminar / kollokvium); on an
     unclassifiable cluster, treat conservatively as "pick one" (fewer false
     alarms is the safer failure mode).
2. **Kont/utsatt exam filtering + multi-part collapsing.** Continuation exams
   (August, belonging to the *prior* semester) must be filtered out of the main
   exam timeline or clearly bucketed separately. Multi-part assessments
   (`weighting` "2/3", "100/100") are one course's several rows — collapse to one
   timeline entry; they never clash with themselves. Compare only *ordinary,
   single-occasion* exam dates within the *selected* semester.
3. **Dateless exams are common, not an edge case.** `date` is frequently `null`
   (home-exam "Utlevering" releases, unpublished). Give them an explicit "dato
   ikke satt" state — do not silently drop them; they still consume busy weeks.
4. **`planElement` filtering on bulk-add.** HMS/praksis/administrative plan rows
   must be filtered from "legg til alle" (ntnu-api's own `planCourseCodes()`
   already learned this). But note: real 0-sp *courses* exist and are legitimate
   — don't conflate "0 sp" with "filter out"; they show a timetable slot and count
   as in-plan, just add 0 to credits.
5. **Version threading.** Codes carry version suffixes; `timetable()`/`schedules()`
   default to `version:"1"` silently. A course added from an old kull's plan with
   a different version silently fetches wrong data. Thread `version` through
   `PlanState.courses[]` (currently `{code,name}` — a gap to flag to the lib
   agent) from both study-plan adds and catalog adds.

**SHOULD get right (moderate effort):**

6. **Par/odde week rendering.** The week-intersection *math* likely already
   handles alternating weeks (disjoint week lists, no boolean flag). Audit the
   *rendering*: two courses sharing a timeslot on alternating weeks must render as
   **one grid cell** with differentiated week annotations, not a fake
   side-by-side split implying a room conflict.
7. **Recursive retninger.** `StudyWaypoint.directions` ↔ `PlanDirection.waypoints`
   are mutually recursive (hovedprofil can contain a further fordypning). Render
   recursively, not hand-unrolled to two levels. Surface `deadlineDate`.
8. **`publishedYears` / periodNumber.** `periodNumber` is raw upstream (`number |
   null`), not guaranteed contiguous — index by the field, not array position.
   Young kulls' future periods legitimately don't exist yet: say "ikke publisert
   ennå", don't render an empty program.

**MAY simplify, don't break:**

9. **x.5-sp is the norm** (7.5 standard). Sum in half-point integer units (×2,
   sum, ÷2) to avoid "22,4999996 sp".
10. **Semester-year derivation** goes through one `semesterYear()` helper — a
    spring off-by-one silently fetches an empty timetable that reads as "not
    taught this semester", a plausible wrong answer.
11. **Course `notices[]`** surfaced at add-time (§5 MUST).

**Never re-parse scraped free-text.** Branch UI on structured `form`/`weighting`
fields only; treat `assessmentScheme` / `duration` / `aidCode` / `dateText` as
display-only prose. The crawler did the hard parsing once; client-side re-parsing
breaks silently on upstream template drift.

---

## 7. Explicit non-goals

- **No accounts, no server-side storage.** State is localStorage + shareable URL
  only (ground truth). No `/logg-inn/`, no server identity implied by any feature.
- **No registration / Studentweb integration.** We are the thinking tool
  *upstream*; the student finalizes in Studentweb. Every deadline/eligibility
  claim carries a "bekreft i Studentweb" disclaimer.
- **No fabricated signals.** No synthesized workload/difficulty score, no computed
  thesis-relevance ranking, no auto "best 2 of 5" recommender, no faked
  seat/capacity/popularity data (we don't have it). Honest proxies shown as plain
  counts only (p2/p4).
- **No cross-course grade leaderboard.** No sortable strykprosent column anywhere,
  especially `/emner/`. Student-initiated 2-course compare is the only legitimate
  ranking-adjacent UI (p4).
- **No multi-year program planning in the planner surface.** One semester at a
  time; the study-plan pages carry the multi-year view (p8).
- **No calendar/ICS export, no push notifications, no commute/map calculation, no
  auto-optimizer/solver.** No prerequisite or seat data exists to make a solver
  safe; no accounts to push to (p5).
- **No bilingual UI layer / browser-language auto-switch.** Data-level English +
  compact mono badges instead (p3).
- **No onboarding wizard/modal, no glossary page.** Empty states chained
  correctly *are* the onboarding (p1/p7).
- **No building-level (Gløshaugen vs Dragvoll) course-campus filter** — course
  `location` is city-level only in current data; that granularity exists only on
  program summaries. Don't fabricate precision the data doesn't support (p3).
- **No drag as a primary gesture.** Decisions here are status toggles and
  selections (you can't move a course in time — NTNU fixes times); click/hover
  express them accessibly. Drag reserved for a possible v2 lab-group picker (p8).
- **No extending the squared ruling beyond planning surfaces** (DESIGN.md law) and
  **no hue-tinted good/bad grade bars** (would recreate the toxic signal and
  violate Red-Is-Collision) (p4/DESIGN.md).

---

## 8. Resolved conflicts (reasoning, not averaging)

**Conflict 1 — Is there a "considering" state? (p8 two-tier YES vs p7 "skip it,
it duplicates the plan" vs p2 "candidates are essential").**
*Resolved: YES, build the two-tier committed/shortlist model (p8/p2).* p7's
objection was specifically to a *separate compare page or catalog multi-select
tray* — a valid objection to *that mechanism*. But the elective loop (Persona A,
endorsed by p2/p6/p8/p12) is the product's center of gravity, and it structurally
requires holding "weighing" separate from "taking". p8's ghost-block model
delivers this *inside* the existing planner surface without a new page, which
satisfies p7's real concern (no new nav surface) while giving p2 its candidate
set. `PlanState` goes to `v:2` with `candidates[]`; hash gains a second segment.

**Conflict 2 — Where does compare live? (p8 tray on planner vs p7 `/emne/?mot=`
vs p2 comparison table).**
*Resolved: BOTH surfaces, one shared render.* The compare *table* is a component,
not a page. It renders (a) on the planner below the grid, fed by the shortlist
(p8's tray — where the chooser already is), and (b) via `/emne/[code]/?mot=CODE,CODE`
for the deep-linkable/shareable case (p7 — "should I take X or Y" pasted to a
friend). Same `data.ts` shapes, same mono table, two entry points. No standalone
`/sammenlign/` page (p7). This is not averaging — both viewpoints wanted the same
artifact reachable from their persona's natural spot; we build the artifact once.

**Conflict 3 — Onboarding: wizard vs. chained empty states (p1 "one-step program
picker" vs p7 "no wizard, empty states chain").**
*Resolved: no wizard, but promote the program+kull picker to a first-class
on-ramp (p1) inside the empty-state chain (p7).* These only appear to conflict.
p7 rejects a *multi-screen modal wizard*; p1 asks for *collapsing a 4-step
navigation path into one picker*. A single name-based program+kull picker that
pre-fills the planner is not a wizard — it's a better empty state. It lives on `/`
and in the planner's empty state, exactly where p7's chain already branches for
"first-year, knows program."

**Conflict 4 — Semester default (PLANNER.md implies "current"; p6 demands "next
plannable term").**
*Resolved: default to the next plannable term* (p6). The site is provably a
next-semester tool used during the current one (five demand spikes, all pointing
forward). Prefer the nearest semester with `timetablePublished`; fall back to the
next chronological one with the pre-publish mode.

**Conflict 5 — Grade data: how much to show (p4 "inform, split, trend" vs the
general temptation to rank).**
*Resolved: p4's discipline is law.* Always season-split, always show cohort `n`
(reduced weight below ~n=20, not hidden), default to a multi-year trend strip,
show two derived facts (strykprosent + median band) not one score, never a
cross-course sortable column. Grade bars never hue-tinted good/bad (would violate
Red-Is-Collision). Student-initiated 2-course compare is the only ranking-adjacent
UI, because the student picked the set.

**Conflict 6 — Conflict engine reuse (p8 wants preview/resolution; p2 warns "one
engine only, or it drifts and destroys trust").**
*Resolved: one engine, extended by tier, never a second engine* (p2's constraint
binds p8's ambition). Preview, shortlist-vs-committed soft conflicts, and
provisional swap-in all run through the *same* `conflicts.ts`/`schedule.ts`
against a candidate union — typed by tier, not reimplemented. A second conflict
engine anywhere is forbidden.

---

## 9. Open product questions

1. **Øving-group heuristic accuracy floor.** What keyword-classification hit-rate
   is acceptable before shipping? The safe failure mode is under-flagging (p9),
   but how do we validate against real timetables — a labeled sample of the
   lab-heaviest programs (MTDT, MTFYMA)?
2. **Shortlist default view.** When a choice group is bulk-pulled to candidates,
   does compare open automatically (p8's "default view of the shortlist when ≥2
   compete for a slot") or stay collapsed? Trade-off: first-visit wall vs. hidden
   value.
3. **Should candidates ride the shareable hash by default?** p8 says yes (the
   artifact students paste to advisors carries "what I'm still choosing"). But a
   longer, two-segment hash is more fragile to hand-editing and truncation. Ship
   candidates-in-hash from day one, or committed-only first?
4. **Plan strip on `/planlegger/` itself** — suppress (redundant with the page) or
   keep (uniform)? p7 flags this as a legitimate either/or; pick one, keep it
   uniform.
5. **Compare fail-rate cell** — which single derived figure goes in the compare
   table's grade cell without becoming a leaderboard? p8 wants "fail-rate", p4
   warns a bare number misleads. Candidate: "strykprosent (vår, snitt 3 år)" with
   the season label baked into the cell.
6. **First-year on-ramp vs. `publishedYears` gap.** A fresher picking their kull
   for a future period in July may hit unpublished data (p9). Does the on-ramp
   still populate period 1 and note "senere semestre ikke publisert ennå", or
   route them to the study-plan page? Affects Flow 1 step 3.
7. **Personal fixed-commitment blocks (p5 COULD)** — worth the `store.ts`
   complexity (a non-hash-synced field) for the livability persona, or defer? It's
   the one feature that adds *user-authored* data to an otherwise
   NTNU-data-only tool.
8. **How aggressively to surface the exchange-student filters (p3)** given
   building-level campus data doesn't exist — is city-level campus + language +
   assessment enough to serve the persona, or does it read as half-built?
