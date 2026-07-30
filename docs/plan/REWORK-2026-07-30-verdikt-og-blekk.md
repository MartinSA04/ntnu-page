# REWORK 2026-07-30 — the verdict is green, the interface is ink

## Why

The accent did five jobs. Two of them were verdicts.

`--accent` owned the collision line, the credit total at a full 30 sp, the
"I planen" state, every focus ring and every link. *Green-Means-Fits* says
green never decorates — and a focus ring is decoration by that rule's own
definition. The rule was unenforceable because the token it forbade reaching
for was the only accent there was.

That is also why the green looked muddy, and it was not the hue's fault. One
olive had to be legible as a 2 px ring, readable as link text, and mean *yes*.
No colour is good at all three.

Three measurements, taken before anything moved:

| | as shipped | |
| --- | --- | --- |
| `--accent` hue | **73°** | the paper's own hue is 48° — 25° away |
| `--accent` on paper | **4.39:1** | under AA, hence `--accent-ink` *and* `--accent-strong` |
| `--accent-ink` | **7.63:1** | three stops past what it needed, and it reads brown |

## D1 — Split the token, and delete the old name

- **`--verdict`** — green. The collision line and a full 30 sp. Nothing else.
- **`--ui`** = `--fg`, **`--ui-contrast`** = `--bg` — focus rings, pressed and
  selected fills, links, hover, membership, the now marker.
- **`--accent` is gone**, along with `--accent-ink`, `--accent-strong`,
  `--accent-weak`, `--accent-ring` and `--accent-contrast`.

Deleting the name is the point. Renaming it `--verdict` and leaving a general
accent behind would have preserved the bug in a new spelling; with no
general-purpose accent token, the wrong thing is unnameable.

## D2 — A green at hue 107°

`#31701F` light, `#74AD55` dark.

A *true* green (145–160°) was never available: the course hue cyan sits at
175°, and Flexoki's green is olive precisely to stay clear of it. A verdict
that looks like a course identity is worse than a muddy verdict. 100–120° is
the only gap where neither the ground nor a course lives.

It is the one sanctioned departure from §2's "literal Flexoki swatches", and it
pays for itself by deleting two tokens: measured **5.89 / 5.30 / 4.75** on the
three paper steps and **5.89** the other way round as a fill, so one token is
both the text and the fill. The `-ink` and `-strong` variants existed only
because green-600 cleared neither. `tests/site/tokens.test.ts` asserts all
four figures in both themes.

## D3 — Ink for everything that is not a judgement

*Ink-Before-Chrome* already governed every other surface. The accent was the
unexplained exception, and obeying the existing rule took a focus ring from
4.39:1 to **18.62:1**.

Two places needed a real replacement rather than a token swap:

- **`.emner-row-link:hover`** rested at `--fg` already, so an ink hover would
  have been a silent no-op on the catalog's only row feedback. It answers with
  the underline now — the same mark every other link uses.
- **`.np-btn:hover` and `a.np-tag:hover`** likewise rested at `--fg`; their
  colour declaration is simply gone, and the surface step that was always
  doing the work is what remains.

`--selection` follows `--ui` too: a text selection is the browser's interface,
not a verdict on anything.

## D4 — The focus ring's offset is now load-bearing

The ring is the same colour as every filled control, so a focused
`.np-toggle` is an ink slab inside an ink ring and the paper gap between them
is the entire indicator. At 2 px it read as a seam. It is **3 px**.

(The green ring had the identical collision on green fills. It was rarer only
because fewer controls filled.)

## D5 — The mark

`favicon.ts`'s `ACCENT` is `VERDICT`, and it takes the **dark** value: the mark
is drawn on a fixed `GROUND`, never on paper, where the light green measured
4.24:1 and this one measures 7.16:1.

The favicon is the one place the verdict colour doubles as identity, and that
is the point of it — a filled cell on squared paper *is* a term that fits.

## What this does not touch

The chrome proposals it came out of. The planner still carries the duplicated
plan identity, the 2 rem programme string and three identical uppercase mono
toggles. Those are a separate change.
