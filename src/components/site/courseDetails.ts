/**
 * Course-details island for `/emne/[code]/`: fetches `/api/course/:code`
 * and renders the facts panel, prose sections, exam table and credit
 * reductions into the static shell's "Om emnet" section.
 */

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
    el("p", "np-kicker details-prose-heading", heading),
    el("p", "details-prose-body", text),
  );
  return section;
}

function renderExams(exams: CourseExam[]): HTMLElement | null {
  if (exams.length === 0) return null;
  const wrap = el("div", "details-exams");
  wrap.append(el("p", "np-kicker details-prose-heading", "Eksamensdetaljer"));
  const table = el("table", "details-exam-table");
  const tbody = el("tbody");
  for (const exam of exams) {
    const row = el("tr");
    const parts = [exam.occasion, exam.season, exam.form].filter(Boolean).join(" · ");
    row.append(el("td", "np-data", parts));
    row.append(el("td", "np-data", exam.dateText ?? exam.date ?? "—"));
    row.append(el("td", "np-data", exam.timeText ?? exam.time ?? ""));
    row.append(el("td", "np-data", exam.duration ?? ""));
    row.append(el("td", "np-data", exam.aidCode ?? ""));
    tbody.append(row);
  }
  table.append(tbody);
  wrap.append(table);
  return wrap;
}

function renderCreditReductions(reductions: CreditReduction[]): HTMLElement | null {
  if (reductions.length === 0) return null;
  const wrap = el("div", "details-reductions");
  wrap.append(el("p", "np-kicker details-prose-heading", "Studiepoengreduksjon"));
  const list = el("ul", "details-reductions-list");
  for (const r of reductions) {
    const item = el("li");
    item.append(
      el("span", "np-data", r.courseCode),
      el("span", undefined, ` — ${r.reduction ?? "?"}${r.fromTerm ? ` (${r.fromTerm})` : ""}`),
    );
    list.append(item);
  }
  wrap.append(list);
  return wrap;
}

export async function mountCourseDetails(code: string): Promise<void> {
  const section = document.getElementById("details-section");
  const status = section?.querySelector<HTMLElement>('[data-role="status"]');
  const body = section?.querySelector<HTMLElement>('[data-role="body"]');
  if (!section || !status || !body || !code) return;

  try {
    const res = await fetch(`/api/course/${code}`);
    if (res.status === 404) {
      status.textContent = "ingen emnedetaljer funnet";
      return;
    }
    if (!res.ok) throw new Error(`${res.status}`);
    const details = (await res.json()) as CourseDetails;

    const facts = el("div", "details-facts");
    for (const row of [
      factRow("Studiepoeng", details.credits, true),
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

    for (const section of [
      prose("Faglig innhold", details.content),
      prose("Læringsutbytte", details.learningOutcome),
      prose("Læringsformer og aktiviteter", details.learningMethods),
      prose("Mer om vurdering", details.assessmentDetails),
      prose("Forkunnskapskrav", details.requiredKnowledge),
      prose("Anbefalte forkunnskaper", details.recommendedKnowledge),
    ]) {
      if (section) body.append(section);
    }

    if (details.mandatoryActivities.length > 0) {
      const wrap = el("div", "details-prose");
      wrap.append(el("p", "np-kicker details-prose-heading", "Obligatoriske aktiviteter"));
      const list = el("ul", "details-activities-list");
      for (const activity of details.mandatoryActivities)
        list.append(el("li", undefined, activity));
      wrap.append(list);
      body.append(wrap);
    }

    const examsEl = renderExams(details.exams);
    if (examsEl) body.append(examsEl);

    const reductionsEl = renderCreditReductions(details.creditReductions);
    if (reductionsEl) body.append(reductionsEl);

    status.hidden = true;
    body.hidden = false;
  } catch {
    status.textContent = "klarte ikke å hente emnedetaljer";
  }
}
