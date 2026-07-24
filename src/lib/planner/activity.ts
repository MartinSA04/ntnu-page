/**
 * Lecture/øving activity classifier (PRODUCT.md DR-1, ROADMAP Phase §0).
 *
 * `TimetableEntry`/`ScheduleActivity` carry no `activityCode` or other
 * structured "this is a lecture" field (see conflicts.ts header) — the only
 * signal is free-text `title`/`name`/`acronym`. Built from real data: curled
 * `/api/course/:code/timetable` for ~30 varied courses (TDT4110, TMA4240,
 * EXPH0300, TDT4145, TFY4104, IT2805, TDT4136, SPA1100, ENG1004, MGLU3105,
 * KP3200, TPG4175, IDATA2306, TTK4135, PROG2051, POL2024, and a random
 * 100+-course sample across faculties) and hand-inspecting every distinct
 * (title, acronym, name) triple that came back.
 *
 * The critical finding: `acronym`/`name` (e.g. "FORM"/"Formidling",
 * "DISAM"/"Dialog- og samarbeidsbasert undervisning", "FERD"/
 * "Ferdighetstrening", "SAM"/"Samlingsbasert undervisning") is a *delivery
 * format* bucket, not a lecture signal — the exact same acronym/name pair
 * shows up on lectures, øvinger, seminars, labs and even "Frokost" and
 * "Eksamensavvikling". `title` is the only field that mentions the activity
 * kind, and it is unstructured (mixed language, campus suffixes, numbers
 * glued onto words like "1Forelesning", combined sessions like
 * "Forelesning/Øving", stray whitespace, misspellings like "Forelesing").
 *
 * DR-1's asymmetry: misclassifying an øving as a lecture creates a *false
 * red* (a collision the student doesn't actually have — confidently wrong,
 * the thing DR-1 exists to prevent); misclassifying a lecture as "other"
 * only *hides* a real collision behind the "vis øvinger og labber" toggle
 * (silently degraded, not confidently wrong, and the toggle layer still
 * shows the entry as a muted block). So the classifier is deliberately
 * asymmetric: `"lecture"` requires an unambiguous lecture keyword and *no*
 * competing øving/lab/seminar keyword in the same title; every other case —
 * including combined "Forelesning/Øving"-style titles, unrecognized
 * strings, and empty titles — falls back to `"other"`.
 */

/** Structural subset of `TimetableEntry`/`ScheduleActivity` this classifier reads. */
export interface ActivityLike {
  title?: string | null;
  name?: string | null;
  acronym?: string | null;
}

export type ActivityKind = "lecture" | "other";

/**
 * Keywords that unambiguously mark a *lecture*, matched case-insensitively
 * as whole words (so "Forelesningsparallell 3" and "1Forelesning" both hit,
 * but a course code that happened to contain "for" would not).
 */
const LECTURE_KEYWORDS = [
  /forelesning(?:sparallell)?/i, // "Forelesning", "1Forelesning", "Forelesningsparallell 3"
  /forelesing/i, // observed misspelling (KP3200-style courses)
  /\blecture\b/i, // "Main lecture", "Assignment lecture"
  /\bplenum/i, // "Plenumsregning" — whole-class lecture-style session
];

/**
 * Keywords that mark a *non-lecture* teaching activity. Any hit here — even
 * alongside a lecture keyword (combined sessions like "Forelesning/Øving",
 * "Fellesøving / forelesning", "Forelesning/Lab") — keeps the entry out of
 * `"lecture"`, per the asymmetric-risk tradeoff above.
 */
const NON_LECTURE_KEYWORDS = [
  /øving/i, // "Øving", "Øvingstime", "Fellesøving", "Gruppeøving", "Laboratorieøving"
  /\blab\b|laboratorie/i, // "Lab", "Lab exercises", "Laboratorieøvelse", "Mattelab"
  /seminar/i, // "Seminar 1", "Seminargrupper"
  /\bgruppe/i, // "Gruppe", "Gruppearbeid", "10Gruppe", "Gruppeøving"
  /kollokvie/i,
  /\bekskursjon|\btur\b|omvisning/i, // field trips
  /samling/i, // "Samlingsbasert undervisning", "Samling 1" — block-taught, not a lecture slot
  /øvelse/i,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Classify one timetable/schedule entry as `"lecture"` or `"other"`.
 * `"lecture"` only when `title` (falling back to `name`, then `acronym`)
 * contains a lecture keyword and no competing non-lecture keyword. Missing/
 * blank text classifies as `"other"` (the safe default — see module docs).
 */
export function classifyActivity(entry: ActivityLike): ActivityKind {
  const text = entry.title?.trim() || entry.name?.trim() || entry.acronym?.trim() || "";
  if (text === "") return "other";
  if (matchesAny(NON_LECTURE_KEYWORDS, text)) return "other";
  if (matchesAny(LECTURE_KEYWORDS, text)) return "lecture";
  return "other";
}

/** Filters `entries` down to the ones `classifyActivity` calls `"lecture"`. */
export function lecturesOnly<T extends ActivityLike>(entries: T[]): T[] {
  return entries.filter((e) => classifyActivity(e) === "lecture");
}
