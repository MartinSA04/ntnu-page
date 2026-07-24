# P6 — UX Researcher: the student's year and the job map

Lens: what a real NTNU student is *trying to do* when they open this site, mapped
onto the calendar that forces them to open it. The site's job is not "browse
courses" — it is to end a moment of anxious uncertainty with a **confident
choice** the student then commits in Studentweb. Everything below ranks the
site's work by that yardstick.

---

## 1. The student's year — when this site gets opened, and why

The academic calendar creates the demand. Nobody opens a semester planner "to
browse." They open it because a **deadline or a decision is bearing down**. The
NTNU year has five spikes and three troughs. Only the spikes matter.

| Window | Calendar reality | Who opens the site | Emotional state |
|---|---|---|---|
| **Late Nov – early Dec** | Spring courses/timetables surfacing; students planning *next* semester while sitting in *this* one's lectures | Continuing students choosing spring electives | "What am I taking in January, and does it fit?" — deliberative, has time |
| **~Feb 1** | Spring exam-registration deadline (`examLastDate`); *also* the moment spring choices become binding | Everyone registering for spring | Deadline pressure; wants confirmation, not exploration |
| **Exam period (Dec / May–Jun)** | Sitting exams; glancing at the *next* term | Light traffic; "when is my exam / how spread are they" | Stressed, low patience, single-question |
| **August scramble** | `fromDate` ~late July; timetables publish *just* before term (`timetablePublished` flips); kont exams running; new fall electives live | Continuing students finalizing fall; kont-takers; first-years orienting | **Highest urgency + highest volume.** "Term starts in days, does my plan actually work?" |
| **~Sep 15** | Fall exam-registration deadline | Everyone registering for fall | Deadline pressure |

Troughs (mid-semester Feb–Apr, Sep–Nov, July): near-zero planning intent. Do not
design for them; do not let mid-semester emptiness drive feature decisions.

**Two hard truths the calendar imposes:**

1. **The site is a *next-semester* tool used *during* the current one.** At every
   spike the student is planning a semester they are not yet in. The default
   semester must be the **next plannable one**, not `current`. Defaulting to
   "Høst 2026" in October is right; defaulting to it in February is wrong. The
   semester chips (current + next two) are the single most calendar-sensitive
   control on the site — get the *default selection* wrong and every job starts
   with a correction.

2. **Timetable-published is a gate, not a detail.** Before publish (the long
   Nov→Aug wait for fall, the autumn wait for spring), the planner *cannot*
   answer its headline question "does it clash?" — there is no grid. That is not
   an edge case; it is the state the tool sits in for **most of the planning
   window**. The design must have a real, useful pre-publish mode, not just a
   grey "timeplan ikke publisert ennå" apology (see §4, failure mode F1).

---

## 2. The top 5 jobs — trigger → entry → steps → done → failure

Ranked by frequency × pain × fit-to-available-data. Each "done" is a **confident
choice**, and the honest end-state is *the student leaves for Studentweb*. The
site wins by making that handoff feel earned, not by trapping the user.

### JOB 1 — "Do my chosen courses fit together?" (the core loop)
*The reason the product exists. Every other job is a feeder or a variant.*

- **Trigger:** Student has a rough set in mind (2–5 codes: obligatory + a couple
  of electives) and needs to know if it's *takeable* — lectures don't clash,
  exams aren't stacked, credits ≈ 30.
- **Entry point:** `/planlegger/` directly (returning user, plan in localStorage),
  or arrives there after adding from search/course/program pages.
- **Steps:** open planner → confirm correct semester selected → read the merged
  timetable for red-ink clashes → scan exam ribbon for same-day/tight collisions
  → check the "X av 30 sp" total → swap the offending elective → recheck.
- **Done:** "22,5 av 30 sp, no red ink, exams 4 days apart" → screenshots or
  copies the plan → **goes to Studentweb to register.**
- **Failure modes:**
  - **F1 (fatal):** timetable unpublished → no grid → the *whole* value prop is
    absent for the window when the job is most active. Tool feels broken.
  - **F2:** clash shown but student can't tell *which elective* to drop or what
    the alternative is — sees the problem, not the path out. Diagnosis without
    treatment.
  - **F3:** a course "not taught this semester" is silently absent from the grid;
    student reads "no clash" as "fits" when really the course isn't running.
  - **F4:** 30 sp is treated as a hard target when the student is deliberately
    over/under-loading; a scolding tone drives them off.

### JOB 2 — "Which elective should I pick?" (the real planning pain)
*The brief is explicit: electives / valgbare emner are where planning hurts.
This is JOB 1's upstream — choosing the *candidates* before testing the set.*

- **Trigger:** Studieplan says "choose 15 sp from this group / this retning."
  Student faces 6–20 options and no basis to choose.
- **Entry point:** `/studier/[code]` study plan → a choice group / retning with
  N courses.
- **Steps:** see the group's options → compare them on the axes that decide it:
  **does it clash with my locked obligatory courses**, exam date, grade
  distribution (how brutal), teaching language, campus, assessment form (exam vs
  project) → shortlist 2–3 → add to plan → fall into JOB 1.
- **Done:** picks one (or a testable shortlist) with a reason ("TDT4145 — no
  clash, better grade spread, written exam not a semester-long project").
- **Failure modes:**
  - **F5 (structural):** the study-plan page lists choice courses as bare
    links. To compare, the student opens 6 tabs and eyeballs. **The one place
    NTNU explicitly says "choose" is the one place the site gives no help
    choosing.** This is the biggest structural gap.
  - **F6:** clash-against-locked-courses isn't visible *at the choice point* —
    student must add each candidate to the plan and bounce to the planner to
    find out, one at a time. The decision context and the test context are
    different pages.
  - **F7:** grade distribution — a top decision driver for electives — lives two
    clicks away on `/emne/[code]`, disconnected from the choice.

### JOB 3 — "When are my exams / how bad is the crunch?"
*High-frequency, low-effort, deadline- and exam-period-driven. The lightweight
question that pulls people back.*

- **Trigger:** approaching Feb 1 / Sep 15 (registering) or exam period (bracing).
  "Are my exams survivable — any same-day, any three-in-four-days?"
- **Entry point:** `/planlegger/` exam ribbon; or a returning user who only ever
  wanted this.
- **Steps:** open plan → read exam ribbon → spot stacked dots / tight gaps →
  react (drop or swap the course causing the crunch) → register.
- **Done:** "exams span 25 Nov–18 Dec, worst gap is 2 days, no collisions" →
  confident, registers.
- **Failure modes:**
  - **F8:** exam data present in catalog only as season, date missing/TBD for the
    plannable term → ribbon looks empty or wrong → student distrusts it.
  - **F9:** kont/continuation exams (August) and multiple exam occasions per
    course conflated with the ordinary sitting → misreads the date that applies
    to them.
  - **F10:** ribbon shows collisions but not *duration/form* (4-hour written vs
    home exam) — two same-week exams of different weight read as equal stress.

### JOB 4 — "What's my program's plan for next semester — start me off?"
*Especially first-years and anyone on a fixed studieplan. The "give me the
skeleton, I'll adjust" job.*

- **Trigger:** new kull / start of a program year; "what am I *supposed* to take,
  and where are the choices I actually control?"
- **Entry point:** `/studier/[code]` → pick kull → the period matching next term.
- **Steps:** find *my* semester's period (the "ditt semester" highlight) → see
  obligatory courses (auto-included) + choice groups (the decisions) → "Legg til
  alle" the obligatory block → now in the planner with the skeleton pre-loaded →
  spend energy only on JOB 2 (the electives).
- **Done:** plan pre-populated with obligatory courses + correct program/kull
  context recorded; student now only agonizes over the genuinely optional part.
- **Failure modes:**
  - **F11:** student can't identify *which* period is theirs (kull math is
    invisible or wrong) → adds the wrong semester's courses.
  - **F12:** obligatory vs choice isn't visually load-bearing → student treats a
    fixed course as a decision, or misses that a "group" needs a pick.
  - **F13:** the jump from study plan → planner loses context or dumps them in an
    unfamiliar page with no "here's what just happened" cue.

### JOB 5 — "Is this specific course worth/possible for me?" (single-course probe)
*The quick lookup that often seeds a plan. Lowest planning-intent but highest
raw traffic; the funnel's mouth.*

- **Trigger:** heard a course name, saw a code, curious or evaluating.
- **Entry point:** `/emner/` search or direct `/emne/[code]`.
- **Steps:** read facts (credits, level, language, semester, assessment) → skim
  learning outcomes/mandatory activities → check grade distribution → **decide:
  add to plan or not.**
- **Done:** either "Legg til i planen" (enters JOB 1) or dismisses.
- **Failure modes:**
  - **F14:** the course page is a *terminus*, not a *fork* — student reads, gets
    no nudge toward "test this against your semester," leaves without ever
    finding the planner. The catalog and the planner feel like separate
    products.
  - **F15:** "teaching semester" not made prominent → student plans a spring
    course into a fall plan.

---

## 3. Where the current page structure fights these jobs

The current IA is **catalog-shaped** (Emner / Studier / Emne) with a planner
bolted on as one more page. The jobs are **decision-shaped**. Four frictions:

1. **Decision and test are on different pages.** JOB 2's choice happens on
   `/studier/[code]`; the clash test happens on `/planlegger/`. The student
   ping-pongs, adding candidates one at a time to discover fit. The "does it
   clash with what I've already locked?" answer must appear *at the choice
   point*, inline — not require a round trip. This is the highest-leverage fix.

2. **Comparison is unsupported exactly where NTNU demands a choice.** Choice
   groups render as link lists. No side-by-side on the axes that decide
   electives (clash, exam date, grade spread, form). The `compare_courses`
   capability exists in the data layer but has no home in the UI at the moment
   of choosing.

3. **Course pages are dead ends.** `/emne/[code]` (JOB 5, the highest-traffic
   entry) informs but doesn't route into planning. The single most common
   arrival doesn't reliably reach the core loop. "Legg til i planen" exists but
   is a quiet button, not a fork in the road.

4. **The planner can't answer its own question during most of its own season.**
   Pre-publish (the bulk of the planning window) the grid is empty. The tool's
   headline promise silently degrades in the exact window students are planning.
   The unpublished state needs a *designed* fallback (exam spread, credit sum,
   "which weeks each course teaches," program context) — real value that doesn't
   depend on the grid — not an apology.

---

## 4. The ONE primary job the homepage must nail

**JOB 1 — "do these fit together?" — expressed as: get the returning student back
into their plan in one click, and get the first-timer to a *populated* plan fast.**

The homepage is not a landing page to admire; it is a **switchboard onto the
core loop**, and it must be *stateful*:

- **Returning user with a plan (the common case):** the hero *is* their plan
  status — "Planen din: 4 emner · 22,5 sp · Høst 2026 — 1 kollisjon" as a live
  mono line linking straight into `/planlegger/`. One click back to work. If
  there's a clash, say so on the homepage; that's the hook that reopens the tool.
- **First-timer / empty plan:** one primary action, and it must resolve the
  cold-start problem — an empty planner is useless. So the primary path is **"Start
  from your program"** (JOB 4, gives an instant skeleton) with search as the
  secondary path. A blank "add courses" field as the only entry strands the user
  who doesn't yet know what to add.
- **The homepage must reflect the calendar:** the semester it defaults into and
  the pitch it leads with should track the active spike (next-semester default,
  and near a registration deadline, a mono line naming it: "Frist for
  eksamensoppmelding: 15. september").

Everything else on the homepage is secondary. Not a search-first catalog
homepage; a **plan-first, calendar-aware switchboard**. The current spec's
stateful "Planen din: N emner" line is the right instinct — it should be the
*loudest* thing on the page when a plan exists, not a footnote under the hero.

---

## 5. Prioritized job map (the deliverable)

Priority = frequency × decision-pain × how well available data serves it.

| # | Job | Trigger window | Entry | "Done" | Priority | Biggest failure to kill |
|---|---|---|---|---|---|---|
| **1** | Do my courses fit? (core loop) | Aug, Nov/Dec, both deadlines | `/planlegger/` | No red ink, ~30 sp → Studentweb | **P0** | F1 unpublished-grid = empty tool |
| **2** | Which elective? (choice pain) | Nov/Dec, pre-deadline | `/studier/[code]` choice group | Picks with a reason | **P0** | F5/F6 no compare + no inline clash at choice point |
| **3** | Exam crunch check | Feb 1, Sep 15, exam period | Planner exam ribbon | Survivable spread → register | **P1** | F8 missing dates; F9 kont/occasion confusion |
| **4** | Program skeleton start | Term start, new kull | `/studier/[code]` kull | Plan pre-loaded, choices isolated | **P1** | F11/F12 wrong period, obligatory≠choice unclear |
| **5** | Single-course probe | Year-round, traffic-heavy | `/emner/`, `/emne/[code]` | Add to plan or dismiss | **P2** | F14 course page dead-ends, never reaches planner |

**Cross-cutting must-fixes, in order:**

1. **Semester default = next plannable term, not `current`.** One wrong default
   taxes every job at the door. Calendar-aware.
2. **A designed pre-publish planner mode.** The tool must be useful in the *bulk*
   of its own planning window without a timetable grid: lead with exam spread,
   credit sum, per-course teaching-weeks, program context; frame the grid as
   "coming when timetables publish," not as failure.
3. **Bring the clash test to the choice point.** Inline "clashes with your
   locked courses" on study-plan choice groups and on course pages — collapse
   JOB 2's page round-trip.
4. **Turn course pages into forks, not termini.** Every `/emne/[code]` visibly
   offers "test this in your plan."
5. **"Not taught this semester" and kont/occasion exams must be explicit**, never
   silent — a missing course reading as "fits" (F3) or a kont date read as the
   ordinary exam (F9) produces a *confidently wrong* choice, the worst outcome
   for a decision tool.

**The through-line:** every job ends the same way — *confident choice → leave for
Studentweb.* The site's success metric isn't time-on-site or pages-viewed; it's
**"did the student leave sure?"** Design for the fast, certain exit, not the long
visit.
