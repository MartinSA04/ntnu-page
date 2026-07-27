/**
 * EKSAMENER — the exam list (PRODUCT.md DR-3, rework Task 9). Replaces the
 * ribbon's horizontal date axis + hue dots with a chronological list: one
 * `.exam-row` per dated exam and a `.exam-gap` connector between consecutive
 * rows naming the whole-day gap ("5 dager mellomrom", tight ink under two
 * days, a same-day pair collapsing to "samme dag"). Dateless exams stay
 * listed, never dropped, as `.exam-dateless` rows. Sourced from catalog
 * `ExamDate` via the planner index (`examsFromIndex`), not scraped
 * `CourseExam` text — kont exams are already excluded upstream by the
 * crawler (see data.ts).
 *
 * The list is ALL there is. It used to be preceded by its own ruled frame
 * holding a summary kicker ("5 eksamener over 26 dager"), which restated in
 * prose what four dated rows underneath it already showed. Both are gone —
 * this module now writes into one host element, and a message (nothing
 * found, nothing published) renders in that same host rather than in a box
 * of its own.
 *
 * The sort/gap/tight/sameDay/countdown math itself lives in the pure,
 * unit-tested `buildExamList` (examSchedule.ts) — this module is DOM-only.
 */

import {
  type ExamWindow,
  examsFromIndex,
  type PlannerIndex,
  type PlannerIndexCourse,
} from "../../lib/planner/data.js";
import {
  buildExamList,
  type ExamListInput,
  type ExamListRow,
} from "../../lib/planner/examSchedule.js";
import { dot, el, formatShortDate } from "./dom.js";
import type { PlanCourseState } from "./types.js";

/** Collects one exam input per catalog-sourced exam occasion (dated or not) across the plan's courses. */
function collectExamInputs(
  courses: PlanCourseState[],
  semesterId: string,
  index: PlannerIndex | null,
  window: ExamWindow | null,
): ExamListInput[] {
  if (!index) return [];
  const byCode = new Map<string, PlannerIndexCourse>(index.courses.map((c) => [c[0], c]));
  const inputs: ExamListInput[] = [];
  for (const state of courses) {
    const row = byCode.get(state.course.code);
    if (!row) continue;
    inputs.push(...examsFromIndex(row, semesterId, window));
  }
  return inputs;
}

export interface ExamRenderOptions {
  /**
   * A course bundle or the planner index is still loading. Nothing is
   * asserted about the exam list until it isn't — "Ingen eksamensdatoer
   * funnet" while the fetch is in flight is the same false-and-loud statement
   * U5 removed from the week.
   */
  loading?: boolean;
}

export interface ExamRenderResult {
  collisionCount: number;
  /** Which branch rendered. Only `"list"` carries a meaningful `collisionCount`. */
  state: "list" | "empty" | "loading";
}

function renderEmpty(listHost: HTMLElement, message: string | null): ExamRenderResult {
  listHost.replaceChildren(...(message ? [el("p", "exam-empty np-hint", message)] : []));
  return {
    collisionCount: 0,
    state: message === null ? "loading" : "empty",
  };
}

/**
 * Renders a message where the list would be — the exam half of
 * `renderGridMessage`. Use it when the CALLER knows something the list
 * cannot work out for itself: C3's case is a semester the shipped index does
 * not cover at all, where "Ingen eksamensdatoer funnet ennå" would be a
 * finding reported by something that never looked. Pass no message to just
 * empty the host.
 */
export function renderExamMessage(
  listHost: HTMLElement,
  message?: string | null,
): ExamRenderResult {
  return renderEmpty(listHost, message ?? null);
}

/** The course chip a row wears — DESIGN §5's `.np-tag`, hue dot + mono code. */
function examCodeTag(code: string, hueVar: string): HTMLElement {
  const tag = el("span", "exam-code np-tag");
  tag.append(dot(hueVar));
  tag.append(el("span", "np-data", code));
  return tag;
}

/** One dated row: weekday + short date, the course's tag, and — only on the
 * first upcoming exam — a countdown from today. */
function examRow(row: ExamListRow, hueVar: string): HTMLLIElement {
  const item = el("li", "exam-row");
  item.append(el("span", "exam-date np-data", `${row.weekday} ${formatShortDate(row.date)}`));
  item.append(examCodeTag(row.code, hueVar));
  if (row.daysFromToday !== null) {
    item.append(el("span", "np-hint", daysFromTodayText(row.daysFromToday)));
  }
  return item;
}

/** "i dag" / "om 1 dag" / "om {n} dager" — the singular/plural split every
 * other day-count sentence in this codebase already makes (D3). */
function daysFromTodayText(days: number): string {
  if (days === 0) return "i dag";
  if (days === 1) return "om 1 dag";
  return `om ${days} dager`;
}

/**
 * The connector between two consecutive dated rows. `row.gapToNext === 0` is
 * the reliable same-day signal for THIS connector specifically — `row.sameDay`
 * can also be true because of the row's relationship with the PREVIOUS row,
 * which says nothing about the gap to the next one.
 */
function examGap(row: ExamListRow): HTMLLIElement {
  if (row.gapToNext === 0) {
    return el("li", "exam-gap np-note-clash", "samme dag");
  }
  const gap = row.gapToNext ?? 0;
  const text = gap === 1 ? "1 dag mellomrom" : `${gap} dager mellomrom`;
  const item = el("li", "exam-gap np-note", row.tight ? `${text} · tett` : text);
  if (row.tight) item.classList.add("is-tight");
  return item;
}

/** One "dato ikke satt" row (DR-3) — kept, not dropped, so the course isn't silently missing. */
function datelessRow(code: string, hueVar: string): HTMLLIElement {
  const item = el("li", "exam-row exam-dateless");
  item.append(examCodeTag(code, hueVar));
  item.append(el("span", "np-note", "dato ikke satt"));
  return item;
}

/** Renders the chronological exam list into `listHost`. */
export function renderExamList(
  listHost: HTMLElement,
  courses: PlanCourseState[],
  semesterId: string,
  index: PlannerIndex | null,
  window: ExamWindow | null,
  todayIso: string,
  options: ExamRenderOptions = {},
): ExamRenderResult {
  const loading = options.loading ?? false;
  if (courses.length === 0) {
    return renderEmpty(listHost, "Legg til emner for å se eksamensdatoer.");
  }

  const hueByCode = new Map(courses.map((c) => [c.course.code, c.hueVar]));
  const inputs = collectExamInputs(courses, semesterId, index, window);

  if (inputs.length === 0) {
    return renderEmpty(
      listHost,
      loading ? null : "Ingen eksamensdatoer funnet ennå for emnene i planen.",
    );
  }

  const model = buildExamList(inputs, todayIso);

  if (model.rows.length === 0) {
    // Dated rows are empty, but dateless exams exist: still list them, under
    // one line saying no date is set rather than dropping them silently.
    const list = el("ul", "exam-list");
    for (const code of model.dateless) {
      list.append(datelessRow(code, hueByCode.get(code) ?? "--hue-blue"));
    }
    listHost.replaceChildren(
      el("p", "exam-empty np-hint", "Ingen eksamensdatoer satt ennå for emnene i planen."),
      list,
    );
    return { collisionCount: 0, state: "empty" };
  }

  const list = el("ul", "exam-list");
  model.rows.forEach((row, i) => {
    list.append(examRow(row, hueByCode.get(row.code) ?? "--hue-blue"));
    if (i < model.rows.length - 1) list.append(examGap(row));
  });
  for (const code of model.dateless) {
    list.append(datelessRow(code, hueByCode.get(code) ?? "--hue-blue"));
  }
  listHost.replaceChildren(list);

  // How many exam rows actually share their day with another (`sameDay` is set
  // on EVERY row of a same-date cluster) — so the caller's verdict reads "3
  // eksamener samme dag" for a 3-way clash, not the 2 adjacent-pair connectors
  // that `gapToNext === 0` would have counted.
  const collisionCount = model.rows.filter((row) => row.sameDay).length;

  return { collisionCount, state: "list" };
}
