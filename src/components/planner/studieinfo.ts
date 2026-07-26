/**
 * Studieinfo modal (REWORK-2026-07-25 design §2) — the product's front door.
 *
 * One native `<dialog>` that owns *all four* choices the plan hangs off:
 * programme, kull, studieretning and semester. Every edit is staged in a
 * local variable and nothing touches the store until **Lagre**; Avbryt/Esc
 * discard by simply closing (the store never saw the edits). This is the
 * only surface that picks programme/kull/retning/semester — the homepage
 * picker and the planner's inline picker are deleted in later tasks — so it
 * absorbs the old "Bruk som planen min" import semantics from
 * `studyPlan.ts`: obligatory-classified courses replace the plan's
 * `source: "program"` set via `setProgramPlan`, preserving manual adds/drops.
 * A >30 sp prefill is **kept**, not zeroed — CMEDFORSK period 1 legitimately
 * sums to 42,5 sp, and the planner's credit-line note (B9) does the
 * surfacing; clearing it would reproduce the "0 av 30 sp, no rows" bug.
 *
 * **Why two study-plan fetches on a programme pick.** The NTNU plan API
 * returns a document whose `periods` are truncated to how far the *fetched
 * cohort* has progressed: MTDT fetched at 2026 lists only periods 1–2, so its
 * `maxPeriodNumber` is 2 and `relevantCohorts` would offer a single kull. The
 * full programme length lives in an older, graduated cohort's plan (MTDT
 * fetched at 2020 lists periods 1–10). So we fetch the current-year plan (for
 * `name`/`publishedYears`/existence) *and* an older-cohort plan, and feed
 * `relevantCohorts` whichever reaches further. The per-cohort plan for
 * studieretning + the final classify is fetched on kull-select, exactly as
 * `plannerApp` does, so the committed direction code is valid for that kull.
 */
import { semesterYear } from "../../lib/planner/schedule.js";
import type { AddCourseInput, PlanProgram, PlanStore } from "../../lib/planner/store.js";
import { el, fold, formatShortDate } from "./dom.js";
import type { ProgramOption, SemesterSummary } from "./plannerApp.js";
import {
  type DirectionOption,
  findProgramPlan,
  maxPeriodNumber,
  relevantCohorts,
  resolvePeriodFor,
  type StudyPlan,
} from "./programPlan.js";

export interface StudieinfoDeps {
  store: PlanStore;
  /** The plannable candidates (current + next two) — one `<option>` each. */
  semesters: SemesterSummary[];
  programOptions: ProgramOption[];
  defaultSemesterId: string;
}

export interface StudieinfoHandle {
  open(): void;
}

/** `window` CustomEvent the modal listens for (Layout chip / empty states open it). */
export const OPEN_STUDIEINFO_EVENT = "np:open-studieinfo";

/** Rows rendered in the programme typeahead at once (matches the planner picker). */
const MAX_PROGRAM_ROWS = 12;

/**
 * How many cohorts back to look for a *fully-published* plan when the
 * current-year document is period-truncated (see the file header). A cohort
 * this many years back has normally graduated, so its plan carries the whole
 * period range; `findProgramPlan`'s 404 step-back tolerates the odd gap.
 */
const FULL_PLAN_LOOKBACK = 6;

/** "publiseres vanligvis i <måned>" — desember for vår, august for høst. */
export function publishMonthFor(semesterId: string): string {
  return /v$/i.test(semesterId.trim()) ? "desember" : "august";
}

/** "Høst 2026" / "Vår 2027" — the label every surface uses for a semester. */
function semesterLabel(semester: SemesterSummary): string {
  const season = /h$/i.test(semester.id) ? "Høst" : "Vår";
  const year = semesterYear(semester.id);
  return year !== null ? `${season} ${year}` : semester.name;
}

/**
 * Mounts the studieinfo modal once. Creates a single `<dialog>` appended to
 * `document.body`, wires the `OPEN_STUDIEINFO_EVENT` listener, and returns a
 * handle so a caller holding it can open the dialog directly. `signal` aborts
 * on the next page swap: it removes the dialog and drops the window listener,
 * so a re-mount (once per `astro:page-load`) never leaves a second dialog or
 * a stale listener behind.
 */
export function mountStudieinfo(deps: StudieinfoDeps, signal: AbortSignal): StudieinfoHandle {
  // Idempotency: a previous mount's dialog may still be in the DOM after a
  // client-side navigation that didn't fire the abort in time.
  document.getElementById("studieinfo-dialog")?.remove();

  // --- Staged state (nothing here reaches the store until Lagre) ----------
  let invoker: HTMLElement | null = null;
  let stagedProgram: { code: string; name: string } | null = null;
  let stagedCohort: number | null = null;
  let stagedDirection: DirectionOption | null = null;
  let stagedSemesterId = defaultSemesterOf();
  /** Full-range plan feeding `relevantCohorts` (see file header). */
  let cohortsPlan: StudyPlan | null = null;
  /** The selected kull's own plan — studieretning options + the Lagre classify. */
  let cohortPlan: StudyPlan | null = null;
  /** Every year the programme has a plan document for (S4 missing-kull hint). */
  let publishedYears: number[] = [];
  /** `true` once a programme pick came back not-found/error. */
  let programMissing = false;
  /** Whichever `<select>` options studieretning currently offers. */
  let retningOptions: DirectionOption[] = [];
  let hintText = "";
  /** Guards against a slow fetch resolving after a newer pick (superseded). */
  let programToken = 0;
  let cohortToken = 0;

  function defaultSemesterOf(): string {
    return deps.semesters.some((s) => s.id === deps.defaultSemesterId)
      ? deps.defaultSemesterId
      : (deps.semesters[0]?.id ?? deps.defaultSemesterId);
  }

  // --- DOM skeleton (built once) ------------------------------------------
  const dialog = el("dialog", "np-frame studieinfo-dialog") as HTMLDialogElement;
  dialog.id = "studieinfo-dialog";
  dialog.setAttribute("aria-labelledby", "studieinfo-title");

  const body = el("div", "studieinfo-body");
  dialog.append(body);

  const title = el("h2", "studieinfo-title", "Studieinfo");
  title.id = "studieinfo-title";
  body.append(title);

  // Programme -------------------------------------------------------------
  const programSection = el("div", "studieinfo-field");
  const programLabel = el("label", "np-kicker studieinfo-label", "Studieprogram");
  programLabel.htmlFor = "studieinfo-program-input";
  programSection.append(programLabel);

  const chipHost = el("div", "studieinfo-chip-host");
  chipHost.hidden = true;
  programSection.append(chipHost);

  const programForm = el("form", "np-field studieinfo-program-field") as HTMLFormElement;
  programForm.autocomplete = "off";
  const programInput = el("input", "studieinfo-program-input") as HTMLInputElement;
  programInput.type = "text";
  programInput.id = "studieinfo-program-input";
  programInput.placeholder = "Søk etter studieprogram …";
  programInput.setAttribute("role", "combobox");
  programInput.setAttribute("aria-expanded", "false");
  programInput.setAttribute("aria-autocomplete", "list");
  programInput.setAttribute("aria-controls", "studieinfo-program-listbox");
  programForm.append(programInput);
  programSection.append(programForm);

  const programListbox = el("ul", "np-popover studieinfo-program-listbox") as HTMLUListElement;
  programListbox.id = "studieinfo-program-listbox";
  programListbox.setAttribute("role", "listbox");
  programListbox.setAttribute("aria-label", "Studieprogramforslag");
  programListbox.hidden = true;
  programSection.append(programListbox);
  body.append(programSection);

  // Kull ------------------------------------------------------------------
  const kullSection = el("div", "studieinfo-field");
  kullSection.hidden = true;
  kullSection.append(el("p", "np-kicker studieinfo-label", "Kull"));
  const kullChips = el("div", "studieinfo-kull-chips");
  kullChips.id = "studieinfo-kull-chips";
  kullChips.setAttribute("role", "group");
  kullChips.setAttribute("aria-label", "Velg kull");
  kullSection.append(kullChips);
  body.append(kullSection);

  // Studieretning ---------------------------------------------------------
  const retningSection = el("div", "studieinfo-field");
  retningSection.hidden = true;
  const retningLabel = el("label", "np-kicker studieinfo-label", "");
  retningLabel.htmlFor = "studieinfo-retning-select";
  retningSection.append(retningLabel);
  const retningSelect = el("select", "studieinfo-select") as HTMLSelectElement;
  retningSelect.id = "studieinfo-retning-select";
  retningSection.append(retningSelect);
  const retningNote = el("p", "np-note studieinfo-note", "");
  retningNote.hidden = true;
  retningSection.append(retningNote);
  body.append(retningSection);

  // Semester --------------------------------------------------------------
  const semesterSection = el("div", "studieinfo-field");
  const semesterLabelEl = el("label", "np-kicker studieinfo-label", "Semester");
  semesterLabelEl.htmlFor = "studieinfo-semester-select";
  semesterSection.append(semesterLabelEl);
  const semesterSelect = el("select", "studieinfo-select") as HTMLSelectElement;
  semesterSelect.id = "studieinfo-semester-select";
  for (const semester of deps.semesters) {
    const suffix = semester.timetablePublished
      ? ""
      : ` — timeplan publiseres ~${publishMonthFor(semester.id)}`;
    const option = el(
      "option",
      undefined,
      `${semesterLabel(semester)}${suffix}`,
    ) as HTMLOptionElement;
    option.value = semester.id;
    semesterSelect.append(option);
  }
  semesterSection.append(semesterSelect);
  body.append(semesterSection);

  // Hint + footer ---------------------------------------------------------
  const hint = el("p", "np-hint studieinfo-hint", "");
  hint.id = "studieinfo-hint";
  hint.setAttribute("aria-live", "polite");
  hint.hidden = true;
  body.append(hint);

  const actions = el("div", "studieinfo-actions");
  const saveBtn = el("button", "np-btn studieinfo-save", "Lagre") as HTMLButtonElement;
  saveBtn.type = "button";
  saveBtn.id = "studieinfo-save";
  const cancelBtn = el("button", "np-btn studieinfo-cancel", "Avbryt") as HTMLButtonElement;
  cancelBtn.type = "button";
  cancelBtn.id = "studieinfo-cancel";
  actions.append(saveBtn, cancelBtn);
  body.append(actions);

  document.body.append(dialog);

  // --- Programme typeahead ------------------------------------------------
  let programMatches: ProgramOption[] = [];
  let programActive = -1;

  function closeProgramList(): void {
    programListbox.replaceChildren();
    programListbox.hidden = true;
    programMatches = [];
    programActive = -1;
    programInput.setAttribute("aria-expanded", "false");
    programInput.removeAttribute("aria-activedescendant");
  }

  function setProgramActive(index: number): void {
    programActive = index;
    let activeId: string | null = null;
    for (const [i, opt] of [...programListbox.children].entries()) {
      if (opt.getAttribute("role") !== "option") continue;
      const isActive = i === index;
      opt.classList.toggle("is-active", isActive);
      opt.setAttribute("aria-selected", String(isActive));
      if (isActive) activeId = opt.id;
    }
    if (activeId) programInput.setAttribute("aria-activedescendant", activeId);
    else programInput.removeAttribute("aria-activedescendant");
  }

  function renderProgramOptions(): void {
    const query = fold(programInput.value.trim());
    if (query === "") {
      closeProgramList();
      return;
    }
    programMatches = deps.programOptions
      .filter(([code, name]) => fold(code).includes(query) || fold(name).includes(query))
      .slice(0, MAX_PROGRAM_ROWS);

    programListbox.replaceChildren();
    if (programMatches.length === 0) {
      programListbox.append(el("li", "studieinfo-typeahead-empty np-hint", "Ingen treff."));
      programListbox.hidden = false;
      programActive = -1;
      programInput.setAttribute("aria-expanded", "true");
      programInput.removeAttribute("aria-activedescendant");
      return;
    }
    programMatches.forEach((option, index) => {
      const [code, name, studyLevel, cities] = option;
      const item = el("li", "np-popover-option studieinfo-program-option");
      item.id = `studieinfo-program-option-${index}`;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", "false");
      item.append(el("span", "np-data studieinfo-program-code", code));
      item.append(el("span", "studieinfo-program-name", name));
      if (studyLevel !== "") {
        const detail = cities.length > 0 ? `${studyLevel}, ${cities.join(", ")}` : studyLevel;
        item.append(el("span", "studieinfo-program-level", detail.toLowerCase()));
      }
      // mousedown holds focus; click is what assistive tech dispatches (A2).
      item.addEventListener("mousedown", (event) => event.preventDefault());
      item.addEventListener("click", () => pickProgram(option));
      programListbox.append(item);
    });
    programListbox.hidden = false;
    programInput.setAttribute("aria-expanded", "true");
    setProgramActive(0);
  }

  programInput.addEventListener("input", renderProgramOptions);
  programInput.addEventListener("keydown", (event) => {
    if (programListbox.hidden || programMatches.length === 0) {
      if (event.key === "Escape") closeProgramList();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setProgramActive((programActive + 1) % programMatches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setProgramActive((programActive - 1 + programMatches.length) % programMatches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = programMatches[programActive] ?? programMatches[0];
      if (picked) pickProgram(picked);
    } else if (event.key === "Escape") {
      event.stopPropagation(); // close the list, not the dialog
      closeProgramList();
    }
  });
  programForm.addEventListener("submit", (event) => event.preventDefault());
  programForm.addEventListener("focusout", (event) => {
    if (!programSection.contains(event.relatedTarget as Node | null)) closeProgramList();
  });

  // --- Programme / kull / retning loading ---------------------------------
  function pickProgram(option: ProgramOption): void {
    const [code, name] = option;
    programInput.value = "";
    closeProgramList();
    stagedProgram = { code, name };
    stagedCohort = null;
    stagedDirection = null;
    renderProgramField();
    void loadProgram(false);
  }

  /**
   * Fetches the two plans a programme pick needs and (re)builds the kull
   * chips. `keepCohort` re-uses a pre-staged kull when the modal opened on an
   * existing profile; otherwise the kull area resets.
   */
  async function loadProgram(keepCohort: boolean): Promise<void> {
    const program = stagedProgram;
    if (!program) return;
    const token = ++programToken;
    programMissing = false;
    cohortsPlan = null;
    publishedYears = [];
    hintText = "";
    renderKull();
    renderRetning();
    renderHint();

    const guessYear = semesterYear(deps.defaultSemesterId) ?? new Date().getFullYear();
    const head = await findProgramPlan(program.code, guessYear);
    if (token !== programToken) return;
    if ("kind" in head) {
      programMissing = true;
      hintText =
        "Fant ingen studieplan for dette programmet. Du kan fortsatt legge til emnene dine selv.";
      renderKull();
      renderRetning();
      renderHint();
      return;
    }

    if (head.plan.name && head.plan.name !== program.code) {
      program.name = head.plan.name;
      renderProgramField();
    }
    publishedYears = head.plan.publishedYears ?? [];

    let fuller = head.plan;
    const older = await findProgramPlan(program.code, guessYear - FULL_PLAN_LOOKBACK);
    if (token !== programToken) return;
    if (!("kind" in older) && (maxPeriodNumber(older.plan) ?? 0) > (maxPeriodNumber(fuller) ?? 0)) {
      fuller = older.plan;
    }
    cohortsPlan = fuller;
    renderKull();

    const stillRelevant =
      keepCohort &&
      stagedCohort !== null &&
      relevantCohorts(cohortsPlan, stagedSemesterId).includes(stagedCohort);
    if (stillRelevant && stagedCohort !== null) {
      void loadCohort(stagedCohort, true);
    } else {
      stagedCohort = null;
      stagedDirection = null;
      renderRetning();
      renderHint();
    }
  }

  /** Fetches the kull's own plan (studieretning + Lagre classify) and updates the hint. */
  async function loadCohort(cohort: number, keepDirection: boolean): Promise<void> {
    const program = stagedProgram;
    if (!program) return;
    stagedCohort = cohort;
    if (!keepDirection) stagedDirection = null;
    const token = ++cohortToken;
    cohortPlan = null;
    renderKull();
    renderRetning();

    const res = await findProgramPlan(program.code, cohort);
    if (token !== cohortToken || stagedCohort !== cohort) return;
    // A stepped-back plan (kull with no document of its own) still carries the
    // period structure; the fuller cohortsPlan is the last-resort fallback.
    cohortPlan = "kind" in res ? cohortsPlan : res.plan;

    hintText = publishedYears.includes(cohort)
      ? ""
      : `Fant ingen studieplan for kull ${cohort} — du kan legge til emner selv.`;
    renderRetning();
    renderHint();
  }

  // --- Renders ------------------------------------------------------------
  function renderProgramField(): void {
    if (stagedProgram) {
      programForm.hidden = true;
      programListbox.hidden = true;
      chipHost.hidden = false;
      chipHost.replaceChildren();
      const chip = el("span", "np-tag studieinfo-program-chip");
      chip.append(el("span", "np-data studieinfo-chip-code", stagedProgram.code));
      chip.append(el("span", "studieinfo-chip-sep", "·"));
      chip.append(el("span", "studieinfo-chip-name", stagedProgram.name));
      const remove = el("button", "np-icon-btn studieinfo-chip-remove", "×") as HTMLButtonElement;
      remove.type = "button";
      remove.setAttribute("aria-label", "Fjern studieprogram");
      remove.addEventListener("click", clearProgram);
      chip.append(remove);
      chipHost.append(chip);
    } else {
      chipHost.hidden = true;
      chipHost.replaceChildren();
      programForm.hidden = false;
    }
  }

  function clearProgram(): void {
    stagedProgram = null;
    stagedCohort = null;
    stagedDirection = null;
    cohortsPlan = null;
    cohortPlan = null;
    publishedYears = [];
    programMissing = false;
    hintText = "";
    programInput.value = "";
    renderProgramField();
    renderKull();
    renderRetning();
    renderHint();
    programInput.focus();
  }

  function renderKull(): void {
    if (!stagedProgram || programMissing) {
      kullSection.hidden = true;
      kullChips.replaceChildren();
      return;
    }
    kullSection.hidden = false;
    kullChips.replaceChildren();
    if (!cohortsPlan) {
      kullChips.append(el("p", "np-hint studieinfo-loading", "henter studieplan …"));
      return;
    }
    const cohorts = relevantCohorts(cohortsPlan, stagedSemesterId);
    if (cohorts.length === 0) {
      kullChips.append(el("p", "np-hint", "Fant ingen kull for dette programmet."));
      return;
    }
    for (const year of cohorts) {
      const chip = el(
        "button",
        "np-toggle studieinfo-kull-chip",
        String(year),
      ) as HTMLButtonElement;
      chip.type = "button";
      chip.setAttribute("aria-label", `Kull ${year}`);
      chip.setAttribute("aria-pressed", String(year === stagedCohort));
      chip.addEventListener("click", () => {
        void loadCohort(year, false);
      });
      kullChips.append(chip);
    }
  }

  function renderRetning(): void {
    retningOptions = [];
    if (!stagedProgram || stagedCohort === null || !cohortPlan) {
      retningSection.hidden = true;
      return;
    }
    // No direction passed: detect whether the period is gated at all, so a
    // student who already chose one can still change it (choosing it would
    // otherwise resolve the gate and hide the select).
    const gate = resolvePeriodFor(cohortPlan, stagedSemesterId, stagedCohort);
    const pending = gate.pendingChoice;
    if (!pending) {
      retningSection.hidden = true;
      return;
    }
    retningSection.hidden = false;
    retningLabel.textContent = pending.name;
    retningOptions = pending.directions;

    retningSelect.replaceChildren();
    const placeholder = el("option", undefined, "Ikke valgt ennå") as HTMLOptionElement;
    placeholder.value = "";
    retningSelect.append(placeholder);
    for (const direction of pending.directions) {
      const option = el("option", undefined, direction.name) as HTMLOptionElement;
      option.value = direction.code;
      retningSelect.append(option);
    }
    retningSelect.value = stagedDirection?.code ?? "";

    if (pending.deadlineDate) {
      retningNote.textContent = `frist ${formatShortDate(pending.deadlineDate)}`;
      retningNote.hidden = false;
    } else {
      retningNote.hidden = true;
    }
  }

  function renderHint(): void {
    hint.textContent = hintText;
    hint.hidden = hintText === "";
  }

  retningSelect.addEventListener("change", () => {
    const code = retningSelect.value;
    stagedDirection = code === "" ? null : (retningOptions.find((d) => d.code === code) ?? null);
  });

  semesterSelect.addEventListener("change", () => {
    stagedSemesterId = semesterSelect.value;
    // Relevance and the studieretning question both depend on the semester.
    if (stagedCohort !== null && cohortsPlan) {
      const cohorts = relevantCohorts(cohortsPlan, stagedSemesterId);
      if (!cohorts.includes(stagedCohort)) {
        stagedCohort = null;
        stagedDirection = null;
        cohortPlan = null;
        hintText = "";
      }
    }
    renderKull();
    if (stagedCohort !== null) {
      void loadCohort(stagedCohort, true);
    } else {
      renderRetning();
      renderHint();
    }
  });

  // --- Commit / open / close ----------------------------------------------
  async function commit(): Promise<void> {
    // Snapshot the staging at click time — the awaited plan fetch below must
    // commit what was on screen when Lagre was pressed.
    const semesterId = stagedSemesterId;
    const program = stagedProgram;
    const cohort = stagedCohort;
    const direction = stagedDirection;

    // Semester commits *unconditionally* and first, so a semester-only edit is
    // never dropped by an incomplete programme half, and the programme set
    // re-derives against the semester the student is actually planning
    // (setProgramPlan reads the freshly-switched plan).
    deps.store.setSemester(semesterId);

    // A staged programme still needs a kull before it can classify a period —
    // only the programme part waits; the semester above already committed.
    if (program && cohort === null) {
      hintText = "Velg kull for å lagre studieprogrammet.";
      renderHint();
      return;
    }

    if (program && cohort !== null) {
      const planProgram: PlanProgram = {
        code: program.code,
        name: program.name,
        cohort,
        ...(direction ? { direction } : {}),
      };
      // Classify against the *kull-specific* plan. If its fetch is still in
      // flight `cohortPlan` is null; await the (memoised, near-instant) fetch
      // rather than falling back to a different cohort's curriculum. The
      // not-found/error fallback to the fuller cohortsPlan is preserved.
      let plan = cohortPlan;
      if (!plan) {
        const res = await findProgramPlan(program.code, cohort);
        plan = "kind" in res ? cohortsPlan : res.plan;
      }
      let toAdd: AddCourseInput[] = [];
      if (plan) {
        const resolved = resolvePeriodFor(plan, semesterId, cohort, direction?.code ?? null);
        // The prefill is kept even when it exceeds a semester (B9): the
        // planner's credit-line note surfaces it; zeroing it here would leave
        // a legitimately-heavy programme with no rows and no explanation.
        const obligatory = resolved.courses?.obligatory ?? [];
        toAdd = obligatory.map((c) => ({
          code: c.code,
          name: c.name,
          version: c.version ?? "1",
          credits: c.credits,
          source: "program" as const,
        }));
      }
      deps.store.setProgramPlan(planProgram, toAdd);
    }
    // No programme staged → only the semester changed. Clearing an existing
    // profile needs a store-level removal the current PlanStore does not
    // expose (Task 2 owns it); manual courses are untouched either way.

    dialog.close();
  }

  function focusInitial(): void {
    if (!stagedProgram) programInput.focus();
    else semesterSelect.focus();
  }

  function open(): void {
    invoker = (document.activeElement as HTMLElement | null) ?? null;

    const plan = deps.store.loadPlan();
    stagedSemesterId = deps.semesters.some((s) => s.id === plan.semesterId)
      ? plan.semesterId
      : defaultSemesterOf();
    stagedProgram = null;
    stagedCohort = null;
    stagedDirection = null;
    cohortsPlan = null;
    cohortPlan = null;
    publishedYears = [];
    programMissing = false;
    hintText = "";
    programInput.value = "";
    if (plan.program) {
      stagedProgram = { code: plan.program.code, name: plan.program.name };
      stagedCohort = plan.program.cohort;
      stagedDirection = plan.program.direction
        ? { code: plan.program.direction.code, name: plan.program.direction.name }
        : null;
    }

    semesterSelect.value = stagedSemesterId;
    renderProgramField();
    renderKull();
    renderRetning();
    renderHint();

    dialog.showModal();
    focusInitial();
    if (stagedProgram) void loadProgram(true);
  }

  saveBtn.addEventListener("click", () => void commit());
  cancelBtn.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    invoker?.focus?.();
    invoker = null;
  });

  window.addEventListener(OPEN_STUDIEINFO_EVENT, open, { signal });
  signal.addEventListener("abort", () => dialog.remove());

  return { open };
}
