/**
 * Course-details island for `/emne/[code]/`: one fetch of `/api/course/:code`
 * feeding three places on the reordered page (REVIEW U10/U13):
 *   - the 9 key facts, below the week;
 *   - every prose section, collapsed into the page's one "Mer om emnet"
 *     disclosure — the encyclopedia stays available, it stops being the page;
 *   - the scraped exam enrichment (form/duration/aid code), which now hangs
 *     under the *catalog* exam headline instead of standing beside it as a
 *     peer section. DR-3 makes the catalog the authority and the scrape the
 *     enrichment; two peer exam blocks invited exactly the confusion the rule
 *     prevents.
 */
import { formatCreditNumber } from "../planner/dom.js";

interface CourseFact {
  label: string;
  value: string;
}

interface CreditReduction {
  courseCode: string;
  reduction: string | null;
  fromTerm: string | null;
}

interface CourseExam {
  occasion: string | null;
  season: string | null;
  form: string | null;
  weighting: string | null;
  aidCode: string | null;
  aidCodeDescription: string | null;
  date: string | null;
  dateText: string | null;
  time: string | null;
  timeText: string | null;
  duration: string | null;
  system: string | null;
}

interface CourseDetails {
  courseName: string | null;
  credits: number | null;
  level: string | null;
  teachingStart: string | null;
  teachingDuration: string | null;
  teachingLanguage: string | null;
  location: string | null;
  assessmentScheme: string | null;
  gradeRule: string | null;
  facts: CourseFact[];
  content: string | null;
  learningOutcome: string | null;
  learningMethods: string | null;
  mandatoryActivities: string[];
  assessmentDetails: string | null;
  requiredKnowledge: string | null;
  recommendedKnowledge: string | null;
  department: string | null;
  exams: CourseExam[];
  creditReductions: CreditReduction[];
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * `isData` marks values a student would copy into a calendar — counts,
 * dates, durations — which render mono per the Data-Is-Mono rule. Prose
 * categories (level, language, campus, assessment form...) stay grotesk.
 */
function factRow(label: string, value: string | number | null, isData = false): HTMLElement | null {
  if (value === null || value === "") return null;
  const row = el("div", "details-fact");
  row.append(
    el("span", "details-fact-label np-kicker", label),
    el("span", `details-fact-value${isData ? " np-data" : ""}`, String(value)),
  );
  return row;
}

function prose(heading: string, text: string | null): HTMLElement | null {
  if (!text) return null;
  const section = el("div", "details-prose");
  section.append(
    el("h3", "np-kicker details-prose-heading", heading),
    el("p", "details-prose-body", text),
  );
  return section;
}

/**
 * The scraped exam rows as enrichment under the catalog headline: form,
 * duration and aid code — the facts the catalog's `ExamDate` does not carry.
 * The date itself is deliberately NOT repeated here; it is the headline.
 */
function renderExamDetails(exams: CourseExam[]): HTMLElement | null {
  const rows = exams
    .map((exam) => {
      const head = [exam.occasion, exam.season, exam.form].filter(Boolean).join(" · ");
      const facts = [
        exam.timeText ?? exam.time,
        exam.duration,
        exam.aidCode ? `hjelpemidler ${exam.aidCode}` : null,
        exam.weighting,
      ].filter(Boolean);
      if (!head && facts.length === 0) return null;
      const row = el("li", "details-exam-row");
      if (head) row.append(el("span", "details-exam-form", head));
      if (facts.length > 0) row.append(el("span", "details-exam-facts np-data", facts.join(" · ")));
      return row;
    })
    .filter((row): row is HTMLLIElement => row !== null);
  if (rows.length === 0) return null;
  const list = el("ul", "details-exam-list");
  for (const row of rows) list.append(row);
  return list;
}

/**
 * Studiepoengreduksjon as a three-column table — emne · reduksjon · gjelder
 * fra. It was a bullet list of run-together sentences ("TDT4102 — 3,7 sp
 * (Høst 2008)"), which put the three values a student compares across rows
 * into one string, and TDT4100 renders eleven of them.
 *
 * De-duplicated on the whole (code, reduction, fromTerm) triple: upstream
 * carries one row per course *version*, so TDT4100 shipped the identical
 * "SIF8005 — 7,5 sp" three times with nothing to tell the copies apart. Rows
 * that differ in any field are kept — a course whose reduction changed with a
 * later term is two real facts, not a duplicate.
 */
function renderCreditReductions(reductions: CreditReduction[]): HTMLElement | null {
  if (reductions.length === 0) return null;

  const seen = new Set<string>();
  const rows = reductions.filter((r) => {
    const key = `${r.courseCode}|${r.reduction ?? ""}|${r.fromTerm ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  rows.sort((a, b) => a.courseCode.localeCompare(b.courseCode, "nb"));

  const wrap = el("div", "details-reductions");
  wrap.append(el("h3", "np-kicker details-prose-heading", "Studiepoengreduksjon"));

  const table = el("table", "details-reductions-table");
  const headRow = el("tr");
  for (const label of ["Emne", "Reduksjon", "Gjelder fra"]) {
    const th = el("th", undefined, label);
    th.setAttribute("scope", "col");
    headRow.append(th);
  }
  const thead = el("thead");
  thead.append(headRow);
  table.append(thead);

  const tbody = el("tbody");
  for (const r of rows) {
    const tr = el("tr");
    const code = el("td", "np-data", r.courseCode);
    // An em dash, not "?" and not an empty cell: the catalog genuinely does
    // not date the older reductions, and a blank cell reads as a render bug.
    tr.append(
      code,
      el("td", "np-data", r.reduction ?? "—"),
      el("td", undefined, r.fromTerm ?? "—"),
    );
    tbody.append(tr);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

export async function mountCourseDetails(code: string): Promise<void> {
  const section = document.getElementById("details-section");
  const status = section?.querySelector<HTMLElement>('[data-role="status"]');
  const body = section?.querySelector<HTMLElement>('[data-role="body"]');
  const proseHost = section?.querySelector<HTMLElement>('[data-role="prose"]');
  const proseWrap = section?.querySelector<HTMLElement>('[data-role="prose-wrap"]');
  if (!section || !status || !body || !proseHost || !code) return;

  try {
    const res = await fetch(`/api/course/${encodeURIComponent(code)}`);
    if (res.status === 404) {
      status.textContent = "Vi har ingen emnedetaljer for dette emnet.";
      return;
    }
    if (!res.ok) throw new Error(`${res.status}`);
    const details = (await res.json()) as CourseDetails;

    const facts = el("div", "details-facts");
    for (const row of [
      factRow(
        "Studiepoeng",
        details.credits === null ? null : formatCreditNumber(details.credits),
        true,
      ),
      factRow("Nivå", details.level),
      factRow("Undervises", details.teachingStart, true),
      factRow("Varighet", details.teachingDuration, true),
      factRow("Undervisningsspråk", details.teachingLanguage),
      factRow("Sted", details.location),
      factRow("Vurderingsform", details.assessmentScheme),
      factRow("Karakterregel", details.gradeRule),
      factRow("Ansvarlig enhet", details.department),
    ]) {
      if (row) facts.append(row);
    }
    body.append(facts);

    for (const block of [
      prose("Faglig innhold", details.content),
      prose("Læringsutbytte", details.learningOutcome),
      prose("Læringsformer og aktiviteter", details.learningMethods),
      prose("Mer om vurdering", details.assessmentDetails),
      prose("Forkunnskapskrav", details.requiredKnowledge),
      prose("Anbefalte forkunnskaper", details.recommendedKnowledge),
    ]) {
      if (block) proseHost.append(block);
    }

    if (details.mandatoryActivities.length > 0) {
      const wrap = el("div", "details-prose");
      wrap.append(el("h3", "np-kicker details-prose-heading", "Obligatoriske aktiviteter"));
      const list = el("ul", "details-activities-list");
      for (const activity of details.mandatoryActivities)
        list.append(el("li", undefined, activity));
      wrap.append(list);
      proseHost.append(wrap);
    }

    const reductionsEl = renderCreditReductions(details.creditReductions);
    if (reductionsEl) proseHost.append(reductionsEl);

    if (proseWrap) proseWrap.hidden = proseHost.childElementCount === 0;

    // Exam enrichment lands in the exam block above, never as a peer section.
    const examMore = document.querySelector<HTMLElement>('#exam-section [data-role="exam-more"]');
    const examBody = document.querySelector<HTMLElement>('#exam-section [data-role="exam-body"]');
    const examDetails = renderExamDetails(details.exams);
    if (examMore && examBody && examDetails) {
      examBody.replaceChildren(examDetails);
      examMore.hidden = false;
    }

    status.hidden = true;
    body.hidden = false;
  } catch {
    status.textContent = "Klarte ikke å hente emnedetaljer.";
  }
}
