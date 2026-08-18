# SPEC.md — architecture and data contracts

An NTNU timetable getter: pick a study programme and kull (or add course
codes), see the merged weekly schedule and the semester's exam dates. Two
pages, no account, `localStorage` only. Built on the `ntnu-api` npm package.

It was a five-column join with accounts, sync and a shared-plan page until
2026-08-18; `docs/superpowers/specs/2026-08-18-timetable-only-reduction-design.md`
is what was cut and why.

Product definition is `docs/PRODUCT.md`; the design system is
`docs/DESIGN.md` and its named rules are binding. This file covers
architecture and data contracts only.

Site language is **Norwegian** (labels, headings, prose), bokmål, sentence
case. Code, comments and identifiers are English.

---

## Topology

```
Astro static site (dist/)  ──served by──▶  Cloudflare Worker (Workers Assets)
                                              │
  nightly crawler ──▶ data/*.json             └─ /api/* ──▶ ntnu-api client
  (build-time input     public/data/*.json                  + TieredCache
   + runtime index)                                         (memory → KV)
```

- **Nightly crawl** (~20 upstream requests over two catalog years): course
  catalog via `searchAll(year)` for the canonical year and `year - 1`,
  `programs.all()`, `semesters.all()`. Output is gitignored build-artifact
  JSON — consumed at build time (static pages) and at runtime (the search
  index), baked into each deploy, never committed. A `prebuild` guard
  (`crawler/ensure-data.mjs`) crawls automatically when the files are absent.
- **Live via Worker `/api/*`** (per course / per programme, cached): course
  details, timetables, study plans. Only courses and programmes people actually
  view are fetched upstream. The worker stores nothing about a student.
- Not yet wired: GitHub remote, Cloudflare deploy, KV namespace creation.
  Config carries commented placeholders and instructions.

## Repo layout and ownership

| Path | Contents |
|---|---|
| `src/styles/` | `tokens.css`, `base.css`, `primitives.css` (the `.np-*` layer), `site.css` (the shell), `planner-week.css` (the week's geometry), `plan-surface.css` (the plan's own sections) |
| `src/layouts/Layout.astro`, `src/components/{ThemeToggle,Icon}.astro`, `src/lib/{favicon,pageLifecycle,planProbe,sitemap}.ts` | page shell: persistent nav, footer, theme, lifecycle, the plan probe |
| `src/pages/planlegger/index.astro`, `src/components/planner/*`, `src/lib/planner/*` | **the app** — see below |
| `src/pages/{index,404}.astro`, `src/pages/sitemap.xml.ts`, `src/components/site/now.ts` | the front door and its one island |
| `crawler/*.mjs`, `data/*.json`, `public/data/search-index.json`, `.github/workflows/crawl.yml` | crawler |
| `worker/src/*.ts`, `worker/tsconfig.json` | API worker |
| `e2e/*.pw.ts`, `playwright.config.ts` | browser suite |
| `tests/**` | unit tests: crawler transforms, worker routes, planner engines, site islands, design tokens |
| root configs (`astro.config.mjs`, `wrangler.jsonc`, `tsconfig*.json`, `mise.toml`, `biome.json`) | pre-written — edit only with clear need |

---

## `/planlegger/` — the flagship surface

Reading order for a change:

```
store.ts        the plan's shape + persistence
   │
data.ts         fetch + shape: search-index rows, per-course bundles,
   │             indexForSemester() (the exam-window filter)
   │
programPlan.ts  study-plan resolution: resolvePeriodFor() is the ONE entry
   │             point — the studieinfo section and the planner both call it
   │
   │  pure engines, no DOM:
   │  layout.ts       day-column packing (clusters, columns, piling)
   │  groups.ts       parallel / øving group selection
   │  activity.ts     DR-1's lecture/other collapse
   │  schedule.ts     semester-id arithmetic + the semester-window filters
   │  examSchedule.ts exam-list model (sort, gaps, tight flag, countdown)
   │  weekDates.ts    which ISO week the page is open in
   │  hues.ts         course hue from the plan's code SET
   │  courseLinks.ts  where a question about a COURSE goes: ntnu.no, karakterweb
   │
   │  DOM renderers and dialogs:
   │  weekView.ts     the week as one mountable thing: view state, tabs,
   │                  scroll edge, now marker, popover, render switch
   │  weekNotes.ts    what a week MEANS: margin, gaps, branch ladder
   │  columnGrid.ts   "Uke" — days across, time down
   │  board.ts        "Liste" — a departure board, one row per session
   │  weekSkeleton.ts a pending week, in the shape of the view about to land
   │  examList.ts     the exam month band + list
   │  layerMotion.ts  the øving layer's arrive/leave choreography
   │  studieinfo.ts   programme / kull / retning modal
   │  courseSettings.ts  the one surface a planned course is configured on
   │  blockPopover.ts a session's facts, anchored to the bar you clicked
   │  addCourse.ts    the catalog search modal, and the only search there is
   │  dom.ts          tiny element builders; types.ts  view shapes
   │
plannerApp.ts    orchestration: owns the DOM ids in planlegger/index.astro,
                  wires store → data → programPlan → renderers, and is the
                  ONE place a <script> module talks to `document`
```

### The engine and state layer (`src/lib/planner/`)

- **`store.ts`** — `PlanState` and persistence. Storage and the change-event
  target are injected so it works in non-DOM contexts. Split three ways:
  `np:profile` (the programme choice, global — it survives a semester switch),
  `np:plans` (the course list, keyed per `semesterId`), `np:lastSemester`.
  `removeProgram()` clears the profile and drops programme-sourced courses in
  the *active* semester while keeping manual adds. `onPlanChange(cb)` fires on
  storage events, on the custom `ntnu:plan-change` event and on the page's own
  writes, so every surface reading the plan stays live without polling.
  **Storage is the only source of a plan, and the only place one exists.**
  There is no hash grammar, no account and no server copy (PRODUCT mandate
  11): a student who clears their browser has cleared their plan.

- **`data.ts`** — `PlannerIndex` / `PlannerIndexCourse` (the typed shape of
  `search-index.json`), `fetchCourseBundle`, and
  `indexForSemester(index, semesterId, window?)`, which narrows every row's
  exams to one semester's season *and* `fromDate…examFinalDate` window before
  anything renders them — a carried-over course's only exam date can be last
  year's.

  **The honest-fetch contract.** This is the layer PRODUCT's moat is built
  on, so it is spelled out rather than left to the code:
  - `TimetableOutcome` is the authority on the week's verdict:
    `{kind:"entries",count}` | `{kind:"empty"}` | `{kind:"failed",reason,message}`,
    plus `{kind:"pending"}` in the wider `CourseFetchState`. **"Came back
    empty" and "we could not ask" must never collapse into "no blocks
    drawn"** — that is precisely how a failed fetch renders as a free
    Tuesday. Read `timetableOutcomeOf(bundle)` or `courseFetchState(code)`,
    never `bundle.timetable?.length`. `bundleFromEntries()` builds the same
    guarantees for a hand-made bundle, and a semester-narrowed clone keeps the
    *fetch's* outcome, so "fetched 12 entries, none this semester" stays
    distinct from "fetch failed".
  - **No upstream English leaves this module.** Every rejection is a
    `FetchFailureError` with a classified `reason`
    (`not-found`/`invalid`/`rate-limited`/`server`/`network`/`timeout`/`unknown`),
    a `source` (`ntnu` | `site` — a failed download of our *own*
    `search-index.json` must not be reported as "NTNU svarte ikke"), and a
    ready Norwegian `message`. The raw string survives as `.detail`, for
    `console.debug` only.
  - **Memoisation is per part, and failures are never cached.** Bundles are
    memoised per `code:year:version`; *details* have their own memo keyed by
    **code alone**, because `/api/course/:code` carries neither year nor
    version. A bundle carrying any failure is dropped from the memo as it
    settles — the module outlives every ClientRouter navigation, so memoising
    a transient blip made it permanent for the session. In-flight dedup is
    unaffected, and `loadPlannerIndex()`'s rejection is not memoised either.
    `clearCourseBundleMemo()` is what "Prøv igjen" calls.
  - Every request carries the caller's `onPage` signal combined with a 15 s
    `FETCH_TIMEOUT_MS` cap, so one stalled socket cannot hang the page.

- **`layout.ts`** — `layoutDay(items, maxColumns) → LayoutSlot[]`, pure:
  greedy calendar-column packing into overlap clusters. A touching boundary
  (`start === prevEnd`) is **not** an overlap, matching the conflict engine's
  own rule. The column cap is a **viewport question, not a constant** — below
  40 rem a day column is ~56 px, so 1 is passed and a 2-deep cluster piles
  instead of splitting into 27 px slivers. A cluster needing more than the cap
  is **not split at all**: every member comes back `piled: true` and the
  renderer draws the whole cluster as ONE block naming each session. There is
  no "+N til" overflow chip and no `overflow` flag — the chip named a count
  the student could not act on, and three columns in a ~106 px weekday is
  ~35 px per block, at which width a course code breaks one character per
  line. `LayoutSlot.cluster` is also the renderer's partition, so "what
  overlaps what" has exactly one implementation.

- **`groups.ts`** — `groupKey(name)`, `groupOptions`, `defaultLectureKeys`,
  `applyGroupSelection`. **Lecture entries are not all alternatives**:
  "Forelesning 1" Tuesday and "Forelesning 2" Monday are complementary
  sessions, while four "Forelesning 1 <programmes>" are one session offered
  four times. So narrowing runs per *session family* — only groups within one
  family are mutually exclusive — and an unresolvable family is reported
  rather than guessed. Øving and lab entries are never defaulted away, only
  narrowed once a group is picked, and **a selection of one kind may never
  delete the other kind's entries**.

- **`activity.ts` / `conflicts.ts` / `schedule.ts`** — thin policy seams over
  `ntnu-api`. What NTNU's titles *mean* lives upstream; what stays here is
  this product's policy: DR-1's asymmetric collapse to `lecture | other`, the
  lecture-only pre-filter, and the rule that **no exam logic goes in
  `conflicts.ts`** (`examSchedule.ts` owns the sort, gaps, same-day flag and
  "tett" threshold — there is exactly one exam engine).

- **`examSchedule.ts`** — `buildExamList(exams, todayIso) → ExamListModel`.
  Pure `Date.UTC` day-differencing, no `Date.parse`, locale- and
  timezone-independent: sorts dated exams chronologically, annotates
  `gapToNext`/`tight`/`sameDay`, sets `daysFromToday` on the first upcoming
  exam only, keeps dateless exams in a separate bucket.

- **`hues.ts`** — the six course hues, assigned as a deterministic function of
  the plan's **code set** (DESIGN.md §9). Never by insertion order.

- **`weekDates.ts`** — ISO 8601 week arithmetic, unit-tested across both year
  boundaries, because NTNU publishes timetables in ISO week numbers.

### The renderers (`src/components/planner/`)

- **`columnGrid.ts`** — **Uke**: days across, time down. The width law
  (whole days only; the day grows before the code shrinks, and no day takes
  more than half the frame) is expressed in **CSS**, not in a measuring pass,
  so there is no resize listener and no `getBoundingClientRect`. The module's
  only input to it is `--planner-lanes-max`, the deepest cluster in the week —
  which is why the cap exists: that one number sizes every column, so before it
  a single Friday overlap set Monday's minimum too (DESIGN §6).
- **`board.ts`** — **Liste**: a departure board, one row per session, the
  start time in the left margin and the room in the right. No geometry, so
  nothing narrows as the viewport does — which is the point: the grid is
  weakest exactly where this is strongest, at 390 px, in print, and in a
  screen reader.
- **`weekView.ts`** — the week as ONE thing a page mounts. It earned that
  shape when three surfaces drew a week; one does now, and the shape stays
  because the alternative is inlining it back into the page.
  `mountWeekView({frame, notes, tabs, surface, onOpenSettings, signal})` owns
  the view state (`np:weekView`), the Uke/Liste pair, the øving layer box and
  everything it does (state, click, choreography, pending count, the B7a
  auto-reveal mirroring), the scroll edge and its mask, the minute tick, the
  session popover, the frame's reservation lease, and the choice between
  `renderColumnGrid` and `renderBoard`.
  `render(states, input) → WeekRenderResult` draws and reports.
  What a PAGE keeps is the CONTENT of its message branches (`message()`,
  `card()`): the planner's empty week can be a studieretning question, an
  unpublished semester or a failed fetch with a retry, and none of that belongs
  to a shared controller.
  `onOpenSettings: null` on a surface with no editor, which omits the popover's
  verb rather than pointing it at nothing.
- **`weekNotes.ts`** — what a week MEANS, as distinct from how it is drawn:
  the margin and the branch ladder. `weekNotes(...) → WeekNotesResult` reports
  `mutedLayerAutoRevealed`, `pendingGroupCourses`, `uncheckedCourses`,
  `state`/`message`, and the two honesty fields: `incompleteCourses[]`
  (courses whose timetable we could not get, as opposed to courses NTNU
  publishes nothing for) and `partial`. Those two are what survives of the
  verdict (PRODUCT D17) and they are not decoration — a course missing from
  the drawn week looks exactly like a course with no teaching.
  `renderWeekMessage` exists so a message never renders inside the week's own
  frame as though it were a plan.
- **`examList.ts`** — a **month band** showing the shape of the exam period,
  and under it the list. A same-day pair gets no connector (zero distance is
  not a distance); the band splits that day into both hues with a collision
  ring, and the clash line names both courses in words, because neither the
  split nor the ring survives a screen reader. Reads an already
  `indexForSemester`-narrowed index, so a stale exam date cannot reach it.
  Owns the DR-3 kont join (`collectExamInputs` / `isDeferredOn` /
  `isDeferredOccasion`), fail-open.
- **`studieinfo.ts`** — the front door: one `<dialog>` owning **all four**
  choices the plan hangs off (programme, kull, studieretning, semester). Every
  edit is staged locally; nothing touches the store until **Lagre**, which
  calls `setProgramPlan` and preserves manual adds, drops and group picks.
  Opened from the plan's own name in the planner's bar, and from the first-run
  screen. **It is the only settings surface on the site.**
- **`courseSettings.ts`** — the ONE surface a planned course is configured on,
  reached from a course row or from a bar in the week. A real modal, so Esc,
  backdrop dismissal and focus return are native. `setCourseGroups` writes on
  every edit, so the grid behind the backdrop is already correct when it
  closes.
- **`blockPopover.ts`** — a READ surface: the facts of the session you
  pointed at, anchored to it, with a way through to the editor rather than
  being the editor. `show()`, not `showModal()`, so the week stays visible and
  clicking another bar re-targets the same dialog — which also means it gets
  no free dismissal, so Esc, backdrop and a real close button are all wired by
  hand.
- **`addCourse.ts`** — the catalog search modal, and since 2026-08-18 the only
  search on the site. Ranked through `lib/planner/searchCatalog.ts`. One
  persistent action button per row with four verbs ("Legg til" / "Fjern" /
  "Dropp" / "Legg tilbake") beside a state span, all four decided by
  `courseAction.ts` so the rule that a programme course is dropped rather than
  deleted lives in one place. The dialog stays open for several adds.
  **Not-taught rows are excluded outright — from the list *and* from the
  count**; when a query matches only such courses the dialog says so
  specifically, because "0 treff" would read as "no such course".
- **`plannerApp.ts`** — the only file that queries `document`. Grep
  `planlegger/index.astro` for the DOM-id contract rather than duplicating it
  here; it drifts fast. Mounted via `onPage()`.
- **`layerMotion.ts`** — the øving layer's arrive/leave choreography
  (DESIGN.md §7). The renderers stay dumb and still throw the subtree away.

### Site islands (`src/components/site/`)

One file. `catalogSearch.ts` moved to `lib/planner/searchCatalog.ts` with the
add dialog that is now its only caller, and `planClash.ts`, `courseDetails.ts`,
`courseTimetable.ts` and `gradeChart.ts` are deleted with the course page
(PRODUCT D10, D11).

- **`now.ts`** — the landing page's answer to the only question a returning
  student has on a Tuesday at 11:05: **which room**. It degrades in a straight
  line, every step a real state rather than a spinner.

---

## Design-system usage

- Load order in `<head>`: `tokens.css` → `base.css` → `primitives.css` →
  `site.css`, imported from `Layout.astro` frontmatter;
  `planner-week.css` and `plan-surface.css` from the planner. **There are no
  webfonts** — type is the platform UI face (DESIGN.md §3).
- No-flash theme init: an `is:inline` head script reading
  `localStorage["np:theme"]`, falling back to `prefers-color-scheme`, setting
  `data-theme` on `<html>` before paint, and re-applying on
  `astro:after-swap`. It carries a second passenger, the **plan probe** — see
  CLAUDE.md for why both are load-bearing.
- Use ONLY `tokens.css` custom properties and `.np-*` primitives (inventory in
  DESIGN.md §5). Never hardcode colours, never pure #000/#fff, no borders on
  interactive controls, and honour the named rules.
- Brand: wordmark **"Semesterplan"** with a small "NTNU" suffix in `--muted`;
  favicon is a 2×2 ruled square with one cell filled in the verdict green,
  inlined as an SVG `data:` URI from `src/lib/favicon.ts` on a fixed dark
  ground so the tab icon reads the same in both themes.
- Shell (`site.css` + `Layout.astro`): sticky topbar (wordmark left;
  one `.np-navlink` for "Planlegger", `aria-current` computed from an explicit
  per-item `sections` list rather than `path.startsWith`; then ThemeToggle
  right), a content column (`--maxw` for the planner via Layout's `wide` prop,
  `--measure` otherwise), and a footer that only states provenance. **No
  sitewide plan bar of any kind** (PRODUCT.md §5), and no account door — with
  two controls left there is nothing to fold, so `menuPanel.ts` is deleted
  too.
- `/data/programs.json` is a **build-time endpoint**
  (`src/pages/data/programs.json.ts`), not a crawler artifact: the trimmed
  `[code, name, studyLevel, cities]` tuples the programme typeahead searches.
  It is fetched lazily the first time the panel opens, because the panel is
  fetched the first time the picker is opened rather than inlined: importing
  the 332 KB record into a client chunk is not affordable, and the typeahead is
  not on the critical path to a drawn week.

---

## Crawled data contracts

`data/catalog.json` — **two catalog years unioned**, newest canonical, so a
course absent from this year's catalog but taught last year still gets a page:

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

`public/data/search-index.json` — runtime-fetched by the search island and the
planner. Compact **positional tuples**; new fields are only ever appended and
**no existing position is ever renumbered**:

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

- `exams` is `[[season, dateOrNull], …]` — **every published sitting, ordinary
  and deferred alike.** `transform.mjs` does filter `!exam.continuation`, but
  that filter is a **no-op**: 0 of the 2 439 exam rows in the current
  `catalog.json` carry the flag, and the search portlet returns
  `continuation: false` for the same sitting `/api/course/:code` labels
  `occasion: "Utsatt eksamen"`. **The kont filter lives in the consumer**
  (`examList.ts`, and the same predicate again in `gradeChart.ts`): it needs
  both this index's structured ISO date and `/api/course/:code`'s `occasion`,
  joins them on the exact date, and reads `occasion` as a label only. It is
  fail-open. **Do not "fix" this in the crawler** — the flag it would filter
  on is never set.
- `version` (element 4) is the catalog course version to thread into
  `/api/course/:code/timetable?year=&version=`. 293 of 5 470 rows are not
  `"1"` (DR-4).
- `offeredYears` (element 5) mirrors `catalog.json`'s per-course field. A row
  whose `offeredYears` excludes `year` is not taught in the canonical year,
  and its name, location, exams and version all come from the newest year it
  *was* offered — render that honestly ("ikke undervist i 2026 · sist
  undervist 2025"), never as a current course with a mysteriously empty week.
  703 of 5 470 rows are in this state today.

**Crawler:** `node crawler/crawl.mjs [--year 2026]` — plain ESM (no TS build),
importing `ntnu-api`. Default year is `semesters.current()`'s. It crawls the
canonical year and `year - 1` (~20 requests at the 500 ms gap); if either
catalog pass fails, **the whole crawl fails (exit 1)** — a half-crawl that
looks complete is worse than a red build. All four files are written
atomically (tmp + rename), pretty-printed except the search index. Pure
transforms live in `crawler/transform.mjs` and are unit-tested against small
fixtures with no network. The crawl sanity-checks its own output against
floors before writing, so a hollow catalog fails loudly rather than deploying
nightly. **`tests/artifacts.test.mjs` asserts this contract against the real
artifacts** — row counts, the two-year union, `offeredYears` descending, the
six-element tuple with no position renumbered, and both code grammars mirrored
from `worker/src/routes.ts` — and skips cleanly when the gitignored artifacts
are absent.

---

## Worker API contract

Base: same origin as the site. **GET/HEAD only** — anything else is
`405 {"error":"Method not allowed"}`
with `Allow: GET, HEAD`. JSON responses, `content-type: application/json;
charset=utf-8`.

| Route | Upstream call | TTL | Notes |
|---|---|---|---|
| `GET /api/health` | none | — | `{"ok":true}` |
| `GET /api/course/:code?year=` | `courses.details(code, year?)` | 6 h | 404 `{error}` if null |
| `GET /api/course/:code/timetable?year=&version=` | `courses.timetable(code, year, version?)` | 1 h | year required, 4-digit |
| `GET /api/program/:code/plan?year=` | `programs.studyPlan(code, year)` | 24 h | cohort year required; 404 if null |

- **Codes are percent-decoded before validation**, in one place
  (`routes.ts`'s `parseCode`). The WHATWG URL spec keeps path segments
  encoded, so without the decode every code containing Æ/Ø/Å 400s from the
  whole `/api` surface — 58 programmes and 238 courses. A malformed escape
  400s with the route's own message.
- **Two code grammars, not one.** Course codes validate against
  `COURSE_CODE_RE = /^[A-ZÆØÅ0-9_-]{2,16}$/i`; programme codes against the
  wider `PROGRAM_CODE_RE = /^[A-ZÆØÅ0-9_+/-]{2,16}$/i`, because 4 of the 403
  codes in `programs.json` carry a literal `/` or `+` (`EMNE/HF`, `EMNE/SU`,
  `MSECT+OH`, `MSØK/5`) and used to 400 from our own validator while the UI
  blamed NTNU. `.` stays excluded in both, so no path-traversal shape can
  form. Both run *after* decoding. Years `/^\d{4}$/`, optional `?version=`
  `/^[A-Za-z0-9-]{1,8}$/` (a bound on the cache key, not a whitelist) → else
  400.
- **Error mapping:** `NotFoundError` → 404, `RateLimitError` → 429 with
  `Retry-After: 60`, other `NTNUAPIError` → 502 with the **fixed body
  `{"error":"Upstream error"}`** — ntnu-api's own message can carry an
  internal NTNU Liferay portlet URL, so it is `console.warn`ed and never
  returned. Do not "improve" the 502 by echoing `err.message`. Non-API bugs
  propagate as 500.
- **Upstream throttle:** a token bucket keyed on `CF-Connecting-IP` (120
  burst / 15 per second, ≤5 000 tracked clients) — the only client identifier
  a Worker can trust. A token is spent **inside the handler, after the cache
  misses**, so it meters *our egress to NTNU* and never throttles a warm-cache
  visitor. An absent header (local `curl`, some harnesses) means nothing is
  metered, rather than bucketing every caller together where one abuser could
  deny everyone. This is politeness metering, not a DoS defence: 400s, 404s
  and cache hits cost no tokens.
- **Caching:** `TTLCache` / `TieredCache` / `KVCacheBinding` — isolate memory
  in front of the optional KV binding `CACHE` (undefined locally →
  memory-only). `TTLCache` deletes on an expired read and caps at 500 entries
  with insertion-order eviction (a `set` on an existing key deletes-then-sets,
  so a refreshed hot key isn't evicted ahead of cold ones). Keys are
  `JSON.stringify([kind, ...decodedUppercaseCode, ...params])`, so `MTIØT` and
  `MTI%C3%98T` share one entry. KV prefix `v1:`.
  **A `null` details/plan result is cached as a `"missing"` sentinel under its
  own key with its own 10-minute TTL**, not the route's positive TTL:
  `ntnu-api` returns `null` for an empty 200 too, so a transient blank
  response used to mean up to 24 h of "this cohort has no plan" — which the
  study-plan step-back then papers over by silently serving another cohort.
  KV writes go through `ctx.waitUntil`. Response headers: `Cache-Control:
  public, max-age=<≤300>, s-maxage=<ttl/1000>` on success and on a 404 served
  from the sentinel; `no-store` on every other error.
- **Entry (`worker/src/server.ts`):** module-level `NTNUClient`, `TTLCache`
  and `RateLimiter` singletons; routing on `url.pathname`; no router
  framework. `/api` **without** a trailing slash is part of the API surface
  too. Non-`/api` paths go to `env.ASSETS.fetch` and get the headers below;
  the lowercase-course-code 301 that used to sit on that branch went with the
  `/emne/[code]/` pages it canonicalised.
  **Sitewide security headers** (`withSecurityHeaders`, applied to asset and
  JSON responses alike): a CSP (`default-src 'self'`, `object-src` and
  `base-uri` `'none'`, `frame-ancestors 'none'`, `img-src 'self' data:`;
  `script-src`/`style-src` keep `'unsafe-inline'` — the hash form for Layout's
  single no-flash block is a documented upgrade, deliberately not shipped
  unverified), `X-Content-Type-Options: nosniff`, `Referrer-Policy:
  strict-origin-when-cross-origin`, `X-Frame-Options: DENY`.
- Route handlers are pure functions taking `{ client, cache, throttle? }`
  deps, so tests inject a fake fetch via
  `new NTNUClient({ fetch, sleep: async () => {} })` and a bare `TieredCache()`.
- Worker TS: `worker/tsconfig.json` with
  `types: ["@cloudflare/workers-types"]`; keep Workers-only ambient types out
  of shared files (use structural interfaces).

## Pages

All pages use `Layout.astro` (props: `title`, `description`, optional
`wide`). Build-time data comes from `import catalog from "../../data/catalog.json"`.
Islands are **vanilla `<script>` modules** (no framework) fetching relative
`/api/...` URLs, mounted through `onPage()`. `astro.config.mjs` proxies
`/api` → `http://localhost:8787` during `astro dev`.

- **`/`** — the front door, and it is two things: the "Nå" card (the student's
  own running or next session, with the room set as display type, then the
  next few after it) and one CTA to `/planlegger/`. **No pitch** — no kicker,
  no headline, no sub-copy; the `<h1>` is `sr-only` so the document still has
  an outline. No picker, no proof fragment.
- **`/planlegger/`** — the app. One bar at the top carries the plan's name and
  the semester select; the week's own controls (the week picker, the layer box
  and Uke/Liste) live in the week's section; then the week and the exam list
  against the course rail. The title names the programme and the kull only —
  the semester is the `<select>` on the same bar, and stating it twice made a
  label compete with a control. The primary "Legg til emne" is at the foot of
  the Emner column, under the rows it appends to, and it is the **only** door
  into adding a course: the study plan's choice pool is a filter inside that
  dialog (`studyPlanCodes`/`openScoped` on `AddCourseDeps`), engaged on open
  whenever a programme is stored.

  **There is no verdict** (PRODUCT D17). The line under the bar carries one
  thing — "mangler timeplan for N emner" — and is silent otherwise. Every
  course row and every session card carries the two outbound links
  (`lib/planner/courseLinks.ts`), which is the whole of what this site says
  about a course.
- **`/404`** — states the reason, states the crawl date (DR-8), and offers
  exactly two honest ways back. It has no search form.
- **`/sitemap.xml`** — two URLs. It existed because nothing server-rendered
  linked to the 5 470 course pages; those are deleted, and it stays because
  `robots.txt` points at it. Composition is in `src/lib/sitemap.ts` so it can
  be unit-tested;
  `tests/site/discoverability.test.ts` pins the two-file agreement between
  `astro.config.mjs`'s `site` and `public/robots.txt`'s `Sitemap:` line, which
  nothing else would notice breaking.

---

## Testing and quality bar

`mise run check` (lint + typecheck + tests, server-free) and `npm run build`
must pass. `biome check --error-on-warnings` must exit 0 — `.astro`
frontmatter's `noUnusedImports`/`noUnusedVariables` false positives are
disabled **per-file** via `biome.json`'s `overrides`, not globally, so a real
dead import elsewhere still fails the gate.

**Unit tests** (`tests/`, vitest, no network): crawler transforms, worker
routes and cache, every planner engine, the site islands, and
`tests/site/tokens.test.ts`, which measures every token pair that carries text
and fails below AA. `tests/bundle.test.mjs` fails if an upstream NTNU URL ever
reaches a client chunk — i.e. if `ntnu-api`'s HTTP layer stops being
tree-shaken out of the pure helpers the browser imports.

**Browser suite** (`e2e/*.pw.ts`, named so vitest's default include never
picks them up) — `mise run e2e` builds, serves via wrangler and drives
Chromium. It **replays recorded `/api/*` responses by default** from
`e2e/fixtures/api/`, which is what makes it ~25 s, deterministic and runnable
offline. Two things keep that honest:

- **A miss is recorded, then fails the run in teardown**, so a fixture gap is
  never silently a live call and never reappears.
- **`e2e/contract.pw.ts` asserts, against LIVE upstream, the facts the
  fixtures bake in.** Every one of those was a discovery, and a fixture
  written from what we already believed would have shipped the bug green. The
  contract tests are skipped by default and run on the nightly schedule, which
  is the only thing that can notice upstream moving. When one fails,
  `mise run e2e:record` refreshes the store; `mise run e2e:live` runs
  everything against live.
- `/api/health` is deliberately **not** intercepted — `navigation.pw.ts` reads
  the worker's real security headers off it, and a replayed response would
  answer that with headers captured at some past moment.

**`e2e/cls.pw.ts`** gates layout stability with a per-surface budget. Every
page here paints a static shell and grows its islands a second later, which is
the shape that produces CLS by default: `/planlegger/` scored 0.61 on a phone
and a four-page visit accumulated 0.98, because a ClientRouter swap does not
reset the metric. The budgets are geometry, not timing. See CLAUDE.md for the
three mechanisms that hold it down and why none of them may be tidied away.

**Copy:** Norwegian bokmål, sentence case, no exclamation marks, comma
decimals. Keep dependencies at zero beyond what root `package.json` already
declares.
