/**
 * KARAKTERER — the grade-distribution figure on `/emne/[code]/`.
 *
 * The worker has served `/api/course/:code/grades` (DBH table 308, cached for
 * a semester) since the API layer was built and nothing had ever rendered it.
 *
 * **Form: small multiples, one simple bar chart per semester.** The obvious
 * alternative — a 100 %-stacked bar per semester — needs six mutually
 * distinguishable colours for A–F, and the palette validator rejected every
 * such ramp built from this design system: the best adjacent pair came out at
 * ΔE 6.9 for normal vision, well under the 15 floor. Small multiples need
 * exactly ONE colour for the whole figure, so the problem disappears and the
 * charts stay comparable through a shared y-scale instead.
 *
 * **Colour: `--hue-blue`, and deliberately not red for F.** DESIGN.md's
 * Red-Is-Collision reserves red for coexistence failures; a fail rate is not a
 * collision. The token is already theme-aware (#205ea6 / #4385be) and both
 * steps pass the validator's six checks against their own surface.
 *
 * Every bar is labelled with its own percentage, so the figure needs no y-axis
 * and no legend: six bars is not a dense series, and the labels are also the
 * table view an unlabelled chart would owe.
 */

import {
  buildGradeSemesters,
  type GradeRowInput,
  type GradeSemester,
  peakPercent,
} from "../../lib/planner/grades.js";
import { el } from "../planner/dom.js";

/** Semesters drawn at once. Six is three years — enough to see a trend. */
const MAX_SEMESTERS = 6;
/** Chart plot height in px. The bars scale within this. */
const PLOT_HEIGHT = 96;

/** "30,4" — one decimal, comma separator, per the repo's number rule. */
function formatPercent(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/** One semester's chart: a heading, the bars, and the candidate count. */
function renderSemester(semester: GradeSemester, peak: number): HTMLElement {
  const figure = el("figure", "grades-chart");

  const caption = el("figcaption", "grades-chart-head");
  caption.append(el("span", "np-data grades-chart-term", semester.label));
  caption.append(el("span", "grades-chart-count", `${semester.candidates} kandidater`));
  figure.append(caption);

  const plot = el("div", "grades-plot");
  plot.style.setProperty("--grades-plot-h", `${PLOT_HEIGHT}px`);

  for (const bar of semester.bars) {
    const column = el("div", "grades-bar-col");
    // The label doubles as this chart's table view, so it is always present
    // rather than shown on hover.
    column.append(el("span", "np-data grades-bar-value", formatPercent(bar.percent)));

    const track = el("div", "grades-bar-track");
    const fill = el("div", "grades-bar");
    // Against the shared peak, not this semester's own max: that is what
    // makes six charts on one page comparable to each other.
    const height = peak > 0 ? (bar.percent / peak) * 100 : 0;
    fill.style.height = `${height}%`;
    track.append(fill);
    column.append(track);

    column.append(el("span", "np-data grades-bar-grade", bar.grade));

    column.setAttribute(
      "aria-label",
      `${bar.grade}: ${bar.count} av ${semester.candidates} kandidater, ${formatPercent(bar.percent)} prosent`,
    );
    column.setAttribute("role", "img");
    // Native tooltip: the exact count, which the visible label trades for the
    // share. No custom tooltip layer for one integer.
    column.title = `${bar.grade} · ${bar.count} kandidater · ${formatPercent(bar.percent)} %`;
    plot.append(column);
  }

  figure.append(plot);

  if (semester.masked > 0) {
    figure.append(
      el(
        "p",
        "np-note grades-masked",
        `${semester.masked} ${semester.masked === 1 ? "karakter er" : "karakterer er"} skjermet av personvernhensyn`,
      ),
    );
  }

  return figure;
}

/**
 * Fetches and renders the figure into `#grades-section`. Silent about its own
 * absence: a course DBH has never recorded (new, tiny, or purely externally
 * examined) says so in one line rather than rendering an empty frame.
 */
export async function mountGradeChart(code: string, signal?: AbortSignal): Promise<void> {
  const section = document.getElementById("grades-section");
  const status = section?.querySelector<HTMLElement>('[data-role="status"]');
  const body = section?.querySelector<HTMLElement>('[data-role="body"]');
  if (!section || !status || !body || !code) return;

  try {
    const res = await fetch(`/api/course/${encodeURIComponent(code)}/grades`, { signal });
    if (!res.ok) throw new Error(`${res.status}`);
    const payload = (await res.json()) as { rows?: GradeRowInput[] };
    const semesters = buildGradeSemesters(payload.rows ?? [], MAX_SEMESTERS);

    if (semesters.length === 0) {
      status.textContent = "Ingen karakterstatistikk registrert for dette emnet.";
      return;
    }

    const peak = peakPercent(semesters);
    const grid = el("div", "grades-grid");
    for (const semester of semesters) grid.append(renderSemester(semester, peak));

    body.replaceChildren(grid);
    body.append(
      el(
        "p",
        "np-hint grades-source",
        "Andel av kandidatene som fikk hver karakter. Kilde: DBH (Database for statistikk om høyere utdanning).",
      ),
    );
    body.hidden = false;
    status.hidden = true;
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return;
    status.textContent = "Fikk ikke hentet karakterstatistikk.";
  }
}
