# One week, three surfaces — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/planlegger/`, `/emne/[code]/` and `/user/<navn>` draw the same week through one component with the same two views (Uke and Liste), the same clickable blocks and the same popover — and the transposed "Rader" geometry is deleted.

**Architecture:** `grid.ts` today is two modules wearing one name: it draws Rader *and* it owns every judgment about a week (margin notes, conflict count, gap reporting, message branches). The judgment half is split out as `weekNotes.ts`, the drawing half is deleted, and a new `weekView.ts` owns what is currently inline in `plannerApp.ts` — the view state, the tab pair, scroll/mask sync, the now tick and the render switch between `renderColumnGrid` and `renderBoard`. Three pages mount it.

**Tech Stack:** Astro 6, TypeScript, vanilla DOM (`el()` helpers, no framework), Vitest for unit, Playwright for browser, Biome for lint/format.

## Global Constraints

- **UI copy is Norwegian bokmål, sentence case, comma decimals** ("7,5 sp").
- **No `—` and no `·` in any string a student can read**, anywhere in `src/` or `worker/`, and no substitute mark (`–`, `|`, a hyphen standing in for one). Prose becomes sentences; data rows become spaced fields. `tests/copy.test.ts` gates this and must not be loosened.
- **No copy that announces the week is finished** — "tegne uka", "uka er klar", "så er uka klar" and the same shape around *timeplanen*/*ukeplanen* are banned in every inflection. Write the visible outcome instead.
- **Every page setup goes through `onPage(setup)`** (`src/lib/pageLifecycle.ts`), binding listeners with `{ signal }`. Hoisted module scripts run once per module and do NOT re-execute after a ClientRouter swap.
- **Do not write tests that restate the current design** — DOM child counts, exact visual treatments, per-control geometry. Test mechanism: does it survive a ClientRouter swap, does CLS stay in budget, did a fixture go missing.
- **`[hidden]` works** because `primitives.css` has `[hidden] { display: none !important }`. Keep using it; do not replace it with a state class without reading that rule's comment.
- **`mise run check` and `mise run e2e` must both stay green.**
- Single unit file: `npx vitest run tests/planner/<file>.test.ts`. Full unit pass: `mise run check`. Browser: `mise run e2e`.

---

## File structure

**Created**

| File | Responsibility |
|---|---|
| `src/components/planner/weekNotes.ts` | Everything `grid.ts` knew that was not geometry: `planGaps`, `unresolvedLectureChoices`, `lectureLessCourses`, `visibleLayer`, `isDropIn`, `blockDetailFor`, `buildingLabel`, `metaLine`, `setScrollFade`, `renderWeekMessage`, and the new `weekNotes()` that emits margin notes and returns the verdict material. |
| `src/components/planner/weekView.ts` | The week as one mountable thing: view state (`np:weekView`), the Uke/Liste tab pair, scroll/mask sync, the now tick, layer-change choreography, the skeleton, and the switch between `renderColumnGrid` and `renderBoard`. |
| `src/components/WeekTabs.astro` | The Uke/Liste markup, server-rendered on all three pages so the tabs are in the static shell and never pop in. |
| `tests/planner/weekNotes.test.ts` | The pure halves lifted out of `tests/planner/grid.test.ts`. |
| `tests/planner/weekView.test.ts` | View storage keyed by surface; the skeleton's shape. |

**Modified**

| File | Change |
|---|---|
| `src/components/planner/grid.ts` | **Deleted** at the end of Task 7. |
| `src/components/planner/board.ts` | `collectSessions` gains a `showAllGroups` bypass; `renderBoard` threads it. |
| `src/components/planner/columnGrid.ts` | `renderColumnGrid` threads `showAllGroups`. |
| `src/components/planner/blockPopover.ts` | `onOpenSettings` becomes nullable; the edit button is omitted when null. |
| `src/components/planner/plannerApp.ts` | Loses the week's plumbing and `discardHost`; mounts `weekView`. |
| `src/components/site/courseTimetable.ts` | Mounts `weekView`; passes its own weeks and `showAllGroups`. |
| `src/components/planner/publicPlan.ts` | Mounts `weekView`. |
| `src/pages/planlegger/index.astro` | Tab markup moves to `WeekTabs.astro`; `data-surface` on the frame. |
| `src/pages/emne/[code].astro` | Renders `WeekTabs` + frame + notes in the static shell. |
| `src/pages/user/index.astro` | Same. |
| `src/layouts/Layout.astro` | The probe reads `--planner-box` per surface. |
| `src/styles/planner-week.css` | Rader deleted; reservations keyed on `data-surface`. |
| `docs/DESIGN.md`, `docs/ROADMAP.md`, `CLAUDE.md` | The decisions this reverses. |
| `e2e/flows.pw.ts`, `e2e/cls.pw.ts` | Rader references; new budgets. |

---

### Task 1: `showAllGroups` reaches the column and list views

`board.ts:103` calls `applyGroupSelection` unconditionally. With no picks and no programme that is **not** a no-op — `resolveLectureDefaults` still narrows lectures to one default parallel. So the two surviving views cannot express "every parallel and every group", which is the course page's whole rule. This is the enabling change for Task 5.

**Files:**
- Modify: `src/components/planner/board.ts:95-137` (`collectSessions`), `:22-29` (`BoardRenderOptions`), `:186-196` (`renderBoard`)
- Modify: `src/components/planner/columnGrid.ts:57-71` (`ColumnRenderOptions`), `:371-380` (`renderColumnGrid`)
- Test: `tests/planner/board.test.ts`

**Interfaces:**
- Produces: `collectSessions(courses, teachingWeeks, options?: { showAllGroups?: boolean })`; `BoardRenderOptions.showAllGroups?: boolean`; `ColumnRenderOptions.showAllGroups?: boolean`.

- [ ] **Step 1: Write the failing test**

Append to `tests/planner/board.test.ts`. Reuse the fixture shape already at the top of that file — a course state with a bundle whose `timetable` holds two lecture parallels with distinct `title`s and no `studyProgramKeys`.

```ts
describe("collectSessions: showAllGroups is the course page's rule", () => {
  /**
   * `applyGroupSelection` narrows lectures to `resolveLectureDefaults` even
   * with no picks and no programme, so the default path draws ONE parallel.
   * `/emne/[code]/` is the course's own reference page and must draw all of
   * them — which the column and list views had no way to say.
   */
  const twoParallels = courseWith([
    lecture({ title: "Forelesningsparallell 1 Trondheim", day: 1, from: "08:15", to: "10:00" }),
    lecture({ title: "Forelesningsparallell 2 Trondheim", day: 2, from: "08:15", to: "10:00" }),
  ]);

  it("narrows to one parallel by default", () => {
    const sessions = collectSessions([twoParallels], [34, 35]);
    expect(sessions).toHaveLength(1);
  });

  it("draws every parallel under showAllGroups", () => {
    const sessions = collectSessions([twoParallels], [34, 35], { showAllGroups: true });
    expect(sessions).toHaveLength(2);
  });
});
```

Add the two fixture helpers beside the file's existing ones if they are not already there:

```ts
function lecture(o: { title: string; day: number; from: string; to: string }) {
  return {
    dayNumber: o.day,
    startTime: o.from,
    endTime: o.to,
    weeks: "34-40",
    title: o.title,
    name: null,
    rooms: [],
    studyProgramKeys: null,
  };
}

function courseWith(timetable: ReturnType<typeof lecture>[]): PlanCourseState {
  return {
    course: { code: "TDT4100", name: "Objektorientert programmering", version: "1", source: "manual" },
    hueVar: "--hue-blue",
    bundle: { timetable, details: null, exams: [], outcome: "ok" },
    loading: false,
  } as unknown as PlanCourseState;
}
```

- [ ] **Step 2: Run it and watch the second case fail**

```bash
npx vitest run tests/planner/board.test.ts -t "showAllGroups"
```

Expected: the first case PASSES (proving the default really does narrow), the second FAILS with `expected length 1 to be 2` — or a TypeScript error on the third argument, which is the same finding.

- [ ] **Step 3: Thread the option**

`board.ts` — add the parameter and the bypass:

```ts
export interface CollectOptions {
  /**
   * Draw every parallel and every group, bypassing `applyGroupSelection`.
   * `/emne/[code]/` is a reference page for the course, not one student's
   * plan: a visitor deciding which parallel to register for needs all of
   * them, and there is no programme context to guess from. The planner
   * never sets this.
   */
  showAllGroups?: boolean;
}

export function collectSessions(
  courses: PlanCourseState[],
  teachingWeeks: number[],
  options: CollectOptions = {},
): SessionEntry[] {
  const out: SessionEntry[] = [];
  for (const state of courses) {
    const timetable = state.bundle?.timetable;
    if (!timetable) continue;
    const selected = options.showAllGroups
      ? timetable
      : applyGroupSelection(timetable, state.course.groups, state.programCode);
    // …rest unchanged
```

`BoardRenderOptions` and `ColumnRenderOptions` each gain `showAllGroups?: boolean` with a one-line comment pointing at `CollectOptions`, and each render function passes it:

```ts
// board.ts renderBoard
const entries = visibleLayer(
  collectSessions(courses, teachingWeeks, { showAllGroups: options.showAllGroups }),
  showOthers,
).shown;

// columnGrid.ts renderColumnGrid
const entries = mergeSessions(
  visibleLayer(
    collectSessions(courses, teachingWeeks, { showAllGroups: options.showAllGroups }),
    showOthers,
  ).shown,
);
```

- [ ] **Step 4: Run the whole planner unit set**

```bash
npx vitest run tests/planner/
```

Expected: PASS, including the new second case.

- [ ] **Step 5: Commit**

```bash
git add src/components/planner/board.ts src/components/planner/columnGrid.ts tests/planner/board.test.ts
git commit -m "feat(planner): the column and list views can draw every parallel"
```

---

### Task 2: split the judgment out of `grid.ts` into `weekNotes.ts`

`plannerApp.ts:1087` keeps a detached `discardHost` and renders a **complete week nobody will see** into it on every single render, purely to collect the margin notes and the conflict count. That is a workaround for `grid.ts` having two jobs. Give the notes their own function and the workaround disappears.

Nothing changes on screen in this task.

**Files:**
- Create: `src/components/planner/weekNotes.ts`
- Modify: `src/components/planner/grid.ts` (re-export from the new module during the transition)
- Modify: `src/components/planner/plannerApp.ts:1082-1087` (delete `discardHost`), `:2637-2794` (`renderGridAndExams`)
- Create: `tests/planner/weekNotes.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces:

```ts
export interface WeekNotesOptions {
  loading?: boolean;
  pendingChoiceMessage?: string | null;
  showAllGroups?: boolean;
  onChoiceClick?: (code: string) => void;
}

export interface WeekNotesResult {
  conflictCount: number;
  conflictPairCount: number;
  mutedLayerAutoRevealed: boolean;
  /** Courses drawing a provisional lecture pick — the "velg din gruppe" notes. */
  pendingGroupCourses: string[];
  /** Courses whose timetable failed or never arrived (`planGaps`). */
  incompleteCourses: string[];
  /** The check is not the whole plan: loading, or something incomplete. */
  partial: boolean;
  checkedLectureCount: number;
  /** Published sessions but nothing classifiable as a lecture. */
  uncheckedCourses: string[];
  /** Which message branch the week is in, or "grid" when there is one to draw. */
  state: "grid" | "empty" | "loading" | "pending-choice";
  /** The message the caller should draw when `state` is not "grid". */
  message: string | null;
}

export function weekNotes(
  notesHost: HTMLElement,
  courses: PlanCourseState[],
  showOthers: boolean,
  options?: WeekNotesOptions,
): WeekNotesResult;

export function renderWeekMessage(
  frame: HTMLElement,
  notesHost: HTMLElement,
  message?: string,
): void;
```

- [ ] **Step 1: Move the judgment functions verbatim**

Create `src/components/planner/weekNotes.ts` and **cut** these from `grid.ts`, unchanged, with their comments: `buildingLabel`, `PlanGaps`, `planGaps`, `LectureChoice`, `unresolvedLectureChoices`, `isDropIn`, `metaLine`, `blockDetailFor`, `setScrollFade`, `visibleLayer`, `lectureLessCourses`, `BlockDetail`, `BlockClash`, plus `renderGridMessage` renamed to `renderWeekMessage`.

Head the file:

```ts
/**
 * WHAT A WEEK MEANS, as distinct from how it is drawn.
 *
 * These functions used to live in `grid.ts` beside the transposed renderer,
 * which is why `plannerApp` rendered a complete week into a detached
 * `discardHost` on every render just to collect the margin notes. The notes,
 * the conflict count, the honest-gap reporting (DR-8) and the message branches
 * are facts about the WEEK, not about which way round it is drawn — so they
 * belong to neither view and are owned here.
 *
 * `weekNotes()` is the single entry point: it writes the margin and hands back
 * everything the page's verdict, toggle and message branches need.
 */
```

In `grid.ts`, add re-exports so nothing else breaks yet:

```ts
export {
  blockDetailFor, buildingLabel, isDropIn, lectureLessCourses, metaLine,
  planGaps, setScrollFade, unresolvedLectureChoices, visibleLayer,
  type BlockClash, type BlockDetail, type PlanGaps, type LectureChoice,
} from "./weekNotes.js";
```

- [ ] **Step 2: Run the suite to prove the move was lossless**

```bash
mise run check
```

Expected: PASS. A failure here is a move that changed something — revert and redo it as a pure cut-and-paste.

- [ ] **Step 3: Commit the move on its own**

```bash
git add -A && git commit -m "refactor(planner): a week's judgment is not its geometry"
```

- [ ] **Step 4: Write the failing test for `weekNotes()`**

Create `tests/planner/weekNotes.test.ts`. The host is the same minimal fake DOM `tests/planner/board.test.ts` already uses — copy that helper rather than inventing one.

```ts
describe("weekNotes: the margin without a grid", () => {
  it("reports a failed fetch as an incomplete check, not an empty week", () => {
    const host = fakeHost();
    const result = weekNotes(host, [courseWhoseFetchFailed("TMA4100")], false);
    expect(result.incompleteCourses).toEqual(["TMA4100"]);
    expect(result.partial).toBe(true);
  });

  it("counts one collision slot for a three-way clash", () => {
    const host = fakeHost();
    const result = weekNotes(host, threeCoursesAtTheSameHour(), false);
    expect(result.conflictCount).toBe(1);
    expect(result.conflictPairCount).toBe(3);
  });

  it("names the empty-week branch instead of drawing one", () => {
    const host = fakeHost();
    const result = weekNotes(host, [], false);
    expect(result.state).toBe("empty");
    expect(result.message).toBe("Legg til emner for å se ukeplanen.");
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
npx vitest run tests/planner/weekNotes.test.ts
```

Expected: FAIL — `weekNotes is not a function`.

- [ ] **Step 6: Write `weekNotes()`**

It is `renderGrid`'s body with every DOM-building call removed. Lift, in order: `collectEntries` (move it here too — it is the input to every judgment), `lectureLessCourses`, `planGaps`, `unresolvedLectureChoices`, the empty/loading/pending branch ladder (returning `state` + `message` instead of calling `renderWeekMessage`), `visibleLayer`, `mergeSlots`, the `findConflicts`/`groupConflicts` pass, and the margin-note writer at the tail of `renderGrid` (the `notesHost.replaceChildren(...)` block with its `onChoiceClick` wiring).

**Keep the branch ladder's order.** Its comment explains why: a fetch that failed is not a question the student can answer, so telling them to pick a studieretning over it sends them to a control that cannot fix the week.

- [ ] **Step 7: Run the new test**

```bash
npx vitest run tests/planner/weekNotes.test.ts
```

Expected: PASS.

- [ ] **Step 8: Delete `discardHost` and route the planner through `weekNotes`**

In `plannerApp.ts`, delete the `discardHost` declaration at `:1082-1087` and replace both `renderGrid(discardHost, elements.gridNotes, …)` calls (`:2737` and `:2778`) with one call before the view branch:

```ts
const notes = weekNotes(elements.gridNotes, filteredStates, showOthers, {
  loading: anyLoading,
  pendingChoiceMessage: question?.weekMessage ?? null,
  onChoiceClick: openCourseSettings,
});
```

`gridResult` becomes `notes` throughout. The `columns.blockCount === 0 && gridResult.state !== "grid"` fallback at `:2760` becomes:

```ts
if (columns.blockCount === 0 && notes.state !== "grid") {
  renderWeekMessage(elements.gridFrame, elements.gridNotes, notes.message ?? undefined);
}
```

- [ ] **Step 9: Full pass, then the browser**

```bash
mise run check && mise run e2e
```

Expected: both PASS. The planner should look and behave exactly as before.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(planner): the margin no longer needs a week nobody sees"
```

---

### Task 3: a skeleton for the views that survive

`renderSkeleton` in `grid.ts` builds a **Rader** skeleton, and `publicPlan.ts` depends on it: it renders with `loading: true` while every course's bundle is in flight. When Rader goes, that surface would flash an empty frame. `renderColumnGrid` and `renderBoard` have no loading state at all.

**Files:**
- Modify: `src/components/planner/weekView.ts` — not yet created; write the skeleton into `weekNotes.ts` for now and let Task 4 move it. **No** — write it directly into a new `src/components/planner/weekSkeleton.ts` so Task 4 imports rather than moves.
- Create: `src/components/planner/weekSkeleton.ts`
- Modify: `src/styles/planner-week.css`

**Interfaces:**
- Produces: `renderWeekSkeleton(frame: HTMLElement, view: "kolonner" | "tavle"): void`

- [ ] **Step 1: Write the skeleton**

```ts
/**
 * What the frame holds while the bundles are in flight.
 *
 * It exists for the same reason the frame's `min-height` does: the step from
 * "nothing" to "a week" is the largest layout shift on any of these pages, and
 * `/user/<navn>` renders with `loading: true` for the whole of its first
 * round-trip. The shapes are deliberately dumb — the point is that the box is
 * the right size and visibly pending, not that it predicts the week.
 *
 * `SKELETON_HOURS` and `SKELETON_DAYS` are the same numbers the reservation in
 * planner-week.css computes from. Change one and you must change the other.
 */
export const SKELETON_HOURS = 8;
export const SKELETON_DAYS = 5;

export function renderWeekSkeleton(frame: HTMLElement, view: "kolonner" | "tavle"): void {
  frame.replaceChildren();
  frame.setAttribute("aria-busy", "true");
  const shell = el("div", view === "tavle" ? "planner-board is-skeleton" : "planner-cols is-skeleton");
  if (view === "tavle") {
    for (let row = 0; row < SKELETON_DAYS; row++) {
      shell.append(el("div", "planner-skeleton-row"));
    }
  } else {
    shell.setAttribute("data-days", String(SKELETON_DAYS));
    shell.style.setProperty("--planner-hours", String(SKELETON_HOURS));
    shell.append(el("div", "planner-cols-corner"));
    for (let day = 1; day <= SKELETON_DAYS; day++) {
      shell.append(el("div", "planner-cols-day-header"));
    }
    shell.append(el("div", "planner-cols-allday-corner"));
    for (let day = 1; day <= SKELETON_DAYS; day++) {
      shell.append(el("div", "planner-cols-allday"));
    }
    shell.append(el("div", "planner-cols-rail"));
    for (let day = 1; day <= SKELETON_DAYS; day++) {
      const column = el("div", "planner-cols-day");
      column.append(el("div", "planner-cols-lanes"));
      shell.append(column);
    }
  }
  frame.append(shell);
}
```

- [ ] **Step 2: Add the `is-skeleton` treatment**

In `planner-week.css`, beside the column rules:

```css
/* Pending, not empty. The columns are already drawn by the grid template, so
   the skeleton only has to say "this is not the week yet" — a wash over the
   lanes, no shimmer. DESIGN §7 has no entrance choreography, and a pulsing
   week is exactly that. */
.planner-cols.is-skeleton .planner-cols-lanes,
.planner-board.is-skeleton .planner-skeleton-row {
  background: var(--card-nested);
  border-radius: var(--radius-sm);
  opacity: 0.6;
}
.planner-board.is-skeleton .planner-skeleton-row {
  height: 3rem;
  margin-bottom: var(--space-2);
}
```

- [ ] **Step 3: Verify it renders in a build**

```bash
mise run check
```

Expected: PASS (type-level only at this point; nothing calls it yet).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(planner): a pending week for the two views that survive"
```

---

### Task 4: `weekView.ts`, and the planner mounts it

Nothing changes on screen. This is the extraction that makes Tasks 5 and 6 small.

**Files:**
- Create: `src/components/planner/weekView.ts`
- Create: `src/components/WeekTabs.astro`
- Modify: `src/pages/planlegger/index.astro:237-255` (tabs → component), the frame gets `data-surface="planner"`
- Modify: `src/components/planner/plannerApp.ts` — delete `WEEK_VIEW_KEY`/`loadWeekView`/`saveWeekView`/`WEEK_BOX_KEY`/`saveWeekBox`/`setWeekView`/`renderViewTabs`/`syncGridScroll`/the now tick; mount `weekView` instead
- Create: `tests/planner/weekView.test.ts`

**Interfaces:**
- Consumes: `weekNotes` (Task 2), `renderWeekSkeleton` (Task 3), `showAllGroups` (Task 1).
- Produces:

```ts
export type WeekView = "kolonner" | "tavle";
export type WeekSurface = "planner" | "emne" | "user";

export interface WeekViewOptions {
  frame: HTMLElement;
  notes: HTMLElement;
  /** The two buttons `WeekTabs.astro` rendered, or null where a page has none. */
  tabs: { kolonner: HTMLButtonElement; tavle: HTMLButtonElement } | null;
  surface: WeekSurface;
  /** The way out to the editor. `null` on the two read-only surfaces. */
  onOpenSettings: ((code: string) => void) | null;
  /** Called after a view switch, so the page can re-render what depends on it. */
  onViewChange?: (view: WeekView) => void;
  signal: AbortSignal;
}

export interface WeekRenderInput {
  teachingWeeks: number[];
  showOthers: boolean;
  showAllGroups?: boolean;
  loading?: boolean;
  dates?: Map<number, number>;
  todayNumber?: number | null;
}

export interface WeekViewHandle {
  /** Draws the week. Returns how many blocks landed; 0 means draw a message. */
  render(states: PlanCourseState[], input: WeekRenderInput): { blockCount: number };
  /** Replaces the week with a sentence. Releases the reservation. */
  message(text: string | null): void;
  /** Replaces the week with a caller-built card (the planner's recovery states). */
  card(build: (card: HTMLElement) => void): void;
  readonly view: WeekView;
}

export function mountWeekView(options: WeekViewOptions): WeekViewHandle;
```

- [ ] **Step 1: Write the failing test for surface-keyed view storage**

`tests/planner/weekView.test.ts`:

```ts
/**
 * The reservation key. `--planner-box` used to be one height per view, guarded
 * by an id selector so the planner's remembered Liste height could not reach
 * the course page's frame. Three surfaces share two views now, so the guard
 * moves from the selector to the key: a height measured on a five-course
 * planner is not evidence about a one-course course page.
 */
describe("week box storage is keyed by surface", () => {
  it("keeps two surfaces' heights apart", () => {
    saveWeekBox("planner", "tavle", 390, 907);
    saveWeekBox("emne", "tavle", 390, 240);
    expect(loadWeekBox("planner", "tavle", 390)).toBe(907);
    expect(loadWeekBox("emne", "tavle", 390)).toBe(240);
  });

  it("discards a height measured at another width", () => {
    saveWeekBox("emne", "kolonner", 390, 487);
    expect(loadWeekBox("emne", "kolonner", 1200)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run tests/planner/weekView.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write `weekView.ts`**

Move, from `plannerApp.ts`, unchanged except for the surface key: `WEEK_VIEW_KEY`, `WEEK_VIEWS`, `loadWeekView`, `saveWeekView`, `WEEK_BOX_KEY`, `WEEK_BOX_TOLERANCE`, `saveWeekBox` (now `(surface, view, width, height)`), and add the matching `loadWeekBox`. The stored shape becomes:

```ts
// { "planner": { "kolonner": [width, height] }, "emne": { … }, "user": { … } }
```

Then the controller. Its render body is the view branch from `renderGridAndExams`, minus everything about exams:

```ts
function render(states, input) {
  if (input.loading && states.every((s) => s.loading)) {
    renderWeekSkeleton(frame, view);
    return { blockCount: 0 };
  }
  frame.removeAttribute("aria-busy");
  const result =
    view === "tavle"
      ? { blockCount: renderBoard(frame, states, input.teachingWeeks, input.showOthers, {
            showAllGroups: input.showAllGroups,
            todayNumber: input.todayNumber ?? null,
            animate: pendingViewAnimation,
            ...(onBlockClick ? { onBlockClick } : {}),
          }).rowCount }
      : { blockCount: renderColumnGrid(frame, states, input.teachingWeeks, input.showOthers, {
            showAllGroups: input.showAllGroups,
            todayNumber: input.todayNumber ?? null,
            animate: pendingViewAnimation,
            ...(input.dates ? { dates: input.dates } : {}),
            ...(onBlockClick ? { onBlockClick } : {}),
          }).blockCount };
  pendingViewAnimation = false;
  renderTabs();
  syncScroll();
  settleWeekBox();
  return result;
}
```

Also move in: `syncGridScroll` (renamed `syncScroll`, keeping its `.planner-grid` fallback deleted — only `.planner-cols` and the board remain), the `scroll`/`resize` listeners, `renderViewTabs`, `setWeekView`, the `nowTimer`/`visibilitychange` tick calling `syncColumnNow`/`syncBoardNow`, and `settleWeekBox`.

`onBlockClick` is built inside the module from `onOpenSettings`: when it is `null`, **no** click handler is passed and the frame gets `data-static="true"`, which is the existing CSS hook. When it is a function, the module mounts `blockPopover` itself.

- [ ] **Step 4: Run the test**

```bash
npx vitest run tests/planner/weekView.test.ts
```

Expected: PASS.

- [ ] **Step 5: Create `WeekTabs.astro`**

```astro
---
/**
 * The Uke/Liste pair, server-rendered so it is in the static shell on every
 * surface that draws a week. Building it in JS would pop it in a frame late on
 * three pages, and the planner's copy is deliberately THE ONE CONTROL THAT
 * DOES NOT FOLD — a student throws it while reading the week.
 */
interface Props { idPrefix: string }
const { idPrefix } = Astro.props;
---
<div class="planner-view-tabs" role="group" aria-label="Velg hvordan uka vises">
  <span class="planner-view-thumb" aria-hidden="true"></span>
  <button type="button" class="planner-view-tab" id={`${idPrefix}-view-kolonner`} aria-pressed="true">Uke</button>
  <button type="button" class="planner-view-tab" id={`${idPrefix}-view-tavle`} aria-pressed="false">Liste</button>
</div>
```

Replace the inline markup at `planlegger/index.astro:237-255` with `<WeekTabs idPrefix="planner" />`, and move `.planner-view-tabs` / `.planner-view-tab` / `.planner-view-thumb` styles from that page's scoped block into `planner-week.css` — a page-scoped rule ships only with that page, which is exactly how two copies drift apart.

- [ ] **Step 6: Mount it from `plannerApp.ts`**

```ts
const week = mountWeekView({
  frame: elements.gridFrame,
  notes: elements.gridNotes,
  tabs: { kolonner: elements.viewKolonner, tavle: elements.viewTavle },
  surface: "planner",
  onOpenSettings: openCourseSettings,
  onViewChange: () => renderGridAndExams(),
  signal: lifeSignal,
});
```

`renderGridAndExams`'s week branch collapses to `week.render(filteredStates, {...})`, and its message branches to `week.message(...)` / `week.card(...)`.

- [ ] **Step 7: Full pass, then the browser**

```bash
mise run check && mise run e2e
```

Expected: both PASS. The planner is byte-for-byte the same experience.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(planner): the week becomes one thing a page mounts"
```

---

### Task 5: `/emne/[code]/` gets the planner's week

**Files:**
- Modify: `src/pages/emne/[code].astro:156-162` (the timetable section's shell), the scoped style block
- Modify: `src/components/site/courseTimetable.ts`
- Modify: `src/components/planner/blockPopover.ts:116-119`
- Test: `tests/site/courseTimetable.test.ts`

**Interfaces:**
- Consumes: `mountWeekView` (Task 4), `showAllGroups` (Task 1).
- Produces: `weeksOf(entries: CourseTimetableEntry[]): number[]` from `courseTimetable.ts`.

- [ ] **Step 1: Make the popover's edit button optional**

```ts
/**
 * `onOpenSettings` is the way out to the editor, and two of the three surfaces
 * that draw a week have no editor to open — `/emne/[code]/` is one course's
 * reference page and `/user/<navn>` is somebody else's plan. Passing `null`
 * omits the button; the card is then facts only, which is what it mostly was.
 */
export function mountBlockPopover(
  onOpenSettings: ((code: string) => void) | null,
  signal: AbortSignal,
): BlockPopoverHandle {
```

At `:272`, guard the button:

```ts
if (onOpenSettings) {
  const edit = el("button", "np-btn block-popover-edit", editVerb(ctx.choice));
  // …unchanged
}
```

- [ ] **Step 2: Write the failing test for the off-term weeks**

`renderColumnGrid` filters through `entriesInSemester(…, teachingWeeks)`. The course page's `entriesForSemester` deliberately falls back to the newest term when nothing intersects the planned semester — and those weeks are by definition not the planned semester's, so the fallback would filter to empty and the page would draw nothing where it used to draw last term's honest timetable.

In `tests/site/courseTimetable.test.ts`:

```ts
describe("weeksOf: the fallback week still draws", () => {
  /**
   * An autumn-only course while the student plans spring. `entriesForSemester`
   * has already fallen back to the autumn term; handing the column view the
   * SPRING teaching weeks would filter that fallback straight back out.
   */
  it("returns the weeks the drawn entries carry, not the semester's", () => {
    const autumn = [
      { dayNumber: 1, startTime: "08:15", endTime: "10:00", weeks: "34-40", term: "2026_HØST" },
      { dayNumber: 3, startTime: "10:15", endTime: "12:00", weeks: "41,42", term: "2026_HØST" },
    ] as CourseTimetableEntry[];
    expect(weeksOf(autumn)).toEqual([34, 35, 36, 37, 38, 39, 40, 41, 42]);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
npx vitest run tests/site/courseTimetable.test.ts -t "weeksOf"
```

Expected: FAIL — `weeksOf is not a function`.

- [ ] **Step 4: Write `weeksOf`**

```ts
/**
 * The weeks the drawn entries actually carry, ascending and deduped.
 *
 * The two surviving views filter through `entriesInSemester`, and this page
 * cannot hand them the planned semester's teaching weeks: `entriesForSemester`
 * falls back to the newest term the response carries when nothing intersects,
 * and that fallback's weeks are by definition not the planned semester's. The
 * narrowing has already happened by then, so the honest filter is a no-op over
 * exactly these.
 */
export function weeksOf(entries: CourseTimetableEntry[]): number[] {
  const weeks = new Set<number>();
  for (const entry of entries) for (const week of parseWeeks(entry.weeks)) weeks.add(week);
  return [...weeks].sort((a, b) => a - b);
}
```

- [ ] **Step 5: Run it**

```bash
npx vitest run tests/site/courseTimetable.test.ts
```

Expected: PASS.

- [ ] **Step 6: Put the shell in the page**

`emne/[code].astro`'s timetable section becomes:

```astro
<section class="emne-section" id="timetable-section" data-surface="emne">
  <div class="emne-section-head-row">
    <h2 class="np-kicker emne-section-head">Timeplan</h2>
    <WeekTabs idPrefix="emne" />
  </div>
  <p class="emne-loading np-hint" data-role="status" data-reserve aria-live="polite">
    Henter timeplanen …
  </p>
  <div data-role="body" hidden></div>
</section>
```

The tabs are in the static shell but must not be pressable before there is a week: give the wrapper `hidden` and let `mountCourseTimetable` remove it once it has entries. Style `.emne-section-head-row` as a `flex` row with `justify-content: space-between` and `align-items: baseline`.

- [ ] **Step 7: Mount the week**

In `courseTimetable.ts`, replace the `renderGrid` call, the two scroll helpers and the `fitBlockLabels` resize listener with:

```ts
const week = mountWeekView({
  frame,
  notes,
  tabs: tabsFor("emne"),
  surface: "emne",
  // No editor on this page: the popover answers "what is this session", which
  // is exactly what a reference page owes a visitor deciding which parallel to
  // register for. There is no course-settings modal here to send them to.
  onOpenSettings: null,
  onViewChange: () => draw(toggle.getAttribute("aria-pressed") === "true"),
  signal: options.signal ?? new AbortController().signal,
});

function draw(showOthers: boolean): void {
  const drawn =
    scope === "mine" ? applyGroupSelection(shown, options.selectedGroups, programCode) : shown;
  state.bundle = bundleFromEntries(drawn);
  const notesResult = weekNotes(notes, [state], showOthers, { showAllGroups: true });
  week.render([state], {
    teachingWeeks: weeksOf(drawn),
    showOthers,
    showAllGroups: true,
    todayNumber: todayInWeeks(weeksOf(drawn)),
    ...(datesFor(weeksOf(drawn)) ? { dates: datesFor(weeksOf(drawn)) } : {}),
  });
  if (notesResult.mutedLayerAutoRevealed) toggle.setAttribute("aria-pressed", "true");
}
```

`todayInWeeks` / `datesFor` are the mønsteruke rule, shared: inside the drawn weeks the day headers carry the day-of-month and today gets its disc; outside them the numerals come off. Reuse `weekdayDates` from `src/lib/planner/weekDates.ts` rather than writing a second clock.

**Delete** the `frame.dataset.static = "true"` line and the `block.tabIndex = -1` loop — `mountWeekView` owns that now, and this surface no longer wants it.

- [ ] **Step 8: Full pass, then the browser**

```bash
mise run check && mise run e2e
```

Expected: `mise run e2e` FAILS on the four Rader assertions in `e2e/flows.pw.ts` (lines 42, 662, 1721, 1987). That is the expected failure — Task 7 removes them. Confirm every OTHER browser test passes before continuing.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(emne): the course page draws the week the planner draws"
```

---

### Task 6: `/user/<navn>` gets it too

`publicPlan.ts:12` claims *"one renderer for three surfaces… so a shared week is the same week the sharer is looking at"*. That stopped being true when the planner moved to columns. This makes it true again.

**Files:**
- Modify: `src/components/planner/publicPlan.ts:183-260`
- Modify: `src/pages/user/index.astro`

- [ ] **Step 1: Put the tabs in the shell**

`user/index.astro` renders `<WeekTabs idPrefix="user" />` beside the week's heading and puts `data-surface="user"` on the section. `publicPlan.ts` builds the frame at runtime today; move the frame and notes into the Astro shell too, so the reservation is held from first paint like the other two.

- [ ] **Step 2: Mount the week**

```ts
const week = mountWeekView({
  frame,
  notes,
  tabs: tabsFor("user"),
  surface: "user",
  // Somebody else's plan. There is nothing here for a viewer to change, which
  // is the whole of what the page is (`parsePublicPlan` writes nothing).
  onOpenSettings: null,
  onViewChange: () => draw(loadingNow),
  signal,
});

const draw = (loading: boolean): void => {
  weekNotes(notes, states, false, { loading });
  week.render(states, {
    teachingWeeks: semester?.teachingWeeks ?? [],
    showOthers: false,
    loading,
    todayNumber: todayWeekday(semester),
    ...(dates ? { dates } : {}),
  });
};
```

Delete `syncScroll`, the `fitBlockLabels` call, the `block.tabIndex = -1` loop and `frame.dataset.static`.

- [ ] **Step 3: Fix the docstring**

`publicPlan.ts:11-13` — the sentence is true again, but "one renderer for three surfaces" now names `weekView`, not `renderGrid`. Update it to say so.

- [ ] **Step 4: Verify the round-trip**

```bash
mise run check
npx playwright test e2e/flows.pw.ts -g "shared plan"
```

Expected: PASS. `/api/sync/*` runs against `wrangler dev`'s local KV, so this exercises the real handler.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(user): a shared week is the sharer's week again"
```

---

### Task 7: delete Rader

Nothing draws it now.

**Files:**
- Delete: `src/components/planner/grid.ts`
- Modify: `src/styles/planner-week.css`
- Modify: `tests/planner/grid.test.ts` → deleted, its pure halves already in `weekNotes.test.ts`
- Modify: `e2e/flows.pw.ts:42, 662, 1721, 1987`

- [ ] **Step 1: Delete the module**

```bash
git rm src/components/planner/grid.ts tests/planner/grid.test.ts
```

Fix the imports this breaks: `columnGrid.ts:40` and `blockPopover.ts:29` both import from `./grid.js` and must import from `./weekNotes.js`.

- [ ] **Step 2: Delete the CSS**

From `planner-week.css`, remove: `.planner-grid`, `.planner-row`, `.planner-spine`, `.planner-field`, `.planner-block` and every descendant, `.planner-ruler`, `.planner-now`, `--planner-spine`, `--planner-lane-h`, `--planner-bar-h`, `--planner-band-h`, `--planner-row-pad`, `--planner-box-rader`, the `.planner-grid-frame:has(.planner-grid)` pin rule, and the `@media (max-width: 40rem) { .planner-grid { min-width: 32rem } }` block.

Rewrite the file's header comment: it currently opens *"UKEPLAN — geometry and ink for the weekly spread rendered by `src/components/planner/grid.ts`… `.planner-grid` is a stack of day ROWS"*, which will describe nothing.

- [ ] **Step 3: Update the browser suite**

Four places in `e2e/flows.pw.ts` name Rader on `/emne/`:
- `:42` — the comment about `.planner-block` surviving on `/emne/[code]/`
- `:662` — "The transposed grid is /emne/[code]/'s alone now"
- `:1721` — "`/emne/[code]/` mounts `renderGrid` into its own `.planner-grid-frame`"
- `:1987` — "`fitBlockLabels` belongs to the transposed grid"

Rewrite the first three against `.planner-cols-block`. **Delete** the fourth: `fitBlockLabels` no longer exists, and a test of a deleted mechanism is not a test.

- [ ] **Step 4: Grep for stragglers**

```bash
grep -rn "renderGrid\|planner-grid\b\|planner-block\|fitBlockLabels\|Rader\|transposed" src/ e2e/ tests/ docs/ CLAUDE.md
```

Expected: only `.planner-grid-frame` and `.planner-grid-notes` (both kept — the frame and the margin are geometry-neutral) and the doc lines Task 9 rewrites.

- [ ] **Step 5: Full pass**

```bash
mise run check && mise run e2e
```

Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: delete Rader"
```

---

### Task 8: re-measure the reservations

**These numbers are evidence, not arithmetic.** Every one is measured in Chromium against the real stylesheets, and each is set a few px **under** its measured settle so the residual nudges down rather than snatching content upward.

**Files:**
- Modify: `src/styles/planner-week.css` (the reservation block at `:114-138`)
- Modify: `src/layouts/Layout.astro:196-232` (the probe reads the surface)
- Modify: `e2e/cls.pw.ts`

- [ ] **Step 1: Teach the probe about surfaces**

`Layout.astro` renders `data-surface` on `<html>` from a page prop (`planner` | `emne` | `user` | none). `applyWeekBox` reads it and looks the height up under `saved[surface][view]`. Keep the default view agreement note — the probe's default must still match `loadWeekView`'s (`kolonner`), or a cold load reserves for a view it is not about to draw.

- [ ] **Step 2: Re-key the CSS**

```css
/* Each surface reserves its own view's height. The guard used to be an id
   selector — the planner's frame alone — because one `--planner-box` held one
   height and a remembered Liste height must never reach a one-course page. The
   guard is now the KEY (surface, view, width), so the selector can be shared. */
.planner-grid-frame[data-reserve] {
  min-height: calc(2 * var(--planner-frame-pad-block) + var(--planner-box, var(--planner-box-uke)));
}
html[data-view="tavle"] .planner-grid-frame[data-reserve] {
  min-height: calc(2 * var(--planner-frame-pad-block) + var(--planner-box, var(--planner-box-liste)));
}
.planner-grid-frame:not([data-reserve]) { min-height: 0; }
```

with per-surface fallbacks:

```css
[data-surface="planner"] { --planner-box-uke: …; --planner-box-liste: …; }
[data-surface="emne"]    { --planner-box-uke: …; --planner-box-liste: …; }
[data-surface="user"]    { --planner-box-uke: …; --planner-box-liste: …; }
```

Uke's is exact arithmetic and carries over unchanged:
`calc(var(--planner-cols-head-font) + var(--space-2) + 1px + N * var(--planner-hour-h))`, with `N` the drawn hours — 8 for the planner, and **measured** for a one-course page, which typically draws fewer.

Liste's cannot be arithmetic — its height is a session count — so it stays a fitted line in `--plan-courses`, refitted per surface.

- [ ] **Step 3: Measure**

```bash
npm run build && npm run preview &
```

Then, for each of the six (surface × view) pairs, at 390px and 1280px, with a **one-course** plan: load the page, let the week settle, read `document.querySelector('.planner-grid-frame').getBoundingClientRect().height`. Write each number into the CSS a few px under what you read, with the measurement in a comment beside it.

**A one-course plan is required.** A full plan draws a week taller than every reservation, so slack is zero whether or not the lease is released — the first version of this gate passed with both halves of the fix disabled.

- [ ] **Step 4: Set the budgets**

Add `/emne/[code]/` and `/user/<navn>` to `e2e/cls.pw.ts` in both views, at the per-surface budgets the measurements justify.

- [ ] **Step 5: Verify the gate actually gates**

Comment out the `min-height` rule, run `npx playwright test e2e/cls.pw.ts`, and confirm it FAILS. Restore it and confirm it passes. A reservation test that passes with the reservation removed is not a test.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "perf: each surface reserves its own view's height"
```

---

### Task 9: the docs this reverses

**Files:**
- Modify: `docs/DESIGN.md`, `docs/ROADMAP.md:70`, `CLAUDE.md`

- [ ] **Step 1: `docs/DESIGN.md`**

- §9's "Two views, and they are Uke and Liste" (`:319-322`): delete the sentence about `grid.ts` surviving for `/emne/[code]/`. Replace with: the two views are drawn on all three surfaces that show a week.
- §9's course-page entry (`:681-…`): delete the inert-blocks paragraph and its false premise. State the correction: the popover is a read surface, so the course page's blocks are live and the card answers "what is this session" without an edit button, because there is no editor on that page.
- Add the dating rule once, for all three surfaces: inside the teaching period the headers carry the day-of-month and today its disc; outside it, a mønsteruke. Delete "`/emne/`'s reference week is nobody's particular Tuesday".
- Keep §9's "Default is all, per visit, never persisted" and the `showAllGroups` reasoning — both still hold, and `showAllGroups` is now a `collectSessions` option rather than a `renderGrid` one.

- [ ] **Step 2: `docs/ROADMAP.md:70`**

"with the third transposed geometry kept only for `/emne/[code]/`" → the two views are what every week-drawing surface uses.

- [ ] **Step 3: `CLAUDE.md`**

The layout-shift bullet's (b) clause is written entirely around the transposed geometry belonging to `/emne/[code]/` and the planner's rules being scoped by id. Rewrite it around the surface key: what the lease is, why it is per (surface, view, width), and that a gate for it needs a one-course plan. Keep every other sentence in that bullet — the lease, `settleWeekBox`, the probe's default agreeing with `loadWeekView`'s — they are all still true.

- [ ] **Step 4: Verify the copy gate**

```bash
npx vitest run tests/copy.test.ts && mise run check
```

Expected: PASS. The docs keep their em-dashed register on purpose; only `src/` and `worker/` strings are scanned.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: one week, three surfaces"
```

---

## Self-review notes

- **Spec §1** → Task 4. **§2** → Task 2 (+ deletion in Task 7). **§3** → Task 1. **§4** → Task 5 steps 2-5. **§5** → Task 8. **§6** → Task 5 step 1. **§7** → Tasks 5 and 6. **§8** → Task 6 step 3. Docs → Task 9.
- **One gap the spec did not name:** `publicPlan.ts` renders with `loading: true` for its whole first round-trip and depends on `renderGrid`'s Rader skeleton, which Task 7 deletes. Task 3 was added for it.
- **Expected red:** Task 5 step 8 leaves `e2e/flows.pw.ts` failing on four Rader assertions until Task 7. That is stated at the step rather than discovered.
