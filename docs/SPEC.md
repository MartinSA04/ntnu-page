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
| `src/layouts/Layout.astro`, `src/styles/site.css`, `src/pages/index.astro`, `src/pages/404.astro` | page shell, nav/footer/plan strip, landing, 404 | shell |
| `src/pages/planlegger/index.astro`, `src/components/planner/*`, `src/lib/planner/*` | **the app** — see the architecture section below | planner |
| `src/pages/emner/index.astro`, `src/pages/emne/[code].astro`, `src/pages/studier/index.astro`, `src/pages/studier/[code].astro`, `src/components/site/*` | catalog + study-programme pages and islands | pages |
| `crawler/crawl.mjs` (+ helpers), `data/*.json`, `public/data/search-index.json`, `.github/workflows/crawl.yml`, `tests/crawler.test.mjs` | crawler | crawler |
| `worker/src/*.ts`, `worker/tsconfig.json`, `tests/worker/*.test.ts` | API worker | worker |
| `e2e/*.pw.ts`, `playwright.config.ts` | browser suite: what only shows up after a ClientRouter navigation, and the four+ flagship flows against live data | docs/CI |
| `docs/*.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `.github/workflows/e2e.yml`, `biome.json`, root `package.json` scripts | docs, CI, lint gate | docs/CI |
| root configs (`astro.config.mjs`, `wrangler.jsonc`, `tsconfig*.json`, `mise.toml`) | pre-written — edit only with clear need | — |

## `/planlegger/` architecture — the flagship surface

Five layers, each a thin, testable seam. Reading order for a change:

```
store.ts        the plan's shape + persistence + the hash grammar
   │
data.ts         fetch + shape: search-index rows, per-course bundles,
   │             indexForSemester() (the exam-window filter)
   │
programPlan.ts  study-plan resolution: resolvePeriodFor() is the one
   │             entry point (homepage picker and planner both call it —
   │             they must never diverge on how a period resolves)
   │
grid.ts / examRibbon.ts   pure(ish) renderers: DOM in, DOM out, given a
   │                       PlanCourseState[] and a semester id
   │
plannerApp.ts    orchestration: owns the DOM ids in planlegger/index.astro,
                  wires store → data → programPlan → the renderers, and is
                  the one place a `<script>` module talks to `document`
```

- **`store.ts`** — `PlanState` (v2: `semesterId`, `courses[]` with
  `source: "program" | "manual"` + `dropped` + `credits`, optional
  `program: { code, name, cohort, direction? }`). LocalStorage key
  `ntnu:plan:v1` (the key name predates the v2 hash grammar and is
  unrelated to it — do not read anything into the "v1" here).
  `onPlanChange(cb)` fires on storage events, the custom `ntnu:plan-change`
  event, and the page's own writes, so the sitewide plan strip
  (`Layout.astro`) and every page that reads the plan stay live without
  polling.
  **Hash grammar (frozen, v2 — see PRODUCT.md §7 for the full grammar and
  why it differs from the version that file used to freeze):**
  `#v2;<semesterId>;<programme>;<courses>`, every field
  `encodeURIComponent`-escaped so `Ø`/`Å`/`Æ` and the grammar's own `.`/`-`/`+`
  survive the round trip (REVIEW.md B10). A legacy unversioned
  `#<semesterId>;<codes>` hash is still read (all courses `source:"manual"`)
  but never written. `parsePlanHash`/`formatPlanHash` live here;
  `hashchange` is listened for so a pasted link updates an already-open tab.
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
  homepage picker and the planner page both call it; nothing else
  re-implements period resolution.
- **`grid.ts`** — `renderGrid(frame, notesHost, courses, showOthers,
  options?) → GridRenderResult` (`conflictCount` = grouped collision slots,
  `mutedLayerAutoRevealed`, `blockCount`, `state`, `partial`), plus
  `renderGridMessage(frame, notesHost, message?)` for every non-grid state
  (loading, empty, pending-choice) so a message never renders inside a ruled
  frame it doesn't belong in (DESIGN's Ruling-Marks-The-Plan). Shared by
  `/planlegger/` (the full week) and `/emne/[code]/` (a single-course
  read-only week) — one renderer, not two.
- **`examRibbon.ts`** — `renderExamRibbon(frame, listHost, courses,
  semesterId, index, options?) → ExamRenderResult`, reading an already
  `indexForSemester`-narrowed index so a stale exam date cannot reach it.
- **`plannerApp.ts`** — the only file that queries `document`. Wires
  everything above to the DOM ids declared in `planlegger/index.astro`
  (`#planner-title`, `#planner-context-line`, `#planner-direction*`,
  `#planner-grid-frame`, `#planner-exam-frame`, `#planner-course-rows`,
  `#planner-add-*`, `#planner-semester*` — grep the page for the full
  contract rather than duplicating it here, it drifts fast). Mounted via
  `onPage()` per the ClientRouter rule (CLAUDE.md).
- **`src/components/site/planClash.ts`** — the same lecture-conflict engine
  (`lib/planner/conflicts.ts`) reused as a plan-aware clash preview on
  `/emner/` result rows and `/emne/[code]/`'s add CTA, computed lazily
  (first hover/focus, not eagerly for every row).

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
- Shell (`site.css` + `Layout.astro`): sticky topbar (wordmark left; **one**
  `.np-navlink` — "Planlegger" — with `aria-current` computed from an
  explicit per-item `sections` list, not `path.startsWith`; ThemeToggle
  right), a sitewide `#plan-strip` (hidden on `/` and `/planlegger/`, shown
  whenever the stored plan has active courses, "Se på ukeplanen →"), content
  column (`--maxw` for data pages via Layout's `wide` prop, `--measure`
  otherwise), and a footer link row ("Søk i emner · Studieprogram · Data
  hentet {crawlDate} fra NTNU · uoffisiell") — `/emner/` and `/studier/` are
  demoted to this row, not the nav (PRODUCT.md §4, REVIEW.md I1/I5).

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

- **`/`** — dispatcher. Autofocused programme typeahead (`studyLevel` +
  `cities` on every row so e.g. MIDT and MTDT don't collide), kull chips
  filtered to cohorts whose computed period actually exists, the
  studieretning/campus question asked inline before navigating when one
  exists, a resume line when a plan already exists, and one small
  `.np-frame.np-ruled` proof fragment (a red-ink collision) below the fold.
- **`/planlegger/`** — **the app**; see the architecture section above.
  Context line as the page's real `<h1>`; the week at `minmax(0,1fr) 20rem`
  against the course rail; verdict lines computed from `GridRenderResult`/
  `ExamRenderResult` and never discarded; course rows with programme-course
  drop/restore and manual-add delete; an add field scoped to the study plan
  or all of NTNU, with a plan-aware clash preview on every candidate row
  before commit; a "Bytt semester" disclosure rather than fold-weight chips.
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
- **`/studier/[code]/`** — the browsable **template**, not a second plan
  owner: current period expanded with a credit subtotal and DR-5's verbatim
  group/waypoint prose, next period collapsed, "Bruk som planen min" (gated
  off while the period is direction-gated — never commits courses the
  student was never shown). No per-course "+" buttons (DR-10: adding into a
  semester you are not planning is a bug factory). The context line on
  `/planlegger/` links back here.
- **`/studier/`** — the plain programme index. **Marked for removal
  (REVIEW.md I3/§12, PRODUCT.md D11)**, but not yet deleted: it is currently
  the only link to `/studier/[code]/` anywhere in the codebase, and the
  entrances (`/planlegger/`'s context line, `/emne/[code]/` where relevant)
  have to land and be verified live before this page can go without
  orphaning ~400 static pages. Do not add new features here; do not delete
  it in the same change that adds an entrance — sequence them.
- **404** — recovers intent from the failed path (`/emne/TMA4100/` →
  "Vi fant ikke emnet TMA4100" + the search field prefilled from the code),
  falls back to the programme field otherwise, states the crawl date (DR-8).

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
