# REWORK 2026-07-29 — one editing surface, and a day view

User mandate, 2026-07-29. Supersedes the parts of
`REWORK-2026-07-25-design.md` named below. Where this document and
`docs/DESIGN.md` conflict, this document wins — the user is the judge of the
result.

## The complaint

1. The planner is ugly and reads badly.
2. Parallel/group selection is buried in a block popover reachable only by
   clicking a rendered block. It belongs with the course, on a settings
   surface the course list opens too, and the remove action belongs there
   with it.
3. "Click a block, get a floating card" is not good enough.
4. Simultaneous courses are hard to read: a cluster deeper than the column
   cap collapses into one pile slab, and the pile is a dead end.

## The decisions

**D1 — One shared course-settings modal.** A single `<dialog>`, opened by
`showModal()`, is the only place a course is configured. It is opened from a
course row in the Emner list and from any block in the week or day view.
`popover.ts` is deleted.

**D2 — The course row carries identity, not facts.** Hue dot, code, name,
credits. No vurderingsform (that is exam material — D6), no "which parallel
am I in" line: once a parallel is set, the student does not look at it
again. The whole row is the control that opens the modal.

**D3 — The remove action moves into the modal.** PRODUCT.md §0.3's "one tap
to restore" is explicitly relaxed by the user: two taps is fine. The row no
longer carries a Dropp/Fjern button. A dropped programme course still grays
in the list, so the state stays visible where it always was.

**D4 — A day view, entered by expanding one day column.** The week grid gains
a focused mode: one weekday at full width, the other columns collapsed to
nothing. It is the same `renderGrid` — `.planner-grid` is
`grid-template-columns: 3rem repeat(var(--planner-days), 1fr)` and blocks are
absolutely positioned from `--planner-row-start × --cell`, so vertical
geometry is independent of how many days are shown. Focusing a day changes
horizontal track sizes and nothing else; every block keeps its exact `top`
and `height`.

**D5 — Piles open the day.** A pile is the grid saying "too dense to read
here". Clicking it focuses its day, where the column is wide enough to split
the cluster into real side-by-side blocks. `BlockDetail` gains `dayNumber` to
make that routing possible. The pile's `kind: "info"` popover context is
deleted along with `popover.ts`.

**D6 — Vurderingsform moves to the exam list.** It is exam material and the
exam section is where it goes.

**D7 — The transition is a horizontal expansion, nothing else.** DESIGN §6's
"no entrance choreography" is set aside for this one interaction by explicit
user instruction. `grid-template-columns` is animatable; the collapse/expand
is a CSS transition on that property over `--dur` with `--ease`. No
scripted FLIP, no View Transitions API, no cross-fade, no vertical motion.

## The surfaces

### `courseSettings.ts` (new — replaces `popover.ts`)

One `<dialog class="np-frame course-settings">`, mounted once, `showModal()`.
Native modal dismissal (Esc, focus return to the invoker) replaces the ~120
lines of hand-wired positioning, outside-pointerdown dismissal, anchor
re-resolution (`refreshInvoker`) and flip-above-when-no-room math that only
existed because the popover was a non-modal card pinned to a block.

One thing does NOT come free with `showModal()`, and the browser suite caught
it: focus return works only while the invoker is still in the document, and
Dropp/Fjern is exactly the case where it is not — the grid re-renders without
that block, `focus()` on a detached node is a silent no-op, and focus falls to
`<body>` (audit a11y-3, straight back). So `restoreFocus` stays: the course's
own row in the Emner list catches it, since that surface still shows the course
and reopens this dialog, with the week frame as the last resort.

Content:

- **Head** — hue dot, mono code, course name, and a close button.
- **Facts** — credits, and the semester-status line the course row used to
  carry (`undervises ikke i valgt semester`, `ikke undervist i {year}`,
  fetch failures with their retry).
- **Grupper** — the picker moved verbatim from `popover.ts`:
  `pickableGroups`, `lecturesAreExclusive`, `nextSelection`, the
  radios-vs-checkboxes rule, the `(din parallell)` label, the
  "Uten avkryssing viser uka alle forelesningene vi tror er dine." note, and
  "Nullstill gruppevalg". These functions are already pure and unit-tested;
  they move modules, they do not change.
- **Actions** — `Dropp` / `Legg tilbake` / `Fjern fra planen` per
  `CourseSource` and `dropped`, and `Gå til emnesiden →`.

Every group edit still writes through `store.setCourseGroups` immediately.
The grid re-renders behind the modal; because the modal is centered and not
anchored to a block, the re-render can no longer move it — `refreshInvoker`
and `position` are dropped, not ported.

### The week grid (`grid.ts`, `planner-week.css`)

- `GridRenderOptions.focusDay?: number | null` — the weekday to expand.
- `GridRenderOptions.previousFocusDay?: number | null` — what the grid was
  showing before, so the render can animate from it.
- `GridRenderOptions.onDayFocus?: (day: number) => void` — makes the day
  headers real buttons.
- `BlockDetail.dayNumber` — so a pile click can name its day.
- In focused mode the focused day's clusters get a raised column cap
  (`DAY_MAX_COLUMNS = 4`) since the column is now the width of the grid;
  the other days keep the week cap and are invisible behind
  `overflow: hidden` anyway.
- `buildGridShell` writes `grid-template-columns` inline: the week template
  is `3rem repeat(n, 1fr)`, the day template is `3rem` followed by `1fr` for
  the focused day and `0fr` for every other. Track *count* is identical in
  both, which is what makes the property interpolable.
- When `previousFocusDay !== focusDay`, the fresh grid is appended carrying
  the *previous* template inline, then flipped to the target template on the
  second animation frame, so the CSS transition has two states to run
  between. Under `prefers-reduced-motion` the duration tokens are already
  zero, so this degrades to an instant swap with no extra code.
- `.planner-grid-day` and `.planner-grid-day-header` get `overflow: hidden`
  so collapsed columns clip their contents instead of spilling. NOT scoped to
  the day view: the day→week direction animates on a grid that carries no
  `data-view`, and needs the clip just as much on the way out.
- The day headers are buttons, but the expanded one gets accent **ink**, never
  a fill. A fill was tried and is what a 1fr column does with it: a full-width
  green slab across the top of the week, restating what the day strip four
  pixels above already says.

### `plannerApp.ts`

- `focusDay: number | null` render state, reset to `null` on semester or
  plan-identity changes.
- A segmented control in the week's section head: `Uke · Man · Tir · Ons ·
  Tor · Fre` (+ `Lør` when the grid draws six days), `aria-pressed` on the
  active one.
- `onBlockClick`: a pile (`detail.code` contains `" · "`) focuses
  `detail.dayNumber`; a single block opens the course settings modal.
- `renderCourseRows` reduced to D2's row, with the whole row a `<button>`
  that opens the modal. The `pendingFocusCode` refocus dance goes away with
  the row's action button.

### `examList.ts`

`examRow` and `datelessRow` gain the course's `assessmentScheme` as a
`.np-note` fragment, resolved from the `PlanCourseState[]` the renderer
already receives.

## Out of scope here

The broader visual pass (page chrome above the week, block resting ink,
type and colour) is a separate piece of work. This document covers the
editing model and the day view only.
