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
 * **Qualified 2026-07-28 (bucket-as-title).** The rule above holds for a
 * bucket used as a `name` *alongside a real title* — that is the case it was
 * derived from, and `{title: "Øving", name: "Formidling"}` is still an øving.
 * It does not hold when the department published no finer title and the
 * bucket IS the title. TFY4220's 2026_HØST is entirely
 * `{title: "Formidling", name: "Formidling"}` (two weekly slots, one room —
 * the lectures) plus `{title: "Ferdighetstrening", ...}` (three slots, three
 * rooms — the øvinger); its spring term, published with real titles,
 * classifies fine. A full-catalog timetable sweep put numbers on it: **35% of
 * course-terms with teaching had zero lecture-classified rows**, and a bare
 * "Formidling" title co-occurs with a real "Forelesning" in the same
 * course-term only ~6% of the time. So when the title carries no more
 * information than the bucket, the bucket is the best evidence there is.
 *
 * `BUCKET_LECTURE_TITLE` is deliberately a **closed list**, not the more
 * general "when the title is opaque, fall back to the name bucket". That
 * general rule was built and scored against the same sweep: it rescued ~5
 * percentage points more, but changed 106 distinct titles instead of 15,
 * promoting programme names ("Bachelor i Paramedisin Gjøvik"), orientation
 * weeks and admin ("Annet", "Info/diverse") to lectures. Wrong side of DR-1.
 * The one place the name bucket IS consulted is "Samling N", where live data
 * spreads the same title across four different buckets and the bucket is the
 * only thing separating block-taught lectures from group work.
 *
 * What this does NOT fix: ~22% of course-terms still classify as entirely
 * lecture-less, and most of them genuinely are (Kunstakademiet's "allmøte" and
 * "atelierflyt/rydding", the conservatory's "Gehør gruppe 1"). No keyword list
 * reaches those. They are handled by *saying so* — see `grid.ts`'s
 * lecture-less margin note — not by guessing.
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
 * The one carve-out (REVIEW.md B7b) is the *joined* combined session —
 * "Forelesning/Øving", "Forelesning / Øving", "Forelesning/Lab",
 * "Forelesing/øving", "Fellesøving / forelesning", "Lecture/Tutorial/Lab",
 * "Lecture and Lab exercise". The under-classification bias cost more than it
 * bought there: whole faculties schedule every one of their slots that way,
 * so their default week came out empty. And the tradeoff does not actually
 * apply — the join means *one* session that is partly lecture, the student is
 * in the room either way, so a clash against it is a real clash, not a false
 * red. The carve-out is deliberately narrow: every part must itself be a
 * recognized lecture or non-lecture qualifier ("Forelesning/Øving/Frokost"
 * stays "other"), only "/", " and " and "&" join (comma-joined enumerations
 * like "Øving, prosjektarbeid, forelesning" are left alone — those read as
 * "these things happen here over the term", not as one session).
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
  /forlesning/i, // the other observed misspelling — dropped e (LKRO001E, IT3708)
  /\blectures?\b/i, // "Main lecture", "Assignment lecture", "Friday lectures"
  /\bplenum/i, // "Plenumsregning" — whole-class lecture-style session
  /teorimodul/i, // TDT4140's "1 Teorimodul" — the lecture half of a modular course
  /regneverksted/i, // whole-class worked-example session, taught from the front
];

/**
 * Keywords that mark a *non-lecture* teaching activity. A hit here keeps the
 * entry out of `"lecture"` per the asymmetric-risk tradeoff above — unless
 * the whole title is a joined combined session (see `isCombinedLecture`).
 */
const NON_LECTURE_KEYWORDS = [
  /øving/i, // "Øving", "Øvingstime", "Fellesøving", "Gruppeøving", "Laboratorieøving"
  /\blab\b|laboratorie/i, // "Lab", "Lab exercises", "Laboratorieøvelse", "Mattelab"
  /seminar/i, // "Seminar 1", "Seminargrupper"
  /tutorial/i, // English for øving — AIS4004's "Lecture/Tutorial/Lab"
  /\bgruppe/i, // "Gruppe", "Gruppearbeid", "10Gruppe", "Gruppeøving"
  /kollokvie/i,
  /\bekskursjon|\btur\b|omvisning/i, // field trips
  /samling/i, // "Samlingsbasert undervisning", "Samling 1" — block-taught, not a lecture slot
  /øvelse/i,
  // PBL is group work, not a plenary, whichever way a faculty spells it
  // (conf-2). BI1001's 2026_VÅR timetable publishes 29 rows titled exactly
  // "Problembasert læring" across FIVE mutually exclusive weekly slots (ma
  // 10:15 and 14:15, ti 10:15, on 12:15, to 12:15) — the repeated-identical-row
  // signature of parallel groups, not five plenaries anyone attends. MDT4030
  // spells the same activity "PBL-gruppe 1…16" and "PBL-fasilitering IAB".
  // Classifying it as a lecture produced a real false red: BI1001 + TKT4116
  // yielded 2 conflict groups, 0 once PBL is group work.
  /problembasert|\bpbl\b/i,
];

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * The four ways live data joins the parts of ONE combined session: a slash,
 * the English " and ", "&", and Norwegian " og ".
 *
 * " og " was deliberately excluded until the 2026-07-28 sweep, on the grounds
 * that it joins ordinary prose ("Dialog- og samarbeidsbasert undervisning")
 * far more often than two activities. That reasoning was sound but the
 * conclusion was not, because of *where* the split runs: `isCombinedLecture`
 * is only ever called from inside the non-lecture branch, i.e. only for text
 * that already contains an øving/lab/seminar keyword. Prose like "Dialog- og
 * samarbeidsbasert undervisning" never reaches it, and anything that does is
 * still held to the `every`-part guard below. Live data spells the combined
 * session this way ("Forelesning og øving", FOR and DISAM alike) and it was
 * costing those courses their whole lecture layer.
 */
const COMBINED_SEPARATOR = /\s*\/\s*|\s+and\s+|\s*&\s*|\s+og\s+/i;

/**
 * Titles that ARE the delivery-format bucket, matched whole (except
 * "Fellesundervisning", which live data glues cohorts onto —
 * "Fellesundervisning1B"). See the module header for why a bucket used as a
 * title is a lecture signal when the same word used as a `name` is not.
 */
const BUCKET_LECTURE_TITLE = /^(?:formidling|undervisning)$|^fellesundervisning/i;

/** "Samling", "Samling 1" — block teaching, but only per the name bucket. */
const SAMLING_TITLE = /^samling\s*\d*$/i;

/** The two `name` buckets that mean "this is a plenary". */
const LECTURE_NAME_BUCKET = /^(?:forelesning|formidling)$/i;

/**
 * True for a title that is nothing but joined activity qualifiers, at least
 * one of which is a plain lecture — "Forelesning/Øving", "Forelesning / Øving",
 * "1Forelesning/Lab", "Fellesøving / forelesning",
 * "Forelesning/øving Ålesund uke 19", "Lecture/Tutorial/Lab",
 * "Lecture and Lab exercise".
 *
 * The `every` guard is what keeps this narrow: a part that is neither a
 * lecture nor a recognized non-lecture qualifier ("Forelesning/Øving/Frokost")
 * means we do not understand the title, and not understanding it sends us
 * back to the safe `"other"` verdict.
 */
function isCombinedLecture(text: string): boolean {
  const parts = text
    .split(COMBINED_SEPARATOR)
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
 * only ones that sit on the other side of a combining separator (a combined
 * session the student attends either way). Missing/blank text classifies as
 * `"other"` (the safe default — see module docs).
 */
export function classifyActivity(entry: ActivityLike): ActivityKind {
  // Bucket-as-title runs FIRST and reads `title`/`name` as separate fields
  // rather than the resolved text below: the whole point is that the
  // department published nothing finer than the bucket, which is only
  // observable while the two fields are still distinguishable. "Samling" also
  // has to be decided here because `/samling/i` is itself a non-lecture
  // keyword and would otherwise swallow it.
  const rawTitle = entry.title?.trim() ?? "";
  if (rawTitle !== "") {
    if (BUCKET_LECTURE_TITLE.test(rawTitle)) return "lecture";
    if (SAMLING_TITLE.test(rawTitle) && LECTURE_NAME_BUCKET.test(entry.name?.trim() ?? "")) {
      return "lecture";
    }
  }

  const text = entry.title?.trim() || entry.name?.trim() || entry.acronym?.trim() || "";
  if (text === "") return "other";
  if (matchesAny(NON_LECTURE_KEYWORDS, text)) {
    return isCombinedLecture(text) ? "lecture" : "other";
  }
  if (matchesAny(LECTURE_KEYWORDS, text)) return "lecture";
  return "other";
}

/** Filters `entries` down to the ones `classifyActivity` calls `"lecture"`. */
export function lecturesOnly<T extends ActivityLike>(entries: T[]): T[] {
  return entries.filter((e) => classifyActivity(e) === "lecture");
}
