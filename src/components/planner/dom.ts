/**
 * Tiny DOM-builder helpers shared across the planner modules (mirrors the
 * pattern already used in src/components/site/*.ts).
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A `.np-dot` square carrying a course hue via the `--dot` custom property. */
export function dot(hueVar: string): HTMLSpanElement {
  const span = el("span", "np-dot");
  span.style.setProperty("--dot", `var(${hueVar})`);
  return span;
}

/** Formats a credit total per DESIGN.md/PLANNER.md: comma decimals, "X av 30 sp". */
export function formatCredits(total: number): string {
  const rounded = Math.round(total * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
  return `${text} av 30 sp`;
}

const DAY_NAMES = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];

export function dayName(dayNumber: number): string {
  return DAY_NAMES[dayNumber - 1] ?? `dag ${dayNumber}`;
}

/** "uke 35–41" style label from a sorted, deduplicated list of ISO week numbers. */
export function weekLabel(weeks: number[]): string {
  if (weeks.length === 0) return "";
  // Collapse consecutive runs into ranges: [35,36,37,41] -> "35–37, 41".
  const ranges: string[] = [];
  let start = weeks[0] as number;
  let prev = start;
  for (let i = 1; i <= weeks.length; i++) {
    const w = weeks[i];
    if (w !== undefined && w === prev + 1) {
      prev = w;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    if (w !== undefined) {
      start = w;
      prev = w;
    }
  }
  return `uke ${ranges.join(", ")}`;
}

/** Case/diacritic-insensitive fold (Æ/Ø/Å -> A/O/A), matches /emner/'s search. */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
