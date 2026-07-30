# ROADMAP.md — from current build to PRODUCT.md

**Rewritten 2026-07-24** against `docs/REVIEW.md` (a full-site review of this
branch) rather than against the original Phase §0–6 plan: that plan predates
implementation and had drifted from what actually shipped and in what order.
Phases §0–2 below are now largely **done** — REVIEW.md's own "Wave 1" (make
the flagship flow correct and legible) and several Phase 5/6 items were
pulled forward alongside it, because REVIEW.md found they were load-bearing
for the same flow (one nav pill, the footer, the sitewide plan strip, DR-9's
next-plannable-term rule). What remains is mostly PRODUCT.md's Phase 3
growth loop and Phase 4 decide-loop, which have **not** been started.

Do not re-litigate what §10 of PRODUCT.md already decided against (compare
matrix, week-scrubber, personal fixed blocks, etc.) — this file only
sequences what's still MUST/SHOULD per PRODUCT.md §6.

## 2026-07-25 — the rework (shipped, active phase superseded)

A second user mandate landed the day after the section below was written
(full spec: `docs/plan/REWORK-2026-07-25-design.md`; recorded in PRODUCT.md
as the §0 addendum). It rebuilt several of the surfaces the 2026-07-24 pass
below shipped, so **read this section first** — where the two disagree,
this one is current. e2e: 18/18 green on the tree this shipped against.

- **Studieinfo modal** (`studieinfo.ts`) is now the *only* programme/kull/
  retning/semester picker: the homepage picker and the planner's inline
  picker are both deleted.
- **Unversioned hash grammar**, `#<semesterId>;<programme>;<courses>` with
  repeatable `~group` course suffixes; `np:plans` (semester-scoped course
  lists) + `np:profile` (global programme choice) + `removeProgram`; all
  legacy/versioned hash parsing deleted (no compat, per the mandate).
- **Calendar-engine grid** (`layout.ts` + `grid.ts`): side-by-side overlap
  clusters, group-filtered parallels (default = the programme's own,
  `groups.ts`), a block popover (`popover.ts`) with a group picker, and a
  "+N til" overflow chip for 4+-way clashes. *(The chip is gone as of the
  2026-07-27 audit fixes: the column cap is 2 (1 on a phone) and a deeper
  cluster collapses into one pile block that names every session in it — a
  count the student could not act on became a list they can. SPEC.md's
  `layout.ts` bullet.)*
- **Exam date list** (`examSchedule.ts` + `examList.ts`) with explicit gap
  lines, replacing the exam ribbon.
- **Persistent nav**: Planlegger + Emner + a studieinfo chip, identical on
  every page; the plan strip is deleted. *(A sitewide plan-count link shipped
  here too and was removed 2026-07-27, commit 665513f — it duplicated the chip
  one row below it. The chip alone carries the cross-page affordance;
  PRODUCT.md §4.)*
- **Add-course modal** (`addCourse.ts`); `planClash` is now
  programme-section-aware everywhere (kills the false-positive preview);
  `setProgramPlan` preserves group selections across re-derivation.
- **Four honest planner empty/fallback states**, including a real
  fetch-failure retry path; `/studier/*` (both surfaces) + `studyPlan.ts` +
  `programUrl.ts` deleted with no redirects; 404 simplified.
- **Homepage proof fragment** (`.home-proof`, commit 74cd6ff): built
  2026-07-27 after this file and PRODUCT.md §5 had both listed it as the one
  open MUST of §5 (audit pc-7), then **deleted 2026-07-30d**. A ruled panel
  showing two invented courses colliding is a picture of the product, not
  evidence about it, and the Nå card above it already shows the student's own
  week. Its removal took `.np-ruled` with it, which had no other caller.

**UX-STUDY.md folded in.** This rework subsumes S1–S4 (picker regression +
kull-chip dead-end — the modal + kull-relevance rule fix all four), S5 (the
parallel-groups unreadable-stack blocker — `groups.ts` + the grid rebuild),
S6 (the one-fallback-for-three-causes bug — the four honest states), S7
(the false-positive clash preview — shared section-aware path), S9 (the
sabotaged 404 search value), S10 (the ambiguous "X dager til neste" — the
gap-line exam list), S12 (grid-block truncation — full two-line blocks by
construction), S13 (the raw "Not found" row copy), and S15 (the mobile
scroll-hint typo). **S14 is moot**, not fixed: the homepage input it
described no longer exists (homepage is a landing). **Not touched by this
pass, still open**: S8 (`/emne/[code]/`'s self-contradicting semester
labels — the course page was explicitly left alone except the clash
rewire) and S11's dark-mode clash-text contrast figure (the light/dark
tint-parity half of S11 *is* fixed by the grid rebuild's "both-theme
tints").

**Known polish, deliberately deferred** (see
`.superpowers/sdd/REWORK-2026-07-25-plan/progress.md` for the full ledger):
`/emne/[code]/`'s read-only grid renders inert group-picker affordance
(cursor/click styling should be gated on whether a click handler is
actually wired); `removeProgram` prunes only the active semester's
`np:plans` entry, so a programme course can be orphaned in a *different*
semester's stored plan; and one e2e status-text regex (`/kollisjon/` in
`flows.pw.ts`) over-matches "ingen kollisjoner" and should tighten to
`/\d+ kollisjon/`.

## Shipped — the mandate core + correctness floor (was Phase §0–2)

*(2026-07-24, superseded in part by the rework above — the v2 hash grammar,
plan strip and single nav pill this section describes were replaced
2026-07-25; the rest — B1/B3/B6/B7/B9/C1/C2/C5, the a11y and design-system
items, the CI/docs hygiene — still stands as shipped.)*

The programme → kull → weekly-schedule flow now resolves correctly for the
large majority of programmes, against live data, with the collision engine,
exam ribbon and credit line all fixed:

- **PlanState v2** with `source: "program" | "manual"` + `dropped` flag
  (programme courses gray out on drop, restore on tap; manual adds delete
  outright); `version` and `credits` carried through; hash v2 with
  percent-encoding and v1-compat parse (see PRODUCT.md §7 — corrected from
  the grammar this file and PRODUCT.md originally froze, which the shipped
  parser never actually implemented).
- **Worker decodes percent-encoded path segments** before validating
  (REVIEW.md B1) — programme/course codes containing Æ/Ø/Å (MTIØT, ÅSOS,
  BØA1100, 58 programmes + 238 courses total) resolve instead of 400ing.
- **Lecture/øving classifier + lecture-only red conflicts**: schedule shows
  lectures by default with one "vis øvinger og labber" toggle; the toggle
  stays legible under real load (dedupe identical øving sessions, cap the
  split at 3 columns, collapse a 3+-way clash into one cell — REVIEW.md
  U1/U3); a plan with timetable entries but zero lecture-classified ones
  auto-reveals the muted layer instead of rendering a blank week (B7).
- **The studieretning/campus question is asked before the week renders
  empty**, both in the homepage picker and on `/planlegger/` itself, and an
  elective-only period (zero obligatory courses by design) gets the same
  "here's your question" treatment rather than a silent "0 av 30 sp"
  (B2/U7/U8). The pool of choosable courses is populated in the gated
  branch, not left empty.
- **Kull chips are filtered to cohorts whose computed period exists**
  (B3) instead of offering ~20 chips of which ~2 lead anywhere; `studyLevel`
  + `cities` are in the programme typeahead so same-named programmes don't
  collide (B6, e.g. MIDT vs. MTDT).
- **Switching semester re-derives the programme plan** rather than leaving
  the previous semester's courses on screen under a new green "30 av 30 sp"
  (B4); an empty `/planlegger/` opens the picker as the page's only content
  instead of pointing at a hidden picker and an unmounted add field (B5).
- **The credit line's four independent defects are fixed** (B9):
  study-plan credits are no longer discarded when the catalog lookup
  misses, off-semester courses are excluded from the total, an overload no
  longer reads as the same green as a full load, and a >30 sp prefill is
  surfaced rather than silently zeroed.
- **The exam ribbon is windowed to the planned semester** (`indexForSemester`
  — REVIEW.md C3), so a course carried over from last year's catalog can't
  show a stale exam date inside the current semester.
- **The two-year catalog union** (REVIEW.md C1): the crawler unions the
  canonical year and `year - 1`, so a course absent from this year's catalog
  but present last year (TMA4100 among 703 others) still gets a page and a
  search hit, honestly labeled "ikke undervist i {year} · sist undervist
  {lastYear}" rather than 404ing or looking like a live course with an
  empty week.
- **Version threading is correctness-complete** (DR-4/C2): the search index
  and every add path carry the catalog version, not a hardcoded `"1"` —
  293 of 5 470 courses need it.
- **The week is legible**: a real header row that survives an 08:00 block
  (U2), the rail/course-list width split that gives the week its due (D7),
  the mobile week no longer silently truncates Thursday/Friday (A4), the
  ruling is back in register with an hour landmark (D4).
- **The verdict line renders** from counts the renderers already computed
  and used to discard (U4/U5) — `#planner-grid-status`/`#planner-exam-status`
  now say "ingen kollisjoner" / "2 kollisjoner denne uka" instead of nothing.
- **The provenance line is composed from what actually happened this
  render** on `/planlegger/` (DR-8/U9) — not one build-time crawl date
  standing in for five different sources, three of them fetched live.
- **IA pulled forward from Phase 5**: one nav pill (Planlegger), `aria-current`
  computed from an explicit section map rather than a path prefix (I1), a
  footer link row demoting `/emner/`/`/studier/` (I5), the sitewide plan
  strip (I2, suppressed on `/` and `/planlegger/`), `/emne/[code]/` reordered
  around the verdict CTA with the grade chart removed and the timetable
  extracted to the shared `grid.ts` renderer (U10/U12/U13/U14, D12 — the
  figure **returned 2026-07-27**, season-split and constrained; see the
  Phase 4 note below and PRODUCT.md §6), a
  plan-aware clash preview on `/emner/` rows and `/emne/[code]/`'s add CTA
  (U11), `/studier/[code]/` reduced to current + next period with DR-5's
  verbatim group prose and no per-course "+" (U16/U17), city-level campus
  facets on `/emner/` replacing 8 raw location strings (U15), DR-9's
  next-plannable-term rule (unpublished semester chips carry their own note
  rather than trapping the student — U6).
- **Design system**: `.np-hint` for sentences vs. `.np-note` for mono
  fragments (D1), a real `<h1>` per page + a reconciled seven-step type scale
  (D2), the ruling's registration and hour rule (D4), empty ruled frames
  replaced with a message and no ruling (D5), the prose measure taken off
  data lists (D6), controls visible in dark mode via `--control-bg`/
  `--control-edge` (D8), course-hue washes de-intensified with a categorical
  clash-edge mark instead of a hatch (D9), `.np-toggle--text` for proper
  names (D10), the primitive layer reconciled — `.np-tag`/`.np-tag--sm`
  adopted, `.np-kbd`/`.np-tile`/`.np-lift` deleted, press states built into
  the primitives (D11), fonts re-vendored as four variable files
  (`font-weight` ranges, not twelve static faces) with two preloaded (D12).
- **Accessibility**: real `<h2>` region headings (A1), stable ids +
  `aria-activedescendant` + a `click` handler on all three comboboxes (A2),
  `/emner/` rows stop overlapping at 390px (A3), a skip link + `aria-live`
  on the four status regions + `prefers-reduced-motion` on the one scripted
  scroll (A5).
- **Hygiene sweep** (C5): the worker's TTL cache evicts instead of growing
  forever; grid block ids no longer collide when two entries share a
  `code-day-start`; a `JSON.stringify` inside a `<script>` tag is now
  escaped against a programme name containing `</script`; `findProgramPlan`
  is memoised so a kull pick or a drop/restore doesn't refetch the whole
  study plan; the unused `/api/course/:code/schedule` route is deleted.
- **Docs and CI (REVIEW.md T1/T2/T3, this pass)**: the e2e suite now runs in
  CI (`e2e.yml`, scoped to the planner/worker paths plus a nightly schedule)
  and gates `release.yml` directly; `biome.json` disables the two
  `.astro`-frontmatter false-positive rules per-file (not globally) and CI
  runs `biome check --error-on-warnings`, so a real dead import elsewhere
  can fail the gate again; `SPEC.md` documents the real named design rules,
  the `/planlegger/` architecture (store → data → programPlan → renderers →
  plannerApp), and the ownership rows that were missing; `PRODUCT.md` §7's
  hash grammar and D15 are corrected to what the code actually does;
  `package.json`'s version is bumped off the never-tagged `0.1.0`.

## Known-partial, from the same pass (see PRODUCT.md §6 for the full list)

A few MUST items shipped only in part; each is called out where it lives so
the next session doesn't have to re-derive it from a diff:

- **Pre-publish mode** is an informed choice (semester chips note when a
  term's timetable isn't published) rather than a dedicated primary layout
  (DR-2's fuller "grid degrades to exam-clash + campus-spread" treatment).
- **Provenance** covers `/planlegger/`; `/emne/[code]/` has none yet.
- **Shared-plan handoff** round-trips correctly (including non-ASCII
  direction codes) and applies a pasted link live via `hashchange` (B10);
  there is no static-tier unfurl title and no merge/replace/keep
  interstitial yet (those are Phase 3 below).

## Phase 3 — growth loop (not started)

- **Shared plan as a first-class object, the rest of it**: a real unfurl
  title computed from the hash + search index with no fetch ("Kari deler en
  plan: 5 emner · 28,5 sp · Høst 2026"), and the **merge/replace/keep**
  three-way interstitial for an incoming plan on top of an existing one
  (today an incoming hash simply applies, which is strictly better than the
  pre-B10 divergence but skips the interstitial PRODUCT.md §3.6 specifies).
- **Temporal margin banner** (`termContext()`, PRODUCT.md §3's
  flow-agnostic rule): "Oppmelding for Høst 2026 stenger ~15. sep · 24 dager
  igjen." Depends on knowing the registration deadline, which isn't in any
  crawled data source yet — resolve the data source before scheduling this.
- **Return trigger in the shared artifact** when `timetablePublished` or the
  exam window is about to flip.

## Phase 4 — decide-loop (not started)

Everything here depends on Phase 3's shortlist tier landing in the hash
first (PRODUCT.md §7's forward-compatibility note):

- Shortlist tier UI: ghost blocks, promote/demote, header shows
  "X av 30 sp · +Y sp under vurdering".
- Inline decision facts in choice-group rows: clash-vs-committed +
  assessment form + grade shape. *(D12 was partially reversed 2026-07-27,
  commit 94b5d9a: the season-split figure now ships on `/emne/[code]/` —
  the fork point is itself a decision context, PRODUCT.md §3 flow 4. This
  item is therefore the **remaining** half — the same shape inside a
  choice-group row — not a first build of the figure. What stays killed:
  sortable columns, cross-course leaderboards, hue-tinted bars, any derived
  difficulty score. Do not delete `#grades-section` as a regression.)*
- **Swap delta sentence** on promotion.
- Commit summary (copyable committed-code list + "bekreft i Studentweb").

## Phase 5 — remaining IA (small, mostly sequencing)

- ~~`/studier/` standalone index: not yet killed~~ — **done, 2026-07-25**:
  both `/studier/` surfaces are deleted outright, no redirects, no entrance
  sequencing needed (the user mandate overrode REVIEW.md I3's
  entrances-before-deletion rule — see 2026-07-25 rework section above).
- Code-first paste entry as persona B's on-ramp — **re-scoped, 2026-07-25**:
  the homepage no longer leads with the programme picker at all (it's a
  landing with one CTA), so this item is no longer "promote paste above the
  picker" but "does a cold Persona-B visitor need a paste entry point on the
  landing page at all, given the planner's own empty states already offer
  one" — open question, not yet decided.
- Language / assessment filters on `/emner/` (campus is done — U15).
- Mobile day-agenda restructure (A4's narrower fix — edge fade, scroll to
  today, a hint naming the clipped days — shipped in its place; the
  agenda view itself is still open).

## Phase 6 — SHOULD tier, evidence-gated COULD items

- Day-load strip + free-day sentence (persona C lens).
- Provenance line on `/emne/[code]/` (currently only on `/planlegger/`).
- ~~Bulk-add above prose on `/studier/[code]/`~~ — **moot, 2026-07-25**: the
  page is deleted; "Bruk som planen min" is now the studieinfo modal's
  Lagre action (a whole-period commit, same semantics).
- SR conflict summary; recursive retning render (`pending.deadlineDate` is
  already surfaced in the direction panel's note — the rest of the
  recursion is not).
- COULD items (`?mot=` deep-linked two-course view, par/odde single-cell
  rendering, English course names) stay evidence-gated per PRODUCT.md §6 —
  do not build ahead of a funnel signal.

## Metrics wiring (PRODUCT.md §13, still open)

Pick the counter mechanism (edge-worker aggregate counters is the leading
candidate) when Phase 3 lands — shares created/opened, fork funnel,
deadline-window return rate, preview engagements. No client-side analytics
exist today.
