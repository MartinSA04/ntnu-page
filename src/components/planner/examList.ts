/**
 * EKSAMENER — the exam section (PRODUCT.md DR-3). Two things, in this order
 * (REWORK-2026-07-29c): a **month band** that shows the shape of the exam
 * period at a glance, and under it a **list** whose only rule runs down its
 * own margin.
 *
 * The section exists to answer "how brutal is December", not "when is my
 * exam" — and everything that answers it was already in the model and set in
 * the smallest, greyest type on the page: the whole-day gap to the next exam,
 * a `tight` flag under two days, a `sameDay` flag. The date, the one thing a
 * student cannot change, was the largest.
 *
 * So the gap carries the weight now, and it is drawn as a *distance* rather
 * than a *division*. Three gaps used to draw nine horizontal rules — each
 * connector had a border above it, a border below it and a bar through the
 * middle — and a rule across a list divides it in two. The one rule left is
 * vertical: exams are knots on it (the same mark as the course list's dot, so
 * a colour means one thing everywhere) and the gaps hang between them.
 *
 * A same-day pair gets no connector — zero distance is not a distance. The
 * band splits that day into both courses' hues with a collision ring, and
 * `clashLines` names both courses in words underneath, because neither the
 * split nor the ring survives a screen reader, a printout or colour blindness.
 *
 * Sourced from catalog `ExamDate` via the planner index (`examsFromIndex`);
 * the scraped `CourseExam` list is used for exactly one thing, telling an
 * ordinary sitting from a deferred one (see `collectExamInputs`). Dateless
 * exams stay listed, never dropped, as `.exam-dateless` rows. A message
 * (nothing found, nothing published) renders in the same host rather than in
 * a box of its own.
 *
 * The sort/gap/tight/sameDay/countdown math itself lives in the pure,
 * unit-tested `buildExamList` (examSchedule.ts) — this module is DOM-only.
 */

import { isDeferredOccasion } from "ntnu-api";
import {
  type CourseExam,
  type ExamWindow,
  examsFromIndex,
  type PlannerIndex,
  type PlannerIndexCourse,
} from "../../lib/planner/data.js";
import {
  buildExamList,
  type ExamListInput,
  type ExamListRow,
} from "../../lib/planner/examSchedule.js";
import { el, formatShortDate, MONTH_ABBR } from "./dom.js";
import type { PlanCourseState } from "./types.js";

/**
 * Is this scraped sitting a deferred ("utsatt"/kont) one? DR-3 wants ordinary
 * sittings only, and the catalog cannot say: `continuation` is `false` on all
 * 2 438 catalog exam rows, so `crawler/transform.mjs`'s filter is correct code
 * fed a flag upstream never sets (exams-1). `occasion` is the honest signal —
 * "Ordinær eksamen" vs "Utsatt eksamen".
 *
 * Now `ntnu-api`'s, and re-exported here so DR-3's readers keep one import:
 * which wordings NTNU prints is a fact about NTNU, and `ntnu-mcp` was filtering
 * on the dead `continuation` flag for want of this. `ExamDate.continuation`
 * now documents its own uselessness upstream too, so the next consumer does
 * not have to rediscover it.
 *
 * Still read as a **label only**, never re-parsed for a date (DR-3), and still
 * fail-open: an occasion we do not recognise keeps its exam. Deleting a real
 * exam date is far worse than listing one too many.
 */
export { isDeferredOccasion };

/**
 * Does the scraped exam list say this catalog date is a deferred sitting?
 *
 * The join is on the **exact ISO date** — the one structured field both sides
 * carry — and only decides when the scrape actually knows that date and every
 * sitting it lists there is deferred. No scrape (details 404'd, still in
 * flight), no match, or a mixed day all keep the exam.
 */
function isDeferredOn(date: string | null, scraped: CourseExam[] | null | undefined): boolean {
  if (date === null || !scraped) return false;
  const onDate = scraped.filter((e) => e.date === date);
  if (onDate.length === 0) return false;
  return onDate.every((e) => isDeferredOccasion(e.occasion));
}

/**
 * Collects one exam input per catalog-sourced exam occasion (dated or not)
 * across the plan's courses, with deferred sittings joined out (exams-1).
 *
 * When the join removes *every* sitting a course has in this semester, the
 * course still gets one dateless input rather than vanishing: MGLU1106's only
 * dated Høst 2026 sittings are utsatt and its real Vår 2027 ordinary sitting
 * carries no date, so "dato ikke satt" is what we know — "no exam" is not.
 */
export function collectExamInputs(
  courses: PlanCourseState[],
  semesterId: string,
  index: PlannerIndex | null,
  window: ExamWindow | null,
): ExamListInput[] {
  if (!index) return [];
  const byCode = new Map<string, PlannerIndexCourse>(index.courses.map((c) => [c[0], c]));
  const inputs: ExamListInput[] = [];
  for (const state of courses) {
    const row = byCode.get(state.course.code);
    if (!row) continue;
    const catalog = examsFromIndex(row, semesterId, window);
    if (catalog.length === 0) continue;
    const scraped = state.bundle?.details?.exams ?? null;
    const kept = catalog.filter((exam) => !isDeferredOn(exam.date, scraped));
    if (kept.length === 0) {
      inputs.push({ code: state.course.code, date: null });
      continue;
    }
    inputs.push(...kept);
  }
  return inputs;
}

export interface ExamRenderOptions {
  /**
   * A course bundle or the planner index is still loading. Nothing is
   * asserted about the exam list until it isn't — "Ingen eksamensdatoer
   * funnet" while the fetch is in flight is the same false-and-loud statement
   * U5 removed from the week.
   */
  loading?: boolean;
}

export interface ExamRenderResult {
  collisionCount: number;
  /** Which branch rendered. Only `"list"` carries a meaningful `collisionCount`. */
  state: "list" | "empty" | "loading";
}

function renderEmpty(listHost: HTMLElement, message: string | null): ExamRenderResult {
  listHost.replaceChildren(...(message ? [el("p", "exam-empty np-hint", message)] : []));
  return {
    collisionCount: 0,
    state: message === null ? "loading" : "empty",
  };
}

/**
 * Renders a message where the list would be — the exam half of
 * `renderGridMessage`. Use it when the CALLER knows something the list
 * cannot work out for itself: C3's case is a semester the shipped index does
 * not cover at all, where "Ingen eksamensdatoer funnet ennå" would be a
 * finding reported by something that never looked. Pass no message to just
 * empty the host.
 *
 * `action` is the one recovery the panel can offer: a failed download of our
 * own catalog is retryable, and without a control the column simply spun
 * forever (pd-3/ux-fail-7).
 */
export function renderExamMessage(
  listHost: HTMLElement,
  message?: string | null,
  action?: { label: string; run: () => void } | null,
): ExamRenderResult {
  const result = renderEmpty(listHost, message ?? null);
  if (message && action) {
    const button = el("button", "np-btn", action.label);
    button.type = "button";
    button.addEventListener("click", action.run);
    listHost.append(button);
  }
  return result;
}

/**
 * The month band (REWORK-2026-07-29c): one row per month the exam period
 * touches, one cell per day, exam days printed in the course's own hue.
 *
 * It answers the question the list answers slowly — *how clustered is this* —
 * before a single date is read, and it costs about 40 px. Weekends carry a
 * heavier ground so the week rhythm reads, which is what makes a cluster look
 * like a cluster rather than like four evenly-spaced marks.
 */
function examBand(rows: ExamListRow[], hueByCode: Map<string, string>): HTMLElement | null {
  const dated = rows.filter((r) => r.date);
  const first = dated[0];
  const last = dated[dated.length - 1];
  if (!first || !last) return null;

  const byDate = new Map<string, ExamListRow[]>();
  for (const row of dated) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);

  const band = el("div", "exam-band");
  band.setAttribute("aria-hidden", "true");

  let year = Number(first.date.slice(0, 4));
  let month = Number(first.date.slice(5, 7));
  const lastYear = Number(last.date.slice(0, 4));
  const lastMonth = Number(last.date.slice(5, 7));
  // A guard, not a belt: an exam period spanning more than a year would be
  // upstream nonsense, and an unbounded loop over it would hang the page.
  for (let guard = 0; guard < 24; guard++) {
    const row = el("div", "exam-band-row");
    row.append(el("span", "exam-band-name np-data", MONTH_ABBR[month - 1] ?? ""));
    const days = el("div", "exam-band-days");
    const inMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    for (let day = 1; day <= 31; day++) {
      if (day > inMonth) {
        days.append(el("span", "exam-band-day is-void"));
        continue;
      }
      const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
      const cell = el(
        "span",
        `exam-band-day${weekday === 0 || weekday === 6 ? " is-weekend" : ""}`,
      );
      const on = byDate.get(iso);
      if (on) {
        cell.classList.add("is-exam");
        if (on.length > 1) cell.classList.add("is-clash");
        cell.style.background = dayFill(on, hueByCode);
      }
      days.append(cell);
    }
    row.append(days);
    band.append(row);
    if (year === lastYear && month === lastMonth) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return band;
}

/**
 * The fill for one day cell. One exam is a solid printed hue; several are the
 * same hues split into equal hard-edged bands, in code order so the same pair
 * always splits the same way.
 *
 * A colliding day is NOT a flat red square. Red says "something collides
 * here" and throws away the one fact a student would act on — *which two* —
 * so the hues stay and the collision is marked by a ring instead
 * (`.is-clash` in the stylesheet). A ring is a different KIND of mark from a
 * fill, which is what lets it out-shout five hues without erasing them
 * (Red-Is-Collision).
 */
function dayFill(rows: ExamListRow[], hueByCode: Map<string, string>): string {
  const ink = (code: string): string =>
    `color-mix(in srgb, var(${hueByCode.get(code) ?? "--hue-blue"}) var(--block-mix), var(--block-base))`;
  const codes = [...new Set(rows.map((r) => r.code))].sort();
  const [only] = codes;
  if (codes.length === 1 && only) return ink(only);
  const step = 100 / codes.length;
  const stops = codes
    .map((code, i) => `${ink(code)} ${(i * step).toFixed(2)}% ${((i + 1) * step).toFixed(2)}%`)
    .join(", ");
  return `linear-gradient(90deg, ${stops})`;
}

/**
 * One dated row: the date in the left margin, then a knot on the list's single
 * vertical rule carrying the course, its vurderingsform and — on the first
 * upcoming exam only — a countdown.
 *
 * The knot is the same mark as the course list's `.np-dot`, so a colour means
 * one thing wherever it appears.
 *
 * The vurderingsform ("Skriftlig skoleeksamen", "Mappevurdering") used to sit
 * in the Emner course row, where it was one clause of a run-on meta line about
 * a course. It is exam material and this is the exam section
 * (REWORK-2026-07-29 D6): here it is the fact that tells a student whether a
 * date on the list is something to revise for or something to hand in.
 */
function examRow(row: ExamListRow, hueVar: string, scheme: string | null): HTMLLIElement {
  const item = el("li", "exam-row");
  const date = el("span", "exam-date np-data");
  date.append(el("span", "exam-weekday", row.weekday));
  date.append(formatShortDate(row.date));
  item.append(date);

  const what = el("span", "exam-what");
  what.style.setProperty("--dot", `var(${hueVar})`);
  what.append(el("span", "exam-code np-data", row.code));
  if (scheme) what.append(el("span", "exam-form", scheme));
  if (row.daysFromToday !== null) {
    what.append(el("span", "exam-away np-data", daysFromTodayText(row.daysFromToday)));
  }
  item.append(what);
  return item;
}

/** "i dag" / "om 1 dag" / "om {n} dager" — the singular/plural split every
 * other day-count sentence in this codebase already makes (D3). */
function daysFromTodayText(days: number): string {
  if (days === 0) return "i dag";
  if (days === 1) return "om 1 dag";
  return `om ${days} dager`;
}

/**
 * The distance to the next exam, hung on the rule between two knots.
 *
 * It is a distance, not a division — which is why it is no longer a row with a
 * border above it, a border below it and a bar through the middle. Three gaps
 * used to draw nine horizontal rules; the list's only rule now runs *along* it.
 *
 * `row.gapToNext === 0` is the reliable same-day signal for THIS connector
 * specifically — `row.sameDay` can also be true because of the row's
 * relationship with the PREVIOUS row, which says nothing about the gap to the
 * next one. A same-day pair gets no connector at all: it is named in words
 * under the list instead (`clashLine`), because zero distance is not a
 * distance.
 */
function examGap(row: ExamListRow): HTMLLIElement | null {
  if (row.gapToNext === null || row.gapToNext === 0) return null;
  // LESEDAGER, not the distance between the dates. Exams on the 15th and the
  // 17th are two days apart and leave exactly one day to revise — you sit an
  // exam on both of the others — so "2 dagers mellomrom" overstated the room by
  // a whole day. It is also the word students use for it.
  //
  // The genitive "dagers mellomrom" needed (copy-8) does not arise: "lesedager"
  // is a plain plural noun, not a measure phrase modifying one. And no "· tett"
  // suffix any more — "ingen lesedager" already says the tight case outright,
  // in the unit the reader cares about.
  const days = row.readingDays ?? 0;
  const text = days === 0 ? "ingen lesedager" : days === 1 ? "1 lesedag" : `${days} lesedager`;
  const item = el("li", "exam-gap np-data", text);
  if (row.tight) item.classList.add("is-tight");
  return item;
}

/**
 * One sentence per colliding date, naming both courses.
 *
 * The split cell in the band and the red ring around it are the fast read; this
 * is the one that survives a screen reader, a printout and colour blindness.
 * Red-Is-Collision requires the copy to name both things, not just mark them.
 */
function clashLines(rows: ExamListRow[]): HTMLElement[] {
  const byDate = new Map<string, ExamListRow[]>();
  for (const row of rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  const out: HTMLElement[] = [];
  for (const [date, list] of byDate) {
    if (list.length < 2) continue;
    const codes = [...new Set(list.map((r) => r.code))];
    const names = codes.length === 2 ? codes.join(" og ") : codes.join(", ");
    const line = el("p", "exam-clash np-note-clash");
    line.append(`${names} er samme dag — `);
    line.append(el("span", "np-data", `${list[0]?.weekday ?? ""} ${formatShortDate(date)}`));
    out.push(line);
  }
  return out;
}

/** One "dato ikke satt" row (DR-3) — kept, not dropped, so the course isn't
 *  silently missing. Also where a course whose only sittings this semester are
 *  deferred lands, so the kont filter never reads as "no exam" (exams-1). */
function datelessRow(code: string, hueVar: string, scheme: string | null): HTMLLIElement {
  const item = el("li", "exam-row exam-dateless");
  item.append(el("span", "exam-date np-data", "—"));
  const what = el("span", "exam-what");
  what.style.setProperty("--dot", `var(${hueVar})`);
  what.append(el("span", "exam-code np-data", code));
  if (scheme) what.append(el("span", "exam-form", scheme));
  what.append(el("span", "exam-away np-data", "dato ikke satt"));
  item.append(what);
  return item;
}

/** Renders the chronological exam list into `listHost`. */
export function renderExamList(
  listHost: HTMLElement,
  courses: PlanCourseState[],
  semesterId: string,
  index: PlannerIndex | null,
  window: ExamWindow | null,
  todayIso: string,
  options: ExamRenderOptions = {},
): ExamRenderResult {
  const loading = options.loading ?? false;
  if (courses.length === 0) {
    return renderEmpty(listHost, "Legg til emner for å se eksamensdatoer.");
  }

  const hueByCode = new Map(courses.map((c) => [c.course.code, c.hueVar]));
  // Vurderingsform per course (D6). `null` where the bundle has not landed or
  // the catalog does not say — an absent scheme is simply not printed, never
  // guessed at.
  const schemeByCode = new Map(
    courses.map((c) => [c.course.code, c.bundle?.details?.assessmentScheme ?? null]),
  );
  const inputs = collectExamInputs(courses, semesterId, index, window);

  if (inputs.length === 0) {
    return renderEmpty(
      listHost,
      loading ? null : "Ingen eksamensdatoer funnet ennå for emnene i planen.",
    );
  }

  const model = buildExamList(inputs, todayIso);

  if (model.rows.length === 0) {
    // Dated rows are empty, but dateless exams exist: still list them, under
    // one line saying no date is set rather than dropping them silently.
    const list = el("ul", "exam-list");
    for (const code of model.dateless) {
      list.append(
        datelessRow(code, hueByCode.get(code) ?? "--hue-blue", schemeByCode.get(code) ?? null),
      );
    }
    listHost.replaceChildren(
      el("p", "exam-empty np-hint", "Ingen eksamensdatoer satt ennå for emnene i planen."),
      list,
    );
    return { collisionCount: 0, state: "empty" };
  }

  const list = el("ul", "exam-list");
  for (const row of model.rows) {
    list.append(
      examRow(row, hueByCode.get(row.code) ?? "--hue-blue", schemeByCode.get(row.code) ?? null),
    );
    // No connector after the last row, and none across a same-day pair —
    // `examGap` returns null for both.
    const gap = examGap(row);
    if (gap) list.append(gap);
  }
  for (const code of model.dateless) {
    list.append(
      datelessRow(code, hueByCode.get(code) ?? "--hue-blue", schemeByCode.get(code) ?? null),
    );
  }

  // Band first: the shape of the period, then the dates that make it up.
  const band = examBand(model.rows, hueByCode);
  listHost.replaceChildren(...(band ? [band] : []), list, ...clashLines(model.rows));

  // How many exam rows actually share their day with another (`sameDay` is set
  // on EVERY row of a same-date cluster) — so the caller's verdict reads "3
  // eksamener samme dag" for a 3-way clash, not the 2 adjacent-pair connectors
  // that `gapToNext === 0` would have counted.
  const collisionCount = model.rows.filter((row) => row.sameDay).length;

  return { collisionCount, state: "list" };
}
