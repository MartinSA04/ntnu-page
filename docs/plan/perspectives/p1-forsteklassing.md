# Perspective: The first-year student, week 1

**Persona**: Just started MTDT (Datateknologi, 5-year) or a 3-year bachelor. It's
August. Their plan is entirely pre-decided by NTNU — obligatory courses only,
zero choices to make. They don't know what "TP", "Studentweb", "emnekode",
"kull", or "øving" mean. They have a physical/digital welcome-week schedule
from the institute, a student card, and mild panic. Their phone is the primary
device half the time; laptop the other half.

This is the persona furthest from "power user." They are not here to plan —
someone else already planned for them. They are here to **decode**: turn a
list of five cryptic course codes into "where do I physically need to be, and
when, this week."

## What week-1 them actually needs

Not planning. **Orientation.** The gap between "I have been handed
TDT4110, TMA4100, TFY4145, EXPH0300, HMS0002" and "I know what building to
walk into at 10:15 tomorrow" is the entire job in week 1. Nothing about
choice, electives, or credits-toward-a-degree matters yet — that's semester
2+.

Concretely, ranked:

1. **"What is my week?"** — a timetable they can look at once and trust,
   ideally without having to assemble it themselves. Program students get a
   plan handed to them; the site should be able to start from *that*, not
   from an empty search box.
2. **"What is TDT4110?"** — decode a code into a name and a one-line sense of
   what the course is (not the full learning-outcomes essay — that's noise
   in week 1).
3. **"Where is room X"** and **"when does this actually start"** — the kind
   of thing they'll check daily on a phone standing in a hallway.
4. **"Am I signed up for the right things?"** — reassurance, not action. They
   can't register here (no Studentweb integration), but they can *check*
   that what's pre-filled in Studentweb matches what NTNU's own data says
   their kull takes.

Explicitly NOT needed in week 1: elective comparison, grade distributions,
credit-reduction rules, exam-form nuance beyond "when is it," anything
requiring them to already know their program code or cohort year fluently.

## The confusion the current page structure creates

Reading `/`, `/planlegger/`, `/emner/`, `/emne/[code]`, `/studier/[code]` as
this persona:

- **The landing page pitches "planlegging" as the verb**, and the hero CTA is
  "Åpne planleggeren." A first-year with a pre-decided plan does not think of
  themselves as someone who "plans a semester" — that word implies choice
  they don't have yet. This is the single biggest mismatch: the whole product
  voice assumes an active chooser, but week-1 you are a passive receiver
  trying to decode what was chosen *for* you. The landing page should still
  route them into the planner (it's the right tool), but the framing needs a
  second doorway that doesn't say "plan," it says something like "see your
  timetable."
- **`/planlegger/` starts empty.** "Ingen emner i planen ennå" + an add
  field + "Søk i emnekatalogen" is a cold start for someone who doesn't know
  their own course codes yet. The empty state does offer "Start fra et
  studieprogram," which is exactly right — but it's the *third* option
  listed, visually subordinate to manual search-and-add, when for this
  persona it should be the primary path, arguably the only one surfaced
  first.
- **`/studier/[code]` requires knowing your program code and cohort already.**
  A first-year doesn't reliably know "MTDT" is short for
  "Datateknologi." They know the Norwegian name of what they applied to, and
  possibly not even the exact one NTNU uses internally. `/studier/` is a
  search field over 403 programs — workable, but it's a second search the
  student has to get right before anything useful happens (find program →
  find own kull year → find own semester/period → find own courses → add
  them one by one or "legg til alle"). That's four decisions before they see
  a single room number. For a panicking week-1 student this is too many
  steps between landing and "see my week."
- **Nothing on the site says "5. semester" in terms a first-year parses.**
  Study plans are structured by period number; a first-year thinks in "first
  semester of my first year," not period arithmetic. The `/studier/[code]`
  auto-highlight of "ditt semester" (per PLANNER.md §5) is the right idea but
  depends on the student first landing on the correct kull page — which
  again depends on them already knowing program code + cohort.
- **`/emne/[code]` is built for evaluation, not orientation.** Facts panel,
  prose (content/learning outcomes/assessment), exams table, grades chart,
  timetable — this is a "should I take this" page. A first-year with
  TDT4110 already assigned doesn't need to evaluate it, they need "what is
  this, in one sentence, and when do I sit in a room for it." The page has
  no compressed/glanceable mode; it's a full dossier at all times.
- **"Emnekode" itself is unexplained.** TDT4110, ITGK (the old nickname
  students still say out loud even though it's not the current code) — the
  site treats codes as the primary key everywhere (nav is mono codes, tags
  are mono codes) which is correct information design for someone fluent in
  the domain, but a first-year doesn't yet trust that "TDT4110" and "Objekt-
  orientert programmering" are the same thing until they've seen them
  paired enough times. This resolves itself by week 3 but is real friction
  on day 1.
- **The plan/basket concept itself is unfamiliar.** "Legg til i planen,"
  tags with an × to remove — this is shopping-cart language for something
  the student didn't choose to put in a cart; NTNU put it there. It's not
  wrong, just requires a half-beat of "wait, I'm not choosing this, why do
  I 'add' it" that a returning semester-2 student won't have.

## Ideal first-visit flow (concrete)

```
Landing (/)
  → sees TWO doorways, not one CTA:
      "Se ukeplanen din" (if program known)   — big, primary
      "Bygg en plan selv"                      — secondary, existing planner entry
  → clicks "Se ukeplanen din"
Program picker (lightweight, not full /studier/)
  → free-text field: "Skriv studieprogrammet ditt (f.eks. Datateknologi)"
    matches on NAME, not code, autocompletes to MTDT-code under the hood
  → single most-likely kull preselected (current year = this year, since
    they're new) — no year-chip decision needed for a true first-year
  → one button: "Vis min ukeplan"
/planlegger/ (pre-populated)
  → plan arrives already containing the kull's period-1 obligatory courses
  → weekly grid renders immediately: rooms, times, course names alongside
    codes (not code-only)
  → each course row/tag has an inline one-line gloss, not just a link out:
    "TDT4110 — Algoritmer og datastrukturer" rather than bare code
  → exam ribbon shows, but de-emphasized (December exams don't matter in
    week 1 — this can even collapse behind a disclosure for first-time
    visitors and expand for returners)
  → a persistent, low-key link: "Er dette feil? Se hele studieplanen din"
    → /studier/[code] for the student who wants to verify against
    Studentweb or understand what comes in semester 2
```

The critical structural change this implies: **the planner should be
reachable pre-filled from a program+kull picker that does not require going
through the full `/studier/[code]` browsing page first.** Whether that's a
new lightweight landing widget or a promoted/simplified version of the
existing "Start fra et studieprogram" empty-state affordance, the effect is
the same — collapse "find my program → find my kull → find my period → add
each course" into one action for the common case (new first-year, current
year, period 1).

## What changes by semester 2

By semester 2 (spring, second real semester), this same student has:

- learned their program code and roughly what a kull is (their friends say
  "vi går 2024-kullet")
- discovered that some second/third-semester course lists include **choices**
  for the first time (or will next year) — this is where "valgbare emner"
  pain starts for some programs sooner than others
- probably still returning to `/planlegger/` mainly to re-check "what's my
  week" each time the semester's timetable actually publishes (timetables
  publish shortly before semester start — a returning student's plan from
  last time may show "timeplan ikke publisert ennå" notes that flip to real
  data; a "your timetable just published" signal would be well-timed here,
  though there's no notification mechanism, so at minimum the empty/pending
  states must read correctly)
- started caring about grade distributions and exam load for the *next*
  semester's obligatory courses ("is TMA4115 going to wreck me") — this is
  the first moment `/emne/[code]`'s full dossier (grades chart, assessment
  form) becomes relevant to them rather than noise
- for programs with early electives: this is where `/emner/` search and
  comparing 2-3 candidate courses' timetables/exams for clashes becomes a
  real task, and the planner's core "does this collide" value prop finally
  matches their actual problem

So the product correctly serves semester-2-them largely as currently
designed — planlegger + emner + emne detail is the right toolset for someone
making real choices. The gap is specifically **week 1 of semester 1**: the
on-ramp for a plan-receiver, not a plan-chooser.

## Top tasks (week 1, ranked)

1. See this week's schedule with rooms and times, without assembling it
   themselves.
2. Translate a course code into a name and one-sentence sense of the course.
3. Confirm the auto-assigned obligatory courses match what they see in
   Studentweb (verification, not planning).
4. Find a room/building for a specific lecture, fast, probably on a phone,
   probably standing in Realfagbygget wondering where R7 is.
5. Understand what "kull," "emnekode," and the semester's period number mean
   — implicitly, through consistent pairing of code+name+plain-language
   labels, not an explainer page nobody will read.

## Must / nice / anti-features

**Must** (serves week-1 orientation, buildable on existing data):
- Program+kull picker that pre-populates the planner directly (name-based
  search, not code memorization; guesses current year for new students).
- Course code always paired with full name wherever a code appears alone
  today (tags, list rows) — not just on hover/click-through. This is cheap
  (catalog.json already has names) and fixes the "what is TDT4110" problem
  everywhere at once, not just for first-years.
- Room/building surfaced prominently in the weekly grid block, not buried —
  it already is per PLANNER.md's block spec ("blocks = square hue dot + mono
  code + name + rooms"); the ask is that it stays legible at a glance, since
  "where do I go" is the literal top task.
- Correct, calm handling of "timeplan ikke publisert ennå" — week 1 is
  exactly when this state is common (courses may not have published rooms
  yet) and a confusing empty grid would be actively harmful at the worst
  possible time.
- A visible, low-friction path from the pre-filled planner back to "see the
  full official study plan" for the suspicious/careful student who wants to
  cross-check against Studentweb.

**Nice** (real value, not blocking):
- A one-line plain-language gloss on `/emne/[code]` above the full dossier —
  something like a subhead sentence extracted or hand-styled distinctly from
  the full learning-outcomes prose — so the page has a "5-second answer"
  mode before the "20-minute dossier" mode. (No new data needed; this is
  presentation, e.g. surfacing the first sentence of the description larger
  and treating the rest as detail.)
- Landing page copy fork or secondary CTA that doesn't lead with "planlegg"
  — even just adding "Se timeplanen din" as an equally-weighted second
  doorway addresses the persona-voice mismatch without a redesign.
- Light explanation of "kull" inline the first time it's shown to a given
  browser (e.g., a one-time mono note), rather than a glossary page nobody
  will visit deliberately.

**Anti-features** (would waste effort or actively confuse this persona):
- A dedicated onboarding wizard/tutorial overlay — first-years are
  overwhelmed already; another modal to click through is friction, not help.
  Solve this through better defaults and pre-filled state, not instructional
  UI.
- Any account system or "save your program forever" mechanism — out of
  scope (no server-side storage) and unnecessary; localStorage + a fast
  re-pick already covers "I'm back in week 2."
- Building a glossary/FAQ page for "what is TP/emnekode/kull" — this is a
  losing battle against jargon that pairs codes with names inline will solve
  more durably and more cheaply for the actual moments of confusion.
- Surfacing grade distributions or credit-reduction rules anywhere near the
  week-1 flow — correct data, wrong moment; it dilutes the one thing week-1
  them needs (the weekly grid) with things that matter in semester 3.
- Push notifications / "timetable just published" alerts — no account
  system exists to deliver them to, and building one for this alone is out
  of proportion to the problem (a calm, correctly-worded pending state
  covers it).
