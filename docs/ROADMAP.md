# ROADMAP.md — from current build to PRODUCT.md

Re-sequenced 2026-07-24 for PRODUCT.md §0 (the mandate): the programme →
kull → weekly-schedule core ships FIRST, folding in the Phase-1 correctness
floor it depends on (lecture classification, catalog exams, version/hash
v2). The decide-loop (old Phase 4) is deferred behind an excellent §0 core.
Flow-level detail lives in docs/plan/flows/f1–f5.

## Phase §0 (NOW) — the mandate core

- PlanState v2 with course `source: "program" | "manual"` + `dropped` flag
  (programme courses gray out on drop, restore on tap; manual adds delete);
  version field; hash v2 encoding programme/kull/drops/extras with
  v1-compat parse.
- Lecture/øving classifier + lecture-only red conflicts; schedule shows
  lectures by default with one "vis øvinger og labber" toggle.
- Landing: programme typeahead + kull chips → straight to the schedule.
- Planner: schedule-first layout; course list with gray-out editing; add
  field; catalog-sourced exam section; null-aware active-only credits;
  pre-publish fallback; provenance line.

## What stands (assets, keep)

Ruteark design system + tokens/primitives; the plan store architecture
(needs v2 migration); the conflict-engine core (pairwise + week
intersection + dedupe — needs lecture classification); grid + exam-ribbon
renderers (ribbon needs a source swap); typeahead; crawler/worker/caching
pipeline; the browser-probe test rig; unit-test suite (96).

## Phase 1 — correctness floor (PRODUCT §11.1)

- **PlanState v2 + version threading (DR-4)**: `courses[].version` +
  `tier: committed|shortlist`; version in every API call; grade join =
  bare-prefix aggregation. Migrate stored v1 state in memory.
- **Hash grammar v2 frozen (D15)**: `#v2;26h;TDT4100.1,…;IT2805.1` with
  legacy-v1 parse. No un-versioned segments ever again.
- **Lecture-only conflict engine (DR-1)**: keyword classifier on
  `name`/`title` (needs a small hand-labeled validation set — open question
  §13); hard red = lecture×lecture only; øving/lab = muted display label,
  never a clash; same-course sections never flag.
- **Catalog-sourced exam ribbon (DR-3)**: axis/gap math from catalog
  `ExamDate` (already in search-index), kont excluded by default; scraped
  exam text only enriches popovers; "dato ikke satt" lane.

## Phase 2 — honest surfaces (§11.2)

- **Provenance line (DR-8)** on every composed verdict: crawl date,
  "eksamensdato ikke publisert", "timeplan ikke publisert ennå".
- **Pre-publish as primary mode (DR-2)**: engine degrades to exam-clash +
  campus-spread; optional prior-year grid labeled non-authoritative; never
  a blank flagship.
- **Null-aware credits (DR-6, DR-10)**: "22,5 av 30 sp (+2 emner uten
  oppgitt sp)"; off-semester adds noticed and excluded from the total.

## Phase 3 — growth loop (§11.3)

- **Shared plan first-class (D1)**: static-tier first paint from hash +
  search index; unfurl title ("Kari deler en plan: 5 emner · 28,5 sp");
  merge/replace/keep three-way interstitial.
- **Plan strip** in Layout (suppressed on `/` and `/planlegger/`), with the
  continuation CTA ("… · Se på ukeplanen →").
- **Homepage rebuild (§5)**: verb-first H1, static red-ink proof fragment,
  one CTA, named share affordance. Kill the triptych.

## Phase 4 — decide-loop (§11.4)

- Shortlist tier UI: ghost blocks (hue outline, no credit), promote/demote,
  header shows "X av 30 sp · +Y sp under vurdering".
- Inline decision facts in choice-group rows: clash-vs-committed +
  assessment form + grade shape (D12: grades in decision cells ONLY —
  remove the browsable course-page presentation).
- **Swap delta sentence** on promotion — the product's core line.
- Clash-preview **before** add on `/emner/` rows and `/emne/[code]`
  (verdict line + CTA per flows/f4; five specified states).

## Phase 5 — IA + temporal chrome (§11.5)

- Nav = one pill (Planlegger); `/emner/` out of nav (footer/inline);
  **kill `/studier/` index** (absorb as `/emner/?type=studier`);
  `/emne/[code]` reframe per f4 (verdict above the fold, prose below).
- Temporal margin banner + `termContext()` + next-plannable-term rule
  (DR-9); return trigger in the shared artifact.
- Commit summary (copyable codes + "bekreft i Studentweb"); code-first
  paste entry (persona B); language/campus/assessment filters.
- Mobile day-agenda per f5; 44px targets.

## Phase 6 — SHOULD tier (§11.6)

Day-load strip + free-day sentence; plan-context line on `/emne/`;
bulk-add above prose; SR conflict summary; retning recursion + deadlines;
`publishedYears`/`periodNumber` gating. COULD items stay evidence-gated.

## Metrics wiring (open question §13)

Pick the counter mechanism (edge-worker aggregate counters) when Phase 3
lands — shares created/opened, fork funnel, deadline-window return rate,
preview engagements.
