/**
 * Categorical course-identity hues (docs/DESIGN.md §2). Six custom
 * properties, cycling by selection order — green is the verdict ("it fits")
 * and red is collision ink, so neither is ever assigned here.
 */
export const PLAN_HUES = [
  "--hue-blue",
  "--hue-cyan",
  "--hue-purple",
  "--hue-magenta",
  "--hue-orange",
  "--hue-yellow",
] as const;

export type PlanHue = (typeof PLAN_HUES)[number];

/** The hue custom property for the course at insertion-order index `i` (cycles past 6). */
export function hueForIndex(i: number): PlanHue {
  const hue = PLAN_HUES[i % PLAN_HUES.length];
  if (hue === undefined) throw new RangeError("hueForIndex: index must be non-negative");
  return hue;
}
