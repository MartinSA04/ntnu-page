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
  frames, table lines, the keycap). Interactive controls are
  surface-or-nothing.
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

Scale: display 2.6rem/1.1 700 (tight-tracked), headline 1.6rem 700, title
1.13rem 500, body 1rem/1.55 400, label 0.72rem mono 500 uppercase
(`--tracking-wide` for kickers). Prose measure `--measure` (38rem); data
surfaces use the full `--maxw` (72rem) column.

### Named rule

**Data-Is-Mono.** If a string is something a student copies into a
calendar — a time, a date, a code, a count — it is mono. If it is a
sentence, it is the grotesk. No third voice.

## 4. Surfaces, ruling, elevation

Depth is tonal paper layering: page → `--card` → `--card-nested`, flat at
rest. Shadows are whispers (`--shadow-sm` on floating tiles, one step up on
hover); `--shadow-lg` only for true overlays. Radii are instrument corners:
2/3/6px, `--radius-lg` 10px reserved for `.np-frame`.

**The ruling** — the signature. A faint `--cell`-sized squared grid
(`.np-ruled`) drawn in `--ruling-line`, framed by `.np-frame`. It appears
on planning surfaces only: the weekly timetable spread and the exam ribbon.

### Named rules

**Ruling-Marks-The-Plan.** The squared ruling appears exactly where
planning happens. Everywhere else the paper is plain — if the whole site is
ruteark, nothing is.

**Ink-Before-Chrome.** Structure is tonal steps and hairlines; interactive
controls carry fills or washes, never borders. (Sanctioned exception: the
`.np-kbd` keycap.)

## 5. Components (.np-*)

One grammar, defined once in primitives.css: rest = flat; hover = surface
answer (paper darkens a step, bare controls take `--wash`) + text lights to
`--accent-ink`; press = 1px dip (`.np-press`); focus = global 2px accent
outline.

- **`.np-btn`** — paper action button (grotesk 500 label, sentence verbs:
  "Legg til i planen"). `aria-pressed`/`.is-active` fills accent.
- **`.np-icon-btn`** — 36px bare glyph, wash hover.
- **`.np-navlink`** — bare navigation text; `aria-current="page"` inks it.
- **`.np-tag`** — squared course tag: hue `.np-dot` + mono code. A ruteark
  cell, not a pill.
- **`.np-dot`** — the square hue dot (8px, 1px radius), set via
  `style="--dot: var(--hue-cyan)"`.
- **`.np-toggle`** — selectable mono tag (semester switcher, filters),
  `aria-pressed` fills accent.
- **`.np-field`** — borderless paper input, focus ring on the wrapper.
- **`.np-panel` / `.np-tile`** — paper surfaces; tiles float (`--shadow-sm`,
  `.np-lift .np-press` when links).
- **`.np-frame` + `.np-ruled`** — the planning spread.
- **`.np-summary`** — mono disclosure row with rotating chevron.
- **`.np-kicker` / `.np-data` / `.np-note` / `.np-note-clash`** — the mono
  label set; `-clash` is the red-ink margin note.
- **`.np-target-flash`** — quiet accent outline flash on deep-link arrival.

## 6. Motion

One easing (`--ease`), `--dur-fast` (110ms) for state, `--dur` (190ms) for
surfaces, `--dur-flash` for arrival marks. Transform/opacity/color only
(`.np-lift`'s shadow transition is the bounded exception). Theme flips are
instant (`.theme-snap` zeroes transitions for one frame). Reduced motion
zeroes all duration tokens globally. No entrance choreography.

## 7. Voice & copy

Norwegian bokmål, sentence case, no exclamation marks. Verbs name their
outcome and stay consistent through the flow: "Legg til i planen" →
"I planen · Fjern"; "kolliderer med" for clashes; credits always
"X av 30 sp" with comma decimals. Errors say what failed and what to do
next, in ink, without apology. Empty states are invitations to act.

## 8. Adjudicated decisions

- **The accent is green, not NTNU blue.** The tool's output is a verdict
  (fits / collides); green-vs-red is that verdict's native language. Blue
  remains a course-identity hue. Do not "brand-correct" this to blue.
- **Course hues never color text.** Hue-colored text on warm paper fails
  contrast in half the pairs; the square dot carries identity, text stays
  ink. Do not add colored course names for "scannability".
- **The ruling is not on cards.** Reviewers may suggest extending the
  squared background to panels or the hero for "cohesion" — that dilutes
  the one signature. It stays on planning surfaces only.
