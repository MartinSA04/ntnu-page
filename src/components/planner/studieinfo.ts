/**
 * Studieinfo modal — the product's front door.
 *
 * One native `<dialog>` owning *all four* choices the plan hangs off:
 * programme, kull, studieretning and semester. Every edit is staged locally and
 * nothing touches the store until **Lagre**; Avbryt/Esc discard by closing.
 * Obligatory-classified courses replace the plan's `source: "program"` set via
 * `setProgramPlan`, preserving manual adds/drops. A >30 sp prefill is **kept**,
 * not zeroed — the planner's credit-line note does the surfacing.
 *
 * **Why two study-plan fetches on a programme pick.** The plan API truncates
 * `periods` to how far the *fetched cohort* has progressed, so a current-year
 * fetch of MTDT lists periods 1–2 and `relevantCohorts` would offer one kull.
 * The full programme length lives in an older, graduated cohort's plan. So we
 * fetch the current-year plan (for name/existence) *and* an older-cohort plan
 * and feed `relevantCohorts` whichever reaches further. The per-cohort plan for
 * studieretning + the final classify is fetched on kull-select.
 *
 * **Programmes NTNU publishes no plan for** (~17 % of the catalogue) must still
 * be savable — this is the only programme picker there is, so refusing to close
 * is a hard dead end. We offer `fallbackCohorts` chips, record programme + kull
 * with an empty prefill, and say the emner have to be added by hand.
 */
import { semesterYear } from "../../lib/planner/schedule.js";
import type { AddCourseInput, PlanProgram, PlanStore } from "../../lib/planner/store.js";
import { el, fold, formatShortDate, icon } from "./dom.js";
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

/** Rows rendered in the programme typeahead at once (matches the planner picker). */
const MAX_PROGRAM_ROWS = 12;

/**
 * How many cohorts back to look for a *fully-published* plan when the
 * current-year document is period-truncated (see the file header). A cohort
 * this far back has normally graduated, so its plan carries the whole range.
 */
const FULL_PLAN_LOOKBACK = 6;

/**
 * How many kull chips to offer when there is no study plan to derive them from
 * — six, the length of the longest NTNU programme. Without a plan there is no
 * `maxPeriodNumber` and therefore no relevance rule.
 */
const FALLBACK_COHORT_YEARS = 6;

/**
 * Said when NTNU publishes no study plan for the programme. It carries the
 * instruction too: this is the state Lagre used to refuse while hiding kull.
 */
const PROGRAM_MISSING_HINT =
  "Fant ingen studieplan for dette programmet. Velg kull og lagre, så husker vi programmet ditt. Emnene må du legge til selv.";

/** "publiseres vanligvis i <måned>" — desember for vår, august for høst. */
export function publishMonthFor(semesterId: string): string {
  return /v$/i.test(semesterId.trim()) ? "desember" : "august";
}

/**
 * The kull chips offered for a programme with no study plan. Newest first,
 * mirroring `relevantCohorts`. A **spring** semester belongs to the study year
 * that started the previous autumn, so its newest kull is one year back.
 */
export function fallbackCohorts(semesterId: string): number[] {
  const year = semesterYear(semesterId);
  if (year === null) return [];
  const newest = /h$/i.test(semesterId.trim()) ? year : year - 1;
  return Array.from({ length: FALLBACK_COHORT_YEARS }, (_, i) => newest - i);
}

/**
 * The kull-level hint, from what the fetch actually returned rather than the
 * API's `publishedYears` — that field is one global publication window for
 * every programme, so it stayed silent when a plan really was missing.
 * `foundYear` is where `findProgramPlan` resolved (`null` = no document).
 */
export function cohortHint(input: {
  cohort: number;
  foundYear: number | null;
  periodMissing: boolean;
  semesterLabel: string;
}): string {
  const notes: string[] = [];
  if (input.foundYear === null) {
    notes.push(`Fant ingen studieplan for kull ${input.cohort}. Du kan legge til emner selv.`);
  } else if (input.foundYear !== input.cohort) {
    notes.push(
      `Fant ingen studieplan for kull ${input.cohort}. Viser kull ${input.foundYear} i stedet, juster selv.`,
    );
  }
  if (input.periodMissing) {
    notes.push(
      `Studieplanen for kull ${input.cohort} har ingen periode for ${input.semesterLabel} ennå. Velg et annet kull eller semester.`,
    );
  }
  return notes.join(" ");
}

/**
 * A native `<select>` in a shell that owns its indicator.
 *
 * The platform arrow renders differently in every engine, sits hard against the
 * right edge answering nothing on the left, and cannot say whether the picker
 * is open. `appearance: none` (site.css) removes it; this puts Lucide's
 * `chevron-down` in its place, and CSS turns it over while `:open`.
 *
 * The icon is a sibling rather than a background image so it inherits
 * `currentColor`; `pointer-events: none` keeps it clear of the control, which
 * is still an ordinary `<select>` with its native keyboard behaviour.
 */
function selectShell(select: HTMLSelectElement): HTMLElement {
  const shell = el("div", "studieinfo-select-shell");
  shell.append(select, icon("chevronDown", "studieinfo-select-icon"));
  return shell;
}

/** "Høst 2026" / "Vår 2027" — the label every surface uses for a semester. */
function semesterLabel(semester: SemesterSummary): string {
  const season = /h$/i.test(semester.id) ? "Høst" : "Vår";
  const year = semesterYear(semester.id);
  return year !== null ? `${season} ${year}` : semester.name;
}

/**
 * Mounts the studieinfo modal once: a single `<dialog>` on `document.body`
 * plus the handle callers open it through. `signal` aborts on the next page
 * swap and removes the dialog, so a re-mount never leaves a second behind.
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
  /** `true` once a programme pick came back not-found/error. */
  let programMissing = false;
  /** Whichever `<select>` options studieretning currently offers. */
  let retningOptions: DirectionOption[] = [];
  let hintText = "";
  /** Guards against a slow fetch resolving after a newer pick (superseded). */
  let programToken = 0;
  let cohortToken = 0;
  /**
   * Guards `commit`'s awaited plan fetch: bumped on every open and close, so an
   * Avbryt/Esc/reopen during the in-flight classify cancels the pending write.
   */
  let commitToken = 0;

  function defaultSemesterOf(): string {
    return deps.semesters.some((s) => s.id === deps.defaultSemesterId)
      ? deps.defaultSemesterId
      : (deps.semesters[0]?.id ?? deps.defaultSemesterId);
  }

  function stagedSemesterLabel(): string {
    const semester = deps.semesters.find((s) => s.id === stagedSemesterId);
    return semester ? semesterLabel(semester) : stagedSemesterId;
  }

  // --- DOM skeleton (built once) ------------------------------------------
  const dialog = el("dialog", "np-frame studieinfo-dialog") as HTMLDialogElement;
  dialog.id = "studieinfo-dialog";
  dialog.setAttribute("aria-labelledby", "studieinfo-title");
  // Light dismiss: Esc *and* a backdrop click. Unlike the other two modals this
  // one stages its edits, so a backdrop click discards them — the same outcome
  // Esc and Avbryt have. The keydown handler below still keeps Escape away from
  // the dialog while the programme listbox is open.
  dialog.setAttribute("closedby", "any");

  // The same masthead the session card and course modal open on, in its paper
  // variant: a programme has no hue of its own. It sits outside the scrolling
  // body, so it stays put while a long programme list moves under it.
  const head = el("div", "np-head studieinfo-head");
  const ident = el("div", "np-head-ident");
  const title = el("h2", "np-head-title studieinfo-title", "Studieinfo");
  title.id = "studieinfo-title";
  ident.append(title);
  head.append(ident);
  dialog.append(head);

  const body = el("div", "studieinfo-body");
  dialog.append(body);

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
  // The caption shipped on the homepage picker and did not move when that
  // picker was deleted (PRODUCT §11) — so this modal, now the ONLY place a
  // programme and kull are ever chosen, offered a first-year five bare year
  // chips and no way to know which one was theirs.
  kullSection.append(el("p", "np-hint studieinfo-kull-hint", "Året du begynte på programmet."));
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
  retningSection.append(selectShell(retningSelect));
  const retningNote = el("p", "np-note studieinfo-note", "");
  retningNote.hidden = true;
  retningSection.append(retningNote);
  // The way back out of a *nested* choice: once an answer resolves one level
  // the select moves to the next, and the earlier answer is no longer among its
  // options. Only rendered in that case.
  const retningReset = el(
    "button",
    "np-btn studieinfo-retning-reset",
    "Nullstill studieretning",
  ) as HTMLButtonElement;
  retningReset.type = "button";
  retningReset.hidden = true;
  retningSection.append(retningReset);
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
      : `, timeplan publiseres ~${publishMonthFor(semester.id)}`;
    const option = el(
      "option",
      undefined,
      `${semesterLabel(semester)}${suffix}`,
    ) as HTMLOptionElement;
    option.value = semester.id;
    semesterSelect.append(option);
  }
  semesterSection.append(selectShell(semesterSelect));
  body.append(semesterSection);

  // Hint + footer ---------------------------------------------------------
  // Permanently mounted, never `hidden` — see `renderHint()` for why.
  const hint = el("p", "np-hint studieinfo-hint sr-only", "");
  hint.id = "studieinfo-hint";
  hint.setAttribute("aria-live", "polite");
  body.append(hint);

  const actions = el("div", "np-actions studieinfo-actions");
  const saveBtn = el("button", "np-btn studieinfo-save", "Lagre") as HTMLButtonElement;
  saveBtn.type = "button";
  saveBtn.id = "studieinfo-save";
  // A refused Lagre writes its reason into the hint; describing the button with
  // it makes the reason reachable from the control that caused it. An empty
  // hint contributes no description.
  saveBtn.setAttribute("aria-describedby", "studieinfo-hint");
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
    // `Array.from`, not a spread: the Node typecheck pass (tsconfig.test.json)
    // has no DOM.Iterable, and this module is reachable from tests/.
    for (const [i, opt] of Array.from(programListbox.children).entries()) {
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
      // A `role="listbox"` may only contain options, so a bare <li> is dropped
      // from the accessibility tree and a mistyped programme is answered with
      // silence. A disabled option is valid and can be `aria-activedescendant`.
      const empty = el("li", "studieinfo-typeahead-empty np-hint", "Ingen treff.");
      empty.id = "studieinfo-program-option-empty";
      empty.setAttribute("role", "option");
      empty.setAttribute("aria-disabled", "true");
      empty.setAttribute("aria-selected", "false");
      programListbox.append(empty);
      programListbox.hidden = false;
      programActive = -1;
      programInput.setAttribute("aria-expanded", "true");
      programInput.setAttribute("aria-activedescendant", empty.id);
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
    if (event.key === "Escape") {
      // With no list open, Escape belongs to the dialog. With one open it must
      // dismiss only the list — and a dialog's Escape close is a *close
      // request*, which `stopPropagation()` does not touch.
      if (programListbox.hidden) return;
      event.preventDefault();
      closeProgramList();
      return;
    }
    if (programListbox.hidden || programMatches.length === 0) return;
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
    // The input that had focus is now hidden, dropping `activeElement` to
    // <body>. Hand focus to the chip that replaced it.
    chipHost.querySelector<HTMLButtonElement>(".studieinfo-chip-remove")?.focus();
    void loadProgram(false);
  }

  /**
   * Fetches the two plans a programme pick needs and rebuilds the kull chips.
   * `keepCohort` re-uses a pre-staged kull when the modal opened on a profile.
   */
  async function loadProgram(keepCohort: boolean): Promise<void> {
    const program = stagedProgram;
    if (!program) return;
    const token = ++programToken;
    programMissing = false;
    cohortsPlan = null;
    hintText = "";
    renderKull();
    renderRetning();
    renderHint();

    const guessYear = semesterYear(deps.defaultSemesterId) ?? new Date().getFullYear();
    const head = await findProgramPlan(program.code, guessYear);
    if (token !== programToken) return;
    if ("kind" in head) {
      programMissing = true;
      hintText = PROGRAM_MISSING_HINT;
      renderKull();
      renderRetning();
      renderHint();
      return;
    }

    if (head.plan.name && head.plan.name !== program.code) {
      program.name = head.plan.name;
      renderProgramField();
    }

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
    if (programMissing) {
      // Nothing to fetch, classify or gate on — the kull is recorded, not
      // used, and PROGRAM_MISSING_HINT already says so.
      return;
    }

    const res = await findProgramPlan(program.code, cohort);
    if (token !== cohortToken || stagedCohort !== cohort) return;
    // A stepped-back plan (kull with no document of its own) still carries the
    // period structure; the fuller cohortsPlan is the last-resort fallback.
    cohortPlan = "kind" in res ? cohortsPlan : res.plan;

    hintText = cohortHint({
      cohort,
      foundYear: "kind" in res ? null : res.year,
      periodMissing:
        cohortPlan !== null &&
        resolvePeriodFor(cohortPlan, stagedSemesterId, cohort).courses === null,
      semesterLabel: stagedSemesterLabel(),
    });
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
      const remove = el("button", "np-icon-btn studieinfo-chip-remove") as HTMLButtonElement;
      remove.append(icon("close"));
      remove.type = "button";
      // Names the programme: this button is where focus lands after a pick and
      // on open, so its label is what announces which programme is staged.
      remove.setAttribute("aria-label", `Fjern studieprogram ${stagedProgram.code}`);
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
    programMissing = false;
    hintText = "";
    programInput.value = "";
    renderProgramField();
    renderKull();
    renderRetning();
    renderHint();
    programInput.focus();
  }

  /**
   * The kull chips to offer: the study plan's relevance rule when there is a
   * plan, the generic start-year window when there is none or the plan has no
   * period for this semester — a programme with no kull cannot be saved.
   */
  function kullChoices(): number[] {
    const fromPlan = cohortsPlan ? relevantCohorts(cohortsPlan, stagedSemesterId) : [];
    return fromPlan.length > 0 ? fromPlan : fallbackCohorts(stagedSemesterId);
  }

  function renderKull(): void {
    if (!stagedProgram) {
      kullSection.hidden = true;
      kullChips.replaceChildren();
      return;
    }
    kullSection.hidden = false;
    kullChips.replaceChildren();
    if (!cohortsPlan && !programMissing) {
      kullChips.append(el("p", "np-hint studieinfo-loading", "henter studieplan …"));
      return;
    }
    const cohorts = kullChoices();
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
    // Resolving *with* the staged answer walks past levels already answered, so
    // a nested waypoint becomes askable here — otherwise the planner asks a
    // question this modal cannot answer and the student loops between the two.
    // When every level is answered we fall back to the top-level question so an
    // existing choice stays changeable.
    const staged = stagedDirection?.code ?? null;
    const deepest = resolvePeriodFor(
      cohortPlan,
      stagedSemesterId,
      stagedCohort,
      staged,
    ).pendingChoice;
    const pending =
      deepest ??
      (staged === null
        ? null
        : resolvePeriodFor(cohortPlan, stagedSemesterId, stagedCohort).pendingChoice);
    if (!pending) {
      retningSection.hidden = true;
      retningReset.hidden = true;
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
    // An answer given at another level is not among *this* level's options, so
    // the select cannot show it — name it in the note and offer the way back.
    const shown = staged !== null && pending.directions.some((d) => d.code === staged);
    retningSelect.value = shown && staged !== null ? staged : "";
    retningReset.hidden = staged === null || shown;

    if (!retningReset.hidden && stagedDirection) {
      retningNote.textContent = `valgt: ${stagedDirection.name}`;
      retningNote.hidden = false;
    } else if (pending.deadlineDate) {
      retningNote.textContent = `frist ${formatShortDate(pending.deadlineDate)}`;
      retningNote.hidden = false;
    } else {
      retningNote.hidden = true;
    }
  }

  /**
   * The polite live region under the fields. It stays MOUNTED and in the
   * accessibility tree at all times: a region that is `hidden` when its text
   * lands is not being listened to, so a refused Lagre announced nothing.
   * Unhiding first and writing second still enters the tree and mutates in one
   * task, which several screen readers treat as initial content.
   *
   * `.sr-only` (base.css) takes it out of flow instead of out of the tree,
   * which is what the flex `gap` needed.
   */
  function renderHint(): void {
    hint.classList.toggle("sr-only", hintText === "");
    hint.textContent = hintText;
  }

  retningSelect.addEventListener("change", () => {
    const code = retningSelect.value;
    stagedDirection = code === "" ? null : (retningOptions.find((d) => d.code === code) ?? null);
    // Re-render: answering one waypoint can open the next one, and
    // answering the last one closes the section.
    renderRetning();
  });

  retningReset.addEventListener("click", () => {
    stagedDirection = null;
    renderRetning();
    retningSelect.focus();
  });

  semesterSelect.addEventListener("change", () => {
    stagedSemesterId = semesterSelect.value;
    // Relevance and the studieretning question both depend on the semester.
    if (stagedCohort !== null && (cohortsPlan !== null || programMissing)) {
      if (!kullChoices().includes(stagedCohort)) {
        stagedCohort = null;
        stagedDirection = null;
        cohortPlan = null;
        hintText = programMissing ? PROGRAM_MISSING_HINT : "";
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
    const token = ++commitToken;
    // Snapshot the staging at click time — the awaited plan fetch below must
    // commit what was on screen when Lagre was pressed.
    const semesterId = stagedSemesterId;
    const program = stagedProgram;
    const cohort = stagedCohort;
    const direction = stagedDirection;

    // A staged programme still needs a kull before it can classify a period.
    // The refusal comes *before* the semester write: a rejected Lagre must write
    // nothing, or an Avbryt afterwards leaves the planner on a semester the
    // student was never told about.
    if (program && cohort === null) {
      hintText = "Velg kull for å lagre studieprogrammet.";
      renderHint();
      // Otherwise the refusal is silent to assistive tech: focus does not move
      // and the hint goes into a region nothing was listening to. Moving focus
      // to the control that answers it is what gets spoken.
      kullChips.querySelector<HTMLButtonElement>(".studieinfo-kull-chip")?.focus();
      return;
    }

    // Semester commits first, so the programme set re-derives against the
    // semester the student is actually planning.
    deps.store.setSemester(semesterId);

    if (program && cohort !== null) {
      const planProgram: PlanProgram = {
        code: program.code,
        name: program.name,
        cohort,
        ...(direction ? { direction } : {}),
      };
      // Classify against the *kull-specific* plan. If its fetch is in flight,
      // await the memoised call rather than falling back to another cohort's
      // curriculum. A programme with no plan at all skips the round trip: the
      // empty prefill is the honest answer.
      let plan = cohortPlan;
      if (!plan && !programMissing) {
        const res = await findProgramPlan(program.code, cohort);
        // Avbryt/Esc/reopen during the fetch bumped the token — the student
        // is no longer looking at this Lagre, so drop the write.
        if (token !== commitToken) return;
        plan = "kind" in res ? cohortsPlan : res.plan;
      }
      let toAdd: AddCourseInput[] = [];
      if (plan) {
        const resolved = resolvePeriodFor(plan, semesterId, cohort, direction?.code ?? null);
        // The prefill is kept even when it exceeds a semester (B9): zeroing it
        // leaves a legitimately-heavy programme with no rows and no reason.
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
    } else if (deps.store.loadPlan().program) {
      // No programme staged but the profile still holds one → the student
      // cleared it. `removeProgram` keeps manual adds; the semester stands.
      deps.store.removeProgram();
    }

    dialog.close();
  }

  function focusInitial(): void {
    if (!stagedProgram) {
      programInput.focus();
      return;
    }
    // Reading order is programme → kull → retning → semester → Lagre, so
    // opening on the semester select left forward Tab covering only two
    // controls before it wrapped.
    const chipRemove = chipHost.querySelector<HTMLButtonElement>(".studieinfo-chip-remove");
    if (chipRemove) chipRemove.focus();
    else semesterSelect.focus();
    // A control that is hidden, disabled or not yet rendered refuses focus
    // WITHOUT complaining, and the dialog then opens with focus on <body> —
    // outside itself, so the first Tab starts at the top of the document
    // instead of in the modal. Measured on an MTDT plan, where the chip this
    // reaches for is rendered by a fetch that has not landed yet. Of the four
    // floating surfaces this was the only one that did it, and it is the one
    // PRODUCT §1.1 calls path number one.
    if (!dialog.contains(document.activeElement)) {
      dialog
        .querySelector<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        )
        ?.focus();
    }
  }

  function open(): void {
    // Invalidate any commit still awaiting its plan fetch from a prior open.
    commitToken++;
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
    // Avbryt/Esc closes here: cancel any commit awaiting its plan fetch.
    commitToken++;
    invoker?.focus?.();
    invoker = null;
  });

  signal.addEventListener("abort", () => dialog.remove());

  return { open };
}
