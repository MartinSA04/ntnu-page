# ntnu-page — Semesterplan

Uoffisiell timeplan for NTNU: velg studieprogram og kull (eller legg til
emnekodene selv), og se ukeplanen med rom og eksamensdatoer med en gang.
Ingen innlogging, ingen deling, alt ligger i nettleseren din.

Emnesiden og karakterstatistikken ligger hos dem som eier dem: hvert emne i
planen lenker til `ntnu.no` og `karakterweb.no`.

Astro static site + Cloudflare Worker in one deployable unit: the Worker
serves the built site via Workers Assets and exposes a cached `/api/*` layer
over the [`ntnu-api`](https://github.com/MartinSA04/ntnu-api) client.

## Docs

| File | What it decides |
|---|---|
| [`docs/PRODUCT.md`](docs/PRODUCT.md) | **The product definition.** Mandate, positioning, flows, feature status, the domain rules (DR-1…DR-10) and the decisions that stay decided. |
| [`docs/DESIGN.md`](docs/DESIGN.md) | The design system: colour, type, the `.np-*` primitives, the week's own rules, motion, voice. Its named rules are binding. |
| [`docs/SPEC.md`](docs/SPEC.md) | Architecture and data contracts: module layout, the crawled-data shapes, the worker API, testing. |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | What is shipped and what is left, in order. |

`CLAUDE.md` holds the non-obvious invariants — the fixes a reasonable person
would undo.

## Data flow

- **Crawled nightly** (`data/` + `public/data/` — gitignored build artifacts,
  never committed): the course catalog via `searchAll`, **two catalog years
  unioned** (the canonical one and `year - 1`, so a course taught last year
  still gets a page), the study-programme catalog, and semesters — ~20
  upstream requests. Static pages (`/emne/[code]`) and the client-side search
  index are built from these and ship only as part of the deployed site.
  `npm run build` crawls automatically if the files are missing (`prebuild`
  guard). The crawler is deliberately polite: an identifying user agent,
  ~500 ms gaps, a stable sort for dedup-friendly pagination, and
  retry/backoff left entirely to `ntnu-api` (which honours `Retry-After`).
- **Live via `/api/*`** (per course, cached memory → KV with per-datatype
  TTLs): course details (6 h), grade distributions (24 h), timetables (1 h),
  study plans (24 h). Only viewed courses hit upstream.

## Commands

```sh
npm run crawl      # refresh data/*.json + public/data/search-index.json
npm run build      # astro build → dist/
npm run preview    # wrangler dev: built site + live /api on :8787
npm run dev        # astro dev on :4321 (/api proxied to :8787 — run preview too)
mise run check     # lint + typecheck + tests
mise run e2e       # browser suite over recorded /api fixtures
mise run e2e:live  # same suite against live NTNU, plus the contract checks
```

## Workflows

- `ci.yml` — lint + typecheck + tests + build smoke on push/PR. Crawl
  artifacts come from a date-keyed Actions cache, so CI rarely crawls at all.
- `e2e.yml` — the Playwright suite against a real build and wrangler dev
  server. Runs on PRs touching `src/lib/planner/**`,
  `src/components/planner/**` and `worker/**`, plus a nightly schedule
  (upstream data drifts independently of any commit). This is the only
  end-to-end check of the "programme + kull → your week" flow.
- `release.yml` — tag-driven deploy: `npm version <bump> && git push
  --follow-tags` re-runs checks, crawls fresh, **runs the e2e suite**, then
  builds, `wrangler deploy`s, and cuts a GitHub Release. Needs
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The e2e run gates every
  deploy directly, regardless of which paths the tagged diff touched.
- `crawl.yml` — nightly (03:47 UTC) crawl + rebuild + redeploy, so baked data
  stays fresh without a code release. No-ops entirely until the Cloudflare
  secrets exist, so no upstream requests are wasted.

## Not wired up yet

- No GitHub remote; no Cloudflare deploy (the workflows activate once the repo
  is pushed and the two Cloudflare secrets are added).
- KV cache: create with `npx wrangler kv namespace create CACHE`, then add the
  binding in `wrangler.jsonc` (the worker runs memory-only without it).
- Custom domain route commented out in `wrangler.jsonc`;
  `ntnu.martinsundal.no` is a placeholder. It appears in **two** places that
  must agree — `astro.config.mjs`'s `site` and `public/robots.txt`'s
  `Sitemap:` line — and `tests/site/discoverability.test.ts` is what notices
  if they stop agreeing.
