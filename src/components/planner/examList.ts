/**
 * EKSAMENER — the exam section (DR-3). A **month band** showing the shape of
 * the exam period at a glance, and under it a **list** whose only rule runs
 * down its own margin.
 *
 * The section answers "how brutal is December", not "when is my exam", so the
 * gap between exams carries the weight — drawn as a *distance* rather than a
 * *division*. The one rule left is vertical: exams are knots on it (the same
 * mark as the course list's dot, so a colour means one thing everywhere) and
 * the gaps hang between them.
 *
 * A same-day pair gets no connector — zero distance is not a distance. The band
 * splits that day into both hues with a collision ring, and `clashLines` names
 * both courses in words, because neither the split nor the ring survives a
 * screen reader, a printout or colour blindness.
 *
 * Sourced from catalog `ExamDate` via `examsFromIndex`; the scraped
 * `CourseExam` list tells an ordinary sitting from a deferred one and nothing
 * else. Dateless exams stay listed, never dropped.
 *
 * The sort/gap/tight/sameDay/countdown math lives in the pure, unit-tested
 * `buildExamList` (examSchedule.ts) — this module is DOM-only.
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
 * 2 438 catalog exam rows, so a filter on it is correct code fed a flag
 * upstream never sets. `occasion` is the honest signal.
 *
 * Now `ntnu-api`'s and re-exported here, because which wordings NTNU prints is
 * a fact about NTNU. Read as a **label only**, never re-parsed for a date, and
 * fail-open: an unrecognised occasion keeps its exam, since deleting a real
 * exam date is far worse than listing one too many.
 */
export { isDeferredOccasion };

/**
 * Does the scraped exam list say this catalog date is a deferred sitting?
 *
 * The join is on the **exact ISO date** — the one structured field both sides
 * carry — and only decides when the scrape knows that date and every sitting
 * it lists there is deferred. No scrape, no match, or a mixed day keeps it.
 */
function isDeferredOn(date: string | null, scraped: CourseExam[] | null | undefined): boolean {
  if (date === null || !scraped) return false;
  const onDate = scraped.filter((e) => e.date === date);
  if (onDate.length === 0) return false;
  return onDate.every((e) => isDeferredOccasion(e.occasion));
}

/**
 * One exam input per catalog-sourced occasion (dated or not) across the plan's
 * courses, with deferred sittings joined out.
 *
 * When the join removes *every* sitting a course has this semester, the course
 * still gets one dateless input rather than vanishing: "dato ikke satt" is what
 * we know — "no exam" is not.
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
   * A course bundle or the planner index is still loading. Nothing is asserted
   * about the exam list until it is not — "Ingen eksamensdatoer funnet" mid
   * fetch is the same false-and-loud statement U5 removed from the week.
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
 * `renderGridMessage`. For what the CALLER knows and the list cannot work out:
 * a semester the shipped index does not cover at all, where "Ingen
 * eksamensdatoer funnet ennå" would be a finding reported by something that
 * never looked. Pass no message to just empty the host.
 *
 * `action` is the one recovery the panel can offer: a failed download of our
 * own catalog is retryable, and without it the column simply spun forever.
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
 * The month band: one row per month the exam period touches, one cell per day,
 * exam days printed in the course's own hue. It answers *how clustered is this*
 * before a date is read, for about 40 px. Weekends carry a heavier ground so
 * the week rhythm reads, which is what makes a cluster look like one.
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
 * same hues split into hard-edged bands, in code order so a pair always splits
 * the same way.
 *
 * A colliding day is NOT a flat red square — red would throw away the one fact
 * a student acts on, *which two*. The hues stay and the collision is a ring: a
 * different KIND of mark from a fill, which is what lets it out-shout five hues
 * without erasing them (Red-Is-Collision).
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
 * upcoming exam only — a countdown. The knot is the same mark as the course
 * list's `.np-dot`.
 *
 * The vurderingsform is exam material and this is the exam section (D6): it is
 * what tells a student whether a date is something to revise for or hand in.
 */
function examRow(row: ExamListRow, hueVar: string, scheme: string | null): HTMLLIElement {
  const item = el("li", "exam-row");
  // THE DATE IS TYPOGRAPHY, NOT A BADGE: the day in full ink and weight, the
  // month muted beside it. A student scanning this column is looking for a
  // number, and every date in it shares a month with its neighbours.
  const date = el("span", "exam-date np-data");
  const short = formatShortDate(row.date);
  const split = short.indexOf(" ");
  if (split === -1) {
    date.append(short);
  } else {
    date.append(el("b", "exam-day", short.slice(0, split)));
    date.append(" ");
    date.append(el("span", "exam-month", short.slice(split + 1)));
  }
  item.append(date);

  const what = el("span", "exam-what");
  what.style.setProperty("--dot", `var(${hueVar})`);
  what.append(el("span", "exam-code np-data", row.code));
  if (scheme) what.append(el("span", "exam-form", scheme));
  item.append(what);

  // The weekday, at the far end. It used to sit in front of the date, where it
  // pushed the one figure being scanned off the column's own edge — and "lør"
  // matters most as an afterthought ("…that one's a Saturday"), not first.
  item.append(el("span", "exam-weekday np-data", row.weekday));

  return item;
}

/**
 * The countdown to the first exam not yet sat — hung on the rule ABOVE its
 * knot, in the same idiom as the reading-day connectors below it (`examGap`).
 *
 * As a third cell of the row it had no column to sit in on a phone, so it
 * dropped to a second grid row and made one row two lines tall with a hole
 * beside it. Every escape from that was worse: at 390 px there is genuinely no
 * width for a date, a code, a vurderingsform and a countdown on one line.
 *
 * Making it a segment is what it always was: the list is a chain of distances
 * along one rule, and this was the only link drawn as a badge on a knot.
 */
function awayLine(row: ExamListRow): HTMLLIElement | null {
  if (row.daysFromToday === null) return null;
  // `is-away` and not `is-tight`: a distance from today is not a verdict on
  // how much revision room there is, and red here would claim one.
  const away = el("li", "exam-gap is-away np-data");
  away.append(el("span", "exam-gap-text", daysFromTodayText(row.daysFromToday)));
  away.append(el("i", "exam-gap-rule"));
  return away;
}

/**
 * The list's closing line: how far off the first exam is, and the one caveat
 * about exam data that is true of every row and belongs on none of them.
 *
 * The ROOM is the caveat worth spending a line on. NTNU publishes exam dates
 * months before it publishes where you sit them, and a list that shows a date,
 * a code and a vurderingsform without ever mentioning rooms reads as though it
 * simply failed to fetch one — which is the same shape as a bug.
 */
function examFoot(rows: ExamListRow[]): HTMLElement[] {
  const next = rows.find((row) => row.daysFromToday !== null && row.daysFromToday >= 0);
  const away =
    next?.daysFromToday == null
      ? null
      : next.daysFromToday === 0
        ? "Første eksamen er i dag."
        : next.daysFromToday === 1
          ? "Første eksamen om 1 dag."
          : `Første eksamen om ${next.daysFromToday} dager.`;
  return [
    el("p", "exam-foot np-hint", `${away ? `${away} ` : ""}Eksamensrom tildeles noen dager før.`),
  ];
}

/** "i dag" / "om 1 dag" / "om {n} dager" — the singular/plural split every
 * other day-count sentence in this codebase already makes (D3). */
function daysFromTodayText(days: number): string {
  if (days === 0) return "i dag";
  if (days === 1) return "om 1 dag";
  return `om ${days} dager`;
}

/**
 * The distance to the next exam, hung on the rule between two knots. It is a
 * distance, not a division — the list's only rule runs *along* it.
 *
 * `row.gapToNext === 0` is the reliable same-day signal for THIS connector —
 * `row.sameDay` can also be true because of the PREVIOUS row, which says
 * nothing about the gap to the next. A same-day pair gets no connector at all
 * and is named in words under the list instead (`clashLine`).
 */
function examGap(row: ExamListRow): HTMLLIElement | null {
  if (row.gapToNext === null || row.gapToNext === 0) return null;
  // LESEDAGER, not the distance between the dates. Exams on the 15th and the
  // 17th are two days apart and leave exactly one day to revise, so "2 dagers
  // mellomrom" overstated the room by a whole day. "ingen lesedager" already
  // says the tight case outright, in the unit the reader cares about.
  const days = row.readingDays ?? 0;
  const text = days === 0 ? "ingen lesedager" : days === 1 ? "1 lesedag" : `${days} lesedager`;
  // The distance drawn as distance: the words, then a hairline running out to
  // the edge, so the row reads as the SPACE between two dates rather than as a
  // third entry in the list. It replaced a vertical rule the exams hung off as
  // knots — the same idea, turned the way the list actually runs, and one less
  // line down a page whose whole structure is now type, hairlines and space.
  const item = el("li", "exam-gap np-data");
  item.append(el("span", "exam-gap-text", text));
  item.append(el("i", "exam-gap-rule"));
  if (row.tight) item.classList.add("is-tight");
  return item;
}

/**
 * One sentence per colliding date, naming both courses. The split cell and the
 * red ring are the fast read; this is the one that survives a screen reader, a
 * printout and colour blindness. Red-Is-Collision requires naming both things.
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
    line.append(`${names} er samme dag: `);
    line.append(el("span", "np-data", `${list[0]?.weekday ?? ""} ${formatShortDate(date)}`));
    out.push(line);
  }
  return out;
}

/** One "dato ikke satt" row (DR-3) — kept, not dropped, so the course isn't
 *  silently missing. Also where a course whose only sittings this semester are
 *  deferred lands, so the kont filter never reads as "no exam". */
function datelessRow(code: string, hueVar: string, scheme: string | null): HTMLLIElement {
  const item = el("li", "exam-row exam-dateless");
  // The date cell is left empty rather than filled with a dash: the row's
  // own third column already says "dato ikke satt" in words.
  item.append(el("span", "exam-date np-data"));
  const what = el("span", "exam-what");
  what.style.setProperty("--dot", `var(${hueVar})`);
  what.append(el("span", "exam-code np-data", code));
  if (scheme) what.append(el("span", "exam-form", scheme));
  item.append(what);
  item.append(el("span", "exam-away np-data", "dato ikke satt"));
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
  // Nothing to list, and nothing to apologise for: the planner hides the whole
  // Eksamener section at zero active courses (`renderSectionPresence`), so this
  // renders into a box nobody can see. Not `renderEmpty(host, null)` — that
  // spelling means "loading" there, and this is not loading, it is empty. The
  // copy it replaces ("Legg til emner for å se eksamensdatoer.") was wrong
  // anyway for a plan whose courses are all dropped.
  if (courses.length === 0) {
    listHost.replaceChildren();
    return { collisionCount: 0, state: "empty" };
  }

  const hueByCode = new Map(courses.map((c) => [c.course.code, c.hueVar]));
  // Vurderingsform per course (D6). `null` where the bundle has not landed or
  // the catalog does not say — an absent scheme is not printed, never guessed.
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
    // The distance from today comes BEFORE the exam it measures to — it is the
    // first link in the same chain the reading-day connectors continue.
    const away = awayLine(row);
    if (away) list.append(away);
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

  // Band first: the shape of the period, then the dates that make it up, then
  // the one thing the dates cannot say for themselves.
  const band = examBand(model.rows, hueByCode);
  listHost.replaceChildren(
    ...(band ? [band] : []),
    list,
    ...clashLines(model.rows),
    ...examFoot(model.rows),
  );

  // How many rows actually share their day (`sameDay` is set on EVERY row of a
  // same-date cluster), so the verdict reads "3 eksamener samme dag" for a
  // 3-way clash rather than the 2 adjacent pairs `gapToNext === 0` counts.
  const collisionCount = model.rows.filter((row) => row.sameDay).length;

  return { collisionCount, state: "list" };
}
