/**
 * KARAKTERER — the grade-distribution figure on `/emne/[code]/`, from DBH table
 * 308 via the worker.
 *
 * **Small multiples, one bar chart per semester.** A 100 %-stacked bar needs
 * six mutually distinguishable colours for A–F, and the palette validator
 * rejected every such ramp this design system can build (best adjacent pair
 * ΔE 6.9 against a 15 floor). Small multiples need exactly ONE colour and stay
 * comparable through a shared y-scale.
 *
 * **`--hue-blue`, deliberately not red for F** — Red-Is-Collision reserves red
 * for coexistence failures. Every bar carries its own percentage, so the figure
 * needs no y-axis and no legend.
 *
 * **The shared scale is per grade scale**: a pass/fail term peaks near 100 % by
 * construction and flattened every letter chart beside it to a 4–29 px stub.
 * Semesters under `MIN_CHART_CANDIDATES` neither set the scale nor get bars.
 *
 * **Not drawn at all**: DBH files the utsatt/kont sitting as its own (year,
 * semester), so it leads the figure as the newest and reads as current
 * difficulty. Held out and named in a note, using the same signal and
 * fail-open stance DR-3 uses on the exam list.
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
 * Ordinary semesters kept at all. The cap counts ordinary sittings only, so
 * holding the utsatt ones out lengthens the history rather than shortening it.
 */
const MAX_SEMESTERS = 6;
/** Charts shown up front; the rest fold into a disclosure. */
const VISIBLE_SEMESTERS = 3;
/** Chart plot height in px. The bars scale within this. */
const PLOT_HEIGHT = 96;

/** "30,4" — one decimal, comma separator, per the repo's number rule. */
function formatPercent(value: number): string {
  return value.toFixed(1).replace(".", ",");
}

/**
 * The caption's right-hand fact. The scale is named where it is not the A–F one
 * a reader assumes, because two bars at "82,5 %" and "20,8 %" are not
 * comparable across scales however alike they look.
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
 * Which seasons this course holds an **ordinary** exam in, read off the scraped
 * exam list. Null when we cannot tell, and then nothing is held out.
 *
 * Fetched after the grades and through `detailsUrl`, so it is byte-identical to
 * the request `mountCourseDetails` already has in flight; with the worker's
 * `max-age=300` this second read is a browser cache hit. In parallel, or on a
 * differently-shaped URL, it would guarantee a duplicate request. Any failure
 * is answered with null — DR-3's fail-open rule.
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
 * absence: a course DBH has never recorded says so in one line rather than
 * rendering an empty frame.
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
      // Hands back the height the placeholder held for the figure. This branch
      // KEEPS the status line, so without the release a course DBH never
      // recorded would carry 36rem of empty page under one sentence.
      status.removeAttribute("data-reserve");
      return;
    }

    const peaks = peaksByScale(model.semesters);
    const chart = (semester: GradeSemester): HTMLElement =>
      renderSemester(semester, peaks.get(semester.scale) ?? 0);

    // Exactly one `.grades-grid`: the older half stacks inside a disclosure so
    // the figure stops being the tallest thing on a phone.
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
    // under it has to go.
    status.removeAttribute("data-reserve");
  }
}
