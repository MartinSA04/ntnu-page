# PLANNER.md — Semesterplanleggeren

The product pivot: ntnu-page is not a catalog mirror, it is a **planning
tool**. The single job: *"kan jeg ta disse emnene sammen?"* — pick a set of
courses (by search or from a program/kull), then see immediately whether
lectures clash, how exams are spread, and whether credits sum to a full
semester. Everything else on the site feeds this flow.

Binding alongside docs/SPEC.md and docs/DESIGN.md. Where this file and SPEC.md
disagree, this file wins (it supersedes the "Pages" section for the pages it
touches).

## 1. Product shape

- **The plan** is the central object: a chosen semester + a set of course
  codes + optional program context (program + kull). Persisted in
  localStorage, shareable via URL hash, alive on every page (the "add"
  buttons write to it from anywhere).
- **`/planlegger/`** is the app page where the plan is read: merged weekly
  timetable with conflicts, exam timeline with collision/gap warnings,
  selection list with credit total.
- **Entry paths**: (a) search-and-add from `/emner/` or the planner's own
  add field; (b) `/emne/[code]` "Legg til i planen"; (c) `/studier/[code]`
  study plan → per-course and per-period add, which also records the
  program/kull context.

## 2. Visual & interaction design

The design system is **Ruteark** (docs/DESIGN.md — designed for this site;
its named rules are law). The planner is the system's home turf:

**Signature — red ink on the squared spread.** The timetable is `.np-frame`
+ `.np-ruled`: a paper sheet with the faint squared ruling, blocks laid on
the grid like a hand-drawn timetable done neatly. When two courses collide,
the page marks the sheet in red ink: colliding blocks get a subtle red
hatch overlay (`repeating-linear-gradient`, `--clash` at low alpha over the
block fill), the course code inside gets `text-decoration: underline wavy`
in `--clash`, and a mono margin note under the grid reads like a correction:
"TDT4100 kolliderer med TMA4100 · mandag 10:15–12:00 · uke 35–41". No
warning triangles, no toasts — red ink on paper (Red-Is-Collision rule;
literal `--clash`/`--clash-bg`, never mixes). Same treatment for exam
collisions.

**Course identity**: each selected course gets one of the six `--hue-*`
categoricals in selection order (see hues.ts; green = accent, red =
collision, neither is a course hue). The mark is the square `.np-dot`
preceding the mono course code (tags, grid blocks, exam dots, list rows).
Never colored borders, never hue-tinted text (Adjudicated in DESIGN.md §8).

**Layout of `/planlegger/`** (wide column, stacked editorial sections, no
tabs):

```
PLANLEGGER (np-kicker)                 [HØST 2026][VÅR 2027]   ← .np-toggle
Semesterplanen din (display grotesk)               22,5 av 30 sp ← .np-data, live
┌ basket panel (.np-panel) ──────────────────────────────────┐
│ [▪TDT4100 ×] [▪TMA4100 ×] [▪TFE4146 ×]  [ + legg til emne ]│  ← .np-tag + .np-field
│ Fra MTDT, kull 2024 · 5. semester                (np-note, if program context)
└─────────────────────────────────────────────────────────────┘
UKEPLAN (np-kicker) ─ uke 34–47 (np-data)
[ .np-frame.np-ruled weekly spread: Mon–Fri columns, 08–20 rows, blocks
  = square hue dot + mono code (wavy-red when colliding) + name + rooms +
  "uke 35–41" mono; overlapping blocks split side-by-side ]
[ margin notes: .np-note-clash conflict lines, one per colliding pair ]
EKSAMENER (np-kicker) ─ 25. nov – 18. des (np-data)
[ ribbon on a .np-frame.np-ruled strip: horizontal date axis, mono month
  labels, one square dot per exam in course hue; same-day dots stack with a
  red ring + red-ink note ]
[ list: date — ▪code — exam form — gap annotation ("2 dager til neste") ]
EMNER (np-kicker)
[ rows: ▪code name · credits · campus · exam form · [Fjern] ]
```

**Empty state is an invitation**: "Ingen emner i planen ennå." + the add
field, a link "Søk i emnekatalogen", and "Start fra et studieprogram" with a
small program search that links to `/studier/[code]/`.

**States**: every async block renders a quiet mono "henter timeplan …" line
while loading; errors are one mono line stating what failed and what to do
("Fikk ikke hentet timeplanen. Prøv igjen om litt."). A course whose
timetable has no weeks inside the chosen semester gets a mono note
"Undervises ikke i valgt semester" on its rows (not red — it is information,
not an error).

**Motion**: standard tokens only (`--dur-fast`/`--dur`/`--ease`). Adding a
course lets its blocks fade/settle in over `--dur`; clicking a conflict note
scrolls to and `np-target-flash`es the block. Nothing else moves.

**Copy vocabulary** (consistent verbs everywhere, bokmål, sentence case):
"Legg til i planen" → state flips to "I planen · Fjern". "Fjern" removes.
"kolliderer med" for clashes. Credits always "X av 30 sp" (comma decimals:
"22,5"). Semester names as NTNU writes them ("Høst 2026"). The planner is
"planen" in all copy, the page title "Planlegger".

**A11y**: chips/toggles carry `aria-pressed`; grid blocks are focusable with
an `aria-label` ("TDT4100, mandag 10:15 til 12:00, uke 35 til 41, kolliderer
med TMA4100"); conflict notes are real links to block anchors; focus rings
are the system's 2px accent outline; the whole page works keyboard-only.

## 3. Data & engine (src/lib/planner/)

All pure TS, unit-tested, no framework. Files owned by the "lib" agent:

- **`store.ts`** — plan state + persistence.
  ```ts
  interface PlanState {
    v: 1;
    semesterId: string;            // "26h" | "27v" — Semester.id from semesters.json
    courses: { code: string; name: string }[];   // insertion order = hue order
    program?: { code: string; name: string; cohort: number };
  }
  ```
  localStorage key `ntnu:plan:v1`. API: `loadPlan()`, `savePlan(p)`,
  `addCourse`, `removeCourse`, `hasCourse`, `setSemester`, `setProgram`,
  `onPlanChange(cb)` (storage + custom event `ntnu:plan-change`, fires
  across components and tabs). Storage injectable for tests. Hash sync
  (planner page only): `#26h;TDT4100,TMA4100` — parse on load (hash wins
  over storage, so links are shareable), write on change.
- **`schedule.ts`** — time math. `parseWeeks(["2-13","15"]) → number[]`,
  `toMinutes("10:15") → 615`, `semesterYear("26h") → 2026`,
  `entriesInSemester(entries, teachingWeeks)` (intersects entry weeks with
  the semester's teaching weeks; empty ⇒ not taught this semester).
- **`conflicts.ts`** — the engine. Pairwise over selected courses:
  same `dayNumber` + time-range overlap + non-empty week intersection ⇒
  `Conflict { a, b, dayNumber, start, end, weeks }`. Exam analysis over
  `{ code, date }[]`: same-date ⇒ collision; 1-day gap ⇒ "tett" warning;
  output sorted by date with day-gaps computed. Both must be thoroughly
  unit-tested (edge: back-to-back 12:00/12:00 is NOT a conflict; disjoint
  weeks NOT a conflict; multi-exam courses; null dates skipped).
- **`data.ts`** — fetch + shape. Per course, in parallel:
  `GET /api/course/:code/timetable?year=` (grid) and `GET /api/course/:code`
  (credits, exams with date/time/form, assessment). Static tier for instant
  add/name/exam-dates: the search index (see §4). In-memory memoization per
  page load; tolerate individual failures per course (the page renders what
  it has, one error line per failed course).
- **`hues.ts`** — `hueForIndex(i)` cycling the six categorical custom
  properties by insertion order.

## 4. Crawler change (search index gains planner fields)

`public/data/search-index.json` entries become
`[code, name, location, exams]` where `exams` =
`[[season, dateOrNull], ...]` (e.g. `[["AUTUMN","2026-12-05"]]`) — compact
arrays, same file serves search page + planner (instant exam dates before
details load). Bump nothing else; transform tests updated accordingly.

## 5. Page work

- **`/planlegger/` (new, "planner-page" agent)**: one Astro page, wide
  Layout, one main island module orchestrating the sections per §2; DOM built
  with vanilla TS; grid via CSS grid (15-min row granularity, 08:00–20:00,
  Mon–Fri + Sat only when data demands); side-by-side split for overlapping
  blocks (2-way is enough; 3+ stacks by width). Semester chips offer the
  current + next two semesters from semesters.json (prefer ones with
  `timetablePublished`; mono note "timeplan ikke publisert ennå" when not).
- **Integrations ("integrations" agent)**:
  - `Layout.astro` nav: add "Planlegger" pill (first, before Emner/Studier).
  - `/` landing: re-pitch hero around the planner ("Planlegg semesteret.
    Se timeplankollisjoner og eksamensdatoer før du melder deg opp."),
    primary tile → `/planlegger/`; if the stored plan is non-empty, a mono
    line "Planen din: 4 emner · 22,5 sp" linking to the planner.
  - `/emne/[code]`: "Legg til i planen" (paper button `.np-btn`) near the
    title; reflects membership ("I planen · Fjern").
  - `/emner/` rows: trailing `.np-icon-btn` "+" quick-add (aria-label "Legg
    til CODE i planen"), flips to a checkmark when in plan.
  - `/studier/[code]`: each plan course row gets a small add control; each
    period header gets "Legg til alle"; any add from here calls
    `setProgram({code, name, cohort})`. Auto-highlight the period matching
    the planner's chosen semester for the selected kull (period n =
    (semYear − cohort) × 2 + (autumn ? 1 : 2); mono kicker "ditt semester").
- **Worker**: unchanged — existing endpoints cover everything.

## 6. Quality bar

`mise run check` + `npm run build` green; conflict/schedule engines have
real test coverage (not smoke tests); every interactive element has rest/
hover/focus-visible/press states per DESIGN.md; keyboard-only pass works;
`prefers-reduced-motion` honored via tokens; no console errors on any page;
Norwegian copy per the vocabulary above. The planner must be genuinely
pleasant with 0, 1, 6 and 12 selected courses.
