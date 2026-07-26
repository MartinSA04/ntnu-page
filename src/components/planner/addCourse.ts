/**
 * Add-course modal (Task 12 — replaces the inline `planner-add-*` typeahead
 * that used to live in the Emner rail).
 *
 * One native `<dialog>`, built and mounted once (same idiom as
 * `studieinfo.ts`/`popover.ts`): a flat search over the *whole* catalog
 * (`index.courses`, the same `search-index.json` `/emner/` searches), a row
 * per match with a `Legg til` button that flips to `Lagt til ✓` + `Fjern`,
 * and the dialog stays open afterwards so several courses can be added in
 * one visit. Esc/backdrop-adjacent dismissal is the native `showModal()`
 * behaviour — nothing extra to wire.
 *
 * **The clash line is lazy**, reusing `/emner/`'s exact pattern
 * (`attachClashPreview`): computed on a row's first hover/focus, cached
 * after that, and invalidated (recomputed on the next hover) whenever the
 * plan changes. A per-row generation counter guards against a slow fetch
 * that started before a plan change overwriting the fresher one that
 * started after it. The same `fetchCourseBundle` call also carries the
 * course's credits — `search-index.json` rows have no credits field of
 * their own, and this reuses the one memoized request rather than costing a
 * second round trip.
 *
 * **Not-taught rows** (`offeredYears` missing the index's own year) get no
 * add control at all — just the friendly `kun eksamen · ikke undervist i
 * {year}` note (S13/`/emne/`'s own copy) — instead of an add whose later
 * bundle fetch for a year the course was never offered in would error.
 *
 * `deps` is a plain object the caller (plannerApp.ts) is expected to *mutate
 * in place* as its own state changes (semester switch, programme change,
 * the catalog index finishing its fetch) rather than re-mounting: every
 * function here reads `deps.foo` at call time, never destructures it once
 * up front, so the caller's assignment is picked up on the very next open
 * or the very next lazy check — no re-mount, no risk of doubled listeners.
 * `index` is nullable because the catalog fetch is async and can still be
 * in flight the moment the page mounts; the dialog says so rather than
 * asserting an empty catalog.
 */

import { fetchCourseBundle, type PlannerIndex } from "../../lib/planner/data.js";
import { semesterYear } from "../../lib/planner/schedule.js";
import { DEFAULT_VERSION, type PlanStore } from "../../lib/planner/store.js";
import { clashSentence, planClash } from "../site/planClash.js";
import { el, fold, formatCreditNumber } from "./dom.js";
import type { SemesterSummary } from "./plannerApp.js";

export interface AddCourseDeps {
  store: PlanStore;
  /** `null` while `loadPlannerIndex()` is still in flight — see file header. */
  index: PlannerIndex | null;
  semester: SemesterSummary;
  programCode: string | null;
}

export interface AddCourseHandle {
  open(): void;
}

/** Rows shown at once — matches the deleted typeahead's own cap. */
const MAX_ROWS = 12;

/**
 * Mounts the add-course dialog once. `signal` aborts on the next page swap
 * (`astro:before-swap`), removing the dialog and dropping its `onPlanChange`
 * subscription — a re-mount per `astro:page-load` never leaves a stale one
 * behind (same guard as studieinfo.ts/popover.ts).
 */
export function mountAddCourse(deps: AddCourseDeps, signal: AbortSignal): AddCourseHandle {
  document.getElementById("planner-add-dialog")?.remove();

  const dialog = el("dialog", "np-frame add-course-dialog") as HTMLDialogElement;
  dialog.id = "planner-add-dialog";
  dialog.setAttribute("aria-labelledby", "add-course-title");

  const body = el("div", "add-course-body");
  dialog.append(body);

  const title = el("h2", "add-course-title", "Legg til emne");
  title.id = "add-course-title";
  body.append(title);

  const searchForm = el("form", "np-field add-course-field") as HTMLFormElement;
  searchForm.autocomplete = "off";
  const searchInput = el("input", "add-course-input") as HTMLInputElement;
  searchInput.type = "search";
  searchInput.placeholder = "Søk etter emnekode eller emnenavn …";
  searchInput.setAttribute("aria-label", "Søk etter emne");
  searchForm.append(searchInput);
  body.append(searchForm);

  const status = el("p", "np-hint add-course-status");
  status.setAttribute("aria-live", "polite");
  body.append(status);

  const results = el("ul", "add-course-results");
  body.append(results);

  const closeBtn = el("button", "np-btn add-course-close", "Lukk") as HTMLButtonElement;
  closeBtn.type = "button";
  body.append(closeBtn);

  document.body.append(dialog);

  /** The element focus returns to once the dialog closes. */
  let invoker: HTMLElement | null = null;

  /**
   * The rows currently on screen. Reset at the top of every `render()` and
   * driven back in place (not a full re-render) by `syncRows` on a plan
   * change — rebuilding the list on every add would throw focus back to
   * `<body>` on the very button the student just pressed (mirrors emner's A5
   * fix).
   */
  const rows: { sync: () => void; invalidate: () => void }[] = [];

  function setAddState(
    button: HTMLButtonElement,
    added: HTMLElement,
    removeBtn: HTMLButtonElement,
    inPlan: boolean,
  ): void {
    button.hidden = inPlan;
    added.hidden = !inPlan;
    removeBtn.hidden = !inPlan;
  }

  /**
   * Lazy clash + credits line, on first hover/focus of the row — exactly
   * `/emner/`'s `attachClashPreview`, generalized with a generation counter:
   * a plan change invalidates (so the next hover recomputes), and if a
   * slower fetch that started *before* the change resolves *after* a fresh
   * one triggered by a later hover, its stale result is discarded rather
   * than overwriting the newer verdict.
   */
  function attachPreview(
    row: HTMLLIElement,
    noteEl: HTMLElement,
    code: string,
    version: string,
  ): () => void {
    let checked = false;
    let generation = 0;
    const check = async (): Promise<void> => {
      if (checked) return;
      checked = true;
      const gen = ++generation;
      const year = semesterYear(deps.semester.id);
      if (year === null) return;
      const [bundle, verdict] = await Promise.all([
        fetchCourseBundle(code, year, version),
        planClash(
          { code, version },
          deps.store.loadPlan(),
          deps.semester,
          undefined,
          deps.programCode,
        ),
      ]);
      if (gen !== generation) return; // superseded — a newer check is already in flight/done
      const parts: string[] = [];
      const credits = bundle.details?.credits;
      if (credits != null) parts.push(`${formatCreditNumber(credits)} sp`);
      parts.push(clashSentence(verdict, deps.semester));
      noteEl.textContent = parts.join(" · ");
      noteEl.classList.toggle("is-clash", verdict.kind === "clash");
    };
    row.addEventListener("pointerenter", check);
    row.addEventListener("focusin", check);
    return () => {
      checked = false;
      noteEl.textContent = "";
      noteEl.classList.remove("is-clash");
    };
  }

  function buildRow(course: PlannerIndex["courses"][number]): HTMLLIElement {
    const [code, name, , , versionRaw, offeredYears] = course;
    const version = versionRaw && versionRaw !== "" ? versionRaw : DEFAULT_VERSION;
    const currentYear = deps.index?.year ?? null;
    const notTaught = currentYear !== null && !offeredYears.includes(currentYear);

    const row = el("li", "add-course-row") as HTMLLIElement;
    const head = el("span", "add-course-row-head");
    head.append(el("span", "np-data add-course-row-code", code));
    head.append(el("span", "add-course-row-name", name));
    row.append(head);

    const note = el("p", "np-hint add-course-row-note");
    row.append(note);

    const actions = el("span", "add-course-row-actions");
    row.append(actions);

    if (notTaught) {
      // S13: a course whose current catalog year has no offering would 404
      // on its timetable fetch the moment it landed in the plan — the row
      // says so up front instead of offering an add that later errors.
      note.textContent = `kun eksamen · ikke undervist i ${currentYear}`;
      return row;
    }

    const addBtn = el("button", "np-btn add-course-add", "Legg til") as HTMLButtonElement;
    addBtn.type = "button";
    addBtn.setAttribute("aria-label", `Legg til ${code} i planen`);
    const added = el("span", "np-note add-course-added", "Lagt til ✓");
    const removeBtn = el("button", "np-btn add-course-remove", "Fjern") as HTMLButtonElement;
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", `Fjern ${code} fra planen`);
    actions.append(addBtn, added, removeBtn);

    const sync = (): void => setAddState(addBtn, added, removeBtn, deps.store.hasCourse(code));
    sync();

    addBtn.addEventListener("click", () => {
      deps.store.addCourse({ code, name, version });
      sync();
    });
    removeBtn.addEventListener("click", () => {
      deps.store.removeCourse(code);
      sync();
    });

    const invalidate = attachPreview(row, note, code, version);
    rows.push({ sync, invalidate });
    return row;
  }

  function render(): void {
    const index = deps.index;
    const query = fold(searchInput.value.trim());
    rows.length = 0;
    results.replaceChildren();

    if (!index) {
      status.textContent = "Henter emner …";
      return;
    }
    if (query === "") {
      status.textContent = `Skriv for å søke i ${index.courses.length} emner.`;
      return;
    }

    const matched = index.courses.filter(
      ([code, name]) => fold(code).includes(query) || fold(name).includes(query),
    );
    const shown = matched.slice(0, MAX_ROWS);
    for (const course of shown) results.append(buildRow(course));

    status.textContent =
      matched.length > shown.length
        ? `Viser ${shown.length} av ${matched.length} treff — skriv for å filtrere.`
        : `${matched.length} treff.`;
  }

  /** In-place refresh of the rows currently on screen — see `rows`. */
  function syncRows(): void {
    for (const row of rows) {
      row.invalidate();
      row.sync();
    }
  }

  searchInput.addEventListener("input", render);
  searchForm.addEventListener("submit", (event) => event.preventDefault());
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    invoker?.focus?.();
    invoker = null;
  });
  // Cross-tab/self-triggered plan changes while the dialog is open (a row's
  // own add/remove already calls `sync()` directly, but a drop/restore
  // elsewhere or another tab should still be reflected).
  signal.addEventListener("abort", deps.store.onPlanChange(syncRows));
  signal.addEventListener("abort", () => dialog.remove());

  function open(): void {
    invoker = (document.activeElement as HTMLElement | null) ?? null;
    searchInput.value = "";
    render();
    dialog.showModal();
    searchInput.focus();
  }

  return { open };
}
