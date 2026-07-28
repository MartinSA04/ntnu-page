/**
 * Add-course modal (Task 12 — replaces the inline `planner-add-*` typeahead
 * that used to live in the Emner rail).
 *
 * One native `<dialog>`, built and mounted once (same idiom as
 * `studieinfo.ts`/`popover.ts`): a search over the *whole* catalog
 * (`index.courses`, the same `search-index.json` `/emner/` searches) through
 * `/emner/`'s own ranked `searchCatalog`, a row per match with **one
 * persistent action button** whose verb follows the
 * plan entry (`addCourseRowControl`), and the dialog stays open afterwards
 * so several courses can be added in one visit. Esc dismissal is the native
 * `showModal()` behaviour — nothing extra to wire, as long as nothing inside
 * the dialog eats the key first (see `searchInput.type` below). Backdrop
 * clicks are NOT a dismissal: no browser closes a `showModal()` dialog on
 * one without `closedby="any"`, and this dialog sets no such attribute — the
 * "Lukk" button and Esc are the two ways out (modals-7).
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
 * add control at all — just the `ikke undervist i {year}` note (`/emner/`'s
 * and `/emne/`'s own wording) — instead of an add whose later bundle fetch
 * for a year the course was never offered in would error. The note used to
 * lead with "kun eksamen", which the search-index tuple has no field to
 * support: of the 703 rows that exclude the catalog year, 203 record
 * `examOnly: false` and 107 have neither the flag nor a single exam
 * occasion, so `/emne/AAR4923/` deliberately declines to say it
 * (copy-3/crawler-4). Saying it here needs `examOnly` appended to the
 * tuple first (append-only, per docs/SPEC.md's crawled-data contracts).
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
import { type AddCourseInput, DEFAULT_VERSION, type PlanStore } from "../../lib/planner/store.js";
import { searchCatalog } from "../site/catalogSearch.js";
import { clashSentence, planClash } from "../site/planClash.js";
import { el, formatCreditNumber } from "./dom.js";
import type { SemesterSummary } from "./plannerApp.js";

export interface AddCourseDeps {
  store: PlanStore;
  /** `null` while `loadPlannerIndex()` is still in flight — see file header. */
  index: PlannerIndex | null;
  /**
   * The catalog download failed, so `index` will stay `null` until the
   * planner's own "Prøv igjen" refetches it. Without this the dialog read
   * "Henter emner …" forever over a dead download and offered no way out
   * (pd-3); the caller sets it from `loadPlannerIndex()`'s own outcome.
   */
  indexFailed?: boolean;
  semester: SemesterSummary;
  programCode: string | null;
}

export interface AddCourseHandle {
  open(): void;
}

/**
 * Rows shown at once — matches the deleted typeahead's own cap. The cap is
 * why `render()` ranks through `searchCatalog` rather than keeping its own
 * `filter()`: unranked catalog order put TMA4100 at row 77 of 112 for
 * "matematikk" on `/emner/` (search-1), and here only the first 12 survive.
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
   * Machine-readable twin of `state`. The span carries three different
   * sentences and they do not want the same tone — "I planen" is the
   * membership state DESIGN §2 gives the accent to, while "fra programmet"
   * and "droppet" are provenance and de-emphasis, which the rail itself
   * renders as plain muted text. CSS cannot select on text, so the tone
   * split needs this hook (modals-4).
   */
  stateKind: "none" | "added" | "program" | "dropped";
  /** Performs the action and returns the sentence to announce afterwards. */
  run: () => string;
}

/**
 * Derives a row's control from the plan *entry*, not from `hasCourse`.
 *
 * Four states, because §0.3/D3 say a programme course is never deleted:
 * absent → "Legg til", a manual add → "Fjern", a programme course →
 * "Dropp", a dropped programme course → "Legg tilbake". The rail picks the
 * same verbs the same way (plannerApp.ts:923-935); this surface used to
 * pick neither. It called `removeCourse` unconditionally, which hard-
 * deleted a programme course — and since a deletion leaves no `dropped`
 * marker, the next study-plan derive silently put the course back
 * (edit-3/modals-3; the store is source-aware since store-3, so "Fjern"
 * would now drop, but it would still be the wrong verb on the wrong
 * button). And it read `hasCourse`, which reports a *dropped* course as
 * present, so the modal asserted "Lagt til ✓" over a course the week, the
 * credit total and the exam list all exclude, with an inert add control as
 * the only way back (modals-4).
 *
 * `run()` returns its own confirmation because the control stays on screen
 * and keeps focus: hiding the pressed button dropped focus to `<body>` and
 * left the add unannounced (a11y-2), so the dialog's live region is the
 * only thing that reports the change.
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
      // DESIGN §7's mandated pair is "Legg til i planen" → "I planen"; this
      // said "Lagt til ✓" while three sibling surfaces each said something
      // else (copy-6). The *verbs* stay as they are: Dropp/Legg tilbake are
      // §7-correct and cannot collapse into a two-state toggle.
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
      return `${code} droppet — fortsatt en del av programmet.`;
    },
  };
}

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
  // NOT `type="search"`: Chrome's search input consumes the first Escape to
  // clear itself and cancels the dialog's close request with it, so a keyboard
  // user pressing Esc from the field emptied it instead of leaving (press 1 →
  // `{open: true, value: ""}`, press 2 → `{open: false}`) — the dismissal
  // gesture reads as broken until the second press (modals-7). The native
  // clear button is not load-bearing: `open()` resets the value anyway.
  searchInput.type = "text";
  searchInput.placeholder = "Søk etter emnekode eller emnenavn …";
  searchInput.setAttribute("aria-label", "Søk etter emne");
  searchForm.append(searchInput);
  body.append(searchForm);

  // Result count *and* the dialog's only live region: a row's action writes
  // its confirmation here, because the button that did it stays put and
  // silent otherwise (a11y-2). The next keystroke restores the count.
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
      // says so up front instead of offering an add that later errors. Only
      // what `offeredYears` supports, though — see the file header.
      note.textContent = `ikke undervist i ${currentYear}`;
      return row;
    }

    // One control, never hidden. The old add/added/remove triple hid the
    // button the student had just pressed (a11y-2) — and hid nothing in
    // practice, since `.np-btn { display: inline-flex }` outranks the UA
    // `[hidden] { display: none }`, so every row painted "Legg til", "Lagt
    // til ✓" and "Fjern" at once (copy-5). `.add-course-added` is a plain
    // `<span>` with no `display` of its own, so `hidden` does work on it.
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
      // the accent — the span paints all three today (modals-4).
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

    const invalidate = attachPreview(row, note, code, version);
    rows.push({ sync, invalidate });
    return row;
  }

  function render(): void {
    const index = deps.index;
    const query = searchInput.value.trim();
    rows.length = 0;
    results.replaceChildren();

    if (!index) {
      // A failed download is not a slow one: "Henter emner …" over a dead
      // fetch is a spinner that never resolves, and this dialog is the only
      // way to add a course by code (pd-3). The retry lives on the planner's
      // exam panel and repairs both surfaces at once, so the sentence states
      // the fact rather than pointing at a control that is not in here.
      status.textContent = deps.indexFailed ? "Fikk ikke hentet emnekatalogen." : "Henter emner …";
      return;
    }
    if (query === "") {
      status.textContent = `Skriv for å søke i ${index.courses.length} emner.`;
      return;
    }

    const matched = searchCatalog(index.courses, query);
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
