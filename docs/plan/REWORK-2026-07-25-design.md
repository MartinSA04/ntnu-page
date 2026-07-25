# REWORK-2026-07-25 — design spec (user-approved direction)

User mandate, 2026-07-25 (overrides PRODUCT.md where they conflict; recorded
as a §0 addendum when this ships):

1. Parallels: the programme's own parallel selected by default, user-selectable
   per course ("some may have other commitments and want to customize").
2. Programme/kull/retning editing is unclear → a settings surface ("people
   have webpage patterns they are used to — a settings/my page").
   **Decided: modal over the planner.**
3. Remove /studier (both surfaces). No redirects — early dev.
4. The schedule must render multiple simultaneous items properly — people
   deliberately take colliding courses. **Decided: calendar-engine rebuild.**
5. Schedule and exam views need major rework.
   **Decided: side-by-side cluster grid; exam date list + gap lines.**
6. Navigation: persistent buttons, not layout-dependent ones.
7. Manual adds are semester-specific.
8. Add-course flow: search modal.
9. No versioning/compat apparatus — delete old code outright. Not on GitHub;
   breaking existing links/storage is fine.
10. Kull chips: only *relevant* cohorts (a programme can have 20+ historical
    kull), not all and not just the newest.
11. Homepage picker gone: homepage is a landing with a button to
    /planlegger/; the planner owns onboarding via good empty states.

Everything below serves those eleven points. The UX-STUDY.md P0/P1 findings
(S1–S15) are folded in where they touch the same code; study fixes that this
rework subsumes are marked.

---

## 1. State model (`src/lib/planner/store.ts`)

**One canonical hash grammar, no version tokens, no legacy parse.** Delete
the v1-compat branch, the `PLAN_HASH_VERSION` constant, and every "v2"
mention. New grammar:

```
#<semesterId>;<programme>;<courses>
semesterId: 26h | 27v
programme:  - | code[.cohort[.direction]]        (unchanged fields)
courses:    comma list of [-|+]code[.version][~group]*
```

- Each `~group` is a selected group key for that course (see §5) — repeatable,
  because a course can need both a lecture parallel and an øving group
  selected (`TDT4110~p2~ov5`); omitted = default selection. State field:
  `groups?: string[]`. Percent-encoding stays exactly as today (load-bearing
  for Ø/Å/Æ in direction codes) — the encoding helper survives, the version
  machinery does not.
- **Semester-scoped plans.** localStorage:
  - `np:profile` = `{ program: {code,name,cohort,direction?} }` — global,
    "who you are", shared by all semesters.
  - `np:plans` = `{ [semesterId]: { courses: PlanCourse[] } }` — per
    semester. Manual adds live only in their semester's entry. Switching
    semester swaps the whole course context; programme courses re-derive
    for the target semester as today, manual adds come from that semester's
    entry only (S-fix: user point 7).
  - `np:lastSemester` = last viewed semesterId (session restore).
- The hash remains the shareable truth for the *current* semester: on load,
  hash wins over localStorage; edits write both.
- `PlanCourse` gains `groups?: string[]`. `PlanState.program` is unchanged in
  shape but **committing a programme pick writes the store + hash
  immediately** — the current picker's failure to do this is UX-STUDY
  S1/S2/S3 (empty plan, `-` in hash, no confirmation) and dies with the
  picker itself (§3).

## 2. Studieinfo modal (new: `src/components/planner/studieinfo.ts`)

Native `<dialog>`, opened from the header chip (§4) and from planner empty
states. Contents, top to bottom:

- **Programme** typeahead (reuses the existing search-index typeahead code,
  extracted from the homepage before the homepage picker is deleted). Picked
  programme renders as a chip with ×; the input never silently clears
  (study S3).
- **Kull** chips — *relevant cohorts only* (user point 10): cohort K is
  offered iff its students are plausibly still enrolled in the planned
  semester: `year(S) - durationYears < K ≤ year(S)`, using the programme's
  duration from the catalog (`studyLevel`/duration already drives the
  typeahead's "5-årig" tags) and honoring `startTerm` for spring intakes.
  A relevant kull with no ingested plan is still shown, and selecting it
  says "Fant ingen studieplan for kull K — du kan legge til emner selv"
  (study S4: never silently omit).
- **Studieretning** select, shown only when the chosen programme+kull is
  direction-gated — this surfaces the already-built panel that today is
  reachable only by hand-editing the URL.
- **Semester** select with the existing "timeplan publiseres ~måned" notes.
- **Lagre / Avbryt.** Save commits profile + re-derives the plan live behind
  the dialog; Avbryt/Esc changes nothing. Focus-trapped, `aria-modal`,
  restores focus to the chip on close.

## 3. Homepage (`src/pages/index.astro`) — landing only

The picker, kull chips, direction panel, and `?q=` handling are **deleted**
(user point 11). What remains: kicker, headline, the illustrative
mini-schedule with the collision example, one primary CTA **"Åpne
planleggeren"** → `/planlegger/`, and the returning-user resume line
("Planen din: MTDT · 5 emner → gå til planleggeren") when a profile exists.
The 404 page's search form goes with the picker (it was its only consumer);
404 offers "Til forsiden" + "Åpne planleggeren", and the stray
`value="404"` bug (study S9) dies with the form.

**Planner empty states** (user: "with good empty states") — exactly four,
each naming its next action:

| State | Surface |
| --- | --- |
| No profile, no courses | Centered card: primary button "Velg studieprogram" (opens modal) + secondary "…eller legg til emner med emnekode" (opens add modal, §7) |
| Profile set, semester's timetable unpublished | Existing designed state (unchanged copy) |
| Profile set, courses exist, none run this term | "Ingen av emnene dine undervises i {semester}." + button to add/switch semester (study S6c) |
| Fetch failure | Own copy — "Fikk ikke hentet timeplanen. Prøv igjen." with a retry button; never the "publiseres i august" message (study S6b). Implementation: `showFallback` must distinguish `timetable === null` (failed) from `[]` (empty) — the `?? []` coalesce in plannerApp.ts is the bug. |

## 4. Persistent navigation (`src/layouts/Layout.astro`)

One header on every page, same elements always (user point 6): brand → `/`,
**Planlegger**, **Emner**, and the **studieinfo chip** showing
`MTDT · 2024 · Høst 2026` (or "Velg studieprogram") — chip opens the modal
(on non-planner pages it navigates to `/planlegger/?studieinfo` and opens
it there — a query param, read once and stripped, because the fragment
belongs to the plan-state grammar and must not be clobbered). On non-planner pages the chip row also shows
"N emner · X sp → ukeplanen", replacing the plan strip; the plan-strip
component and its suppression rules are deleted. Footer loses the /studier
links.

## 5. Week grid — calendar engine (`src/components/planner/grid.ts` rewrite)

**Layout algorithm** (pure, unit-tested, in `src/lib/planner/layout.ts`):
per day, build overlap clusters (connected components of the interval
graph); within a cluster assign columns greedily by start time (an entry
takes the lowest-indexed column whose last entry ended); cluster width is
split equally among its columns. More than 3 columns → the 3rd shows a
"+N" chip; clicking it opens the popover listing the hidden entries.
Blocks always render the full course code (two-line block: `TMA4412` /
`R2 · 10:15`); the truncation class of bugs (study S12, T9/T14) is gone by
construction. Per-course background tint applies in both themes; red
collision ink stays as an *edge + sentence* on genuinely colliding chosen
entries — overlap is a supported state, not breakage (user point 4).

**Parallels & groups** (user point 1): each course renders only its
*selected group set*. Defaults: lecture parallels → the programme's own
parallel via the existing `entriesForProgram` mapping; no programme mapping
→ parallel 1, and the block notes "1 av 3" as a badge. Øving/lab groups
(muted layer): default all-muted as today until a group is chosen, then
only that group renders. Selection is per course, stored as `group` in
state and `~group` in the hash. Group keys are slugs derived from the
entry's acronym/name (percent-encoded in the hash).

**Block popover** (new: `src/components/planner/popover.ts`, one `<dialog>`
reused for all blocks): full name, time, room(s), week range, **group
picker** (radio list: the parallels/groups this course offers this
semester, plus "vis alle"), and actions — dropp/fjern, "gå til emneside".
Anchored near the block on desktop, bottom-positioned on mobile. This is
the mobile disambiguation gap from study T9, now in-mandate by user
direction.

Mobile keeps the horizontally scrolled week (day agenda stays a roadmap
item); the scroll hint becomes a sentence: "Dra sidelengs for å se hele
uken." (study S15).

## 6. Exam view (`src/components/planner/examRibbon.ts` → `examList.ts`)

Delete the ribbon. Chronological list: `to 26. nov · TMA4412 · skriftlig`
per row; between consecutive rows a connector "5 dager mellomrom", with
"⚠ tett" when the gap is ≤ 2 days; "om X dager" only on the next upcoming
exam; summary line "N eksamener over M dager" on top. Dateless exams keep
the "dato ikke satt" bucket at the bottom; kont stays excluded (DR-3
unchanged). This retires the ambiguous "X dager til neste" (study S10).

## 7. Add-course modal (replaces the inline typeahead)

"Legg til emne" button in the course panel opens a search `<dialog>`:
search field, result rows (code, name, credits, and a clash-preview line),
"Legg til" per row, dialog stays open for multiple adds, Esc closes. The
clash preview uses the **same section-aware collision path as the grid**
(`entriesForProgram`-filtered) — `planClash.ts` on /emner/ and /emne/ is
rewired to the shared function, killing the false-positive preview (study
S7). The raw "fikk ikke hentet detaljer: Not found" row copy is replaced
with the friendly not-taught phrasing from /emne/ (study S13).

## 8. /studier deletion

Delete `src/pages/studier/index.astro`, `src/pages/studier/[code].astro`,
`src/components/site/studyPlan.ts`, their styles and tests. No redirects.
Surviving logic moves: kull relevance + plan fetch → modal (§2); period
courses + choice groups with verbatim prose (DR-5 stands) → a collapsible
"Fra studieplanen" panel inside the planner's course sidebar, which is also
where "Bruk som planen min" semantics land (implicit: saving
programme+kull in the modal IS the import). `/emne/[code]/` keeps its
course pages untouched except the shared clash rewire (§7).

## 9. Docs

- PRODUCT.md: §0 addendum listing the eleven mandate points and naming what
  they supersede (D11's nav minimalism; §7's frozen-grammar/compat rule —
  suspended until post-launch; the /studier sequencing in §4/I3; DR-1's
  scope is *narrowed*, not reopened: conflict detection stays lecture-only,
  but display-level group selection is now in).
- ROADMAP.md: this rework becomes the active phase; UX-STUDY.md §3 order is
  superseded by this spec's build order (the plan doc will sequence it).

## 10. Testing

- Unit (vitest): `layout.ts` cluster/column assignment (overlap pairs,
  3-way, 4+ with +N, touching-not-overlapping edges); hash round-trip for
  the new grammar incl. `~group` and Ø/Å direction codes; semester-scoped
  store (manual add isolated per semester, profile shared, hash-wins-over-
  storage); kull relevance rule (5-år vs 2-år, spring intake, missing
  plan); exam gap math (gaps, tett threshold, dateless bucket, "om X
  dager" only on first upcoming).
- e2e (Playwright, `.pw.ts`): modal onboarding (empty planner → modal →
  MTDT + older kull + retning → week renders, chip updates, hash
  round-trips through reload in a fresh context); overlap render (two
  simultaneous chosen courses side-by-side, both readable, red edge +
  sentence); group picker (switch parallel → grid updates → survives
  share); add modal (search, clash preview matches planner verdict, add);
  semester switch (manual add does not leak); navigation (header identical
  on all pages, /studier/* returns 404).
- Deleted with their features: `tests/site/studyPlan.test.ts`, ribbon
  tests, old hash-compat tests, homepage-picker e2e steps.

## 11. Explicit non-goals (unchanged from PRODUCT.md unless listed above)

No accounts; conflict *detection* stays lecture-only (DR-1); no compare
matrix; no day agenda this pass; no ICS; no fabricated scores; grade-stat
placement unchanged. Nothing in this rework adds decide-loop apparatus.
