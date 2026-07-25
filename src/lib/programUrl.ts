/**
 * How a study-programme code becomes a URL.
 *
 * A handful of upstream programme codes contain a literal "/" ("EMNE/HF",
 * "MSØK/5"), which would otherwise split across two path segments. Astro's
 * dynamic segments pass non-ASCII codes ("ÅALIT", "MTIØT") through untouched,
 * so "/" is the only character that needs escaping.
 *
 * This lives in `src/lib/` rather than in the page because a `.astro` file
 * cannot be imported from a client module: `getStaticPaths`, the /studier/
 * listing links and the planner banner's back-link all have to agree, and the
 * planner is a plain `.ts` island. Two copies of an escaping rule drift the
 * day a code grows a second reserved character.
 */

/** `"MSØK/5"` -> `"MSØK%2F5"`. The path segment, not the whole URL. */
export function codeToSegment(code: string): string {
  return code.replaceAll("/", "%2F");
}

/** `"MSØK/5"` -> `"/studier/MSØK%2F5/"`. */
export function programHref(code: string): string {
  return `/studier/${codeToSegment(code)}/`;
}
