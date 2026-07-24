# f5 — IA + Wireframes (master reference)

Consolidated information architecture and per-page wireframe pack for Semesterplan, derived strictly from `PRODUCT-v2.md`. This is the master layout reference the other flow docs (f1–f4, f6…) hang off: they own the *behaviour* inside a surface; this doc owns *what surfaces exist, where they live, and how the plan-state and navigation frame every page.* Where PRODUCT-v2 and PLANNER.md disagree, PRODUCT-v2 wins; the Ruteark render detail from PLANNER.md §2 and DESIGN.md is assumed and only referenced, never re-specified.

Wireframes are ASCII, structural not pixel-accurate. `[·]` = a hue `.np-dot`; `[ btn ]` = `.np-btn`; `‹mono›` marks strings that render in Spline Sans Mono per **Data-Is-Mono**; red-ink notes are written `!! …` (they render as `.np-note-clash`, never a triangle/toast). Everything else is Schibsted Grotesk sentence-case bokmål.

---

## 1. Sitemap & URL scheme (final)

Four real pages, one nav pill. Search is a *mode*, not a destination (PRODUCT-v2 §4, D11). The plan is never a nav item — it lives in the strip (§4 here) and *is* `/planlegger/`.

```
/                         Dispatcher + proof (verb-first homepage, §5-v2)
/planlegger/              THE APP — plan basket, weekly grid, exam ribbon,
                          decide-loop, credit total, temporal banner, share
/emner/                   Find courses (deep search + SEO landing). A MODE,
                          reachable from planner add-field + footer/inline.
                          Program search merged here as ?type=studier.
/emne/[code]/             THE FORK POINT — plan-aware single course; primary
                          CTA "legg til og se", prose below the fold.
/studier/[code]/          Study plan as template; host of the elective
                          decide-loop. (No standalone /studier/ index — KILLED.)
/404                      Not-found; routes back to / and the plan strip.
```

**Nav (global, `Layout.astro`):** exactly one pill — **Planlegger**. `/emner/` is *demoted from the nav* to inline + footer. `/studier/` index is killed (redundant second search). Logo → `/`.

**URL = state = growth object (§4/§7-v2).** State rides the hash on `/planlegger/`; every other page reads/writes the same store and shares the same strip. Frozen versioned hash grammar:

```
#v2 ; <semesterId> ; <committed code.version,…> ; <shortlist code.version,…>
     e.g.  #v2;26h;TDT4100.1,TMA4100.1;IT2805.1
     legacy read-only:  #26h;TDT4100,TMA4100   (parsed → all committed, v"1")
```

**Page-local view params** (never carry plan state):

| Param | Pages | Meaning |
| --- | --- | --- |
| `?q=` | `/emner/` | search query |
| `?sted=` `?språk=` | `/emner/` | campus (city) / language filter |
| `?type=studier` | `/emner/` | program-search mode (merged, replaces killed index) |
| `?mot=<code>` | `/emne/[code]/` | lightweight two-course *add* view (COULD; not a matrix) |
| `?kull=<year>` | `/studier/[code]/` | cohort selector for the study plan |

Rule: **plan lives in the hash; view lives in the query.** A shared link is `/planlegger/#v2;…` — nothing else needs to travel.

---

## 2. The three page frames

Every page is one of three frames. This keeps the IA legible and the strip logic trivial.

- **Frame A — Dispatcher** (`/`): full-bleed, no strip duplication (the resume line *is* the strip here), single CTA.
- **Frame B — App** (`/planlegger/`): wide column, stacked editorial sections, **strip suppressed** (the page is the plan). Temporal banner lives here.
- **Frame C — Satellite** (`/emner/`, `/emne/[code]/`, `/studier/[code]/`): wide column, **plan strip present** at top as the continuation affordance back to the app.

---

## 3. Global chrome (all pages)

```
DESKTOP  ─ top bar, ≤72rem (--maxw), centered ───────────────────────────
┌──────────────────────────────────────────────────────────────────────┐
│  ‹SEMESTERPLAN›            Planlegger              [◐ tema]            │
│   ↑ logo → /              ↑ the one nav pill        ↑ np-icon-btn      │
└──────────────────────────────────────────────────────────────────────┘
   (aria-current inks "Planlegger" when on /planlegger/)

MOBILE ─ same, pill stays inline (only one → no burger needed) ──────────
┌────────────────────────────────┐
│ ‹SEMESTERPLAN›  Planlegger  ◐  │
└────────────────────────────────┘
```

One pill means **no hamburger, ever** — a deliberate consequence of the one-nav-pill decision. `/emner/` reaches the nav only through the footer:

```
FOOTER (all pages)
────────────────────────────────────────────────────────────────────────
  Semesterplan · uoffisiell · ingen innlogging
  Finn emner (→/emner/)   ·   Finn studieprogram (→/emner/?type=studier)
  ‹Data sist oppdatert 22. jul 2026›   ·   Om dataene   ·   NTNU-data
────────────────────────────────────────────────────────────────────────
```

The footer is where provenance lives globally (DR-8 site-level: last crawl); per-verdict provenance lines live *inline* on the composed surfaces.

---

## 4. Persistent plan-state surface — the plan strip

The connective tissue that turns "add from anywhere" into "aware from anywhere" (PRODUCT-v2 §4, c3-3). Built **once** in `Layout.astro`, directly under the top bar, on Frame-C pages only.

**Visibility rule (frozen):**

| Page | Plan strip | Because |
| --- | --- | --- |
| `/planlegger/` | **suppressed** | the page *is* the plan |
| `/` | **suppressed** | replaced by the hero resume line |
| `/emner/`, `/emne/[code]/`, `/studier/[code]/` | **shown when plan non-empty** | continuation back to the app |
| any page, empty plan | **hidden** | no empty strip; empty state lives on the page body |

**Non-empty strip (desktop):**

```
┌──────────────────────────────────────────────────────────────────────┐
│ ‹HØST 2026›  [·]‹TDT4100› [·]‹TMA4100› [·]‹IT2805›  +2 til vurdering  │
│              ‹22,5 av 30 sp›              Se på ukeplanen →           │
└──────────────────────────────────────────────────────────────────────┘
```

- Committed courses render as solid `.np-tag`s; shortlist ("til vurdering") courses collapse into the `+N til vurdering` counter so the strip never sprawls — the tiering (`tier: committed|shortlist`) is visible but compact.
- `‹22,5 av 30 sp›` is the live, null-aware credit total (DR-6); turns accent-green at 30 (Green-Means-Fits).
- **"Se på ukeplanen →"** is the cross-page continuation affordance (c3-3) → `/planlegger/#…`. It is the *only* CTA in the strip; the strip is a status bar, not a control panel. Editing happens in the planner.

**Mobile strip** — collapses to one tap-line, expands on tap:

```
┌────────────────────────────────┐
│ ‹5 emner · 22,5 sp›   ukeplan → │   ← 44px row, whole row taps to /planlegger/
└────────────────────────────────┘
```

The strip **never** carries the temporal banner (that is app-only) and **never** shows conflict marks (red is earned on the grid, not asserted in a status bar).

---

## 5. Navigation & empty-state model

**Navigation model.** There is exactly one hub (`/planlegger/`) and one funnel into it. Movement is:

```
        google a code ─────────────┐
        /  ──────────► /planlegger/ │
                ▲            ▲       ▼
   /studier/[code]/     /emner/   /emne/[code]/
        │  (decide-loop)  │ (search)  │ (fork)
        └────────────► plan store ◄───┘   (all writes land in one store;
                          │                 the strip reflects it everywhere)
        shared link  ─► /planlegger/#v2;…  (merge / replace / keep)
```

No page is a dead end: every satellite has a plan strip pointing home, and `/emne/[code]/` and `/studier/[code]/` both write to the store so arriving cold and adding one course immediately lights the strip.

**Empty-state model.** Empty states are invitations to act (DESIGN.md §7), never apologies, never red.

| Surface | Empty copy + affordance |
| --- | --- |
| `/planlegger/` no courses | "Ingen emner i planen ennå." + add field, "Søk i emnekatalogen" (→/emner/), "Start fra et studieprogram" (inline program search → /studier/[code]/). |
| Plan strip | not rendered at all when empty (see §4). |
| `/emner/` no results | "Ingen emner matcher ‹q›. Prøv en emnekode eller et emnenavn." — ink, not red. |
| `/emne/[code]/` empty-plan visitor | one-time inline planner intro under the CTA: "Ny her? Legg til emnet, så ser du om det kolliderer i ukeplanen." |
| `/studier/[code]/` no kull chosen | default to the most recently published kull; kull chips above the plan. |
| Shared link, no local plan | interstitial with **Bruk denne / Behold min egen** (no "Slå sammen" when local plan is empty — nothing to merge). |
| Pre-publish semester (no grid) | **not empty** — DR-2 primary mode fills it (exam ribbon + credits + grades + assessment); grid area shows the pre-publish panel, never a blank sheet. |

**Loading & error (all async blocks):** one quiet mono line — `‹henter timeplan …›` / `!! Fikk ikke hentet timeplanen. Prøv igjen om litt.` Errors are ink, state what failed + next step (DESIGN.md §7).

---

## 6. `/` — Homepage (Frame A: dispatcher + proof)

Verb-first, growth-proof above the fold (PRODUCT-v2 §5). Replaces the passive triptych.

```
DESKTOP ──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────────────┐
│  ‹SEMESTERPLAN›                Planlegger                  [◐]        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│   Kan du ta disse emnene sammen?                    (display grotesk)│
│   Sjekk kollisjoner og eksamensklynger — og se hva du bytter —      │
│   før oppmeldingen.                                          (body)  │
│                                                                      │
│   [ Lag en plan → ]           ‹Planen din: 4 emner · 22,5 sp›  →     │
│    ↑ single CTA →/planlegger/  ↑ mono resume line, only if non-empty │
│                                                                      │
│   ┌ .np-frame.np-ruled  (above-the-fold PROOF, not a triptych) ──┐  │
│   │  man        tir        ons                                   │  │
│   │  ┌────────┐                                                  │  │
│   │  │[·]‹TDT4100›  ┌────────┐                                   │  │
│   │  │ 10:15  │····│[·]‹TMA4100›   ← red hatch overlay on overlap│  │
│   │  └────────┘    │ 10:15  │                                   │  │
│   │                └────────┘                                   │  │
│   │  !! TDT4100 kolliderer med TMA4100 · man 10:15 · uke 35–41   │  │
│   └──────────────────────────────────────────────────────────────┘  │
│                                                                      │
│   ‹Del planen med en lenke — ingen innlogging.›   (names the share) │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘

MOBILE ──────────────────────────────
┌────────────────────────────────┐
│ ‹SEMESTERPLAN› Planlegger  ◐   │
├────────────────────────────────┤
│ Kan du ta disse                │
│ emnene sammen?                 │
│ Sjekk kollisjoner og           │
│ eksamensklynger — før          │
│ oppmeldingen.                  │
│                                │
│ [ Lag en plan → ]              │
│ ‹Planen din: 4 emner·22,5 sp›→ │
│                                │
│ ┌ np-ruled proof ───────────┐ │
│ │ [·]‹TDT4100› 10:15         │ │
│ │ [·]‹TMA4100› 10:15  ▓ red  │ │
│ │ !! kolliderer man 10:15    │ │
│ └────────────────────────────┘ │
│ ‹Del med en lenke — ingen      │
│  innlogging.›                  │
└────────────────────────────────┘
```

Design notes: the proof is a *static frozen fragment* (not the live plan) so the collision reads instantly, cold, first paint. One CTA only. The share is named as a visible action (the growth loop). No strip here — the resume line is the strip's stand-in.

---

## 7. `/planlegger/` — The app (Frame B)

The hub. Stacked editorial sections, no tabs. Strip suppressed; temporal banner is the top element. This wireframe shows the **published-grid** state; §7.1 shows the pre-publish primary mode (DR-2), §7.2 the empty state.

```
DESKTOP ──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────────────┐
│  ‹SEMESTERPLAN›                Planlegger                  [◐]        │
├──────────────────────────────────────────────────────────────────────┤
│ ‹Oppmelding for Høst 2026 stenger ~15. sep · 24 dager igjen.›        │  ← temporal banner (termContext, DR-9)
├──────────────────────────────────────────────────────────────────────┤
│ ‹PLANLEGGER›                          [‹HØST 2026›][‹VÅR 2027›] tgl   │
│ Semesterplanen din                              ‹22,5 av 30 sp›       │  ← live, null-aware
│                                          ‹(+2 emner uten oppgitt sp)› │
│                                                                      │
│ ┌ basket panel (.np-panel) ────────────────────────────────────────┐ │
│ │ [·]‹TDT4100›× [·]‹TMA4100›× [·]‹IT2805›×   [ + legg til emne ▾ ]  │ │  ← add field = inline search mode
│ │ til vurdering: [·]‹TDT4258›⊘ [·]‹TFE4146›⊘                        │ │  ← shortlist tier, muted
│ │ ‹Fra MTDT, kull 2024 · 5. semester›              (if program ctx) │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ‹UKEPLAN›  ‹uke 34–47›                                               │
│ ┌ .np-frame.np-ruled ──────────────────────────────────────────────┐ │
│ │        man       tir       ons       tor       fre               │ │
│ │ 08 ─────────────────────────────────────────────────────────────  │ │
│ │ 10  [·]TDT4100▓ [·]TMA4100                                        │ │  ← ▓ = red hatch; code wavy-underline
│ │ 12  ‹uke 35–41› ‹uke 34–47›                                       │ │
│ │ 14           [·]IT2805  (øving — muted, non-clashing label)       │ │  ← DR-1 øving shown, never clashes
│ │ 16 ─────────────────────────────────────────────────────────────  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ !! TDT4100 kolliderer med TMA4100 · man 10:15–12:00 · uke 35–41     │  ← margin note, links to block
│ ‹Timeplan sist hentet 22. jul.›                        (provenance)  │  ← DR-8
│                                                                      │
│ ‹EKSAMENER›  ‹25. nov – 18. des›                                    │
│ ┌ .np-frame.np-ruled ribbon ───────────────────────────────────────┐ │
│ │ nov │────[·]──────[·][·]────────────[·]──────│ des               │ │  ← catalog ExamDate (DR-3)
│ │             4.        11.12.               18.                    │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ !! TMA4100 og IT2805 samme dag · 11. des                            │
│ ‹25. nov — [·]TDT4100 — skriftlig — 2 dager til neste›              │
│ ‹11. des — [·]IT2805 — hjemmeeksamen — dato ikke satt for sluttlev.›│  ← DR-3 dateless bucket
│                                                                      │
│ ‹EMNER›                                                             │
│ ‹[·]TDT4100  Objektorientert prog.· 7,5 sp· Gløshaugen· skriftlig›  │
│    ‹Karakter: snittet ligger lavt, tung stryk› (i beslutningscellen)│  ← grade shape only in-decision (D12)
│    [ Fjern ]                                                        │
│ ‹[·]TMA4100  Matematikk 1 · 7,5 sp · Gløshaugen · skriftlig›  [Fjern]│
│                                                                      │
│ ┌ commit summary ──────────────────────────────────────────────────┐ │
│ │ Klar for Studentweb: ‹TDT4100, TMA4100, IT2805›   [ Kopier ]     │ │
│ │ [ Del planen (lenke) ]        [ Bekreft i Studentweb ↗ ]         │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘

MOBILE ─ day-agenda, not a 5-col grid (persona C forces this) ─────────
┌────────────────────────────────┐
│ ‹SEMESTERPLAN› Planlegger  ◐   │
├────────────────────────────────┤
│ ‹Oppmelding ~15. sep·24 d igj› │  ← temporal banner
├────────────────────────────────┤
│ ‹PLANLEGGER›   [‹H26›][‹V27›]  │
│ Semesterplanen din             │
│ ‹22,5 av 30 sp›                │
│ [·]‹TDT4100›× [·]‹TMA4100›×    │
│ til vurd: [·]‹TDT4258›⊘        │
│ [ + legg til emne ]            │
│                                │
│ ‹UKEPLAN›  [ man ‹◂ ▸› fre ]   │  ← day tabs, one day column at a time
│ ┌ np-ruled (mandag) ────────┐  │
│ │ 10 [·]TDT4100 ▓            │  │
│ │ 10 [·]TMA4100 ▓           │  │
│ │ 14 [·]IT2805 (øving)      │  │
│ └────────────────────────────┘ │
│ !! TDT4100 kolliderer med      │
│    TMA4100 · man 10:15         │
│ ‹Fri: tir, fre›  (day-load, SHOULD)
│ ‹Timeplan hentet 22. jul›      │
│                                │
│ ‹EKSAMENER› ‹25 nov–18 des›    │
│ ‹25.nov [·]TDT4100 skriftlig›  │
│ !! IT2805 & TMA4100 samme dag  │
│                                │
│ ‹EMNER› (list, 44px rows)      │
│ [·]‹TDT4100› 7,5 sp   [Fjern]  │
│                                │
│ [ Kopier koder ]               │
│ [ Del (lenke) ][ Studentweb ↗ ]│
└────────────────────────────────┘
```

Ordering is fixed: **banner → basket → ukeplan → eksamener → emner → commit summary.** Whole-semester conflict notes are always shown regardless of the day/week in view (c3-9); there is no week-scrubber.

### 7.1 `/planlegger/` — pre-publish primary mode (DR-2)

When `timetablePublished` is false for the chosen semester — the *normal* state during the elective window — the grid section is **replaced**, not blanked:

```
┌──────────────────────────────────────────────────────────────────────┐
│ ‹UKEPLAN›  ‹timeplan ikke publisert ennå›                           │
│ ┌ pre-publish panel (.np-panel, no ruling) ────────────────────────┐ │
│ │ Timeplanen for Høst 2026 er ikke publisert.                      │ │
│ │ Vi sjekker fortsatt: eksamenskollisjoner, campus-spredning,      │ │
│ │ studiepoeng, karakterhistorikk og vurderingsform.                │ │
│ │ ‹Timeplan publiseres ~12. aug — kom tilbake da.›                 │ │  ← return trigger (c1-7)
│ │ [ Vis fjorårets timeplan (ikke autoritativ) ]        (optional)  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│ !! TDT4100 og IT2805 har eksamen samme dag · 11. des                │  ← exam-clash still works
│ !! Begge på Gløshaugen og Kalvskinnet samme uke — reisetid          │  ← campus-spread degrade
└──────────────────────────────────────────────────────────────────────┘
```

Exam ribbon, credit total, EMNER list and commit summary all render exactly as in the published state — they carry the mode. The clash engine degrades to **exam-clash + campus-spread**, never to nothing.

### 7.2 `/planlegger/` — empty state

```
┌──────────────────────────────────────────────────────────────────────┐
│ ‹PLANLEGGER›                          [‹HØST 2026›][‹VÅR 2027›]       │
│ Semesterplanen din                                      ‹0 av 30 sp›  │
│                                                                      │
│ Ingen emner i planen ennå.                                           │
│ [ + legg til emne ]                                                  │
│ Søk i emnekatalogen (→/emner/)                                       │
│ Start fra et studieprogram:  [ søk program … ] (→/studier/[code]/)   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. `/emner/` — Find courses (Frame C: satellite, a mode)

Real page for deep search + SEO landing, demoted from nav. Program search merges here via `?type=studier`. Plan strip present at top.

```
DESKTOP ──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────────────┐
│  ‹SEMESTERPLAN›                Planlegger                  [◐]        │
├──────────────────────────────────────────────────────────────────────┤
│ [ plan strip: ‹HØST 2026› [·]‹TDT4100›[·]‹TMA4100›  ‹15 sp›  ukeplan→]│  ← §4, if non-empty
├──────────────────────────────────────────────────────────────────────┤
│ ‹EMNER›   [ Emner | Studieprogram ]  ← ?type toggle                  │
│ [ 🔍 søk emnekode eller navn …               ]  ‹4767 emner›         │
│ Filtre:  [‹sted: alle›▾] [‹språk: alle›▾] [‹vurdering: alle›▾]       │
│                                                                      │
│ ┌ result row ──────────────────────────────────────────────────────┐ │
│ │ [·]‹TDT4160› Datamaskiner og digitalteknikk                      │ │
│ │ ‹7,5 sp · Gløshaugen · høst · skriftlig›            [ + ]         │ │  ← quick-add np-icon-btn
│ │ !! ville kollidert med ‹TMA4100› · man 10:15   (plan-aware preview)│ │  ← the VERB, before add (DR-1)
│ └──────────────────────────────────────────────────────────────────┘ │
│ ┌ result row (already in plan) ────────────────────────────────────┐ │
│ │ [·]‹TDT4100› Objektorientert programmering   ‹7,5 sp›   [ ✓ ]    │ │  ← flips to check
│ └──────────────────────────────────────────────────────────────────┘ │
│ … (virtualised list)                                                 │
└──────────────────────────────────────────────────────────────────────┘

MOBILE ──────────────────────────
┌────────────────────────────────┐
│ ‹SEMESTERPLAN› Planlegger  ◐   │
├────────────────────────────────┤
│ ‹5 emner·22,5 sp›   ukeplan →  │  ← strip
├────────────────────────────────┤
│ [ Emner | Studieprogram ]      │
│ [ 🔍 søk …            ]        │
│ [ filtre ▾ ]                   │
│                                │
│ [·]‹TDT4160› Datamaskiner…     │
│ ‹7,5 sp·Gløshaugen·høst›  [+]  │
│ !! ville kollidert m/ TMA4100  │
│                                │
│ [·]‹TDT4100› Objektorient. [✓] │
└────────────────────────────────┘
```

`?type=studier` swaps the result rows to program rows (`[·] code · navn · fakultet · [ Åpne studieplan → ]` → `/studier/[code]/`). Same search box, same filters shell; this absorbs the killed `/studier/` index.

---

## 9. `/emne/[code]/` — The fork point (Frame C: satellite)

Reframed from encyclopedia to fork (PRODUCT-v2 §3.4, D11/D12). Primary CTA and plan-context above the fold; grade shape only in the decision context; prose demoted below.

```
DESKTOP ──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────────────┐
│  ‹SEMESTERPLAN›                Planlegger                  [◐]        │
├──────────────────────────────────────────────────────────────────────┤
│ [ plan strip (if non-empty) … ukeplan → ]                            │
├──────────────────────────────────────────────────────────────────────┤
│ ‹TDT4160›                                                            │
│ Datamaskiner og digitalteknikk              (title, grotesk)         │
│ ‹7,5 sp · bachelor · høst · norsk · Gløshaugen›                      │
│                                                                      │
│ ┌ FORK BLOCK (above the fold) ─────────────────────────────────────┐ │
│ │ Vil dette kollidere for deg?                                     │ │
│ │ [ Legg til og se → ]     (primary np-btn → writes store)         │ │
│ │ ‹Passer i planen din for Høst 2026 — ingen kollisjon.›           │ │  ← plan-context line (SHOULD)
│ │   …or…  !! Ville kollidert med ‹TMA4100› · man 10:15–12:00       │ │
│ │ ‹Timeplan sist hentet 22. jul · eksamensdato ikke publisert.›    │ │  ← provenance (DR-8)
│ │ (empty-plan visitor: "Ny her? Legg til, så ser du kollisjoner.") │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ‹TIMEPLAN›   (a grid, not a flat list)                              │
│ ┌ .np-frame.np-ruled mini-grid — this course's blocks ─────────────┐ │
│ │ man 10:15 forelesning · tir 14:15 øving (muted)                  │ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ ‹EKSAMEN›  ‹4. des · skriftlig · 4 t›   (catalog ExamDate)          │
│ ‹KARAKTERER›  season-split shape, in decision context (D12)         │
│ ‹Høst-snitt lavt · stryk ~18 % · n=140›   (no sortable score)       │
│                                                                      │
│ ── below the fold ───────────────────────────────────────────────── │
│ ‹OM EMNET› læringsutbytte, innhold, obl. aktiviteter (prose, --measure)│
│ ‹Studieprogram som bruker emnet› → /studier/[code]/ links           │
└──────────────────────────────────────────────────────────────────────┘

MOBILE ──────────────────────────
┌────────────────────────────────┐
│ ‹SEMESTERPLAN› Planlegger  ◐   │
├────────────────────────────────┤
│ ‹5 emner·22,5 sp›  ukeplan →   │
├────────────────────────────────┤
│ ‹TDT4160›                      │
│ Datamaskiner og                │
│ digitalteknikk                 │
│ ‹7,5 sp·bachelor·høst·norsk›   │
│                                │
│ Vil dette kollidere for deg?   │
│ [ Legg til og se → ]           │
│ !! Ville kollidert m/ TMA4100  │
│    man 10:15–12:00             │
│ ‹Timeplan hentet 22. jul›      │
│                                │
│ ‹TIMEPLAN› man 10:15 forel.    │
│ ‹EKSAMEN› 4. des·skriftlig·4t  │
│ ‹KARAKTERER› stryk ~18%·n=140  │
│ ── OM EMNET (prose) ───────    │
└────────────────────────────────┘
```

`?mot=<code>` variant (COULD): the fork block gains a second course line and a **"Legg begge til"** button — a lightweight two-course *add* surface, explicitly **not** a compare matrix (D2, c3-7).

---

## 10. `/studier/[code]/` — Study plan as template + decide-loop host (Frame C)

Hosts the elective decide-loop (co-primary flow). Kull selector, periods → course groups → courses, with add controls and the inline decide facts. **Never asserts "group satisfied"** (DR-5) — shows credit running total + verbatim prose.

```
DESKTOP ──────────────────────────────────────────────────────────────
┌──────────────────────────────────────────────────────────────────────┐
│  ‹SEMESTERPLAN›                Planlegger                  [◐]        │
├──────────────────────────────────────────────────────────────────────┤
│ [ plan strip (if non-empty) … ukeplan → ]                            │
├──────────────────────────────────────────────────────────────────────┤
│ ‹MTDT›  Datateknologi (sivilingeniør)                               │
│ Kull:  [‹2024›][‹2023›][‹2022›]     ?kull=                          │
│                                                                      │
│ ‹5. SEMESTER — HØST›   ‹ditt semester›   (matched to plan semester)  │
│                                                                      │
│ ‹Obligatorisk›                                                      │
│ [·]‹TDT4145› Datamodellering og databaser · 7,5 sp   [ Legg til ]   │
│                                                                      │
│ ┌ CHOICE GROUP (decide-loop lives here) ───────────────────────────┐ │
│ │ ‹Valgbare emner›       [ Legg alle til vurdering ]                │ │  ← bulk → shortlist tier
│ │ « Velg 2 av følgende emner. » (verbatim prose, DR-5 — never       │ │
│ │   auto-picked; app never says "gruppe oppfylt")                   │ │
│ │ ┌ row ─────────────────────────────────────────────────────────┐ │ │
│ │ │ [·]‹TDT4258› Mikrokontroller-prog. · 7,5 sp                   │ │ │
│ │ │ !! kolliderer med planen din · man 10:15  (vs committed, DR-1)│ │ │  ← inline fact 1
│ │ │ ‹prosjektvurdering · stryk ~6 % · n=90›   (assessment+grade)  │ │ │  ← inline facts 2,3 (D12)
│ │ │                              [ Til vurdering ⊘ / Legg til ]   │ │ │
│ │ └────────────────────────────────────────────────────────────────┘ │ │
│ │ ┌ row ─────────────────────────────────────────────────────────┐ │ │
│ │ │ [·]‹TDT4200› Parallelle beregninger · 7,5 sp                 │ │ │
│ │ │ ‹ingen kollisjon · skriftlig eksamen · stryk ~20 %›          │ │ │
│ │ │                              [ Legg til ]                    │ │ │
│ │ └────────────────────────────────────────────────────────────────┘ │ │
│ │ ‹Valgt her: 0 av ~15 sp i gruppa›   (running total, not a verdict)│ │
│ └──────────────────────────────────────────────────────────────────┘ │
│                                                                      │
│ On promotion of a survivor, a delta sentence appears inline:         │
│ ‹TDT4200 → TDT4258: fjerner 1 kollisjon, sprer eksamen fra 2 til    │  ← swap-delta (THE PRODUCT)
│  5 dagers mellomrom.›                                                │
│                                                                      │
│ ‹Timeplan ikke publisert — kollisjonssjekk gjelder eksamen + campus.›│  ← DR-2/DR-8 in decide context
└──────────────────────────────────────────────────────────────────────┘

MOBILE ──────────────────────────
┌────────────────────────────────┐
│ ‹SEMESTERPLAN› Planlegger  ◐   │
├────────────────────────────────┤
│ ‹5 emner·22,5 sp›  ukeplan →   │
├────────────────────────────────┤
│ ‹MTDT› Datateknologi           │
│ Kull: [‹2024›][‹2023›]         │
│ ‹5. SEM — HØST› ‹ditt semester›│
│                                │
│ ‹Obligatorisk›                 │
│ [·]‹TDT4145› 7,5 sp  [Legg til]│
│                                │
│ ‹Valgbare emner›               │
│ [ Legg alle til vurdering ]    │
│ « Velg 2 av følgende. »        │
│ ┌──────────────────────────┐   │
│ │[·]‹TDT4258› 7,5 sp        │   │
│ │!! kolliderer · man 10:15  │   │
│ │‹prosjekt·stryk 6%·n=90›   │   │
│ │         [ Til vurdering ] │   │
│ └──────────────────────────┘   │
│ ‹Valgt: 0 av ~15 sp›           │
│                                │
│ ‹TDT4200→TDT4258: −1 kollisjon,│
│  sprer eksamen 2→5 dager.›     │
└────────────────────────────────┘
```

Recursive retning (choice-direction) render + `retning.deadlineDate` + `publishedYears`/`periodNumber` gating are SHOULD; they nest inside the same choice-group block pattern. The **"ditt semester"** kicker highlights the period matching the plan's semester for the selected kull (period math is best-effort per DR-7, and this is a *highlight*, never an auto-fill here).

---

## 11. Shared-plan handoff surface (co-primary growth loop)

A received `/planlegger/#v2;…` link is a first-class object (D1). Two moments: the **static-tier first paint** (renders before any fetch, from hash + search index) and the **three-way interstitial**.

```
INTERSTITIAL (over /planlegger/, recipient has a local plan) ──────────
┌──────────────────────────────────────────────────────────────────────┐
│  Kari deler en plan                                                  │
│  ‹5 emner · 28,5 sp · Høst 2026›            (from hash, no fetch)     │  ← real unfurl values
│  [·]‹TDT4100› [·]‹TMA4100› [·]‹IT2805› [·]‹TDT4258› [·]‹TFE4146›     │
│                                                                      │
│  Du har allerede en plan (‹3 emner›). Hva vil du gjøre?              │
│  [ Bruk denne ]     [ Slå sammen ]        [ Behold min egen ]        │
│   ↑ replace          ↑ union+dedupe        ↑ dismiss                 │
│                      preview: ‹+TDT4258, +TFE4146 (2 nye)›           │
│                                                                      │
│  ‹Timeplan publiseres ~12. aug — kom tilbake da for å sjekke›        │  ← return trigger if pre-publish
└──────────────────────────────────────────────────────────────────────┘

MOBILE — same three actions stacked full-width (44px each), unfurl line on top.

EMPTY-PLAN RECIPIENT: only [ Bruk denne ] and [ Behold min egen ]
(nothing to merge). Same static first paint.
```

**Unfurl / link-preview** (og:title etc., worker-rendered from the hash, no fetch): title `"Kari deler en plan"`, description `"5 emner · 28,5 sp · Høst 2026"`. The received link is the group's **re-editable canonical plan** — re-opening the same link after edits shows the current plan (c1-7).

---

## 12. Cross-page state & continuity summary

| Concern | Where it lives | Rule |
| --- | --- | --- |
| Plan (committed + shortlist + version) | hash `#v2;…` + localStorage | hash wins on load (shareable); §7 grammar; frozen |
| View (query/filter/kull/mot) | `?…` query per page | never carries plan state |
| Continuation to the app | plan strip (Frame C) | "ukeplan →", non-empty only |
| Deadline awareness | temporal banner | `/planlegger/` only (app-scoped) |
| Return pull | return trigger | in the shared artifact + pre-publish panel |
| Provenance | inline verdict line + footer | per-verdict inline; site-wide in footer |
| Credit truth | strip + planner header | null-aware; off-semester excluded (DR-6/DR-10) |
| Grade shape | decision cells only | never a browsable page decoration (D12) |
| Conflict red | grids + margin notes only | earned on a surface; never in the strip |

**Invariants for downstream flow docs:** (1) one nav pill, no hamburger; (2) strip suppressed on `/` and `/planlegger/`, shown-if-non-empty elsewhere; (3) plan in hash, view in query; (4) every satellite writes to one store and points home; (5) pre-publish is a filled primary mode, never a blank; (6) no red outside grids/margin notes; (7) provenance rides every composed verdict.
