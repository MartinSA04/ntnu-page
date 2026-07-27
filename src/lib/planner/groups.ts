/**
 * Group-selection engine for multi-section courses (Task 3; grid rewrite +
 * popover consume this). Big service courses publish several parallel
 * sections under the same course code — lecture parallels split by
 * programme cluster ("Forelesningsparallell 2", "Forelesning 1 MTDT, MTIØT,
 * MTKOM"), øving/lab groups split by student ("Øvingsgruppe 5") — and the
 * student needs exactly one lecture parallel plus whichever øving group they
 * were assigned, not every section overlaid on top of each other.
 *
 * The hard part is that a course's lecture entries are NOT all alternatives.
 * IT2805 teaches "Forelesning 1" on Tuesday and "Forelesning 2" on Monday —
 * two complementary weekly sessions the student attends both of — while
 * TMA4400 publishes four "Forelesning 1 <programmes>" entries that are one
 * session offered four times. Treating the first shape as the second is how
 * real teaching went missing from the week (audit week-2/week-5), so the
 * narrowing runs per *session family* (`sessionFamily`): only groups inside
 * one family are mutually exclusive, and a family we cannot resolve is
 * reported as unresolved (`LectureDefaults.resolved`) rather than silently
 * guessed at.
 *
 * `resolveLectureDefaults`/`defaultLectureKeys` pick the programme's own
 * lecture parallel so the grid opens on a sane default; øving/lab ("other")
 * entries are never defaulted away — the grid's own "vis øvinger og labber"
 * toggle governs their visibility, this module only ever narrows *which*
 * group of them is shown once the student picks one via
 * `applyGroupSelection`.
 */

import type { ActivityKind } from "./activity.js";
import { classifyActivity } from "./activity.js";
import type { TimetableEntry } from "./data.js";
import { entriesForProgram } from "./schedule.js";

export interface GroupOption {
  key: string;
  label: string;
  kind: ActivityKind;
  entryCount: number;
}

/**
 * Slug of an entry's group name: lowercase, æøå kept (they survive the
 * hash's `encodeURIComponent`, see store.ts's `encodeField`), every other
 * run of non-alphanumerics collapsed to a single `-`. `null`/blank input
 * gives `null` (no group, i.e. an ungrouped stream).
 *
 * MUST NEVER return a string containing `~` — store.ts's hash grammar uses
 * `~` as an unescaped delimiter between a course token and its group keys
 * (`code.version~group1~group2`), so a key containing it would corrupt the
 * hash. Since `~` is neither a-z/0-9 nor æøå, it always falls into the
 * "collapse to -" branch below and can never survive into a key.
 */
export function groupKey(name: string | null | undefined): string | null {
  const trimmed = name?.trim() ?? "";
  if (trimmed === "") return null;
  const slug = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9æøå]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? null : slug;
}

/**
 * The name a group is identified/labeled by: `title`, falling back to
 * `name`. `title` carries the distinguishing activity label on real NTNU
 * data ("Forelesningsparallell 2 Trondheim", "Lab BDIGSEC") — `name` is a
 * coarse delivery-format bucket that can be identical across genuinely
 * distinct groups (see activity.ts's classifier docs). Matches the priority
 * `classifyActivity` (activity.ts) and the grid's block label (grid.ts)
 * already use.
 *
 * The text arrives already entity-decoded from data.ts's timetable mapping
 * (audit edit-7/groups-8) — do not decode again here, or a title that really
 * contains "&#38;" would be mangled and its key would drift from grid.ts's
 * label.
 */
function rawGroupName(entry: Pick<TimetableEntry, "name" | "title">): string | null {
  return entry.title?.trim() || entry.name?.trim() || null;
}

/**
 * The group key an entry belongs to, or `null` for an ungrouped stream. This
 * is the same derivation `applyGroupSelection` matches a selection against —
 * exported so the grid can ask "did the student pick THIS entry's group?"
 * without re-deriving the slug and drifting out of step with the filter.
 */
export function entryGroupKey(entry: Pick<TimetableEntry, "name" | "title">): string | null {
  return groupKey(rawGroupName(entry));
}

/**
 * Label order the way a student reads it: locale-aware and digit-aware, so
 * "Seminargruppe 2" sorts before "Seminargruppe 10" instead of after
 * "Seminargruppe 19" (audit groups-7/edit-6).
 */
function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, "nb", { numeric: true });
}

function distinctLectureKeys(entries: TimetableEntry[]): string[] {
  const keys = new Set<string>();
  for (const entry of entries) {
    if (classifyActivity(entry) !== "lecture") continue;
    const key = groupKey(rawGroupName(entry));
    if (key !== null) keys.add(key);
  }
  return [...keys];
}

/** A label's leading activity word, its session number and whatever follows it. */
const SESSION_LABEL = /^(.*?[^\s\d])\s*(\d+)\s*(.*)$/;

/**
 * Which weekly *session* a lecture group belongs to. Groups that share a
 * family are alternatives — the student attends exactly one. Groups in
 * different families are complementary slots the student attends all of, and
 * narrowing those away deletes real teaching from the week (week-2/week-5).
 *
 * The tell is in the label, checked against real 2026 data:
 *  - "…parallell N (Trondheim)" says "alternative" by name — TDT4110's three
 *    parallels, EXPH0300's five campus parallels. One family per stem.
 *  - "<ord> N <qualifier>" is one session split across programme clusters or
 *    campuses — TMA4400's four "Forelesning 1 <programmes>" and seven
 *    "Forelesning 2 <programmes>". Family is the word plus the number, so
 *    "Forelesning 1 …" and "Forelesning 2 …" stay two families.
 *  - anything else is its own family, which is the fail-open direction: an
 *    unrecognized label keeps its teaching in the week. That covers IT2805's
 *    bare "Forelesning 1"/"Forelesning 2" (nothing after the number, so the
 *    number names the session itself) and TMR4106's clock-time titles
 *    ("Forelesning morgen tirsdager kl. 08:15-10:00" — the number is an
 *    hour, not a session number, hence the single-digit guard).
 */
function sessionFamily(label: string): string {
  const trimmed = label.trim().toLowerCase();
  const match = SESSION_LABEL.exec(trimmed);
  if (!match) return trimmed;
  const word = match[1] ?? "";
  const number = match[2] ?? "";
  const rest = (match[3] ?? "").trim();
  if (word.endsWith("parallell")) return word;
  if (rest !== "" && /^[1-9]$/.test(number)) return `${word} ${number}`;
  return trimmed;
}

/** Distinct entry group names, sorted lecture-first then by label. Ungrouped (null-key) entries produce no option. */
export function groupOptions(entries: TimetableEntry[]): GroupOption[] {
  const byKey = new Map<string, GroupOption>();
  for (const entry of entries) {
    const raw = rawGroupName(entry);
    if (raw === null) continue;
    const key = groupKey(raw);
    if (key === null) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.entryCount += 1;
    } else {
      byKey.set(key, { key, label: raw, kind: classifyActivity(entry), entryCount: 1 });
    }
  }
  return [...byKey.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "lecture" ? -1 : 1;
    return compareLabels(a.label, b.label);
  });
}

/** What the grid should draw for a course's lecture layer, and how sure we are of it. */
export interface LectureDefaults {
  /**
   * The lecture group keys to draw before the student picks. `[]` means "no
   * narrowing at all" — every lecture group the programme filter leaves is
   * the student's own.
   */
  keys: string[];
  /**
   * `true` when `keys` is an answer: there was nothing to choose between, or
   * the programme's own section chose it. `false` when at least one session
   * family had several alternatives we could not choose between — `keys`
   * then holds a provisional pick per family and the surface MUST invite the
   * student to pick ("velg din"), not present it as theirs.
   */
  resolved: boolean;
  /**
   * Every key in the families we could not resolve, provisional picks
   * included. Empty when `resolved`.
   */
  alternatives: string[];
}

const NOTHING_TO_NARROW: LectureDefaults = { keys: [], resolved: true, alternatives: [] };

/**
 * The lecture parallel(s) the grid should show before the student picks one,
 * with the honest signal about how we got there (audit groups-5: the caller
 * must be able to tell "resolved to this" from "could not resolve").
 *
 * A course with one lecture group overall (or none — ungrouped lectures)
 * needs no narrowing. Otherwise the programme's own section
 * (`entriesForProgram`) narrows first; if that leaves one lecture group we
 * are done and `resolved`. If several survive they are split into session
 * families (`sessionFamily`): a family with one member is a session of its
 * own and always kept, a family with several members is an alternative set
 * where the first by label is drawn provisionally and every member is
 * reported in `alternatives` with `resolved: false`.
 */
export function resolveLectureDefaults(
  entries: TimetableEntry[],
  programCode: string | null | undefined,
): LectureDefaults {
  if (distinctLectureKeys(entries).length <= 1) return NOTHING_TO_NARROW;

  const survivors = entriesForProgram(entries, programCode);
  const lectures = groupOptions(survivors).filter((o) => o.kind === "lecture");
  // The programme's own section answered it (or left no named lecture at all,
  // which `applyGroupSelection`'s programme filter handles on its own).
  if (lectures.length <= 1) {
    return { keys: lectures.map((o) => o.key), resolved: true, alternatives: [] };
  }

  const families = new Map<string, GroupOption[]>();
  for (const option of lectures) {
    const family = sessionFamily(option.label);
    const members = families.get(family);
    if (members) members.push(option);
    else families.set(family, [option]);
  }

  const keys: string[] = [];
  const alternatives: string[] = [];
  for (const members of families.values()) {
    const [first, ...rest] = [...members].sort((a, b) => compareLabels(a.label, b.label));
    if (!first) continue;
    keys.push(first.key);
    if (rest.length > 0) alternatives.push(first.key, ...rest.map((o) => o.key));
  }
  // Every family was a session of its own: nothing is an alternative to
  // anything, so nothing is narrowed away and nothing is unresolved.
  if (alternatives.length === 0) return NOTHING_TO_NARROW;
  return { keys, resolved: false, alternatives };
}

/** `resolveLectureDefaults(...).keys` — the narrowing without the resolution signal. */
export function defaultLectureKeys(
  entries: TimetableEntry[],
  programCode: string | null | undefined,
): string[] {
  return resolveLectureDefaults(entries, programCode).keys;
}

/**
 * Filters a course's entries down to the groups relevant to show.
 *
 * `selected` is applied PER ACTIVITY KIND (audit groups-1): ticking an
 * øving group narrows the øving/lab layer only, and the lecture layer keeps
 * its default — a flat allow-list deleted every lecture of every course
 * whose lecture group the student had not also named, which is the common
 * case. A selected key matching no entry of a kind is likewise no selection
 * for that kind, so a stale key out of an old hash or an upstream retitling
 * degrades to the default instead of blanking the course (audit store-5).
 *
 * Inside the lecture kind it narrows PER SESSION FAMILY (audit groups-2), the
 * same grammar the default branch has always used: a pick answers the session
 * it names and no other, so on TMA4400 choosing "Forelesning 2 MTBYGG" swaps
 * that Thursday session and leaves "Forelesning 1 …" and "Plenumsregning" on
 * their defaults. Treating a lecture pick as an allow-list across every family
 * is how one tick deleted two thirds of a course's week — and it did so
 * silently on load for anyone holding an old share hash, which no picker
 * control can undo. Alternatives inside one family still replace each other
 * (TDT4110's three "Forelesningsparallell N" are one family), so a real
 * choice is still a choice.
 *
 * An explicit pick wins outright within its layer/family — the student's pick
 * beats the programme filter, so a cross-programme parallel/øving they chose
 * still draws. Where there is no pick, ungrouped entries always stay, and any
 * *grouped* entry is first narrowed to the programme's own section
 * (`entriesForProgram`): a non-lecture (øving/lab) group of the programme's own
 * stays "all groups" until the student picks (the grid's showOthers toggle
 * governs whether it's even visible), while a non-lecture group tagged for
 * ANOTHER programme is dropped — a multi-programme service course must not
 * flood every programme's øving groups (the EXPH0300 flood). Lecture entries
 * additionally narrow to `resolveLectureDefaults` (the programme's own
 * parallel, or one provisional pick per ambiguous session family).
 */
export function applyGroupSelection<T extends TimetableEntry>(
  entries: T[],
  selected: string[] | undefined,
  programCode: string | null | undefined,
): T[] {
  // Which kind each group key actually belongs to, and — for lectures — which
  // weekly session it is a variant of, from the data itself. A key naming no
  // entry belongs to neither kind and is ignored. Families are read off ALL
  // entries, not the programme's own, because an explicit pick may name another
  // programme's section, which `entriesForProgram` would have dropped.
  const lectureKeys = new Set<string>();
  const otherKeys = new Set<string>();
  const familyByKey = new Map<string, string>();
  for (const entry of entries) {
    const raw = rawGroupName(entry);
    const key = groupKey(raw);
    if (key === null || raw === null) continue;
    if (classifyActivity(entry) === "lecture") {
      lectureKeys.add(key);
      familyByKey.set(key, sessionFamily(raw));
    } else {
      otherKeys.add(key);
    }
  }
  const familyOf = (key: string): string => familyByKey.get(key) ?? key;
  const pickedLectures = (selected ?? []).filter((key) => lectureKeys.has(key));
  const pickedOthers = (selected ?? []).filter((key) => otherKeys.has(key));
  const pickedFamilies = new Set(pickedLectures.map(familyOf));

  const defaults = resolveLectureDefaults(entries, programCode).keys;
  const inProgramme = new Set(entriesForProgram(entries, programCode));
  return entries.filter((entry) => {
    const key = groupKey(rawGroupName(entry));
    if (key === null) return true;
    const isLecture = classifyActivity(entry) === "lecture";
    // The pick applies to the session it belongs to; a session nobody picked in
    // falls through to the default rule below and keeps its teaching (groups-2).
    if (isLecture && pickedFamilies.has(familyOf(key))) return pickedLectures.includes(key);
    if (!isLecture && pickedOthers.length > 0) return pickedOthers.includes(key);
    // No pick applies here — the default rule. Any grouped entry — lecture OR
    // øving/lab — belonging to another programme's section is dropped.
    // `entriesForProgram` is a no-op when the course doesn't name the programme
    // (or none is set), so an ordinary course still shows all its groups.
    if (!inProgramme.has(entry)) return false;
    if (!isLecture) return true;
    return defaults.length === 0 || defaults.includes(key);
  });
}
