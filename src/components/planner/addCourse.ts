/**
 * Add-course modal. One native `<dialog>`, mounted once: a search over the
 * *whole* catalog through `/emner/`'s ranked `searchCatalog`, a row per match
 * with **one persistent action button** whose verb follows the plan entry
 * (`addCourseRowControl`), and the dialog stays open for several adds.
 *
 * Esc is native `showModal()` behaviour as long as nothing inside eats the key
 * (see `searchInput.type`). Backdrop clicks dismiss via `closedby="any"` —
 * native light dismiss, so a text selection dragged onto the backdrop does not
 * close it, which the hand-rolled `event.target === dialog` idiom gets wrong.
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

import type { PlannerIndex } from "../../lib/planner/data.js";
import { type AddCourseInput, DEFAULT_VERSION, type PlanStore } from "../../lib/planner/store.js";
import { searchCatalog } from "../site/catalogSearch.js";
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

/** What a row's single button says, and what pressing it does. */
export interface AddCourseRowControl {
  /** Visible label — the verb for what the press will do. */
  label: string;
  /** Accessible name; contains `label`, so voice control matches it (2.5.3). */
  ariaLabel: string;
  /** The state beside the button; `""` when the course is not in the plan. */
  state: string;
  /**
   * Machine-readable twin of `state`. The span carries three sentences that do
   * not want the same tone — "I planen" is membership (accent), "fra
   * programmet" and "droppet" are provenance (muted). CSS cannot select on
   * text, so the tone split needs this hook.
   */
  stateKind: "none" | "added" | "program" | "dropped";
  /** Performs the action and returns the sentence to announce afterwards. */
  run: () => string;
}

/**
 * Derives a row's control from the plan *entry*, not from `hasCourse`.
 *
 * Four states, because §0.3/D3 say a programme course is never deleted: absent
 * → "Legg til", a manual add → "Fjern", a programme course → "Dropp", a dropped
 * programme course → "Legg tilbake". Calling `removeCourse` unconditionally
 * hard-deleted a programme course, and with no `dropped` marker left behind the
 * next study-plan derive silently put it back. Reading `hasCourse` reports a
 * *dropped* course as present, so the modal asserted the course was in a plan
 * that excludes it, with an inert control as the only way back.
 *
 * `run()` returns its own confirmation because the control stays on screen and
 * keeps focus: hiding the pressed button dropped focus to `<body>` and left the
 * add unannounced, so the dialog's live region is the only thing reporting it.
 */
export function addCourseRowControl(store: PlanStore, course: AddCourseInput): AddCourseRowControl {
  const code = course.code;
  const entry = store.loadPlan().courses.find((c) => c.code === code);
  if (!entry) {
    return {
      label: "Legg til",
      ariaLabel: `Legg til ${code} i planen`,
      state: "",
      stateKind: "none",
      run: () => {
        store.addCourse(course);
        return `${code} lagt til i planen.`;
      },
    };
  }
  if (entry.source !== "program") {
    return {
      label: "Fjern",
      ariaLabel: `Fjern ${code} fra planen`,
      // DESIGN §7's mandated pair is "Legg til i planen" → "I planen". The
      // *verbs* stay: Dropp/Legg tilbake cannot collapse into a two-state
      // toggle.
      state: "I planen",
      stateKind: "added",
      run: () => {
        store.removeCourse(code);
        return `${code} fjernet fra planen.`;
      },
    };
  }
  if (entry.dropped) {
    return {
      label: "Legg tilbake",
      ariaLabel: `Legg tilbake ${code} i planen`,
      state: "droppet",
      stateKind: "dropped",
      run: () => {
        store.restoreCourse(code);
        return `${code} lagt tilbake i planen.`;
      },
    };
  }
  return {
    label: "Dropp",
    ariaLabel: `Dropp ${code} fra planen`,
    state: "fra programmet",
    stateKind: "program",
    run: () => {
      store.dropCourse(code);
      return `${code} droppet, men fortsatt en del av programmet.`;
    },
  };
}

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
  // Light dismiss: Esc *and* a backdrop click. See the file header.
  dialog.setAttribute("closedby", "any");

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
  body.append(searchForm);

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
    if (query === "") {
      status.textContent = `Skriv for å søke i ${taught.length} emner.`;
      return;
    }

    const matched = searchCatalog(taught, query);
    const shown = matched.slice(0, MAX_ROWS);
    for (const course of shown) results.append(buildRow(course));

    if (matched.length === 0) {
      // "0 treff" over a query that matched only not-taught courses reads as
      // "no such course", which is wrong and unactionable.
      const hidden = searchCatalog(index.courses, query).length;
      const subject = hidden === 1 ? "Ett emne" : `${hidden} emner`;
      status.textContent =
        hidden > 0
          ? `Ingen treff undervises i ${index.year}. ${subject} i emnekatalogen passer søket, men undervises ikke i år.`
          : "0 treff.";
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
  searchForm.addEventListener("submit", (event) => event.preventDefault());
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
    render();
    dialog.showModal();
    searchInput.focus();
  }

  return { open };
}
