import { describe, expect, it } from "vitest";
import {
  type CourseTimetableEntry,
  type CourseTimetableOptions,
  decodeEntry,
  entriesForSemester,
  narrowingChangesWeek,
  scopeNote,
  termLabel,
  termNote,
  weeksOf,
} from "../../src/components/site/courseTimetable.js";
import { entriesInSemester } from "../../src/lib/planner/schedule.js";

/** Høst 2026's real teaching weeks, from data/semesters.json. */
const AUTUMN_WEEKS = [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47];
const SPRING_WEEKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

const OPTIONS: CourseTimetableOptions = {
  code: "TDT4100",
  name: "Objektorientert programmering",
  version: "1",
  year: 2026,
  semester: { season: "AUTUMN", year: 2026, label: "Høst 2026", teachingWeeks: AUTUMN_WEEKS },
  signal: new AbortController().signal,
};

function entry(term: string | null, weeks: string[] = ["34-40"]): CourseTimetableEntry {
  return {
    courseCode: "TDT4100",
    courseName: { nob: null, nno: null, eng: null },
    dayNumber: 2,
    startTime: "12:15",
    endTime: "14:00",
    weeks,
    rooms: [],
    title: "Forelesning",
    name: null,
    term,
  };
}

describe("termLabel", () => {
  it("reads the upstream term key back as Norwegian copy", () => {
    expect(termLabel("2026_HØST")).toBe("Høst 2026");
    expect(termLabel("2026_VÅR")).toBe("Vår 2026");
    expect(termLabel("2026_SOMMER")).toBe("Sommer 2026");
  });

  it("passes an unrecognised key through rather than inventing a season", () => {
    expect(termLabel("2026_XX")).toBe("2026_XX");
    expect(termLabel("høsten")).toBe("høsten");
  });
});

describe("termNote (U14 — one view, honest about which season it is)", () => {
  it("names the season without a caveat when it is the planned one", () => {
    expect(termNote([entry("2026_HØST")], OPTIONS)).toBe("Viser Høst 2026.");
  });

  // The defect U14 describes: TDT4100's only entries are 2026_VÅR, already
  // elapsed, shown under a bare "2026" chip a student would plan around.
  it("says outright when the entries are not the planned semester", () => {
    expect(termNote([entry("2026_VÅR")], OPTIONS)).toBe(
      "Viser Vår 2026. Ikke undervist i Høst 2026.",
    );
  });

  it("lists every term the entries carry, deduped", () => {
    expect(termNote([entry("2026_VÅR"), entry("2026_HØST"), entry("2026_VÅR")], OPTIONS)).toBe(
      "Viser Høst 2026, Vår 2026.",
    );
  });

  it("claims only the fetched year when upstream sends no term key", () => {
    expect(termNote([entry(null)], OPTIONS)).toBe("Viser timeplanen for 2026.");
  });

  // C1: a course carried over from the previous catalog year is fetched for
  // that year, so the line has to name it rather than the canonical one.
  it("names last year's season for a course not offered this year", () => {
    expect(termNote([entry("2025_HØST")], { ...OPTIONS, year: 2025 })).toBe(
      "Viser Høst 2025. Ikke undervist i Høst 2026.",
    );
  });
});

// `?year=2026` answers with the whole catalog year — EXPH0300's 84
// entries are 51 spring + 33 autumn — and layout.ts clusters on time alone, so
// the union drew an Ålesund spring lecture beside a Trondheim autumn lecture as
// a simultaneous pair.
describe("entriesForSemester (one semester's week, not the year's)", () => {
  const spring = entry("2026_VÅR", ["3-13", "16"]);
  const autumn = entry("2026_HØST", ["34-45"]);

  it("drops the other term's sessions from the planned semester's week", () => {
    expect(entriesForSemester([spring, autumn], AUTUMN_WEEKS)).toEqual([autumn]);
    expect(entriesForSemester([spring, autumn], SPRING_WEEKS)).toEqual([spring]);
  });

  it("keeps every session of the planned semester", () => {
    const second = entry("2026_HØST", ["34-47"]);
    expect(entriesForSemester([spring, autumn, second], AUTUMN_WEEKS)).toEqual([autumn, second]);
  });

  // Not taught in the planned semester at all: the fallback is still ONE term,
  // so the week never mixes two, and termNote says which one it is.
  it("falls back to the newest term when nothing is taught in the planned weeks", () => {
    const shown = entriesForSemester([spring, autumn], [24, 25, 26]);
    expect(shown).toEqual([autumn]);
    expect(termNote(shown, OPTIONS)).toBe("Viser Høst 2026.");
  });

  // "VÅR" sorts after "HØST" as a string; the fallback is chronological.
  it("ranks HØST after VÅR within a year", () => {
    expect(entriesForSemester([autumn, spring], [24, 25, 26])).toEqual([autumn]);
  });

  it("keeps everything when upstream sends no term keys", () => {
    const untermed = [entry(null, ["3-13"]), entry(null, ["34-45"])];
    expect(entriesForSemester(untermed, [24, 25, 26])).toEqual(untermed);
  });
});

/**
 * Both surviving views filter their entries through `entriesInSemester`, and
 * this page cannot hand them the PLANNED semester's teaching weeks: the
 * fallback above deliberately draws the newest term when nothing intersects,
 * and that term's weeks are by definition not the planned semester's. Handing
 * over the planned weeks would filter the fallback straight back out and leave
 * an empty week where last term's honest timetable used to be.
 */
describe("weeksOf (the weeks the drawn entries actually carry)", () => {
  it("unions and sorts the drawn entries' own weeks", () => {
    const drawn = [entry("2026_HØST", ["34-36"]), entry("2026_HØST", ["41", "39"])];
    expect(weeksOf(drawn)).toEqual([34, 35, 36, 39, 41]);
  });

  it("survives the round trip that used to empty an off-term week", () => {
    // Autumn-only course, student planning spring: `entriesForSemester` has
    // already fallen back to autumn, and these weeks are what keeps it drawn.
    const spring = entry("2026_VÅR", ["3-13"]);
    const autumn = entry("2026_HØST", ["34-36"]);
    const shown = entriesForSemester([spring, autumn], SPRING_WEEKS.slice(0, 0).concat([24, 25]));
    expect(entriesInSemester(shown, weeksOf(shown))).toEqual(shown);
    expect(entriesInSemester(shown, SPRING_WEEKS)).toEqual([]);
  });

  it("is empty for no entries rather than undefined", () => {
    expect(weeksOf([])).toEqual([]);
  });
});

// the module fetches around data.ts, so the planner's entity decode
// never reached this surface — TMA4400's real block label rendered
// "Forelesning 1 MTELSYS &#38; MTTK" on /emne/TMA4400/.
describe("decodeEntry", () => {
  it("decodes the entities upstream ships in title and name", () => {
    const decoded = decodeEntry({
      ...entry("2026_HØST"),
      title: "Forelesning 1 MTELSYS &#38; MTTK",
      name: "Gruppe A &amp; B",
    });
    expect(decoded.title).toBe("Forelesning 1 MTELSYS & MTTK");
    expect(decoded.name).toBe("Gruppe A & B");
  });

  it("keeps an untouched entry's identity", () => {
    const plain = entry("2026_HØST");
    expect(decodeEntry(plain)).toBe(plain);
  });
});

describe("scopeNote — the week says what slice of the course it is drawing", () => {
  it("with no programme, says what it shows and where the answer lives", () => {
    expect(scopeNote({ programCode: null, inPlan: false, scope: "all" })).toBe(
      "Uka viser alle paralleller og grupper for emnet. Velg studieprogram i planleggeren for å se din egen undervisning.",
    );
  });

  it("with a programme but no plan entry, names the thing a plan would add", () => {
    expect(scopeNote({ programCode: "MTDT", inPlan: false, scope: "all" })).toBe(
      "Uka viser alle paralleller og grupper for emnet. Legg emnet i planen for å velge øvingsgruppe.",
    );
  });

  it("drops the nudge once the course is in the plan — it has been acted on", () => {
    expect(scopeNote({ programCode: "MTDT", inPlan: true, scope: "all" })).toBe(
      "Uka viser alle paralleller og grupper for emnet.",
    );
  });

  it("narrowed, it names the programme it narrowed to", () => {
    expect(scopeNote({ programCode: "MTDT", inPlan: true, scope: "mine" })).toBe(
      "Viser undervisningen for MTDT.",
    );
    expect(scopeNote({ programCode: "MTDT", inPlan: false, scope: "mine" })).toBe(
      "Viser undervisningen for MTDT. Legg emnet i planen for å velge øvingsgruppe.",
    );
  });
});

describe("narrowingChangesWeek — the guard on the switch", () => {
  /** A lecture entry carrying the programme cluster upstream partitions by. */
  const forProgram = (keys: string[] | undefined, title = "Forelesning"): CourseTimetableEntry => ({
    ...entry("2026_HØST"),
    title,
    studyProgramKeys: keys,
  });

  it("is false with no programme — there is nothing to narrow to", () => {
    expect(narrowingChangesWeek([forProgram(["MTDT"])], undefined, null)).toBe(false);
  });

  it("is false when no entry names a programme, so the control would do nothing", () => {
    // `entriesForProgram` is a no-op here, which is the majority of courses —
    // rendering the switch anyway is a control that visibly does nothing.
    const entries = [forProgram(undefined), forProgram(undefined)];
    expect(narrowingChangesWeek(entries, undefined, "MTDT")).toBe(false);
  });

  it("is true when the programme filter actually drops an entry", () => {
    const entries = [
      forProgram(["MTDT"], "Forelesning 1 MTDT"),
      forProgram(["MTFYMA"], "Forelesning 1 MTFYMA"),
    ];
    expect(narrowingChangesWeek(entries, undefined, "MTDT")).toBe(true);
  });

  it("is false for a programme none of the entries name — the filter never empties a week", () => {
    const entries = [forProgram(["MTFYMA"]), forProgram(["MTIOT"])];
    expect(narrowingChangesWeek(entries, undefined, "MTDT")).toBe(false);
  });
});
