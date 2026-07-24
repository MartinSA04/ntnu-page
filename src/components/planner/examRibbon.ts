/**
 * EKSAMENER — the exam ribbon (PLANNER.md §2). `.np-frame.np-ruled` strip
 * with a horizontal date axis over the semester's exam window, one square
 * hue dot per exam; same-day stacks get a red ring + `.np-note-clash` line;
 * below, the sorted mono list with day-gap annotations.
 */
import { analyzeExams, type ExamInput, type ExamRow } from "../../lib/planner/conflicts.js";
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

/**
 * Whether a `details.exams[].season` prose string (e.g. "Vår 2026") matches
 * the chosen semester's season, keyed off the `Semester.id` suffix (h/v).
 */
function seasonMatches(seasonText: string | null, semesterId: string): boolean {
  const letter = semesterId.trim().slice(-1).toLowerCase();
  if (letter !== "h" && letter !== "v") return true; // unknown suffix: don't filter
  if (!seasonText) return false;
  const lower = seasonText.toLowerCase();
  const markers = letter === "h" ? ["høst", "autumn"] : ["vår", "spring"];
  return markers.some((m) => lower.includes(m));
}

/** Collects one exam input per dated, in-semester exam occasion across the plan's courses. */
function collectExamInputs(courses: PlanCourseState[], semesterId: string): ExamInput[] {
  const inputs: ExamInput[] = [];
  for (const state of courses) {
    const details = state.bundle?.details;
    if (details?.exams && details.exams.length > 0) {
      for (const exam of details.exams) {
        if (!exam.date) continue;
        if (!seasonMatches(exam.season, semesterId)) continue;
        inputs.push({ code: state.course.code, date: exam.date });
      }
    }
    // Static tier fallback: no details loaded yet, nothing to show for this course.
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
}

function renderEmpty(frame: HTMLElement, listHost: HTMLElement, message: string): void {
  frame.replaceChildren(el("p", "planner-exam-empty np-note", message));
  listHost.replaceChildren();
}

/** Renders the exam ribbon + sorted list into `frame` / `listHost`. */
export function renderExamRibbon(
  frame: HTMLElement,
  listHost: HTMLElement,
  courses: PlanCourseState[],
  semesterId: string,
): ExamRenderResult {
  if (courses.length === 0) {
    renderEmpty(frame, listHost, "Legg til emner for å se eksamensdatoer.");
    return { collisionCount: 0 };
  }

  const hueByCode = new Map(courses.map((c) => [c.course.code, c.hueVar]));
  const inputs = collectExamInputs(courses, semesterId);

  if (inputs.length === 0) {
    renderEmpty(frame, listHost, "Ingen eksamensdatoer funnet ennå for emnene i planen.");
    return { collisionCount: 0 };
  }

  const rows = analyzeExams(inputs);
  const first = rows[0];
  const last = rows[rows.length - 1];
  if (!first || !last) {
    renderEmpty(frame, listHost, "Ingen eksamensdatoer funnet ennå for emnene i planen.");
    return { collisionCount: 0 };
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
  listHost.replaceChildren(list);

  // One "collision" per same-date group (a group may hold 2+ same-day exams).
  return { collisionCount: [...byDate.values()].filter((g) => g.length > 1).length };
}
