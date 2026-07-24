# Perspective: exchange / international student (+ Norwegian students eyeing English-taught options)

Persona anchor: Léa, one-semester exchange student, no Norwegian, arrives two
weeks before term not knowing which building "Dragvoll" even is. Secondary
reader: Kari, a Norwegian BSc student choosing between two electives where
one is taught in English and she wants to know before she commits.

## The core problem this persona has that others don't

Every other persona on this panel is inside the system: they have a kull, a
studieplan, a default path, and Norwegian as a working language. Léa has
**none of that**. She is not "planning around a fixed plan," she is
constructing a plan from zero, under three constraints simultaneously that
the current site does not let her filter on at all:

1. **Language of instruction** — not exposed as a filter or a visible signal
   anywhere on `/emner/` today. It exists in the data
   (`CourseDetails.teachingLanguage`, e.g. `"Engelsk"`/`"Norsk"`) but only
   after opening a course's detail page and reading a fact-box row. For a
   student scanning 4767 courses, this is fatal — she cannot search 4767
   pages by hand to find the ~few hundred taught in English.
2. **Campus** — she needs to know not just "Trondheim" but which physical
   campus, because Gløshaugen ↔ Dragvoll is a 25-minute bus ride and
   Gjøvik/Ålesund are different cities entirely. `catalog.json`'s
   `location` field is **city-level only** ("Trondheim" / "Gjøvik" /
   "Ålesund") — it cannot distinguish Gløshaugen from Dragvoll. That finer
   split only exists today on `StudyProgramSummary.campuses`, not on
   individual courses. This is a real data gap, not just a missing filter —
   see "Data reality check" below.
3. **Assessment form** — portfolio vs. hjemmeeksamen vs. skriftlig
   skoleeksamen changes how survivable a course is for someone new to
   Norwegian academic norms and, for exam-form students, whether they can
   even sit it remotely if their exchange ends before a December exam.

None of these three are search facets today. `/emner/` filters only by
`location` (city) chips per SPEC.md. Everything else requires opening each
course.

## Concrete flow Léa needs, that the current 5-page shape doesn't give her

1. **Filter, don't browse.** She lands on `/emner/`, needs to immediately
   narrow ~4767 → "taught in English" → "Trondheim, Gløshaugen-side
   subjects" (informatics/tech) → "not a school-exam-only course in her
   final week" (because her exchange may end before the December exam
   window — see kont-exam point below). This is a compound filter, not a
   single chip toggle.
2. **See campus/language/assessment as list-row signals**, not just as
   detail-page prose. She should not have to open 40 course pages to build
   a shortlist of 8. Right now the `/emner/` row is "mono code + serif
   name" only (per SPEC.md) — that's the Norwegian-student's already-fluent
   scan pattern (code = enough), and it fails her completely: a course code
   like `TDT4136` communicates nothing about language or location.
3. **Cross-campus conflict awareness in the planner.** If she picks a
   Gløshaugen course and a Dragvoll course with adjacent time slots, the
   conflict engine (`conflicts.ts`) currently only checks day+time+week
   overlap — it has no notion of travel buffer. Two back-to-back classes on
   different campuses are functionally a collision even with a 15-minute
   gap. This isn't in the data (no travel-time model, and building-level
   location isn't even in `catalog.json` for courses), so it can't be
   solved precisely — but the site should at minimum not present two
   different-campus courses ending/starting within, say, 45 minutes of each
   other as conflict-free the way it would two Gløshaugen courses.
4. **Exam-timing awareness against her exchange window.** She needs to know,
   at a glance, whether a course's exam falls in the ordinary December/May
   window or requires staying for kont (August) — because if she's leaving
   in mid-December and the exam is in a January-tail slot, or if the only
   assessment is a home exam released while she's mid-flight home, that's a
   dealbreaker she needs to catch during *planning*, not after enrolling.
   The exam-date/form pairing exists in the data (`CourseExam.date` +
   `.form`); it just needs to be legible in the planner's exam ribbon
   alongside form, not only date.

## Bilingual UI: verdict

**No — do not build a bilingual UI.** Reasons, concretely:

- The underlying *data itself* is already available in English where it
  matters (`teachingLanguage`, `assessmentScheme`, course names all have
  English variants via the `ntnu.edu` course-page twin, per
  `coursepage.ts`). The gap is not "the site is in Norwegian," it's "the
  site doesn't surface the language/campus/assessment facts as
  scannable/filterable signals."
- SPEC.md and DESIGN.md are unambiguous and correct that Norwegian is the
  site's voice (bokmål, bindingly, throughout Ruteark's copy vocabulary).
  Maintaining two copy trees for a site with one part-time-ish
  maintainer is a tax that will bit-rot immediately, and it fights the
  design system's own "Data-Is-Mono" ethos: NTNU course codes, credit
  counts, dates, and — crucially — **course names on the English catalog
  pages** are not Norwegian-only concepts a translation layer needs to
  wrap.
- What Léa actually needs is not Norwegian sentences translated — it's
  **data currently locked in prose becoming a first-class filterable/
  scannable field**: language chip, campus chip (once/if building-level
  data exists), assessment-form badge. That is a data-surfacing problem,
  solvable without touching UI copy language at all.
- Compromise that respects both the "no bilingual UI" call and Léa's real
  need: where the *underlying fact itself* is inherently bilingual data
  (e.g., `teachingLanguage: "Engelsk"` is Norwegian-labeled but the
  concept "this course is taught in English" is exactly what an
  English-only reader needs to identify), render it as a compact
  internationally-legible badge/icon (e.g., "EN" mono tag) rather than as
  a sentence — sidesteps translation entirely because it's data typeset
  per Data-Is-Mono, not prose.
- One narrow exception worth flagging, not solving now: course *names* on
  `/emner/` rows are pulled from the Norwegian catalog crawl
  (`catalog.json`, `searchAll`). A pure-English reader sees "Objektorientert
  programmering" in the list even though an English name exists on the
  course's own English page. This is a real rough edge for Léa, but fixing
  it means the crawler pulling bilingual names for all 4767 courses (cost),
  not a UI-language toggle — flagged as a data/crawler question, not a
  "build bilingual UI" answer.

## Must / Nice / Anti

**Must**
- Language-of-instruction as a first-class filter chip on `/emner/`
  (English / Norwegian / other), sourced from `teachingLanguage` — this is
  the single highest-leverage addition for this persona and is purely a
  data-surfacing change (field already scraped), not new data collection.
- Language badge on `/emne/[code]` visible without scrolling into the fact
  prose — a mono tag near the title, same visual register as campus.
  Consistent with Data-Is-Mono (it's a category label, not a sentence).
- Assessment-form signal on both the course list row (compact) and the
  exam ribbon in `/planlegger/` (already has the data: `CourseExam.form`) —
  "hjemmeeksamen" vs "skriftlig skoleeksamen" vs "mappevurdering" should be
  scannable, because it changes whether a course is survivable/completable
  remotely or from abroad.
- City-level campus filter on `/emner/` (Trondheim / Gjøvik / Ålesund) —
  this exists in the data today (`catalog.json.location`) and is currently
  unused as a facet on the list beyond the SPEC's mention of "location
  filter chips," which should be confirmed shipped and prioritized for this
  persona specifically.
- Kont-exam / exam-season visibility fixed and prominent (noted in brief as
  already-tracked bug work) — for this persona it's not cosmetic, it
  determines whether a course is even completable within an exchange
  window.

**Nice**
- English course names surfaced on list/detail pages where available
  (requires crawler change: pull bilingual name pairs, not just Norwegian).
  Flag as a crawler-cost question for whoever owns `crawler/crawl.mjs`, not
  a frontend decision.
- A compact "EN" mono badge convention reused consistently across
  `/emner/` rows, `/emne/[code]`, and `/studier/[code]` plan rows —
  cheap, high-legibility, fits Ruteark's mono-for-data rule.
- Travel-buffer awareness in the conflict engine once/if course-level
  building data exists (currently it doesn't — see data gap below); until
  then, at minimum treat different-city courses (Trondheim vs Gjøvik vs
  Ålesund) as an automatic hard conflict regardless of listed time, since
  no student attends both in one semester.

**Anti**
- Bilingual UI / i18n copy layer for the site chrome. Wrong problem,
  wrong cost, fights the design system's committed Norwegian voice.
- Auto-detecting browser language and silently switching site copy —
  same objection, plus it would surprise Norwegian students the tool is
  primarily built for.
- Inventing building-level campus data (Gløshaugen vs Dragvoll room
  numbers) that isn't in the crawl — do not fabricate or guess; if it's
  not in `catalog.json`/`CourseDetails`, the UI must not imply precision
  it doesn't have. Say "Trondheim" honestly rather than a wrong campus
  guess.
- A generic "international students" info page/FAQ as a substitute for
  the filters above — prose about visa/housing is out of scope (not
  planning-tool data) and doesn't solve the actual filtering pain; the
  brief is explicit the site's job stops at "the thinking tool upstream
  of Studentweb," not a relocation guide.

## Data reality check (what's assumable vs. what's genuinely missing)

- **Have, unused as a facet**: `teachingLanguage` (per-course, via course-page
  scrape), `assessmentScheme`/`CourseExam.form` (per-course), `location`
  (city, catalog-level, cheap/bulk).
- **Have, but only at the wrong granularity**: campus. Programs know
  Gløshaugen vs Dragvoll (`StudyProgramSummary.campuses`); individual
  courses only know their city. A course-level campus-building filter is
  **not buildable from current data** without either (a) inferring campus
  from the course's owning department/study-program join (imperfect — a
  course can serve multiple programs across campuses), or (b) a scrape
  change to extract building from `ExamRoom.building` /
  `ScheduleActivity` room strings (exists per-timetable-entry, expensive to
  aggregate for a catalog-wide filter, and only populated near term start).
  Plan around city-level for `/emner/`, and treat true campus/building
  precision as a `/planlegger/` per-course nice-to-have once a timetable is
  loaded (room strings are already fetched there).
- **Genuinely absent, do not build toward**: prerequisites as structured
  filterable data (prose only), visa/immigration/housing content, seat
  capacity (so no "will I get a spot" promise — the tool tells you what
  clashes and what exists, never whether you'll be admitted).
