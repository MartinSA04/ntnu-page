# P10 — Mobile + Accessibility

Lens: students live on phones between lectures. This audits the planned
surfaces against a 390×844 viewport, one thumb, patchy campus wifi, and
screen-reader/keyboard-only use. I read the actual code, not just the spec:
`src/pages/planlegger/index.astro`, `src/components/planner/plannerApp.ts`,
`src/components/site/studyPlan.ts`, `src/styles/{tokens,primitives}.css`.

**Headline finding: there are zero `@media` queries anywhere in the
codebase except one for `prefers-reduced-motion`.** The weekly grid ships
with `min-width: 40rem` inside `overflow-x: auto` — on a 375px-wide phone
that is a horizontally-scrolling timetable with no visible affordance that
it scrolls. `--control-h` (the height of every button/toggle/field) is
**36px**, under the 44px touch-target floor, site-wide. This is not "needs
polish" — mobile is currently a shrunk desktop by omission, exactly the
failure mode this brief warns against. Everything below is what "first
class" requires instead.

---

## 1. The weekly grid: this is the one that needs a real layout transform

**Verdict: do not ship the ruled Mon–Fri×08–20 grid to narrow viewports,
even scrollable.** Reasoning:

- A 5-day × 12-hour grid needs roughly 40rem to show blocks with legible
  text (the code has this exact number). A phone viewport is ~23rem of
  usable width. Shrinking columns below ~5rem makes `.planner-block`'s two
  lines of course name, room, and week range unreadable — the block-head
  code + wavy-red clash mark is the *entire point* of the surface, and it's
  the first thing to get squeezed.
- Horizontal scroll-to-explore is a bad primitive for "what's on right now"
  — a student checking the plan between classes needs today's schedule
  without a horizontal gesture hunt, and horizontal scroll fights the
  vertical scroll of the page it's embedded in (scroll-direction ambiguity
  at the frame edge is a classic mobile-web papercut, doubly so inside
  `overflow-x: auto` with no `overscroll-behavior` isolation, which the
  current CSS doesn't set).
- Sticky day headers (`.planner-grid-day-header { position: sticky; top: 0 }`)
  only make sense when the whole grid is the scroll container in one axis;
  combined with horizontal scroll they produce a corner-locked header that
  reads fine on desktop, confusing on a scrubbing thumb.

**Transform: day-scroller below a breakpoint (~640px).** Same data, same
`.np-ruled` signature, restructured as one vertical day at a time:

```
UKEPLAN                          uke 34–47
[MAN][TIR][ONS][TOR][FRE]         ← .np-toggle row, horizontally
  ^^^                                scrollable if needed, snap-x,
                                     today pre-selected + underlined
┌ .np-frame.np-ruled ───────────────────────┐
│ 08                                         │
│ 10  ▪TDT4100 Objektorientert... 10:15–12:00│
│     ~wavy-red~ kolliderer med TMA4100      │  ← inline, not a separate
│ 12                                         │     margin note — margin
│ 14  ▪TMA4100 Matematikk 1  14:15–16:00     │     notes don't work when
│ ...                                         │     there's no margin
└─────────────────────────────────────────────┘
▸ 2 kollisjoner denne uken → tap scrolls to first
```

- Single vertical axis, one `--cell`-height ruled column, blocks are
  full-width rows (stacked, not side-by-side splits — the 2-way
  side-by-side split rule from PLANNER.md §5 is a desktop-only concession;
  on mobile stack overlapping blocks in start-time order, each still
  showing its own clash mark, because side-by-side at ~5rem block width is
  unreadable).
- Day chips are real `.np-toggle`s (`aria-pressed`), not a scroll-position
  proxy — keyboard/switch users need to *select* a day, not scrub to it.
  Default to the current teaching day if the semester is live, else the
  first taught day.
- The margin-note clash line (desktop: a mono line below the grid pointing
  at a block) becomes an **inline** wavy-red note directly under the
  colliding block's time range on mobile — there is no margin, and forcing
  the student to correlate a note three sections away with a tiny block up
  top is worse than repeating the sentence. This is a genuine content
  restructure, not a CSS reflow: `grid.ts`/`examRibbon.ts`-equivalent
  render logic needs a mobile branch that emits the clash sentence as a
  child of the block, not a sibling list item.
- Breakpoint choice: key off `--maxw`-style container width via a single
  `@media (max-width: 640px)` that swaps `.planner-grid` (CSS Grid,
  absolute-positioned blocks) for `.planner-daylist` (flex column, static
  blocks) — two render paths in `grid.ts`, sharing the same
  `PlanCourseState[]`/conflict data, not two data models. This is a
  meaningful chunk of net-new work, not a stylesheet tweak.

## 2. Exam ribbon: the same problem, smaller stakes, easier fix

The ribbon is absolutely-positioned dots along a date axis
(`--planner-pos` percentage offsets). At phone width, dots for exams spread
across a 4-month semester compress to a few pixels apart — same-day
stacking (already outlined-red for clashes) becomes indistinguishable from
2-days-apart stacking. The ribbon's entire value is *seeing the shape* of
exam spacing at a glance; that value degrades gracefully on a laptop and
breaks on a phone.

**Transform: keep the ribbon down to ~480px (it's genuinely useful as an
overview even compressed — Flexoki dots against ruled paper survive small),
then let the list underneath carry the real information.** The list
(`date — ▪code — form — gap annotation`) is already the accessible,
information-dense version — PLANNER.md already specs it. On mobile it
should not be a "detail view below the visual" but promoted to *the*
primary view, with the ribbon becoming a thin decorative strip (reduce its
height, drop the month-label row which duplicates each list row's date) or
collapsed behind a `.np-summary` disclosure ("Vis eksamensoversikt som
tidslinje") for students who want it. Nobody scans a 6px-wide ribbon to
find a gap; everybody reads "25. nov — ▪TDT4100 — skriftlig · 2 dager til
neste."

## 3. Basket, typeahead, course rows: mostly fine, fix the specifics

- **Basket tags** (`.np-tag` with `×` remove): `padding: 0.3em 0.6em` at
  `--text-xs` — the whole tag is maybe 24px tall, and the `×` remove glyph
  (`.planner-tag-remove`, `padding: 0 0.15em`) is a separate tap target
  smaller than that. On mobile this is the single easiest mis-tap in the
  whole product — a student trying to remove TDT4100 will clip TMA4100's
  tag or miss both. Fix: the tag stays visually compact (it's also on
  desktop and in study-plan rows), but the tappable remove zone needs an
  invisible padded hit area to 44×44px (`::after` expanding the hit region,
  or a min-width/min-height on `.planner-tag-remove` with `display: inline-flex;
  align-items:center;justify-content:center`) — don't enlarge the tag chrome,
  enlarge the *hit target* around the same visual glyph.
- **Typeahead add field**: `role="combobox"` + `aria-controls` listbox is
  the right pattern. On mobile, `max-height: 16rem` for the listbox eats
  half the viewport when the on-screen keyboard is also up — verify the
  listbox scrolls *within itself* under the visible-viewport-minus-keyboard
  height (use `max-height: min(16rem, 50dvh)` so iOS Safari's keyboard
  doesn't push the listbox off-screen entirely). Each option row
  (`.planner-typeahead-option`, `padding: var(--space-2)`) should be
  audited to ≥44px row height — course code + name in one line at
  `--text-sm`/`--text-xs` is probably ~32px today.
- **"+ legg til emne" as the only add path in the basket**: fine on
  desktop where hover/typeahead is fluid; on mobile, opening a keyboard to
  type 3 characters of a course code for a course the student is *already
  looking at* (came from `/emne/[code]` or `/studier/[code]`) is friction
  the "Legg til i planen" buttons on those pages already solve — just
  confirming those inline add buttons are the primary mobile path in and
  the planner's own typeahead is the fallback for "I don't have the page
  open."
- **Course rows** (`.planner-course-row`, `flex-wrap: wrap`): code, name,
  credits, campus, assessment, remove button all in one wrapping flex row.
  At 375px this wraps into a ragged 3–4 line block per course; with 6+
  courses that's a long scroll of uneven rows. It's not broken, just
  untidy — worth a mobile-specific `grid-template-columns: auto 1fr;
  grid-template-areas` (code+name on row 1, meta as a single mono line row
  2, remove button pinned top-right as an icon not a text button) so scan
  rhythm stays even. Lower priority than §1/§2.
- **Semester toggle chips**: two/three `.np-toggle`s at 36px height,
  `flex-wrap: wrap` — acceptable at 375px (they're short labels: "HØST
  2026"), but raise to 44px height per the global control-height fix below.

## 4. Study plan page (`/studier/[code]`): touch targets, disclosure depth

- **Per-course add button** is `.np-icon-btn` (36×36px per token) — a bare
  "+" glyph with no visible label, inside a `.plan-course-row` that also
  holds a code link and name. This is the highest-density add-control on
  the site (a study plan can have 8-course periods) and it's simultaneously
  the smallest tap target and the one most likely to be tapped in a
  crowded list. Needs the 44px floor non-negotiably, plus confirm the
  `aria-label="Legg til CODE i planen"` pattern from PLANNER.md §5 is
  actually implemented (spec says it should be; verify in `studyPlan.ts`
  rather than assume).
- **"Legg til alle" per period header**: a real `.np-btn`, fine as a target
  — but on mobile, a period can hold obligatory + choice courses (retning
  waypoints); "add all" bulk-adding an entire choice group the student
  hasn't chosen between yet is a footgun on any viewport, worse on mobile
  where reviewing what just got added means scrolling back up through a
  long single-column list. Not a layout issue — a content one: "Legg til
  alle" should probably only appear on period headers with no unresolved
  choice groups underneath, or choice groups need their own scoped
  "legg til denne retningen" rather than inheriting the period's bulk add.
  Flagging for the interaction-design lens too, but it's a mobile-severity
  issue because recovery (removing 5 wrongly-added electives) is more
  taps on a phone.
- **Waypoint disclosures** (`<details class="plan-waypoint">`): native
  `<details>` is the right call — free keyboard support, free
  screen-reader semantics, no ARIA to get wrong. Good. Just confirm the
  summary row itself is ≥44px (it likely inherits `.np-summary`'s row
  height — check that against the same control-height token).
- **Long single-column list on mobile**: periods → groups → courses,
  potentially 8 semesters deep for a full program. This wants a "jump to
  your semester" affordance beyond the mono "ditt semester" kicker label —
  on desktop the auto-highlighted period is probably in the initial
  viewport or one scroll away; on mobile it can be 10+ screens down. A
  sticky "hopp til ditt semester ↓" chip that appears once the highlighted
  period has scrolled out of view (IntersectionObserver-driven, cheap) is
  worth it given first-years land here from onboarding.

## 5. Site-wide touch-target and viewport fixes

- **`--control-h: 36px` → needs a mobile override to 44px minimum.**
  This one token underlies `.np-btn`, `.np-toggle`, `.np-field`,
  `.np-icon-btn` — every interactive control on the site. Cheapest highest-
  leverage fix in this whole review: `@media (pointer: coarse) { :root {
  --control-h: 44px; } }` (or a max-width media query if pointer-media
  support is a concern) upgrades every button, toggle, chip, and field
  site-wide from one token change. Keep 36px for mouse/desktop where
  precision is higher and density matters more — this is exactly what
  `pointer: coarse` is for, don't just blanket-raise it and cost desktop
  density.
- **Icon-only buttons need real hit areas, not just visual size** —
  `.np-icon-btn` at 44px is a good visual size but confirm no negative
  margin or tight `gap` in a row of icon buttons closes the *effective*
  gap between adjacent tap targets to under ~8px (mis-tap risk between,
  e.g., a quick-add "+" and an adjacent element in `/emner/` rows).
- **`/emner/` search rows with trailing quick-add `.np-icon-btn`**: same
  36→44px issue, plus — per PLANNER.md §5 — the icon flips to a checkmark
  when added. On mobile, confirm the entire row (not just the icon) is not
  *also* a tap target to the course page, or the two targets will overlap
  awkwardly at narrow width; if the row does link to `/emne/[code]`, the
  add-icon needs `stopPropagation`/nested-interactive handling (a `<button>`
  inside an `<a>` is invalid HTML and unreliable for AT — verify the actual
  markup pattern used, this is easy to get structurally wrong).
- **Bottom-of-thumb reachability**: nothing in the spec currently pins any
  primary action to the bottom of the viewport. On a tall phone, the
  basket's add field sits at the top of `/planlegger/`, meaning "add
  another course" during a live planning session requires reaching to the
  top of the screen every time. Not proposing a bottom nav bar (that's a
  bigger call for the interaction-design lens/product owner) — but flag
  that the add-field's position should be reconsidered for one-thumb use,
  e.g. a lightweight sticky mini-add affordance is worth exploring rather
  than assuming top-of-page placement is fine because it's fine on desktop.

## 6. Offline / slow-net behavior

The architecture (SPEC.md) is static shell + `/api/*` for live data — good
bones for mobile networks, but the current spec's loading/error states
("henter timeplan …" mono line, one-line errors) are written for "slow"
not for "flaky." Campus wifi and moving between buildings produces
*intermittent* failure, not uniform slowness. Concretely:

- **Per-course fetch failures already degrade gracefully** (PLANNER.md
  §3: "tolerate individual failures per course, one error line per failed
  course") — this is the right shape. Make sure the retry path is a tap,
  not a full page reload: the error line format ("Fikk ikke hentet
  timeplanen. Prøv igjen om litt.") should be realized as an actual button/
  link that re-triggers `fetchCourseBundle` for that one course, not prose
  the student has to act on by refreshing everything (losing the rest of
  the plan's already-loaded state on a full reload is real cost on a bad
  connection).
- **No offline affordance for the plan itself.** The plan (localStorage +
  URL hash) is available with zero network — that's already true and
  valuable. Make it *legible*: if the network is down, the basket/course-
  list/credit-total should render instantly from stored state while only
  the grid/exam sections show their quiet loading or error lines. Reread
  `mountPlannerApp`: `renderAll()` (basket, credit line from
  already-cached bundles, course rows) does run before `loadBundles()`
  resolves, so the shape is already roughly right — the thing to verify
  is that credit line and course rows correctly show "last known" values
  (from a previous session's cached bundle, if any) rather than blanking
  to 0 sp while a fetch is in flight, which would read as data loss to a
  student glancing at their phone.
- **Search index fetch on `/emner/`**: `search-index.json` for 4767
  courses is a single static file with no incremental/streaming read — on
  a slow connection this is a blocking wait before any search is possible.
  Not asking for full offline-search infra, but the loading state on that
  page needs to be as considered as the planner's ("henter emnekatalog …"
  with a visible, non-frozen input field the moment JS is ready, even
  before the fetch resolves, so the student can start typing while it
  loads rather than perceiving the page as stuck).
- **Add-to-plan from `/emne/[code]` and `/studier/[code]` must work
  offline** — these are pure localStorage writes with no network
  dependency (per architecture), but only if the "Legg til i planen"
  button's JS is already loaded/hydrated. Since these are static Astro
  pages with vanilla-script islands, confirm the add-button script doesn't
  itself block on an unrelated network fetch before wiring its click
  handler — the button should be interactive the instant the page's own
  JS parses, independent of `/api/*` reachability.

## 7. Screen-reader narrative: what "a timetable conflict" sounds like

PLANNER.md §2 already specifies the block `aria-label` pattern:
"TDT4100, mandag 10:15 til 12:00, uke 35 til 41, kolliderer med TMA4100" —
this is good and I'd keep it verbatim as the per-block label. But a screen-
reader student needs more than per-block labels to actually use the grid;
they need a **narrative entry point**, because scanning 15+ absolutely-
positioned grid cells one at a time via arrow-key/tab navigation to
*discover* that a conflict exists is a worse experience than the sighted
"red hatch catches your eye" affordance the whole design is built around.
Concretely:

- **A conflict summary must exist as text before the grid, not only as
  margin notes after it.** Something like a live region or a heading-level
  line: "2 kollisjoner denne uken" as an actual programmatically-announced
  summary (not just a mono note styled to look secondary), positioned so
  it's encountered *before* the 15-cell grid in both visual and DOM/tab
  order, functioning as the audio equivalent of the sighted "your eye
  catches red ink." The margin-note list already has real links to block
  anchors (spec §2) — good — but a screen-reader student navigating
  linearly hits those *after* the grid, which is backwards: they should be
  able to jump straight to what's wrong, then optionally explore the full
  grid for context, exactly like a sighted student's eye does (glance at
  red, then look at the grid).
- **Each grid block's `aria-label` should be reachable as one stop, not
  three** — confirm the block itself is a single focusable element (`role`
  + `tabindex="0"` or a real `<button>`) carrying the full label, rather
  than exposing the code, time, and clash note as separate child elements
  a screen-reader has to piece together across multiple tab stops. The dot
  (`.np-dot`) inside the block should be `aria-hidden="true"` — it's purely
  a visual hue marker, its meaning ("this is course N in your selection
  order, colored consistently across the page") doesn't translate to a
  useful audio cue and would be noise before the useful label.
- **Exam ribbon dots** need the equivalent: a same-day stack's `outline:
  2px solid var(--clash)` visual ring needs an audio equivalent per PLANNER.md's
  own pattern — "TDT4100, 5. desember, kolliderer med TMA4100 samme dag" —
  and the *list* below the ribbon (already spec'd with gap annotations like
  "2 dager til neste") is naturally screen-reader-friendly as a real list;
  make sure the ribbon's dots either share `aria-label`s with their list
  counterparts or are `aria-hidden` and the list is the sole a11y-tree
  representation (don't make a screen-reader user parse both the abstract
  ribbon *and* the list — pick the list as canonical, ribbon decorative,
  consistently with §2's mobile treatment above).
- **Keyboard-only planning, full loop**: typeahead → add → grid appears →
  review conflict → remove/adjust, entirely without a mouse. Trace it:
  combobox pattern (arrow keys + Enter to select) is already right per the
  markup (`role="combobox"`, `aria-controls`, `aria-expanded`); after
  adding, focus should move somewhere sensible — not silently stay in the
  now-cleared input (which is fine) but also not get lost if the listbox
  closes. When a new block appears in the grid (spec says it "fades/settles
  in" — motion is fine, reduced-motion honored per tokens), a keyboard user
  needs a way to *get to* that block without tabbing through every prior
  cell; the margin-note "kolliderer med" links already provide this for
  conflicts specifically (spec: "clicking a conflict note scrolls to and
  flashes the block") — confirm those note-links are real anchors/buttons
  reachable early in tab order, and that `.np-target-flash`'s visual flash
  has a non-visual announcement too (e.g. moving focus to the block itself,
  whose `aria-label` then gets read — focus-move *is* the accessible
  equivalent of the flash, so this may already work if focus is
  programmatically set on click, just confirm it's `element.focus()` not
  only `scrollIntoView()`).
- **Course-hue color identity is already handled correctly by the design
  system** (never color-as-only-signal, dot + mono code together, DESIGN.md
  §8's "course hues never color text" rule) — flagging as a place where the
  design system already did the a11y work correctly, so no further ask
  here beyond making sure the dot is `aria-hidden` as noted above.

## 8. Priority ranking (mobile-first + a11y lens only)

1. **`--control-h` coarse-pointer override to 44px** — one token, site-wide
   fix, cheapest leverage in this review.
2. **Weekly grid day-scroller transform** — the load-bearing surface of the
   whole product; shipping it as a horizontal-scroll shrink is the single
   biggest gap between "mobile-first" and what's currently planned.
3. **Screen-reader conflict narrative (pre-grid summary + focus-on-jump)**
   — makes the product's central value ("see collisions") actually usable
   non-visually, not just labeled.
4. **Basket tag remove hit-target enlargement** — small fix, high mis-tap
   frequency given it's used every time a plan is edited.
5. **Exam ribbon demotion to secondary/collapsed on mobile, list
   promoted** — same information, cheaper to build than the grid fix,
   meaningful clarity gain.
6. **Study-plan per-course add button to 44px + verify nested-interactive
   markup on `/emner/` rows** — correctness/target-size issue in
   high-density lists.
7. **Offline/flaky-net legibility pass** (instant render from cache,
   tap-to-retry per course, non-blocking search input) — architecture
   already supports it; needs explicit verification/wiring, not new
   infrastructure.
8. **Course-row mobile layout tidy, sticky "jump to your semester" on long
   study plans, bottom-reachability reconsideration for the add field** —
   real but lower-severity polish once 1–7 are in place.
