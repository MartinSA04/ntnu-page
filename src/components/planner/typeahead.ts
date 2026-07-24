/**
 * The basket's add-course typeahead (PLANNER.md §2): `.np-field` input over
 * the planner index, diacritic-insensitive substring match, max 12 rows,
 * mono code + name, full keyboard operability (ArrowUp/Down/Enter/Escape).
 */
import type { PlannerIndexCourse } from "../../lib/planner/data.js";
import { el, fold } from "./dom.js";

const MAX_RESULTS = 12;

export interface TypeaheadOptions {
  field: HTMLElement;
  input: HTMLInputElement;
  listbox: HTMLUListElement;
  getCourses: () => PlannerIndexCourse[];
  isSelected: (code: string) => boolean;
  onPick: (course: PlannerIndexCourse) => void;
}

/** Wires a search input to a listbox of matches; returns nothing (event-driven, lives for the page). */
export function mountTypeahead(options: TypeaheadOptions): void {
  const { field, input, listbox, getCourses, isSelected, onPick } = options;
  let activeIndex = -1;
  let matches: PlannerIndexCourse[] = [];

  function close(): void {
    listbox.replaceChildren();
    listbox.hidden = true;
    activeIndex = -1;
    matches = [];
    input.removeAttribute("aria-activedescendant");
    input.setAttribute("aria-expanded", "false");
  }

  function optionId(index: number): string {
    return `planner-typeahead-option-${index}`;
  }

  function setActive(index: number): void {
    activeIndex = index;
    for (const [i, opt] of [...listbox.children].entries()) {
      opt.classList.toggle("is-active", i === index);
    }
    if (index >= 0) {
      input.setAttribute("aria-activedescendant", optionId(index));
      listbox.children[index]?.scrollIntoView({ block: "nearest" });
    } else {
      input.removeAttribute("aria-activedescendant");
    }
  }

  function render(): void {
    const query = fold(input.value.trim());
    if (query === "") {
      close();
      return;
    }
    matches = getCourses()
      .filter(
        ([code, name]) =>
          !isSelected(code) && (fold(code).includes(query) || fold(name).includes(query)),
      )
      .slice(0, MAX_RESULTS);

    listbox.replaceChildren();
    if (matches.length === 0) {
      listbox.hidden = true;
      activeIndex = -1;
      return;
    }

    matches.forEach((course, index) => {
      const [code, name] = course;
      const item = el("li", "planner-typeahead-option");
      item.id = optionId(index);
      item.setAttribute("role", "option");
      item.append(el("span", "np-data planner-typeahead-code", code));
      item.append(el("span", "planner-typeahead-name", name));
      item.addEventListener("mousedown", (event) => {
        // mousedown (not click) so it fires before the input's blur.
        event.preventDefault();
        onPick(course);
        input.value = "";
        close();
      });
      listbox.append(item);
    });
    listbox.hidden = false;
    input.setAttribute("aria-expanded", "true");
    setActive(0);
  }

  input.addEventListener("input", render);

  input.addEventListener("keydown", (event) => {
    if (listbox.hidden || matches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((activeIndex + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((activeIndex - 1 + matches.length) % matches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = matches[activeIndex] ?? matches[0];
      if (picked) {
        onPick(picked);
        input.value = "";
        close();
      }
    } else if (event.key === "Escape") {
      close();
    }
  });

  // Closes when focus leaves the field entirely (input -> listbox stays open; input -> elsewhere
  // closes). The listbox option's mousedown already preventDefault()s so a pick still lands
  // before this fires.
  field.addEventListener("focusout", (event) => {
    if (!field.contains(event.relatedTarget as Node | null)) close();
  });
}
