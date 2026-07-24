# P4 — Kont-planlegging og karakterstatistikk

**Persona**: pragmatic strategist. Has an F (or a grade they want to bin) sitting
somewhere in Studentweb. Deciding: retake in August (kont) or wait and retake
the ordinary sitting in-semester? Shopping electives, willing to let a
brutal-F-rate course lose to an equally relevant but gentler one. Building a
semester that isn't three merciless written-exam finals in the same week.
Does not want a leaderboard, does not want to feel like a coward for checking —
wants to walk into an exam room having made an informed bet.

This persona touches two site surfaces that barely exist today in the spec:
**grade statistics as a first-class per-course panel**, and **kont/re-sit as a
planning case the planner doesn't currently model at all**. Both are covered
below, then workload balance, then must/nice/anti.

---

## 1. Grade statistics: inform without becoming a leaderboard

### What the data actually looks like (grounding, from live DBH pulls)

Pulling `TDT4100`'s distribution live surfaces the shape problem immediately:

- **Autumn (Høst) sittings are small and volatile**: 16, 19, 31, 34, 39, 43,
  45, 50, 57, 60, 62, 68, 77, 84, 85, 119 candidates across 2010–2025. F-rate
  swings from 9% to 81% year over year on these small cohorts.
- **Spring (Vår) sittings are the "real" ordinary exam**: 278–822 candidates,
  much more stable distributions (F-rate mostly 12–25%, drifting with course
  changes).
- This is because **autumn offerings of a spring-taught course are disproportionately re-takers and kont-takers** — a self-selected, already-struggling
  population. A naive "average F-rate across all rows" figure would be
  dragged hard toward the worst case by exactly the sittings that are least
  representative of what a first-time student in the normal semester will
  face.
- Small-N years get GDPR-masked (some grade buckets simply absent, e.g. no
  "A" row at all in 2010 Høst) — the UI must handle sparse/missing grade keys
  gracefully, not assume A–F always present.

**This is the single most important design fact for this persona.** If
Semesterplan shows one blended "F-rate: 34%" number, it is actively
misleading for exactly the two situations this persona cares about: (a)
judging the ordinary spring sitting they're about to take, and (b) judging
whether the August kont sitting is worse odds than waiting. The fix is not a
caveat footnote — it's structural.

### Presentation model

**Split by season, always.** Not a toggle bolted on — the default view is
two (or more, if summer/kont recorded separately) small distributions side by
side, mono-labeled "Vår" / "Høst" / "Sommer", each with its own candidate
count. If a course only has one season's data, show that one, unlabeled
noise avoided. This single move does most of the "inform not indict" work:
it tells a kont-planner in one glance "the sitting you'd actually take (Høst,
n=68) looks like this" instead of forcing them to mentally back out the
autumn signal from a blended figure.

**Cohort size is never omitted, and small N is visually damped, not hidden.**
Every distribution bar/row carries "n=68 kandidater" as a mono fact directly
under it (Data-Is-Mono). Below some threshold (proposal: n<20) the bars
render at reduced opacity or with a mono note "lite grunnlag (n=14) — store
utslag mellom år" — not blocked, not scary-red, just visually saying "hold
this loosely." This is a caveat as *visual weight*, not as a hidden tooltip
nobody reads.

**Trend over single-year snapshot.** A student comparing two elective
courses should see the last 3-5 years, not just the latest, because single
years swing (TDT4100 Vår F-rate: 20%, 15%, 19%, 14%, 12% — 2020→2025 — a
real but gentle downtrend that a single-year read would miss or
mis-signal). Render as a small multi-year strip (stacked bars per year,
mono year labels), not a single number. The engine already needs
`years?: number[]` filtering (mirrors the underlying API) — expose "last 5
years" as the default slice with an option to see all.

**Pass rate and grade spread are different questions — show both, don't
collapse to one.** "F-rate" alone conflates a course that's brutal-but-fair
(hands out plenty of A-C too, wide spread) with one that's just badly
pitched (everyone bunches D-E-F). This persona's actual question is usually
"if I pass, what's realistic?" as much as "will I pass?" — so the stacked
A/B/C/D/E/F bar (already planned in SPEC.md's `/emne/[code]/` grades island)
is right; the ADD is a derived pair of mono headline stats sitting above it:
**"Strykprosent"** (F ÷ total, or F+not-passed for pass/fail courses) and
**"Snittkarakter"** or median band, both per season, both with the n=
caption. Two honest numbers, not a score.

**No cross-course ranking UI.** This is the anti-leaderboard line: never
render "top 10 easiest courses" or a sortable strykprosent column across
`/emner/`. That is the one interaction shape that turns "inform" into
"toxic ranking" — it invites gaming, embarrasses small departments/courses
with tiny cohorts, and isn't something the data (GDPR-masked, noisy small-N)
supports responsibly at that scale. Grade stats live *on the course page*
and *in course-vs-course comparison the student explicitly initiates*
(picking two specific electives), never as an ambient sortable leaderboard
column. `/emner/` search stays name/code/campus — no strykprosent column,
ever.

**Explicit comparison view earns its keep here.** This persona's real
decision is almost always binary: "this elective or that one," "retake now
or in spring." A lightweight compare affordance — pick two courses (from an
elective group, or free pick) and see their grade-trend strips and exam
forms stacked directly above one another — is worth building because it's
the one place ranking-adjacent UI is legitimate: the student picked the
comparison set themselves, it's not the site editorializing about which
courses are "hard."

**Caveats live inline, permanently, in one line, not a dismissible modal.**
Every grades panel carries a static mono footer: "Tall fra DBH, per
årskull. Høstkull er ofte kontinuasjon/omtak og kan gi et skjevt bilde av
vanlig eksamen." (Autumn cohorts are often continuation/retake and can skew
the picture vs. the ordinary exam.) This is the single sentence doing the
most anti-toxicity work in the whole feature — it reframes a scary autumn
F-rate as *expected, structural, not a verdict on the student*.

---

## 2. Kont-planning: what this persona needs that doesn't exist yet

Today's PLANNER.md models one semester, one set of courses, one weekly grid,
one exam ribbon. It has no concept of "I already have a grade in this course
and I'm deciding what to do about it." That's a real gap for this persona
specifically, and it's cheap to close because **all the needed data already
exists** (exam occasions carry `occasion: "Ordinary examination" |
"Re-sit examination"`, season, date, duration, aids — confirmed live above).

**Must: surface re-sit ("kontinuasjonseksamen") as a distinct, labeled exam
occasion everywhere exams are shown.** On `/emne/[code]/`, the exams table
already has occasion data available — render "Ordinary" and "Re-sit" as two
visually distinct mono-labeled rows, not merged. On the planner's exam
ribbon, this matters only if the student is planning around a kont sitting —
see next point.

**Must: let the planner treat a kont exam as a plannable date, not just the
ordinary one.** Concretely: when a course is in the plan, its exam dot on
the ribbon should default to whichever occasion falls inside the chosen
semester's exam window — for most students that's ordinary, but August kont
sittings fall inside neither Høst nor Vår cleanly (they're a summer-ish
window). Cheapest correct answer: add a lightweight `/kont/` or a section of
the planner — "Kontinuasjonseksamener i august" — a flat list (not the full
weekly-grid apparatus, kont has no lectures to collide with) of the
student's plan courses' re-sit occasions with date (when published),
duration, aids code, and the exam-registration-deadline framing below. This
avoids overloading the Høst/Vår semester toggle with a third semester
concept and keeps `.np-frame.np-ruled` machinery scoped to what it's good at
(weekly collision grids, which kont doesn't need).

**Must: deadline awareness, stated in copy, not just implied by dates.**
NTNU's actual deadlines this persona lives by: **exam registration deadline
Feb 1** (spring) **/ Sep 15** (autumn) for the *ordinary* sitting, and kont
eligibility/sign-up rules that are course/program-specific and NOT
structured data we have. The site cannot compute "you are eligible for
kont in TDT4100" — that's a Studentweb/rule-engine fact we don't have and
must not fake. What we *can* do honestly: show the semester's registration
deadline as a mono fact ("Oppmeldingsfrist: 15. sep 2026") next to the
semester toggle (semester metadata already has teaching weeks + exam
windows per SPEC.md; deadline is a fixed, computable Feb1/Sep15 rule, not
scraped, so mark it as *computed from the standard NTNU rule*, with a one-line
disclaimer "Sjekk Studentweb for din frist" since a few programs deviate).
This is upstream-of-Studentweb thinking exactly as the brief frames it: we
surface the date that should trigger the student to go act in Studentweb,
we do not adjudicate eligibility.

**Nice: "already have a grade" as local-only plan annotation.** Since there's
no user accounts/server storage, this must be a pure client-side,
optional, opt-in tag: a plan course can carry a localStorage-only note like
"har F, vurderer kont" that changes nothing about data fetching, just
changes the course row's rendering (e.g., a small mono tag, not a hue,
per Course-hues-never-mean-status). This is genuinely low-cost (a UI-only
extension of `PlanState`) and directly serves "should I retake" as a
returning-visit workflow — the plan remembers *why* a course is there.
Don't build this first; it's a v2 nicety once the kont list itself exists.

**Nice: kont vs. wait-and-retake comparison surfaced automatically when
both a Høst kont date and the same course's next-ordinary-sitting date are
knowable.** E.g., "TDT4100 kont: 12. aug 2026 · neste ordinære: vår 2027
(dato ikke satt)" — literally just placing the two known dates near each
other so the time-gap is visible without math. Small win, uses only exam
data already fetched for the course.

**Anti: do not build eligibility logic, grade-input forms, or a "GPA
calculator."** All three require either data we don't have (prerequisites/
rules, official grades) or invite a false sense of authority the site can't
back up. The "har F, vurderer kont" tag above is deliberately a sticky-note,
not a grade tracker — no grade values entered, no GPA math, ever. This is a
firm line: the moment the site asks "what grade did you get," it's
pretending to be Studentweb-adjacent official record-keeping, which it
structurally cannot be (no accounts, no verified source) and shouldn't
pretend to be.

---

## 3. What "workload balance" means with our data

We do not have hours-per-week or ECTS-workload survey data. What we *do*
have that proxies workload, all already in the crawled/detail data per
SPEC.md: **assessment scheme** (written exam vs. home exam vs. portfolio vs.
oral vs. multiple weighted components) and **mandatory activities**
(øvinger/lab reports/attendance requirements, prose + probably a count).
That's the honest workload signal available, and it's a good one for this
persona specifically:

**Assessment-form mix across the plan, shown as a plain count.** On the
planner's course list (§EMNER section of PLANLEGGER layout), add the
assessment form as a mono fact per row (it's already planned as a column:
"credits · campus · exam form"). The *balance* insight is a simple derived
line above the list: "4 emner · 3 skriftlig eksamen, 1 mappevurdering" —
this tells the pragmatic strategist in one line whether they've stacked four
finals in the same week-and-a-half window (bad, stressful, and — this
persona's specific fear — means one bad exam day tanks a quarter of the
semester) versus having spread risk across forms. No judgment copy ("dette
er ubalansert") — just the count, mono, factual; the student draws the
conclusion (Ink-Before-Chrome: show the fact, don't editorialize).

**Mandatory-activity load as a second plain count, not a score.** "Obligatoriske aktiviteter: 3 emner har øvinger/innleveringer gjennom semesteret" —
again a count with which-courses-have-it visible per row, not a 1-10
workload score (we don't have the data to justify a score, and a fake score
is worse than no score — it would look authoritative while being made up).

**Exam clustering is already the planner's job — extend it slightly.** The
exam ribbon already shows gaps ("2 dager til neste"); this persona's
workload-balance question is served by that same mechanism, just make the
"tett" (back-to-back) warning apply not only to same-day/one-day-gap
collisions but render distinctly when 3+ written exams fall inside one week
— still red-ink-for-collision only when actually colliding per Red-Is-Collision, but a neutral mono note ("3 skriftlige eksamener i uke 49") is
fair game as information, not a warning color. Small extension of existing
`conflicts.ts` exam-gap logic, not a new engine.

**What we will not call "workload balance": raw credit sum alone.** 30 sp of
four 7.5-credit courses with four written finals in the same week is not
balanced just because it sums to 30. The credit total the planner already
shows ("22,5 av 30 sp") is a *load* indicator, not a *balance* one — don't
let UI copy conflate the two. Balance = assessment-form mix + mandatory-activity spread + exam-date clustering, all derivable now; load = credits, already shipped.

---

## 4. Must / Nice / Anti

**Must**
1. Grade distributions split by season (Vår/Høst/Sommer) by default, each
   with its own n= count — never one blended figure.
2. Cohort size (n=) shown next to every distribution/rate, with reduced
   visual weight (not hidden) below a small-N threshold (~20).
3. Multi-year trend strip (last ~5 years) as the default grades view, not a
   single-year snapshot.
4. Two plain derived stats per season — strykprosent (F-rate) and a
   median/snitt band — displayed as facts, not a single "score."
5. Standing footer caveat sentence on every grades panel: autumn cohorts
   skew toward retakers/kont and are not representative of the ordinary
   exam experience.
6. No cross-course ranking or sortable strykprosent column anywhere,
   especially not on `/emner/`.
7. Exam occasions labeled distinctly as "Ordinær" vs. "Kontinuasjon/
   Utsatt" wherever exams render (course page and planner).
8. A kont-focused view (list, not weekly grid) for the student's plan
   courses' August re-sit dates, with duration/aids shown as soon as
   published.
9. Registration-deadline fact (Feb 1 / Sep 15, computed) shown near the
   semester toggle, with a "confirm in Studentweb" disclaimer.
10. Assessment-form mix and mandatory-activity count shown as plain counts
    in the planner's course list, feeding a one-line workload-balance
    summary.

**Nice**
- Course-vs-course grade/exam-form comparison view for an explicitly
  student-picked pair (e.g., two electives), building on planned
  `compare_courses`-style data.
- Local-only, opt-in "vurderer kont" sticky note per plan course
  (localStorage, no accounts, no grade values).
- Automatic "kont date vs. next ordinary date" juxtaposition when both are
  known.
- Neutral (non-red) "N skriftlige eksamener i uke X" note when the plan
  clusters 3+ written finals in one week.

**Anti**
- Any ranked/sortable leaderboard of courses by pass rate or difficulty.
- A single blended all-time F-rate number presented without season split
  or n=.
- A fabricated "workload score" (1-10, stars, etc.) — we don't have
  hours-of-work data; counts of assessment forms/mandatory activities are
  the honest substitute, not a proxy score.
- Grade-input / GPA calculator / eligibility-for-kont logic — all require
  data (official grades, program-specific rules) this site does not and
  should not try to have.
- Coloring grade bars or course rows by "good/bad" hue — course hues are
  identity only (DESIGN.md), and a red/green pass-rate tint would directly
  contradict Red-Is-Collision (red must mean coexistence failure, nothing
  else) and turn the grades panel into exactly the toxic signal this
  persona doesn't want.
