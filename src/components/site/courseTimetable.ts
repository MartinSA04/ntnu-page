/**
 * Timetable island for `/emne/[code]/`.
 *
 * It renders the *same* ruled week the planner renders, by handing the fetched
 * entries to `components/planner/grid.ts` as a one-course plan — one renderer,
 * not two.
 *
 * Three honesty rules ride along:
 *   - upstream has exactly one timetable snapshot per course, so there is one
 *     view, labelled with the season the entries actually carry, saying so when
 *     that is not the semester the student is planning;
 *   - DR-4: the fetch carries the catalog `version` (293 of 5 470 courses are
 *     not version "1", and their default-version payload is a different week);
 *   - the response is the whole catalog *year*, both terms. One semester's
 *     entries are drawn, never the union — see `entriesForSemester`.
 */
import {
  bundleFromEntries,
  decodeEntities,
  type TimetableEntry as PlannerTimetableEntry,
} from "../../lib/planner/data.js";
import { applyGroupSelection } from "../../lib/planner/groups.js";
import { naturalHue } from "../../lib/planner/hues.js";
import { entriesInSemester } from "../../lib/planner/schedule.js";
import { el } from "../planner/dom.js";
import { fitBlockLabels, renderGrid, setScrollFade } from "../planner/grid.js";
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
  /** The stored programme, for the "bare min undervisning" narrowing. */
  programCode?: string | null;
  /** The student's group picks for this course, when it is in the plan. */
  selectedGroups?: string[];
  /** Whether the course is in the plan — only a plan entry can hold a pick. */
  inPlan?: boolean;
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
 * The entries the week may draw — one semester's, not the fetched year's.
 *
 * `?year=YYYY` answers with the WHOLE catalog year: EXPH0300 returns 84
 * entries, 51 spring and 33 autumn. Handing all of them to `renderGrid` drew a
 * Trondheim autumn lecture beside an Ålesund spring lecture as a simultaneous
 * pair, because `layout.ts` clusters on time alone and is week-blind.
 * `/planlegger/` has always narrowed the same way before drawing.
 *
 * Fallback, in order:
 *  1. the entries taught in the planned semester's weeks;
 *  2. nothing intersects — the newest term the response carries, so the view is
 *     still ONE term and `termNote` can name it honestly;
 *  3. no term keys at all — everything, which is all we know.
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
 * Upstream ships HTML entities inside plain-text fields, and this module
 * fetches around `data.ts`, so the planner's decode never reached the course
 * page's week. Same two fields, same rule: unchanged entries keep identity.
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
 * and, when the planned semester is not among them, says that outright.
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

/** Which slice of the course's teaching the week is drawing. */
export type TimetableScope = "all" | "mine";

export interface ScopeState {
  /** The stored programme, or null when the student has not said. */
  programCode: string | null;
  /** Whether this course is in the plan — the only thing that can hold a group pick. */
  inPlan: boolean;
  scope: TimetableScope;
}

/**
 * The line under the week: what it is showing, and what would change it.
 *
 * This page draws EVERY parallel and every group by default, deliberately —
 * it is the course's own reference page, not one student's plan — and until
 * now nothing on it said so, which left a student to assume the six lectures
 * in front of them were six lectures they had to attend.
 *
 * Three rungs, and they differ by what the student can actually do next. With
 * no programme stored nothing can be narrowed at all, so the line points at
 * the planner. With one, lectures narrow to that programme's section and other
 * programmes' øving groups drop. Only a PLAN entry can carry the student's own
 * group pick, which is what the second sentence is for and why it goes away
 * once the course is in the plan.
 */
export function scopeNote(state: ScopeState): string {
  if (state.programCode === null) {
    return "Uka viser alle paralleller og grupper for emnet. Velg studieprogram i planleggeren for å se din egen undervisning.";
  }
  const nudge = state.inPlan ? "" : " Legg emnet i planen for å velge øvingsgruppe.";
  if (state.scope === "mine") return `Viser undervisningen for ${state.programCode}.${nudge}`;
  return `Uka viser alle paralleller og grupper for emnet.${nudge}`;
}

/**
 * Would narrowing actually change this week?
 *
 * `entriesForProgram` is a no-op for a course whose entries name no programme
 * in `studyProgramKeys` — which is most of them — so without this guard the
 * switch would be a control that visibly does nothing on the majority of
 * course pages. That is the exact failure the layer box was fixed for, and it
 * is worth a filter pass at mount to avoid repeating.
 */
export function narrowingChangesWeek(
  entries: CourseTimetableEntry[],
  selected: string[] | undefined,
  programCode: string | null,
): boolean {
  if (!programCode) return false;
  return applyGroupSelection(entries, selected, programCode).length !== entries.length;
}

/**
 * Renders the course's week into `#timetable-section`. Returns the entries it
 * drew, so the page's clash line can reuse them instead of fetching the same
 * timetable twice; `null` means the fetch failed (unknown, not empty).
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
    // Releases the height the placeholder held for the week: this line stays on
    // screen, and an apology atop 24rem of empty page is worse than the shift.
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

  // One semester's entries, never the fetched year's union.
  const shown = entriesForSemester(entries, options.semester.teachingWeeks);

  body.append(el("p", "np-hint timetable-term", termNote(shown, options)));

  const programCode = options.programCode ?? null;
  const inPlan = options.inPlan ?? false;
  /** All of it, until the student asks for their own slice. Per visit, never
   *  persisted: the same URL has to show two people the same week, and a
   *  remembered choice would need a pre-paint read to avoid shifting the week
   *  in a frame late. */
  let scope: TimetableScope = "all";

  const controls = el("div", "timetable-controls");
  const toggle = el("button", "np-toggle timetable-others", "Vis øvinger og labber");
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", "false");
  controls.append(toggle);

  // Only when it would change something — see `narrowingChangesWeek`.
  const canNarrow = narrowingChangesWeek(shown, options.selectedGroups, programCode);
  const mine = el("button", "np-toggle np-toggle--text timetable-mine", "Bare min undervisning");
  mine.type = "button";
  mine.setAttribute("aria-pressed", "false");
  if (canNarrow) controls.append(mine);

  body.append(controls);

  // WHAT THIS WEEK IS. Every parallel and every group, said out loud, because
  // six lectures on screen with nothing naming them read as six lectures you
  // have to attend.
  const scopeLine = el("p", "np-hint timetable-scope");
  const syncScopeLine = (): void => {
    scopeLine.textContent = scopeNote({ programCode, inPlan, scope });
  };
  syncScopeLine();
  body.append(scopeLine);

  // Same class names as /planlegger/'s week: the geometry lives in
  // src/styles/planner-week.css, which both surfaces import.
  const frame = el("div", "planner-grid-frame");
  // `renderGrid` emits a `<button>` per block and wires a click only when the
  // caller supplies `onBlockClick`. This surface has nothing to hand it — the
  // popover edits the student's *plan*, and this page is a reference for one
  // course — so it carried 24 focusable, hover-lit controls that answered no
  // click. The affordance is withdrawn rather than faked: no tab stops, and
  // `data-static` for the cursor/hover rule in planner-week.css.
  frame.dataset.static = "true";
  const notes = el("div", "planner-grid-notes");
  // At 360 px the frame closes just after TOR with more than half a lecture
  // behind the edge, and nothing said the frame was swipeable. The mask lives
  // in planner-week.css, so both surfaces get it from one place.
  //
  // `/planlegger/`'s `scrollToToday` is deliberately NOT ported: there is no
  // "today" in a week that repeats for one course, and a non-zero starting
  // scrollLeft would fade the near edge of a week nobody has touched.
  body.append(frame, notes);

  /** Mirrors plannerApp's `syncGridScroll`: the edge fades only when a day really is off-frame. */
  function syncScroll(): void {
    const grid = frame.querySelector<HTMLElement>(".planner-grid");
    const hiddenPx = grid ? grid.getBoundingClientRect().width - frame.clientWidth : 0;
    if (hiddenPx <= 1) {
      delete frame.dataset.scroll;
      return;
    }
    const maxScroll = frame.scrollWidth - frame.clientWidth;
    const left = frame.scrollLeft;
    frame.dataset.scroll = left <= 1 ? "start" : left >= maxScroll - 1 ? "end" : "middle";
    setScrollFade(frame, left, maxScroll);
  }

  frame.addEventListener("scroll", syncScroll, { passive: true, signal: options.signal });
  // Same pair as the planner's: a resize moves both the frame's edge and what
  // each bar has room to say (`fitBlockLabels`).
  window.addEventListener(
    "resize",
    () => {
      syncScroll();
      fitBlockLabels(frame);
    },
    { passive: true, signal: options.signal },
  );

  // One-course plan: the grid's conflict pass is lecture×lecture across
  // *different* courses, so a single course can never paint itself red here.
  const state: PlanCourseState = {
    course: { code: options.code, name: options.name, version: options.version, source: "manual" },
    // The course's OWN hue, so the block a student sees here is the block they
    // will see in the planner once they add it — same course, same colour,
    // across surfaces. It was hue #0 (blue) for every course on the site.
    hueVar: naturalHue(options.code),
    // `bundleFromEntries` rather than an object literal: it is the one place
    // the honest fields are filled in, so this surface cannot omit them.
    bundle: bundleFromEntries(shown),
    loading: false,
  };

  function draw(showOthers: boolean): void {
    // The narrowing happens on the ENTRIES handed in, not on `showAllGroups`.
    // That flag stays true either way: it says "this is the course's page, not
    // one student's plan", which is still what the surface is — the switch is
    // the student ASKING for their own slice of it, which is a different
    // statement and belongs on the data rather than on the renderer's policy.
    const drawn =
      scope === "mine" ? applyGroupSelection(shown, options.selectedGroups, programCode) : shown;
    state.bundle = bundleFromEntries(drawn);
    const result = renderGrid(frame, notes, [state], showOthers, { showAllGroups: true });
    // Blocks are rebuilt on every draw, so the tab stops come off every time.
    // They keep their aria-label and title, which is where a keyboard or
    // screen-reader user gets the room, activity and week range.
    for (const block of Array.from(frame.querySelectorAll<HTMLElement>(".planner-block"))) {
      block.tabIndex = -1;
    }
    // B7a: when nothing classifies as a lecture the grid reveals the muted
    // layer unasked, so the toggle has to describe what is on screen.
    if (result.mutedLayerAutoRevealed) toggle.setAttribute("aria-pressed", "true");
    // Toggling øvinger can widen the grid (a Saturday column) — re-measure.
    syncScroll();
  }

  // Same grammar as the layer toggle beside it: a deliberate switch that
  // changes how much of the same plan is drawn, so it animates rather than
  // snapping (DESIGN §7's one exception).
  mine.addEventListener("click", () => {
    scope = scope === "mine" ? "all" : "mine";
    mine.setAttribute("aria-pressed", String(scope === "mine"));
    syncScopeLine();
    const settle = beginLayerChange(frame, scope === "mine" ? "hide" : "reveal");
    draw(toggle.getAttribute("aria-pressed") === "true");
    settle();
  });

  toggle.addEventListener("click", () => {
    const next = toggle.getAttribute("aria-pressed") !== "true";
    toggle.setAttribute("aria-pressed", String(next));
    // The same button on /planlegger/ moves the layer rather than rebuilding
    // the week. It is one control; it cannot behave two ways per page.
    const settle = beginLayerChange(frame, next ? "reveal" : "hide");
    draw(next);
    settle();
  });

  draw(false);
  return shown;
}
