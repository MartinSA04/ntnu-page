/**
 * Timetable island for `/emne/[code]/` — the page's fork point (REVIEW U10).
 *
 * It renders the *same* ruled week the planner renders, by handing the
 * fetched entries to `components/planner/grid.ts` as a one-course plan. The
 * flat day-column list this module used to build was a second timetable
 * renderer with its own geometry; §3 adjudicated the extraction as correct
 * precisely because it deletes a renderer rather than adding one.
 *
 * Three honesty rules ride along:
 *   - U14: upstream has exactly one timetable snapshot per course, so the
 *     old ±1-year chips implied a choice that does not exist. There is one
 *     view, labelled with the season the entries actually carry, and it says
 *     so when that is not the semester the student is planning.
 *   - C2 (DR-4): the fetch carries the catalog `version`. 293 of 5 470
 *     courses are not version "1", and the default-version payload for those
 *     is a different timetable for the same slot.
 *   - course-3: the response is the whole catalog *year*, both terms of it.
 *     One semester's entries are drawn, never the union — see
 *     `entriesForSemester`.
 */
import {
  bundleFromEntries,
  decodeEntities,
  type TimetableEntry as PlannerTimetableEntry,
} from "../../lib/planner/data.js";
import { hueForIndex } from "../../lib/planner/hues.js";
import { entriesInSemester } from "../../lib/planner/schedule.js";
import { el } from "../planner/dom.js";
import { renderGrid } from "../planner/grid.js";
import { beginLayerChange } from "../planner/layerMotion.js";
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
  semester: { season: string; year: number; label: string; teachingWeeks: number[] };
  /** The page's lifecycle signal — the window-level scroll/resize listeners hang off it. */
  signal?: AbortSignal;
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

/** Chronological rank of a term key's season within its year; unknown seasons sort first. */
const TERM_ORDER: Record<string, number> = { VÅR: 0, SOMMER: 1, HØST: 2 };

function termRank(term: string): number {
  const [year = "0", season = ""] = term.split("_");
  return Number(year) * 10 + (TERM_ORDER[season] ?? -1);
}

/**
 * The entries the week is allowed to draw — one semester's, not the fetched
 * year's (course-3).
 *
 * `/api/course/:code/timetable?year=YYYY` answers with the WHOLE catalog
 * year: EXPH0300 returns 84 entries, 51 spring and 33 autumn. Handing all of
 * them to `renderGrid` drew a Trondheim autumn lecture beside an Ålesund
 * spring lecture as a simultaneous pair, because `layout.ts` clusters on time
 * alone and is week-blind — and a third cross-term entry in the same rute
 * collapses all three into one pile presenting sessions months apart as one
 * group. PRODUCT §3.4 / REVIEW U10 both specify the grid is the *planned*
 * semester's — and /planlegger/ has always narrowed the same way before
 * drawing (`semesterWeekEntries`, plannerApp.ts), so this is the shared rule
 * catching up with the surface that skipped it, not a new one.
 *
 * Fallback, in order:
 *  1. the entries taught in the planned semester's weeks;
 *  2. nothing intersects (the course is simply not taught then) — the newest
 *     term the response carries, so the fallback view is still ONE term and
 *     `termNote` can name it honestly;
 *  3. upstream sent no term keys at all — everything, which is the only thing
 *     we know, and the fetched year is all `termNote` then claims.
 */
export function entriesForSemester(
  entries: CourseTimetableEntry[],
  teachingWeeks: number[],
): CourseTimetableEntry[] {
  const planned = entriesInSemester(entries, teachingWeeks);
  if (planned.length > 0) return planned;
  const terms = entries.map((e) => e.term).filter((t): t is string => !!t);
  if (terms.length === 0) return entries;
  const newest = terms.reduce((a, b) => (termRank(b) > termRank(a) ? b : a));
  return entries.filter((e) => e.term === newest);
}

/**
 * ux-7: upstream ships HTML entities inside plain-text fields — TMA4400's
 * real Monday block is titled `"Forelesning 1 MTELSYS &#38; MTTK"` — and this
 * module fetches around `data.ts`, so the planner's decode never reached the
 * course page's own week. Same two fields `data.ts` decodes, same rule:
 * unchanged entries keep their identity.
 */
export function decodeEntry(entry: CourseTimetableEntry): CourseTimetableEntry {
  const title = entry.title === null ? null : decodeEntities(entry.title);
  const name = entry.name === null ? null : decodeEntities(entry.name);
  if (title === entry.title && name === entry.name) return entry;
  return { ...entry, title, name };
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
  const raw = (await res.json()) as CourseTimetableEntry[];
  return Array.isArray(raw) ? raw.map(decodeEntry) : [];
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
  return `Viser ${shown}. Ikke undervist i ${semester.label}.`;
}

/**
 * Renders the course's week into `#timetable-section`. Returns the entries it
 * drew — the planned semester's, per `entriesForSemester` — so the page's
 * clash line can reuse them instead of fetching the same timetable a second
 * time; `null` means the fetch failed (unknown, not empty).
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
    // Releases the height the placeholder was holding for the week (perf-1):
    // this line stays on screen, and an apology at the top of 24rem of empty
    // page is worse than the shift the reservation exists to prevent.
    status.removeAttribute("data-reserve");
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

  // One semester's entries, never the fetched year's union (course-3).
  const shown = entriesForSemester(entries, options.semester.teachingWeeks);

  body.append(el("p", "np-hint timetable-term", termNote(shown, options)));

  const toggle = el("button", "np-toggle timetable-others", "Vis øvinger og labber");
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", "false");
  body.append(toggle);

  // Same class names as /planlegger/'s week: the geometry lives in
  // src/styles/planner-week.css, which both surfaces import.
  const frame = el("div", "planner-grid-frame");
  // cpc-4: `renderGrid` emits `<button type="button">` for every block and
  // wires a click only when the caller supplies `onBlockClick`. This surface
  // has nothing to hand it — the block popover edits the student's *plan*
  // (Dropp/Fjern, group picks), and this page is a reference for one course
  // whether or not it is in any plan — so /emne/EXPH0300/ carried 24
  // focusable, cursor:pointer, hover-lit controls that answered no click.
  // The affordance is withdrawn rather than faked: no tab stops here, and
  // `data-static` for the cursor/hover rule in planner-week.css.
  frame.dataset.static = "true";
  const notes = el("div", "planner-grid-notes");
  // mob-2: at 360 px the frame closes just after TOR and more than half of
  // TDT4109's only lecture hangs behind the edge — no fade, no hint, no
  // scroll offset, because A4's mobile-week fix lives on /planlegger/ (its
  // `[data-scroll]` mask and `#planner-scroll-hint`) and this surface shares
  // only the geometry. The frame is swipeable; nothing said so. The mask and
  // the hint's spacing are in planner-week.css now, so both surfaces get them
  // from one place.
  //
  // The third part of that fix — /planlegger/'s `scrollToToday`, which happens
  // to consume the frame's own `var(--cell)` padding and so recovers ~24 px on
  // the right — is deliberately NOT ported. There is no "today" in a week that
  // repeats for one course, and any non-zero starting scrollLeft puts the
  // frame in `[data-scroll="middle"]`, whose left ramp then washes out the
  // hour rail the student reads the grid against (mob-5) for every visit.
  // Fading the rail permanently to win 24 px of a 56 px clip the hint already
  // names is the wrong trade.
  const scrollHint = el("p", "np-hint planner-scroll-hint");
  scrollHint.hidden = true;
  body.append(scrollHint, frame, notes);

  /** Mirrors plannerApp's `syncGridScroll`: masks and hints only when a day really is off-frame. */
  function syncScroll(): void {
    const grid = frame.querySelector<HTMLElement>(".planner-grid");
    const hiddenPx = grid ? grid.getBoundingClientRect().width - frame.clientWidth : 0;
    if (hiddenPx <= 1) {
      delete frame.dataset.scroll;
      scrollHint.hidden = true;
      return;
    }
    const maxScroll = frame.scrollWidth - frame.clientWidth;
    const left = frame.scrollLeft;
    frame.dataset.scroll = left <= 1 ? "start" : left >= maxScroll - 1 ? "end" : "middle";
    scrollHint.textContent = "Dra sidelengs for å se hele uken.";
    scrollHint.hidden = false;
  }

  frame.addEventListener("scroll", syncScroll, { passive: true, signal: options.signal });
  window.addEventListener("resize", syncScroll, { passive: true, signal: options.signal });

  // One-course plan: the grid's conflict pass is lecture×lecture across
  // *different* courses, so a single course can never paint itself red here.
  const state: PlanCourseState = {
    course: { code: options.code, name: options.name, version: options.version, source: "manual" },
    hueVar: hueForIndex(0),
    // `bundleFromEntries` rather than a hand-built object literal: it is the
    // one place the honest fields (`timetableOutcome`, `failures`) are filled
    // in, so this surface cannot be the one that omits them.
    bundle: bundleFromEntries(shown),
    loading: false,
  };

  function draw(showOthers: boolean): void {
    // The ruling rides on the grid's own rail/day columns now, so a branch
    // that draws no grid draws no lines — nothing to strip here.
    // showAllGroups: this is the course's own reference page, not one
    // student's plan — every parallel/group draws (Task 7 ruling), not just
    // whichever one a programme-less context would default to.
    const result = renderGrid(frame, notes, [state], showOthers, { showAllGroups: true });
    // Blocks are rebuilt on every draw, so the tab stops come off every time.
    // They keep their aria-label and title, which is where a keyboard or
    // screen-reader user gets the room, the activity and the week range.
    for (const block of Array.from(frame.querySelectorAll<HTMLElement>(".planner-block"))) {
      block.tabIndex = -1;
    }
    // B7a: when nothing in the course classifies as a lecture the grid
    // reveals the muted layer unasked. The toggle has to describe what is
    // actually on screen.
    if (result.mutedLayerAutoRevealed) toggle.setAttribute("aria-pressed", "true");
    // Toggling øvinger can widen the grid (a Saturday column) — re-measure.
    syncScroll();
  }

  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(next));
    // The same button on /planlegger/ moves the layer rather than rebuilding
    // the week (REWORK-2026-07-29g). It is one control; it cannot behave two
    // ways depending on which page it is on.
    const settle = beginLayerChange(frame, next ? "reveal" : "hide");
    draw(next);
    settle();
  });

  draw(false);
  return shown;
}
