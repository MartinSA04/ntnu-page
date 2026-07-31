/**
 * Route-handler tests: fixture-backed `NTNUClient` (injected `fetch`), no
 * network. Dispatch mirrors `worker/src/server.ts`'s pathname matching but
 * calls the handlers directly so the client/cache wiring stays testable
 * without a real Workers runtime.
 */
import type { Fetch } from "ntnu-api";
import { NTNUClient } from "ntnu-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TieredCache } from "../../worker/src/cache.js";
import {
  handleCourseDetails,
  handleCourseGrades,
  handleCourseTimetable,
  handleHealth,
  handleProgramPlan,
  methodNotAllowed,
  notFoundJson,
  RateLimiter,
  type RouteDeps,
  rateLimited,
  withSecurityHeaders,
} from "../../worker/src/routes.js";
import worker, { canonicalCoursePath, type Env } from "../../worker/src/server.js";

type FetchInput = Parameters<Fetch>[0];

function urlOf(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as Request).url;
}

interface FetchCall {
  url: string;
}

/** Recording fetch stand-in dispatching by URL substring, first match wins. */
function routeFetch(routes: Array<{ match: string; respond: () => Response }>): {
  fetch: Fetch;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetch: Fetch = (async (input: FetchInput) => {
    const url = urlOf(input);
    calls.push({ url });
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`routeFetch: no route matched ${url}`);
    return route.respond().clone();
  }) as Fetch;
  return { fetch, calls };
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function statusResponse(status: number, body = ""): Response {
  return new Response(body, { status });
}

function htmlResponse(html: string): Response {
  return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
}

const noopSleep = async (_ms: number): Promise<void> => {};

function makeDeps(fetchImpl: Fetch): RouteDeps {
  return {
    client: new NTNUClient({ fetch: fetchImpl, sleep: noopSleep }),
    cache: new TieredCache(),
  };
}

const GRADE_ROW = {
  Institusjonskode: "1150",
  Institusjonsnavn: "NTNU",
  Emnekode: "TDT4100-1",
  Årstall: 2023,
  Semester: 1,
  Semesternavn: "Høst",
  Karakter: "A",
  "Antall kandidater totalt": 10,
  "Antall kandidater kvinner": 4,
  "Antall kandidater menn": 6,
};

const TIMETABLE_ENTRY = {
  courseCode: "TDT4100",
  courseName: {
    nob: "Objektorientert programmering",
    nno: null,
    eng: "Object-Oriented Programming",
  },
  acronym: null,
  term: null,
  termNumber: null,
  name: null,
  title: null,
  dayNum: 1,
  from: "08:15",
  to: "10:00",
  weeks: ["2-13"],
  rooms: [],
  studyProgramKeys: [],
};

const PLANNER_PORTLET_HTML =
  "<html>studyprogrammeplannerportlet_WAR_studyprogrammeplannerportlet_INSTANCE_abc123</html>";

const STUDY_PLAN_RESPONSE = {
  studyplan: {
    code: "MTDT",
    name: "Datateknologi",
    year: 2022,
    startTerm: "HØST",
    updated: null,
    studyPeriods: [],
    publishedYears: [2022, 2023],
  },
};

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const res = await handleHealth();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe("GET /api/course/:code/grades", () => {
  it("happy path: envelope + Cache-Control header", async () => {
    const { fetch, calls } = routeFetch([
      { match: "hentJSONTabellData", respond: () => jsonResponse([GRADE_ROW]) },
    ]);
    const deps = makeDeps(fetch);

    const res = await handleCourseGrades(deps, "tdt4100");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[] };
    expect(body.rows).toHaveLength(1);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=86400");
    expect(calls.length).toBe(1);
  });

  it("rejects an invalid course code with 400", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    const res = await handleCourseGrades(deps, "!!");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid course code" });
  });

  it("caches: two calls hit upstream exactly once", async () => {
    const { fetch, calls } = routeFetch([
      { match: "hentJSONTabellData", respond: () => jsonResponse([GRADE_ROW]) },
    ]);
    const deps = makeDeps(fetch);
    await handleCourseGrades(deps, "TDT4100");
    await handleCourseGrades(deps, "TDT4100");
    expect(calls.length).toBe(1);
  });
});

describe("GET /api/course/:code/timetable", () => {
  it("400 on missing/invalid year", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    const res = await handleCourseTimetable(deps, "TDT4100", null);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid year" });

    const res2 = await handleCourseTimetable(deps, "TDT4100", "26");
    expect(res2.status).toBe(400);
  });

  it("400 on invalid course code", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    const res = await handleCourseTimetable(deps, "!!", "2026");
    expect(res.status).toBe(400);
  });

  it("happy path returns entries", async () => {
    const { fetch } = routeFetch([
      {
        match: "p_p_resource_id=timetable",
        respond: () => jsonResponse({ summarized: [TIMETABLE_ENTRY] }),
      },
    ]);
    const deps = makeDeps(fetch);
    const res = await handleCourseTimetable(deps, "TDT4100", "2026");
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(1);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=3600");
  });

  it("defaults to version 1 upstream when ?version= is absent (DR-4)", async () => {
    const { fetch, calls } = routeFetch([
      {
        match: "p_p_resource_id=timetable",
        respond: () => jsonResponse({ summarized: [TIMETABLE_ENTRY] }),
      },
    ]);
    const deps = makeDeps(fetch);
    await handleCourseTimetable(deps, "TDT4100", "2026");
    expect(calls.some((c) => c.url.includes("version=1"))).toBe(true);
  });

  it("passes a non-default ?version= through to the upstream call (DR-4)", async () => {
    const { fetch, calls } = routeFetch([
      {
        match: "p_p_resource_id=timetable",
        respond: () => jsonResponse({ summarized: [TIMETABLE_ENTRY] }),
      },
    ]);
    const deps = makeDeps(fetch);
    await handleCourseTimetable(deps, "TDT4100", "2026", "3");
    expect(calls.some((c) => c.url.includes("version=3"))).toBe(true);
  });

  it("re-versioned and default-versioned timetables are cached under distinct keys", async () => {
    const { fetch, calls } = routeFetch([
      {
        match: "p_p_resource_id=timetable",
        respond: () => jsonResponse({ summarized: [TIMETABLE_ENTRY] }),
      },
    ]);
    const deps = makeDeps(fetch);
    await handleCourseTimetable(deps, "TDT4100", "2026");
    await handleCourseTimetable(deps, "TDT4100", "2026", "2");
    // Two distinct upstream calls -- not served from the same cache entry.
    expect(calls).toHaveLength(2);
  });

  it("treats an empty ?version= the same as absent (falls back to upstream default)", async () => {
    const { fetch, calls } = routeFetch([
      {
        match: "p_p_resource_id=timetable",
        respond: () => jsonResponse({ summarized: [TIMETABLE_ENTRY] }),
      },
    ]);
    const deps = makeDeps(fetch);
    await handleCourseTimetable(deps, "TDT4100", "2026", "");
    expect(calls.some((c) => c.url.includes("version=1"))).toBe(true);
  });
});

describe("GET /api/course/:code (details)", () => {
  it("maps NotFoundError to 404", async () => {
    const { fetch } = routeFetch([
      { match: "coursedetailsportlet", respond: () => statusResponse(404) },
      { match: "emner", respond: () => statusResponse(404) },
    ]);
    const deps = makeDeps(fetch);
    const res = await handleCourseDetails(deps, "TDT9999", null);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("maps RateLimitError to 429 with Retry-After", async () => {
    const { fetch } = routeFetch([{ match: "emner", respond: () => statusResponse(429) }]);
    const deps = makeDeps(fetch);
    const res = await handleCourseDetails(deps, "TDT4100", null);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("maps other NTNUAPIError (5xx) to 502", async () => {
    const { fetch } = routeFetch([{ match: "emner", respond: () => statusResponse(500) }]);
    const deps = makeDeps(fetch);
    const res = await handleCourseDetails(deps, "TDT4100", null);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBeTruthy();
  });

  /**
   * `ntnu-api` builds its message as `${method} ${url} -> ${status}` with the
   * whole internal Liferay portlet URL, and the planner rendered it verbatim
   * into a Norwegian course row.
   */
  it("does not leak the upstream message (URL, method, status) in the 502 body", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { fetch } = routeFetch([{ match: "emner", respond: () => statusResponse(500) }]);
    const res = await handleCourseDetails(makeDeps(fetch), "TDT4100", null);
    expect(res.status).toBe(502);

    const body = (await res.json()) as { error: string };
    expect(body).toEqual({ error: "Upstream error" });
    expect(body.error).not.toMatch(/ntnu\.no|https?:|p_p_id|->/);
    // The detail survives for Workers Logs, not for the response body.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ntnu.no"));
    warn.mockRestore();
  });
});

describe("GET /api/program/:code/plan", () => {
  it("happy path returns the plan", async () => {
    const { fetch } = routeFetch([
      { match: "p_p_resource_id=studyplan", respond: () => jsonResponse(STUDY_PLAN_RESPONSE) },
      { match: "studieplan", respond: () => htmlResponse(PLANNER_PORTLET_HTML) },
    ]);
    const deps = makeDeps(fetch);
    const res = await handleProgramPlan(deps, "MTDT", "2022");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("MTDT");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=86400");
  });

  it("null plan -> 404, and the miss is cached as a sentinel (no re-fetch)", async () => {
    const { fetch, calls } = routeFetch([
      { match: "p_p_resource_id=studyplan", respond: () => statusResponse(200, "null") },
      { match: "studieplan", respond: () => htmlResponse(PLANNER_PORTLET_HTML) },
    ]);
    const deps = makeDeps(fetch);
    const res = await handleProgramPlan(deps, "MTDT", "2099");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });

    const callsAfterFirst = calls.length;
    const res2 = await handleProgramPlan(deps, "MTDT", "2099");
    expect(res2.status).toBe(404);
    // Second lookup is served entirely from the sentinel cache entry.
    expect(calls.length).toBe(callsAfterFirst);
  });

  it("400 on invalid year", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    const res = await handleProgramPlan(deps, "MTDT", "abcd");
    expect(res.status).toBe(400);
  });

  it("400 on invalid program code", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    const res = await handleProgramPlan(deps, "!!", "2022");
    expect(res.status).toBe(400);
  });
});

/**
 * Handlers receive a raw `URL.pathname` segment, which stays percent-encoded.
 * `CODE_RE` allow-lists Æ/Ø/Å, so without a decode 58 programmes (MTIØT and
 * every Å-prefixed årsstudium) and 238 courses answered 400 to every route.
 */
describe("percent-encoded codes (Æ/Ø/Å)", () => {
  const planRoutes = [
    { match: "p_p_resource_id=studyplan", respond: () => jsonResponse(STUDY_PLAN_RESPONSE) },
    { match: "studieplan", respond: () => htmlResponse(PLANNER_PORTLET_HTML) },
  ];

  it("decodes MTIØT on the program-plan route and passes it upstream", async () => {
    const { fetch, calls } = routeFetch(planRoutes);
    const res = await handleProgramPlan(makeDeps(fetch), "MTI%C3%98T", "2026");
    expect(res.status).toBe(200);
    expect(calls.some((c) => decodeURIComponent(c.url).includes("MTIØT"))).toBe(true);
  });

  it("decodes ÅSOS on the program-plan route", async () => {
    const { fetch } = routeFetch(planRoutes);
    const res = await handleProgramPlan(makeDeps(fetch), "%C3%85SOS", "2026");
    expect(res.status).toBe(200);
  });

  it("decodes BØA1100 on the grades route", async () => {
    const { fetch } = routeFetch([
      { match: "hentJSONTabellData", respond: () => jsonResponse([GRADE_ROW]) },
    ]);
    const res = await handleCourseGrades(makeDeps(fetch), "B%C3%98A1100");
    expect(res.status).toBe(200);
  });

  it("decodes BØA1100 on the timetable route and passes it upstream", async () => {
    const { fetch, calls } = routeFetch([
      {
        match: "p_p_resource_id=timetable",
        respond: () => jsonResponse({ summarized: [TIMETABLE_ENTRY] }),
      },
    ]);
    const res = await handleCourseTimetable(makeDeps(fetch), "b%C3%B8a1100", "2026");
    expect(res.status).toBe(200);
    // Uppercased after decoding, as for any other code.
    expect(calls.some((c) => decodeURIComponent(c.url).includes("BØA1100"))).toBe(true);
  });

  it("accepts an already-decoded code unchanged", async () => {
    const { fetch } = routeFetch(planRoutes);
    const res = await handleProgramPlan(makeDeps(fetch), "MTIØT", "2026");
    expect(res.status).toBe(200);
  });

  it("400 on a malformed percent escape rather than throwing", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    const res = await handleProgramPlan(deps, "MTI%ZZT", "2026");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid program code" });

    const res2 = await handleCourseDetails(deps, "TDT%", null);
    expect(res2.status).toBe(400);
    expect(await res2.json()).toEqual({ error: "Invalid course code" });
  });

  it("still rejects a decoded code that is not a code", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    // "%2F" decodes to "/" -- valid escape, invalid *course* code. The wider
    // programme grammar accepts it; the course grammar deliberately does not.
    const res = await handleCourseGrades(deps, "TDT%2F4100");
    expect(res.status).toBe(400);
  });
});

/**
 * The four codes in `data/programs.json` (403 programmes) that the shared
 * course grammar rejected. All four reach the planner's typeahead unfiltered,
 * and MSØK/5 has a real 9-period plan upstream, so each one 400'd from our own
 * validator while the UI told the student NTNU had no plan
 *.
 */
describe("programme codes containing / and +", () => {
  const planRoutes = [
    { match: "p_p_resource_id=studyplan", respond: () => jsonResponse(STUDY_PLAN_RESPONSE) },
    { match: "studieplan", respond: () => htmlResponse(PLANNER_PORTLET_HTML) },
  ];

  const cases: Array<{ code: string; encoded: string }> = [
    { code: "EMNE/HF", encoded: "EMNE%2FHF" },
    { code: "EMNE/SU", encoded: "EMNE%2FSU" },
    { code: "MSECT+OH", encoded: "MSECT%2BOH" },
    { code: "MSØK/5", encoded: "MS%C3%98K%2F5" },
  ];

  for (const { code, encoded } of cases) {
    it(`accepts ${code} (encoded as ${encoded}) on the program-plan route`, async () => {
      const { fetch, calls } = routeFetch(planRoutes);
      const res = await handleProgramPlan(makeDeps(fetch), encoded, "2026");
      expect(res.status).toBe(200);
      expect(calls.some((c) => decodeURIComponent(c.url).includes(code))).toBe(true);
    });
  }

  it("accepts a literal + in the path segment (a path + is a plus, not a space)", async () => {
    const { fetch, calls } = routeFetch(planRoutes);
    const res = await handleProgramPlan(makeDeps(fetch), "MSECT+OH", "2026");
    expect(res.status).toBe(200);
    expect(calls.some((c) => decodeURIComponent(c.url).includes("MSECT+OH"))).toBe(true);
  });

  it("encoded and literal + share one cache entry (key is the decoded code)", async () => {
    const { fetch, calls } = routeFetch(planRoutes);
    const deps = makeDeps(fetch);
    await handleProgramPlan(deps, "MSECT%2BOH", "2026");
    const afterFirst = calls.length;
    const res = await handleProgramPlan(deps, "MSECT+OH", "2026");
    expect(res.status).toBe(200);
    expect(calls.length).toBe(afterFirst);
  });

  it("keeps course codes on the tighter grammar (no / or +)", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    expect((await handleCourseGrades(deps, "MS%C3%98K%2F5")).status).toBe(400);
    expect((await handleCourseDetails(deps, "MSECT%2BOH", null)).status).toBe(400);
    expect((await handleCourseTimetable(deps, "MSECT+OH", "2026")).status).toBe(400);
  });

  it("still rejects a programme code with characters neither grammar allows", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    // A space and a dot stay out, so no traversal or query shape can form.
    expect((await handleProgramPlan(deps, "MTDT%204100", "2026")).status).toBe(400);
    expect((await handleProgramPlan(deps, "..%2F..%2Fetc", "2026")).status).toBe(400);
  });
});

/**
 * A `null` from `ntnu-api` also covers "NTNU answered 200 with an empty body",
 * so caching it for the positive TTL turned one blip into up to 24 h of
 * "this cohort has no plan". Its own 10-minute TTL keeps the
 * no-refetch-storm property and caps the blast radius.
 */
describe("negative caching", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const nullPlanRoutes = [
    { match: "p_p_resource_id=studyplan", respond: () => statusResponse(200, "null") },
    { match: "studieplan", respond: () => htmlResponse(PLANNER_PORTLET_HTML) },
  ];

  it("re-asks upstream once the miss TTL has passed, not after the 24 h plan TTL", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = routeFetch(nullPlanRoutes);
    const deps = makeDeps(fetch);

    expect((await handleProgramPlan(deps, "MTDT", "2099")).status).toBe(404);
    const afterFirst = calls.length;

    vi.advanceTimersByTime(9 * 60 * 1000);
    expect((await handleProgramPlan(deps, "MTDT", "2099")).status).toBe(404);
    expect(calls.length).toBe(afterFirst);

    vi.advanceTimersByTime(2 * 60 * 1000);
    expect((await handleProgramPlan(deps, "MTDT", "2099")).status).toBe(404);
    expect(calls.length).toBeGreaterThan(afterFirst);
  });

  it("does the same for course details rather than holding a miss for 6 h", async () => {
    vi.useFakeTimers();
    const { fetch, calls } = routeFetch([
      { match: "coursedetailsportlet", respond: () => statusResponse(200, "") },
      { match: "emner", respond: () => statusResponse(200, "") },
    ]);
    const deps = makeDeps(fetch);

    expect((await handleCourseDetails(deps, "TDT4100", null)).status).toBe(404);
    const afterFirst = calls.length;

    vi.advanceTimersByTime(11 * 60 * 1000);
    expect((await handleCourseDetails(deps, "TDT4100", null)).status).toBe(404);
    expect(calls.length).toBeGreaterThan(afterFirst);
  });

  it("never serves the sentinel as a 200 body", async () => {
    const { fetch } = routeFetch(nullPlanRoutes);
    const deps = makeDeps(fetch);
    await handleProgramPlan(deps, "MTDT", "2099");
    const res = await handleProgramPlan(deps, "MTDT", "2099");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  /** a 404 the worker holds itself was `no-store`, so every page load re-asked. */
  it("marks the sentinel 404 cacheable for the miss TTL", async () => {
    const { fetch } = routeFetch(nullPlanRoutes);
    const deps = makeDeps(fetch);
    const fresh = await handleProgramPlan(deps, "MTDT", "2099");
    expect(fresh.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=600");
    const cached = await handleProgramPlan(deps, "MTDT", "2099");
    expect(cached.headers.get("Cache-Control")).toBe("public, max-age=300, s-maxage=600");
  });

  it("keeps no-store on answers the worker does not cache", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    expect((await handleProgramPlan(deps, "!!", "2026")).headers.get("Cache-Control")).toBe(
      "no-store",
    );
    const { fetch } = routeFetch([{ match: "emner", respond: () => statusResponse(429) }]);
    const limited = await handleCourseDetails(makeDeps(fetch), "TDT4100", null);
    expect(limited.headers.get("Cache-Control")).toBe("no-store");
  });
});

/** no route carried a single security header. */
describe("security headers", () => {
  it("sets CSP, nosniff, Referrer-Policy and X-Frame-Options on a success", async () => {
    const { fetch } = routeFetch([
      { match: "hentJSONTabellData", respond: () => jsonResponse([GRADE_ROW]) },
    ]);
    const res = await handleCourseGrades(makeDeps(fetch), "TDT4100");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it("sets them on an error envelope too", async () => {
    const deps = makeDeps(routeFetch([]).fetch);
    const res = await handleCourseGrades(deps, "!!");
    expect(res.status).toBe(400);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("adds them to a response it did not build (the ASSETS branch)", () => {
    const asset = new Response("<html></html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8", ETag: "abc" },
    });
    const res = withSecurityHeaders(asset);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("ETag")).toBe("abc");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toBeTruthy();
  });

  it("keeps a null-body redirect intact", () => {
    const res = withSecurityHeaders(
      new Response(null, { status: 301, headers: { Location: "/emne/TDT4100/" } }),
    );
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/emne/TDT4100/");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });
});

/** /api answered in HTML, and POST/PUT/DELETE were served as GETs. */
describe("/api envelope and method gate", () => {
  it("answers 404 in the JSON envelope", async () => {
    const res = notFoundJson();
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(await res.json()).toEqual({ error: "Not found" });
  });

  it("answers 405 with Allow and no-store", async () => {
    const res = methodNotAllowed();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("GET, HEAD");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Method not allowed" });
  });
});

/**
 * the proxy had no throttle at all, so one machine could turn a curl
 * loop into an unbounded stream of uncacheable requests to www.ntnu.no.
 */
describe("RateLimiter", () => {
  it("allows a full burst then denies", () => {
    const limiter = new RateLimiter(3, 1);
    const now = 1_000_000;
    expect(limiter.take("ip", now).allowed).toBe(true);
    expect(limiter.take("ip", now).allowed).toBe(true);
    expect(limiter.take("ip", now).allowed).toBe(true);
    expect(limiter.take("ip", now).allowed).toBe(false);
  });

  it("refills over time and reports a usable Retry-After", () => {
    const limiter = new RateLimiter(2, 1);
    const now = 1_000_000;
    limiter.take("ip", now);
    limiter.take("ip", now);
    const denied = limiter.take("ip", now);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(1);

    expect(limiter.take("ip", now + 1000).allowed).toBe(true);
  });

  it("never refills past capacity", () => {
    const limiter = new RateLimiter(2, 1);
    const now = 1_000_000;
    limiter.take("ip", now);
    // An hour of idling must not bank 3600 tokens.
    limiter.take("ip", now + 3_600_000);
    limiter.take("ip", now + 3_600_000);
    expect(limiter.take("ip", now + 3_600_000).allowed).toBe(false);
  });

  it("buckets clients independently", () => {
    const limiter = new RateLimiter(1, 1);
    const now = 1_000_000;
    expect(limiter.take("a", now).allowed).toBe(true);
    expect(limiter.take("a", now).allowed).toBe(false);
    expect(limiter.take("b", now).allowed).toBe(true);
  });

  it("bounds its own map so a long-lived isolate cannot grow without limit", () => {
    const limiter = new RateLimiter(1, 1, 10);
    const now = 1_000_000;
    for (let i = 0; i < 50; i++) limiter.take(`ip${i}`, now);
    // ip0 was evicted long ago, so it starts full again rather than being denied.
    expect(limiter.take("ip0", now).allowed).toBe(true);
    // The most recent client keeps its (now spent) bucket.
    expect(limiter.take("ip49", now).allowed).toBe(false);
  });

  it("renders a denial as a 429 with Retry-After", async () => {
    const res = rateLimited(0.2);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "Rate limited" });
  });
});

/**
 * The budget meters egress to NTNU, so it is spent inside the handlers, after
 * the cache has already missed — a client asking fast for warm data costs NTNU
 * nothing and must not be denied.
 */
describe("upstream throttle", () => {
  const gradeRoutes = [{ match: "hentJSONTabellData", respond: () => jsonResponse([GRADE_ROW]) }];

  function throttledDeps(fetchImpl: Fetch, limiter: RateLimiter): RouteDeps {
    return { ...makeDeps(fetchImpl), throttle: () => limiter.take("client") };
  }

  it("429s the request that would have gone upstream", async () => {
    const limiter = new RateLimiter(1, 1);
    const { fetch, calls } = routeFetch(gradeRoutes);
    const deps = throttledDeps(fetch, limiter);

    expect((await handleCourseGrades(deps, "TDT4100")).status).toBe(200);
    const denied = await handleCourseGrades(deps, "TDT4200");
    expect(denied.status).toBe(429);
    expect(await denied.json()).toEqual({ error: "Rate limited" });
    // Denied before the client was ever asked.
    expect(calls).toHaveLength(1);
  });

  it("does not spend a token on a cache hit", async () => {
    const limiter = new RateLimiter(1, 0);
    const { fetch } = routeFetch(gradeRoutes);
    const deps = throttledDeps(fetch, limiter);

    expect((await handleCourseGrades(deps, "TDT4100")).status).toBe(200);
    // Budget is now empty, but every one of these is served from the cache.
    for (let i = 0; i < 20; i++) {
      expect((await handleCourseGrades(deps, "TDT4100")).status).toBe(200);
    }
  });

  it("does not spend a token on a cached MISSING sentinel", async () => {
    const limiter = new RateLimiter(1, 0);
    const { fetch } = routeFetch([
      { match: "p_p_resource_id=studyplan", respond: () => statusResponse(200, "null") },
      { match: "studieplan", respond: () => htmlResponse(PLANNER_PORTLET_HTML) },
    ]);
    const deps = throttledDeps(fetch, limiter);

    expect((await handleProgramPlan(deps, "MTDT", "2099")).status).toBe(404);
    expect((await handleProgramPlan(deps, "MTDT", "2099")).status).toBe(404);
  });

  it("is a no-op when no throttle is wired (no client to bucket on)", async () => {
    const { fetch } = routeFetch(gradeRoutes);
    const deps = makeDeps(fetch);
    expect(deps.throttle).toBeUndefined();
    expect((await handleCourseGrades(deps, "TDT4100")).status).toBe(200);
  });
});

/**
 * hygiene: `?version=` reaches both the cache key and the upstream call,
 * so an arbitrarily long value was an arbitrarily long cache key. Real values
 * are `1`, `2`, `3`, `A`, `B`, `C` (all six in data/catalog.json).
 */
describe("?version= validation", () => {
  const timetableRoutes = [
    {
      match: "p_p_resource_id=timetable",
      respond: () => jsonResponse({ summarized: [TIMETABLE_ENTRY] }),
    },
  ];

  it("accepts the letter versions the catalog actually carries", async () => {
    for (const version of ["1", "2", "3", "A", "B", "C"]) {
      const { fetch } = routeFetch(timetableRoutes);
      const res = await handleCourseTimetable(makeDeps(fetch), "TDT4100", "2026", version);
      expect(res.status).toBe(200);
    }
  });

  it("400s an over-long or shaped-wrong version instead of caching it", async () => {
    const deps = makeDeps(routeFetch(timetableRoutes).fetch);
    const long = await handleCourseTimetable(deps, "TDT4100", "2026", "x".repeat(450));
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: "Invalid version" });

    const traversal = await handleCourseTimetable(deps, "TDT4100", "2026", "../../etc");
    expect(traversal.status).toBe(400);
  });
});

/**
 * `/emne/tdt4100/` 404'd though `/emne/TDT4100/` is 200 — all 5 470
 * catalog codes are uppercase and none collide case-insensitively.
 */
describe("canonicalCoursePath", () => {
  it("uppercases a lowercase course path", () => {
    expect(canonicalCoursePath("/emne/tdt4100/")).toBe("/emne/TDT4100/");
    expect(canonicalCoursePath("/emne/tdt4100")).toBe("/emne/TDT4100/");
  });

  it("re-encodes Æ/Ø/Å so the Location header stays ASCII", () => {
    expect(canonicalCoursePath("/emne/b%C3%B8a1100/")).toBe("/emne/B%C3%98A1100/");
  });

  it("returns null when the path is already canonical (no redirect loop)", () => {
    expect(canonicalCoursePath("/emne/TDT4100/")).toBeNull();
    expect(canonicalCoursePath("/emne/B%C3%98A1100/")).toBeNull();
  });

  it("ignores paths that are not a single course page", () => {
    expect(canonicalCoursePath("/emner/")).toBeNull();
    expect(canonicalCoursePath("/planlegger/")).toBeNull();
    expect(canonicalCoursePath("/emne/tdt4100/noe/")).toBeNull();
  });

  it("returns null on a malformed escape rather than throwing", () => {
    expect(canonicalCoursePath("/emne/tdt%ZZ/")).toBeNull();
  });
});

/**
 * The entry point's own wiring, driven with a stub `ASSETS` binding. Only
 * paths that never reach `NTNUClient` are exercised here — the module-level
 * client has no injected fetch, so anything that routes to a handler would go
 * to the real network.
 */
describe("worker entry point", () => {
  function envWith(paths: Record<string, number>): Env {
    return {
      ASSETS: {
        fetch: async (request: Request) => {
          const status = paths[new URL(request.url).pathname] ?? 404;
          return new Response(status === 404 ? "<html>404</html>" : "<html>ok</html>", {
            status,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        },
      },
    };
  }

  const call = (path: string, init?: RequestInit, env: Env = envWith({})): Promise<Response> =>
    worker.fetch(new Request(`https://example.test${path}`, init), env);

  it("passes a static asset through with the security headers added (sec-3)", async () => {
    const res = await call("/planlegger/", undefined, envWith({ "/planlegger/": 200 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("301s a lowercase course URL to the built casing (astro-7)", async () => {
    const env = envWith({ "/emne/TDT4100/": 200 });
    const res = await call("/emne/tdt4100/", undefined, env);
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/emne/TDT4100/");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("keeps the query string across the redirect", async () => {
    const res = await call("/emne/tdt4100/?fra=søk", undefined, envWith({}));
    expect(res.status).toBe(301);
    expect(res.headers.get("Location")).toBe("/emne/TDT4100/?fra=s%C3%B8k");
  });

  it("serves the 404 page unchanged for a course that really does not exist", async () => {
    const res = await call("/emne/TDT9999/", undefined, envWith({}));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
  });

  it("answers /api and /api/ with the same JSON envelope (worker-7)", async () => {
    for (const path of ["/api", "/api/"]) {
      const res = await call(path);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
      expect(await res.json()).toEqual({ error: "Not found" });
    }
  });

  it("405s a non-GET method instead of serving it as a GET (worker-7)", async () => {
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
      const res = await call("/api/course/TDT4100", { method });
      expect(res.status).toBe(405);
      expect(res.headers.get("Allow")).toBe("GET, HEAD");
      expect(res.headers.get("Cache-Control")).toBe("no-store");
    }
  });

  it("does not method-gate the static site", async () => {
    const res = await call("/", { method: "POST" }, envWith({ "/": 200 }));
    expect(res.status).toBe(200);
  });

  it("serves /api/health without a route match or a client fetch", async () => {
    const res = await call("/api/health", { headers: { "CF-Connecting-IP": "203.0.113.1" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
