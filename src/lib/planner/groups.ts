/**
 * Group-selection engine for multi-section courses (Task 3; grid rewrite +
 * popover consume this). Big service courses publish several parallel
 * sections under the same course code — lecture parallels split by
 * programme cluster ("Forelesningsparallell 2"), øving/lab groups split by
 * student ("Øvingsgruppe 5") — and the student needs exactly one lecture
 * parallel plus whichever øving group they were assigned, not every section
 * overlaid on top of each other.
 *
 * `defaultLectureKeys` picks the programme's own lecture parallel so the
 * grid opens on a sane default; øving/lab ("other") entries are never
 * defaulted away — the grid's own "vis øvinger og labber" toggle governs
 * their visibility, this module only ever narrows *which* group of them is
 * shown once the student picks one via `applyGroupSelection`.
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
 */
function rawGroupName(entry: Pick<TimetableEntry, "name" | "title">): string | null {
  return entry.title?.trim() || entry.name?.trim() || null;
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

/** True when every option's label ends in a number — "Forelesningsparallell 2", not e.g. "Ekstraforelesning". */
function looksLikeNumberedParallels(options: GroupOption[]): boolean {
  return options.length > 1 && options.every((o) => /\d+\s*$/.test(o.label));
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
    return a.label.localeCompare(b.label);
  });
}

/**
 * The lecture parallel(s) the grid should show before the student picks one.
 * A course with only one lecture group overall (or none — ungrouped
 * lectures) needs no default narrowing: `[]`. Otherwise, if the programme's
 * own section (`entriesForProgram`) narrows it to exactly one, that one key
 * is the default; if it's still ambiguous (several survive, or there's no
 * programme to narrow by) and the survivors look like numbered parallels,
 * the first by label wins. An ambiguous, non-numbered set is left
 * unresolved (`[]`) rather than guessing.
 */
export function defaultLectureKeys(
  entries: TimetableEntry[],
  programCode: string | null | undefined,
): string[] {
  if (distinctLectureKeys(entries).length <= 1) return [];

  const survivors = entriesForProgram(entries, programCode);
  const survivorKeys = distinctLectureKeys(survivors);
  if (survivorKeys.length === 1) return survivorKeys;

  const candidates = groupOptions(survivors).filter(
    (o) => o.kind === "lecture" && survivorKeys.includes(o.key),
  );
  if (!looksLikeNumberedParallels(candidates)) return [];
  const [first] = [...candidates].sort((a, b) => a.label.localeCompare(b.label));
  return first ? [first.key] : [];
}

/**
 * Filters a course's entries down to the groups relevant to show. An
 * explicit non-empty `selected` wins outright — every entry whose key is in
 * it, plus every ungrouped entry, regardless of programme (the student's pick
 * beats the programme filter, so a cross-programme parallel/øving they chose
 * still draws). With no selection, ungrouped entries always stay, and any
 * *grouped* entry is first narrowed to the programme's own section
 * (`entriesForProgram`): a non-lecture (øving/lab) group of the programme's own
 * stays "all groups" until the student picks (the grid's showOthers toggle
 * governs whether it's even visible), while a non-lecture group tagged for
 * ANOTHER programme is dropped — a multi-programme service course must not
 * flood every programme's øving groups (the EXPH0300 flood). Lecture entries
 * additionally narrow to `defaultLectureKeys` (the programme's own parallel).
 */
export function applyGroupSelection<T extends TimetableEntry>(
  entries: T[],
  selected: string[] | undefined,
  programCode: string | null | undefined,
): T[] {
  if (selected && selected.length > 0) {
    const set = new Set(selected);
    return entries.filter((entry) => {
      const key = groupKey(rawGroupName(entry));
      return key === null || set.has(key);
    });
  }

  const keys = defaultLectureKeys(entries, programCode);
  const inProgramme = new Set(entriesForProgram(entries, programCode));
  return entries.filter((entry) => {
    const key = groupKey(rawGroupName(entry));
    if (key === null) return true;
    // Any grouped entry — lecture OR øving/lab — belonging to another
    // programme's section is dropped by default. `entriesForProgram` is a
    // no-op when the course doesn't name the programme (or none is set), so an
    // ordinary course still shows all its groups.
    if (!inProgramme.has(entry)) return false;
    if (classifyActivity(entry) !== "lecture") return true;
    return keys.length === 0 || keys.includes(key);
  });
}
