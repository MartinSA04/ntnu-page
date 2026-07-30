# PLANNER.md — Semesterplanleggeren

The product pivot: ntnu-page is not a catalog mirror, it is a **planning
tool**. The single job: *"kan jeg ta disse emnene sammen?"* — pick a set of
courses (by search or from a program/kull), then see immediately whether
lectures clash, how exams are spread, and whether credits sum to a full
semester. Everything else on the site feeds this flow.

Binding alongside docs/SPEC.md and docs/DESIGN.md, for the Ruteark
interaction/render detail below — the *file-and-function* architecture
(store → data → programPlan → renderers → plannerApp) and the crawled data
contracts are SPEC.md's, not restated here to avoid the two drifting.
**Corrected 2026-07-24**: several sections below described the pre-mandate
build (v1 plan state, a single-column layout, "Fjern" for every removal) and
had drifted from what actually shipped once PRODUCT.md §0 landed — fixed in
place rather than left stale, per the same docs-are-not-frozen instruction
that corrected PRODUCT.md §7.

**Corrected again, 2026-07-25**: a second user mandate (full spec:
`docs/plan/REWORK-2026-07-25-design.md`, recorded as PRODUCT.md's §0
addendum) rebuilt the grid, the exam view, the programme/kull/retning
editor and the nav. Sections below are patched in place for the specifics
that are now flatly wrong (the picker, the exam ribbon, `/studier/`, the
v2 hash); SPEC.md's `/planlegger/` architecture section is the current
source of truth for the full file-and-function detail, same as before.

## 1. Product shape

- **The plan** is the central object: a chosen semester + a set of course
  codes + optional program context (program + kull). Persisted in
  localStorage, shareable via URL hash, alive on every page (the "add"
  buttons write to it from anywhere).
- **`/planlegger/`** is the app page where the plan is read: merged weekly
  timetable with conflicts, exam timeline with collision/gap warnings,
  selection list with credit total.
- **Entry paths**: (a) search-and-add from `/emner/` or the planner's own
  add-course search modal (`addCourse.ts`, 2026-07-25 — replaces the old
  inline add field); (b) `/emne/[code]` "Legg til i planen"; (c) the
  studieinfo modal's Lagre (`studieinfo.ts`, 2026-07-25) — a **whole-period**
  commit that records the program/kull(/direction) context, not a
  per-course add. `/studier/[code]/` (which used to host "Bruk som planen
  min") is deleted outright, no redirect — the modal absorbed that
  semantics. DR-10's underlying rule is unchanged: adding a single course
  into a semester you are not planning is a bug factory, so the modal
  never exposes a per-course "+" either, only the whole-period commit.

## 2. Visual & interaction design

The design system is **Ruteark** (docs/DESIGN.md — designed for this site;
its named rules are law). The planner is the system's home turf:

**Signature — red ink on the ruled sheet.** *(Corrected 2026-07-27, audit
ds-1/ds-4 — this paragraph described a spread the code retired in f86105b.)*
The week carries **one hour hairline**, drawn by `planner-week.css` on
`.planner-grid-rail`/`.planner-grid-day`, and **neither `.np-frame` nor
`.np-ruled`** — the squared 15-minute field in both axes read as texture
behind the blocks, and `.np-frame`'s `overflow: hidden` fights the week's own
horizontal scroll. `.np-ruled--hours` does not exist any more at all; do not
reach for it (DESIGN.md §4/§5). What survives of the signature here is the
register: blocks laid on the grid like a hand-drawn timetable done neatly,
with the hour line anchored to the same box the slot grid starts at.

When two courses collide, the page marks the sheet
in red ink. *(Superseded in part: the per-block inline-start rule below is
gone, and with it the `--clash-edge` token. The collision is ONE zone per day
across exactly the minutes that overlap, drawn behind every lane it crosses —
the mark belongs to the moment, not to either course. See DESIGN §4 and
planner-week.css.)* A solid 2px `--clash-edge` inline-start rule on the colliding
block plus `--clash-bg` on the overlapping band only (not a hatch over the
whole block — that read at the same weight as the pastel course wash and
was barely separable), the course code keeps `underline wavy` in `--clash`,
and a margin note under the grid reads like a correction — grouped by
(day, overlap window), so a real 3-way clash is one note, not three:
"Torsdag 14:15–16:00 · TDT4160, TDT4136 og TMA4145 kolliderer · uke 34–46".
No warning triangles, no toasts — red ink on paper (Red-Is-Collision rule).
Same treatment for exam collisions.

**Course identity**: each selected course gets one of the six `--hue-*`
categoricals in selection order (see hues.ts; green = accent, red =
collision, neither is a course hue). The mark is the square `.np-dot`
preceding the mono course code (`.np-tag`/`.np-tag--sm`, grid blocks, exam
dots, list rows). Never colored borders, never hue-tinted text (Adjudicated
in DESIGN.md §8).

**Layout of `/planlegger/`**: a real `<h1>` (the programme name/code or
"Semesterplan"), a context line (kull · studieretning · resolved semester)
behind a "Bytt semester" disclosure rather than fold-weight chips, then a
two-column body — the week (the calendar-engine grid + verdict line + the
exam date list, 2026-07-25 — see below) at `minmax(0,1fr)` against a fixed
`20rem` course rail (course rows + credit line + "Legg til emne" opening
the add-course modal), collapsing to one column below the tablet breakpoint.
See SPEC.md's `/planlegger/` architecture section for the exact DOM ids and
the store → data → programPlan → renderers → plannerApp seam; it isn't
restated here because a second copy of the DOM contract is exactly what
goes stale first (which is what happened to the ASCII mockup this section
used to have).

**Empty states, corrected 2026-07-25** (superseding REVIEW.md B5's "empty
state is the picker" — the inline picker it describes is deleted): the
planner has four honest empty/fallback states instead of one picker —
no profile & no courses (a centered card: "Velg studieprogram" opens the
studieinfo modal, plus a secondary "…eller legg til emner med emnekode"
opening the add-course modal), profile set but the semester's timetable
unpublished, profile set but none of the plan's courses run this term, and
a fetch-failure state with its own copy and a retry button (never the
"publiseres i august" message for a failure that has nothing to do with
publishing — see design spec §3 for the fourth state's rationale).

**States**: every async block renders a quiet "henter timeplan …" line
while loading (or a skeleton grid, reserving the week's height, once
bundles are in flight — REVIEW.md U5); errors are one line stating what
failed and what to do. A course whose timetable has no weeks inside the
chosen semester gets a note "Undervises ikke i valgt semester" on its row
(not red — it is information, not an error) and is excluded from the
credit total (DR-10).

**Motion**: standard tokens only (`--dur-fast`/`--dur`/`--ease`). Clicking
a conflict note scrolls to and `np-target-flash`es the block, honoring
`prefers-reduced-motion` (falls back to an instant jump — REVIEW.md A5).

**Copy vocabulary** (consistent verbs everywhere, bokmål, sentence case):
"Legg til i planen" → "I planen". A programme course's removal is
reversible — "Dropp" → "Legg tilbake" — and gets a different verb from a
manual add's outright "Fjern" (PRODUCT.md §0.3, DESIGN.md §7 — using
"Fjern" for both used to make a reversible edit read as a delete).
"kolliderer med" for clashes. Credits always "X av 30 sp" (comma decimals:
"22,5"). Semester names as NTNU writes them ("Høst 2026"). The planner is
"planen" in all copy, the page title "Planlegger".

**A11y**: chips/toggles carry `aria-pressed`; grid blocks are focusable with
an `aria-label` ("TDT4100, mandag 10:15 til 12:00, uke 35 til 41, kolliderer
med TMA4100"); conflict notes are real links to block anchors; focus rings
are the system's 2px accent outline; the whole page works keyboard-only.

## 3. Data & engine (src/lib/planner/)

All pure TS, unit-tested, no framework. Files owned by the "lib" agent:

- **`store.ts`** — plan state + persistence + the hash grammar, **rebuilt
  2026-07-25 (unversioned, no compat parse)** — see SPEC.md's
  `/planlegger/` architecture section for the current, exact grammar and
  storage-key layout (`np:profile`/`np:plans`/`np:lastSemester`); not
  restated here to avoid the two drifting again. API: `loadPlan()`,
  `savePlan(p)`, `addCourse`, `dropCourse`, `restoreCourse`, `removeCourse`,
  `hasCourse`, `setSemester`, `setProgramPlan`, `setProgram`,
  `removeProgram`, `setCourseGroups`, `onPlanChange(cb)` (storage + custom
  event `ntnu:plan-change`, fires across components, tabs and the
  persistent nav's studieinfo chip). Storage injectable for
  tests. Hash sync: `parsePlanHash`/`formatPlanHash`, `hashchange`-aware so
  a pasted link applies live.
- **`layout.ts`**, **`groups.ts`**, **`examSchedule.ts`** — the
  2026-07-25 rework's pure engines (day-column layout, group/parallel
  selection, exam-list sort/gap math). Same "pure TS, unit-tested, no
  framework" rule as everything else here; see SPEC.md for their exact
  signatures rather than duplicating them in a second place.
- **`schedule.ts`** — time math. `parseWeeks(["2-13","15"]) → number[]`,
  `toMinutes("10:15") → 615`, `semesterYear("26h") → 2026`,
  `entriesInSemester(entries, teachingWeeks)` (intersects entry weeks with
  the semester's teaching weeks; empty ⇒ not taught this semester).
- **`conflicts.ts`** — the engine. Pairwise over selected courses: same
  `dayNumber` + time-range overlap + non-empty week intersection ⇒
  `Conflict { a, b, dayNumber, start, end, weeks }`, then `groupConflicts()`
  collapses pairwise conflicts sharing a (day, overlap window) into one
  `ConflictGroup` — a real 3-way clash is one group, not three pairs, which
  is what the verdict line and the grid's margin notes both count.
  `mergeParallelSlots()` folds byte-identical parallel entries (four
  identical "Lab" sessions) into one labelled group without losing a
  genuinely distinct one (two campuses at the same time). Exam analysis
  over `{ code, date }[]`: same-date ⇒ collision; 1-day gap ⇒ "tett"
  warning; output sorted by date with day-gaps computed. All of it is
  thoroughly unit-tested (edge: back-to-back 12:00/12:00 is NOT a conflict;
  disjoint weeks NOT a conflict; multi-exam courses; null dates skipped).
- **`data.ts`** — fetch + shape. Per course: `GET
  /api/course/:code/timetable?year=&version=` (grid, version-threaded —
  DR-4) and `GET /api/course/:code` (credits, exams, assessment). Static tier
  for instant add/name/exam-dates: the search index (§4 below).
  `indexForSemester()` narrows an index's exams to one semester's window
  before anything renders them (REVIEW.md C3). Tolerates individual
  per-course failures (the page renders what it has, composing the gap into
  the provenance line — DR-8) — and states *which* kind of gap it is:
  `TimetableOutcome` ("entries" / "empty" / "failed" + reason) is the
  authority for the week's verdict, and every failure carries a ready
  Norwegian sentence. Memoisation is per-part and failures are never cached.
  **See SPEC.md's `data.ts` bullet for that contract in full; it is not
  restated here to keep the two from drifting.**
- **`hues.ts`** — `hueForIndex(i)` cycling the six categorical custom
  properties by insertion order.

## 4. Crawler / search index

`public/data/search-index.json`'s row shape and the two-year catalog union
are SPEC.md's contract (`# Crawled data contracts`) — not duplicated here.
In short: each row is `[code, name, location, exams, version, offeredYears]`
(six elements; the first four are what this file originally shipped, the
last two were added for DR-4's version threading and REVIEW.md C1's
two-year union so a course absent from this year's catalog still renders
honestly).

## 5. Page work — status

`/planlegger/` and its integrations across `/`, `/emne/[code]/`, `/emner/`
are built (`/studier/[code]/` and `/studier/` were part of this list until
2026-07-25, when both were deleted outright — PRODUCT.md §0 addendum point
3). What actually shipped, and where it diverged from this file's original
plan, is tracked in `docs/ROADMAP.md`'s "Shipped" sections and
`docs/REVIEW.md` (the full-site review that fixed most of the divergences)
— this section is intentionally not a duplicate task list.

## 6. Quality bar

`mise run check` + `npm run build` green; `mise run e2e` green (now gates
CI on the planner/worker paths and every release — REVIEW.md T1); conflict/
schedule engines have real test coverage (not smoke tests); every
interactive element has rest/hover/focus-visible/press states per
DESIGN.md; keyboard-only pass works; `prefers-reduced-motion` honored; no
console errors on any page; Norwegian copy per the vocabulary above. The
planner must be genuinely pleasant with 0, 1, 6 and 12 selected courses.
