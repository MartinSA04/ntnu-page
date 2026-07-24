# Perspective 5 — Hverdagslogistikk (the student with a fixed-cost week)

**Persona**: works a part-time job 12h/week (fixed shifts, e.g. Tue/Thu evenings + Sat), or commutes 40+ min each way from outside Trondheim, or trains twice daily with a club. This student does not ask "which courses interest me" — they already know the courses. They ask: **"does this semester's week actually fit around the parts of my life that don't move?"** Their planning horizon is the week-shape, not the syllabus. They fail not because a course was wrong, but because Thursday turned out to have a 08:15 and a 16:15 with nothing useful between, or because week 40 (fall break — "no wait, øvingsuke") secretly has a mandatory lab that ordinary weeks don't.

This persona is not hypothetical noise — it's arguably the modal NTNU student outside the youngest cohorts: commuter students, students supporting themselves, students in idrettslag/musikk/verv that own fixed evening slots. The current planner (per PLANNER.md) is built to answer "do my courses collide" — a necessary but not sufficient question for this student. Collision-free is not the same as *livable*.

---

## What this student actually wants, in order

1. **"Which weekdays are mine?"** — not "is there a conflict" but "after I commit to this course set, which days have zero campus obligation, which have one block, which are wall-to-wall." This is the single highest-value question the planner currently does not answer directly. The weekly grid *shows* this if you stare at it, but staring is not answering. A day with three classes spread from 08:15 to 18:00 with two-hour gaps between is technically conflict-free and functionally unusable for someone with a 16:00 shift or a train to catch — the grid alone does not surface that.

2. **"How does this week compare to a normal week?"** — uke 35 (early, may be lighter, orientation activities may already be behind them) vs uke 40 (potential fall-break/øvingsuke with compressed lab deadlines) vs exam weeks vs the week with a mandatory excursion. Right now the merged weekly view in `/planlegger/` is architecturally a *single* week template built from `entriesInSemester` — it does not, per the spec, distinguish week-to-week variation within the semester at a glance. This student has been burned by "the timetable looked fine in September" turning into "surprise mandatory Saturday lab in week 44."

3. **"Where do the gaps go, and are they long enough to be useful or just long enough to be wasted?"** A 45-minute gap between two buildings is dead time (can't go home, can't get real work done); a 3-hour gap might be enough to go to the gym or take a shift. This is a different question from "is the day light or heavy" — it's about gap *quality*, not just gap *presence*.

4. **"When does the semester actually start and stop, including exams?"** Not the nominal semester dates — the real first teaching day, the real last teaching day, and critically the exam tail: because kont-exams sit in August and ordinary exams cluster late Nov/late May, this student's "semester" for job/training-scheduling purposes is longer than "uke 34–47." They need to tell their employer/coach/landlord *these are my blocked weeks*, and undercounting the exam tail is a classic mistake.

5. **Room/campus geography, secondarily.** For the commuter specifically: if Monday has one class at Gløshaugen and one at Øya, that "free-looking" day has a hidden transit cost the grid doesn't price in. This is lower priority than 1–4 (NTNU Trondheim's campuses aren't *that* spread, and cross-campus days are the exception not the rule) but it's real for MH/medisin-adjacent courses.

---

## How the weekly view should serve this — concrete features

### Must

**Day-load summary strip.** Above or beside the weekly grid, one row, five (or six) cells — Mon–Fri(–Sat) — each showing, in mono (per Data-Is-Mono): total campus hours that day, first-start / last-end time, and a compact fill indicator (e.g. a mini ruled bar within the `.np-frame` idiom, not a foreign progress-bar widget — density expressed the same square-ruled way the timetable already is). Tapping/clicking a day cell scrolls/highlights that column in the grid below. This is the single highest-leverage addition: it turns "stare at the grid and do arithmetic" into "read one line." It belongs entirely in the planner (it's a derived view of the plan's own timetable data — no new data source, pure computation over what `data.ts`/`conflicts.ts` already assembles).

**Free-day / light-day callout, in words, not just visually.** A mono note under the day strip: "Fredag er ledig" or "Onsdag: ett fag, 10:15–12:00" (mirroring the existing margin-note voice used for clashes — "TDT4100 kolliderer med TMA4100 · mandag 10:15–12:00"). This matters because the persona is often scanning on a phone between other obligations — they want the sentence, not the puzzle. Zero free days should also say so plainly ("Ingen ledige dager denne uken") rather than silence, because that's a decision-relevant fact (do they need to renegotiate a shift).

**Week scrubber with real week-to-week difference, not a static grid.** The planner must let the student step through the semester's teaching weeks (prev/next, or a compact week-number strip — mono numbers, current week highlighted) and see the grid *actually change* — because lab weeks, weeks with only every-other-week seminars, and weeks with an exam-adjacent gap all look different. The spec's current framing ("weekly spread … uke 34–47" as a header label) reads like one merged canonical week; that's necessary as a default/overview (most weeks in a semester ARE the template week — don't force everyone to scrub) but there must be a way to answer "is week 40 different from the template" without reading every course's raw week-list by hand. Concretely: default view = the modal/most-common week pattern (clearly labeled "typisk uke"), with a scrubber to inspect exceptions, and — cheap but high value — auto-flag which weeks *deviate* from the typical pattern (a small marker under the relevant week numbers: "avviker fra typisk uke") so the student doesn't have to scrub all 14 weeks to find the two that matter. This is pure computation over already-crawled per-course weekly entries (`entriesInSemester`, week arrays) — no new data needed, just a diffing pass across weeks instead of collapsing straight to one template.

**Semester bounds stated as a sentence, exam tail included.** Under the EKSAMENER section (already spec'd), one explicit line stacking the real edges: "Undervisning: 18. aug – 21. nov · Eksamener: 25. nov – 18. des · Kontinuasjonseksamen: august 2027" (only show kont if any selected course has one). This is cheap — `semesters.json` + the exams already fetched per course — but it's the fact this persona actually plans their job schedule and lease/training calendar around, and right now it's implicit in reading a ribbon rather than stated as text.

**Gap annotation, not just block placement.** For gaps between consecutive blocks on the same day, a small mono duration label in the gap itself on the grid ("45 min" / "2 t 15 min") when the gap is under, say, 3 hours — signal "this gap is dead time" vs. leaving genuinely long gaps unlabeled (obviously usable, no need to annotate the obvious). This reuses the grid's own geometry — the gap is literally the blank cells between two blocks — so it's a rendering addition, not new data.

### Nice

**"Compact my week" as a lens, not a mutator.** A toggle that doesn't change the plan but re-sorts/highlights: which of the *candidate* courses (in search results, or alternatives within a study-plan choice group) would tighten a currently-sprawled day if swapped in. This is genuinely hard with only weekly-timetable data (no seat/prerequisite data to know if a swap is legal) so keep it advisory and cheap: e.g. on `/emne/[code]`, when the plan is non-empty, show one derived line — "Dette faget ville lagt til [day], som i dag har 0 andre fag" or "…ville kollidert med TMA4100 på mandag" — extending the existing "Legg til i planen" island with a one-line preview instead of requiring an actual add to find out. This turns the emne-page into part of the logistics-thinking loop instead of a dead end you must return from.

**Named-block markers for personal fixed commitments.** LocalStorage-only (no accounts, matches the site's architecture), purely client-side: let the student mark 1–3 recurring blocks ("Jobb: tirsdag/torsdag 16–21", "Trening: man/ons/fre 07–08:30") that render on the same grid, visually distinct from course hues (not a `--hue-*`, not `--clash` — perhaps a plain hatched `--faint` block with a mono label, deliberately unstyled/muted so it reads as "yours," not "a course") so conflicts against real life are visible in the same glance as conflicts against other courses. This is the single most direct answer to "does this fit my actual week" and costs zero new server data — it's a pure client-side overlay. Scope tightly: no recurrence editor UI beyond day+time+label, no calendar import/export in v1. This is the biggest net-new idea here and should be validated cheaply (e.g. as a one-field "legg til fast avtale" affordance) before over-building it.

**Campus/building transit note on cross-campus days only.** When a day's blocks span more than one `location`/campus (data already present per course), one mono note under that day: "Gløshaugen → Øya" — no travel-time estimate (no data for that, don't fabricate it), just naming the fact so the student notices before it bites them.

### Anti (explicitly do not build)

- **No calendar/ICS export or Google Calendar sync in v1.** Tempting for this persona ("just put it in my phone calendar") but it's a real integration surface (recurrence rules, week-exceptions, timezone) that doesn't exist yet in the data model or architecture (static + edge worker, no accounts) and would become the thing that's "almost right" and generates support burden. If ever built, it's a v2 export button off the finished plan, not a planner feature.
- **No auto-optimizer ("build me the lightest schedule").** No prerequisite/seat data exists to make swap suggestions safe or even legal — a "best schedule" button would silently suggest illegal or nonsensical combinations. The advisory one-liner above (nice-to-have) is the ceiling; do not build a solver.
- **No commute-time calculation or map.** No data source for this and it's scope creep into a routing product. A campus-name note is the correct stopping point.
- **No push notifications / reminders about semester start or exam tail.** No accounts, no server-side state, static site — this belongs to whatever the student already uses (phone calendar), not to us. Stating the dates as clear text on the page is our whole job here.
- **Don't put day-load summaries or the week-scrubber on `/emne/[code]`.** Those are properties of the *combined plan*, meaningless for a single course (a single course's "day load" is just its own blocks). Keep `/emne/[code]` scoped to that course's own timetable/exam facts, as already spec'd; only the one-line "would add to a day with N other courses" preview (nice-to-have above) belongs there, because that's specifically a plan-aware question asked from the course page.
- **Don't fragment the week view behind tabs ("day view" vs "week view" as separate pages/modes).** PLANNER.md already commits to "no tabs, stacked editorial sections" — the day-load strip must be a companion row to the existing grid, not an alternate mode you have to switch into and lose the grid to.

---

## Placement summary (planner vs. course page vs. new)

| Feature | Belongs in |
|---|---|
| Day-load summary strip + free-day sentence | `/planlegger/` — new sub-section directly above/beside UKEPLAN |
| Week scrubber + "avviker fra typisk uke" flags | `/planlegger/` — UKEPLAN section, extends existing grid, needs a diffing pass in `schedule.ts`/`conflicts.ts` over per-week entries instead of collapsing to one template |
| Semester-bounds sentence incl. kont tail | `/planlegger/` — EKSAMENER section, one line, data already fetched |
| Gap duration labels | `/planlegger/` — UKEPLAN grid rendering only |
| Cross-campus day note | `/planlegger/` — UKEPLAN, per-day, uses existing `location` field |
| "Would add to day X" preview | `/emne/[code]` — extends existing "Legg til i planen" island, plan-aware |
| Personal fixed-commitment blocks | `/planlegger/` — new localStorage-backed overlay on UKEPLAN; needs a small `store.ts` extension (new optional array, not touching `PlanState.courses`/hash-sync semantics) |

## Engine/data implications (for whoever owns `src/lib/planner/`)

- `schedule.ts` currently intersects entry weeks with the *semester's* teaching weeks to decide in/out. This persona's features need one more level: intersect/diff entries *across individual teaching weeks* to detect which weeks deviate from the mode. That's a new pure function (`weeksDiffer(entries, teachingWeeks) → { typical: WeekPattern, deviations: number[] }` or similar) — computable from data already fetched, no new endpoint.
- Day-load/gap/free-day derivations are pure functions over the same conflict-engine inputs (`entriesInSemester` output) — belongs beside `conflicts.ts`, not a new data source.
- Personal fixed-commitment blocks need a `store.ts` addition: a small array of `{ label, dayNumber, start, end }`, localStorage-only, explicitly *not* part of the shareable hash (these are personal, not plan-defining — sharing a plan URL with a friend should not leak "Jobb tirsdag 16–21" onto their screen).

---

## One-sentence verdict

The planner currently proves a course *set* doesn't collide; this persona additionally needs it to prove the *week shape* is livable — which weekdays are theirs, whether this week is the typical week or an exception, and where the semester's real edges are — and every piece of that is derivable from data already being fetched, so it's a rendering/computation problem, not a data problem.
