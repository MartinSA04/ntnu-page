# PRODUCT.md — Semesterplan: what this site should be

## §0 — The mandate (user, 2026-07-24; overrides everything below where they conflict)

1. **Programme → kull → your week, instantly.** Selecting study programme +
   kull must be extremely easy, and the immediate result is the weekly
   schedule. NTNU auto-enrolls programme students in their courses each
   semester, so the programme pre-fill IS the student's reality — it is the
   default plan, not a hedged "suggestion". (DR-7's fallback math and honest
   labeling still apply; D4's suggestion-only framing is superseded.)
2. **The weekly schedule is the primary surface.** The drop/add window runs
   well into the first month of the semester; the schedule is what people
   come back to. Everything else supports it.
3. **Editing is trivial**: drop a programme course → it grays out in the
   course list (still visible as part of the programme, one tap to restore,
   excluded from schedule/credits). Add extra courses on top. Manual adds
   are removable outright.
4. **Lecture-based by default** with one simple toggle to show
   øvinger/labber (aligns with DR-1's lecture-only conflict engine).
5. **Graceful pre-publish fallback** when timetables aren't out (DR-2):
   never blank — course list + exam dates + "publiseres ~august" note.
6. **DO NOT OVERCOMPLICATE.** As simple as possible while maintaining
   value. The decide-loop apparatus (shortlist tier, swap-delta, inline
   decision facts) is deferred until the §0 core is excellent. When in
   doubt, cut.

### Addendum (user, 2026-07-25) — supersedes items below where noted

A second user mandate landed the day after the section above shipped, full
design spec at `docs/plan/REWORK-2026-07-25-design.md`, recorded here per
that doc's own instruction. The eleven points, compressed, each naming what
they supersede:

1. **Parallels default to the programme's own, user-selectable per course**
   ("some may have other commitments and want to customize"). DR-1 (§8) is
   **narrowed, not reopened**: conflict *detection* stays lecture-only, but
   display-level group selection (which lecture parallel/øving group
   renders) is now shipped (`groups.ts`, the block popover's group picker).
2. **Programme/kull/retning editing gets a settings surface** ("people have
   webpage patterns they are used to"). Decided: a modal over the planner
   (`studieinfo.ts`), not a page — supersedes the homepage picker's role as
   the *only* editor (point 11 below deletes that picker outright).
3. **`/studier` is deleted outright, both surfaces, no redirects** ("not on
   GitHub, breaking links is fine"). Supersedes §4's IA list (both
   `/studier/[code]/` and the `/studier/` standalone index rows are gone —
   §4 corrected below) and REVIEW.md I3's "entrances before deletion"
   sequencing rule, which no longer applies now that both pages are simply
   gone rather than migrated.
4. **The schedule must render multiple simultaneous items properly** —
   people deliberately take colliding courses; overlap is a *supported*
   state, not breakage. Decided: a calendar-engine rebuild (`layout.ts`/
   `grid.ts`, side-by-side clusters up to two columns — one on a phone —
   then one pile block naming every session in the cluster; the "+N til" chip
   this line originally described is gone, see SPEC.md's `layout.ts` bullet)
   with a block popover (`popover.ts`). D14's cut of the week-scrubber
   reads, adjacent to
   "no personal fixed blocks," as also having killed any block-level
   popover — it didn't decide that either way, but this point settles it:
   the popover is explicitly in scope. D14's actual holdings (week-scrubber,
   fixed blocks, workload counts, persona D) are unaffected.
5. **Schedule and exam views needed major rework.** Decided: the side-by-side
   cluster grid above, plus an exam *date list* with explicit gap lines
   (`examSchedule.ts`/`examList.ts`) replacing the ribbon DR-3 shipped.
   DR-3's underlying sourcing rule (catalog `ExamDate`, not scraped text;
   kont excluded) is unchanged — only the display is.
6. **Navigation: persistent buttons, not layout-dependent ones.** Supersedes
   D11's "one nav pill" — the nav is now **Planlegger + Emner + a
   studieinfo chip**, identical on every page (`Layout.astro`). §4's "one
   pill" line and the plan strip it describes are corrected below.
7. **Manual adds are semester-specific.** Shipped as `np:plans` scoped per
   `semesterId`, with `np:profile` (the programme choice) global — a manual
   add in one semester no longer leaks into another.
8. **Add-course flow: a search modal** (`addCourse.ts`), replacing the
   planner's inline add-field typeahead described in §3.3/PLANNER.md.
9. **No versioning/compat apparatus — delete old code outright.** §7's
   "frozen versioned hash grammar (`#v2;…`) with v1-compat parse" (also
   D15) is **suspended, not amended**: pre-launch, not on GitHub, breaking
   old links/localStorage is acceptable. The shipped grammar is unversioned
   (`#<semesterId>;<programme>;<courses>`, `~group` keys added) — see
   SPEC.md for the exact grammar the code implements. This rule resumes
   once the site has real external links worth not breaking.
10. **Kull chips: only relevant cohorts.** Narrows REVIEW.md B3's "cohorts
    whose computed period exists" to a duration-and-intake-aware window
    (`year(S) - durationYears < K ≤ year(S)`, honoring `startTerm`), so a
    20+-kull programme doesn't dead-end on a wall of dead chips.
11. **Homepage picker gone: homepage is a landing.** Supersedes §3 flow 1's
    "picker as the secondary path" and all of §5 (the picker, kull chips,
    and direction panel described there are deleted) — the homepage is now
    kicker + headline + proof fragment + one CTA to `/planlegger/`; the
    planner owns onboarding via its own empty states (§4 below).

Definitive product definition (assembled from the 23-agent planning panel; working papers in docs/plan/). Reworked against four critiques — c1 (value), c2 (feasibility vs. our exact `ntnu-api` data), c3 (flow), c4 (differentiation). Design system "Ruteark" (DESIGN.md) is assumed law and not restated. Where this file and PLANNER.md disagree on scope, this file wins for the pages it touches; PLANNER.md remains binding for the Ruteark render detail it specifies.

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

1. **First-year on-ramp (decode-first).** *(The picker step below is deleted, 2026-07-25 — §0 addendum point 11. Kept as historical record of the reasoning; the homepage is now a landing with one CTA to `/planlegger/`, which owns onboarding via its own empty states — §4.)* `/` → **code-first path is the headline** ("Har du fått emnekodene? Lim dem inn") → `/planlegger/` renders this week's schedule + rooms + code→name. The program+kull picker is the *secondary* path and pre-fills only labeled, editable **suggestions** ("foreslåtte emner, juster selv"), never an authoritative plan (c1-4). Calm pre-publish mode if timetables aren't out (see flow-agnostic rule below).

2. **Elective decide-loop (CO-PRIMARY, not yet built — Phase 4).** *(`/studier/[code]/` below is deleted, 2026-07-25 — §0 addendum point 3; the choice-group prose it hosted moved to a "Fra studieplanen" panel in the planner's course rail. This flow is unbuilt regardless, so the entry point needs re-deciding whenever Phase 4 starts.)* Choice group on `/studier/[code]/` → "legg alle til vurdering" (shortlist tier, localStorage + hash) → **inline in each choice-group row: "kolliderer med planen din" + two facts** (assessment form, grade shape) computed against committed courses → ghost blocks on the planner grid → drop losers → **promote survivor, and on promotion render a plain-language delta**: *"TDT4200 → TDT4258: fjerner 1 kollisjon, sprer eksamen fra 2 til 5 dagers mellomrom."* → credit running total climbs → **commit summary** (copyable code list + "bekreft i Studentweb") → Studentweb. No compare page, no matrix (c1-2, c4).

3. **Free-search add & clash-check.** `/emner/` (a *mode*, not a top-level destination — see §4) with filters → **plan-aware row preview before add** ("ville kollidert med TMA4100") → quick-add → the persistent nav's studieinfo chip updates sitewide (plan strip deleted 2026-07-25 and the count-link deleted 2026-07-27, §4).

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

**Four pages. Persistent nav (corrected 2026-07-25 — see §0 addendum point
6). Search is a mode, not a destination.** The draft's "two pills —
Planlegger | Emner" still made search a co-equal top-level surface, which
contradicted the positioning at the time (c4-2, c4-cut #1); the 2026-07-25
mandate has since asked for persistent buttons regardless of layout, so the
nav *is* now Planlegger + Emner side by side, plus a studieinfo chip — see
the corrected nav paragraph below.

- `/` — **dispatcher + proof.** Verb-first, shows the red-ink collision above the fold (§5). **Shipped.**
- `/planlegger/` — **the app.** The plan, the grid, the verdict lines, the "Bytt semester" disclosure. Search lives *inside it* as an add field/mode. **Shipped** (the temporal margin banner and the decide-loop's shortlist/swap-delta layer are Phase 3/4, not yet built — see ROADMAP.md).
- `/emner/` — **find courses** (still a real page for deep search and for search-engine landing). Reachable from the planner's add field (now a search modal, `addCourse.ts`) and from the nav — **Shipped**; the `?type=studier` merge with programme search is moot (`/studier/` is deleted outright, not absorbed — §0 addendum point 3).
- `/emne/[code]/` — **the fork point** (§3.4). Plan-aware, with a clash preview under the CTA. **Shipped**, reordered per REVIEW.md U10. `?mot=` as a deep-linked two-course view is COULD-tier and not built.

**`/studier/[code]/` and `/studier/` (both surfaces) — deleted 2026-07-25,
no redirects** (§0 addendum point 3). Surviving logic moved: kull relevance
+ plan fetch → the studieinfo modal (§2 of the design spec); period courses
+ verbatim choice-group prose → a collapsible "Fra studieplanen" panel in
the planner's course rail, where "Bruk som planen min" semantics now live
(saving programme+kull in the modal *is* the import). This retires REVIEW.md
I3's "entrances before deletion" sequencing rule — it doesn't apply to an
outright deletion with no migration path.

**Nav: persistent Planlegger + Emner + a studieinfo chip, corrected
2026-07-25 (§0 addendum point 6, supersedes D11's "one pill").** Every page
carries the same nav — no page-dependent single pill, no footer demotion of
`/emner/`. `aria-current` is still computed from an explicit per-item
`sections` list rather than a path prefix, so `/emne/[code]/` (not a
prefix-match of `/emner/`) still lights the right item. The chip shows
`MTDT · 2024 · Høst 2026` (or "Velg studieprogram") and opens the
studieinfo modal; the plan is not a nav item, but its state is always one
tap away via the chip.

**The plan strip is deleted, corrected 2026-07-25 — and the count-link that
replaced it is deleted too, 2026-07-27 (commit 665513f).** The cross-page
continuation affordance (c3-3) is carried by the persistent nav's studieinfo
chip alone: it names whose plan this is on every page and is one tap from the
week. The intermediate design — a sitewide count-link bar reading "N emner ·
X sp → ukeplanen" on every page but the two that already show the plan — was
built and then removed; it duplicated the chip one row below it and spent a
whole sitewide band on a number the planner's own credit line owns. Do not
re-add it. Any credits shown outside `/planlegger/` are best-effort, not
authoritative.

**URL is the state, and it is the growth object** (c1-1, c2-F7). Hash
grammar — **unversioned as of 2026-07-25** (§0 addendum point 9, suspending
§7's freeze/D15): `#<semesterId>;<programme>;<courses>`, courses gaining
repeatable `~group` keys. See SPEC.md for the exact grammar the code
implements; §7 below is left as the historical record of the versioned
grammar and why it was suspended. Query params for page-local view: `?q=`
(search prefill, also used for cross-page intent recovery from 404).

---

## 5. Homepage (was under-specified; now a MUST, and the growth proof) — superseded 2026-07-25

**The picker described in this section is deleted** (§0 addendum point 11):
the homepage is now a landing (kicker, headline, illustrative mini-schedule
proof fragment, one CTA to `/planlegger/`, and a resume line when a profile
exists) — the planner owns onboarding via its own empty states (design
spec §3). The bullets below are kept as the historical record of what the
picker-era homepage shipped, not current behavior.

The original hero ("Planlegg semesteret … se … samlet") was passive, calendar-generic, read-only, and hid our one instantly-legible differentiator on another page (c4-3). Status of the fix, as of 2026-07-24 (superseded, see above):

- **Verb-first H1** and above-the-fold typeahead: **shipped.** The programme field autofocuses, carries `studyLevel` + `cities` on every row (REVIEW.md B6 — this is what stops MIDT and MTDT rendering as identical "Datateknologi" rows), and kull chips are filtered to cohorts whose computed period actually exists (B3) rather than a 20-chip dead-end grid.
- **The studieretning/campus question inline before navigating** (B2): **shipped.** A picked programme with a `pendingChoice` renders its direction chips on `/` itself; the dispatcher never sends a student to a week it can't fill.
- **Proof fragment** (a small `.np-frame.np-ruled` red-ink collision showing "Del planen med en lenke — ingen innlogging"): **shipped** — `src/pages/index.astro`'s `.home-proof` renders exactly that (TDT4110 above a TMA4100 row marked "Kolliderer med TDT4110 torsdag 14:15", `aria-hidden`, with the caption below it). It sits *below* the CTA rather than above the fold, which the picker-era wording assumed; nothing in this section is still open. (It is also the last surviving `.np-ruled` surface on the site — see DESIGN.md §4/§8.)
- **One CTA + resume line** ("Planen din: N emner · X sp" when a plan is already stored): **shipped**, plus the plan strip is suppressed here (§4) since the resume line already says the same thing.
- **Kull caption** ("kull = året du startet"): **shipped** (U18).

---

## 6. Features (MoSCoW) — reweighted so verbs beat nouns

The draft's MoSCoW was ~60% incumbent-owned nouns (catalog, grid, description, grade stats), reading as "course browser + bolted-on planner" (c4-1). v2 keeps the nouns we genuinely need but **elevates the verbs that are ours** (decide / preview / swap-delta / share / admit-gaps) and demotes the elective *apparatus* that a twice-a-year user won't reach until evidence says otherwise (c1-2).

**MUST (the buildable spine + the differentiators)** — status as of 2026-07-24, this branch:
- Merged weekly grid (red-ink collisions). **Shipped**; rebuilt 2026-07-25 as the calendar-engine grid (`layout.ts`/`grid.ts` — side-by-side overlap clusters, a pile block where a cluster is too deep to split, a block popover) per §0 addendum point 4: overlap is a supported state, not breakage. *(The `.np-frame.np-ruled` this bullet used to specify is no longer on the week — the squared ruling was retired from the spread in f86105b and only the hour line remains; DESIGN.md §4.)*
- **Conflict engine — lecture-only hard conflicts** (see DR-1; the draft's "øving-group clustering with alternative-avoidance" is **cut as unbuildable** — §12/DR-1). Øving/lab shown as a muted, non-clashing display label. **Shipped**, including the B7 fix (auto-reveal the muted layer when a plan has entries but zero lecture-classified ones, instead of a blank default week). **2026-07-25:** display-level group/parallel selection shipped alongside it (`groups.ts`) — DR-1's detection scope is unchanged (§0 addendum point 1).
- **Exam ribbon sourced from catalog `ExamDate`** (structured `date`+`continuation`), not scraped exam text (DR-3). Ordinary-only by default; kont filtered out. **Shipped** — but by a *different mechanism than DR-3 originally assumed*, corrected 2026-07-27 (audit exams-1). The catalog's `continuation` flag cannot carry it: **0 of 2 438 catalog exam rows set it**, and the search portlet returns `continuation: false` for the very sitting `/api/course/:code` labels "Utsatt eksamen". The kont filter is therefore a **client-side join in `src/components/planner/examList.ts`** (`collectExamInputs`/`isDeferredOn`/`isDeferredOccasion`): it matches a catalog exam to a scraped one on the **exact ISO date** — the one structured field both sides carry — and drops it only when every scraped sitting on that date is deferred. `occasion` is read as a *label only*, never re-parsed for a date, so DR-3's "never re-parse scraped free-text" still holds. It is deliberately **fail-open**: no scrape, no match, or an occasion we do not recognise keeps the exam, because deleting a real exam date is far worse than listing one too many. A course left with no dated ordinary sitting keeps one "dato ikke satt" row rather than vanishing. **Do not "restore" the crawler filter** — it is correct code fed a flag upstream never sets. Also shipped: the semester-window filter (REVIEW.md C3) so a carried-over course can't show a stale year's date. **The ribbon display itself was replaced 2026-07-25** by a chronological exam date list with explicit gap lines (`examSchedule.ts`/`examList.ts`, §0 addendum point 5) — DR-3's sourcing rule is unchanged.
- **Live, null-aware credit total**: *"22,5 av 30 sp (+2 emner uten oppgitt sp)"* (DR-6). **Shipped** — B9's four independent defects (discarded study-plan credits, off-semester courses counted, overload painted green, suspicious prefills silently zeroed) are all fixed.
- **Plan-aware clash preview *before* add** — the verb, everywhere (`/emner/` rows, `/emne/[code]`, and 2026-07-25's add-course modal, `addCourse.ts`, §0 addendum point 8). **Shipped** (`components/site/planClash.ts`, computed lazily on first hover/focus) — all three surfaces now share the same section-aware collision path.
- **Decide-loop inline facts**: in each choice-group row, "kolliderer med planen din" + assessment form + grade shape (no compare matrix). **Not yet built** — Phase 4, ROADMAP.md.
- **Plain-language swap delta sentence** on promotion (c4-double-down #2). *This is the product.* **Not yet built** — Phase 4; there is no promote/swap flow yet to attach it to.
- **Shortlist tier** (committed vs. considering) as pure localStorage + hash — **candidates in the hash from day one** (c3-2, c4-double-down #1; open question closed). No `v:2`-only compare dependency. **Not yet built** — Phase 4; `PlanState` (§7) has no `tier` field yet.
- **Shared-plan as a first-class object**: static-tier first paint, real unfurl title, **merge/replace/keep** three-way interstitial (c1-1, c3-5). **Partial.** The hash itself round-trips correctly including non-ASCII (B10) and `hashchange` applies a pasted link live; there is no unfurl title and no merge/replace/keep interstitial yet — Phase 3.
- **Code↔name pairing** and **code-first paste entry** (persona B's real artifact) (c3-6). **Partial.** The planner's add field is code-first once you're on `/planlegger/`, and B8 turns a missing study plan into a link there ("legg til emnekodene dine selv →"); the homepage still leads with the programme picker, not a code-paste field, so a cold Persona-B visitor doesn't see this first.
- **Season-split grade trend**, rendered *in decision context* (see the differentiation note below). **Shipped on `/emne/[code]/` 2026-07-27** (commit 94b5d9a, `#grades-section` + `src/components/site/gradeChart.ts`) — a deliberate re-litigation of D12, recorded in the D12 row of §10 rather than silently rewritten. The fork point *is* a decision context per §3 flow 4 and the differentiation note below, so the figure lives there and not in a browsable encyclopedia tab. **The constraints that still bind** (all shipped, all verified during the 2026-07-27 audit remediation): season-split small multiples, one chart per sitting, newest first; cohort `n` written out on every chart ("… kandidater") and no bars at all under `MIN_CHART_CANDIDATES` = 10; one hue (`--hue-blue`) for every bar, F deliberately **not** red (Red-Is-Collision); no sortable column, no cross-course leaderboard, no derived difficulty score. **Deferred (utsatt/kont) sittings must never be drawn as peer semesters** — DBH files them as their own (year, semester), so the newest chart used to be the re-sit cohort's ~60 % fail rate read as this course's current difficulty (audit pc-2/cpc-6); they are held out and named in a note. The still-unbuilt half is the *elective decision cell* (Phase 4), where the same shape belongs in a choice-group row.
- **Provenance / staleness line** on every composed verdict (DR-8) — the honest-join MUST (c1-5). **Shipped** on `/planlegger/` (composed per-render from what actually happened: live timetable fetch, catalog-dated exams, study-plan cohort, real per-course fetch failures). Not yet present on `/emne/[code]/`.
- **Temporal margin banner** driven by `termContext()` (c3-1) and **"next plannable term" as an explicit rule** across the Sep-15/Feb-1 seam (c3-1, DR-9). **Partial.** DR-9's rule is enforced (semester chips for an unpublished term carry an inline "timeplan publiseres ~måned" note rather than a silent trap — REVIEW.md U6); the deadline-countdown banner itself is not built.
- **Designed pre-publish mode as a *primary* mode** (DR-2, c2-F8): exam ribbon + credits + grades + assessment carry real value with no grid; clash engine degrades to exam-clash + campus-spread. **Partial** — an unpublished semester is now an informed choice (U6) rather than a silent blank grid, but there is no dedicated pre-publish layout distinct from the normal empty-grid message.
- **Commit summary**: copyable committed-code list + "bekreft i Studentweb" (c3-4). **Not yet built.**
- Language / campus (city-level) / assessment filters (absorbs old persona D). **Partial** — campus is shipped as ~4 city facets on `/emner/` (REVIEW.md U15, replacing 8 raw location strings); language and assessment filters are not built.
- Plan strip (sitewide, with cross-page continuation affordance) (c3-3). **Superseded 2026-07-25, and settled 2026-07-27** — the strip went with the layout-dependent single nav pill (§0 addendum point 6), and the count-link that briefly replaced it was removed in turn (665513f). The persistent nav's studieinfo chip carries the affordance alone — see §4.
- Mobile day-agenda + 44px touch targets. **Not yet built** — unaffected by the 2026-07-25 rework, stays open. A4's narrower fix shipped instead (edge fade + scroll-to-today + a hint naming the clipped days, so the horizontal-scroll week stops silently truncating Thursday/Friday) — the agenda *restructure* for mobile is still open.
- `notices[]` at add-time, incl. **off-semester add handling**: message defined, and **off-semester credits excluded from the 30-sp total** so the "full load" signal isn't corrupted (c3-8). **Shipped** (part of the B9 credit-line fix).
- **Version threading** made first-class in `PlanState` + every API call + hash (DR-4, c2-F4) — a correctness MUST, not a nicety. **Shipped** (REVIEW.md C2 — the search index and every add path now carry the catalog version; 293 of 5 470 courses are not version "1"). This is catalog *course* versioning (DR-4), unaffected by the 2026-07-25 suspension of *hash-grammar* versioning below.
- Dateless-exam state ("dato ikke satt", DR-3). **Shipped.**
- **Frozen versioned hash grammar with v1-compat parse** (c2-F7). **Suspended 2026-07-25** (§0 addendum point 9) — the grammar shipped today is unversioned, no compat parse; see §7's suspension note for why and SPEC.md for the exact grammar.

**SHOULD:**
- Day-load strip + free-day sentence (persona C lens).
- Plan-context line on `/emne/[code]`.
- Bulk-add above prose on `/studier/[code]` — **moot 2026-07-25**, the page is deleted; "Bruk som planen min" now lives as the studieinfo modal's Lagre action (§0 addendum point 3).
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

**Suspended 2026-07-25 (§0 addendum point 9).** The "frozen" heading above
and the `v`/version machinery this section describes are historical record
only — the user mandate deleted versioning/compat apparatus outright
pre-launch. The code now implements the unversioned grammar
`#<semesterId>;<programme>;<courses>` with repeatable `~group` course
suffixes (SPEC.md has the exact, current grammar). This section is kept
below rather than rewritten because it documents *why* a versioned grammar
was chosen in the first place (studieretning-gated round-tripping, D15);
that reasoning still explains the shape of the unversioned grammar's
programme segment, only the version token itself is gone.

**Corrected 2026-07-24, after the fact.** This section originally froze
`#v2;26h;TDT4100.1,TMA4100.1;IT2805.1` — courses in segment 3, no programme
segment at all. That was never buildable against our actual domain model: a
programme pick needs to carry `code`, `cohort` *and* an optional resolved
`direction` (studieretning/campus) through the hash, or a shared link to a
studieretning-gated programme (REVIEW.md B2, B10) can't round-trip. The
shipped grammar below is what the code has always actually done; freezing
the wrong grammar on paper is exactly the failure mode this section exists
to prevent, so it's corrected here rather than left to drift (docs are not
frozen; the code was right, the doc wasn't — REVIEW.md B10.2).

```ts
interface PlanState {
  v: 2;
  semesterId: string;                 // "26h" | "27v" — Semester.id
  courses: {
    code: string;
    name: string;
    version: string;                  // FIRST-CLASS — "1" default; threads to API + grid + exam
    source: "program" | "manual";     // programme-derived vs. added by hand
    dropped: boolean;                 // programme course grayed out, never deleted
    credits: number | null;           // carried from the study plan, so a catalog-miss doesn't zero it (B9.1)
  }[];
  program?: { code: string; name: string; cohort: number; direction?: { code: string; name: string } };
}
```

- **Hash grammar (versioned, v1-compat):**
  `#v2;<semesterId>;<programme>;<courses>`

  - `semesterId` — `/^\d{2}[hv]$/i`, e.g. `26h`. Whether the *site* can plan
    that id is the caller's problem, not the grammar's: an id the site has
    no plannable data for falls back to the current semester with a visible
    note, it never fails to parse.
  - `programme` — `-` (none) or `code[.cohort[.direction]]`. `cohort` MUST
    be a plausible 4-digit year (`[1990, currentYear + 5]`) or the **whole**
    programme segment is rejected (`program: null`) while the rest of the
    hash still parses — this is exactly what would otherwise misread
    `TDT4100.1,TMA4100.1` (the grammar this section used to freeze) as
    `{code:"TDT4100", cohort: 1}`.
  - `courses` — comma-separated `[-|+]code[.version]`. No prefix = an active
    programme course; `-` = a dropped programme course (still listed,
    excluded from the grid/credits, one tap restores it); `+` = a manual
    add (removable outright). `.version` is omitted when it equals the
    default (`"1"`).
  - **Encoding is load-bearing.** Every field is
    `encodeURIComponent`-escaped on write and `decodeURIComponent`-unescaped
    on read. `encodeURIComponent` leaves the grammar's own punctuation
    (`. - _ ~ ! * ' ( )`) untouched while escaping `; , / %` and every
    non-ASCII byte — so `Ø`/`Å`/`Æ` in a direction code (e.g.
    `BSPL26-V-GJØVIK` → `BSPL26-V-GJ%C3%98VIK`) round-trips exactly, which
    it did not before (REVIEW.md B10.1). A malformed escape is returned
    verbatim rather than failing the whole parse.
  - A legacy unversioned `#<semesterId>;<codes>` (no `v` token, bare comma
    codes, all `source:"manual"`, version `"1"`, no programme) is still
    **read** for backward compatibility with any link written before this
    grammar existed. `formatPlanHash` only ever **writes** `v2`. A hash with
    any other version token (`v1`, `v3`, …) parses to `null` — it is never
    half-read and never falls through to the legacy branch.
  - `hashchange` is listened for (aborted with the page's own signal) so
    pasting a shared link into an already-open tab applies it, ignoring the
    hash the page just wrote itself.

- **Static-tier first paint** (c1-1): codes/names/credits resolve from the
  hash + `search-index.json` with zero API calls where possible — the
  received-plan first render and any future unfurl title both come from
  here.
- `PLAN_HASH_VERSION = "v2"` is exported from `src/lib/planner/store.ts`;
  reference that constant rather than the literal string.
- **Not yet shipped, forward-compatible:** §6's shortlist tier
  (`committed`/`shortlist`) and the grade-join bare-prefix aggregation
  belong to the Phase 4 decide-loop (ROADMAP.md), which hasn't landed. When
  it does, a `tier` field is a new, additive `courses[]` property — it does
  not need a new hash version, since an old client encountering a courses
  segment it doesn't understand a sub-field of still round-trips the parts
  it does understand. A change that is NOT additive (e.g. restructuring the
  `courses` segment's grammar itself) does need a new version token, per the
  rule above: no un-versioned or silently-reinterpreted segment, ever.

---

## 8. Domain rules (binding — reconciled with our actual data shapes)

Each rule below names the data reality that forces it; these supersede the draft's §6 where they conflict, because the draft assumed fields we don't have (c2).

- **DR-1 — Conflict engine is lecture-only.** `TimetableEntry` (models.ts:322) has **no `activityCode`** and no group-membership field; keying on `courseCode+day+start+end` *merges* parallel øving groups instead of distinguishing them, and there is no way to enumerate "alternative slots that avoid the clash." Therefore: **MUST = lecture-only hard conflicts**, lectures classified by keyword on `name`/`title`; øving/lab rendered as a muted, non-clashing display label. **The draft's "only hard-flag when no alternative avoids the clash" is deleted** — it is unbuildable and would produce confidently-wrong answers on every lab-heavy course (c2-F1). Fix first, alongside DR-4. *(Narrowed, not reopened, 2026-07-25 — §0 addendum point 1: conflict* detection *stays lecture-only exactly as above; display-level group/parallel selection is a separate, now-shipped concern, `groups.ts`.)*
- **DR-2 — Pre-publish is the chooser's primary mode.** `timetablePublished` is false through most of the elective-planning window and `timetable()` returns `[]` then, so a grid-only flagship is **blank exactly when Velgeren plans** (c2-F8). The clash engine degrades to exam-clash + campus-spread; exam ribbon + credits + grades + assessment carry the mode; optionally show last published year's grid **labeled non-authoritative.** "Next plannable term" must not force a blank primary surface.
- **DR-3 — Exam ribbon from catalog, not scrape.** Scraped `CourseExam.date` is null for hjemmeeksamen (`dateText` carries `"Utlevering 07.11.2025"`); occasion is free text (c2-F3). Drive the ribbon from catalog `ExamDate` (structured `date`, already in the search index); scraped exam only enriches popovers; `dateText`-only → "dato ikke satt" bucket. **Never re-parse scraped free-text into a date.** *(Corrected 2026-07-27, audit exams-1: the `continuation` half of this rule does not work — upstream sets the flag on nothing, so kont filtering has to be a client-side join on the exact ISO date against the scraped `occasion`, read as a label. Both the planner's exam list and the course page's grade figure do it that way, fail-open. See §6's exam bullet.)*
- **DR-4 — Version threading is first-class + correctness-critical.** `courses.timetable/schedules` default `version:"1"` (courses.ts:167); a re-versioned course otherwise shows the **wrong grid/exam data** (c2-F4). `version` is in `PlanState`, every API call, and the hash (§7). Grade join is bare-prefix aggregation (§7).
- **DR-5 — Study plan has no cardinality; never assert "group satisfied."** `PlanCourseGroup` (programs.ts:91) is `{code,name,description,courses[]}` — **no min/max/choose-N**; the "velg 2 av 5" lives only in free-text `description` (c2-F2). Therefore the decide-loop shows a **credit running total + a verbatim quote of the group prose**; the app **never** asserts a group is satisfied or auto-picks "best 2 of 5." Recursive retning render + `retning.deadlineDate` + `publishedYears`/`periodNumber` gating are SHOULD.
- **DR-6 — Credit total is null-holed.** `PlannedCourse.credits` is nullable; the authoritative number is on course details (c2-F6). Total is async-aware: *"22,5 av 30 sp (+2 emner uten oppgitt sp)."* Off-semester courses excluded from the sum (c3-8).
- **DR-7 — First-year period math is fragile; the pre-fill is a suggestion.** `periodNumber` nullable, `startTerm` nullable (spring intakes break `autumn?1:2`), unpublished cohorts return null, `studyChoice.code` "O" unreliable (c2-F5). Fall back to nearest `publishedYears`, honor `startTerm`, default period 1 + user-editable chip when null, and **label the pre-fill "foreslåtte emner, juster selv."** Never present it as authoritative (also c1-4).
- **DR-8 — Provenance is a surface, not an edge state.** Every composed verdict carries a data-freshness line: last-crawl date, "eksamensdato ikke publisert," "timeplan ikke publisert ennå." The honest join is the moat (c1-5).
- **DR-9 — "Next plannable term" is an explicit rule.** Defined across the Sep-15/Feb-1 seam via `semesters.json` `phase`/`fromDate`/`toDate`/`examLastDate`/`timetablePublished` (c3-1) — not an invisible default. Drives both the semester default and the temporal banner.
- **DR-10 — Off-semester add is defined.** `planElement` filtering on bulk-add (0-sp *real* courses stay); an off-semester add yields a `notices[]` line and is **excluded from the credit total** (c3-8).

**Never** re-parse scraped free-text into structured facts; branch only on structured `form`/`weighting`/`continuation` (kept from draft) — with the 2026-07-27 caveat that `continuation` is *structurally* present but *empirically* always false, so a branch on it is a branch on nothing (DR-3).

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
| D11 | **One nav pill (Planlegger); `/emner/` demoted from nav; `/emne/[code]` is a fork point, not an encyclopedia.** *(Nav corrected 2026-07-25 — §0 addendum point 6: the user asked for persistent buttons regardless of layout; nav is now Planlegger + Emner + a studieinfo chip on every page. `/emne/[code]` as a fork point, not an encyclopedia, is unaffected.)* | Draft's two pills (Planlegger \| Emner); course page as "research / largest traffic." | The loudest surfaces were the least differentiated; the IA must obey the positioning (c4-cut #1, c4-cut #2). |
| D12 | **Grade stats only in the decision cell.** *(Partially reversed 2026-07-27, commit 94b5d9a — an explicit owner decision, kept here rather than rewritten so the reasoning on both sides survives. The season-split figure now ships on `/emne/[code]/`, which §3 flow 4 and the differentiation note below already name as **a** decision context — "the fork-point context". What D12 rejected and still rejects is grade **trivia**: a sortable column, a cross-course leaderboard, hue-tinted bars, any derived difficulty score, and a figure divorced from the fork CTA. The audit's cpc-2 flagged the doc/code contradiction; §6's grade bullet lists the constraints the shipped figure is held to, including that resit sittings must not be drawn as peer semesters.)* | Draft's browsable grade shape on the course page. | Browsable grade trivia is DBH-mirror parasitism and violates the p4 discipline; in-decision it informs and differentiates (c4-cut #3). |
| D13 | **Temporal margin banner + return trigger are MUST; "next plannable term" is an explicit rule.** | Draft had the deadline in zero of six flows; "next term" was an invisible default. | The entire positioning is "before the deadline" — it was off-screen (c3-1, c1-7). |
| D14 | **Cut week-scrubber, personal fixed blocks, assessment-mix workload counts; fold persona D into filters.** *(Clarified 2026-07-25 — §0 addendum point 4: this row never actually decided anything about a block-level popover; it only read that way adjacent to "no personal fixed blocks." The 2026-07-25 mandate settles it: a block popover is in scope. Week-scrubber, fixed blocks, workload counts and persona-D-as-a-build stay cut.)* | Draft SHOULD/COULD-listed all of them. | During-semester concern in a before-semester tool; breaks shared-URL parity; wrong side of no-fabricated-scores; dragged translation work back for a sliver (c1-6, c3-9). |
| D15 | **Frozen versioned hash grammar (`#v2;…`), v1-compat parse, four segments: semester · programme (`code.cohort.direction`) · courses (`[-\|+]code.version`).** *(Corrected 2026-07-24 — see §7. This row originally froze a three-segment grammar with courses in segment 3 and no programme segment; that was never what the code did, and feeding it to the shipped parser misread a course code as a programme+cohort. §7 now documents the grammar that actually round-trips, including the percent-encoding rule that makes an Ø/Å/Æ-bearing direction code survive a share.)* | Draft accreted hash segments across six flows with no version token. | Un-versioned accretion means shared links silently drop state as the grammar grows (c2-F7). |

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

- **KILLED:** øving-group clustering with alternative-avoidance (DR-1, unbuildable); compare *matrix* + both substitution engines (D2); week-scrubber (D14); personal fixed blocks (D14); assessment-mix workload counts (D14); persona D as a distinct build (D14); `/studier/` standalone index; the "Emner" nav pill (D11 — *reinstated 2026-07-25, §0 addendum point 6: persistent nav is now Planlegger + Emner*); homepage triptych (§5); "did the student leave sure?" as a *metric* (D3); auto "best 2 of 5" / any "group satisfied" assertion (DR-5); program marketing prose as primary content; bilingual UI chrome; glossary/FAQ; cross-course grade leaderboard; building-level campus filter.
- **DEMOTED to COULD (evidence-gated):** `?mot=` two-course view (add-surface only, not a matrix); English course names; par/odde single-cell rendering.
- **DEMOTED to SHOULD:** shortlist auto-open-compare behavior (may just be the inline facts); grade shape moved *into* the decision cell only (D12) — **partially reversed 2026-07-27**: the fork point counts as a decision context and the season-split figure ships there (§6, D12's note). What stays killed is the *browsable* framing: no sortable column, no cross-course grade leaderboard, no hue-tinted bars, no difficulty score, and no grade figure detached from the fork CTA.

---

## 13. Resolved open questions (draft §9 — all closed)

| Draft open question | Resolution |
| --- | --- |
| Øving-heuristic accuracy floor + validation set | Moot — clustering cut (DR-1). Only the lecture/øving keyword classifier needs a small validation set; a misclassified øving degrades to a muted label, never a wrong hard-flag. |
| Shortlist auto-opens compare or not | No compare page exists; shortlist surfaces inline facts. Auto-open is a COULD micro-decision, not architectural. |
| Candidates-in-hash from day one | **Yes** — `tier` is in `PlanState` and the hash from v2 (§7, c3-2, c4). |
| Plan strip suppressed on `/planlegger/` or not | **Shipped, corrected from the original answer:** suppressed on both `/` (its own resume line already says this) and `/planlegger/` (the page *is* the plan); shown everywhere else. |
| Which single grade figure in the compare cell | Season-split distribution *shape* (two derived facts, never a score/sortable column), per the p4 discipline (D12). |
| First-year on-ramp when `publishedYears` gaps | Fall back to nearest published year; pre-fill labeled "foreslåtte emner, juster selv" (DR-7). |
| Personal-blocks worth the `store.ts` complexity | **No** — cut (D14). |
| City-level campus + language + assessment enough for exchange persona | Persona D folded into filters (D14); city-level campus + language + assessment is the commitment, no translation layer. |
| **New, kept open:** lecture/øving keyword classifier's precision on non-English course names | Needs a small hand-labeled validation set; failure mode is benign (muted label, not a false conflict). |
| **New, kept open:** which client-side counter mechanism satisfies the four §1 metrics without accounts | Edge-worker aggregate counters vs. privacy-preserving client beacon — a build detail, doesn't change the product. |

---

*This file is the definitive product definition. docs/plan/ holds the panel working papers (perspectives, critiques, draft, five flow blueprints) as history and detail.*
