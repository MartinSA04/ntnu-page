# DESIGN.md — the design system

This repo's own design system. It has no codename: it is the calendar,
played straight. (An earlier warm-paper direction called **Ruteark** — Flexoki
ground, a vendored grotesk and mono, a squared 15-minute ruling, printed
course fills — was replaced wholesale on 2026-08-01. Nothing of it survives
except the `.np-*` class prefix and the primitives' interaction grammar. If
you find the word in a comment, it is a leftover, not a rule.)

The rules named in **bold** below are binding. `tests/site/tokens.test.ts` is
the authority on every contrast claim and fails the build below AA.

---

## 1. North star

**The calendar, played straight.** A student opens this to answer one
question — does the term hold together, and where do I walk in at 10:15 — so
the design's job is to disappear. The week is days against hours in solid
colour blocks with mass; the list is a departure board with the time in the
left margin and the room in the right; the page carries no modular
containers, because the content is static and known.

The craft bar is Google Calendar and Apple Calendar: the familiar thing,
executed properly, without irony or smuggled quirk.

Explicitly rejected: anything that reads as institutional (Studentweb,
Blackboard, Altinn), as a startup dashboard, or as concept-led. A timetable
that costs half a second per glance has failed regardless of how it
photographs. **Cards are not page structure** — a card is a container for
content whose count and shape you do not know at build time, and this page
knows both.

---

## 2. Colour

Neutrals carry the page. Colour is spent on exactly four jobs, and no two of
them share a hue.

- **Ground and ink.** `--bg` #FFFFFF *is* the content surface — there is no
  grey backdrop for cards to float on. `--card` #F7F7F8 survives only for
  things that genuinely float (dialogs, the popover) and for two ground tones
  (the exam band's empty day, the load track). Ink runs `--fg` → `--muted` →
  `--faint`; hairlines are `--border` and `--border-strong`. Dark mirrors on
  #151517.
- **The interface — ink** (`--ui` = `--fg`). Focus rings, pressed and
  selected fills, links, hover, membership.
- **The accent — system blue** (`--accent` #1A73E8 / #8AB4F8 dark), with
  **exactly one job**: the primary action, and the now/today marker.
- **The verdict — green** (`--verdict`): the term works. Nothing else.
- **Collision — red** (`--clash`): two things that cannot coexist. Fetch
  errors, empty states and validation are ink, not red.
- **Attention — amber** (`--warn`): short of a problem. An over-full load,
  sessions sharing an hour. Amber exists so red is never spent on something
  merely worth a look.
- **Course hues — six**, each held clear of the accent's azure, the verdict's
  green and the collision's red. They are dark enough (light) and light
  enough (dark) to carry knocked-out text, so `--block-mix` is 100 % in both
  themes: the fill *is* the hue, not the hue pulled toward black.

### Named rules

**Red-Is-Collision.** Red marks coexistence failures, nothing else, and the
copy names both things.

**Green-Means-Fits.** Green is a judgement about whether the term works.
Membership, selection, focus and hover are interface and take `--ui`.

**One-Job-Accent.** The accent may mark the primary action and "now/today",
and nothing else. The moment it marks a third thing, the rule that killed its
predecessor applies again.

**Course-hues-never-colour-text**, with one sanctioned exception. Hue-coloured
text fails contrast in half the pairs; the square mark carries identity and
text stays ink. The exception is the **tinted øving layer**, whose label is
the course hue pulled toward ink — and it is measured, not assumed:
`tokens.test.ts` checks both block pairs across all six hues in both themes,
and rejected 22 % and 15 % dark tints at 3.94:1 and 4.42:1. Do not add
coloured course names for "scannability".

**`--faint` is not a text colour.** It measured 2.87:1 while carrying a credit
figure, a dropped course's title and the exam months. It is deliberately
**not** raised to AA, because it cannot be — `--muted` is 5.07, so a third
AA-clearing step would have to live inside 4.5–5.07 and would stop being a
step. It buys back the 3:1 non-text floor instead, and everything a student
*reads* moved to `--muted`. `tokens.test.ts` pins both halves.

---

## 3. Typography

**One family: the platform's own UI face.** `-apple-system,
BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
There are no vendored fonts, no `@font-face`, no preloads and no build step.
Google Calendar and Apple Calendar both use the system face on purpose; so
does this.

**`--font-mono` is an alias of `--font-sans`.** `.np-data` keeps its meaning
and every call site — it still marks a figure a student copies — but the
distinction is carried by `font-variant-numeric: tabular-nums` rather than by
a second typeface. Figures still column up; they do it in the same voice as
the sentence around them.

**Scale — seven steps, one per role.** `--text-xs` label, `--text-sm` small
sentence, `--text-base` body, `--text-md` title, `--text-lg` headline,
`--text-xl` page title, `--text-2xl` display.

### Named rules

**Data-Is-Mono is retired; `.np-data` is not.** The rule was right about
*which* strings matter — times, dates, codes, counts — and wrong that they
need their own face. Keep marking them; the mark now buys tabular figures
instead of a monospace. (Several code comments still cite the old name. They
mean "this is a figure", which is still true.)

**`.np-note` vs. `.np-hint`.** `.np-note` is the fragment voice ("uke 38–40",
"0 sp"); `.np-hint` is any small text with a verb. Putting a sentence in
`.np-note` is a category error.

---

## 4. Surfaces, ruling, depth

Depth is tonal paper layering, flat at rest. Shadows are whispers
(`--shadow-sm` on floating tiles, one step up on hover); `--shadow-lg` only
for true overlays. Radii are instrument corners: 3 / 4 / 6 px, with
`--radius-lg` 10 px reserved for `.np-frame`.

**No inset shadow as an edge treatment.** A mark pressed into a control is not
this system's voice, and the three that existed as decoration were **removed
rather than reimplemented**: `.np-field`'s and the select's inline-start rule,
and a per-bar collision edge. Replacing one with a painted gradient or an
inset-offset outline is the same mark in other clothes; don't.

Two inset shadows survive, and both are **structural rather than
decorative** — they are doing something a border cannot:
- the all-day row's rule, because the row is drawn at **zero height** when the
  plan has no drop-in window, and an inset shadow is clipped to the box so at
  zero it draws nothing (a border would still paint a line);
- the ring on a **dropped** course's swatch, because the mark has to keep its
  place in the column while losing its fill — a dropped course is switched
  off, not missing, and a hole in the column of marks reads as the latter.

Do not add a third without one of those two arguments.

**The ruling is one hour hairline, and it lives on the boxes it rules.** The
squared 15-minute field is gone: in both axes behind five columns of blocks
it was ~600 squares of texture, and what a student reads off a timetable is
the *hour*. `planner-week.css` draws the line on `.planner-grid-rail` and
`.planner-grid-day` — the boxes whose top edge *is* the slot grid's origin,
which is what keeps it in register. Tiling it from the frame instead is what
caused a permanent ~22 px misregistration.

**`.np-ruled` and `.np-ruled--hours` do not exist.** Both were deleted with
their last callers. Reaching for either would give you a 15-minute square
field plus a second hour rule anchored to a different box than the live one.
If ruling ever returns to a planning surface, put it on the rail and day
columns, not on the frame.

### Named rules

**Ruling-Marks-The-Plan.** What ruling remains appears exactly where planning
happens and nowhere else — if the whole site is ruled, nothing is. Two
corollaries, and the first is the one reviewers keep proposing against:
*do not spread it* to panels, cards or a hero for "cohesion"; and *the week
does not carry a squared field either*. A message is never rendered inside
the week's frame as though it were a plan (`renderWeekMessage` exists for
that).

**Ink-Before-Chrome.** Structure is tonal steps and hairlines; interactive
controls carry fills or washes, never borders. There is no sanctioned
exception.

---

## 5. Components (`.np-*`)

One grammar, defined once in `primitives.css`: rest = flat; hover = a surface
answer (paper darkens a step, bare controls take `--wash`) plus text lighting
to `--ui` where it was muted; **press = a 1 px dip, built into every control**
(`.np-btn`, `.np-icon-btn`, `.np-navlink`, `.np-toggle`, `.np-summary`,
`a.np-tag`, `button.np-tag`) — `.np-press` is the escape hatch for a one-off
pressable that is none of those, not something to add alongside them; focus =
a global 2 px `--ui` outline.

**Labels and data**
- **`.np-kicker`** — `--text-xs`, 500, uppercase, `--tracking-wide`,
  `--muted`. Eyebrow / section label.
- **`.np-data`** — `tabular-nums`, inherits size. Any figure a student copies
  (time, date, week, code, count).
- **`.np-note`** — `--text-xs`, `--muted`. Fragments only, never a sentence.
- **`.np-hint`** — `--text-sm`, `--leading-normal`, `--muted`, capped at
  `--measure` (opt out with `max-width: none` in a narrow column). Every small
  *sentence*: help text, empty states, provenance.
- **`.np-note-clash`** — `--text-sm`, colour `--clash`. A sentence; wrap the
  day/time/week/code it quotes in `.np-data`.

**Buttons**
- **`.np-btn`** — paper action button on `--control-bg`/`--control-hover`,
  sentence verbs ("Legg til i planen"). `aria-pressed` / `.is-active` fills
  `--ui`.
- **`.np-btn--primary`** — the accent's one job made a control. **At most one
  per surface.**
- **`.np-icon-btn`** — 36 px bare glyph, `--wash` hover.
- **`.np-navlink`** — bare navigation text; `aria-current="page"` inks it.

**Marks, tags and toggles**
- **`.np-dot`** — the course mark: a **rounded square**, 10 px in a row of
  text, 12 px where it leads a block of it. Not a circle — a circle is a
  bullet and belongs to lists of sentences. The corner is what makes it the
  same object as the bars in the week. Set via
  `style="--dot: var(--hue-cyan)"`.
- **`.np-tag`** — squared course tag: `.np-dot` plus the code. Inside an
  already hue-washed block it drops its own surface — a card-coloured chip on
  a course wash is chrome on chrome; on `--bg` it keeps its card background.
  `.np-tag--sm` is the in-grid size.
- **`.np-toggle`** — selectable tag on `--control-bg`/`--control-hover`;
  `aria-pressed` fills `--ui`. **`.np-toggle--text`** for multi-word proper
  names (studieretning, campus), where tracked caps would wrap a
  20-character Norwegian phrase to two rows. Don't also call `.toUpperCase()`
  in JS on either — the CSS owns casing.

**Fields**
- **`.np-field`** — paper input on `--control-bg`, nothing else at rest;
  `focus-within` keeps the 2 px `--ui` outline. No edge rule.
- **`.np-select` / `-shell` / `-icon`** — a native `<select>` on the same
  grammar, with the platform arrow removed (`appearance: none`) and Lucide's
  `chevron-down` put in its place, turned over while `:open`. The icon is a
  sibling so it inherits `currentColor`; `--select-inset` is the one number
  both sides are measured from. Live users: the planner's semester control and
  the studieinfo dialog's studieretning picker.

**Surfaces**
- **`.np-panel`** — paper panel on `--card`.
- **`.np-popover` / `.np-popover-option`** — the floating list surface for
  every typeahead: `--card` background (never `--card-nested`, which is the
  *recessed* step and inverts lighter than `--card` in dark), `--radius-sm`,
  `--shadow`, `max-height: var(--popover-max, 18rem)`. `.np-popover` sets no
  positioning and `.np-popover-option` sets no display — the call site keeps
  those. Only the shared padding, corner and `.is-active` highlight live here,
  which is exactly what drifted between three hand-rolled copies before it
  existed.
- **`.np-frame`** — the bordered, rounded paper box. Live users: the four
  `<dialog>`s (studieinfo, add-course, course settings, block popover). It
  sets `overflow: hidden`, which is why the week's frame is deliberately
  **not** an `.np-frame` — it would kill the horizontal scroll.
- **`.np-head` / `-swatch` / `-ident` / `-title` / `-sub`** — the masthead
  every card and modal opens on: what this is, its quiet second line, and the
  way out, full-bleed against the frame's edge. **One ground**, paper one step
  down with a hairline under it. A surface about a *course* adds
  `.np-head-swatch` — the same mark as `.np-dot`, `--dot` set per open — so
  the card reads as the block you pressed. A `<dialog>` pads its **body**,
  never itself, and the body is what scrolls, so the head stays put.
- **`.np-fact` / `-value` / `-sub`** — a fact and the line that qualifies it:
  a room over its building, a parallel over "one of three", credits over
  where the course came from. This replaced a `NÅR / ROM / HVA / UKER` label
  column that spent a third of a 20 rem card naming facts that say what they
  are.
- **`.np-actions`** — a card's footer: a hairline, then what you can do about
  what is above it. **`--split`** pushes a pair apart when they are different
  kinds of thing (a verb that changes the plan, and the way out to another
  page); verbs about the same edit stay together at the start.
- **`.np-link-out`** — the way out of a card to a page ("Gå til emnesiden →").
  A target, not a tail: 24 px tall (WCAG 2.5.8), `--muted` until pointed at.

**Disclosure**
- **`.np-summary`** — disclosure row with a rotating chevron.

**Micro-interactions**
- **`.np-target-flash`** — a quiet `--ui-ring` outline flash on deep-link
  arrival.

**Deleted — do not reach for these:** `.np-ruled`, `.np-ruled--hours`,
`.np-kbd`, `.np-tile`, `.np-lift`. A documented primitive with no caller is
system debt; the primitive layer is defined once and every user of it is
expected to actually exist.

---

## 6. The week

The primary surface, and the one with the most accumulated rules.

**A block's edges are its facts** — left and right are the day, top and bottom
are the start and the end — so it carries no ring. The separation is real air,
and each side does a different job: 3 px in from the left so the block does
not sit on the day's own rule, 6 px of channel at the right so the hour ruling
runs unbroken past it, 2 px off the bottom so the line a session *ends* on is
never covered. **4 px of corner** — not zero: at zero, two touching blocks
fuse into one column of ink.

**A block carries the course and the room, and nothing else.** The clock is
already drawn, and the room is the only fact position cannot state, so it
never drops out — the type shrinks instead. Block text has **one ink, and the
quieting is weight**: the room and activity under the code were `--on-block`
at 72 % and failed AA on all six hues in light (orange 3.01). The light hues
clear AA at *full* strength by so little (orange 4.56) that no alpha survives
on all six, so there is no quieter colour to be had. Do not re-introduce a
mix.

**52 px an hour, not 72.** A student reads a timetable for the *shape* of a
week; at 72 an eight-hour day was 576 px of column. A tick per hour on the
rail, because the ruling is painted behind the blocks as a calendar's is, and
**the rail prints whole times** (`08:00`, not `08`) — an axis you read a time
off, not a column of numbers you have to be told are hours.

**The øving layer is tinted, not printed**, with its label in the course hue
pulled toward ink — one treatment in both geometries. This is §2's one
sanctioned exception, and it is measured.

**The control that reveals it is a BOX YOU TICK**, and the same box on every
surface that draws a week. It ADDS a layer; the pair beside it CHOOSES how the
week is drawn, so the two read as different kinds of control because they are.
`/planlegger/` settled that grammar and the others mirror it — one component,
one set of styles, and `weekView` owning the state, the click, the layer
choreography and the count, because written out per page they had already
diverged into a tick box on one surface and a filled pill on another.

**It carries what the layer is still waiting on.** The layer draws PICKED
groups only, which is right — every group of every course put 41 blocks in one
week — but it made the control dishonest: ticking the box on a five-course plan
added two blocks and said nothing about the four courses that drew none. Only
while the layer is on; beside an unticked box "3 mangler gruppe" is a fact about
something not on screen.

**A margin note is a control only where there is something to control.** The
"velg din gruppe" line opens that course's picker on `/planlegger/`. Where there
is no picker — `/user/<navn>` shows somebody else's plan — it is a sentence
instead, and it drops the imperative with the affordance: an underlined,
focusable button that does nothing when pressed is the failure this rule exists
to prevent.

**Drop-in windows live in an all-day row.** A window is 08:15–14:00 every
weekday, not an appointment at a time, so it has no honest place on the time
axis. The row is drawn **at zero height** when the plan has no window, because
a row that is absent in one state and present in the next cannot animate, and
its rule is an inset shadow so at zero it draws nothing.

**Two views, and they are Uke and Liste.** `WeekView` is
`"kolonner" | "tavle"` — the stored values stay as they are, because that is
what a student's localStorage already holds and what the pre-paint probe must
agree with. A third transposed view ("Rader") was removed from the planner and
then deleted outright; do not reintroduce it.

**Every surface that draws a week draws these two, through one controller.**
`/planlegger/`, `/emne/[code]/` and `/user/<navn>` all mount `weekView.ts`:
same tab pair, same blocks, same popover, same margin. For a while they did
not — the planner moved to the column week while the other two kept drawing
the transposed one, which is how `/user/<navn>`'s own docstring came to claim a
parity it had lost. **The view choice is one fact**, one `np:weekView`: it is
how you are looking at a week rather than which week you are looking at, and a
student who chose a list on a phone chose it for weeks, not for one page.

**Both week geometries round their sessions to 4 px**, so the same session is
not two shapes depending on which page drew it.

**The week is dated.** Day headers carry the day-of-month beside the weekday,
today's in a filled accent disc, and the context line leads with `Uke 38`. The
grid still draws a *pattern* week — a block stands for every week in its own
range — but the page is opened in exactly one of them, and a calendar that
will not say which is a diagram. A date numeral claims which Monday the column
is, not that everything under it happens; the margin notes and the provenance
line are what name the difference. Week numbers are ISO 8601, because NTNU
publishes timetables in them.

**Outside the teaching period the week is a MØNSTERUKE.** Dating it
unconditionally put `MAN 27 … FRE 31` over blocks that all run `uke 34–47` —
every block false under its own date, on the default state of the surface.
Inside the teaching period the numerals stay; outside it they come off and the
context line reads `Mønsteruke · undervisning fra uke 34`.

**The day header is a label, not a heading** — ~0.9 rem medium in `--muted`,
with today taking full ink and the weight.

**The needle** is the accent with a 1 px page-coloured halo and a dot at the
rail. In Liste, the row you are inside is washed in the accent and carries a
`nå` tag, placed on a timer. Same contract for both: **an ordinary minute may
not rebuild the week.**

**Whole days only.** The day count is `maks(1, min(ukedager, gulv(plass /
dagminimum)))` and the width `maks(dagminimum, plass / dager)`, expressed in
CSS rather than in a measuring pass — hence no resize listener. Flooring the
count keeps the week honest at the edges: a narrower window drops a whole day
and widens the rest.

**The phone gate is a fraction, not a pixel count**: the week must begin
inside the first **37 %** of the screen, measured from the viewport's top so
the site topbar is inside the budget too. That is the claim that was always
meant, and it is what the controls at the top of the page are budgeted
against. The figure was 0.35 and was raised deliberately: the verdict and the
deadline cannot share one 390 px row, so a **qualified** pass spends 27 px
more than a plan whose pass says nothing. Only a qualified plan spends it —
an unqualified clean verdict is still hidden on a phone.

Measured at 390 × 844 on that qualified plan, the week's frame has started at
277 px, then 304 px when the qualified pass began printing, and **260 px
(31 %) since the plan bar folded into its ⋯ menu** on 2026-08-03. The fold
bought back **one** row of controls, 44 px — not two: the plan's name and the
view switch still take a row each. The budget stays at 0.37 rather than being
tightened onto the new reading; the fraction is the claim, and the measurement
is only evidence that the claim currently holds.

---

## 7. Motion

One easing (`--ease`), `--dur-fast` (110 ms) for state, `--dur` (190 ms) for
surfaces, `--dur-flash` for arrival marks. Transform, opacity and colour only,
with one bounded exception. Theme flips are instant. **No entrance
choreography for arriving data** — a re-render caused by a fetch, a group pick
or a plan edit draws straight.

**The week is the exception, and only under a deliberate switch.** Two
controls change how the week is drawn rather than what is in it — Uke ⇄ Liste,
and «vis øvinger og labber» — and both animate, because a student who pressed
one of them is asking to see the same plan differently and needs to be able to
follow it there.

- **Uke ⇄ Liste** redraws, so it plays the strike-in: a clip-path wipe from
  the left, staggered in reading order.
- **The øving toggle** does not redraw. One layer arrives or leaves, so what
  stays *travels*, what arrives *strikes in* after the space is made, and what
  leaves *wipes out* before the space closes (`layerMotion.ts`). Replaying the
  strike-in here would claim that lectures which did not change had changed.

Travelling is what breaks the transform-only rule: the week animates `left`,
`width`, `top` and `min-height`, because a bar's width **is** its duration and
a `scaleX` FLIP would squash the course code inside it for the length of the
move. It is bounded to ~50 elements of one surface on an explicit press. The
list half is flow layout and stays on `transform`.

Reduced motion zeroes all duration tokens globally *for CSS transitions*.
Scripted motion is not covered by that and asks the media query directly: the
conflict-note `scrollIntoView` falls back to `"auto"`, and the layer change
skips its whole choreography.

---

## 8. Voice and copy

Norwegian bokmål, sentence case, no exclamation marks. Verbs name their
outcome and stay consistent through the flow: "Legg til i planen" → "I
planen"; "kolliderer med" for clashes; credits always "X av 30 sp" with comma
decimals ("7,5").

**"Fjern" labels only an outright, irreversible removal** — a manual add. A
programme course's removal is reversible (it grays out, it is not gone) and
gets its own verb: **"Dropp" → "Legg tilbake"**. Using "Fjern" for both made
an editable action read as a delete.

Errors say what failed and what to do next, in ink, without apology. Empty
states are invitations to act. Semester names as NTNU writes them ("Høst
2026"). The planner is "planen" in copy; the page title is "Planlegger".

**No upstream English reaches the UI.** Every fetch failure carries a ready
Norwegian sentence; the raw string survives only as a debug detail.

**No `—` and no `·` in any string a student can read**, anywhere in `src/` or
`worker/`, **and no substitute mark** — not `–`, not `|`, not a hyphen standing
in for one. They were doing three unrelated jobs at once (sentence punctuation,
field separation, brand separation), so none of them read as deliberate. The
rewrite rule is:

> **Prose becomes sentences. Data rows become spaced fields.**

Subpage `<title>` tags drop the brand suffix rather than substitute a
separator: "Planlegger", "Emner", "TDT4120 Algoritmer og datastrukturer",
"Fant ikke siden". The homepage stays "Semesterplan". Both calendars this
project benchmarks against name the page and nothing else in the tab.

**Name what shows up. Never announce that it is finished.** Two phrasings are
struck, and the second is why the rule is worth stating rather than just the
ban list:

- **"tegne uka"**, in any inflection. We assemble a week that already exists in
  NTNU's data; we do not invent one.
- **"så er uka klar" / "uka er klar"**, and the same shape around *timeplanen*
  or *ukeplanen*. This one reads as the product congratulating itself on a
  state, which is a claim rather than a description — and the student cannot
  check it against anything on screen.

Write the outcome as the thing that appears: **"så lages timeplanen din"**,
"så vises ukeplanen med en gang". A sentence that names a visible result is
one the page can be held to.

`tests/copy.test.ts` gates all of it, and its failure message carries the
rewrite rather than only the ban. It strips comments before scanning, so code
comments and the four docs keep their heavily em-dashed register on purpose.
When it fails, rewrite the string; do not loosen the test.

---

## 9. Adjudicated decisions

Settled, with the reasoning, so they are not re-opened by the next reviewer.

- **A plan-less planner is a first-run SCREEN, not a card in a drawn planner.**
  The empty state used to be an invitation floating in ~900 px of white inside
  a fully drawn page whose every control acted on nothing: a layer box, a
  Uke/Liste switch, a semester select and a countdown to registering courses
  the student had not chosen. Two more headings printed apologies over content
  that did not exist. The screen replaces all of it.

  **The predicate is `html:not([data-plan])`, and it is not a new mechanism.**
  Layout's pre-paint probe already sets `data-plan` when a programme or a
  course is stored and removes it otherwise, so its absence is exactly "no
  plan", written before the first frame. That is what lets a CSS-gated static
  panel paint *with* the document: no mount flash, no reserved void, no
  reservation to lease and release. It is complete only because the `#v2;…`
  hash is gone — localStorage is now the only way a plan can reach the page.

  **It is live and reversible, and the predicate is "a plan ANYWHERE".**
  Emptying the plan returns to this screen, because everything left behind
  presupposes the courses that are gone — a week frame with one grey sentence
  in ~500 px of white, a layer box and a view switch acting on nothing, a
  countdown to registering courses the student just deleted. That is the screen
  this design replaced, so arriving back at it by another route is the same
  defect.

  But *empty in this term* is not *empty*. `--plan-courses` stays the current
  semester's count (reservations are measured in rows being drawn), while
  `data-plan`'s **presence** answers "does this student have a plan at all",
  across every semester and the programme profile — `"elsewhere"` is the value
  for a plan that exists but not here. A student who switched to a term they
  have not filled keeps the planner, and keeps the semester control that is
  their way back to it.

  An earlier attempt made the gate one-way per page-load instead
  (`data-planner-ready`). It fixed the semester case and broke the emptying
  case, which is what a latch on the wrong fact will do; the fix was to widen
  the fact, not to remember a past state. **`syncFirstRun` and the probe must
  keep testing the same thing** — the CSS gate reads `data-plan`, so a JS
  predicate that disagrees leaves the page looking correct while a second
  studieinfo section mounts into the hidden host and duplicates every id.

  **One picker, two hosts, never at once.** The first-run screen and the
  studieinfo dialog mount the same `buildStudieinfoSection`, differing only in
  a commit policy: `"on-kull"` writes as soon as programme and kull are known
  and renders no Lagre, `"explicit"` stays the dialog's so a light dismiss
  discards a half-picked programme. They must never both be live — the unit
  hard-codes its ids — so the dialog is built on its first open and the
  screen's section exists only while there is no plan.

- **Login and register are two forms, not two buttons.** One form carried Navn,
  PIN and Gjenta PIN under two co-equal buttons, which made Enter a coin flip:
  the same fields fed both actions, so whichever button carried `type="submit"`
  mis-routed one of the two populations. The mitigation was `reasonCopy` naming
  the other action after the fact — a mitigation for a defect.

  The panel has a **mode**. Login asks Navn and PIN; register asks for the PIN
  twice and carries the two terms lines, which are about *creating* a
  credential and have no business on a login form. Each has one submit, and a
  **link below the form** switches — the returning-or-new choice is a link, not
  a second button competing with the action. The switch carries the **name**
  across and clears the **PIN**, because it means a different thing on the
  other side (one to prove versus one to set).

  Login is the default: the callers that know pass a mode explicitly, and a
  door opened with no opinion is more often a returning student than a new one.
  The submit wears the accent, which it could not while studieinfo shared this
  surface and Lagre had it.

  `taken` and `no_account` still name the other form rather than stopping at
  the fact, and now that form is one press away. They are **not** auto-switches:
  flipping the form under someone would discard the PIN they just typed.

- **The verdict is green, not NTNU blue.** The tool's output is a verdict
  (fits / collides); green-vs-red is that verdict's native language. Blue is a
  course-identity hue, and a verdict may not wear a colour that also means
  "this is TDT4120". Do not "brand-correct" this.

- **The verdict green's exact value is measured, not chosen.** The constraint
  is that it must clear AA as text and as a fill on every surface it lands on,
  and must not collide with a course hue. `tokens.test.ts` is the authority
  and it rejected the first value tried at 4.46:1.

- **The interface is ink, not the accent.** Ink-Before-Chrome already governed
  every other surface; the accent was the unexplained exception. A focus ring
  went from 4.39:1 to 18.62:1 by obeying the rule the rest of the system
  already followed.

- **The accent exists, with one job.** A calendar without a "you are here"
  colour has to spend red on it, and red means collision here. The rule that
  killed the previous `--accent` was never "no accent" — it was "no token
  doing five jobs".

- **A course hue may never be the accent's hue.** Found the hard way: with the
  interface blue and the course blue at the same value, the now-line vanished
  the moment it crossed that course's block. An overlay that crosses arbitrary
  fills cannot be a flat colour drawn from a palette it is also a member of.

- **A course's hue comes from its CODE, not its position in the plan.**
  Cycling by insertion order meant every add or drop repainted the plan —
  dropping one course moved 1.95 of the other four — and two people opening
  the same shared link could see different colours. The assignment is now a
  deterministic function of the plan's code *set*, so order cannot matter and
  a recipient sees the sender's week. That brings the churn to 0.55, and it
  cannot be zero: six buckets and five courses collide, and a displaced course
  has to go somewhere.

- **The course palette is the calendar family, and the value is bought.**
  `--hue-blue` #027cb8, `--hue-cyan` #00818c, `--hue-purple` #8e24aa,
  `--hue-indigo` #3f51b5, `--hue-orange` #d93c0b, `--hue-green` #0b8043. Two
  of the reference values fail AA with a code knocked out of them (#039be5
  measures 3.08:1 under white, #f4511e 3.48), so **those two are darkened
  along their own hue until they clear and the rest are the reference
  exactly.** That is the shape of the trade throughout: the family is the
  design decision and is kept; the value is measured and bought. Dark-theme
  indigo went one step up its own ramp for the same reason.

- **A pass says what it passed on.** `conflictCount: 0` over a plan where one
  course contributed no classifiable lecture is a claim about four courses
  printed as a claim about five. The verdict carries `· N emner ikke sjekket`,
  and the phone rule that hides a clean verdict is narrowed to an
  **unqualified** one — it was hiding the qualified pass too, leaving
  "kollisjonssjekken er ufullstendig" on screen with no verdict for it to
  qualify. The verdict may never print green when nothing was checked.

- **The verdict is a run of chips**, between the plan's name and the week: a
  mark and a sentence, never a filled pill. The colour is in the sign; the
  words stay ink. "Ingen forelesninger kolliderer" says which thing DR-1
  actually checked. **The collision verdict is a shortcut to the collision** —
  "2 kollisjoner denne uka" is a button that scrolls to the first clash mark
  in whichever view is drawing it, underlined on hover only, because at rest
  it is a verdict and must read as one.

- **One bar at the top of the page, and it carries the PLAN.** The plan's name
  and the controls that act on *it* share a row. **The title is a name, not a
  headline** (1.25 rem / 600).

  **On 2026-08-04 that row was cut down to what the sentence above actually
  licenses.** It had grown to five controls, and two of them were not about the
  plan at all: the layer checkbox and the Uke/Liste switch are questions about
  the WEEK — *which sessions are drawn, and in what shape* — and a plan does not
  change when either is thrown. They went down to the week's own section, where
  a third week control joined them (see *The week is something you pick*). The
  argument that brought them up here in 2026-08-03 — "a second bar 200 px lower
  saying the same kind of thing" — was the right diagnosis of the wrong thing:
  the two bars did not say the same kind of thing, and merging them is what
  forced a fold.

  What is left is **the name, the semester and the hand-over**, and the row
  therefore fits 390 px on its own: a title that ellipsises, a select that sizes
  to "Høst 2026", and a 36 px mark. **So the `⋯` menu is gone from this page**
  (the shell topbar keeps its own — that bar genuinely does run out of room),
  and with it the rule about which controls close it. Nothing folds, so nothing
  has to decide.

  **"Del lenke" is a mark, not a labelled button.** It is the last thing in the
  row at every width and it never moves. The label was 84 px of the one row the
  plan's name has to fit in, and losing it retires the whole pinned-width
  apparatus below: an icon square cannot change size, so there is nothing to
  reserve. The name lives on `aria-label`; the confirmation is `share` → `check`
  plus an `aria-label` that says what happened.

  Two of the bar's original five left on 2026-08-03, and the line they were
  sorted along is *what the control is about*. **"Legg til emne"** went back to
  the foot of the Emner column, under the rows it appends to. **Profil** went
  to the site topbar. The semester came the other way, out of the studieinfo
  modal, because a term is a fact about the plan.

  **Later the same day the split was cut again, in the same place but along a
  truer line.** "Profil" had carried programme, kull, studieretning *and* the
  account up to the topbar together, on the argument that all four describe
  the STUDENT. They do not divide that way. A programme is a fact about the
  PLAN — exactly like the semester, which had just moved the other direction
  for that reason — and only sign-in is a fact about the person. So studieinfo
  came back as **the planner's own dialog**, and what stayed in the topbar is
  the account alone, which earns its door on all four pages because
  `np:plans` is read on all four.

  **The picker's entrance is the plan's own name**, not a sixth control: the
  title states programme and kull, and pressing it is how you change them.
  That is what makes the entrance free — a control in the action run would
  have cost a slot the phone's ⋯ menu then has to fold.

  **It is always a door.** It used to go inert on "no programme and no
  courses", because the week's card was saying "Velg studieprogram" in the
  accent right below it and two controls with one accessible name is the
  two-doors-into-one-room shape the bar was cleaned of. That card is gone —
  the first-run screen replaced it and hides the bar underneath it — so there
  is nothing left to yield to. Keeping the rule would have been a dead end:
  the first-run gate is one-way per page-load, so a student with manual adds
  and no programme who switches to an empty term keeps the bar, and that is
  precisely the state the old rule disabled.

- **The title is `MTFYMA Kull 24` — the programme and the kull, and NOT the
  semester.** It was `MTFYMA Kull 24 H26` until the bar grew a `<select>` for
  the term four controls along the same row, at which point the page stated
  `H26` twice: once as a label and once as a control you can act on. **A title
  restating the setting beside it is redundancy, not reinforcement** — the
  control is the authority, so the title stops competing with it. This
  supersedes the three-part shape recorded here before 2026-08-03.

  It bought **no vertical space**: measured at 390 px the week's frame started
  at 304 px before and after, because the title's row is a full-width block
  whose height comes from one line of 1.25 rem plus the context line, not from
  how many words are on it. The bar still wrapped to three rows. That was the
  honest result, and the reason to make the change was the redundancy, not the
  budget. (The fold later took it to two rows and 260 px — see §6. That is a
  different change, and it is the one that bought the space.)

  The one string that still names the term in short form is gone with it:
  `semesterShort` was deleted with its only caller. Everything that names a
  term now says it in full ("Høst 2026"), **including the share sheet's own
  title**, which is the one string that travels off the page and therefore the
  one that cannot lean on the control beside it.

- **The topbar carries the account, and still no plan state.** The name it
  prints is the account's own; there is no semester, no course count and no
  programme code up there, and the three killed plan affordances stay killed.
  A long name ellipsises — the bar is one row at 390 px or §6's phone gate
  fails, since that gate measures from the viewport's top.

  **Below 480 px it is a row in the topbar's menu, and the name is visible
  there.** This supersedes the mark-alone rule that stood here for part of
  2026-08-03. That rule was a concession, not a design: capped at 6ch the name
  stopped saying anything ("Martin…" beside a glyph that already says "you")
  and signed out it spent the same room on the word "Profil" beside a person
  mark, so the text was dropped and `aria-label` carried "Profil · {navn}"
  alone. A menu row has the width for a whole name, so the concession is
  repealed — the sighted phone user gets back what only a screen reader had.
  The `aria-label` stays at every width, and the row is still a **44 px**
  target. The mark is `user` at every width: what is behind the door is the
  session, which is who you are and not what the page is set to, so a cog would
  claim settings and `settings-2` is spoken for by the plan's own control.

  Folding also **repeals three economies the bar was paying for those
  controls**: the wordmark's size step-down, its ellipsis, and the dropped mono
  suffix. "Semesterplan NTNU" is whole at 360 px again.

- **The course page's week is every parallel, and it says so.** `/emne/[code]/`
  draws with `showAllGroups` on purpose — it is the course's own reference
  page, not one student's plan — and for a long time nothing on it said that,
  so six lectures on screen read as six lectures you had to attend. A line
  under the controls now states the scope, and it has **three rungs** because
  what the student can do next differs: with no programme stored, nothing can
  be narrowed and the line points at the planner; with one, a **«Bare min
  undervisning»** switch appears; only a *plan entry* can carry an øving-group
  pick, so the offer to add the course stands until it is in the plan.

  The switch renders **only when narrowing would change the week**.
  `entriesForProgram` is a no-op for a course whose entries name no programme
  in `studyProgramKeys`, which is most of them, so an unguarded control would
  visibly do nothing on the majority of course pages — the same failure the
  layer box was fixed for.

  **Default is all, per visit, never persisted.** One URL has to show two
  people the same week, and a remembered choice would need a pre-paint read to
  avoid shifting the week in a frame late (§6). The narrowing acts on the
  ENTRIES handed to the renderer, not on `showAllGroups`: that flag states what
  the surface is, and the switch is the student asking for a slice of it. The
  flag is an option on `collectSessions`, which is what both views read their
  entries through — `applyGroupSelection` is not a no-op with no picks and no
  programme, so without it neither view could express this at all.

  **Its blocks are live, and its popover carries no verb.** They were inert for
  a while, on the stated grounds that the popover edits a plan. It does not:
  it is a READ card, the facts of the session you pointed at, which is exactly
  what a visitor deciding between five parallels wants. What this page genuinely
  lacks is an editor to send them to, so `onOpenSettings` is null and the card
  ends at the link to the course. Same on `/user/<navn>`, for the same reason.

  **The week is dated by one rule, everywhere.** Inside the teaching period the
  day headers carry their day-of-month and today gets its disc; outside it the
  numerals come off and the week is a mønsteruke. `weekView` derives that from
  the weeks it was handed rather than taking it from the caller, so three
  surfaces cannot disagree about whether the week on screen is a particular
  one.

- **A bar that runs out of room folds into a menu, and the WRAPPER is what
  folds.** One controller (`src/lib/menuPanel.ts`), two bars. Above its
  breakpoint the wrapper is `display: contents`, so its children are the bar's
  own flex children and the wide layout is exactly what it would be with no
  menu at all; below it the wrapper is an absolutely-positioned `.np-frame`
  panel, drawn only while the bar carries `data-menu="open"`.

  Three things about that are load-bearing. It is **not** a `<dialog>` and not
  `[popover]`, because neither can be switched back to inline layout by CSS and
  switching is the entire point. The open state is `data-menu` **on the bar**,
  never `[hidden]` on the wrapper — that rule carries `!important` and would
  delete the controls at every width rather than only on a phone. And there is
  **one DOM**: every control that folds is bound by id elsewhere, so a
  duplicated phone copy would collide and a `matchMedia` node-move would
  relocate a live `<select>` across resizes and ClientRouter swaps.

  **ONE BAR USES THIS NOW, and that is the correction.** The plan bar folded at
  46 rem because it carried five controls, two of which were about the week
  rather than the plan. Moving those two down to the week's own section left
  three things on the row, which fit 390 px, so the fold went and the rules it
  needed went with it — the per-bar breakpoint, and *a control that redraws the
  week closes the menu, a control that only confirms itself stays open*. Both
  are recorded here because they were right about the mechanism; neither has a
  bar left to govern. **A fold is a symptom.** Reach for one only after asking
  whether the bar is carrying something that belongs somewhere else.

  The shell topbar still folds, at 480 px, and genuinely does run out of room:
  a wordmark, two nav links, an account and a theme toggle have nowhere else to
  be.

- **The hand-over is a MARK, and the confirmation is the mark swapping.**
  `share` → `check`, with `aria-label` carrying both the name and the
  confirmation. A check is the half of "it worked" that is read before any word,
  and with no word there is nothing else to read.

  **The three labelled versions before it are why.** "Del" → "Lenke kopiert"
  grew the button and shoved the Uke/Liste switch ~22 px sideways at the moment
  it was pressed. Pinning to the *wider* label stopped the jump and bought a
  permanent slab of dead space after the short word. "Del lenke" → "Kopiert"
  made the RESTING state the widest, so the pin cost nothing at rest — a good
  fix, and still a pin, a measurement and a reserved width for a control that
  only ever needed not to change size. **An icon square cannot change size.**
  The apparatus is deleted, not improved: `reserveShareWidth` and its measured
  `minWidth` are gone.

  The label was also 84 px of the one row the plan's name has to fit in at
  390 px, which is what made this the change that let the `⋯` menu go.

  Its icon is drawn from `Icon.astro` like every other mark, and that is not
  bookkeeping: as a hand-inlined `<svg>` with no width, no height and no CSS it
  was a flex child with no intrinsic size and **computed to 0×0**, so the
  button painted the word with an 8 px hole where the mark should be, and the
  mark appeared — oversized — only in the state where the label wrapped the box
  open. **A mark in this system carries its own size**; do not inline one that
  leaves sizing to the layout it lands in.

- **THE WEEK IS SOMETHING YOU PICK, and the week's controls are the week's.**
  Three controls decide what the grid draws — *which weeks*, *which layers*,
  *in what shape* — and all three now live in the week's own section, in two
  rows, on all three surfaces that draw a week
  (`src/components/WeekControls.astro`):

  ```
  Uke 34  ⌄
  ☐ Øvinger og labber                            [ Uke | Liste ]
  ```

  **The second row's geometry is a rule, not a layout.** The layer box is hard
  left, the view switch hard right, and **nothing may ever come between them**.
  They are the two things a student throws while reading the week, and a third
  control landing in that gap is what the split into two rows exists to prevent.

  **The picker is above them rather than beside them, and the reason is 390 px.**
  Three controls come to about 400 px against 358 px of content width, so
  sharing a row means the phone silently gets a different arrangement from the
  desktop. Above, the same two rows hold at every width and on every surface —
  which is what lets this be a component instead of three similar bars.

  **`mountWeekView` owns the block, and nothing in it has an id.** Every control
  is found by `data-role` inside the element the page hands over. Three surfaces
  can therefore carry three copies with no prefix bookkeeping and nothing to
  collide, and the runtime twins that existed for `/user/<navn>`
  (`buildWeekTabs`, `buildLayerToggle`) are deleted — that page has a static
  shell now.

  **What the picker offers, and what decides its default.** «Alle uker» is the
  mønsteruke, «Denne uka» follows the calendar rather than pinning a number, and
  every teaching week is listed by number and Monday ("Uke 36, 31. aug"). The
  default is **the same predicate that already decides whether the drawn week
  carries dates**: inside the teaching period the page is open in a particular
  week and shows it; outside there is no such week, so the pattern is the only
  honest answer and «Denne uka» is not in the list at all. Deriving both from
  one predicate is what stops the picker and the column headers disagreeing
  about whether this is a real Monday.

  **A chosen week is always a real one**, so it carries its Monday's numerals
  whether or not today falls inside the teaching period. The disc still marks
  *today*, so it appears only in the week today is in.

  **Not persisted, and not in the URL** — unlike the view, which is a preference
  about shape. One link has to show two people the same week, and a remembered
  scope would need a fourth fact in the pre-paint probe to avoid drawing the
  wrong height for a frame. It is a lease like the view is: changing weeks
  releases the frame's reservation, because a week with three sessions is not
  the height being held for a week with eleven.

  **The verdict is not narrowed with the grid.** A collision in week 40 is a
  fact about the plan, and the margin note names the weeks it happens in, so it
  stays on screen beside a week that does not show it. What changed is the
  wording and the shortcut: "2 kollisjoner denne uka" became **"2 kollisjoner"**
  (with a picker on the page the old phrase reads as a claim about the drawn
  week), and pressing it moves the picker to the week the clash is actually in
  before flashing anything — `ConflictGroup` already carries that list.

- **A pass says nothing.** "Ingen forelesninger kolliderer" was removed on
  2026-08-04. It answered a question a student only asks when something might be
  wrong and spent a line of the first screen on every load reporting that
  nothing is — which a phone rule already half-admitted by hiding it there. What
  survives is the **admission** it used to carry: some courses publish sessions
  but nothing the classifier calls a lecture, so the DR-1 check went over them
  rather than on them, and that is a caveat with no claim left to qualify. It
  stands alone now as an "unknown" chip, the same shape as the other two
  branches about a check that could not be completed.

  **So the verdict line holds no space.** Its only tenants are exceptions — a
  collision, a check that could not run, a load over 30 sp — so `:empty` takes
  it out of flow the rest of the time, and it carries no reservation. The
  loading chip went with the reservation: the week's own skeleton is directly
  below and already says a timetable is being fetched. Reserving 22 px for a
  line that is usually silent costs the week that space on every load; the shift
  when an exception does arrive is one row, on the minority of plans that have
  one.

  **DR-9's deadline left with it**, to the foot of the Emner list. It is a fact
  about the calendar rather than about the plan, it was the one permanent tenant
  of a row otherwise reserved for exceptions, and what a student does about it
  is register those courses.

- **ONE CONTROL HEIGHT, at every pointer type, and the target is bigger than the
  box.** `--control-h` used to step 36 px → 44 px under `@media (pointer:
  coarse)`. That bought hit area by making every phone layout taller — the plan
  bar, the topbar's menu rows and the settings dialog's group list each grew
  8 px per control — which is paying in the dimension a phone has least of.

  36 px clears **WCAG 2.5.8 (AA), 24 × 24**, unaided; `e2e/flows.pw.ts` measures
  every control on the planner against that floor. The reach a thumb wants is
  bought where it costs nothing instead: a transparent pseudo-element grows the
  hit rectangle past the painted box (`primitives.css`), so a 36 px control
  answers a 44 px tap while occupying 36 px. **Overlapping targets steal each
  other's taps**, so a control closer to its neighbour than the shortfall does
  not get one.

- **EVERY DISMISSAL IS DECIDED ON THE CLICK, and a modal surface has a visible
  scrim.** One rule, and it replaced three different ones.

  A touch has no click of its own: the browser synthesises `mousedown` /
  `mouseup` / `click` after `touchend`, which is after `pointerup`. Every
  dismissal here used to happen at or before `pointerup`, so the surface was
  gone when its own click landed and the browser hit-tested that click against
  the page it had been covering. One tap closed the sheet and pressed what was
  behind it — a semester select opened, a layer toggled, a link navigated. On a
  phone that is most of the screen, because all three surfaces are full width
  down there.

  The click is the LAST event of the gesture, so a dismissal decided there has
  nothing trailing it. That is what the chrome menu's scrim does, and now what
  the session sheet's scrim and every modal's backdrop do.

  **`closedby="any"` had to go, and it was not only the leak.** The attribute is
  Chrome 134+ and Firefox 141+; on Safari and iOS it is still "preview", so on an
  iPhone it did nothing at all and those four modals could not be dismissed by
  tapping outside them. And the light-dismiss algorithm — shared by popovers and
  dialogs, so `popover=auto` leaks the same way, with a mouse too — is *defined*
  to close at `pointerup`. `closedby="closerequest"` stays, because Esc and the
  close watcher are the halves with no defect. `dialogDismiss.ts` keeps the one
  property the attribute was chosen for: a text selection dragged from inside the
  card and released on the backdrop is not a dismissal, because the gesture has
  to begin outside as well as end there.

  **A modal surface's scrim is visible, never a transparent click-catcher.** The
  session card below 60rem is a full-width bottom sheet and reads as modal, so
  the page behind it is out of reach — and it has to LOOK out of reach, or the
  reader is told they can still touch what they can still see. Above 60rem the
  same card is a small anchored non-modal thing over a live page, it gets no
  scrim, and the click going through is the point: it is what lets one bar hand
  the card to the next. Two shapes, two promises; on the phone, moving between
  bars costs a second tap.

- **The view switch is a segmented control**, a recessed track with the live
  view raised out of it. A travelling underline was right when it lived in a
  section head, where a hairline was the local idiom; in a bar beside two
  buttons it read as a link.

- **A row's actions are `ellipsis-vertical`; the plan's own control wears
  `settings-2`.** The same mark at two scopes claimed the two do the same kind
  of thing at different levels, and they do not.

- **A card about a course carries a swatch, not a coloured band.** The
  `.np-head` variants that flooded the masthead with the hue are deleted: a
  full-bleed band of colour is the loudest chrome on a site whose thesis is
  that structure comes from type, hairlines and space, and it cost two
  variants that had to knock out their own text and invert every control
  inside themselves.

- **The course rail carries a swatch, not a printed chip.** The dot already
  carries identity in the exam list, in Liste's rows and in the session card;
  the rail was the one place that fused the hue and the code into one filled
  shape, making the same course two objects on one page. A dropped course
  keeps the swatch as a ring, so the column of marks never develops a hole.

- **The session popover is labelled rows** — `Tid`, `Sted`, and a `Merk` when
  there is something a clock cannot state. The clock is not the card's largest
  figure: in a grid the time is already drawn, because it *is* the block's
  place in the week you just clicked. The title names the **session** — code,
  course, activity — because "which of this course's five sessions is this" is
  the one thing the block has no width to say. Three parts divided by two
  hairlines: head, rows, foot.

- **A picker may not make the student read for themselves.** NTNU titles a
  split lecture with the programmes it serves, and one course publishes
  seventeen such rows flat and unsorted. Rows naming the plan's own programme
  sort to the top and are marked `ditt program` (whole-token matching —
  marking the wrong row would send someone to another programme's lecture),
  and the list is grouped under `Forelesning` / `Øving og lab`. This is weaker
  and always true where `(din parallell)` is suppressed for being a guess,
  which is exactly the ambiguous case where the help is needed.

- **One door into the picker, and the study plan is a FILTER on it.** There used
  to be a second: "Velg fra studieplanen (8)" in the credit-gap line, `hidden`
  until the plan was short of credits and sitting one row above the standing
  "Legg til emne". Two things were wrong with it and the second is the fatal
  one: it competed with the primary action, and it opened *the same dialog*, on
  the whole catalog — so the pool its label promised was on neither surface.
  It is a `.np-toggle--text` facet beside the dialog's search field now, and
  the dialog **opens with the facet engaged in exactly the state that button
  used to render in** (`openScoped` = the plan is short of credits), so the one
  press the door cost still lands on the study plan's courses and now actually
  arrives. Scoped, the empty query lists the pool rather than prompting; a
  scoped search that finds nothing **names the filter** and says how many the
  catalog has, because a scope must never escape on its own. The facet is
  **absent, not merely unpressed**, when the pool is empty — persona B has no
  programme and must not be shown a control that can only subtract.

  The gap line keeps its informative half ("Mangler 7,5 sp"): a dialog you have
  not opened cannot tell you it is worth opening. It is a sentence now, with no
  control in it.

  The collapsed "Fra studieplanen" panel at the foot of the column is not a
  third door and is untouched: it is the study plan's groups with their
  **verbatim prose** (DR-5) and a row per offered course. It answers "what does
  the study plan say", which a flat search result cannot; the facet answers
  "show me those courses here", which the prose panel is the wrong shape for.

- **Under the week: one rule, two equal columns, one hairline.** The sections
  were already card-less; what was left was a gap doing a rule's job. The
  week's open question lost its panel and got nothing in its place — the page
  knows it has at most one such question, so the box was a container for a
  count it already knew, and what makes the question findable is that it is
  the only thing above the week and carries the only button there. A coloured
  bar down its side was tried and rejected: Ink-Before-Chrome, and the accent
  is already spent on the button.

- **The exam list is typography, not a diagram.** The date is `**21.** nov`
  with the weekday at the far end, and the reading-day gaps are the only rules
  in the list — each a hairline running from its own words to the edge. A
  vertical rule with exams as knots on it was the same idea turned the wrong
  way for how the list runs. The list **closes with its own caveat**
  ("Eksamensrom tildeles noen dager før"), because NTNU publishes exam dates
  months before rooms and a list that never mentions rooms reads like a fetch
  that failed.

- **The load track is 8 px and fully rounded, and its mark is labelled.** At
  15 px it was a bar chart of one bar, competing with the course rows it
  introduces. It marks 30 sp when the plan has run past it, and says so
  ("streken er 30 sp") only when it actually draws the mark.

- **`isRoomCode` counts whitespace and a digit, not punctuation.** The old
  letter/digit shape test rejected `A4-156` for its hyphen and demoted a real
  room to the style meant for "Digital undervisning".

- **The reference wins, unless something measurable says it cannot.** When the
  design reference and this repo disagreed, three change logs used to explain
  what was "deliberately not the reference". That had it backwards: the
  reference was the design decision, not a proposal to be reconciled against
  what was already here. Where they conflict, take the reference — and when a
  measurement blocks it, buy the value rather than keeping the old design.
