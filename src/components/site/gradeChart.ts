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
 *
 * **What the shared scale is shared across.** One peak per grade scale, not
 * one per figure: a covid-era pass/fail term peaks near 100 % by construction
 * and used to flatten every letter chart beside it to a 4–29 px stub
 * (course-5/cpc-5). Semesters too small to carry a share (under
 * `MIN_CHART_CANDIDATES`) neither set the scale nor get bars — an n=3 term
 * drew the tallest bar on the page for a single candidate's grade.
 *
 * **What is not drawn at all.** DBH files the utsatt/kont sitting as its own
 * (year, semester), so a spring-taught course grows an autumn "semester" of
 * candidates who already failed once — newest, therefore leading the figure,
 * therefore read as this course's current difficulty (pc-2/cpc-6). Those
 * sittings are held out and named in a note. Which seasons are ordinary comes
 * from the scraped exam `occasion` via `isDeferredOccasion`, the same signal
 * (and the same fail-open stance) DR-3 uses on the planner's exam list.
 */

import {
  awardedBars,
  buildGradeSemesters,
  drawsChart,
  type GradeRowInput,
  type GradeSemester,
  MIN_CHART_CANDIDATES,
  peaksByScale,
} from "../../lib/planner/grades.js";
import { el } from "../planner/dom.js";
// One rule for "is this sitting deferred?", shared with the planner's exam
// list rather than restated here.
import { isDeferredOccasion } from "../planner/examList.js";
import { detailsUrl } from "./courseDetails.js";

/**
 * Ordinary semesters kept at all — three years for a course taught in both
 * terms, six for a one-term one. The cap counts ordinary sittings only, so
 * holding the utsatt ones out lengthens the history rather than shortening it.
 */
const MAX_SEMESTERS = 6;
/** Charts shown up front; the rest fold into a disclosure (course-4). */
const VISIBLE_SEMESTERS = 3;
/** Chart plot height in px. The bars scale within this. */
const PLOT_HEIGHT = 96;

/** "30,4" — one decimal, comma separator, per the repo's number rule. */
function formatPercent(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/**
 * The caption's right-hand fact. The scale is named where it is not the
 * A–F one a reader assumes, because two bars at "82,5 %" and "20,8 %" are
 * not comparable across scales however alike they look.
 */
function countLabel(semester: GradeSemester): string {
  const base = `${semester.candidates} kandidater`;
  if (semester.scale === "passfail") return `${base} · bestått/ikke bestått`;
  if (semester.scale === "mixed") return `${base} · to karakterskalaer`;
  return base;
}

/** The sentence a semester gets in place of a plot. */
function semesterNote(semester: GradeSemester): string {
  const awarded = awardedBars(semester);
  if (semester.candidates >= MIN_CHART_CANDIDATES && awarded.length === 1) {
    return `Alle kandidatene fikk ${awarded[0]?.grade}.`;
  }
  const listed = awarded.map((bar) => `${bar.grade} ${bar.count}`).join(" · ");
  return `For få kandidater til å vise andeler: ${listed}.`;
}

/** One semester's chart: a heading, the bars, and the candidate count. */
function renderSemester(semester: GradeSemester, peak: number): HTMLElement {
  const figure = el("figure", "grades-chart");

  const caption = el("figcaption", "grades-chart-head");
  caption.append(el("span", "np-data grades-chart-term", semester.label));
  caption.append(el("span", "grades-chart-count", countLabel(semester)));
  figure.append(caption);

  if (!drawsChart(semester)) {
    figure.append(el("p", "np-note grades-masked", semesterNote(semester)));
    return appendMasked(figure, semester);
  }

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
  return appendMasked(figure, semester);
}

/** DBH suppressed some cells here — say so, whatever the semester rendered as. */
function appendMasked(figure: HTMLElement, semester: GradeSemester): HTMLElement {
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
 * Which seasons this course holds an **ordinary** exam in, read off the
 * scraped exam list — "Vår 2026" → "Vår". Null when we cannot tell, and then
 * nothing is held out of the figure.
 *
 * Fetched after the grades, not alongside them, and through `detailsUrl` so
 * it is byte-identical to the request `mountCourseDetails` makes: that one is
 * already in flight when the page mounts and the worker sends it
 * `max-age=300`, so by the time DBH answers this second read is a browser
 * cache hit. Issuing it in parallel, or on a differently-shaped URL, would
 * guarantee a duplicate request instead. Any failure is answered with null —
 * DR-3's fail-open rule: a sitting we cannot classify keeps its place.
 */
async function fetchOrdinarySeasons(
  code: string,
  signal?: AbortSignal,
  year?: number | null,
): Promise<string[] | null> {
  try {
    const res = await fetch(detailsUrl(code, year), { signal });
    if (!res.ok) return null;
    const details = (await res.json()) as {
      exams?: { occasion?: string | null; season?: string | null }[];
    };
    const seasons = new Set<string>();
    for (const exam of details.exams ?? []) {
      if (isDeferredOccasion(exam.occasion)) continue;
      const word = exam.season?.trim().split(/\s+/)[0];
      if (word) seasons.add(word);
    }
    return seasons.size > 0 ? [...seasons] : null;
  } catch {
    return null;
  }
}

/**
 * Fetches and renders the figure into `#grades-section`. Silent about its own
 * absence: a course DBH has never recorded (new, tiny, or purely externally
 * examined) says so in one line rather than rendering an empty frame.
 */
export async function mountGradeChart(
  code: string,
  signal?: AbortSignal,
  /** Same value `mountCourseDetails` gets, so both share one cache entry. */
  year?: number | null,
): Promise<void> {
  const section = document.getElementById("grades-section");
  const status = section?.querySelector<HTMLElement>('[data-role="status"]');
  const body = section?.querySelector<HTMLElement>('[data-role="body"]');
  if (!section || !status || !body || !code) return;

  try {
    const res = await fetch(`/api/course/${encodeURIComponent(code)}/grades`, { signal });
    if (!res.ok) throw new Error(`${res.status}`);
    const payload = (await res.json()) as { rows?: GradeRowInput[] };
    const ordinarySeasons = await fetchOrdinarySeasons(code, signal, year);
    if (signal?.aborted) return;
    const model = buildGradeSemesters(payload.rows ?? [], {
      limit: MAX_SEMESTERS,
      ordinarySeasons,
    });

    if (model.semesters.length === 0) {
      status.textContent = "Ingen karakterstatistikk registrert for dette emnet.";
      // Hands back the height the placeholder was holding for the figure
      // (perf-1). This branch KEEPS the status line on screen, so without the
      // release a course DBH has never recorded would carry 36rem of empty
      // page under one sentence, permanently — see [code].astro's own note.
      status.removeAttribute("data-reserve");
      return;
    }

    const peaks = peaksByScale(model.semesters);
    const chart = (semester: GradeSemester): HTMLElement =>
      renderSemester(semester, peaks.get(semester.scale) ?? 0);

    // Exactly one `.grades-grid`: the older half stacks inside a disclosure so
    // the figure stops being the tallest thing on a phone (course-4).
    const grid = el("div", "grades-grid");
    for (const semester of model.semesters.slice(0, VISIBLE_SEMESTERS))
      grid.append(chart(semester));
    body.replaceChildren(grid);

    const older = model.semesters.slice(VISIBLE_SEMESTERS);
    if (older.length > 0) {
      const disclosure = el("details", "grades-older");
      disclosure.append(el("summary", "np-summary", `Eldre semestre (${older.length})`));
      const list = el("div", "grades-older-list");
      for (const semester of older) list.append(chart(semester));
      disclosure.append(list);
      body.append(disclosure);
    }

    if (model.deferred.length > 0) {
      body.append(
        el(
          "p",
          "np-hint grades-source",
          `Utsatt eksamen er ikke tatt med (${model.deferred.map((s) => s.label).join(", ")}). Det er kandidater som tar eksamen på nytt, ikke et ordinært kull.`,
        ),
      );
    }
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
    // Same lease, same reason: the apology stays visible, so the reservation
    // under it has to go (perf-1).
    status.removeAttribute("data-reserve");
  }
}
