/**
 * Grades island for `/emne/[code]/`: fetches `/api/course/:code/grades` and
 * renders a per-year horizontal stacked bar chart with a mono legend and
 * per-year totals. GDPR-masked null counts (DBH suppresses small cells)
 * render as "<5".
 *
 * Color treatment: a grade distribution is not course identity, so it does
 * not get the categorical hues, and Red-Is-Collision reserves --clash for
 * timetable/exam clashes only — a strykprosent is not a collision. Pass
 * grades (A–E) step through --accent at decreasing opacity (A brightest);
 * fail grades ("F", "ikke bestått") render in --muted. Single ink, ordered
 * by opacity, not by hue.
 */

interface GradeRow {
  courseCode: string;
  year: number;
  semester: number | null;
  semesterName: string | null;
  grade: string;
  total: number | null;
  women: number | null;
  men: number | null;
}

const PASS_OPACITY: Record<string, number> = {
  A: 1,
  B: 0.84,
  C: 0.68,
  D: 0.52,
  E: 0.36,
  BESTÅTT: 1,
};

const FAIL_GRADES = new Set(["F", "IKKE BESTÅTT"]);

function gradeColor(grade: string): string {
  if (FAIL_GRADES.has(grade)) return "var(--muted)";
  const opacity = PASS_OPACITY[grade] ?? 1;
  return `color-mix(in srgb, var(--accent) ${opacity * 100}%, transparent)`;
}

const GRADE_ORDER = ["A", "B", "C", "D", "E", "F", "BESTÅTT", "IKKE BESTÅTT"];

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

function normalizeGrade(grade: string): string {
  return grade.trim().toUpperCase();
}

export async function mountCourseGrades(code: string): Promise<void> {
  const section = document.getElementById("grades-section");
  const status = section?.querySelector<HTMLElement>('[data-role="status"]');
  const body = section?.querySelector<HTMLElement>('[data-role="body"]');
  if (!section || !status || !body || !code) return;

  try {
    const res = await fetch(`/api/course/${code}/grades`);
    if (!res.ok) throw new Error(`${res.status}`);
    const { rows } = (await res.json()) as { rows: GradeRow[] };

    if (rows.length === 0) {
      status.textContent = "ingen karakterstatistikk funnet";
      return;
    }

    const byYear = new Map<number, GradeRow[]>();
    for (const row of rows) {
      const list = byYear.get(row.year) ?? [];
      list.push(row);
      byYear.set(row.year, list);
    }
    const years = [...byYear.keys()].sort((a, b) => b - a);

    const chart = el("div", "grades-chart");
    for (const year of years) {
      const yearRows = byYear.get(year) ?? [];
      const totals = new Map<string, number | null>();
      let knownTotal = 0;
      let hasMasked = false;
      for (const row of yearRows) {
        const grade = normalizeGrade(row.grade);
        const existing = totals.get(grade) ?? 0;
        if (row.total === null) {
          hasMasked = true;
          totals.set(grade, existing);
        } else {
          totals.set(grade, (existing ?? 0) + row.total);
          knownTotal += row.total;
        }
      }

      const yearRow = el("div", "grades-year-row");
      yearRow.append(el("span", "grades-year-label np-data", String(year)));

      const bar = el("div", "grades-bar");
      const present = GRADE_ORDER.filter((g) => totals.has(g));
      for (const grade of present) {
        const count = totals.get(grade) ?? 0;
        if (count <= 0 && knownTotal === 0) continue;
        const pct = knownTotal > 0 ? (count / knownTotal) * 100 : 0;
        const segment = el("div", "grades-segment");
        segment.style.background = gradeColor(grade);
        segment.style.width = `${pct}%`;
        segment.title = `${grade}: ${count}`;
        if (pct > 0) bar.append(segment);
      }
      yearRow.append(bar);

      const totalLabel = hasMasked ? `${knownTotal}+ (maskert <5)` : String(knownTotal);
      yearRow.append(el("span", "grades-year-total np-data", totalLabel));
      chart.append(yearRow);
    }
    body.append(chart);

    const legend = el("div", "grades-legend");
    const usedGrades = new Set(rows.map((r) => normalizeGrade(r.grade)));
    for (const grade of GRADE_ORDER) {
      if (!usedGrades.has(grade)) continue;
      const item = el("span", "grades-legend-item np-data");
      const swatch = el("span", "grades-legend-swatch");
      swatch.style.background = gradeColor(grade);
      item.append(swatch, document.createTextNode(grade));
      legend.append(item);
    }
    body.append(legend);

    status.hidden = true;
    body.hidden = false;
  } catch {
    status.textContent = "klarte ikke å hente karakterstatistikk";
  }
}
