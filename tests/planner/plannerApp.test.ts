/**
 * `mountPlannerApp` end to end, against the audit's own degraded-path repros.
 *
 * The audit's §1 verdict is that "we don't know" renders as "it's fine", and
 * every one of those regressions reached a green build because nothing below
 * the browser suite ever mounted this module. So this file mounts it for real:
 * a hand-rolled DOM shim (this repo deliberately ships no jsdom/happy-dom),
 * a stubbed `fetch` per scenario, and assertions on the four surfaces the
 * findings name — the verdict line, the provenance line, the week frame and
 * the course rail.
 *
 * The shim is minimal ON PURPOSE and implements only what the planner's own
 * render path touches. It is not a DOM: no layout, no CSS, no real selector
 * engine (`querySelectorAll` matches the LAST simple selector of a compound).
 * If a future change reaches for an API it lacks, this file fails loudly —
 * which is the safe direction. Anything visual, focus-related or CSS-dependent
 * belongs in `e2e/*.pw.ts`, not here.
 *
 * Every scenario below was confirmed to FAIL against the pre-fix module and
 * pass after, except the deliberate healthy-plan control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

class FakeEl {
  tagName: string;
  _className = "";
  id = "";
  children: FakeEl[] = [];
  parent: FakeEl | null = null;
  private text = "";
  classList: FakeClassList = new FakeClassList(this);
  dataset: Record<string, string> = {};
  /** `display` is real state: plannerApp sets it to defeat `.np-btn`'s author rule (plan-8). */
  style = { setProperty: () => {}, removeProperty: () => {}, display: "" };
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
  /** The only layout the shim has: what `getBoundingClientRect().width` reports (mob-5). */
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
  matches(sel: string): boolean {
    if (sel.startsWith("#")) return this.id === sel.slice(1);
    if (sel.startsWith(".")) return this.classList.contains(sel.slice(1));
    return this.tagName === sel.toUpperCase();
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
  "planner-context-line",
  "planner-link-note",
  "planner-credit-line",
  "planner-credit-note",
  "planner-credit-strip",
  "planner-direction",
  "planner-direction-title",
  "planner-direction-note",
  "planner-direction-actions",
  "planner-direction-btn",
  "planner-others-toggle",
  "planner-view-uke",
  "planner-view-tavle",
  "planner-scroll-hint",
  "planner-grid-frame",
  "planner-grid-notes",
  "planner-grid-status",
  "planner-status",
  "planner-exam-list-host",
  "planner-exam-status",
  "planner-course-rows",
  "planner-gap-line",
  "planner-gap-text",
  "planner-gap-btn",
  "planner-add-course-btn",
  "planner-plan-panel",
  "planner-plan-body",
  "planner-provenance",
];

let byId: Map<string, FakeEl>;
let body: FakeEl;
let replaceStateCalls: { state: unknown; url: string }[] = [];
let winListeners: Map<string, ((e: unknown) => void)[]> = new Map();
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
  replaceStateCalls = [];
  const doc = {
    body,
    documentElement: new FakeEl("html"),
    activeElement: null as FakeEl | null,
    createElement: (tag: string) => new FakeEl(tag),
    getElementById: (id: string) =>
      byId.get(id) ?? body.descendants().find((e) => e.id === id) ?? null,
    querySelector: (s: string) => body.querySelector(s),
    querySelectorAll: (s: string) => body.querySelectorAll(s),
    addEventListener: () => {},
    removeEventListener: () => {},
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
  g.history = {
    state: { index: 3, scrollX: 0, scrollY: 0 },
    replaceState: (state: unknown, _t: string, url: string) => {
      replaceStateCalls.push({ state, url });
    },
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
 * 26h plus a published spring semester, for the scenarios that switch term
 * (app-3, app-5). `data/semesters.json` only has 26h published today, which is
 * why app-5 is latent on screen — the defect is in the code either way.
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
 * === "O"` is the ONLY structured signal for that (DR-5, programPlan.ts:291) —
 * a fixture without it prefills nothing.
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

  async function mount(
    routes: Record<string, () => unknown>,
    hash: string,
    semesters: unknown = SEMESTERS,
  ) {
    (globalThis as unknown as Record<string, unknown>).location = {
      hash,
      search: "",
      pathname: "/planlegger/",
    };
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
    await mountPlannerApp(semesters as never, [], undefined);
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
      "#26h;-;%2BTDT4109,%2BTMA4400,%2BTMA4412",
    );
    const status = find("planner-grid-status");
    expect(status.textContent).toBe("kan ikke sjekkes — mangler timeplan for 1 emne");
    expect(status.classList.contains("is-clean")).toBe(false);
    expect(status.classList.contains("np-note-clash")).toBe(false);
  });

  it("pc-3 control: an all-healthy plan still says ingen kollisjoner", async () => {
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
      "#26h;-;%2BTDT4109,%2BTMA4412",
    );
    const status = find("planner-grid-status");
    expect(status.textContent).toBe("ingen kollisjoner");
    expect(status.classList.contains("is-clean")).toBe(true);
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
      "#26h;-;%2BTDT4109,%2BTMA4400",
    );
    const prov = find("planner-provenance").textContent;
    expect(prov).not.toContain("Henter timeplan fra NTNU nå");
    expect(prov).toContain("Timeplan hentet direkte fra NTNU nå");
    expect(prov).toContain("Fikk ikke hentet timeplan for TMA4400");
    expect(prov).not.toMatch(/Not found|Failed to fetch|boom/);
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
      "#26h;MTMT.2026;",
    );
    const prov = find("planner-provenance").textContent;
    expect(prov).toContain("studieplan for kull 2024 (ingen egen plan for kull 2026)");
  });

  it("app-1: syncHash never writes a null history state", async () => {
    await mount(
      { "/data/search-index.json": () => ({ year: 2026, courses: [] }) },
      "#26h;-;%2BTDT4109",
    );
    expect(replaceStateCalls.length).toBeGreaterThan(0);
    for (const call of replaceStateCalls) expect(call.state).not.toBeNull();
  });

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
      "#26h;MTDT.2026;%2BTDT4109",
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
      "#26h;-;%2BTDT4109",
    );
    const examHost = find("planner-exam-list-host");
    expect(examHost.textContent).toContain("Fikk ikke hentet eksamensdatoene.");
    expect(examHost.descendants().filter((e) => e.textContent === "Prøv igjen").length).toBe(1);
    expect(find("planner-exam-status").textContent).not.toContain("henter");
    const prov = find("planner-provenance").textContent;
    expect(prov).toContain("fikk ikke hentet eksamensdatoene");
    expect(prov).not.toContain("eksamensdatoer ikke publisert");
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
      "#26h;MPPR.2026;",
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
      hash: "#26h;MTDT.2026;",
      search: "",
      pathname: "/planlegger/",
    };
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
    const mounted = mountPlannerApp(SEMESTERS as never, [], undefined);
    await new Promise((r) => setTimeout(r, 0));

    // The student pastes a program-less shared link while the plan fetch is
    // still in flight (the 404 ladder can spend three round trips here).
    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "#26h;-;%2BPSY1000",
      search: "",
      pathname: "/planlegger/",
    };
    for (const fn of winListeners.get("hashchange") ?? []) fn({});
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
      "#26h;-;%2BTDT4109,%2BTMA4400",
    );
    // REWORK-2026-07-29 D2/D1: the row itself is identity plus one mark that
    // there is something to read; the sentence and the retry live in the
    // settings modal the row opens.
    const rows = find("planner-course-rows");
    expect(rows.textContent).toContain("se detaljer");
    expect(rows.textContent).not.toContain("fikk ikke hentet");

    const row = rows.descendants().find((e) => e.dataset.code === "TMA4400");
    expect(row).toBeDefined();
    row?.click();

    const dialog = body.querySelector(".course-settings");
    expect(dialog?.open).toBe(true);
    const buttons = dialog
      ?.descendants()
      .filter((e) => e.tagName === "BUTTON" && e.textContent === "Prøv igjen");
    expect(buttons?.length).toBe(1);
    // copy-2: nothing on the surface is upstream English.
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
      "#26h;-;%2BTMA4100",
    );
    // The row flags that there is something to read; the sentence itself is in
    // the settings modal (D2).
    const rows = find("planner-course-rows");
    expect(rows.textContent).toContain("se detaljer");

    const row = rows.descendants().find((e) => e.dataset.code === "TMA4100");
    row?.click();
    const dialog = body.querySelector(".course-settings");
    expect(dialog?.textContent).toContain("Ikke undervist i 2026 — sist undervist 2025");
    expect(dialog?.textContent).not.toContain("Fikk ikke hentet");
  });

  it("app-3: the link note stops naming a semester after the student switches", async () => {
    await mount(
      { "/data/search-index.json": () => ({ year: 2026, courses: [] }) },
      // A shared link for a term this build cannot plan: the note fires and the
      // planner falls back to Høst 2026.
      "#25h;-;%2BTDT4109",
      SEMESTERS_TWO,
    );
    const note = find("planner-link-note");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("viser Høst 2026");

    // studieinfo's Lagre → store.setSemester → savePlan. It does NOT go through
    // `hashchange` (syncHash uses replaceState), which is why nothing cleared it.
    const { createPlanStore } = await import("../../src/lib/planner/store.js");
    createPlanStore("26h").setSemester("27v");
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    expect(find("planner-context-line").textContent).toContain("Vår 2027");
    expect(note.textContent).toBe("");
    expect(note.hidden).toBe(true);
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
      "#26h;MTDT.2026;",
    );
    // The row carries no Dropp of its own any more (D3 relaxed §0.3's "one tap
    // to restore" to two) — it opens the settings modal, and the verb is there.
    const rows = find("planner-course-rows");
    const row = rows.descendants().find((e) => e.dataset.code === "TDT4136");
    expect(row).toBeDefined();
    row?.click();

    const dialog = body.querySelector(".course-settings");
    const dropp = dialog
      ?.descendants()
      .find((e) => e.getAttribute("aria-label") === "Dropp TDT4136");
    expect(dropp).toBeDefined();
    dropp?.click();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    // The action closes the modal (the course it edits is no longer on screen)
    // and the row stays, grayed and saying so — §0.3's visible, reversible drop.
    expect(dialog?.open).toBe(false);
    const dropped = rows.descendants().find((e) => e.dataset.code === "TDT4136");
    expect(dropped?.className).toContain("is-dropped");
    expect(rows.textContent).toContain("droppet");

    // …and the way back is the same row, now offering the reverse verb.
    dropped?.click();
    const reopened = body.querySelector(".course-settings");
    expect(
      reopened?.descendants().find((e) => e.getAttribute("aria-label") === "Legg tilbake TDT4136"),
    ).toBeDefined();
  });

  it("store-4: a reload from the hash keeps the study plan's credits on disk", async () => {
    // What the B9.1 fallback wrote: a study-plan elective the catalog does not
    // list, carrying the plan's own name and sp. The hash carries neither.
    planStorage.set("np:lastSemester", "26h");
    planStorage.set(
      "np:plans",
      JSON.stringify({
        "26h": [
          {
            code: "ZZZ9999",
            name: "Fordypningsemne i studieplanen",
            version: "1",
            source: "manual",
            credits: 15,
          },
        ],
      }),
    );
    await mount(
      { "/data/search-index.json": () => ({ year: 2026, courses: [] }) },
      "#26h;-;%2BZZZ9999",
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
      "#26h;MSCHEM.2026;",
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
      "#26h;MJORM.2026;",
    );
    expect(find("planner-credit-note").textContent).toContain("Fjern det du ikke tar");
  });

  it("plan-8: an empty study-plan pool leaves no stray Velg fra studieplanen", async () => {
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
      "#26h;MPPR.2026;",
    );
    const button = find("planner-gap-btn");
    expect(find("planner-gap-line").hidden).toBe(false);
    expect(button.hidden).toBe(true);
    // `.np-btn { display: inline-flex }` beats the UA's `[hidden]`, so the
    // property alone left a 36 px button on screen (plan-8).
    expect(button.style.display).toBe("none");
  });

  it("mob-5: no drag hint or edge mask when the whole grid is on screen", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => DETAILS,
      },
      "#26h;-;%2BTDT4109",
    );
    const frame = find("planner-grid-frame");
    const grid = frame.querySelector(".planner-grid");
    expect(grid).not.toBeNull();
    // The measured 390 px geometry: the frame's own 24 px padding is scrollable
    // content, so scrollWidth - clientWidth is 26 while the grid itself fits.
    frame.clientWidth = 358;
    frame.scrollWidth = 384;
    if (grid) grid.rectWidth = 336;
    for (const fn of winListeners.get("resize") ?? []) fn({});
    expect(find("planner-scroll-hint").hidden).toBe(true);
    expect(frame.dataset.scroll).toBeUndefined();

    // 360 px, where the fre column really does hang 8 px past the edge.
    frame.clientWidth = 328;
    frame.scrollWidth = 384;
    for (const fn of winListeners.get("resize") ?? []) fn({});
    expect(find("planner-scroll-hint").hidden).toBe(false);
    expect(frame.dataset.scroll).toBe("start");
  });

  it("ds-5: the exam gap counts reading days and matches its neighbours' ink", async () => {
    // The planner index is memoised per module, and a FAILED download is
    // memoised too — so an earlier scenario that stubbed a dead index leaves
    // this one rendering "Fikk ikke hentet eksamensdatoene" over a perfectly
    // good stub. Clearing it makes the test independent of its neighbours,
    // which is what the other index-sensitive scenarios already do.
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
      "#26h;-;%2BAAA1000,%2BBBB1000",
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
    // Both day-count fragments are mono (ds-5): they used to sit rows apart in
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
    const mounted = mountPlannerApp(SEMESTERS_TWO as never, [], undefined);
    await new Promise((r) => setTimeout(r, 0));

    // A bar no longer prints its own start time — the axis above it does
    // (REWORK-2026-07-29b D1) — so the slot a block stands for is read off its
    // accessible name, which still spells the day and the hours out loud.
    const slots = (): string =>
      find("planner-grid-frame")
        .querySelectorAll(".planner-block")
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

  // KNOAND/MTPROD: NTNU publishes no study plan at all. The modal now saves
  // such a programme (studieinfo's half of ux-fail-5), so the planner is where
  // the student lands — and it used to say nothing about why the week is bare.
  it("ux-fail-5: a programme with no study plan says so and offers the way out", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/program/KNOAND/plan": () => "FAIL404",
      },
      "#26h;KNOAND.2026;",
    );
    expect(find("planner-direction").hidden).toBe(false);
    expect(find("planner-direction-title").textContent).toBe("Fant ingen studieplan");
    expect(find("planner-direction-note").textContent).toBe(
      "NTNU publiserer ingen studieplan for KNOAND. Legg til emnene du tar selv.",
    );
    expect(find("planner-direction-btn").textContent).toBe("Legg til emne");
    // The week says the same thing instead of the canned "Legg til emner …".
    expect(find("planner-grid-frame").textContent).toContain("publiserer ingen studieplan");
    // ux-fail-4's provenance half (landed in wave 3) must not contradict it.
    expect(find("planner-provenance").textContent).toContain("fant ingen studieplan for KNOAND");
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
      "#26h;KNOAND.2026;",
    );
    expect(find("planner-direction-title").textContent).not.toBe("Fant ingen studieplan");
    expect(find("planner-provenance").textContent).toContain(
      "fikk ikke hentet studieplanen for KNOAND",
    );
  });

  it("pd-3/modals-7: the add dialog names a dead catalog and does not eat Escape", async () => {
    await mount(
      {
        "/data/search-index.json": () => "FAIL",
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => DETAILS,
      },
      "#26h;-;%2BTDT4109",
    );
    find("planner-add-course-btn").click();
    const dialog = body.querySelector(".add-course-dialog");
    expect(dialog?.open).toBe(true);
    expect(body.querySelector(".add-course-status")?.textContent).toBe(
      "Fikk ikke hentet emnekatalogen.",
    );
    // modals-7: `type="search"` made Chrome swallow the first Escape to clear
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
    const mounted = mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    find("planner-add-course-btn").click();
    expect(body.querySelector(".add-course-status")?.textContent).toBe("Henter emner …");

    releaseIndex();
    await mounted;
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
});
