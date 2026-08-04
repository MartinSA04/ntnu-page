# One week, three surfaces — design

**Date:** 2026-08-04
**Status:** approved, not yet planned

`/planlegger/`, `/emne/[code]/` and `/user/<navn>` all draw a week. Two of them
draw a geometry the third abandoned. This closes that: **one week component,
mounted three times, with the same two views, the same blocks and the same
popover — and Rader deleted rather than relocated.**

---

## Why this is not "make the course page share a renderer"

It already shares one. `courseTimetable.ts:353` calls `renderGrid` from
`components/planner/grid.ts` — the planner's own module, the same
`planner-week.css`, the same hues, the same layer toggle and conflict engine.
There is no second renderer and never was.

The problem is that **`grid.ts` *is* Rader**. The planner's week moved to
`columnGrid.ts` (KOLONNER — days across, time down) and Rader was removed as a
view, but the module survived because two surfaces still drew through it.
`docs/DESIGN.md:321` records that as a decision. It is now reversed: nothing
draws Rader, so Rader goes.

A second premise recorded in `docs/DESIGN.md` §9 is simply wrong and is
corrected here. The course page's blocks were made inert — no tab stops, no
click, `data-static` on the frame — on the stated grounds that "the popover
edits the student's *plan*, and this page is a reference for one course."
`blockPopover.ts:2` says the opposite in its first line: *"A READ surface: the
facts of the session you pointed at, anchored to it, with a way through to the
editor rather than being the editor."* The card answers "what is this session",
which is exactly what a reference page owes a visitor. The withdrawal is
repealed.

---

## 1. `weekView.ts` — the week, as one thing

The view state, the Uke/Liste tab pair, the scroll/mask sync, the now-marker
tick, the layer-change choreography and the render switch are today inline in
`plannerApp.ts` (3 300 lines). They become one module three pages mount.

```ts
mountWeekView(options: WeekViewOptions): WeekViewHandle

interface WeekViewOptions {
  frame: HTMLElement;
  notes: HTMLElement;
  /** Where the Uke/Liste pair is built. */
  tabHost: HTMLElement;
  /** Which surface this is — the reservation key (§5). */
  surface: "planner" | "emne" | "user";
  /** The way out to the editor, or null where there is no editor (§6). */
  onOpenSettings?: ((code: string) => void) | null;
  signal: AbortSignal;
}

interface WeekViewHandle {
  render(states: PlanCourseState[], input: WeekRenderInput): WeekRenderResult;
  /** The message branches keep working through the same frame. */
  message(text: string | null): void;
  readonly view: WeekView;
}

interface WeekRenderInput {
  teachingWeeks: number[];
  showOthers: boolean;
  /** Every parallel and every group — the course page's rule (§3). */
  showAllGroups?: boolean;
  dates?: Map<number, number>;
  todayNumber?: number | null;
}
```

**What stays with the page**, deliberately: the message branches' *content*.
`/planlegger/`'s empty week can be a studieretning question, a period question,
an unpublished-semester card or "none of your courses are taught this term",
and those depend on plan state no shared component should learn. The page
decides what to say; `handle.message()` decides where it stands.

`plannerApp.ts` keeps `renderGridAndExams` — the exam list, verdict, credit line
and course rows are its own. It loses the week's plumbing.

## 2. `grid.ts` loses its geometry and keeps its judgment

`grid.ts` is two modules wearing one name. Besides drawing Rader it owns
`planGaps`, `unresolvedLectureChoices`, `lectureLessCourses`, `visibleLayer`,
`isDropIn`, `blockDetailFor`, `buildingLabel`, `metaLine`, `setScrollFade`, the
conflict count and every message branch. That is why `plannerApp.ts:1087` keeps
a `discardHost` and renders a complete week into it that nobody will ever see,
purely to collect the margin notes.

The judgment half becomes **`weekNotes.ts`**, with one new export replacing the
discard render:

```ts
weekNotes(
  notesHost: HTMLElement,
  states: PlanCourseState[],
  showOthers: boolean,
  options: WeekNotesOptions,
): WeekNotesResult   // { conflictCount, conflictPairCount, mutedLayerAutoRevealed, pendingGroupCourses }
```

`renderGridMessage` moves with it as `renderWeekMessage`.

**Deleted outright:** `renderGrid`, `buildGridShell`, the row/spine/bar builders,
the Rader skeleton, `fitBlockLabels`, `syncNowMarker`, and `GridEntry` (both
surviving views carry `SessionEntry`).

**`discardHost` is deleted.** It was a workaround for this file's shape, and the
shape is what changes.

## 3. `collectSessions` gets a `showAllGroups` bypass

`board.ts:103` calls `applyGroupSelection` unconditionally. With no picks and no
programme that is not a no-op — it still applies `resolveLectureDefaults`, which
narrows lectures to a default parallel. So **the column and list views cannot
currently express "every parallel and every group"**, which is precisely the
course page's rule (DESIGN §9: *"The course page's week is every parallel, and
it says so"*).

One option, threaded through:

```ts
collectSessions(courses, teachingWeeks, { showAllGroups }?)
renderColumnGrid(frame, courses, teachingWeeks, showOthers, { showAllGroups, … })
renderBoard(host, courses, teachingWeeks, showOthers, { showAllGroups, … })
```

The narrowing the "Bare min undervisning" switch performs stays where it is —
on the ENTRIES handed in, not on this flag. The flag states what the surface is;
the switch states what the student asked for. That distinction is already
documented in `courseTimetable.ts` and survives unchanged.

## 4. The course page hands over its own weeks

`renderColumnGrid` and `renderBoard` filter through
`entriesInSemester(…, teachingWeeks)`. The course page cannot pass
`semester.teachingWeeks`: `entriesForSemester` deliberately falls back to the
newest term the response carries when nothing intersects the planned semester,
and those weeks are by definition not teaching weeks of the planned one. The
fallback week would filter to empty and the page would draw nothing where it
used to draw last term's honest timetable.

It passes **the union of week numbers its drawn entries actually carry**, so the
filter is a no-op over entries `entriesForSemester` already narrowed. One
helper, beside `entriesForSemester`, tested on the off-term case.

## 5. Height reservations get a surface key

`--planner-box` is one variable holding one height per view, and the rules are
`#planner-grid-frame`-scoped by id *specifically* so a remembered Liste height
can never reach the course page's frame (CLAUDE.md states this). With three
surfaces sharing two views that guard has to move from the selector to the key.

- Storage becomes `(surface, view, width)`; `Layout.astro`'s pre-paint probe
  reads the surface from a `data-surface` attribute the page renders
  server-side, so it is known before any script runs.
- The CSS reservations key off `data-surface` + `data-view` instead of an id.
- `--planner-box-rader` and the bare `.planner-grid-frame` `min-height` are
  deleted along with the geometry they model.
- All Rader CSS goes: `.planner-grid`, `.planner-row`, `.planner-spine`,
  `.planner-block`, `--planner-spine`, `--planner-lane-h`, `--planner-bar-h`,
  `--planner-band-h`, `--planner-row-pad`, the `:has(.planner-grid)` pin rule
  and the `@media (max-width: 40rem)` Rader block.

**The formulas are evidence, not arithmetic.** Uke's fallback is exact
(`head + gap + 1px + hours × --planner-hour-h`) and carries over. Liste's is a
line fitted through real plans and was fitted on the planner's five-course
plan; a one-course course page needs its own. Both new surfaces are measured in
Chromium on the real stylesheets before a number is written, and each is set a
few px UNDER its measured settle so the residual nudges down.

`e2e/cls.pw.ts` gets budgets for `/emne/[code]/` and `/user/<navn>` in both
views. Per CLAUDE.md, a lease gate needs a **one-course** plan — a full plan
draws a week taller than every reservation, so slack is zero and the test passes
with the fix disabled.

## 6. The popover's edit button becomes optional

`mountBlockPopover(onOpenSettings, signal)` requires the callback and always
renders the button. `/emne/` and `/user/` have no course-settings modal to open,
so the signature becomes `onOpenSettings: ((code: string) => void) | null` and
the button is omitted when it is null. The card is then facts only: the session
named, Tid, Sted, and a Merk when there is something a clock cannot state.

`SessionChoice` is only consulted to word that button, so those two surfaces
never compute one.

## 7. What the three surfaces pass

| | `/planlegger/` | `/emne/[code]/` | `/user/<navn>` |
|---|---|---|---|
| states | the plan | one course | the shared plan |
| `showAllGroups` | never | always | never (the owner's picks are the point) |
| `teachingWeeks` | the semester's | the drawn entries' (§4) | the semester's |
| `onOpenSettings` | course settings | `null` | `null` |
| dates / today | inside the teaching period | inside the teaching period | inside the teaching period |
| tab host | `.planner-head` | `.timetable-controls` | beside the week heading |

**Dating is one rule, applied mechanically.** Inside the teaching period the day
headers carry the day-of-month and today gets its disc; outside it the numerals
come off and the week is a mønsteruke. That already governs `/planlegger/`, and
it is honest on the other two for the same reason it is honest there — the grid
draws a pattern week, and a numeral claims which Monday the column is, not that
everything under it happens. DESIGN §9's "`/emne/`'s reference week is nobody's
particular Tuesday" was a statement about Rader's `todayNumber` and is rewritten.

**The view choice is one fact, shared.** One `np:weekView`; pick Liste on the
planner and the course page opens in Liste. It is how you are looking at a week,
not what you are looking at, and a student who chose a list on a phone chose it
for weeks, not for one page.

## 8. `/user/<navn>` stops claiming a parity it lost

`publicPlan.ts:12` reads *"one renderer for three surfaces… so a shared week is
the same week the sharer is looking at"*. That stopped being true when the
planner moved to columns. After this change it is true again, and the comment
stays; before it, it is a lie in a docstring.

---

## What else moves

**Docs.** `docs/DESIGN.md` §9: the "Two views" paragraph loses its "grid.ts
survives" sentence; the course-page-week entry loses the inert-blocks paragraph
and its false premise; the mønsteruke rule is stated once for all three
surfaces. `docs/ROADMAP.md:70` ("with the third transposed geometry kept only
for `/emne/[code]/`"). `CLAUDE.md`'s layout-shift bullet — the whole
"transposed geometry alone" clause and the by-id scoping rationale, replaced by
the surface key. `planner-week.css`'s header comment, which still describes a
stack of day rows.

**Tests.** The four `renderGrid:` describes in `tests/planner/grid.test.ts` go
(transposed shell, bar geometry, lane stacking, one zone per day); their pure
halves move to `tests/planner/weekNotes.test.ts`. `e2e/flows.pw.ts` names Rader
on `/emne/` at lines 42, 662, 1721 and 1987.

**New tests, mechanism only** (CLAUDE.md's rule: a test whose failure means
"someone changed their mind" is transcription):

- an off-term course still draws a week on `/emne/[code]/` (§4);
- `showAllGroups` really shows every parallel through the column path (§3) —
  a unit test on `collectSessions`, since it is the thing that silently narrowed;
- the view choice round-trips across a ClientRouter navigation from
  `/planlegger/` to `/emne/[code]/`;
- CLS stays in budget on both new surfaces in both views, with a one-course plan.

---

## Order

1. `showAllGroups` through `collectSessions` / `renderColumnGrid` / `renderBoard`.
2. `weekNotes.ts` split out of `grid.ts`; `discardHost` deleted; planner still
   drawing exactly what it draws today.
3. `weekView.ts` extracted; `/planlegger/` mounts it and nothing changes on
   screen.
4. `/emne/[code]/` mounts it: tabs, popover, `showAllGroups`, its own weeks.
5. `/user/<navn>` mounts it.
6. Rader deleted — module, CSS, tests, docs.
7. Reservations re-measured; CLS budgets set.

Steps 1–3 are refactors with no visible change, which is what makes 4 and 5
small. Step 6 cannot happen before 5, and step 7 cannot happen before 6, because
the numbers it measures do not exist until the geometry is final.
