/**
 * The basket panel (PLANNER.md §2): `.np-panel` with one `.np-tag` per
 * course (hue dot + code + remove ×), the add-typeahead field, and a
 * program-context `.np-note` line when the plan has one.
 */
import type { PlannerIndex, PlannerIndexCourse } from "../../lib/planner/data.js";
import type { PlanCourse } from "../../lib/planner/store.js";
import { dot, el } from "./dom.js";
import { mountTypeahead } from "./typeahead.js";
import type { PlanCourseState } from "./types.js";

export interface BasketOptions {
  field: HTMLElement;
  input: HTMLInputElement;
  listbox: HTMLUListElement;
  onAdd: (course: PlanCourse) => void;
}

let plannerIndex: PlannerIndex | null = null;

/** Supplies the loaded planner index to the typeahead once available (set by the orchestrator). */
export function setBasketIndex(index: PlannerIndex): void {
  plannerIndex = index;
}

/** Renders the current course tags + the program-context note. */
export function renderBasket(
  tagsHost: HTMLElement,
  noteHost: HTMLElement,
  courses: PlanCourseState[],
  program: { code: string; name: string; cohort: number } | undefined,
  onRemove: (code: string) => void,
): void {
  tagsHost.replaceChildren();

  if (courses.length === 0) {
    tagsHost.append(el("p", "planner-basket-empty np-note", "Ingen emner i planen ennå."));
  } else {
    for (const state of courses) {
      const tag = el("span", "np-tag planner-tag");
      tag.append(dot(state.hueVar));
      tag.append(el("span", "planner-tag-code", state.course.code));
      const remove = el("button", "planner-tag-remove");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `Fjern ${state.course.code} fra planen`);
      remove.addEventListener("click", () => onRemove(state.course.code));
      tag.append(remove);
      tagsHost.append(tag);
    }
  }

  noteHost.replaceChildren();
  if (program) {
    noteHost.append(el("p", "np-note", `Fra ${program.code}, kull ${program.cohort}`));
  }
}

/** Wires the add-typeahead once (idempotent per page load). */
export function mountBasket(options: BasketOptions, isSelected: (code: string) => boolean): void {
  mountTypeahead({
    field: options.field,
    input: options.input,
    listbox: options.listbox,
    getCourses: (): PlannerIndexCourse[] => plannerIndex?.courses ?? [],
    isSelected,
    onPick: (course) => {
      const [code, name] = course;
      options.onAdd({ code, name });
    },
  });
}
