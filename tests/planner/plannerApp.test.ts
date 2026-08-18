/**
 * `mountPlannerApp` end to end, against the degraded paths where "we don't
 * know" used to render as "it's fine" — every one of those regressions reached
 * a green build because nothing below the browser suite ever mounted this
 * module. So this file mounts it for real: a hand-rolled DOM shim (this repo
 * ships no jsdom), a stubbed `fetch` per scenario, and assertions on the
 * verdict line, the provenance line, the week frame and the course rail.
 *
 * The shim is minimal ON PURPOSE and implements only what the render path
 * touches. It is not a DOM: no layout, no CSS, no real selector engine
 * (`querySelectorAll` matches the LAST simple selector of a compound). A change
 * that reaches for an API it lacks fails loudly, which is the safe direction.
 * Anything visual, focus-related or CSS-dependent belongs in `e2e/*.pw.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageLike } from "../../src/lib/planner/store.js";

class FakeClassList {
  private set = new Set<string>();
  constructor(private owner: FakeEl) {}
  add(...names: string[]) {
    for (const n of names) this.set.add(n);
    this.sync();
  }
  remove(...names: string[]) {
    for (const n of names) this.set.delete(n);
    this.sync();
  }
  toggle(name: string, force?: boolean) {
    const on = force ?? !this.set.has(name);
    if (on) this.set.add(name);
    else this.set.delete(name);
    this.sync();
  }
  contains(name: string) {
    return this.set.has(name);
  }
  replace(from: string) {
    this.set = new Set(from.split(/\s+/).filter(Boolean));
  }
  toString() {
    return [...this.set].join(" ");
  }
  private sync() {
    this.owner._className = this.toString();
  }
}

/** `data-week-select` → `weekSelect`, the one transform `dataset` applies. */
function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

class FakeEl {
  tagName: string;
  _className = "";
  id = "";
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  private text = "";
  classList: FakeClassList = new FakeClassList(this);
  dataset: Record<string, string> = {};
  /**
   * `display` is real state: plannerApp sets it to defeat `.np-btn`'s author
   * rule. Custom properties are too — the week's edge fade is a pair of lengths
   * written here and read by the mask.
   */
  props = new Map<string, string>();
  style = {
    setProperty: (k: string, v: string) => {
      this.props.set(k, v);
    },
    removeProperty: (k: string) => {
      this.props.delete(k);
    },
    getPropertyValue: (k: string) => this.props.get(k) ?? "",
    display: "",
  };
  attrs = new Map<string, string>();
  listeners = new Map<string, ((e: unknown) => void)[]>();
  hidden = false;
  disabled = false;
  type = "";
  value = "";
  open = false;
  scrollWidth = 800;
  clientWidth = 800;
  clientHeight = 600;
  scrollLeft = 0;
  /** The only layout the shim has: what `getBoundingClientRect.width` reports. */
  rectWidth = 0;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  get className() {
    return this._className;
  }
  set className(v: string) {
    this._className = v;
    this.classList.replace(v);
  }
  get textContent(): string {
    if (this.children.length === 0) return this.text;
    return this.children.map((c) => c.textContent).join("");
  }
  set textContent(v: string) {
    this.text = v;
    this.children = [];
  }
  get childNodes() {
    return this.children;
  }
  get innerText(): string {
    return this.textContent;
  }
  append(...nodes: (FakeEl | string)[]) {
    for (const n of nodes) {
      if (typeof n === "string") {
        const t = new FakeEl("#text");
        t.textContent = n;
        t.parent = this;
        this.children.push(t);
      } else {
        n.parent = this;
        this.children.push(n);
      }
    }
  }
  appendChild(n: FakeEl) {
    this.append(n);
    return n;
  }
  replaceChildren(...nodes: (FakeEl | string)[]) {
    this.children = [];
    this.text = "";
    this.append(...nodes);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
    if (k === "id") this.id = v;
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  addEventListener(type: string, fn: (e: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener() {}
  dispatch(type: string, ev: unknown = {}) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  click() {
    this.dispatch("click", { preventDefault() {}, stopPropagation() {} });
  }
  focus() {
    const doc = (globalThis as unknown as { document?: { activeElement: FakeEl | null } }).document;
    if (doc) doc.activeElement = this;
  }
  blur() {}
  scrollTo() {}
  scrollIntoView() {}
  prepend(...nodes: (FakeEl | string)[]) {
    const existing = this.children;
    this.children = [];
    this.append(...nodes);
    this.children.push(...existing);
  }
  insertBefore(node: FakeEl, ref: FakeEl | null) {
    const at = ref ? this.children.indexOf(ref) : -1;
    node.parent = this;
    if (at < 0) this.children.push(node);
    else this.children.splice(at, 0, node);
    return node;
  }
  contains(node: FakeEl): boolean {
    return node === this || this.descendants().includes(node);
  }
  getBoundingClientRect() {
    return {
      left: 0,
      top: 0,
      right: this.rectWidth,
      bottom: 0,
      width: this.rectWidth,
      height: 0,
      x: 0,
      y: 0,
    };
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  descendants(): FakeEl[] {
    const out: FakeEl[] = [];
    for (const c of this.children) {
      out.push(c, ...c.descendants());
    }
    return out;
  }
  /**
   * The week's controls are found by `[data-role]` rather than by id — three
   * surfaces carry three copies and prefixed ids were the bookkeeping that
   * bought — so the shim has to answer an attribute selector.
   */
  matches(sel: string): boolean {
    const attr = /^\[data-([a-z-]+)="([^"]*)"\]$/.exec(sel);
    if (attr) return this.dataset[camel(attr[1] ?? "")] === attr[2];
    if (sel.startsWith("#")) return this.id === sel.slice(1);
    if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  /** A <select>'s own rows, which `weekView` reads to check a week is on offer. */
  get options(): FakeEl[] {
    return this.children.filter((c) => c.tagName === "OPTION");
  }
  querySelector(sel: string): FakeEl | null {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  querySelectorAll(sel: string): FakeEl[] {
    const parts = sel.split(/\s+/).filter(Boolean);
    const simple = (parts[parts.length - 1] ?? sel).split(",")[0] ?? sel;
    return this.descendants().filter((e) => e.matches(simple));
  }
  closest(sel: string): FakeEl | null {
    let node: FakeEl | null = this;
    while (node) {
      if (node.matches(sel)) return node;
      node = node.parent;
    }
    return null;
  }
}

const IDS = [
  "planner-title",
  // The identity block, which is also the door into the programme picker —
  // `renderBanner` writes its aria-label, so a missing one fails the mount.
  "planner-name-btn",
  "planner-context-line",
  // The plan's own semester control, beside programme, kull and
  // studieretning: all four describe the PLAN, and all four are the planner's.
  "planner-semester-select",
  "planner-credit-line",
  "planner-load-legend",
  "planner-credit-note",
  "planner-credit-strip",
  // The two surfaces that go ABSENT at zero active courses rather than printing
  // a heading over an apology (`renderSectionPresence`).
  "planner-load-foot",
  "planner-region-exams",
  "planner-direction",
  "planner-direction-title",
  "planner-direction-note",
  "planner-direction-actions",
  "planner-direction-btn",
  // The week's own controls are NOT here: they are one `WeekControls.astro`
  // block found by `[data-role]` inside the week's section, built below.
  "planner-region-week",
  "planner-grid-frame",
  "planner-grid-notes",
  "planner-grid-status",
  "planner-deadline",
  "planner-exam-list-host",
  "planner-exam-status",
  "planner-course-rows",
  "planner-gap-line",
  "planner-gap-text",
  // No `planner-gap-btn`: the credit-gap line is a sentence now. Its "Velg fra
  // studieplanen" button opened the same dialog "Legg til emne" does, on the
  // whole catalog, so the pool it named was on neither surface. It is a facet
  // inside that dialog instead — see the `add-course-scope` tests below.
  "planner-add-course-btn",
  "planner-plan-panel",
  "planner-plan-body",
  "planner-provenance",
];

let byId: Map<string, FakeEl>;
let body: FakeEl;
let winListeners: Map<string, ((e: unknown) => void)[]> = new Map();
let docListeners: Map<string, ((e: unknown) => void)[]> = new Map();
let planStorage: Map<string, string>;

/** `document.getElementById`, but a miss is a test bug, not a `null`. */
function find(id: string): FakeEl {
  const el = byId.get(id);
  if (!el) throw new Error(`no element #${id} in the shim`);
  return el;
}

function installDom(): void {
  byId = new Map();
  body = new FakeEl("body");
  for (const id of IDS) {
    const e = new FakeEl(id.includes("btn") || id.includes("toggle") ? "button" : "div");
    e.id = id;
    byId.set(id, e);
    body.append(e);
  }
  // THE WEEK'S CONTROLS, as `WeekControls.astro` renders them: one block
  // inside the week's section, everything in it found by `data-role`.
  const weekSection = find("planner-region-week");
  const weekControls = new FakeEl("div");
  weekControls.dataset.role = "week-controls";
  const weekSelect = new FakeEl("select");
  weekSelect.dataset.role = "week-select";
  const layerToggle = new FakeEl("button");
  layerToggle.dataset.role = "layer-toggle";
  const layerPending = new FakeEl("span");
  layerPending.dataset.role = "layer-pending";
  layerToggle.append(layerPending);
  const viewTabs = new FakeEl("div");
  viewTabs.dataset.role = "view-tabs";
  for (const view of ["kolonner", "tavle"]) {
    const tab = new FakeEl("button");
    tab.classList.add("planner-view-tab");
    tab.dataset.view = view;
    viewTabs.append(tab);
  }
  weekControls.append(weekSelect, layerToggle, viewTabs);
  weekSection.append(weekControls);

  docListeners = new Map();
  const doc = {
    body,
    documentElement: new FakeEl("html"),
    activeElement: null as FakeEl | null,
    // Page Visibility API surface: real by default (unlike the no-op
    // `addEventListener` below used to be) because the sync-trigger tests
    // need to actually fire `visibilitychange` on `plannerApp.ts`'s own
    // listeners, not just have the call silently swallowed.
    hidden: false,
    createElement: (tag: string) => new FakeEl(tag),
    // The course rows build an inline SVG for their settings control, so the
    // shim has to answer the namespaced constructor too. Namespace ignored:
    // nothing here asserts on it, and a FakeEl is all the render path touches.
    createElementNS: (_ns: string, tag: string) => new FakeEl(tag),
    getElementById: (id: string) =>
      byId.get(id) ?? body.descendants().find((e) => e.id === id) ?? null,
    querySelector: (s: string) => body.querySelector(s),
    querySelectorAll: (s: string) => body.querySelectorAll(s),
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      const l = docListeners.get(t) ?? [];
      l.push(fn);
      docListeners.set(t, l);
    },
    removeEventListener: () => {},
    dispatchEvent: (ev: { type: string }) => {
      for (const fn of docListeners.get(ev.type) ?? []) fn(ev);
      return true;
    },
  };
  const store = new Map<string, string>();
  planStorage = store;
  winListeners = new Map();
  const win = {
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      const l = winListeners.get(t) ?? [];
      l.push(fn);
      winListeners.set(t, l);
    },
    removeEventListener: () => {},
    dispatchEvent: (ev: { type: string }) => {
      for (const fn of winListeners.get(ev.type) ?? []) fn(ev);
      return true;
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    innerWidth: 1280,
    innerHeight: 900,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  };
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = doc;
  g.window = win;
  g.localStorage = win.localStorage;
  g.matchMedia = win.matchMedia;
  // The planner writes no history entry any more (the URL stopped being the
  // plan when the hash was deleted). Kept as a no-op so anything that reaches
  // for it fails loudly on its own terms rather than on a missing global.
  g.history = {
    state: { index: 3, scrollX: 0, scrollY: 0 },
    replaceState: () => {},
    pushState: () => {},
  };
  g.location = { hash: "", search: "", pathname: "/planlegger/", href: "http://x/planlegger/" };
  g.CustomEvent = class {
    type: string;
    detail: unknown;
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type;
      this.detail = init?.detail;
    }
  };
  g.HTMLElement = FakeEl;
}

const SEMESTERS = {
  crawledAt: "2026-07-24T02:00:00.000Z",
  current: {
    id: "26h",
    name: "Høst 2026",
    teachingWeeks: [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46],
    timetablePublished: true,
    fromDate: "2026-08-17",
    toDate: "2026-12-18",
    examLastDate: "2027-02-01",
    examFinalDate: "2027-02-01",
  },
  semesters: [
    {
      id: "26h",
      name: "Høst 2026",
      teachingWeeks: [34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46],
      timetablePublished: true,
      fromDate: "2026-08-17",
      toDate: "2026-12-18",
      examLastDate: "2027-02-01",
      examFinalDate: "2027-02-01",
    },
  ],
};

/**
 * 26h plus a published spring semester, for the scenarios that switch term.
 * `data/semesters.json` only has 26h published today.
 */
const SEMESTERS_TWO = {
  ...SEMESTERS,
  semesters: [
    ...SEMESTERS.semesters,
    {
      id: "27v",
      name: "Vår 2027",
      teachingWeeks: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
      timetablePublished: true,
      fromDate: "2027-01-04",
      toDate: "2027-05-21",
      examLastDate: "2027-06-20",
      examFinalDate: "2027-06-20",
    },
  ],
};

function entry(code: string, day: number, start: string, end: string, weeks = "34-46") {
  return {
    courseCode: code,
    courseName: { nob: `${code} navn`, nno: null, eng: null },
    dayNumber: day,
    startTime: start,
    endTime: end,
    weeks: [weeks],
    rooms: [{ building: "B", room: "R1", url: null }],
    title: "Forelesning",
    name: "Forelesning",
  };
}

/**
 * One study-plan course the programme auto-enrolls you in. `studyChoice.code
 * === "O"` is the ONLY structured signal for that (DR-5) — a fixture without it
 * prefills nothing.
 */
function obligatory(code: string, name: string, credits: number) {
  return {
    code,
    version: "1",
    name,
    credits,
    planElement: false,
    studyChoice: { code: "O", name: "Obligatorisk emne", description: null },
  };
}

/** The `/api/course/:code` details leg — the same shape every scenario stubs. */
const DETAILS = {
  courseCode: "X",
  courseName: "X",
  credits: 7.5,
  location: null,
  assessmentScheme: null,
  exams: [],
};

function jsonResponse(bodyValue: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => bodyValue,
  };
}

describe("mountPlannerApp — audit repro", () => {
  beforeEach(() => {
    installDom();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * The plan a test starts from.
   *
   * It used to be a `#v2;…` hash string — the URL was the plan, so seeding one
   * seeded the other. The hash is gone (spec §5) and `localStorage` is the only
   * source now, so a seed says what it means: which semester, which programme,
   * which course codes.
   */
  interface PlanSeed {
    semesterId?: string;
    program?: { code: string; name: string; cohort: number };
    /** A bare code is the common case; the object form is for a stored row
     *  carrying facts the catalog does not have (B9.1's credits fallback). */
    courses?: Array<string | { code: string; name?: string; credits?: number }>;
  }

  async function mount(
    routes: Record<string, () => unknown>,
    seed: PlanSeed,
    semesters: unknown = SEMESTERS,
  ) {
    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };
    const semesterId = seed.semesterId ?? "26h";
    const storage = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    storage.setItem(
      "np:plans",
      JSON.stringify({
        [semesterId]: (seed.courses ?? []).map((entry) => {
          const row = typeof entry === "string" ? { code: entry } : entry;
          return {
            code: row.code,
            // Defaults to the code, as a plan built from codes alone holds it:
            // the search-index backfill is what fills real names in, and
            // several tests below are about that path.
            name: row.name ?? row.code,
            version: "1",
            source: "manual",
            ...(row.credits === undefined ? {} : { credits: row.credits }),
          };
        }),
      }),
    );
    storage.setItem("np:lastSemester", semesterId);
    if (seed.program) storage.setItem("np:profile", JSON.stringify({ program: seed.program }));
    const fetchMock = vi.fn(async (url: string) => {
      for (const [pattern, make] of Object.entries(routes)) {
        if (url.includes(pattern)) {
          const value = make();
          if (value === "FAIL")
            return { ok: false, status: 503, json: async () => ({ error: "boom" }) };
          if (value === "FAIL404")
            return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
          return jsonResponse(value);
        }
      }
      return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
    });
    (globalThis as unknown as Record<string, unknown>).fetch = fetchMock;
    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();
    await mountPlannerApp(semesters as never, undefined);
    // let the microtask-debounced renders flush
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    return { fetchMock };
  }

  it("pc-3: a mixed 4-ok/1-failed plan never prints a green verdict", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/course/TMA4400/timetable": () => "FAIL",
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/TMA4412/timetable": () => [entry("TMA4412", 2, "10:15", "12:00")],
        "/api/course/": () => ({
          courseCode: "X",
          courseName: "X",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { courses: ["TDT4109", "TMA4400", "TMA4412"] },
    );
    const status = find("planner-grid-status");
    expect(status.textContent).toBe("kan ikke sjekkes, mangler timeplan for 1 emne");
    expect(status.classList.contains("is-clean")).toBe(false);
    expect(status.classList.contains("np-note-clash")).toBe(false);
  });

  it("pc-3 control: an all-healthy plan says nothing at all", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/TMA4412/timetable": () => [entry("TMA4412", 2, "10:15", "12:00")],
        "/api/course/": () => ({
          courseCode: "X",
          courseName: "X",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { courses: ["TDT4109", "TMA4412"] },
    );
    const status = find("planner-grid-status");
    // THE PASS IS SILENCE. "Ingen forelesninger kolliderer" was removed for
    // spending a line of the first screen on every load to report that nothing
    // is wrong. What this control still guards is the other half of pc-3: a
    // healthy plan must not fall into one of the "kan ikke sjekkes" branches,
    // which is what an empty verdict distinguishes it from.
    expect(status.textContent).toBe("");
    expect(status.children.length).toBe(0);
  });

  /**
   * The other way a green verdict can lie, and the one that shipped: not a
   * MISSING timetable (pc-3 above) but a present one the lecture-only check has
   * nothing to compare in. BSPL kull 2024's period is entirely activities NTNU
   * never marks as `forelesning`, so `findConflicts` ran over an empty set,
   * returned 0, and the page printed Green-Means-Fits over fifteen visibly
   * overlapping bars — with the note explaining it folded 800 px below.
   *
   * `conflictCount === 0` is only a verdict when something was checked.
   */
  it("never prints a green verdict over a plan with no lectures in it", async () => {
    const lab = (code: string, day: number, start: string, end: string) => ({
      ...entry(code, day, start, end),
      title: "Øving",
      name: "Øving",
    });
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        // Two courses whose only sessions overlap on Monday morning, and not
        // one of them a lecture.
        "/api/course/MH2000/timetable": () => [lab("MH2000", 1, "08:15", "12:00")],
        "/api/course/MH2001/timetable": () => [lab("MH2001", 1, "09:00", "11:00")],
        "/api/course/": () => ({
          courseCode: "X",
          courseName: "X",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { courses: ["MH2000", "MH2001"] },
    );
    const status = find("planner-grid-status");
    expect(status.textContent).toBe("kan ikke sjekkes, ingen forelesninger i planen");
    expect(status.querySelector(".is-clean")).toBeNull();
    expect(status.classList.contains("np-note-clash")).toBe(false);
  });

  it("the provenance line is silent when the join has no gap to admit", async () => {
    // The counterpart to the failure test below: on a plan where everything
    // resolved, the line used to state its routine sources under a week that
    // visibly worked, with the crawl date and the caveat already in the footer.
    // DR-8 asks the join to admit its gaps, not to announce it has none.
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => ({
          courseCode: "X",
          courseName: "X",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { courses: ["TDT4109"] },
    );
    const prov = find("planner-provenance");
    expect(prov.textContent).toBe("");
    expect(prov.hidden).toBe(true);
  });

  it("copy-4/pd-2/ux-2/pc-4/edit-5: provenance is recomposed after the fetches land", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/course/TMA4400/timetable": () => "FAIL",
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => ({
          courseCode: "X",
          courseName: "X",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { courses: ["TDT4109", "TMA4400"] },
    );
    // The line states ONLY what could not be verified now
    //: no "Timeplan hentet direkte fra NTNU nå", because
    // a sentence saying everything worked, printed under a week that visibly
    // worked, is what stopped anyone reading the clause that matters.
    const prov = find("planner-provenance").textContent;
    expect(prov).not.toContain("Henter timeplan fra NTNU nå");
    expect(prov).not.toContain("Timeplan hentet direkte fra NTNU nå");
    expect(prov).toContain("Fikk ikke hentet timeplan for TMA4400");
    expect(prov).not.toMatch(/Not found|Failed to fetch|boom/);
    expect(find("planner-provenance").hidden).toBe(false);
  });

  it("plan-3/ux-fail-4: a 404 step-back names the cohort the plan really came from", async () => {
    let planCalls = 0;
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/MTMT/plan": () => {
          planCalls += 1;
          if (planCalls < 3) return "FAIL404";
          return {
            code: "MTMT",
            name: "Matematiske fag",
            year: 2024,
            startTerm: "AUTUMN",
            updated: null,
            publishedYears: [2024],
            periods: [
              {
                periodNumber: 1,
                direction: { code: null, name: null, courseGroups: [], waypoints: [] },
              },
            ],
          };
        },
        "/api/course/": () => ({
          courseCode: "X",
          courseName: "X",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { program: { code: "MTMT", name: "MTMT", cohort: 2026 } },
    );
    const prov = find("planner-provenance").textContent;
    expect(prov).toContain("Studieplan for kull 2024, det finnes ingen egen plan for kull 2026.");
  });

  /* `app-1: syncHash never writes a null history state` is DELETED with
     `syncHash`. The planner writes no history entry at all now — the URL
     stopped being the plan when `/user/<navn>` became the thing you hand over,
     so there is no `replaceState` left to get wrong. */

  it("ux-3/ux-fail-2: a failed fetch beats an open studieretning question, and Prøv igjen is reachable", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/MTDT/plan": () => ({
          code: "MTDT",
          name: "Datateknologi",
          year: 2026,
          startTerm: "AUTUMN",
          updated: null,
          publishedYears: [2026],
          periods: [
            {
              periodNumber: 1,
              direction: {
                code: null,
                name: null,
                courseGroups: [],
                waypoints: [
                  {
                    name: "Valg av studieretning",
                    deadlineDate: null,
                    directions: [
                      { code: "A", name: "A", courseGroups: [], waypoints: [] },
                      { code: "B", name: "B", courseGroups: [], waypoints: [] },
                    ],
                  },
                ],
              },
            },
          ],
        }),
        "/timetable": () => "FAIL",
        "/api/course/": () => ({
          courseCode: "X",
          courseName: "X",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { program: { code: "MTDT", name: "MTDT", cohort: 2026 }, courses: ["TDT4109"] },
    );
    const frame = find("planner-grid-frame");
    expect(frame.textContent).toContain("Fikk ikke hentet timeplanen.");
    const retries = frame.descendants().filter((e) => e.textContent === "Prøv igjen");
    expect(retries.length).toBe(1);
    // The question is not lost — it keeps its own panel.
    expect(find("planner-direction").hidden).toBe(false);
    expect(find("planner-direction-title").textContent).toBe("Valg av studieretning");
  });

  it("pd-3/ux-fail-7: a dead search-index gets a retry, not an eternal spinner or a false NTNU claim", async () => {
    await mount(
      {
        "/data/search-index.json": () => "FAIL",
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => ({
          courseCode: "X",
          courseName: "X",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { courses: ["TDT4109"] },
    );
    const examHost = find("planner-exam-list-host");
    expect(examHost.textContent).toContain("Fikk ikke hentet eksamensdatoene.");
    expect(examHost.descendants().filter((e) => e.textContent === "Prøv igjen").length).toBe(1);
    expect(find("planner-exam-status").textContent).not.toContain("henter");
    const prov = find("planner-provenance").textContent;
    expect(prov).toContain("Fikk ikke hentet eksamensdatoene.");
    expect(prov).not.toContain("ikke publisert");
  });

  /**
   * A section appears with its rows. Not a claim about how the sections LOOK —
   * a claim that a surface computed from courses is absent when there are none,
   * rather than printing its heading over an apology for content the student
   * has not created yet. The state is real: a programme whose study plan has no
   * published period lands in it and stays there.
   */
  it("Eksamener and the load track go absent at zero active courses", async () => {
    await mount(
      { "/data/search-index.json": () => ({ year: 2026, courses: [] }) },
      { courses: [] },
    );

    expect(find("planner-region-exams").hidden).toBe(true);
    expect(find("planner-credit-strip").hidden).toBe(true);
    expect(find("planner-load-foot").hidden).toBe(true);
    // Emner is the exception: it is where the first course is added, so it
    // keeps its heading and its button. What it lost is its own apology.
    expect(find("planner-course-rows").hidden).not.toBe(true);
    expect(find("planner-course-rows").textContent).not.toContain("Ingen emner i planen");
  });

  it("…and are back the moment the plan holds one", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => ({
          courseCode: "TDT4109",
          courseName: "ITGK",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { courses: ["TDT4109"] },
    );

    expect(find("planner-region-exams").hidden).not.toBe(true);
    expect(find("planner-load-foot").hidden).not.toBe(true);
  });

  it("plan-2: a period that exists but names nothing says so", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/MPPR/plan": () => ({
          code: "MPPR",
          name: "Pedagogisk-psykologisk rådgivning",
          year: 2026,
          startTerm: "AUTUMN",
          updated: null,
          publishedYears: [2026],
          periods: [
            {
              periodNumber: 1,
              direction: { code: null, name: null, courseGroups: [], waypoints: [] },
            },
          ],
        }),
      },
      { program: { code: "MPPR", name: "MPPR", cohort: 2026 } },
    );
    expect(find("planner-direction").hidden).toBe(false);
    expect(find("planner-direction-title").textContent).toBe("Ingen emner i studieplanen");
    expect(find("planner-direction-note").textContent).toContain(
      "oppgir ingen emner for Høst 2026",
    );
  });

  it("store-2: a slow study-plan fetch for the old programme cannot resurrect it", async () => {
    let releasePlan = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releasePlan = resolve;
    });
    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };
    (globalThis as unknown as { localStorage: StorageLike }).localStorage.setItem(
      "np:profile",
      JSON.stringify({ program: { code: "MTDT", name: "MTDT", cohort: 2026 } }),
    );
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(async (url: string) => {
      if (url.includes("/data/search-index.json")) return jsonResponse({ year: 2026, courses: [] });
      if (url.includes("/api/program/MTDT/plan")) {
        await gate;
        return jsonResponse({
          code: "MTDT",
          name: "Datateknologi",
          year: 2026,
          startTerm: "AUTUMN",
          updated: null,
          publishedYears: [2026],
          periods: [
            {
              periodNumber: 1,
              direction: {
                code: null,
                name: null,
                courseGroups: [
                  {
                    name: null,
                    description: null,
                    type: "O",
                    courses: [{ code: "TDT4136", name: "KI", credits: 7.5, courseGroupType: "O" }],
                  },
                ],
                waypoints: [],
              },
            },
          ],
        });
      }
      return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
    });
    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    const { clearProgramPlanMemo } = await import("../../src/components/planner/programPlan.js");
    clearCourseBundleMemo();
    clearPlannerIndexMemo();
    clearProgramPlanMemo();
    const mounted = mountPlannerApp(SEMESTERS as never, undefined);
    await new Promise((r) => setTimeout(r, 0));

    // The student clears the programme while the plan fetch is still in flight
    // (the 404 ladder can spend three round trips here).
    const { createPlanStore } = await import("../../src/lib/planner/store.js");
    createPlanStore("26h").removeProgram();
    await new Promise((r) => setTimeout(r, 0));
    expect(find("planner-title").textContent).toBe("Semesterplan");

    releasePlan();
    await mounted;
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    expect(find("planner-title").textContent).toBe("Semesterplan");
    expect(planStorage.get("np:profile") ?? "{}").not.toContain("MTDT");
    expect(planStorage.get("np:plans") ?? "").not.toContain("TDT4136");
  });

  it("pd-5: a failed course's settings carry its own Prøv igjen", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/course/TMA4400/timetable": () => "FAIL",
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => ({
          courseCode: "X",
          courseName: "X",
          credits: 7.5,
          location: null,
          assessmentScheme: null,
          exams: [],
        }),
      },
      { courses: ["TDT4109", "TMA4400"] },
    );
    // the row itself is identity plus one mark that
    // there is something to read; the sentence and the retry live in the
    // settings modal the row opens.
    const rows = find("planner-course-rows");
    expect(rows.textContent).toContain("se detaljer");
    expect(rows.textContent).not.toContain("fikk ikke hentet");

    const open = rows
      .descendants()
      .find((e) => e.classList.contains("planner-course-open") && e.dataset.code === "TMA4400");
    expect(open).toBeDefined();
    open?.click();

    const dialog = body.querySelector(".course-settings");
    expect(dialog?.open).toBe(true);
    const buttons = dialog
      ?.descendants()
      .filter((e) => e.tagName === "BUTTON" && e.textContent === "Prøv igjen");
    expect(buttons?.length).toBe(1);
    // nothing on the surface is upstream English.
    expect(dialog?.textContent).toContain("Fikk ikke hentet timeplan: NTNU svarte ikke");
    expect(dialog?.textContent).not.toMatch(/Not found|Failed to fetch|boom|Internal/);
  });

  it("crawler-3: a course this year's catalog does not carry says so, not 'fikk ikke hentet'", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({
          year: 2026,
          // TMA4100 is the two-catalog-year case: last taught 2025.
          courses: [["TMA4100", "Matematikk 1", "Trondheim", [], "1", [2025]]],
        }),
        "/api/course/TMA4100/timetable": () => [],
      },
      { courses: ["TMA4100"] },
    );
    // The row flags that there is something to read; the sentence itself is in
    // the settings modal (D2).
    const rows = find("planner-course-rows");
    expect(rows.textContent).toContain("se detaljer");

    rows
      .descendants()
      .find((e) => e.classList.contains("planner-course-open") && e.dataset.code === "TMA4100")
      ?.click();
    const dialog = body.querySelector(".course-settings");
    expect(dialog?.textContent).toContain("Ikke undervist i 2026. Sist undervist 2025");
    expect(dialog?.textContent).not.toContain("Fikk ikke hentet");
  });

  /* `app-3: the link note stops naming a semester after the student switches`
     is DELETED. C4's note explained a semester substituted for a LINK's own,
     and `planFromHash` was its only writer — nothing points at a semester any
     more. What survives is the correction itself, covered below: a stored plan
     for a term this build cannot plan falls back silently. */
  it("a stored plan for a term this build cannot plan falls back to the default", async () => {
    await mount(
      { "/data/search-index.json": () => ({ year: 2026, courses: [] }) },
      { semesterId: "25h", courses: ["TDT4109"] },
      SEMESTERS_TWO,
    );
    expect(find("planner-context-line").textContent).toContain("Høst 2026");
  });

  it("app-4/D3: Dropp lives in the course's settings, and the row says it is dropped", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/MTDT/plan": () => ({
          code: "MTDT",
          name: "Datateknologi",
          year: 2026,
          startTerm: "AUTUMN",
          updated: null,
          publishedYears: [2026],
          periods: [
            {
              periodNumber: 1,
              direction: {
                code: null,
                name: null,
                courseGroups: [
                  {
                    name: null,
                    description: null,
                    type: "O",
                    courses: [obligatory("TDT4136", "Metoder i kunstig intelligens", 7.5)],
                  },
                ],
                waypoints: [],
              },
            },
          ],
        }),
        "/api/course/TDT4136/timetable": () => [entry("TDT4136", 1, "08:15", "10:00")],
        "/api/course/": () => DETAILS,
      },
      { program: { code: "MTDT", name: "MTDT", cohort: 2026 } },
    );
    // The row carries no Dropp of its own any more — it opens the settings
    // modal, and the verb is there. That relaxes PRODUCT §1.3's "one tap to
    // restore" to two, deliberately: one editing surface per course.
    const rows = find("planner-course-rows");
    const openBtn = rows
      .descendants()
      .find((e) => e.classList.contains("planner-course-open") && e.dataset.code === "TDT4136");
    expect(openBtn).toBeDefined();
    openBtn?.click();

    const dialog = body.querySelector(".course-settings");
    const dropp = dialog
      ?.descendants()
      .find((e) => e.getAttribute("aria-label") === "Dropp TDT4136");
    expect(dropp).toBeDefined();
    dropp?.click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    // The action closes the modal (the course it edits is no longer on screen)
    // and the row stays, grayed and saying so — PRODUCT §1.3's visible, reversible drop.
    expect(dialog?.open).toBe(false);
    const dropped = rows.descendants().find((e) => e.dataset.code === "TDT4136");
    expect(dropped?.className).toContain("is-dropped");
    expect(rows.textContent).toContain("droppet");

    // …and the way back is the same row's settings button, now offering the
    // reverse verb.
    rows
      .descendants()
      .find((e) => e.classList.contains("planner-course-open") && e.dataset.code === "TDT4136")
      ?.click();
    const reopened = body.querySelector(".course-settings");
    expect(
      reopened?.descendants().find((e) => e.getAttribute("aria-label") === "Legg tilbake TDT4136"),
    ).toBeDefined();
  });

  it("store-4: a reload keeps the study plan's own credits and name", async () => {
    // What the B9.1 fallback wrote: a study-plan elective the catalog does not
    // list, carrying the plan's own name and sp. Nothing on a reload may
    // overwrite either with the code and a gap.
    await mount(
      { "/data/search-index.json": () => ({ year: 2026, courses: [] }) },
      {
        courses: [{ code: "ZZZ9999", name: "Fordypningsemne i studieplanen", credits: 15 }],
      },
    );
    expect(planStorage.get("np:plans")).toContain('"credits":15');
    expect(planStorage.get("np:plans")).toContain("Fordypningsemne i studieplanen");
    expect(find("planner-credit-line").textContent).toBe("15 av 30 sp");
    expect(find("planner-course-rows").textContent).toContain("15 sp");
  });

  it("plan-6: a single 60 sp thesis is not an overload to prune", async () => {
    const period = (courses: unknown[]) => ({
      code: "MSCHEM",
      name: "Kjemi",
      year: 2025,
      startTerm: "AUTUMN",
      updated: null,
      publishedYears: [2025],
      periods: [
        {
          periodNumber: 1,
          direction: {
            code: null,
            name: null,
            courseGroups: [{ name: null, description: null, type: "O", courses }],
            waypoints: [],
          },
        },
      ],
    });
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/MSCHEM/plan": () =>
          period([obligatory("KJ3900", "Masteroppgave i kjemi", 60)]),
        "/api/course/": () => ({ ...DETAILS, credits: 60 }),
      },
      { program: { code: "MSCHEM", name: "MSCHEM", cohort: 2026 } },
    );
    const note = find("planner-credit-note");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("fører opp hele emnet (60 sp)");
    expect(note.textContent).not.toContain("Fjern det du ikke tar");
  });

  it("plan-6 control: a genuinely overloaded period still says what to do", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/MJORM/plan": () => ({
          code: "MJORM",
          name: "Jordmorfag",
          year: 2026,
          startTerm: "AUTUMN",
          updated: null,
          publishedYears: [2026],
          periods: [
            {
              periodNumber: 1,
              direction: {
                code: null,
                name: null,
                courseGroups: [
                  {
                    name: null,
                    description: null,
                    type: "O",
                    courses: [obligatory("AAA1000", "A", 22.5), obligatory("BBB1000", "B", 22.5)],
                  },
                ],
                waypoints: [],
              },
            },
          ],
        }),
        "/api/course/": () => DETAILS,
      },
      { program: { code: "MJORM", name: "MJORM", cohort: 2026 } },
    );
    expect(find("planner-credit-note").textContent).toContain("Fjern det du ikke tar");
  });

  it("plan-8: an empty study-plan pool renders the gap sentence and no filter", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/MPPR/plan": () => ({
          code: "MPPR",
          name: "Pedagogisk-psykologisk rådgivning",
          year: 2026,
          startTerm: "AUTUMN",
          updated: null,
          publishedYears: [2026],
          periods: [
            {
              periodNumber: 1,
              direction: { code: null, name: null, courseGroups: [], waypoints: [] },
            },
          ],
        }),
      },
      { program: { code: "MPPR", name: "MPPR", cohort: 2026 } },
    );
    // The informative half survives — a modal cannot tell you there is a gap
    // before you open it.
    expect(find("planner-gap-line").hidden).toBe(false);
    expect(find("planner-gap-text").textContent).toBe("Mangler 30 sp");
    // And a filter over nothing is absent, not merely unpressed: this is the
    // state the removed button had to be `display: none`-d out of, because
    // `.np-btn { display: inline-flex }` beat the UA's `[hidden]`.
    find("planner-add-course-btn").click();
    expect(body.querySelector(".add-course-scope")?.hidden).toBe(true);
  });

  it("mob-5: no edge mask when the whole grid is on screen", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => DETAILS,
      },
      { courses: ["TDT4109"] },
    );
    const frame = find("planner-grid-frame");
    const grid = frame.querySelector(".planner-cols");
    expect(grid).not.toBeNull();
    // The measured 390 px geometry: the frame's own 24 px padding is scrollable
    // content, so scrollWidth - clientWidth is 26 while the grid itself fits.
    frame.clientWidth = 358;
    frame.scrollWidth = 384;
    if (grid) grid.rectWidth = 336;
    for (const fn of winListeners.get("resize") ?? []) fn({});
    expect(frame.dataset.scroll).toBeUndefined();

    // 360 px, where the fre column really does hang 8 px past the edge.
    frame.clientWidth = 328;
    frame.scrollWidth = 384;
    for (const fn of winListeners.get("resize") ?? []) fn({});
    expect(frame.dataset.scroll).toBe("start");
    // At rest the near edge fades over nothing: the ramp grows with the drag
    // rather than appearing whole the moment the frame becomes scrollable.
    expect(frame.style.getPropertyValue("--planner-fade-start")).toBe("0px");
  });

  it("ds-5: the exam gap counts reading days and matches its neighbours' ink", async () => {
    // The planner index is memoised per module, and a FAILED download is
    // memoised too — so an earlier scenario that stubbed a dead index leaves
    // this one rendering an error over a perfectly good stub.
    const { clearPlannerIndexMemo } = await import("../../src/lib/planner/data.js");
    clearPlannerIndexMemo();
    await mount(
      {
        "/data/search-index.json": () => ({
          year: 2026,
          courses: [
            // Deliberately far-future dates: the countdown row (`daysFromToday`)
            // only renders for an exam ahead of today, and this assertion must
            // not start passing vacuously in December.
            ["AAA1000", "A", "Trondheim", [["AUTUMN", "2098-12-07"]], "1", [2026]],
            ["BBB1000", "B", "Trondheim", [["AUTUMN", "2098-12-14"]], "1", [2026]],
          ],
        }),
        "/api/course/": () => DETAILS,
      },
      { courses: ["AAA1000", "BBB1000"] },
      {
        ...SEMESTERS,
        semesters: [{ ...SEMESTERS.semesters[0], examFinalDate: "2099-02-01" }],
      },
    );
    const host = find("planner-exam-list-host");
    // The connector quotes LESEDAGER, not the distance: 7. and 14. December are
    // seven days apart and leave six days to revise, because the seventh is
    // spent sitting the first exam.
    expect(host.textContent).toContain("6 lesedager");
    expect(host.textContent).not.toContain("7 lesedager");
    // Both day-count fragments are mono: they used to sit rows apart in
    // two typefaces at two sizes. The connector is `.exam-gap np-data` and the
    // countdown `.exam-away np-data` — different roles, one voice, and
    // Data-Is-Mono is the rule that binds them.
    const counts = host
      .descendants()
      .filter((e) => e.classList.contains("exam-gap") || e.classList.contains("exam-away"));
    expect(counts.length).toBeGreaterThan(0);
    for (const el of counts) expect(el.className).toContain("np-data");
  });

  it("app-5: a late bundle from the previous semester cannot overwrite the new one", async () => {
    let release2026 = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release2026 = resolve;
    });
    // The plan is stored per semester, so the race needs the same course in
    // both: a student carrying TDT4109 into the spring (or any programme
    // prefill that re-derives it) is what keeps one `PlanCourseState` alive
    // across the switch.
    planStorage.set("np:lastSemester", "26h");
    const stored = [{ code: "TDT4109", name: "IT grunnkurs", version: "1", source: "manual" }];
    planStorage.set("np:plans", JSON.stringify({ "26h": stored, "27v": stored }));
    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(async (url: string) => {
      if (url.includes("/data/search-index.json")) return jsonResponse({ year: 2026, courses: [] });
      if (url.includes("/timetable") && url.includes("year=2026")) {
        await gate;
        return jsonResponse([entry("TDT4109", 1, "08:15", "10:00")]);
      }
      if (url.includes("/timetable") && url.includes("year=2027")) {
        return jsonResponse([entry("TDT4109", 2, "14:15", "16:00", "2-17")]);
      }
      if (url.includes("/api/course/")) return jsonResponse(DETAILS);
      return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
    });
    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    const { createPlanStore } = await import("../../src/lib/planner/store.js");
    clearCourseBundleMemo();
    clearPlannerIndexMemo();
    const mounted = mountPlannerApp(SEMESTERS_TWO as never, undefined);
    await new Promise((r) => setTimeout(r, 0));

    // A bar no longer prints its own start time — the axis above it does
    // — so the slot a block stands for is read off its
    // accessible name, which still spells the day and the hours out loud.
    const slots = (): string =>
      find("planner-grid-frame")
        .querySelectorAll(".planner-cols-block")
        .map((b) => b.getAttribute("aria-label") ?? "")
        .join(" | ");

    // The student switches term before the first fetch settles.
    createPlanStore("26h").setSemester("27v");
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    expect(slots()).toContain("14:15");

    // …and only then does 26h's timetable arrive.
    release2026();
    await mounted;
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    expect(slots()).toContain("14:15");
    expect(slots()).not.toContain("08:15");
  });

  // KNOAND/MTPROD: NTNU publishes no study plan at all. The studieinfo dialog
  // now saves such a programme (studieinfo's half of), so the planner is where
  // the student lands — and it used to say nothing about why the week is bare.
  it("ux-fail-5: a programme with no study plan says so and offers the way out", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/KNOAND/plan": () => "FAIL404",
      },
      { program: { code: "KNOAND", name: "KNOAND", cohort: 2026 } },
    );
    expect(find("planner-direction").hidden).toBe(false);
    expect(find("planner-direction-title").textContent).toBe("Fant ingen studieplan");
    expect(find("planner-direction-note").textContent).toBe(
      "NTNU publiserer ingen studieplan for KNOAND. Legg til emnene du tar selv.",
    );
    expect(find("planner-direction-btn").textContent).toBe("Legg til emne");
    // The week says the same thing instead of the canned "Legg til emner …".
    expect(find("planner-grid-frame").textContent).toContain("publiserer ingen studieplan");
    // 's provenance half (landed in wave 3) must not contradict it.
    expect(find("planner-provenance").textContent).toContain("Fant ingen studieplan for KNOAND.");
    expect(find("planner-provenance").textContent).not.toContain("studieplan for kull 2026");
  });

  // A study plan we asked for and did not get is a different fact, and the
  // branch above must not claim NTNU publishes nothing over it.
  it("ux-fail-5 control: a failed study-plan fetch is not reported as 'ingen studieplan'", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/KNOAND/plan": () => "FAIL",
      },
      { program: { code: "KNOAND", name: "KNOAND", cohort: 2026 } },
    );
    expect(find("planner-direction-title").textContent).not.toBe("Fant ingen studieplan");
    expect(find("planner-provenance").textContent).toContain(
      "Fikk ikke hentet studieplanen for KNOAND.",
    );
  });

  /**
   * The credit gap's door, merged into the one add surface as a filter.
   *
   * `#planner-gap-btn` ("Velg fra studieplanen (8)") opened the very dialog
   * `#planner-add-course-btn` opens, on the whole catalog, so the pool it named
   * appeared on neither surface. These pin what replaced it: the facet exists
   * only when there is a pool, it opens engaged when the plan is short of
   * credits, and turning it off is a way back to the catalog that says so.
   */
  describe("the study-plan facet in the add dialog", () => {
    /** A choice-group course: anything whose `studyChoice.code` is not "O". */
    function elective(code: string, name: string, credits: number) {
      return {
        code,
        version: "1",
        name,
        credits,
        planElement: false,
        studyChoice: { code: "V", name: "Valgbart emne", description: null },
      };
    }

    const PROGRAM = {
      code: "BIT",
      name: "Informasjonsbehandling",
      year: 2026,
      startTerm: "AUTUMN",
      updated: null,
      publishedYears: [2026],
      periods: [
        {
          periodNumber: 1,
          direction: {
            code: null,
            name: null,
            courseGroups: [
              {
                name: null,
                description: null,
                type: "O",
                courses: [obligatory("TDT4109", "Informasjonsteknologi", 7.5)],
              },
              {
                name: "Valgemner",
                description: "Velg blant emnene under.",
                type: "V",
                courses: [
                  elective("TDT4160", "Datamaskiner og digitalteknikk", 7.5),
                  elective("TDT4180", "Menneske-maskin-interaksjon", 7.5),
                ],
              },
            ],
            waypoints: [],
          },
        },
      ],
    };

    /** Two pool rows plus one course the pool does not name. */
    const INDEX = {
      year: 2026,
      courses: [
        ["TDT4109", "Informasjonsteknologi", null, [], "1", [2026]],
        ["TDT4160", "Datamaskiner og digitalteknikk", null, [], "1", [2026]],
        ["TDT4180", "Menneske-maskin-interaksjon", null, [], "1", [2026]],
        ["TMA4100", "Matematikk 1", null, [], "1", [2026]],
      ],
    };

    const scope = () => body.querySelector(".add-course-scope");
    const status = () => body.querySelector(".add-course-status");
    const input = () => body.querySelector(".add-course-input");
    const rowCodes = () => body.querySelectorAll(".add-course-row-code").map((e) => e.textContent);

    async function open(): Promise<void> {
      await mount(
        {
          "/data/search-index.json": () => INDEX,
          "/api/program/BIT/plan": () => PROGRAM,
          "/api/course/": () => DETAILS,
        },
        { program: { code: "BIT", name: "BIT", cohort: 2026 } },
      );
      find("planner-add-course-btn").click();
    }

    it("opens engaged on a short plan, and lists the pool instead of an empty search", async () => {
      await open();
      // 7,5 of 30 sp prefilled, so the gap sentence is up — the exact state the
      // removed button rendered in.
      expect(find("planner-gap-line").hidden).toBe(false);
      expect(scope()?.hidden).toBe(false);
      expect(scope()?.textContent).toBe("Fra studieplanen (2)");
      expect(scope()?.getAttribute("aria-pressed")).toBe("true");
      // ONE PRESS from "Mangler 22,5 sp" to the study plan's own courses, which
      // is what the old door cost and never actually delivered.
      expect(rowCodes()).toEqual(["TDT4160", "TDT4180"]);
      expect(status()?.textContent).toBe("2 emner fra studieplanen din.");
    });

    it("scopes the search, and names the filter when that is why there is nothing", async () => {
      await open();
      const field = input();
      if (!field) throw new Error("no search field");
      field.value = "matematikk";
      field.dispatch("input", {});
      expect(rowCodes()).toEqual([]);
      // Not "0 treff": the catalog has the course and the filter is the reason
      // it is not here, so the sentence names the control that lets it in.
      expect(status()?.textContent).toContain("Ingen treff i studieplanen din.");
      expect(status()?.textContent).toContain("Slå av «Fra studieplanen»");
    });

    it("turning the filter off searches the whole catalog again", async () => {
      await open();
      const field = input();
      if (!field) throw new Error("no search field");
      field.value = "matematikk";
      field.dispatch("input", {});
      scope()?.click();
      expect(scope()?.getAttribute("aria-pressed")).toBe("false");
      expect(rowCodes()).toEqual(["TMA4100"]);
    });

    it("a full plan opens on the catalog, with the facet present but off", async () => {
      await mount(
        {
          "/data/search-index.json": () => INDEX,
          "/api/program/BIT/plan": () => PROGRAM,
          "/api/course/": () => ({ ...DETAILS, credits: 30 }),
        },
        { program: { code: "BIT", name: "BIT", cohort: 2026 } },
      );
      // 30 sp: nothing is missing, so nothing preempts the search the button
      // says it opens.
      expect(find("planner-gap-line").hidden).toBe(true);
      find("planner-add-course-btn").click();
      expect(scope()?.hidden).toBe(false);
      expect(scope()?.getAttribute("aria-pressed")).toBe("false");
      expect(status()?.textContent).toBe("Skriv for å søke i 4 emner.");
    });
  });

  it("pd-3/modals-7: the add dialog names a dead catalog and does not eat Escape", async () => {
    await mount(
      {
        "/data/search-index.json": () => "FAIL",
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => DETAILS,
      },
      { courses: ["TDT4109"] },
    );
    find("planner-add-course-btn").click();
    const dialog = body.querySelector(".add-course-dialog");
    expect(dialog?.open).toBe(true);
    expect(body.querySelector(".add-course-status")?.textContent).toBe(
      "Fikk ikke hentet emnekatalogen.",
    );
    // `type="search"` made Chrome swallow the first Escape to clear
    // the field, so the dialog took two presses to leave.
    expect(body.querySelector(".add-course-input")?.type).toBe("text");
  });

  it("pd-3 control: the add dialog still says 'Henter emner …' while the catalog loads", async () => {
    let releaseIndex = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseIndex = resolve;
    });
    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "#26h;-;%2BTDT4109",
      search: "",
      pathname: "/planlegger/",
    };
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(async (url: string) => {
      if (url.includes("/data/search-index.json")) {
        await gate;
        return jsonResponse({ year: 2026, courses: [] });
      }
      if (url.includes("/timetable")) return jsonResponse([entry("TDT4109", 1, "08:15", "10:00")]);
      if (url.includes("/api/course/")) return jsonResponse(DETAILS);
      return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
    });
    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();
    const mounted = mountPlannerApp(SEMESTERS as never, undefined);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    find("planner-add-course-btn").click();
    expect(body.querySelector(".add-course-status")?.textContent).toBe("Henter emner …");

    releaseIndex();
    await mounted;
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
});
