# c4 — Differensiering: strip the TP-with-nicer-fonts, find what's left

Adversarial critique of `PRODUCT-draft.md`. Lens: positioning & identity.
Question I'm answering: after you delete every feature that is ntnu.no or TP
(timeplan.no) with better typography, what actually remains? Is the
conflict-and-decide loop the *spine* of the IA, or is it buried under a course
browser? Does the homepage sell the differentiator in five seconds?

Verdict up front: **the draft's *prose* is sharp about the differentiator and
its *IA* is not.** Section 1 nails the position ("owns the row, not the
column"). But by Section 4 the site is still, structurally, a two-tab course
search engine with a planner attached — the exact shape of every incumbent.
The draft resolved twelve viewpoints into a feature list and let the identity
leak out in the process. Below: the parasite test, the 3 cuts, the 3
double-downs.

---

## 1. The parasite test — remove TP/ntnu.no, what's left?

Run every MUST/SHOULD feature through: *does an incumbent already do this?*

**Pure parasites (incumbent already owns it, we're reskinning):**
- merged grid → TP does this. It's literally TP's one job.
- weekly timetable, dated schedules, rooms → TP.
- course description / learning outcomes / assessment scheme → ntnu.no emne page, verbatim source.
- study plan as template (`/studier/[code]`) → ntnu.no studieprogram page.
- grade distributions → DBH / karakterstatistikk sites already publish these.
- free-search catalog with filters → ntnu.no course search, TP's picker.
- exam dates/forms → ntnu.no.

**What is genuinely ours (no incumbent composes it):**
1. **Conflict across the *union* of a candidate set** — TP shows a merged grid but does not treat "these 5 courses, pick 2" as a set-narrowing problem with clash-cost per swap. This is the draft's Flow 2.
2. **Exam clustering + credit-load as first-class alongside timetable clash** — nobody merges "lectures collide AND exams stack AND you're at 22,5 sp" into one yes/no.
3. **Plan-aware preview before add** ("ville kollidert med X" *before* you commit) — Flow 3. This is a real inversion of the incumbent flow, where you find out you clashed after building the whole schedule.
4. **The single shareable stateless URL** — architecturally trivial for us, absent everywhere. The "send your candidate semester to a friend / advisor" primitive.
5. **Season-split grade *shape* as a decision input inside the chooser**, not a standalone stats page.

Notice the pattern: **everything ours is a verb (decide, swap, preview,
share). Everything parasitic is a noun (catalog, grid, description, stats).**
The draft's own MoSCoW is ~60% nouns by weight. That ratio *is* the identity
problem. A visitor landing cold cannot tell from the IA that we are a
verb-shaped product.

**So what remains after the strip:** exactly the "considering-state → compare →
swap-with-clash-cost → commit" loop, plus the shareable-URL primitive. That is
the whole product. Everything else is table stakes we host so the loop has
data to chew — and the draft treats the table stakes as co-equal pages.

---

## 2. Is the conflict-and-decide loop the centerpiece of the IA? No.

The draft *says* it is (§1, §3 Flow 2 labelled "core"). But look at what the IA
actually foregrounds (§4):

> **Nav: two pills — Planlegger | Emner**

Two pills, and one of them is a course search engine — a noun. The nav gives
50% of the site's permanent chrome to the thing incumbents already own. A
student reading the nav learns "this is a course browser that also has a
planner," which is precisely backwards from the positioning.

Worse, the draft admits the browser is bigger than the planner:

> **Flow 4. Single-course research → fork** — `/emne/[code]/` **(largest
> traffic, search-engine)**

The highest-traffic surface is the parasitic one. That's fine as an *acquisition*
reality — SEO brings people in on `/emne/TDT4100`. But the draft never resolves
the tension: the loudest page by traffic is the one least differentiated, and
the IA doubles down on it by giving search a top-level pill. The decide-loop —
the actual product — has **no dedicated surface at all**. It lives *inside*
`/planlegger/` as ghost blocks and a compare component (§8 resolution 1–2).
The centerpiece is an *interaction pattern buried in a page*, not a place.

That's defensible (I don't want a standalone compare page either — p7 is right).
But then the burden shifts entirely onto the empty-state and the homepage to
teach that the planner *is* a decision tool, not a schedule viewer. And the
homepage doesn't.

---

## 3. Does the homepage sell the differentiator in 5 seconds? No.

Ground truth — current `/` (index.astro:13-17):

> H1: **"Planlegg semesteret før du melder deg opp."**
> Lede: "Sett sammen emner … og se timeplankollisjoner, eksamensdatoer og
> studiepoeng samlet — før du melder deg opp."

The draft's §3 Flow-implied hero is the same register. Problems:

1. **"Planlegg semesteret" is what a calendar does.** Google Calendar plans
   your semester. The verb is generic. Five seconds in, a student cannot
   distinguish us from "a nicer TP." The differentiator — *decide between
   overlapping electives* — is absent from the headline.
2. **"se … samlet" (see it gathered) is a passive, read-only promise.** It
   sells the exact "read/verify" framing the draft itself says (§1) is too
   weak. The homepage contradicts the positioning section of the same product.
3. **Three equal tiles: Planlegger / Emner / Studier** (index.astro:21-34).
   Three co-equal doors, two of them noun-doors. The homepage visually asserts
   "we are three things," diluting the one job into a triptych. (The draft
   kills the `/studier/` index in §4 — good — but doesn't fix the homepage's
   tile triptych that mirrors it.)
4. **No proof-in-view.** The single most differentiating asset we have is the
   red-ink collision mark on the squared sheet (DESIGN.md signature). It is a
   *visual* that communicates "this catches a problem" in under a second. The
   homepage shows none of it — it's all text tiles. We're hiding our one
   5-second-legible differentiator below the fold, on another page.

**The five-second test the homepage must pass:** a 4th-year staring at two
elective slots and five overlapping options should read the hero and think
*"oh — this decides that for me."* Neither the current copy nor the draft's
implied hero does that.

---

## 4. THREE CUTS (sharpen by removing)

### Cut 1 — Kill the "Emner" nav pill. Search is a mode, not a destination.
> Draft §4: "Nav: two pills — Planlegger | Emner"

Giving search top-level chrome tells every visitor we're a catalog. **Fix:**
one primary nav identity — **Planlegger** (or the sitename linking to it) — and
search becomes an *action inside the planner's add-field and a plan-aware
`/emner/` that you reach by searching, not by navigating.* SEO landing pages
(`/emne/[code]`, `/emner/?q=`) still exist and still rank — they just aren't
sold as the product's front door. The nav should read as *one verb-shaped
product with an entry field*, not *two things*. This is the single highest-
leverage identity move in the document.

Concretely: nav = `Semesterplan` (home) · `Planlegger`. `/emner/` is reachable
from the planner's "legg til" affordance and from search engines; it is not a
pill. This makes the IA assert what §1 claims.

### Cut 2 — Cut the standalone "research" framing of `/emne/[code]`; reframe it as a *fork point*.
> Draft §3 Flow 4: "Single-course research → fork … one-time planner intro for
> empty-plan visitors."

The draft treats the course page as a research destination that *also* offers
add-to-plan. That's the parasite posture — it's ntnu.no with our fonts plus a
button. **Fix:** every `/emne/[code]` visit is treated as *a candidate arriving
at the decision loop*. The page's primary CTA isn't "read about this course,"
it's **"Vil dette kollidere for deg? Legg til og se"** — i.e. the page's job is
to *convert a lookup into a candidate*. Same data, but the framing stops being
"encyclopedia entry" (which we lose to ntnu.no on SEO depth anyway) and becomes
"the moment a course enters your decision." The description/outcomes prose gets
demoted below the plan-context + clash-preview line. We are not competing with
ntnu.no on being a better encyclopedia; we're competing on being the only place
the encyclopedia entry is *actionable against your semester*.

### Cut 3 — Cut grade stats as a browsable feature; keep them ONLY as a decision cell.
> Draft §5 MUST: "season-split grade trend"; §3 Flow 4: "season-split grade
> shape"; COULD: "grade data in elective rows."

Standalone grade trends on a course page are pure DBH-parasite content — the
stats sites do it, do it deeper, and we add nothing but typography. Having it as
a MUST on the course page and as a "COULD" in the compare row is exactly
backwards. **Fix:** grade *shape* is MUST **only inside the compare/decision
context** (the elective row and `?mot=` cell) — where "TMA4100 skews harder
than TMA4105" is a *substitution input*, which nobody else composes. On the
standalone course page it drops to SHOULD/COULD at most. This enforces the p4
discipline (§8 resolution 5) *and* the differentiation discipline at once: the
number only appears where it does work no incumbent does. Every place grade data
appears as browseable trivia is a place we look like a stats mirror.

---

## 5. THREE DOUBLE-DOWNS (sharpen by investing more)

### Double-down 1 — The candidate/shortlist state is the product. Fund it like it.
> Draft §8 res.1: "two-tier committed/shortlist"; §5 MUST "two-tier
> committed+shortlist"; §9 open: "candidates-in-hash from day one."

This is buried in resolved-conflicts as if it were a settled implementation
detail. **It's the differentiator's load-bearing wall** — the entire "owns the
row" claim collapses to "TP with fonts" without it, because a plain merged grid
*is* TP. Elevate it from a resolved conflict to a **stated product principle**:
"The planner holds two kinds of course — *taking* and *weighing* — and the whole
UI is built to move courses between them." And close the open question **now, in
favor of yes**: candidates must be in the shareable hash from day one, or the
share-a-decision primitive (double-down 3) is crippled — you could only share
committed plans, not "help me choose between these five." Sharing a *decision in
progress* is more differentiating than sharing a finished plan.

### Double-down 2 — Clash-cost-per-swap must be a *number the student sees*, not a red mark.
> Draft §3 Flow 2: "provisional swap (preview clash cost)"; §6: øving-group
> clustering as P0.

The draft has the mechanism (preview) and the correctness engine (øving
clustering) but under-specifies the *payoff moment*. The thing that makes the
decide-loop feel like magic — and that no incumbent can show — is a comparative
verdict at the moment of substitution: **"Bytt TDT4145 → TDT4225: fjerner 1
kollisjon, sprer eksamen fra 2 til 5 dager."** That sentence is the product.
Invest in making swap render a *plain-language delta*, not just re-drawing the
grid and letting the student re-scan for red. The margin-note vocabulary
(PLANNER.md:38, "kolliderer med … · mandag 10:15") already establishes the
register; extend it to *comparative* margin notes on swap. This is where
"thinking tool" stops being a slogan.

### Double-down 3 — The shareable-decision URL is a marketing weapon, not just persistence. Put it on the homepage.
> Draft §1: "single shareable stateful URL with no login (architecturally
> trivial for us, absent everywhere)"; §3 Flow 6: shared-plan handoff.

The draft correctly identifies this as uniquely ours, then relegates it to a
handoff interstitial (Flow 6). It's under-sold. **Double down:** (a) make
"share this semester / share these options with your advisor or study-buddy" a
*named, visible action* in the planner, not just a URL you happen to be able to
copy; (b) it belongs in the **homepage proof** — a shared plan link is the
organic acquisition loop (student sends candidate semester → friend opens →
friend has our tool). No incumbent has an account-less share, so this is both
differentiator and growth engine. The draft's §1 knows this; the IA and
homepage forget it.

---

## 6. The homepage fix, concretely

Replace the generic "Planlegg semesteret" + triptych with a
differentiator-first hero that shows the one thing we do and incumbents can't:

- **H1 (verb + the decision, not the calendar):**
  *"Kan du ta disse emnene sammen?"* — or —
  *"Velg mellom emner som kolliderer — før oppmeldingen."*
  (Leads with *choosing between conflicting options*, the pain no tool owns.)
- **Sub:** "Legg inn kandidatene dine, se kollisjoner, eksamensklynger og
  studiepoeng med én gang — og finn ut hva du bytter hvis det ikke går opp."
  (Note "hva du bytter" — commits to *decide*, per §1's sharpened job.)
- **Proof-in-view, above the fold:** a small live/static `.np-frame.np-ruled`
  fragment showing two blocks colliding with the red-ink hatch + margin note.
  Our one instantly-legible differentiator, on the page that has five seconds.
- **One CTA, not three tiles:** "Åpne planleggeren." Demote Emner/Studier to a
  thin secondary link row or fold them into the planner. Kill the co-equal
  triptych that says "we are three nouns."
- **Returning-visitor line stays** (the "Planen din: N emner" line,
  index.astro:104) — it's good, it's the one place the homepage already shows
  we hold state. Extend it to show shortlist count too ("… + 3 til vurdering").

---

## 7. What I'd leave alone (the draft got right)

- §1 positioning ("owns the row not the column," "join") — best sentence in the
  document. My whole critique is: *make the IA obey it.*
- §7 non-goals — the discipline (no scores, no fabricated signals, no
  Studentweb integration, "thinking tool upstream") is exactly the moat.
  Fabricated difficulty scores would have been the fastest way to become
  indistinguishable snake-oil. Good that it's killed.
- §8 res.1–2 — no standalone compare page, compare-as-component with two entry
  points. Correct. The decide-loop should be *in* the planner, not a new noun-
  page. (My complaint is that it's under-sold, not mis-placed.)
- Killing the `/studier/` index (§4) — right instinct; the homepage tile
  triptych is the last vestige of the same redundancy and should die with it.

---

## Top findings (for the synthesizer)

1. **The MoSCoW is ~60% nouns (catalog/grid/description/stats — all incumbent-
   owned) and the IA foregrounds them.** Everything genuinely ours is a verb
   (decide/swap/preview/share). The product reads as a course browser with a
   planner bolted on — the exact shape of every competitor.
2. **The decide-loop has no home in the IA.** It's an interaction pattern buried
   in `/planlegger/`; meanwhile search gets a top-level nav pill and the course
   page is called "largest traffic." The loudest surfaces are the least
   differentiated.
3. **The homepage fails the 5-second test.** "Planlegg semesteret … se … samlet"
   is a passive, calendar-generic, read-only promise that contradicts §1's own
   "decide, don't just check" framing — and it hides the red-ink collision
   visual (our one instantly-legible differentiator) on another page.
4. **CUT 1: kill the "Emner" nav pill** — search is a mode inside the planner,
   not a co-equal destination. Highest-leverage identity move.
5. **CUT 2: reframe `/emne/[code]` from research page to fork point** — primary
   CTA "vil dette kollidere for deg? legg til og se," prose demoted. Stop
   competing with ntnu.no on being an encyclopedia.
6. **CUT 3: grade stats as MUST only in the compare/decision cell**, not as
   browsable course-page trivia (that's DBH-mirror parasitism).
7. **DOUBLE 1: promote candidate/shortlist from "resolved conflict" to product
   principle**, and put candidates in the shareable hash from day one.
8. **DOUBLE 2: swap must render a plain-language delta** ("fjerner 1 kollisjon,
   sprer eksamen fra 2 til 5 dager"), not just redraw the grid. That sentence is
   the product.
9. **DOUBLE 3: the account-less shareable-decision URL is a growth loop** — name
   it as an action and put it in the homepage proof, don't bury it in a handoff
   interstitial.
