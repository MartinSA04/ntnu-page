/**
 * Plan-aware clash preview for the catalog surfaces (PRODUCT.md §6 — "the
 * verb, everywhere"; REVIEW U11). `/emne/[code]/` and `/emner/` both have to
 * answer *does this fit my week* **before** the student commits, so both run
 * the candidate course and the plan through the same engine `/planlegger/`
 * uses (`lib/planner/conflicts.ts`) rather than growing a second one.
 *
 * Lecture×lecture only, per DR-1: an øving overlap is not a hard conflict,
 * and a false red is the one failure mode DR-1 exists to prevent. Entries are
 * clamped to the semester's own teaching weeks first, so a spring-only course
 * never "collides" with an autumn plan.
 */
import { lecturesOnly } from "../../lib/planner/activity.js";
import { findConflicts } from "../../lib/planner/conflicts.js";
import { fetchCourseBundle, type TimetableEntry } from "../../lib/planner/data.js";
import { entriesForProgram, entriesInSemester, semesterYear } from "../../lib/planner/schedule.js";
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
  | { kind: "empty" }
  | { kind: "off-semester" }
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

/**
 * One course's lecture entries inside the semester's teaching weeks, or
 * `null` when its timetable could not be fetched (unknown ≠ empty). `known`
 * lets a caller that already fetched the timetable skip the round trip; pass
 * `[]` to assert "not taught here" without a fetch.
 */
async function semesterLectures(
  code: string,
  version: string,
  year: number,
  semester: ClashSemester,
  known?: TimetableEntry[] | null,
): Promise<TimetableEntry[] | null> {
  let entries = known;
  if (entries === undefined) {
    const bundle = await fetchCourseBundle(code, year, version);
    entries = bundle.timetable;
  }
  if (!entries) return null;
  return lecturesOnly(entriesInSemester(entries, semester.teachingWeeks));
}

function bySlot(a: ClashPartner, b: ClashPartner): number {
  return a.dayNumber - b.dayNumber || a.start - b.start || a.code.localeCompare(b.code);
}

/**
 * Diffs one course against the plan's other active courses for `semester`.
 * Never throws — an unreachable timetable is reported as `error`, which the
 * caller renders as a gap rather than as "no collision" (DR-6's honest gap).
 *
 * `programCode` (the plan's programme, when it has one) narrows BOTH the
 * candidate's own entries and every partner course's entries through
 * `entriesForProgram` before either side is diffed — the same section-aware
 * filter the grid (`groups.ts`/`grid.ts`) already applies. Without it, a
 * multi-section service course's parallel for an *unrelated* programme
 * (e.g. TMA4400's MTGEORT stream) could still red a collision against a
 * plan's own MTDT sections that never actually overlap — the false positive
 * study S7 documented, where this preview disagreed with the planner grid.
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
  if (others.length === 0) return { kind: "empty" };

  try {
    const own = await semesterLectures(course.code, course.version, year, semester, ownEntries);
    if (own === null) return { kind: "error" };
    if (own.length === 0) return { kind: "off-semester" };
    const ownForProgram = entriesForProgram(own, programCode);

    const otherLists = await Promise.all(
      others.map(async (c) => {
        const list = await semesterLectures(c.code, c.version, year, semester);
        return list === null ? null : entriesForProgram(list, programCode);
      }),
    );
    const otherEntries = otherLists.flatMap((list) => list ?? []);
    if (otherEntries.length === 0) return { kind: "clear" };

    // findConflicts sees the whole set, so drop pairs that are between two
    // *other* plan courses — those are the planner's business, not this
    // course's verdict.
    const partners = new Map<string, ClashPartner>();
    for (const conflict of findConflicts([...ownForProgram, ...otherEntries])) {
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
    case "empty":
      return `Ingen andre emner i planen din for ${term}.`;
    case "off-semester":
      return `Undervises ikke i ${term} — ingen kollisjon å sjekke.`;
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
 * The same verdict as a node. `.np-note-clash` is a *sentence* class (D1), so
 * the figures it quotes — course code, day, time — carry `.np-data` rather
 * than the whole line being set in the mono.
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
