# ntnu-page — Architecture Spec

A public website for browsing NTNU course data (catalog, course details, grade
statistics, timetables, study programs), built on the `ntnu-api` npm package
and the StudyCompanion design system (see `docs/DESIGN.md` — its named rules
are binding: Mono-Marginalia, Structural-Border, Accent-Ink, Literal-Swatch).

Site language is **Norwegian** (labels, headings, prose). Code, comments and
identifiers are English.

## Topology

```
Astro static site (dist/)  ──served by──▶  Cloudflare Worker (Workers Assets)
                                              │
  nightly crawler ──▶ data/*.json             └─ /api/* ──▶ ntnu-api client
  (build-time input     public/data/*.json                  + TieredCache
   + runtime index)                                         (memory → KV)
```

- **Nightly crawl** (cheap bulk endpoints, ~10 upstream requests): course
  catalog via `searchAll(year)`, `programs.all()`, `semesters.all()`. Output is
  gitignored build-artifact JSON — consumed at build time (static pages) and at
  runtime (search index fetch), baked into each deploy, never committed. A
  `prebuild` guard (`crawler/ensure-data.mjs`) crawls automatically when the
  files are absent.
- **Live via Worker `/api/*`** (per-course/per-program, cached): course
  details, grade distributions, timetables, schedules, study plans. Only
  courses people actually view are fetched upstream.
- Not yet: GitHub remote, Cloudflare deploy, KV namespace creation. Config
  carries commented placeholders + instructions.

## Repo layout & file ownership

| Path | Contents | Owner agent |
|---|---|---|
| `src/styles/` | the Ruteark system: tokens/base/primitives.css (owned here) + generated fonts.css/fonts/ | design |
| `src/components/ThemeToggle.astro`, `Icon.astro`, `src/lib/{favicon,pageLifecycle}.ts` | shell components | shell |
| `src/layouts/Layout.astro`, `src/styles/site.css`, `src/pages/index.astro`, `src/pages/404.astro` | page shell, landing, 404 | shell |
| `src/pages/emner/index.astro`, `src/pages/emne/[code].astro`, `src/pages/studier/index.astro`, `src/pages/studier/[code].astro`, `src/components/site/*` | data pages + islands | pages |
| `crawler/crawl.mjs` (+ helpers), `data/*.json`, `public/data/search-index.json`, `.github/workflows/` (ci/release/crawl), `tests/crawler.test.mjs` | crawler | crawler |
| `worker/src/*.ts`, `worker/tsconfig.json`, `tests/worker/*.test.ts` | API worker | worker |
| root configs (`package.json`, `astro.config.mjs`, `wrangler.jsonc`, `tsconfig*.json`, `biome.json`, `mise.toml`) | pre-written — edit only with clear need | — |

## Design-system usage (all UI work)

The design system is **Ruteark** — this repo's own (docs/DESIGN.md; tokens/
base/primitives in `src/styles/`, fonts vendored via `scripts/fetch-fonts.mjs`).
StudyCompanion is inspiration only; nothing is ported from it anymore.

- Load order in `<head>`: `fonts.css` → `tokens.css` → `base.css` →
  `primitives.css` → `site.css`. Import via Astro frontmatter in Layout.astro
  only. The accent is defined in tokens.css (Flexoki green) — no inline
  accent vars on `<html>`.
- No-flash theme init: inline `is:inline` head script reading
  `localStorage["np:theme"]` falling back to `prefers-color-scheme`, setting
  `data-theme="dark"` on `<html>` before paint. ThemeToggle gets
  `storageKey="np:theme"`. Include `<ClientRouter />` from `astro:transitions`
  (ThemeToggle's `onPage` needs `astro:page-load`).
- Use ONLY tokens.css custom properties and `.np-*` primitives (inventory in
  DESIGN.md §5). Never hardcode colors, never pure #000/#fff, no borders on
  interactive controls, and honor the named rules: Data-Is-Mono,
  Red-Is-Collision, Green-Means-Fits, Ruling-Marks-The-Plan,
  Ink-Before-Chrome.
- Brand: wordmark **"Semesterplan"** (grotesk 700) with a small mono "NTNU"
  suffix in `--muted`; favicon = the Ruteark mark (a 2×2 ruled square with
  one cell filled `--accent` green) as an inline SVG data URI from
  `src/lib/favicon.ts`.
- Shell (`site.css`): sticky topbar (wordmark left; `.np-navlink`s
  Planlegger/Emner/Studier with `aria-current`; ThemeToggle right), content
  column (`--maxw` for data pages via Layout's `wide` prop, `--measure`
  otherwise), quiet mono footer ("Uoffisiell side · data fra NTNU og HK-dir
  (DBH)").

## Crawled data contracts (crawler writes, pages read)

`data/catalog.json`:
```jsonc
{
  "year": 2026,                    // catalog year crawled
  "crawledAt": "2026-07-24T12:00:00Z",
  "courses": [{
    "code": "TDT4100", "name": "Objektorientert programmering",
    "url": null, "version": "1", "location": "Trondheim",
    "examOnly": false,
    "exams": [{ "season": "AUTUMN", "date": "2026-12-05", "continuation": false }]
  }]                               // deduped, sorted by code
}
```
`data/programs.json`: `{ "crawledAt", "programs": StudyProgramSummary[] }`
(full objects from `client.programs.all()`, sorted by code).
`data/semesters.json`: `{ "crawledAt", "current": Semester | null, "semesters": Semester[] }`.
`public/data/search-index.json` (runtime-fetched by search island; compact):
`{ "year": 2026, "courses": [["TDT4100", "Objektorientert programmering", "Trondheim"], ...] }`.

Crawler: `node crawler/crawl.mjs [--year 2026]` — plain ESM JS (no TS build),
imports `ntnu-api`. Default year = `semesters.current()`'s `year`. Writes all
four files atomically (tmp + rename), pretty-printed except search-index
(minified). Pure transform functions live in `crawler/transform.mjs` and are
unit-tested with small fixture objects (no network in tests).

## Worker API contract

Base: same origin as the site. All GET, JSON responses, `content-type:
application/json; charset=utf-8`.

| Route | Upstream call | TTL | Notes |
|---|---|---|---|
| `GET /api/health` | none | — | `{"ok":true}` |
| `GET /api/course/:code?year=` | `courses.details(code, year?)` | 6h | 404 `{error}` if null |
| `GET /api/course/:code/grades` | `grades.distribution(code)` | 24h | `{rows: GradeRow[]}`, `[]` fine |
| `GET /api/course/:code/timetable?year=` | `courses.timetable(code, year)` | 1h | year required, 4-digit |
| `GET /api/course/:code/schedule?year=` | `courses.schedules(code, year)` | 1h | Dates → ISO strings |
| `GET /api/program/:code/plan?year=` | `programs.studyPlan(code, year)` | 24h | cohort year required; 404 if null |

- Envelope: success = the payload object shown above; error = `{ "error":
  "<message>" }` with status. Course/program codes validated
  `/^[A-ZÆØÅ0-9_-]{2,16}$/i` (uppercase before use), years `/^\d{4}$/` → else 400.
- Error mapping: `NotFoundError`→404, `RateLimitError`→429 (+`Retry-After: 60`),
  other `NTNUAPIError`→502 `{error}`. Non-NTNUAPIError bugs propagate (500).
- Caching: port ntnu-mcp's `TTLCache`/`TieredCache`/`KVCacheBinding`
  (`/workspaces/ntnu-mcp/src/cache.ts`) — isolate memory in front of optional
  KV binding `CACHE` (`env.CACHE` may be undefined locally → memory-only).
  Keys `JSON.stringify([kind, ...params])`, KV prefix `v1:`. Cache null
  details/plan as sentinel `"missing"`. KV writes via `ctx.waitUntil`.
  Response headers: `Cache-Control: public, max-age=300, s-maxage=<ttl/1000>`
  on success; `no-store` on errors.
- Entry (`worker/src/server.ts`): module-level `NTNUClient` + `TTLCache`
  singletons (no options → library defaults); route on `url.pathname`; no
  router framework. Non-`/api` paths → `env.ASSETS.fetch(request)`.
  Route handlers live in `worker/src/routes.ts` as pure functions taking
  `{ client, cache }` deps (ntnu-mcp pattern) so tests inject a fake fetch via
  `new NTNUClient({ fetch, sleep: async () => {} })` and a bare `TieredCache()`.
- Worker TS: `worker/tsconfig.json` with `types: ["@cloudflare/workers-types"]`;
  avoid Workers-only ambient types in shared files (structural
  `MinimalExecutionContext`, ntnu-mcp pattern).

## Pages

All pages use `Layout.astro` (props: `title`, `description`, optional
`wide: boolean`). Build-time data via `import catalog from "../../data/catalog.json"`
etc. Islands are **vanilla `<script>` modules** (no framework) fetching
relative `/api/...` URLs; `astro.config.mjs` proxies `/api` →
`http://localhost:8787` during `astro dev`.

- `/` (shell agent): hero (site purpose, one sentence), a prominent
  `.sc-field` search box that navigates to `/emner/?q=…`, tiles linking
  Emner/Studier, current-semester line from `data/semesters.json`.
- `/emner/` (pages agent): client-side search over `search-index.json`
  (fetch on load; filter on code+name substring, case/diacritic-insensitive),
  location filter chips (`.sc-chip`, `aria-pressed`), result rows (mono code +
  serif name) linking `/emne/CODE/`, capped at 200 rendered hits with a mono
  "viser 200 av N treff" note. Reads `?q=` from the URL on load.
- `/emne/[code]/` (pages agent): `getStaticPaths` from `catalog.json`
  (~3600 pages, keep the template light). Static shell: code (mono kicker),
  name (display serif), exam seasons/dates from catalog. Islands fetch in
  parallel and render: details (facts panel: credits/level/language/location/
  department; prose sections: content, learning outcome, assessment; exams
  table; credit reductions), grades (per-year stacked bar chart, inline SVG or
  divs colored with the categorical hues `--green`→`--red` for A–F, pass/fail
  variant; year selector chips; totals), timetable (weekly grid Mon–Fri,
  entries with time/room/type; year defaults to catalog year). Loading state:
  quiet mono "henter …" lines; error state: mono line, no drama. 404 page
  handles unknown codes.
- `/studier/` (pages agent): filterable program list from `programs.json`
  (search field + level chips), rows linking `/studier/CODE/`.
- `/studier/[code]/` (pages agent): static summary (name, level, campuses,
  department, description) + study-plan island: cohort-year `.sc-chip` row
  (guess current year first, then re-render chips from `publishedYears` in the
  response), plan rendered as periods → course groups → course rows (mono
  code linking to `/emne/CODE/` + serif name + credits), waypoints/directions
  as nested `.sc-summary` disclosures.

## Quality bar

`mise run check` (= lint + typecheck + test) and `npm run build` must pass.
Tests: crawler transforms and worker routes (fixture-driven, no network).
Norwegian UI copy, bokmål, sentence case, no exclamation marks. Keep
dependencies at zero beyond what root package.json already declares.
