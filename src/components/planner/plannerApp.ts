/**
 * `/planlegger/` orchestrator (PRODUCT.md §0 — the mandate). Schedule-first:
 * programme + kull picked once → the weekly schedule for the chosen
 * semester renders immediately, prefilled with the programme's obligatory
 * courses for that kull+semester (NTNU auto-enrolls students — DR-7's
 * pre-fill IS the default plan, not a hedged suggestion). Drop/restore,
 * lecture-only conflicts + øving/lab toggle, catalog-sourced exams,
 * null-aware active-only credits, pre-publish fallback and the provenance
 * line all live here; render work is delegated to grid.ts/examRibbon.ts.
 */
import {
  fetchCourseBundle,
  loadPlannerIndex,
  type PlannerIndex,
  type PlannerIndexCourse,
} from "../../lib/planner/data.js";
import { hueForIndex } from "../../lib/planner/hues.js";
import { entriesForProgram, entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
import {
  type AddCourseInput,
  activeCourses,
  createPlanStore,
  formatPlanHash,
  type PlanCourse,
  type PlanProgram,
  type PlanState,
  type PlanStore,
  parsePlanHash,
} from "../../lib/planner/store.js";
import { el, fold, formatCredits } from "./dom.js";
import { renderExamRibbon } from "./examRibbon.js";
import { renderGrid } from "./grid.js";
import {
  classifyPeriod,
  findProgramPlan,
  isSuspiciousPrefill,
  type PeriodCourses,
  periodNumberFor,
} from "./programPlan.js";
import type { PlanCourseState } from "./types.js";

export interface SemesterSummary {
  id: string;
  name: string;
  teachingWeeks: number[];
  timetablePublished: boolean;
  fromDate: string | null;
  toDate: string | null;
  examLastDate: string | null;
  examFinalDate: string | null;
}

export interface SemestersFile {
  crawledAt: string;
  current: SemesterSummary | null;
  semesters: SemesterSummary[];
}

/** `[code, name]` — the trimmed programme catalog passed in from the page (see index.astro). */
export type ProgramOption = [code: string, name: string];

interface PlannerElements {
  contextLine: HTMLElement;
  contextChange: HTMLButtonElement;
  toggleHost: HTMLElement;
  creditLine: HTMLElement;
  picker: HTMLElement;
  pickerField: HTMLElement;
  pickerInput: HTMLInputElement;
  pickerListbox: HTMLUListElement;
  pickerKull: HTMLElement;
  pickerKullChips: HTMLElement;
  pickerStatus: HTMLElement;
  emptyState: HTMLElement;
  main: HTMLElement;
  othersToggle: HTMLButtonElement;
  gridFrame: HTMLElement;
  gridNotes: HTMLElement;
  gridStatus: HTMLElement;
  prepublishNote: HTMLElement;
  examFrame: HTMLElement;
  examList: HTMLElement;
  examStatus: HTMLElement;
  examWindow: HTMLElement;
  courseRows: HTMLElement;
  choiceSection: HTMLElement;
  choiceRows: HTMLElement;
  addField: HTMLElement;
  addInput: HTMLInputElement;
  addListbox: HTMLUListElement;
  provenance: HTMLElement;
}

function getElements(): PlannerElements | null {
  const byId = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;

  const found = {
    contextLine: byId<HTMLElement>("planner-context-line"),
    contextChange: byId<HTMLButtonElement>("planner-context-change"),
    toggleHost: byId<HTMLElement>("planner-semester-toggle"),
    creditLine: byId<HTMLElement>("planner-credit-line"),
    picker: byId<HTMLElement>("planner-picker"),
    pickerField: byId<HTMLElement>("planner-picker-field"),
    pickerInput: byId<HTMLInputElement>("planner-picker-input"),
    pickerListbox: byId<HTMLUListElement>("planner-picker-listbox"),
    pickerKull: byId<HTMLElement>("planner-picker-kull"),
    pickerKullChips: byId<HTMLElement>("planner-picker-kull-chips"),
    pickerStatus: byId<HTMLElement>("planner-picker-status"),
    emptyState: byId<HTMLElement>("planner-empty-state"),
    main: byId<HTMLElement>("planner-main"),
    othersToggle: byId<HTMLButtonElement>("planner-others-toggle"),
    gridFrame: byId<HTMLElement>("planner-grid-frame"),
    gridNotes: byId<HTMLElement>("planner-grid-notes"),
    gridStatus: byId<HTMLElement>("planner-grid-status"),
    prepublishNote: byId<HTMLElement>("planner-prepublish-note"),
    examFrame: byId<HTMLElement>("planner-exam-frame"),
    examList: byId<HTMLElement>("planner-exam-list-host"),
    examStatus: byId<HTMLElement>("planner-exam-status"),
    examWindow: byId<HTMLElement>("planner-exam-window"),
    courseRows: byId<HTMLElement>("planner-course-rows"),
    choiceSection: byId<HTMLElement>("planner-choice-section"),
    choiceRows: byId<HTMLElement>("planner-choice-rows"),
    addField: byId<HTMLElement>("planner-add-field"),
    addInput: byId<HTMLInputElement>("planner-add-input"),
    addListbox: byId<HTMLUListElement>("planner-add-listbox"),
    provenance: byId<HTMLElement>("planner-provenance"),
  };

  for (const value of Object.values(found)) {
    if (!value) return null;
  }
  return found as PlannerElements;
}

/** Current + next two non-summer semesters, ordered chronologically. */
function candidateSemesters(file: SemestersFile): SemesterSummary[] {
  const teaching = file.semesters.filter((s) => s.id.endsWith("h") || s.id.endsWith("v"));
  teaching.sort((a, b) => (a.fromDate ?? "").localeCompare(b.fromDate ?? ""));
  const currentIndex = file.current
    ? teaching.findIndex((s) => s.id === file.current?.id)
    : teaching.findIndex((s) => (s.fromDate ?? "") >= new Date().toISOString().slice(0, 10));
  const start = currentIndex >= 0 ? currentIndex : 0;
  return teaching.slice(start, start + 3);
}

/** "publiseres vanligvis i <måned>" — desember for vår, august for høst (task brief). */
function publishMonthFor(semesterId: string): string {
  return /v$/i.test(semesterId.trim()) ? "desember" : "august";
}

function semesterLabel(semester: SemesterSummary | undefined): string {
  if (!semester) return "";
  const season = /h$/i.test(semester.id) ? "Høst" : "Vår";
  const year = semesterYear(semester.id);
  return year !== null ? `${season} ${year}` : semester.name;
}

/**
 * Obligatory courses of a classified period, shaped as `AddCourseInput`s for
 * `setProgramPlan` — with the DR-5/DR-7 bug-signal guard: a >30 sp
 * obligatory prefill would hand the student a confidently wrong "reality",
 * so it falls back to no prefill at all (matching the pre-fill's
 * "suggestion, not authoritative" spirit) rather than truncating.
 */
function obligatoryToAdd(classified: PeriodCourses | null): AddCourseInput[] {
  let obligatory = classified?.obligatory ?? [];
  if (isSuspiciousPrefill(obligatory)) obligatory = [];
  return obligatory.map((c) => ({
    code: c.code,
    name: c.name,
    version: c.version,
    source: "program",
  }));
}

/** "22. jul 2026" style date for the provenance line, from an ISO timestamp. */
function formatCrawledAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const MONTHS = [
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
  return `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Mounts the planner page. `semestersFile` is `data/semesters.json`,
 * `programOptions` is the trimmed `[code, name]` catalog from
 * `data/programs.json` (both build-time crawler artifacts imported by the
 * caller, not fetched at runtime — see SPEC.md's crawled-data contracts).
 */
export async function mountPlannerApp(
  semestersFile: SemestersFile,
  programOptions: ProgramOption[],
): Promise<void> {
  const found = getElements();
  if (!found) return;
  const elements = found;

  const defaultSemesterId = semestersFile.current?.id ?? "26h";
  const store: PlanStore = createPlanStore(defaultSemesterId);

  // Hash wins over storage on load (frozen v2 grammar, PRODUCT.md §7) — but
  // only a hash that actually carries a plan. Every load ends by writing the
  // *current* plan back into the hash (syncHash below), so on a later visit
  // a trivially-empty hash (`#v2;26h;-;`, no program, no courses) is
  // indistinguishable from "no hash was ever set" and must defer to
  // localStorage instead of silently wiping it.
  const hashPlan = parsePlanHash(location.hash);
  const hashHasPlan =
    hashPlan !== null && (hashPlan.program !== null || hashPlan.courses.length > 0);
  let plan: PlanState = store.loadPlan();
  if (hashPlan && hashHasPlan) {
    const program: PlanProgram | undefined = hashPlan.program
      ? {
          code: hashPlan.program.code,
          name: hashPlan.program.code,
          cohort: hashPlan.program.cohort,
        }
      : undefined;
    plan = {
      v: 1,
      semesterId: hashPlan.semesterId,
      courses: hashPlan.courses.map((c) => ({
        code: c.code,
        name: c.code,
        version: c.version,
        source: c.source,
        ...(c.dropped ? { dropped: true } : {}),
      })),
      ...(program ? { program } : {}),
    };
    store.savePlan(plan);
  }

  const semesters = candidateSemesters(semestersFile);
  let plannerIndex: PlannerIndex | null = null;
  let showOthers = false;
  let periodCourses: PeriodCourses | null = null;
  let studyPlanFetchToken = 0;

  function currentSemester(): SemesterSummary | undefined {
    return semesters.find((s) => s.id === plan.semesterId) ?? semestersFile.current ?? undefined;
  }

  function syncHash(): void {
    history.replaceState(null, "", formatPlanHash(plan));
  }

  // --- Semester toggle + credit/context header --------------------------

  function renderSemesterToggle(): void {
    elements.toggleHost.replaceChildren();
    for (const semester of semesters) {
      const chip = el("button", "np-toggle", semester.name.toUpperCase());
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(semester.id === plan.semesterId));
      chip.addEventListener("click", () => {
        if (semester.id === plan.semesterId) return;
        store.setSemester(semester.id);
      });
      elements.toggleHost.append(chip);
    }
  }

  function renderContextLine(): void {
    elements.contextLine.replaceChildren();
    const semester = currentSemester();
    const parts: string[] = [];
    if (plan.program) parts.push(`${plan.program.code} · kull ${plan.program.cohort}`);
    parts.push(semesterLabel(semester));
    elements.contextLine.append(document.createTextNode(`${parts.join(" · ")} · `));
    elements.contextLine.append(elements.contextChange);
  }

  function totalCredits(): number {
    let sum = 0;
    for (const state of orderedActiveStates()) {
      sum += state.bundle?.details?.credits ?? 0;
    }
    return sum;
  }

  function unpricedActiveCount(): number {
    return orderedActiveStates().filter((s) => (s.bundle?.details?.credits ?? null) === null)
      .length;
  }

  function renderCreditLine(): void {
    const total = totalCredits();
    const unpriced = unpricedActiveCount();
    let text = formatCredits(total);
    if (unpriced > 0) {
      text += ` (+${unpriced} ${unpriced === 1 ? "emne" : "emner"} uten oppgitt sp)`;
    }
    elements.creditLine.textContent = text;
    elements.creditLine.classList.toggle("is-full", total >= 30);
  }

  // --- Programme + kull picker -------------------------------------------

  let pickerActiveIndex = -1;
  let pickerMatches: ProgramOption[] = [];

  function closePicker(): void {
    elements.pickerListbox.replaceChildren();
    elements.pickerListbox.hidden = true;
    pickerActiveIndex = -1;
    pickerMatches = [];
    elements.pickerInput.setAttribute("aria-expanded", "false");
  }

  function setPickerActive(index: number): void {
    pickerActiveIndex = index;
    for (const [i, opt] of [...elements.pickerListbox.children].entries()) {
      opt.classList.toggle("is-active", i === index);
    }
  }

  async function pickProgram(option: ProgramOption): Promise<void> {
    const [code, name] = option;
    elements.pickerInput.value = "";
    closePicker();
    elements.pickerKull.hidden = true;
    elements.pickerKullChips.replaceChildren();
    elements.pickerStatus.textContent = "henter studieplan …";

    const currentYear = semesterYear(plan.semesterId) ?? new Date().getFullYear();
    const result = await findProgramPlan(code, currentYear);
    if ("kind" in result) {
      elements.pickerStatus.textContent =
        result.kind === "not-found"
          ? "ingen studieplan funnet for dette programmet"
          : "klarte ikke å hente studieplan";
      return;
    }

    elements.pickerStatus.textContent = "";
    const years = [...result.plan.publishedYears].sort((a, b) => b - a);
    if (years.length === 0) {
      elements.pickerStatus.textContent = "ingen kull publisert for dette programmet ennå";
      return;
    }
    elements.pickerKull.hidden = false;
    elements.pickerKullChips.replaceChildren();
    for (const year of years) {
      const chip = el("button", "np-toggle", String(year));
      chip.type = "button";
      chip.setAttribute("aria-label", `Kull ${year}`);
      chip.addEventListener("click", () => {
        void applyProgramCohort(code, name, year);
      });
      elements.pickerKullChips.append(chip);
    }
  }

  async function applyProgramCohort(code: string, name: string, cohort: number): Promise<void> {
    elements.pickerStatus.textContent = "henter studieplan …";
    const result = await findProgramPlan(code, cohort);
    if ("kind" in result) {
      elements.pickerStatus.textContent = "klarte ikke å hente studieplan";
      return;
    }
    const program: PlanProgram = { code, name, cohort };
    const periodNumber = periodNumberFor(plan.semesterId, cohort);
    const classified = periodNumber !== null ? classifyPeriod(result.plan, periodNumber) : null;

    store.setProgramPlan(program, obligatoryToAdd(classified));
    elements.picker.hidden = true;
    elements.pickerStatus.textContent = "";
  }

  function renderPickerOptions(): void {
    const query = fold(elements.pickerInput.value.trim());
    if (query === "") {
      closePicker();
      return;
    }
    pickerMatches = programOptions
      .filter(([code, name]) => fold(code).includes(query) || fold(name).includes(query))
      .slice(0, 12);

    elements.pickerListbox.replaceChildren();
    if (pickerMatches.length === 0) {
      elements.pickerListbox.append(el("li", "planner-typeahead-empty np-note", "Ingen treff."));
      elements.pickerListbox.hidden = false;
      pickerActiveIndex = -1;
      elements.pickerInput.setAttribute("aria-expanded", "true");
      return;
    }
    pickerMatches.forEach((option) => {
      const [code, name] = option;
      const item = el("li", "planner-picker-option");
      item.setAttribute("role", "option");
      item.append(el("span", "np-data planner-picker-code", code));
      item.append(el("span", "planner-picker-name", name));
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        void pickProgram(option);
      });
      elements.pickerListbox.append(item);
    });
    elements.pickerListbox.hidden = false;
    elements.pickerInput.setAttribute("aria-expanded", "true");
    setPickerActive(0);
  }

  elements.pickerInput.addEventListener("input", renderPickerOptions);
  elements.pickerInput.addEventListener("keydown", (event) => {
    if (elements.pickerListbox.hidden || pickerMatches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPickerActive((pickerActiveIndex + 1) % pickerMatches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setPickerActive((pickerActiveIndex - 1 + pickerMatches.length) % pickerMatches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = pickerMatches[pickerActiveIndex] ?? pickerMatches[0];
      if (picked) void pickProgram(picked);
    } else if (event.key === "Escape") {
      closePicker();
    }
  });
  elements.pickerField.addEventListener("focusout", (event) => {
    if (!elements.pickerField.contains(event.relatedTarget as Node | null)) closePicker();
  });

  elements.contextChange.addEventListener("click", () => {
    elements.picker.hidden = !elements.picker.hidden;
    if (!elements.picker.hidden) elements.pickerInput.focus();
  });

  // --- Add-course typeahead (EMNER section's add field) ------------------

  let addActiveIndex = -1;
  let addMatches: PlannerIndexCourse[] = [];

  function closeAddListbox(): void {
    elements.addListbox.replaceChildren();
    elements.addListbox.hidden = true;
    addActiveIndex = -1;
    addMatches = [];
    elements.addInput.setAttribute("aria-expanded", "false");
  }

  function setAddActive(index: number): void {
    addActiveIndex = index;
    for (const [i, opt] of [...elements.addListbox.children].entries()) {
      opt.classList.toggle("is-active", i === index);
    }
  }

  function addManualCourse(course: PlannerIndexCourse): void {
    const [code, name] = course;
    store.addCourse({ code, name, source: "manual" });
  }

  function renderAddOptions(): void {
    const query = fold(elements.addInput.value.trim());
    if (query === "") {
      closeAddListbox();
      return;
    }
    const selected = new Set(plan.courses.map((c) => c.code));
    addMatches = (plannerIndex?.courses ?? [])
      .filter(
        ([code, name]) =>
          !selected.has(code) && (fold(code).includes(query) || fold(name).includes(query)),
      )
      .slice(0, 12);

    elements.addListbox.replaceChildren();
    if (addMatches.length === 0) {
      elements.addListbox.append(el("li", "planner-typeahead-empty np-note", "Ingen treff."));
      elements.addListbox.hidden = false;
      addActiveIndex = -1;
      elements.addInput.setAttribute("aria-expanded", "true");
      return;
    }
    addMatches.forEach((course) => {
      const [code, name] = course;
      const item = el("li", "planner-typeahead-option");
      item.setAttribute("role", "option");
      item.append(el("span", "np-data planner-typeahead-code", code));
      item.append(el("span", "planner-typeahead-name", name));
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        addManualCourse(course);
        elements.addInput.value = "";
        closeAddListbox();
      });
      elements.addListbox.append(item);
    });
    elements.addListbox.hidden = false;
    elements.addInput.setAttribute("aria-expanded", "true");
    setAddActive(0);
  }

  elements.addInput.addEventListener("input", renderAddOptions);
  elements.addInput.addEventListener("keydown", (event) => {
    if (elements.addListbox.hidden || addMatches.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setAddActive((addActiveIndex + 1) % addMatches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setAddActive((addActiveIndex - 1 + addMatches.length) % addMatches.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const picked = addMatches[addActiveIndex] ?? addMatches[0];
      if (picked) {
        addManualCourse(picked);
        elements.addInput.value = "";
        closeAddListbox();
      }
    } else if (event.key === "Escape") {
      closeAddListbox();
    }
  });
  elements.addField.addEventListener("focusout", (event) => {
    if (!elements.addField.contains(event.relatedTarget as Node | null)) closeAddListbox();
  });

  // --- Course bundle state (timetable + details per active course) -------

  const courseStates = new Map<string, PlanCourseState>();

  function syncCourseStates(): void {
    const seen = new Set<string>();
    const active = activeCourses(plan);
    active.forEach((course, index) => {
      seen.add(course.code);
      const existing = courseStates.get(course.code);
      if (existing) {
        existing.hueVar = hueForIndex(index);
        existing.course = course;
      } else {
        courseStates.set(course.code, {
          course,
          hueVar: hueForIndex(index),
          bundle: null,
          loading: false,
        });
      }
    });
    for (const code of [...courseStates.keys()]) {
      if (!seen.has(code)) courseStates.delete(code);
    }
  }

  function orderedActiveStates(): PlanCourseState[] {
    return activeCourses(plan)
      .map((c) => courseStates.get(c.code))
      .filter((s): s is PlanCourseState => !!s);
  }

  // --- Mutators (store writes; the change listener below re-renders) -----

  function dropCourse(code: string): void {
    store.dropCourse(code);
  }

  function restoreCourse(code: string): void {
    store.restoreCourse(code);
  }

  function removeManualCourse(code: string): void {
    store.removeCourse(code);
  }

  function addChoiceCourse(course: { code: string; name: string; version: string }): void {
    store.addCourse({
      code: course.code,
      name: course.name,
      version: course.version,
      source: "manual",
    });
  }

  // --- Render: EMNER course rows ------------------------------------------

  function renderCourseRows(): void {
    elements.courseRows.replaceChildren();
    const semester = currentSemester();
    if (plan.courses.length === 0) {
      elements.courseRows.append(el("p", "np-note", "Ingen emner i planen ennå."));
      return;
    }

    // Programme courses first (dropped or not), then manual adds — one
    // representation of the plan, not two (task brief's simplify note).
    const ordered = [...plan.courses].sort((a, b) => {
      if (a.source !== b.source) return a.source === "program" ? -1 : 1;
      return 0;
    });

    for (const course of ordered) {
      const state = courseStates.get(course.code);
      const isDropped = course.source === "program" && course.dropped === true;
      const row = el("div", `planner-course-row${isDropped ? " is-dropped" : ""}`);

      const head = el("span", "planner-course-row-head");
      if (state && !isDropped) {
        const dotEl = el("span", "np-dot");
        dotEl.style.setProperty("--dot", `var(${state.hueVar})`);
        head.append(dotEl);
      }
      head.append(el("span", "np-data", course.code));
      row.append(head);

      const details = state?.bundle?.details;
      row.append(el("span", "planner-course-row-name", details?.courseName ?? course.name));

      if (isDropped) {
        row.append(el("span", "np-note", "Fjernet"));
      } else {
        if (details?.credits != null) {
          row.append(el("span", "np-data", `${details.credits} sp`));
        }
        if (details?.assessmentScheme) {
          row.append(el("span", "planner-course-row-assessment", details.assessmentScheme));
        }
        if (state?.bundle && semester) {
          const timetable = entriesForProgram(state.bundle.timetable ?? [], plan.program?.code);
          const taught = entriesInSemester(timetable, semester.teachingWeeks);
          if (timetable.length > 0 && taught.length === 0) {
            row.append(el("span", "np-note", "Undervises ikke i valgt semester"));
          }
        }
        for (const error of state?.bundle?.errors ?? []) {
          row.append(el("span", "np-note", `Fikk ikke hentet ${error}. Prøv igjen om litt.`));
        }
      }

      row.append(
        el(
          "span",
          "planner-course-row-source np-note",
          course.source === "program" ? "fra programmet" : "lagt til selv",
        ),
      );

      if (course.source === "program") {
        if (isDropped) {
          const restore = el("button", "np-btn planner-course-remove", "Legg tilbake");
          restore.type = "button";
          restore.addEventListener("click", () => restoreCourse(course.code));
          row.append(restore);
        } else {
          const drop = el("button", "np-btn planner-course-remove", "Fjern");
          drop.type = "button";
          drop.addEventListener("click", () => dropCourse(course.code));
          row.append(drop);
        }
      } else {
        const remove = el("button", "np-btn planner-course-remove", "Fjern");
        remove.type = "button";
        remove.addEventListener("click", () => removeManualCourse(course.code));
        row.append(remove);
      }

      elements.courseRows.append(row);
    }
  }

  // --- Render: choice-group list ("Valgemner i studieplanen", DR-5) ------

  function renderChoiceRows(): void {
    const choices = periodCourses?.choice ?? [];
    const inPlan = new Set(plan.courses.map((c) => c.code));
    const remaining = choices.filter((c) => !inPlan.has(c.code));

    elements.choiceSection.hidden = choices.length === 0;
    elements.choiceRows.replaceChildren();
    if (remaining.length === 0) {
      if (choices.length > 0) {
        elements.choiceRows.append(
          el("p", "np-note", "Alle valgemnene i studieplanen er lagt til."),
        );
      }
      return;
    }
    for (const course of remaining) {
      const row = el("div", "planner-choice-row");
      row.append(el("span", "planner-choice-name", course.name));
      if (course.credits != null) row.append(el("span", "np-data", `${course.credits} sp`));
      const add = el("button", "np-btn planner-choice-add", "Legg til");
      add.type = "button";
      add.addEventListener("click", () => addChoiceCourse(course));
      row.append(add);
      elements.choiceRows.append(row);
    }
  }

  // --- Render: grid + exams + pre-publish fallback ------------------------

  function renderGridAndExams(): void {
    const semester = currentSemester();
    const states = orderedActiveStates();
    const anyLoading = states.some((s) => s.loading);

    elements.gridStatus.textContent = anyLoading ? "henter timeplan …" : "";
    elements.examStatus.textContent = anyLoading ? "henter eksamensdatoer …" : "";

    const filteredStates: PlanCourseState[] = semester
      ? states.map((s) => {
          if (!s.bundle?.timetable) return s;
          return {
            ...s,
            bundle: {
              ...s.bundle,
              // Section-filter to the programme's own lecture sections first
              // (big service courses publish one per programme cluster),
              // then semester-filter by teaching weeks.
              timetable: entriesInSemester(
                entriesForProgram(s.bundle.timetable, plan.program?.code),
                semester.teachingWeeks,
              ),
            },
          };
        })
      : states;

    // Pre-publish fallback (DR-2): timetable not published, or every loaded
    // bundle came back with zero entries — never a blank grid, always the
    // course list + exams + a graceful note naming when to come back.
    const published = semester?.timetablePublished ?? true;
    const anyBundlesLoaded = states.some((s) => s.bundle !== null);
    const allEmpty =
      anyBundlesLoaded && filteredStates.every((s) => (s.bundle?.timetable ?? []).length === 0);
    const showFallback = states.length > 0 && !anyLoading && (!published || allEmpty);

    if (showFallback && semester) {
      elements.gridFrame.replaceChildren();
      elements.gridNotes.replaceChildren();
      elements.prepublishNote.hidden = false;
      elements.prepublishNote.textContent = `Timeplan for ${semesterLabel(semester)} publiseres vanligvis i ${publishMonthFor(semester.id)} — kom tilbake da.`;
    } else {
      elements.prepublishNote.hidden = true;
      renderGrid(elements.gridFrame, elements.gridNotes, filteredStates, showOthers);
    }

    const examResult = renderExamRibbon(
      elements.examFrame,
      elements.examList,
      states,
      plan.semesterId,
      plannerIndex,
    );
    elements.examWindow.textContent = examResult.windowLabel ?? "";
  }

  // --- Provenance line -----------------------------------------------------

  function renderProvenance(): void {
    elements.provenance.textContent = `Data hentet ${formatCrawledAt(semestersFile.crawledAt)} fra NTNU · uoffisiell`;
  }

  // --- Top-level render orchestration --------------------------------------

  function renderAll(): void {
    syncCourseStates();
    // A programme+kull with a real (if entirely direction-gated, DR-5) study
    // plan still earns the full page shell — the "Valgemner i studieplanen"
    // list can be non-empty even when zero courses are prefilled.
    const hasContent = plan.courses.length > 0 || plan.program !== undefined;
    elements.emptyState.hidden = hasContent;
    elements.main.hidden = !hasContent;
    renderContextLine();
    renderCreditLine();
    renderCourseRows();
    renderChoiceRows();
    renderGridAndExams();
    renderProvenance();
  }

  async function loadBundles(): Promise<void> {
    const year = semesterYear(plan.semesterId);
    if (year === null) return;

    const toLoad = orderedActiveStates().filter((s) => s.bundle === null && !s.loading);
    if (toLoad.length === 0) return;

    for (const state of toLoad) state.loading = true;
    renderGridAndExams();

    await Promise.all(
      toLoad.map(async (state) => {
        const bundle = await fetchCourseBundle(state.course.code, year, state.course.version);
        const current = courseStates.get(state.course.code);
        if (!current) return; // removed/dropped while loading
        current.bundle = bundle;
        current.loading = false;
      }),
    );

    renderCreditLine();
    renderCourseRows();
    renderGridAndExams();
  }

  /**
   * (Re)fetches the study plan for `plan.program` and rebuilds `periodCourses`
   * (DR-5/DR-7). Also self-heals a `program`-tagged plan with zero
   * `source: "program"` courses (e.g. a hand-typed or hash-seeded link that
   * names a programme+kull but never carries its course list) by prefilling
   * obligatory courses the same way the picker does — "programme → kull →
   * your week, instantly" must hold no matter how the programme got set.
   */
  async function loadPeriodCourses(): Promise<void> {
    const program = plan.program;
    if (!program) {
      periodCourses = null;
      renderChoiceRows();
      return;
    }
    const token = ++studyPlanFetchToken;
    const result = await findProgramPlan(program.code, program.cohort);
    if (token !== studyPlanFetchToken) return; // superseded by a newer programme/kull pick
    if ("kind" in result) {
      periodCourses = null;
      renderChoiceRows();
      return;
    }
    const periodNumber = periodNumberFor(plan.semesterId, program.cohort);
    const classified = periodNumber !== null ? classifyPeriod(result.plan, periodNumber) : null;
    periodCourses = classified;

    const hasProgramCourses = plan.courses.some((c) => c.source === "program");
    if (!hasProgramCourses && classified) {
      const toAdd = obligatoryToAdd(classified);
      if (toAdd.length > 0) {
        store.setProgramPlan(program, toAdd); // triggers onPlanChange -> re-render, no direct recursion here
        return;
      }
    }
    renderChoiceRows();
  }

  elements.othersToggle.addEventListener("click", () => {
    showOthers = !showOthers;
    elements.othersToggle.setAttribute("aria-pressed", String(showOthers));
    renderGridAndExams();
  });

  store.onPlanChange((next) => {
    plan = next;
    syncHash();
    renderSemesterToggle();
    renderAll();
    void loadBundles();
    void loadPeriodCourses();
  });

  loadPlannerIndex()
    .then((index) => {
      plannerIndex = index;
      // Backfill real course names for any hash-sourced courses that only had their code.
      let changed = false;
      const byCode = new Map<string, PlannerIndexCourse>(index.courses.map((c) => [c[0], c]));
      const nextCourses: PlanCourse[] = plan.courses.map((c) => {
        if (c.name !== c.code) return c;
        const found = byCode.get(c.code);
        if (!found) return c;
        changed = true;
        return { ...c, name: found[1] };
      });
      if (changed) store.savePlan({ ...plan, courses: nextCourses });
      renderGridAndExams(); // exam ribbon needed the index to render its catalog data
    })
    .catch(() => {
      // Typeahead search + exam ribbon will simply show no results; the rest of the page still works.
    });

  // First paint from the initial (hash-or-storage) plan, then kick off fetches.
  syncHash();
  renderSemesterToggle();
  renderAll();
  await Promise.all([loadBundles(), loadPeriodCourses()]);
}
