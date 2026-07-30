# ntnu-page — Architecture Spec

A NTNU semester planner: pick a study programme + kull (or paste course
codes), see the merged weekly schedule, catch lecture collisions and exam
clustering, and share the result as a URL — before the registration deadline.
Built on the `ntnu-api` npm package and **Ruteark**, this repo's own design
system (`docs/DESIGN.md` — its named rules are binding: Data-Is-Mono,
Red-Is-Collision, Green-Means-Fits, Ruling-Marks-The-Plan, Ink-Before-Chrome).
StudyCompanion (`.sc-*`, serif) was inspiration only; nothing from it is
ported or referenced — this file used to say otherwise in two contradicting
places, which REVIEW.md T2 called out. Product definition lives in
`docs/PRODUCT.md`; this file covers architecture and data contracts only.

Site language is **Norwegian** (labels, headings, prose), bokmål, sentence
case. Code, comments and identifiers are English.

## Topology

```
Astro static site (dist/)  ──served by──▶  Cloudflare Worker (Workers Assets)
                                              │
  nightly crawler ──▶ data/*.json             └─ /api/* ──▶ ntnu-api client
  (build-time input     public/data/*.json                  + TieredCache
   + runtime index)                                         (memory → KV)
```

- **Nightly crawl** (~20 upstream requests over two catalog years — see
  below): course catalog via `searchAll(year)` for the canonical year and
  `year - 1`, `programs.all()`, `semesters.all()`. Output is gitignored
  build-artifact JSON — consumed at build time (static pages) and at runtime
  (search index fetch), baked into each deploy, never committed. A
  `prebuild` guard (`crawler/ensure-data.mjs`) crawls automatically when the
  files are absent.
- **Live via Worker `/api/*`** (per-course/per-program, cached): course
  details, grade distributions, timetables, study plans. Only
  courses/programmes people actually view are fetched upstream.
- **e2e in CI (REVIEW.md T1)**: `.github/workflows/e2e.yml` runs the
  Playwright suite (`e2e/*.pw.ts`) against a real build + wrangler dev server
  on PRs touching `src/lib/planner/**`, `src/components/planner/**`,
  `worker/**`, plus a nightly schedule for live-data drift.
  `release.yml` runs it again directly before every deploy, so a tag push is
  gated regardless of which paths the tagged diff touched.
- Not yet wired: GitHub remote, Cloudflare deploy, KV namespace creation.
  Config carries commented placeholders + instructions.

## Repo layout & file ownership

| Path | Contents | Owner agent |
|---|---|---|
| `src/styles/` | the Ruteark system: tokens/base/primitives.css (owned here), `planner-week.css` (the week's geometry, shared by `/planlegger/` and `/emne/[code]/`) + generated fonts.css/fonts/ | design |
| `src/components/ThemeToggle.astro`, `Icon.astro`, `src/lib/{favicon,pageLifecycle}.ts` | shell components | shell |
| `src/layouts/Layout.astro`, `src/styles/site.css`, `src/pages/index.astro`, `src/pages/404.astro` | page shell — persistent nav (Planlegger + Emner + studieinfo chip, replacing the 2026-07-24 one-pill nav + plan strip; the interim plan-count link is deleted too, 665513f), footer, landing, 404 | shell |
| `src/pages/planlegger/index.astro`, `src/components/planner/*`, `src/lib/planner/*` | **the app** — see the architecture section below | planner |
| `src/pages/emner/index.astro`, `src/pages/emne/[code].astro`, `src/components/site/*` | catalog pages and islands (`/studier/*` deleted 2026-07-25, no replacement page) | pages |
| `crawler/crawl.mjs` (+ helpers), `data/*.json`, `public/data/search-index.json`, `.github/workflows/crawl.yml`, `tests/crawler.test.mjs` | crawler | crawler |
| `worker/src/*.ts`, `worker/tsconfig.json`, `tests/worker/*.test.ts` | API worker | worker |
| `e2e/*.pw.ts`, `playwright.config.ts` | browser suite: what only shows up after a ClientRouter navigation, and the four+ flagship flows against live data | docs/CI |
| `docs/*.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/e2e.yml`, `biome.json`, root `package.json` scripts | docs, CI, lint gate | docs/CI |
| root configs (`astro.config.mjs`, `wrangler.jsonc`, `tsconfig*.json`, `mise.toml`) | pre-written — edit only with clear need | — |

## `/planlegger/` architecture — the flagship surface

**Rebuilt 2026-07-25** (design spec `docs/plan/REWORK-2026-07-25-design.md`,
recorded as PRODUCT.md's §0 addendum). Reading order for a change:

```
store.ts        the plan's shape + persistence + the unversioned hash grammar
   │
data.ts         fetch + shape: search-index rows, per-course bundles,
   │             indexForSemester() (the exam-window filter)
   │
programPlan.ts  study-plan resolution: resolvePeriodFor() is the one
   │             entry point (the studieinfo modal and the planner both
   │             call it — they must never diverge on how a period resolves)
   │
layout.ts       pure day-column layout engine (clusters, columns, piling)
   │             — consumed by grid.ts, no DOM
groups.ts       pure group/parallel selection engine — consumed by grid.ts
   │             and popover.ts, no DOM
examSchedule.ts pure exam-list model (sort, gaps, tight flag, countdown)
   │             — consumed by examList.ts, no DOM
   │
grid.ts / examList.ts / studieinfo.ts / popover.ts / addCourse.ts
   │             DOM renderers/dialogs: the week grid, the exam date list,
   │             the studieinfo modal, the block popover, the add-course
   │             search modal
   │
plannerApp.ts    orchestration: owns the DOM ids in planlegger/index.astro,
                  wires store → data → programPlan → the renderers, and is
                  the one place a `<script>` module talks to `document`
```

- **`store.ts`** — `PlanState` (`semesterId`, `courses[]` with
  `source: "program" | "manual"` + `dropped` + `credits` + `groups?: string[]`,
  optional `program: { code, name, cohort, direction? }`). Storage is split
  three ways: `np:profile` (the programme choice, global, survives a
  semester switch), `np:plans` (the course list, keyed per `semesterId` — a
  manual add in one semester never leaks into another), `np:lastSemester`
  (session restore). `removeProgram()` clears the profile and drops
  programme-sourced courses in the *active* semester's plan while keeping
  manual adds (a programme course in another semester's stored plan is not
  pruned — known-minor, see ROADMAP.md). `onPlanChange(cb)` fires on
  storage events, the custom `ntnu:plan-change` event, and the page's own
  writes, so the persistent nav's studieinfo chip and every page that reads
  the plan stay live without polling.
  **Hash grammar — unversioned, no compat parse** (per the 2026-07-25
  mandate: "no versioning/compat apparatus, delete old code outright"; see
  PRODUCT.md §7's suspension note for why a versioned grammar existed
  before and why that requirement is now suspended):
  `#<semesterId>;<programme>;<courses>` — three `;`-separated segments,
  every field `encodeURIComponent`-escaped so `Ø`/`Å`/`Æ` and the grammar's
  own `.`/`-`/`+`/`~` survive the round trip (REVIEW.md B10). `programme` is
  `-` (none) or `code[.cohort[.direction]]`, `cohort` gated to a plausible
  4-digit year or the whole segment is rejected. `courses` is a comma list
  of `[-|+]code[.version][~groupKey…]`: `-` = dropped programme course,
  `+` = manual add, bare = active programme course; a version equal to the
  default (`"1"`) is omitted; each trailing `~groupKey` is a selected
  parallel/øving group for that course (repeatable — a course can carry
  both a lecture parallel and an øving group pick). Malformed course tokens
  are dropped rather than failing the whole parse. `parsePlanHash`/
  `formatPlanHash` live here; `hashchange` is listened for so a pasted link
  updates an already-open tab. **No legacy/versioned hash is read any
  more** — an old `#v2;…` link (or any hash with a version token) simply
  fails to parse `semesterId` and is treated as absent, by design.
- **`data.ts`** — `PlannerIndex`/`PlannerIndexCourse` (the typed shape of
  `search-index.json`, six-element tuple — see below), `fetchCourseBundle`,
  `indexForSemester(index, semesterId, window?)` — narrows every row's exams
  to one semester's season *and* `fromDate…examFinalDate` window before
  anything renders them (REVIEW.md C3: a carried-over course's only exam date
  can be last year's).

  **The honest-fetch contract (rewritten 2026-07-27, audit A1/pd-*) — this is
  the layer PRODUCT §1's moat is built on, so it is spelled out rather than
  left to the code:**
  - `TimetableOutcome` is the authority on the week's verdict:
    `{kind:"entries",count}` | `{kind:"empty"}` | `{kind:"failed",reason,message}`,
    plus `{kind:"pending"}` in the wider `CourseFetchState`. **"came back
    empty" and "we could not ask" must never collapse into "no blocks
    drawn"** — that is precisely how a failed fetch used to render as "ingen
    kollisjoner". Read `timetableOutcomeOf(bundle)` or
    `courseFetchState(code)`; never `bundle.timetable?.length`.
    `bundleFromEntries()` builds the same guarantees for a hand-made bundle
    (`courseTimetable.ts`), and a semester-narrowed clone keeps the *fetch's*
    outcome so "fetched 12 entries, none this semester" stays distinct from
    "fetch failed".
  - **No upstream English ever leaves this module** (pd-9). Every rejection is
    a `FetchFailureError` with a classified `reason`
    (`not-found`/`invalid`/`rate-limited`/`server`/`network`/`timeout`/`unknown`),
    a `source` (`ntnu` | `site` — a failed download of our *own*
    `search-index.json` must not be reported as "NTNU svarte ikke"), and a
    ready Norwegian `message` from `failureMessage()`. The raw worker/browser
    string survives as `.detail`, for `console.debug` only. A consumer that
    prints `err.message` blindly still renders bokmål.
  - **Memoisation is per part, and failures are never cached.** Bundles are memoised
    per `code:year:version`; *details* have their own memo keyed by **code
    alone**, because `/api/course/:code` carries neither year nor version and
    re-fetching byte-identical data on every semester switch was pd-8. A
    bundle carrying any failure is **dropped from the memo as it settles**
    (pd-5) — the module outlives every ClientRouter navigation, so memoising a
    transient blip made it permanent for the session; in-flight dedup is
    unaffected. `loadPlannerIndex()`'s rejection is not memoised either
    (pd-3). `clearCourseBundleMemo()` is what "Prøv igjen" calls.
  - Every request carries the caller's `onPage` signal combined with a
    `FETCH_TIMEOUT_MS` (15 s) cap, so one stalled socket cannot hang the page
    (pd-4).
- **`programPlan.ts`** — `findProgramPlan` (memoised per `code:year`, three-
  year step-back on 404, `encodeURIComponent`s the code so `MTIØT`/`ÅSOS`
  reach the worker), `classifyPeriod` (obligatory vs. gated-by-studieretning
  vs. elective-pool), `resolvePeriodFor(plan, semesterId, cohort,
  direction?)` — the one function that turns a fetched study plan into "this
  semester's courses, or the question that has to be answered first". The
  studieinfo modal and the planner page both call it; nothing else
  re-implements period resolution.
- **`layout.ts`** — `layoutDay(items, maxColumns = MAX_COLUMNS) →
  LayoutSlot[]`, pure and dependency-free: greedy calendar-column packing into
  overlap clusters. `MAX_COLUMNS = 2` is a **default, not a constant** — the
  cap is a viewport question (below 40rem a day column is ~56 px, so grid.ts
  passes 1 and a 2-deep cluster piles instead of splitting into 27 px
  slivers). A cluster needing more than the cap is **not split at all**:
  every member comes back `piled: true` and the grid draws the whole cluster
  as ONE block naming each session (code + start–end time). **There is no
  "+N til" overflow chip and no `overflow` flag any more** — the chip named a
  count the student could not act on, and three columns in a ~106 px weekday
  is ~35 px per block, at which width a course code broke one character per
  line (audit grid-3/grid-7). `LayoutSlot.cluster` is also the renderer's
  partition, so "what overlaps what" has exactly one implementation.
- **`groups.ts`** — `groupKey(name)` (slug, never contains `~` — load-
  bearing for the hash grammar above), `groupOptions(entries)`,
  `defaultLectureKeys(entries, programCode?)` (the programme's own lecture
  parallel, or parallel 1 with a "1 av N" badge when no programme mapping
  exists), `applyGroupSelection(entries, selectedKeys)` — narrows a
  course's rendered entries to its selected group set; øving/lab entries
  are never defaulted away, only narrowed once a group is picked.
- **`examSchedule.ts`** — `buildExamList(exams, todayIso) → ExamListModel`,
  pure date math (`Date.UTC` day-differencing, no `Date.parse`, locale/
  timezone-independent): sorts dated exams chronologically, annotates
  `gapToNext`/`tight`/`sameDay`, sets `daysFromToday` on the first upcoming
  exam only, keeps dateless exams in a separate bucket.
- **`grid.ts`** — `renderGrid(frame, notesHost, courses, showOthers,
  options?) → GridRenderResult` (`conflictCount` = grouped collision slots,
  `conflictPairCount`, `mutedLayerAutoRevealed`, `blockCount`, `state`, plus
  the two honesty fields wave 2 added: `incompleteCourses[]` — courses whose
  timetable we could not get, as opposed to courses NTNU publishes nothing
  for — and `partial`, which means "these counts are a floor, do not print a
  clean verdict"), plus `renderGridMessage(frame, notesHost, message?)` for
  every non-grid state (loading, empty, pending-choice) so a message never
  renders inside the week's own frame as though it were a plan (DESIGN's
  Ruling-Marks-The-Plan). Shared by `/planlegger/` (the full week) and
  `/emne/[code]/` (a single-course read-only week) — one renderer, not two.
  `GridRenderOptions.onBlockClick` hands a clicked block's or pile's
  `BlockDetail` to the block popover.
- **`examList.ts`** — `renderExamList(frame, listHost, courses, semesterId,
  index, options?) → ExamRenderResult` and `renderExamMessage(...)`,
  rendering `examSchedule.ts`'s `ExamListModel` as a chronological
  `.exam-row`/`.exam-gap` list with a summary kicker line — **replaces the
  deleted `examRibbon.ts`**. Reads an already `indexForSemester`-narrowed
  index so a stale exam date cannot reach it.
- **`studieinfo.ts`** — `mountStudieinfo(deps, signal) → StudieinfoHandle`,
  `publishMonthFor(semesterId)`. Opened through the handle alone, from
  `/planlegger/` alone: `#planner-edit-plan` ("Endre") plus the contextual
  empty-state and studieretning openers. The `OPEN_STUDIEINFO_EVENT` window
  event, its `studieinfoEvent.ts` leaf module, the `?studieinfo` query param
  and `Layout.astro`'s topbar chip that used all three are **deleted**
  (2026-07-30, owner's call). **The only surface that picks
  programme/kull/retning/semester** — the deleted homepage picker and
  planner inline picker are gone. Absorbed `/studier/[code]/`'s "Bruk som
  planen min" import semantics: Lagre calls `setProgramPlan`, preserving
  manual adds/drops and (since Task 10/12) course `groups`.
- **`popover.ts`** — `mountBlockPopover(store, signal) → BlockPopoverHandle`,
  one shared non-modal `<dialog>` (`show()`, not `showModal()`, so the grid
  stays interactive behind it) for a clicked block or pile: facts,
  a group picker sourced from `groups.ts` (radios only where the options
  really are mutually exclusive parallels; complementary weekly sessions are
  additive checkboxes — audit week-1) that calls `store.setCourseGroups`
  immediately, and dropp/fjern/gå-til-emneside actions. A pile spanning more
  than one course gets `kind: "info"` — its `detail.code` is the codes joined
  `" · "` (plannerApp keys off that separator), so it shows facts plus one
  course-page link per code, with no group section and no course action.
- **`addCourse.ts`** — `mountAddCourse(deps, signal) → AddCourseHandle`, a
  search `<dialog>` over the whole catalog **replacing the inline
  `planner-add-*` typeahead**: search field (ranked through
  `src/components/site/catalogSearch.ts`, the same ranking `/emner/` uses —
  not a second unranked filter), result rows with a lazy section-aware clash
  preview (the same path `planClash.ts` uses — kills the S7 false-positive),
  and the dialog stays open for multiple adds. **One persistent action button
  per row, four verbs** (`addCourseRowControl`, a pure derive+dispatch over
  the store): "Legg til" / "Fjern" (manual add) / "Dropp" / "Legg tilbake"
  (programme course — reversible, DESIGN §7), beside a state span reading
  "I planen" / "fra programmet" / "droppet". The class name
  `.add-course-add` survived as a *hook*, not a description; `.add-course-remove`
  no longer exists. A **not-taught row gets no add control at all**, only
  `ikke undervist i {year}` — it deliberately does *not* say "kun eksamen",
  which the six-element index tuple has no field to support (audit copy-3):
  of the 703 rows excluding the catalog year, 203 record `examOnly: false`.
  Saying it would need `examOnly` appended to the tuple first (append-only,
  per the crawled-data contracts below). `deps` is mutated in place by
  plannerApp rather than re-mounted, and `deps.indexFailed` is what turns the
  permanent "Henter emner …" into "Fikk ikke hentet emnekatalogen." (pd-3).
- **`plannerApp.ts`** — the only file that queries `document`. Wires
  everything above to the DOM ids declared in `planlegger/index.astro`
  (`#planner-title`, `#planner-context-line`, `#planner-direction*`,
  `#planner-grid-frame`, `#planner-exam-frame`, `#planner-course-rows`,
  `#planner-semester*` — grep the page for the full contract rather than
  duplicating it here, it drifts fast; the old `#planner-add-*` inline
  typeahead ids are gone with the typeahead itself). Mounted via `onPage()`
  per the ClientRouter rule (CLAUDE.md).
- **`src/components/site/planClash.ts`** — the same lecture-conflict engine
  (`lib/planner/conflicts.ts`) reused as a plan-aware clash preview on
  `/emner/` result rows, `/emne/[code]/`'s add CTA, and (2026-07-25)
  `addCourse.ts`'s result rows — all three now share one section-aware
  path, computed lazily (first hover/focus, not eagerly for every row).

**Deleted 2026-07-25, no replacement:** `examRibbon.ts` (→ `examList.ts` +
`examSchedule.ts`), `src/components/site/studyPlan.ts` (→ `studieinfo.ts` +
the planner's "Fra studieplanen" panel), `src/lib/planner/programUrl.ts`
(→ moot, nothing links to `/studier/*` any more), the sitewide plan-strip
component (→ the persistent nav's studieinfo chip, `Layout.astro` — and its
interim replacement, the `#plan-count-link` bar, is deleted too, 665513f),
and every legacy/versioned hash-parsing branch in `store.ts`.

## Design-system usage (all UI work)

- Load order in `<head>`: `fonts.css` → `tokens.css` → `base.css` →
  `primitives.css` → `site.css` (+ `planner-week.css` on pages that render a
  week). Import via Astro frontmatter in Layout.astro (or the page, for
  `planner-week.css`) only. The accent is defined in tokens.css (Flexoki
  green) — no inline accent vars on `<html>`.
- No-flash theme init: inline `is:inline` head script reading
  `localStorage["np:theme"]` falling back to `prefers-color-scheme`, setting
  `data-theme="dark"` on `<html>` before paint. ThemeToggle gets
  `storageKey="np:theme"`. Include `<ClientRouter />` from `astro:transitions`
  (ThemeToggle's `onPage` needs `astro:page-load`, and Layout re-applies
  `data-theme` on `astro:after-swap` — `swapRootAttributes()` wipes it
  otherwise, see CLAUDE.md).
- Use ONLY tokens.css custom properties and `.np-*` primitives (inventory in
  DESIGN.md §5). Never hardcode colors, never pure #000/#fff, no borders on
  interactive controls, and honor the named rules: Data-Is-Mono,
  Red-Is-Collision, Green-Means-Fits, Ruling-Marks-The-Plan,
  Ink-Before-Chrome.
- Fonts are vendored as **variable files** (`scripts/fetch-fonts.mjs`):
  4 `.woff2` files (Schibsted Grotesk + Spline Sans Mono, `latin` +
  `latin-ext`), each declaring a `font-weight: <min> <max>` range rather than
  one `@font-face` per static weight — see DESIGN.md §3 and CLAUDE.md.
- Brand: wordmark **"Semesterplan"** (grotesk 700) with a small mono "NTNU"
  suffix in `--muted`; favicon = the Ruteark mark (a 2×2 ruled square with
  one cell filled `--accent` green) as an inline SVG data URI from
  `src/lib/favicon.ts`.
- Shell (`site.css` + `Layout.astro`): sticky topbar (wordmark left;
  **persistent nav, rebuilt 2026-07-25** — `.np-navlink`s for "Planlegger"
  and "Emner", both always present, `aria-current` computed from an
  explicit per-item `sections` list, not `path.startsWith`; a studieinfo
  chip showing `MTDT · 2024 · Høst 2026` (or "Velg studieprogram") that
  opens the studieinfo modal on `/planlegger/` and navigates + opens it
  elsewhere; ThemeToggle right) — **no sitewide plan bar of any kind**: the
  `#plan-strip` was deleted 2026-07-25 and the `#plan-count-link` that
  replaced it 2026-07-27 (665513f), the chip carries the whole cross-page
  affordance and re-adding a bar is a regression, not a feature —
  content column (`--maxw` for data pages via Layout's `wide` prop,
  `--measure` otherwise), and a footer that only states provenance ("Data
  hentet {crawlDate} fra NTNU · uoffisiell, med forbehold om feil" — no link;
  the catalog is one of the two nav destinations, so a third route to it in
  the footer was chrome, REWORK-2026-07-30d) — `/studier/` is gone outright, not
  demoted (PRODUCT.md §4 addendum, §0 addendum point 6; supersedes REVIEW.md
  I1/I5's "one pill, footer-demoted" description).

## Crawled data contracts (crawler writes, pages read)

`data/catalog.json` — **two catalog years unioned**, newest canonical
(REVIEW.md C1: a course absent from this year's catalog but present last
year, e.g. TMA4100, must still get a page):
```jsonc
{
  "year": 2026,                    // canonical (newest) crawled year
  "years": [2026, 2025],           // every crawled year, newest first
  "crawledAt": "2026-07-24T12:00:00Z",
  "courses": [{
    "code": "TDT4100", "name": "Objektorientert programmering",
    "url": null, "version": "1", "location": "Trondheim",
    "examOnly": false,
    "exams": [{ "season": "AUTUMN", "date": "2026-12-05", "continuation": false }],
    "offeredYears": [2026, 2025]   // subset of `years`, newest first, never empty
  }]                                // deduped by code, sorted by code
}
```
`data/programs.json`: `{ "crawledAt", "programs": StudyProgramSummary[] }`
(full objects from `client.programs.all()`, sorted by code).
`data/semesters.json`: `{ "crawledAt", "current": Semester | null, "semesters": Semester[] }`.

`public/data/search-index.json` (runtime-fetched by the search island and
the planner's add field; compact positional tuples — **no existing position
was renumbered when this grew**):
```jsonc
{
  "year": 2026,
  "courses": [
    // [code, name, location, exams, version, offeredYears]
    ["TDT4100", "Objektorientert programmering", "Trondheim", [["AUTUMN","2026-12-05"]], "1", [2026, 2025]],
    ["TMA4100", "Matematikk 1", "Trondheim", [["AUTUMN","2025-11-19"]], "1", [2025]]
  ]
}
```
`exams` is `[[season, dateOrNull], ...]` — **every published sitting, ordinary
and deferred alike.** `transform.mjs` does filter `!exam.continuation`, but
that filter is a no-op against today's upstream: **0 of 2 438 exam rows in
`data/catalog.json` carry the flag**, and the catalog search portlet returns
`continuation: false` for the same sitting `/api/course/:code` labels
`occasion: "Utsatt eksamen"` (audit exams-1, measured 2026-07-27 on
HBIOT2030/MGLU1106/ENG1102). This line used to claim "ordinary (non-`kont`)
exams only" and that claim was false. **The kont filter lives in the
consumer**, `src/components/planner/examList.ts`
(`collectExamInputs`/`isDeferredOn`/`isDeferredOccasion`, and the same
predicate again in `src/components/site/gradeChart.ts`): it needs BOTH this
index's structured ISO `date` and `/api/course/:code`'s `occasion`, joins them
on the exact date, and reads `occasion` as a label only (PRODUCT.md DR-3). It
is fail-open. Do not "fix" this in the crawler — the flag it would filter on
is never set.
`version` (element 4) is the catalog course version to thread into
`/api/course/:code/timetable?year=&version=` — 293 of 5 470 rows are not
`"1"` (DR-4). `offeredYears` (element 5) is the same field as
`catalog.json`'s per-course `offeredYears`; a row whose `offeredYears`
excludes `year` is not taught in the canonical year and its name/location/
exams/version all come from the newest year it *was* offered — render that
honestly ("ikke undervist i 2026 · sist undervist 2025"), never as a current
course with a mysteriously empty week.

Crawler: `node crawler/crawl.mjs [--year 2026]` — plain ESM JS (no TS build),
imports `ntnu-api`. Default year = `semesters.current()`'s `year`. Crawls the
canonical year and `year - 1` (~20 requests total at the existing 500 ms
gap — a `searchAll` pass per year, `programs.all()`, `semesters.all()`); if
either catalog pass fails the whole crawl fails (exit 1) — a half-crawl that
looks complete is worse than a red build. Writes all four files atomically
(tmp + rename), pretty-printed except search-index (minified). Pure
transform functions live in `crawler/transform.mjs` and are unit-tested with
small fixture objects (no network in tests). The crawl also sanity-checks its
own output against floors before writing, so a hollow catalog fails loudly
instead of being deployed nightly (audit crawler-2/crawler-5). **The contract
on this page is asserted against the real artifacts** by
`tests/artifacts.test.mjs` — row counts, the two-year union, `offeredYears`
descending, the six-element tuple with no position renumbered, and both code
grammars mirrored from `worker/src/routes.ts` (course *and* programme, the
crawler-1 split) — skipping cleanly when the gitignored artifacts are absent.

## Worker API contract

Base: same origin as the site. **GET/HEAD only** — anything else is
`405 {"error":"Method not allowed"}` with `Allow: GET, HEAD` (before this,
a POST was served as a GET, body and all, marked publicly cacheable —
audit worker-7). JSON responses, `content-type: application/json;
charset=utf-8`. Course/programme codes may be percent-encoded in the path —
the worker `decodeURIComponent`s the segment before validating (REVIEW.md B1:
`MTIØT`, `ÅSOS`, `BØA1100` all 200 today; a malformed escape 400s with the
route's own message).

| Route | Upstream call | TTL | Notes |
|---|---|---|---|
| `GET /api/health` | none | — | `{"ok":true}` |
| `GET /api/course/:code?year=` | `courses.details(code, year?)` | 6h | 404 `{error}` if null |
| `GET /api/course/:code/grades` | `grades.distribution(code)` | 24h | `{rows: GradeRow[]}`, `[]` fine |
| `GET /api/course/:code/timetable?year=&version=` | `courses.timetable(code, year, version?)` | 1h | year required, 4-digit |
| `GET /api/program/:code/plan?year=` | `programs.studyPlan(code, year)` | 24h | cohort year required; 404 if null |

- `GET /api/course/:code/schedule?year=` was implemented, cached and tested
  but called by nothing — **deleted** (REVIEW.md C5e). It now falls through
  to the generic 404.
- Envelope: success = the payload object shown above; error = `{ "error":
  "<message>" }` with status. **Two code grammars, not one** (audit
  crawler-1/worker-1): course codes validate against `COURSE_CODE_RE =
  /^[A-ZÆØÅ0-9_-]{2,16}$/i`, programme codes against the wider
  `PROGRAM_CODE_RE = /^[A-ZÆØÅ0-9_+/-]{2,16}$/i` — 4 of the 403 codes in
  `data/programs.json` carry a literal `/` or `+` (`EMNE/HF`, `EMNE/SU`,
  `MSECT+OH`, `MSØK/5`) and used to 400 from our own validator while the UI
  blamed NTNU. `.` stays excluded in both, so no path-traversal shape can
  form. Both regexes run *after* decoding (uppercase before use). Years
  `/^\d{4}$/`, optional `?version=` `/^[A-Za-z0-9-]{1,8}$/` (a bound on the
  cache key, not a whitelist) → else 400.
- Error mapping: `NotFoundError`→404, `RateLimitError`→429 (+`Retry-After: 60`),
  other `NTNUAPIError`→502 with the **fixed body `{"error":"Upstream error"}`**
  — ntnu-api's own message can carry an internal NTNU Liferay portlet URL, so
  it is `console.warn`ed and never returned (audit sec-4/worker-2). Do not
  "improve" the 502 by echoing `err.message`. Non-NTNUAPIError bugs propagate
  (500).
- **Upstream throttle** (audit sec-5): a token bucket in `routes.ts`
  (`RateLimiter`, 120 burst / 15 per second, ≤5 000 tracked clients) keyed on
  `CF-Connecting-IP` — the only client identifier a Worker can trust. A token
  is spent **inside the handler, after the cache misses**, so it meters *our
  egress to NTNU* and never throttles a warm-cache visitor; exceeding it is
  our own `429` + `Retry-After`. Absent header (local `curl`, some test
  harnesses) ⇒ `server.ts` passes no `throttle` and nothing is metered, rather
  than bucketing every caller together where one abuser could deny everyone.
  This is politeness metering, not a DoS defence: 400s, 404s and cache hits
  cost no tokens.
- Caching: `TTLCache`/`TieredCache`/`KVCacheBinding` (ntnu-mcp pattern) —
  isolate memory in front of optional KV binding `CACHE` (`env.CACHE` may be
  undefined locally → memory-only). `TTLCache` deletes on an expired read and
  caps at `MAX_ENTRIES = 500` with insertion-order eviction (a `set` on an
  existing key deletes-then-sets so a refreshed hot key doesn't get evicted
  ahead of cold ones). Keys `JSON.stringify([kind, ...decodedUppercaseCode,
  ...params])` — so `MTIØT` and `MTI%C3%98T` share one cache entry, not two.
  KV prefix `v1:`. **A `null` details/plan result is cached as the sentinel
  `"missing"` under its own `["details-miss"|"plan-miss", …]` key with its own
  `MISS_CACHE_TTL_MS` = 10 min**, not the route's positive TTL (audit
  worker-3): `ntnu-api` returns `null` for an empty 200 too, so a transient
  blank response used to mean up to 24 h of "this cohort has no plan" — which
  the study-plan step-back then papers over by silently serving another
  cohort. KV writes via `ctx.waitUntil`. Response headers: `Cache-Control:
  public, max-age=<≤300>, s-maxage=<ttl/1000>` on success and on a 404 served
  from the miss sentinel (10 min); `no-store` on every other error.
- Entry (`worker/src/server.ts`): module-level `NTNUClient` + `TTLCache` +
  `RateLimiter` singletons (no options → library defaults); route on
  `url.pathname`; no router framework. `/api` **without** a trailing slash is
  part of the API surface too (it used to fall through and answer the HTML 404
  page where every sibling answered JSON — worker-7). Non-`/api` paths →
  `env.ASSETS.fetch(request)`; when ASSETS 404s, a `/emne/<code>/` path whose
  code is not already uppercase gets a `301` to the canonical casing
  (`canonicalCoursePath`, audit astro-7 — all 5 470 built pages are uppercase
  and have no case-insensitive collisions), preserving `url.search`.
  **Sitewide security headers** (`withSecurityHeaders`, applied to asset and
  JSON responses alike — the site sent none at all, audit sec-3): a CSP
  (`default-src 'self'`, `object-src`/`base-uri` `'none'`,
  `frame-ancestors 'none'`, `img-src 'self' data:`; `script-src`/`style-src`
  keep `'unsafe-inline'` — the hash form for Layout's single no-flash block is
  a documented upgrade, deliberately not shipped unverified, see the constant's
  comment), `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
  Route handlers live in `worker/src/routes.ts` as pure functions taking
  `{ client, cache, throttle? }` deps (ntnu-mcp pattern) so tests inject a fake
  fetch via `new NTNUClient({ fetch, sleep: async () => {} })` and a bare
  `TieredCache()`. The decode step lives in `routes.ts`'s `parseCode`, one
  place, rather than five separate try/catches in `server.ts`.
- Worker TS: `worker/tsconfig.json` with `types: ["@cloudflare/workers-types"]`;
  avoid Workers-only ambient types in shared files (structural
  `MinimalExecutionContext`, ntnu-mcp pattern).

## Pages

All pages use `Layout.astro` (props: `title`, `description`, optional
`wide: boolean`). Build-time data via `import catalog from "../../data/catalog.json"`
etc. Islands are **vanilla `<script>` modules** (no framework) fetching
relative `/api/...` URLs, mounted through `onPage()` (CLAUDE.md);
`astro.config.mjs` proxies `/api` → `http://localhost:8787` during
`astro dev`.

- **`/`** — **a landing page, rebuilt 2026-07-25** (§0 addendum point 11):
  kicker, verb-first `<h1>`, one small `.np-frame.np-ruled` proof fragment
  (a red-ink collision example) below the fold, one primary CTA ("Åpne
  planleggeren" → `/planlegger/`), and a resume line ("Planen din: N emner →
  gå til planleggeren") when a profile already exists. **The programme
  typeahead, kull chips and direction panel are deleted** — the studieinfo
  modal is now the only picker, opened from `/planlegger/`.
- **`/planlegger/`** — **the app**; see the architecture section above.
  Context line as the page's real `<h1>`; the week at `minmax(0,1fr) 20rem`
  against the course rail; verdict lines computed from `GridRenderResult`/
  `ExamRenderResult` and never discarded — **three states, not two**: clean
  (accent), "N kollisjoner" (clash red) and, since 2026-07-27, "kan ikke
  sjekkes — mangler timeplan for N emne(r)" in muted ink whenever
  `partial`/`incompleteCourses` says the counts are a floor; course rows with
  programme-course
  drop/restore and manual-add delete; **an "Legg til emne" button opening
  the add-course search modal** (`addCourse.ts`, replacing the old inline
  add field) with a plan-aware clash preview on every candidate row before
  commit; a "Bytt semester" disclosure rather than fold-weight chips; the
  studieinfo chip/`?studieinfo` param opens `studieinfo.ts` for
  programme/kull/retning/semester edits.
- **`/emner/`** — search as a mode, not a nav destination. Hidden until the
  visitor types a query or picks a studienivå/city chip ("skriv for å søke i
  N emner" otherwise); city facets are ~4 multi-select `.np-toggle--text`
  chips (not 8 raw comma-joined location strings); rows carry an add button
  with a clash preview. Matching and ranking live in
  `src/components/site/catalogSearch.ts` (extracted 2026-07-27, audit
  search-1, and shared with the planner's add dialog): exact code → code
  prefix → name-word prefix → substring, with both sides folded and tokenised
  so "TDT 4100" and "maskinlaering" match. The query round-trips through
  `?q=` (`history.replaceState`), so Back from a course page restores the
  results. A row whose `offeredYears` excludes the catalog year gets **no add
  button** — only its `/emne/` link (crawler-3). The "· se ukeplanen →" link
  this bullet used to describe is gone from both `/emner/` and `/emne/[code]/`
  (94b5d9a — the topbar chip already goes there).
- **`/emne/[code]/`** — `getStaticPaths` from the two-year-unioned
  `catalog.json` (~5 470 pages, up from ~4 767 — see C1 above). Order is the
  fork point first: code · name · campus → verdict CTA ("Legg til i planen",
  flipping to "Fjern fra planen"/"Dropp"/"Legg tilbake" against the stored
  plan with a `#emne-plan-state` span reading "I planen", plus a clash
  sentence in the reserved slot beneath it — the "se ukeplanen →" link is
  gone, the topbar chip already goes there) → the week for
  `offeredYears[0]`, narrowed to ONE semester (via `renderGrid`, the same
  renderer `/planlegger/` uses — `courseTimetable.ts` has no renderer of its
  own any more; its frame carries `data-static` so the shared block styling
  drops the click affordance no handler backs) → one exam block (catalog date
  as the headline, scraped form/duration/aid-code inside a `.np-summary`) →
  **Karakterer** → the 9-fact panel → all prose in one `.np-summary` ("Mer om
  emnet"). A course whose `offeredYears` excludes the catalog year gets **no
  add control at all**, only the sentence "Kan ikke legges til i planen …"
  (audit crawler-3, matching `addCourse.ts`). No year tabs (U14 — the worker
  doesn't actually vary by year for most courses, and three tabs implying a
  choice that isn't there was worse than one honest view).
  **Karakterer** (`#grades-section` + `src/components/site/gradeChart.ts`,
  shipped 2026-07-27) renders `/api/course/:code/grades` as season-split
  small multiples — one bar chart per sitting, newest first, `--hue-blue`
  only (F is deliberately not red — Red-Is-Collision), cohort `n` per chart,
  no bars under `MIN_CHART_CANDIDATES` = 10, one shared y-peak **per grade
  scale** so a pass/fail term cannot flatten the letter charts, and older
  terms behind a `<details>`. Deferred (utsatt/kont) sittings are **held out
  and named in a note**, never drawn as peer semesters. That filter is a
  **client-side join in `gradeChart.ts`**, not a crawler flag: it re-reads
  `/api/course/:code` (same URL `mountCourseDetails` uses, so it is a browser-
  cache hit) and classifies each sitting's season through `examList.ts`'s
  `isDeferredOccasion`. It is fail-open — no scrape, or an occasion we do not
  recognise, keeps every bucket — and carries a size guard
  (`DEFERRED_MAX_SHARE`) so a course that has moved term does not have its
  real cohorts relabelled. Do not try to "fix" this in `crawler/transform.mjs`;
  `continuation` is false on all 2 438 catalog exam rows (see the search-index
  note under "Crawled data contracts" above, and PRODUCT.md DR-3). This is a
  partial reversal of D12 — PRODUCT.md's D12 row records what the decision
  still forbids.
- **`/studier/[code]/` and `/studier/` — deleted outright, 2026-07-25, no
  redirects** (§0 addendum point 3; supersedes REVIEW.md I3/§12/PRODUCT.md
  D11's "sequence entrances before deletion" plan — the mandate deletes
  regardless, pre-launch breakage is acceptable). The template's surviving
  logic — current-period expansion, credit subtotal, DR-5's verbatim group
  prose, "Bruk som planen min" — moved into the studieinfo modal (kull
  relevance + plan fetch) and a collapsible "Fra studieplanen" panel in the
  planner's course rail.
- **404** — simplified 2026-07-25 (kills S9's stray `value="404"` search-box
  bug outright rather than patching it): both search forms are gone; the
  page states the reason, states the crawl date (DR-8), and offers exactly
  two honest ways back — "Åpne planleggeren" and "Til forsiden".

## Quality bar

`mise run check` (= lint + typecheck + test, server-free, excludes
`*.pw.ts` by design) and `npm run build` must pass. `mise run e2e` (browser
suite against live data) must pass — it now gates `release.yml` and runs in
CI on the paths named in `e2e.yml` (REVIEW.md T1). `biome check
--error-on-warnings` must exit 0 — `.astro` frontmatter's
`noUnusedImports`/`noUnusedVariables` false positives are disabled per-file
via `biome.json`'s `overrides`, not globally, so a real dead import
elsewhere still fails the gate (REVIEW.md T3). Tests: crawler transforms,
worker routes, and the planner's pure engines (fixture-driven, no network).
Norwegian UI copy, bokmål, sentence case, no exclamation marks, comma
decimals ("7,5 sp"). Keep dependencies at zero beyond what root
`package.json` already declares.
