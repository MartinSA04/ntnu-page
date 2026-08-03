# Onboarding, the empty planner, and the punctuation sweep

Date: 2026-08-03

## Prerequisite: this is built AFTER publish-and-share

**Do not start this until
`docs/superpowers/plans/2026-08-03-publish-and-share.md` has landed, Task 5
included.** This spec is written against the world that plan leaves behind, and
two of its decisions are wrong before it:

1. **The hash is deleted** (the sync design's §5, in
   `2026-08-02-accountless-sync-design.md`). Sharing becomes publish plus
   `/user/<navn>`, the recipient *views* it, and nothing is ever written to
   their storage. So `localStorage` becomes the only way a plan can reach
   `/planlegger/`, which is what makes this spec's §1 predicate complete. Built
   before Task 5, the same design needs a hash branch in the pre-paint script,
   which breaks the sync design's stated invariant that nothing in the CLS
   machinery depends on the hash, and then has to be unwound.
2. **The publish flow writes new UI copy**, and it is copy in the old
   punctuation: `Mac · Safari`, `iPhone · Safari — nå`, `Denne enheten — 5
   emner · 30 sp`, `Ikke synkronisert · prøv igjen`. Running this spec's §5
   sweep first would have it re-violated by the next feature to land. Running
   it second means the sweep covers the publish flow's strings too, and its
   test gate is what keeps them right afterwards.

The dependency is one-directional: publish-and-share does not need anything
here.

## Why

`/planlegger/` with no plan is the one screen where a new student has no other
evidence about what this tool is, and it is the weakest screen in the product.
Measured on the built site at 1280×900 and 390×844:

- The week frame holds its full reserved height with nothing in it, so the
  invitation card floats in roughly 900 px of white with another 700 px under
  it before the first section.
- The bar around that void carries four controls that act on nothing: the
  "Øvinger og labber" layer box, the Uke/Liste switch, the semester select, and
  the registration deadline ("Oppmelding stenger 15. september — 43 dager
  igjen"), which is a countdown to registering courses the student has not
  chosen.
- **Eksamener** and **Emner** print their headings over placeholder copy:
  "Legg til emner for å se eksamensdatoer.", "0 av 30 sp", "Ingen emner i
  planen ennå." A third door to adding courses sits under the second of them,
  competing with the card's own "Jeg har emnekodene".
- The invitation itself reads "Velg studieprogram og kull, så tegner vi uka di
  — med forelesninger, kollisjoner og eksamensdatoer." The verb is wrong for
  this product and the em dash is house-banned as of this document.
- Reaching a week costs a press, a modal, a search, a chip, a second chip and a
  "Lagre".

The filled planner is good. That is exactly why the empty one reads as badly as
it does: everything on screen presupposes the content that is missing.

## What changes

Five things, in dependency order.

### 1. First run is `html:not([data-plan])`, which the probe already writes

No new attribute, and no new mechanism. `Layout.astro`'s pre-paint script sets
`data-plan` to `"program"` when a programme is stored, `"courses"` when the
count is above zero, and **removes it otherwise** — so its absence is already
exactly "no programme and no courses", written before the first frame and kept
true for the rest of the visit by `src/lib/planProbe.ts`.
`html:not([data-plan])` is the first-run predicate, and committing a programme
clears it without a reload.

That predicate is complete **because the hash is gone** (see Prerequisite
above). `localStorage` is the only way a plan can reach `/planlegger/`, so what
the probe reads is the whole truth about whether this load has one. Nothing is
added to the pre-paint script, and the sync design's invariant — *"nothing in
the CLS machinery depends on the hash"* — stays true.

Why a pre-paint attribute rather than JS-built DOM: the probe is the one
mechanism that runs before the first frame, so a CSS-gated panel paints **with**
the document. No mount flash, no reserved void, and no reservation to lease and
release.

### 2. The first-run screen

Static markup in `src/pages/planlegger/index.astro`, revealed by
`html:not([data-plan])`, which hides `.planner-banner` and `#planner-main` in
the same rule.

```
        Lag timeplanen for semesteret

   Velg studieprogrammet og kullet ditt, så er
   uka klar med forelesninger, kollisjoner og
   eksamensdatoer.

   ┌──────────────────────────────────┐
   │ Søk etter studieprogram …        │
   └──────────────────────────────────┘
     MTDT    Datateknologi    master 5 år
     MTFYMA  Fysikk og matematikk

   Har du emnekodene? Legg dem til direkte.
```

- The `<h1>` is the invitation, not "Semesterplan". The wordmark says that
  100 px above, and a page title that repeats the wordmark spends the largest
  type on the screen saying nothing.
- One sentence under it, and it is the product's mandate in one line.
- The programme field is **on the page**. Choosing a programme swaps the field
  for the chosen chip and reveals the kull chips in place.
- **Choosing a kull commits.** There is no "Lagre" on this screen, because the
  sentence above promises the week is ready once the two facts are given, and a
  third press makes that false.
- Studieretning is not asked here. `#planner-direction` already asks it
  afterwards, when the study plan has landed and it knows whether it matters.
- The secondary route is one quiet line of text, not a paper button competing
  with the field.
- No autofocus. The field is the only control on the screen, and an autofocus
  opens the keyboard over the sentence that explains why the field is there.

Nothing else renders: no bar, no tools, no deadline, no verdict, no week frame,
no Eksamener, no Emner.

### 3. One picker, two hosts

`buildStudieinfoSection(deps): StudieinfoSectionHandle` in
`src/components/planner/studieinfo.ts` is already a mountable unit with a
built-once, re-rendered-in-place element, a `reset()`, and a `focusProgram()`.
The first-run screen mounts the same unit. `StudieinfoSectionDeps` gains one
field:

    commit: "explicit" | "on-kull"

- `"explicit"` is today's behaviour and stays the dialog's: the dialog edits a
  plan that already exists, where a stray chip press must not rewrite it.
- `"on-kull"` writes as soon as programme and kull are both known, and calls
  `onSaved`. The save button is not rendered at all in this variant, and
  neither is the section's own heading and hint, which the screen's `<h1>` and
  sentence already carry.

No second typeahead, no second kull renderer, no second store write path.

While the file is open, the dialog loses two of its three titles. It prints
"Studieprogram" (dialog head), "Studieinfo" (section heading) and
"STUDIEPROGRAM" (field label) inside 300 px; the section heading and its hint
go, leaving the dialog title and the field label. Its "Lagre" also stops being
accent-blue and enabled before anything is picked, which today invites a press
that does nothing.

### 4. Chrome appears with the plan, sections appear with their rows

The gate for the bar is the **plan**, not the fetch:

| state | what renders |
| --- | --- |
| no plan | the first-run screen, and nothing else |
| any plan (programme or courses) | the full bar, every control included |

Gating the bar on the plan rather than on drawn sessions is deliberate. The
plan is probe-known before paint, so no control appears or vanishes after a
fetch lands, and the one shift that remains — first run giving way to the
planner — happens inside 500 ms of the student's own press, which CLS excludes.
A per-control content gate would move the bar twice per cold load on a phone,
where it wraps to two rows.

Inside the planner, a section still goes absent rather than printing an
apology:

- **Eksamener** (heading, status line and list) is absent at zero courses,
  instead of "Legg til emner for å se eksamensdatoer."
- The **30 sp load track**, its figure and its legend are absent at zero
  courses, instead of "0 av 30 sp".
- **Emner** stays whenever there is a programme, because that is where the
  first course is added. Its "Ingen emner i planen ennå." goes; the section is
  its heading and the "Legg til emne" button.

This is the state a programme with no published study plan lands in
(`PROGRAM_MISSING_HINT`), so it is a real state and not a transitional one.

### 5. The punctuation sweep

**No `—` and no `·` in any string a student can read**, sitewide, and no
substitute mark. The rule for rewriting:

> **Prose becomes sentences. Data rows become spaced fields.**

Roughly 12 em dashes and 50 middle dots across `src/`, including two CSS
`content: "· "` rules (`.course-settings-group-own`,
`.planner-others-pending`) and `Layout.astro`'s `.site-footer-sep` span, which
become spacing and quieter ink rather than characters.

| now | becomes |
| --- | --- |
| Velg studieprogram og kull, så tegner vi uka di — med … | Velg studieprogrammet og kullet ditt, så er uka klar med … |
| Oppmelding stenger 15. september — 43 dager igjen | Oppmelding stenger om 43 dager, 15. september |
| Ingen forelesninger kolliderer · 1 emne ikke sjekket | Ingen forelesninger kolliderer. 1 emne er ikke sjekket. |
| Data hentet 28. jul 2026 fra NTNU · uoffisiell, … | Data hentet 28. jul 2026 fra NTNU. Uoffisiell, … |
| Mønsteruke · undervisning fra uke 34 · Høst 2026 | three spaced fields, no mark: `Høst 2026` `Mønsteruke` `Undervisning fra uke 34` |
| 5 470 emner · katalog 2026 | 5 470 emner i katalogen for 2026 |
| Denne enheten — 2 emner · 15 sp | Denne enheten, 2 emner og 15 sp |
| Åpent vindu — du kan stikke innom når du vil. | Åpent vindu. Du kan stikke innom når du vil. |
| Nå · 37 min igjen | Nå, 37 min igjen |
| Profil · Kari | Profil for Kari |
| Ikke synkronisert · prøv igjen | Ikke synkronisert. Prøv igjen. |

`<title>` tags use the dot as a brand separator today. Rather than substituting
a pipe or an en dash, subpages **drop the brand suffix**: `Planlegger`,
`Emner`, `TDT4120 Algoritmer og datastrukturer`, `Fant ikke siden`. The
homepage stays `Semesterplan`. Both calendars this project benchmarks against
name the page and nothing else in the tab.

**"Tegne uka" is struck from the vocabulary**, in UI copy and in new comments.
The replacement idiom is "så er uka klar".

Scope: strings a student can read, in `src/` and `worker/`. That includes
everything publish-and-share leaves behind — the signup and login copy, the
device list, the sync-failure line, and the `/user/<navn>` read-only view, all
of which land before this work starts and all of which are written in the old
punctuation. Code comments and the four docs keep their existing voice: they
are written in a heavily em-dashed register, and rewriting ~900 of them would
bury this work in a mechanical diff without changing anything anyone reads.

## Architecture

Nothing new is introduced. Every mechanism this uses is one the codebase
already documents:

- **The probe** (`Layout.astro` pre-paint script + `src/lib/planProbe.ts`) is
  **not touched at all**. It already writes the fact this design reads, and
  because the hash is gone by then, that fact is complete. This is the whole
  reason for the sequencing.
- **The picker** (`studieinfo.ts`) gains one policy field. Its element,
  lifecycle and focus contract are unchanged, and the dialog's behaviour is
  unchanged.
- **The page** (`planlegger/index.astro`) gains one static section and a
  `html:not([data-plan])` rule. The reserved week height is not touched; it is
  simply not on screen during first run.
- **The planner app** (`plannerApp.ts`) loses its `noProfile` week-card branch,
  which the first-run screen replaces, and gains the two section gates.

The one boundary worth stating: the first-run screen owns **presentation** of
the first run, and `studieinfo.ts` owns **the picking**. The screen does not
know how a programme is searched and the picker does not know it is on a page
rather than in a dialog; the only thing they agree on is the commit policy.

## Testing

Mechanism only, per CLAUDE.md's rule against tests that restate the current
design.

- **Unit:** no banned mark (`—`, `·`) reaches a user-facing string. This is the
  gate that keeps the sweep from rotting; its failure means "someone
  reintroduced a mark", which is a real regression rather than a change of
  mind.
- **Unit:** the probe's first-run predicate, over the cases that decide it —
  empty storage, courses only, programme only, and a malformed payload.
- **e2e:** first run → programme → kull → a drawn week, with no dialog in the
  path.
- **e2e:** `cls.pw.ts` gains a first-run budget for `/planlegger/`. The
  existing planner budgets are measured with a plan and do not cover this
  state.

## Out of scope

Real, separate, and deliberately not bundled:

- **The homepage.** Its own layout is thin below the fold and its CTA is not
  accented, but it is a different screen with a different job.
- **`astro dev` shadows `/data/programs.json`.** Vite serves the project-root
  crawler record (331 961 B) in place of `src/pages/data/programs.json.ts`
  (28 026 B of tuples), so the typeahead throws `programOptions.filter is not a
  function` and finds nothing under `npm run dev`. The built site is correct;
  this makes the onboarding flow untestable in dev and should be fixed before
  the next person iterates on it.
- **The typeahead's meta line prints "trondheim" lowercase.**
- **Provenance on `/emne/[code]/`** and everything else in ROADMAP Phase 4+.
  Phase 3 is not out of scope; it is the prerequisite.
