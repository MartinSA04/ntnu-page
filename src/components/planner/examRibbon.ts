/**
 * EKSAMENER — the exam ribbon (PRODUCT.md DR-3). `.np-frame.np-ruled` strip
 * with a horizontal date axis over the semester's exam window, one square
 * hue dot per exam; same-day stacks get a red ring + `.np-note-clash` line;
 * below, the sorted mono list with day-gap annotations, dateless exams as
 * "dato ikke satt" rows. Sourced from catalog `ExamDate` via the planner
 * index (`examsFromIndex`), not scraped `CourseExam` text — kont exams are
 * already excluded upstream by the crawler (see data.ts).
 */

import { analyzeExams, type ExamInput, type ExamRow } from "../../lib/planner/conflicts.js";
import { examsFromIndex, type PlannerIndex } from "../../lib/planner/data.js";
import { dot, el, formatShortDate } from "./dom.js";
import type { PlanCourseState } from "./types.js";

const MONTH_NAMES = [
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

/** Collects one exam input per catalog-sourced exam occasion (dated or not) across the plan's courses. */
function collectExamInputs(
  courses: PlanCourseState[],
  semesterId: string,
  index: PlannerIndex | null,
): ExamInput[] {
  if (!index) return [];
  const byCode = new Map(index.courses.map((c) => [c[0], c]));
  const inputs: ExamInput[] = [];
  for (const state of courses) {
    const row = byCode.get(state.course.code);
    if (!row) continue;
    inputs.push(...examsFromIndex(row, semesterId));
  }
  return inputs;
}

function monthLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${MONTH_NAMES[d.getMonth()]}`;
}

function dayGapText(row: ExamRow): string | null {
  if (row.dayGap === null) return null;
  if (row.collision) return "samme dag som neste";
  if (row.dayGap === 1) return "1 dag til neste";
  return `${row.dayGap} dager til neste`;
}

export interface ExamRenderOptions {
  /**
   * A course bundle or the planner index is still loading. Nothing is
   * asserted about the exam window until it isn't — "Ingen eksamensdatoer
   * funnet" while the fetch is in flight is the same false-and-loud statement
   * U5 removed from the week.
   */
  loading?: boolean;
}

export interface ExamRenderResult {
  collisionCount: number;
  /** "25. nov – 18. des" span of the rendered exams, or `null` when none are shown. */
  windowLabel: string | null;
  /** Which branch rendered. Only `"ribbon"` carries a meaningful `collisionCount`. */
  state: "ribbon" | "empty" | "loading";
}

/**
 * The ruling belongs to a ribbon with exams on it, not to the frame
 * (Ruling-Marks-The-Plan / D5) — an empty ruled rectangle holding an apology
 * is the opposite of what the rule says the ruling means.
 */
function setFrameRuled(frame: HTMLElement, ruled: boolean): void {
  frame.classList.toggle("np-ruled", ruled);
  frame.classList.toggle("is-empty", !ruled);
}

function renderEmpty(
  frame: HTMLElement,
  listHost: HTMLElement,
  message: string | null,
): ExamRenderResult {
  setFrameRuled(frame, false);
  frame.replaceChildren(...(message ? [el("p", "planner-exam-empty np-hint", message)] : []));
  listHost.replaceChildren();
  return {
    collisionCount: 0,
    windowLabel: null,
    state: message === null ? "loading" : "empty",
  };
}

/**
 * Renders a message where the ribbon would be — the exam half of
 * `renderGridMessage`. Use it when the CALLER knows something the ribbon
 * cannot work out for itself: C3's case is a semester the shipped index does
 * not cover at all, where "Ingen eksamensdatoer funnet ennå" would be a
 * finding reported by something that never looked. Pass no message to just
 * empty the frame.
 */
export function renderExamMessage(
  frame: HTMLElement,
  listHost: HTMLElement,
  message?: string | null,
): ExamRenderResult {
  return renderEmpty(frame, listHost, message ?? null);
}

function formatAxisDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getDate()}. ${MONTH_NAMES[d.getMonth()]}`;
}

/** The course chip a row wears — DESIGN §5's `.np-tag`, hue dot + mono code. */
function examCodeTag(code: string, hueVar: string): HTMLElement {
  const tag = el("span", "planner-exam-code np-tag");
  tag.append(dot(hueVar));
  tag.append(el("span", "np-data", code));
  return tag;
}

/** One "dato ikke satt" row (DR-3) — kept, not dropped, so the course isn't silently missing. */
function datelessRow(code: string, hueVar: string): HTMLLIElement {
  const item = el("li", "planner-exam-row");
  item.append(el("span", "planner-exam-date np-data", "dato ikke satt"));
  item.append(examCodeTag(code, hueVar));
  return item;
}

/** Renders the exam ribbon + sorted list into `frame` / `listHost`. */
export function renderExamRibbon(
  frame: HTMLElement,
  listHost: HTMLElement,
  courses: PlanCourseState[],
  semesterId: string,
  index: PlannerIndex | null,
  options: ExamRenderOptions = {},
): ExamRenderResult {
  const loading = options.loading ?? false;
  if (courses.length === 0) {
    return renderEmpty(frame, listHost, "Legg til emner for å se eksamensdatoer.");
  }

  const hueByCode = new Map(courses.map((c) => [c.course.code, c.hueVar]));
  const inputs = collectExamInputs(courses, semesterId, index);
  const dateless = inputs.filter((e) => e.date === null);

  if (inputs.length === 0) {
    return renderEmpty(
      frame,
      listHost,
      loading ? null : "Ingen eksamensdatoer funnet ennå for emnene i planen.",
    );
  }

  const rows = analyzeExams(inputs);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) {
    // Dated rows are empty, but dateless exams exist: still list them, no ribbon axis to plot.
    if (dateless.length > 0) {
      setFrameRuled(frame, false);
      frame.replaceChildren(
        el(
          "p",
          "planner-exam-empty np-hint",
          "Ingen eksamensdatoer satt ennå for emnene i planen.",
        ),
      );
      const list = el("ul", "planner-exam-list");
      for (const exam of dateless) {
        list.append(datelessRow(exam.code, hueByCode.get(exam.code) ?? "--hue-blue"));
      }
      listHost.replaceChildren(list);
      return { collisionCount: 0, windowLabel: null, state: "empty" };
    }
    return renderEmpty(
      frame,
      listHost,
      loading ? null : "Ingen eksamensdatoer funnet ennå for emnene i planen.",
    );
  }

  const firstMs = Date.parse(first.date);
  const lastMs = Date.parse(last.date);
  const span = Math.max(1, lastMs - firstMs);

  const ribbon = el("div", "planner-exam-ribbon");
  ribbon.setAttribute("role", "img");
  ribbon.setAttribute("aria-label", "Eksamensdatoer for emnene i planen, på en tidslinje");

  // Month labels along the axis.
  const axis = el("div", "planner-exam-axis");
  const months = new Set<string>();
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    if (months.has(key)) continue;
    months.add(key);
    const pos = ((Date.parse(row.date) - firstMs) / span) * 100;
    const label = el("span", "planner-exam-month np-data", monthLabel(row.date));
    label.style.setProperty("--planner-pos", `${pos}%`);
    axis.append(label);
  }
  ribbon.append(axis);

  // Dots, grouped by date so same-day stacks can get the collision ring.
  const byDate = new Map<string, ExamRow[]>();
  for (const row of rows) {
    const list = byDate.get(row.date) ?? [];
    list.push(row);
    byDate.set(row.date, list);
  }

  const dotsLayer = el("div", "planner-exam-dots");
  for (const [date, dateRows] of byDate) {
    const pos = ((Date.parse(date) - firstMs) / span) * 100;
    const stack = el("div", "planner-exam-stack");
    stack.style.setProperty("--planner-pos", `${pos}%`);
    if (dateRows.length > 1) stack.classList.add("is-clash");
    for (const row of dateRows) {
      const hueVar = hueByCode.get(row.code) ?? "--hue-blue";
      const d = dot(hueVar);
      d.setAttribute("title", `${row.code} · ${date}`);
      stack.append(d);
    }
    dotsLayer.append(stack);
  }
  ribbon.append(dotsLayer);

  setFrameRuled(frame, true);
  frame.replaceChildren(ribbon);

  // Sorted list with gap annotations. The date is formatted the same way the
  // section's own window label is — "9. des", not "2026-12-09" (D3).
  const list = el("ul", "planner-exam-list");
  for (const row of rows) {
    const item = el("li", "planner-exam-row");
    item.append(el("span", "planner-exam-date np-data", formatShortDate(row.date)));
    const hueVar = hueByCode.get(row.code) ?? "--hue-blue";
    item.append(examCodeTag(row.code, hueVar));

    const gapText = dayGapText(row);
    if (row.collision) {
      // A sentence, so grotesk with the code it quotes in `.np-data` (D1).
      const note = el("span", "np-note-clash");
      note.append(el("span", "np-data", row.code));
      note.append(" kolliderer med eksamen samme dag");
      note.setAttribute("aria-label", `${row.code} kolliderer med eksamen samme dag`);
      item.append(note);
    } else if (gapText) {
      // The gap is a mono fragment in both states — swapping it to
      // `.np-note-clash` when it turns red would also change its size and
      // voice mid-list. `.is-tight` carries the warning instead.
      const gap = el("span", "planner-exam-gap np-note", gapText);
      if (row.tight) gap.classList.add("is-tight");
      item.append(gap);
    }
    list.append(item);
  }
  for (const exam of dateless) {
    list.append(datelessRow(exam.code, hueByCode.get(exam.code) ?? "--hue-blue"));
  }
  listHost.replaceChildren(list);

  const windowLabel =
    first.date === last.date
      ? formatAxisDate(first.date)
      : `${formatAxisDate(first.date)} – ${formatAxisDate(last.date)}`;

  // One "collision" per same-date group (a group may hold 2+ same-day exams).
  return {
    collisionCount: [...byDate.values()].filter((g) => g.length > 1).length,
    windowLabel,
    state: "ribbon",
  };
}
