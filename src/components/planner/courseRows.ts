/**
 * EMNER — the plan's course list and the load track over it, for both surfaces
 * that show a plan.
 *
 * `/planlegger/` and `/user/<navn>` draw the same list. They differ in exactly
 * one thing, and it is the thing that separates the two pages: the planner's
 * rows carry a way into the editor, and the shared plan's carry a way into the
 * course. Everything else — the swatch, the code, the name, the credit column,
 * the dropped state, the "se detaljer" flag — is one implementation, because
 * two implementations is how a change lands on one page and not the other.
 *
 * A row is IDENTITY AND NOTHING ELSE. Vurderingsform lives in the exam list;
 * the status line, the retry and the Dropp/Fjern button live in the settings
 * modal the row opens. That rule is what keeps this renderable read-only at
 * all: with nothing on the row that acts, taking the action off leaves a row
 * that still says everything it said.
 */

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
  /**
   * The way into the editor, as a settings button at the row's end.
   *
   * Absent on a read-only surface, and then the row's name becomes a link to
   * the course's own page instead — the one place `/user/<navn>` can honestly
   * send a viewer, since it cannot edit the plan it is showing.
   */
  onOpenSettings?: ((code: string) => void) | null;
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
    // A LINK ONLY WHERE THERE IS NOWHERE ELSE TO GO. The planner's row opens
    // the settings modal from its own button and the title stays inert; the
    // shared plan has no editor, so the name is the way into the course.
    //
    // NOT `.np-navlink`: that primitive is `inline-flex`, and a flex container
    // drops the text node holding the space between the code and the name
    // ("TDT4102Prosedyre- og …"). Its own class keeps this an inline run of
    // text, which is what a title inside a row is.
    const title = el(onOpenSettings ? "span" : "a", "planner-course-title");
    title.append(el("b", "planner-course-code np-data", course.code));
    title.append(` ${course.name}`);
    if (!onOpenSettings) {
      const link = title as HTMLAnchorElement;
      link.href = `/emne/${encodeURIComponent(course.code)}/`;
      link.classList.add("planner-course-link");
    }
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

    host.append(row);
  }
}

/** One counted course in the load track. */
export interface LoadSegment {
  code: string;
  hueVar: string;
  credits: number;
}

/**
 * THE LOAD, DRAWN: a full semester as a track, each counted course a segment in
 * its own printed hue, its width its own credits. It does for credits what the
 * exam band does for the exam period, so a colour means one thing in three
 * places.
 *
 * The caller decides what counts — DR-10's off-semester exclusion is a fact
 * about a plan and its programme, not about a track — and hands over only the
 * courses that do. A 0 sp course cannot be drawn in a strip about credits: it
 * is real and it is in the list, it is not a load.
 */
export function renderLoadTrack(host: HTMLElement, segments: LoadSegment[], full: number): void {
  // Emptied, never hidden: `[hidden]` takes the track's 15px out of the flow
  // and every row under it moves when the first segment is drawn.
  host.replaceChildren();
  if (segments.length === 0) return;

  const track = el("div", "planner-load-track");
  let total = 0;
  for (const segment of segments) {
    total += segment.credits;
    const seg = el("span", "planner-load-seg");
    seg.style.flexGrow = String(segment.credits);
    seg.style.setProperty("--dot", `var(${segment.hueVar})`);
    seg.title = `${segment.code}, ${formatCreditNumber(segment.credits)} sp`;
    track.append(seg);
  }
  // The gap to a full load is empty track, not a segment: it is the absence of
  // a course and must not read as one.
  if (total < full) {
    const rest = el("span", "planner-load-rest");
    rest.style.flexGrow = String(full - total);
    track.append(rest);
  }
  // Over a full load the track no longer says where full IS: the segments fill
  // it edge to edge whether the plan is 30 sp or 45. The mark is where a full
  // load lands, so the overload is a length you can see rather than a number
  // you have to subtract.
  if (total > full) {
    const mark = el("span", "planner-load-mark");
    mark.style.insetInlineStart = `${(full / total) * 100}%`;
    mark.title = `${full} sp`;
    track.append(mark);
  }
  host.append(track);
}
