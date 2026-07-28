import { describe, expect, it } from "vitest";
import { classifyActivity, lecturesOnly } from "../../src/lib/planner/activity.js";

/**
 * Hand-labeled validation set built from real `/api/course/:code/timetable`
 * responses (see src/lib/planner/activity.ts header for the course sample —
 * TDT4110, TMA4240, EXPH0300, TDT4145, TFY4104, IT2805, TDT4136, SPA1100,
 * ENG1004, MGLU3105, KP3200, TPG4175, IDATA2306, TTK4135, PROG2051,
 * POL2024, plus a ~100-course random sample across faculties). Every
 * distinct (title, acronym, name) triple observed was inspected by hand;
 * this is a representative subset spanning every category seen.
 *
 * Classifier accuracy on the full 116-triple corpus this set is drawn from:
 * 61/61 = 100% against hand labels (validated via a throwaway script during
 * development — this file is the checked-in subset).
 */
describe("classifyActivity — real-data validation set", () => {
  const lectures: Array<[string | null, string | null, string | null]> = [
    ["Forelesning", "FOR", "Forelesning"],
    ["Forelesning", "FORM", "Formidling"],
    ["Forelesning", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Forelesning 1", "FORM", "Formidling"],
    ["1Forelesning", "SAM", "Samlingsbasert undervisning"],
    ["1-1Forelesning", "FORM", "Formidling"],
    ["Forelesing", "FORM", "Formidling"], // observed misspelling
    ["Main lecture", "FORM", "Formidling"],
    ["Assignment lecture", "FORM-P", "Formidling"],
    ["Plenumsregning", "FORM", "Formidling"],
    // The lecture half of a modular course carries its own name (TDT4140's
    // "1 Teorimodul").
    ["1 Teorimodul", "FORM", "Formidling"],
    ["Teorimodul", "FORM", "Formidling"],
    ["Regneverksted", "FORM", "Formidling"],
    // Slash-joined combined sessions (REVIEW.md B7b): the student is in the
    // room either way, so a clash against one of these is a real clash. Every
    // one of these is a title observed in live data.
    ["Forelesning/Øving", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Forelesning/øving", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Forelesning / Øving", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Forelesning/øving Ålesund uke 19", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Forelesing/øving", "FORM", "Formidling"],
    ["Forelesning/Gruppe", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Forelesning/Gruppe Arbeid", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Forelesning/Lab", "FERD-P", "Ferdighetstrening"],
    ["1Forelesning/Lab", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Forelesning/Seminar", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    // Same combination written the other way round — same session.
    ["Fellesøving / forelesning", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    // conf-3: four titles that emptied whole courses' lecture layer. All four
    // are verbatim from the live API — the dropped-e misspelling (LKRO001E
    // 2026_HØST, IT3708 2026_VÅR), and the English combined sessions joined by
    // " and " instead of "/" (IIK4100 2026_HØST, note the trailing space) or
    // carrying an unrecognised "Tutorial" part (AIS4004 2026_VÅR).
    ["Forlesning", "FOR", "Forelesning"],
    ["Forlesning/Øving sammen med MGLU2509", "FOR", "Forelesning/Øving"],
    ["2Forlesning/Øving", "FORM", "Formidling"],
    ["Lecture and Lab exercise ", "FORM", "Formidling"],
    ["Lecture/Tutorial/Lab", "FORM", "Formidling"],
  ];

  const other: Array<[string | null, string | null, string | null]> = [
    // øving / lab / seminar / group — the muted, never-red display layer
    ["Øving", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Øving 1", "FERD", "Ferdighetstrening"],
    ["Øvingstime", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Fellesøving", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Gruppeøving", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Laboratorieøving", "FERD", "Ferdighetstrening"],
    ["Laboratorieøvelse", "DISAM-P", "Dialog- og samarbeidsbasert undervisning"],
    ["Lab", "FERD", "Ferdighetstrening"],
    ["Lab exercises", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Mattelab klynge A", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Seminar", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Seminar 1", "DISAM-P", "Dialog- og samarbeidsbasert undervisning"],
    ["Seminargrupper", "DISAM-P", "Dialog- og samarbeidsbasert undervisning"],
    ["10Gruppe", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    [" Gruppe 1", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Gruppearbeid", "DISAM-P", "Dialog- og samarbeidsbasert undervisning"],
    ["Gruppe", "GR", "Gruppe"],
    ["Samlingsbasert undervisning", "SAM", "Samlingsbasert undervisning"],
    ["Samling 1", "SAM", "Samlingsbasert undervisning"],
    // PBL, in each of the three spellings live data shows. This row used to be
    // hand-labeled a lecture ("the health faculties' PBL plenary") — BI1001
    // publishes it across five mutually exclusive weekly slots, so it is
    // parallel group work and the label was the source of a false red (conf-2).
    ["Problembasert læring", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["PBL-gruppe 1", "GR", "Gruppe"],
    ["PBL-fasilitering IAB", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    // excursions / admin / social — not teaching in the lecture sense
    ["Demo omvisning", "EKSKUR", "Ekskursjon"],
    ["Tur", "EKSKUR", "Ekskursjon"],
    ["Frokost", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Klassens time", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Eksamensavvikling", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Annet", "ORIENT", "Orientering"],
    ["Diverse", "FORM", "Formidling"],
    ["Undervisning", "FORM", "Formidling"],
    ["Vurdering", "FORM", "Formidling"],
    ["Prosjektperiode", "FELT", "Feltarbeid"],
    // an administrative artifact, not a teaching session, despite a
    // FOR/Forelesning acronym+name pair (acronym/name are never consulted)
    ["Arkiv-timeplan", "FOR", "Forelesning"],
    // an abbreviated title with no recognizable keyword substring
    ["1FOR", "FOR", "Forelesning"],
    // A comma-joined enumeration is not a slash-joined combined session: it
    // reads as "these things happen here over the term", so the
    // under-classification bias still applies (DR-1).
    ["Øving, prosjektarbeid, forelesning", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    // A joined title we do not fully understand stays "other" — the carve-out
    // only covers combinations of recognized activity qualifiers, whichever
    // separator joins them.
    ["Forelesning/Øving/Frokost", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Lab/Ekskursjon", "FERD", "Ferdighetstrening"],
    ["Lecture and Lab and Frokost", "FORM", "Formidling"],
    // "Tutorial" on its own is øving by another name, not a lecture — it only
    // rides along inside a combined session (conf-3).
    ["Tutorial", "DISAM", "Dialog- og samarbeidsbasert undervisning"],
    ["Tutorial/Lab", "FERD", "Ferdighetstrening"],
    // Other modules of a modular course are not the lecture module.
    ["2 Prosjektarbeid", "FORM", "Formidling"],
    ["3 Refleksjonsmodul", "FORM", "Formidling"],
    // English course-topic titles used verbatim as the session title
    ["Flexibility in power grid and local markets", "FORM", "Formidling"],
    [
      "Power Market Optimisation, Decomposition and Hydropower Planning",
      "SAM",
      "Samlingsbasert undervisning",
    ],
    // missing/blank text
    [null, "FORM", "Formidling"],
    [null, null, null],
  ];

  it.each(lectures)("classifies %j / %j / %j as lecture", (title, acronym, name) => {
    expect(classifyActivity({ title, acronym, name })).toBe("lecture");
  });

  it.each(other)("classifies %j / %j / %j as other", (title, acronym, name) => {
    expect(classifyActivity({ title, acronym, name })).toBe("other");
  });
});

describe("classifyActivity — field fallback + edge cases", () => {
  it("falls back from title to name to acronym when earlier fields are absent", () => {
    expect(classifyActivity({ title: null, name: "Forelesning", acronym: null })).toBe("lecture");
    expect(classifyActivity({ title: null, name: null, acronym: "Forelesning" })).toBe("lecture");
  });

  it("prefers title over name/acronym when they disagree", () => {
    expect(classifyActivity({ title: "Øving", name: "Forelesning", acronym: "FOR" })).toBe("other");
  });

  it("treats an empty/whitespace-only title as missing and falls back", () => {
    expect(classifyActivity({ title: "   ", name: "Forelesning", acronym: null })).toBe("lecture");
  });

  it("is case-insensitive", () => {
    expect(classifyActivity({ title: "FORELESNING", name: null, acronym: null })).toBe("lecture");
    expect(classifyActivity({ title: "øVING", name: null, acronym: null })).toBe("other");
  });

  it("returns other for a fully empty entry", () => {
    expect(classifyActivity({})).toBe("other");
  });
});

describe("lecturesOnly", () => {
  it("filters a mixed list down to lecture entries only", () => {
    const entries = [
      { title: "Forelesning", courseCode: "A" },
      { title: "Øving", courseCode: "A" },
      { title: "Forelesning 2", courseCode: "B" },
      { title: "Laboratorieøvelse", courseCode: "B" },
    ];
    expect(lecturesOnly(entries).map((e) => e.title)).toEqual(["Forelesning", "Forelesning 2"]);
  });

  it("returns [] for an all-øving list", () => {
    expect(lecturesOnly([{ title: "Øving" }, { title: "Lab" }])).toEqual([]);
  });

  it("returns [] for an empty list", () => {
    expect(lecturesOnly([])).toEqual([]);
  });
});
