# REWORK 2026-07-30b — ett navn, and a switch that is not a toggle

Measured on the running page at 1440 and 390 before anything moved.

## D1 — The plan is named once

The topbar chip read `MTDT · 2026 · Høst 2026`. The title block 100 px under
it read `Datateknologi – master (5-årig) MTDT` / `kull 2026 · Høst 2026`. Same
three facts, two typographic treatments, no division of labour.

**The chip leaves the planner** and stays everywhere else, where it is still
the only thing saying whose plan a course would join. That drops the topbar to
three children — which is what stops the wordmark and the chip truncating each
other into `Semesterp…` and `MTDT ·…` at 390 px.

**The title becomes the plan**, in the notation a student types:
`MTDT · 2026 · Høst 2026`, set in Spline Sans Mono. Every part of it is data,
so Data-Is-Mono governs it; the rule was already the system's, this just
follows it to the top of the type scale instead of abandoning it there.

At 1.75rem, not `--text-xl`'s 2rem: the mono sets wider and taller than the
grotesk, and 1.75 is the optical match for the 2rem every other page title
uses. It clamps down to 1.4rem, which is measured rather than chosen — at
390 px the banner has 358 px, and an 8-character code
(`EXPHPHIL · 2026 · Vår 2027`) sets 337 px there against 427 px at 1.75.

Each `part ·` is one unbreakable span, so a title that must still wrap breaks
as `MTDT ·` / `2026 · Høst 2026` rather than orphaning a lone `·` at the head
of the second line.

**The programme's own name is demoted to the hint.** It is a 42-character
database field with a hyphen and a parenthetical in it, and it was set at
2 rem, taking three lines on a phone before anything actionable appeared.

**With no plan there is nothing to name**, so the title falls back to being
the product's own — the one moment the wordmark and the page title are allowed
to agree, because until you pick a programme the page really is only
Semesterplan. It swaps back to the grotesk for that state.

## D2 — The verdict shares the title's baseline

PRODUCT §1's question and its answer on one line rather than two paragraphs
apart. `justify-content: space-between`, not `margin-left: auto` on the
verdict: a flex line holding a single item lays it out at main-start under
space-between, so the verdict sits at the far end when it shares the title's
line and returns to the left margin when it wraps to its own. The margin
version pinned it right in both cases, which on a phone left it floating in
the gutter.

## D3 — The switch is a rule that moves; the layer is a box you tick

`Rutenett`/`Liste` is a radio group. `Vis øvinger og labber` is a checkbox.
They were the same height, the same uppercase mono and the same accent fill —
three identical controls in a row, and nothing in the form said that one PICKS
and the other ADDS.

- **The switch** is two words with a 2 px rule that slides between them. No
  box: a box says "press me", and this is a place you already are — one of the
  two is always true, which a filled chip cannot say. The rule is the same
  mark the section head draws directly underneath, so the control sits *in*
  the structure rather than on top of it.
- **The layer** keeps its label but loses the chrome: a 14 px box that fills
  with ink when ticked. It cannot be mistaken for a third view.

`--view-x` / `--view-w` are written by `renderViewTabs` from the live button
boxes, because "Rutenett" and "Liste" are different widths in every face, at
every zoom step, and again once the webfont lands — a hard-coded 50 % is wrong
at all of them. Re-measured on resize and on `document.fonts.ready`. The rule
travels on the same `--dur`/`--ease` as the week's own layer change, so
pressing *Liste* and pressing *Øvinger* feel like one instrument; reduced
motion zeroes both.

Neither control is `.np-toggle` any more. The primitive is unchanged and still
correct where it is used (the studieinfo kull chips, `/emner/`'s city facets);
it was simply the wrong shape for these two.

## D4 — One opener, and it moved with the chip

`endre` in the hint line is the planner's only permanent studieinfo opener now
— a bare underlined word, not a button, because it changes a fact stated on
the line it sits in and a filled control there would out-shout the fact. With
no plan it reads `velg studieprogram`.

## Copy

«vis øvinger og labber» → «Øvinger og labber» wherever it is quoted, so the
grid's own margin note names the control as it is now labelled.
