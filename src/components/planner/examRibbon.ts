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
import { dot, el } from "./dom.js";
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

export interface ExamRenderResult {
  collisionCount: number;
  /** "25. nov – 18. des" span of the rendered exams, or `null` when none are shown. */
  windowLabel: string | null;
}

function renderEmpty(frame: HTMLElement, listHost: HTMLElement, message: string): ExamRenderResult {
  frame.replaceChildren(el("p", "planner-exam-empty np-note", message));
  listHost.replaceChildren();
  return { collisionCount: 0, windowLabel: null };
}

function formatAxisDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getDate()}. ${MONTH_NAMES[d.getMonth()]}`;
}

/** One "dato ikke satt" row (DR-3) — kept, not dropped, so the course isn't silently missing. */
function datelessRow(code: string, hueVar: string): HTMLLIElement {
  const item = el("li", "planner-exam-row");
  item.append(el("span", "planner-exam-date np-data", "dato ikke satt"));
  const codeWrap = el("span", "planner-exam-code");
  codeWrap.append(dot(hueVar));
  codeWrap.append(el("span", "np-data", code));
  item.append(codeWrap);
  return item;
}

/** Renders the exam ribbon + sorted list into `frame` / `listHost`. */
export function renderExamRibbon(
  frame: HTMLElement,
  listHost: HTMLElement,
  courses: PlanCourseState[],
  semesterId: string,
  index: PlannerIndex | null,
): ExamRenderResult {
  if (courses.length === 0) {
    return renderEmpty(frame, listHost, "Legg til emner for å se eksamensdatoer.");
  }

  const hueByCode = new Map(courses.map((c) => [c.course.code, c.hueVar]));
  const inputs = collectExamInputs(courses, semesterId, index);
  const dateless = inputs.filter((e) => e.date === null);

  if (inputs.length === 0) {
    return renderEmpty(frame, listHost, "Ingen eksamensdatoer funnet ennå for emnene i planen.");
  }

  const rows = analyzeExams(inputs);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) {
    // Dated rows are empty, but dateless exams exist: still list them, no ribbon axis to plot.
    if (dateless.length > 0) {
      frame.replaceChildren(
        el(
          "p",
          "planner-exam-empty np-note",
          "Ingen eksamensdatoer satt ennå for emnene i planen.",
        ),
      );
      const list = el("ul", "planner-exam-list");
      for (const exam of dateless) {
        list.append(datelessRow(exam.code, hueByCode.get(exam.code) ?? "--hue-blue"));
      }
      listHost.replaceChildren(list);
      return { collisionCount: 0, windowLabel: null };
    }
    return renderEmpty(frame, listHost, "Ingen eksamensdatoer funnet ennå for emnene i planen.");
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

  frame.replaceChildren(ribbon);

  // Sorted mono list with gap annotations.
  const list = el("ul", "planner-exam-list");
  for (const row of rows) {
    const item = el("li", "planner-exam-row");
    item.append(el("span", "planner-exam-date np-data", row.date));
    const hueVar = hueByCode.get(row.code) ?? "--hue-blue";
    const codeWrap = el("span", "planner-exam-code");
    codeWrap.append(dot(hueVar));
    codeWrap.append(el("span", "np-data", row.code));
    item.append(codeWrap);

    const gapText = dayGapText(row);
    if (row.collision) {
      item.append(el("span", "np-note-clash", `${row.code} kolliderer med eksamen samme dag`));
    } else if (gapText) {
      const gapClass = row.tight ? "np-note-clash" : "np-note";
      item.append(el("span", gapClass, gapText));
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
  };
}
