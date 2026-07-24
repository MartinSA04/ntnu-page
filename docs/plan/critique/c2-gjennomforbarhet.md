# c2 — Gjennomførbarhet: adversarial feasibility critique of PRODUCT-draft.md

Scope: attack every flow against the *actual* stack (static Astro + edge Worker
+ localStorage + shareable URL) and the *actual* data set (the `ntnu-api`
models, nightly crawl, `/api/*` worker). Ground truth read: `ntnu-api/src/models.ts`,
`coursepage.ts`, `programs.ts`, `courses.ts`; `docs/SPEC.md`, `docs/PLANNER.md`.

Verdict up front: the draft is mostly buildable, but **four load-bearing
features silently assume data or state we do not have.** The worst is the one
the draft itself labels "P0" and "the naive engine lies on every lab-heavy
course" — because the fix it prescribes is *also* unbuildable with our fields.
Each finding below quotes the draft, states the data reality, and gives the
honest degraded version.

---

## F1 — Øving-group clustering (MUST / "P0") assumes a group-membership field we do not have

> §6 MUST(1): "**øving-group clustering** — cluster by `courseCode+day+start+end`,
> only hard-flag when *no* alternative avoids the clash, classify
> lecture-vs-group by keyword"
> §5 MUST: "conflict engine **with øving-group clustering**"
> §8.6: "one engine extended by tier … run through the same `conflicts.ts`"

**Reality.** `TimetableEntry` (models.ts:322) carries only: `courseCode`,
`courseName`, `acronym`, `term`, `termNumber`, `name`, `title`, `dayNumber`,
`startTime`, `endTime`, `weeks[]`, `rooms[]`, `studyProgramKeys[]`. **There is
no `activityCode` on the summarized timetable** (only `ScheduleActivity` — the
*dated* feed — has `activityCode`, models.ts:277). So the grid the planner
renders (`courses.timetable` → `data.summarized`) has no stable id telling us
which slots are *interchangeable alternatives of one øving group* versus
*distinct mandatory groups*.

The draft's own clustering key — `courseCode+day+start+end` — collapses slots
that share a wall-clock slot, which is the *opposite* of what group logic
needs: two øving groups for the *same* course routinely run in *different*
rooms at the *same* time (that is the whole point of parallel groups). Keyed
that way they merge into one cluster; keyed any finer we have nothing to key
on. "Classify lecture-vs-group by keyword" then leans on `name`/`title` free
text (`"Forelesning"`/`"Øving"`/`"Lab"`/English/blank/null) — brittle, and it
still does not tell us *which* øving slots belong to the *same choosable group*.

The engine cannot answer "does an alternative slot avoid the clash?" because it
cannot enumerate the alternative set. It can only see "here are N slots for
this course on the grid."

**Honest degraded version.** Do not claim group-aware clash resolution. Ship:
- **Lecture-only hard conflicts.** Keyword-classify `name`/`title`; treat
  `Forelesning`/`Lecture` (and blank/unknown) as schedulable-fixed → these
  drive red-ink hard conflicts. Everything matching `Øving`/`Lab`/`Øvingsforelesning`/
  `Kollokvie` → **soft, non-colliding "øving/lab (flere grupper kan finnes)"**
  annotation, never a red hard-flag.
- Render øving slots as a **muted, non-clashing layer** with a mono margin note:
  "Øvings-/labtider vises — gruppevalg gjøres i eget system, sjekk der."
- This makes the "no alternative avoids the clash" logic honest by *never
  asserting it* — we don't have the alternative set, so we don't pretend to.

Downgrade F1 from MUST to: MUST = lecture hard-conflict engine; SHOULD =
keyword soft-classification of øving/lab. Delete "only hard-flag when no
alternative avoids the clash" — it is unimplementable and will produce
confident wrong answers (both false "it fits" and false "it clashes").

Open-question §9 "Øving-heuristic accuracy floor & validation set" is really
"can this heuristic exist at all" — the answer is: only as a *display* label,
not as conflict input.

---

## F2 — The elective decision loop assumes choice cardinality ("velg 2 av 5") that is not in the data

> §1 job: "'velg 2 av 5' … is a **comparison-and-substitution** problem"
> §3 flow 2: "choice group → 'legg alle til vurdering' … promote survivor →
> commit at ~30 sp"
> §5 SHOULD: "conflict **resolution** (choice-group substitute chips)"

**Reality.** `PlanCourseGroup` (programs.ts:91) is `{ code, name, description,
courses[] }`. **There is no min/max/choose-N field anywhere** — not on the
group, not on the direction, not on the waypoint. `parseCourseGroup`
(programs.ts:226) reads only `code`/`name`/`description`/`courses`. The
"velg 2 av 5" constraint lives *only* as prose inside `name`/`description`
(e.g. "Velg minst 22,5 SP"), unparsed and unreliable. `PlannedCourse.credits`
is `number | null`, so even the *credit floor* interpretation ("reach 30 sp")
degrades to null-holes.

So "commit at ~30 sp" and "promote survivor" cannot be validated against a
real "you have chosen the required number." The product can *show* a group and
let the user pull courses into a shortlist, but it **cannot tell the user
"you've satisfied this choice group"** — the required count is not machine-readable.

**Honest degraded version.**
- Keep the shortlist/candidate ("vurdering") state — that is pure localStorage,
  fully feasible, and genuinely useful.
- Replace "commit at ~30 sp / survivors satisfy the group" with a **credit
  running total against the 30 sp nominal** *only* (a number the student reads
  and judges), plus **verbatim display of the group's `name`/`description`
  prose** ("Studieplanen sier: 'velg minst 22,5 SP fra denne gruppen'") — quote
  it, do not parse it. Success = "student saw the rule and their total," not
  "app verified the rule."
- "Substitute chips" (SHOULD) become "other courses in the same group" chips —
  a flat list from `PlanCourseGroup.courses`, feasible. Drop any implication
  the app knows the swap keeps you *valid*.

This keeps Velgeren as the center of gravity (correct call) while not lying
about constraint satisfaction the data can't express.

---

## F3 — Exam ribbon / kont surfacing assumes clean dates; upstream gives nullable + prefixed text

> §5 MUST: "ordinary-only exam ribbon … kont + deadline surfacing … **dateless-exam state**"
> §6 MUST(2)(3): "kont filtering + multi-part collapsing … explicit 'dato ikke satt' state"

The draft *does* acknowledge dateless exams (good). But two sub-realities need
naming or the ribbon renders wrong:

**Reality A — two exam sources disagree.** Catalog `ExamDate` (models.ts:159)
has `{ date, season, continuation, submissionDate, withdrawalDate }` — clean
ISO `date`, boolean `continuation` for kont filtering. But the *richer* exam
data (form, weighting, duration, time) comes from `CourseExam` (coursepage.ts:70),
where `date` is "normalized to ISO when unambiguous" and `dateText` carries raw
strings like **`"Utlevering 07.11.2025"`** and `occasion`/`season` are free text
(`"Ordinær eksamen"`, `"Vår 2026"`). "Ordinary-only" filtering on the scraped
side means string-matching `occasion`/`continuation`-less prose — brittle.

**Honest fix.** Drive the **ribbon dot position** from **catalog `ExamDate`**
only (`date` + `continuation` for kont filter — both structured, both in the
search index already per PLANNER.md §4). Use `CourseExam` only to *enrich* a
dot's detail popover (form/duration), and when `CourseExam.date` is null but
`dateText` is present, show `dateText` verbatim as a mono note ("Utlevering
07.11.2025") rather than trying to place it on the axis. A hjemmeeksamen with
`date=null, dateText="Utlevering…"` must land in the "dato ikke satt / se
emneside" bucket, not silently vanish or stack at day-0.

**Reality B — deadlines are per-exam, not global.** `ExamDate` has
`submissionDate`/`withdrawalDate`; the Feb-1/Sep-15 registration deadlines from
the brief are *NTNU calendar constants*, not fields. "deadline surfacing" is fine
if it means "show `withdrawalDate` when present + a static reminder of the
semester's opp-melding deadline," not "the app computes each course's deadline."

---

## F4 — Version threading is under-specified and the grade join is version-fragile

> §5 MUST: "version threading"
> §6 MUST(5): "version threading through `PlanState.courses[]`"
> §5 COULD-adjacent, §8.6: engine over "a candidate union"

**Reality.** Versioned codes appear in *three* incompatible shapes:
- Catalog/`CourseSearchHit.courseVersion` and `PlannedCourse.version` →
  `string | null` (e.g. `"1"`).
- `courses.timetable`/`schedules` take `version` as an option, default `"1"`
  (courses.ts:167) — so a re-versioned course with a live `"2"` returns the
  **wrong (v1) grid** unless the caller threads the version.
- **Grades `GradeRow.courseCode` is *suffixed*: `"TDT4100-1"`** (models.ts:453),
  a different string space from the bare `"TDT4100"` the plan and catalog use.

The draft says "thread version through `PlanState.courses[]`" but `PlanState`
(PLANNER.md store.ts) is `{ code, name }[]` — **no version field today**, and
the shareable **hash is `#26h;TDT4100,TMA4100`** (bare codes). Adding version
to the hash is a URL-state schema change (`v:2` migration, per §8.1) that the
draft folds into the shortlist migration but never specifies for version.

**Consequences if unaddressed:**
- Timetable/exam for a re-versioned course silently shows v1 data (wrong
  rooms/times) — a *correctness* bug in the core conflict engine, not cosmetic.
- "season-split grade trend" (MUST) must match `TDT4100-*` against a bare code:
  either aggregate across all versions (defensible, must be stated) or the
  chart shows nothing for a version mismatch.

**Honest fix.** Make version a first-class `PlanState.courses[]` field
(`{ code, version, name }`), thread it into every `/api/course/:code/*?year=`
call, and **specify** the grade join as "match on bare code prefix, aggregate
versions, label the trend 'alle versjoner'." Put version in the hash only if a
non-`"1"` version is present (keep short URLs the common case). Add "versioned
grade join" to the domain rules — it is currently invisible.

---

## F5 — First-year on-ramp period math is fragile against `publishedYears` gaps and dateless start terms

> §3 flow 1: "name-based program+kull picker → pre-fills `/planlegger/` with
> **period-1 obligatory courses**"
> PLANNER.md §5: `period n = (semYear − cohort) × 2 + (autumn ? 1 : 2)`
> §9 open: "first-year on-ramp behavior when `publishedYears` gaps"

**Reality.** `StudyPlan.periods[].periodNumber` is `number | null`
(programs.ts:120) and `StudyPlan.publishedYears` gates which cohorts resolve at
all (programs.ts:136; `studyPlan()` returns `null` for unpublished cohort
years, programs.ts:353). The period formula also assumes a `HØST` start;
`startTerm` is `string | null` and spring-intake programs exist → the
`(autumn ? 1 : 2)` term-offset silently misindexes them. And "period-1
obligatory courses" assumes `StudyChoice.code == "O"` reliably marks
obligatorisk — `studyChoice` is `null`-able and its `code` is free-form
(programs.ts:72), so "obligatory" is a best-effort filter, not a guarantee.

**Honest degraded version.** The on-ramp is feasible and worth building, but:
- If the exact `(program, kull)` is not in `publishedYears`, fall back to the
  **nearest published cohort** with a mono note ("Studieplan for kull 2026 ikke
  publisert — viser 2025"), never a blank planner.
- Derive the period from `periodNumber` matching by **`startTerm` + intake
  year**, and when `startTerm`/`periodNumber` is null, **default to period 1 and
  let the user pick the semester chip** rather than compute a wrong period.
- "Obligatory" pre-fill = courses whose `studyChoice.code` looks obligatorisk
  **plus** everything not clearly in a choice group; label it "foreslåtte
  emner, juster selv" — never present it as authoritative enrolment.

---

## F6 — "Legg til alle" / bulk-add and credit totals inherit null-credit and planElement holes

> §5 SHOULD: "bulk-add above prose"
> §6 MUST(4): "`planElement` filtering on bulk-add (but 0-sp real courses stay)"
> §5 MUST: "credit total"

**Reality.** `PlannedCourse.planElement` (programs.ts:86) correctly flags
non-course rows (work-experience etc.) — the draft handles this. But
`credits` is `number | null`, and the *authoritative* credit number for a
course lives on the **course details** (`CourseDetails` fact box), not always on
the plan row. A plan-driven bulk-add can produce a basket where several courses
have `credits: null` until details load. "22,5 av 30 sp" then flickers or
under-counts.

**Honest fix (small).** Credit total must be **async-aware**: sum known
credits, render "22,5 av 30 sp (+ 2 emner uten oppgitt studiepoeng)" until
details resolve, and source the number from course details when the plan row's
`credits` is null. This is buildable — just name it, so the "live credit total"
MUST isn't quietly wrong on first paint.

---

## F7 — Shared-plan URL: feasible, but the hash schema must be frozen *now* or every feature breaks it

> §4: "**URL is the state**: `#26h;committed;shortlist` … `?mot=` … `?kull=`"
> §8.1: "`PlanState` → `v:2`"

**Reality (not a data gap — a discipline gap).** This is architecturally our
*strongest* card (localStorage + hash, no server). But the draft accretes hash
segments (semester; committed; shortlist) and query params (`?q ?sted ?språk
?type ?mot ?kull`) across six flows with **no versioning byte in the hash**.
PLANNER.md's current hash is `#26h;TDT4100,TMA4100`. Adding a shortlist tier
and per-course versions (F4) changes the grammar; an old shared link opened in
a new build must not silently drop the shortlist or misparse versions as codes.

**Honest fix.** Freeze a hash grammar with an explicit version token *before*
building shortlist/version (e.g. `#v2;26h;committed=…;shortlist=…`), and define
forward/back-compat parse (v1 `#26h;CODES` still loads as committed-only). Add
"hash schema version" to the domain rules. Cost is trivial; the cost of *not*
doing it is silent data loss on shared links — the one feature that's supposed
to be our moat.

---

## F8 — Timetable-publish lag makes the "grid" the fragile default; pre-publish mode must be the *real* default, not a fallback

> §5 MUST: "designed pre-publish mode"
> §3 flow 4: "grid (not flat list) + season-split grade shape"
> §8.4: "next plannable term … the site is provably forward-looking"

**Reality.** `Semester.timetablePublished` (models.ts:402) is false for most
of the window when Velgeren actually plans (electives are chosen *before* the
Feb-1/Sep-15 deadline, and timetables "publish shortly before semesters").
`courses.timetable(code, year)` for an unpublished term returns `[]` (empty
`summarized`). So the draft's headline artifact — the merged weekly grid with
red-ink clashes — is **empty exactly when the core user (elective chooser for
next term) needs it.** The conflict engine has nothing to chew on.

**Honest consequence + fix.** The "next plannable term" default (§8.4, correct)
*guarantees* we land on an unpublished-timetable term much of the year. So:
- Pre-publish mode is **not a graceful fallback, it is the primary experience
  for the flagship persona.** It must carry real planning value with *no grid*:
  exam-date ribbon (catalog dates exist pre-publish), credit total, grade
  shape, assessment mix, campus/language — all available without a timetable.
- The clash engine degrades to **exam-clash + campus-spread only** in
  pre-publish mode; state it plainly ("Timeplan ikke publisert — viser eksamener
  og studiepoeng. Timeplankollisjoner kommer når timeplanen er klar"). Do not
  build the product's success metric ("did the student leave sure?") on a grid
  that is blank for the chooser.
- Consider defaulting the chooser to the **most recent *published* year's grid
  as an indicative preview** ("timeplan fra 2025 som pekepinn") — feasible
  (`publishedYears`-style gating), honest if labeled non-authoritative.

---

## Cross-cutting: the "join no one else owns" is real, but three of its columns are soft

The positioning (§1) — catalog + timetable + exam + study-plan + grade as one
object — is genuinely our moat and *is* buildable. But be honest that of the
five joined columns:
- **timetable** is absent much of the planning window (F8) and group-blind (F1),
- **study-plan** carries no choice cardinality (F2),
- **grade** joins on a different code space (F4).

The join still delivers value (no incumbent composes even the reliable subset),
but the draft oversells the *precision* of the composite. Position it as
"assemble and sanity-check," not "the app knows whether your semester is valid."

---

## Summary of downgrades (what to change in PRODUCT-draft.md)

| Draft claim | Status | Honest version |
|---|---|---|
| øving-group clustering, "no alternative avoids clash" (MUST/P0) | **Cut** | Lecture-only hard conflicts (MUST); øving/lab as muted non-clashing display label (SHOULD). No group-alternative logic — no data for it. |
| "velg 2 av 5" satisfaction / commit-at-30sp validation | **Downgrade** | Shortlist state + credit running total + verbatim group prose. App never asserts "group satisfied." |
| Exam ribbon from scraped `CourseExam.date` | **Re-source** | Ribbon from catalog `ExamDate` (date + continuation); scraped exam only enriches popover; `dateText`-only → "dato ikke satt" bucket. |
| "version threading through `PlanState.courses[]`" (already `{code,name}`) | **Specify** | Add `version` to PlanState + every API call + hash (when ≠"1"); grade join = bare-code prefix, aggregate versions. |
| First-year period math `(semYear−cohort)×2+…` | **Guard** | Fall back to nearest `publishedYears`; honor `startTerm`; default period 1 + user chip when null. |
| Live credit total | **Async-aware** | Show "+N emner uten sp" until details load; source from details when plan `credits` null. |
| URL is the state (accreting segments) | **Freeze grammar** | Versioned hash token now, v1-compat parse, before shortlist/version land. |
| Grid as headline artifact / pre-publish as fallback | **Invert** | Pre-publish (no grid) is the chooser's primary mode; grid is the bonus when `timetablePublished`. |

None of these kill the product. They convert confident-but-false features into
honest-and-useful ones. The two that are *correctness bugs* if shipped as
drafted (not just overclaims): **F1** (engine lies on lab-heavy courses — the
draft admits this but prescribes an equally-unbuildable fix) and **F4**
(re-versioned courses show wrong grid/exam data). Fix those two first.
