# P8 — Interaksjonsdesigner: Planlegger-flaten som beslutningsinstrument

Lens: interaction design. My claim: the current PLANNER.md builds a good
*read surface* — you assemble a set elsewhere, then look at the verdict here.
That is one interaction short of the product. The pain the brief names —
"electives are where real planning pain lives" — is a **comparison and
substitution** problem, not a display problem. A student rarely knows their
set; they hold 5–8 candidates for 2 free slots and are trying to *find* the
combination that fits. The planner must be the surface where that search
happens, with the timetable/exam grid reacting *before* you commit. Below is
the interaction vocabulary that makes it one.

---

## 1. The core model shift: two states, not one list

The current store has one flat `courses[]`. That conflates two very different
things a student is doing at once: **"this is in my plan"** and **"this is a
thing I'm weighing."** Collapse them and you force premature commitment — the
exact opposite of a thinking tool. So the plan gets two tiers:

- **Committed** (`courses`) — "these I'm taking." Full hue, solid blocks on
  the grid, counts toward the credit total, exported to the share URL as
  today.
- **Shortlist** (`candidates`) — "these I'm considering." Rendered as
  *ghost* blocks (hue outline, hatch-free, ~40% ink) that sit on the same
  grid but read as pencil, not ink. They do **not** count toward "X av 30 sp"
  (a second faint counter does: "+ 15 sp under vurdering"). Their conflicts
  *with committed courses* are shown, but softly — see §4.

This is the single most important interaction decision in the document.
Everything else follows from it. Store shape:

```ts
interface PlanState {
  v: 2;
  semesterId: string;
  courses:    { code; name }[];   // committed — hue order, counts credits
  candidates: { code; name }[];   // shortlist — ghosted, doesn't count
  program?: { code; name; cohort };
}
```

Migration from v1 is trivial (all v1 courses → `courses`, empty candidates).
Hash grows a second segment: `#26h;TDT4100,TMA4100;TFE4146,TTM4100`
(committed `;` shortlist). A shared link therefore carries "here's my plan,
and here's what I'm still choosing between" — which is exactly the artifact
students paste to each other and to advisors.

**The promotion gesture is the heart of the loop.** One click on a ghost
block (or its list row) promotes candidate → committed: the block inks in,
credits tick up, its conflicts harden. One click back demotes. This
click-to-toggle-commitment *is* direct manipulation of the decision. No drag
needed for the primary loop (drag is discussed and mostly rejected in §7).

---

## 2. Adding a course: hover-preview before commit

Right now "add" is a blind write from four entry points — you add, then look.
Invert it wherever the grid is visible (the planner page itself, and the
search-and-add field). The interaction:

1. **Hover / focus a result** in the add field's live dropdown, or a row in
   `/emner/` when the planner grid is on-screen → the course's blocks
   **preview-render on the grid as ghosts immediately**, in a reserved
   "preview" style (dashed hue outline, no fill). If they'd collide with a
   committed block, the collision preview lights the affected committed block
   with a red *outline* (not the full hatch — this is hypothetical).
2. **Click / Enter** → commits to shortlist (`candidate`), preview solidifies
   into a ghost. A second affordance on the same row — "Legg rett i planen" —
   goes straight to committed for the case where the student already knows.

So the vocabulary has three depths of certainty, each with a distinct visual
weight: **preview (dashed, transient)** → **shortlist (ghost, persistent)** →
**committed (ink, persistent)**. A student can feel their way toward a set by
hovering candidates and watching the grid fill, without ever committing to a
dead end. This is the "kan jeg ta disse sammen?" question answered *while
still asking it*, which is the whole point.

Data cost: preview needs the candidate's timetable + exam dates. Exam dates
are already in the search index (instant). Timetable requires the
`/api/course/:code/timetable` fetch. **Prefetch on hover-intent** (150ms
dwell) so that by click the blocks are usually ready; show the dashed
skeleton in the meantime with the standard "henter timeplan …" mono line
*inside the reserved grid region*, so the layout doesn't jump.

---

## 3. Handling >30 sp candidate sets: the shortlist is unbounded, the plan is not

A student weighing 4 electives for 2 slots has 60 sp of candidates against a
30 sp plan. The current design has nowhere to *put* that — it would show 60 sp
of collisions and read as failure. With the two-tier model this is natural:

- The **shortlist has no credit ceiling and shows no red among its own
  members.** Two candidates that clash with *each other* is fine — you'll only
  pick one. We do not draw candidate-vs-candidate collisions at all by default
  (it's noise; they're mutually exclusive by intent). A toggle "vis
  kollisjoner mellom kandidater" turns them on for the student who *is* trying
  to fit two candidates together.
- The plan's credit meter shows committed against 30 with the accent
  green-at-30 rule; the shortlist shows a separate, quieter "+X sp under
  vurdering" so the student sees headroom ("I have 22,5 committed, 7,5 of room,
  and these three candidates are 7,5 each — pick one").
- When you promote a candidate that would push committed past ~32,5 sp, don't
  block it — annotate: mono note "over normert — 37,5 av 30 sp". Overload is a
  real, legitimate choice (students do it); the tool informs, never forbids.
  Red stays reserved for collisions (Red-Is-Collision), so overload is ink.

---

## 4. Conflicts that guide resolution, not just report it

The current conflict treatment is beautiful but **terminal**: it names the
clash and stops. A decision instrument has to answer the next question — *"so
what do I do about it?"* Two additions:

**4a. Conflicts are typed by tier.** A clash between two *committed* courses
is the real red-ink correction the design describes (you've told the tool you
want both; it can't happen — full hatch + wavy + margin note). A clash
between a *committed* course and a *candidate* is softer: the candidate's
ghost block gets a red outline and the margin note reads as a consequence, not
an error: "TFE4146 ville kollidert med TDT4100 · man 10:15". This tells the
student the cost of promoting *before* they do it. Candidate-candidate clashes
are hidden by default (§3).

**4b. "Hva frigjør dette?" — the resolution affordance.** On any *committed*
collision margin note, a mono action "vis alternativer". Clicking it does two
things we can actually deliver from our data:

- **Grays the clashing pair and shows the hole.** Temporarily demotes both
  colliding blocks to preview-ghost so the student *sees the freed slot* on
  the grid — the empty ruled cells where a replacement could go. This is
  direct: "here's the 2 hours you'd get back."
- **Suggests substitutes from context we already have.** If the plan has
  program context (`program`/`cohort`), we know the study plan's course
  groups. The clashing course almost always sits in a choice group
  ("retning"/valggruppe) with siblings. We surface those siblings that (a)
  are taught this semester and (b) *don't* collide with the rest of the
  committed set, as one-click "prøv i stedet" chips. This is the single
  highest-value feature the study-plan data unlocks and the current spec
  doesn't use it for resolution at all. Without program context, we fall back
  to "søk erstatning" that opens the add field pre-filtered to same-credits,
  same-semester, conflict-free courses. (We have credits, teaching semester,
  and timetables for every course — this filter is buildable.)

This turns the red ink from a verdict into a fork in the road. The design
language holds: the suggestions are ghost previews, so accepting one is the
same promote gesture as everywhere else.

---

## 5. Comparing candidates: a decision needs a table

When a student holds 3 electives for 1 slot, the actual question is a
comparison across dimensions we have: *when does it meet, when's the exam, how
hard is it (grade distribution), what's the assessment form, does it clash.*
The MCP layer literally has `compare_courses`; the site has nothing. Add a
**compare tray**:

- Any 2–4 candidates can be marked for comparison (a small "⇄" on candidate
  rows, or just: comparison is the default view of the shortlist when it has
  ≥2 members competing for the same slot).
- Renders a compact mono table — one column per candidate — with rows:
  *meeting times · exam date + form · credits · fail-rate (from grade dist,
  the "A/B vs F" split) · clashes with your plan (yes/no) · taught this
  semester.* Every cell is data-mono per Data-Is-Mono. The "clashes" row is
  the only place red appears.
- Each column header is the `.np-tag`; a "velg denne" promotes that one and
  clears the others from the slot.

This is where a student *decides*, and it's the thing they currently open
five `/emne/` tabs to do by hand. Keep it on the planner page, below the grid,
collapsible (`.np-summary`) so first-visit doesn't hit a wall.

---

## 6. Progressive disclosure: the first visit is not a wall

Zero state today is an add field + two links — fine but flat. Sequence the
reveal so complexity arrives only as the plan earns it:

- **0 courses:** the invitation (as specced) plus a single ghosted "example"
  faint outline on the grid showing *what a block looks like* — a wordless
  "this is where your week appears." No exam ribbon, no compare tray, no
  shortlist section rendered yet.
- **1–2 committed, 0 candidates:** grid + credit meter appear. Exam ribbon
  appears only once ≥1 course has a known exam date. Shortlist/compare
  sections stay collapsed and unlabeled until the first candidate is added.
- **First candidate added:** the shortlist section unfolds with a one-time
  mono note explaining the two tiers in one sentence: "Kandidater vises som
  blyant — klikk for å ta dem inn i planen." Shown once (localStorage flag),
  never again.
- **First collision:** the "vis alternativer" affordance is the *only* time we
  introduce resolution UI — right when it's relevant, attached to the actual
  clash, not in a help panel.

Principle: every control appears anchored to the first datum that makes it
meaningful. Nothing is explained in the abstract.

---

## 7. Direct manipulation: what gestures, precisely

I want to be exact here because "drag" is tempting and mostly wrong for us.

- **Promote/demote: click** (the block, or the list row's primary area).
  `aria-pressed` toggles committed. This is the workhorse; it must be dead
  simple and instant. Not drag — you're not moving a course in *time* (we
  can't; NTNU sets the times), you're changing its *status*. Click is the
  honest gesture for a status flip.
- **Remove entirely: explicit "×"/"Fjern"** — never a gesture, so it's never
  accidental. (Swipe-to-delete on mobile is a footgun on a planning artifact.)
- **Preview: hover/focus** (desktop) — §2.
- **Drag is reserved for exactly one thing, and only if we build lab groups:**
  choosing among parallel timetable *variants* of the same course (a course
  with multiple øvingsgrupper/lab slots — the timetable data does expose
  parallel entries). There, dragging a course's block to an alternative slot
  to pick which group you'll attend is genuine direct manipulation of a real
  choice. This is a v2+ idea; flag it, don't scope it now. Everything in v1 is
  click/hover.

Rationale: drag has poor discoverability, is punishing on touch, and breaks
keyboard parity. Our decisions are *toggles and selections*, which click and
focus express perfectly and accessibly.

---

## 8. Mobile: the grid is a viewport problem, so change the model

A Mon–Fri × 08–20 grid does not fit a phone, and pinch-zooming a timetable is
misery. Don't shrink the desktop grid — switch representation below the
breakpoint:

- **Default mobile view is a day-agenda, not a week-grid.** A vertical
  scroll of days; each day is a mono header ("Mandag") and its blocks stacked
  full-width in time order. Collisions render as *overlapping stacked blocks
  with the red hatch on the overlap band* + the margin note directly beneath —
  which actually reads *better* than the desktop side-by-side split on a
  narrow screen.
- **A "uke"/"dag" toggle** (`.np-toggle`) lets the student flip to a
  horizontally-scrollable mini week-grid when they want the shape, but agenda
  is the default because it answers "what's my Monday" without zooming.
- **Preview-on-hover has no touch equivalent**, so on touch the add flow is:
  tap a result → it lands as a *candidate* (ghost) with the grid scrolled to
  its first block and `np-target-flash`ed → tap again to commit. The
  two-tier model earns its keep on mobile: the first tap is the "preview," the
  second is the commit, and neither is destructive.
- Compare tray on mobile: one candidate column at a time with a swipe between
  columns, or stacked cards — the table transposes to card-per-candidate.
- Everything stays within the paper column; the grid/agenda scrolls inside its
  own `overflow-x` container, the page body never scrolls sideways.

---

## 9. Micro-interactions that carry meaning (within the motion budget)

The DESIGN.md budget is tight (transform/opacity/color, `--dur`, no
choreography). Within it:

- **Promote** = ghost block's fill opacity animates 40%→100% over `--dur`, hue
  dot squares up. The credit meter's number rolls (tabular-nums, no bounce).
  This is the one moment of satisfying feedback and it's honest — the course
  literally solidified.
- **Preview appearing** = dashed outline fades in over `--dur-fast`. Leaving
  the hover fades it out. No layout shift (region reserved).
- **Collision arriving** = the red hatch cross-fades in on the block over
  `--dur` (color transition only) — the "ink bleeding onto the page" reading,
  not a flash. Margin note fades in beneath.
- **Conflict-note click** = the specced scroll + `np-target-flash` on the
  block. Keep it.
- Reduced-motion zeroes all of this to instant state swaps, per tokens. The
  meaning survives without the motion because it's carried by *state* (ghost
  vs ink), not by the animation.

---

## 10. What I'd cut / defer to protect the core

- **Don't** build multi-semester planning (a full study *program* across
  years) in this surface. It's a different instrument (a longer timeline) and
  would drown the "does this semester fit" job. The study-plan pages already
  cover the multi-year view; keep the planner about one semester.
- **Defer** lab-group/parallel picking (§7) — real but heavy, needs the drag
  model and careful timetable-variant data handling.
- **Defer** advisor/share annotations (comments on a shared plan) — needs
  server state we don't have.

---

## 11. Interaction vocabulary — the one-page contract

| Gesture | Target | Effect |
|---|---|---|
| Hover / focus | search result, `/emner/` row (grid visible) | dashed **preview** blocks on grid; hypothetical clashes as red outline |
| Click | search result | add as **candidate** (ghost) |
| Click "Legg rett i planen" | search result | add as **committed** (ink) |
| Click | ghost block or candidate row | **promote** candidate → committed |
| Click again | committed block/row | **demote** committed → candidate |
| Click "×" / "Fjern" | any tag/row | **remove** from plan entirely |
| Click "vis alternativer" | committed collision note | gray the pair, show freed slot + substitute chips |
| Click "prøv i stedet" | substitute chip | swap: demote clashing course, preview the substitute |
| Mark "⇄" | 2–4 candidates | open **compare tray** |
| Click "velg denne" | compare column | promote that one, clear slot rivals |
| Toggle uke/dag | mobile | switch week-grid ↔ day-agenda |

Three visual weights of certainty, everywhere, consistently:
**preview (dashed, transient)** · **shortlist (ghost, ~40%)** ·
**committed (ink, 100%)**. If a student can always tell which of the three a
block is, the instrument works.

---

### The single bet

Split the plan into **committed vs shortlist**, make **promote a one-click
gesture**, and let **candidates preview on the grid before commitment.** That
one move converts the planner from a place you *check* a decision into the
place you *make* it — which is the difference between a nice timetable viewer
and the thinking tool upstream of Studentweb that the brief asks for.
