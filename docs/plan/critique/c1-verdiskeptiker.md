# C1 — Verdiskeptiker: adversarial critique of PRODUCT-draft.md

Lens: would a real NTNU student switch from TP + ntnu.no + ntnu.1024.no + a
spreadsheet to *this*? Where is the draft admiring itself instead of the
student? Which listed features will be built and never used? What one thing
creates a habit and gets talked about? I quote the draft, then propose the
fix. I assume the design system and the bug-fixes; I attack value.

---

## The core problem: the draft optimizes for a moment students visit ~4 times a year

The draft's own success metric is **"did the student leave sure?"** — "a fast,
certain exit to Studentweb, not time-on-site." Read honestly, that is a
description of a tool with **no habit loop**. p6's own calendar says the
planning-intent windows are five spikes a year, most of them clustered around
Feb 1 and Sep 15. A tool you open twice a year, use for six minutes, and
leave, does not generate word-of-mouth by being *correct* — it generates
word-of-mouth by producing **an artifact the student wants to send someone**.

The draft names that artifact once — "a single shareable stateful URL with no
login (architecturally trivial for us, absent everywhere else)" — and then
files it under connective plumbing (§4 "URL is the state") instead of treating
it as **the growth engine**. This is the central strategic miss. See Finding 1.

Everything below is downstream of one question the draft never asks: *why would
student B ever hear about this site?* The honest answers are (a) a friend sent
them a plan URL, or (b) they googled a course code and hit `/emne/[code]`. The
draft under-invests in both and over-invests in the elective-compare machinery
that only student A, already on the site, mid-decision, ever touches.

---

## FINDINGS (top-ranked, most load-bearing first)

### 1. The shareable plan URL is the whole growth story and the draft buries it as plumbing

**Quote:** "plus a single shareable stateful URL with no login (architecturally
trivial for us, absent everywhere else)." And §4: "**URL is the state**:
`#26h;committed;shortlist`."

**Why it's wrong:** This is filed as an architecture note. It is actually the
*only* mechanism by which this site acquires a user who didn't already google a
course code. p11 confirms every incumbent lacks it and that ntnu.1024.no's
18-year survival ran on a *worse* version (nicknames). A plan URL a
kull-kamerat pastes into a group chat is the product's distribution. But a raw
`#26h;TDT4100,TMA4100` hash is not shareable in the way that spreads — nobody
forwards a URL that renders as a blank planner until three API calls resolve.

**Fix:** Make the shared plan a **first-class received object with a preview
that survives being pasted anywhere**. Concretely: (a) the plan URL must
resolve to a page whose *first paint* — before any timetable fetch — already
shows the course codes, names, credit sum, and semester, from the search-index
static tier the draft already has (§ inherited from PLANNER.md §4). (b) Give
the shared-plan interstitial ("Bruk denne / Behold min egen") a real title line
— "Kari deler en plan: 5 emner · 28,5 sp · Høst 2026" — so the *link unfurl in
a chat* is the pitch. (c) The habit loop is not "did the student leave sure";
it is "the student who left sure sent the link, and the receiver became a
user." Elevate the shared-plan flow (§3 flow 6) from last to co-primary with
the elective loop, and instrument it as the north-star metric instead of the
un-measurable "left sure."

---

### 2. The elective compare table is the draft's centerpiece and will be under-used relative to its build cost

**Quote:** §2 "**Velgeren** — the product's center of gravity." §5 MUST:
"compare view." §3 flow 2 is the "core." §8 resolves *two separate conflicts*
(1 and 2) about where compare lives and how the shortlist tier works.

**Why I'm skeptical:** The compare-on-axes table (schedule-fit-vs-locked, exam
clustering, grade shape, assessment mix) is real work — a shortlist tier in
`PlanState v:2`, ghost blocks, a `?mot=` deep-link render, promote/swap logic
through the conflict engine. But look at what actually decides an elective for a
real student: **(1) does it clash, (2) is the exam a project or a written exam,
(3) is it brutal.** Two of those three are single facts, not a comparison
matrix. The elaborate side-by-side compare table assumes a student who
methodically weighs 5 candidates on 4 axes. Most students weigh 2 candidates on
1 axis ("do either of these clash?") and pick the one a friend recommended —
which is *exactly* the qualitative signal (emnr.no) the draft correctly refuses
to fabricate but therefore cannot supply.

**The risk:** a beautiful compare view that gets opened, admired by the builder,
and used by a thin slice of methodical 4th-years for the 3 weeks a year they
choose electives. That is not nothing — it is p6's stated P0 pain — but the
draft treats "candidate set + shortlist tier + compare + ghost blocks + swap"
as one indivisible flagship when the **90% version is far cheaper**: inline
"kolliderer med planen din" on every choice-group course, plus the two facts
(exam form, grade shape) shown *in the row*, no compare page, no shortlist tier.

**Fix:** Ship the cheap 90% first — inline clash + two facts on choice-group
rows (this is p6's must-fix #3 and it's most of the value). Demote the shortlist
tier and the ghost-block compare to **SHOULD/COULD**, gate them behind
evidence that anyone reaches the compare state. Do not let `PlanState v:2` and a
two-tier model block the shipping of v:1 inline-clash-at-choice-point. The
draft's §8 spends two whole conflict-resolutions perfecting a feature it hasn't
proven anyone will open.

---

### 3. "did the student leave sure?" is an unmeasurable, self-flattering metric

**Quote:** §1 "**Success metric (p6): 'did the student leave sure?'** — a fast,
certain exit to Studentweb, not time-on-site."

**Why it's wrong:** On a static site with no accounts and (correctly) no
Studentweb integration, you **cannot observe** whether a student left sure or
left confused. This metric is unfalsifiable — which makes it a comfort, not a
metric. It lets the panel declare victory without evidence. Worse, it actively
argues *against* the one measurable thing that matters (share/return), by
framing time-on-site and return visits as vanity.

**Fix:** Adopt metrics you can actually see on a static+edge stack: (1)
**shared-plan link creations and shared-plan link opens** (the worker sees URL
hits; this is the word-of-mouth coefficient); (2) **`/emne/[code]` → "Legg til"
→ `/planlegger/` funnel completion** (the SEO-mouth-to-planner conversion, the
only organic acquisition path); (3) **return rate across a Feb-1 / Sep-15
window**. "Did they leave sure" survives only as a *design principle*, never as
a success metric — you can't optimize what you can't count.

---

### 4. The first-year on-ramp is designed for the persona least able to trust it

**Quote:** §2 "**Førsteklassingen** — the onboarding shape." §3 flow 1:
"name-based program+kull picker → pre-fills `/planlegger/` with period-1
obligatory courses."

**Why I'm skeptical:** The brief states first-years get **pre-assigned plans**.
A first-year in week 1 does not have a *choice* to make — their courses are
handed to them. So the job isn't "assemble a candidate set," it's "decode 5
codes into where I walk in at 10:15" (the draft's own persona B text says
exactly this). But a name-based program+kull picker that pre-fills obligatory
courses is a **trust minefield for precisely this user**: if the kull-period
math (`(semYear − cohort) × 2 + …`) is off by one, or a program's
`publishedYears` has a gap (the draft's own open question), the first-year — who
has *no basis to catch the error* — gets a confidently wrong plan and concludes
the site is broken. This persona cannot self-correct; every other persona can.

**Fix:** For persona B, lead with **decode, not assemble**. The highest-value
first-year screen is "here is *this week's* schedule with rooms for the codes
you were assigned" — code→name→room→time — which requires no risky kull math,
just the timetable data. Keep the program+kull pre-fill, but (a) never present
it as authoritative — "Vi tror dette er ditt semester; sjekk mot Studentweb" —
and (b) make the *room-finding week view* (persona C's day-agenda) the thing a
first-year lands on, because that is the job they actually have in week 1 and
the one that makes them show it to a classmate ("hvilket rom?").

---

### 5. The draft congratulates itself on "owning the row" without pricing what the row costs to keep correct

**Quote:** §1 "Every incumbent owns one column … none owns the row. Our position
is the join." §11 "Én samlet plan … **Ingen**."

**Why it's self-congratulatory:** "Owning the row" is true and good — but the
row is only valuable if *every cell in it is trustworthy*, and the draft's data
is a **nightly crawl of scraped pages** with several cells that are structurally
unreliable: exam dates that are TBD in the plannable term (p6 F8), timetables
that don't publish until days before the semester (F1 — the tool's headline
answer is absent for most of the planning window), "not taught this semester"
courses that silently vanish (F3). The incumbents each own one column *and keep
it correct because it's their whole product*. The join is only differentiated
if the join is *right*; a joined view where one cell is stale or missing is
**worse** than four correct single-column tools, because the student trusts the
composite and gets a confidently-wrong answer — the worst outcome for a decision
tool (p6's own words).

**Fix:** The draft must treat **data-freshness honesty as a MUST-have surface,
not an edge state**. It half-does this (`notices[]`, "dato ikke satt",
pre-publish mode) but frames them as graceful degradation. Reframe: the site's
credibility bet is *"we tell you what we don't know."* Every composite view
needs a visible provenance/staleness line ("Timeplan publisert 12. aug · Eksamensdato
ikke satt for TDT4100"). The competitive moat isn't the join; it's **the join
you can trust because it admits its gaps** — which is also the honest answer to
"why not just use ntnu.no," whose data is always authoritative and current.

---

### 6. Features likely to be built and go unused — cut or demote

The draft's MoSCoW is long. Named specifically, these will cost build time and
see near-zero use; a value-skeptic cuts them now:

- **Week scrubber flagging atypical weeks** (§5 SHOULD, §3 flow 5). A student
  planning *next* semester does not scrub week-by-week; they ask "does it clash,
  when are exams." Atypical-week detection is a *during-semester* concern for a
  tool used *before* the semester. **Demote to COULD or cut.**
- **Personal fixed blocks (localStorage-only)** (§5 COULD, §3 flow 5, open
  question "worth the `store.ts` complexity"). The draft itself doubts it. A
  student who wants to block "jobb tirsdag" is doing weekly life-logistics, not
  semester assembly — that's a calendar app's job. **Cut.** It also breaks the
  clean shareable-URL story (personal blocks aren't shared, so a shared plan
  renders differently for sender and receiver — a subtle trust bug).
- **`assessment-mix workload counts`** (§5 SHOULD). This edges toward the
  fabricated-workload-score the draft correctly forbids in §7. Counting
  assessment components is a proxy that *reads* as a difficulty signal students
  will over-trust. **Cut** — it's on the wrong side of the draft's own honesty
  line.
- **English course names / bilingual anything** (§5 COULD / KILLED — good that
  chrome is killed) — but the exchange-student persona D is kept alive as a
  "cousin." p3's exchange student is a genuinely different build-from-zero user
  whose real blocker is *English-taught + assessment form + campus* filters,
  which are already MUST filters. **Fold persona D entirely into the filters
  already committed; drop it as a persona** so it stops pulling English-name and
  translation work back in through the open questions.

**The pattern:** the draft added a feature for every persona and every
perspective's pet concern. A value-skeptic's cut: keep the two things every
persona shares (clash-check at the choice point; a trustworthy shareable plan),
and ruthlessly demote everything that serves one persona in one narrow window.

---

### 7. The "thinking tool upstream of Studentweb" positioning quietly caps the product's ceiling

**Quote:** §1 "the *thinking tool upstream of Studentweb*." §7 "always 'bekreft
i Studentweb'."

**Why it's a risk (not wrong, but under-examined):** This positioning is
correct and honest — you can't integrate Studentweb, so don't pretend to. But
it means the product's *terminal action* is always "now go do the real thing
somewhere else." That's a fine scope boundary and a bad growth position: the
student's *last* interaction with you is being handed off. The draft never
asks what brings them *back*. The answer can't be "they'll plan again in 5
months" — that's the twice-a-year trap (Finding 1).

**Fix:** Since you can't own the commit, own the **artifact and the re-check**.
Two concrete hooks the draft misses: (a) a plan URL is not just shared *once* —
it's the thing a study group iterates on across the weeks before the deadline;
design the URL to be *re-openable and re-editable as the canonical group
plan*, so the site is where the group's semester conversation lives, not a
one-shot checker. (b) When timetables/exam dates *publish* (the `timetablePublished`
flip, the exam-window open), a previously-saved plan becomes newly answerable —
that publish event is a natural return trigger, but with no accounts you can't
notify. So surface it *in the shared artifact*: a plan opened before publish
should visibly say "timeplan ikke publisert — kom tilbake etter ~12. aug," and
after, render the answer it couldn't before. The re-open *is* the return.

---

## What the draft gets right (so the panel doesn't over-correct)

- The core job reframing from **verify → "hva bytter jeg?"** (decide, not check)
  is correct and sharper than PLANNER.md. Keep it.
- **Killing `/studier/` as a standalone search index** and the two-pill nav is
  right — a second search page is exactly the ntnu.no-mirror trap.
- **Grade-data discipline** (§8.5: season-split, cohort-n, no sortable column,
  no hue-tint, two facts not one score) is the draft's best moment — it resists
  fabricating a signal it can't earn. Hold this line hard.
- **Refusing fabricated workload/difficulty scores and the grade leaderboard**
  (§7) is correct — the honesty is the moat (Finding 5).
- **øving-group clustering as P0** (§6) is a genuinely load-bearing correctness
  fix the incumbents don't do; it's the difference between a clash engine that
  helps and one that lies on every lab course. Keep it MUST.

---

## The one-line verdict

The draft has correctly identified the *join* nobody else owns and the *elective
pain* nobody else serves — then over-built the elective machinery for a
twice-a-year user and under-built the shareable artifact that is its only path
to a second user. **Ship the cheap clash-at-the-choice-point, make the shared
plan URL an unfurlable, trust-worthy, re-openable object, and measure shares —
not the unmeasurable "left sure."** That is the difference between a correct
tool students visit twice a year and a habit a kull passes around.
