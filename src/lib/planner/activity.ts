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
 * competing øving/lab/seminar keyword in the same title; unrecognized
 * strings and empty titles fall back to `"other"`.
 *
 * The one carve-out (REVIEW.md B7b) is the *slash-joined* combined session —
 * "Forelesning/Øving", "Forelesning / Øving", "Forelesning/Lab",
 * "Forelesing/øving", "Fellesøving / forelesning". The under-classification
 * bias cost more than it bought there: whole faculties schedule every one of
 * their slots that way, so their default week came out empty. And the
 * tradeoff does not actually apply — the slash means *one* session that is
 * partly lecture, the student is in the room either way, so a clash against
 * it is a real clash, not a false red. The carve-out is deliberately narrow:
 * every slash-separated part must itself be a recognized lecture or
 * non-lecture qualifier ("Forelesning/Øving/Frokost" stays "other"), and
 * comma-joined enumerations ("Øving, prosjektarbeid, forelesning") are left
 * alone — those read as "these things happen here over the term", not as one
 * session.
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
  /teorimodul/i, // TDT4140's "1 Teorimodul" — the lecture half of a modular course
  /problembasert\s+l(?:æ|ae)ring/i, // PBL plenary, medicine/health faculties
  /regneverksted/i, // whole-class worked-example session, taught from the front
];

/**
 * Keywords that mark a *non-lecture* teaching activity. A hit here keeps the
 * entry out of `"lecture"` per the asymmetric-risk tradeoff above — unless
 * the whole title is a slash-joined combined session (see
 * `isSlashCombinedLecture`).
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
 * True for a title that is nothing but slash-joined activity qualifiers, at
 * least one of which is a plain lecture — "Forelesning/Øving",
 * "Forelesning / Øving", "1Forelesning/Lab", "Fellesøving / forelesning",
 * "Forelesning/øving Ålesund uke 19".
 *
 * The `every` guard is what keeps this narrow: a part that is neither a
 * lecture nor a recognized non-lecture qualifier ("Forelesning/Øving/Frokost")
 * means we do not understand the title, and not understanding it sends us
 * back to the safe `"other"` verdict.
 */
function isSlashCombinedLecture(text: string): boolean {
  if (!text.includes("/")) return false;
  const parts = text
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.length < 2) return false;
  const hasPlainLecturePart = parts.some(
    (part) => matchesAny(LECTURE_KEYWORDS, part) && !matchesAny(NON_LECTURE_KEYWORDS, part),
  );
  if (!hasPlainLecturePart) return false;
  return parts.every(
    (part) => matchesAny(LECTURE_KEYWORDS, part) || matchesAny(NON_LECTURE_KEYWORDS, part),
  );
}

/**
 * Classify one timetable/schedule entry as `"lecture"` or `"other"`.
 * `"lecture"` when `title` (falling back to `name`, then `acronym`) contains
 * a lecture keyword and either no competing non-lecture keyword at all, or
 * only ones that sit on the other side of a slash (a combined session the
 * student attends either way). Missing/blank text classifies as `"other"`
 * (the safe default — see module docs).
 */
export function classifyActivity(entry: ActivityLike): ActivityKind {
  const text = entry.title?.trim() || entry.name?.trim() || entry.acronym?.trim() || "";
  if (text === "") return "other";
  if (matchesAny(NON_LECTURE_KEYWORDS, text)) {
    return isSlashCombinedLecture(text) ? "lecture" : "other";
  }
  if (matchesAny(LECTURE_KEYWORDS, text)) return "lecture";
  return "other";
}

/** Filters `entries` down to the ones `classifyActivity` calls `"lecture"`. */
export function lecturesOnly<T extends ActivityLike>(entries: T[]): T[] {
  return entries.filter((e) => classifyActivity(e) === "lecture");
}
