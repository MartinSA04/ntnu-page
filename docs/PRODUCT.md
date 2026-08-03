# PRODUCT.md — Semesterplan

The definitive product definition: what this site is for, what it must do,
what it must never do, and which decisions are closed. `docs/ROADMAP.md`
sequences what is left. `docs/SPEC.md` covers architecture and data
contracts. `docs/DESIGN.md` is the design system and is assumed law here.

Where this file and any other disagree about *product* scope, this one wins.

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
2. **The weekly schedule is the primary surface.** The drop/add window runs
   well into the first month of the semester; the schedule is what people
   come back to. Everything else supports it.
3. **Editing is trivial.** Drop a programme course → it grays out in the
   course list, still visible as part of the programme, one tap to restore,
   excluded from schedule and credits. Add extra courses on top. Manual adds
   are removable outright.
4. **Lecture-based by default**, with one toggle to show øvinger and labber
   (this is DR-1's asymmetry, expressed as a control).
5. **Graceful pre-publish fallback** when timetables aren't out (DR-2):
   never blank — course list, exam dates, and a "publiseres ~august" note.
6. **Parallels default to the programme's own, user-selectable per course.**
   Some students have other commitments and need to pick a different
   parallel. This is display-level selection, not conflict detection —
   DR-1 is narrowed by it, not reopened.
7. **The schedule must render simultaneous items properly.** People
   deliberately take colliding courses; overlap is a *supported state*, not
   breakage.
8. **Programme/kull/retning editing gets a real settings surface**, because
   people have webpage patterns they are used to. **Delivered**, as the
   profile panel: the planner's action bar carries one door into it
   ("Profil") rather than the two nested doors — an account entrance and a
   studieinfo entrance into the same room — that preceded it.
9. **Manual adds are semester-specific.** A course added in one semester
   must not leak into another.
10. **No versioning or compat apparatus — delete old code outright.**
    Pre-launch, not published anywhere, so breaking old links and stored
    state is acceptable. *This rule resumes once the site has real external
    links worth not breaking; until then, do not build compat layers.*
11. **DO NOT OVERCOMPLICATE.** As simple as possible while keeping the
    value. When in doubt, cut.

---

## 2. Positioning and the one job

**Positioning.** Semesterplan is the *thinking tool upstream of
Studentweb* — where an NTNU student assembles a candidate set of courses and
finds out, before the registration deadline, whether that semester holds
together: lectures don't collide, exams aren't stacked, credits reach a full
load. Unofficial, free, no account required. It composes data no official tool
composes together — catalog, timetable, exam, study plan and grade history
as **one shareable object**.

**The moat, priced honestly.** Every incumbent owns one column: description
(ntnu.no), timetable-merge (TP), grade stats (DBH). None owns the *row* — the
join across columns for a set of courses in a chosen semester. That join is
ours, and it comes with one thing absent everywhere else: **a single
shareable stateful URL, no account required.**

But the join is only worth more than four correct single-column tools *if it
tells the truth about its own thinness.* Three of the five columns are soft:
the timetable is absent for most of the planning window and group-blind; the
study plan carries no "choose N" cardinality; grade codes live in a different
string space than course codes. So the honest one-liner is:

> **We assemble your semester and sanity-check it — and we show you exactly
> what we couldn't verify.**

That second clause is not a hedge. It is the differentiator and the answer to
"why not just use ntnu.no". Provenance and staleness are a **first-class MUST
surface** (DR-8), not an edge state.

**The one job:**

> **"Kan jeg ta disse emnene sammen — og hvis ikke, hva bytter jeg?"**

"Hva bytter jeg" commits us to helping a student *choose*, not just check.
The line we draw: helping someone decide means **surfacing the one or two
facts a decision actually turns on, inline, at the moment of choice** — not a
comparison matrix. The decide-loop is a sentence and a red mark, not a
spreadsheet.

**Success metrics.** "Did the student leave sure?" is unobservable on an
account-less static site; it is a design principle, not a metric. What we
would instrument (client-side, privacy-respecting, no accounts — **not built,
see ROADMAP**):

| Metric | Why it is the right one |
| --- | --- |
| **Shared-link creations and opens** (north star) | The only growth path for a user who didn't google a course code. A created share is a plan someone found worth sending. |
| **`/emne/[code]` → "Legg til" → planner funnel** | Converts search-engine arrivals, our largest cold traffic, into plan-holders. |
| **Return rate across a Feb-1 / Sep-15 window** | Planning is bursty and deadline-shaped. Do people come back as the deadline nears and after timetables publish? |
| **Clash-preview engagements before add** | The closest observable proxy for the decide behaviour itself. |

---

## 3. Personas

Ordered by weight. **A** and **B** are co-primary but serve different
moments; **C** is a lens on both, not a separate build.

- **A. Velgeren (elective chooser)** — 3rd–5th year, one or two elective
  slots drawn from overlapping choice groups; today uses ntnu.no + TP + a
  spreadsheet. The pain is *set-narrowing under a small number of hard
  facts*. Jobs: pull a choice group's courses in as candidates; for each, see
  the facts a real decision turns on — **does it clash with what I've
  committed, is it project- or exam-assessed, is the grade distribution
  brutal** — inline; drop the losers; commit the survivors; hand off to
  Studentweb. What is deliberately *not* built for them: a four-axis compare
  matrix, a deep-linked compare page, and any substitution engine. Electives
  are decided on one or two facts by someone who shows up twice a year.

- **B. Førsteklassingen (week-1 receiver)** — the onboarding shape. Five
  codes and one question: "where do I walk in at 10:15." Jobs: programme +
  kull (or paste codes) → this week's schedule with rooms → code↔name
  translation → "bekreft i Studentweb". The pre-fill is authoritative per
  mandate 1, but DR-7's fallback math means it must still be **editable and
  honestly labelled** where the period arithmetic is uncertain.

- **C. Logistikeren (constrained week)** — a *lens* on A and B. Needs the
  week *livable*, not just non-colliding: which days are free, gap quality,
  where the semester's edges are. This lens is what forces the mobile
  treatment and justifies the day-load and free-day work. It does **not**
  justify a week-scrubber — that is a during-semester concern in a
  before-semester tool.

**Not personas:** the grade-aware strategist and the exchange student both
reduce to filters and honest signals we already commit to (season-split grade
trend, kont dates, language/campus/assessment filters). Keeping them as
personas dragged bilingual work back in for a sliver of users. Also not a
persona: the multi-year degree planner — a different instrument that would
drown the one-semester job.

---

## 4. Core flows

Two are co-primary: **the elective decide-loop (2)** and **the shared-plan
handoff (5)**. The second is the growth loop, not plumbing.

1. **On-ramp.** `/` is a landing: it shows the student's own next session and
   room when a plan exists, and otherwise one CTA into `/planlegger/`. The
   planner owns onboarding through its own empty states — the studieinfo
   modal is the only picker on the site.

2. **Elective decide-loop (CO-PRIMARY, not built — ROADMAP Phase 4).**
   Choice group → "legg alle til vurdering" (shortlist tier) → **inline in
   each row: "kolliderer med planen din" plus two facts** (assessment form,
   grade shape) computed against committed courses → ghost blocks on the grid
   → drop losers → **on promotion, a plain-language delta**: *"TDT4200 →
   TDT4258: fjerner 1 kollisjon, sprer eksamen fra 1 til 4 lesedager."*
   → credit total climbs → commit summary → Studentweb. The choice-group
   prose lives in the planner's "Fra studieplanen" panel; the entry point for
   this flow needs re-deciding whenever Phase 4 starts.
   *Lesedager = the free days between two exams, both exam days excluded.*

3. **Free search and add.** `/emner/` — a *mode*, not a co-equal
   destination — with city facets and ranked search, then quick-add, then
   the plan is read back on `/planlegger/`.

4. **Single-course research → fork** (largest cold traffic).
   `/emne/[code]/` is a **fork point, not an encyclopedia.** Primary CTA:
   "Legg til i planen", with a plan-aware clash sentence beneath it. The week
   renders as a grid, the season-split grade figure sits in the decision
   context, and all prose is demoted into one disclosure. We stop competing
   with ntnu.no on encyclopedic depth we would lose on.

5. **Shared-plan handoff (CO-PRIMARY, growth loop).** A received plan URL is
   a first-class object:
   - **Static-tier first paint** — codes, names and credits render from the
     hash plus the search index *before any API fetch*.
   - **Real unfurl** — the link preview reads *"Kari deler en plan: 5 emner ·
     28,5 sp · Høst 2026"*, derived from the hash with no fetch. *(Not
     built — Phase 3.)*
   - **Three actions:** **"Bruk denne"** (replace) · **"Slå sammen"** (union,
     deduped, with a preview of incoming codes) · **"Behold min egen"**.
     Binary destroy-or-ignore is not acceptable. *(Today: an incoming link
     replaces, and the plan it overwrote is offered back as an undo. The
     merge action is Phase 3.)*
   - The URL is a group's **re-editable canonical plan** — the same link,
     re-opened after edits, is the current plan.

6. **Livability check.** Day-load strip and free-day sentence;
   semester-edge sentence; **whole-semester conflict notes always shown**
   regardless of which week is in view.

**Rules baked into every flow:**

- **The deadline is on screen.** The whole positioning is "before the
  registration deadline"; it may never be off-screen on the planner.
- **Return trigger in the shared artifact:** when `timetablePublished` or the
  exam window is about to flip, the artifact says *"Timeplan publiseres ~12.
  aug — kom tilbake da for å sjekke kollisjoner."* This is the only thing
  that pulls a handed-off user back. *(Not built — Phase 3.)*
- **Provenance on every composed verdict** (DR-8): *"Timeplan sist hentet
  22. jul · eksamensdato ikke publisert."* The join admits its gaps.

---

## 5. IA

**Four pages, plus a sitemap. Persistent nav. Search is a mode, not a
destination.**

- `/` — **landing.** The student's own next session and room when a plan
  exists (this is the proof: the real thing, not a drawing of it), a
  verb-first headline, one CTA to `/planlegger/`.
- `/planlegger/` — **the app.** The plan, the week, the verdict, the exam
  list, the course rail. Search lives inside it as a modal.
- `/emner/` — **find courses.** Real deep search and a search-engine landing.
- `/emne/[code]/` — **the fork point.** Plan-aware, with a clash sentence
  under the CTA.
- `/sitemap.xml` — the only route into the ~5 470 built course pages;
  nothing server-rendered links to them.

**Nav: Planlegger + Emner, on every page.** No page-dependent single pill, no
footer demotion of `/emner/`. `aria-current` is computed from an explicit
per-item section list rather than a path prefix, so `/emne/[code]/` (not a
prefix-match of `/emner/`) still lights the right item.

**The topbar carries no plan state.** Three successive attempts at a sitewide
plan affordance — a plan strip, a plan-count link, and a studieinfo chip —
were each built and each removed. The planner is where the plan is named, and
`/planlegger/`'s own "Profil" button (formerly "Endre") is the single
entrance to it — programme/kull/retning editing and the optional account open
through the same door (mandate 8). **Do not re-add a sitewide plan bar of any
kind.** Any credits shown outside `/planlegger/` are best-effort, not
authoritative.

**`/studier/[code]/` and `/studier/` are deleted, no redirects.** Their
surviving logic moved: kull relevance and plan fetch into the studieinfo
modal, period courses and verbatim choice-group prose into the planner's
"Fra studieplanen" panel, where "Bruk som planen min" semantics now live —
saving programme + kull in the modal *is* the import.

**URL is the state, and it is the growth object.** See §6. Query params are
page-local only: `?q=` on `/emner/` (search prefill, round-tripped through
`history.replaceState` so Back from a course page restores results).

---

## 6. State and hash grammar

```ts
interface PlanState {
  semesterId: string;                 // "26h" | "27v" — Semester.id
  courses: {
    code: string;
    name: string;
    version: string;                  // FIRST-CLASS — "1" default; threads to API + grid + exam
    source: "program" | "manual";     // programme-derived vs. added by hand
    dropped: boolean;                 // programme course grayed out, never deleted
    credits: number | null;           // carried from the study plan, so a catalog miss doesn't zero it
    groups?: string[];                // selected parallel / øving group keys
  }[];
  program?: { code: string; name: string; cohort: number; direction?: { code: string; name: string } };
}
```

**Hash grammar — unversioned, no compat parse** (mandate 10):

```
#<semesterId>;<programme>;<courses>
```

- `semesterId` — `/^\d{2}[hv]$/i`, e.g. `26h`. Whether the *site* can plan
  that id is the caller's problem, not the grammar's: an id we have no
  plannable data for falls back to the current semester with a visible note.
  It never fails to parse.
- `programme` — `-` (none) or `code[.cohort[.direction]]`. `cohort` must be a
  plausible 4-digit year or the **whole** programme segment is rejected while
  the rest of the hash still parses. That gate is what stops a bare course
  list being misread as a programme with a one-digit cohort.
- `courses` — comma-separated `[-|+]code[.version][~groupKey…]`. No prefix =
  active programme course; `-` = dropped programme course; `+` = manual add.
  `.version` is omitted when it equals the default `"1"`. Each trailing
  `~groupKey` is a selected parallel or øving group, repeatable. Malformed
  course tokens are dropped rather than failing the whole parse.
- **Encoding is load-bearing.** Every field is `encodeURIComponent`-escaped
  on write and decoded on read. That leaves the grammar's own punctuation
  untouched while escaping `; , / %` and every non-ASCII byte, so `Ø`/`Å`/`Æ`
  in a direction code (`BSPL26-V-GJØVIK`) round-trips exactly. A malformed
  escape is returned verbatim rather than failing the whole parse.
- `hashchange` is listened for, so pasting a shared link into an already-open
  tab applies it — ignoring the hash the page just wrote itself.
- **The hash wins over storage** when it carries a real plan. That is right —
  a link that did not show its own plan would be pointless — but it is
  destructive, so the overwritten plan is kept in memory and offered back.

**Storage** is split three ways so semesters stay independent:
`np:profile` (the programme choice, global), `np:plans` (the course list,
keyed per `semesterId`), `np:lastSemester` (session restore).

**Adding a field is additive.** Phase 4's shortlist `tier` is a new
`courses[]` property and needs no version token. A change that is *not*
additive — restructuring the courses segment's grammar itself — would need
one, and mandate 10 would have to be lifted first.

---

## 7. Domain rules (binding)

Each names the data reality that forces it.

- **DR-1 — Conflict engine is lecture-only.** `TimetableEntry` has no
  `activityCode` and no group-membership field; keying on
  `courseCode+day+start+end` *merges* parallel øving groups instead of
  distinguishing them, and there is no way to enumerate "alternative slots
  that avoid the clash". So: **hard conflicts are lecture-only**, lectures
  classified from the activity `title`; øving and lab render as a muted,
  non-clashing layer. "Only hard-flag when no alternative avoids the clash"
  is **unbuildable** on our data and would produce confidently-wrong answers
  on every lab-heavy course.

  **The asymmetry is the point.** Misclassifying an øving as a lecture is a
  *false red* — the failure DR-1 exists to prevent. Misclassifying a lecture
  as "other" only hides it behind the toggle. So anything that is not an
  unambiguous lecture becomes "other".

  Two qualifications, both measured. A bare delivery-format title (a
  department that publishes no finer title than "Formidling") is a lecture
  signal via a **closed list**; the general "fall back to the name bucket
  when the title is opaque" rule was built, scored and **rejected** — it
  promoted programme names and orientation weeks to lectures. And a
  *samling* is a lecture: it is the gathering a samlingsbasert programme
  calls its students in for, and that gathering is the teaching. Together
  these take zero-lecture course-terms from 35 % to 20 %. The residual 20 %
  genuinely has no lectures and is handled by **DR-8 provenance** — a margin
  note naming the courses — not by guessing.

  Display-level group selection is a **separate, shipped** concern and does
  not reopen this rule.

- **DR-2 — Pre-publish is a primary mode.** `timetablePublished` is false
  through most of the elective-planning window and the timetable returns `[]`
  then, so a grid-only flagship is **blank exactly when Velgeren plans.** The
  clash engine degrades to exam-clash and campus-spread; exam list, credits,
  grades and assessment carry the mode. "Next plannable term" must not force
  a blank primary surface.

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
  `PlanState`, in every API call, and in the hash. 293 of 5 470 courses are
  not version `"1"`. The grade join is bare-prefix aggregation, because
  `GradeRow.courseCode` lives in a suffixed string space.

- **DR-5 — The study plan has no cardinality; never assert "group
  satisfied".** `PlanCourseGroup` is `{code, name, description, courses[]}` —
  no min, max or choose-N. The "velg 2 av 5" exists only in free-text
  `description`. So the decide-loop shows a **credit running total plus a
  verbatim quote of the group prose**, and the app **never** asserts a group
  is satisfied or auto-picks "best 2 of 5".

- **DR-6 — The credit total is null-holed.** `PlannedCourse.credits` is
  nullable and the authoritative number is on course details, so the total is
  async-aware: *"22,5 av 30 sp (+2 emner uten oppgitt sp)."* Off-semester
  courses are excluded from the sum. An overload is not green.

- **DR-7 — First-year period math is fragile.** `periodNumber` is nullable,
  `startTerm` is nullable (spring intakes break `autumn ? 1 : 2`),
  unpublished cohorts return null, and `studyChoice.code` "O" is unreliable.
  Fall back to the nearest published year, honour `startTerm`, default to
  period 1 with a user-editable chip when null, and keep the result
  **editable**. Mandate 1 makes the pre-fill the default plan; DR-7 makes it
  correctable.

- **DR-8 — Provenance is a surface, not an edge state.** Every composed
  verdict carries a data-freshness line built from *what actually happened
  this render*: last-crawl date, "eksamensdato ikke publisert", "timeplan
  ikke publisert ennå", real per-course fetch failures. **"Came back empty"
  and "we could not ask" must never collapse into "no blocks drawn"** — that
  is precisely how a failed fetch renders as "ingen kollisjoner". A verdict
  computed over an incomplete plan says so.

- **DR-9 — "Next plannable term" is an explicit rule.** Defined across the
  Sep-15 / Feb-1 seam from `semesters.json`'s `phase`, `fromDate`, `toDate`,
  `examLastDate` and `timetablePublished` — not an invisible default. It
  drives both the semester default and the deadline line, and a semester chip
  for an unpublished term carries its own inline note rather than being a
  silent trap.

- **DR-10 — Off-semester add is defined.** An off-semester add yields a
  notice line and is **excluded from the credit total**, so the "full load"
  signal isn't corrupted. `planElement` filtering applies on bulk add;
  genuine 0-sp courses stay.

**Never** re-parse scraped free-text into structured facts. Branch only on
structured `form` and `weighting` — and not on `continuation`, which is
structurally present but empirically always false, so a branch on it is a
branch on nothing (DR-3).

---

## 8. Non-goals

No accounts required. Optional sync stores only client-encrypted blobs. No
Studentweb integration (always "bekreft i Studentweb"). **No fabricated
signals** — no workload or difficulty scores, no thesis-relevance, no auto
"best 2 of 5", no seat/capacity/popularity data.
No cross-course grade leaderboard. **No compare matrix** — facts inline, not
a spreadsheet. No multi-year planning in the planner. No ICS, push, maps or
solver. No bilingual UI chrome. No wizard, glossary or FAQ. No
building-level campus filter (the data is city-level only). No drag as a
primary gesture. No hue-tinted grade bars. **No week-scrubber.** **No
assessment-mix workload count** — it sits on the wrong side of the
no-fabricated-scores line. **No personal fixed blocks** — localStorage-only
state breaks shared-URL parity, which is the growth object.

---

## 9. Features and status (MoSCoW)

The nouns here are mostly incumbent-owned (catalog, grid, description, grade
stats). The **verbs** are ours — decide, preview, swap-delta, share,
admit-gaps — and they outrank the nouns when something has to give.

### MUST

| Feature | Status |
| --- | --- |
| Merged weekly grid with red-ink collisions; overlap as a supported state (side-by-side clusters, a pile block when a cluster is too deep to split) | **Shipped** |
| Lecture-only conflict engine (DR-1); øving/lab as a muted toggle layer; the layer auto-reveals when a plan has entries but no lecture-classified ones | **Shipped** |
| Display-level parallel / øving group selection per course | **Shipped** |
| Exam list from catalog `ExamDate` with explicit gap lines, kont filtered by the client-side date join (DR-3), windowed to the planned semester | **Shipped** |
| Live, null-aware credit total (DR-6), off-semester excluded, overload not green | **Shipped** |
| Plan-aware clash preview **before** add — **on `/emne/[code]/` only** | **Shipped, deliberately narrowed** |
| Provenance / staleness line on every composed verdict (DR-8), recomposed after fetches land | **Shipped on `/planlegger/`**; absent on `/emne/[code]/` |
| Version threading (DR-4) through state, every API call and the hash | **Shipped** |
| Dateless-exam state ("dato ikke satt") | **Shipped** |
| Off-semester add handling and notices (DR-10) | **Shipped** |
| Season-split grade trend, rendered *in a decision context* | **Shipped on `/emne/[code]/`** — see the constraints below |
| Registration deadline on screen | **Shipped** — `deadline.ts`; a passed deadline says nothing at all |
| Two-year catalog union so a course taught last year still gets a page | **Shipped** |
| Shared plan as a first-class object | **Partial** — the hash round-trips including non-ASCII, `hashchange` applies a pasted link live, a Del button copies or invokes the native share sheet, and an overwritten plan is offered back. No unfurl title and no merge action yet |
| Code↔name pairing and code-first entry | **Partial** — the planner's add modal is code-first; the landing page does not offer a paste entry |
| Pre-publish as a *primary* mode (DR-2) | **Partial** — an unpublished semester is an informed choice, but there is no dedicated pre-publish layout |
| Decide-loop inline facts in choice-group rows | **Not built** — Phase 4 |
| Plain-language swap delta sentence on promotion. *This is the product.* | **Not built** — Phase 4 |
| Shortlist tier (committed vs. considering), candidates in the hash from day one | **Not built** — Phase 4 |
| Commit summary: copyable code list + "bekreft i Studentweb" | **Not built** |
| Language / campus / assessment filters | **Partial** — campus ships as ~4 city facets on `/emner/`; language and assessment are not built |
| Mobile day-agenda restructure | **Not built** — the Liste view and the week's width law cover much of the need; the agenda itself is still open |

**The grade figure's binding constraints** (all shipped, and all of them are
what keeps this on the right side of the no-DBH-mirror line): season-split
small multiples, one chart per sitting, newest first; cohort `n` written out
on every chart and no bars at all under 10 candidates; one hue for every bar
with F deliberately **not** red; one shared y-peak per grade scale so a
pass/fail term cannot flatten the letter charts; no sortable column, no
cross-course leaderboard, no derived difficulty score. **Deferred sittings
must never be drawn as peer semesters** — DBH files them as their own (year,
semester), so the newest chart was otherwise the re-sit cohort's ~60 % fail
rate read as the course's current difficulty. They are held out and named in
a note, fail-open, with a size guard so a course that has moved term does not
have its real cohorts relabelled.

**Why the clash preview is asymmetric.** It shipped on all three surfaces and
was removed from the two **search** surfaces — `/emner/`'s rows and the
add-course modal — along with the hover dwell, the generation guard and the
"Sjekker kollisjon" indicator that covered the wait. Searching is not the
moment a plan is judged: a verdict per visible row is a timetable fetch per
row per plan course, and the answer arrives while the student is still
scanning names. The verb stays where a student is looking at *one* course,
and where the plan itself is drawn. **Do not reinstate it on a search surface
for consistency** — the asymmetry is the decision.

### SHOULD

- Day-load strip and free-day sentence (persona C).
- Provenance line on `/emne/[code]/`.
- Screen-reader conflict summary; recursive retning render;
  `publishedYears`/`periodNumber` gating (DR-5).
- Grade shape in the elective decision cell (the Phase 4 half of the figure).

### COULD (behind evidence anyone reaches it)

- Deep-linked `?mot=` two-course view, as an *add surface* only — never a
  matrix.
- par/odde single-cell rendering.
- English course names, data permitting; not UI chrome.

---

## 10. Decisions that stay decided

Do not re-litigate or silently re-add these.

| # | Decision | What was rejected, and why |
| --- | --- | --- |
| D1 | **The shared plan is a co-primary, first-class object** — static first paint, real unfurl, merge/replace/keep. | Filing "URL is the state" under plumbing, and a binary replace-or-ignore interstitial. It is the only growth path for a non-search arrival, and binary destroy-or-ignore nukes an hour of work. |
| D2 | **No compare matrix, no `?mot=` compare page, no substitution engine.** Keep the shortlist tier and one plain-language swap-delta sentence. | A four-axis compare table with ghost blocks and swap logic. Electives are decided on one or two facts by a twice-a-year user; the *sentence* carries the value, not the table. |
| D3 | **"Left sure" is a design principle; instrument shares, funnel and return rate.** | "Did the student leave sure?" as the success metric — unobservable on an account-less static site, and self-flattering. |
| D4 | **The conflict engine is lecture-only** (DR-1). | Øving-group clustering with alternative-avoidance. Unbuildable on our data; ships confidently-wrong answers. |
| D5 | **The moat is "the join that admits its gaps"; provenance is a MUST surface.** | "We own the row" as self-sufficient. A wrong composite from a stale scrape is *worse* than four correct single-column tools. |
| D6 | **Exam dates from catalog `ExamDate`, not scraped exam text** (DR-3). | Driving the list from the scrape. Its date is null for hjemmeeksamen, `dateText` is prose, `occasion` is free text. |
| D7 | **Version is first-class in state, every API call and the hash; the grade join is bare-prefix aggregation** (DR-4). | A `{code, name}` plan state and a bare-code hash. Re-versioned courses would show the wrong grid and exam. |
| D8 | **The study plan never asserts "group satisfied"; show the credit total plus verbatim prose** (DR-5). | "Commit at 30 sp" / "survivors satisfy the group". There is no choose-N field; the count is free text only. |
| D9 | **Pre-publish is a value-carrying primary mode** (DR-2). | Treating pre-publish as a fallback. `timetablePublished` is false through most of the elective window. |
| D10 | **Persistent nav: Planlegger + Emner, on every page. `/emne/[code]` is a fork point, not an encyclopedia.** | A single layout-dependent nav pill, and a course page built as research/encyclopedia. The loudest surfaces were the least differentiated; the IA must obey the positioning. |
| D11 | **Grade stats only in a decision context.** The fork point *is* one, so the season-split figure ships there under §9's constraints. | Browsable grade trivia: a sortable column, a cross-course leaderboard, hue-tinted bars, a derived difficulty score, or any figure divorced from the fork CTA. That is DBH-mirror parasitism. |
| D12 | **The deadline and "next plannable term" are MUST** (DR-9). | Leaving the deadline off-screen — it was in zero of six flows — and "next term" as an invisible default. |
| D13 | **No week-scrubber, no personal fixed blocks, no assessment-mix workload count.** | All three were SHOULD/COULD in an early draft. A during-semester concern in a before-semester tool; breaks shared-URL parity; wrong side of no-fabricated-scores. **A block-level popover is explicitly in scope** and is not covered by this row. |
| D14 | **`/studier/` and `/studier/[code]/` are deleted outright, no redirects.** | Migrating them, or sequencing entrances before deletion. Pre-launch breakage is acceptable (mandate 10); the surviving logic moved into the studieinfo modal and the planner's study-plan panel. |
| D15 | **The hash grammar is unversioned, with no compat parse** (mandate 10). | A frozen `#v2;…` grammar with a v1-compat branch. Suspended, not abandoned: it resumes when there are external links worth not breaking. |

---

## 11. Killed and demoted

**Killed:** øving-group clustering with alternative-avoidance; the compare
matrix and both substitution engines; the week-scrubber; personal fixed
blocks; assessment-mix workload counts; the `/studier/` index and
`/studier/[code]/`; the homepage triptych; the homepage programme picker;
the homepage proof fragment (a drawing of two invented courses colliding is
not evidence the product works — the landing answers with the student's own
next session instead); the sitewide plan strip, the plan-count link and the
topbar studieinfo chip; "did the student leave sure?" as a *metric*; auto
"best 2 of 5" or any "group satisfied" assertion; programme marketing prose
as primary content; bilingual UI chrome; a glossary or FAQ; the cross-course
grade leaderboard; building-level campus filtering; the "+N til" overflow
chip on deep clusters (a count the student could not act on, replaced by a
pile block that names every session in it).

**Demoted to COULD, evidence-gated:** the `?mot=` two-course view as an add
surface; English course names; par/odde single-cell rendering.

---

## 12. Open questions

- **Which counter mechanism satisfies §2's four metrics without accounts.**
  Edge-worker aggregate counters versus a privacy-preserving client beacon.
  A build detail; it does not change the product. Nothing is instrumented
  today.
- **Does a cold Persona-B visitor need a paste entry point on the landing
  page**, given the planner's own empty states already offer one? The
  homepage no longer leads with a picker, so the old framing ("promote paste
  above the picker") no longer applies.
- **The lecture classifier's precision on non-English course names.** Needs a
  small hand-labelled validation set. The failure mode is benign by DR-1's
  asymmetry: a muted label, never a false conflict.
- **Where the Phase 4 decide-loop enters from**, now that `/studier/[code]/`
  is gone and the choice-group prose lives in the planner's rail.
