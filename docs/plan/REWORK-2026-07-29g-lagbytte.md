# REWORK 2026-07-29g — "vis øvinger og labber" as a layer change

## The problem

Uke ⇄ Liste has a motion: the bars strike in from the left, staggered in
reading order. "Vis øvinger og labber" has none. It tears the whole week down
and rebuilds it in one frame — rows grow, the axis shifts, twenty new bars are
suddenly there. Same button, same surface, and one of them feels made while the
other feels broken.

But it cannot have the *same* motion. Replaying the strike-in over the whole
week because one checkbox moved is exactly the entrance choreography DESIGN §6
forbids: the lectures that were already there have not changed, and redrawing
them claims they have.

## The principle

The motion has to say what actually happened: **one layer arrived, or one layer
left.**

- What stays **travels** to its new place. It is not redrawn.
- What arrives **strikes in**, with the same wipe and the same easing as the
  view switch, *after* the space has been made.
- What leaves **wipes out** first, and the space closes behind it.

The ordering is the whole point: space opens before anything arrives, and what
is leaving is gone before the space closes. Nothing crosses.

## D1 — The week (grid): animate the geometry, not the elements

The week keeps all its geometry in custom properties: `--planner-x` /
`--planner-w` / `--planner-lane` on a bar, `--planner-lanes` on the day's
field, `--planner-hours` on the grid. `left`, `width`, `top` and `min-height`
read from those.

After a fresh render the *old* values are written back onto the elements that
survived, layout is forced, and the values are released to their new ones. CSS
does the rest. That buys:

- rows that grow and shrink with their own ruling — the rules between days
  glide, they do not jump;
- bars that keep crisp type when the axis changes length. A FLIP with `scaleX`
  would squash the label, and a bar's width *is* its meaning.

The cost is that this animates layout properties, which DESIGN §6 otherwise
does not allow. It is bounded: only on an explicit layer change, only across
the ~50 elements the week has, never on a data re-render. §6 says so now.

## D2 — The list (Tavla): FLIP

Tavla is a flow list with no geometry in properties, so it uses FLIP: measure
before, measure after, set `transform` to the difference and release it.
Translation only — the rows do not change size, so nothing is squashed.

Every element that can move carries a `data-motion-key` that is stable across
the toggle (`code|day|from|to|label`, with an occurrence index for duplicates).
A row inside a collision bracket subtracts its parent's delta, or the two
transforms would compound.

## D3b — The departure is the arrival played backwards (2026-07-30g)

The sequence above was mirrored from the start: space opens, then bars arrive;
bars leave, then space closes. The **stagger** was not. Arrivals struck in one
after another in reading order; departures all vanished on the same frame.

That is not the reverse of an order, it is the absence of one, and it is what
made hiding the layer read as a different gesture rather than as the same one
undone.

They now leave on the same 32 ms step, counted backwards — the last bar to
land is the first to go. Measured on a six-bar layer:

| | reading order → delay |
| --- | --- |
| arrive | 152, 184, 216, 248, 280, 312 ms |
| depart | 160, 128, 96, 64, 32, 0 ms |

And the close waits for the *last* wipe rather than the first:
`--planner-departs` carries the final stagger index, so the field's
`transition-delay` is `departs × 32 ms + --dur-fast` — 270 ms for six bars,
which is exactly when the last one finishes. "What is leaving is gone before
the space closes" now holds for all of them, not just the earliest.

## D3 — What leaves

Elements that disappear are out of the DOM before anything can animate them.
They are re-inserted as ghosts in a layer over the week, at the coordinates
they held, and wipe out in the reverse direction of the strike-in.
`aria-hidden`, `tabindex="-1"`, `pointer-events: none` — they are a picture,
not content.

## D4 — Reduced motion

The whole choreography is skipped in JS, not merely zeroed in CSS: it is
scripted, and the `--dur` tokens do not reach inside `requestAnimationFrame`.
Without it the toggle is an immediate re-render, which is exactly what it
replaced.

## Scope

Both surfaces that carry the button: `/planlegger/` (both views) and
`/emne/[code]/` (the grid). It is one control — it cannot behave two ways.
