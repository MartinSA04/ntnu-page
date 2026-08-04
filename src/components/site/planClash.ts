/**
 * Plan-aware clash preview for the course page (PRODUCT.md §9). `/emne/[code]/`
 * answers *does this fit my week* before the student commits, through the same
 * engine `/planlegger/` uses rather than a second one.
 *
 * **One caller, deliberately**: this used to run on `/emner/`'s rows and in the
 * add-course dialog. Both dropped it — searching is not the moment a plan is
 * judged, and a verdict per visible row is a timetable fetch per row per plan
 * course. Don't wire it back into a result list on consistency grounds.
 *
 * Lecture×lecture only, per DR-1: an øving overlap is not a hard conflict, and
 * a false red is the one failure mode DR-1 exists to prevent. Entries are
 * clamped to the semester's teaching weeks first.
 *
 * DR-1's under-classification bias makes "no lecture-classified entry" routine
 * (~30 % of taught courses), so it gets its own verdict: `off-semester` means
 * NO entries in these weeks, `unclassified` means entries we could not read a
 * kind from. Collapsing the two asserted "undervises ikke i Høst 2026" directly
 * above the course's own autumn grid.
 */
import { lecturesOnly } from "../../lib/planner/activity.js";
import { findConflicts } from "../../lib/planner/conflicts.js";
import { fetchCourseBundle, type TimetableEntry } from "../../lib/planner/data.js";
import { applyGroupSelection } from "../../lib/planner/groups.js";
import { entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
import { activeCourses, type PlanState } from "../../lib/planner/store.js";
import { dayName, el } from "../planner/dom.js";

/** The `semesters.json` fields a verdict is computed against. */
export interface ClashSemester {
  id: string;
  /** As stored: `"2026 Høst"`. Rendered as "Høst 2026" — see `semesterLabel`. */
  name: string;
  teachingWeeks: number[];
}

/** One course in the plan the candidate collides with, at one overlap slot. */
export interface ClashPartner {
  code: string;
  dayNumber: number;
  /** Overlap start, minutes since midnight. */
  start: number;
}

export type ClashVerdict =
  /**
   * No stored plan at all: this student has never used the planner. The line
   * under the CTA is the REASON to press it, not a report about a plan that
   * does not exist.
   */
  | { kind: "no-plan" }
  /** A plan exists for this semester and holds no other courses. */
  | { kind: "empty" }
  | { kind: "off-semester" }
  /** Taught this semester, but no entry classifies as a lecture — nothing to diff. */
  | { kind: "unclassified" }
  | { kind: "clear" }
  | { kind: "clash"; partners: ClashPartner[] }
  | { kind: "error" };

/** `"2026 Høst"` → `"Høst 2026"`; anything else is passed through verbatim. */
export function semesterLabel(name: string): string {
  const m = /^(\d{4})\s+(.+)$/.exec(name.trim());
  return m ? `${m[2]} ${m[1]}` : name;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** What one course contributes to a verdict; `null` = timetable unreachable. */
interface SemesterEntries {
  /** Everything taught inside the semester's teaching weeks. */
  inSemester: TimetableEntry[];
  /** The section-narrowed lecture subset — what a DR-1 collision is diffed on. */
  lectures: TimetableEntry[];
}

/**
 * One course's entries inside the semester's teaching weeks, or `null` when the
 * timetable could not be fetched (unknown ≠ empty). `known` lets a caller that
 * already fetched skip the round trip; `[]` asserts "not taught here".
 *
 * `inSemester` is measured *before* the group narrowing on purpose: "is this
 * taught here at all" must not depend on which parallel is selected.
 */
async function semesterEntries(
  course: { code: string; version: string; groups?: string[] },
  year: number,
  semester: ClashSemester,
  programCode: string | null | undefined,
  known?: TimetableEntry[] | null,
): Promise<SemesterEntries | null> {
  let entries = known;
  if (entries === undefined) {
    const bundle = await fetchCourseBundle(course.code, year, course.version);
    entries = bundle.timetable;
  }
  if (!entries) return null;
  const inSemester = entriesInSemester(entries, semester.teachingWeeks);
  return {
    inSemester,
    lectures: lecturesOnly(applyGroupSelection(inSemester, course.groups, programCode)),
  };
}

function bySlot(a: ClashPartner, b: ClashPartner): number {
  return a.dayNumber - b.dayNumber || a.start - b.start || a.code.localeCompare(b.code);
}

/**
 * Diffs one course against the plan's other active courses for `semester`.
 * Never throws — an unreachable timetable is `error`, which the caller renders
 * as a gap rather than as "no collision" (DR-6's honest gap).
 *
 * Both sides go through `applyGroupSelection` — the single call the grid makes
 * — so the preview and the week cannot disagree by construction. That carries
 * `entriesForProgram` *and* the lecture-parallel defaults; without the latter a
 * parallel the grid never draws reds a collision that does not exist, which is
 * the one failure mode DR-1 exists to prevent.
 */
export async function planClash(
  course: { code: string; version: string },
  plan: PlanState,
  semester: ClashSemester,
  ownEntries?: TimetableEntry[] | null,
  programCode?: string | null,
): Promise<ClashVerdict> {
  const year = semesterYear(semester.id);
  if (year === null) return { kind: "error" };

  const others = activeCourses(plan).filter((c) => c.code !== course.code);
  // The candidate's own group pick, when the plan already holds it — the grid
  // would draw it with exactly this selection.
  const ownGroups = plan.courses.find((c) => c.code === course.code)?.groups;

  try {
    const own = await semesterEntries(
      { ...course, groups: ownGroups },
      year,
      semester,
      programCode,
      ownEntries,
    );
    if (own === null) return { kind: "error" };
    // Off-semester is a fact about the COURSE, so it outranks the empty-plan
    // shortcut — a cold visitor's first add is who needs it most.
    if (own.inSemester.length === 0) return { kind: "off-semester" };
    if (others.length === 0) {
      // NO PLAN AT ALL is not an empty plan. This page is the largest
      // cold-traffic surface on the site, so the common reader of this line
      // arrived from a search engine and has never touched the planner —
      // "Ingen andre emner i planen din" told them about a plan they do not
      // have. The two states get two sentences.
      const untouched = plan.program === undefined && plan.courses.length === 0;
      return { kind: untouched ? "no-plan" : "empty" };
    }
    // Taught here, but nothing reads as a lecture: there is nothing to diff,
    // and saying so is the honest gap. Never "undervises ikke".
    if (own.lectures.length === 0) return { kind: "unclassified" };

    const otherLists = await Promise.all(
      others.map(async (c) => {
        const list = await semesterEntries(c, year, semester, programCode);
        return list === null ? null : list.lectures;
      }),
    );
    const otherEntries = otherLists.flatMap((list) => list ?? []);
    if (otherEntries.length === 0) return { kind: "clear" };

    // findConflicts sees the whole set, so drop pairs between two *other* plan
    // courses — those are the planner's business, not this course's verdict.
    const partners = new Map<string, ClashPartner>();
    for (const conflict of findConflicts([...own.lectures, ...otherEntries])) {
      const mineIsA = conflict.a.courseCode === course.code;
      const mineIsB = conflict.b.courseCode === course.code;
      if (!mineIsA && !mineIsB) continue;
      const other = mineIsA ? conflict.b : conflict.a;
      const key = `${other.courseCode}|${conflict.dayNumber}|${conflict.start}`;
      if (partners.has(key)) continue;
      partners.set(key, {
        code: other.courseCode,
        dayNumber: conflict.dayNumber,
        start: conflict.start,
      });
    }
    if (partners.size === 0) return { kind: "clear" };
    return { kind: "clash", partners: [...partners.values()].sort(bySlot) };
  } catch {
    return { kind: "error" };
  }
}

/** Plain-text verdict, for `title`/`aria-label` where markup is not available. */
export function clashSentence(verdict: ClashVerdict, semester: ClashSemester): string {
  const term = semesterLabel(semester.name);
  switch (verdict.kind) {
    case "no-plan":
      return "Du har ingen plan ennå. Legg til emnet, så er uka klar.";
    case "empty":
      return `Ingen andre emner i planen din for ${term}.`;
    case "off-semester":
      return `Undervises ikke i ${term}, ingen kollisjon å sjekke.`;
    case "unclassified":
      return `Kan ikke sjekke kollisjon i ${term}. Ingen aktiviteter er merket som forelesning.`;
    case "clear":
      return `Ingen kollisjon i planen din for ${term}.`;
    case "error":
      return "Klarte ikke å sjekke kollisjoner mot planen din.";
    case "clash": {
      const [first, ...rest] = verdict.partners;
      if (!first) return `Ingen kollisjon i planen din for ${term}.`;
      const head = `Kolliderer med ${first.code}, ${dayName(first.dayNumber)} ${minutesToTime(first.start)}`;
      return rest.length === 0 ? `${head}.` : `${head} og ${rest.length} til.`;
    }
  }
}

/**
 * The same verdict as a node. `.np-note-clash` is a *sentence* class, so the
 * figures it quotes carry `.np-data` rather than the whole line being mono.
 */
export function clashNode(verdict: ClashVerdict, semester: ClashSemester): HTMLElement {
  const term = semesterLabel(semester.name);
  if (verdict.kind !== "clash") {
    return el("p", "np-hint emne-clash", clashSentence(verdict, semester));
  }
  const [first, ...rest] = verdict.partners;
  const line = el("p", "np-note-clash emne-clash");
  if (!first) {
    line.textContent = `Ingen kollisjon i planen din for ${term}.`;
    return line;
  }
  line.append(document.createTextNode("Kolliderer med "));
  line.append(el("span", "np-data", first.code));
  line.append(document.createTextNode(", "));
  line.append(el("span", "np-data", dayName(first.dayNumber)));
  line.append(document.createTextNode(" "));
  line.append(el("span", "np-data", minutesToTime(first.start)));
  line.append(document.createTextNode(rest.length === 0 ? "." : ` og ${rest.length} til.`));
  return line;
}
