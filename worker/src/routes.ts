/**
 * Pure route handlers for `/api/*`, taking their dependencies as a plain object
 * so tests inject a fixture-backed `NTNUClient` and a bare `TieredCache`.
 *
 * No Workers-only ambient types are referenced here (see `server.ts`), so this
 * file type-checks under both `worker/tsconfig.json` and `tsconfig.test.json`.
 */
import type { NTNUClient } from "ntnu-api";
import { NotFoundError, NTNUAPIError, RateLimitError } from "ntnu-api";
import {
  DETAILS_CACHE_TTL_MS,
  PLAN_CACHE_TTL_MS,
  TIMETABLE_CACHE_TTL_MS,
  type TieredCache,
} from "./cache.js";

export interface RouteDeps {
  client: NTNUClient;
  cache: TieredCache;
  /**
   * Spends one unit of this client's upstream budget, called only when a
   * request has missed the cache and is about to go to NTNU. Absent =
   * unthrottled, which is what `server.ts` passes with no client to bucket on.
   */
  throttle?: () => RateLimitDecision;
}

const COURSE_CODE_RE = /^[A-ZÆØÅ0-9_-]{2,16}$/i;

/**
 * Programme codes need two characters course codes never carry: a literal `/`
 * (`EMNE/HF`, `MSØK/5`) and a `+` (`MSECT+OH`). Those are exactly the 4 of 403
 * codes the shared course grammar rejected — all four offered by the planner's
 * own typeahead, so every one 400'd from our own validator.
 *
 * Kept separate rather than widening `COURSE_CODE_RE`: no course code contains
 * either character, and a course route should keep saying so. `.` stays
 * excluded in both, so no path-traversal shape can form, and both downstream
 * uses escape the value again.
 */
const PROGRAM_CODE_RE = /^[A-ZÆØÅ0-9_+/-]{2,16}$/i;

const YEAR_RE = /^\d{4}$/;

/**
 * Optional `?version=`. Real values are single characters today, so this is a
 * loose bound rather than a whitelist: it exists to keep an arbitrarily long
 * query value out of the cache key (KV caps keys at 512 bytes).
 */
const VERSION_RE = /^[A-Za-z0-9-]{1,8}$/;

/** Sentinel stored in the cache for a `null` upstream result (unknown code/cohort). */
const MISSING = "missing";

/**
 * TTL for a negative cache entry. A `null` from `ntnu-api` is overloaded — it
 * is also what an empty 200 from NTNU's Liferay resource produces — so caching
 * a miss for the full positive TTL turned one transient blank response into up
 * to 24 h of "this cohort has no plan", which `findProgramPlanUncached` then
 * papers over by stepping back a year. Ten minutes keeps the no-refetch-storm
 * property while capping the blast radius of a blip.
 */
const MISS_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Defense-in-depth response headers, on every route including static assets.
 *
 * `script-src` deliberately keeps `'unsafe-inline'`: the build ships exactly one
 * executable inline block (Layout's no-flash theme init). Pinning it with a
 * `'sha256-…'` is stronger, but the hash is valid for one exact rendering — any
 * reformat of `Layout.astro` would silently reintroduce the theme flash — and
 * it cannot be computed without a build, so it is left as a documented upgrade
 * rather than shipped unverified. Everything else is tight.
 *
 * `style-src` needs `'unsafe-inline'` for Astro's scoped `<style>` blocks and
 * `style="…"` attributes; `img-src` needs `data:` for the generated favicon.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
};

/**
 * Returns `response` with `SECURITY_HEADERS` applied. Used by `server.ts` for
 * the `ASSETS` branch; the JSON helpers below set the same headers directly.
 */
export function withSecurityHeaders(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
  return out;
}

/**
 * `Cache-Control` for a response we will have cached for `ttlMs`, or
 * `no-store` when absent. `max-age` stays at or below 300 s so a browser
 * re-checks often while the edge holds the full TTL.
 */
function cacheControl(ttlMs?: number): string {
  if (ttlMs === undefined) return "no-store";
  const seconds = Math.floor(ttlMs / 1000);
  return `public, max-age=${Math.min(300, seconds)}, s-maxage=${seconds}`;
}

function json(data: unknown, status: number, ttlMs?: number): Response {
  const cacheable = status >= 200 && status < 300 ? ttlMs : undefined;
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl(cacheable),
      ...SECURITY_HEADERS,
    },
  });
}

/**
 * Error envelope. `ttlMs` is set only where the worker serves an answer it has
 * itself cached (the `MISSING` sentinel), so the edge and the browser may hold
 * it as long as we do. 400/429/502 stay `no-store`.
 */
function errorJson(
  message: string,
  status: number,
  opts?: { headers?: Record<string, string>; ttlMs?: number },
): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": cacheControl(opts?.ttlMs),
      ...SECURITY_HEADERS,
      ...opts?.headers,
    },
  });
}

/** The generic `/api` 404 envelope, shared with `server.ts` so every path answers in JSON. */
export function notFoundJson(): Response {
  return errorJson("Not found", 404);
}

/** 405 for a non-GET/HEAD method on `/api`; the surface is read-only. */
export function methodNotAllowed(): Response {
  return errorJson("Method not allowed", 405, { headers: { Allow: "GET, HEAD" } });
}

/** 429 from our own throttle; same envelope as an upstream rate limit. */
export function rateLimited(retryAfterSeconds: number): Response {
  return errorJson("Rate limited", 429, {
    headers: { "Retry-After": String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  });
}

/**
 * Decodes, validates and uppercases a course/program code, or returns `null`.
 * `re` is the grammar for the surface being addressed.
 *
 * The decode is the load-bearing step: handlers get a raw `URL.pathname`
 * segment, which the WHATWG URL spec keeps percent-encoded, so `BØA1100`
 * arrives as `B%C3%98A1100` and the Æ/Ø/Å allow-list never sees the characters
 * it exists for — 58 programmes and 238 courses hard-400 without it. Equally
 * load-bearing for the programme grammar: a `/` can only reach a path segment
 * as `%2F`. A `+` is a literal plus in a path segment (the `+`-means-space rule
 * is form-encoding only), so `MSECT+OH` and `MSECT%2BOH` decode alike.
 *
 * A malformed escape throws `URIError`, which is a 400 like any other.
 */
function parseCode(raw: string, re: RegExp): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (!re.test(decoded)) return null;
  return decoded.toUpperCase();
}

/** Validates a 4-digit year string, or returns `null` on failure (absent or malformed). */
function parseYear(raw: string | null): number | null {
  if (raw === null || !YEAR_RE.test(raw)) return null;
  return Number(raw);
}

/**
 * Maps upstream errors per SPEC; non-`NTNUAPIError` bugs propagate (500).
 *
 * The 502 body is a fixed token, never `err.message`: `ntnu-api` builds that as
 * `${method} ${url} -> ${status}` with the full internal Liferay portlet URL,
 * and the planner used to render ~250 English characters into a Norwegian
 * course row. The detail stays in Workers Logs. `src/lib/planner/data.ts` keys
 * on the *status*, so a 502 renders as "NTNU svarte ikke".
 */
function mapUpstreamError(err: unknown): Response {
  if (err instanceof NotFoundError) {
    return errorJson("Not found", 404);
  }
  if (err instanceof RateLimitError) {
    return errorJson("Rate limited", 429, { headers: { "Retry-After": "60" } });
  }
  if (err instanceof NTNUAPIError) {
    console.warn(`Upstream error: ${err.message}`);
    return errorJson("Upstream error", 502);
  }
  throw err;
}

/** What `RateLimiter.take` decided, and how long to tell the caller to wait. */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * Spends one unit of upstream budget, or returns the 429 to send instead.
 * Called at the point of no return — after the cache has missed — so the budget
 * meters *our egress to NTNU*, not our own cached answers. A warm-cache client
 * is never throttled however fast it asks.
 */
function upstreamGate(deps: RouteDeps): Response | null {
  const decision = deps.throttle?.();
  if (decision === undefined || decision.allowed) return null;
  return rateLimited(decision.retryAfterSeconds);
}

/**
 * Per-isolate token bucket, one bucket per client.
 *
 * `/api/*` is an unauthenticated proxy in front of a third party this project
 * treats politely, and it had no throttle: a `curl` loop over random course
 * codes produced an unbounded stream of uncacheable requests to www.ntnu.no
 * from this worker's egress.
 *
 * Bounded like `TTLCache`: the map is module-level, so a long-lived isolate
 * seeing many client IPs must evict rather than grow. Full buckets are dropped
 * on eviction, which is safe — a client whose bucket is gone starts full.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; updatedAt: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly maxClients = 5000,
  ) {}

  /** Spends one token for `key`, refilling first. `now` is injectable for tests. */
  take(key: string, now: number = Date.now()): RateLimitDecision {
    const bucket = this.buckets.get(key);
    let tokens = this.capacity;
    if (bucket) {
      const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
      tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerSecond);
    }
    if (tokens < 1) {
      // Keep the timestamp so refill keeps accruing while the client is denied.
      this.buckets.set(key, { tokens, updatedAt: now });
      return { allowed: false, retryAfterSeconds: (1 - tokens) / this.refillPerSecond };
    }
    this.buckets.delete(key);
    this.buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    while (this.buckets.size > this.maxClients) {
      const oldest = this.buckets.keys().next();
      if (oldest.done === true) break;
      this.buckets.delete(oldest.value);
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

export async function handleHealth(): Promise<Response> {
  return json({ ok: true }, 200);
}

export async function handleCourseDetails(
  deps: RouteDeps,
  code: string,
  yearParam: string | null,
): Promise<Response> {
  const parsedCode = parseCode(code, COURSE_CODE_RE);
  if (parsedCode === null) return errorJson("Invalid course code", 400);
  let year: number | null = null;
  if (yearParam !== null) {
    year = parseYear(yearParam);
    if (year === null) return errorJson("Invalid year", 400);
  }

  const key = JSON.stringify(["details", parsedCode, year]);
  const missKey = JSON.stringify(["details-miss", parsedCode, year]);
  const hit = await deps.cache.get(key, DETAILS_CACHE_TTL_MS);
  // The sentinel lives under its own key now, but never serve it as data.
  if (hit !== null && hit !== MISSING) return json(hit, 200, DETAILS_CACHE_TTL_MS);
  const miss = await deps.cache.get(missKey, MISS_CACHE_TTL_MS);
  if (miss !== null) return errorJson("Not found", 404, { ttlMs: MISS_CACHE_TTL_MS });
  const throttled = upstreamGate(deps);
  if (throttled !== null) return throttled;

  try {
    const details = await deps.client.courses.details(parsedCode, year ?? undefined);
    if (details === null) {
      await deps.cache.set(missKey, MISSING, MISS_CACHE_TTL_MS);
      return errorJson("Not found", 404, { ttlMs: MISS_CACHE_TTL_MS });
    }
    await deps.cache.set(key, details, DETAILS_CACHE_TTL_MS);
    return json(details, 200, DETAILS_CACHE_TTL_MS);
  } catch (err) {
    return mapUpstreamError(err);
  }
}

/**
 * Validates an optional `?version=`. Empty/absent → `undefined` (let `ntnu-api`
 * apply its own default); otherwise it must match `VERSION_RE`, and `false`
 * signals a 400. The value reaches the cache key, so an unbounded string here
 * is an unbounded cache key.
 */
function parseVersion(raw: string | null): string | undefined | false {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  return VERSION_RE.test(trimmed) ? trimmed : false;
}

export async function handleCourseTimetable(
  deps: RouteDeps,
  code: string,
  yearParam: string | null,
  versionParam: string | null = null,
): Promise<Response> {
  const parsedCode = parseCode(code, COURSE_CODE_RE);
  if (parsedCode === null) return errorJson("Invalid course code", 400);
  const year = parseYear(yearParam);
  if (year === null) return errorJson("Invalid year", 400);
  const version = parseVersion(versionParam);
  if (version === false) return errorJson("Invalid version", 400);

  const key = JSON.stringify(["timetable", parsedCode, year, version ?? null]);
  const hit = await deps.cache.get(key, TIMETABLE_CACHE_TTL_MS);
  if (hit !== null) return json(hit, 200, TIMETABLE_CACHE_TTL_MS);
  const throttled = upstreamGate(deps);
  if (throttled !== null) return throttled;

  try {
    const entries = await deps.client.courses.timetable(parsedCode, year, { version });
    await deps.cache.set(key, entries, TIMETABLE_CACHE_TTL_MS);
    return json(entries, 200, TIMETABLE_CACHE_TTL_MS);
  } catch (err) {
    return mapUpstreamError(err);
  }
}

export async function handleProgramPlan(
  deps: RouteDeps,
  code: string,
  yearParam: string | null,
): Promise<Response> {
  const parsedCode = parseCode(code, PROGRAM_CODE_RE);
  if (parsedCode === null) return errorJson("Invalid program code", 400);
  const year = parseYear(yearParam);
  if (year === null) return errorJson("Invalid year", 400);

  const key = JSON.stringify(["plan", parsedCode, year]);
  const missKey = JSON.stringify(["plan-miss", parsedCode, year]);
  const hit = await deps.cache.get(key, PLAN_CACHE_TTL_MS);
  if (hit !== null && hit !== MISSING) return json(hit, 200, PLAN_CACHE_TTL_MS);
  const miss = await deps.cache.get(missKey, MISS_CACHE_TTL_MS);
  if (miss !== null) return errorJson("Not found", 404, { ttlMs: MISS_CACHE_TTL_MS });
  const throttled = upstreamGate(deps);
  if (throttled !== null) return throttled;

  try {
    const plan = await deps.client.programs.studyPlan(parsedCode, year);
    if (plan === null) {
      await deps.cache.set(missKey, MISSING, MISS_CACHE_TTL_MS);
      return errorJson("Not found", 404, { ttlMs: MISS_CACHE_TTL_MS });
    }
    await deps.cache.set(key, plan, PLAN_CACHE_TTL_MS);
    return json(plan, 200, PLAN_CACHE_TTL_MS);
  } catch (err) {
    return mapUpstreamError(err);
  }
}
