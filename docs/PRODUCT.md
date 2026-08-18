# PRODUCT.md — Semesterplan

The definitive product definition: what this site is for, what it must do,
what it must never do, and which decisions are closed. `docs/ROADMAP.md`
sequences what is left. `docs/SPEC.md` covers architecture and data
contracts. `docs/DESIGN.md` is the design system and is assumed law here.

Where this file and any other disagree about *product* scope, this one wins.

**2026-08-18: this file was cut down by about two thirds.** The site was a
five-column join — catalog, timetable, exam, study plan, grade history —
with accounts, sync and a shared-plan page. It is now a timetable getter.
`docs/superpowers/specs/2026-08-18-timetable-only-reduction-design.md` is the
demolition order and the record of why; §11 lists what died. Do not restore a
feature by reading an older paragraph somewhere else in the repo.

---

## 1. The mandate

The owner's standing instruction. It overrides everything below where they
conflict.

1. **Programme → kull → your week, instantly.** Picking study programme and
   kull must be trivial, and the immediate result is the weekly schedule.
   NTNU auto-enrolls programme students in their courses each semester, so
   the programme pre-fill **is** the student's reality — it is the default
   plan, not a hedged suggestion. (DR-7's fallback math and honest labeling
   still apply.)
2. **The weekly schedule is the primary surface.** It is the only surface.
   Everything else on the page exists to produce it or to date it.
3. **We do not compete with NTNU.** No course descriptions, no grade figures,
   no catalog browsing, no encyclopedia. A student who wants to know about a
   *course* is sent to `ntnu.no`; one who wants grade statistics is sent to
   `karakterweb.no`. Both are one press away from every course in the plan.
4. **Editing is trivial.** Drop a programme course → it grays out in the
   course list, still visible as part of the programme, one tap to restore,
   excluded from the schedule. Add extra courses on top. Manual adds are
   removable outright.
5. **Lecture-based by default**, with one toggle to show øvinger and labber
   (DR-1's asymmetry, expressed as a control).
6. **Graceful pre-publish fallback** when timetables aren't out (DR-2):
   never blank — course list, exam dates, and a "publiseres ~august" note.
7. **Parallels default to the programme's own, user-selectable per course.**
   Display-level selection, not conflict detection.
8. **The schedule must render simultaneous items properly.** People
   deliberately take colliding courses; overlap is a *supported state*, not
   breakage. We draw it correctly; we no longer render a verdict about it.
9. **Programme/kull/retning editing gets a real settings surface** — the
   studieinfo dialog, opened from the plan's own name in the bar. Press the
   fact to change the fact. There is no second door beside it: **the account
   is gone** (§11), so the bar carries no profile, no sign-in and no share.
10. **Manual adds are semester-specific.** A course added in one semester
    must not leak into another.
11. **localStorage is the only store.** No accounts, no server-side state, no
    sync, no shared links. The worker is a caching proxy in front of NTNU and
    holds nothing about a student.
12. **No versioning or compat apparatus — delete old code outright.**
    Pre-launch, not published anywhere, so breaking old links and stored
    state is acceptable. *This rule resumes once the site has real external
    links worth not breaking; until then, do not build compat layers.*
13. **DO NOT OVERCOMPLICATE.** As simple as possible while keeping the
    value. When in doubt, cut.

---

## 2. Positioning and the one job

**Positioning.** Semesterplan turns a study programme and a kull into a
weekly schedule, in about fifteen seconds, with no account. That is the
whole product.

NTNU publishes each course's timetable one course at a time; TP merges them
if you already know the codes and the parallels. Neither will take
"Datateknologi, 2026" and hand back a drawn week with rooms. That gap is the
only thing this site fills, and filling it well is the entire brief.

**The one job:**

> **"Hvor skal jeg være, og når?"**

Everything the site once did *around* that question — verdicts, credit
totals, grade figures, course descriptions, shared plans — is gone. The
answer to "is this course hard" and "what is this course about" is a link,
because two other sites already answer them better than we would.

**Success metrics.** None are instrumented, and none are planned. An
account-less two-page static site with no share mechanism has no growth loop
to measure; the only honest question is whether the week is correct, and
that is a test suite's job, not an analytics pipeline's.

---

## 3. Who it is for

One shape, not a persona set:

**A student who knows their programme and wants their week.** Most often a
first-year at the start of a semester — five codes and one question, "where
do I walk in at 10:15" — but equally a third-year checking which days are
free before the term starts. Jobs: programme + kull (or paste codes) → this
week's schedule with rooms → code↔name translation → the exam dates for the
same semester.

**Not personas any more:** the elective chooser and the grade-aware
strategist. Both needed facts we no longer compute or display — clash
verdicts, credit running totals, grade shape in a decision cell — and every
one of those is now an outbound link. Also not a persona, and never was: the
multi-year degree planner.

---

## 4. Core flows

1. **On-ramp.** `/` is a thin front door: the student's own next session and
   the rest of today when a plan exists, and one button into `/planlegger/`.
   There is still no pitch — no headline, no explanatory subcopy, nothing
   explaining what a schedule page is, because people know what a schedule
   page is. What a first-time visitor does get is **one line, and only on the
   first visit**: what is on the other side of the button, and that it costs
   no account. It is gated in CSS on `html:not([data-plan])` — the same
   predicate the planner's first-run screen uses, written by the pre-paint
   probe — so it paints with the document rather than mounting into it, and it
   is gone the moment a plan exists, where the card is the answer and a
   sentence would only stand in front of it. It is deliberately not the
   planner's first-run lead reworded: that one stands over the programme field
   and says what pressing it does.

   **The planner owns onboarding, and with no plan it IS the onboarding.**
   `/planlegger/` gated on `html:not([data-plan])` is a first-run screen and
   nothing else: an `<h1>` invitation, one sentence, the programme field on
   the page, and a quiet line for "I already have the codes". No bar, no
   tools, no week frame, no Eksamener, no Emner — every one of those
   presupposes content that is missing, which is why the empty planner used
   to read worse than an empty page. **The last answer commits**, and there is
   no Lagre on that screen: a button meaning "and now do it" would stand
   between the student and the week their answer already produced.

   **Studieretning is asked here too, when the kull's own plan has the
   question open.** It is the third field on the same screen, revealed by the
   kull press instead of committing on it, and answering it is the write. Most
   kull never see it — studieretning normally opens in year three — so this
   stays a two-press screen for most students and grows a third field only for
   the ones it is a real question for. **The skip is not optional**: a
   studieretning deadline is often months out, so "Jeg vet ikke ennå" writes
   programme and kull alone and hands the question to `#planner-direction`,
   which asks it again over a drawn week. A screen that refuses to draw a week
   until a student has made a decision nobody has made yet answers nothing.

   Once a programme is stored, the plan's own name in the bar is the way back
   into the picker, through the studieinfo dialog — the only other place that
   picker appears, and never at the same time as the first-run screen.

   Inside the planner, **a section appears with its rows.** Eksamener is
   absent at zero active courses rather than printing a heading over an
   apology for content nobody has created yet. Emner is the exception and
   stays, because it is where the first course is added.

2. **Add a course.** A catalog search modal inside the planner: code-first,
   ranked matching, quick-add. It is the only search surface on the site.

3. **Read the week.** Two views, Uke and Liste. A week scope picker, because
   the mønsteruke draws sessions together that never occur together (D13).
   One layer box for øving and lab.

4. **Leave for the course.** Every course row and every session popover
   carries two outbound links: the emnepage on `ntnu.no` and the grade
   statistics on `karakterweb.no`. This is flow 4 in its entirety. We do not
   preview, summarise or mirror what is on the other end.

**Rules baked into every flow:**

- **A failed fetch is never a blank week** (DR-8). "Came back empty" and "we
  could not ask" are different sentences, and neither may render as an empty
  grid.

---

## 5. IA

**Two pages, plus a sitemap and a 404. Persistent chrome carries almost
nothing.**

- `/` — the front door. The next session and the rest of today when a plan
  exists; one button to `/planlegger/`, under one line of introduction that
  only a first-time visitor sees. Still no pitch.
- `/planlegger/` — the app. The plan, the week, the exam list, the course
  rail. Search lives inside it as a modal.
- `/sitemap.xml` — those two URLs.
- `/404`.

**The topbar carries a brand link and the theme toggle.** Nothing else. It
does not carry plan state — three successive attempts at a sitewide plan
affordance were each built and each removed, and they stay removed. It no
longer carries an account door either, because there is no account. With two
items there is nothing to fold, so the 480 px menu fold is deleted too.

**`/emne/[code]/`, `/emner/`, `/user/<navn>`, `/studier/` and
`/studier/[code]/` are all deleted, no redirects.** The first three went on
2026-08-18 with this reduction; the last two went earlier (D14).

**URL is not state.** There is no hash grammar and no query param that
carries a plan. `/planlegger/` is one address whatever is in the plan.

---

## 6. State and storage

```ts
interface PlanState {
  semesterId: string;                 // "26h" | "27v" — Semester.id
  courses: {
    code: string;
    name: string;
    version: string;                  // FIRST-CLASS — "1" default; threads to API + grid + exam
    source: "program" | "manual";     // programme-derived vs. added by hand
    dropped: boolean;                 // programme course grayed out, never deleted
    groups?: string[];                // selected parallel / øving group keys
  }[];
  program?: { code: string; name: string; cohort: number; direction?: { code: string; name: string } };
}
```

**Storage is the only source of truth**, split three ways so semesters stay
independent: `np:profile` (the programme choice, global), `np:plans` (the
course list, keyed per `semesterId`), `np:lastSemester` (session restore).
Nothing mirrors it anywhere. A student who clears their browser has cleared
their plan, and that is the deal — it is stated on the page, not hidden.

`credits` left the shape with the credit total (§11). Nothing reads it.

---

## 7. Domain rules (binding)

Each names the data reality that forces it. The numbering is preserved
across the reduction so existing code comments and test names keep pointing
at the right rule; retired rules keep their number and say so.

- **DR-1 — Activity classification is asymmetric, and lecture-only.**
  `TimetableEntry` has no `activityCode` and no group-membership field, so
  there is no way to distinguish parallel øving groups from the entry alone.
  Lectures are classified from the activity `title`; øving and lab render as
  a muted layer behind a toggle.

  **The asymmetry is the point.** Misclassifying an øving as a lecture puts
  a session in the student's default week that does not belong there.
  Misclassifying a lecture as "other" only hides it behind the toggle. So
  anything that is not an unambiguous lecture becomes "other".

  Two qualifications, both measured. A bare delivery-format title (a
  department that publishes no finer title than "Formidling") is a lecture
  signal via a **closed list**; the general "fall back to the name bucket
  when the title is opaque" rule was built, scored and **rejected** — it
  promoted programme names and orientation weeks to lectures. And a
  *samling* is a lecture: it is the gathering a samlingsbasert programme
  calls its students in for, and that gathering is the teaching. Together
  these take zero-lecture course-terms from 35 % to 20 %.

- **DR-2 — Pre-publish is a primary mode.** `timetablePublished` is false
  through most of the planning window and the timetable returns `[]` then,
  so a grid-only flagship is **blank exactly when a student plans.** The
  exam list and the course list carry the mode, with a note saying when the
  timetable is expected. "Next plannable term" must not force a blank
  primary surface.

- **DR-3 — Exam dates come from the catalog, not the scrape.** Scraped
  `CourseExam.date` is null for hjemmeeksamen (`dateText` carries
  `"Utlevering 07.11.2025"`) and `occasion` is free text. Drive the exam list
  from catalog `ExamDate`; the scrape only enriches. **Never re-parse scraped
  free-text into a date.**

  **The kont filter is a client-side join, not a crawler flag.** Upstream's
  `continuation` boolean is structurally present and empirically always
  false — **0 of 2 439 catalog exam rows set it** — and the search portlet
  returns `continuation: false` for the very sitting `/api/course/:code`
  labels "Utsatt eksamen". So the filter matches a catalog exam to a scraped
  one on the **exact ISO date**, the one structured field both sides carry,
  and drops it only when every scraped sitting on that date is deferred.
  `occasion` is read as a **label only**, never re-parsed for a date. It is
  deliberately **fail-open**: no scrape, no match, or an unrecognised
  occasion keeps the exam, because deleting a real exam date is far worse
  than listing one too many. A course with no dated ordinary sitting keeps a
  "dato ikke satt" row rather than vanishing. **Do not "restore" a crawler
  filter** — it would branch on a flag upstream never sets.

- **DR-4 — Version threading is first-class and correctness-critical.**
  Course timetables and schedules default to `version: "1"`; a re-versioned
  course otherwise shows the **wrong grid and exam data**. `version` is in
  `PlanState` and in every API call. 293 of 5 470 courses are not version
  `"1"`.

- **DR-5 — The study plan has no cardinality; never assert "group
  satisfied".** `PlanCourseGroup` is `{code, name, description, courses[]}` —
  no min, max or choose-N. The "velg 2 av 5" exists only in free-text
  `description`. The programme prefill takes what the plan lists for the
  period and stops there; it never picks a best N and never claims a group
  is complete.

- **DR-6 — retired.** The credit total is deleted (§11). `credits` is no
  longer carried in `PlanState` and nothing sums it.

- **DR-7 — First-year period math is fragile.** `periodNumber` is nullable,
  `startTerm` is nullable (spring intakes break `autumn ? 1 : 2`),
  unpublished cohorts return null, and `studyChoice.code` "O" is unreliable.
  Fall back to the nearest published year, honour `startTerm`, default to
  period 1 with a user-editable chip when null, and keep the result
  **editable**. Mandate 1 makes the pre-fill the default plan; DR-7 makes it
  correctable.

- **DR-8 — A failed fetch is not an empty week.** Narrowed by the reduction,
  not retired. The provenance *line* is gone; the distinction it rested on
  stays. `TimetableOutcome` keeps "came back empty", "we could not ask" and
  "not fetched yet" apart, and a fetch that failed renders one honest line
  with a retry above the grid. **"Came back empty" and "we could not ask"
  must never collapse into "no blocks drawn"** — that is precisely how NTNU
  being down renders as a free week.

- **DR-9 — "Next plannable term" is an explicit rule.** Defined across the
  Sep-15 / Feb-1 seam from `semesters.json`'s `phase`, `fromDate`, `toDate`,
  `examLastDate` and `timetablePublished` — not an invisible default. It
  drives the semester default, and a semester chip for an unpublished term
  carries its own inline note rather than being a silent trap. The
  registration-deadline half of this rule is retired with the deadline line.

- **DR-10 — Off-semester add is defined.** An off-semester add yields a
  notice line. `planElement` filtering applies on bulk add; genuine 0-sp
  courses stay. The credit-exclusion half is retired with DR-6.

**Never** re-parse scraped free-text into structured facts. Branch only on
structured `form` and `weighting` — and not on `continuation`, which is
structurally present but empirically always false, so a branch on it is a
branch on nothing (DR-3).

---

## 8. Non-goals

**No accounts, ever.** No sync, no server-side plan state, no shared links,
no shared-plan page. **No course content of any kind** — no descriptions, no
learning outcomes, no contact cards, no assessment prose, no grade figures,
no grade tables. **No catalog browsing surface**; search exists only as the
planner's add modal. No verdicts — no collision count, no credit total, no
load track, no registration deadline, no provenance sentence. No fabricated
signals: no workload or difficulty scores, no seat/capacity/popularity data.
No Studentweb integration. No multi-year planning. No ICS, push, maps or
solver. No bilingual UI chrome. No wizard, glossary or FAQ. No
building-level campus filter (the data is city-level only). No drag as a
primary gesture. No week-scrubber.

---

## 9. Features and status

### MUST

| Feature | Status |
| --- | --- |
| Programme + kull → prefilled plan → drawn week, with no account | **Shipped** |
| Merged weekly grid; overlap as a supported state (side-by-side clusters, a pile block when a cluster is too deep to split) | **Shipped** |
| Activity classification (DR-1); øving/lab as a muted toggle layer; the layer auto-reveals when a plan has entries but no lecture-classified ones | **Shipped** |
| Two views, Uke and Liste, plus the week scope picker | **Shipped** |
| Display-level parallel / øving group selection per course | **Shipped** |
| Exam list from catalog `ExamDate`, kont filtered by the client-side date join (DR-3), windowed to the planned semester | **Shipped** |
| Version threading (DR-4) through state and every API call | **Shipped** |
| Dateless-exam state ("dato ikke satt") | **Shipped** |
| Off-semester add notice (DR-10) | **Shipped** |
| Outbound links to `ntnu.no` and `karakterweb.no` on the course row and the session popover | **Shipped 2026-08-18** |
| An honest failure line instead of a blank week (DR-8) | **Shipped** |
| Two-year catalog union so a course taught last year is still addable | **Shipped** |
| Code↔name pairing and code-first entry | **Shipped** — inside the planner's add modal |
| Pre-publish as a *primary* mode (DR-2) | **Partial** — an unpublished semester is an informed choice, but there is no dedicated pre-publish layout |
| Mobile day-agenda restructure | **Not built** — the Liste view and the week's width law cover much of the need |

### SHOULD

- DR-2's dedicated pre-publish layout.
- Screen-reader summary of the drawn week; recursive retning render;
  `publishedYears`/`periodNumber` gating (DR-5).
- Day-load strip and free-day sentence.

### COULD

- par/odde single-cell rendering.
- English course names, data permitting; not UI chrome.

---

## 10. Decisions that stay decided

Do not re-litigate or silently re-add these.

| # | Decision | What was rejected, and why |
| --- | --- | --- |
| D1 | **retired.** The shared plan is deleted, not deferred (§11). | The whole growth-loop argument. Nobody shares schedules; the mechanism cost an account system, a crypto layer, a KV namespace and a fifth page. |
| D2 | **No compare matrix, no `?mot=` compare page, no substitution engine.** | Unchanged, and now moot: the facts a compare table would have compared are all outbound links. |
| D3 | **retired.** No metrics, none planned (§2). | Instrumenting a two-page site with no growth loop. |
| D4 | **Activity classification is asymmetric** (DR-1). | Øving-group clustering with alternative-avoidance. Unbuildable on our data. |
| D5 | **retired.** The join is gone; there is nothing composed to be honest *about* except the fetch itself, which DR-8 still covers. | — |
| D6 | **Exam dates from catalog `ExamDate`, not scraped exam text** (DR-3). | Driving the list from the scrape. Its date is null for hjemmeeksamen, `dateText` is prose, `occasion` is free text. |
| D7 | **Version is first-class in state and every API call** (DR-4). | A `{code, name}` plan state that drops the version on the way out. Re-versioned courses would show the wrong grid and exam. |
| D8 | **The study plan never asserts "group satisfied"** (DR-5). | "Survivors satisfy the group". There is no choose-N field; the count is free text only. |
| D9 | **Pre-publish is a value-carrying primary mode** (DR-2). | Treating pre-publish as a fallback. `timetablePublished` is false through most of the window. |
| D10 | **We do not compete with NTNU** (mandate 3). `/emne/[code]/` and `/emner/` are deleted; the emnepage and the grade statistics are links. | A course page built as a fork point with a clash sentence, a season-split grade figure and prose in a disclosure. It was 826 lines and ~5 470 built pages of a thinner `ntnu.no`, and the grade figure was a thinner `karakterweb.no`. Two sites already do both properly. |
| D11 | **No grade statistics on this site, in any form.** | The season-split figure, its constraints, and the whole "grade stats only in a decision context" compromise. There is no decision context left, and the link is better than the compromise. |
| D12 | **retired.** The registration deadline is deleted with the rest of the verdict apparatus. | — |
| D13 | **A week SCOPE picker ships; no week-scrubber.** | The scrubber stays killed. The picker is not one: the mønsteruke draws two sessions that never co-occur in the same slot, so the DRAWING contradicted itself and the only way to settle it by eye was to open each block's card and read its weeks. It is a scope selector in the same family as the layer box and the view switch, «Alle uker» remains the default outside the teaching period, and there is no timeline to drag. **A block-level popover is explicitly in scope**, and now carries the two outbound links. |
| D14 | **`/studier/` and `/studier/[code]/` are deleted outright, no redirects.** | Migrating them, or sequencing entrances before deletion. Pre-launch breakage is acceptable (mandate 12). |
| D15 | **There is no hash grammar and no URL-carried plan state.** | Versioning the `#v2;…` grammar instead of deleting it. |
| D16 | **localStorage is the only store; the worker holds nothing about a student.** | Accounts, PINs, client-side encryption, KV records, device lists, and the `/user/<navn>` mirror. All shipped, all deleted 2026-08-18. A student who clears their browser clears their plan, and the page says so. |
| D17 | **No verdict.** The week is drawn; it is not judged. | Collision chips, the credit total and 30 sp load track, the provenance sentence, the registration deadline, conflict margin notes. What survives is geometry: overlapping sessions are still drawn side by side, because drawing them stacked would be wrong regardless of whether we comment on it. |

---

## 11. Killed and demoted

**Killed 2026-08-18, with the reduction.** The account system (signup, login,
PIN, device handling); client-side sync and its crypto layer; the KV sync
namespace; the shared plan and `/user/<navn>`; the link unfurl and its
`X-Robots-Tag` pairing; the Del button; `/emne/[code]/` and all ~5 470 built
course pages; `/emner/` and its city facets; the season-split grade figure
and every grade code path; the plan-aware clash preview; the credit total and
the 30 sp load track; the collision verdict chips; the registration deadline;
the provenance line; the conflict margin notes; the exam list's lesedager gap
lines; the homepage pitch; the 480 px topbar menu fold.

**Killed earlier, and still killed.** Øving-group clustering with
alternative-avoidance; the compare matrix and both substitution engines; the
week-*scrubber* (**not** the week scope picker, see D13); personal fixed
blocks; assessment-mix workload counts; `/studier/` and `/studier/[code]/`;
the homepage triptych, programme picker and proof fragment; the sitewide plan
strip, the plan-count link and the topbar studieinfo chip; auto "best 2 of 5"
or any "group satisfied" assertion; programme marketing prose as primary
content; bilingual UI chrome; a glossary or FAQ; building-level campus
filtering; the "+N til" overflow chip on deep clusters.

**Killed onboarding apparatus, and it stays killed:** a welcome modal; a
guided tour or coach marks; a progress stepper; a sample, demo or seeded
"example" plan; illustrations in empty states. Onboarding's whole job here is
time to value, and the value is two decisions and about fifteen seconds
away — programme, kull, a drawn week with real rooms. Anything that stands
between a student and that week costs more than it teaches. The empty states
are the onboarding: they say what to do next and get out of the way.

---

## 12. Open questions

- **DR-2's dedicated pre-publish layout.** An unpublished semester is an
  informed choice today, not a designed mode.
- **The lecture classifier's precision on non-English course names.** Needs a
  small hand-labelled validation set. The failure mode is benign by DR-1's
  asymmetry: a muted label, never a session invented in the default week.
- **Whether `/` earns its own page** now that it holds a card and a button.
  It survives this cut because a front door that answers "where am I next"
  is worth one page; if it stops earning that, merge it into `/planlegger/`.
