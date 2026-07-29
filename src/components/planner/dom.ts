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

/**
 * Lucide's `settings-2` (https://lucide.dev — ISC), inline.
 *
 * `Icon.astro` owns the set, but an Astro component cannot be reached from a
 * module that builds its DOM at runtime — so the one glyph the course rows
 * need lives here. Keep the two in step if the set changes.
 */
export function settingsIcon(): SVGSVGElement {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const [tag, attrs] of [
    ["path", { d: "M20 7h-9" }],
    ["path", { d: "M14 17H5" }],
    ["circle", { cx: "17", cy: "17", r: "3" }],
    ["circle", { cx: "7", cy: "7", r: "3" }],
  ] as const) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    svg.append(node);
  }
  return svg;
}

/** A `.np-dot` square carrying a course hue via the `--dot` custom property. */
export function dot(hueVar: string): HTMLSpanElement {
  const span = el("span", "np-dot");
  span.style.setProperty("--dot", `var(${hueVar})`);
  return span;
}

/**
 * A credit figure on its own: "7,5", "30", "0". Comma decimals, one decimal
 * place — the single formatter every credit number goes through, so "7.5"
 * can never appear eight lines above "7,5 sp" again (D3).
 */
export function formatCreditNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}

/** Formats a credit total per DESIGN.md/PLANNER.md: comma decimals, "X av 30 sp". */
export function formatCredits(total: number): string {
  return `${formatCreditNumber(total)} av 30 sp`;
}

/** Month names as `formatShortDate` prints them — shared so the exam band
 *  and the dates under it cannot disagree about what a month is called. */
export const MONTH_ABBR = [
  "jan",
  "feb",
  "mar",
  "apr",
  "mai",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "des",
];

/** `"2026-12-09"` → `"9. des"`. Returns the input verbatim if it isn't an ISO date. */
export function formatShortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return iso;
  const month = MONTH_ABBR[Number(m[2]) - 1];
  if (!month) return iso;
  return `${Number(m[3])}. ${month}`;
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

/**
 * Case/diacritic-insensitive fold (Æ/Ø/Å -> a/o/a), matches /emner/'s search.
 *
 * The pre-map is not decoration. NFD decomposes Å (A + combining ring) but Æ
 * and Ø are *atomic* letters with no combining form, so the mark strip alone
 * left `fold("Økonomi") === "økonomi"` and typing "okonomi" found nothing —
 * on a site with 238 Ø/Æ course codes and Ø-initial programme names (C4).
 */
export function fold(value: string): string {
  return value
    .replace(/[æÆ]/g, "a")
    .replace(/[øØ]/g, "o")
    .replace(/[åÅ]/g, "a")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
