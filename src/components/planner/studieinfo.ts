/**
 * Studieinfo — programme, kull and studieretning — as a SECTION of the profile
 * panel rather than a modal of its own.
 *
 * **What moved, and why.** This was one `<dialog>` owning four choices:
 * programme, kull, studieretning and semester. Three of them describe the
 * *student* and one describes the *plan*, and the file made no distinction —
 * so the only way to change your programme was a modal opened from a button
 * that existed on one of four pages, while the semester rode along inside it
 * for no reason except that it was also a `<select>`.
 *
 * Now: the three that describe the student are this section, mounted inside
 * the profile panel (`profilePanel.ts`) which the topbar opens from every
 * page. The semester is the planner's own control, in the planner's own bar,
 * because it belongs to the plan you are looking at — see
 * `#planner-semester-select`. This file no longer touches it; it reads the
 * stored semester when it needs one (kull relevance and the studieretning
 * question both depend on which term is being planned) and writes it never.
 *
 * Every edit is still staged locally and nothing touches the store until
 * **Lagre**; closing the panel discards. Obligatory-classified courses replace
 * the plan's `source: "program"` set via `setProgramPlan`, preserving manual
 * adds/drops. A >30 sp prefill is **kept**, not zeroed — the planner's
 * credit-line note does the surfacing.
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
 * be savable — this is the only programme picker there is, so refusing to save
 * is a hard dead end. We offer `fallbackCohorts` chips, record programme + kull
 * with an empty prefill, and say the emner have to be added by hand.
 */
import { semesterYear } from "../../lib/planner/schedule.js";
import type { AddCourseInput, PlanProgram, PlanStore } from "../../lib/planner/store.js";
import { el, fold, formatShortDate, icon } from "./dom.js";
import type { ProgramOption } from "./plannerApp.js";
import {
  type DirectionOption,
  findProgramPlan,
  maxPeriodNumber,
  relevantCohorts,
  resolvePeriodFor,
  type StudyPlan,
} from "./programPlan.js";

export interface StudieinfoSectionDeps {
  store: PlanStore;
  /**
   * WHEN a pick is written, which is the only thing this section's two hosts
   * disagree about.
   *
   * `"explicit"` is the dialog's. It edits a plan that already exists, where a
   * stray chip press must not rewrite it, so Lagre is the write and a light
   * dismiss discards the staging.
   *
   * `"on-kull"` is the first-run screen's. The sentence above the field
   * promises the week is ready once programme and kull are given, and a third
   * press would make that false — so the kull IS the commit, and no Lagre is
   * rendered at all.
   */
  commit: "explicit" | "on-kull";
  /**
   * Called after a commit that actually wrote. The dialog closes itself on it:
   * the student came here to answer a question, the answer is stored, and the
   * week behind the modal has already redrawn.
   */
  onSaved: () => void;
}

export interface StudieinfoSectionHandle {
  /** The element the panel appends. Built once, re-rendered in place. */
  element: HTMLElement;
  /** Re-reads the store and rebuilds the staging. Called on every panel open. */
  reset(): void;
  /** Focus for a first-run student: the programme field, or the picked chip. */
  focusProgram(): void;
  /**
   * Focus for the planner's studieretning question. The select does not exist
   * until the kull's study plan has landed, which on a cold open is a fetch
   * away — so this focuses it now if it is drawn and otherwise ARMS the next
   * render to do it. The arming is dropped if the student has meanwhile
   * started typing in the programme field.
   */
  focusDirection(): void;
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

/**
 * The typeahead's catalogue, fetched once per tab from the build-time endpoint
 * (`src/pages/data/programs.json.ts`) rather than inlined into every document.
 * Memoised on the module, so the second panel open on the same tab is free.
 *
 * A failure resolves to an empty list rather than rejecting: the field then
 * says it found nothing, which is true of what it can see, and the next open
 * retries because the memo is cleared on the way out.
 */
let programOptionsMemo: Promise<ProgramOption[]> | null = null;

export function loadProgramOptions(): Promise<ProgramOption[]> {
  if (!programOptionsMemo) {
    programOptionsMemo = fetch("/data/programs.json")
      .then((res) => (res.ok ? (res.json() as Promise<ProgramOption[]>) : []))
      .catch(() => [])
      .then((options) => {
        if (options.length === 0) programOptionsMemo = null;
        return options;
      });
  }
  return programOptionsMemo;
}

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
 * A native `<select>` in a shell that owns its indicator. The grammar is
 * `primitives.css`'s `.np-select`, shared with the planner's semester control
 * — the platform arrow renders differently in every engine and cannot say
 * whether the picker is open.
 */
function selectShell(select: HTMLSelectElement): HTMLElement {
  const shell = el("div", "np-select-shell");
  shell.append(select, icon("chevronDown", "np-select-icon"));
  return shell;
}

/**
 * "Høst 2026" / "Vår 2027" from a semester id alone. Derived rather than
 * looked up in `data/semesters.json`, so this module ships no copy of that
 * file to the browser — it is mounted on every page now, and the only fact it
 * needs about a semester is what to call it.
 */
export function semesterLabelFor(semesterId: string): string {
  const year = semesterYear(semesterId);
  if (year === null) return semesterId;
  return `${/h$/i.test(semesterId.trim()) ? "Høst" : "Vår"} ${year}`;
}

/**
 * Builds the section once and hands back the element plus the three things the
 * panel drives it with. Nothing is appended to the document here: the panel
 * owns where it goes.
 */
export function buildStudieinfoSection(deps: StudieinfoSectionDeps): StudieinfoSectionHandle {
  // --- Staged state (nothing here reaches the store until Lagre) ----------
  let stagedProgram: { code: string; name: string } | null = null;
  let stagedCohort: number | null = null;
  let stagedDirection: DirectionOption | null = null;
  /** The semester being planned. Read from the store, never written here. */
  let semesterId = deps.store.loadPlan().semesterId;
  /** Full-range plan feeding `relevantCohorts` (see file header). */
  let cohortsPlan: StudyPlan | null = null;
  /** The selected kull's own plan — studieretning options + the Lagre classify. */
  let cohortPlan: StudyPlan | null = null;
  /** `true` once a programme pick came back not-found/error. */
  let programMissing = false;
  /** Whichever `<select>` options studieretning currently offers. */
  let retningOptions: DirectionOption[] = [];
  /** The typeahead catalogue, once its fetch has landed. */
  let programOptions: ProgramOption[] | null = null;
  /** A `focusDirection()` waiting for the studieretning select to exist. */
  let pendingDirectionFocus = false;
  let hintText = "";
  /** Guards against a slow fetch resolving after a newer pick (superseded). */
  let programToken = 0;
  let cohortToken = 0;
  /**
   * Guards `commit`'s awaited plan fetch: bumped on every `reset()`, so
   * closing and reopening the panel during the in-flight classify cancels the
   * pending write.
   */
  let commitToken = 0;

  // --- DOM skeleton (built once) ------------------------------------------
  // NO HEADING AND NO HINT OF ITS OWN. The section used to print "Studieinfo"
  // over "Programmet og kullet ditt fyller ukeplanen.", which inside a 300px
  // dialog meant three titles ("Studieprogram" in the head, "Studieinfo" here,
  // "STUDIEPROGRAM" on the field) stacked above one input. Both hosts already
  // say what this is: the dialog in its head, the first-run screen in its <h1>
  // and its one sentence. So the section names itself nowhere and takes its
  // accessible name from whichever room it stands in.
  const section = el("section", "studieinfo-section");

  const body = el("div", "studieinfo-body");
  section.append(body);

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
  // picker was deleted (PRODUCT §11) — so this section, the ONLY place a
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
  const retningSelect = el("select", "np-select") as HTMLSelectElement;
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

  // Hint + action ---------------------------------------------------------
  // Permanently mounted, never `hidden` — see `renderHint()` for why.
  const hint = el("p", "np-hint studieinfo-hint sr-only", "");
  hint.id = "studieinfo-hint";
  hint.setAttribute("aria-live", "polite");
  body.append(hint);

  // ONLY THE DIALOG HAS A LAGRE. Under `"on-kull"` the kull press is the write,
  // so an action row here would be a second way to do the thing that already
  // happened.
  //
  // NOT `.np-actions`: that primitive is a CARD's footer and brings its own
  // hairline, and this is a section inside one.
  let saveBtn: HTMLButtonElement | null = null;
  if (deps.commit === "explicit") {
    const actions = el("div", "studieinfo-actions");
    // PAPER, not `.np-btn--primary`. It wore the accent while this section was
    // the profile panel's one job; the panel's own submit is the accent now,
    // and an accent here would be a second one on the same surface (DESIGN §5).
    // There is no Avbryt beside it — the dialog's × is the way out, and closing
    // discards the staging, which is exactly what Avbryt did.
    saveBtn = el("button", "np-btn studieinfo-save", "Lagre") as HTMLButtonElement;
    saveBtn.type = "button";
    saveBtn.id = "studieinfo-save";
    // A refused Lagre writes its reason into the hint; describing the button
    // with it makes the reason reachable from the control that caused it. An
    // empty hint contributes no description.
    saveBtn.setAttribute("aria-describedby", "studieinfo-hint");
    actions.append(saveBtn);
    body.append(actions);
  }

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

  /** One non-option row in the listbox — "Ingen treff." and the loading line.
   *  A `role="listbox"` may only contain options, so a bare <li> is dropped
   *  from the accessibility tree and a mistyped programme is answered with
   *  silence. A disabled option is valid and can be `aria-activedescendant`. */
  function renderListboxMessage(text: string): void {
    const item = el("li", "studieinfo-typeahead-empty np-hint", text);
    item.id = "studieinfo-program-option-empty";
    item.setAttribute("role", "option");
    item.setAttribute("aria-disabled", "true");
    item.setAttribute("aria-selected", "false");
    programListbox.replaceChildren(item);
    programListbox.hidden = false;
    programActive = -1;
    programInput.setAttribute("aria-expanded", "true");
    programInput.setAttribute("aria-activedescendant", item.id);
  }

  function renderProgramOptions(): void {
    const query = fold(programInput.value.trim());
    if (query === "") {
      closeProgramList();
      return;
    }
    if (programOptions === null) {
      // Typed before the catalogue landed. It is one small file requested when
      // the panel opened, so this is a frame or two, not a state to design
      // around — but silence here reads as "no such programme".
      renderListboxMessage("henter studieprogram …");
      return;
    }
    programMatches = programOptions
      .filter(([code, name]) => fold(code).includes(query) || fold(name).includes(query))
      .slice(0, MAX_PROGRAM_ROWS);

    programListbox.replaceChildren();
    if (programMatches.length === 0) {
      renderListboxMessage("Ingen treff.");
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
      // With no list open, Escape belongs to the panel. With one open it must
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
   * `keepCohort` re-uses a pre-staged kull when the panel opened on a profile.
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

    const guessYear = semesterYear(semesterId) ?? new Date().getFullYear();
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
      relevantCohorts(cohortsPlan, semesterId).includes(stagedCohort);
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
        cohortPlan !== null && resolvePeriodFor(cohortPlan, semesterId, cohort).courses === null,
      semesterLabel: semesterLabelFor(semesterId),
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
    const fromPlan = cohortsPlan ? relevantCohorts(cohortsPlan, semesterId) : [];
    return fromPlan.length > 0 ? fromPlan : fallbackCohorts(semesterId);
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
        // Under `"on-kull"` this press IS the save. It waits for the kull's own
        // plan first, because `commit` classifies the period against it and
        // would otherwise write a programme with no prefilled courses.
        void loadCohort(year, false).then(() => {
          if (deps.commit === "on-kull") return commit();
        });
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
    // question this section cannot answer and the student loops between the
    // two. When every level is answered we fall back to the top-level question
    // so an existing choice stays changeable.
    const staged = stagedDirection?.code ?? null;
    const deepest = resolvePeriodFor(cohortPlan, semesterId, stagedCohort, staged).pendingChoice;
    const pending =
      deepest ??
      (staged === null
        ? null
        : resolvePeriodFor(cohortPlan, semesterId, stagedCohort).pendingChoice);
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

    // The question the planner sent the student here to answer has finally
    // drawn its control. Not while they are typing a programme name: an armed
    // focus that jumps out of a field mid-word is worse than no focus at all.
    if (pendingDirectionFocus) {
      pendingDirectionFocus = false;
      if (document.activeElement !== programInput) retningSelect.focus();
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
    renderSave();
  }

  /**
   * Lagre is dead until there is something to write. Called from `renderHint`,
   * which every staging change already goes through.
   *
   * The test is "is anything pending", NOT "is the pick complete": a programme
   * staged without a kull must stay pressable, because pressing it is what
   * produces "Velg kull for å lagre studieprogrammet." and moves focus to the
   * chips — a disabled button explains nothing. What it refuses is the pristine
   * form, where a press did nothing and said nothing. A cleared programme over
   * a stored one is also pending: that press commits the removal.
   */
  function renderSave(): void {
    if (!saveBtn) return;
    saveBtn.disabled = stagedProgram === null && deps.store.loadPlan().program === undefined;
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

  // --- Commit -------------------------------------------------------------
  async function commit(): Promise<void> {
    const token = ++commitToken;
    // Snapshot the staging at click time — the awaited plan fetch below must
    // commit what was on screen when Lagre was pressed. The semester is
    // snapshotted too, and never written: it is the planner's control now, and
    // a settings panel that silently moved the student's term would be worse
    // than one that refuses to.
    const semester = semesterId;
    const program = stagedProgram;
    const cohort = stagedCohort;
    const direction = stagedDirection;

    // A staged programme still needs a kull before it can classify a period.
    if (program && cohort === null) {
      hintText = "Velg kull for å lagre studieprogrammet.";
      renderHint();
      // Otherwise the refusal is silent to assistive tech: focus does not move
      // and the hint goes into a region nothing was listening to. Moving focus
      // to the control that answers it is what gets spoken.
      kullChips.querySelector<HTMLButtonElement>(".studieinfo-kull-chip")?.focus();
      return;
    }

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
        // A close/reopen during the fetch bumped the token — the student is no
        // longer looking at this Lagre, so drop the write.
        if (token !== commitToken) return;
        plan = "kind" in res ? cohortsPlan : res.plan;
      }
      let toAdd: AddCourseInput[] = [];
      if (plan) {
        const resolved = resolvePeriodFor(plan, semester, cohort, direction?.code ?? null);
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

    deps.onSaved();
  }

  saveBtn?.addEventListener("click", () => void commit());

  function reset(): void {
    // Invalidate any commit still awaiting its plan fetch from a prior open.
    commitToken++;
    const plan = deps.store.loadPlan();
    semesterId = plan.semesterId;
    stagedProgram = null;
    stagedCohort = null;
    stagedDirection = null;
    cohortsPlan = null;
    cohortPlan = null;
    programMissing = false;
    pendingDirectionFocus = false;
    hintText = "";
    programInput.value = "";
    closeProgramList();
    if (plan.program) {
      stagedProgram = { code: plan.program.code, name: plan.program.name };
      stagedCohort = plan.program.cohort;
      stagedDirection = plan.program.direction
        ? { code: plan.program.direction.code, name: plan.program.direction.name }
        : null;
    }

    renderProgramField();
    renderKull();
    renderRetning();
    renderHint();

    // Requested on open rather than on page-load: a student who never touches
    // their studieinfo never pays for the catalogue.
    void loadProgramOptions().then((options) => {
      programOptions = options;
      // Only if something is waiting on it — otherwise this would open a
      // listbox nobody asked for.
      if (programInput.value.trim() !== "") renderProgramOptions();
    });

    if (stagedProgram) void loadProgram(true);
  }

  return {
    element: section,
    reset,
    focusProgram(): void {
      // Reading order is programme → kull → retning → Lagre, so a picked
      // programme puts focus on its chip rather than on a field the student
      // has already filled.
      const chipRemove = chipHost.querySelector<HTMLButtonElement>(".studieinfo-chip-remove");
      if (chipRemove) chipRemove.focus();
      else programInput.focus();
    },
    focusDirection(): void {
      if (!retningSection.hidden) {
        retningSelect.focus();
        return;
      }
      pendingDirectionFocus = true;
    },
  };
}
