/**
 * The one thing every page needs from the studieinfo dialog: the name of the
 * `window` CustomEvent that opens it.
 *
 * It lives in its own leaf module because `Layout.astro` — which renders on
 * every page — used to import the constant straight from `studieinfo.ts`, and
 * a named import of a string constant is not tree-shakeable across an Astro
 * client bundle: the built Layout entry began `import{O as s}from
 * "./studieinfo.D5p2DPur.js"`, so `/` and `/emner/` each downloaded, parsed
 * and evaluated 11 941 B (4 422 B gzip, ~27 % of the homepage's JS) of
 * programme-dialog code they can never run (perf-4).
 *
 * Nothing else belongs here. The moment this module imports anything, the
 * cost comes back.
 */
export const OPEN_STUDIEINFO_EVENT = "np:open-studieinfo";
