/**
 * DR-1's lecture/øving split (PRODUCT.md).
 *
 * The *observations* — what NTNU's `title`/`name`/`acronym` mean, the delivery
 * buckets, the misspellings, the samling reading — live in `ntnu-api`'s
 * `activity` module: they are facts about upstream. What stays here is the
 * *policy*, collapsing that five-way verdict to the binary the planner reasons
 * about.
 *
 * **DR-1's asymmetry is why the collapse goes this way.** Misclassifying an
 * øving as a lecture creates a *false red* — confidently wrong, the thing DR-1
 * exists to prevent. Misclassifying a lecture as "other" only hides a real
 * collision behind the toggle, which still shows the entry as a muted block. So
 * everything that is not an unambiguous lecture becomes `"other"`, `unknown`
 * included.
 *
 * What this does NOT fix: ~22 % of course-terms classify as entirely
 * lecture-less, and most genuinely are. No keyword list reaches those; they are
 * handled by *saying so* (grid.ts's lecture-less margin note), not by guessing.
 */

import { type ActivityLike, classifyActivity as classifyUpstream } from "ntnu-api";

export type { ActivityLike };

/**
 * What the planner reasons about: a slot either counts for hard-conflict
 * detection or it does not. `ntnu-api`'s finer verdicts all collapse into
 * `"other"` here — the planner renders them identically, so a distinction it
 * cannot act on would only be one more thing to get wrong.
 */
export type ActivityKind = "lecture" | "other";

/**
 * Classify one entry as `"lecture"` or `"other"`. `"lecture"` exactly when
 * `ntnu-api` says so on unambiguous evidence; everything else — including text
 * it could not read at all — is `"other"`.
 */
export function classifyActivity(entry: ActivityLike): ActivityKind {
  return classifyUpstream(entry) === "lecture" ? "lecture" : "other";
}

/** Filters `entries` down to the ones `classifyActivity` calls `"lecture"`. */
export function lecturesOnly<T extends ActivityLike>(entries: T[]): T[] {
  return entries.filter((e) => classifyActivity(e) === "lecture");
}
