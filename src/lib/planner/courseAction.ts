/**
 * ONE ANSWER TO "WHAT DOES PRESSING THIS DO TO THE PLAN", for every surface
 * that offers to put a course in one.
 *
 * This used to live inside `addCourse.ts`, which meant the *dialog* knew that a
 * programme course must not be hard-deleted and that a dropped course is not in
 * the plan, and `/emner/` — the other surface with the same button on a hundred
 * rows — did not. The register asked `store.hasCourse(code)` and called
 * `store.removeCourse(code)`, so it reported a dropped course as present, and
 * pressing its button deleted a programme course outright: no `dropped` marker
 * was left behind, so the next study-plan derive silently put the course back
 * and the student's press was undone by the tool.
 *
 * The rule is a product rule (PRODUCT §1.3, a programme course is never
 * deleted), not a dialog rule, so it belongs where both callers can reach it
 * and neither can drift from it. Nothing here touches the DOM.
 */

import type { AddCourseInput, PlanStore } from "./store.ts";

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
   *
   * It is also what a two-state surface reads to decide which half of DESIGN
   * §8's pair to show: `none` and `dropped` are both "not in the plan", which
   * is the distinction `hasCourse` cannot make.
   */
  stateKind: "none" | "added" | "program" | "dropped";
  /** Performs the action and returns the sentence to announce afterwards. */
  run: () => string;
}

/**
 * Derives a row's control from the plan *entry*, not from `hasCourse`.
 *
 * Four states, because a programme course is never deleted (PRODUCT §1.3): absent
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
      // DESIGN §8's mandated pair is "Legg til i planen" → "I planen". The
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

/** Is this course in the plan *as the week draws it*? A dropped course is not. */
export function isPlanned(kind: AddCourseRowControl["stateKind"]): boolean {
  return kind === "added" || kind === "program";
}
