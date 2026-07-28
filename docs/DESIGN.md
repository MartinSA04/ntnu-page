# Design System: Ruteark

The design system of ntnu-page — designed for this product only. StudyCompanion
was the inspiration (Flexoki warmth, paper-and-ink discipline, quiet
interactions); Ruteark is its own voice, built for a planning instrument
rather than an editorial reading surface.

## 1. North star

**"Ruteark"** — the squared paper every Norwegian student sketches a
timetable on, set with an engineer's hand. The page is a warm Flexoki sheet;
planning surfaces carry a faint squared ruling; data is typeset in a humanist
mono; the tool's verdict is a color: green when things fit, red ink where
they collide. Interaction is quiet and tactile — flat at rest, surface
answers on hover, a 1px dip on press.

Explicitly rejected: serif bookishness (that is StudyCompanion's voice, not
this tool's), SaaS gradients/glassmorphism/hero metrics, warning-triangle
alarmism, pill-shaped chrome, bouncy motion, pure #000/#fff anywhere.

## 2. Color

Flexoki throughout. Every neutral is warm; accents are literal Flexoki
swatches, never derived mixes (except the sanctioned `--accent-ink` and
`--wash` mixes in tokens.css).

- **Paper**: `--bg` #FFFCF0 ground, `--card` #F2F0E5 panels one step down,
  `--card-nested` #E6E4D9 for recessed/nested fills. Dark mode mirrors on
  Flexoki black (#100F0F / #1C1B1A / #282726) — elevation lightens.
- **Ink**: `--fg` #100F0F, `--muted` #575653, `--faint` #6F6E69 (captions
  and placeholders only).
- **Hairlines**: `--border` / `--border-strong` — structure only (rules,
  frames, table lines). Interactive controls are surface-or-nothing.
- **Controls**: `--control-bg` / `--control-hover` — the resting/hover fill
  of `.np-field`/`.np-btn`/`.np-toggle`, one deliberate step off `--card` so
  a control is identifiable against the page in *both* themes (measured:
  `--card` on `--bg` is only ~1.1:1, below WCAG 1.4.11's 3:1 for a control
  boundary). `--control-edge` — a neutral (not accent) inline-start rule on
  `.np-field` only, since a field carries no text label to identify it the
  way a button's or toggle's caption does; a green edge on every resting
  field would spend Green-Means-Fits on chrome instead of a verdict. This is
  a tonal step, not a border: Ink-Before-Chrome still holds, the control
  layer is just one more layer of the same paper stack.
- **Accent — Flexoki green** (#66800B light / #879A39 dark): the color of
  "it fits". Owns: focus rings, selected fills, links, the credit total at
  30 sp, "I planen" state. As text always via `--accent-ink` (green mixed
  65% toward ink) — raw `--accent` text is forbidden; on accent fills use
  `--accent-contrast`.
- **Collision red** (#AF3029 / #D14D41 + `--clash-bg`): **only** for two
  things that cannot coexist (timetable overlaps, same-day exams). Fetch
  errors, empty states and validation are ink, not red.
- **Course hues**: six Flexoki categoricals (blue, cyan, purple, magenta,
  orange, yellow — green and red are spoken for), assigned by selection
  order, expressed as the square `.np-dot`. Never as text color, never as
  borders.

### Named rules

**Red-Is-Collision.** Red marks coexistence failures, nothing else. If red
appears, two concrete things clash, and the copy names both.

**Green-Means-Fits.** Positive verdicts are the accent's job: complete
credits, conflict-free confirmations, membership state. Green never
decorates.

## 3. Typography

**Voice**: Schibsted Grotesk (400/500/700) — a Norwegian grotesk with
sturdy, slightly wonky terminals. All sentences: headings, body, buttons,
navigation.
**Data**: Spline Sans Mono (400/500/600) — every time, date, week number,
course code, credit count, kicker and label; `tabular-nums` where figures
column up.

Both are vendored as a **single variable file per subset** (`latin` +
`latin-ext`, four files total) declaring a `font-weight: <min> <max>` range,
not one static `@font-face` per weight — every weight above is a real
instanced axis position, never browser-synthesised fake bold. See
`scripts/fetch-fonts.mjs`, which asserts (a) every vendored file contains an
`fvar` table — a static instance smuggled in here would silently reintroduce
fake bold at every weight but one — and (b) the four files hash differently
— a family or subset collapsing to one file means the subsetting broke.
Only the two `latin` faces are preloaded (Norwegian æ/ø/å live in `latin`,
U+0000–00FF; `latin-ext` never loads for our own copy).

**Scale — seven steps, one per role, no dead rung:**

| Token | Size | Role |
| --- | --- | --- |
| `--text-xs` | 0.72rem | label (mono kickers, notes, toggles) |
| `--text-sm` | 0.84rem | small sentence (`.np-hint`, control labels) |
| `--text-base` | 1rem | body |
| `--text-md` | 1.13rem | title (section and row heads) |
| `--text-lg` | 1.6rem | headline (`<h2>`) |
| `--text-xl` | 2rem | page title (`<h1>` on content pages) |
| `--text-2xl` | 2.6rem | display (the homepage, and nowhere else) |

Prose measure `--measure` (38rem) applies only to **unclassed** prose
(`:where(p,ul,ol):not([class])`); every classed data surface — result
lists, course rows, exam lists — uses the full `--maxw` (72rem) column. A
list that needs the narrow measure sets it explicitly; the default is wide.

### Named rules

**Data-Is-Mono.** If a string is something a student copies into a
calendar — a time, a date, a code, a count — it is mono. If it is a
sentence, it is the grotesk. No third voice.

**`.np-note` vs. `.np-hint`.** `.np-note` is Data-Is-Mono's fragment voice —
"uke 38–40", "0 sp", "dato ikke satt", "kull 2026" — never a full sentence.
Any small text with a verb (help text, empty-state invitations, provenance,
"undervises ikke i valgt semester") is `.np-hint`: sans, `--text-sm`,
`--leading-normal`, `--muted`. Putting a sentence in `.np-note` or a bare
fragment in `.np-hint` is the same category error Data-Is-Mono forbids —
it just took a second class to say it precisely.

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
`.np-frame` nor `.np-ruled` is on the spread, and the exam date list carries
no ruling either. **`.np-ruled--hours` is deleted** (§5) — it had zero callers
while still shipping in the sitewide bundle, and reaching for it would have
given a contributor a 15-minute square field plus a second hour rule anchored
to a different box than the live one. The only surviving `.np-ruled` surface
on the whole site is the homepage proof panel (`.home-proof-frame`, §8).

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
`--accent-ink`; **press = a 1px dip, built into every control listed below**
(`.np-btn:active`, `.np-icon-btn:active`, `.np-navlink:active`,
`.np-toggle:active`, `.np-summary:active`, `a.np-tag:active`,
`button.np-tag:active`) — `.np-press` is the escape hatch for one-off
pressables that aren't one of those, not something to add alongside them;
focus = global 2px accent outline.

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
  `.is-active` fills accent.
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
  (semester switcher, filters), `aria-pressed` fills accent.
  `.np-toggle--text` — sans, `--text-sm`, no uppercase/tracking, same fills
  and `aria-pressed`; use for multi-word proper names (studieretning/campus
  choices) where mono-tracked caps would wrap a 20-character Norwegian
  phrase to two rows. Don't also call `.toUpperCase()` in JS on either
  variant — the CSS owns casing.

**Fields**
- **`.np-field`** — paper input on `--control-bg`, a persistent 2px
  `--control-edge` inline-start rule (§2 — this is the one primitive that
  owns that shadow; don't add another `box-shadow` to it or a class composed
  with it), focus-within keeps the 2px accent outline.

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
- **`.np-ruled`** — the squared field, used with `.np-frame`. One live user:
  the homepage proof panel (§4/§8). Not on the week, not on the exam list.

**Disclosure**
- **`.np-summary`** — mono disclosure row with rotating chevron.

**Micro-interactions**
- **`.np-target-flash`** — quiet accent outline flash on deep-link arrival.

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
surfaces, `--dur-flash` for arrival marks. Transform/opacity/color only —
no exceptions remain (the one that used to exist, `.np-lift`'s shadow
transition, is gone with the primitive). Theme flips are instant
(`.theme-snap` zeroes transitions for one frame). Reduced motion zeroes all
duration tokens globally *for CSS transitions* — the one scripted motion
outside them (the conflict-note `scrollIntoView`) checks
`prefers-reduced-motion` directly and falls back to `"auto"` (A5). No
entrance choreography.

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

- **The accent is green, not NTNU blue.** The tool's output is a verdict
  (fits / collides); green-vs-red is that verdict's native language. Blue
  remains a course-identity hue. Do not "brand-correct" this to blue.
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
     from the weekly spread in favour of a single hour hairline (§4). So the
     one `.np-ruled` element left on the site is the homepage proof panel
     `.home-proof-frame` — an `aria-hidden` **picture of a plan**, not a card
     and not a control. That is sanctioned: it is the site's one illustration
     of the instrument, and the signature belongs on the thing being
     illustrated. It is not a licence to rule any other decorative surface.
