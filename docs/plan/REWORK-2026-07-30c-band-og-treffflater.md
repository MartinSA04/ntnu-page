# REWORK 2026-07-30c — the drop-in strip, and every target at 24 px

## D1 — A drop-in window is a strip, not a backdrop

TDT4120 publishes `Øvingsveiledning` **08:15–14:00, every weekday**. Over the
5-hour `ALL_DAY_MINUTES` threshold, so the week drew it as a *band*: full row
height, 50 % opacity, `z-index: 0` — behind every bar.

That was the right instinct and the wrong drawing. The instinct: a drop-in
window is not a session you attend at a time, so it must not take a lane and
push every real session down a row. The drawing: on any day with a lecture in
the same hours, the band's own label sat **under** that lecture and could not
be read at all, and what was left of it looked like a grey slab rather than a
course.

It is a strip along the bottom of the row now — `--planner-band-h`, 18 px, and
the row reserves height for it (`--planner-bands`), so it can never be
overlapped. Subordinate by size and position instead of by being hidden, at
full opacity because nothing is drawn on top of it any more.

It is also clickable now. As a 50 % backdrop it took no click handler, so the
one surface that could tell you its week range and its full room list — the
session popover — was unreachable for exactly the sessions whose bar is too
cramped to say either.

## D2 — Every target clears 24 px

WCAG 2.5.8 Target Size (Minimum), AA. Measured across `/`, `/emner/`,
`/emne/[code]/` and `/planlegger/` in four states, at 1440 and 390. **Six
controls were under it**, all of them wide enough and none of them tall
enough:

| | was | fix |
| --- | --- | --- |
| `.planner-edit-plan` "endre" | 37×22 | rebuilt — see D3 |
| `.planner-view-tab` ×2 | 56×21, 30×21 | padding on the buttons, negative margin on the group |
| `.planner-others-toggle` | 131×21 | same |
| `.planner-note-groups` ×4 | 230×21 | `padding-block: 3px; margin-block: -3px` |
| `.course-settings-link` | 121×21 | `min-height: 24px` |
| `.site-footer a` | 77×18 | `min-height: 24px`, pulled out of the line box |

The pattern throughout is **padding on the element that receives the click,
negative margin on its container**: a target is only a target where the
pointer actually lands, so padding on a wrapper is dead space — and the
negative margin means none of the 24 px is spent on layout. The section head
keeps the rhythm it had.

The first attempt got this backwards and padded the *container*; the audit
caught it still at 21 px, which is precisely why the check is now an e2e test
rather than a one-off script.

## D3 — "endre" becomes a control

It was an underlined word at 0.84 rem in a hint line: 37×22, under the floor,
and reading as a footnote rather than as the one thing on the page that
changes everything above it.

It is a `.np-btn` now — 36 px, a paper surface, and the same sliders mark the
course rows use for "settings for this thing", one scope up. Paper rather than
an ink fill, so it still does not out-shout the plan name beside it. It sits
in the title's own group, which keeps the verdict at the far end of the line
under `space-between`.

With no programme it reads **Velg studieprogram**; the empty week card keeps
its own button, and in that one state two doors is right.
