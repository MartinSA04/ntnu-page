/**
 * Pure route handlers for `/api/*`, taking their dependencies as a plain
 * object (ntnu-mcp pattern) so tests inject a fixture-backed `NTNUClient`
 * and a bare `TieredCache` without touching module-level singletons.
 *
 * No Workers-only ambient types are referenced here (see `server.ts`), so
 * this file type-checks cleanly under both `worker/tsconfig.json`
 * (workers-types) and `tsconfig.test.json` (node types).
 */
import type { NTNUClient } from "ntnu-api";
import { NotFoundError, NTNUAPIError, RateLimitError } from "ntnu-api";
import {
  DETAILS_CACHE_TTL_MS,
  GRADES_CACHE_TTL_MS,
  PLAN_CACHE_TTL_MS,
  SCHEDULE_CACHE_TTL_MS,
  TIMETABLE_CACHE_TTL_MS,
  type TieredCache,
} from "./cache.js";

export interface RouteDeps {
  client: NTNUClient;
  cache: TieredCache;
}

const CODE_RE = /^[A-ZÆØÅ0-9_-]{2,16}$/i;
const YEAR_RE = /^\d{4}$/;

/** Sentinel stored in the cache for a `null` upstream result (unknown code/cohort). */
const MISSING = "missing";

function json(data: unknown, status: number, ttlMs?: number): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
  headers["Cache-Control"] =
    status >= 200 && status < 300 && ttlMs !== undefined
      ? `public, max-age=300, s-maxage=${Math.floor(ttlMs / 1000)}`
      : "no-store";
  return new Response(JSON.stringify(data), { status, headers });
}

function errorJson(
  message: string,
  status: number,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

/** Validates + uppercases a course/program code, or returns `null` on failure. */
function parseCode(raw: string): string | null {
  if (!CODE_RE.test(raw)) return null;
  return raw.toUpperCase();
}

/** Validates a 4-digit year string, or returns `null` on failure (absent or malformed). */
function parseYear(raw: string | null): number | null {
  if (raw === null || !YEAR_RE.test(raw)) return null;
  return Number(raw);
}

/** Maps upstream errors per SPEC; non-`NTNUAPIError` bugs propagate to the caller (500). */
function mapUpstreamError(err: unknown): Response {
  if (err instanceof NotFoundError) {
    return errorJson("Not found", 404);
  }
  if (err instanceof RateLimitError) {
    return errorJson("Rate limited", 429, { "Retry-After": "60" });
  }
  if (err instanceof NTNUAPIError) {
    return errorJson(err.message, 502);
  }
  throw err;
}

export async function handleHealth(): Promise<Response> {
  return json({ ok: true }, 200);
}

export async function handleCourseDetails(
  deps: RouteDeps,
  code: string,
  yearParam: string | null,
): Promise<Response> {
  const parsedCode = parseCode(code);
  if (parsedCode === null) return errorJson("Invalid course code", 400);
  let year: number | null = null;
  if (yearParam !== null) {
    year = parseYear(yearParam);
    if (year === null) return errorJson("Invalid year", 400);
  }

  const key = JSON.stringify(["details", parsedCode, year]);
  const hit = await deps.cache.get(key, DETAILS_CACHE_TTL_MS);
  if (hit !== null) {
    if (hit === MISSING) return errorJson("Not found", 404);
    return json(hit, 200, DETAILS_CACHE_TTL_MS);
  }

  try {
    const details = await deps.client.courses.details(parsedCode, year ?? undefined);
    await deps.cache.set(key, details ?? MISSING, DETAILS_CACHE_TTL_MS);
    if (details === null) return errorJson("Not found", 404);
    return json(details, 200, DETAILS_CACHE_TTL_MS);
  } catch (err) {
    return mapUpstreamError(err);
  }
}

export async function handleCourseGrades(deps: RouteDeps, code: string): Promise<Response> {
  const parsedCode = parseCode(code);
  if (parsedCode === null) return errorJson("Invalid course code", 400);

  const key = JSON.stringify(["grades", parsedCode]);
  const hit = await deps.cache.get(key, GRADES_CACHE_TTL_MS);
  if (hit !== null) return json({ rows: hit }, 200, GRADES_CACHE_TTL_MS);

  try {
    const rows = await deps.client.grades.distribution(parsedCode);
    await deps.cache.set(key, rows, GRADES_CACHE_TTL_MS);
    return json({ rows }, 200, GRADES_CACHE_TTL_MS);
  } catch (err) {
    return mapUpstreamError(err);
  }
}

/**
 * Validates an optional `?version=` query param. Empty/absent → `undefined`
 * (let `ntnu-api` apply its own default); non-empty is passed through
 * verbatim — course versions are short numeric-ish strings upstream, not a
 * format this route needs to police beyond "not empty".
 */
function parseVersion(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

export async function handleCourseTimetable(
  deps: RouteDeps,
  code: string,
  yearParam: string | null,
  versionParam: string | null = null,
): Promise<Response> {
  const parsedCode = parseCode(code);
  if (parsedCode === null) return errorJson("Invalid course code", 400);
  const year = parseYear(yearParam);
  if (year === null) return errorJson("Invalid year", 400);
  const version = parseVersion(versionParam);

  const key = JSON.stringify(["timetable", parsedCode, year, version ?? null]);
  const hit = await deps.cache.get(key, TIMETABLE_CACHE_TTL_MS);
  if (hit !== null) return json(hit, 200, TIMETABLE_CACHE_TTL_MS);

  try {
    const entries = await deps.client.courses.timetable(parsedCode, year, { version });
    await deps.cache.set(key, entries, TIMETABLE_CACHE_TTL_MS);
    return json(entries, 200, TIMETABLE_CACHE_TTL_MS);
  } catch (err) {
    return mapUpstreamError(err);
  }
}

export async function handleCourseSchedule(
  deps: RouteDeps,
  code: string,
  yearParam: string | null,
  versionParam: string | null = null,
): Promise<Response> {
  const parsedCode = parseCode(code);
  if (parsedCode === null) return errorJson("Invalid course code", 400);
  const year = parseYear(yearParam);
  if (year === null) return errorJson("Invalid year", 400);
  const version = parseVersion(versionParam);

  const key = JSON.stringify(["schedule", parsedCode, year, version ?? null]);
  const hit = await deps.cache.get(key, SCHEDULE_CACHE_TTL_MS);
  // `ScheduleActivity.start`/`end` are `Date`s upstream; after a KV round-trip
  // they come back as ISO strings. `JSON.stringify` renders a `Date` and its
  // ISO-string equivalent identically, so the response body is the same
  // either way — no revival needed here (unlike ntnu-mcp, which hands the
  // parsed value to callers instead of serializing it directly).
  if (hit !== null) return json(hit, 200, SCHEDULE_CACHE_TTL_MS);

  try {
    const activities = await deps.client.courses.schedules(parsedCode, year, { version });
    await deps.cache.set(key, activities, SCHEDULE_CACHE_TTL_MS);
    return json(activities, 200, SCHEDULE_CACHE_TTL_MS);
  } catch (err) {
    return mapUpstreamError(err);
  }
}

export async function handleProgramPlan(
  deps: RouteDeps,
  code: string,
  yearParam: string | null,
): Promise<Response> {
  const parsedCode = parseCode(code);
  if (parsedCode === null) return errorJson("Invalid program code", 400);
  const year = parseYear(yearParam);
  if (year === null) return errorJson("Invalid year", 400);

  const key = JSON.stringify(["plan", parsedCode, year]);
  const hit = await deps.cache.get(key, PLAN_CACHE_TTL_MS);
  if (hit !== null) {
    if (hit === MISSING) return errorJson("Not found", 404);
    return json(hit, 200, PLAN_CACHE_TTL_MS);
  }

  try {
    const plan = await deps.client.programs.studyPlan(parsedCode, year);
    await deps.cache.set(key, plan ?? MISSING, PLAN_CACHE_TTL_MS);
    if (plan === null) return errorJson("Not found", 404);
    return json(plan, 200, PLAN_CACHE_TTL_MS);
  } catch (err) {
    return mapUpstreamError(err);
  }
}
