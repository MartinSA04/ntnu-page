# ntnu-page

Uoffisiell nettside for NTNU-emnedata: emnekatalog med søk, emnedetaljer,
karakterstatistikk (HK-dir/DBH), timeplaner, studieprogram og studieplaner.

Astro static site + Cloudflare Worker in one deployable unit: the Worker
serves the built site via Workers Assets and exposes a cached `/api/*` layer
over the [`ntnu-api`](https://github.com/MartinSA04/ntnu-api) client. Design
system ported from [StudyCompanion](https://github.com/MartinSA04/StudyCompanion)
(see `docs/DESIGN.md`). Architecture and contracts: `docs/SPEC.md`.

## Data flow

- **Crawled nightly** (`data/` + `public/data/` — gitignored build artifacts,
  never committed): course catalog (`searchAll`), study-program catalog,
  semesters — ~10 upstream requests. Static pages (`/emne/[code]`,
  `/studier/[code]`) and the client-side search index are built from these and
  ship only as part of the deployed site. `npm run build` crawls automatically
  if the files are missing (`prebuild` guard); `.github/workflows/
  nightly-crawl.yml` crawls fresh + rebuilds on a cron once the repo is on
  GitHub (deploy step still commented out).
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

## Not wired up yet

- No GitHub remote; no Cloudflare deploy.
- KV cache: create with `npx wrangler kv namespace create CACHE`, then add the
  binding in `wrangler.jsonc` (worker runs memory-only cache without it).
- Custom domain route commented out in `wrangler.jsonc`
  (`ntnu.martinsundal.no` is a placeholder — rename freely).
