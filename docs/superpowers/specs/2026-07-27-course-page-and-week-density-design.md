# Course page + week density — 2026-07-27

Second pass on the user's mandate. Five items, four of them subtractive or
tabular, one (the week) a real change of approach. Ethos unchanged: a utility,
as simple as possible.

## 1. Remove the "se ukeplanen →" link

Two copies, both deleted:

- `src/pages/emne/[code].astro` — `#emne-plan-link` beside "Legg til i planen".
- `src/pages/emner/index.astro` — the same copy set on each row's plan link
  after an add (`planLink.textContent = "se ukeplanen →"`).

The topbar studieinfo chip already links to the week from every page. This was
noise next to the button that just did the thing.

## 2. Studiepoengreduksjon becomes a table

`renderCreditReductions` (`src/components/site/courseDetails.ts`) currently
emits `<ul>` rows reading `IT1104 — 7,5 sp` / `TDT4102 — 3,7 sp (Høst 2008)`.
TDT4100 shows eleven of them, three of which are the identical string
`SIF8005 — 7,5 sp` repeated, because upstream carries one row per version with
a null `fromTerm`.

Replace with a three-column table — **Emne · Reduksjon · Gjelder fra** —
sorted by course code, and de-duplicated on the `(courseCode, reduction,
fromTerm)` triple so the three identical SIF8005 rows collapse to one. A
missing `fromTerm` renders as an em dash, not "(null)" and not a dropped
column.

## 3. Grade distribution — a new section on the course page

The worker already serves `/api/course/:code/grades` (cached, `GRADES_CACHE_TTL_MS`)
and **nothing in the UI has ever consumed it**. Rows are
`GradeRow { courseCode, year, semester, semesterName, grade, total, women, men }`
— one row per (version, year, semester, grade).

### Form

Small multiples: one simple bar chart per semester, newest first, up to six.
Each chart is grades on the x-axis (A–F, or whatever codes the course
actually reports — pass/fail courses ship `G`/`H`, not letters) and share of
candidates on the y, on a **y-scale shared across all shown semesters** so the
charts are comparable to each other.

Rejected: a 100 %-stacked bar per semester. Six adjacent segments need six
distinguishable colors, and the skill's validator failed that palette outright
— worst adjacent pair ΔE 6.9 normal-vision, far under the 15 floor. Small
multiples need **one** color for the whole figure, so the problem does not
arise.

### Color

One hue, `--hue-blue`, straight from `tokens.css` — already theme-aware
(`#205ea6` light, `#4385be` dark). Both validated against their own surface:
all six checks pass in both modes.

**Not red for F.** `docs/DESIGN.md`'s Red-Is-Collision reserves red for
coexistence failures and nothing else; a fail bar is not a collision.

### Labels

Every bar carries its own percentage above it, so the figure needs no y-axis
at all — six bars is not a dense series, and the labels double as the
accessible table view. Each bar has an `aria-label` naming grade, count and
share.

### States

Loading, "ingen karakterdata" (DBH has nothing — common for new or tiny
courses), and fetch failure each get one honest line. Small counts are
privacy-masked upstream (`total: null`); those render as a gap, never a zero.

## 4. The week, when several things overlap

Two problems, visible in a screenshot of MTDT kull 2026 with øvinger on: **41
blocks in one week**, and course codes breaking *one character per line*
(`T D T 4 1 0 9`) because `.planner-block-code` sets `overflow-wrap: anywhere`
and a third column is ~35 px wide.

### 4.1 Two columns, then a pile

`MAX_COLUMNS` drops 3 → 2, so no block is ever narrower than about half a day
column. A cluster that would need a third column is not split at all: the
whole cluster collapses into **one pile block** spanning the cluster's own
start→end, listing each course code on its own line. Clicking it opens the
existing block popover with every entry in the pile.

`LayoutSlot` grows two fields: `cluster` (an index, so the renderer can group
a pile's members) and `piled` (this cluster draws as one block). The greedy
column packing is unchanged for clusters of 1–2.

This replaces the "+N til" overflow chip for the ≥3 case: a pile that names
its courses beats a chip that hides them behind a count.

### 4.2 The øving/lab layer shows only groups you picked

"Vis øvinger og labber" currently draws every published group — EXPH0300 alone
contributes nine seminar groups at nine different times. That is the cohort's
timetable, not the student's.

New behaviour: with the toggle on, a course's øving/lab entries draw **only if
the student has explicitly picked a group** for it (`course.groups` names a
non-lecture key). For every course that has such groups but no pick, the grid
emits one margin note — "EXPH0300 har 9 øvingsgrupper — velg din" — whose
click opens that course's group picker. Nothing is silently hidden.

A course whose øving entries are ungrouped (no group key at all) is unaffected
and still draws: there is nothing to pick.

## 5. Width

`--maxw` 72rem → **84rem**. One token; every `wide` page and the topbar,
count-line and footer that share the measure follow it.

`--measure` (38rem, the prose column) is deliberately unchanged — prose gets
harder to read as it gets wider, and DESIGN.md scopes the measure to prose.

## Testing

- `mise run check` — `layout.test.ts` carries MAX_COLUMNS = 3 assumptions and
  is rewritten for the 2-column + pile contract. New unit tests for the grade
  aggregation (rows → per-semester distributions, masked counts, non-letter
  grade codes).
- `mise run e2e` — new specs: the course page renders a grade figure; the pile
  block appears instead of three slivers; the øving toggle does not flood.
- Screenshot the result and look at it (the validator checks color, not
  layout).
