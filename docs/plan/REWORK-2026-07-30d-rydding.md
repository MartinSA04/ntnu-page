# REWORK 2026-07-30d — chrome removed, marks drawn properly

## D1 — The footer states provenance and links nowhere

"Søk i emner" is gone. The catalog is one of the site's two nav destinations,
permanently, at the top of every page; a third route to it in the footer was
chrome. What is left is what a footer is for:

> Data hentet 28. jul 2026 fra NTNU · uoffisiell, med forbehold om feil

## D2 — The studieinfo chip is a landing-page element

It left the planner in `REWORK-2026-07-30b` because the title already names the
plan. It leaves the catalog pages now: you are looking a course up there, not
checking whose plan it would join. That leaves one page, the one with no other
way to say it.

The "persistent sitewide chip" idea is retired with it. `Layout.astro` reads
`path === "/"`, not "everywhere except".

## D3 — The landing page loses its picture of itself

`.home-proof` was a ruled panel showing two invented courses (TDT4110,
TMA4100) colliding, with "Del planen med en lenke" under it. A drawing of the
product is not evidence that the product works, and the Nå card directly above
it shows the student's actual next lecture, which is the real thing.

It was also the last caller of `.np-ruled`, so the primitive is deleted with
it. The ruling now exists in exactly one place: hand-rolled in
`planner-week.css` on the boxes it rules. DESIGN §4/§5/§8, PRODUCT §5 and
ROADMAP all recorded it as shipped and are corrected rather than left stale.

## D4 — Marks are SVG, not characters

`×` on three close buttons, `→` on two links out, and a hand-drawn
approximation of the settings icon on the plan's own Endre button.

A glyph is not an icon. It inherits the text font's weight and metrics, sits
on the baseline instead of centred, and renders differently in every fallback
face. `dom.ts` grew an `icon()` builder with three Lucide marks (`settings-2`,
`x`, `arrow-right`); `settingsIcon()` stays as its own name because that is
what it means at the call site.

The Endre button now carries the **exact** paths `settingsIcon()` builds for
the course rows, rather than something that looked roughly like them. Same
mark, one scope up.

Em dashes standing in for "no value" went too: an empty room, an unset exam
date and an absent credit reduction are now empty cells and words. The board's
room column collapses instead of printing a dash.

## D5 — The provenance line states only what it could not verify

It read, on every render:

> Timeplan hentet direkte fra NTNU nå · eksamensdatoer fra katalogen (hentet
> 28. jul 2026) · studieplan for kull 2024. Uoffisiell.

A sentence saying everything worked, printed under a week that visibly worked,
on a page whose footer now carries the crawl date and the caveat anyway.
Boilerplate that appears every time is boilerplate nobody reads, and it was
carrying the clauses that matter with it: the per-course fetch failure, the
substituted study-plan cohort, the exams with no date yet.

So it is silent when the join is clean and speaks only when it is not. DR-8's
MUST is that *the join admits its gaps*; announcing that it has none was never
part of it. What survives, each as its own sentence rather than a fragment in
a middot chain, because each is a separate thing that went wrong:

- `Fikk ikke hentet timeplan for TMA4400.`
- `Fikk ikke hentet eksamensdatoene.` / `Eksamensdatoer ikke publisert for Høst 2026.`
- `Studieplan for kull 2024, det finnes ingen egen plan for kull 2026.`
- `Fant ingen studieplan for MTDT.` / `Fikk ikke hentet studieplanen for MTDT.`
- `2 eksamener har ingen dato ennå.`

`formatCrawledAt` had no other caller and is deleted with it.

(An earlier pass read "the line under exams" as the section head's rule and
removed that instead. It is back.)

## D6 — No em dashes in anything the product says

Roughly forty strings, rewritten rather than search-replaced, because an em
dash usually joins two clauses that wanted a full stop:

- "Fikk ikke hentet timeplan for X — kollisjonssjekken er ufullstendig."
  → "… for X. Kollisjonssjekken er ufullstendig."
- "Velg kull og lagre — da husker vi programmet ditt, men emnene må du legge
  til selv." → "Velg kull og lagre, så husker vi programmet ditt. Emnene må du
  legge til selv."
- "har 3 grupper — velg din" → "har 3 grupper, velg din"
- Page titles "Planlegger — Semesterplan" → "Planlegger · Semesterplan"

Also `"…eller legg til emner med emnekode"` → `"Eller legg til emner med
emnekode"`.

**Not** swept: code comments and the docs, which still use them heavily. That
is a much larger, purely internal diff and it is not what a reader of the site
sees.
