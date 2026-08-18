# Timetable-only reduction — design

**Date:** 2026-08-18
**Status:** approved, in implementation

The owner's instruction, verbatim in substance: *reduce the page
substantially, remove the course pages — I don't want to compete with NTNU.
This should be just a timetable getter. Link directly to the NTNU page and
karakterweb for emnepage and grade stats. Remove all login and sharing.
Nobody really shares schedules. Keep it localStorage only.*

This spec is the demolition order. `docs/PRODUCT.md` is rewritten from it and
remains the law afterwards; this file is the record of what was cut and why,
so the next session does not re-derive it from a diff or try to restore a
feature by reading an old paragraph.

---

## 1. What the product becomes

Two pages. No accounts, no sync, no sharing, no course pages, no catalog
browsing surface. `localStorage` is the only store there is.

Every question about a *course* — what it covers, who teaches it, how the
grades fell — leaves the site. `ntnu.no` owns the emnepage. `karakterweb.no`
owns the grade statistics. We stop building thinner copies of both.

What is left is the one thing neither of them does: **take a study programme
and a kull, and draw the week.**

```
/                → next session, the rest of today, one button
/planlegger/     → programme + kull picker → the week → exam dates → course list
/sitemap.xml     → those two URLs
/404
```

## 2. Decisions taken in this session

| # | Question | Decision |
| --- | --- | --- |
| R1 | Which routes survive | `/` and `/planlegger/`, plus `/404` and `/sitemap.xml`. `/emne/[code]/`, `/emner/` and `/user/<navn>` are deleted outright. |
| R2 | Does `/` keep a pitch | No. "People know what a schedule page is." The headline, the subcopy and the login line all go. |
| R3 | What `/` holds instead | The next-session card, then the rest of today's sessions, then one button into the planner. A cold visitor gets the site name and the button. |
| R4 | Where the out-links live | On the course row in the Emner list **and** at the foot of the block popover. Not buried in the per-course settings surface. |
| R5 | How much verdict apparatus survives | The week and the exam list. Credits, the load track, the verdict chips, the registration deadline and the provenance line are all cut. |

## 3. Deletions

### Accounts, sync, sharing

`src/components/AccountButton.astro`, `src/components/account.ts`,
`src/components/planner/profilePanel.ts`,
`src/components/planner/publicPlan.ts`, `src/lib/planner/publicPlan.ts`,
`src/lib/planner/syncClient.ts`, `src/lib/planner/syncCrypto.ts`,
`src/pages/user/index.astro`, `worker/src/sync.ts`, `worker/src/unfurl.ts`.

With them: the `SYNC` KV binding in `wrangler.jsonc`, `release.yml`'s
`local-sync-dev` precheck (there is no longer a placeholder that could ship),
the Del button, both "har du plan fra før" login lines, the `X-Robots-Tag`
handling and the `og:` rewrite, and the tests — `syncClient`, `syncCrypto`,
`profilePanel`, `publicPlan`, `worker/sync`, `worker/unfurl`,
`e2e/sync.pw.ts`, `e2e/publish.pw.ts`.

### Course pages and the catalog surface

`src/pages/emne/[code].astro`, `src/pages/emner/index.astro`,
`src/components/site/courseDetails.ts`,
`src/components/site/courseTimetable.ts`,
`src/components/site/gradeChart.ts`, `src/components/site/planClash.ts`,
`src/lib/planner/grades.ts`, and the worker's `/api/course/:code/grades`
route with `GRADES_CACHE_TTL_MS`.

`catalogSearch.ts` is **not** deleted — the planner's add dialog imports
`searchCatalog` from it. It moves to `src/lib/planner/searchCatalog.ts` as
pure ranked matching, shedding the city facets and the row rendering that
only `/emner/` used. `courseAction.ts` stays; it loses its second caller but
keeps the rule it exists for (a programme course is dropped, never deleted).

### Verdict apparatus

The credit total and the 30 sp load track (`renderLoadTrack` and DR-6's
null-aware arithmetic), the verdict chips, `src/lib/planner/deadline.ts`,
the provenance line, `src/lib/planner/conflicts.ts` and the conflict margin
notes, and the exam list's lesedager gap lines.

`src/lib/planner/layout.ts` **stays.** Its side-by-side clustering is
geometry, not verdict: two sessions at the same hour still have to be drawn
next to each other rather than stacked on top of each other. Cutting the
collision *verdict* does not license drawing overlapping blocks wrong.

### Chrome

The topbar loses the account door and the Emner nav item, leaving a brand
link and the theme toggle. `src/lib/menuPanel.ts` and the 480 px fold go with
them — one bar with two items has nothing to fold.

## 4. What survives, changed

**`/`** — the pitch block goes; `now.ts`'s card stays and its next-list grows
into the remainder of today. One `.np-btn--primary` into the planner.

**`/planlegger/`** — the first-run screen and the studieinfo dialog are
untouched. They are the mandate: programme + kull → the week, two presses, no
Lagre. The week keeps both views, the week scope picker and the øving/lab
layer box. The exam list keeps its dates, the "dato ikke satt" row and the
client-side kont date-join (DR-3).

**The out-links**, on the course row and in the block popover:

- `https://www.ntnu.no/studier/emner/{KODE}/{år}`, built from `ntnu-api`'s
  exported `COURSE_PAGE_URL_NB`. Upstream NTNU URLs live in the package, not
  here — the layering rule is unchanged by this reduction.
- `https://karakterweb.no/ntnu/{kode}` (lowercase). Karakterweb is not NTNU,
  so this one is a plain constant in this repo.

**The worker** keeps `/api/health`, `/api/course/:code`,
`/api/course/:code/timetable`, `/api/program/:code/plan`, the tiered cache,
the egress token bucket, the percent-decode in `parseCode`, and the sitewide
security headers. `run_worker_first` stays, because the headers depend on it.
The canonical-casing 301s for `/emne/` go with the route they canonicalised.

**The crawler** is untouched. Catalog, programmes, semesters and the search
index all still feed the programme typeahead and the add dialog.

## 5. One rule kept against the cut

Provenance is cut as a *surface*. DR-8's underlying rule is not decoration and
is **kept**: a timetable fetch that failed must never draw as an empty week.

`TimetableOutcome`'s three states stay in `data.ts` — "came back empty", "we
could not ask", "not fetched yet" — and a failure renders as one line with a
retry above the grid, not as a composed provenance sentence. Without it, NTNU
being down is pixel-identical to having no classes that week, which is the
exact failure DR-8 was written for.

## 6. Sequence

1. Commit the in-flight WIP so the demolition is a clean diff. *(done —
   `362f92a`)*
2. Rewrite `docs/PRODUCT.md`. It is law in this repo, so the doc leads.
3. Delete accounts, sync and sharing.
4. Delete the course pages and the catalog surface; rehome `searchCatalog`;
   add the two out-links.
5. Cut the verdict apparatus.
6. Reshape the landing, the topbar and the sitemap.
7. Trim the worker.
8. Sweep `CLAUDE.md`, `SPEC.md`, `DESIGN.md`, `ROADMAP.md`.
9. `mise run check` and `mise run e2e` green.

Expected scale: roughly 6 000–7 000 lines out of ~13 000 in `src/`, plus the
worker and the tests that covered the deleted surfaces.

## 7. Consequences worth stating

- **Mandate 10 applies.** Nothing is published, so old links and stored state
  may break. No redirects for `/emne/`, `/emner/` or `/user/`, no compat
  layer for anything the account used to hold. A student with a synced plan
  and no local copy loses it; there is no migration and none may be written.
- **The growth loop is gone**, deliberately. Sharing was PRODUCT's north-star
  metric; the owner's judgement is that nobody shares schedules. The metrics
  section that rested on share creations goes with it, and Phase 3 is deleted
  rather than deferred.
- **The decide-loop is gone.** Phase 4's shortlist tier, inline decision
  facts and swap-delta sentence presupposed grade figures and clash verdicts
  on our own surfaces. Both are cut, so the phase has nothing to attach to.
- **`tests/copy.test.ts` still gates.** No `—` and no `·` in a string a
  student reads, and no copy announcing that the week is finished. Deleting
  surfaces does not loosen it.
