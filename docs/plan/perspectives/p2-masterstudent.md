# Perspective: 4th-year specialization student (elective exploration)

**Who I am.** 7th semester of a 5-year MSc (or 3rd-year BSc going into
specialization). My semester is 2 obligatory courses (fixed by the studieplan,
non-negotiable, already known) + 2 electives I must pick from overlapping
choice groups (a "velg 2 av 5" retning group, sometimes crossed with a
free-elective slot that lets me raid other programs' groups too). I have a
loose thesis/specialization direction in mind and I'm trying to build a
semester that (a) doesn't collide, (b) doesn't front-load three exams into one
week, (c) doesn't put me in a course historically brutal on grades right when
I need bandwidth for something else, and (d) actually feeds where I'm going
next year. Today I do this by having four browser tabs open — NTNU's course
pages, TP (timeplan.ntnu.no) for room/collision sanity-checking, Studentweb's
grade statistics buried three clicks deep, and a personal spreadsheet where I
paste course codes and manually tally credits and eyeball exam dates. The
spreadsheet is the tell: **the tool that's missing is a comparison table**,
not another single-course detail page.

The obligatory half of my semester is not this persona's problem — that's
solved by `/studier/[code]` already having "legg til alle" for a period. My
whole pain is entirely inside the two elective slots. Any feature aimed at me
that doesn't specifically shorten the distance between "a choice group with 5
options" and "2 committed choices" is solving someone else's problem.

## The core insight: this is a set-narrowing problem, not a search problem

`/emner/` is built for "I know roughly what I want, find it." My actual task
is closer to "I have an *institutionally supplied* candidate list (the choice
group, ~4-8 courses) plus maybe a couple of free-elective wildcards I found by
browsing, and I need to eliminate down to 2 without ever losing track of the
*other* obligatory course and my existing plan." Two different candidate
sources feed the same narrowing motion:

1. **Structured candidates** — a choice group inside a study plan
   (`/studier/[code]`'s "retninger"/waypoints, already modeled as course
   groups with a "choose N of M" semantic). This is the majority case for
   students like me: NTNU already tells me the menu, I just can't compare the
   items on it side by side today.
2. **Foraged candidates** — a free-elective slot where I've found 3-4
   candidates by browsing `/emner/`, possibly from other programs' groups
   entirely, that I want held next to the structured ones in the same
   comparison.

Both need to land in the same working set. The site currently has no notion
of "things I'm considering" that's distinct from "things I've committed to."
That's the missing object.

## The what-if loop, precisely

This is the loop I run 15-20 times while deciding, and it needs to be *fast*
enough that I don't fall back to the spreadsheet:

1. **Start from a choice group, not a blank search.** I land on
   `/studier/[code]` at my period, see "Velg 2 av: TDT4310, TDT4171, TDT4137,
   IT3708, TDT4265" as a group. Today each is a plain row with an add button
   straight into the committed plan. I want the group itself to be
   comparable as a unit before I commit anything.
2. **Widen: pull the whole group (or a hand-picked superset) into a
   comparison set in one action**, not five individual adds. "Sammenlign
   gruppen" on the group header, or individually flagging courses from
   `/emner/` search results with a "vurder" (consider) action distinct from
   "legg til i planen." Candidate set is deliberately wider than my 2 slots —
   5, maybe 7 with foraged wildcards — because eliminating requires seeing
   the loser next to the winner, not remembering it from a different tab.
3. **Compare: one table, one screen, dimensions below.** This is the
   artifact that replaces the spreadsheet. It must render fast (static data
   where possible — see cost note) and be scannable in the time it takes to
   glance down a column.
4. **Provisionally slot one or two candidates into the plan and re-render
   the real timetable/exam views** (the existing `/planlegger/` machinery,
   which already does conflict math) *without leaving the comparison* — or
   with a one-click round trip that preserves my comparison set on return.
   This is the crux of the what-if loop: "if I take TDT4265 instead of
   TDT4171, does Thursday still work, and does my exam week still breathe?"
   I need to swap-and-recheck in seconds, not re-navigate and re-remember.
5. **Narrow: eliminate candidates with a reason visible in place** — a
   collision mark, a red exam-cluster mark, a workload signal that gives me
   pause — not by closing tabs. The comparison table itself should visibly
   gray out / mark eliminated options as I rule them out, so the state of my
   thinking persists across a session (survives a reload, ideally
   shareable — see below).
6. **Commit: promote survivors from "considering" to "in plan."** The
   moment I commit, the comparison set should be able to just disappear (or
   collapse to a note) — I don't need to keep comparing after I've decided.

The loop's speed depends entirely on step 4 being cheap. If swapping a
candidate in/out of the live timetable requires a full page reload and
re-fetch of 5 courses' timetables, I will do this twice and then go back to
the spreadsheet. The existing `data.ts` per-course parallel fetch + memoization
described in PLANNER.md is the right foundation — the comparison view should
reuse the plan engine wholesale (conflicts.ts, schedule.ts) against a
*second*, parallel candidate set rather than inventing new conflict logic.

## Comparison dimensions, ranked by how much they actually decide it

1. **Schedule fit against my *locked* courses.** Not "do the 5 candidates
   collide with each other" (I'll only take 2 of them, so pairwise collisions
   *among candidates* are almost never the real question) — the question is
   "does candidate X collide with my 2 obligatory courses (and whichever
   *other* candidate I'm leaning toward)." This means the comparison needs
   my obligatory courses pinned as a fixed backdrop, and each candidate
   evaluated against that backdrop independently, not just against each
   other. Practically: the comparison table's collision column should read
   per-candidate against "rest of plan," with a secondary candidate-vs-
   candidate check only surfaced once I've provisionally picked 2.
2. **Exam clustering.** Not just "do two exams land on the same day"
   (already handled as a hard collision by conflicts.ts) but the *shape* of
   my exam period once this candidate is added: gap-to-nearest-exam in days,
   and whether it stacks a candidate's exam next to my obligatory courses'
   exams within a tight window (NTNU's own "tett" warning in PLANNER.md
   §2 is exactly this signal, generalized from 2 courses to a candidate set).
   This is a first-class ranking axis for me, not an afterthought — I've
   personally over-clustered a semester before and regretted it.
3. **Grade history (as shape, not a single number).** I don't want "average
   grade C" — I want the distribution shape (bunched around B/C vs. long tail
   into E/F), because a wide tail says "risky, uneven cohort experience" even
   if the mean looks fine. Small-cohort/GDPR-masked years should say so
   plainly rather than silently omitting — a masked recent year next to two
   healthy older years is itself information (small/new course, treat grade
   signal cautiously). Trend across the last 2-3 years available matters more
   than any single year (grading practice, teacher changes).
4. **Workload signals — the honest ceiling of what the data supports.**
   There is no assignment-hours field. What's real and worth surfacing
   *as-is*, clearly framed as proxies, not promises:
   - number and shape of mandatory activities (øvinger/projects) from course
     details — "5 mandatory exercises" reads differently than "1 term
     project," even without knowing hours;
   - assessment scheme composition (100% written exam vs. exam + portfolio +
     project) — students have real, differentiated risk appetite here;
   - credit weight itself as a blunt proxy (a 15 sp course is institutionally
     claiming more load than a 7.5 sp course);
   - level (grunnleggende emner, videregående emner nivå 1/2) as a rough
     prerequisite/difficulty proxy since real prerequisite graphs aren't
     available.
   Do **not** synthesize a fake "workload score" — that manufactures false
   precision the data can't back and will be wrong in ways that erode trust
   in everything else on the comparison table. Show the components, let the
   student weigh them.
5. **Language.** Binary but decisive for some — a course taught in Norwegian
   when my cohort is heavy with exchange students planning group work, or
   vice versa. Cheap to show, easy to filter/sort by, shouldn't be buried.
6. **Thesis-direction fit — deliberately NOT a data dimension.** There is no
   structured "leads to" or prerequisite graph, and I don't want the tool
   inventing a fuzzy relevance score from course descriptions — that's a
   confident-sounding hallucination magnet. What the tool *can* honestly do:
   let me tag/star candidates myself as "relevant to thesis" (pure client-
   side annotation, no data claim), and — separately — surface "courses that
   list this course as a credit reduction/overlap" or share the same
   department/level cluster as a soft, clearly-labeled "related" hint if
   that's cheaply derivable from existing crawled fields. Anything beyond
   that is out of scope until NTNU exposes real prerequisite/outcome data.

Dimensions ranked roughly by decision weight for me: schedule fit and exam
clustering are hard gates (a collision or a brutal exam week can eliminate a
candidate outright regardless of how good it looks otherwise); grade history
and workload signals are soft tie-breakers among survivors; language is a
fast filter; thesis fit is my own judgment, not the tool's to compute.

## What the comparison view is, concretely

A table, not cards — cards force scrolling to compare, tables let the eye
run down a column. Rows = candidate courses, columns = the dimensions above.
Sits comfortably inside the existing Ruteark idiom:

- Course identity: same `.np-dot` hue + mono code as everywhere else, so a
  candidate visually matches its ghost-block in the timetable preview below.
- Schedule-fit and exam-clustering columns render as the same red-ink
  vocabulary as `/planlegger/` (`--clash`, wavy underline, mono margin
  note) — no new visual language for "this collides," it's the same fact
  rendered the same way, just inside a table cell instead of a grid block.
- Grade-history column: a compact per-course sparkline/mini-stack (same
  hue-per-grade convention as the existing course-page chart, shrunk), not a
  single number — shape over scalar, per dimension 3 above.
- A row can be in one of three states: considering (default, once added to
  the comparison), provisionally-slotted (shown live in a collapsed
  timetable/exam strip below the table — reusing `/planlegger/`'s rendering
  against the "plan + this candidate" union), eliminated (grayed, struck,
  stays visible with the reason so I don't re-add something I already ruled
  out this session).
- Column sort/re-order lets me answer "which of these has the emptiest exam
  week" or "which has the tightest grade distribution" in one click — this
  is where a table earns its keep over anything card-shaped.

## Must / nice / anti-features

**Must:**
- A "considering" set distinct from the committed plan, addable in bulk from
  a study-plan choice group (one action for the whole group) and
  individually from `/emner/` search/course pages.
- The comparison table itself, with schedule-fit-against-locked-courses and
  exam-clustering as the two lead columns, computed by reusing
  conflicts.ts/schedule.ts against the union of plan + candidate, not a
  parallel engine.
- Fast provisional swap: promote/demote a candidate into the live
  timetable/exam view without losing the rest of the comparison set or
  requiring a full re-navigation.
- Grade-history shown as a shape (mini-distribution) with explicit
  small-cohort/masked-year labeling, not a single misleading average.
- Persistence of the considering set across a reload — this is a multi-day
  decision process for me, and losing it on tab close is the single fastest
  way to send me back to the spreadsheet. Same mechanism as the plan
  (localStorage + shareable URL hash) is sufficient; no accounts needed.
- Elimination state (grayed-with-reason) that persists within the session so
  I don't re-litigate a candidate I already ruled out.

**Nice:**
- Bulk-add-group-to-comparison directly from a study-plan waypoint/retning
  disclosure, pre-labeled with the group's "choose N of M" constraint shown
  in the table header ("velg 2 av 5") so the table itself carries the
  institutional rule, not just the candidates.
- A personal free-text/star "relevant to thesis" tag per candidate, pure
  client-side annotation (no server, no data claim), shown as a small marker
  column — lets me encode my own judgment inside the same table instead of
  in a separate mental list.
- Shareable comparison URL (same hash-encoding pattern as the plan) so I can
  send a labmate "here's what I'm choosing between" without narration.
- Soft "related by credit-reduction/department" hint as a labeled, clearly-
  heuristic column, only if cheaply derivable from already-crawled fields.

**Anti-features (explicitly do not build):**
- A synthesized single "workload score" or "difficulty score" — false
  precision on data that doesn't support it; show the real components
  (mandatory activities, assessment mix, credits, level) and let the
  student weigh them.
- A computed "fits your thesis" relevance ranking from course description
  text — confident-sounding noise with no ground truth to check it against;
  personal tagging covers the real need honestly.
- Auto-picking or recommending "the best 2 of 5" — this is a thinking tool
  upstream of Studentweb, not a decision-maker; the moment it recommends,
  students either blindly follow (bad when the data is thin) or distrust the
  whole tool (bad always).
- A second, separate "comparison conflict engine" diverging from the
  planner's conflicts.ts — guaranteed to drift and produce a case where the
  comparison says "fits" and the planner says "collides," which destroys
  trust instantly.
- Treating the comparison set as equivalent to the plan for credit-total
  purposes — 22.5 av 30 sp must only ever count committed courses; showing
  candidates in that sum, even provisionally, will make students think
  they've registered for something they haven't.
- Seat/capacity or "popularity" data — not available, don't fake it with
  proxies like search-index hit counts.
