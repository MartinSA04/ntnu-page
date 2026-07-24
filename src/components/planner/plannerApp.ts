/**
 * `/planlegger/` orchestrator (PLANNER.md §2/§5). Owns the plan store,
 * semester switcher, credit line, hash sync, and coordinates the basket /
 * grid / exam-ribbon render modules against fetched course bundles.
 */
import {
  fetchCourseBundle,
  loadPlannerIndex,
  type PlannerIndexCourse,
} from "../../lib/planner/data.js";
import { hueForIndex } from "../../lib/planner/hues.js";
import { entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
import {
  createPlanStore,
  formatPlanHash,
  type PlanCourse,
  type PlanState,
  parsePlanHash,
} from "../../lib/planner/store.js";
import { mountBasket, renderBasket, setBasketIndex } from "./basket.js";
import { el, formatCredits } from "./dom.js";
import { renderExamRibbon } from "./examRibbon.js";
import { renderGrid } from "./grid.js";
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
  current: SemesterSummary | null;
  semesters: SemesterSummary[];
}

interface PlannerElements {
  toggleHost: HTMLElement;
  creditLine: HTMLElement;
  publishNote: HTMLElement;
  tagsHost: HTMLElement;
  addField: HTMLElement;
  addInput: HTMLInputElement;
  addListbox: HTMLUListElement;
  programNote: HTMLElement;
  gridFrame: HTMLElement;
  gridNotes: HTMLElement;
  gridStatus: HTMLElement;
  examFrame: HTMLElement;
  examList: HTMLElement;
  examStatus: HTMLElement;
  examWindow: HTMLElement;
  courseRows: HTMLElement;
  emptyState: HTMLElement;
  main: HTMLElement;
}

function getElements(): PlannerElements | null {
  const byId = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;

  const toggleHost = byId<HTMLElement>("planner-semester-toggle");
  const creditLine = byId<HTMLElement>("planner-credit-line");
  const publishNote = byId<HTMLElement>("planner-publish-note");
  const tagsHost = byId<HTMLElement>("planner-tags");
  const addField = byId<HTMLElement>("planner-add-field");
  const addInput = byId<HTMLInputElement>("planner-add-input");
  const addListbox = byId<HTMLUListElement>("planner-add-listbox");
  const programNote = byId<HTMLElement>("planner-program-note");
  const gridFrame = byId<HTMLElement>("planner-grid-frame");
  const gridNotes = byId<HTMLElement>("planner-grid-notes");
  const gridStatus = byId<HTMLElement>("planner-grid-status");
  const examFrame = byId<HTMLElement>("planner-exam-frame");
  const examList = byId<HTMLElement>("planner-exam-list-host");
  const examStatus = byId<HTMLElement>("planner-exam-status");
  const examWindow = byId<HTMLElement>("planner-exam-window");
  const courseRows = byId<HTMLElement>("planner-course-rows");
  const emptyState = byId<HTMLElement>("planner-empty-state");
  const main = byId<HTMLElement>("planner-main");

  if (
    !toggleHost ||
    !creditLine ||
    !publishNote ||
    !tagsHost ||
    !addField ||
    !addInput ||
    !addListbox ||
    !programNote ||
    !gridFrame ||
    !gridNotes ||
    !gridStatus ||
    !examFrame ||
    !examList ||
    !examStatus ||
    !examWindow ||
    !courseRows ||
    !emptyState ||
    !main
  ) {
    return null;
  }

  return {
    toggleHost,
    creditLine,
    publishNote,
    tagsHost,
    addField,
    addInput,
    addListbox,
    programNote,
    gridFrame,
    gridNotes,
    gridStatus,
    examFrame,
    examList,
    examStatus,
    examWindow,
    courseRows,
    emptyState,
    main,
  };
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

function examWindowLabel(semester: SemesterSummary | undefined): string {
  if (!semester?.examLastDate) return "";
  const from = semester.examLastDate;
  const to = semester.examFinalDate ?? semester.examLastDate;
  const fmt = (d: string): string => {
    const date = new Date(`${d}T00:00:00`);
    return `${date.getDate()}. ${
      [
        "jan.",
        "feb.",
        "mars",
        "apr.",
        "mai",
        "juni",
        "juli",
        "aug.",
        "sep.",
        "okt.",
        "nov.",
        "des.",
      ][date.getMonth()]
    }`;
  };
  return `${fmt(from)} – ${fmt(to)}`;
}

/**
 * Mounts the planner page. `semestersFile` is `data/semesters.json`,
 * imported at build time by the caller (a build-time crawler artifact, not
 * served under `public/` — see SPEC.md's crawled-data contracts) rather
 * than fetched at runtime.
 */
export async function mountPlannerApp(semestersFile: SemestersFile): Promise<void> {
  const found = getElements();
  if (!found) return;
  // Rebind as a non-optional local: TS doesn't narrow captured outer bindings
  // inside nested function declarations below (see courseTimetable.ts).
  const elements = found;

  const defaultSemesterId = semestersFile.current?.id ?? "26h";
  const store = createPlanStore(defaultSemesterId);

  // Hash wins over storage on load (PLANNER.md §3); backfill course names once the index loads.
  const hashPlan = parsePlanHash(location.hash);
  let plan: PlanState = store.loadPlan();
  if (hashPlan) {
    plan = {
      v: 1,
      semesterId: hashPlan.semesterId,
      courses: hashPlan.codes.map((code) => ({ code, name: code })),
      program: plan.program,
    };
    store.savePlan(plan);
  }

  const semesters = candidateSemesters(semestersFile);

  function currentSemester(): SemesterSummary | undefined {
    return semesters.find((s) => s.id === plan.semesterId) ?? semestersFile.current ?? undefined;
  }

  function syncHash(): void {
    history.replaceState(null, "", formatPlanHash(plan));
  }

  function renderSemesterToggle(): void {
    elements.toggleHost.replaceChildren();
    for (const semester of semesters) {
      const chip = el("button", "np-toggle", semester.name.toUpperCase());
      chip.type = "button";
      chip.setAttribute("aria-pressed", String(semester.id === plan.semesterId));
      chip.addEventListener("click", () => {
        if (semester.id === plan.semesterId) return;
        // The store's change event (below) drives the re-render + reload.
        store.setSemester(semester.id);
      });
      elements.toggleHost.append(chip);
    }
    const semester = currentSemester();
    elements.publishNote.textContent =
      semester && !semester.timetablePublished ? "timeplan ikke publisert ennå" : "";
    elements.examWindow.textContent = examWindowLabel(semester);
  }

  const courseStates = new Map<string, PlanCourseState>();

  function syncCourseStates(): void {
    const seen = new Set<string>();
    plan.courses.forEach((course, index) => {
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

  function orderedStates(): PlanCourseState[] {
    return plan.courses
      .map((c) => courseStates.get(c.code))
      .filter((s): s is PlanCourseState => !!s);
  }

  function totalCredits(): number {
    return orderedStates().reduce((sum, s) => sum + (s.bundle?.details?.credits ?? 0), 0);
  }

  function renderCreditLine(): void {
    const total = totalCredits();
    elements.creditLine.textContent = formatCredits(total);
    elements.creditLine.classList.toggle("is-full", total >= 30);
  }

  function renderEmptyState(): void {
    elements.emptyState.hidden = plan.courses.length > 0;
    elements.main.hidden = plan.courses.length === 0;
  }

  function renderCourseRows(): void {
    elements.courseRows.replaceChildren();
    const semester = currentSemester();
    for (const state of orderedStates()) {
      const row = el("div", "planner-course-row");
      const head = el("span", "planner-course-row-head");
      const dotEl = el("span", "np-dot");
      dotEl.style.setProperty("--dot", `var(${state.hueVar})`);
      head.append(dotEl);
      head.append(el("span", "np-data", state.course.code));
      row.append(head);

      const details = state.bundle?.details;
      row.append(el("span", "planner-course-row-name", details?.courseName ?? state.course.name));
      if (details?.credits != null) {
        row.append(el("span", "np-data", `${details.credits} sp`));
      }
      if (details?.location) {
        row.append(el("span", "np-data", details.location));
      }
      if (details?.assessmentScheme) {
        row.append(el("span", "planner-course-row-assessment", details.assessmentScheme));
      }

      if (state.bundle && semester) {
        const timetable = state.bundle.timetable ?? [];
        const taught = entriesInSemester(timetable, semester.teachingWeeks);
        if (timetable.length > 0 && taught.length === 0) {
          row.append(el("span", "np-note", "Undervises ikke i valgt semester"));
        }
      }
      for (const error of state.bundle?.errors ?? []) {
        row.append(el("span", "np-note", `Fikk ikke hentet ${error}. Prøv igjen om litt.`));
      }

      const remove = el("button", "np-btn planner-course-remove", "Fjern");
      remove.type = "button";
      remove.addEventListener("click", () => removeCourse(state.course.code));
      row.append(remove);

      elements.courseRows.append(row);
    }
  }

  function renderGridAndExams(): void {
    const semester = currentSemester();
    const states = orderedStates();

    if (states.some((s) => s.loading)) {
      elements.gridStatus.textContent = "henter timeplan …";
      elements.examStatus.textContent = "henter eksamensdatoer …";
    } else {
      elements.gridStatus.textContent = "";
      elements.examStatus.textContent = "";
    }

    const filteredStates: PlanCourseState[] = semester
      ? states.map((s) => {
          if (!s.bundle?.timetable) return s;
          return {
            ...s,
            bundle: {
              ...s.bundle,
              timetable: entriesInSemester(s.bundle.timetable, semester.teachingWeeks),
            },
          };
        })
      : states;

    renderGrid(elements.gridFrame, elements.gridNotes, filteredStates);
    renderExamRibbon(elements.examFrame, elements.examList, states, plan.semesterId);
  }

  function renderAll(): void {
    syncCourseStates();
    renderEmptyState();
    renderBasket(
      elements.tagsHost,
      elements.programNote,
      orderedStates(),
      plan.program,
      removeCourse,
    );
    renderCreditLine();
    renderCourseRows();
    renderGridAndExams();
  }

  async function loadBundles(): Promise<void> {
    const year = semesterYear(plan.semesterId);
    if (year === null) return;

    const toLoad = orderedStates().filter((s) => s.bundle === null && !s.loading);
    if (toLoad.length === 0) return;

    for (const state of toLoad) state.loading = true;
    renderGridAndExams();

    await Promise.all(
      toLoad.map(async (state) => {
        const bundle = await fetchCourseBundle(state.course.code, year);
        const current = courseStates.get(state.course.code);
        if (!current) return; // removed while loading
        current.bundle = bundle;
        current.loading = false;
      }),
    );

    renderCreditLine();
    renderCourseRows();
    renderGridAndExams();
  }

  // The store's change event (dispatched on every save, same-tab or cross-tab) is the
  // single re-render trigger: mutators below just write to the store.
  function addCourse(course: PlanCourse): void {
    store.addCourse(course);
  }

  function removeCourse(code: string): void {
    store.removeCourse(code);
  }

  mountBasket(
    {
      field: elements.addField,
      input: elements.addInput,
      listbox: elements.addListbox,
      onAdd: addCourse,
    },
    (code) => plan.courses.some((c) => c.code === code),
  );

  store.onPlanChange((next) => {
    plan = next;
    syncHash();
    renderSemesterToggle();
    renderAll();
    void loadBundles();
  });

  loadPlannerIndex()
    .then((index) => {
      setBasketIndex(index);
      // Backfill real course names for any hash-sourced courses that only had their code.
      let changed = false;
      const byCode = new Map<string, PlannerIndexCourse>(index.courses.map((c) => [c[0], c]));
      const nextCourses = plan.courses.map((c) => {
        if (c.name !== c.code) return c;
        const found = byCode.get(c.code);
        if (!found) return c;
        changed = true;
        return { code: c.code, name: found[1] };
      });
      if (changed) store.savePlan({ ...plan, courses: nextCourses });
    })
    .catch(() => {
      // Typeahead search will simply show no results; the rest of the page still works.
    });

  // First paint from the initial (hash-or-storage) plan, then kick off fetches.
  syncHash();
  renderSemesterToggle();
  renderAll();
  await loadBundles();
}
