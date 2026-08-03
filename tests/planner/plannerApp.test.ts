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
import { shouldPullOnVisible } from "../../src/components/planner/plannerApp.js";
import { PLAN_CHANGE_EVENT, type StorageLike } from "../../src/lib/planner/store.js";
import { createSyncClient, type SyncClient } from "../../src/lib/planner/syncClient.js";

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
  "planner-profile-btn",
  "planner-profile-btn-label",
  "planner-link-note",
  "planner-credit-line",
  "planner-load-legend",
  "planner-credit-note",
  "planner-credit-strip",
  "planner-direction",
  "planner-direction-title",
  "planner-direction-note",
  "planner-direction-actions",
  "planner-direction-btn",
  "planner-others-toggle",
  "planner-others-pending",
  "planner-share",
  "planner-share-label",
  "planner-view-kolonner",
  "planner-view-tavle",
  "planner-grid-frame",
  "planner-grid-notes",
  "planner-grid-status",
  "planner-status",
  "planner-deadline",
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
let docListeners: Map<string, ((e: unknown) => void)[]> = new Map();
let planStorage: Map<string, string>;

/** `document.getElementById`, but a miss is a test bug, not a `null`. */
function find(id: string): FakeEl {
  const el = byId.get(id);
  if (!el) throw new Error(`no element #${id} in the shim`);
  return el;
}

/**
 * Flips the shim's `document.hidden` and fires `visibilitychange` on every
 * listener bound to it — the tab-switch-and-back this file's sync tests need
 * to drive `plannerApp.ts`'s own `document.addEventListener("visibilitychange",
 * …)` handlers (the day-rollover tick and the pull trigger both listen here).
 */
function fireVisibilityChange(hidden: boolean): void {
  const doc = (
    globalThis as unknown as {
      document: { hidden: boolean; dispatchEvent: (ev: { type: string }) => void };
    }
  ).document;
  doc.hidden = hidden;
  doc.dispatchEvent({ type: "visibilitychange" });
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

/** A `StorageLike` with nothing else attached — one "other device"'s own storage. */
function fakeStorage(seed: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

/**
 * A minimal in-memory stand-in for `/api/sync/*`: claim (POST), read (GET),
 * write (PUT) against one map — enough for two real `createSyncClient`s
 * sharing an account (real PBKDF2/AES-GCM, same as `syncClient.test.ts`) to
 * round-trip through it, which is what lets "device A" hand "device B" a
 * plan it can actually decrypt. It does not check `x-np-auth` — that
 * contract is exercised by the worker's own tests, not this one.
 */
function makeSyncServer() {
  const accounts = new Map<string, { blob: string; version: number }>();
  /** Every PUT this fake server has answered, in order — the signal the sync
   *  trigger tests key off: a pull-triggered render must never add to it. */
  const puts: string[] = [];
  async function handle(url: string, init?: RequestInit) {
    const navn = decodeURIComponent(url.replace("/api/sync/", ""));
    const method = init?.method ?? "GET";
    if (method === "POST") {
      const body = JSON.parse(String(init?.body)) as { blob: string };
      accounts.set(navn, { blob: body.blob, version: 1 });
      return jsonResponse({ version: 1 });
    }
    if (method === "PUT") {
      puts.push(navn);
      const body = JSON.parse(String(init?.body)) as { blob: string; version: number };
      const current = accounts.get(navn);
      if (!current) return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
      if (body.version !== current.version) {
        return { ok: false, status: 409, json: async () => ({ version: current.version }) };
      }
      const next = { blob: body.blob, version: current.version + 1 };
      accounts.set(navn, next);
      return jsonResponse({ version: next.version });
    }
    const current = accounts.get(navn);
    if (!current) return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
    return jsonResponse({ blob: current.blob, version: current.version });
  }
  return { handle, puts };
}

/**
 * What another device would see right now: `fetchRemote` + `applyRemote`, the
 * two halves of a pull composed by hand.
 *
 * `SyncClient` has no `pull()` — an unguarded fetch-and-overwrite is the exact
 * defect the split exists to remove, and leaving the composition on the public
 * interface kept inviting the next caller to reintroduce it. The APP has a
 * generation counter to check between the halves (`pullAndRefresh`); these
 * "other device" clients have nothing concurrent to protect.
 */
async function pullNow(client: SyncClient): Promise<void> {
  const fetched = await client.fetchRemote();
  if (fetched.ok) client.applyRemote(fetched.snapshot);
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
    expect(status.textContent).toBe("kan ikke sjekkes, mangler timeplan for 1 emne");
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
    // DR-1: the engine only ever compares LECTURES, so the pass says which
    // thing it checked. "ingen kollisjoner" claimed the whole week.
    expect(status.textContent).toBe("Ingen forelesninger kolliderer");
    // The state moved onto the chip when the verdict became a run of them; the
    // phone rule that hides a clean pass matches it with `:has()`.
    expect(status.querySelector(".is-clean")).not.toBeNull();
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
      "#26h;-;%2BMH2000,%2BMH2001",
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
      "#26h;-;%2BTDT4109",
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
      "#26h;-;%2BTDT4109,%2BTMA4400",
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
      "#26h;MTMT.2026;",
    );
    const prov = find("planner-provenance").textContent;
    expect(prov).toContain("Studieplan for kull 2024, det finnes ingen egen plan for kull 2026.");
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
    expect(prov).toContain("Fikk ikke hentet eksamensdatoene.");
    expect(prov).not.toContain("ikke publisert");
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
      "#26h;-;%2BTMA4100",
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
    expect(note.textContent).toContain("Viser Høst 2026");

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
    // property alone left a 36 px button on screen.
    expect(button.style.display).toBe("none");
  });

  it("mob-5: no edge mask when the whole grid is on screen", async () => {
    await mount(
      {
        "/data/search-index.json": () => ({ year: 2026, courses: [] }),
        "/api/course/TDT4109/timetable": () => [entry("TDT4109", 1, "08:15", "10:00")],
        "/api/course/": () => DETAILS,
      },
      "#26h;-;%2BTDT4109",
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
    const mounted = mountPlannerApp(SEMESTERS_TWO as never, [], undefined);
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

  // KNOAND/MTPROD: NTNU publishes no study plan at all. The modal now saves
  // such a programme (studieinfo's half of), so the planner is where
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
      "#26h;KNOAND.2026;",
    );
    expect(find("planner-direction-title").textContent).not.toBe("Fant ingen studieplan");
    expect(find("planner-provenance").textContent).toContain(
      "Fikk ikke hentet studieplanen for KNOAND.",
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
    const mounted = mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    find("planner-add-course-btn").click();
    expect(body.querySelector(".add-course-status")?.textContent).toBe("Henter emner …");

    releaseIndex();
    await mounted;
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
  });
});

/**
 * `applySyncable` (syncClient.ts) writes a pull's result straight into
 * storage, never through `store.savePlan` — so `store.onPlanChange` never
 * fires on its own and the page would otherwise keep drawing the pre-pull
 * week until an unrelated re-render happened to occur. These two tests cover
 * `plannerApp.ts`'s own fix for that (`applyPulledPlan`/`pullAndRefresh`,
 * mounted alongside the sync client): a pull that actually changes the plan
 * must repaint, a pull that does not must stay quiet, and neither may ever
 * schedule a push of its own.
 *
 * `replaceStateCalls.length` is the signal for "did a repaint happen":
 * `syncHash()` calls `history.replaceState` unconditionally exactly once
 * per `applyPlanUpdate`, including the one unconditional call every ordinary
 * mount already makes before its first paint — so the baseline after a
 * plain mount is 1, and a pull-triggered repaint (or the deliberate absence
 * of one) shows up as a clean +1 or +0 rather than something inferred from
 * DOM content that a différent render could produce by coincidence.
 */
/** Wires the fake sync server behind `/api/sync/*` and the ordinary course
 *  fixtures behind everything else, onto the one global `fetch` the
 *  planner's own `createSyncClient` and `loadBundles` both call through.
 *  Shared by every describe block below that mounts the planner with a sync
 *  session already in `localStorage`. */
function installCombinedFetch(server: ReturnType<typeof makeSyncServer>): void {
  (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
    async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/sync/")) return server.handle(url, init);
      if (url.includes("/data/search-index.json")) return jsonResponse({ year: 2026, courses: [] });
      if (url.includes("/api/course/TDT4109/timetable")) {
        return jsonResponse([entry("TDT4109", 1, "08:15", "10:00")]);
      }
      if (url.includes("/api/course/")) return jsonResponse(DETAILS);
      return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
    },
  );
}

describe("mountPlannerApp — a successful sync pull re-renders without pushing", () => {
  beforeEach(() => {
    installDom();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a pull that finds a changed plan repaints once and never pushes", async () => {
    const server = makeSyncServer();
    // Device A: another device, already on this account, plan empty at first.
    const storageA = fakeStorage({ "np:plans": '{"26h":[]}' });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    // This tab logs in while the server still only has the empty plan — the
    // same starting point a session restored from a week-old login would have.
    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };
    installCombinedFetch(server);
    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    const deviceB = createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceB.login("martin", "482913", "Tavle · nettleser");

    // Device A now adds a course and pushes — the server has moved on, which
    // is exactly the state a returning tab's on-load pull exists to notice.
    storageA.setItem(
      "np:plans",
      '{"26h":[{"code":"TDT4109","name":"TDT4109 navn","version":"1","source":"manual"}]}',
    );
    await deviceA.push();

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();
    const putsBefore = server.puts.length;

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    // Real time, past `schedulePush`'s 1s debounce: if the pull's repaint
    // had gone through the `onPlanChange` path instead of its own
    // `applyPulledPlan`, a push would fire in this window. A short flush
    // loop of 0ms ticks would not reach it, so this has to be a real wait.
    await new Promise((r) => setTimeout(r, 1100));

    // The pull landed and repainted: the course device A added is on screen…
    const row = find("planner-course-rows")
      .descendants()
      .find((e) => e.dataset.code === "TDT4109");
    expect(row).toBeDefined();
    // …the repaint happened exactly once on top of the mount's own first
    // paint (2 = 1 baseline + 1 from the pull)…
    expect(replaceStateCalls.length).toBe(2);
    // …and none of that repainting scheduled or fired a push of the plan
    // this tab just pulled back to the server.
    expect(server.puts.length).toBe(putsBefore);
  }, 10_000);

  it("a pull that finds the same plan does not repaint", async () => {
    const server = makeSyncServer();
    const storageA = fakeStorage({
      "np:plans":
        '{"26h":[{"code":"TDT4109","name":"TDT4109 navn","version":"1","source":"manual"}]}',
    });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };
    installCombinedFetch(server);
    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    const deviceB = createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    });
    // Logs in to the exact version the server still holds — nothing moves
    // between this and the planner's own on-load pull below.
    await deviceB.login("martin", "482913", "Tavle · nettleser");

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();
    const putsBefore = server.puts.length;

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // Only the mount's own unconditional first paint — the pull found
    // nothing new and stayed quiet rather than spending a repaint on a no-op.
    expect(replaceStateCalls.length).toBe(1);
    expect(server.puts.length).toBe(putsBefore);
  });
});

/**
 * Single device, single tab, no second device needed: an edit arms the 1s
 * debounced push, and — inside that same second — the tab goes hidden and
 * comes back. Before the fix, the visibility handler pulled unconditionally:
 * `sync.pull()` overwrites `localStorage` with the server's PRE-edit copy and
 * adopts the server's version, `applyPulledPlan` repaints the edit away, and
 * the still-armed timer then pushes the now edit-free copy — landing clean
 * (the version already matches) and reporting "ok" while the edit is gone
 * from screen, storage and server. `handleVisibilityPull` closes this by
 * flushing a pending push BEFORE pulling.
 */
describe("mountPlannerApp — a pending edit survives a visibility pull in the same second", () => {
  beforeEach(() => {
    installDom();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an edit still waiting to be pushed is not clobbered by a pull that fires before it", async () => {
    const server = makeSyncServer();
    // No second device required — the server just holds the pre-edit
    // (empty) plan throughout; the race is purely about ordering on this one
    // tab.
    const storageA = fakeStorage({ "np:plans": '{"26h":[]}' });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };
    installCombinedFetch(server);
    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    const deviceB = createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceB.login("martin", "482913", "Tavle · nettleser");

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    const putsBefore = server.puts.length;

    // The student adds a course — the same effect `store.addCourse` has,
    // driven through the same event `savePlan` dispatches. `onCustom` falls
    // back to a fresh `loadPlan()` read when `detail` is absent, so writing
    // storage first and then dispatching reproduces a real edit without
    // driving the add-course dialog's search flow, which is not what this
    // test is about.
    planStorage.set(
      "np:plans",
      '{"26h":[{"code":"TDT4109","name":"TDT4109 navn","version":"1","source":"manual"}]}',
    );
    (
      globalThis as unknown as { window: { dispatchEvent: (ev: { type: string }) => void } }
    ).window.dispatchEvent({ type: PLAN_CHANGE_EVENT });

    // Still well inside the 1s debounce window: the tab goes hidden and
    // comes back.
    fireVisibilityChange(true);
    fireVisibilityChange(false);

    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // The edit is still on screen and in local storage…
    expect(planStorage.get("np:plans")).toContain("TDT4109");
    const row = find("planner-course-rows")
      .descendants()
      .find((e) => e.dataset.code === "TDT4109");
    expect(row).toBeDefined();
    // …and it actually reached the server: a third client on the same
    // account, pulling fresh, decrypts to a plan that still has it.
    await pullNow(deviceA);
    expect(storageA.getItem("np:plans")).toContain("TDT4109");
    expect(server.puts.length).toBeGreaterThan(putsBefore);
  });
});

/**
 * `applyPlanUpdate` calls `loadPeriodCourses()` when a pull changes the
 * derivation key (semester|programme|cohort|direction) — and
 * `loadPeriodCourses` can itself call `store.setProgramPlan`, which
 * dispatches `PLAN_CHANGE_EVENT` and re-enters `store.onPlanChange`'s
 * subscriber, bumping `planGen` and scheduling a push exactly as a real
 * edit would.
 *
 * That push is INTENTIONAL under the counter design (`plannerApp.ts`'s own
 * comment on `planGen`): the derived obligatory course is real local
 * content the server does not have yet, so sending it is correct, not a
 * bug to suppress. What this test actually needs to prove is the "it
 * converges" half of that claim — the derive settles into exactly ONE push,
 * not a loop, and what lands on the server is the same content this tab
 * rendered.
 */
describe("mountPlannerApp — a pull-driven programme derive converges to one push", () => {
  beforeEach(() => {
    installDom();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the derived obligatory course reaches the server in exactly one push", async () => {
    const server = makeSyncServer();
    // Device A: another device, already on this account, no programme set yet.
    const storageA = fakeStorage({ "np:plans": '{"26h":[]}' });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    // This tab logs in before device A ever sets a programme — the starting
    // point a returning tab's on-load pull needs to find something to do.
    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };
    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    const deviceB = createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceB.login("martin", "482913", "Tavle · nettleser");

    // Device A now picks MTDT kull 2026 (no courses yet — the derive below
    // is what is supposed to fill them in) and pushes it.
    storageA.setItem("np:profile", '{"program":{"code":"MTDT","name":"MTDT","cohort":2026}}');
    await deviceA.push();

    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
      async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/sync/")) return server.handle(url, init);
        if (url.includes("/data/search-index.json"))
          return jsonResponse({ year: 2026, courses: [] });
        // MTDT kull 2026's period 1 (26h is the cohort's first autumn) —
        // same fixture shape as app-4/D3 above, obligatory course swapped
        // for TDT4109 so it shares the timetable route below.
        if (url.includes("/api/program/MTDT/plan")) {
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
                      courses: [obligatory("TDT4109", "TDT4109 navn", 7.5)],
                    },
                  ],
                  waypoints: [],
                },
              },
            ],
          });
        }
        if (url.includes("/api/course/TDT4109/timetable")) {
          return jsonResponse([entry("TDT4109", 1, "08:15", "10:00")]);
        }
        if (url.includes("/api/course/")) return jsonResponse(DETAILS);
        return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
      },
    );

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    const { clearProgramPlanMemo } = await import("../../src/components/planner/programPlan.js");
    clearCourseBundleMemo();
    clearPlannerIndexMemo();
    clearProgramPlanMemo();
    const putsBefore = server.puts.length;

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    // Real time, past `schedulePush`'s 1s debounce, so the derive's own
    // (intentional) push actually fires within this test rather than being
    // left dangling for whatever runs next.
    await new Promise((r) => setTimeout(r, 1100));

    // The derive ran — TDT4109 is on screen…
    const row = find("planner-course-rows")
      .descendants()
      .find((e) => e.dataset.code === "TDT4109");
    expect(row).toBeDefined();
    // …it reached the server in exactly one push (converged, not looped —
    // nothing else changed locally after the derive settled)…
    expect(server.puts.length).toBe(putsBefore + 1);
    // …and what a fresh pull from another client decrypts to is the same
    // derived content, not something a stale/duplicate push corrupted.
    await pullNow(deviceA);
    expect(storageA.getItem("np:plans")).toContain("TDT4109");
  }, 10_000);
});

/**
 * The two compound races review specifically asked for — each is a genuine
 * edit landing inside a window the SIMPLER (single) races already covered
 * did not reach: mid pull-driven derive, and mid the flush's own push round
 * trip. `planGen`/`isDirty()` is supposed to make both self-healing rather
 * than needing a bespoke guard per window; these are the tests that would
 * fail if that were only true in the cases already covered elsewhere.
 */
describe("mountPlannerApp — an edit survives a race inside the pull/push machinery itself", () => {
  beforeEach(() => {
    installDom();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("an edit made while loadPeriodCourses's own fetch is in flight survives a later visibility cycle", async () => {
    const server = makeSyncServer();
    const storageA = fakeStorage({ "np:plans": '{"26h":[]}' });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };
    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    const deviceB = createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceB.login("martin", "482913", "Tavle · nettleser");

    // Device A picks MTDT kull 2026 (no courses yet) and pushes — the
    // on-load pull below moves the derivation key and kicks off
    // `loadPeriodCourses`.
    storageA.setItem("np:profile", '{"program":{"code":"MTDT","name":"MTDT","cohort":2026}}');
    await deviceA.push();

    // The programme-plan fetch is held open until the test releases it —
    // the window a genuine edit needs to land inside.
    let releasePlan = (): void => {};
    const planGate = new Promise<void>((resolve) => {
      releasePlan = resolve;
    });
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
      async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/sync/")) return server.handle(url, init);
        if (url.includes("/data/search-index.json"))
          return jsonResponse({ year: 2026, courses: [] });
        if (url.includes("/api/program/MTDT/plan")) {
          await planGate;
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
                      courses: [obligatory("TDT4109", "TDT4109 navn", 7.5)],
                    },
                  ],
                  waypoints: [],
                },
              },
            ],
          });
        }
        if (url.includes("/api/course/TDT4109/timetable")) {
          return jsonResponse([entry("TDT4109", 1, "08:15", "10:00")]);
        }
        if (url.includes("/api/course/TDT4136/timetable")) {
          return jsonResponse([entry("TDT4136", 2, "10:15", "12:00")]);
        }
        if (url.includes("/api/course/")) return jsonResponse(DETAILS);
        return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
      },
    );

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    const { clearProgramPlanMemo } = await import("../../src/components/planner/programPlan.js");
    clearCourseBundleMemo();
    clearPlannerIndexMemo();
    clearProgramPlanMemo();

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    // Let the on-load pull land and `loadPeriodCourses` reach — and hang on
    // — the gated fetch.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // The genuine edit, while the derive's own fetch is still in flight —
    // `source: "manual"` so `store.setProgramPlan`'s own merge (it only
    // replaces `source: "program"` courses) preserves it once the derive
    // below finally lands.
    planStorage.set(
      "np:plans",
      '{"26h":[{"code":"TDT4136","name":"TDT4136 navn","version":"1","source":"manual"}]}',
    );
    (
      globalThis as unknown as { window: { dispatchEvent: (ev: { type: string }) => void } }
    ).window.dispatchEvent({ type: PLAN_CHANGE_EVENT });
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    // Now let the derive land: obligatory TDT4109 merges in alongside the
    // manual TDT4136, and `setProgramPlan`'s own write re-enters
    // `onPlanChange`, bumping `planGen` again.
    releasePlan();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    const putsBefore = server.puts.length;

    // A later visibility cycle is what is supposed to flush all of it.
    fireVisibilityChange(true);
    fireVisibilityChange(false);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // Both courses are on screen and in local storage…
    expect(planStorage.get("np:plans")).toContain("TDT4109");
    expect(planStorage.get("np:plans")).toContain("TDT4136");
    const rows = find("planner-course-rows").descendants();
    expect(rows.find((e) => e.dataset.code === "TDT4109")).toBeDefined();
    expect(rows.find((e) => e.dataset.code === "TDT4136")).toBeDefined();
    // …a push actually happened…
    expect(server.puts.length).toBeGreaterThan(putsBefore);
    // …and BOTH courses reached the server, not just whichever one a race
    // happened to send first.
    await pullNow(deviceA);
    expect(storageA.getItem("np:plans")).toContain("TDT4109");
    expect(storageA.getItem("np:plans")).toContain("TDT4136");
  }, 10_000);

  it("an edit made while the flush's own push is on the wire survives the same cycle", async () => {
    const server = makeSyncServer();
    const storageA = fakeStorage({ "np:plans": '{"26h":[]}' });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };

    // The FIRST PUT after `armGate()` is held open until the test releases
    // it; every other request (including later PUTs) passes straight
    // through. This is the flush's own network round trip, from the
    // inside.
    let gateActive = false;
    let releasePut = (): void => {};
    let gate: Promise<void> = Promise.resolve();
    function armGate(): void {
      gate = new Promise<void>((resolve) => {
        releasePut = resolve;
      });
      gateActive = true;
    }
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
      async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/sync/")) {
          if ((init?.method ?? "GET") === "PUT" && gateActive) {
            gateActive = false;
            await gate;
          }
          return server.handle(url, init);
        }
        if (url.includes("/data/search-index.json"))
          return jsonResponse({ year: 2026, courses: [] });
        if (url.includes("/api/course/TDT4109/timetable")) {
          return jsonResponse([entry("TDT4109", 1, "08:15", "10:00")]);
        }
        if (url.includes("/api/course/TDT4136/timetable")) {
          return jsonResponse([entry("TDT4136", 2, "10:15", "12:00")]);
        }
        if (url.includes("/api/course/")) return jsonResponse(DETAILS);
        return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
      },
    );

    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    const deviceB = createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceB.login("martin", "482913", "Tavle · nettleser");

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // First edit.
    planStorage.set(
      "np:plans",
      '{"26h":[{"code":"TDT4109","name":"TDT4109 navn","version":"1","source":"manual"}]}',
    );
    (
      globalThis as unknown as { window: { dispatchEvent: (ev: { type: string }) => void } }
    ).window.dispatchEvent({ type: PLAN_CHANGE_EVENT });

    // Fires the visibility cycle that flushes it — the very next push this
    // fetch mock sees is held open.
    armGate();
    fireVisibilityChange(true);
    fireVisibilityChange(false);
    // Give the async chain time to actually reach the gated fetch call and
    // hang there before the second edit lands.
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    // Second edit, while the first push is still on the wire — this tab's
    // own `collectSyncable` read for that in-flight push already missed it.
    planStorage.set(
      "np:plans",
      '{"26h":[{"code":"TDT4109","name":"TDT4109 navn","version":"1","source":"manual"},{"code":"TDT4136","name":"TDT4136 navn","version":"1","source":"manual"}]}',
    );
    (
      globalThis as unknown as { window: { dispatchEvent: (ev: { type: string }) => void } }
    ).window.dispatchEvent({ type: PLAN_CHANGE_EVENT });
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    releasePut();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // Both courses survived — the second edit was not left dirty with
    // nothing scheduled once the first push (that could not have carried
    // it) landed.
    expect(planStorage.get("np:plans")).toContain("TDT4109");
    expect(planStorage.get("np:plans")).toContain("TDT4136");
    await pullNow(deviceA);
    expect(storageA.getItem("np:plans")).toContain("TDT4109");
    expect(storageA.getItem("np:plans")).toContain("TDT4136");
  }, 10_000);
});

/**
 * The window every other sync test in this file steps over: an edit made
 * inside a PULL's own round trip — not before the visibility flip (covered
 * above), not inside a PUSH's round trip (covered above), but between the GET
 * going out and its answer coming back.
 *
 * `pull()` used to apply the response the moment it landed, unconditionally.
 * The dirty guard runs before `pullAndRefresh()` is CALLED, so nothing sat
 * between the GET returning and the wholesale overwrite of `np:plans` — and
 * `applySyncable` also resynced `session.version` to the server's, so the
 * debounced push that followed re-read the clobbered storage, landed a clean
 * 200 with no 409, and set "Sist synkronisert nå". The edit was gone from
 * screen, storage AND server, reported as a success.
 *
 * The fix is structural: `fetchRemote()` writes nothing, and the caller
 * refuses to apply an answer whose `planGen` has moved.
 */
describe("mountPlannerApp — an edit inside a pull's own round trip is not destroyed", () => {
  beforeEach(() => {
    installDom();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("the edit survives on screen, in storage and on the server, and is not reported as saved", async () => {
    const server = makeSyncServer();
    // The server holds the pre-edit (empty) plan throughout. One device, no
    // conflict — the race is purely about ordering on this tab.
    const storageA = fakeStorage({ "np:plans": '{"26h":[]}' });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };

    // The FIRST sync GET after `armGate()` hangs until the test releases it —
    // the pull's own round trip, from the inside. Everything else, including
    // the mount's on-load pull, passes straight through.
    let gateActive = false;
    let releaseGet = (): void => {};
    let gate: Promise<void> = Promise.resolve();
    function armGate(): void {
      gate = new Promise<void>((resolve) => {
        releaseGet = resolve;
      });
      gateActive = true;
    }
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
      async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/sync/")) {
          if ((init?.method ?? "GET") === "GET" && gateActive) {
            gateActive = false;
            await gate;
          }
          return server.handle(url, init);
        }
        if (url.includes("/data/search-index.json"))
          return jsonResponse({ year: 2026, courses: [] });
        if (url.includes("/api/course/TDT4109/timetable")) {
          return jsonResponse([entry("TDT4109", 1, "08:15", "10:00")]);
        }
        if (url.includes("/api/course/")) return jsonResponse(DETAILS);
        return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
      },
    );

    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    const deviceB = createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceB.login("martin", "482913", "Tavle · nettleser");

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // Nothing is dirty, so the visibility flip goes straight to the pull —
    // whose GET is now held open.
    armGate();
    fireVisibilityChange(true);
    fireVisibilityChange(false);
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    // The student drops a course in — inside the GET's own round trip. The
    // response already on its way back knows nothing about it.
    planStorage.set(
      "np:plans",
      '{"26h":[{"code":"TDT4109","name":"TDT4109 navn","version":"1","source":"manual"}]}',
    );
    (
      globalThis as unknown as { window: { dispatchEvent: (ev: { type: string }) => void } }
    ).window.dispatchEvent({ type: PLAN_CHANGE_EVENT });
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

    releaseGet();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
    // Real time, past `schedulePush`'s 1s debounce, so the edit's own push
    // actually fires inside this test.
    await new Promise((r) => setTimeout(r, 1100));

    // The edit is still in storage — the stale answer did not overwrite it…
    expect(planStorage.get("np:plans")).toContain("TDT4109");
    // …it is still on screen…
    const row = find("planner-course-rows")
      .descendants()
      .find((e) => e.dataset.code === "TDT4109");
    expect(row).toBeDefined();
    // …and it actually reached the server, rather than a green "synced" over
    // a plan the pull had already emptied.
    await pullNow(deviceA);
    expect(storageA.getItem("np:plans")).toContain("TDT4109");
  }, 10_000);
});

/**
 * The same race, arriving from the other side: the shared-link branch writes
 * a `#…` plan into storage SYNCHRONOUSLY, but it runs long after the on-load
 * pull was fired and long before `store.onPlanChange`'s subscriber is
 * registered — so nothing bumped `planGen` and the tab read as clean. The
 * pull's answer then overwrote the friend's plan, `applyPlanUpdate` cleared
 * `replacedPlan` and `syncHash()` rewrote the URL: the link, the plan and the
 * way back all vanished after a ~200 ms flash. The link application bumps the
 * counter now, so the pull guard covers this case with no separate logic.
 */
describe("mountPlannerApp — an on-load pull does not eat a shared link", () => {
  beforeEach(() => {
    installDom();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the link's plan and the way back to the student's own", async () => {
    const server = makeSyncServer();
    // The account holds a DIFFERENT plan (TDT4136) from both the link
    // (TDT4109) and this device's stored one (TMA4400).
    const storageA = fakeStorage({
      "np:plans":
        '{"26h":[{"code":"TDT4136","name":"TDT4136 navn","version":"1","source":"manual"}]}',
    });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "#26h;-;%2BTDT4109",
      search: "",
      pathname: "/planlegger/",
    };
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
      async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/sync/")) return server.handle(url, init);
        if (url.includes("/data/search-index.json"))
          return jsonResponse({ year: 2026, courses: [] });
        if (url.includes("/api/course/TDT4109/timetable")) {
          return jsonResponse([entry("TDT4109", 1, "08:15", "10:00")]);
        }
        if (url.includes("/api/course/TDT4136/timetable")) {
          return jsonResponse([entry("TDT4136", 2, "10:15", "12:00")]);
        }
        if (url.includes("/api/course/")) return jsonResponse(DETAILS);
        return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
      },
    );

    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    const deviceB = createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceB.login("martin", "482913", "Tavle · nettleser");
    // This device had a plan of its own before the link arrived — which is
    // what makes `replacedPlan` (the "Behold min egen" way back) real.
    planStorage.set(
      "np:plans",
      '{"26h":[{"code":"TMA4400","name":"TMA4400 navn","version":"1","source":"manual"}]}',
    );

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // The link's plan is what is on screen and in storage — not the account's.
    expect(planStorage.get("np:plans")).toContain("TDT4109");
    expect(planStorage.get("np:plans")).not.toContain("TDT4136");
    const rows = find("planner-course-rows").descendants();
    expect(rows.find((e) => e.dataset.code === "TDT4109")).toBeDefined();
    // …and the way back to the student's own plan is still offered.
    const note = find("planner-link-note");
    expect(note.hidden).toBe(false);
    expect(note.textContent).toContain("Denne delte planen erstattet din egen.");
  }, 10_000);

  /**
   * The other direction, and the worse one. Opening a link REPLACES
   * `np:plans`, and the tab was left dirty with no push armed — `schedulePush`
   * needs the `onPlanChange` subscriber, which is registered long after the
   * link branch runs. So the friend's plan sat there as unsent work until
   * something flushed it: the first visibility flip, or the search-index name
   * backfill a few hundred ms later (which fires for EVERY link, since a hash
   * carries codes and not names). Either one pushed a plan the student had
   * merely looked at into their own account, over their own plan on every
   * device.
   *
   * A viewed link is now a viewer: this tab neither sends nor receives until
   * the student settles it.
   */
  it("never pushes a link the student only opened", async () => {
    const server = makeSyncServer();
    const storageA = fakeStorage({
      "np:plans":
        '{"26h":[{"code":"TDT4136","name":"TDT4136 navn","version":"1","source":"manual"}]}',
    });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "#26h;-;%2BTDT4109",
      search: "",
      pathname: "/planlegger/",
    };
    installCombinedFetch(server);

    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    const deviceB = createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceB.login("martin", "482913", "Tavle · nettleser");
    planStorage.set(
      "np:plans",
      '{"26h":[{"code":"TMA4400","name":"TMA4400 navn","version":"1","source":"manual"}]}',
    );

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();
    const putsBefore = server.puts.length;

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // Trigger one: a write the PAGE makes on the link's behalf — the name
    // backfill's `savePlan`, reaching the subscriber like any other change.
    (
      globalThis as unknown as { window: { dispatchEvent: (ev: { type: string }) => void } }
    ).window.dispatchEvent({ type: PLAN_CHANGE_EVENT });
    // Trigger two: the student switches tabs and comes back.
    fireVisibilityChange(true);
    fireVisibilityChange(false);

    // Real time, past `schedulePush`'s 1s debounce, so a push that WAS armed
    // would have fired inside this test rather than after it.
    await new Promise((r) => setTimeout(r, 1100));
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // Nothing was sent…
    expect(server.puts.length).toBe(putsBefore);
    // …and the account still holds the student's own plan, not the friend's.
    await pullNow(deviceA);
    expect(storageA.getItem("np:plans")).toContain("TDT4136");
    expect(storageA.getItem("np:plans")).not.toContain("TDT4109");
  }, 10_000);
});

/**
 * Signing in is the OTHER write to `np:plans` that bypasses `store.savePlan`:
 * `login` calls `applySyncable` straight through `localStorage`. It did not
 * move `planGen`, so a GET already on the wire still satisfied
 * `planGen === sentGen`, and its snapshot — fetched before the student signed
 * in, at a version two writes old — was applied straight over the state the
 * login had just established, session version and device registry included.
 *
 * Driven on ONE account on purpose. Logging into a *different* account inside
 * the same window is caught by accident today (the answer is decrypted with
 * whatever key the session holds NOW, so the other account's blob fails to
 * open) — an accident is not the guard, and this is the case where there is no
 * accident to lean on.
 *
 * The profile panel is replaced with a double so the test can hold the two
 * halves apart in time — it captures the very `deps` the real panel is handed,
 * including the app's OWN sync client, and drives `login` + `onAuthenticated`
 * exactly as `renderSignedOut`'s `submit()` does.
 */
describe("mountPlannerApp — a login inside a pull's round trip is not overwritten", () => {
  beforeEach(() => {
    installDom();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("../../src/components/planner/profilePanel.js");
  });

  it("refuses the answer to a GET that predates the login", async () => {
    const server = makeSyncServer();
    // Another device on the same account, holding the plan this tab starts on.
    const storageA = fakeStorage({
      "np:plans":
        '{"26h":[{"code":"TDT4136","name":"TDT4136 navn","version":"1","source":"manual"}]}',
    });
    const deviceA = createSyncClient({
      storage: storageA,
      fetch: server.handle as unknown as typeof fetch,
    });
    await deviceA.signup("martin", "482913", "Mac");

    (globalThis as unknown as Record<string, unknown>).location = {
      hash: "",
      search: "",
      pathname: "/planlegger/",
    };

    const localStorageLike = (globalThis as unknown as { localStorage: StorageLike }).localStorage;
    await createSyncClient({
      storage: localStorageLike,
      fetch: server.handle as unknown as typeof fetch,
    }).login("martin", "482913", "Tavle · nettleser");

    // The first GET is answered as of NOW and then held: the response body is
    // captured before the account moves on, which is what makes it stale by
    // the time the student sees it.
    let releaseGet = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    let held = false;
    (globalThis as unknown as Record<string, unknown>).fetch = vi.fn(
      async (url: string, init?: RequestInit) => {
        if (url.startsWith("/api/sync/")) {
          const answer = await server.handle(url, init);
          if ((init?.method ?? "GET") === "GET" && !held) {
            held = true;
            await gate;
          }
          return answer;
        }
        if (url.includes("/data/search-index.json")) {
          return jsonResponse({ year: 2026, courses: [] });
        }
        if (url.includes("/api/course/TDT4109/timetable")) {
          return jsonResponse([entry("TDT4109", 1, "08:15", "10:00")]);
        }
        if (url.includes("/api/course/TDT4136/timetable")) {
          return jsonResponse([entry("TDT4136", 2, "10:15", "12:00")]);
        }
        if (url.includes("/api/course/")) return jsonResponse(DETAILS);
        return { ok: false, status: 404, json: async () => ({ error: "Not found" }) };
      },
    );

    type PanelModule = typeof import("../../src/components/planner/profilePanel.js");
    let panelDeps: Parameters<PanelModule["mountProfilePanel"]>[0] | null = null;
    vi.doMock("../../src/components/planner/profilePanel.js", async (importOriginal) => {
      const actual = await importOriginal<PanelModule>();
      return {
        ...actual,
        mountProfilePanel: (deps: Parameters<PanelModule["mountProfilePanel"]>[0]) => {
          panelDeps = deps;
          return { show: () => {}, setSyncState: () => {} };
        },
      };
    });

    const { mountPlannerApp } = await import("../../src/components/planner/plannerApp.js");
    const { clearCourseBundleMemo, clearPlannerIndexMemo } = await import(
      "../../src/lib/planner/data.js"
    );
    clearCourseBundleMemo();
    clearPlannerIndexMemo();

    await mountPlannerApp(SEMESTERS as never, [], undefined);
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // The account moves on while that GET is still held: the other device adds
    // a course and pushes it.
    storageA.setItem(
      "np:plans",
      '{"26h":[{"code":"TDT4136","name":"TDT4136 navn","version":"1","source":"manual"},{"code":"TDT4109","name":"TDT4109 navn","version":"1","source":"manual"}]}',
    );
    expect(await deviceA.push()).toEqual({ ok: true });

    // The student signs out and back in — the app's own client, the panel's
    // own two calls. Nothing to ask about (this device's plan is a subset of
    // the account's), so it is the ordinary promptless login.
    const deps = panelDeps as unknown as Parameters<PanelModule["mountProfilePanel"]>[0];
    expect(deps).not.toBeNull();
    deps.sync.logout();
    expect(await deps.sync.login("martin", "482913", "Tavle · nettleser")).toEqual({ ok: true });
    deps.onAuthenticated();
    expect(planStorage.get("np:plans")).toContain("TDT4109");

    releaseGet();
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));

    // The held answer described the account two writes ago. It must not land
    // on top of what the login just established — neither the plan…
    expect(planStorage.get("np:plans")).toContain("TDT4109");
    // …nor the version, which is what a stale one would leave for the next
    // push to 409 against.
    expect(JSON.parse(planStorage.get("np:sync") ?? "{}").version).toBe(2);
  }, 20_000);
});

describe("shouldPullOnVisible", () => {
  const session = {
    navn: "martin",
    authKey: "a",
    encKeyRaw: "b",
    version: 1,
    deviceId: "d",
    label: "Mac · Safari",
    devices: [],
  };

  it("pulls when a signed-in tab becomes visible — the stale-tab guard", () => {
    expect(shouldPullOnVisible(session, false)).toBe(true);
  });

  it("does not pull while the tab is hidden", () => {
    expect(shouldPullOnVisible(session, true)).toBe(false);
  });

  it("does nothing at all when signed out", () => {
    expect(shouldPullOnVisible(null, false)).toBe(false);
  });
});
