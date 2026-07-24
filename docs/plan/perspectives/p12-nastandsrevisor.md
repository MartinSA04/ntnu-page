# P12 — Nåstandsrevisor (current-state auditor)

Lens: what exists today, judged against student value, not correctness.
Salvage map for what to keep / reshape / discard before further building.

Read: PLANNER.md, SPEC.md, DESIGN.md, all six page sources
(`index.astro`, `emner/index.astro`, `emne/[code].astro`, `studier/index.astro`,
`studier/[code].astro`, `planlegger/index.astro`), the planner lib
(`store.ts`, `conflicts.ts`, `schedule.ts`, `data.ts`, `hues.ts`), the three
`emne` islands, `studyPlan.ts`, and two screenshots of `/planlegger/`
(one empty, one populated but visibly broken — grid data rendering as
unstyled inline text, exam ribbon empty despite an exam existing). The
screenshots corroborate known bugs already slated for separate fixing; I
did not spend analysis on them, only on what they reveal about intent vs.
execution gaps.

## Verdict up front

The site has **one real asset** (the conflict/plan engine) and **three
pages that don't know what job they're doing**. The engine — `store.ts` +
`conflicts.ts` + `schedule.ts` — is genuinely good: well-modeled, unit-test
shaped, cross-tab reactive, hash-shareable, tolerant of partial failure.
Everything downstream of it ranges from "fine, forgettable" (`/studier/`,
`/emner/`) to "actively working against the product's stated thesis"
(`/emne/[code]/`, `/`). The `/planlegger/` page is the correct centerpiece
by design but is currently a monument to build-vs-decide confusion: it
renders every fact it can fetch and asks the student to do the deciding.

## Asset: the plan engine (`src/lib/planner/*`) — KEEP, and lean on it harder

- `store.ts`: a single localStorage-backed `PlanState` with insertion-order
  hue assignment, hash sync, cross-tab `storage`-event reactivity, and an
  injectable storage backend for tests. This is the one piece of the site
  that is actually infrastructure rather than a page. It's already built to
  be read from anywhere (`onPlanChange`), which is exactly right — a plan
  that lives only on `/planlegger/` would be a much weaker product.
- `conflicts.ts`: pairwise day/time/week-intersection collision detection
  plus exam-gap analysis, with real edge cases called out in the spec
  (back-to-back 12:00/12:00 is not a conflict, disjoint weeks are not a
  conflict). This is the thing that makes the site worth visiting instead
  of Studentweb — nowhere else can a student see "these two collide" before
  committing. It is the actual product.
- `schedule.ts`: teaching-week intersection so a course not taught this
  semester silently drops out of the grid instead of lying about a
  conflict. Correct call, matches the "not an error, information" framing
  in PLANNER.md.

**Why this matters for the audit**: the panel's job is to decide what the
site *should be*. The honest answer is "a thin shell around this engine,
surfaced in more places, with more of the engine's judgment (fits / doesn't
fit / tight) pushed earlier into the flow." The engine is not the
bottleneck. The pages are.

## Liability: `/emne/[code]/` is a spec-sheet mirror, not a decision aid — RESHAPE hard

Read `courseDetails.ts`, `courseGrades.ts`, `courseTimetable.ts`: three
independent islands, each fetching its own endpoint, each rendering into
its own inert section (`Om emnet`, `Karakterstatistikk`, `Timeplan`), with
zero cross-talk between them or with the plan. The page structure is
"facts panel → prose blob → exam table → grade bars → timetable list," in
that order, which is literally NTNU's own course-page structure re-skinned
in Ruteark. A student who already knows they want TDT4100 gets nothing
here they couldn't get from ntnu.no faster. A student who is *deciding
whether to take it* gets no help either — the one button that ties this
page to the site's actual purpose (`Legg til i planen`) sits above three
sections that never mention the plan again.

Concretely, what's missing that would make this page pull its weight:

- **No "does this fit what I already have" framing.** The moment a
  student has ≥1 course in their plan, this page has everything needed
  (via `data.ts`'s fetch pattern, already proven on `/planlegger/`) to say
  "kolliderer med TMA4100, tirsdag 10:15–12:00" *right here*, before they
  add it. Instead they must add it blind and go check the planner.
- **Grades render but say nothing about difficulty relative to nothing** —
  a bar chart with no framing ("strykprosent", "typisk karakter") is a
  data dump. A grade chart's entire value on a *decision* page is "is this
  a hard course," and that requires one computed sentence, not six years
  of stacked bars a student has to eyeball.
  - Also worth flagging: A–F/pass-fail distributions with GDPR-masking on
    small counts are one of the more distinctive assets this dataset has
    (few tools show this at all) and it's being spent on a decorative
    chart instead of an answer.
- **Timetable island renders as a flat list of entries, not the ruled grid
  the planner uses.** Two different visual languages for the same data
  (list here, `.np-frame.np-ruled` grid there) means a student can't
  eyeball a clash on this page even in principle — they have to hold the
  shape in their head and go check the planner. The system already owns a
  correct single-course grid renderer (or should — see gap below); this
  page should show it, ideally with the *existing plan's* blocks ghosted
  behind it so the "does this fit" question answers itself visually.
- **Three separate loading states for one page** ("henter emnedetaljer …",
  "henter karakterstatistikk …", "henter timeplan …") is implementation
  leaking into UX — a visitor doesn't care that these are three fetches,
  they care whether the course is worth their next 5 minutes.

Verdict: keep the URL and the data plumbing, discard the layout metaphor
("mirror ntnu.no's course page structure"). This page's job is *"should I
add this to my plan,"* and today nothing on it computes that answer — the
student does all the synthesis themselves, which is exactly the labor
PLANNER.md says the site exists to remove.

## Liability: `/emner/` is a well-built dead end — RESHAPE (light)

The search itself is solid: instant client-side filter over a compact
index, quick-add `+`/`✓` icon buttons wired straight to the store, location
chips, diacritic folding, a sane 200-row cap with an honest count. No
complaints about the mechanism.

The problem is positional, not technical: **this is the only page in the
site with zero synthesis**, and it's the page most likely to be a
student's *second* stop (after landing, before they've committed to
anything). Right now it answers "does TDT4100 exist and where is it
taught" and nothing else — not exam season overlap with what's already in
the plan, not credit load, not a clash preview. The exam-season note
(`eksamen høst`) is the one glimmer of decision-relevant info already
present in the row and it's buried as a faint trailing label.

Two things this page should be doing that it isn't:
- Rows for courses already in the plan should look different (not just the
  ✓ on the button — the whole row, since that's the actual state a student
  scanning 40 rows wants to see at a glance).
  - **Named-rule tension worth flagging explicitly**: DESIGN.md's
    Course-hues rule ("never as text color... square dot carries identity")
    was adjudicated for the *planner*, where hue = selection identity
    across a small set. `/emner/` is a scan-a-list-of-hundreds context —
    reusing the same `.np-dot` mechanism for "already in plan" here is
    plausible and roughly free, but it is genuinely a different semantic
    (membership vs. individual identity) and deserves a design-lens
    decision, not an assumption. Flagging, not solving.
- A course whose exam collides with something already in the plan is
  exactly the kind of fact this list could pre-compute (it has the exam
  dates already, per SPEC.md's compact search-index format) and mark
  before the student ever clicks through.

## Reshape: `/studier/` + `/studier/[code]/` — the actual entry point for the majority of students, undersold

This is the page type that matches how most NTNU students actually
experience course selection: they don't browse a catalog of 4767 courses
freely, they inherit a `kull`'s study plan and make choices inside
"valgbare emner" groups. PLANNER.md itself says this is where the real
planning pain lives, and `/studier/[code]/` is the only page built around
that structure (periods → groups → courses, waypoints/retninger as
disclosures, per-course and per-period add wired to `setProgram`).

Mechanically this is fine — good use of the data model, reasonable
disclosure pattern for retninger. But it undersells its own good idea:

- The "ditt semester" auto-highlight (period matching the planner's chosen
  semester) is described in PLANNER.md but from reading `studyPlan.ts`'s
  310+ lines and the page shell, the emphasis this deserves — this is the
  single highest-value moment in the whole site for a program student ("go
  straight to the semester you're actually planning") — is not visually
  foregrounded anywhere in the static shell; it's buried as one more period
  among many once the island mounts.
- Choice groups ("velg 2 av følgende 5") are exactly where a program
  student needs *this site's* help most (compare options, check which pair
  doesn't clash) and today they render as flat course rows identical to
  the obligatory ones — no visual distinction between "you must take this"
  and "you are choosing between these," which is the one piece of
  information a kull's study plan actually withholds from a student
  reading it cold.
- No connection back to grade/difficulty data at the point of choice. A
  student staring at 5 electives in a choice group is in the single
  highest-leverage moment for "which of these is hard" — and that's a
  join this site's own data already supports (course code → grade
  distribution) that nothing here performs.

Verdict: keep the structure, this is closer to the site's real center of
gravity than `/emner/` is. Reshape by (a) making choice groups visually
distinct from obligatory blocks, (b) making "ditt semester" a strong
default view rather than a highlight buried in a full list, (c) piping
grade/difficulty signal into elective rows since the join already exists
in the data layer.

## Liability: `/` (landing) — selling nothing, mostly doing nothing either

Three tiles of equal visual weight (Planlegger / Emner / Studier) plus a
generic hero sentence. This is a sitemap, not a pitch. Per PLANNER.md's own
spec this should re-pitch around the planner specifically with a single
primary CTA and a "your plan has N courses" line for returning visitors —
the returning-visitor line is implemented (`home-plan-status`, reads the
store), which is the one genuinely good idea on the page: it turns a
static landing into a "pick up where you left off" moment. But it's
`hidden` by default and easy to miss, and it's competing for attention
with three equally-weighted tiles that dilute the "one job" framing the
rest of the product claims to have.

More importantly: the landing is the one place in the whole site where a
first-time visitor could be told *why this exists instead of Studentweb /
ntnu.no* — "see collisions before you register" is the entire value prop
and it's stated as a subordinate clause in the lede, not demonstrated. A
static, tiny illustrative example of a caught collision (even a fixed,
non-interactive one) would sell the product in one glance better than the
current three-tile grid. This is a **discard-the-tile-grid, keep-the-
returning-visitor-hook, add-a-demonstration** situation, not a rebuild.

## Gap: no single-course "would this fit" view exists anywhere

This is the most important missing piece, and it's missing *everywhere*,
not on one page. The site has:
- a full plan view (`/planlegger/`) that requires committing (adding) a
  course before you can see if it clashes,
- a course detail view (`/emne/[code]/`) that never looks at the plan at
  all,
- a catalog list (`/emner/`) that never looks at the plan at all,
- a study-plan view (`/studier/[code]/`) that never looks at grades or
  clashes at all.

None of them answer "if I add this, what happens" *before* the add. The
engine (`conflicts.ts`) already computes exactly this pairwise, cheaply,
for a handful of courses — this is not a new capability, it's a
composition gap. The single highest-leverage build item this audit
surfaces: **hover/preview-level "would clash with X" signal on every
add-affordance in the site** (search rows, course page button, study-plan
rows), computed against the current plan, shown as the same red-ink
vocabulary the planner already owns. Today the only way to learn a course
clashes is to add it, look at the planner, and undo it if it's bad — that
is friction the engine has already paid for and the pages aren't spending.

## Salvage map

| Piece | Verdict | Why |
|---|---|---|
| `src/lib/planner/store.ts`, `conflicts.ts`, `schedule.ts` | **Keep, invest more** | The actual product. Correct model, well-scoped, already cross-page reactive. Under-used, not under-built. |
| `src/lib/planner/data.ts` (fetch + memoize pattern) | **Keep** | Right shape (parallel fetch, per-course failure tolerance, static-tier fast path). Reuse this pattern to power decision-preview features on other pages instead of building new fetch logic per page. |
| `src/lib/planner/hues.ts` + `.np-dot` course-identity system | **Keep as-is on the planner**, extend cautiously elsewhere | Correct, adjudicated for the planner. Reusing it as a "membership" signal on `/emner/` rows is plausible but is a different semantic and needs a deliberate call, not an assumption. |
| `/planlegger/` page shell & layout (per PLANNER.md §2) | **Keep the design, fix the execution** | The spec is right — squared grid, red-ink collisions, exam ribbon, basket. Screenshots show it's not currently landing that spec (unstyled grid dump, empty exam ribbon despite exam data present) — separately tracked as bugs, not a design problem. |
| `/emne/[code]/` layout (facts → prose → exam table → grades → timetable, as three independent islands) | **Discard the layout metaphor, keep the data plumbing** | It's a spec-sheet mirror of ntnu.no with no synthesis and no connection to the plan. Rebuild around "should I add this," with plan-relative clash preview and grade data reduced to one framed sentence instead of a chart nobody asked for. |
| `/emner/` search mechanism (index fetch, fold, chips, cap) | **Keep** | Solid, fast, simple. Reposition: rows should reflect plan state and pre-computed clash risk, not just membership. |
| `/studier/[code]/` structure (periods → groups → waypoints) | **Keep, reweight** | Closest page to the site's real center of gravity (majority of students plan from a kull, not free catalog browsing). Needs: visual distinction for choice groups vs. obligatory courses, "ditt semester" as a strong default not a buried highlight, grade/difficulty signal joined into elective rows. |
| `/` landing (three equal tiles + hero sentence) | **Discard the tile grid, keep the returning-visitor hook** | Sitemap, not a pitch. The `home-plan-status` "pick up your plan" line is the one good idea and it's under-emphasized. Needs one clear CTA and a concrete demonstration of the value prop (a shown collision), not three equally-weighted doors. |
| Cross-site "would this clash if added" preview | **Missing — build this** | The engine already supports it; no page currently spends it before the add commits. This is the single highest-leverage gap the audit found — it would upgrade `/emne/[code]/`, `/emner/`, and `/studier/[code]/` simultaneously without inventing new data or new engine logic. |

## One-paragraph synthesis for the panel

The engine is ready for a product the pages haven't caught up to yet: today
you must *commit* a course to the plan to learn anything about it (does it
clash, does it fit), and the three pages that exist to help you decide
*before* committing (`/emne/`, `/emner/`, `/studier/[code]/`) each show
you facts in isolation instead of judgment relative to what you already
have. The fix is not new data or a new engine — `conflicts.ts` already
computes everything needed — it's pushing the plan-aware "would this fit"
answer upstream, onto every page where a student is still deciding, and
demoting `/emne/[code]/` from a spec-sheet mirror to a page whose entire
job is answering that one question.
