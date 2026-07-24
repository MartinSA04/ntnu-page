# P9 — NTNU domain expert: stress-testing the planner against reality

Lens: does the product model NTNU's actual academic machinery correctly, or
does it quietly lie to students because the naive version of a feature
looked right in a demo with 2 courses and no øving groups? I read
`ntnu-api`'s actual models (`src/models.ts`, `src/coursepage.ts`,
`src/programs.ts`) to ground every claim in the real data shapes, not
assumptions about what NTNU "should" provide.

Verdict up front: the current `/planlegger/` conflict engine as specced in
PLANNER.md §3 (`conflicts.ts`: pairwise, same `dayNumber` + time overlap +
week intersection) **will produce false-positive conflicts on real student
plans at a rate that makes the tool untrustworthy**, because it treats every
`TimetableEntry` as something the student must attend. It isn't. This is the
single highest-priority domain fix. Everything else below is secondary but
real.

---

## 1. The øving-group trap (P0 — breaks the core feature's credibility)

**The reality**: a course's weekly timetable is not "the course's schedule."
It's every scheduled activity for every group, all merged into one course
code. A typical programming course has:

- 1× forelesning (everyone, 2× per week)
- 6–15× øvingsgrupper ("group 1", "group 2", ... — same time slot,
  different rooms, sometimes different times too) — **a student attends
  exactly one**
- Possibly separate lab sessions, same pattern
- Possibly a "kollokvie" or seminar track with its own grouping

`TimetableEntry` (the summarized grid ntnu-api's `courses.timetable()`
returns) gives you `name`, `title`, `acronym`, `dayNumber`, `startTime`,
`endTime`, `weeks`, `rooms[]` — **but no structured field distinguishing
"lecture, attend-all" from "exercise group, attend-one-of-N."** The only
signals available are free-text `name`/`title` (often things like "Øving
gruppe 3" or just a room/acronym) and the fact that N entries share the same
day/time-window with different rooms.

**Why this breaks conflict detection as specced**: PLANNER.md's engine does
"pairwise over selected courses: same dayNumber + time overlap + non-empty
week intersection ⇒ Conflict." If Course A has 8 øving-group slots on
Tuesday 14:15–16:00 (group 1 in room X, group 2 in room Y, ...) and Course B
has a lecture Tuesday 14:15–15:00, the naive engine reports **8 separate
conflicts for the same actual scheduling question** ("can I attend B's
lecture and still make it to one of A's exercise groups?" — usually yes,
since you pick a group, but the UI will scream 8 red collisions). Worse: two
courses that are each fine individually will show a wall of collisions
between their respective exercise-group fan-outs, burying the one real
lecture/lecture clash a student actually needs to see.

**What must change**:
- **Group entries by (name/title/acronym cluster) before conflict-checking,
  not raw entries.** Heuristic: entries sharing course+day+near-identical
  time window are candidate members of one "activity" whose N rooms are
  alternatives, not additions. Cluster key ≈ `courseCode + dayNumber +
  startTime + endTime` (ignoring room) — same-time same-duration repeats are
  almost always parallel sections of one activity, not distinct
  obligations.
- **Only flag a conflict as certain when there is no non-colliding choice
  among alternatives.** If Course A has 8 group slots on Tuesday and at
  least one doesn't collide with Course B's lecture, that's not a hard
  conflict — it's "you'll need to pick group 2, 4, or 7." If literally every
  alternative in the cluster collides, that's a hard, always-true conflict
  worth red ink.
- **Lectures (forelesning) are attend-all and should be treated as hard
  obligations**; distinguishing them from groups by text pattern-matching on
  `name`/`title` (Norwegian keywords: "forelesning", "øving", "øv.",
  "gruppe", "lab", "seminar", "kollokvium") is a defensible heuristic layer,
  imperfect but far better than none. Ship a keyword table, expect misses,
  and when a cluster can't be classified, treat it conservatively as
  "multiple sections, pick one" (fewer false alarms is the safer failure
  mode than crying wolf on every group-heavy course).
- **This is a "may simplify but must not skip" rule.** You do not need a
  perfect classifier. You need to stop reporting N-of-N conflicts when the
  true obligation is 1-of-N. Even a crude "cluster by identical time window,
  require room-count ≥ 2 to call it a group" heuristic removes the worst
  noise.

If this isn't fixed, the planner's signature feature (red ink = don't trust
Studentweb blindly) becomes the thing that erodes trust in the planner
itself — a CS student who knows their øving groups don't actually clash
will stop believing the red ink at all, including for the real lecture
clash three courses later.

## 2. Par/odde (even/odd) week patterns — must model, cannot skip

`TimetableEntry.weeks` is a list of ISO week range strings ("2-13", "36")
that `weekNumbers()` expands to a flat integer list — **there is no
even/odd flag**; NTNU's par/odde pattern shows up as *disjoint week lists*,
not a boolean. A course meeting only on odd weeks in the 14-week span
already looks like `["3","5","7","9","11","13"]` (or similar) once expanded.

This is good news structurally (the existing week-intersection check in
`conflicts.ts` already handles it correctly *if* it operates on expanded
week numbers, not on range strings) but it's a trap for the UI: **two
courses that occupy the identical timeslot but on alternating weeks
(A on odd, B on even) never actually conflict**, and the weekly-grid render
must not draw them as if permanently overlapping. The spec's plan to "split
side-by-side" overlapping blocks is right for true concurrent overlap but
**wrong for alternating-week courses** — those should render as the *same
grid cell*, distinguishing week ranges in the block's mono "uke 35–41"
annotation (per PLANNER.md's own block format) rather than as a fake
side-by-side split that visually implies a room-choice problem that doesn't
exist. Get the week-intersection math right (it mostly will be, since it's
already spec'd to intersect weeks) but audit the *rendering* path
separately — rendering can regress this even when the conflict math is
correct, because "these two blocks occupy the same day/time" is a rendering
question independent of "do their weeks overlap."

## 3. Multiple exam occasions, kont/utsatt, and dateless exams

`catalog.json`'s `exams[]` (from `CourseSearchHit.exams`, `ExamDate[]`) and
the richer per-course `CourseExam[]` from `coursepage.ts` both model exams
as **arrays**, because a single course-in-a-semester routinely has more than
one exam record:
- Ordinary exam (`continuation: false`)
- Kont/utsatt (continuation exam, `continuation: true`) — happens in
  **August**, i.e. in the *next* semester's calendar window, for a course
  that was taught the semester before. A course's April kont-exam belongs
  to the previous autumn's offering, not the current spring's.
- Multi-part assessments: `CourseExam.weighting` ("2/3", "100/100") means
  **one course can have 2–4 separate `CourseExam` rows that are all part of
  the same overall grade**, not independent exams to individually flag as
  "collisions." A student doesn't choose between them; they do all parts.
  The exam-collision engine must know the difference between "two rows
  because it's a two-part assessment of the same course" (never a conflict
  with itself) and "two rows because ordinary + kont" (kont should probably
  be filtered out of the semester timeline entirely, or clearly bucketed
  separately — a kont exam sitting in the same semester's date list as
  everyone else's ordinary exams is confusing).
- **Dateless exams are common, not an edge case.** `CourseExam.date` is
  frequently `null` even when `dateText` carries something like "Utlevering
  07.11.2025" (a home-exam "arbeider" release, not a sit-down date) or
  simply isn't published yet. The catalog-level `ExamDate.date` can also be
  `null` while `season` is set. **The exam-timeline UI (PLANNER.md's
  EKSAMENER ribbon) needs an explicit "dato ikke satt" state for these,
  distinct from "no exam" — do not silently drop them from the plan's exam
  section**, because a 0-date home-exam still consumes a chunk of the
  semester (often the busiest weeks) even without a ribbon dot.

**What the product must get right**: exam-conflict detection should only
compare *ordinary, single-occasion* exam dates within the *selected*
semester — filter continuation exams out of the main timeline (surface them
only if a student explicitly needs kont, which the product doesn't know and
shouldn't guess), and collapse multi-part same-course rows into one
timeline entry (their internal weighting is irrelevant to the "does this
clash with another course's exam" question — they never clash with
themselves). **May simplify**: don't try to model exam-part scheduling
within a course (e.g. "innlevering 1 of 3 in week 44") — that's assignment
granularity, not semester-planning granularity, and the "obligatoriske
aktiviteter" free-text field is the honest place to point students for that
level of detail rather than trying to structure it.

## 4. Versioned course codes — silent wrong-data trap

Course codes carry a version suffix upstream (`TDT4120-2` etc.;
`CourseSearchHit.courseVersion`, `PlannedCourse.version`), and
`courses.timetable()`/`courses.schedules()` in ntnu-api **default to
`version: "1"` when not given explicitly**. A study plan's `PlannedCourse`
carries its own `version` field precisely because a course referenced from
an old kull's plan may be a different version than what the catalog
currently calls "the course." If the planner's `data.ts` always calls
`GET /api/course/:code/timetable?year=` without ever threading a version
through, **a re-versioned course silently returns version-1's timetable**
— which may be stale, wrong days, or simply not exist for that year. This
is invisible: no error, just quietly incorrect data rendered with full
confidence in red/green ink.

**Must handle**: when a course enters the plan via a study-plan add
(`/studier/[code]` → add from a `PlannedCourse`), carry its `version`
through into the plan state and the timetable/details fetch. When a course
enters via free search/`/emner/`, the catalog's `courseVersion` should be
threaded the same way. **This needs a `version` field added to
`PlanState.courses[]` entries** (currently `{ code, name }` per PLANNER.md
§3) or the worker needs a documented default-version fallback path that at
minimum doesn't fail silently. This is a real gap between the current
`store.ts` shape and correctness — worth flagging to the lib-owning agent
directly, not just noting here.

## 5. Kull math, periodNumber, and "which semester am I actually in"

PLANNER.md already sketches the right formula in §5 (`period n = (semYear −
cohort) × 2 + (autumn ? 1 : 2)`) for highlighting "your semester" in a study
plan — good, keep it, it's the correct NTNU convention (semester 1 = intake
autumn, counts continuously including summers-as-non-periods). Two
additions:

- **`StudyPlanPeriod.periodNumber` is raw upstream data, not guaranteed
  contiguous or 1-based-clean** — `programs.ts` types it as
  `number | null`. Do not assume `periods[i].periodNumber === i + 1`; index
  by the field, not by array position, and handle a `null` gracefully (some
  plan elements print without a clean period number, e.g. programs with
  flexible/self-paced tracks or exchange-semester placeholders).
- **`publishedYears` gates what cohorts even have data** — a first-year
  kull's plan for semesters 5–10 legitimately doesn't exist yet (published
  year by year as `programs.ts`'s docstring notes). The UI must say "ikke
  publisert ennå for dette kullet," not render an empty course group as if
  the program has no courses that semester. This affects the "Start fra et
  studieprogram" empty-state flow directly — a fresher clicking their own
  kull for semester 3 in July of year 1 may hit exactly this gap.

## 6. Retninger (waypoints) nest recursively — don't flatten too early

`StudyWaypoint.directions: PlanDirection[]` and `PlanDirection.waypoints:
StudyWaypoint[]` are mutually recursive in the actual model — a
specialization choice can itself contain another specialization choice
further down the plan (e.g. choose a "hovedprofil" in semester 5, which
then offers a narrower "fordypning" choice in semester 7). `planCourseCodes()`
in ntnu-api already walks this correctly (recursive `visitDirection`), which
tells you the *library* expects consumers to handle arbitrary nesting depth,
not a fixed two-level "program → retning" model.

**Trap for the study-plan UI**: if `/studier/[code]`'s renderer assumes
"one waypoint = one flat list of alternative retninger, pick one, done," it
will mis-render programs with nested choices (not uncommon in 5-year
sivilingeniør programs with a hovedprofil→fordypning structure) — either
crashing on unexpected shape or silently truncating the tree. The DESIGN.md
"nested `.sc-summary` disclosures" approach (SPEC.md's page description)
is structurally the right instinct — disclosures nest naturally — just
confirm the renderer is written recursively against `PlanDirection`, not
hand-unrolled to two levels.

**Also**: `StudyWaypoint.deadlineDate` exists and matters practically —
students choosing a retning/fordypning have a real deadline before which
the choice is reversible in Studentweb. Surfacing that date next to the
choice point (even just verbatim, no cleverness) is a small, high-value
addition squarely inside the "thinking tool upstream of Studentweb" mission
— it's exactly the kind of deadline students lose track of.

## 7. planElement, 0-sp courses, and credit-total honesty

`PlannedCourse.planElement: boolean` marks **non-course plan rows** — e.g.
HMS (safety) requirements, work-placement/praksis requirements, or other
administrative plan entries that are not "emner" in the catalog sense.
ntnu-api's own `planCourseCodes()` helper explicitly filters
`!course.planElement` when computing addable course codes — meaning the
library authors already learned the hard way that these rows break naive
"add all courses in this group" logic if not filtered.

**The product must**:
- Filter `planElement` rows out of "legg til alle"-style bulk-add actions
  (PLANNER.md §5 specs exactly this feature on period headers — it must
  reuse or replicate this filter, not reinvent it and miss the case).
- **Separately, real 0-credit-point courses do exist in the catalog itself**
  (some HMS/ethics courses are pass/fail 0 sp course codes, not
  `planElement` rows) — these are legitimate courses with real course pages
  and timetables, just contribute 0 to the "X av 30 sp" tally. Don't
  conflate "0 sp" with "should be filtered" — a 0-sp HMS course a student
  actually adds to their plan should still show its timetable slot (it's
  often a single mandatory session) and still count as "in the plan," just
  contribute 0 to the credit sum. The credit-sum math already naturally
  handles this if `credits` is just summed (0 adds nothing), so this is
  more a "don't accidentally special-case 0 out of existence" warning than
  a build item.
- **x.5-credit courses are common, not rare** (7.5 sp is the standard
  single-course size; the credit total for a full load is usually built
  from four 7.5s). PLANNER.md already specifies comma-decimal display
  ("22,5 av 30 sp") — correct, keep it, and make sure summation is done in
  a way that doesn't accumulate floating-point drift over a 12-course plan
  (sum in half-point integer units — multiply by 2, sum, divide — rather
  than raw float addition of repeated 7.5s; cheap insurance against a
  "22,499999999999996 sp" bug).

## 8. Course-page scraping fragility bleeding into the plan (assessment/exam text)

Everything from `coursepage.ts` — `assessmentScheme`, `mandatoryActivities`,
`CourseExam.*` — is **regex-scraped HTML off an internal, unversioned
Liferay surface**, explicitly documented as such in the module's own
comments (fixtures + "daily live drift check"). This isn't a reason to
distrust the data day-to-day, but it is a reason the product should:
- Treat every free-text field (`assessmentScheme`, `duration`, `aidCode`,
  `dateText`) as **display-only prose, never as something the UI parses
  further client-side.** E.g. do not attempt to regex "4 timer" vs "4 uker"
  client-side to distinguish school exam from take-home duration — that's
  exactly the kind of re-parsing that breaks silently when NTNU's template
  text changes upstream of a scrape the crawler already handled once.
  `CourseExam.form` (e.g. "Skriftlig skoleeksamen", "Hjemmeeksamen") is the
  correct field to branch UI behavior on, not duration text.
- **`notices[]` (course-portlet alert banners) is an underused signal** —
  things like "Det tilbys ikke lenger undervisning i emnet" (course
  discontinued) or assessment-subject-to-change-until-a-date banners are
  exactly what a planning tool should surface prominently next to a course
  a student is about to add, not bury in the details page. A discontinued
  course silently sitting in someone's plan basket because they added it
  from an old kull's study plan is a real, avoidable failure mode this data
  already flags.

## 9. Semester numbering vs. calendar year — the "which year's catalog" question

`courses.timetable(code, year)`/`schedules(code, year)` take a plain
4-digit `year`, but NTNU's semester id scheme (`"26h"`, `"27v"`,
`Semester.year`) associates one integer year with *both* the autumn and the
following spring in different ways depending on context (a `"26h"`→`"27v"`
academic year pair both key off different `year` values upstream). The
existing `semesterYear("26h") → 2026` helper in PLANNER.md's `schedule.ts`
spec is the right idea — just make sure every call site that needs "the
catalog/timetable year for this semester id" goes through that one function
rather than each page re-deriving it ad hoc, because getting spring's year
off-by-one silently fetches an empty or wrong-year timetable (no error —
`courses.timetable()` for a valid code+wrong-year often just returns an
empty/near-empty entry list, which reads as "not taught this semester," a
plausible-looking wrong answer).

---

## Priority ranking (must-fix vs. may-simplify)

**Must model correctly before the planner is trustworthy:**
1. Øving-group clustering in conflict detection (§1) — without this the
   headline feature is noisy to the point of being wrong more often than
   right for any lab-heavy course (most of NTNU's technology programs).
2. Continuation/kont exam filtering + multi-part exam collapsing (§3).
3. Dateless-exam explicit state, not silent drop (§3).
4. `planElement` filtering on bulk-add (§7) — direct reuse of a bug
   ntnu-api's own authors already had to fix once.
5. Version threading for re-versioned courses (§4) — currently a gap
   against the `PlanState` shape as specced; flag to the lib agent.

**Should get right, moderate effort:**
6. Par/odde week rendering (not math — math is likely already fine; audit
   rendering) (§2).
7. Recursive retning/waypoint rendering, not hand-unrolled two-level (§6).
8. `publishedYears`/missing-period messaging for young kulls (§5).

**May simplify, but don't accidentally break:**
9. 0-sp and x.5-sp courses — mostly "don't special-case them away";
   floating point summation is the one concrete action item (§7).
10. Waypoint deadline dates — nice-to-surface, not launch-blocking (§6).
11. Course notices (discontinued/subject-to-change banners) surfaced at
    add-time — high value, low cost, not structurally risky (§8).

**Explicitly fine to leave as prose, never parse further:**
- Assessment/exam free text beyond the structured `form`/`weighting`
  fields (§8) — the crawler/scraper already did the hard parsing once;
  don't re-parse client-side.
- Assignment-level exam-part scheduling within a course (§3) — semester
  granularity, not assignment granularity.
