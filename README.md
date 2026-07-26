# ntnu-page — Semesterplan

Uoffisiell semesterplanlegger for NTNU: velg emner (eller hent dem fra et
studieprogram og kull), og se timeplankollisjoner, eksamensdatoer og
studiepoeng før du melder deg opp. Emnekatalog og studieplaner følger med.
Karakterstatistikk (HK-dir/DBH) is reachable via the worker's
`/api/course/:code/grades` endpoint but is not shown on any page today —
the browsable grade chart was removed from `/emne/[code]/` (it read as
DBH-mirror parasitism rather than helping a decision); a future season-split
shape in a decision context is the only planned return, see PRODUCT.md §6.

Astro static site + Cloudflare Worker in one deployable unit: the Worker
serves the built site via Workers Assets and exposes a cached `/api/*` layer
over the [`ntnu-api`](https://github.com/MartinSA04/ntnu-api) client.
**Product spec: `docs/PRODUCT.md`** (positioning, flows, MoSCoW, the domain
rules and decisions that bind the build); `docs/PLANNER.md` remains binding
only for the Ruteark render/interaction detail it specifies. Design system:
**Ruteark**, this repo's own (`docs/DESIGN.md`) — Flexoki paper, Schibsted
Grotesk + Spline Sans Mono (vendored as variable fonts), squared-ruling
signature. Architecture and contracts: `docs/SPEC.md`. What's shipped vs.
open: `docs/ROADMAP.md`.

## Data flow

- **Crawled nightly** (`data/` + `public/data/` — gitignored build artifacts,
  never committed): course catalog (`searchAll`), study-program catalog,
  semesters — ~10 upstream requests. Static pages (`/emne/[code]`) and the
  client-side search index are built from these and ship only as part of the
  deployed site (`/studier/[code]` was deleted 2026-07-25 — see PRODUCT.md
  §0 addendum). `npm run build` crawls automatically
  if the files are missing (`prebuild` guard). The crawler is deliberately
  polite: identifying user agent, ~500 ms gaps between requests, stable
  `+ntnucoursecode` sort for dedup-friendly pagination, and retry/backoff left
  entirely to `ntnu-api` (which honors `Retry-After`).
- **Live via `/api/*`** (per-course, cached memory→KV with per-datatype TTLs):
  course details (6h), grade distributions (24h), timetables/schedules (1h),
  study plans (24h). Only viewed courses hit upstream.

## Commands

```sh
npm run crawl      # refresh data/*.json + public/data/search-index.json
npm run build      # astro build → dist/
npm run preview    # wrangler dev: built site + live /api on :8787
npm run dev        # astro dev on :4321 (/api proxied to :8787 — run preview too)
mise run check     # lint + typecheck + tests
```

## Workflows (same split as ntnu-api / ntnu-mcp)

- `ci.yml` — lint + typecheck + tests + build smoke on push/PR. Crawl
  artifacts come from a date-keyed Actions cache so CI rarely crawls at all.
- `e2e.yml` — the Playwright suite (`e2e/*.pw.ts`) against a real build +
  wrangler dev server on live NTNU data. Runs on PRs touching
  `src/lib/planner/**`, `src/components/planner/**`, `worker/**`, plus a
  nightly schedule (upstream data can drift independently of any commit).
  This is the only end-to-end check of the "programme + kull → your week"
  flow; it was not wired into CI before and a regression could ship behind
  a green badge (see `docs/REVIEW.md` T1).
- `release.yml` — tag-driven deploy: `npm version <bump> && git push
  --follow-tags` re-runs checks, crawls fresh, **runs the e2e suite**, then
  builds, `wrangler deploy`s, and cuts a GitHub Release. Needs
  `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`. The e2e run gates every
  deploy directly, regardless of whether the tagged diff touched the paths
  `e2e.yml` watches.
- `crawl.yml` — nightly (03:47 UTC) crawl + rebuild + redeploy so baked data
  stays fresh without a code release. No-ops entirely until the Cloudflare
  secrets exist, so no upstream requests are wasted.

## Not wired up yet

- No GitHub remote; no Cloudflare deploy (workflows activate once the repo is
  pushed and the two Cloudflare secrets are added).
- KV cache: create with `npx wrangler kv namespace create CACHE`, then add the
  binding in `wrangler.jsonc` (worker runs memory-only cache without it).
- Custom domain route commented out in `wrangler.jsonc`
  (`ntnu.martinsundal.no` is a placeholder — rename freely).
