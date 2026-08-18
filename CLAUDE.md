# CLAUDE.md

- **2026-08-18: the site was cut to a timetable getter.** Accounts, sync, the
  shared plan at `/user/<navn>`, `/emne/[code]/` and its ~5 470 built pages,
  `/emner/`, the grade figure and the whole verdict apparatus are deleted.
  `docs/superpowers/specs/2026-08-18-timetable-only-reduction-design.md` is the
  order and `docs/PRODUCT.md` §11 is the list. Two pages remain, `/` and
  `/planlegger/`, and `localStorage` is the only store there is. **Do not
  restore any of it from an older paragraph elsewhere in the repo.**
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
  The planner's add dialog — the only search surface left — omits those rows
  from the list *and* from the count: its window is twelve rows deep and
  "matematikk" spent six of them on courses it was refusing to add. When a
  query matches only such courses the dialog says so specifically instead of
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
  still what gates the first-run screen, and `--plan-courses` sizes every
  reservation, so neither the probe nor the attribute is dead.
  (b) **the week's height, held from first paint** — the paint→mount half,
  worth 0.52 of the 0.61 on its own (`renderWeekSkeleton` already stops the
  loading→data reflow, which is the other half). **Each view reserves its own
  height**: Uke is the drawn hours × `--planner-hour-h`, Liste is a session
  count and has no formula at all, and reserving one for the other is worse
  than reserving nothing (0.14 CLS). Three surfaces draw those two views, and
  they do NOT all reserve the same way.
  `/planlegger/`'s frame is in the static shell, so it reserves on the FRAME
  and can be handed a remembered height: `saveWeekBox`/`--planner-box` files
  what the week actually measured under **(surface, view, width)** and the
  probe writes it back before paint. The surface is still in the key though
  only one surface draws a week now; the width is in it because a list measured
  at 390px wraps differently at 1440, and it is discarded outside a 32px
  tolerance.
  **Both fallbacks were re-measured on 2026-08-18** and both moved: Uke's is
  8.75 hours rather than 8 (a five-course week settles at 512px against the
  471px eight reserved), and `.planner-course-rows` is 3.5rem per row rather
  than 3 (the row grew a second line when it took the two outbound links).
  Together they were 0.10 CLS of the page under the week moving. Re-measure
  before changing either.
  **The probe's default view must match `loadWeekView`'s** (`kolonner`), or a
  cold load reserves for a view it is not about to draw. And **the per-view
  rules are COMPOUND selectors, not descendant ones**: `data-view` and
  `data-surface` are both written on `<html>`, so
  `html[data-view="tavle"] [data-surface="planner"]` asked for an element
  carrying the surface *inside* an html carrying the view, which does not exist.
  That typo meant Liste's reservation never applied at all — it fell through to
  Uke's and held 486px for a week that settles at 812 (three courses, 1280px,
  measured 2026-08-04). Neither the CLS budget nor the lease tests caught it,
  because both measure the RELEASE. All of it is a
  **lease**: `--planner-box` holds the height of the view the page LOADED in,
  so a reservation that never ends kept Liste's 829px around the other view's
  much shorter week the moment the student pressed the other tab (600px of
  white paper above the exam list, for the rest of the visit). `weekView`'s
  `settle` releases on the first drawn week and `setWeekView` on the way out of
  a view. A gate for this needs a **one-course** plan — a full plan draws a
  week taller than every reservation, so slack is zero whether or not the lease
  is released, and the first version of that test passed with both halves
  disabled. On the course page a CLS budget cannot gate it at all: the section
  sits low enough that everything it displaces is below the fold, so
  `e2e/cls.pw.ts` asserts the reservation against what the section actually
  settles at instead.
  (c) **leases** — `data-reserve` attributes that JS deletes on reaching a
  terminal state. Deleting
  one is not optional: a reservation left standing over a short answer is a
  permanent hole, which is why the failure and empty branches release them too.
  Reservations are deliberately a few px UNDER their measured settle, so the
  residual nudges down rather than snatching content upward. `e2e/cls.pw.ts`
  gates all of it with per-surface budgets — verified to fail when (b) is
  removed. Re-measure before changing any number; do not "tidy" a
  `min-height` you cannot see doing anything.
- **The week's three controls are ONE server-rendered component, and
  `mountWeekView` owns everything in it** (`src/components/WeekControls.astro`).
  Two rows: the week picker, then the layer box hard left and the Uke/Liste
  switch hard right with **nothing ever between them**. Three things here are
  load-bearing. (a) **No ids** — every control is found by `data-role` inside
  the block the page hands over, which is what let three surfaces carry three
  copies; the old `idPrefix` scheme and the runtime twins `buildWeekTabs` /
  `buildLayerToggle` are **deleted**. One surface draws a week now, and the
  `data-role` contract stays because it costs nothing and an id contract is
  what has to be undone if a second ever appears. (b) It stays
  **server-rendered**: building a control at mount pops it in a frame late, on
  top of a frame already reserving its own height. (c) The picker sits **above** the other two rather than beside
  them because three controls come to ~400px against 358px of content at 390px,
  so sharing a row would silently give the phone a different arrangement.
  The picker narrows through `entriesInWeek` inside `collectSessions` — one
  option on one function, so the two views cannot disagree — and it is a
  **lease** like the view switch: changing weeks releases the frame's
  reservation. It is **not persisted and not in the URL** (one link shows two
  people the same week); its default is `inTeachingWeek`, the same predicate
  that decides whether the drawn week carries dates, so the picker and the
  column headers cannot disagree about whether this is a real Monday. The
  margin notes are **not** narrowed with the grid: a course missing from the
  whole plan is not a fact about the week you happen to be looking at.

- **Every dismissal is decided on the CLICK, and a modal surface has a visible
  scrim.** A touch synthesises `mousedown`/`mouseup`/`click` only after
  `touchend`, i.e. after `pointerup`, so anything that dismisses at or before
  `pointerup` is gone when its own click is dispatched and the browser
  hit-tests that click against the page underneath: one tap closed the surface
  AND pressed the control behind it. The click is the last event of the
  gesture, so a dismissal decided there has nothing trailing it. Four things
  here look wrong and are not.
  (a) **`closedby="any"` is deliberately NOT used** — `src/lib/dialogDismiss.ts`
  hand-wires the backdrop click for all four modals instead, and `closedby`
  stays on as `"closerequest"` for Esc and the close watcher. Two reasons: the
  attribute is Chrome 134+/Firefox 141+ and still "preview" on Safari and iOS,
  so on an iPhone it did nothing and those modals had no backdrop dismissal at
  all; and light dismiss is *defined* to close at `pointerup`, so it leaks its
  own click on touch (the same algorithm backs `popover=auto`, which leaks with
  a mouse too — nothing inert to retarget through). Do not "simplify" this back
  to the attribute.
  (b) The helper requires the gesture to **begin** on the backdrop as well as
  end there, which is the property `closedby="any"` was chosen for: a text
  selection dragged out of the field and released on the backdrop must not
  dismiss. The bare `event.target === dialog` recipe gets this wrong, because
  the click's target is then the common ancestor, which is the dialog.
  (c) `blockPopover`'s sheet scrim closes on **`click`, not `pointerdown`**, so
  the scrim is still in the document to absorb it. (`menuPanel`'s did the same,
  and is deleted with the menu.)
  (d) The sheet scrim is **visibly dimmed**, not a transparent click-catcher,
  and exists **only below 60rem** — the anchored desktop card is non-modal over
  a live page and its pass-through is what lets one bar hand the card to the
  next (DESIGN §9).
  `e2e/touch.pw.ts` is the gate, and the only spec that asks for a phone
  viewport with `hasTouch`; the desktop project cannot see any of this.

- **There is ONE control height, at every pointer type.** `--control-h` is 36px
  and the `@media (pointer: coarse)` step to 44px is **deleted**: it bought hit
  area by making every phone layout taller, which is paying in the dimension a
  phone has least of. 36 clears WCAG 2.5.8 AA (24px) unaided and
  `e2e/flows.pw.ts` measures it. The thumb's reach is bought by a transparent
  pseudo-element that grows the hit rectangle past the painted box
  (`primitives.css`) — do not reintroduce the media query, and do not add a
  target to a control closer to its neighbour than the shortfall, because
  overlapping targets steal each other's taps.

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
  does CLS stay in budget, do targets clear 24 px, did a fixture go missing. Those caught four real defects
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
  BSPL's Ø-coded campus waypoint). Those tests are
  skipped by default and run on the nightly schedule, which is the only thing
  that can notice upstream moving. When one fails, `mise run e2e:record`
  refreshes the store; `mise run e2e:live` runs everything against live.
  `/api/health` is deliberately NOT intercepted — `navigation.pw.ts` reads the
  worker's real security headers off it, and a replayed response would answer
  that with headers captured at some past moment. It is the ONLY carve-out:
  `/api/sync/*` and `/api/plan/*` were the others, and both are deleted with
  the account. Every route left is a read of NTNU's data and should be
  replayed.
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
  document. (b) **The probe's two facts have different scopes on purpose:**
  `--plan-courses` is the CURRENT semester's row count (reservations are
  measured in rows being drawn), while `data-plan`'s presence means "a plan
  exists ANYWHERE", value `"elsewhere"` for one that is not in this term. That
  is what makes the screen reversible — emptying the plan brings it back —
  without throwing a student who switched to an empty semester into onboarding
  with the semester control hidden behind it. `syncFirstRun` must test the same
  thing the probe does; a JS predicate that disagrees leaves the page looking
  right while a second picker mounts into the hidden host. (c) The screen and
  the studieinfo dialog mount the same `buildStudieinfoSection`, which
  hard-codes its element ids — so the dialog is built lazily on first open and
  `destroy()`d when first run returns. Two live instances collide on every id.
- `.planner-context-field`, `.home-now-next li` and friends need `:global()`:
  Astro stamps its scoping attribute on what it *compiled*, and these nodes are
  built at runtime by `el()`, so a scoped selector matches nothing. The failure
  is silent and looks like a missing space ("Undervisning fra uke 34Høst 2026"),
  not like a broken build.
- `mise run check` and `mise run e2e` must both stay green; UI copy is
  Norwegian bokmål, sentence case, comma decimals ("7,5 sp").
