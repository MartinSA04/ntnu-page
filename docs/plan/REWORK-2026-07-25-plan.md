# Planner Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement docs/plan/REWORK-2026-07-25-design.md — studieinfo modal, semester-scoped state with group selection, calendar-engine week grid, exam date list, persistent nav, add-course modal, homepage-as-landing, /studier deletion.

**Architecture:** Pure logic lands first as unit-tested libs (`layout.ts`, `groups.ts`, `examSchedule.ts`, store rewrite, kull relevance), then components consume them (`grid.ts` rewrite, `popover.ts`, `examList.ts`, `studieinfo.ts`), then pages/chrome (`plannerApp.ts`, `Layout.astro`, homepage, deletions), then e2e + docs.

**Tech Stack:** TypeScript, Astro 6 islands (plain TS modules, no framework), vitest (pure logic only — NO jsdom harnesses), Playwright `.pw.ts` e2e via `npm run test:e2e`, Biome.

## Global Constraints

- All UI copy is Norwegian bokmål, du-form. Exact strings are given per task — use them verbatim.
- Every client `<script>` body wraps in `onPage((signal) => …)` from `src/lib/pageLifecycle.ts` (ClientRouter survival). Event listeners take `{ signal }`.
- Design-system primitives only: `.np-frame`, `.np-btn`, `.np-tag`, `.np-hint`, `.np-note`, `.np-toggle`, `.np-field`, `.np-kicker` (see `src/styles/primitives.css`). No new one-off button styles.
- DO NOT modify: `src/lib/planner/{conflicts,activity,schedule,hues}.ts`, `worker/**`, `crawler/**`. Conflict *detection* stays lecture-only (DR-1).
- Delete dead code outright — no deprecation shims, no legacy hash parsing, no redirects. Early dev; breaking stored state and old links is accepted.
- JSON serialized into inline `<script>` must escape `<` (see `planlegger/index.astro` frontmatter's existing pattern).
- Percent-encoding of hash fields is load-bearing (Ø/Å/Æ in direction codes) — keep `encodeField`/`decodeField` behavior.
- Verify per task: `npx vitest run <file>` for unit tasks; `npm run typecheck` and `npm run lint` before every commit. Commit directly to `main` (repo convention), message style matches `git log`, ending with the Claude Co-Authored-By line.
- The dev loop for visual checks: `npm run build && npx wrangler dev --port 8788` (a server may already be running on 8788 — reuse it, don't fight over the port; after a rebuild it serves the new dist).

---

### Task 1: `layout.ts` — day-column layout engine

**Files:**
- Create: `src/lib/planner/layout.ts`
- Test: `tests/planner/layout.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Task 7's grid rewrite):

```ts
export interface LayoutInput {
  id: string;
  start: number; // minutes since midnight
  end: number;   // exclusive
}
export interface LayoutSlot {
  id: string;
  col: number;      // 0-based visible column, < cols
  cols: number;     // total visible columns in this slot's cluster (1..MAX_COLUMNS)
  overflow: boolean; // true = not rendered as a block; listed behind the "+N til" chip
}
export const MAX_COLUMNS = 3;
export function layoutDay(items: LayoutInput[]): LayoutSlot[];
```

Algorithm: sort by `(start, end, id)`. A cluster is a maximal run where each item starts before the running `maxEnd` of the cluster (`item.start < clusterMaxEnd`); touching (`start === prevEnd`) starts a NEW cluster. Within a cluster, assign each item the lowest-indexed column whose last occupant has `end <= item.start`. `rawCols` = number of columns used. If `rawCols <= MAX_COLUMNS`: all visible, `cols = rawCols`. Else: `cols = MAX_COLUMNS`, items assigned column index `>= MAX_COLUMNS` get `overflow: true` (they don't occupy a visible column); visible items keep their column, `cols = MAX_COLUMNS`.

- [ ] **Step 1: Write the failing test** — `tests/planner/layout.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { layoutDay, MAX_COLUMNS } from "../../src/lib/planner/layout";

const slot = (r: ReturnType<typeof layoutDay>, id: string) => {
  const s = r.find((x) => x.id === id);
  if (!s) throw new Error(`missing ${id}`);
  return s;
};

describe("layoutDay", () => {
  test("disjoint items each get a full-width column", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 615, end: 720 },
    ]);
    expect(slot(r, "a")).toMatchObject({ col: 0, cols: 1, overflow: false });
    expect(slot(r, "b")).toMatchObject({ col: 0, cols: 1, overflow: false });
  });

  test("touching boundaries (end === next start) do NOT overlap", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 600, end: 720 },
    ]);
    expect(slot(r, "a").cols).toBe(1);
    expect(slot(r, "b").cols).toBe(1);
  });

  test("a simple pair splits into two columns", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 540, end: 660 },
    ]);
    expect(slot(r, "a")).toMatchObject({ col: 0, cols: 2 });
    expect(slot(r, "b")).toMatchObject({ col: 1, cols: 2 });
  });

  test("a chain A-B-C where A and C don't overlap reuses column 0", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 540, end: 660 },
      { id: "c", start: 600, end: 720 },
    ]);
    expect(slot(r, "a").col).toBe(0);
    expect(slot(r, "b").col).toBe(1);
    expect(slot(r, "c").col).toBe(0); // reuses a's column
    for (const id of ["a", "b", "c"]) expect(slot(r, id).cols).toBe(2);
  });

  test("three simultaneous items use three columns", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 480, end: 600 },
      { id: "c", start: 480, end: 600 },
    ]);
    const cols = ["a", "b", "c"].map((id) => slot(r, id).col).sort();
    expect(cols).toEqual([0, 1, 2]);
    expect(slot(r, "a").cols).toBe(3);
  });

  test("a fourth simultaneous item overflows past MAX_COLUMNS", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 480, end: 600 },
      { id: "c", start: 480, end: 600 },
      { id: "d", start: 480, end: 600 },
    ]);
    const overflowing = r.filter((s) => s.overflow);
    expect(overflowing).toHaveLength(1);
    const visible = r.filter((s) => !s.overflow);
    expect(visible).toHaveLength(3);
    for (const s of visible) expect(s.cols).toBe(MAX_COLUMNS);
  });

  test("clusters are independent: a crowded morning doesn't split the afternoon", () => {
    const r = layoutDay([
      { id: "a", start: 480, end: 600 },
      { id: "b", start: 480, end: 600 },
      { id: "c", start: 840, end: 960 },
    ]);
    expect(slot(r, "c")).toMatchObject({ col: 0, cols: 1 });
  });

  test("empty input returns empty output", () => {
    expect(layoutDay([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run tests/planner/layout.test.ts` — expect FAIL (module not found).
- [ ] **Step 3: Implement `src/lib/planner/layout.ts`** per the algorithm above (~60 lines; module docstring explains cluster/column semantics and that overflow items surface behind the "+N til" chip).
- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/planner/layout.test.ts` — expect PASS.
- [ ] **Step 5: Commit** — `git add src/lib/planner/layout.ts tests/planner/layout.test.ts && git commit` — "Planner: pure day-layout engine (clusters, columns, overflow)".

---

### Task 2: `store.ts` rewrite — unversioned hash + groups + semester-scoped storage

**Files:**
- Modify: `src/lib/planner/store.ts` (full rewrite of hash + storage sections; keep the coerce/validate defensive style)
- Test: `tests/planner/store.test.ts` (rewrite the hash describes; delete `describe("parsePlanHash — legacy v1-compat read (D15)")` entirely)

**Interfaces:**
- Consumes: nothing new.
- Produces (relied on by Tasks 6–14):

```ts
export const PROFILE_STORAGE_KEY = "np:profile";
export const PLANS_STORAGE_KEY = "np:plans";
export const LAST_SEMESTER_KEY = "np:lastSemester";
// DELETED: PLAN_STORAGE_KEY, PLAN_HASH_VERSION, PlanState.v, all legacy/v-token parsing.

export interface PlanCourse {
  code: string; name: string; version: string; source: CourseSource;
  credits?: number | null; dropped?: boolean;
  groups?: string[];            // NEW: selected group keys (Task 3 defines keys)
}
export interface PlanState { semesterId: string; courses: PlanCourse[]; program?: PlanProgram; }

export interface PlanStore {
  /* all existing methods keep their exact signatures, plus: */
  setCourseGroups(code: string, groups: string[]): PlanState;  // [] = back to defaults
}
export interface HashCourse {
  code: string; version: string; source: CourseSource; dropped?: boolean;
  groups: string[];             // NEW (empty array when none)
}
export function parsePlanHash(hash: string): ParsedPlanHash | null;
export function formatPlanHash(plan: Pick<PlanState, "semesterId" | "courses" | "program">): string;
```

Hash grammar (replaces v2 wholesale): `#<semesterId>;<programme>;<courses>` — exactly 3 segments. `programme` = `-` or `code[.cohort[.direction]]` (unchanged validation incl. `cohortIsPlausible`). Course token = `[-|+]code[.version]` followed by zero or more `~<groupKey>` (each groupKey `encodeField`-encoded; `~` itself survives `encodeURIComponent` so it is a safe delimiter). A hash whose first segment does not match `/^\d{2}[hv]$/i` parses to `null` — that also kills every old `#v2;…` link by construction, no version check needed.

Storage (replaces the single `ntnu:plan:v1` key):
- `np:profile` → `{ program: PlanProgram } | absent`
- `np:plans` → `{ [semesterId: string]: PlanCourse[] }`
- `np:lastSemester` → plain string
- `loadPlan()` reads `lastSemester` (fallback: the `defaultSemesterId` given to `createPlanStore`), assembles `{ semesterId, courses: plans[semesterId] ?? [], program: profile?.program }`.
- `savePlan(plan)` writes all three keys (current semester's courses into the map, program into profile) and dispatches `PLAN_CHANGE_EVENT` exactly as today.
- `setSemester(id)`: persist current courses under the old id, then load `plans[id] ?? []` as the new `courses` — manual adds stay in their own semester (the point of user mandate 7). `source:"program"` courses in the target entry are kept as-is; `plannerApp` re-derives them via `setProgramPlan` when its `derivationKey` changes (existing flow).
- `setCourseGroups(code, groups)`: replaces that course's `groups` (empty array → delete the property), saves.

- [ ] **Step 1: Rewrite the hash tests** in `tests/planner/store.test.ts`. Replace `describe("parsePlanHash / formatPlanHash — v2 grammar")` with `— hash grammar`; keep every encoding/validation case (B10: `BSPL26-V-GJØVIK` round-trip, malformed escapes, implausible cohort rejected) but on the 3-segment grammar; delete the whole legacy-v1 describe; add:

```ts
describe("parsePlanHash / formatPlanHash — groups", () => {
  test("group keys round-trip on a course token", () => {
    const hash = formatPlanHash({
      semesterId: "26h",
      courses: [{ code: "TDT4110", name: "ITGK", version: "1", source: "manual", groups: ["forelesningsparallell-2", "øvingsgruppe-5"] }],
    });
    expect(hash).toBe("#26h;-;%2BTDT4110~forelesningsparallell-2~%C3%B8vingsgruppe-5");
    const parsed = parsePlanHash(hash);
    expect(parsed?.courses[0]?.groups).toEqual(["forelesningsparallell-2", "øvingsgruppe-5"]);
  });
  test("no groups → bare token and empty array on parse", () => {
    const hash = formatPlanHash({ semesterId: "26h", courses: [{ code: "TMA4100", name: "", version: "1", source: "program" }] });
    expect(hash).toBe("#26h;-;TMA4100");
    expect(parsePlanHash(hash)?.courses[0]?.groups).toEqual([]);
  });
  test("an old versioned hash is simply invalid", () => {
    expect(parsePlanHash("#v2;26h;-;TMA4100")).toBeNull();
  });
});

describe("semester-scoped plans", () => {
  test("a manual add in one semester does not leak into another", () => {
    const store = createPlanStore("26h", { storage: memoryStorage(), events: fakeEvents() });
    store.addCourse({ code: "IT2805", name: "Webteknologi" });
    store.setSemester("27v");
    expect(store.loadPlan().courses).toHaveLength(0);
    store.setSemester("26h");
    expect(store.loadPlan().courses.map((c) => c.code)).toEqual(["IT2805"]);
  });
  test("the programme profile is shared across semesters", () => {
    const store = createPlanStore("26h", { storage: memoryStorage(), events: fakeEvents() });
    store.setProgram({ code: "MTDT", name: "Datateknologi", cohort: 2024 });
    store.setSemester("27v");
    expect(store.loadPlan().program?.code).toBe("MTDT");
  });
});

describe("setCourseGroups", () => {
  test("sets, replaces and clears a course's group selection", () => {
    const store = createPlanStore("26h", { storage: memoryStorage(), events: fakeEvents() });
    store.addCourse({ code: "TDT4110", name: "ITGK" });
    expect(store.setCourseGroups("TDT4110", ["forelesningsparallell-2"]).courses[0]?.groups).toEqual(["forelesningsparallell-2"]);
    expect(store.setCourseGroups("TDT4110", []).courses[0]?.groups).toBeUndefined();
  });
});
```

(Reuse the file's existing `memoryStorage()`/`fakeEvents()` helpers — they exist for the current suite; if named differently, adapt to the file's actual helpers.)

- [ ] **Step 2: Run to verify the new describes fail** — `npx vitest run tests/planner/store.test.ts`.
- [ ] **Step 3: Rewrite `store.ts`** per the interface block above. Delete: `PLAN_STORAGE_KEY`, `PLAN_HASH_VERSION`, `v: 1` from `PlanState`, the `coercePlan` `v !== 1` check (coercion now validates shape only), the legacy-v1 parse branch, the version-token check at line 534. Update every internal caller.
- [ ] **Step 4: Run the whole unit suite** — `npx vitest run` — everything except known consumers-to-be-updated must pass. Fix compile fallout in `plannerApp.ts`/`Layout.astro`/`index.astro`/`emner`/`emne` call sites minimally (`v: 1` removals, key renames) so `npm run typecheck` is green — behavioral rework of those files comes in Tasks 10–13.
- [ ] **Step 5: Commit** — "Store: unversioned hash with group keys, semester-scoped plans, global profile".

---

### Task 3: `groups.ts` — group keys, options, defaults, filtering

**Files:**
- Create: `src/lib/planner/groups.ts`
- Test: `tests/planner/groups.test.ts`

**Interfaces:**
- Consumes: `classifyActivity`/`ActivityKind` (activity.ts), `entriesForProgram` (schedule.ts), `fold` (dom.ts — move nothing; import from `../../components/planner/dom` is wrong layering, so re-implement the tiny fold-slug inline), `TimetableEntry` (data.ts).
- Produces (used by grid rewrite, popover, plannerApp):

```ts
export interface GroupOption {
  key: string;            // slug of the entry's `name`, e.g. "forelesningsparallell-2"
  label: string;          // the raw name, e.g. "Forelesningsparallell 2"
  kind: ActivityKind;     // "lecture" | "other"
  entryCount: number;
}
export function groupKey(name: string | null | undefined): string | null;
// null/blank → null. Slug: lowercase, æøå kept (encodeField handles the hash), spaces/punct → "-", collapse repeats.

export function groupOptions(entries: TimetableEntry[]): GroupOption[];
// distinct entry.name values (fallback title), sorted lecture-first then label. Entries with null name → no option (ungrouped stream).

export function defaultLectureKeys(entries: TimetableEntry[], programCode: string | null | undefined): string[];
// The programme's own parallel: keys of lecture-classified entries surviving entriesForProgram(entries, programCode).
// If >1 lecture group key survives (or no programme), and the groups look like numbered parallels, keep only the first by label sort.
// A course with a single lecture group (or ungrouped lectures) → [] (no selection needed).

export function applyGroupSelection<T extends TimetableEntry>(
  entries: T[], selected: string[] | undefined, programCode: string | null | undefined,
): T[];
// selected non-empty: keep entries whose groupKey is in selected, plus ungrouped (null-key) entries.
// selected empty/undefined: keep ungrouped + lecture entries whose key is in defaultLectureKeys + ALL non-lecture entries
// (the muted øving layer stays "all groups" until the user picks one — grid's showOthers toggle governs visibility).
```

- [ ] **Step 1: Write failing tests** with realistic fixtures (entry helper `e(name, {day, start, end, programs})`):

```ts
import { describe, expect, test } from "vitest";
import { applyGroupSelection, defaultLectureKeys, groupKey, groupOptions } from "../../src/lib/planner/groups";
import type { TimetableEntry } from "../../src/lib/planner/data";

const e = (name: string | null, over: Partial<TimetableEntry> = {}): TimetableEntry => ({
  courseCode: "TDT4110", courseName: { nob: null, nno: null, eng: null },
  dayNumber: 1, startTime: "10:15", endTime: "12:00", weeks: ["34-47"], rooms: [],
  title: null, name, ...over,
});

describe("groupKey", () => {
  test("slugs a parallel name", () => expect(groupKey("Forelesningsparallell 2")).toBe("forelesningsparallell-2"));
  test("keeps æøå", () => expect(groupKey("Øvingsgruppe 5")).toBe("øvingsgruppe-5"));
  test("null and blank give null", () => {
    expect(groupKey(null)).toBeNull();
    expect(groupKey("  ")).toBeNull();
  });
});

describe("groupOptions", () => {
  test("distinct names, lecture-first, with counts", () => {
    const opts = groupOptions([
      e("Forelesningsparallell 1"), e("Forelesningsparallell 1", { dayNumber: 3 }),
      e("Forelesningsparallell 2"), e("Øvingsgruppe 5"),
    ]);
    expect(opts.map((o) => o.key)).toEqual(["forelesningsparallell-1", "forelesningsparallell-2", "øvingsgruppe-5"]);
    expect(opts[0]).toMatchObject({ kind: "lecture", entryCount: 2 });
    expect(opts[2]?.kind).toBe("other");
  });
});

describe("defaultLectureKeys", () => {
  const parallels = [
    e("Forelesningsparallell 1", { studyProgramKeys: ["MTDT"] }),
    e("Forelesningsparallell 2", { studyProgramKeys: ["MTKJ"] }),
    e("Forelesningsparallell 3", { studyProgramKeys: ["BIT"] }),
  ];
  test("programme match picks the programme's parallel", () => {
    expect(defaultLectureKeys(parallels, "MTKJ")).toEqual(["forelesningsparallell-2"]);
  });
  test("no programme falls back to the first parallel", () => {
    expect(defaultLectureKeys(parallels, null)).toEqual(["forelesningsparallell-1"]);
  });
  test("a single lecture stream needs no selection", () => {
    expect(defaultLectureKeys([e("Forelesning"), e(null)], "MTDT")).toEqual([]);
  });
});

describe("applyGroupSelection", () => {
  const entries = [
    e(null), e("Forelesningsparallell 1", { studyProgramKeys: ["MTDT"] }),
    e("Forelesningsparallell 2", { studyProgramKeys: ["MTKJ"] }),
    e("Øvingsgruppe 5"), e("Øvingsgruppe 7"),
  ];
  test("default keeps ungrouped, the default parallel, and every øving group", () => {
    const kept = applyGroupSelection(entries, undefined, "MTDT").map((x) => x.name);
    expect(kept).toEqual([null, "Forelesningsparallell 1", "Øvingsgruppe 5", "Øvingsgruppe 7"]);
  });
  test("an explicit selection filters both kinds", () => {
    const kept = applyGroupSelection(entries, ["forelesningsparallell-2", "øvingsgruppe-7"], "MTDT").map((x) => x.name);
    expect(kept).toEqual([null, "Forelesningsparallell 2", "Øvingsgruppe 7"]);
  });
});
```

- [ ] **Step 2: Verify fail**, **Step 3: implement** (~90 lines), **Step 4: verify pass** (`npx vitest run tests/planner/groups.test.ts` + full suite), **Step 5: commit** — "Planner: group keys, options, programme-default parallels, selection filter".

---

### Task 4: `examSchedule.ts` — exam list model

**Files:**
- Create: `src/lib/planner/examSchedule.ts`
- Test: `tests/planner/examSchedule.test.ts`

**Interfaces:**
- Consumes: nothing (pure; caller supplies exam inputs and today's ISO date).
- Produces (used by Task 9's `examList.ts`):

```ts
export interface ExamListInput { code: string; date: string | null; }
export interface ExamListRow {
  code: string; date: string;       // ISO
  weekday: string;                  // "to" — 2-letter Norwegian, lowercase
  gapToNext: number | null;         // whole days to the NEXT row; null on the last row
  tight: boolean;                   // gapToNext !== null && gapToNext <= 2
  sameDay: boolean;                 // shares a date with another exam
  daysFromToday: number | null;     // set ONLY on the first row with date >= today
}
export interface ExamListModel {
  summary: string | null;           // "4 eksamener over 14 dager" / "1 eksamen" / null when empty
  rows: ExamListRow[];              // date-ascending
  dateless: string[];               // codes with null date, input order
}
export function buildExamList(exams: ExamListInput[], todayIso: string): ExamListModel;
```

- [ ] **Step 1: Failing tests** — cases: ordering + gaps (`26.11 → 01.12` = gap 5); tight at gap ≤ 2 and not at 3; `sameDay` on both of a 0-gap pair (and gapToNext 0, tight); `daysFromToday` only on first upcoming (past exams get null; all-past list → no row has it); dateless codes preserved in order and excluded from summary math; summary singular "1 eksamen" (no "over" clause), plural over `last - first` days; empty input → `{ summary: null, rows: [], dateless: [] }`; weekday correctness for a known date (`2026-11-26` → `"to"`).
- [ ] **Step 2: Verify fail**, **Step 3: implement** (date math via `Date.UTC` day diffing — no locale-dependent parsing; weekday via `["sø","ma","ti","on","to","fr","lø"][utcDay]`), **Step 4: verify pass**, **Step 5: commit** — "Planner: exam list model (gaps, tight flags, next-upcoming countdown)".

---

### Task 5: kull relevance in `programPlan.ts`

**Files:**
- Modify: `src/components/planner/programPlan.ts` (append two exports)
- Test: `tests/planner/programPlan.test.ts` (append describes)

**Interfaces:**
- Consumes: existing `StudyPlan`, `periodNumberFor` (same file).
- Produces (used by the studieinfo modal, Task 6):

```ts
export function maxPeriodNumber(plan: Pick<StudyPlan, "periods">): number | null;
// highest non-null periods[].periodNumber; null when none.
export function relevantCohorts(plan: Pick<StudyPlan, "periods">, semesterId: string): number[];
// descending cohort years K in [year(S) - 7, year(S)] where 1 <= periodNumberFor(semesterId, K) <= maxPeriodNumber.
// Empty when maxPeriodNumber is null. This replaces the homepage's periodExists() chip filter (the S4 lockout bug:
// relevance is by period RANGE, never by whether the period's courseGroups are non-empty).
```

- [ ] **Step 1: Failing tests** — a 10-period plan (5-year) for `26h` → `[2026, 2025, 2024, 2023, 2022]`; 4-period (2-year) → `[2026, 2025]`; 2-period (årsstudium) → `[2026]`; spring semester `27v` with a 10-period plan → `[2026, …, 2022]` (period math via existing `periodNumberFor` spring branch); plan with all-null periodNumbers → `[]`.
- [ ] **Step 2–5:** fail → implement (~25 lines) → pass (`npx vitest run tests/planner/programPlan.test.ts`) → commit — "Programme plan: relevant-cohort rule from the plan's own period range".

---

### Task 6: `studieinfo.ts` — the modal

**Files:**
- Create: `src/components/planner/studieinfo.ts`
- Modify: `src/pages/planlegger/index.astro` (add the dialog host + "Endre studieinfo" affordance; picker markup removal happens in Task 10)
- Modify: `src/styles/site.css` (dialog styling on `.np-frame` bones; `::backdrop` dim)

**Interfaces:**
- Consumes: `PlanStore` (Task 2), `findProgramPlan`, `resolvePeriodFor`, `relevantCohorts` (Task 5), `classifyPeriod`, `prefillCredits`, `isSuspiciousPrefill` (programPlan.ts), `ProgramOption`/`SemesterSummary` (plannerApp.ts), `fold` (dom.ts).
- Produces (used by plannerApp Task 10 and Layout chip Task 11):

```ts
export interface StudieinfoDeps {
  store: PlanStore;
  semesters: SemesterSummary[];        // the plannable candidates (current + next two)
  programOptions: ProgramOption[];
  defaultSemesterId: string;
}
export interface StudieinfoHandle { open(): void; }
export function mountStudieinfo(deps: StudieinfoDeps, signal: AbortSignal): StudieinfoHandle;
export const OPEN_STUDIEINFO_EVENT = "np:open-studieinfo";  // window CustomEvent; mount listens for it
```

Behavior spec (all copy verbatim):
- Creates `<dialog id="studieinfo-dialog" aria-labelledby="studieinfo-title">` once; `<h2 id="studieinfo-title">Studieinfo</h2>`.
- **Program** field: label `Studieprogram`, typeahead over `programOptions` (reuse the option-row pattern from the planner picker: code + name + `studyLevel` + cities, `fold()` matching, max 12 rows). A picked programme renders as a chip `MTDT · Datateknologi` with an `×` button (aria-label `Fjern studieprogram`) — the input never silently clears (S3).
- **Kull** chips: on programme pick, `findProgramPlan(code, semesterYear(deps.defaultSemesterId))`; chips = `relevantCohorts(plan, selectedSemesterId)` descending. Cohorts whose year is missing from `plan.publishedYears` still render; selecting one shows `Fant ingen studieplan for kull {K} — du kan legge til emner selv.` as an `.np-hint` (never a dead chip). `not-found`/`error` plan results → hint `Fant ingen studieplan for dette programmet. Du kan fortsatt legge til emnene dine selv.`
- **Studieretning** select: rendered only when `resolvePeriodFor(plan, semesterId, cohort).pendingChoice` is non-null; label = the waypoint's own `name`; options from `pendingChoice.directions`; a deadline renders as `.np-note` `frist {formatShortDate(deadlineDate)}`.
- **Semester** select: one option per `deps.semesters`; unpublished ones append ` — timeplan publiseres ~{august|desember}` (reuse plannerApp's `publishMonthFor` copy; move that helper into this file or export it — one owner only).
- Footer buttons: `.np-btn` `Lagre` (primary) / `Avbryt`. Esc = Avbryt. Focus is trapped by the native dialog; on close, focus returns to the invoking element.
- **Lagre** commits in one pass: `store.setSemester(sem)`; then if a programme is picked → resolve `classifyPeriod`; obligatory (cleared to `[]` when `isSuspiciousPrefill`) → `store.setProgramPlan(program, toAdd)` (this is the old `useAsMyPlan` semantics from studyPlan.ts, now the ONLY import path); no programme → `store.setProgram` removal path (clearing profile) with manual courses untouched. Avbryt/Esc changes nothing (all edits are staged in local variables until Lagre).
- Listens on `window` for `OPEN_STUDIEINFO_EVENT` (with `{signal}`) and opens.

- [ ] **Step 1:** Implement the module + dialog host + styles. (Interactive component — covered by e2e in Task 14; the logic it composes is already unit-tested in Tasks 2/5.)
- [ ] **Step 2:** Wire a temporary dev entry: in `planlegger/index.astro`'s bootstrap, `mountStudieinfo(...)` and a visible `Endre studieinfo` button; build + verify by hand in the browser (`npm run build && npx wrangler dev --port 8788`): pick MTDT → kull chips show 5 years → pick 2024 → retning select appears → Lagre → week renders, hash contains `MTDT.2024`.
- [ ] **Step 3:** `npm run typecheck && npm run lint`; commit — "Planner: studieinfo modal — programme, relevant kull, retning, semester in one dialog".

---

### Task 7: `grid.ts` rewrite — calendar engine

**Files:**
- Modify: `src/components/planner/grid.ts` (replace `buildClusters`/`MAX_SPLIT_COLUMNS` internals with `layoutDay`; add group filtering + block-click)
- Modify: `src/styles/planner-week.css` (column layout from slot vars; light-mode tint; overflow chip; two-line block)
- Test: unit — none new (layout is Task 1); visual via dev server; e2e in Task 14.

**Interfaces:**
- Consumes: `layoutDay`/`LayoutSlot`/`MAX_COLUMNS` (Task 1), `applyGroupSelection` (Task 3), existing `findConflicts`/`groupConflicts`/`mergeParallelSlots`.
- Produces (consumed by plannerApp Task 10, courseTimetable unchanged consumers):

```ts
export interface BlockDetail {
  code: string; name: string;                 // course
  entryName: string | null;                   // group/activity label
  timeLabel: string;                          // "mandag 08:15–10:00"
  rooms: string; weeksLabel: string;
  isLecture: boolean;
}
export interface GridRenderOptions {
  loading?: boolean;
  pendingChoiceMessage?: string | null;
  onBlockClick?: (detail: BlockDetail, anchor: HTMLElement) => void;   // NEW
}
// renderGrid signature otherwise unchanged; GridRenderResult unchanged.
```

Spec:
- Per course, entries pass through `applyGroupSelection(entries, course.groups, programCode)` BEFORE `mergeParallelSlots` — the grid never shows unselected parallels. `programCode` comes from a new optional field on `PlanCourseState` (`types.ts`: add `programCode?: string | null`; plannerApp sets it from `plan.program?.code`).
- Replace the internal cluster/column assignment with `layoutDay` per day (`MAX_SPLIT_COLUMNS` and `buildClusterBlock`'s stacked-codes variant are deleted). Visible slots position via existing `--planner-col`/`--planner-col-count`. Overflow slots render ONE `.planner-block-overflow` chip per cluster, text `+{N} til`, which invokes `onBlockClick` with a synthetic detail listing the hidden entries (join codes with " · ").
- Blocks are two-line minimum: `.planner-block-code` (full code, never truncated — CSS `min-width: 0; overflow-wrap: anywhere` on the block, remove any `text-overflow: ellipsis` on the code), second line room · start time.
- Every block (not just clash ones) gets `cursor: pointer` and fires `onBlockClick(detail, blockEl)`.
- Light-mode tint: `.planner-block` background uses `oklch(from var(--hue-…) …)`-style low-alpha fill in BOTH themes — concretely, apply the same `color-mix(in oklab, var(hue) 14%, var(--paper))` treatment dark mode already has (find the dark-only rule in planner-week.css and lift it out of the `@media`/`[data-theme]` guard, tuning alpha for light paper). Red clash edge (`.is-clash`) unchanged.

- [ ] **Step 1:** Implement grid changes + CSS.
- [ ] **Step 2:** Rebuild and verify in the browser: a plan with TDT4110 shows ONE parallel; two deliberately-overlapping courses render side-by-side, both fully readable, red edge + sentence present; light mode blocks are tinted per course; four simultaneous → "+1 til" chip.
- [ ] **Step 3:** `npx vitest run` (courseTimetable's reuse must still typecheck — it passes no `onBlockClick`, fine), `npm run typecheck && npm run lint`; commit — "Grid: calendar-engine layout, group-filtered entries, readable overlaps, both-theme tints".

---

### Task 8: `popover.ts` — block detail + group picker

**Files:**
- Create: `src/components/planner/popover.ts`
- Modify: `src/styles/site.css` (positioning: anchored near block on ≥60rem, bottom-sheet below)

**Interfaces:**
- Consumes: `GroupOption` (Task 3), `PlanStore.setCourseGroups` (Task 2), `BlockDetail` (Task 7).
- Produces (used by plannerApp Task 10):

```ts
export interface BlockPopoverContext {
  detail: BlockDetail;
  groups: GroupOption[];          // ALL of this course's group options (from the unfiltered bundle)
  selected: string[];             // course.groups ?? [] (empty = defaults)
  defaults: string[];             // defaultLectureKeys(...) for labeling
  source: CourseSource; dropped: boolean;
}
export function mountBlockPopover(store: PlanStore, signal: AbortSignal): {
  showFor(ctx: BlockPopoverContext, anchor: HTMLElement): void;
};
```

Spec: one shared `<dialog id="planner-popover" class="np-frame">`. Content: `<h3>` `{code} · {name}`; `.np-note` `{timeLabel} · {rooms} · {weeksLabel}`; when `groups.length > 1` a `Grupper` section — radio-per-lecture-group (checked = selected, or the default when selection empty; default option's label suffixed ` (din parallell)` when it came from the programme), checkbox-per-øving-group, plus `Vis alle grupper` which calls `setCourseGroups(code, [])`… followed by action row: `Dropp`/`Legg tilbake` (program courses), `Fjern fra planen` (manual), link `Gå til emnesiden →` (`/emne/{code}/`). Group changes call `setCourseGroups` immediately (plan-change re-renders the grid live behind the dialog); the dialog stays open until Esc/outside-click/close.

- [ ] **Step 1:** Implement + styles. **Step 2:** Browser-verify: click TDT4110 block → popover lists 3 parallels with parallel-1 marked `(din parallell)`; switching updates the grid live; øving group checkbox narrows the muted layer. **Step 3:** typecheck+lint; commit — "Planner: block popover with group picker and course actions".

---

### Task 9: `examList.ts` replaces `examRibbon.ts`

**Files:**
- Create: `src/components/planner/examList.ts`
- Delete: `src/components/planner/examRibbon.ts`
- Modify: `src/styles/site.css` (list + connector styles; delete `.planner-exam-ribbon/-axis/-month/-dots/-stack` styles wherever they live)

**Interfaces:**
- Consumes: `buildExamList` (Task 4), `examsFromIndex`/`PlannerIndex`/`ExamWindow` (data.ts), `PlanCourseState`.
- Produces (drop-in for plannerApp):

```ts
export interface ExamRenderResult { collisionCount: number; state: "list" | "empty" | "loading"; }
export function renderExamMessage(frame: HTMLElement, listHost: HTMLElement, message?: string | null): ExamRenderResult;
export function renderExamList(
  frame: HTMLElement, listHost: HTMLElement, courses: PlanCourseState[],
  semesterId: string, index: PlannerIndex | null, window: ExamWindow | null,
  todayIso: string, options?: { loading?: boolean },
): ExamRenderResult;
```

Markup per model: summary `.np-kicker` line; rows `.exam-row` → `.exam-date` (`{weekday} {formatShortDate(date)}`), `.np-tag` code, `.np-hint` `om {n} dager` on the first upcoming; connector `.exam-gap` between rows: `{n} dager mellomrom` (`1 dag mellomrom`), `.is-tight` + suffix ` · tett` when tight, `.np-note-clash` `samme dag` styling when `sameDay`. Dateless: `.exam-dateless` rows `“{code} · dato ikke satt”`. `collisionCount` = number of sameDay pairs (drives `#planner-exam-status` copy unchanged).

- [ ] **Step 1:** Implement; update `plannerApp.ts` imports (`renderExamRibbon` → `renderExamList` with `todayIso = new Date().toISOString().slice(0, 10)`), delete `examRibbon.ts`.
- [ ] **Step 2:** `npx vitest run` + browser-verify the list against a real MTDT plan (gap numbers match the dates shown). **Step 3:** typecheck+lint; commit — "Exams: chronological date list with explicit gaps replaces the ribbon".

---

### Task 10: `plannerApp.ts` rework — modal wiring, empty states, fallback split, picker removal

**Files:**
- Modify: `src/components/planner/plannerApp.ts`, `src/pages/planlegger/index.astro`, `src/components/planner/types.ts` (add `programCode`)

**Interfaces:**
- Consumes: everything above. Produces: the page. Key edits:

1. **Delete the inline picker**: markup ids `planner-picker*` from the astro file and every picker function in plannerApp; `getElements()` loses those ids. The kull/direction question flow (`weekQuestion`'s pending-direction shape) now renders as a sentence + `Endre studieinfo`-opening button instead of inline chips.
2. **Mount** `mountStudieinfo` + `mountBlockPopover` + pass `onBlockClick` through to `renderGrid`; `PlanCourseState.programCode = plan.program?.code ?? null`.
3. **Open triggers**: `?studieinfo` query param on mount (`new URLSearchParams(location.search)`; strip via `history.replaceState` after opening); `OPEN_STUDIEINFO_EVENT`; every empty-state button.
4. **Empty/fallback states** (replaces the single `!published || allEmpty` branch in `renderGridAndExams`, line ~1623). Compute three booleans per render: `failed` = some bundle finished with `timetable === null`; `empty` = every loaded bundle has `timetable?.length === 0`; `published` = semester flag. Order:
   - no profile && no courses → centered card: `.np-hint` `Ingen plan ennå.` + primary `.np-btn` `Velg studieprogram` (opens modal) + secondary link `…eller legg til emner med emnekode` (opens add modal).
   - `!published` → existing copy `Timeplan for {name} publiseres vanligvis i {måned} — kom tilbake da.` (unchanged).
   - `failed` → `.np-note` `Fikk ikke hentet timeplanen.` + `.np-btn` `Prøv igjen` → `clearCourseBundleMemo()` + reload bundles. NEVER the publiseres copy (S6/T10 fix — the `?? []` coalesce is the bug; keep `null` distinct).
   - `published && empty` (courses exist) → `Ingen av emnene dine undervises i {name}.` + button `Endre studieinfo`.
5. **Scroll hint** (`#planner-scroll-hint` copy): `Dra sidelengs for å se hele uken.` (S15).
6. **Semester switching** uses the new store semantics; drop the app-side course carry-over so a manual add stays in its own semester (verify against `derivationKey` flow — programme re-derivation is unchanged).
7. The `planner-context-line`'s `/studier/` link (via `programHref`) is replaced by a button opening the modal (the page is being deleted in Task 13).

- [ ] **Step 1:** Implement; delete dead picker code ruthlessly (target: plannerApp shrinks).
- [ ] **Step 2:** `npx vitest run` + typecheck + lint.
- [ ] **Step 3:** Browser-verify the four states: fresh profile-less visit shows the card; MTDT/2024 via modal → week; DevTools-offline reload → `Prøv igjen` state (not "publiseres"); Vår 2027 → publiseres state; manual add in 26h absent from 27v and back.
- [ ] **Step 4:** Commit — "Planner: modal-driven onboarding, four honest empty states, picker removed".

---

### Task 11: `Layout.astro` — persistent nav + studieinfo chip, plan strip deleted

**Files:**
- Modify: `src/layouts/Layout.astro`, `src/styles/site.css`

Spec:
- `NAV = [{ href: "/planlegger/", label: "Planlegger", sections: ["/planlegger/"] }, { href: "/emner/", label: "Emner", sections: ["/emner/", "/emne/"] }]`.
- After the nav, the chip `<a class="np-btn studieinfo-chip" id="studieinfo-chip">`: script fills text from the store — `{code} · {cohort} · {semesterLabel}` (profile present) else `Velg studieprogram`. On `/planlegger/` it `preventDefault`s and dispatches `OPEN_STUDIEINFO_EVENT`; elsewhere `href="/planlegger/?studieinfo"`. Non-planner pages with ≥1 active course also render `<a id="plan-count-link" class="np-hint" href="/planlegger/">{n} emner · {sp} sp → ukeplanen</a>` (reuse the credit-summing logic from the current strip script, minus the bundle prefetch — use stored `credits`, suffix `+ {m} uten oppgitt sp` when unknown).
- Delete `#plan-strip`/`#plan-strip-link` markup, styles, and the entire strip script block (lines 152–248 region).
- Footer: drop the `/studier/` link; keep `/emner/` + provenance sentence.

- [ ] **Step 1:** Implement. **Step 2:** Browser-verify chip on all pages (planner opens dialog in place; `/emner/` navigates with `?studieinfo`), aria-current still right on `/emne/TDT4100/`. **Step 3:** typecheck+lint; commit — "Chrome: persistent nav with studieinfo chip; plan strip retired".

---

### Task 12: add-course modal + shared clash path (S7)

**Files:**
- Create: `src/components/planner/addCourse.ts`
- Modify: `src/components/planner/plannerApp.ts` (replace `planner-add-*` inline typeahead with a `Legg til emne` button opening the dialog), `src/pages/planlegger/index.astro`
- Modify: `src/components/site/planClash.ts` (+ its test), `src/pages/emne/[code].astro`, `src/pages/emner/index.astro` (pass the programme)

**Interfaces:**

```ts
// addCourse.ts
export function mountAddCourse(deps: {
  store: PlanStore; index: PlannerIndex; semester: SemesterSummary; programCode: string | null;
}, signal: AbortSignal): { open(): void };

// planClash.ts — signature change:
export async function planClash(
  course: { code: string; version: string },
  plan: PlanState,
  semester: ClashSemester,
  ownEntries?: TimetableEntry[] | null,
  programCode?: string | null,        // NEW: plan.program?.code; both own and partner entries
                                       // pass through entriesForProgram(entries, programCode)
): Promise<ClashVerdict>;
```

The dialog: search field over `index.courses` (fold-matching, cap 12), row = code/name/credits + lazy clash line via `planClash(…, plan.program?.code)` computed on focus/hover (reuse the existing lazy pattern from `/emner/`), `Legg til` button per row (row flips to `Lagt til ✓` + `Fjern`), stays open for multiple adds. The not-taught case renders the friendly copy `kun eksamen · ikke undervist i {year}` from `offeredYears` (S13) instead of a later raw fetch error.

- [ ] **Step 1: planClash test first** — add to `tests/site/planClash.test.ts`: a candidate whose only Thursday entry carries `studyProgramKeys: ["MTGEORT"]` while the plan's programme is `MTDT` and its own MTDT-relevant sections don't overlap → verdict `clear` with `programCode: "MTDT"`, `clash` without (documents the S7 false positive and its fix). Run: fails.
- [ ] **Step 2:** Implement the `planClash` change; update both call sites to pass the plan's programme; test passes.
- [ ] **Step 3:** Implement `addCourse.ts` + plannerApp wiring; delete the `planner-add-*` inline typeahead markup/code.
- [ ] **Step 4:** Full unit suite + typecheck + lint; browser-verify: add modal searches, previews clash consistently with the grid verdict, adds multiple, not-taught row shows friendly copy.
- [ ] **Step 5:** Commit — "Add-course modal; clash preview shares the grid's section-aware path (S7)".

---

### Task 13: homepage landing, 404, /studier deletion

**Files:**
- Modify: `src/pages/index.astro` (delete picker/kull/direction/`?q=`; keep hero + proof frame + CTA `.np-btn` `Åpne planleggeren` → `/planlegger/` + resume line reading the new store), `src/pages/404.astro` (drop both search forms → `Til forsiden` + `Åpne planleggeren` links; kills the `value="404"` bug S9)
- Delete: `src/pages/studier/index.astro`, `src/pages/studier/[code].astro`, `src/components/site/studyPlan.ts`, `tests/site/studyPlan.test.ts`
- Modify: `src/lib/programUrl.ts` — delete `programHref` (no consumers after Task 10); keep `codeToSegment` only if `/emner/` still uses it, else delete the file; `src/pages/emner/index.astro` + `src/pages/emne/[code].astro` — remove any `/studier/` links.

- [ ] **Step 1:** Implement deletions + rewrites. Grep-verify: `grep -rn "studier\|plan-strip\|planner-picker\|PLAN_HASH_VERSION" src/` returns nothing (except the word "studieretning").
- [ ] **Step 2:** `npm run build` must succeed (no orphan imports; `/studier/*` pages gone from dist); unit suite + typecheck + lint green.
- [ ] **Step 3:** Commit — "Homepage is a landing; /studier deleted; 404 recovers to the planner".

---

### Task 14: e2e rewrite

**Files:**
- Modify: `e2e/flows.pw.ts`, `e2e/navigation.pw.ts`

Rewrite `flows.pw.ts` around the modal (the homepage-picker tests are obsolete). Required tests (names verbatim):
- `"onboarding: modal → programme + kull + retning → a full week"` — `/planlegger/` → empty-state card → `Velg studieprogram` → type `Datateknologi` → pick MTDT → expect ≥ 4 kull chips → pick an older kull (2024) → retning select appears → choose one → Lagre → grid renders blocks, chip shows `MTDT · 2024`, hash matches `/#26h;MTDT\.2024/`.
- `"share: the hash reproduces the plan in a fresh context"` — copy URL, open in a new browser context, assert same course codes render.
- `"overlap: two colliding courses render side by side, both readable"` — build a plan with a known collision (the flows file already knows one from the clash-preview test); assert two `.planner-block`s share a timeslot with `--planner-col-count: 2` and neither has zero visible text width; `#planner-grid-status` mentions `kollisjon`.
- `"groups: switching parallel updates the grid and survives the URL"` — click a TDT4110 block → popover → choose `Forelesningsparallell 2` → block count for that hour drops; reload the URL → still parallel 2 (`~forelesningsparallell-2` in hash).
- `"manual adds stay in their semester"` — add a course via the add modal in 26h, switch semester in the modal, assert gone, switch back, assert present.
- `"failure honesty: API down shows retry, not 'publiseres'"` — `context.route('**/api/**', r => r.abort())` on a plan URL; assert text `Fikk ikke hentet timeplanen` and a `Prøv igjen` button; assert the publiseres copy is absent.
- Keep (adapted to modal): the Æ/Ø/Å programme (`MTIØT`) and campus-code (`BSPL…GJØVIK`) round-trips, drop/restore.
- `navigation.pw.ts`: replace plan-strip assertions with chip assertions (`#studieinfo-chip` present and identically labeled on `/`, `/planlegger/`, `/emner/`, `/emne/TDT4100/`); add `"/studier/ is gone"` (expect 404 status); keep the zero-console-errors circuit.

- [ ] **Step 1:** Rewrite specs. **Step 2:** `npm run test:e2e` (builds + serves via the playwright webServer config; if port 8788 is busy with the dev server, it reuses it — make sure it serves a FRESH build first). All green. **Step 3:** Commit — "e2e: modal onboarding, overlaps, groups, semester isolation, failure honesty".

---

### Task 15: docs + final sweep

**Files:**
- Modify: `docs/PRODUCT.md` (§0 addendum), `docs/ROADMAP.md`, `docs/SPEC.md` (ownership rows: layout.ts, groups.ts, examSchedule.ts, studieinfo.ts, popover.ts, addCourse.ts, examList.ts; deletions), `README.md` if it names /studier.

- [ ] **Step 1:** PRODUCT.md §0 addendum "(user, 2026-07-25)" — the eleven mandate points in compressed form, each naming what it supersedes (D11 nav; §7 frozen-grammar/compat rule suspended; §4/I3 /studier sequencing; DR-1 narrowed to detection-only with display-level group selection now in scope; D14's "no popovers" verifier note superseded by point 4). ROADMAP: mark this rework shipped, list what's still open (day agenda, Phase 3 growth loop, Phase 4 decide-loop).
- [ ] **Step 2:** Full verification: `npm run lint && npm run typecheck && npx vitest run && npm run test:e2e`. All green, no skips.
- [ ] **Step 3:** Commit — "Docs: 2026-07-25 mandate recorded; SPEC/ROADMAP aligned with the rework".

---

## Self-review notes (already applied)

- Spec coverage: design §1→Task 2, §2→Tasks 5+6, §3→Tasks 10+13, §4→Task 11, §5→Tasks 1+3+7+8, §6→Tasks 4+9, §7→Task 12, §8→Task 13, §9→Task 15, §10→Tasks 1–5+12+14. No gaps.
- `programs.json` has NO duration field (interface map §28) — kull relevance is therefore plan-derived (`maxPeriodNumber`), Task 5, not `studyLevel` string parsing. The design doc's "duration from the catalog" line is corrected by this plan.
- Type consistency: `BlockDetail` defined in Task 7, consumed in Task 8/10; `GroupOption` in Task 3, consumed in 8; `setCourseGroups` in Task 2, consumed in 8; `OPEN_STUDIEINFO_EVENT` in Task 6, consumed in 10/11; `planClash`'s new param in Task 12 used by both call sites.
- Execution order is strict: 1→2→3→4→5 may run in any order (independent), 6 needs 2+5, 7 needs 1+2+3, 8 needs 3+7, 9 needs 4, 10 needs 6+7+8+9, 11 needs 6(event name)+2, 12 needs 2+10, 13 needs 10+11, 14 needs 10–13, 15 last.
