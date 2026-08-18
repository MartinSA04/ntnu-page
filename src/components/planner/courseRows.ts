/**
 * EMNER — the plan's course list.
 *
 * Two surfaces used to draw it, `/planlegger/` and `/user/<navn>`, and they
 * differed in one thing: the planner's rows carry a way into the editor and the
 * shared plan's carried a way out to the course. The second surface is deleted.
 *
 * A row is IDENTITY AND NOTHING ELSE. Vurderingsform lives in the exam list;
 * the status line, the retry and the Dropp/Fjern button live in the settings
 * modal the row opens. That rule is what keeps this renderable read-only at
 * all: with nothing on the row that acts, taking the action off leaves a row
 * that still says everything it said.
 */

import { courseLinks } from "../../lib/planner/courseLinks.js";
import { el, formatCreditNumber, settingsIcon } from "./dom.js";

/** One course, as a list row states it. */
export interface CourseRowModel {
  code: string;
  name: string;
  hueVar: string;
  /** `null` is DR-6's honest gap: the column stays, the figure does not appear. */
  credits: number | null;
  /**
   * A programme course the student dropped: still in the list because it is
   * part of the programme, out of the week, the credits and the exams.
   */
  dropped?: boolean;
  /**
   * Something about this course needs looking at and the sentence is elsewhere
   * — off-semester, not taught this year, a failed fetch. One mark under the
   * name, never in the credit column, where it ate the one figure a student
   * might have been questioning.
   */
  needsAttention?: boolean;
}

export interface CourseRowsOptions {
  /** The way into the editor, as a settings button at the row's end. */
  onOpenSettings?: ((code: string) => void) | null;
  /**
   * Which year the plan is for, threaded into the `ntnu.no` link so a plan for
   * a past term points at the page that term was taught from.
   */
  year?: number;
}

/**
 * Renders the plan's rows into `host`.
 *
 * No empty-state sentence: a heading over a line restating the heading is not
 * information, and the section is its name and (on the planner) its "Legg til
 * emne" button. The absence of rows says the rest.
 */
export function renderCourseRows(
  host: HTMLElement,
  rows: CourseRowModel[],
  options: CourseRowsOptions = {},
): void {
  // The rows come straight out of the caller's own state, so this pass ends the
  // gap the reservation was bridging (paint → mount).
  delete host.dataset.reserve;
  host.replaceChildren();

  const onOpenSettings = options.onOpenSettings ?? null;

  for (const course of rows) {
    // A row is not a control: as a full-width `<button>` it had a pointer
    // cursor and a hover wash while showing nothing pressable. It is inert and
    // carries at most ONE explicit target.
    const row = el("div", `planner-course-row${course.dropped ? " is-dropped" : ""}`);
    row.dataset.code = course.code;

    // A SWATCH AND THE CODE, not the code printed inside the hue. The dot is
    // already what carries a course's identity in the exam list, in Liste's
    // rows and in the session card — this rail was the one place that fused the
    // two, which made the same course two different shapes on one page. A
    // dropped course keeps the swatch and loses its fill, so the row reads as
    // switched off rather than as missing.
    const chip = el("span", "planner-course-chip");
    chip.style.setProperty("--dot", `var(${course.hueVar})`);
    row.append(chip);

    const nameCell = el("span", "planner-course-name");
    // THE TITLE IS INERT. It was an `<a>` on the surface that had no editor,
    // pointing at `/emne/[code]/`; that page is deleted and the two places a
    // student can now go about this course are the explicit links below, which
    // say where they lead rather than making the whole name a mystery target.
    const title = el("span", "planner-course-title");
    title.append(el("b", "planner-course-code np-data", course.code));
    title.append(` ${course.name}`);
    nameCell.append(title);
    row.append(nameCell);

    if (course.dropped) {
      // The one status a row still says for itself: a dropped course is out of
      // the week, the credits and the exams, so a grayed row with no
      // explanation looks broken (PRODUCT §1.3).
      row.append(el("span", "planner-course-sp np-data", "droppet"));
    } else {
      if (course.needsAttention) {
        nameCell.append(el("span", "planner-course-flag np-data", "se detaljer"));
      }
      // Right-aligned in its own column so the figures stack into something a
      // student can add up by eye. The column exists either way, or the row's
      // last cell jumps left when one course has no figure.
      row.append(
        course.credits == null
          ? el("span", "planner-course-sp")
          : el("span", "planner-course-sp np-data", `${formatCreditNumber(course.credits)} sp`),
      );
    }

    if (onOpenSettings) {
      const open = el("button", "np-icon-btn planner-course-open");
      open.type = "button";
      open.dataset.code = course.code;
      open.setAttribute("aria-label", `Innstillinger for ${course.code} ${course.name}`);
      open.append(settingsIcon());
      open.addEventListener("click", () => onOpenSettings(course.code));
      row.append(open);
    }

    // WHERE THE REST OF THE QUESTION GOES (PRODUCT mandate 3). Its own line
    // under the name rather than more cells in the identity row: two links per
    // course is four things competing for the trailing edge at 390px, and these
    // two are about leaving rather than about the plan.
    const links = el("span", "planner-course-links");
    for (const link of courseLinks(course.code, course.name, options.year)) {
      const anchor = el("a", "planner-course-link", link.label);
      anchor.href = link.href;
      anchor.target = "_blank";
      // `noopener` is the load-bearing half; `noreferrer` follows it because
      // neither destination needs to know which page sent the student.
      anchor.rel = "noopener noreferrer";
      anchor.setAttribute("aria-label", link.ariaLabel);
      links.append(anchor);
    }
    nameCell.append(links);

    host.append(row);
  }
}
