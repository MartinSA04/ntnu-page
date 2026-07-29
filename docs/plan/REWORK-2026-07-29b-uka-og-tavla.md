# REWORK 2026-07-29b — Uka, Tavla, og Nå

User mandate, 2026-07-29, after four design rounds. Supersedes the week's
geometry decisions in `REWORK-2026-07-25-design.md` §4 and the day view in
`REWORK-2026-07-29-editing-and-day-view.md` (D4/D5/D7).

## The finding

Every version of this week for a year has had **time running vertically**.
TV guides, festival clashfinders and Gantt charts do not: they put time on
the horizontal axis and the channel/stage/day as rows, so the eye scans
across time and down to see what collides at one moment.

It is arithmetic, not taste. A day *column* is ~150 px and cannot get wider —
there are five of them. A day *row* is the full page width, so a 1 t 45
lecture is **22 % of the width** instead of a sliver. The block no longer has
to print its own start time, because a labelled axis reads precisely; it can
spend its space on *what* instead of *when*.

## D1 — The week transposes

`renderGrid` draws days as rows and time as the horizontal axis. Every
consequence follows from that:

- **Piles are gone.** They existed because a cluster deeper than two could
  not be split at 150 px. Lanes stack downward now and vertical space is
  cheap, so `layoutDay` is called uncapped and never returns `piled`.
  `maxColumnsForViewport` and the pile block go with it.
- **The day view is gone.** It existed to give one day the width five columns
  could not. In a transposed grid the time axis is already full width, so
  focusing a day gains nothing. `Tavla` (D2) is the narrow-width answer
  instead. `focusDay`, `previousFocusDay`, `onDayFocus`, the day strip and the
  `grid-template-columns` transition are all removed.
- **The hour ruling turns 90°.** Hairlines run vertically, one per hour,
  because the ruling follows the time axis whichever way it points.

## D2 — Tavla, the second week view

A departure board: one row per session, the start time set large in tabular
mono, the room the same size in the opposite margin, the course name between
them. No geometry — it reads identically at 390 px, in print and in a screen
reader, which is exactly where the grid is weakest.

The planner carries a two-way switch, `Uke ⇄ Tavla`. It is a *view* of one
plan, not a second plan: both render from the same `PlanCourseState[]`, and
the choice is not persisted in the hash (it is how you are looking, not what
you are looking at).

## D3 — Nå on the landing page

The landing page's one piece of state was a text line: "Planen din: MTDT ·
5 emner". It becomes the answer to the question a returning student actually
has — **which room, right now** — with the room set as display type, the
progress of the current session as a filled rule, and the next few sessions
under it. It replaces `#home-resume`, and falls back to the plan summary when
nothing is running.

## D4 — Ink, not tint

The visual treatment the four rounds converged on, applied in both themes:

- **Blocks are printed colour with the code knocked out of them** — a solid
  hue with `--on-hue` text — not an 8–18 % wash of the paper. Five tints of
  beige neither identify nor recede; five solid fields do both.
- **The weekday name is the page's spine**: display size, weight 700, tracked
  tight, each locked to its row. The week you are not in recedes; today is at
  full ink. It is how you find your row.
- **A collision is a hole punched through the week** — the overlapping minutes
  cut across every lane in the row and edged in `--clash`. It is the only
  element that crosses lanes, which is exactly what a collision is.
- **One orchestrated motion**: on a view switch the bars strike in
  left-to-right, 55 ms apart, like the week printing. Nothing else animates.
  `prefers-reduced-motion` removes it.

DESIGN.md §6's "no entrance choreography" is superseded for this one
transition by explicit user approval of the motion in the design round.

## What this deletes

`maxColumnsForViewport`, `buildPileBlock`, `pileSummary`, `pileDetail`, the
`planner-day-strip`, `GridRenderOptions.focusDay` / `previousFocusDay` /
`onDayFocus`, `GridRenderResult.dayCount`, and `animateFocusChange`. The
`layoutDay` engine itself is unchanged — it is simply called uncapped.
