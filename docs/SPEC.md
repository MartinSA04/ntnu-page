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
| `src/layouts/Layout.astro`, `src/styles/site.css`, `src/pages/index.astro`, `src/pages/404.astro` | page shell — persistent nav (Planlegger + Emner + studieinfo chip + plan-count link, replacing the 2026-07-24 one-pill nav + plan strip), footer, landing, 404 | shell |
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
layout.ts       pure day-column layout engine (clusters, columns, overflow)
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
  writes, so the persistent nav's studieinfo chip/count-link and every page
  that reads the plan stay live without polling.
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
  `search-index.json`, six-element tuple — see below), `fetchCourseBundle`
  (memoised per `code:year:version`), `indexForSemester(index, semesterId,
  window?)` — narrows every row's exams to one semester's season *and*
  `fromDate…examFinalDate` window before anything renders them (REVIEW.md
  C3: a carried-over course's only exam date can be last year's).
- **`programPlan.ts`** — `findProgramPlan` (memoised per `code:year`, three-
  year step-back on 404, `encodeURIComponent`s the code so `MTIØT`/`ÅSOS`
  reach the worker), `classifyPeriod` (obligatory vs. gated-by-studieretning
  vs. elective-pool), `resolvePeriodFor(plan, semesterId, cohort,
  direction?)` — the one function that turns a fetched study plan into "this
  semester's courses, or the question that has to be answered first". The
  studieinfo modal and the planner page both call it; nothing else
  re-implements period resolution.
- **`layout.ts`** — `layoutDay(items: LayoutInput[]) → LayoutSlot[]`, pure
  and dependency-free: greedy calendar-column packing into overlap
  clusters, `MAX_COLUMNS = 3`, entries beyond that marked `overflow: true`
  for the grid's "+N til" chip instead of ever-narrower slivers.
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
  `mutedLayerAutoRevealed`, `blockCount`, `state`, `partial`), plus
  `renderGridMessage(frame, notesHost, message?)` for every non-grid state
  (loading, empty, pending-choice) so a message never renders inside a ruled
  frame it doesn't belong in (DESIGN's Ruling-Marks-The-Plan). Shared by
  `/planlegger/` (the full week) and `/emne/[code]/` (a single-course
  read-only week) — one renderer, not two. `GridRenderOptions.onBlockClick`
  hands a clicked block/overflow chip's `BlockDetail` to the block popover.
- **`examList.ts`** — `renderExamList(frame, listHost, courses, semesterId,
  index, options?) → ExamRenderResult` and `renderExamMessage(...)`,
  rendering `examSchedule.ts`'s `ExamListModel` as a chronological
  `.exam-row`/`.exam-gap` list with a summary kicker line — **replaces the
  deleted `examRibbon.ts`**. Reads an already `indexForSemester`-narrowed
  index so a stale exam date cannot reach it.
- **`studieinfo.ts`** — `mountStudieinfo(deps, signal) → StudieinfoHandle`,
  `OPEN_STUDIEINFO_EVENT` (the event `Layout.astro`'s chip dispatches on
  `/planlegger/`, and the `?studieinfo` query param triggers elsewhere),
  `publishMonthFor(semesterId)`. **The only surface that picks
  programme/kull/retning/semester** — the deleted homepage picker and
  planner inline picker are gone. Absorbed `/studier/[code]/`'s "Bruk som
  planen min" import semantics: Lagre calls `setProgramPlan`, preserving
  manual adds/drops and (since Task 10/12) course `groups`.
- **`popover.ts`** — `mountBlockPopover(store, signal) → BlockPopoverHandle`,
  one shared non-modal `<dialog>` (`show()`, not `showModal()`, so the grid
  stays interactive behind it) for a clicked block or "+N til" chip: facts,
  a group picker (radio list sourced from `groups.ts`) that calls
  `store.setCourseGroups` immediately, and dropp/fjern/gå-til-emneside
  actions. A multi-course overflow chip gets `kind: "info"` — facts only,
  no group section, no course action.
- **`addCourse.ts`** — `mountAddCourse(deps, signal) → AddCourseHandle`, a
  search `<dialog>` over the whole catalog **replacing the inline
  `planner-add-*` typeahead**: search field, result rows with a lazy
  section-aware clash preview (the same path `planClash.ts` uses — kills
  the S7 false-positive), "Legg til" that flips to "Lagt til ✓" + "Fjern",
  dialog stays open for multiple adds.
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
component (→ the persistent nav's chip/count-link, `Layout.astro`), and
every legacy/versioned hash-parsing branch in `store.ts`.

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
  elsewhere; ThemeToggle right), a `#plan-count-link` (hidden on `/` and
  `/planlegger/`, shown whenever the stored plan has active courses, "N
  emner · X sp → ukeplanen" — **replaces the deleted sitewide `#plan-strip`**),
  content column (`--maxw` for data pages via Layout's `wide` prop,
  `--measure` otherwise), and a footer link row ("Søk i emner · Data hentet
  {crawlDate} fra NTNU · uoffisiell") — `/studier/` is gone outright, not
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
`exams` is `[[season, dateOrNull], ...]`, ordinary (non-`kont`) exams only.
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
small fixture objects (no network in tests).

## Worker API contract

Base: same origin as the site. All GET, JSON responses, `content-type:
application/json; charset=utf-8`. Course/programme codes may be percent-
encoded in the path — the worker `decodeURIComponent`s the segment before
validating (REVIEW.md B1: `MTIØT`, `ÅSOS`, `BØA1100` all 200 today; a
malformed escape 400s with the route's own message).

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
  "<message>" }` with status. Codes validated `/^[A-ZÆØÅ0-9_-]{2,16}$/i`
  *after* decoding (uppercase before use), years `/^\d{4}$/` → else 400.
- Error mapping: `NotFoundError`→404, `RateLimitError`→429 (+`Retry-After: 60`),
  other `NTNUAPIError`→502 `{error}`. Non-NTNUAPIError bugs propagate (500).
- Caching: `TTLCache`/`TieredCache`/`KVCacheBinding` (ntnu-mcp pattern) —
  isolate memory in front of optional KV binding `CACHE` (`env.CACHE` may be
  undefined locally → memory-only). `TTLCache` deletes on an expired read and
  caps at `MAX_ENTRIES = 500` with insertion-order eviction (a `set` on an
  existing key deletes-then-sets so a refreshed hot key doesn't get evicted
  ahead of cold ones). Keys `JSON.stringify([kind, ...decodedUppercaseCode,
  ...params])` — so `MTIØT` and `MTI%C3%98T` share one cache entry, not two.
  KV prefix `v1:`. Cache null details/plan as sentinel `"missing"`. KV writes
  via `ctx.waitUntil`. Response headers: `Cache-Control: public, max-age=300,
  s-maxage=<ttl/1000>` on success; `no-store` on errors.
- Entry (`worker/src/server.ts`): module-level `NTNUClient` + `TTLCache`
  singletons (no options → library defaults); route on `url.pathname`; no
  router framework. Non-`/api` paths → `env.ASSETS.fetch(request)`.
  Route handlers live in `worker/src/routes.ts` as pure functions taking
  `{ client, cache }` deps (ntnu-mcp pattern) so tests inject a fake fetch via
  `new NTNUClient({ fetch, sleep: async () => {} })` and a bare `TieredCache()`.
  The decode step lives in `routes.ts`'s `parseCode`, one place, rather than
  five separate try/catches in `server.ts`.
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
  `ExamRenderResult` and never discarded; course rows with programme-course
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
  with a clash preview and a "· se ukeplanen →" link once added.
- **`/emne/[code]/`** — `getStaticPaths` from the two-year-unioned
  `catalog.json` (~5 470 pages, up from ~4 767 — see C1 above). Order is the
  fork point first: code · name · campus → verdict CTA ("Legg til i planen",
  a "se ukeplanen →" link once added, a clash sentence in the reserved slot
  beneath it) → the week as a ruled grid for `offeredYears[0]` (via
  `renderGrid`, the same renderer `/planlegger/` uses — `courseTimetable.ts`
  has no renderer of its own any more) → one exam block (catalog date as the
  headline, scraped form/duration/aid-code inside a `.np-summary`) → the
  9-fact panel → all prose in one `.np-summary` ("Mer om emnet"). No grade
  chart (D12 — grades only ever return as a season-split shape inside a
  future decision cell, never a browsable chart); no year tabs (U14 — the
  worker doesn't actually vary by year for most courses, and three tabs
  implying a choice that isn't there was worse than one honest view).
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
