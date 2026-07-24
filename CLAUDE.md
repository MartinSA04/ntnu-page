# CLAUDE.md

- `docs/SPEC.md` is the binding contract (topology, data/API shapes, page
  inventory); `docs/DESIGN.md` is the design system (ported verbatim from
  StudyCompanion — its named rules and §7 adjudicated decisions apply).
- Never edit `src/styles/{fonts,tokens,base,primitives}.css` or
  `src/styles/fonts/` — they are vendored from StudyCompanion; re-port from
  that repo instead of diverging.
- `data/*.json` + `public/data/search-index.json` are crawler output
  (`npm run crawl`) — gitignored build artifacts, baked into each deploy;
  don't hand-edit and don't commit. `prebuild` runs `crawler/ensure-data.mjs`
  to crawl automatically on a fresh checkout.
- Upstream NTNU endpoint knowledge lives in the `ntnu-api` package only
  (same layering rule as ntnu-mcp); this repo consumes its public client.
- Two-pass typecheck (Workers vs Node ambient types clash):
  `worker/tsconfig.json` + `tsconfig.test.json`; keep Workers-only ambient
  types out of files the Node pass includes (structural interfaces instead).
- Biome reports ~40 `noUnusedVariables/noUnusedImports` warnings in `.astro`
  frontmatter — known false positives (template bindings), exit code stays 0;
  don't "fix" them.
- `mise run check` must stay green; UI copy is Norwegian bokmål.
