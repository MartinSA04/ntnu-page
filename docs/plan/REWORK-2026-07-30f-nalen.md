# REWORK 2026-07-30f — nålen, and rows that are actually centred

## D1 — The now marker is a needle on today's row

A 2 px ink line across today's row with a solid head sitting on the row's top
border.

The head is the load-bearing half. The line still has to cross a course bar,
and 2 px of ink laid over a saturated printed fill reads as a scratch rather
than as a mark — that is what the old marker looked like on any day with a
lecture at the current hour. Nothing else in the week ever sits on a row's top
border, so the head cannot be mistaken for something drawn on a course.

Two things it deliberately stops doing:

**It is not on the other days.** It used to draw a 32 % hairline down the whole
week, reasoning that the hour is the same hour on every row. That made it a
1 px line among 1 px hour rules — *the same kind of mark as the ruling it
crossed* — so on any day that was not today it was invisible. Driven at a
Saturday it communicated nothing at all. The ruler already labels the hours.

**It is not a clock.** No time rides on it, and outside the drawn hours it is
hidden rather than pinned to an edge. A week clamped to its own sessions has no
honest place to put 21:10, and the page has a footer, a ruler and a pointer
readout that all carry figures already.

So there are exactly two states: on today's row at a minute, or absent. The
weekend and the evening are the same state.

## D2 — Every bar is centred in its row

`--planner-lane-h` is a **stride** (bar + gap), so N lanes occupy N strides
*less one trailing gap*. That subtraction was missing: a one-lane row measured
`34 + 12 = 46 px` around a 28 px bar sitting 6 px down, leaving 6 above and 12
below. Every row in the week was off-centre.

Fixing the arithmetic was not enough. A row's real height is
`max(spine, field)`, and the spine won: at 1440 px the weekday is set at
1.7 rem with 12 px of padding, so the row was 51 px and the bar sat 8 above,
15 below. Absolute children offset from the top cannot centre inside a box
something else is stretching.

Two changes:

- `--planner-content-h` is declared on the field and every child measures from
  the **middle** of the row (`50% - content/2 + lane × stride`), so they centre
  in whatever height the row ends up being. The band takes the same middle:
  `50% + content/2 - band-h`.
- The spine takes `--planner-row-pad` instead of a hard 12 px and centres its
  own word, so a one-lane row is as tall as its content rather than 23 px
  taller because of the type.

Measured after, at 1440 and 390:

| | row | above | below |
| --- | --- | --- | --- |
| one lane | 44 px | 8 | 8 |
| two lanes | 78 px | 8 | 8 |
| one lane + drop-in strip | 70 px | 8 (bar) | 8 (band), 8 between |
| phone, one lane | 38 px | 6 | 6 |

The week also got about 7 px per row shorter, which is 35 px of the fold back
for free.
