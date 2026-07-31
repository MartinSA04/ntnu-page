/**
 * Group selection for multi-section courses: a course's parallel lecture
 * sections and its øving/lab groups, narrowed to the one set a student
 * attends.
 *
 * Lecture entries are NOT all alternatives. "Forelesning 1" Tuesday +
 * "Forelesning 2" Monday are complementary sessions; four
 * "Forelesning 1 <programmes>" are one session offered four times. So
 * narrowing runs per *session family* (`sessionFamily`) — only groups within
 * one family are mutually exclusive — and an unresolvable family is reported
 * as such (`LectureDefaults.resolved`) rather than guessed at.
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
 * Slug of an entry's group name: lowercase, æøå kept, other runs of
 * non-alphanumerics collapsed to `-`. Blank input gives `null` (ungrouped).
 *
 * MUST NEVER return a string containing `~` — store.ts's hash grammar uses it
 * as an unescaped delimiter (`code.version~group1~group2`). `~` is neither
 * a-z/0-9 nor æøå, so it always collapses to `-`.
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
 * The name a group is identified by: `title` first, then `name`. `title`
 * carries the distinguishing label ("Forelesningsparallell 2 Trondheim");
 * `name` is a coarse delivery-format bucket that can repeat across distinct
 * groups. Text arrives entity-decoded from data.ts — do not decode again.
 */
function rawGroupName(entry: Pick<TimetableEntry, "name" | "title">): string | null {
  return entry.title?.trim() || entry.name?.trim() || null;
}

/**
 * The group key an entry belongs to, or `null` if ungrouped. Exported so the
 * grid can ask "did the student pick THIS entry's group?" without
 * re-deriving the slug.
 */
export function entryGroupKey(entry: Pick<TimetableEntry, "name" | "title">): string | null {
  return groupKey(rawGroupName(entry));
}

/** Locale- and digit-aware, so "gruppe 2" sorts before "gruppe 10". */
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
 * Which weekly *session* a lecture group belongs to. Same family = mutually
 * exclusive alternatives; different families = complementary slots the
 * student attends all of, and narrowing those away deletes real teaching.
 *
 * The label is the tell:
 *  - "…parallell N" says "alternative" by name — one family per stem.
 *  - "<ord> N <qualifier>" is one session split by programme or campus, so
 *    the family is word + number ("Forelesning 1 …" ≠ "Forelesning 2 …").
 *  - anything else is its own family — fail-open, an unrecognized label keeps
 *    its teaching. Covers bare "Forelesning 1" and clock-time titles where
 *    the number is an hour, hence the single-digit guard.
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
   * Lecture group keys to draw before the student picks. `[]` means no
   * narrowing — every group the programme filter leaves is the student's own.
   */
  keys: string[];
  /**
   * `true` when `keys` is an answer. `false` when some session family had
   * alternatives we could not choose between — `keys` then holds a
   * provisional pick per family and the surface MUST invite the student to
   * pick ("velg din").
   */
  resolved: boolean;
  /** Every key in the unresolved families, provisional picks included. */
  alternatives: string[];
}

const NOTHING_TO_NARROW: LectureDefaults = { keys: [], resolved: true, alternatives: [] };

/**
 * The lecture parallel(s) to show before the student picks, plus an honest
 * signal about how we got there.
 *
 * One lecture group overall needs no narrowing. Otherwise the programme's own
 * section narrows first; if one group survives we are `resolved`. If several
 * do they split into session families: a one-member family is a session of
 * its own and is kept, a multi-member family draws its first label
 * provisionally and reports every member in `alternatives`.
 */
export function resolveLectureDefaults(
  entries: TimetableEntry[],
  programCode: string | null | undefined,
): LectureDefaults {
  if (distinctLectureKeys(entries).length <= 1) return NOTHING_TO_NARROW;

  const survivors = entriesForProgram(entries, programCode);
  const lectures = groupOptions(survivors).filter((o) => o.kind === "lecture");
  // The programme's own section answered it (or left no named lecture, which
  // `applyGroupSelection`'s programme filter handles).
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
  // Every family was a session of its own: nothing narrowed, nothing unresolved.
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
 * `selected` applies PER ACTIVITY KIND: ticking an øving group narrows the
 * øving/lab layer only, leaving the lecture layer on its default. A key
 * matching no entry of a kind is no selection for that kind, so a stale key
 * from an old hash degrades to the default instead of blanking the course.
 *
 * Within the lecture kind it narrows PER SESSION FAMILY: a pick answers the
 * session it names and no other, so picking "Forelesning 2 MTBYGG" leaves
 * "Forelesning 1 …" on its default. Alternatives inside one family still
 * replace each other.
 *
 * An explicit pick wins outright within its layer/family, beating the
 * programme filter. Without a pick, ungrouped entries always stay and grouped
 * ones narrow to the programme's own section (`entriesForProgram`) — an øving
 * group of another programme is dropped, or a service course floods every
 * programme's groups. Lectures additionally narrow to
 * `resolveLectureDefaults`.
 */
export function applyGroupSelection<T extends TimetableEntry>(
  entries: T[],
  selected: string[] | undefined,
  programCode: string | null | undefined,
): T[] {
  // Which kind each key belongs to and, for lectures, its session family.
  // Read off ALL entries, not the programme's own: an explicit pick may name
  // another programme's section that `entriesForProgram` would have dropped.
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
    // A pick applies only to its own session; other sessions fall through to
    // the default rule below and keep their teaching.
    if (isLecture && pickedFamilies.has(familyOf(key))) return pickedLectures.includes(key);
    if (!isLecture && pickedOthers.length > 0) return pickedOthers.includes(key);
    // No pick applies here — default rule. Any grouped entry belonging to
    // another programme's section is dropped. `entriesForProgram` is a no-op
    // when the course names no programme, so ordinary courses show all groups.
    if (!inProgramme.has(entry)) return false;
    if (!isLecture) return true;
    return defaults.length === 0 || defaults.includes(key);
  });
}
