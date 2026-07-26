/**
 * Timetable island for `/emne/[code]/` — the page's fork point (REVIEW U10).
 *
 * It renders the *same* ruled week the planner renders, by handing the
 * fetched entries to `components/planner/grid.ts` as a one-course plan. The
 * flat day-column list this module used to build was a second timetable
 * renderer with its own geometry; §3 adjudicated the extraction as correct
 * precisely because it deletes a renderer rather than adding one.
 *
 * Two honesty rules ride along:
 *   - U14: upstream has exactly one timetable snapshot per course, so the
 *     old ±1-year chips implied a choice that does not exist. There is one
 *     view, labelled with the season the entries actually carry, and it says
 *     so when that is not the semester the student is planning.
 *   - C2 (DR-4): the fetch carries the catalog `version`. 293 of 5 470
 *     courses are not version "1", and the default-version payload for those
 *     is a different timetable for the same slot.
 */
import type { TimetableEntry as PlannerTimetableEntry } from "../../lib/planner/data.js";
import { hueForIndex } from "../../lib/planner/hues.js";
import { el } from "../planner/dom.js";
import { renderGrid } from "../planner/grid.js";
import type { PlanCourseState } from "../planner/types.js";

/** The planner's entry shape plus the `term` field only this page reads. */
export interface CourseTimetableEntry extends PlannerTimetableEntry {
  /** Upstream term key, e.g. `"2026_HØST"` / `"2026_VÅR"`. */
  term?: string | null;
}

export interface CourseTimetableOptions {
  code: string;
  name: string;
  /** Catalog course version (DR-4) — threaded into the timetable call. */
  version: string;
  /** Catalog year to fetch: the newest year the course is actually offered in. */
  year: number;
  /** The semester the plan is for, so an off-semester timetable can say so. */
  semester: { season: string; year: number; label: string };
}

const SEASON_TERMS: Record<string, string> = {
  AUTUMN: "HØST",
  SPRING: "VÅR",
  SUMMER: "SOMMER",
};

const TERM_LABELS: Record<string, string> = {
  HØST: "Høst",
  VÅR: "Vår",
  SOMMER: "Sommer",
};

/** `"2026_HØST"` → `"Høst 2026"`; unknown shapes pass through verbatim. */
export function termLabel(term: string): string {
  const [year = "", season = ""] = term.split("_");
  const label = TERM_LABELS[season];
  return label && year ? `${label} ${year}` : term;
}

async function fetchTimetable(
  code: string,
  year: number,
  version: string,
): Promise<CourseTimetableEntry[] | null> {
  const res = await fetch(
    `/api/course/${encodeURIComponent(code)}/timetable?year=${year}&version=${encodeURIComponent(version)}`,
  );
  if (!res.ok) return null;
  return (await res.json()) as CourseTimetableEntry[];
}

/**
 * The "Viser …" provenance line (DR-8). Names the term(s) the entries carry
 * and, when the planned semester is not among them, says that outright —
 * a bare room-numbered grid a student plans around is the failure U14 names.
 */
export function termNote(entries: CourseTimetableEntry[], options: CourseTimetableOptions): string {
  const { semester } = options;
  const terms = [...new Set(entries.map((e) => e.term).filter((t): t is string => !!t))].sort();
  // Upstream can send entries with no term key at all; the fetched year is
  // then the only thing we actually know, and the line says only that.
  if (terms.length === 0) return `Viser timeplanen for ${options.year}.`;
  const plannedTerm = `${semester.year}_${SEASON_TERMS[semester.season] ?? ""}`;
  const shown = terms.map(termLabel).join(", ");
  if (terms.includes(plannedTerm)) return `Viser ${shown}.`;
  return `Viser ${shown} — ikke undervist i ${semester.label}.`;
}

/**
 * Renders the course's week into `#timetable-section`. Returns the fetched
 * entries so the page's clash line can reuse them instead of fetching the
 * same timetable a second time; `null` means the fetch failed (unknown, not
 * empty).
 */
export async function mountCourseTimetable(
  options: CourseTimetableOptions,
): Promise<CourseTimetableEntry[] | null> {
  const section = document.getElementById("timetable-section");
  const status = section?.querySelector<HTMLElement>('[data-role="status"]');
  const body = section?.querySelector<HTMLElement>('[data-role="body"]');
  if (!section || !status || !body || !options.code || !options.year) return null;

  let entries: CourseTimetableEntry[] | null = null;
  try {
    entries = await fetchTimetable(options.code, options.year, options.version);
  } catch {
    entries = null;
  }

  if (entries === null) {
    status.className = "emne-loading np-hint";
    status.textContent = "Klarte ikke å hente timeplanen.";
    return null;
  }

  status.hidden = true;
  body.hidden = false;
  body.replaceChildren();

  // No ruled paper behind an apology (D5): with nothing to place, the page
  // says so in one sentence instead of framing an empty week.
  if (entries.length === 0) {
    body.append(
      el("p", "np-hint", `Ingen timeplan er publisert for ${options.year}.`),
      el("p", "np-hint", `Emnet er ikke oppført med undervisning i ${options.semester.label}.`),
    );
    return entries;
  }

  body.append(el("p", "np-hint timetable-term", termNote(entries, options)));

  const toggle = el("button", "np-toggle timetable-others", "Vis øvinger og labber");
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", "false");
  body.append(toggle);

  // Same class names as /planlegger/'s week: the geometry lives in
  // src/styles/planner-week.css, which both surfaces import.
  const frame = el("div", "np-frame np-ruled np-ruled--hours planner-grid-frame");
  const notes = el("div", "planner-grid-notes");
  body.append(frame, notes);

  // One-course plan: the grid's conflict pass is lecture×lecture across
  // *different* courses, so a single course can never paint itself red here.
  const state: PlanCourseState = {
    course: { code: options.code, name: options.name, version: options.version, source: "manual" },
    hueVar: hueForIndex(0),
    bundle: { timetable: entries, details: null, errors: [] },
    loading: false,
  };

  function draw(showOthers: boolean): void {
    // renderGrid owns the ruling (D5) — it strips `np-ruled` itself when
    // there is no week to rule, so this must not second-guess the class list.
    // showAllGroups: this is the course's own reference page, not one
    // student's plan — every parallel/group draws (Task 7 ruling), not just
    // whichever one a programme-less context would default to.
    const result = renderGrid(frame, notes, [state], showOthers, { showAllGroups: true });
    // B7a: when nothing in the course classifies as a lecture the grid
    // reveals the muted layer unasked. The toggle has to describe what is
    // actually on screen.
    if (result.mutedLayerAutoRevealed) toggle.setAttribute("aria-pressed", "true");
  }

  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(next));
    draw(next);
  });

  draw(false);
  return entries;
}
