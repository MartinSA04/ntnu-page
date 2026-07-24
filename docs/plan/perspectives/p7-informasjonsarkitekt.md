# P7 — Informasjonsarkitekt

Lens: page inventory, URL semantics, navigation, where search lives, how the
plan surfaces everywhere, entry-point redundancy, empty states as onboarding.
Kill anything that just mirrors ntnu.no without adding decision value.

## 0. The one-line thesis

There are exactly four jobs (plan a semester, research a course, explore
electives, follow a program) and they all terminate at the same object: the
plan. Today the IA gets this mostly right structurally (three nav pills,
plan reachable from everywhere per PLANNER.md §5) but is *under-specified* at
the edges that matter most for a real student session: what a course page,
program page, or search result looks like **when arrived at from a different
job** than "browse the catalog cold". The fix isn't new top-level pages — the
site should stay at four nav destinations — it's contextual entry, richer URL
state, and killing the one page that's pure ntnu.no mirroring with no
planning payoff.

## 1. Sitemap (kept, killed, added)

```
/                          KEEP, re-scope   → dispatcher, not a hero
/planlegger/               KEEP             → the app; only object the site persists
/emner/                    KEEP, upgrade    → catalog search AS a plan-building tool
/emne/[code]/              KEEP, upgrade    → single-course research, plan-aware
/studier/                  MERGE INTO /emner/ as a facet, see §4
/studier/[code]/           KEEP, upgrade    → program-scoped plan template
(no /kull, no /account, no /sok — deliberately absent, see §7)
```

That's it. Four addressable destinations plus the program detail page. I am
not proposing new top-level pages — the site's power is in making the
existing five pages plan-aware, not in adding surface area.

### Kill: `/studier/` as a standalone destination

`/studier/` today is: search field + level chips over `programs.json`, rows
linking to `/studier/[code]/`. This is a facet of "find things," identical
in shape and purpose to `/emner/`. It adds a fourth nav pill's worth of
weight for zero unique interaction — it's a filtered list of names that
link elsewhere, exactly like `/emner/` is. Two independent "search a flat
catalog" pages ask a student to learn which catalog their query belongs to
before they've typed anything, which is a false choice: a first-year typing
"data" doesn't know whether they want the course TDT4110 or the program
Datateknologi.

**Resolution**: fold program search into `/emner/` as a result-type facet
(tab or segmented toggle "Emner / Studieprogram" at the top of the same
search-and-filter chrome, defaulting to Emner since course lookups dominate
usage). URL: `/emner/?type=studier&q=data`. `/studier/[code]/` stays as its
own page (it's genuinely a different content shape: a study plan, not a
course record) — only the *index* merges. Nav pill becomes **"Emner"**
covering both; **"Studier"** is removed from top nav (three pills:
Planlegger / Emner / Studier → two: Planlegger / Emner). This is the single
highest-leverage IA cut available: it removes a redundant decision point
from every session without removing any content.

If the panel decides program identity is too important to bury under a tab
(defensible — "jeg går på MTDT" is a strong persistent identity, not a
one-off search), the fallback is: keep `/studier/` but make it reachable
*only* as `/emner/?type=studier`, i.e. same page component, and drop the nav
pill anyway — link to it from `/planlegger/`'s empty state ("Start fra et
studieprogram," already spec'd) and from program mentions elsewhere, never
from primary nav. Either way: **nav goes from three pills to two**, plan
stays first.

## 2. Navigation model

Top nav: **Planlegger | Emner**. Planlegger stays first (PLANNER.md is
explicit and correct: this is the home turf). Two pills, not three — a
planning tool with a three-item nav where one item is a second search page
reads as indecisive about what it is.

The plan itself is not a nav item and must never become one ("Min plan" as
a third pill is the wrong move — it re-introduces the account-y "my stuff"
pattern this static/localStorage site correctly avoids). Instead the plan
is ambient, surfaced the same way on every page via a persistent strip
described in §3 — the nav tells you *where content lives*, the strip tells
you *what you've already decided*. Keeping them visually and structurally
separate is itself an IA statement: navigation is about content, the plan
strip is about state, and conflating them (turning the plan into "a page
you visit") would undersell that the plan is alive everywhere.

## 3. The plan surfaces everywhere — spec the strip, not just the buttons

PLANNER.md §5 correctly lists per-page add affordances (course page button,
catalog row quick-add, program page bulk-add). What's missing from the spec
is the **read** side: a persistent, page-agnostic strip that shows plan
status without navigating away. This is the actual "surfaces on every page"
requirement — add buttons are write-only, a student also needs to *see*
"I have 4 courses, 22.5 sp, on TDT4100+TMA4100 collides" while browsing
`/emner/` for a 5th elective, without a page load.

**Proposal**: a slim sticky strip directly under the topbar, present on all
five pages, collapsed by default to one mono line:

```
▪▪▪▪ 4 emner · 22,5 av 30 sp · 1 kollisjon    [Planlegger →]
```

- Empty plan: strip does not render at all (nothing to show — avoid a
  permanent "0 emner" nag; this matches PLANNER's "empty states are
  invitations" philosophy by *not* competing with the page's own empty
  state for attention).
- Non-empty: renders everywhere including on `/planlegger/` itself (where
  it's redundant with the page body — fine, consistency beats cleverness;
  or suppress it only on `/planlegger/` since the whole page already is
  this information — that's a legitimate simplification, pick one and keep
  it uniform).
  - If PLANNER.md's colored-square convention extends here, the dots are
    literal `.np-dot` hues matching plan order — free, already-built
    vocabulary, no new component.
- Collision or credit-complete state is visible from the strip's mono line
  itself (the numbers + a red "1 kollisjon" note if any), not just after
  clicking through — this is what turns "add courses while browsing" into
  "add courses while *planning*": you find out mid-browse that your 5th
  elective collides, without a round trip.
- Click target is the whole strip → `/planlegger/`. No separate dropdown,
  no mini-timetable preview in the strip — that's `/planlegger/`'s job, the
  strip is a status line + door, not a second planner UI.

This single component is the connective tissue that makes "add from
anywhere" (already spec'd) actually pay off as "aware from anywhere"
(currently unspec'd). Recommend it be built once in the shell layer
(Layout.astro) reading `store.ts`'s `onPlanChange`, not duplicated per page.

## 4. `/emner/` — from catalog mirror to plan-building surface

Current shape (search + location chips + rows linking out) is a fine
*mechanism* but a thin *job fit*. The job here is "explore electives" and
"find one course," which are different enough to deserve different default
behavior, not different pages:

- **Quick-add is already spec'd** (trailing `.np-icon-btn`) — keep, it's
  correct and sufficient. Do not add a "compare" multi-select UI here; that
  is `/emne/[code]/`'s job when two known codes are in hand (see §5), not a
  catalog-browsing job — inventing a comparison tray duplicates the plan's
  own "hold several things" role.
- **Filter state belongs in the URL, not just component state.** `?q=` is
  already read on load (SPEC.md confirms). Extend to `?q=&sted=Trondheim`
  and (if §1's merge happens) `&type=emner|studier`. This isn't
  gold-plating — it's what makes "share a filtered elective list with a
  study buddy" or "come back to where I was searching" possible on a
  site with no accounts. Every piece of state a student built by
  clicking should be recoverable from the address bar.
- **Semester-relevance filter.** The catalog spans all courses; the planner
  only cares about ones taught in the plan's chosen semester
  (`entriesInSemester` already exists in schedule.ts per PLANNER.md §3).
  Add a chip "Undervises i valgt semester" (default OFF, since pure
  research visits shouldn't be pre-filtered) that, when the plan has a
  semester set, filters to courses actually offered then — a student
  hunting for a 5th elective for høst 2026 does not want autumn-only
  results polluted with spring-only courses. This is the single most
  valuable filter for the "explore electives" job and it's currently
  absent from both the page and the spec.
- **Empty/zero-result state**: currently unspecified beyond "200 av N
  treff" capping. Should say what to do next, per DESIGN.md's "empty
  states are invitations": zero hits on a query → mono line + "prøv et
  annet søkeord, eller bla i studieprogrammet ditt" linking to `/studier/`
  if plan has a program context, else to the full unfiltered list.

## 5. `/emne/[code]/` — research page, plan-aware, and where compare lives

This is the single-course research job. Two IA gaps against the current
spec:

- **"Legg til i planen" is spec'd; "hvor passer dette i planen" is not.**
  When a student arrives here from `/studier/[code]/`'s study plan (i.e.
  program context is already set on the plan), the course page should show
  a one-line mono context note: "Obligatorisk i MTDT, kull 2024, 5.
  semester" or "Valgfag i MTDT, kull 2024" sourced from the program's study
  plan data (already crawled per SPEC.md). This is free — the data exists
  (`programs.studyPlan`) — and it's the difference between a course page
  that answers "what is this course" and one that also answers "does this
  belong in *my* plan."
- **Compare belongs here, not as a new page.** "Explore electives" often
  means holding 2-3 candidate courses side by side (schedule, exam date,
  workload/credits, grade distribution) before committing one to the plan.
  Don't build a `/sammenlign/` page or a catalog multi-select — instead,
  when the plan has ≥2 uncommitted "considering" items... **actually,
  simpler**: skip a "considering" sub-state entirely (it duplicates the
  plan with weaker semantics) and instead let `/emne/[code]/` accept a
  compare query: `/emne/TDT4100/?mot=TMA4100,TFE4146` — rendered as a
  lightweight facts-table addendum below the normal single-course content,
  reusing already-fetched `data.ts` shapes. Entry point: on `/emner/`, a
  transient "sammenlign" checkbox state (page-local, not persisted) that
  becomes this URL on 2+ selections. This keeps compare inside the
  existing page (no new nav surface) while still being deep-linkable and
  shareable — "should I take TDT4100 or TDT4105" is exactly the kind of
  question worth a URL you paste to a friend.
- **404 for unknown codes**: already exists per SPEC.md. Extend copy to
  suggest `/emner/?q=<code-prefix>` as a recovery path (the student
  probably mistyped or is thinking of a related version-suffixed code —
  NTNU course codes have version churn).

## 6. `/studier/[code]/` — program page as a plan *template*, not just a read

This page's unique value (vs. everything above) is the study plan: periods
→ groups → courses, obligatoriske + valgfri. IA-wise it is the closest
thing this site has to "start here if you're new" and should lean into
that harder:

- **Bulk-add per period is spec'd — keep as primary CTA**, not buried
  below prose. Move the study-plan island above the descriptive
  paragraphs on the page (name/level/campus stays as a compact header;
  department description prose is exactly the kind of ntnu.no-mirroring
  content that shouldn't be the first thing on the page — it adds no
  decision value, push it below the plan or into a disclosure).
- **First-years' entry point.** First-years get pre-assigned plans (ground
  truth). The realistic first session for this cohort is: land on
  `/studier/[code]/`, pick kull, hit "legg til alle" for period 1, done —
  they're not searching, they're confirming. The page should make that a
  two-click path from a cold landing (program search on `/` or `/emner/`
  → program page → bulk add), and the "ditt semester" auto-highlight
  (already spec'd) is exactly right for this.
- **Retninger/waypoints as disclosures**: already spec'd as `.np-summary`.
  IA note: these should deep-link (`#retning-database`) so a specific
  waypoint is shareable/bookmarkable independent of the whole plan — useful
  for "which retning has less Friday teaching" comparisons between
  students, and costs nothing (anchors are free).

## 7. Entry-point redundancy and deliberate absences

**Redundant entries that should exist** (multiple paths into the same
state, because different students arrive with different priors):

1. Cold search for a course → `/emner/` → `/emne/[code]/` → add.
2. Know the code already (friend told them, syllabus PDF) → typing
   `/emne/TDT4100/` directly must work with zero prior navigation — it
   does today (static `getStaticPaths`), keep it exactly this cheap.
3. Program-first ("I'm MTDT, kull 2024") → `/studier/MTDT/` → bulk-add —
   keep, this is the first-year path.
4. Returning student with an existing plan → `/` or bookmarked
   `/planlegger/` directly, plan restores from localStorage — keep,
   already spec'd via hash sync.
5. **Shared plan link** (`#26h;TDT4100,TMA4100` per store.ts) — a friend
   pastes their plan URL, recipient's browser shows the *sender's* plan.
   IA implication: arriving via a foreign hash must not silently
   overwrite the visitor's own saved plan in localStorage. Land on an
   interstitial state within `/planlegger/` itself (not a new page): "Dette
   er en delt plan. [Bruk denne planen] [Behold min egen]" before it
   clobbers storage. This is a one-line addition to store.ts's hash-wins
   logic but it's a real trap as currently spec'd ("hash wins over
   storage" unconditionally) — a student who clicks a classmate's shared
   link loses their own work silently.

**Deliberately absent** (do not build, would fragment the IA):

- No `/sok/` global omnisearch page separate from `/emner/` — one search
  surface, extended with the `type=` facet from §1, not two.
- No `/kull/[program]/[year]/` as a separate URL from
  `/studier/[code]/?kull=2024` — cohort is a query param / chip state on
  the program page, not a path segment; it's a view filter on one program,
  not a distinct content entity.
- No user accounts / `/logg-inn` — ground truth rules this out
  (localStorage + URL only); do not let any recommendation above imply
  server-side identity. The "shared plan" interstitial in point 5 is
  URL-based, not account-based.
- No `/sammenlign/` standalone page — folded into `/emne/[code]/?mot=`
  per §5.

## 8. Empty states as the real onboarding flow

There is no onboarding wizard and there shouldn't be one — the empty
states, chained correctly, already form the whole onboarding sequence:

```
/  (no plan yet)
  → hero pitch, no plan-status line (nothing to show)
  → two tiles: "Bygg semesterplanen din" (Planlegger) /
               "Søk i emnekatalogen" (Emner, now covering both facets)
      ↓
/planlegger/ (empty)
  → "Ingen emner i planen ennå." + add field + "Søk i emnekatalogen"
    + "Start fra et studieprogram" (small program search)
      ↓ (branches on student type)
  A) knows courses → search inline, adds → plan strip appears sitewide
  B) first-year, knows program → program search → /studier/[code]/
     → picks kull → "legg til alle" on period 1 → back to /planlegger/,
       now populated, program context line showing
```

The one gap: **`/emner/` and `/emne/[code]/` in isolation (arrived at via
external link/search engine, not via `/`) have no plan-aware empty state
at all today** — a student who Googles "TDT4100 NTNU" and lands directly on
the course page has never seen the planner pitched to them. Fix: the plan
strip from §3, when the plan is empty AND this is page load #1 in the
session (sessionStorage flag, not persisted state — just "don't show every
load"), replaces its normal (absent) rendering with a one-time thin
intro line: "Bygger du en semesterplan? Legg til emner mens du leser." This
is the site's actual acquisition funnel — most traffic will hit a course
page from search engines, not the homepage — and right now that visitor is
never told the planner exists unless they scroll to a button. Low cost,
real reach.

## 9. Per-page one-line purpose (final inventory)

| Page | Purpose (one line) |
|---|---|
| `/` | Dispatcher: pitch the plan, route to Planlegger or Emner, show plan status if one exists |
| `/planlegger/` | The app: read and edit the plan — timetable, exams, credits, course list |
| `/emner/` | Find courses (and, merged, programs) to add to the plan; plan-aware quick-add + semester-relevance filter |
| `/emne/[code]/` | Research one course fully, see where it sits in your program plan if any, compare against alternatives via `?mot=` |
| `/studier/[code]/` | Understand and adopt a program's study plan as a template for the plan, period by period |

Five pages. Two nav pills. One persistent state object, visible everywhere
it's non-empty, editable from four of the five pages, fully reconstructable
from a URL.
