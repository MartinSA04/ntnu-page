/**
 * Route-handler tests: fixture-backed `NTNUClient` (injected `fetch`), no
 * network. Dispatch mirrors `worker/src/server.ts`'s pathname matching but
 * calls the handlers directly so the client/cache wiring stays testable
 * without a real Workers runtime.
 */
import type { Fetch } from "ntnu-api";
import { NTNUClient } from "ntnu-api";
import { describe, expect, it } from "vitest";
import { TieredCache } from "../../worker/src/cache.js";
import {
  handleCourseDetails,
  handleCourseGrades,
  handleCourseTimetable,
  handleHealth,
  handleProgramPlan,
  type RouteDeps,
} from "../../worker/src/routes.js";

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
    // "%2F" decodes to "/" -- valid escape, invalid code.
    const res = await handleCourseGrades(deps, "TDT%2F4100");
    expect(res.status).toBe(400);
  });
});
