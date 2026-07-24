# PRODUCT-v2.md — Semesterplan: what this site should be

Definitive product definition. Supersedes `PRODUCT-draft.md`. Reworked against four critiques — c1 (value), c2 (feasibility vs. our exact `ntnu-api` data), c3 (flow), c4 (differentiation). Design system "Ruteark" (DESIGN.md) is assumed law and not restated. Where this file and PLANNER.md disagree on scope, this file wins for the pages it touches; PLANNER.md remains binding for the Ruteark render detail it specifies.

The single change with the widest blast radius: **the draft priced its own composite as automatically better than four correct single-column tools. It is not.** A join built from a nightly scrape with stale/TBD/missing/cardinality-less cells is *worse* than four correct tools unless it admits its gaps. So v2 reframes the moat from "we own the row" to **"we own the row, and the row admits where it's thin"** — provenance and staleness are a MUST surface, not an edge state (c1-5, c2 cross-cutting). Everything else follows from three moves the four critiques agree on: **make the shareable plan the growth object, not plumbing** (c1, c4); **cut the elective apparatus down to what a twice-a-year user actually touches** (c1, c2); and **make the IA obey the positioning** (c4) — decide-loop loud, search quiet.

---

## 1. Positioning & the one primary job

**Positioning.** Semesterplan is the *thinking tool upstream of Studentweb* — the place a NTNU student assembles a candidate set of courses and finds out, before the registration deadline, whether that semester holds together: lectures don't collide, exams aren't stacked, credits reach a full load, electives are chosen deliberately. Unofficial, free, account-less. It composes data no official tool composes together — catalog + timetable + exam + study-plan + grade history as **one shareable object**.

**The moat, priced honestly.** Every incumbent owns one column — description (ntnu.no), timetable-merge (TP), reviews, grade stats (DBH), staff scheduling. None owns the *row*: the join across columns for a set of courses in a chosen semester. That join is genuinely ours and architecturally trivial for us (a static site + edge worker composing our own `ntnu-api` data), and it comes with one thing absent everywhere else: **a single shareable stateful URL with no login.** But the join is only worth more than four correct tools *if it tells the truth about its own thinness.* Three of the five columns are soft (c2 cross-cutting): the timetable is absent for most of the planning window and group-blind; the study plan carries no "choose N" cardinality; grade codes live in a different string space than course codes. So the honest one-liner is:

> **We assemble your semester and sanity-check it — and we show you exactly what we couldn't verify.**

That "what we couldn't verify" line is not a hedge; it is the differentiator and the answer to "why not just use ntnu.no." Data-freshness/provenance is therefore a **first-class MUST surface** (§6, DR-8), not a fallback state.

**The one primary job:**
> **"Kan jeg ta disse emnene sammen — og hvis ikke, hva bytter jeg?"**

This sharpens PLANNER.md's read/verify framing into a **decide** framing (kept from draft §1; endorsed by all four critiques). "Hva bytter jeg?" commits the product to helping the student *choose*, not just check. But v2 draws the line the draft blurred: helping someone decide is **surfacing the one or two facts a decision actually turns on, inline, at the moment of choice** — *not* a four-axis comparison matrix (c1-2). The decide-loop is a sentence and a red mark, not a spreadsheet.

**Success metrics — measurable, not self-flattering.** The draft's "did the student leave sure?" is unobservable on an account-less static site (c1-3); it is retained as a *design principle* only. What we actually instrument (all client-side, privacy-respecting counters via the edge worker; no accounts):

| Metric | Why it is the right one |
| --- | --- |
| **Shared-link creations & opens** (north star) | The only growth path for a user who didn't already google a course code (c1-1). A created share = a plan someone found worth sending. |
| **`/emne/[code]` → "Legg til" → planner funnel** | Converts search-engine arrivals (our largest cold traffic) into plan-holders. The fork rate is the health of the decide-loop's mouth. |
| **Return rate across a Feb-1 / Sep-15 window** | Planning is bursty and deadline-shaped. Do people come back as the deadline nears and after timetables publish? |
| **Clash-preview-before-add engagements** | Proxy for the decide behavior we can't directly see "sureness" of. |

"Left sure" stays as the felt quality we design toward; the four numbers above are what we watch.

---

## 2. Personas & top jobs

Ordered by weight. **A** and **B** are co-primary but serve *different* moments; **C** is a lens on A/B, not a separate build; **D** is folded into filters and no longer a persona (c1-6).

- **A. Velgeren (elective chooser)** — the decide-loop's reason to exist (draft's center of gravity). 3rd–5th-year, 1–2 elective slots drawn from overlapping choice groups; today uses ntnu.no + TP + a spreadsheet. The pain is *set-narrowing under a small number of hard facts*. Jobs: pull a choice group's courses in as candidates; for each, see the one or two facts a real decision turns on — **does it clash with what I've already committed, is it project- or exam-assessed, and is the grade distribution brutal** — inline, in the choice-group row; drop the losers; commit the survivors; hand off to Studentweb. **What v2 cuts:** the 4-axis compare matrix, the `?mot=` deep-linked compare page, and the two §8 "conflict-resolution" substitution engines. Electives are decided on 1–2 facts, not a matrix, and this user shows up twice a year (c1-2, c4-double-down #2). What survives is the *shortlist tier* (localStorage-cheap, feasible) and a **plain-language swap delta sentence** — that sentence *is* the product (c4).

- **B. Førsteklassingen (week-1 receiver)** — co-primary, the onboarding shape, but reframed. **Lead with decode, never with a risky pre-fill** (c1-4). This user has five codes and one question: "where do I walk in at 10:15." Jobs: paste/enter 5 codes → this week's schedule with rooms → code↔name translation → "bekreft i Studentweb." The kull-based pre-fill (period math off-by-one is the draft's own open question) is offered *only* as a labeled, editable suggestion — "foreslåtte emner, juster selv" — never as an authoritative plan, because this is the one user with no basis to catch a confidently-wrong composite (c1-4, c2-F5).

- **C. Logistikeren (constrained week)** — a *lens* on A and B, not its own build. Needs the week *livable*, not just non-colliding: which days are free, gap quality, where the semester's real edges are. Forces mobile-first day-agenda. This lens justifies the day-load strip and free-day sentence (SHOULD) — it does **not** justify the week-scrubber, which is a *during-semester* concern in a *before-semester* tool and is cut (c1-6, c3-9).

- **D. — folded, not a persona.** The grade-aware strategist and the exchange student both reduce to *filters and honest signals we already commit to*: season-split grade trend, kont dates + deadline surfacing, language/campus/assessment filters. Keeping "D" as a persona dragged bilingual/translation work back in for a sliver of users (c1-6). Their needs are met; their headcount doesn't earn a build.

**Not a persona (unchanged):** the multi-year degree planner — a different instrument that would drown the one-semester job.

---

## 3. Core flows (screen-level)

Two flows are co-primary: **the elective decide-loop (2)** and **the shared-plan handoff (6)**. The draft buried (6) as plumbing; it is the growth loop and is promoted (c1-1, c4-double-down #3).

1. **First-year on-ramp (decode-first).** `/` → **code-first path is the headline** ("Har du fått emnekodene? Lim dem inn") → `/planlegger/` renders this week's schedule + rooms + code→name. The program+kull picker is the *secondary* path and pre-fills only labeled, editable **suggestions** ("foreslåtte emner, juster selv"), never an authoritative plan (c1-4). Calm pre-publish mode if timetables aren't out (see flow-agnostic rule below).

2. **Elective decide-loop (CO-PRIMARY).** Choice group on `/studier/[code]/` → "legg alle til vurdering" (shortlist tier, localStorage + hash) → **inline in each choice-group row: "kolliderer med planen din" + two facts** (assessment form, grade shape) computed against committed courses → ghost blocks on the planner grid → drop losers → **promote survivor, and on promotion render a plain-language delta**: *"TDT4200 → TDT4258: fjerner 1 kollisjon, sprer eksamen fra 2 til 5 dagers mellomrom."* → credit running total climbs → **commit summary** (copyable code list + "bekreft i Studentweb") → Studentweb. No compare page, no matrix (c1-2, c4).

3. **Free-search add & clash-check.** `/emner/` (a *mode*, not a top-level destination — see §4) with filters → **plan-aware row preview before add** ("ville kollidert med TMA4100") → quick-add → plan strip updates sitewide.

4. **Single-course research → fork (largest cold traffic).** `/emne/[code]/` is a **fork point, not an encyclopedia** (c4). Primary CTA: **"Vil dette kollidere for deg? Legg til og se."** Prose demoted below the fold. Shows the timetable as a grid (not a flat list) and a season-split grade shape *in the decision context*, plus a plan-context line ("passer i planen din for Høst 2026 — ingen kollisjon"). One-time planner intro for empty-plan visitors. We stop competing with ntnu.no on encyclopedic depth we'd lose on (c4).

5. **Livability check.** Day-load strip + free-day sentence; semester-edge sentence; **whole-semester conflict notes always shown** regardless of which week is in view (c3-9). *(Week-scrubber cut — §12.)*

6. **Shared-plan handoff (CO-PRIMARY, growth loop).** A received plan URL is a **first-class object** (c1-1):
   - **Static-tier first paint:** codes + names + credits render from the hash + search index *before any API fetch* — the recipient sees a real plan instantly, offline-of-the-worker.
   - **Real unfurl:** the interstitial and any link preview read *"Kari deler en plan: 5 emner · 28,5 sp · Høst 2026"* (title/count/credits derived from the hash, no fetch).
   - **Three actions, not two** (c3-5): **"Bruk denne"** (replace) · **"Slå sammen"** (union of `courses[]`, deduped, with a preview of incoming codes) · **"Behold min egen"** (dismiss). Binary destroy-or-ignore is gone.
   - The URL is a group's **re-editable canonical plan** — the same link, re-opened after edits, is the current plan (c1-7).

**Flow-agnostic rules baked into every flow:**
- **Temporal margin banner** on `/planlegger/`, driven by `termContext()` (c3-1): *"Oppmelding for Høst 2026 stenger ~15. sep · 24 dager igjen."* The whole positioning is "before the deadline"; the deadline must be on screen.
- **Return trigger in the shared artifact** (c1-7): when `timetablePublished` or the exam window is about to flip, the artifact says *"Timeplan publiseres ~12. aug — kom tilbake da for å sjekke kollisjoner."* This is the only thing that pulls a handed-off user *back*.
- **Provenance line** on every composed verdict (DR-8): *"Timeplan sist hentet 22. jul · eksamensdato ikke publisert."* The join admits its gaps.

---

## 4. IA / sitemap

**Four pages. One nav pill. Search is a mode, not a destination.** The draft's "two pills — Planlegger | Emner" still made search a co-equal top-level surface, which contradicts the positioning: the loudest surface would be the least differentiated (c4-2, c4-cut #1).

- `/` — **dispatcher + proof.** Verb-first, shows the red-ink collision above the fold (§5).
- `/planlegger/` — **the app.** The plan, the grid, the decide-loop, the temporal banner. Search lives *inside it* as an add field/mode.
- `/emner/` — **find courses** (still a real page for deep search and for search-engine landing), merged program search as `?type=studier`. Reachable from the planner's add field and from footer/inline links — **not a primary nav pill.**
- `/emne/[code]/` — **the fork point** (§3.4). Plan-aware. `?mot=` retained only as a lightweight two-course "legg begge til"-capable view for deep-linking (c3-7), *not* a compare matrix.
- `/studier/[code]/` — **study plan as template**, host of the elective decide-loop.

**Nav: one pill — Planlegger.** `/studier/` standalone index is killed (redundant second search page — survived scrutiny, all critiques agree). `/emner/` is demoted from the nav to an inline/footer surface. The plan is never a nav item.

**The plan strip** (sitewide, non-empty only, built once in `Layout.astro`) is the connective tissue — it turns "add from anywhere" into "aware from anywhere," and it carries the **cross-page continuation affordance** the draft's core loop was missing (c3-3): *"5 emner til vurdering · Se på ukeplanen →."*

**URL is the state, and it is the growth object** (c1-1, c2-F7). Frozen, versioned hash grammar (§7): `#v2;<semesterId>;<committed-codes+versions>;<shortlist-codes+versions>`. Query params for page-local view: `?q=&sted=&språk=&type=`, `?mot=`, `?kull=`.

---

## 5. Homepage (was under-specified; now a MUST, and the growth proof)

The current hero ("Planlegg semesteret … se … samlet") is passive, calendar-generic, read-only, and hides our one instantly-legible differentiator on another page (c4-3). Fix, concretely:

- **Verb-first H1:** *"Kan du ta disse emnene sammen?"* Sub-copy commits to the decide framing: *"Sjekk kollisjoner og eksamensklynger — og se hva du bytter — før oppmeldingen."*
- **Above-the-fold proof:** a small `.np-frame.np-ruled` fragment showing a **red-ink collision** — the product's one instantly-legible signal — not a triptych of tiles.
- **One CTA** ("Lag en plan" → `/planlegger/`), plus, when the stored plan is non-empty, the mono resume line ("Planen din: 4 emner · 22,5 sp"). The three-tile triptych is cut for the same redundancy reason `/studier/` index was (c4).
- **Name the share as a visible action** in the proof ("del planen med en lenke — ingen innlogging") — the growth loop the draft knew about in §1 but forgot in the IA (c4-double-down #3).

---

## 6. Features (MoSCoW) — reweighted so verbs beat nouns

The draft's MoSCoW was ~60% incumbent-owned nouns (catalog, grid, description, grade stats), reading as "course browser + bolted-on planner" (c4-1). v2 keeps the nouns we genuinely need but **elevates the verbs that are ours** (decide / preview / swap-delta / share / admit-gaps) and demotes the elective *apparatus* that a twice-a-year user won't reach until evidence says otherwise (c1-2).

**MUST (the buildable spine + the differentiators):**
- Merged weekly grid (`.np-frame.np-ruled`, red-ink collisions per PLANNER.md).
- **Conflict engine — lecture-only hard conflicts** (see DR-1; the draft's "øving-group clustering with alternative-avoidance" is **cut as unbuildable** — §12/DR-1). Øving/lab shown as a muted, non-clashing display label.
- **Exam ribbon sourced from catalog `ExamDate`** (structured `date`+`continuation`), not scraped exam text (DR-3). Ordinary-only by default; kont filtered out.
- **Live, null-aware credit total**: *"22,5 av 30 sp (+2 emner uten oppgitt sp)"* (DR-6).
- **Plan-aware clash preview *before* add** — the verb, everywhere (`/emner/` rows, `/emne/[code]`).
- **Decide-loop inline facts**: in each choice-group row, "kolliderer med planen din" + assessment form + grade shape (no compare matrix).
- **Plain-language swap delta sentence** on promotion (c4-double-down #2). *This is the product.*
- **Shortlist tier** (committed vs. considering) as pure localStorage + hash — **candidates in the hash from day one** (c3-2, c4-double-down #1; open question closed). No `v:2`-only compare dependency.
- **Shared-plan as a first-class object**: static-tier first paint, real unfurl title, **merge/replace/keep** three-way interstitial (c1-1, c3-5).
- **Code↔name pairing** and **code-first paste entry** (persona B's real artifact) (c3-6).
- **Season-split grade trend**, rendered *in decision context* (see the differentiation note below).
- **Provenance / staleness line** on every composed verdict (DR-8) — the honest-join MUST (c1-5).
- **Temporal margin banner** driven by `termContext()` (c3-1) and **"next plannable term" as an explicit rule** across the Sep-15/Feb-1 seam (c3-1, DR-9).
- **Designed pre-publish mode as a *primary* mode** (DR-2, c2-F8): exam ribbon + credits + grades + assessment carry real value with no grid; clash engine degrades to exam-clash + campus-spread.
- **Commit summary**: copyable committed-code list + "bekreft i Studentweb" (c3-4).
- Language / campus (city-level) / assessment filters (absorbs old persona D).
- Plan strip (sitewide, with cross-page continuation affordance) (c3-3).
- Mobile day-agenda + 44px touch targets.
- `notices[]` at add-time, incl. **off-semester add handling**: message defined, and **off-semester credits excluded from the 30-sp total** so the "full load" signal isn't corrupted (c3-8).
- **Version threading** made first-class in `PlanState` + every API call + hash (DR-4, c2-F4) — a correctness MUST, not a nicety.
- Dateless-exam state ("dato ikke satt", DR-3).
- **Frozen versioned hash grammar with v1-compat parse** (c2-F7).

**SHOULD:**
- Day-load strip + free-day sentence (persona C lens).
- Plan-context line on `/emne/[code]`.
- Bulk-add above prose on `/studier/[code]`.
- SR conflict summary; recursive retning render; `retning.deadlineDate`; `publishedYears`/`periodNumber` gating (DR-5).
- Grade **shape** in the elective decision cell (see note below).

**COULD (behind evidence anyone reaches it — c1-2):**
- Deep-linked `?mot=` two-course view (as an *add surface*, c3-7).
- par/odde single-cell rendering.
- English course names (data permitting; not UI chrome).

**KILLED / DEMOTED — see §12 for the reasoning.**

**Differentiation note on grade stats (c4-cut #3):** grade stats are **not** a browsable course-page decoration (that's DBH-mirror parasitism and it violates the p4 discipline). Grades appear **in the decision cell** — the elective row, the fork-point context, the compare-if-built view — where a distribution shape actually informs a choice. This satisfies both the grade-data discipline and differentiation in one move.

---

## 7. State model & hash grammar (frozen now — c2-F4, c2-F7)

The hash is the moat *and* the growth object; it must be frozen before shortlist/version land or shared links silently drop state (c2-F7).

```ts
interface PlanState {
  v: 2;
  semesterId: string;                 // "26h" | "27v" — Semester.id
  courses: {
    code: string;                     // bare code, e.g. "TDT4100"
    name: string;
    version: string;                  // FIRST-CLASS — "1" default; threads to API + grid + exam + grade join
    tier: "committed" | "shortlist";  // considering vs. taking, in the hash from day one
  }[];
  program?: { code: string; name: string; cohort: number };
}
```

- **Hash grammar (versioned, v1-compat):** `#v2;26h;TDT4100.1,TMA4100.1;IT2805.1` — segment 1 version token, 2 semester, 3 committed (`code.version`), 4 shortlist. A parser reads legacy `#26h;TDT4100,TMA4100` (no `v` token, bare codes, all committed, version "1") and upgrades in memory. **No un-versioned segment may ever be appended again.**
- **Static-tier first paint** (c1-1): codes/names/credits resolve from the hash + `search-index.json` with zero API calls — the received-plan first render and the unfurl title both come from here.
- **Grade join** (DR-4): `GradeRow.courseCode` is suffixed (`"TDT4100-1"`), a different string space than bare codes. Join is defined as **bare-prefix match aggregating across versions**, never string-equality on the bare code.

---

## 8. Domain rules (binding — reconciled with our actual data shapes)

Each rule below names the data reality that forces it; these supersede the draft's §6 where they conflict, because the draft assumed fields we don't have (c2).

- **DR-1 — Conflict engine is lecture-only.** `TimetableEntry` (models.ts:322) has **no `activityCode`** and no group-membership field; keying on `courseCode+day+start+end` *merges* parallel øving groups instead of distinguishing them, and there is no way to enumerate "alternative slots that avoid the clash." Therefore: **MUST = lecture-only hard conflicts**, lectures classified by keyword on `name`/`title`; øving/lab rendered as a muted, non-clashing display label. **The draft's "only hard-flag when no alternative avoids the clash" is deleted** — it is unbuildable and would produce confidently-wrong answers on every lab-heavy course (c2-F1). Fix first, alongside DR-4.
- **DR-2 — Pre-publish is the chooser's primary mode.** `timetablePublished` is false through most of the elective-planning window and `timetable()` returns `[]` then, so a grid-only flagship is **blank exactly when Velgeren plans** (c2-F8). The clash engine degrades to exam-clash + campus-spread; exam ribbon + credits + grades + assessment carry the mode; optionally show last published year's grid **labeled non-authoritative.** "Next plannable term" must not force a blank primary surface.
- **DR-3 — Exam ribbon from catalog, not scrape.** Scraped `CourseExam.date` is null for hjemmeeksamen (`dateText` carries `"Utlevering 07.11.2025"`); occasion is free text (c2-F3). Drive the ribbon from catalog `ExamDate` (structured `date` + `continuation` for kont filtering, already in the search index); scraped exam only enriches popovers; `dateText`-only → "dato ikke satt" bucket. **Never re-parse scraped free-text into a date.**
- **DR-4 — Version threading is first-class + correctness-critical.** `courses.timetable/schedules` default `version:"1"` (courses.ts:167); a re-versioned course otherwise shows the **wrong grid/exam data** (c2-F4). `version` is in `PlanState`, every API call, and the hash (§7). Grade join is bare-prefix aggregation (§7).
- **DR-5 — Study plan has no cardinality; never assert "group satisfied."** `PlanCourseGroup` (programs.ts:91) is `{code,name,description,courses[]}` — **no min/max/choose-N**; the "velg 2 av 5" lives only in free-text `description` (c2-F2). Therefore the decide-loop shows a **credit running total + a verbatim quote of the group prose**; the app **never** asserts a group is satisfied or auto-picks "best 2 of 5." Recursive retning render + `retning.deadlineDate` + `publishedYears`/`periodNumber` gating are SHOULD.
- **DR-6 — Credit total is null-holed.** `PlannedCourse.credits` is nullable; the authoritative number is on course details (c2-F6). Total is async-aware: *"22,5 av 30 sp (+2 emner uten oppgitt sp)."* Off-semester courses excluded from the sum (c3-8).
- **DR-7 — First-year period math is fragile; the pre-fill is a suggestion.** `periodNumber` nullable, `startTerm` nullable (spring intakes break `autumn?1:2`), unpublished cohorts return null, `studyChoice.code` "O" unreliable (c2-F5). Fall back to nearest `publishedYears`, honor `startTerm`, default period 1 + user-editable chip when null, and **label the pre-fill "foreslåtte emner, juster selv."** Never present it as authoritative (also c1-4).
- **DR-8 — Provenance is a surface, not an edge state.** Every composed verdict carries a data-freshness line: last-crawl date, "eksamensdato ikke publisert," "timeplan ikke publisert ennå." The honest join is the moat (c1-5).
- **DR-9 — "Next plannable term" is an explicit rule.** Defined across the Sep-15/Feb-1 seam via `semesters.json` `phase`/`fromDate`/`toDate`/`examLastDate`/`timetablePublished` (c3-1) — not an invisible default. Drives both the semester default and the temporal banner.
- **DR-10 — Off-semester add is defined.** `planElement` filtering on bulk-add (0-sp *real* courses stay); an off-semester add yields a `notices[]` line and is **excluded from the credit total** (c3-8).

**Never** re-parse scraped free-text into structured facts; branch only on structured `form`/`weighting`/`continuation` (kept from draft).

---

## 9. Non-goals

No accounts / server storage; no Studentweb integration (always "bekreft i Studentweb"); **no fabricated signals** — no workload/difficulty scores, no thesis-relevance, no auto "best 2 of 5" (DR-5 forbids it structurally too), no seat/capacity/popularity data (we don't have it); no cross-course grade leaderboard; **no compare *matrix*** (facts inline, not a spreadsheet); no multi-year planning in the planner; no ICS/push/map/solver; no bilingual UI chrome; no wizard/glossary/FAQ; no building-level campus filter (data is city-level only); no drag as primary gesture; no hue-tinted grade bars; **no week-scrubber**; **no assessment-mix "workload count"** (it sits on the wrong side of the no-fabricated-scores line); **no personal fixed blocks** (localStorage-only breaks shared-URL parity and the draft doubted it itself).

---

## 10. Decisions & rejected alternatives (what was cut, and why)

The critiques' whole value is here: what did **not** survive scrutiny, made explicit so no one re-litigates it or silently re-adds it.

| # | Decision | Rejected alternative | Why (critique) |
| --- | --- | --- | --- |
| D1 | **Shared plan is a co-primary, first-class object** (static first paint, real unfurl, merge/replace/keep). | Draft's "URL is the state" filed under plumbing; binary replace/keep interstitial. | It's the *only* growth path for a non-search arrival, and the north-star metric; binary destroy-or-ignore nukes an hour of work (c1-1, c3-5). |
| D2 | **Cut the compare matrix, the `?mot=` compare page (as a matrix), and both §8 substitution engines.** Keep shortlist tier + one plain-language swap delta sentence. | Draft's 4-axis compare table + ghost blocks + `?mot=` + swap logic + two conflict-resolutions. | Electives are decided on 1–2 facts by a twice-a-year user; the apparatus was over-built. The *sentence* carries the decide value, not the matrix (c1-2, c4-double-down #2). |
| D3 | **"Left sure" is a design principle only; instrument shares/funnel/return-rate.** | Draft's "did the student leave sure?" as the success metric. | Unobservable on an account-less static site; self-flattering (c1-3). |
| D4 | **Lead persona B with decode; pre-fill is a labeled editable suggestion.** | Draft's name-based kull pre-fill presented as an authoritative plan. | Off-by-one period math (draft's own open question) hands a confidently-wrong plan to the one user least able to catch it (c1-4, c2-F5). |
| D5 | **Moat reframed to "the join that admits its gaps"; provenance is a MUST surface.** | Draft's "we own the row" as self-sufficient. | A wrong composite from a stale scrape is *worse* than four correct single-column tools; honesty is the actual differentiator and the answer to "why not ntnu.no" (c1-5, c2 cross-cutting). |
| D6 | **Conflict engine is lecture-only.** | Draft's "øving-group clustering, hard-flag only when no alternative avoids the clash" as P0 MUST. | Unbuildable on our data: `TimetableEntry` has no `activityCode`/group field; the key merges parallel groups; alternatives can't be enumerated. Ships confidently-wrong answers (c2-F1). |
| D7 | **Exam ribbon from catalog `ExamDate`, not scraped exam text.** | Draft implicitly drove the ribbon from scraped `CourseExam`. | Scraped date is null for hjemmeeksamen; `dateText` is prose; occasion is free text (c2-F3). |
| D8 | **Version is first-class in state + every API call + hash; grade join is bare-prefix aggregation.** | Draft's `PlanState` of `{code,name}` and bare-code hash. | Re-versioned courses show wrong grid/exam; `GradeRow.courseCode` is a suffixed string space — string-equality join silently misses (c2-F4). |
| D9 | **Study plan never asserts "group satisfied"; show credit total + verbatim prose.** | Draft's "commit at 30 sp / survivors satisfy the group." | `PlanCourseGroup` has no choose-N field; the count is free-text only (c2-F2, DR-5). |
| D10 | **Pre-publish is a *primary* value-carrying mode.** | Draft treated pre-publish as a fallback/edge state. | `timetablePublished` is false through most of the elective window; a grid-only flagship is blank exactly when Velgeren plans (c2-F8). |
| D11 | **One nav pill (Planlegger); `/emner/` demoted from nav; `/emne/[code]` is a fork point, not an encyclopedia.** | Draft's two pills (Planlegger \| Emner); course page as "research / largest traffic." | The loudest surfaces were the least differentiated; the IA must obey the positioning (c4-cut #1, c4-cut #2). |
| D12 | **Grade stats only in the decision cell.** | Draft's browsable grade shape on the course page. | Browsable grade trivia is DBH-mirror parasitism and violates the p4 discipline; in-decision it informs and differentiates (c4-cut #3). |
| D13 | **Temporal margin banner + return trigger are MUST; "next plannable term" is an explicit rule.** | Draft had the deadline in zero of six flows; "next term" was an invisible default. | The entire positioning is "before the deadline" — it was off-screen (c3-1, c1-7). |
| D14 | **Cut week-scrubber, personal fixed blocks, assessment-mix workload counts; fold persona D into filters.** | Draft SHOULD/COULD-listed all of them. | During-semester concern in a before-semester tool; breaks shared-URL parity; wrong side of no-fabricated-scores; dragged translation work back for a sliver (c1-6, c3-9). |
| D15 | **Frozen versioned hash grammar (`#v2;…`) with v1-compat parse, before shortlist/version land.** | Draft accreted hash segments across six flows with no version token. | Un-versioned accretion means shared links silently drop state as the grammar grows (c2-F7). |

**Kept from the draft because it survived all four critiques:** the read/verify → "hva bytter jeg?" decide reframing; killing the `/studier/` standalone index; the grade-data discipline (season-split, cohort-`n`, trend, no sortable column, never hue-tinted); refusing fabricated scores; compare-as-a-component-not-a-page *when built at all*; the plan strip as sitewide connective tissue; URL-as-state.

---

## 11. Build order (what to do first, and why)

Ordered by "produces confidently-wrong answers if wrong" > "load-bearing for the growth loop" > everything else (c2: "fix F1 and F4 first").

1. **DR-4 version threading + DR-1 lecture-only engine + DR-3 catalog-sourced exam ribbon.** These three are the correctness floor — get them wrong and the composite lies. Freeze the §7 hash grammar (DR-15) in the same pass.
2. **DR-8 provenance surface + DR-2 pre-publish primary mode + DR-6 null-aware credits.** Without these the tool is confidently blank or confidently wrong during the actual planning window.
3. **Shared-plan first-class object (D1)** + plan strip continuation + homepage proof (§5) — the growth loop.
4. **Decide-loop inline facts + swap delta sentence + shortlist tier in hash (D2).**
5. Temporal banner + commit summary + `/emne/[code]` fork reframe.
6. SHOULD tier; COULD only behind funnel evidence anyone reaches it.

---

## 12. Killed & demoted (explicit list)

- **KILLED:** øving-group clustering with alternative-avoidance (DR-1, unbuildable); compare *matrix* + both substitution engines (D2); week-scrubber (D14); personal fixed blocks (D14); assessment-mix workload counts (D14); persona D as a distinct build (D14); `/studier/` standalone index; the "Emner" nav pill (D11); homepage triptych (§5); "did the student leave sure?" as a *metric* (D3); auto "best 2 of 5" / any "group satisfied" assertion (DR-5); program marketing prose as primary content; bilingual UI chrome; glossary/FAQ; cross-course grade leaderboard; building-level campus filter.
- **DEMOTED to COULD (evidence-gated):** `?mot=` two-course view (add-surface only, not a matrix); English course names; par/odde single-cell rendering.
- **DEMOTED to SHOULD:** shortlist auto-open-compare behavior (may just be the inline facts); grade shape moved *into* the decision cell only (D12).

---

## 13. Resolved open questions (draft §9 — all closed)

| Draft open question | Resolution |
| --- | --- |
| Øving-heuristic accuracy floor + validation set | Moot — clustering cut (DR-1). Only the lecture/øving keyword classifier needs a small validation set; a misclassified øving degrades to a muted label, never a wrong hard-flag. |
| Shortlist auto-opens compare or not | No compare page exists; shortlist surfaces inline facts. Auto-open is a COULD micro-decision, not architectural. |
| Candidates-in-hash from day one | **Yes** — `tier` is in `PlanState` and the hash from v2 (§7, c3-2, c4). |
| Plan strip suppressed on `/planlegger/` or not | Suppressed on `/planlegger/` (the page *is* the plan); shown everywhere else. |
| Which single grade figure in the compare cell | Season-split distribution *shape* (two derived facts, never a score/sortable column), per the p4 discipline (D12). |
| First-year on-ramp when `publishedYears` gaps | Fall back to nearest published year; pre-fill labeled "foreslåtte emner, juster selv" (DR-7). |
| Personal-blocks worth the `store.ts` complexity | **No** — cut (D14). |
| City-level campus + language + assessment enough for exchange persona | Persona D folded into filters (D14); city-level campus + language + assessment is the commitment, no translation layer. |
| **New, kept open:** lecture/øving keyword classifier's precision on non-English course names | Needs a small hand-labeled validation set; failure mode is benign (muted label, not a false conflict). |
| **New, kept open:** which client-side counter mechanism satisfies the four §1 metrics without accounts | Edge-worker aggregate counters vs. privacy-preserving client beacon — a build detail, doesn't change the product. |

---

*This file is the definitive product definition. `PRODUCT-draft.md` is superseded and retained only as history.*
