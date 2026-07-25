# REVIEW.md — full-site review against PRODUCT.md §0

Review date: 2026-07-24 · reviewed build: `dist/` served by wrangler dev at
`127.0.0.1:8788` against live NTNU data · semester 26h (Høst 2026),
`timetablePublished: true`.

Nine review lenses, adversarially verified. Findings that were refuted have
been dropped; findings that survived but needed correction carry the
correction inline. Written in English (the repo's language); all suggested
UI copy is Norwegian bokmål, sentence case.

**Authority order used throughout:** PRODUCT.md §0 > PRODUCT.md rest >
DESIGN.md named rules > ROADMAP.md sequencing > SPEC.md (stale, see T2) >
docs/plan/.

---

## 1. Verdict

The design system is real, the conflict engine is real, and the data
pipeline is real — this is a better-built site than most of what it will
compete with, and almost nothing here is a rewrite. But the mandate's
flagship promise, *programme + kull → your weekly schedule, instantly*,
currently holds for a minority of students: driven end to end against live
data it produces a non-empty Høst 2026 week for **175 of 403 programmes
(43%)** even on the newest kull, and only **654 of the 5 500 kull chips the
picker offers (11.9%)** point at a study-plan period that exists at all.
The failures are not deep: a missing `decodeURIComponent` kills 58
programmes outright, an unanswered studieretning question empties the week
for 82 more, an unfiltered `publishedYears` loop makes ~90% of the kull
chips dead ends, and a `!hasProgramCourses` guard freezes the prefill at
whatever semester it was first built in — four small, independently
shippable fixes that together move the flagship flow from 43% to something
close to universal. The second problem is legibility, not correctness: the
week — the surface §0.2 calls primary — gets 598 px of a 1152 px column,
loses its day names to any 08:00 block, and collapses into unreadable 16 px
stripes the moment a student taps the one toggle §0.4 promises them. The
third problem is that everything *around* the week is arranged as if this
were a course-browsing site: three nav pills for a product with one
destination, three surfaces that can write to the plan and none that shows
it, and a course page that puts 2 900 px of encyclopedia above the
timetable. **The one thing that matters most is Wave 1 below: make
programme + kull produce a correct, non-empty, readable week for the large
majority of programmes before touching anything else** — the IA cleanup,
the decide-loop, and the design polish are all worth doing, and all of them
are worth less than one working flagship flow.

---

## 2. Blockers — the mandate does not work today

| ID | Claim | Effort |
| --- | --- | --- |
| B1 | Every course/programme code containing Æ/Ø/Å gets a hard 400 from the whole `/api` surface | S |
| B2 | 82 of 275 programmes land on an empty week gated behind an unanswered studieretning — and the grid's own recovery copy points the wrong way | M |
| B3 | The kull picker offers 5 500 chips; 654 (11.9%) lead to a period that exists | S |
| B4 | Switching semester never re-derives the plan: Vår 2027 shows autumn 2026's courses at a green "30 av 30 sp" | M |
| B5 | `/planlegger/` with an empty plan is a dead end — the picker it points at is hidden and the add field is unmounted | S |
| B6 | MIDT and MTDT render as identical "Datateknologi"; the field that distinguishes them is dropped before the typeahead sees it | S |
| B7 | 47 of 235 programmes have timetable data but zero lecture-classified entries, so the default week is blank | S |
| B8 | 70 programmes have no fetchable study plan and the flow terminates on a bare error line | S |
| B9 | The "X av 30 sp" line — the mandate's one completeness signal — is wrong in four independent ways | M |
| B10 | The shared link, PRODUCT's declared growth object, is broken three ways | S |

### B1 — Every code containing Æ/Ø/Å returns 400 from the API

**Where:** `worker/src/server.ts:47,82` (reads `url.pathname`, which the
WHATWG URL spec keeps percent-encoded) → `worker/src/routes.ts:26`
(`CODE_RE = /^[A-ZÆØÅ0-9_-]{2,16}$/i`).

**Evidence (reproduced live):** `curl .../api/program/MTI%C3%98T/plan?year=2026`
→ `400 {"error":"Invalid program code"}`; same for `%C3%85SOS`,
`/api/course/BØA1100`. `curl .../api/program/BIT/plan?year=2026` → 200 from
the same server. The regex deliberately allow-lists Æ/Ø/Å and never sees
them, because nothing calls `decodeURIComponent`. Counted from the crawl
artifacts: **58 of 403 programmes** (MTIØT, BØA, BSØK, MSØK, MSIVØK5,
MLSPRÅK and all 38 Å-prefixed årsstudium) and **238 of 4 767 courses**.

**Why it matters:** MTIØT alone is one of NTNU's largest sivilingeniør
programmes and *every* årsstudium code starts with Å. The static page
`/studier/ÅSOS/` renders 200 and then its own client fetch 400s, so the
user sees "klarte ikke å hente studieplan" forever — indistinguishable from
an upstream outage. 14% of programmes cannot complete step one of the
mandate.

**Fix:** decode the captured segment before validating, in one place:
`handleProgramPlan(deps, decodeURIComponent(code), year)` and the same for
the four course routes, wrapped in try/catch → 400 on a malformed escape.
Add `MTIØT` / `ÅSOS` / `BØA1100` to `tests/worker/routes.test.ts` and one
e2e assertion on `/emne/BØA1100/`. **S.**

### B2 — A gated studieretning lands the student on an empty week

**Where:** `src/components/planner/programPlan.ts:284-334` (the
`classifyPeriod` intersection path); `src/components/planner/plannerApp.ts:639-660`;
`src/components/planner/grid.ts:117-124`. Screenshots `04-planner-program-desktop-light.png`,
`agent-mandate-bdigsec-direction.png`.

**Evidence:** measured across all 403 programmes against the live API,
**82 of the 275 with a period 1** are gated by a multi-direction waypoint.
MIDT kull 2026 → 1 course (HMS0009, 0 sp), "0 av 30 sp", "Ingen
forelesninger funnet". BDIGSEC kull 2026 → literally zero courses. Answering
the question fixes it completely (MIDT → 15 sp, BDIGSEC → 30 sp, BSPL → 30
sp / 37 blocks). For BSPL and BDIGSEC the "choice" is only the **campus**
(Gjøvik / Trondheim / Ålesund) — something the student knows before they
open the site.

The recovery copy makes it worse. For MIDT the grid, seeing zero
lecture-classified entries for HMS0009, prints the canned "Ingen
forelesninger funnet — prøv «Vis øvinger og labber»". Following that
literal instruction reveals five uncaptioned near-identical muted
"HMS0009 Forelesning/Gr…" blocks spread Mon–Fri (DR-1's group-blind merge),
which reads as a 5-day commitment for a 0-credit course. The one sentence
that explains the empty grid — *choose your hovedprofil* — is rendered
correctly in a panel directly above and is not reused as the grid's message.

**Root cause:** the question is asked *after* navigation, in a quiet
`np-panel` of low-contrast chips, while the primary surface simultaneously
renders as a failure.

**Fix:** ask the question **in the picker**, before navigating. After the
kull chip, if `classifyPeriod` returns a `pendingChoice`, render its
direction chips inline in the same picker step — "Hvilken studieretning
følger du?", or for campus splits "Hvilket studiested?" — and only navigate
once the period resolves. Never render an empty ukeplan frame while a
`pendingChoice` exists: replace the frame with the question. If the frame
must render, swap `grid.ts`'s empty message to name the pending choice
("Ukeplanen fylles ut når du har valgt hovedprofil over"). **M.**

### B3 — 88% of the kull chips are dead ends

**Where:** `src/pages/index.astro:302-322` and
`src/components/planner/plannerApp.ts:519-534` — both iterate all of
`plan.publishedYears` with no filter.

**Evidence:** across the 275 programmes with a plan, 5 500 kull chips are
offered and 654 (11.9%) correspond to a period `(2026 − kull)*2 + 1` that
exists. Median chips per programme = 20 (2007–2026); median live = 2. MIDT,
a **two-year** master, offers 20 chips. Picking kull 2007 gives
`periodNumberFor("26h", 2007) = 39`, `classifyPeriod` returns null,
`obligatoryToAdd` returns `[]`, and the planner renders a programme banner
with zero courses and zero explanation.

**Fix:** filter to cohorts whose computed period exists in the fetched plan
— the logic already exists as `defaultCohort` in `index.astro`, it just
isn't used as a filter. Show the degree's own span, newest first, with the
computed default pre-pressed. When a picked cohort resolves to no period,
say so: "studieplanen for kull 2007 dekker ikke Høst 2026". ROADMAP puts
`publishedYears`/`periodNumber` gating in Phase 6; §0.1 makes it Phase §0 —
**resequence it**. **S.**

### B4 — The semester toggle never re-derives the programme plan

**Where:** `src/components/planner/plannerApp.ts:1249-1256` —
`if (!hasProgramCourses && classified)`.

**Evidence:** load `#v2;26h;MTDT.2026;` → prefill is period 1 (HMS0002,
TDT4109, TMA4400, TMA4412, EXPH0300). Click "2027 VÅR": the banner becomes
"Vår 2027", the hash becomes `27v`, and the course list is byte-identical —
all five autumn courses remain, each tagged "undervises ikke i valgt
semester", and the credit line still reads "30 av 30 sp" in accent green.
MTDT kull 2026's real period 2 is TDT4100, TDT4180, TMA4422, TTT4203
(verified via `/api/program/MTDT/plan?year=2026`). `loadPeriodCourses`
recomputes `periodCourses` but only calls `setProgramPlan` when the plan has
*no* `source: "program"` courses.

**Why it matters:** the semester toggle is the only way to plan the next
term — the entire "before the deadline" positioning — and it hands the
student a confident, full, green 30-sp plan of courses they are not taking,
in a semester where the unpublished timetable cannot contradict it. This is
exactly the confidently-wrong composite D5/DR-7 exist to prevent.

**Fix:** when `plan.semesterId` changes and a programme is set, re-run
`setProgramPlan(program, obligatoryToAdd(classified))` for the newly
computed period (`setProgramPlan` already preserves manual adds and drop
flags). Track which semester the programme set was derived for. If the new
period doesn't resolve, clear the programme courses and say so:
"studieplanen har ingen periode for dette semesteret ennå". **M.**

### B5 — The planner's empty state is a dead end

**Where:** `src/pages/planlegger/index.astro:35` (`#planner-picker` authored
`hidden`), `:64-66` (invite copy), `:29-31` ("Endre");
`src/components/planner/plannerApp.ts:1151-1158`. Screenshot `10-planner-empty.png`.

**Evidence:** `renderAll()` sets `elements.main.hidden = !hasContent`, and
`#planner-add-block` lives inside `#planner-main`. So with an empty plan the
grid, the course rail **and the add field** are all removed, and the only
content on the page is the sentence *"Ingen emner i planen ennå. Velg et
studieprogram over, eller legg til emner selv."* Nothing is "over"
(`#planner-picker` is hidden, revealed only by an "Endre" button that sits
inside the semester-chip cluster and reads as "change semester"), and
"legg til emner selv" is literally impossible from this screen.

**Why it matters:** this is the second-most-likely landing on the primary
surface — a bookmark, a shared link that failed to parse, a return visit
after clearing storage — and the copy actively lies about what is on screen.

**Fix:** when the plan is empty, render `#planner-picker` **open** as the
page's only content, keep the add field mounted below it for the
code-paste path, and delete the invite sentence — the picker *is* the
invitation (DESIGN §7: "empty states are invitations to act"). Label the
banner button by state: "Velg studieprogram" when `plan.program` is
undefined, "Endre" once one is set, and move it off the semester-chip
cluster. **S.**

### B6 — Two "Datateknologi" rows, opposite outcomes

**Where:** `src/pages/index.astro:154-156` and
`src/pages/planlegger/index.astro:10-12` both build `programOptions` as bare
`[code, name]` tuples. Screenshot `02-home-typeahead.png`.

**Evidence:** `data/programs.json` carries `studyLevel` for both — MIDT
"Master 2 år", MTDT "Master 5 år", PHCOS "Ph.d." — and it is discarded.
Outcome for kull 2026: MTDT → 5 courses, 30 av 30 sp, 7 lecture blocks;
MIDT → 1 course, 0 av 30 sp, empty grid. The same collision exists for
BSPL/BSPLFLEKS ("Sykepleie") and MHELSP/MHSPLFLEKS ("Helsesykepleie").

**Fix:** include `studyLevel` (and `cities` where they differ) in the tuple
and render it as a muted third column: `MTDT · Datateknologi · master 5 år,
Trondheim`. One field, one line of render code, and the site's worst screen
stops being reachable by accident. **S.**

### B7 — Whole faculties get a blank default week

**Where:** `src/lib/planner/activity.ts:62-89`; `src/components/planner/grid.ts:111,122-125`.

**Evidence:** replaying the repo's own classifier over every period-1
obligatory course of the 235 programmes with a non-empty prefill, **47 have
≥1 timetable entry inside 26h teaching weeks and 0 that classify as
lecture** — ITMAIKTSA (9 entries, 0 lectures), MLREAL, MGLU1-7 (61),
LTTEGN (57), MFA (45), BBL (44), BBK (43), MHSPLFLEKS (48). A further 48 of
the 175 that do render show ≤2 lecture blocks for a whole week. The cause is
that any non-lecture keyword vetoes the lecture verdict even when a lecture
keyword is present: HMS0009's *only* activity is `"Forelesning/Gruppe"`,
ITMAIKTSA's courses are all `"Forelesning/Lab"`, IDATA2306's are
`"Forelesing/øving"` and `"Forelesning / Øving"`, TDT4140's 23 entries are
"1 Teorimodul" / "2 Prosjektarbeid" / "3 Refleksjonsmodul".

**Adjudication:** the verifier is right that this asymmetry is *documented
and deliberate* (DR-1 prefers under-classification), and right that
`tests/planner/activity.test.ts:70-78` already covers eight `Forelesning/X`
titles. So this is not an untested oversight — it is a deliberate tradeoff
whose blast radius turned out to be a fifth of all programmes. DR-1 accepts
under-classification **only because "the toggle layer still shows the entry
as a muted block"** — which the default view does not do. That is the part
that is broken.

**Fix, two parts.** (a) In `grid.ts`, when `allEntries.length > 0 &&
entries.length === 0`, auto-render the muted layer with the toggle pressed
and an inline note: "ingen aktiviteter er merket som forelesning i disse
emnene — viser all undervisning". That alone converts 47 blank weeks into
useful ones with no classifier risk. (b) Let a lecture keyword win when the
competing token is a slash-joined qualifier (`Forelesning/Øving`,
`Forelesning/Gruppe`, `Forelesing/øving`) — the student attends that slot
either way — and add `teorimodul`, `problembasert læring`, `regneverksted`
to the lecture set, with the eight real triples above added to the
validation set. **S.**

### B8 — "Ingen studieplan funnet" is a full stop

**Where:** `src/pages/index.astro:294-300`;
`src/components/planner/programPlan.ts:145-154` (`MAX_STEP_BACK_TRIES = 3`).

**Evidence:** sweeping all 403 programmes with the same three-year step-back
`findProgramPlan` performs, **70 return 404 for 2026, 2025 and 2024**. The
homepage prints "ingen studieplan funnet for dette programmet" under the
search field and stops: no link, no alternative, no explanation that this is
a data gap rather than a typo. Together with B1's 58 hard 400s, **32% of
programme picks terminate in a status line that offers nothing.**

**Fix:** replace the status line with a real offer —
"Vi har ingen studieplan for <navn> ennå. Du kan legge til emnekodene dine
selv →" linking to `/planlegger/` with the semester preset. Persona B's
code-first path exists in the product definition; it is simply not reachable
from the failure it was designed for. **S.**

### B9 — The credit line is wrong four ways

**Where:** `src/components/planner/plannerApp.ts:411-433` (`totalCredits`,
`unpricedActiveCount`, `.is-full`); `programPlan.ts:187-195` and `:336-340`.

Four independent defects in the mandate's one at-a-glance completeness
signal:

1. **Study-plan credits are discarded.** `PlanCourse` has no `credits`
   field; the total reads only `bundle.details.credits`. MTKJ kull 2026
   renders "15 av 30 sp (+2 emner uten oppgitt sp)" with TMA4101 and
   TMT4115 marked "fikt ikke hentet detaljer: Not found" — while the study
   plan response the prefill was built from gives both `"credits": 7.5`.
   39 of 1 383 period-1 obligatory references (2.8%) are absent from the
   catalog (see C1), and every one of them under-reports the load.
2. **Off-semester courses are counted.** `renderCourseRows` already computes
   the off-semester condition thirty lines below and prints "undervises ikke
   i valgt semester" on the row — while the header counts its credits and
   turns green. DR-10 excludes them explicitly "so the 'full load' signal
   isn't corrupted".
3. **Overload reads as success.** `classList.toggle("is-full", total >= 30)`
   — "37,5 av 30 sp" gets the same accent green as "30 av 30 sp". Green-Means-Fits
   used for a 7,5 sp overload tells the student the opposite of the truth.
4. **A >30 sp prefill is silently discarded.** `isSuspiciousPrefill`'s own
   docstring says it is "surfaced as a boolean rather than silently
   truncating", and its single call site (`plannerApp.ts:245`) does
   `if (isSuspiciousPrefill(obligatory)) obligatory = []` and surfaces
   nothing. CMEDFORSK period 1 legitimately sums to 42,5 sp (MD4071 30 sp +
   SMED8008 7,5 + SMED8004 5); MJORM to 45 sp. Both land on "0 av 30 sp"
   with zero rows.

**Fix:** carry `credits` (and the plan's course name) from `ClassifiedCourse`
into `PlanCourse` and use it as the fallback; filter `totalCredits` to
courses with `semesterEntries` non-empty **or** no timetable at all (unknown
≠ off-semester) and add "2 emner undervises ikke i Vår 2027 og teller ikke
med"; add a distinct over-load state that keeps ink neutral and appends
"7,5 sp over normal semesterbelastning"; keep suspicious prefills and render
the note the guard was designed for — "studieplanen oppgir 42,5 sp dette
semesteret — mer enn et normalt semester. Fjern det du ikke tar." **M.**

### B10 — The shared link is broken three ways

**Where:** `src/lib/planner/store.ts:455-518`;
`src/components/planner/programPlan.ts:306`;
`src/components/planner/plannerApp.ts:1268-1303`; vs `docs/PRODUCT.md §7` +
`docs/ROADMAP.md` Phase 1.

1. **Ø in a direction code does not survive the round trip.** BSPL kull 2026
   → "Bachelor i sykepleie (Gjøvik)" → week fills (30 sp, 37 blocks), URL
   becomes `…;BSPL.2026.BSPL26-V-GJ%C3%98VIK;…`. `parsePlanHash` never
   decodes, so `directions.find(d => d.code === directionCode)` misses, the
   "Valg av studieby" question re-opens, and the context line displays the
   raw machine code. Every Gjøvik/Ålesund campus split is affected.
2. **The shipped grammar is not the grammar D15 froze.** Code writes
   `#v2;<semesterId>;<program.cohort[.direction]>;<items>`; PRODUCT §7 and
   ROADMAP Phase 1 both freeze `#v2;26h;TDT4100.1,TMA4100.1;IT2805.1` where
   segment 3 is committed courses. Feeding the *documented* form to the
   shipped parser yields `program = {code:"TDT4100", cohort:1}`, a 400 from
   `?year=1`, and a banner reading "TDT4100 · kull 1". The 220-test suite
   cannot catch this because it was written against the code.
3. **`hashchange` is never listened for.** The hash is read once at mount;
   pasting a shared plan into an already-open planner changes the address bar
   and nothing else, and the next edit rewrites the hash from local state,
   destroying the pasted plan.

**Fix:** `decodeURIComponent` each hash segment in `parsePlanHash` (and
encode deliberately in `formatPlanHash`), with a round-trip unit test for a
code containing Ø; update PRODUCT §7 + ROADMAP Phase 1 to the shipped
four-segment programme grammar **in the same commit** (recommended over
changing the code, since the shortlist tier is deferred by §0.6) and reject
a cohort that isn't a 4-digit year in a plausible range; add a `hashchange`
listener (aborted by the same `signal`) that ignores the hash it just wrote
and otherwise applies through `store.savePlan`. **S.**

---

## 3. What should be shown where

This is the section the owner asked for. The rule I am applying throughout:
**§0.2 — the weekly schedule is the primary surface; everything else
supports it** — plus §0.6's *when in doubt, cut*. Concretely that means one
destination, one place that owns the plan, and search as a mode rather than
a page.

### 3.1 Target IA

| Surface | Primary job | Above the fold | Below the fold | Cut |
| --- | --- | --- | --- | --- |
| `/` | Dispatcher: programme + kull → week | Autofocused programme field with `studyLevel` on every row; kull chips inline (live cohorts only); the studieretning/campus question inline when one exists; resume line when a plan exists | One `.np-frame.np-ruled` proof fragment showing a red-ink collision + "del planen med en lenke — ingen innlogging" | Catalog links in the fold; any triptych; 20-chip kull grids; kull chips for cohorts with no period |
| `/planlegger/` | **The app.** The plan | Context line as `<h1>`; the week grid at ~2/3 width; verdict line ("ingen kollisjoner" / "2 kollisjoner denne uka"); credit line; course rail | Exam ribbon; provenance line composed from what actually happened; add field | Semester chips at fold weight (→ "Bytt semester" disclosure); the hidden picker on empty state; the "0 av 30 sp" empty frame while a choice is pending |
| `/emner/` | Search as a mode + SEO landing | Field; city facets (4, multi-select); plan-aware result rows with clash verdict on the add button | Nothing | The nav pill; the 200-row dump on an empty query (→ "skriv for å søke"); combinatorial location chips |
| `/emne/[code]/` | **Fork point** | Code · name · campus; verdict CTA ("Kolliderer med TDT4110, tirsdag 12:15" / "Ingen kollisjon i planen din for Høst 2026" → "Legg til og se uka"); the timetable as a ruled grid for the planned semester; one exam block | 9 key facts; all prose in one `.np-summary` ("Mer om emnet") | The grade chart (D12); the ±1-year timetable tabs; the duplicate "Eksamensdetaljer" section; prose as the page |
| `/studier/[code]/` | Study plan **as template** | Kull chips (one row + "andre kull" disclosure); the cohort's current period expanded with a credit subtotal and verbatim group prose; "Bruk som planen min" | Next period, collapsed | Marketing-prose lede (§12); the all-periods dump; per-course "+" buttons (DR-10 off-semester adds); "Bruk som planen min" while the period is direction-gated |
| `/studier/` | — | — | — | **KILL** (D11 / §12) — absorb as `/emner/?type=studier`, but only *after* `/studier/[code]/` has other entrances (I3) |
| 404 | Recovery | "Vi fant ikke emnet TMA4100" + the emne search field prefilled from the attempted path segment | Crawl-date line | Generic "til forsiden" as the only action |
| Topbar | One destination | Wordmark · **Planlegger** · theme toggle | — | The "Emner" and "Studier" pills |
| Footer | Provenance + demoted links | — | One mono row: "Søk i emner · Studieprogram · Data hentet 24. jul 2026 fra NTNU · uoffisiell" | — |

### 3.2 IA findings

| ID | Claim | Where | Effort |
| --- | --- | --- | --- |
| I1 | Nav sells three catalogs; the mandate has one destination — and the highest-traffic page matches none of them | `src/layouts/Layout.astro:26-30,100-112` | S |
| I2 | Three surfaces write to the plan; none of them shows it or leads back to the week | `emner/index.astro:196-208`, `emne/[code].astro:311-330`, `Layout.astro` (no plan strip) | M |
| I3 | `/studier/` is killed by D11 but is the only route to the pages D11 keeps | `src/pages/studier/index.astro:45-63` | M |
| I4 | One job, three implementations — and the study plan is rendered by two pages with no stated owner | `index.astro:325-360`, `plannerApp.ts:554-609`, `studier/index.astro:45-63`; `site/studyPlan.ts` vs `planlegger/index.astro` | M |
| I5 | The footer has no links, so there is nowhere to demote `/emner/` and `/studier/` to | `src/layouts/Layout.astro:118-120` | S |

**`/` — the dispatcher.** The homepage is nearly right and one change from
being very good: it leads with the field, which is the mandate. What it does
wrong is stop there. On a 1440×950 viewport the content ends at y≈320 and
~600 px of empty paper follows; the only statement that this is not an NTNU
product sits in a grey mono footer sentence below that gap, while the header
pairs the wordmark with an "NTNU" badge. I would not add tiles (§12 killed
the triptych, correctly), but I would put one small ruled fragment showing a
red-ink collision under the field with the share line beside it — §5's proof
is the cheapest possible answer to "what is this and why should I trust it",
and it doubles as the disclosure surface. The kull step needs a caption
("kull = året du startet") because the green default is currently a
colour-only signal, and the chip list needs B3's filter. Most importantly:
when the picked programme has a pending studieretning or campus choice, ask
it **here** (B2) — the dispatcher's job is to dispatch to a *working* week,
not to any week.

**`/planlegger/` — the app.** The order (week left, courses right) is right;
the ratio is not. At 1440 px the week gets 598 px — 106 px per weekday — and
the course rail gets 408 px and runs out of content 500 px early. Every
legibility defect in §4 (34 px clash blocks, 16 px øving stripes, truncated
"Forelesningsp…", clipped "uke 34–46") is one order of magnitude smaller with
300 more pixels, so I would go to `minmax(0,1fr) 20rem` — the rail only ever
holds a code, a name and a button, so it wants a fixed measure, not a
fraction. Above that, the page needs the one thing it computes and throws
away: `renderGrid` returns `conflictCount` and `renderExamRibbon` returns
`collisionCount`, and `plannerApp` discards both. `#planner-grid-status` is
empty; PRODUCT §1's primary job has no answer line. And the fold's loudest
control — three semester chips, two of which have `timetablePublished:
false` — is a way to break the primary surface; DR-9 exists so the tool
picks the plannable term itself. Resolve the term as text in the `<h1>` and
move switching into a "Bytt semester" disclosure.

**`/emner/` — search as a mode.** Keep the page (it is real deep search and
a real SEO landing) and take it out of the nav. Its two substantive problems
are that the campus filter is eight raw comma-joined strings rather than four
city facets — clicking "Gjøvik, Trondheim" *excludes* courses tagged
"Gjøvik, Ålesund, Trondheim", which is the opposite of what the student
asked — and that its rows are write-only: the "+" mutates localStorage and
gives no evidence anything happened. Until the plan strip ships, the cheapest
correct move is to make the button state its destination: "Lagt til · se
ukeplanen →".

**`/emne/[code]/` — the fork point.** This is the page furthest from its
brief. Rendered order today is kicker → H1 → a low-weight "Legg til i
planen" → "Om emnet" (9-cell fact panel + 6 prose sections + exam table + 10
credit-reduction rows) → 22 years of grade bars → **timeplan, starting at
y≈2 900 of a 3 168 px page**, as a flat day-column list rather than a grid.
§3.4 makes this a fork point for our largest cold traffic, and the visitor's
question — *does this fit my week* — is answered last, below the one section
D12 explicitly killed. Invert it: verdict CTA, then the ruled grid for the
planned semester, then one exam block, then facts, then all prose in a
`.np-summary`. The prose stays available; it stops being the page. Note the
conflict between the lens that wants the timetable grid extracted from
`grid.ts` and §0.6's do-not-overcomplicate — I adjudicate **for** extraction,
because it deletes a second timetable renderer rather than adding one.

**`/studier/[code]/` — the template.** PRODUCT keeps this page deliberately
and it earns its place: seeing the courses before committing is a better
on-ramp than the homepage's blind kull chip. But ownership has to be stated
or the two pages will keep drifting: **the planner owns the current
semester's plan** (prefill, drops, credits, the choice pool); **`/studier/[code]/`
owns the browsable template and nothing else.** That means the current period
expanded plus the next collapsed (not all ten — multi-year planning is a §9
non-goal), one "Bruk som planen min", a credit subtotal per period, the
verbatim group prose DR-5 requires, and **no per-course "+" buttons** (adding
a course to a semester you are not planning is DR-10's bug factory). And the
planner's context line becomes a link back to it — which is also how
`/studier/` the index gets deleted without orphaning 403 pages (I3).

**`/studier/` — kill, but not first.** `grep -rn "/studier/" src/` shows the
index at `studier/index.astro:51` is the **only** link to `/studier/[code]/`
anywhere in the codebase. The Phase-5 sequencing (kill it later) is correct
and is not a bug; the finding is that the entrances must land before the
deletion, not after.

**Topbar and footer.** Three equal-weight pills are the first claim every
page makes about what this site is, and they claim "browse NTNU's catalogs"
— the least differentiated thing we do. One pill. A secondary detail nobody
flagged: `aria-current` is computed with `path.startsWith(item.href)`, so
`/emne/TDT4100/` matches none of the three (`/emne/` is not a prefix of
`/emner/`) — the highest-cold-traffic page in the product is IA-orphaned
even by the nav it has. Fix that with a section map. The footer is currently
one static sentence, which is why D11's demotion has had nowhere to go; ship
the mono link row in the same change that drops the pills so nothing becomes
unreachable.

---

## 4. Major UX & interaction issues

### 4.1 `/planlegger/`

| ID | Claim | Where | Why it matters | Fix | Effort |
| --- | --- | --- | --- | --- | --- |
| U1 | "Vis øvinger og labber" turns the week into unreadable 16 px stripes | `grid.ts:292-338`; `planlegger/index.astro:437-438`; `agent-planner-mtdt-ovinger.png` | The toggle is one of only five things §0.4 requires, and the single tap that answers "når er øvingene mine" destroys the surface it enriches: 7 blocks → 56, widths 106 px → 16 px, Monday stacking 11 concurrent entries of which four are byte-identical "Lab 08:00–18:00 uke 34–47" rows, rendering one character per line | Don't give non-lecture entries equal column weight: dedupe identical (course, day, start, end, weeks) tuples into one block labelled "Lab · 4 grupper" (DR-1 admits they are indistinguishable); cap the split at 3 columns with a mono "+N til" chip; clamp 08:00–18:00 drop-in windows to a single band | M |
| U2 | Any block starting at the grid's first hour paints over its day header | `grid.ts:179-186`; `planlegger/index.astro:428-441`; `agent-planner-header-overlap.png` | Header is a static child of `.planner-grid-day`; blocks are `position:absolute` from the same box's top and appended later, so at row 1 they occlude MAN/TIR/ONS/TOR/FRE entirely. Reproducible with real data (TDT4109 has an 08:00 entry). A week grid without day names is not a week grid | Give `.planner-grid` a dedicated header row (`grid-template-rows: auto` before `grid-auto-rows: var(--cell)`), append headers to the grid rather than the columns, and span the day columns from row 2. The `position: sticky` is inert (the frame scrolls horizontally) and can go | M |
| U3 | A real 3-way lecture clash renders at 34 px per block and reports one problem three times | `grid.ts:292-338`, `:232-247`; `agent-planner-clash.png` | The product's signature moment is its least legible: blocks read "TI", "F…", "M…le…", and three notes describe the same Thursday 14:15 slot pairwise, inflating perceived damage and burying the actionable fact | Below 3 columns stop splitting — render the cluster as one red-ruled cell listing the codes stacked, which is legible at any width and matches Red-Is-Collision's "the copy names both". Group notes by (day, overlap window): "Torsdag 14:15–16:00 · TDT4160, TDT4136 og TMA4145 kolliderer · uke 34–46" | M |
| U4 | The conflict counts are computed and thrown away — there is no verdict line | `plannerApp.ts:1130,1133-1140`; `grid.ts:90-93`; `examRibbon.ts:60-64` | `renderGrid` returns `conflictCount` (its docstring says "so the caller can fold it into the page's overview line"); the caller discards the whole return. PRODUCT §1's primary job — "kan jeg ta disse emnene sammen?" — has no answer anywhere on the page | Put it in `#planner-grid-status` beside the Ukeplan kicker, accent when clean and `.np-note-clash` when not: "ingen kollisjoner" / "2 kollisjoner denne uka"; mirror on the exam head: "1 eksamen samme dag". Highest leverage per line of code in this review | S |
| U5 | While loading, the grid asserts "Ingen timeplandata" and the credit line asserts "0 av 30 sp (+5 emner uten oppgitt sp)" | `grid.ts:118-121` (called while `anyLoading`); `plannerApp.ts:419-433` | Two contradictory statements and the loud one is false; then a 507 px reflow throws the exam ribbon off-screen mid-read. Spending DR-6's honest-gap phrasing on "not fetched yet" teaches students to distrust it when it is true | Render a skeleton grid (rail + day headers + reserved min-height) while `anyLoading` and suppress the `(+N …)` suffix for null bundles, showing "henter …" in the credit slot. Reserving the height also removes the reflow | S |
| U6 | The fold's most prominent control opens two guaranteed-blank semesters | `planlegger/index.astro:21-32`; `plannerApp.ts:374-386`; `data/semesters.json` | 27v and 27h are both `timetablePublished: false`; two of three top-right chips switch the primary surface to a permanently empty grid with no explanation attached to the control that caused it | Resolve the term as text in the context line and move switching into a "Bytt semester" disclosure; chips for unpublished terms carry the note inline ("timeplan publiseres ~august") so choosing one is informed | S |
| U7 | When a period is gated, the study-plan pool is empty too — the escape hatch closes exactly when it's needed | `programPlan.ts:318-333`; `plannerApp.ts:675-697` | In the gated branch only the obligatory intersection is collected; `choice` is never populated. MIDT's five directions collectively offer TDT4117/4136/4165/4195/4200/4225/IT3212 and none reaches the pool, so "Fra studieplanen" is disabled, `effectiveScope()` falls back to "all", and the student with the least information is handed the entire 4 767-course catalog | In the intersection branch also collect each direction's non-obligatory courses into `choice` (deduped, group name preserved verbatim per DR-5) | S |
| U8 | An elective-only period says "Legg til emner" without saying which | `plannerApp.ts:1028-1097,440-458`; `#v2;26h;BIT.2024;` | BIT kull 2024 (period 5, zero `O` courses by design) shows an empty frame and "0 av 30 sp", while the actual next step — "Mangler 30 sp · Velg fra studieplanen (8)" — sits in the other column, and on mobile behind a tab. `plannerApp.ts`'s own header argues the studieretning question must be asked *on the Uke region* because "the same question hidden behind a tab is a dead end"; this is the identical shape with the opposite treatment | Reuse the `.planner-direction` panel above the grid: "Studieplanen din for Høst 2026 er valgfri · 8 emner å velge mellom" + "Velg emner" | M |
| U9 | The provenance line attributes live-fetched data to a build-time crawl | `plannerApp.ts:1145-1147` | "Data hentet 24. jul 2026 fra NTNU · uoffisiell" is built solely from `semesters.json`'s `crawledAt`, while the grid, names, credits and exam enrichment come live from `/api/course/**`. It says the same thing when the timetable is unpublished, when an exam has no date, and when a bundle returned `errors[]`. DR-8 makes provenance the moat; one wrong date on the most volatile column is worse than no line | Compose from what happened this render: "Timeplan hentet nå · eksamensdatoer fra katalogen (hentet 24. jul) · studieplan for kull 2026" + real gaps ("timeplan ikke publisert for Vår 2027", "fikk ikke hentet timeplan for TDT4109"). The `errors[]` and dateless-exam count are already computed | M |

### 4.2 `/emne/[code]/`

| ID | Claim | Where | Why it matters | Fix | Effort |
| --- | --- | --- | --- | --- | --- |
| U10 | The fork point is inverted — the timetable starts at y≈2 900 | `emne/[code].astro:44-91`; `13-emne-TDT4100.png` | See §3. We are competing with ntnu.no on encyclopedic depth, the one axis we lose on, and burying the one thing we do better | Reorder to: code/name → verdict CTA → timeplan as a `.np-frame.np-ruled` grid (extract a read-only mode from `grid.ts`, deleting `courseTimetable.ts`'s second renderer) → eksamen → facts → prose in one `.np-summary` | M |
| U11 | No plan-aware clash preview anywhere — §6's "the verb, everywhere" is unbuilt | `emne/[code].astro:308-336`; `emner/index.astro:204-215` | Both add handlers call `store.addCourse` with no diff against the plan; `grep` for "kolliderer"/"kollisjon" across both pages returns nothing. The lecture-conflict engine (`lib/planner/conflicts.ts`) already exists one directory away and is never called from either page. Without it `/emne/[code]` is exactly the encyclopedia D11 says to kill | Reuse `conflicts.ts`: one line under the CTA ("Kolliderer med TDT4110, tirsdag 12:15" / "Ingen kollisjon i planen din for Høst 2026"), and the same as `title`/`aria-label` on `/emner/`'s "+" **before** commit | L |
| U12 | 22 years of browsable grade bars, which D12 explicitly killed | `emne/[code].astro:80-84`; `site/courseGrades.ts:76-122` | `mountCourseGrades` groups by `row.year` only (never `row.semester`, which is in the payload) and renders one stacked bar per year, 2004–2025 for TDT4100 — ~450 px above the timetable, at the same heading weight. This is the DBH-mirror parasitism §6 and D12 name by name, *and* it drops the season split the doc commits to | Remove the section. Grades return only in the decision cell (Phase 4) as a season-split *shape* in one line. Note this also moots the finding that the F segment (`var(--muted)`) is the darkest mark in light mode and the brightest in dark — if the chart survives review, fix that with a dedicated `--grade-fail` token in both themes | S |
| U13 | Exam info appears twice from two sources — and not at all for 294 courses | `emne/[code].astro:41,55-71`; `site/courseDetails.ts:92-111` | Text order on `/emne/TMA4400/`: "Eksamen · høst — 1. desember 2026" (catalog `ExamDate`, server-rendered) … then a separate "Eksamensdetaljer" table (scraped `CourseExam`, client-rendered). DR-3 makes catalog the authority and the scrape an enrichment; two peer sections invite exactly the confusion the rule prevents. Worse, the static block is gated on `course.exams.length > 0`, so AAR4215 renders the "kun eksamen" badge next to *no* exam section at all while `/api/course/AAR4215` has a real one — 294 catalog courses carry `examOnly: true` and an empty `exams` array | One exam block under the timetable: catalog date as the headline (or "eksamensdato ikke fastsatt" — `formatDate` already supports the fallback, the branch is just unreachable when the array is empty), scraped form/duration/aid-code in a `.np-summary` beneath. Delete `renderExams` from the "Om emnet" island | S |
| U14 | The timetable year tabs are a no-op, and the default tab shows an elapsed season with no disclosure | `site/courseTimetable.ts:95-150` | Curl-verified: `/api/course/TDT4100/timetable` returns byte-identical data for `?year=2025`, `2026`, `2027`; TDT4120 identical for 2024–2028. The worker does thread `year` through — upstream simply has one snapshot. So three independently clickable, separately labelled year chips imply a choice that does not exist. For TDT4100 the only data is `term: "2026_VÅR"` — already elapsed on 2026-07-24 — shown on a chip labelled bare "2026", while the fact panel says "Undervises Vår 2027" | Collapse to one view. Always render the season the entries actually carry ("Viser: Vår 2026" from `entry.term`), and when that isn't the planned season say so ("ikke undervist Høst 2026") rather than showing a bare, room-numbered grid a student will plan around. Drop the year chips — three years of timetable in a one-semester tool also invites the multi-year browsing §9 rules out | M |

### 4.3 `/emner/` and `/studier/[code]/`

| ID | Claim | Where | Why it matters | Fix | Effort |
| --- | --- | --- | --- | --- | --- |
| U15 | Campus chips are 8 raw comma-joined strings, not facets — and one failed fetch kills search for the session | `emner/index.astro:166-167,227-246`, `:248-261` | `jq` over the catalog shows exactly 8 location strings; each becomes its own single-select chip filtered with `location.includes(activeLocation)`, so "Gjøvik, Trondheim" *excludes* "Gjøvik, Ålesund, Trondheim". §6 makes city-level campus filtering a MUST. Separately, `init()` fetches `search-index.json` once; on failure it writes "klarte ikke å hente emner" and returns, and `index` stays undefined for the rest of the session — 8 such messages exist sitewide and not one has a retry | Split on `", "` into ~4 city facets, multi-select OR. Add a shared "prøv igjen" action to every fetch-failure message; at minimum re-fetch the index when the user retypes | M |
| U16 | "Bruk som planen min" can commit courses the page never showed | `site/studyPlan.ts:205-222` + `renderDirection`/`renderWaypoint` | Reproduced: MTDT period 5 has `direction.courseGroups.length === 0` — everything sits under a collapsed "Valg av studieretning" `<details>`. The rendered card shows a header, the button, and one closed triangle: **zero course names on screen.** `useAsMyPlan()` independently calls `classifyPeriod()`, whose intersection rule computes TDT4136 + TMA4135 (15 sp, under the 30 sp suspicious ceiling so unfiltered), commits them via `setProgramPlan`, and navigates. The student lands on "15 av 30 sp" with two courses they never saw | Gate the button off when top-level `courseGroups` is empty (force the studieretning choice first), or expand the waypoint and show the exact intersection before commit. Never move courses the student cannot see | M |
| U17 | The plan page drops DR-5's mandated prose, has no period subtotal, and leads with a mangled sentence | `site/studyPlan.ts` (`grep '\.description'` returns nothing); `studier/[code].astro:37`; `16-studier-MTDT.png` | BIT period 5's `courseGroup.description` is *"Man må velge minimum 2 av emnene i M2A-kategorien…"* — fetched, in the payload, never rendered. The page shows 8 uniform "+" buttons, which reads as "add what you like": the exact ambiguity DR-5 exists to prevent. No period sums its credits although 0 + 7,5×4 = 30 is the single most useful sanity number. And `program.description` is a duplicated string on ~88% of programmes ("Datateknologi - master (5-årig) Datateknologi"), rendered as the first sentence under the H1 | Render `group.description` and `waypoint.description` verbatim under their headings (no paraphrase); add a null-aware credit subtotal per period; **delete** `program.description` — §12 already kills "program marketing prose as primary content", so this is a deletion, not a crawler fix. Also collapse the 20 kull chips to one row + "andre kull" | S |

### 4.4 Entry and error surfaces

| ID | Claim | Where | Why it matters | Fix | Effort |
| --- | --- | --- | --- | --- | --- |
| U18 | 404 and the homepage both discard the intent the visitor arrived with | `404.astro:5-9`; `index.astro:13-49`; `14-emne-TMA4100.png`, `01-home-desktop-light.png` | `/emne/TMA4100/` — a real, heavily searched course absent from the 2026 catalog (C1) — renders "Vi fant ikke siden du lette etter" and one "Til forsiden" button. Course-code URLs are our largest cold-traffic surface and the one most likely to miss. Meanwhile the homepage tells a cold visitor nothing about what the tool is, and hides the unofficial disclosure ~600 px below the fold under a header that pairs the wordmark with an "NTNU" badge | 404 recovers intent from the path: if segment 1 is `emne`, "Vi fant ikke emnet TMA4100" + the search field prefilled with the code + the crawl-date line (DR-8); otherwise the programme field. Homepage: one line of sub-copy under the H1 that states the job *and* that it is unofficial, plus the kull caption "kull = året du startet" | S |

---

## 5. Design system & visual polish

### 5.1 Type and voice

| ID | Claim | Where | Fix | Effort |
| --- | --- | --- | --- | --- |
| D1 | `.np-note` (mono) has become the generic small-text class and carries ~30 full Norwegian sentences — Data-Is-Mono is inverted sitewide | `primitives.css:25-29`; 33 call sites incl. `index.astro:38,44`, `planlegger/index.astro:61,64,92,116,136,163,176`, `grid.ts:87`, `examRibbon.ts:67,117`, `plannerApp.ts:567,875,1031` | Add a `.np-hint` primitive (sans, `--text-sm`, `--leading-normal`, `--muted`) and move every sentence-carrying site to it. Keep `.np-note` for mono fragments only ("uke 38–40", "0 sp", "dato ikke satt"). For `.np-note-clash`, build the string as grotesk with `<span class="np-data">` around day/time/week. DESIGN is unambiguous: "if it is a sentence, it is the grotesk. No third voice" | M |
| D2 | The primary surface has no headline and the site runs on two small sizes | no `<h1>` in `planlegger/index.astro`; `404.astro:7`; `tokens.css:61-68` | Token census: `--text-xs` 30 uses, `--text-sm` 19, `--text-md` 7, `--text-lg` **0**; 49 of 72 sizing declarations are ≤13.4 px. The documented 1.6 rem headline is used once and never on a page, while an undocumented 2 rem is the de-facto page title. The homepage — a search box — gets 2.6 rem; the planner's largest type is a 1.13 rem mono line. Give `/planlegger/` a real `<h1 class="np-data">` at `--text-xl` carrying the context line, give `/404` an `<h1>`, reconcile the scale (adopt 2 rem as an explicit step or demote the four uses), and lift `.planner-block-code` to `--text-sm`/500 so the code outranks room and week numbers | M |
| D3 | Copy conventions drift within a single viewport | `studyPlan.ts:167`, `plannerApp.ts:905,1076`, `courseDetails.ts:147` vs `dom.ts:24-29`; `examRibbon.ts:183`; `plannerApp.ts:1057-1069` | Three things, one commit: (a) four renderers interpolate raw numbers ("7.5 sp") while `formatCredits` correctly produces "7,5 av 30 sp" — on `/emne/TDT4100/` "7.5" and "7,5 sp" appear eight lines apart; export `formatCreditNumber` and route all four through it. (b) The exam list prints `2026-12-09` while its own header prints "25. nov – 18. des"; import the existing `formatShortDate` and widen `.planner-exam-date` to 9 em so "dato ikke satt" fits. (c) "Fjern" labels both a reversible programme drop and an outright delete — use "Dropp" (→ "Legg tilbake") for `source: "program"` per §0.3 | S |

### 5.2 Layout and rhythm

| ID | Claim | Where | Fix | Effort |
| --- | --- | --- | --- | --- |
| D4 | The squared ruling is permanently 16 px out of register with the timetable it rules, and gives hours no landmark | `primitives.css:249-254`; `planlegger/index.astro:383-387,539-544`; `05-planner-with-ovinger.png` | `.np-ruled` sets only `background-image`/`-size`, so tiling starts at the **padding box** while `grid-auto-rows` starts at the content box — measured constant 16 px offset, and the code comment at `planlegger/index.astro:398-401` claims the opposite. Add `background-origin: content-box` and make every ruled surface's padding a multiple of `--cell` (grid frame → 24 px; exam frame → 48/24/24); start the day columns on a cell boundary (`3rem` rail, not `3.5em`). Then add a `.np-ruled--hours` modifier drawing a heavier line every 4th cell — a real timetable sheet has an hour rule, and uniform 15-minute squares make the ruling texture rather than an instrument | S |
| D5 | The ruled frames are shown empty more often than full | `grid.ts:86-88,114-125`; `examRibbon.ts:66-70,96-105`; `04-planner-program-desktop-light.png` | `renderEmpty()` leaves `.np-frame.np-ruled` in place and drops a paragraph in it, so the flagship programme→kull result's dominant visual is two identical ruled rectangles containing apologies, and the exam frame reserves `min-height: 6rem` for nothing. Ruling-Marks-The-Plan says the ruling appears exactly where planning happens. Strip `np-ruled` in the empty branch, set the message in `.np-hint`, drop the min-height | S |
| D6 | The global prose measure caps `<ul>`, clipping every data list to 38 rem | `base.css:58-62` | `/emner/` renders `wide` (72 rem) but `.emner-results` is a `<ul>` inheriting the 38 rem prose cap: rows stop at x≈800 on a 1440 px viewport with ~500 px empty beside them and names ellipsised mid-word. Same silent cap on `.planner-exam-list`, `.planner-notes-list`, `.details-reductions-list`, `.details-activities-list`. DESIGN §3 says the opposite: "data surfaces use the full `--maxw` column". Scope the rule to unclassed prose (`:where(p,ul,ol):not([class])`) or set `max-width: none` on the four data lists | S |
| D7 | The primary surface gets 598 px; the supporting rail gets 408 px and ends 500 px early | `planlegger/index.astro:308-329,394-403`; `agent-planner-mtdt.png` | `minmax(0,1.55fr) minmax(0,1fr)`. Go to `minmax(0,1fr) 20rem` (18 rem at 1024 px) and raise `.planner-grid` `min-width` to 40 rem; the rail is already sticky, so the released ~150 px goes straight into day-column width. Also drop room/week lines from blocks under ~90 min and move them into the block's `title`/`aria-label` so short blocks stop clipping "uke 34–46" | S |

### 5.3 Colour and dark mode

| ID | Claim | Where | Fix | Effort |
| --- | --- | --- | --- | --- |
| D8 | Controls sit at ~1.1:1 against the page, so the homepage search field all but disappears in dark mode | `tokens.css:15-17,126-128`; `primitives.css:189-198,50-65,158-175`; `20-home-dark.png`, `22-studier-dark.png` | Computed contrast of `--card` against `--bg` is 1.11:1 light, ~1.10:1 dark — well under WCAG 1.4.11's 3:1 for control boundaries. Ink-Before-Chrome correctly forbids borders, which makes the tonal step the *only* affordance, so the step has to be visible. Add `--control-bg` (= `--card` light, `#2a2927` dark), point `.np-field`/`.np-btn`/`.np-toggle` at it, and give `.np-field` a persistent 2 px `--accent-weak` inline-start rule via `inset` box-shadow so the field's edge always reads. Keep placeholders at `--muted`, not `--faint` | M |
| D9 | Course hue washes read at the same weight as the collision hatch, and two smaller colour signals are misassigned | `planlegger/index.astro:435-476`; `studyPlan.ts:249`; `index.astro:64-74` vs `planlegger/index.astro:239-247,692-700` | Six pastel washes at 16% (two of them red-adjacent) dilute Red-Is-Collision; the `is-clash` hatch over the magenta block is barely separable and fainter still in dark. Drop the wash to ~8% (the `.np-dot` carries identity per §8) and raise the clash to something categorically different: a solid 2 px `--clash` left edge plus `--clash-bg` on the overlap band only. Two smaller items in the same pass: "ditt semester" — a membership state, the canonical Green-Means-Fits case — is muted mono and should carry `--accent-ink` on `--accent-weak`; and the three typeahead popovers use two different surface tokens, one of them `--card-nested` (documented as *recessed*, and **lighter** than `--card` in dark, so the relationship inverts between themes) — standardise on `--card` and hoist a `.np-popover` primitive | S |

### 5.4 State, motion and assets

| ID | Claim | Where | Fix | Effort |
| --- | --- | --- | --- | --- |
| D10 | `.np-toggle` (uppercase tracked mono filter tag) is used for multi-word proper names, and the chosen programme is set as a kicker | `plannerApp.ts:653,377`; `index.astro:34,309,314`; `04-…png`, `03-home-kull-chips.png` | The studieretning choices render as "DATABASER OG SØK", "VISUELL DATABEHANDLING" — 20-character Norwegian phrases in 11.5 px uppercase tracked mono, wrapping to two rows — and `plannerApp.ts:377` calls `.toUpperCase()` on top of the CSS `text-transform`, baking it into the DOM. Meanwhile the programme you just chose, the only place to tell MIDT from MTDT, is written into a `.np-kicker` (0.72 rem, muted) — meaning set as chrome. Add `.np-toggle--text` (sans, `--text-sm`, no transform, same fills and `aria-pressed`); remove the redundant `.toUpperCase()`; render the confirmation as a title with a mono `.np-data` code beside it | S |
| D11 | The primitive layer is drifting: four declared primitives have zero users, and the declared press grammar is on 3 controls of ~20 | `primitives.css:124-145,230-238,300-313,38-46`; ad-hoc rebuilds at `grid.ts:215-218`, `examRibbon.ts:81-84`, `plannerApp.ts:1045-1052` | `.np-tag` — DESIGN §5's signature course chip, "a ruteark cell, not a pill" — is used **zero** times and hand-rebuilt three ways at three sizes (11.5 / 13.4 / 16 px), all visible simultaneously on one screen. `.np-kbd`, `.np-tile`, `.np-lift` have no users at all. And `.np-press` (the declared "press = 1px dip") is on `studyPlan.ts:253`, `404.astro:8` and `emne/[code].astro:46` only — every control on the planner is dead on press. Replace the three hand-built heads with `.np-tag` (+ a `.np-tag--sm` modifier), move the dip into the primitives themselves (`.np-btn:active, .np-toggle:active, …`) keeping `.np-press` as an escape hatch, and either adopt or delete the three unused primitives — a documented primitive with no user is system debt | M |
| D12 | Every declared 500/600/700 font file is a byte-identical copy of the 400 file, and nothing is preloaded | `src/styles/fonts/*.woff2`; `scripts/fetch-fonts.mjs`; `layouts/Layout.astro:37-93` | `sha256sum` proves it: `schibsted-grotesk-{400,500,700}-latin.woff2` share one hash, the `-latin-ext` trio another, and both Spline Sans Mono triples likewise — 12 `@font-face` rules resolving to 4 physical files. Every use of `--weight-medium`/`--weight-bold` (h1s, the wordmark, `.planner-block-code`, `aria-current`, buttons) is browser-synthesised fake bold, which some renderers apply weakly or not at all. Separately, all faces are `font-display: swap` with no `<link rel="preload">`, so the 2.6 rem homepage headline paints in system-ui and rewraps. Re-run the fetch script against the correct weight endpoints and assert distinct hashes per weight in the script; preload the three latin faces used above the fold | S |

---

## 6. Accessibility and mobile

| ID | Claim | Where | Why it matters | Fix | Effort |
| --- | --- | --- | --- | --- | --- |
| A1 | Zero `<h2>`/`<h3>` in the entire codebase — every section label is a styled `<p>`, and `/planlegger/` has no heading at all | `planlegger/index.astro:18,36,58,91,103,119,129`; `emne/[code].astro:37,58,75,81,87`; `studier/[code].astro:36,54` | Heading navigation (H key / rotor) is how screen-reader users skim. On the app — four labelled regions in one document — an AT user cannot jump to "Eksamener" or "Emner" and must read linearly on every visit. `<section aria-label>` gives landmarks but not headings | Make the planner's context line the `<h1>` and promote real region labels to `<h2>`, keeping `.np-kicker` as the visual class. Leave decorative eyebrows as `<p>`. Zero visual change | M |
| A2 | All three comboboxes never set `aria-activedescendant` or ids on options, and bind selection to `mousedown` only | `index.astro:207-360`; `plannerApp.ts:560-600,890-920` | `grep aria-activedescendant src/` → zero hits; the three `role="option"` `<li>`s get no `id` and no `aria-selected`; highlight is a CSS class. Arrowing through 12 options is silent. Worse, activation is wired to `mousedown` with no `click` handler, so AT paths that dispatch `click` without `mousedown` (VoiceOver/TalkBack double-tap, some switch access) cannot select at all — on the first step of the flagship flow | Stable ids per option, `aria-selected` on the active one mirrored into `aria-activedescendant`, and a `click` listener alongside `mousedown`. Add `aria-expanded`/`aria-controls` to the "Endre" button | M |
| A3 | `/emner/` rows physically overlap at 390 px — the only place in the review where text collides with text | `emner/index.astro:54-100`; `31-emner-mobile.png` | Measured at 390×844: `.emner-row-exam` spans x 190–274 and `.emner-row-location` x 243–306 (31 px overlap) while `.emner-row-name` collapses to 0 px. `.emner-row-link` is `flex:1` but its `.emner-row-exam` child is `flex-shrink:0` with no clipping, so it overflows into the sibling. Rows read "TDT4109 · eksamen høsandheim". The row is still tappable, so it is not a hard blocker — but it is the catalog's entire result list on a phone | `@media (max-width: 40rem)`: wrap `.emner-row-link`, give the name its own full-width line, drop `flex-shrink:0` from the exam note, move location onto the code line, and make `.emner-row-code` `min-width` rather than `width: 7em` | S |
| A4 | The mobile week silently truncates Thursday and Friday | `planlegger/index.astro:383-403`; `agent-planner-mobile-week.png` | At 390 px the frame is 356 px wide against 544–576 px of content; the frame's own rounded border closes right after ONS. No fade, no arrow, no visible scrollbar, and the page itself does not scroll horizontally — so the clip reads as an edge, not as more content. A student can conclude their week has no Thursday lecture. The Phase-5 day agenda is correctly sequenced; the *silent* clip in the interim is not | Edge fade/mask on the scrollable frame, a mono hint under the kicker ("dra sidelengs for torsdag og fredag"), scroll to the current weekday on load, and drop `min-width` enough to fit five day headers | S |
| A5 | Three cheap a11y basics are simply absent | `Layout.astro:94-112`; `emne/[code].astro:76,82,88`, `studier/[code].astro:57`; `grid.ts:272` | No skip link — 5 chrome tab stops before `<main>` on every ClientRouter navigation. Four `data-role="status"` elements lack `aria-live` although `/`, `/emner/` and `/studier/` all have it, so three of the course page's four content blocks load and fail silently. And the one scripted scroll (`scrollIntoView({behavior:"smooth"})` from a conflict note) ignores `prefers-reduced-motion`, which the tokens cannot reach — DESIGN §6 claims zeroing the duration tokens is the complete answer, and this is the one thing outside them | Add `<a href="#main-content" class="skip-link">Hopp til innhold</a>`; add `aria-live="polite"` to the four statuses; guard the scroll with `matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"` | S |

---

## 7. Data correctness and code

### 7.1 DR-1 … DR-10 audit

| Rule | Status | Note |
| --- | --- | --- |
| DR-1 lecture-only engine, øving as muted layer | ⚠️ partial | Engine is correct and lecture-only. But under-classification blanks the *default* view for 47 programmes instead of degrading to the muted layer DR-1 assumes (B7), and merged parallel groups are shown uncaptioned (B2) |
| DR-2 pre-publish as a primary mode | ❌ | Two of three semester chips lead to a blank grid with no pre-publish treatment (U6) |
| DR-3 exam ribbon from catalog `ExamDate` | ⚠️ partial | Source is right; the year filter is missing (C3) and the course page renders a second, scraped exam block as a peer (U13) |
| DR-4 version in state, every API call, the hash | ❌ | Broken for 220 courses (C2) |
| DR-5 never assert group satisfaction; quote the prose | ⚠️ partial | Nothing asserts satisfaction (good) — but the mandated verbatim prose is fetched and never rendered, and the gated pool is hidden entirely (U17, U7) |
| DR-6 null-aware credit total | ❌ | Wrong four ways (B9) |
| DR-7 fallback ladder, prefill as a suggestion | ⚠️ partial | Step-back exists; it never runs on a 400 (B1), and "no plan" is terminal (B8) |
| DR-8 provenance is a surface | ❌ | One build-time date stands in for five sources, three fetched live (U9); absent entirely from `/emne/[code]` |
| DR-9 next plannable term is an explicit rule | ❌ | Three chips, two blank; the rule is not applied (U6) |
| DR-10 off-semester adds excluded from the total | ❌ | Detected and displayed on the row, counted in the header anyway (B9.2) |

### 7.2 Findings

| ID | Claim | Where | Why it matters | Fix | Effort |
| --- | --- | --- | --- | --- | --- |
| C1 | The catalog is single-year, so 703 real courses — including TMA4100 — have no page and no search hit | `crawler/crawl.mjs:78-83`; `emne/[code].astro:5-10` | Verified this is **not** a crawler bug: `searchAll(2026)` returns `numFound: 4767`, 4767 unique codes, zero dropped. TMA4100 is simply absent upstream for 2026 (replaced in MTDT's plan by TMA4400) and present for 2024/2025; diffing years, the 2025 catalog has 5 201 courses of which 703 are absent from 2026. Meanwhile the API still serves them: `/api/course/TMA4100/grades` returns rows back to 2004 and `/timetable?year=2025` is 200, while `/emne/TMA4100/` 404s and the planner's add field says "Ingen treff". This also causes 2.8% of period-1 obligatory references to lose their credits (B9.1) | Crawl year and year−1 (two extra paginated passes at the existing 500 ms gap), union into `catalog.json` with `offeredYears: number[]`, build pages for the union, and render an honest state for the 703: "ikke undervist i 2026 · sist undervist 2025" with grades and last year's timetable intact. This also gives C3 the data it needs | M |
| C2 | DR-4 version threading is broken for 220 courses | `site/courseTimetable.ts:54`; `crawler/transform.mjs:69-79`; `plannerApp.ts:~858` | `courseTimetable.ts` fetches without `&version`; `toSearchIndex` projects `[code, name, location, exams]` and drops `version`, so the "Alle emner" branch hardcodes `version: "1"`. 220 of 4 767 courses are not version "1" (190 × A, 24 × "2", 2 × "3", 2 × B, 2 × C). Live diff on BBOA2010 (version A): `?year=2026` returns `courseName` all null; `&version=A` returns `"Innføring i skatterett"` — different payloads for the same slot. DR-4 calls this "a correctness MUST, not a nicety" | Add `version` as a fifth element of the search-index tuple and to `PlannerIndexCourse`; use it in the "all" branch; pass `course.version` from the catalog props into `mountCourseTimetable` | M |
| C3 | The exam ribbon matches on season only, so Høst 2027 shows Høst 2026's dates | `lib/planner/data.ts:187-196`; `examRibbon.ts` | `examsFromIndex` filters `exams.filter(([s]) => s === season)` — never year — and `search-index.json` carries exactly one crawl year (2026). TDT4109's row is `["AUTUMN","2027-01-09"]`, which is 26h's exam; select "2027 HØST" and it is presented as 27h's, a year early, with no staleness marker, beside a note that correctly says the timetable isn't out yet. (Correction to one lens: there is no "countdown from today" — `dayGap` measures spacing *between* consecutive exams. The stale-date defect stands) | Filter index exams to the semester's own window (`fromDate`…`examFinalDate` from `semesters.json`); when the semester's year is outside the index year, render "eksamensdatoer er ikke publisert for Høst 2027" rather than borrowing | M |
| C4 | Parsers accept anything: an unknown `semesterId` silently mixes semesters, and `fold()` folds Å but not Æ/Ø | `store.ts:455-498` + `plannerApp.ts:354-370,1170-1172`; `dom.ts:83-89` | `#v2;25h;MTDT.2024;…` is accepted verbatim: `currentSemester()` falls back to 26h for `teachingWeeks` while `loadBundles` fetches year 2025 — 2025 entries filtered against 26h's weeks. `#v2;banana;…` makes `semesterYear` null, `loadBundles` returns early, and the page renders a course list with a permanently empty grid, no spinner and no error — then `syncHash()` writes the bad id straight back. Separately, `fold()`'s comment claims "Æ/Ø/Å → A/O/A" but NFD decomposes only Å: verified `fold('Åpen') === 'apen'` while `fold('Økonomi') === 'økonomi'`, so typing "okonomi" finds nothing on a Norwegian site where Ø-initial names and 238 Ø/Æ course codes are common (note: the doc comment's line reference in one lens was wrong — it is `dom.ts:83-89`, not 423-429) | Validate the parsed `semesterId` against `semesters.json` on load; unknown → fall back to `current` with a one-line note ("lenken pekte på et ukjent semester — viser Høst 2026"). Pre-map `æ→a, ø→o, å→a` before NFD, with unit tests for "okonomi" → "Økonomi" and "boa1100" → "BØA1100" | S |
| C5 | Five small correctness/hygiene defects worth one sweep | see below | (a) `worker/src/cache.ts:12-27` — `TTLCache.get` returns null past TTL but never deletes, and the module-level Map only grows, in a 128 MB isolate; delete on expired read and cap with insertion-order eviction. (b) `grid.ts:252-254` — `blockId` is `code-day-start`, and real data collides (EXPH0300 has "Forelesningsparallell 2 Trondheim" and "…3 Gjøvik" both at `EXPH0300-1-10:15`), so duplicate DOM ids make conflict notes flash the wrong block; include the entry index and resolve via a `Map<GridEntry, HTMLElement>`. (c) `planlegger/index.astro:774` — `set:html={JSON.stringify(programOptions)}` inside `<script>`; `JSON.stringify` does not escape `<`, so an upstream programme name containing `</script` breaks out; escape to `<`. (d) `plannerApp.ts:1268-1275` — `onPlanChange` unconditionally refetches the study plan, so a kull pick costs three sequential round trips and every Fjern/Legg tilbake costs another; memoise `findProgramPlan` by `code:year` like `fetchCourseBundle` already does, and skip when neither `program` nor `semesterId` changed. (e) `worker/src/routes.ts:170-198` — `/api/course/:code/schedule` is implemented, cached and tested and called by nothing; delete it or document it in SPEC as a deliberate public endpoint | S |

---

## 8. Docs, tests, CI

| ID | Claim | Where | Why it matters | Fix | Effort |
| --- | --- | --- | --- | --- | --- |
| T1 | The only end-to-end test of the §0 mandate never runs in CI | `.github/workflows/ci.yml`, `release.yml`; `mise.toml [tasks.check]`; `e2e/flows.pw.ts:33-58` | The suite is good — it drives home → typeahead → MTDT → kull 2026 → `toHaveCount(5)`, `"30 av 30 sp"`, a visible grid block, "MTDT · kull 2026" — plus the 3rd-year siving, 3rd-year bachelor and ekstraemne shapes, i.e. exactly the flows that were broken before. But `grep -c 'playwright' .github/workflows/*.yml` → 0 for all three, and `mise run check` (lint + typecheck + test, 220 tests, exit 0) excludes `*.pw.ts` by filename. The mandate can regress into production behind a green badge — which is how B2/B4-class failures reach a user | A second CI job running `npx playwright install --with-deps chromium && npm run test:e2e` (the config already builds and self-serves), gating `release.yml`. If live-data flakiness is a worry, run it on PRs touching `src/lib/planner/**`, `src/components/planner/**`, `worker/**` plus a schedule | M |
| T2 | SPEC.md binds StudyCompanion rules and `.sc-*` classes, and documents no `/planlegger/` at all | `docs/SPEC.md:5,40,49,147-172`; `README.md:11` | Line 5 says DESIGN.md's "named rules are binding: Mono-Marginalia, Structural-Border, Accent-Ink, Literal-Swatch" — **none** of those are Ruteark's rules — while line 49 of the same file says "StudyCompanion is inspiration only; nothing is ported". §Pages still specifies `.sc-field`/`.sc-chip`/`.sc-summary` and "serif name", and documents `/studier/` as first-class. The ownership table has zero rows for `planlegger/index.astro` (791 lines), `components/planner/*` (2 300), `lib/planner/*` (1 060) or `e2e/` — the flagship surface is undocumented. README:11 still calls PLANNER.md the product spec | Point SPEC:5 at the real named rules, replace the `.sc-*`/serif prose with `.np-*`, mark the `/studier/` index Phase-5-for-removal, add a `/planlegger/` architecture section (store → data → engine → render) and the missing ownership rows, and fix README:11 to name PRODUCT.md. Contradiction inside one file is worse than silence | M |
| T3 | The lint gate cannot go red, and the release path has never run | `biome.json:3-18` + `CLAUDE.md`; `package.json:4`; `release.yml` | `mise run check` → "Found 38 warnings … EXIT=0", all of them `noUnusedImports`/`noUnusedVariables` against `.astro` frontmatter the template does use — documented in CLAUDE.md as "don't fix them". A genuine dead import in `worker/`, `crawler/` or `src/lib/` would print in the same wall of noise and still exit 0. Separately `version: "0.1.0"` with no tags and no remote, while `release.yml` asserts the tag matches it — so the first tag push will be the first execution of a workflow that also crawls live NTNU data and deploys | Add a biome `overrides` entry disabling those two rules for `**/*.astro`, then run `biome check --error-on-warnings` in CI now that the output is signal. Bump the version to match reality and dry-run the release path (`workflow_dispatch` on crawl.yml with secrets) before the first real tag | S |

---

## 9. Recommended sequence

### Wave 1 — make "programme + kull → your week" true and legible (≈ 10 S + 8 M)

Exactly the set that moves the flagship flow from 43% of programmes to
near-universal, and makes the resulting week readable. Nothing else ships
before this.

| Entry | One-line |
| --- | --- |
| B1 | Decode path segments in the worker — unblocks 58 programmes and 238 courses |
| B2 | Ask the studieretning/campus question in the picker; never render an empty week while a choice is pending — unblocks 82 programmes |
| B3 | Filter kull chips to cohorts whose period exists |
| B4 | Re-derive the programme plan when the semester changes |
| B5 | Open the picker on an empty planner and keep the add field mounted |
| B6 | Put `studyLevel` in the typeahead so MIDT ≠ MTDT |
| B7 | Auto-show the muted layer when a plan has entries but no lectures — unblocks 47 programmes |
| B8 | Turn "ingen studieplan funnet" into a code-first offer |
| B9 | Fix the credit line's four defects |
| U1 | Dedupe and cap the øving layer so the toggle stays readable |
| U2 | Give the grid a real header row so day names survive 08:00 blocks |
| U3 | Render 3+ way clashes as one cell and group the notes by slot |
| U4 | Render the verdict line from the counts already computed |
| U5 | Skeleton the grid while loading instead of asserting "Ingen timeplandata" |
| U7 | Populate the choice pool in the gated branch |
| U8 | Ask the elective question on the week, not in the side column |
| D7 | Give the week the width (`1fr / 20rem`) |
| A4 | Stop the mobile week from truncating Thursday and Friday silently |

### Wave 2 — IA and honesty (≈ 8 S + 8 M + 1 L)

B10, I1, I2, I3, I4, I5, U6, U9, U10, U11, U12, U13, U14, U16, U17, U18, C1, C3.
One pill, one footer, a plan strip (or add-buttons that name their
destination), `/studier/[code]/` given entrances before the index is
deleted, the course page inverted around the verdict CTA, the grade chart
removed per D12, the provenance line composed from what actually happened,
and the two-year catalog that makes TMA4100 a page again. U11 (clash
preview everywhere) is the L and the one that turns the course page from an
encyclopedia into a fork point.

### Wave 3 — design system and accessibility (≈ 8 S + 5 M)

D1, D2, D3, D4, D5, D6, D8, D9, D10, D11, D12, A1, A2, A3, A5.
`.np-hint` for sentences, a real `<h1>` and a reconciled scale, the ruling
back in register with an hour landmark, the prose measure off data lists,
controls visible in dark mode, the primitives adopted or deleted, real bold
fonts, and the four a11y gaps. Do D1 and D11 in one pass — both are
"primitives.css is the single grammar" work.

### Wave 4 — data, code, docs (≈ 5 S + 4 M)

U15, C2, C4, C5, T1, T2, T3.
Version threading, city facets, parser validation, the hygiene sweep, e2e
in CI, SPEC rewritten, a lint gate that can fail. **T1 arguably belongs in
Wave 1** — it is the only thing that keeps Wave 1 from silently regressing —
so if there is appetite for one out-of-order item, take T1 early.

---

## 10. Deliberately not recommended

Things a reviewer might expect here that I am explicitly **not** proposing.

| Not proposing | Why |
| --- | --- |
| A compare matrix, `?mot=` as a comparison page, or any substitution/swap engine | D2 killed them and I agree: electives are decided on 1–2 facts by a twice-a-year user. The *sentence* carries the value, not the table |
| Øving-group clustering / "flag only when no alternative avoids the clash" | DR-1/D6: unbuildable on our data — `TimetableEntry` has no group field and the key merges parallel groups. My U1 fix leans into that (dedupe + "4 grupper"), it does not try to undo it |
| Any workload, difficulty, or "best 2 of 5" score | §9's no-fabricated-signals line, and DR-5 forbids the last one structurally. The assessment-mix "workload count" is on the wrong side of the same line (D14) |
| A week scrubber, personal fixed blocks, ICS export, push, maps, a solver | §9 / D14. The scrubber and fixed blocks also break shared-URL parity, which is the growth object |
| Multi-year planning in the planner | §9. This is why I recommend `/studier/[code]/` show the current period expanded and the next collapsed rather than all ten — and why U14 drops the ±1-year timetable tabs rather than making them work |
| Bilingual UI chrome, a glossary, an FAQ, a wizard | §9 / §12. U18's one line of sub-copy and U17's caption are orientation, not a wizard |
| Building-level campus filtering | §9 — the data is city-level only. U15's fix is deliberately four cities, not buildings |
| Restoring the grade chart in any browsable form | D12 / §12. If grades come back it is a season-split *shape* in the decision cell, never a chart and never a sortable column |
| A `/studier/` index redesign (pagination, virtualised list, level facets) | It is on §12's killed list. Fixing a 22 000 px page you intend to delete is the definition of over-building; I3 gives its one surviving link two better homes instead |
| Extracting a shared "listbox" abstraction across all typeaheads *now* | I4 proposes one `programPicker` module because there are literally three copies of the same programme search. I am **not** proposing a generic combobox framework on top of that — §0.6, when in doubt cut |
| A "merge / replace / keep" interstitial for incoming shared plans | Phase 3 work and correctly sequenced there. B10's `hashchange` fix applies the incoming plan directly, which is strictly better than the current divergence and does not pre-build the interstitial |
| Server-side rendering the planner, an account system, or Studentweb integration | §9. Everything above is achievable on the static + worker split that exists |
| "Fixing" the 38 Biome warnings | CLAUDE.md is right that they are false positives. T3 silences the rule for `.astro` so the gate becomes real — it does not touch the code |
