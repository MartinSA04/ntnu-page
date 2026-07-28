/**
 * DR-1's lecture/øving split (PRODUCT.md, ROADMAP Phase §0).
 *
 * The *observations* — what NTNU's `title`/`name`/`acronym` fields mean, the
 * delivery-format buckets, the bucket-as-title rule, the misspellings, the
 * combined-session carve-out, the samling reading — now live in `ntnu-api`'s
 * `activity` module, where `ntnu-mcp` and any future consumer can reach them.
 * They are facts about upstream, and they were only ever here because this was
 * the first repo to need them. Read that module's header for the data the
 * keyword lists were built and scored against.
 *
 * What stays here is the *policy*, which is this product's and not the
 * library's: collapsing the library's five-way verdict to the binary the
 * planner reasons about.
 *
 * **DR-1's asymmetry is why the collapse goes this way.** Misclassifying an
 * øving as a lecture creates a *false red* — a collision the student does not
 * actually have, confidently wrong, the thing DR-1 exists to prevent.
 * Misclassifying a lecture as "other" only *hides* a real collision behind
 * the "vis øvinger og labber" toggle — silently degraded, not confidently
 * wrong, and the toggle layer still shows the entry as a muted block. So
 * everything that is not an unambiguous lecture becomes `"other"`, `unknown`
 * included.
 *
 * What this does NOT fix: ~22 % of course-terms classify as entirely
 * lecture-less, and most of them genuinely are (Kunstakademiet's "allmøte" and
 * "atelierflyt/rydding", the conservatory's "Gehør gruppe 1"). No keyword list
 * reaches those. They are handled by *saying so* — see `grid.ts`'s
 * lecture-less margin note — not by guessing.
 */

import { type ActivityLike, classifyActivity as classifyUpstream } from "ntnu-api";

export type { ActivityLike };

/**
 * What the planner reasons about: a slot either counts for hard-conflict
 * detection or it does not. `ntnu-api`'s finer `"exercise"`/`"lab"`/
 * `"seminar"`/`"unknown"` all collapse into `"other"` here — the planner
 * renders them identically (muted, non-clashing, behind the toggle), so a
 * distinction it cannot act on would only be one more thing to get wrong.
 */
export type ActivityKind = "lecture" | "other";

/**
 * Classify one timetable/schedule entry as `"lecture"` or `"other"`.
 *
 * `"lecture"` exactly when `ntnu-api` says so on unambiguous evidence;
 * everything else — including text it could not read at all — is `"other"`.
 */
export function classifyActivity(entry: ActivityLike): ActivityKind {
  return classifyUpstream(entry) === "lecture" ? "lecture" : "other";
}

/** Filters `entries` down to the ones `classifyActivity` calls `"lecture"`. */
export function lecturesOnly<T extends ActivityLike>(entries: T[]): T[] {
  return entries.filter((e) => classifyActivity(e) === "lecture");
}
