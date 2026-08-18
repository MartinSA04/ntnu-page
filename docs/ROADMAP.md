# ROADMAP.md — what is built, and what is left

Sequencing only. `docs/PRODUCT.md` decides *what* and has the authoritative
per-feature status table (§9); this file says what to do next and why in that
order. Do not re-litigate what PRODUCT.md §10 already decided against.

**Where the build stands.** The mandate's core — programme + kull → your week,
trivially editable — works end to end against live data. The design direction
is settled (`docs/DESIGN.md`), the week has two views and a scope picker, the
exam list is correct, and every course links out to `ntnu.no` and
`karakterweb.no` for everything this site deliberately does not answer.

**2026-08-18: the site was cut to a timetable getter.** Accounts, sync, the
shared plan, the course pages, the catalog page, the grade figure and the whole
verdict apparatus are deleted —
`docs/superpowers/specs/2026-08-18-timetable-only-reduction-design.md` is the
order and PRODUCT §11 is the list. Phases 3, 4 and 6 of this file went with
them: the growth loop had no mechanism left to grow through, and the
decide-loop presupposed grade figures and clash verdicts on our own surfaces.

---

## Shipped

Grouped by what it does, not by when it landed.

**The correctness floor.** Activity classification with DR-1's asymmetry, plus
the two measured classifier fixes that took zero-lecture course-terms from 35 %
to 20 % (bucket-as-title via a closed list; a *samling* read as the teaching it
is). Version threading through state and every API call. Exam dates from the
catalog, kont filtered by the client-side ISO-date join against the scraped
occasion. The exam window narrowed to the planned semester. The two-year
catalog union, so a course taught last year is still addable.

**The honest fetch (DR-8), which was once inverted.** `TimetableOutcome` keeps
"came back empty", "we could not ask" and "not fetched yet" apart, so a failed
fetch can no longer render as a free week: the line above the week says how
many courses it is missing, and the margin names them. Every failure carries a
ready Norwegian sentence; no upstream English reaches the UI. Memoisation is
per part and failures are never cached.

**The planner surface.** The studieinfo dialog, opened from the plan's own name
in the bar, is the only picker for programme, kull and retning, and the only
settings surface on the site; the semester is the planner bar's own select. One
editing surface per course (`courseSettings.ts`); a read-only session popover
on the bars, carrying the two outbound links; a catalog search modal for
adding, and it is the only search there is. Display-level parallel and øving
group selection, narrowed per *session family*. Three honest fallback states
including a real retry path.

**Onboarding and the empty states.** A plan-less `/planlegger/` is a first-run
screen and nothing else, gated on the pre-paint probe's own `data-plan`
absence, and reversible. The same picker hosts it under an `"on-kull"` commit
policy, so programme and kull are two presses and no Lagre. Eksamener goes
absent at zero active courses instead of printing a heading over an apology.
Sitewide, no `—` and no `·` reach a student, and no copy announces that the
week is finished; both are gated by `tests/copy.test.ts`.

**The calendar direction** (`docs/DESIGN.md`). Tokens on a white ground and a
four-job colour scheme; type on the platform UI face with every vendored font
deleted; six course hues assigned from the plan's code *set*. Two views, Uke
and Liste. One control bar at the top of the page. The week's own surface:
52 px hours, blocks carrying course and room only, a tinted øving layer, an
all-day row for drop-in windows, ISO week dating with a mønsteruke outside the
teaching period, and a whole-days width law expressed in CSS.

**Infrastructure and gates.** Worker: percent-decoded codes, two code grammars,
a fixed 502 body, an egress token bucket, a negative-cache sentinel with its own
short TTL, and sitewide security headers. CI: `ci.yml` on push/PR, `e2e.yml` for
the browser suite plus a nightly schedule, `release.yml` gated on e2e directly,
`crawl.yml` nightly. The browser suite replays recorded `/api/*` responses (a
miss fails the run in teardown) with live-upstream contract tests behind the
nightly schedule, and `cls.pw.ts` holds per-surface layout-stability budgets.

---

## Known-partial

Called out here so the next session doesn't re-derive them from a diff.

- **Pre-publish mode** (DR-2) is an *informed choice* — a semester chip for an
  unpublished term carries its own note — rather than the dedicated layout
  DR-2 describes.
- **Filters**: none. The city facets went with `/emner/`, and language and
  assessment were never built.

---

## What is left

Short, and deliberately so.

1. **DR-2's dedicated pre-publish layout.** The one MUST still marked partial.
2. **Mobile day-agenda restructure.** The Liste view and the week's whole-days
   width law cover much of what this was for; re-scope it before building.
3. **Day-load strip and free-day sentence** — which days are free, and where
   the semester's edges are. The last piece of "is this week livable" that
   survives the verdict's deletion, because it describes the week rather than
   judging the plan.
4. **Screen-reader summary of the drawn week**; recursive retning render;
   `publishedYears`/`periodNumber` gating (DR-5).
5. **COULD, and only with a reason**: par/odde single-cell rendering, English
   course names.

---

## Known-minor, deliberately deferred

- **`astro dev` shadows `/data/programs.json`.** Vite serves the project-root
  crawler record (~332 kB) in place of `src/pages/data/programs.json.ts`
  (~28 kB of tuples), so the programme typeahead throws
  `programOptions.filter is not a function` and finds nothing under
  `npm run dev`. The built site is correct, so `mise run e2e` is green and only
  hand-iteration is affected — but the first-run screen IS that typeahead now,
  so fix this before the next person iterates there.

- **The typeahead's meta line prints `trondheim` lowercase.**

- **`removeProgram()` prunes only the active semester's `np:plans` entry**, so
  a programme course can be orphaned in a *different* semester's stored plan.
  Harmless today because the orphan is still a real course the student can
  drop; it becomes wrong the moment programme-derived state means anything
  beyond "prefilled".

- ~~`e2e/cls.pw.ts`'s planner budget is flaky~~ — **root-caused and fixed
  2026-08-18, and it was never flakiness.** It was three predicates that all
  answered "is this terminal?" with "is a fetch in flight?" when the question
  is "has every course answered?", and the biggest of the three was also a
  lie the student could read. CLAUDE.md's lease section carries the three
  rules; the short version is that on a cold load in "Denne uka" the planner
  announced the week was empty, dropped the frame's reservation and hauled
  everything under it up ~270px, then refilled and put it back. Budgets go
  0.21 → under 0.03. Two things learned that are worth keeping:

  - **`--repeat-each` is NOT a valid way to measure this.** The worker's
    `RateLimiter(120, 15)` buckets on `CF-Connecting-IP` and every local test
    shares 127.0.0.1, so later repeats get throttled and fail for a reason
    that has nothing to do with layout. Measure with repeated single passes.
  - **The `layout-shift` entry's own `sources` is what turns "flaky" into a
    named element**, printed as `tag#id.class y:before->after h:before->after`
    under a `PerformanceObserver` with `buffered: true`. One trap: those rects
    are **clipped to the viewport**, so an element below the fold reports
    `h:0` and an element moving into view reports `h:0->116` — that is a
    720px-tall viewport arithmetic artifact, not the element being created.
    Reading it as creation cost an hour and a wrong hypothesis.
  - Do not "fix" a budget regression by raising the budget. They are ~3× the
    measured value and the shift they catch is real.

- ~~Two motion specs fail~~ — **fixed 2026-08-18, and they were never broken.**
  `the layer leaves in the reverse of the order it arrived in` and `the list's
  own height animates too` were hostage to the calendar: the week picker
  defaults to "denne", MTDT's øvinger start in week 38, and from week 34 the
  layer arrives empty — so both specs asked for a stagger over zero blocks and
  reported a working mechanism as red. Both now pin the mønsteruke through
  `selectWeek(page, "alle")`, which draws every session together whatever the
  date. Any future spec asserting on what is DRAWN wants the same helper.
