/**
 * Add-course modal. One native `<dialog>`, mounted once: a search over the
 * *whole* catalog through `/emner/`'s ranked `searchCatalog`, a row per match
 * with **one persistent action button** whose verb follows the plan entry
 * (`addCourseRowControl`), and the dialog stays open for several adds.
 *
 * **ONE DOOR INTO THE PICKER, with the study plan as a FILTER on it.** There used
 * to be a second: "Velg fra studieplanen (8)" in the credit-gap line, `hidden`
 * until the plan was short of credits — and it opened *this* dialog, unfiltered,
 * on the whole catalog. So the promise in its label was never kept: the pool it
 * named was nowhere on the surface it opened. It is a facet beside the search
 * field now (`studyPlanCodes`), and the dialog opens with the facet already
 * engaged in exactly the state that button used to render in (`openScoped`), so
 * the student presses the same one control and lands on the pool instead of on
 * an empty search. (The planner's collapsed "Fra studieplanen" panel is not a
 * third door — it is the groups with their verbatim prose, DR-5, which is a
 * different question from "search among them".)
 *
 * The facet SCOPES the search rather than replacing it: with a 300-entry
 * late-year pool, filtering and then searching is the point. It is absent, not
 * merely unpressed, when the pool is empty — a filter over nothing is a control
 * that cannot do anything.
 *
 * Esc is native `showModal()` behaviour as long as nothing inside eats the key
 * (see `searchInput.type`). Backdrop clicks dismiss through
 * `dismissOnBackdropClick`, which replaced `closedby="any"` — that attribute is
 * absent on iOS and leaks its dismissing tap into the page underneath where it
 * exists. A text selection dragged from the field onto the backdrop still does
 * not close it: the helper requires the gesture to BEGIN on the backdrop too,
 * which is the part the bare `event.target === dialog` idiom gets wrong.
 *
 * **No per-row clash preview here, and none on `/emner/` either.** Searching is
 * not the moment a plan is judged. Do not reintroduce it on a search surface on
 * consistency grounds — the asymmetry is the decision.
 *
 * **Not-taught rows** are not rendered and do not count toward the total: this
 * window is twelve rows deep and "matematikk" spent six of them on courses the
 * dialog was refusing to add. When a query matches nothing else, the status
 * says so specifically rather than "0 treff".
 *
 * `deps` is mutated in place by the caller rather than re-mounted: every
 * function reads `deps.foo` at call time.
 */

import { dismissOnBackdropClick } from "../../lib/dialogDismiss.js";
import { addCourseRowControl } from "../../lib/planner/courseAction.js";
import type { PlannerIndex } from "../../lib/planner/data.js";
import { searchCatalog } from "../../lib/planner/searchCatalog.js";
import { type AddCourseInput, DEFAULT_VERSION, type PlanStore } from "../../lib/planner/store.js";
import { el } from "./dom.js";

export interface AddCourseDeps {
  store: PlanStore;
  /** `null` while `loadPlannerIndex()` is still in flight — see file header. */
  index: PlannerIndex | null;
  /**
   * The catalog download failed, so `index` stays `null` until the planner's
   * "Prøv igjen" refetches. Without it the dialog read "Henter emner …" forever
   * over a dead download and offered no way out.
   */
  indexFailed?: boolean;
  /**
   * The study plan's choice pool for the planned period, as codes, read at call
   * time. Empty (or absent) ⇒ no facet is rendered.
   *
   * The WHOLE pool, not the pool minus the plan: the facet's count has to name
   * what pressing it shows, and rows carry their own membership state ("I
   * planen", "Dropp"), so a course added from the list must stay in it rather
   * than vanish from under the button that was just pressed.
   */
  studyPlanCodes?: () => string[];
  /**
   * True when the dialog should open with the facet already engaged — the
   * planner passes "this plan is short of credits", which is the exact state the
   * removed "Velg fra studieplanen" button used to render in. Anything else
   * opens on the whole catalog, so the five-codes flow (PRODUCT §3's persona B,
   * who has no programme and therefore no pool) is untouched.
   */
  openScoped?: () => boolean;
}

export interface AddCourseHandle {
  open(): void;
}

/**
 * Rows shown at once. The cap is why `render()` ranks through `searchCatalog`
 * rather than keeping its own `filter()`: unranked catalog order put TMA4100 at
 * row 77 of 112 for "matematikk", and here only the first 12 survive.
 */
const MAX_ROWS = 12;

/**
 * Mounts the add-course dialog once. `signal` aborts on the next page swap,
 * removing the dialog and dropping its `onPlanChange` subscription, so a
 * re-mount never leaves a stale one behind.
 */
export function mountAddCourse(deps: AddCourseDeps, signal: AbortSignal): AddCourseHandle {
  document.getElementById("planner-add-dialog")?.remove();

  const dialog = el("dialog", "np-frame add-course-dialog") as HTMLDialogElement;
  dialog.id = "planner-add-dialog";
  dialog.setAttribute("aria-labelledby", "add-course-title");
  // Esc and the close watcher from the platform; the backdrop click by hand,
  // because `closedby="any"` is absent on iOS and leaks its click on touch
  // where it exists (`dialogDismiss.ts`).
  dialog.setAttribute("closedby", "closerequest");
  dismissOnBackdropClick(dialog, signal);

  // The masthead the planner's other surfaces open on, in its paper variant:
  // this dialog is about the catalog, not one course, so it has no hue. Outside
  // the scrolling body, so it stays put while a long result list moves.
  const head = el("div", "np-head add-course-head");
  const ident = el("div", "np-head-ident");
  const title = el("h2", "np-head-title add-course-title", "Legg til emne");
  title.id = "add-course-title";
  ident.append(title);
  head.append(ident);
  dialog.append(head);

  const body = el("div", "add-course-body");
  dialog.append(body);

  // The field and its one facet share a row: a filter reads as a filter when it
  // stands beside the thing it filters, and as a second search when it does not.
  const searchRow = el("div", "add-course-search");
  body.append(searchRow);

  const searchForm = el("form", "np-field add-course-field") as HTMLFormElement;
  searchForm.autocomplete = "off";
  const searchInput = el("input", "add-course-input") as HTMLInputElement;
  // NOT `type="search"`: Chrome's search input consumes the first Escape to
  // clear itself and cancels the dialog's close request with it, so Esc from
  // the field emptied it instead of leaving and dismissal took two presses. The
  // native clear button is not load-bearing — `open()` resets the value anyway.
  //
  // The *role* is the half worth keeping and comes free of the behaviour:
  // `searchbox` is what makes a screen reader say "search field", and unlike
  // the input type it changes nothing about Escape.
  searchInput.type = "text";
  searchInput.role = "searchbox";
  searchInput.placeholder = "Søk etter emnekode eller emnenavn …";
  searchInput.setAttribute("aria-label", "Søk etter emne");
  searchForm.append(searchInput);
  searchRow.append(searchForm);

  /**
   * The facet. `.np-toggle--text` because "Fra studieplanen (8)" is a phrase,
   * not a code — tracked caps would wrap it to two rows (DESIGN §5). Its state
   * is `aria-pressed`, which is the primitive's own grammar and what fills it
   * with ink when it is on.
   */
  const scopeBtn = el("button", "np-toggle np-toggle--text add-course-scope") as HTMLButtonElement;
  scopeBtn.type = "button";
  searchRow.append(scopeBtn);

  /** Whether the search is scoped to the study plan's pool. */
  let scoped = false;

  // Result count *and* the dialog's only live region: a row's action writes its
  // confirmation here, because the button that did it stays put and silent
  // otherwise. The next keystroke restores the count.
  const status = el("p", "np-hint add-course-status");
  status.setAttribute("aria-live", "polite");
  body.append(status);

  const results = el("ul", "add-course-results");
  body.append(results);

  // Kept even though Esc and the backdrop both dismiss: on touch there is no
  // Esc, and a backdrop tap is not a gesture to have to guess at.
  const actions = el("div", "np-actions add-course-actions");
  const closeBtn = el("button", "np-btn add-course-close", "Lukk") as HTMLButtonElement;
  closeBtn.type = "button";
  actions.append(closeBtn);
  body.append(actions);

  document.body.append(dialog);

  /** The element focus returns to once the dialog closes. */
  let invoker: HTMLElement | null = null;

  /**
   * The rows currently on screen. Reset at the top of every `render()` and
   * driven back in place by `syncRows` on a plan change — rebuilding the list
   * on every add would throw focus to `<body>` from the button just pressed.
   */
  const rows: { sync: () => void }[] = [];

  /** True when `course` is in the catalog year's own offering — see `render`. */
  function isTaught(course: PlannerIndex["courses"][number]): boolean {
    const year = deps.index?.year ?? null;
    return year === null || course[5].includes(year);
  }

  /**
   * The pool as the dialog can actually show it: the study plan's codes
   * intersected with the taught catalog rows, in catalog order.
   *
   * Intersected rather than trusted, because the count on the facet must be the
   * number of rows pressing it produces. A study-plan course with no catalog row
   * has nothing for this dialog to add, and counting it would put a number on
   * the control that the list then fails to reach.
   */
  function studyPlanRows(taught: PlannerIndex["courses"]): PlannerIndex["courses"] {
    const codes = deps.studyPlanCodes?.() ?? [];
    if (codes.length === 0) return [];
    const wanted = new Set(codes);
    return taught.filter((course) => wanted.has(course[0]));
  }

  /**
   * The facet's label and state. Absent when the pool is empty — including the
   * whole of persona B's flow, who has no programme and therefore no study plan
   * at all, and who must never be shown a filter that can only subtract.
   */
  function renderScope(available: number): void {
    scopeBtn.hidden = available === 0;
    if (available === 0) {
      scoped = false;
      return;
    }
    scopeBtn.textContent = `Fra studieplanen (${available})`;
    scopeBtn.setAttribute("aria-pressed", String(scoped));
  }

  /** Builds one row. The caller has already established `isTaught(course)`. */
  function buildRow(course: PlannerIndex["courses"][number]): HTMLLIElement {
    const [code, name, , , versionRaw] = course;
    const version = versionRaw && versionRaw !== "" ? versionRaw : DEFAULT_VERSION;

    const row = el("li", "add-course-row") as HTMLLIElement;
    const head = el("span", "add-course-row-head");
    head.append(el("span", "np-data add-course-row-code", code));
    head.append(el("span", "add-course-row-name", name));
    row.append(head);

    const actions = el("span", "add-course-row-actions");
    row.append(actions);

    // One control, never hidden. The old add/added/remove triple hid the button
    // the student had just pressed — and hid nothing in practice, since
    // `.np-btn { display: inline-flex }` outranks the UA `[hidden]`, so a row
    // painted all three at once. `.add-course-added` is a plain `<span>` with
    // no `display` of its own, so `hidden` does work on it.
    const stateEl = el("span", "np-note add-course-added");
    // Keeps the `.add-course-add` hook e2e/flows.pw.ts:401 clicks, even
    // though this is now the row's only action button whatever it reads.
    const actionBtn = el("button", "np-btn add-course-add") as HTMLButtonElement;
    actionBtn.type = "button";
    actions.append(stateEl, actionBtn);

    const input: AddCourseInput = { code, name, version };
    const sync = (): void => {
      const control = addCourseRowControl(deps.store, input);
      actionBtn.textContent = control.label;
      actionBtn.setAttribute("aria-label", control.ariaLabel);
      stateEl.textContent = control.state;
      // Lets site.css mute "fra programmet"/"droppet" while "I planen" keeps
      // the accent — the span paints all three today.
      stateEl.dataset.state = control.stateKind;
      stateEl.hidden = control.state === "";
    };
    sync();

    actionBtn.addEventListener("click", () => {
      // Re-derived on press, not captured at build time: the plan can have
      // changed since (another row, another tab, the study-plan derive).
      status.textContent = addCourseRowControl(deps.store, input).run();
      sync();
    });

    rows.push({ sync });
    return row;
  }

  function render(): void {
    const index = deps.index;
    const query = searchInput.value.trim();
    rows.length = 0;
    results.replaceChildren();

    if (!index) {
      renderScope(0);
      // A failed download is not a slow one: "Henter emner …" over a dead fetch
      // never resolves, and this dialog is the only way to add a course by
      // code. The retry lives on the planner's exam panel and repairs both
      // surfaces at once, so this states the fact rather than pointing at a
      // control that is not in here.
      status.textContent = deps.indexFailed ? "Fikk ikke hentet emnekatalogen." : "Henter emner …";
      return;
    }
    // Not-taught courses are excluded outright, in the count as well as the
    // list — see the file header.
    const taught = index.courses.filter(isTaught);
    const pool = studyPlanRows(taught);
    renderScope(pool.length);
    const source = scoped ? pool : taught;

    if (query === "") {
      // Scoped, the empty query is not an empty state: the pool IS the answer to
      // "what does my study plan offer", and it is what the removed door
      // promised. Unscoped it stays a prompt — 4 767 rows is not a list.
      if (scoped) {
        for (const course of pool.slice(0, MAX_ROWS)) results.append(buildRow(course));
        status.textContent =
          pool.length > MAX_ROWS
            ? `Viser ${MAX_ROWS} av ${pool.length} emner fra studieplanen din. Skriv for å filtrere.`
            : `${pool.length} ${pool.length === 1 ? "emne" : "emner"} fra studieplanen din.`;
        return;
      }
      status.textContent = `Skriv for å søke i ${taught.length} emner.`;
      return;
    }

    const matched = searchCatalog(source, query);
    const shown = matched.slice(0, MAX_ROWS);
    for (const course of shown) results.append(buildRow(course));

    if (matched.length === 0) {
      // The filter is the reason there is nothing here, so the message names it
      // and the way out is the control beside the field. Silently searching the
      // whole catalog instead would be the scope escaping on its own.
      const outside = scoped ? searchCatalog(taught, query).length : 0;
      if (outside > 0) {
        status.textContent = `Ingen treff i studieplanen din. ${outside} treff i resten av emnekatalogen. Slå av «Fra studieplanen» for å se dem.`;
        return;
      }
      // "0 treff" over a query that matched only not-taught courses reads as
      // "no such course", which is wrong and unactionable.
      const hidden = searchCatalog(index.courses, query).length;
      const subject = hidden === 1 ? "Ett emne" : `${hidden} emner`;
      status.textContent =
        hidden > 0
          ? `Ingen treff undervises i ${index.year}. ${subject} i emnekatalogen passer søket, men undervises ikke i år.`
          : "0 treff. Prøv emnekode eller navn.";
      // A true zero is a sentence and a Lukk button. There is nowhere further
      // to send the student: `/emner/`, which searched more than this dialog
      // does because it kept the not-taught rows, is deleted (PRODUCT D10).
      return;
    }

    status.textContent =
      matched.length > shown.length
        ? `Viser ${shown.length} av ${matched.length} treff. Skriv for å filtrere.`
        : `${matched.length} treff.`;
  }

  /** In-place refresh of the rows currently on screen — see `rows`. */
  function syncRows(): void {
    for (const row of rows) row.sync();
  }

  searchInput.addEventListener("input", render);
  /**
   * Enter adds, when the query names exactly one course.
   *
   * The five-codes flow is the one PRODUCT §3's persona B arrives on — paste a
   * code, add it, next — and Enter did nothing at all, so each code cost a
   * select-all, a retype and a trip to the mouse. It commits only on an
   * unambiguous query: an exact code, or a single remaining match. Anything
   * else and the student is still choosing, and adding for them would be
   * guessing with their plan.
   *
   * The field clears on success (and only on success) because the next thing
   * typed here is the next code, never a correction to the one that worked.
   */
  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const index = deps.index;
    const query = searchInput.value.trim();
    if (!index || query === "") return;
    const taught = index.courses.filter(isTaught);
    // The key commits what the list is showing. Enter over a scoped, empty
    // result adding a course the student cannot see would be the filter lying
    // about what is in scope.
    const source = scoped ? studyPlanRows(taught) : taught;
    const matched = searchCatalog(source, query);
    const exact = matched.filter((course) => course[0].toUpperCase() === query.toUpperCase());
    const target = exact.length === 1 ? exact[0] : matched.length === 1 ? matched[0] : undefined;
    if (!target) return;
    const [code, name, , , version] = target;
    const control = addCourseRowControl(deps.store, { code, name, version: version ?? undefined });
    // Enter may only ever put a course IN the plan. On a course already there
    // `run()` is Fjern or Dropp — pressing Enter on the code you just typed and
    // having it removed is the opposite of what the key means here.
    if (control.stateKind !== "none" && control.stateKind !== "dropped") return;
    const confirmation = control.run();
    searchInput.value = "";
    // AFTER the re-render, not before. `render()` writes its own status for the
    // now-empty query ("Skriv for å søke i 4767 emner."), so setting the
    // confirmation first threw it away — the keyboard path cleared the field,
    // emptied the list and said nothing, which is indistinguishable from a
    // cancelled search even though the plan had just changed. The mouse path
    // never had this because it does not re-render.
    render();
    status.textContent = confirmation;
    searchInput.focus();
  });
  // Focus stays on the facet, not on the field: a filter is a control a student
  // presses and then reads the result of, and often presses again.
  scopeBtn.addEventListener("click", () => {
    scoped = !scoped;
    render();
  });
  closeBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    invoker?.focus?.();
    invoker = null;
  });
  // Cross-tab/self-triggered plan changes while the dialog is open (a row's own
  // add/remove already calls `sync()` directly).
  signal.addEventListener("abort", deps.store.onPlanChange(syncRows));
  signal.addEventListener("abort", () => dialog.remove());

  function open(): void {
    invoker = (document.activeElement as HTMLElement | null) ?? null;
    searchInput.value = "";
    // The one thing `open()` decides: whether this is the "I am short of
    // credits" opening. `render()` clears the flag again if the pool turns out
    // to be empty, so a stale yes can never leave the list scoped to nothing.
    scoped = deps.openScoped?.() ?? false;
    render();
    dialog.showModal();
    searchInput.focus();
  }

  return { open };
}
