# CLAUDE.md

- **Doc hierarchy — four files, and they do not overlap.**
  `docs/PRODUCT.md` is the definitive product definition (mandate,
  positioning, flows, feature status, domain rules DR-1…DR-10, decisions
  D1–D15, and the killed list — do **not** re-add killed features);
  `docs/DESIGN.md` is the design system, and its named rules and §9
  adjudicated decisions are binding; `docs/SPEC.md` covers architecture and
  data contracts; `docs/ROADMAP.md` sequences what is left. There is no
  fifth doc. `PLANNER.md`, `REVIEW.md`, `UX-STUDY.md`, the two `AUDIT-*`
  files and `docs/plan/` were all consumed and **deleted** — every rule worth
  keeping was moved into the four above, so do not restore them and do not
  cite their finding IDs in new prose. (Some test names and a few comments
  still carry an old ID like `pd-5` or `groups-1`. They are labels, not
  links.)
- **The design system has no codename.** An earlier warm-paper direction
  called *Ruteark* — Flexoki ground, vendored Schibsted Grotesk + Spline Sans
  Mono, a squared 15-minute ruling, printed course fills — was replaced
  wholesale on 2026-08-01 by the calendar direction now in DESIGN.md. Only
  the `.np-*` prefix and the primitives' interaction grammar survived. A few
  comments in `primitives.css`, `base.css`, `site.css`, `Layout.astro` and
  `favicon.ts` still say the word; it is a leftover, not a rule.
  StudyCompanion was inspiration only — never port its styles, and never
  reintroduce serif or `.sc-*` idioms.
- `src/styles/{tokens,base,primitives}.css` are owned here and hand-edited.
  **There are no vendored fonts.** Type is the platform's own UI face
  (`-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, …`), and
  `--font-mono` is an alias of `--font-sans`, so `.np-data` keeps its
  meaning — a figure a student copies — while rendering in the same face as
  the sentence around it, with `font-variant-numeric: tabular-nums` doing the
  aligning. The old apparatus (`scripts/fetch-fonts.mjs`, `src/styles/fonts.css`,
  `src/styles/fonts/*.woff2`, the two `<link rel="preload">` tags in
  `Layout.astro`, `tests/fonts.test.ts` and the metric-matched fallback
  faces) was **deleted** when the calendar direction landed, because a
  self-hosted face that nothing names is dead weight and a build step nobody
  needs. Do not reintroduce a webfont without deciding the type question
  first: the craft bar is Google Calendar and Apple Calendar, and both use the
  system face on purpose.

- Two non-obvious fixes a reasonable person would undo — don't.
  (a) `primitives.css`'s `[hidden] { display: none !important }` (with its
  `biome-ignore`): the UA rule lives at UA origin, so **any** author
  `display` beats it whatever the specificity, and most `.np-*` primitives
  declare one (`.np-btn` is `inline-flex`) — `el.hidden = true` hid nothing,
  which is how the add dialog painted "Legg til" + "Lagt til ✓" + "Fjern" at
  once and a suppressed button stayed 160×36 and clickable. Non-`!important`
  forms lose to site.css and every Astro-scoped block. Something that must
  stay laid out while hidden wants its own state class, not this attribute.
  (b) `addCourse.ts`'s search field is `type="text"`, **not `"search"`**:
  Chrome's search input eats the first Escape to clear itself and cancels the
  dialog's close request with it, so dismissal took two presses. The native
  clear button is not load-bearing.
- `data/*.json` + `public/data/search-index.json` are crawler output
  (`npm run crawl`) — gitignored build artifacts, baked into each deploy;
  don't hand-edit and don't commit. `prebuild` runs `crawler/ensure-data.mjs`
  to crawl automatically on a fresh checkout. The crawl unions **two catalog
  years** (canonical + `year - 1`) so a course absent from this year's
  catalog but taught last year (e.g. TMA4100) still gets a page instead of
  404ing — every course carries `offeredYears: number[]` (newest first,
  never empty); render the honest state ("ikke undervist i {year} · sist
  undervist {lastYear}") when it excludes the canonical year, never treat it
  as a current course with a mysteriously empty week.
  The two search surfaces treat those rows **differently on purpose**:
  `/emner/` keeps them, folded into one labelled `Ikke undervist i {year}`
  group at the end of the register (they have pages, and the group opens
  itself when nothing else matched), while the planner's add dialog omits
  them from the list *and* the count — its window is twelve rows deep and
  "matematikk" spent six of them on courses it was refusing to add. Don't
  "restore consistency" by making the dialog render them again; when a query
  matches only such courses the dialog says so specifically instead of
  reporting "0 treff".
  `search-index.json`'s per-course row is a **six-element positional
  tuple** — `[code, name, location, exams, version, offeredYears]` — new
  fields are only ever appended, existing positions never renumbered; see
  `docs/SPEC.md`'s crawled-data-contracts section for the authoritative
  shape rather than re-deriving it from a diff.
- The worker `decodeURIComponent`s every course/programme code path segment
  before validating (`worker/src/routes.ts`'s `parseCode`, one place) —
  **do not remove this or "simplify" it back to reading `url.pathname`
  directly.** The WHATWG URL spec keeps path segments percent-encoded, and
  without the decode every code containing Æ/Ø/Å (MTIØT, ÅSOS, BØA1100 — 58
  programmes and 238 courses) 400s from the whole `/api` surface. Cache keys
  are built from the decoded, uppercased code so an encoded and
  already-decoded request for the same code share one cache entry.
- Upstream NTNU endpoint knowledge lives in the `ntnu-api` package only
  (same layering rule as ntnu-mcp); this repo consumes its public client.
  That rule now covers **derived** upstream knowledge too, not just URLs:
  activity classification (`classifyActivity` — what a `title` means, the
  FORM/FERD/DISAM/SAM buckets), the conflict engine (`findConflicts`,
  `groupConflicts`, `mergeParallelSlots`), week/time parsing (`parseWeeks`,
  `toMinutes`, `weeksToRanges`), `decodeEntities` and `isDeferredOccasion`
  all live upstream and are re-exported through the thin modules that used
  to own them (`src/lib/planner/{activity,conflicts,schedule}.ts`,
  `examList.ts`). Those files now hold only this product's *policy* — DR-1's
  asymmetric collapse to `lecture | other`, the "no exam logic in
  conflicts.ts" rule. Fix a fact about NTNU in `ntnu-api`; fix a rule about
  Semesterplan here. It is safe to import from `"ntnu-api"` in browser code:
  the package is `sideEffects: false`, every such helper is pure, and
  `tests/bundle.test.mjs` fails if an upstream URL ever reaches a client
  chunk (i.e. if the HTTP layer stops being tree-shaken out).
- **Layout-shift reservations (load-bearing, and invisible when they work):**
  every page here paints a static shell and grows its islands a second later,
  which is the shape that produces CLS by default — /planlegger/ scored 0.61
  on a phone and a four-page visit accumulated 0.98, because a ClientRouter
  swap does **not** reset the metric. Three mechanisms hold that down and all
  three look like dead code to a reader who does not know why:
  (a) the **plan probe** — `Layout.astro`'s pre-paint inline script (beside
  the no-flash theme init, re-applied on the same `astro:after-swap` because
  `swapRootAttributes()` wipes attributes *and* inline style) writes
  `--plan-courses` and `data-plan` onto `<html>` from localStorage;
  `src/lib/planProbe.ts` keeps them true for the rest of the visit. Every
  reservation is `calc(var(--plan-courses) * …)`, so a failed read reserves
  exactly nothing. `data-plan="program"` used to pick the planner title's
  *face* as well; that rule is **deleted** — the title is one size and one
  family now, so there is no swap left to hoist before paint. The attribute is
  still read by `/emner/` and the homepage, and `--plan-courses` by every
  reservation, so neither the probe nor the attribute is dead.
  (b) `.planner-grid-frame`'s `min-height` (`planner-week.css`) — the week's
  height, held from first paint. `renderSkeleton` already stops the
  loading→data reflow; this is the paint→mount half, and it was 0.52 of the
  0.61 on its own. It duplicates `SKELETON_DAYS` and the ruler's 22px from
  `grid.ts`; the row metrics live on the *frame* so it can compute a week that
  does not exist yet. **Each week geometry reserves its own height** and that
  base class rule belongs to the transposed geometry alone — which is
  `/emne/[code]/`'s and nothing else, because the planner's third view is
  gone. The planner's two are Uke (the drawn hours × `--planner-hour-h`, the
  `#`-scoped base rule) and Liste (a session count, `html[data-view="tavle"]`).
  Reserving one for the other is worse than reserving nothing (0.14 CLS), and
  the planner's rules are scoped **by id** so a remembered Liste height can
  never reach the course page's frame. Liste has no formula, so
  `saveWeekBox`/`--planner-box` remembers the height per view *and per width*
  and the probe hands it back before paint — sound because a load in Liste is
  by construction a return visit, and discarded outside a 32px width tolerance
  rather than trusting another layout's number. **The probe's default view must
  match `loadWeekView`'s** (`kolonner`), or a cold load reserves for a view it
  is not about to draw. All of it is a **lease**: `--planner-box` is one
  variable holding the height of the view the page LOADED in, so a reservation
  that never ends kept Liste's 829px around the other view's much shorter week
  the moment the student pressed the other tab (600px of white paper above the
  exam list, for the rest of the visit).
  `settleWeekBox` releases on the first drawn week and `setWeekView` on the way
  out of a view. A gate for this needs a **one-course** plan — a full plan draws
  a week taller than every reservation, so slack is zero whether or not the
  lease is ever released, and the first version of that test passed with both
  halves of the fix disabled.
  (c) **leases** — `data-reserve` attributes that JS deletes on reaching a
  terminal state, the idiom `/emne/[code].astro` already documents. Deleting
  one is not optional: a reservation left standing over a short answer is a
  permanent hole, which is why the failure and empty branches release them too.
  Reservations are deliberately a few px UNDER their measured settle, so the
  residual nudges down rather than snatching content upward. `e2e/cls.pw.ts`
  gates all of it with per-surface budgets — verified to fail when (b) is
  removed. Re-measure before changing any number; do not "tidy" a
  `min-height` you cannot see doing anything.
- **The two chrome bars fold into menus on a phone, and the WRAPPER is what
  folds** (`src/lib/menuPanel.ts`, one controller, two bars: the shell topbar
  at 480px and `.planner-head` at 46rem — each folds where *it* runs out of
  room, so a 700px tablet gets `⋯` with the topbar still expanded). Above its
  breakpoint the wrapper is `display: contents`, so its children are the bar's
  own flex children and the wide layout is untouched; below it the wrapper is a
  positioned panel drawn only while the bar carries `data-menu="open"`. Three
  things a reasonable person would undo: it is deliberately **not** a
  `<dialog>` or `[popover]` (neither can be switched back to inline layout by
  CSS, which is the whole mechanism); the open state is `data-menu` **on the
  bar**, never `[hidden]` on the wrapper (see the bullet above — that rule
  beats `display: contents` too and would delete the controls at every width);
  and there is **one DOM**, because every folded control is bound by id
  elsewhere, so a duplicated phone copy collides and a `matchMedia` node-move
  would relocate a live `<select>` mid-interaction. The planner's menu closes
  on the layer box and the semester but **not** on "Del lenke" — the first two
  redraw the week and you cannot follow an animation under a scrim, the third
  holds "Kopiert" in place. `e2e/flows.pw.ts` covers both, including that the
  menu survives a ClientRouter navigation.
- **ClientRouter rule (load-bearing):** hoisted page/component scripts run
  ONCE per module — they do NOT re-execute after a view-transition swap. Every
  page's setup must go through `onPage(setup)` (`src/lib/pageLifecycle.ts`),
  binding listeners with `{ signal }` and registering teardown on abort;
  mounting at top level silently leaves the page dead after any in-site
  navigation. Likewise `data-theme` is client-only state and Astro's
  `swapRootAttributes()` wipes every `<html>` attribute on each swap, so
  Layout's no-flash script re-applies it on `astro:after-swap`. Both are
  covered by `mise run e2e`; don't "simplify" either away.
- **Do not write tests that restate the current design.** DOM child counts,
  exact visual treatments, per-control geometry, "control X lives inside
  surface Y" — their failure message is "someone changed their mind", and
  editing them is transcription, not verification. Adjudicated decisions belong
  in `docs/DESIGN.md`, which is the record; a test that repeats one just makes
  every design change cost a test-editing pass while catching nothing. On
  2026-08-03 three design changes broke ~10 of ~94 browser tests and 0 of 987
  unit tests, and every broken one was of this kind — they were cut rather than
  re-pinned. **Test mechanism instead**: does it survive a ClientRouter swap,
  does a shared plan round-trip through the account, does CLS stay in budget, do
  targets clear 24 px, did a fixture go missing. Those caught four real defects
  in the same run. Before adding a browser test, ask what its failure would
  mean; if the answer is not "something is broken in a way you cannot see by
  looking", don't add it.
- `mise run check` is the fast unit pass (no server). `mise run e2e` builds,
  serves via wrangler and drives Chromium (`e2e/*.pw.ts` — named `.pw.ts` so
  vitest's default `*.spec/test.*` include never picks them up). Navigation
  regressions are only visible there. It **gates `release.yml` directly** — a
  tag push re-runs it regardless of which paths the tagged diff touched — and
  runs on push/PR per `.github/workflows/e2e.yml`. Do not narrow the trigger
  paths without checking whether the change could regress the flagship flow
  through a path that's no longer watched.
- **The browser suite replays recorded `/api/*` responses by default**
  (`e2e/fixtures.ts` installs the layer for every test via `e2e/harness.ts`;
  the responses are committed under `e2e/fixtures/api/`). That is what makes it
  ~25 s, deterministic and runnable offline. Two things keep it honest:
  a **miss is recorded, then fails the run in teardown**, so a fixture gap is
  never silently a live call and never reappears; and `e2e/contract.pw.ts`
  asserts — against LIVE upstream — the facts the fixtures bake in (MTDT kull
  2026's five period-1 courses, TMA4400 partitioning lectures by programme,
  the TDT4109×TDT4120 clash, BSPL's Ø-coded campus waypoint). Those tests are
  skipped by default and run on the nightly schedule, which is the only thing
  that can notice upstream moving. When one fails, `mise run e2e:record`
  refreshes the store; `mise run e2e:live` runs everything against live.
  `/api/health` is deliberately NOT intercepted — `navigation.pw.ts` reads the
  worker's real security headers off it, and a replayed response would answer
  that with headers captured at some past moment. `/api/sync/*` is the other
  carve-out, for a different reason: it's our own surface, not NTNU's, so
  replaying it would assert against a recording of our own worker instead of
  exercising it. It runs against `wrangler dev`'s local KV instead, which
  provisions a namespace from the `SYNC` binding with no Cloudflare account
  needed, so `mise run e2e` round-trips real accounts through the real
  handler and stays offline.
- **`/user/<navn>` — three things a reasonable person would undo.** (a) The
  page is kept out of search by the `X-Robots-Tag` header, and **`robots.txt`
  must never carry `Disallow: /user/`**: a blocked crawl means Google never
  reads the noindex directive and can still list the bare URL, which is the
  exact failure the header avoids. (b) It **still unfurls richly**, because
  indexers and unfurlers are different crawlers — Slack, iMessage and Discord
  read the `og:` tags the worker rewrites in and do not consult
  `X-Robots-Tag`. Both hold on the same response, on purpose. (c) The worker
  asks the asset server for the DIRECTORY (`/user/`), never for
  `/user/index.html`: the asset server answers the explicit file with a 307 to
  the directory, and handing that redirect on lands the browser at `/user/` —
  a path the route does not match — so the page arrives with no noindex
  header, no unfurl rewrite and no name to look up. A unit test pins what it
  asks for rather than what came back.
- `wrangler.jsonc` binds `SYNC` to the placeholder id `local-sync-dev` for
  local dev only — `wrangler dev` (no `--remote`) accepts a placeholder with
  no Cloudflare account, which is what the previous bullet's local-KV e2e run
  depends on; a `--remote` run or a real `wrangler deploy` rejects it.
  `release.yml` has a precheck, run right after the version-tag check and
  before the build, that greps `wrangler.jsonc` for `local-sync-dev` and
  fails the release outright if it's still there. Replace it with a real
  namespace id (`npx wrangler kv namespace create SYNC`) before tagging a
  release; don't remove or loosen the precheck to unblock a tag — that is
  exactly the failure it exists to catch.
- Two-pass typecheck (Workers vs Node ambient types clash):
  `worker/tsconfig.json` + `tsconfig.test.json`; keep Workers-only ambient
  types out of files the Node pass includes (structural interfaces instead).
- Biome's `.astro`-frontmatter `noUnusedVariables`/`noUnusedImports` false
  positives (template bindings Biome's `.astro` parser doesn't see) are
  disabled **per-file** via `biome.json`'s `overrides` for `**/*.astro`
  only — not globally. CI runs `biome check --error-on-warnings`, so a real
  dead import anywhere else now fails the gate; don't widen the override
  glob to make a new warning disappear without checking it's the same known
  false positive.
- Workflow split mirrors ntnu-api/ntnu-mcp: `ci.yml` (push/PR checks),
  `e2e.yml` (browser suite, see above), `release.yml` (tag-driven deploy:
  `npm version <bump> && git push --follow-tags`), `crawl.yml` (nightly
  data redeploy; no-ops without Cloudflare secrets). Keep the crawler
  polite: identifying UA, request gaps, no retry layer outside ntnu-api's
  HttpClient.
- **`tests/copy.test.ts` is a gate, not a style note.** No `—` and no `·` may
  reach a string a student can read, anywhere in `src/` or `worker/`, **and no
  substitute mark** — not `–`, not `|`, not a hyphen standing in for one. The
  rewrite rule is *prose becomes sentences, data rows become spaced fields*;
  subpage `<title>`s drop the brand suffix rather than substitute a separator.
  It also enforces **name what shows up, never announce that it is finished**:
  "tegne uka" is banned in every inflection, and so is "så er uka klar" / "uka
  er klar" and the same shape around *timeplanen*/*ukeplanen*. Write the
  visible outcome instead — "så lages timeplanen din", "så vises ukeplanen".
  The test strips comments before scanning, so code comments and the four docs
  keep their heavily em-dashed register on purpose — that asymmetry is
  deliberate and is not a bug in the test. When it fails, rewrite the string;
  do not loosen the regex, and do not add an exemption list.
- **The planner's first-run screen has three non-obvious rules**
  (`docs/DESIGN.md` §9 has the reasoning). (a) Its predicate is
  `html:not([data-plan])`, which the pre-paint probe already writes — do not
  replace it with a JS-set class, because the whole point is painting with the
  document. (b) It is gated one-way per page-load via `data-planner-ready`:
  `data-plan` describes the CURRENT semester, so without the latch switching to
  an empty term throws a mid-visit student back to onboarding *and* hides the
  semester control that is their way out. (c) The screen and the studieinfo
  dialog mount the same `buildStudieinfoSection`, which hard-codes its element
  ids — so the dialog is built lazily on first open and the screen's section is
  removed once a plan exists. Two live instances collide on every id.
- `mise run check` and `mise run e2e` must both stay green; UI copy is
  Norwegian bokmål, sentence case, comma decimals ("7,5 sp").
