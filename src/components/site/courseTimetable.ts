/**
 * Timetable island for `/emne/[code]/`: fetches
 * `/api/course/:code/timetable?year=` (default = catalog year), groups
 * entries per weekday (mono day header, rows time + name + rooms +
 * "uke N–M"), and re-fetches when the year changes.
 */

interface Room {
  id: string | null;
  building: string | null;
  room: string | null;
  url: string | null;
}

interface TimetableEntry {
  courseCode: string;
  acronym: string | null;
  name: string | null;
  title: string | null;
  dayNumber: number;
  startTime: string;
  endTime: string;
  weeks: string[];
  rooms: Room[];
}

const DAY_NAMES = ["mandag", "tirsdag", "onsdag", "torsdag", "fredag", "lørdag", "søndag"];

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

function weekRangeLabel(weeks: string[]): string {
  if (weeks.length === 0) return "";
  return weeks.map((w) => `uke ${w.replace("-", "–")}`).join(", ");
}

function roomLabel(rooms: Room[]): string {
  if (rooms.length === 0) return "";
  return rooms
    .map((r) => r.room ?? r.building ?? "")
    .filter(Boolean)
    .join(", ");
}

async function fetchTimetable(code: string, year: number): Promise<TimetableEntry[] | null> {
  const res = await fetch(`/api/course/${code}/timetable?year=${year}`);
  if (!res.ok) return null;
  return (await res.json()) as TimetableEntry[];
}

function renderTimetable(body: HTMLElement, entries: TimetableEntry[]): void {
  if (entries.length === 0) {
    body.append(el("p", "timetable-empty np-note", "ingen timeplanoppføringer for dette året"));
    return;
  }

  const byDay = new Map<number, TimetableEntry[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.dayNumber) ?? [];
    list.push(entry);
    byDay.set(entry.dayNumber, list);
  }

  const grid = el("div", "timetable-grid");
  for (let day = 1; day <= 5; day++) {
    const dayEntries = byDay.get(day);
    if (!dayEntries || dayEntries.length === 0) continue;
    dayEntries.sort((a, b) => a.startTime.localeCompare(b.startTime));

    const dayCol = el("div", "timetable-day");
    dayCol.append(el("p", "np-kicker timetable-day-header", DAY_NAMES[day - 1]));
    for (const entry of dayEntries) {
      const row = el("div", "timetable-entry");
      row.append(el("span", "timetable-entry-time np-data", `${entry.startTime}–${entry.endTime}`));
      row.append(el("span", "timetable-entry-name", entry.title ?? entry.name ?? entry.courseCode));
      const rooms = roomLabel(entry.rooms);
      if (rooms) row.append(el("span", "timetable-entry-room np-data", rooms));
      const weeks = weekRangeLabel(entry.weeks);
      if (weeks) row.append(el("span", "timetable-entry-weeks np-data", weeks));
      dayCol.append(row);
    }
    grid.append(dayCol);
  }
  body.append(grid);
}

export async function mountCourseTimetable(code: string, catalogYear: number): Promise<void> {
  const section = document.getElementById("timetable-section");
  const status = section?.querySelector<HTMLElement>('[data-role="status"]');
  const body = section?.querySelector<HTMLElement>('[data-role="body"]');
  if (!section || !status || !body || !code || !catalogYear) return;
  // Rebind as non-optional locals: TS doesn't narrow captured outer bindings
  // inside nested function declarations below.
  const statusEl = status;
  const bodyEl = body;

  const yearSelect = el("div", "timetable-years", "");
  yearSelect.setAttribute("role", "group");
  yearSelect.setAttribute("aria-label", "Velg år");

  const years = [catalogYear - 1, catalogYear, catalogYear + 1];
  let activeYear = catalogYear;

  async function loadYear(year: number): Promise<void> {
    statusEl.hidden = true;
    bodyEl.hidden = false;
    // Only the year-chip bar (yearSelect) persists across loads; everything
    // else in bodyEl is per-fetch content and must be cleared each time.
    bodyEl.replaceChildren(yearSelect);
    const loading = el("p", "timetable-loading np-note", "henter timeplan …");
    bodyEl.append(loading);

    try {
      const entries = await fetchTimetable(code, year);
      loading.remove();
      if (entries === null) {
        bodyEl.append(el("p", "timetable-empty np-note", "klarte ikke å hente timeplan"));
        return;
      }
      renderTimetable(bodyEl, entries);
    } catch {
      loading.remove();
      bodyEl.append(el("p", "timetable-empty np-note", "klarte ikke å hente timeplan"));
    }
  }

  for (const year of years) {
    const chip = el("button", "np-toggle timetable-year-chip", String(year));
    chip.type = "button";
    chip.setAttribute("aria-pressed", String(year === activeYear));
    chip.addEventListener("click", () => {
      activeYear = year;
      for (const other of yearSelect.querySelectorAll(".timetable-year-chip")) {
        other.setAttribute("aria-pressed", String(other === chip));
      }
      loadYear(year);
    });
    yearSelect.append(chip);
  }

  await loadYear(activeYear);
}
