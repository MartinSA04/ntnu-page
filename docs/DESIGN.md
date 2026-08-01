# Design System: Ruteark

The design system of ntnu-page — designed for this product only. StudyCompanion
was the inspiration (Flexoki warmth, paper-and-ink discipline, quiet
interactions); Ruteark is its own voice, built for a planning instrument
rather than an editorial reading surface.

## 1. North star

**The calendar, played straight.** A student opens this to answer one
question — does the term hold together, and where do I walk in at 10:15 — so
the design's job is to disappear. The week is days against hours in solid
colour blocks with mass; the list is a departure board with the time in the
left margin and the room in the right; and the page carries no modular
containers, because the content is static and known.

Adopted 2026-08-01, replacing **Ruteark** (warm Flexoki paper, a vendored
grotesk and mono, a squared ruling, printed course fills). The craft bar is
Google Calendar and Apple Calendar: the familiar thing, executed properly,
without irony or smuggled quirk.

Explicitly rejected: anything that reads as institutional (Studentweb,
Blackboard, Altinn), as a startup dashboard, or as concept-led — a timetable
that costs half a second per glance has failed regardless of how it
photographs. Cards as page structure are out: they are a container for
content whose count and shape you do not know at build time, and this page
knows both.

## 2. Color

Neutrals carry the page; colour is spent on exactly four jobs, and no two of
them share a hue.

- **Ground and ink**: `--bg` #FFFFFF is the content surface itself — there is
  no grey backdrop for cards to float on. `--card` #F7F7F8 survives for the
  few surfaces that genuinely float (popovers, dialogs). Ink runs
  `--fg` → `--muted` → `--faint`; hairlines are `--border` and
  `--border-strong`. Dark mirrors on #151517.
- **The interface — ink** (`--ui` = `--fg`). Focus rings, pressed and
  selected fills, links, hover, membership. Unchanged and still adjudicated:
  a focus ring measured 18.6:1 as ink against 4.4 as a colour.
- **The accent — system blue** (`--accent` #1A73E8 / #8AB4F8 dark), and it has
  **exactly one job**: the primary action and the now/today marker. The old
  `--accent` was retired for doing five jobs; this one is allowed back because
  it does one. It is deliberately absent from the course palette — an
  interface mark that shares a hue with a course vanishes the moment it
  crosses that course's block.
- **The verdict — green** (`--verdict`): the term works. Nothing else.
- **Collision — red** (`--clash`): two things that cannot coexist. Fetch
  errors, empty states and validation are ink, not red.
- **Attention — amber** (`--warn`): short of a problem. An over-full load,
  sessions sharing an hour. Amber exists so red is never spent on something
  merely worth a look.
- **Course hues**: six, and every one is kept clear of the accent's azure, the
  verdict's green and the collision's red. They are chosen dark enough (light
  theme) and light enough (dark theme) to carry knocked-out text, so
  `--block-mix` is 100 % in both themes — the fill is the hue itself, not the
  hue pulled toward black.

`tests/site/tokens.test.ts` measures every pair that carries text and fails
below AA. It caught two regressions in this very change.

### Named rules

**Red-Is-Collision.** Unchanged. Red marks coexistence failures, nothing
else, and the copy names both things.

**Green-Means-Fits.** Unchanged. Green is a judgement about whether the term
works. Membership, selection, focus and hover are interface and take `--ui`.

**One-Job-Accent.** The accent may mark the primary action and "now/today",
and nothing else. The moment it marks a third thing it is `--accent` again in
the bad sense, and the rule that killed it applies.

## 3. Typography

**One family: the platform's own UI face.** `-apple-system,
BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`.
There are no vendored fonts, no `@font-face`, no preloads and no build step —
see CLAUDE.md for what was deleted and why. Google Calendar and Apple
Calendar both use the system face on purpose; so does this.

**`--font-mono` is an alias of `--font-sans`.** `.np-data` keeps its meaning
and every call site — it still marks a figure a student copies — but the
distinction is now carried by `font-variant-numeric: tabular-nums` rather
than by a second typeface. Figures still column up; they just do it in the
same voice as the sentence around them.

**Scale — seven steps, one per role, unchanged.** `--text-xs` label,
`--text-sm` small sentence, `--text-base` body, `--text-md` title, `--text-lg`
headline, `--text-xl` page title, `--text-2xl` display.

### Named rules

**Data-Is-Mono is retired, and `.np-data` is not.** The rule was right about
*which* strings matter — times, dates, codes, counts — and wrong that they
need their own face. Keep marking them; the mark now buys tabular figures
instead of a monospace.

**`.np-note` vs. `.np-hint`.** Unchanged, and still a real distinction:
`.np-note` is the fragment voice ("uke 38–40", "0 sp"), `.np-hint` is any
small text with a verb. Putting a sentence in `.np-note` is still the same
category error it always was.

## 4. Surfaces, ruling, elevation

Depth is tonal paper layering: page → `--card` → `--card-nested`, flat at
rest. Shadows are whispers (`--shadow-sm` on floating tiles, one step up on
hover); `--shadow-lg` only for true overlays. Radii are instrument corners:
2/3/6px, `--radius-lg` 10px reserved for `.np-frame`.

**The ruling** — the signature. A faint `--cell`-sized squared grid
(`.np-ruled`) drawn in `--ruling-line`, framed by `.np-frame`, tiled from
the **content box** (`background-origin: content-box`) so it stays in
register with whatever it's ruling instead of starting 16px early under the
frame's padding — every ruled surface's own padding must therefore be a
whole multiple of `--cell`.

**Where it actually is, corrected 2026-07-27 (audit ds-1/ds-4 — the doc was
stale, the code is right).** The squared field was **retired from the weekly
spread** in f86105b (adjudicated in
`docs/superpowers/specs/2026-07-27-planner-simplification-design.md`): a
15-minute square in both axes behind five columns of blocks is ~600 squares
of texture, and what a student reads off a timetable is the *hour*. The week
therefore carries **one hour hairline only**, drawn by `planner-week.css` on
`.planner-grid-rail`/`.planner-grid-day` — i.e. on the boxes whose top edge
*is* the slot grid's origin, which is what keeps it in register (tiling it
from the frame is what caused REVIEW.md D4's ~22 px misregistration). Neither
`.np-frame` nor a squared field is on the spread, and the exam date list
carries no ruling either. **`.np-ruled` and `.np-ruled--hours` are both
deleted** (§5). `--hours` went with zero callers; `.np-ruled` itself had one
left, the landing page's picture of a plan, and that picture is gone
(REWORK-2026-07-30d). Reaching for either would have given a contributor a
15-minute square field plus a second hour rule anchored to a different box
than the live one.

If the ruling ever comes back on a planning surface, put it on the rail/day
columns, not the frame.

### Named rules

**Ruling-Marks-The-Plan.** The squared ruling appears exactly where
planning happens — and, since f86105b, *only where a plan is depicted rather
than operated*: the live week reduced to its hour hairline, and the last
squared field is the homepage's picture of a plan (§8). Everywhere else the
paper is plain — if the whole site is ruteark, nothing is. A message is never
rendered inside a ruled frame (`renderGridMessage` exists for that).

**Ink-Before-Chrome.** Structure is tonal steps and hairlines; interactive
controls carry fills or washes, never borders. No sanctioned exception
remains — the one that used to exist here (`.np-kbd`) has zero users and is
deleted (§5).

## 5. Components (.np-*)

One grammar, defined once in primitives.css: rest = flat; hover = surface
answer (paper darkens a step, bare controls take `--wash`) + text lights to
`--ui` where it was muted; **press = a 1px dip, built into every control below**
(`.np-btn:active`, `.np-icon-btn:active`, `.np-navlink:active`,
`.np-toggle:active`, `.np-summary:active`, `a.np-tag:active`,
`button.np-tag:active`) — `.np-press` is the escape hatch for one-off
pressables that aren't one of those, not something to add alongside them;
focus = global 2px `--ui` outline.

**Labels & data**
- **`.np-kicker`** — mono, `--text-xs`, 500, uppercase, `--tracking-wide`,
  `--muted`. Eyebrow/section label.
- **`.np-data`** — mono + `tabular-nums`, inherits size. Wraps any figure a
  student copies (time, date, week, code, count).
- **`.np-note`** — mono, `--text-xs`, `--muted`. Fragments only, never a
  sentence (§3).
- **`.np-hint`** — sans, `--text-sm`, `--leading-normal`, `--muted`,
  `max-width: var(--measure)` (opt out with `max-width: none` in a narrow
  column). Every small *sentence* — help text, empty states, provenance
  (§3).
- **`.np-note-clash`** — sans, `--text-sm`, `--leading-normal`, colour
  `--clash`. A sentence; wrap the day/time/week/code it quotes in
  `.np-data`.

**Buttons**
- **`.np-btn`** — paper action button on `--control-bg`/`--control-hover`
  (grotesk 500 label, sentence verbs: "Legg til i planen"). `aria-pressed`/
  `.is-active` fills `--ui`.
- **`.np-icon-btn`** — 36px bare glyph, `--wash` hover.
- **`.np-navlink`** — bare navigation text; `aria-current="page"` inks it.

**Tags & toggles**
- **`.np-tag`** — squared course tag: hue `.np-dot` + mono code, `--text-sm`.
  A ruteark cell, not a pill. `.np-tag--sm` — the in-grid size for a tag
  inside a timetable block (`--text-xs`, tighter padding, 6px dot). Inside
  an already hue-washed `.planner-block`, the tag drops its own surface
  (`background: transparent`) — a card-coloured chip on top of a course wash
  is chrome on chrome; a tag sitting directly on `--bg` (the exam list) keeps
  its card background.
- **`.np-dot`** — the square hue dot (8px, 1px radius; 6px inside
  `.np-tag--sm`), set via `style="--dot: var(--hue-cyan)"`.
- **`.np-toggle`** — selectable mono tag on `--control-bg`/`--control-hover`
  (semester switcher, filters), `aria-pressed` fills `--ui`.
  `.np-toggle--text` — sans, `--text-sm`, no uppercase/tracking, same fills
  and `aria-pressed`; use for multi-word proper names (studieretning/campus
  choices) where mono-tracked caps would wrap a 20-character Norwegian
  phrase to two rows. Don't also call `.toUpperCase()` in JS on either
  variant — the CSS owns casing.

**Fields**
- **`.np-field`** — paper input on `--control-bg`, nothing else at rest;
  focus-within keeps the 2px `--ui` outline. No edge rule (§2).

**No inset shadows, anywhere.** A mark pressed into a box is not this system's
voice; depth is tonal paper layering, and shadows are outset whispers under
floating things. The three that existed were **removed rather than
reimplemented** (2026-07-30): `.np-field`'s and `.studieinfo-select`'s
inline-start rule, and the ring on a dropped course's chip, which now simply
loses its fill. The `--clash-edge` token that carried a fourth is deleted, its
per-bar collision mark having been replaced by the day zone long before.
Replacing one with a painted gradient or an inset-offset outline is the same
mark in other clothes; don't.

**Surfaces**
- **`.np-panel`** — paper panel on `--card`.
- **`.np-popover` / `.np-popover-option`** — the floating list surface for
  every typeahead combobox: `--card` background (never `--card-nested`,
  which is the *recessed* step and inverts lighter-than-`--card` in dark),
  `--radius-sm`, `--shadow`, `max-height: var(--popover-max, 18rem)`.
  `.np-popover` sets no positioning (the call site keeps `position:
  relative` + placement); `.np-popover-option` sets no display/layout (the
  call site keeps its own flex/grid) — only the shared padding/corner/
  `.is-active`-highlight, which is what drifted between three hand-rolled
  copies before this existed.
- **`.np-frame`** — the bordered, rounded paper box. Live users: the three
  `<dialog>`s (studieinfo, add-course, block popover) and the homepage proof
  panel. Note it sets `overflow: hidden`, which is why the week's frame is
  deliberately *not* an `.np-frame` (it would kill the horizontal scroll —
  see `planner-week.css`).
- **`.np-head` / `.np-head-ident` / `.np-head-title` / `.np-head-sub`** — the
  masthead every card and modal opens on (REWORK-2026-07-30 "Kvittering"): what
  this is, its quiet second line, and the way out of it, full-bleed against the
  frame's own edge. Two grounds, and which one a surface takes says what it is
  about. Plain `.np-head` is paper one step down with a hairline under it, for a
  subject with no colour of its own (the studieinfo modal: a programme is not a
  course). **`.np-head--printed`** is the course's own printed fill with the
  text knocked out of it (§2's block ink, `--dot` set per open by the call
  site), so the session card and the course modal read as the bar you pressed;
  **`.np-head--reduced`** is the same fill at øving/lab strength. A `<dialog>`
  using one pads its BODY, never itself, and the body is what scrolls, so the
  head stays put. Live users: all four floating surfaces in the planner, i.e.
  the session popover and the course modal (printed), studieinfo and
  add-course (paper).
- **`.np-fact` / `.np-fact-value` / `.np-fact-sub`** — a fact and the line that
  qualifies it: a room over its building, a parallel over "one of three",
  credits over where the course came from. This is what replaced the
  `NÅR / ROM / HVA / UKER` label column, which spent a third of a 20 rem card
  naming facts that say what they are.
- **`.np-actions`** — a card's footer: a hairline, then what you can do about
  what is above it. **`--split`** pushes a pair apart when they are different
  kinds of thing (a verb that changes the plan, and the way out to another
  page); verbs about the same edit stay together at the start (studieinfo's
  Lagre/Avbryt, add-course's lone Lukk).
- **`.np-link-out`** — the way out of a card to a page ("Gå til emnesiden →").
  A target, not a tail: 24 px tall (WCAG 2.5.8), `--muted` until pointed at.
- **`.np-ruled`** — deleted with its last caller (§4). The ruling exists in
  exactly one place now, hand-rolled in `planner-week.css` on the boxes it
  rules.

**Disclosure**
- **`.np-summary`** — mono disclosure row with rotating chevron.

**Micro-interactions**
- **`.np-target-flash`** — quiet `--ui-ring` outline flash on deep-link arrival.

**Deleted — do not reach for these, they no longer exist:** `.np-kbd`
(zero users), `.np-tile` (zero users; §12's killed triptych was its only
prospective user), `.np-lift` (zero users), **`.np-ruled--hours`** (zero
users as of 2026-07-27, audit ds-4 — the week's hour line is hand-drawn in
`planner-week.css` on the box that keeps it in register; this modifier would
have tiled a second one from a different origin, §4). A documented primitive
with no caller is system debt; the primitive layer is defined once and every
user of it is expected to actually exist.

## 6. Motion

One easing (`--ease`), `--dur-fast` (110ms) for state, `--dur` (190ms) for
surfaces, `--dur-flash` for arrival marks. Transform/opacity/color only,
with one bounded exception below. Theme flips are instant (`.theme-snap`
zeroes transitions for one frame). No entrance choreography for arriving
data — a re-render caused by a fetch, a group pick or a plan edit draws
straight.

**The week is the exception, and only under a deliberate switch.** Two
controls change how the week is drawn rather than what is in it — Uke ⇄
Liste, and «vis øvinger og labber» — and both animate, because a student who
pressed one of them is asking to see the same plan differently and needs to
be able to follow it there.

- Uke ⇄ Liste redraws, so it plays the strike-in: a clip-path wipe from the
  left, staggered in reading order (`.is-striking`).
- The øving toggle does not redraw. One layer arrives or leaves, so what
  stays travels, what arrives strikes in after the space is made, and what
  leaves wipes out before the space closes (`layerMotion.ts`,
  REWORK-2026-07-29g). Replaying the strike-in here would claim that
  lectures which did not change had changed.

Travelling is what breaks the transform-only rule: the week's grid animates
`left`, `width`, `top` and `min-height`, because a bar's width **is** its
duration and a `scaleX` FLIP would squash the course code inside it for the
length of the move. It is bounded to ~50 elements of one surface on an
explicit press. The list half is flow layout and stays on `transform`.

Reduced motion zeroes all duration tokens globally *for CSS transitions*.
Scripted motion is not covered by that and asks the media query directly:
the conflict-note `scrollIntoView` falls back to `"auto"` (A5), and the
layer change skips its whole choreography.

## 7. Voice & copy

Norwegian bokmål, sentence case, no exclamation marks. Verbs name their
outcome and stay consistent through the flow: "Legg til i planen" →
"I planen"; "kolliderer med" for clashes; credits always "X av 30 sp" with
comma decimals. "Fjern" labels only an outright, irreversible removal (a
manual add). A programme course's removal is reversible — it grays out, not
gone — and gets its own verb: "Dropp" → "Legg tilbake" (§0.3 of PRODUCT.md;
using "Fjern" for both used to make an editable, reversible action read as
a delete). Errors say what failed and what to do next, in ink, without
apology. Empty states are invitations to act.

## 8. Adjudicated decisions

- **The verdict is green, not NTNU blue.** The tool's output is a verdict
  (fits / collides); green-vs-red is that verdict's native language. Blue
  remains a course-identity hue, and a verdict may not wear a colour that
  also means "this is TDT4120". Do not "brand-correct" this to blue.
- **The verdict green's exact value is measured, not chosen** (restated
  2026-08-01). The 107° Flexoki-departure argument died with the Flexoki
  ground; what survives is the constraint that produced it — the verdict must
  clear AA as text and as a fill on every surface it lands on, and must not
  collide with a course hue. `tests/site/tokens.test.ts` is the authority, and
  it rejected the first value tried in this change at 4.46:1.

- **The accent is back, with one job** (2026-08-01). `--ui` stays ink; a
  separate `--accent` carries the primary action and the now/today marker.
  A calendar without a "you are here" colour has to spend red on it instead,
  and red means collision here. The rule that killed the old `--accent` was
  never "no accent" — it was "no token doing five jobs".
- **A course hue may never be the accent's hue.** Found the hard way: with the
  interface blue and the course blue at the same value, the now-line vanished
  the moment it crossed that course's block. An overlay that crosses arbitrary
  fills cannot be a flat colour drawn from a palette it is also a member of.
- **The interface is ink, not the accent.** Ink-Before-Chrome already
  governed every other surface; the accent was the unexplained exception.
  A focus ring went from 4.39:1 to 18.62:1 by obeying the rule the rest of
  the system already followed.
- **Course hues never color text.** Hue-colored text on warm paper fails
  contrast in half the pairs; the square dot carries identity, text stays
  ink. Do not add colored course names for "scannability".
- **The ruling is not on cards** — re-adjudicated 2026-07-27 (audit ds-1),
  because the live state had inverted the original wording. Two decisions,
  and they are separate:
  1. *Do not spread it.* Extending the squared background to panels, cards
     or a hero for "cohesion" dilutes the one signature. That still stands,
     and it is the half reviewers keep proposing.
  2. *The week does not carry it either.* f86105b retired the squared field
     from the weekly spread in favour of a single hour hairline (§4), and
     REWORK-2026-07-30d retired the last ruled element on the site with it:
     the landing page's `aria-hidden` picture of a plan, which showed two
     invented courses colliding. A drawing of the product is not evidence
     that the product works, and the page already answers with the student's
     own week. `.np-ruled` is deleted; the ruling lives in the one file that
     draws it.

---

## 9. Change log

**2026-08-01 — Ruteark → the calendar.** Adopted after four direction rounds;
the owner chose the category standard played straight, over three concept-led
worlds. Landed in this pass:

- `tokens.css` remapped end to end: white ground, system ink ramp, the
  four-job colour scheme above, six course hues cleared of all three signal
  colours, `--block-mix` 100 % in both themes.
- Type moved to the platform UI face. **Deleted**: `scripts/fetch-fonts.mjs`,
  `scripts/woff2-tables.mjs`, `src/styles/fonts.css`, `src/styles/fonts/`,
  `tests/fonts.test.ts`, and the two preloads in `Layout.astro`.
  `--font-mono` is now an alias, so `.np-data` survives unchanged at every
  call site.
- `--exam-date-col` 6.5rem → 5.5rem: it was sized for a monospace date, and
  the proportional face sets the same string narrower. The e2e phone test
  caught the wrap this would otherwise have caused.

**2026-08-01, stage 2 — two views, and the page is the surface.**

- **Rader is no longer a planner view.** `WeekView` is `"kolonner" | "tavle"`
  and the tabs read **Uke** and **Liste**; `"kolonner"` stays the stored value
  and the default, because it is what a student's localStorage already holds
  and what the pre-paint probe must agree with. `grid.ts` is untouched and
  `/emne/[code]/` still draws the transposed week through it — which is now the
  only surface that does, so the Rader-geometry e2e claims (bar centring, the
  room printed whole) moved there and the needle's own test moved to the
  column week, where a needle still exists.
- **The two columns under the week are divided by one hairline**, not by a
  border around each. The sections were already card-less — what was left was
  a gap doing a rule's job. The week's open question (`.planner-direction`)
  lost its `.np-panel` and got nothing in its place: the page knows it has at
  most one such question, so the box was a container for a count it already
  knew, and what makes the question findable is that it is the only thing
  above the week and carries the only button there. A coloured bar down its
  side was tried and rejected — Ink-Before-Chrome, and the accent is already
  spent on the button. `--card` now appears only on things that
  float (the four `<dialog>`s, the popover) and on two ground tones (the exam
  band's empty day, the load track), which are grounds rather than cards.
- **The week's day header is a label, not a heading.** It was `--text-md` bold
  for the word "man"; it is now ~0.9rem medium in `--muted`, with today taking
  full ink and the weight. The CLS reservation is computed from the same
  `--planner-cols-head-font`, so it followed on its own.
- **`isRoomCode` counts whitespace and a digit, not punctuation.** The old
  letter/digit shape test rejected `A4-156` for its hyphen and demoted a real
  room to the style meant for "Digital undervisning".

**2026-08-01, stage 3 — the reference artifact, applied.**

- **One bar at the top of the page.** The plan's name and every control that
  acts on it share a row: the layer checkbox, the Uke/Liste switch, "Endre",
  and the primary "Legg til emne". The switch and the checkbox came up out of
  the week's own section head — a second bar 200 px lower saying the same kind
  of thing — and that head is gone with them.
- **The switch is a segmented control**, a recessed track with the live view
  raised out of it on paper. The travelling rule was right when it lived in a
  section head, where a hairline was the local idiom; in a bar beside two
  buttons it read as a link.
- **`.np-btn--primary` exists, and there is at most one per surface.** The
  accent's one job (§8) had no button to be on.
- **The title is a name, not a headline**: 1.25rem/600, down from `--text-xl`.
  The probe-driven `html[data-plan="program"]` face swap is **deleted** — stage
  1 aliased `--font-mono` to the system face, which killed the face half, and
  one size kills the rest. `data-plan` is still load-bearing for
  `--plan-courses` and the reservations.
- **The verdict is a run of chips**, on its own line between the plan's name and
  the week: a mark and a sentence, never a filled pill. The colour is in the
  sign; the words stay ink. "Ingen forelesninger kolliderer" says which thing
  DR-1 actually checked. An over-full load is a chip here too.
- **The deadline is on screen (D13/c3-1).** `Oppmelding stenger 15. september —
  45 dager igjen`, at the far end of the verdict line. The whole positioning is
  "before the registration deadline" and it had been in zero of six flows.
  `src/lib/planner/deadline.ts` holds NTNU's two standing dates and says why
  they are not crawled; a passed deadline says nothing at all.
- **Uke.** Weekday headers are three uppercase tracked letters with the full
  word left in the accessibility tree; today's is the accent, over a column
  washed in 5 % of it. Blocks carry **the course and the room, and nothing
  else** — the clock is already drawn, and the room is the only fact position
  cannot state, so it never drops out (the type shrinks instead). The needle is
  the accent with a 1 px page-coloured halo and a dot at the rail.
- **Liste.** The day head says when the day starts and ends (`08:15–17:00`)
  rather than how many hours are in it. The row you are inside is washed in the
  accent and carries a `nå` tag, placed on a timer by `syncBoardNow` — the same
  contract as the needle: an ordinary minute may not rebuild the week.
- **Under the week**: one rule between the week and what follows, two equal
  columns divided by one hairline, and pane heads with no rule of their own.
  The exam date is typography (`**21.** nov`) with the weekday at the far end,
  and the reading-day gaps are the only rules in that list — each a hairline
  running from its own words to the edge. The vertical rule with exams as knots
  on it is gone: the same idea, turned the way the list runs.
- **The load track marks 30 sp** when the plan has run past it.

**2026-08-01, stage 4 — the week's own surface.** Stage 3 moved the page's
structure and left the thing you actually look at alone.

- **A block's edges are its facts** — left and right are the day, top and bottom
  are the start and the end — so it carries no ring. The separation is real
  air, and each side does a different job: 3px in from the left so the block
  does not sit on the day's own rule, 6px of channel at the right so the hour
  ruling runs unbroken past it, 2px off the bottom so the line a session *ends*
  on is never covered. **4px of corner**: the old note beside `border-radius: 0`
  was right about pills and wrong about zero — at zero two touching blocks fuse
  into one column of ink.
- **The øving layer is tinted, not printed**, with its label in the course hue
  pulled toward ink — one treatment in both geometries. This is **the one
  sanctioned exception to "course hues never color text"** and it is measured,
  not assumed: `tokens.test.ts` checks both block pairs across all six hues in
  both themes, and rejected 22 % and 15 % dark tints at 3.94:1 and 4.42:1.
- **52px an hour, not 72.** A student reads a timetable for the *shape* of a
  week; at 72 an eight-hour day was 576px of column. Plus a tick per hour on the
  rail, because the ruling is painted behind the blocks as a calendar's is.
- **Drop-in windows moved to an all-day row.** A window is 08:15–14:00 every
  weekday — not an appointment at a time — so it has no honest place on the time
  axis. It was a rotated strip down the column's edge, which kept it out of the
  lane accounting but spent width the days need and set its label sideways. The
  row is drawn **at zero height** when the plan has no window, because a row
  that is absent in one state and present in the next cannot animate, and its
  rule is an inset shadow so at zero it draws nothing.

**2026-08-01, stage 5 — the rest of it.**

- **The week is dated.** Day headers carry the day-of-month beside the weekday,
  today's in a filled accent disc, and the context line leads with `Uke 38`.
  The week the grid draws is still a *pattern* — a block stands for every week
  in its own range — but the page is opened in exactly one of them, and a
  calendar that will not say which is a diagram. The honesty problem this
  creates is answered where it already was: a block whose weeks read "uke
  34–40, 42–47" is drawn under a date in week 41 where it does not occur, and
  the margin notes and the provenance line are what name that. A date numeral
  claims which Monday the column is, not that everything under it happens.
  `weekDates.ts` is ISO 8601 (NTNU publishes timetables in ISO week numbers)
  and unit-tested across both year boundaries.
- **The session popover is labelled rows** — `Tid`, `Sted`, and a `Merk` when
  there is something a clock cannot state ("Åpent vindu — du kan stikke innom
  når du vil"). The clock stopped being the card's largest figure: in a grid
  the time is already drawn, since it IS the block's place in the week you just
  clicked. The title names the *session* — code, course, activity — because
  "which of this course's five sessions is this" is the one thing the block has
  no width to say. It keeps the collision sentence and the edit action, which
  the artifact's card does not have.
- **The exam list closes with its own caveat** ("Første eksamen om N dager.
  Eksamensrom tildeles noen dager før."), because NTNU publishes exam dates
  months before rooms and a list that never mentions rooms reads like a fetch
  that failed.
- **The load track's mark is labelled** ("streken er 30 sp"), shown only when
  the track actually draws one.
- **The collision verdict is a shortcut to the collision.** "2 kollisjoner denne
  uka" is a button that scrolls the week to the first clash mark, in whichever
  view is drawing it — the one thing a student does after reading that sentence
  is look for them, and the week is a scroller. Underlined on hover only: at
  rest it is a verdict and must read as one.
- **The course rail carries a swatch, not a printed chip.** The dot already
  carries a course's identity in the exam list, in Liste's rows and in the
  session card; the rail was the one place that fused the hue and the code into
  one filled shape, which made the same course two different objects on one
  page. A dropped course keeps the swatch as a ring, so the column of marks
  never develops a hole.
- **The phone pays for the bar.** The controls that moved up cost rows the week
  used to have: the context line is clamped to one line at ≤46rem — with the
  week number moved to its front so the 42-character programme name is what
  gets cut — and the bar's rows tightened. The gate is now a fraction of the
  screen rather than a pixel count: the week must begin inside the first 35 %,
  which is the claim that was always meant. Measured at 277 of 844.

**What is deliberately NOT the artifact.** Its `--c1…--c5` are five Google
Calendar hues; this palette keeps its own six, which `tokens.test.ts` measures
against every fill and label they carry. Its body is 14px on a 1240px page;
this keeps the type scale in §3. Neither is a design the artifact argued for —
they are the defaults it inherited from being a single self-contained file.
