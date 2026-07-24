---
name: study-companion
description: Editorial study-guide framework — warm Flexoki paper, serif reading faces, mono marginalia
colors:
  accent-default: "#205ea6"
  paper: "#fffcf0"
  paper-panel: "#f2f0e5"
  paper-nested: "#e6e4d9"
  ink: "#100f0f"
  ink-dim: "#575653"
  ink-faint: "#6f6e69"
  line: "#dad8ce"
  line-strong: "#cecdc3"
  night: "#100f0f"
  night-panel: "#1c1b1a"
  night-nested: "#282726"
  night-ink: "#cecdc3"
  night-ink-dim: "#9f9d96"
  night-ink-faint: "#878580"
  night-line: "#403e3c"
  night-line-strong: "#575653"
typography:
  display:
    fontFamily: "Fraunces, Georgia, Times New Roman, serif"
    fontSize: "2.7rem"
    fontWeight: 600
    lineHeight: 1.18
  headline:
    fontFamily: "Fraunces, Georgia, Times New Roman, serif"
    fontSize: "1.95rem"
    fontWeight: 600
    lineHeight: 1.18
  title:
    fontFamily: "Fraunces, Georgia, Times New Roman, serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.18
  body:
    fontFamily: "Spectral, Georgia, Times New Roman, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.65
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.72rem"
    fontWeight: 600
    letterSpacing: "0.02em"
rounded:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  space-1: "0.25rem"
  space-2: "0.5rem"
  space-3: "0.75rem"
  space-4: "1rem"
  space-5: "1.5rem"
  space-6: "2rem"
  space-7: "3rem"
  space-8: "4rem"
  gap-2: "8px"
  gap-4: "16px"
  gap-6: "24px"
  gap-7: "32px"
  gap-9: "48px"
  gap-11: "80px"
components:
  panel:
    backgroundColor: "{colors.paper-panel}"
    rounded: "{rounded.md}"
  tile:
    backgroundColor: "{colors.paper-panel}"
    rounded: "{rounded.md}"
  icon-button:
    textColor: "{colors.ink-dim}"
    rounded: "{rounded.sm}"
    size: "38px"
  pill-button:
    textColor: "{colors.ink-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
  paper-button:
    backgroundColor: "{colors.paper-panel}"
    textColor: "{colors.ink-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
  chip:
    backgroundColor: "{colors.paper-panel}"
    textColor: "{colors.ink-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0.35em 0.8em"
  chip-selected:
    backgroundColor: "{colors.accent-default}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
  keycap:
    backgroundColor: "{colors.paper-panel}"
    textColor: "{colors.ink-dim}"
    typography: "{typography.label}"
    rounded: "{rounded.xs}"
---

# Design System: study-companion

## 1. Overview

**Creative North Star:** "The Typeset Textbook"

A beautifully set course book whose margins happen to be alive. Print
typography carries the entire hierarchy: Fraunces display headings, Spectral
body at a generous 17px editorial measure, IBM Plex Mono for every piece of
interface marginalia (kickers, chips, keycaps, disclosure labels). The surface
is Flexoki warm paper in light mode and warm near-black in dark; every neutral
is tinted toward the ink, never pure #000/#fff. Interaction is quiet
marginalia, not app chrome: controls sit restrained at rest and answer every
touch (a surface answer on hover — paper fills darken a step, marginalia takes
an ink wash — with text lighting to accent-ink, a 1px dip on press, a 1px lift
on hover).

The system explicitly rejects generic docs-site chrome (the Starlight look),
SaaS/AI-slop tells (gradient text, glassmorphism, hero metrics, icon-card
grids), one-page scroll guides, and playful/bouncy motion. It is a product
surface judged at a best-tool bar: the design serves comprehension and exam
readiness; math and figures are the loudest things on the page.

**Key Characteristics:**

- Warm Flexoki paper/ink palette, per-course accent as the only brand variable
- Serif-first: display serif headings, serif body, mono UI labels; no sans in content
- Depth is tonal paper layering, not shadow stacking; flat at rest
- One interaction vocabulary sitewide (.sc-* primitives); completion is always accent
- Norwegian editorial content with server-rendered KaTeX math everywhere

## 2. Colors

Warm paper and ink from the Flexoki palette; one per-course accent; Flexoki
categorical hues for figures and semantic asides.

### Primary

- **Course Accent** (#205ea6 default; set per course as accent + accentDark):
  links, selection, focus rings, completion states, chip-selected fills,
  primary actions. As TEXT on tinted or elevated grounds it is always mixed
  75% toward the ink (--accent-ink) to stay AA; raw accent is reserved for
  fills, borders, rings, and icons.
- **Accent Contrast** (--accent-contrast: text/icon color placed ON solid
  accent fills, e.g. chip-selected, primary buttons). Light theme: white.
  Dark theme: the ink near-black (#100f0f), not white — dark-mode accent
  fills are light, so white small text on them fails AA; ink-near-black is
  the accent-fill's own foreground answer in dark mode.

### Neutral

- **Paper** (#fffcf0): the page ground (Flexoki paper).
- **Paper Panel** (#f2f0e5): panels, cards, insets (Flexoki base-50); panels
  step DOWN from the bright page, like print stock layered on a desk.
- **Paper Nested** (#e6e4d9): recessed fill for revealed/nested panels
  (base-100); nesting alternates fills rather than darkening forever.
- **Ink** (#100f0f), **Ink Dim** (#575653, 7.1:1), **Ink Faint** (#6f6e69,
  5.0:1): text ramp; faint is for nav numbers and captions only.
- **Line** (#dad8ce) / **Line Strong** (#cecdc3): structural hairlines only
  (dividers, table rules, keycaps, the quiz radio ring); no interactive
  control carries a border.
- Dark theme mirrors the ramp on Flexoki black (#100f0f ground, #1c1b1a
  panels, #cecdc3 ink); accents get per-course dark variants.

### Named Rules

**The Structural-Border Rule.** Borders never mark interactivity. Hairlines
are for structure (dividers, tables, canvas frames) and for two sanctioned
form glyphs: the keycap (--border) and the quiz radio ring (--border-strong).
An interactive control is surface-or-nothing.

**The Paper/Marginalia Rule.** State sits on paper; navigation sits in the
margin. A control you toggle, select, complete or type into keeps a
borderless paper fill (var(--control-fill, var(--bg-elevated)); hosting
panels set --control-fill to the nested tone). A control that acts instantly
or navigates is bare mono type/glyph with an ink-wash hover (--wash). Hover
text is --accent-ink in both families.

**The Accent-Ink Rule.** Accent-colored TEXT always goes through --accent-ink
(accent mixed 75% toward the ink); raw --accent on text is forbidden except on
accent-filled surfaces via --accent-contrast.

**The Literal-Swatch Rule.** Aside/callout tones (note, tip, warning, goals,
wrong) are literal Flexoki -low/-high swatches, never color-mix tints of the
accent; a dark accent mixed onto paper reads muddy.

## 3. Typography

**Display Font:** Fraunces (with Georgia fallback)
**Body Font:** Spectral (with Georgia fallback)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace fallback)

**Character:** A warm book-serif pairing: Fraunces gives headings a wonky
old-style confidence, Spectral reads long-form at 17px/1.65 without fatigue,
and Plex Mono marks everything that is interface rather than content.
Spectral ships true italic faces (400/600) so blockquotes and emphasis never
render synthesized obliques; both serifs declare metric-adjusted Georgia
fallbacks ("Spectral Fallback"/"Fraunces Fallback", size-adjust + ascent
overrides) so the webfont swap does not reflow the column.

### Hierarchy

- **Display / h1** (600, 2.7rem, 1.18): module titles; folio-numbered.
- **Headline / h2** (600, 1.95rem, 1.18): section headings; text-wrap balance.
- **Title / h3** (600, 1.5rem, 1.18): subsections and panel headers.
- **Body** (400, 1rem = 17px, 1.65): all prose. Two-width scheme: running
  prose (paragraphs, list text, disclosure bodies) is capped at a ~70ch
  measure (--measure: 35rem) for sustained reading; formula panels, figures,
  tables, code blocks, and framed widgets keep the wider 820px frame, since
  those need the extra width for equations, wide tables, and code lines to
  avoid awkward wraps. Content sizes are rem so the reading size scales;
  shell chrome is fixed px on purpose.
- **Label** (600 mono, 0.72–0.84rem, uppercase kickers at 0.02em; wide
  0.08em for part dividers): chips, kickers, keycaps, disclosure summaries,
  nav numbers.

### Named Rules

**The Mono-Marginalia Rule.** If text is interface (label, kicker, control,
badge, count), it is IBM Plex Mono. If it is content, it is a serif. No sans
ever appears in rendered content.

**The Fixed-Slab Exception.** Code blocks (Shiki) keep one fixed near-black
surface in BOTH light and dark theme — the single deliberately cold slab on
the warm paper (terminal-as-artifact). It does not tone with the paper ramp
like every other panel; the copy-button's colors are calibrated specifically
against that fixed surface (see base.css comments) and would mis-contrast if
the block ever inherited theme-panel tokens.

## 4. Elevation

Depth is tonal paper layering, flat at rest. The page is the brightest sheet;
panels step down one paper tone; nested panels alternate between base-100 and
base-50 so double-nesting reads as layers instead of a darkening pit. Shadows
are whispers (--shadow-sm at rest on floating cards) that grow one step on
hover; --shadow-lg is reserved for true overlays (search palette). Dark mode
inverts the logic: elevation lightens.

### Shadow Vocabulary

- **Whisper** (`0 1px 2px rgba(ink, 7%)`): resting shadow on floating tiles.
- **Hover** (`0 4px 12px 8% + 0 1px 3px 6%`): the .sc-lift hover response.
- **Overlay** (`0 24px 60px 22%`): search palette / modal layer only.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest; shadow growth is a
response to hover or overlay, never resting decoration.

## 5. Components

One vocabulary sitewide, extracted into `.sc-*` primitives (primitives.css).
Admonition is the reference component; new widgets must speak this language.
Feel: restrained at rest, tactile on touch.

### Buttons

- **Shape:** small radius (6px); square icon buttons at 38px (--control-h).
- **Paper (stateful — .sc-btn, .sc-chip, .sc-field):** borderless panel fill
  one paper step off the ground, mono label; hover darkens the fill one step
  (--card-hover; a 6% ink wash over nested fills) and lights text to
  --accent-ink.
- **Marginalia (navigational — .sc-pill, .sc-icon-btn, .sc-copy):** bare mono
  label / bare glyph in dim ink; hover paints --wash and lights text to
  --accent-ink.
- **Focus:** 2px accent outline offset 2px. Press dips 1px (.sc-press).

### Chips (.sc-chip)

- **Style:** pill radius, borderless paper fill, mono xs text.
- **State:** hover darkens the fill + accent-ink text; selected fills solid
  accent with --accent-contrast text (aria-pressed="true").

### Cards / Containers (.sc-panel / .sc-tile)

- **Corner Style:** 8px (12px for large frames).
- **Background:** paper-panel; nested content alternates paper-nested/panel.
- **Shadow Strategy:** whisper at rest, hover grows shadow + 1px lift
  (.sc-lift); nested cards drop shadows entirely.
- **Border:** none on floating cards; hairline --border where structure
  needs a line instead of a fill step.
- **Internal Padding:** space-4 to space-5.

### Inputs / Fields

- **Style:** quiz options and search fields are paper: borderless fills one
  step off their ground (quiz options recess to --card-nested; search fields
  are .sc-field on the page ground), mono or body text per context. The quiz
  radio ring keeps the one sanctioned --border-strong form glyph.
- **Range sliders (.sc-range):** the native OS range is app-chrome, so every
  framework slider wears one primitive — a thin inset --card-nested groove, an
  accent progress fill (WebKit via a JS-driven --pct, Firefox via
  ::-moz-range-progress), and a slim accent playhead ringed in paper. Used by the
  Stepper seek + size controls and the Simulation parameter sliders.
- **Focus:** 2px accent outline, offset 2px, radius-sm.
- **Error / correct:** literal Flexoki red/green -low fills with -high text
  (--wrong/--wrong-bg, --tip/--answer-bg).

### Navigation

- Sticky topbar (74px, --topbar-h contract) + left course sidebar (288px,
  narrowed to 14rem in the 981–1199px band to protect the reading measure) +
  right "on this page" rail (200px, ≥1440px). Sidebar rows: mono numbers
  in ink-faint, accent completion states, hover-lift. Breakpoints: 1440px
  reveals the TOC rail, 980px collapses the sidebar (drawer), 640px is the
  mobile pass — the complete vocabulary; no other widths.

### Disclosures (signature)

- Solution / Hint / Derivation share one idiom (.sc-summary): mono accent-ink
  summary row, rotating chevron (90° in 120ms), hairline under the open
  summary, faint ink-overlay hover. Revealed bodies sit on the nested paper
  tone.

### Motion vocabulary

- One easing: cubic-bezier(0.32, 0.72, 0, 1); durations 120ms (state),
  200ms (surface), and a 1.8s one-shot (--dur-flash) for deep-link arrival
  flashes (sc-target-flash). prefers-reduced-motion zeroes all three tokens
  globally. The theme flip is deliberately INSTANT — the swap itself rides no
  view transition and no eased colour. Both animated forms were tried and
  reverted (2026-07): WebKit compounds per-element inherited-colour eases into
  a per-hop staircase (deep text late-snaps at ~2x the duration), and it gates
  view-transition fade presentation on the main thread, which the flip's own
  full-tree recalc saturates — the fade steps on iPhone no matter its shape.
  The resting controls still carry their hover-feel colour eases (--dur-fast),
  though, so on the flip they would ease alone ~120ms behind the already-snapped
  page; ThemeToggle adds a `.theme-snap` class to `<html>` for exactly one frame
  around the swap and a base.css rule zeroes every transition while it is
  present (hub included), so the whole tree snaps in one recalc. The class is
  gone by the next frame, leaving hover eases untouched at rest. ClientRouter
  navigations keep their 180ms single-snapshot fade (base.css).
- **The Lift-Shadow Exception.** The vocabulary is otherwise transform/opacity
  only (compositor-cheap); .sc-lift's hover transition is the one bounded
  exception, additionally transitioning box-shadow (a paint cost) so the
  whisper-to-hover shadow growth reads as continuous rather than a hard swap.
  Scope stays deliberately narrow: this exception does not license box-shadow
  transitions elsewhere.

## 6. Do's and Don'ts

### Do

- **Do** route every accent-colored text through --accent-ink; keep raw
  --accent for fills, borders, rings, icons.
- **Do** give every interactive element the full state set: rest, hover
  (surface answer + accent-ink text), focus-visible (2px accent outline),
  press (1px dip).
- **Do** use mono for anything that is interface, serif for anything that is
  content (The Mono-Marginalia Rule).
- **Do** express depth by stepping paper tones (panel → nested → panel);
  keep shadows for hover and overlays.
- **Do** keep completion/progress accent-colored everywhere; completion is
  the accent's semantic job.
- **Do** honor prefers-reduced-motion via the duration tokens; any new
  animation must collapse to 0ms with them.

### Don't

- **Don't** ship generic docs-site chrome ("the Starlight look"); this is an
  editorial reading surface, not a docs theme.
- **Don't** use SaaS/AI-slop tells: gradient text, decorative glassmorphism
  (two sanctioned functional exceptions: the topbar's scroll-legibility
  backdrop blur, and the search palette's ::backdrop scrim, which blurs
  content behind an active overlay rather than frosting a resting surface),
  hero-metric blocks, identical icon-card grids, side-stripe callout borders
  (border-left > 1px as color accent).
- **Don't** use pure #000/#fff anywhere; every neutral is a warm Flexoki tone
  (the print stylesheet is exempt — print intentionally spends pure
  white/black for ink economy, since paper toning and Flexoki tints have no
  meaning on a printed page; screen themes never do this).
- **Don't** put a border on an interactive control; borders are structural
  only (The Structural-Border Rule).
- **Don't** tint asides by color-mixing the accent onto paper; asides use
  literal Flexoki swatches (The Literal-Swatch Rule).
- **Don't** add playful/bouncy motion, confetti, or gamification aesthetics;
  no orchestrated page-load choreography.
- **Don't** put per-course logic or derived colors in the framework; courses
  set explicit accent + accentDark (Explicit over Derived).

## 7. Adjudicated Design Decisions

Deliberate choices that read as defects to conventional-UX review. Each was
raised by a design critique and rejected with rationale; do not "fix" them,
and do not re-report them in future reviews.

- **The quiz is one-shot, with no retry control.** Retrying a small quiz
  after the correct answer has been revealed tests nothing. Quiz state is
  deliberately unpersisted; a later revisit naturally re-arms it.
- **KeyTakeaways checkmarks are purple, not accent.** They tone-match the
  purple takeaways card (Flexoki categorical) and are decorative list marks,
  not completion indicators — completion-is-accent does not apply, and they
  must never become accent-colored or interactive-looking.
- **Flashcard rating is active before the card is flipped.** A student who
  knows the answer by heart rates without being forced to flip first; the
  widget trusts the user's self-assessment.
- **The module pager shows numbers only ("Neste: 03").** The sidebar carries
  full titles on desktop; titles on the pager would wrap multiple lines on
  mobile; pressing next lands on the module's title immediately. The button
  does not need to spell it out.
- **The flashcards tool keeps the English label "Flashcards".** It is the
  day-to-day word students use; a Norwegian coinage like "læringskort" would
  read as artificial. The schema default (ui.flashcardsLabel) stays English;
  do not localize it.
