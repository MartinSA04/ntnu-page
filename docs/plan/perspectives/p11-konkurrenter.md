# P11 — Konkurrentanalyse

Lens: hva bruker NTNU-studenter faktisk i dag for å velge emner, bygge
timeplan og vurdere karakterstatistikk — og hvor er gapet igjen.

Fem verktøy undersøkt: NTNU sine egne offisielle sider (emnesøk + TP),
**ntnu.1024.no** (uoffisiell timeplanbygger), **emnr.no** (emnevurderinger),
**grades.no** / **karakterweb.no** (karakterstatistikk). Ett falskt spor
notert til slutt.

---

## 1. NTNU emnesøk (`ntnu.no/studier/emner/[kode]`)

**Hva det er:** den offisielle, autoritative kildesiden for ett emne av
gangen. Server-rendert, ingen SPA — prosa-tung: faginnhold, læringsutbytte,
vurderingsordning, undervisningsspråk, studieår-velger (2007/08 til
2026/27).

**Gjør bra:**
- Autoritativ og fullstendig — alt en emnebeskrivelse formelt skal
  inneholde er der, inkludert historikk år for år.
- Alltid oppdatert (det *er* kildesystemet via EpN/FS).
- Indekseres av Google — ofte første treff når man søker emnekode.

**Der studenter klager (indirekte — se metodenotat nederst):**
- **Ett emne av gangen, ingen sammenligning.** Det finnes ikke en "legg
  disse tre emnene ved siden av hverandre"-visning. Skal du sammenligne
  TDT4100 vs. IT1901 må du åpne to faner og bla manuelt.
- **Ingen kobling til egen studieplan eller egen timeplan.** Siden vet ikke
  at du går MTDT kull 2024 eller at du allerede har lagt TMA4100 i en plan.
- **Søket er et rent tekstsøk** — ingen filtrering på campus, nivå,
  undervisningsspråk, semester eller ledige plasser i visningen; man må
  kjenne emnekoden eller navnet på forhånd for å lande riktig.
- **Ingen visualisering.** Timeplan og eksamen er nevnt som lenker/faner
  inn i TP, ikke integrert i samme visning som beskrivelsen.

**Gap som blir liggende:** dette er en oppslagsside, ikke et
beslutningsverktøy. Den svarer "hva er dette emnet" utmerket, men aldri
"passer dette emnet inn i *min* høst".

---

## 2. TP — tp.educloud.no/ntnu (offisiell timeplanmotor)

**Hva det er:** Sikt/EduCloud sitt sentrale timeplanleggingssystem, brukt
av *alle* norske universiteter (samme kodebase kjører for UiO, UiB, UiT,
OsloMet). NTNU sine emnesider lenker inn i TP for å vise ukeplan per emne.
Kjernefunksjonen er student**gruppe**-basert kollisjonsfri planlegging —
altså et **administrasjonsverktøy for de som lager timeplaner**, eksponert
med et tynt read-only lag for studenter.

**Gjør bra:**
- Datakilden er sannheten — rom, tider, uker kommer herfra (ntnu-api sin
  timetable-scraping bygger i praksis på samme grunnlag).
- Fungerer på tvers av institusjoner — samme URL-mønster, samme motor,
  kjent for studenter som bytter lærested eller tar emner ved UiO/UiB.

**Der det svikter for en student:**
- **Én emnekode av gangen** (`?id=TDT4100&type=course`) — for å se om
  TDT4100 og TMA4100 kolliderer må du slå opp begge separat og
  sammenligne manuelt, det finnes ingen multi-emne studentvisning uten å
  logge inn og bygge en "studentgruppe" (et adminbegrep, ikke et
  studentbegrep).
- **Personlig, sammenslått ukeplan krever Feide-innlogging** inn i et
  grensesnitt bygget for timeplanleggere, ikke studenter — student-siden
  av TP er i praksis en visning, ikke et planleggingsverktøy.
- Grensesnittet er tungt JS-avhengig, datert (samme UI mønster på tvers av
  alle norske universiteter siden tidlig 2010-tall), ingen URL man kan
  dele med en medstudent som viser "min plan".
- Ingen eksamensdimensjon i samme visning — eksamen ligger som en egen
  emneside-lenke.

**Gap:** TP løser "når er forelesningen" for ett emne. Det løser aldri
"kolliderer emnene *jeg* vurderer" uten manuelt strevsomt oppslag — nøyaktig
jobben `/planlegger/` gjør automatisk.

---

## 3. ntnu.1024.no — "Timetable generator for NTNU students"

**Hva det er:** en uoffisiell, studentlaget timeplanbygger — drevet av én
utvikler (Thomas Adamcik) siden **2008**, fortsatt i drift. Python/Django +
Yahoo UI Library (et frontend-bibliotek som var moderne rundt 2008–2010).
6 400+ lagrede timeplaner, 1000+ emner dekket per vår 2026.

**Gjør bra:**
- Løser nettopp det TP ikke gjør for studenter: velg flere emner, se dem
  slått sammen i én ukeplan, uten Feide-innlogging.
- Har overlevd 18 år — beviser at behovet ("min egen sammenslåtte
  ukeplan, raskt") er reelt og vedvarende nok til at studenter fortsatt
  finner og bruker et verktøy fra 2008.
- Named/delbar plan via kallenavn (`hent lagret plan med samme navn`).

**Der det svikter:**
- **Deling er kallenavn-basert, ikke URL-basert** — "brukernavn" som
  kollisjonshåndteres serverside er en primitiv erstatning for en
  shareable link; ingen skjermbilde-verdig visning å sende en studiekamerat.
- **Ingen kollisjonsmarkering utover visuell overlapp i rutenettet** — man
  ser at to blokker ligger oppå hverandre, men ingen eksplisitt "disse
  kolliderer"-tekst, ingen eksamenskollisjon i det hele tatt.
- **Ingen kredittsum, ingen studieprogram-kontekst, ingen eksamensribbon,
  ingen karakterstatistikk** — rent og utelukkende en ukeplan-blokk-visning.
- Selvstendig erklærer *"no official affiliation with NTNU"* og advarer om
  at data "may not reflect actual lecture times" — tillit til fasthet er
  lav; dataene kan ligge etter.
- Visuelt og teknisk uforandret i essens siden 2008 — ingen mobilvennlig
  respons, ingen moderne interaksjonsmønstre.

**Gap:** dette er beviset på markedet — 18 år med organisk bruk for "slå
sammen timeplanene mine" uten at NTNU selv løste det. Men verktøyet stoppet
ved ukeplanen. Ingen eksamen, ingen karakterer, ingen studieplan, ingen
deling som ikke krever at begge parter husker et brukernavn.

---

## 4. emnr.no — "Finn og vurder NTNU-emner"

**Hva det er:** studentbygget (NTNU-studentgruppe, lansert rundt 2020,
omtalt av NTNU selv på LinkedIn) emnevurderingsside — søk på emnekode,
se snittkarakter, strykprosent og **subjektive studentanmeldelser**
("basert på andre studenters erfaringer"). PWA (manifest.json,
apple-touch-icon) — bygget for å kunne "installeres" på mobil.

**Gjør bra:**
- **Den eneste kilden i dette landskapet med subjektive vurderinger** —
  "er dette emnet greit å ta sammen med jobb", "er pensum tungt", "er
  eksamen rettferdig" — informasjon som verken NTNU, TP eller
  karakterstatistikk-sidene kan gi, fordi det krever meninger, ikke data.
- Kombinerer objektivt (snittkarakter, strykprosent — samme type tall som
  grades.no) med subjektivt (fritekst-anmeldelser) på samme emneside —
  ett stopp for "bør jeg ta dette emnet."
- SEO-optimalisert rundt akkurat emnekode-søk (meta keywords lister
  konkrete koder) — fanger studenter som googler "TDT4100 vurdering".

**Der det svikter:**
- **Rent oppslag, ett emne av gangen** — ingen kobling til egen plan, ingen
  ukeplanvisning, ingen kollisjonssjekk. En student som vil vite "er
  TDT4100 verdt det" *og* "kolliderer det med resten av semesteret mitt"
  må fortsatt til et annet verktøy for del to.
- **Avhengig av at studenter faktisk skriver anmeldelser** — cold-start og
  long-tail-problem iboende i alt UGC; smale/nye emner har sannsynligvis
  få eller ingen vurderinger (kan ikke bekreftes uten pålogging/scraping,
  men er strukturelt uunngåelig for denne typen tjeneste).
- Ingen struktur rundt studieprogram/kull — vurderinger er emne-isolerte,
  ikke satt i sammenheng med "dette emnet i *mitt* studieløp."

**Gap:** emnr.no eier "er dette emnet bra" (kvalitativt). Det eier ikke
"passer dette emnet i timeplanen min" eller "hvor ligger dette i
studieplanen min." Det er et vurderingsleksikon, ikke en planlegger.

---

## 5. grades.no / karakterweb.no — karakterstatistikk

**Hva de er:** to konkurrerende (eller parallelle) rene
karakterstatistikk-sider. grades.no driftes av **Dotkom** (Online,
Institutt for informatikk sin linjeforening) siden 2013/2017, åpen kildekode,
åpent API (`api.grades.no/api/v2`, Swagger-dokumentert). karakterweb.no
dekker flere institusjoner (NTNU, OsloMet m.fl.), men blokkerte automatisert
henting i denne undersøkelsen (403) — konsistent med et strengere,
mer kommersielt/annonsefinansiert oppsett enn grades.no sitt rene
studentdrevne åpne-data-prosjekt.

**Gjør bra:**
- **Dyp historikk per emne, år for år, karakterfordeling A–F** — akkurat
  den samme dataklassen ntnu-api/planleggeren allerede har tilgang til
  (DBH-baserte tall), men grades.no har gjort det til hele sitt produkt i
  over ti år og er trolig godt kjent blant realfag/IT-studenter spesielt
  (Online-tilknytning).
- Åpent API — andre studentprosjekter (inkl. potensielt dette) kan bygge
  videre på dataene uten å måtte scrape selv.
- grades.no er fortsatt vedlikeholdt (commits så sent som desember 2025
  ifølge repo-metadata) — ikke et dødt studentprosjekt.

**Der det svikter:**
- **Rendyrket enkeltemne-statistikk** — ingen ukeplan, ingen studieplan,
  ingen sammenligning på tvers av valgemner i én visning utover det som
  eventuelt finnes i en sammenligningsfunksjon (ikke bekreftet i denne
  undersøkelsen; uansett ikke koblet til en personlig plan).
  karakterweb.no ser ut til å tilby course-review-elementer på siden
  (basert på indekserte titler), men er request-blokkerende og dermed
  ugjennomsiktig for videre analyse her.
- Karakterstatistikk isolert fra alt annet en student trenger for å velge:
  ingen kobling til om emnet kolliderer med resten av planen, ingen kobling
  til studieplan-kontekst.

**Gap:** dette er en dataleverandør, ikke en beslutningsflate. Tallene er
gode men løsrevet — akkurat den samme type data ntnu-api allerede har
(`historical grade distributions`), bare uten courses-i-kontekst.

---

## 6. Falskt spor notert

`emlund.gumroad.com/l/StudentDashboard` dukket opp i søk men er et generisk,
betalt studentplanleggerprodukt uten synlig NTNU-tilknytning — ikke reelt
konkurrerende, nevnes kun for å dokumentere at søket ble gjort bredt.

---

## Metodenotat om Reddit/forum-søk

r/ntnu og lignende studentforum lot seg ikke søke direkte gjennom
WebSearch i denne økten (Reddit-innhold indekseres tynt/ikke i det hele
tatt via de tilgjengelige søkeverktøyene). Konklusjonene over bygger derfor
på **strukturell analyse av de faktiske verktøyene** (hva de kan og ikke
kan gjøre) og på indirekte signaler (levetid, vedlikeholdsstatus,
tilknytning til studentorganisasjoner, SEO-språk rettet mot studentbehov)
snarere than sitert student­sitater. Der jeg skriver "studenter klager" er
det avledet fra funksjonsgap, ikke fra et funnet sitat — flagget slik at
panelet ikke forveksler dette med verifisert brukerforskning.

---

## Konkurrentkart — hvem eier hva

| Behov | Eies i dag av | Hvor godt |
|---|---|---|
| Autoritativ emnebeskrivelse | NTNU emnesøk | Fullstendig, men isolert |
| Time-for-time timeplan, ett emne | TP | Autoritativt, men enkelt-emne |
| Sammenslått ukeplan, flere emner | ntnu.1024.no | Løser det, 2008-UX, ingen deling som URL |
| Kollisjonsvarsling (forelesning) | Delvis ntnu.1024.no (visuelt) | Ingen eksplisitt melding |
| Kollisjonsvarsling (eksamen) | **Ingen** | — |
| Karakterstatistikk | grades.no / karakterweb.no | Dypt, men isolert |
| Kvalitative emnevurderinger | emnr.no | Godt, men isolert, UGC cold-start |
| Studieplan per kull → emnevalg | NTNU emnesøk/studier (prosa) | Finnes, ikke interaktivt |
| Én samlet plan: emner + timeplan + eksamen + kreditter + programkontekst | **Ingen** | — |
| Delbar URL for "min plan" | **Ingen** (1024.no har kun kallenavn) | — |

Det åpenbare mønsteret: **hvert verktøy eier én kolonne**. Ingen har bygget
raden.

---

## Konklusjon: differensiert posisjon

Semesterplan sin posisjon er ikke "bedre emnesøk" eller "bedre timeplan" —
alle de fem undersøkte verktøyene gjør sin *ene* ting kompetent nok til å
ha overlevd (ett av dem i 18 år). Posisjonen er **sammenstillingen**: det
eneste stedet der et valg av emnekombinasjon umiddelbart viser seg selv som
en fungerende — eller kolliderende — helhet, med studieprogrammets egen
struktur som utgangspunkt i stedet for et blankt søkefelt. NTNU emnesøk
svarer "hva er dette emnet", TP svarer "når foreleses det", ntnu.1024.no
svarer "hvordan ser uka ut", emnr.no svarer "er det verdt det", grades.no
svarer "hvor vanskelig er det" — men *ingen* av dem svarer studentens
faktiske spørsmål, som alltid er sammensatt: "kan jeg ta disse fire emnene
sammen, i mitt studieløp, uten at noe kolliderer, og fortsatt lande på 30
studiepoeng?" Det spørsmålet krever at emnekatalog, timeplandata,
eksamensdata og studieplandata leses samtidig og skrives ut som étt objekt
— nøyaktig det ntnu-api/planleggeren allerede har adgang til og som ingen
konkurrent kombinerer.

**Tre kapabiliteter ingen etablert aktør tilbyr i dag:**

1. **Eksamenskollisjon/-tetthet på tvers av valgte emner.** Verken TP,
   1024.no, emnr.no eller karakterstatistikk-sidene viser eksamensdatoene
   for flere emner samtidig, langt mindre varsler når to eksamener havner
   samme dag eller tett inntil hverandre. Dette er rent tapt informasjon i
   dagens landskap — studenter oppdager det i praksis når semesterplanen
   for eksamen publiseres, ikke når de velger emner.

2. **Studieplan-forankret emnevalg med automatisk sammenslått plan.**
   NTNU sine studieplan-sider er prosa/tabell per kull; ingen av
   verktøyene lar en student starte fra "jeg går MTDT kull 2024" og få
   valgemnene i sitt eget kull/retning lagt rett inn i en levende,
   sjekkbar plan. 1024.no og TP er programblinde; emnr.no og
   grades.no er programblinde. Dette er data ntnu-api allerede har
   (`client.programs`, kull-baserte studieplaner) og som ligger helt
   ubrukt hos alle fem konkurrentene.

3. **Én delbar, tilstandsbærende URL for "min plan" uten innlogging.**
   TP krever Feide for noe som ligner en personlig plan; 1024.no bruker et
   ikke-unikt kallenavn som eneste "delingsmekanisme". Ingen tilbyr en plan
   som er både *personlig* (overlever reload, ingen konto) og *delbar*
   (send lenken til en kullkamerat, de ser nøyaktig samme oppsett). Med
   statisk site + URL-hash/localStorage er dette arkitektonisk gratis for
   Semesterplan og arkitektonisk fraværende hos alle fem andre.
