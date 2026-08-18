/**
 * Categorical course-identity hues (docs/DESIGN.md §2). Six custom
 * properties — green is the verdict ("it fits") and red is collision ink, so
 * neither is ever assigned here.
 *
 * **Assigned from the course CODE, not from its position in the plan.** These
 * cycled by insertion order until 2026-08-01, which meant colour identity —
 * the calendar's memory, and the only thing carrying a course across the week,
 * the exam list and the course rail — was a function of what else happened to
 * be in the plan. Dropping TMA4400 moved TMA4412 indigo→purple and EXPH0300
 * orange→indigo; adding did the same. That is worst for exactly the user the
 * palette exists for: comparing two electives is add → read → drop → add, and
 * the plan repainted on all four steps. It also meant two people opening the
 * same shared link could see different colours, which quietly breaks the
 * shareable plan as a shared object.
 *
 * The honest limit: a hue that is BOTH stable under edits AND distinct within
 * the plan cannot be a pure function of one code — six buckets and five
 * courses collide most of the time, and resolving a collision has to consider
 * the other courses. So the guarantee is drawn one level up and stated
 * exactly: **the assignment is a deterministic function of the plan's set of
 * codes.** The same set always yields the same colours regardless of the order
 * they were added in (sender and recipient agree), and an edit can only move a
 * course that was actually displaced by a collision — not every course after
 * it in the list.
 */
export const PLAN_HUES = [
  "--hue-blue",
  "--hue-cyan",
  "--hue-purple",
  "--hue-indigo",
  "--hue-orange",
  "--hue-rose",
] as const;

export type PlanHue = (typeof PLAN_HUES)[number];

/**
 * FNV-1a over the code's UTF-16 units. A hash rather than a character sum
 * because sums put anagram-ish neighbours (TDT4109 / TDT4190) in the same
 * bucket, and a plan is mostly courses that share a three-letter prefix and
 * differ in one digit — precisely the input a weak hash spreads worst.
 */
function hash(code: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < code.length; i++) {
    h ^= code.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A code's own ranking of all six hues — its first choice, then what it wants
 * INSTEAD when that one is taken, and so on.
 *
 * Ranked per (code, hue) rather than "the next one clockwise from the first
 * choice", because clockwise makes every displaced course fall onto the same
 * neighbour: MTDT kull 2026 has three courses whose first choice is indigo, and
 * clockwise marched all three across orange and green in a row. Ranking each
 * hue independently spreads the losers the same way it spreads the winners.
 */
function preference(code: string): PlanHue[] {
  const upper = code.toUpperCase();
  return [...PLAN_HUES].sort((a, b) => hash(`${upper}:${a}`) - hash(`${upper}:${b}`));
}

/** The hue a code wants before anything else in the plan is considered. */
export function naturalHue(code: string): PlanHue {
  return preference(code)[0] as PlanHue;
}

/**
 * Hues for a whole plan, keyed by code.
 *
 * Sorted rather than taken in insertion order, so the result depends on the
 * SET and not on the sequence of edits that produced it — two students who
 * built the same plan in different orders, and a shared link opened by
 * someone who never built it at all, all see one week.
 *
 * A code takes the highest hue on its own preference list that is still free.
 * Past six courses the palette is exhausted and hues repeat, which is the
 * palette's own limit rather than a fallback: six is what DESIGN §2 allows once
 * the verdict's green and the collision's red are spent.
 */
export function assignHues(codes: readonly string[]): Map<string, PlanHue> {
  const out = new Map<string, PlanHue>();
  const taken = new Set<PlanHue>();
  for (const code of [...new Set(codes)].sort((a, b) => a.localeCompare(b, "nb"))) {
    const wanted = preference(code);
    const hue = wanted.find((candidate) => !taken.has(candidate)) ?? (wanted[0] as PlanHue);
    taken.add(hue);
    out.set(code, hue);
  }
  return out;
}
