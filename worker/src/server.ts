/**
 * Worker entry point: routes `/api/*` to `routes.ts` handlers, everything
 * else to the static Astro build via the `ASSETS` binding.
 *
 * `NTNUClient`/`TTLCache`/`RateLimiter` are module-level singletons shared per
 * isolate (no options → library defaults); a fresh `TieredCache` wraps the
 * shared memory tier around the per-request `env.CACHE` KV binding (optional —
 * absent locally, so the cache degrades to memory-only).
 */
import { NTNUClient } from "ntnu-api";
import { type KVCacheBinding, TieredCache, TTLCache } from "./cache.js";
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
  withSecurityHeaders,
} from "./routes.js";

/**
 * Cloudflare Workers Assets binding + optional KV cache binding, typed
 * structurally (not against `@cloudflare/workers-types`' `Fetcher`/
 * `KVNamespace`) so this file — included by both `worker/tsconfig.json`
 * (workers-types) and `tsconfig.test.json` (node types) — type-checks under
 * either pass. `KVCacheBinding` is the same structural slice `TieredCache`
 * accepts.
 */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CACHE?: KVCacheBinding;
}

const client = new NTNUClient();
const memoryCache = new TTLCache();

/**
 * Bounds how fast one client can make this worker fetch from NTNU (sec-5).
 * Tokens are spent by `routes.ts` only after the cache has missed, so a
 * returning visitor — whose courses are all warm — never touches it; what it
 * meters is our egress, which is the thing the project owes NTNU politeness
 * about.
 *
 * Calibration: a cold planner load is one plan fetch plus two calls per course
 * (~15 upstream for a full plan), so a 120-token burst absorbs several cold
 * page loads back to back, and 15/s sustained is far above any human session
 * while still being a hard ceiling where there was none. `mise run e2e` runs
 * one browser serially against a worker that warms after the first test, so it
 * stays well inside the burst (miniflare does set `CF-Connecting-IP` locally,
 * so the throttle is live there — it is not a production-only code path).
 */
const rateLimiter = new RateLimiter(120, 15);

/**
 * The only client identifier a Worker can trust; Cloudflare sets it on every
 * edge request (`X-Forwarded-For` is caller-supplied and must not be used).
 * When it is absent there is no honest key to bucket on, and throttling
 * everyone into one shared bucket would let a single abuser deny service to
 * all callers — so the throttle stands down instead.
 */
function clientKey(request: Request): string | null {
  const ip = request.headers.get("CF-Connecting-IP");
  return ip === null || ip === "" ? null : ip;
}

/**
 * `/emne/<code>/` pages are built with the catalog's own casing, which is
 * uppercase for all 5 470 codes (and has no case-insensitive collisions), so a
 * lowercase link 404s on a page that exists one casing change away (astro-7).
 * Returns the canonical path when it differs from `pathname`, else `null`.
 */
export function canonicalCoursePath(pathname: string): string | null {
  const match = pathname.match(/^\/emne\/([^/]+)\/?$/);
  const raw = match?.[1];
  if (raw === undefined) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  const upper = decoded.toUpperCase();
  if (upper === decoded) return null;
  return `/emne/${encodeURIComponent(upper)}/`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // `/api` (no trailing slash) is part of the API surface too: falling
    // through to ASSETS answered it with the HTML 404 page while every other
    // /api path answered with the JSON envelope (worker-7).
    if (pathname !== "/api" && !pathname.startsWith("/api/")) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status === 404) {
        const canonical = canonicalCoursePath(pathname);
        if (canonical !== null) {
          return withSecurityHeaders(
            new Response(null, { status: 301, headers: { Location: canonical + url.search } }),
          );
        }
      }
      return withSecurityHeaders(assetResponse);
    }

    // Read-only surface: anything but GET/HEAD used to be served as a GET,
    // payload and all, marked publicly cacheable (worker-7).
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed();
    }

    if (pathname === "/api/health") {
      return handleHealth();
    }

    const cache = new TieredCache(memoryCache, env.CACHE);
    const key = clientKey(request);
    const deps: RouteDeps = {
      client,
      cache,
      throttle: key === null ? undefined : () => rateLimiter.take(key),
    };
    const year = url.searchParams.get("year");
    const version = url.searchParams.get("version");

    // `code` is still percent-encoded here (WHATWG keeps `pathname` encoded);
    // `parseCode` in routes.ts decodes it for every route in one place.
    const courseMatch = pathname.match(/^\/api\/course\/([^/]+)(?:\/(grades|timetable))?$/);
    if (courseMatch) {
      const [, code, sub] = courseMatch;
      if (code === undefined) return notFoundJson();
      switch (sub) {
        case undefined:
          return handleCourseDetails(deps, code, year);
        case "grades":
          return handleCourseGrades(deps, code);
        case "timetable":
          return handleCourseTimetable(deps, code, year, version);
        default:
          return notFoundJson();
      }
    }

    const programMatch = pathname.match(/^\/api\/program\/([^/]+)\/plan$/);
    if (programMatch) {
      const [, code] = programMatch;
      if (code === undefined) return notFoundJson();
      return handleProgramPlan(deps, code, year);
    }

    return notFoundJson();
  },
};
