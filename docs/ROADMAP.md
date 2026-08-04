# ROADMAP.md — what is built, and what is left

Sequencing only. `docs/PRODUCT.md` decides *what* and has the authoritative
per-feature status table (§9); this file says what to do next and why in that
order. Do not re-litigate what PRODUCT.md §10 already decided against.

**Where the build stands.** The mandate's core — programme + kull → your week,
trivially editable, shareable — works end to end against live data, with the
collision engine, exam list, credit line and provenance all correct. The
design direction is settled (`docs/DESIGN.md`), the week has two views, and
the registration deadline is on screen. Accounts and sync have landed, opt-in
and never a prerequisite, and so has sharing: `/user/<navn>` is a live
read-only mirror of a shared plan, the `#v2;…` hash is deleted, and a received
link is something you look at rather than something that overwrites your plan.
What has *not* been started is the rest of the growth loop — the return
trigger and any instrumentation at all — and the whole decide-loop.

---

## Shipped

Grouped by what it does, not by when it landed.

**The correctness floor.** Lecture-only conflict detection with DR-1's
asymmetry, plus the two measured classifier fixes that took zero-lecture
course-terms from 35 % to 20 % (bucket-as-title via a closed list; a *samling*
read as the teaching it is). Version threading through state, every API call
and the shared copy. Exam dates from the catalog, kont filtered by the client-side
ISO-date join against the scraped occasion. The exam window narrowed to the
planned semester. The null-aware credit total with off-semester exclusions and
a non-green overload. The two-year catalog union, so a course taught last year
still gets a page and says so.

**The honest join (DR-8), which was once inverted.** `TimetableOutcome` keeps
"came back empty", "we could not ask" and "not fetched yet" apart, so a failed
fetch can no longer render as "ingen kollisjoner". The provenance line is
composed from what actually happened *this render* and recomposed after the
fetches land. The verdict has three states, not two, and a pass names what it
passed on ("· N emner ikke sjekket"). Every failure carries a ready Norwegian
sentence; no upstream English reaches the UI. Memoisation is per part and
failures are never cached.

**The planner surface.** The studieinfo dialog, opened from the plan's own
name in the bar, is the only picker for programme, kull and retning; the
semester is the planner bar's own select. One editing surface per course
(`courseSettings.ts`); a read-only session popover on the bars; a catalog
search modal for adding. Display-level parallel and øving group selection,
narrowed per *session family* so a pick of one kind can never delete the
other's sessions. Three honest fallback states including a real retry path.
`/studier/` and `/studier/[code]/` deleted outright.

**Onboarding and the empty states.** A plan-less `/planlegger/` is a first-run
screen and nothing else, gated on the pre-paint probe's own `data-plan`
absence, and reversible: emptying the plan brings it back, while a term you
have not filled yet does not. The same picker hosts it under an
`"on-kull"` commit policy, so programme and kull are two presses and no Lagre.
Sections appear with their rows: Eksamener and the load track go absent at zero
active courses instead of printing a heading over an apology. Login and
register are two forms with one submit each and a link between them, and both
the first-run screen and the landing page offer login to a returning student on
a new browser. `/emne/[code]/` tells a cold arrival it has no plan yet rather
than reporting on one it does not have. Sitewide, no `—` and no `·` reach a
student, and no copy announces that the week is finished; both are gated by
`tests/copy.test.ts`.

**The calendar direction** (`docs/DESIGN.md`). Tokens remapped to a white
ground and a four-job colour scheme; type moved to the platform UI face and
every vendored font deleted; six course hues cleared of all three signal
colours and assigned from the plan's code *set*. Two views — Uke and Liste —
drawn by every surface that shows a week, with the third transposed geometry
deleted. One control
bar at the top of the page, the verdict as a run of chips, and the
registration deadline beside it. The week's own surface: 52 px hours, blocks
carrying course and room only, a tinted øving layer, an all-day row for
drop-in windows, ISO week dating with a mønsteruke outside the teaching
period, and a whole-days width law expressed in CSS.

**Sharing, as one mechanism.** A standing `public` flag on the account, turned
on in the profile panel or by pressing Del, makes `/user/<navn>` a live
read-only mirror: every sync push refreshes the readable copy, turning it off
clears it, and the page draws the owner's week through the planner's own
renderer. A recipient **views** it — nothing of theirs is written, which is why
"Behold min egen" and the whole three-action interstitial are gone. The link
carries a real unfurl (`kari deler en plan · 5 emner · 28,5 sp · Høst 2026`)
while `X-Robots-Tag: noindex` keeps it out of search. The `#v2;…` hash grammar
is deleted outright: the URL is no longer the plan.

**Accounts and sync.** An opt-in account — name plus a 6-digit PIN — carries
a student's plan between phone, PC and iPad; nothing nags until the topbar's
Profil is opened and asked for it. That single door — on every page, printing
the account name once there is a session — replaces what mandate 8 promised
and what used to be two nested ones on one page (PRODUCT §1). `localStorage`
stays the write target and the server mirrors it — no offline queue, no
polling — and the worker contract (routes, crypto, KV record) is
`docs/SPEC.md`'s. There is no per-device revocation; dropping a device is a
PIN change, which logs every other device out until it is given the new one.

**Course and catalog pages.** `/emne/[code]/` reordered around the fork CTA,
with the clash sentence, the shared week renderer, one exam block, the
season-split grade figure under PRODUCT §9's constraints, and all prose in one
disclosure. `/emner/` as a searchable mode with ranked matching shared with
the planner's add dialog and ~4 city facets. `/sitemap.xml`, without which a
crawler entering at `/` reaches three pages instead of 5 470.

**Infrastructure and gates.** Worker: percent-decoded codes, two code
grammars, a fixed 502 body, an egress token bucket, a negative-cache sentinel
with its own short TTL, sitewide security headers, and canonical-casing 301s.
CI: `ci.yml` on push/PR, `e2e.yml` for the browser suite plus a nightly
schedule, `release.yml` gated on e2e directly, `crawl.yml` nightly. The
browser suite replays recorded `/api/*` responses (a miss fails the run in
teardown) with live-upstream contract tests behind the nightly schedule, and
`cls.pw.ts` holds per-surface layout-stability budgets.

---

## Known-partial

Called out here so the next session doesn't re-derive them from a diff.

- **Pre-publish mode** (DR-2) is an *informed choice* — a semester chip for an
  unpublished term carries its own note — rather than the dedicated layout
  DR-2 describes, where the grid degrades to exam-clash and campus-spread.
- **Provenance** covers `/planlegger/`; `/emne/[code]/` has none.
- **Shared-plan handoff**: the artifact has no return trigger; see Phase 3.
  The merge action is *killed*, not pending — a link that writes nothing to
  the recipient needs no merge (PRODUCT §4 flow 5, D1).
- **Code-first entry** exists inside the planner, not on the landing page.
- **Filters**: campus ships; language and assessment do not.

---

## Phase 3 — the growth loop (not started)

The shared plan is PRODUCT's north-star metric and the only path for an
arrival that didn't google a course code. Publishing landed 2026-08-04, so a
sent plan is now a page worth opening; what is left is what brings someone
back to it, and knowing whether any of it works.

1. ~~A real unfurl title~~ — **done** with publishing: the worker rewrites the
   `og:` tags per name and the page stays out of search at the same time.
2. ~~The merge action~~ — **killed**, not deferred. It existed because an
   incoming link overwrote the recipient's plan; a link that writes nothing
   needs no merge (PRODUCT §4 flow 5, D1).
3. **The return trigger in the shared artifact**, fired when
   `timetablePublished` or the exam window is about to flip. This is the only
   thing that pulls a handed-off user back, and `/user/<navn>` is now a real
   surface to put it on.
4. **Metrics wiring.** Nothing is instrumented today. Pick the mechanism —
   edge-worker aggregate counters is the leading candidate — and cover shares
   created and opened, the fork funnel, deadline-window return rate, and
   preview engagements. Without this, Phase 4's "behind evidence anyone
   reaches it" gate cannot be evaluated at all.

## Phase 4 — the decide-loop (not started)

Everything here depends on the shortlist tier landing in the stored plan
first. It is additive to `courses[]` — in storage and in the shared copy —
and needs no version token anywhere (PRODUCT §6).

1. **Shortlist tier**: committed vs. considering, in localStorage and in the
   shared copy, with ghost blocks on the week, promote/demote, and a header reading
   "X av 30 sp · +Y sp under vurdering".
2. **Inline decision facts** in choice-group rows: clash-against-committed,
   assessment form, and the grade shape. The season-split figure already
   exists on `/emne/[code]/`; this is the *same shape in a choice-group row*,
   not a first build of it. What stays killed: sortable columns, cross-course
   leaderboards, hue-tinted bars, any derived difficulty score.
3. **The swap delta sentence** on promotion. PRODUCT calls this "the product";
   it is the last item because there is no promote flow to attach it to until
   1 and 2 land.
4. **Commit summary**: a copyable committed-code list plus "bekreft i
   Studentweb".

**Open before this starts:** where the flow enters from, now that
`/studier/[code]/` is gone and the choice-group prose lives in the planner's
rail.

## Phase 5 — remaining SHOULD tier

- Provenance line on `/emne/[code]/`.
- Language and assessment filters on `/emner/`.
- Mobile day-agenda restructure. The Liste view and the week's whole-days
  width law cover much of what this was for; re-scope it before building.
- Day-load strip and free-day sentence (persona C).
- Screen-reader conflict summary; recursive retning render.
- DR-2's dedicated pre-publish layout.

## Phase 6 — COULD, evidence-gated

`?mot=` as a two-course *add* surface (never a matrix), par/odde single-cell
rendering, English course names. Do not build ahead of a funnel signal — which
means not before Phase 3's metrics.

---

## Known-minor, deliberately deferred

- **`astro dev` shadows `/data/programs.json`.** Vite serves the project-root
  crawler record (~332 kB) in place of `src/pages/data/programs.json.ts`
  (~28 kB of tuples), so the programme typeahead throws
  `programOptions.filter is not a function` and finds nothing under
  `npm run dev`. The built site is correct, so `mise run e2e` is green and only
  hand-iteration is affected — but the first-run screen IS that typeahead now,
  so fix this before the next person iterates there.

- **The typeahead's meta line prints `trondheim` lowercase.**

- **`removeProgram()` prunes only the active semester's `np:plans` entry**, so
  a programme course can be orphaned in a *different* semester's stored plan.
  Harmless today because the orphan is still a real course the student can
  drop; it becomes wrong the moment programme-derived state means anything
  beyond "prefilled".
