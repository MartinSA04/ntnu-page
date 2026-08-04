/**
 * Worker entry point: routes `/api/*` to `routes.ts` handlers, everything else
 * to the static Astro build via the `ASSETS` binding.
 *
 * `NTNUClient`/`TTLCache`/`RateLimiter` are per-isolate singletons; a fresh
 * `TieredCache` wraps the shared memory tier around the per-request
 * `env.CACHE` KV binding (absent locally, so the cache degrades to memory).
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
  rateLimited,
  withSecurityHeaders,
} from "./routes.js";
import {
  AuthLimiter,
  handlePublicRead,
  handlePublish,
  handleSyncClaim,
  handleSyncDelete,
  handleSyncGet,
  handleSyncPut,
  handleUnpublish,
  type SyncDeps,
  type SyncKv,
  syncUnavailable,
} from "./sync.js";

/**
 * Cloudflare Workers Assets + optional KV cache bindings, typed structurally
 * rather than against `@cloudflare/workers-types`, so this file type-checks
 * under both the Workers and the Node passes.
 */
export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CACHE?: KVCacheBinding;
  SYNC?: SyncKv;
}

const client = new NTNUClient();
const memoryCache = new TTLCache();

/** Per-isolate, like `client` and `memoryCache` above. */
const authLimiter = new AuthLimiter(10, 15 * 60_000);

/**
 * Bounds how fast one client can make this worker fetch from NTNU. Tokens are
 * spent by `routes.ts` only after the cache has missed, so what it meters is
 * our egress — the thing this project owes NTNU politeness about — and a
 * returning visitor with warm courses never touches it.
 *
 * Calibration: a cold planner load is ~15 upstream calls, so a 120-token burst
 * absorbs several cold loads back to back and 15/s sustained is far above any
 * human session. Miniflare sets `CF-Connecting-IP`, so `mise run e2e` exercises
 * this path too — it is not production-only.
 *
 * `/api/sync/*` spends from the same bucket (see the dispatch below), where
 * what it meters is KV writes rather than NTNU egress. One bucket on purpose:
 * both are "how much work can one client make this worker do", and a client
 * hammering one of them has no claim on the other.
 */
const rateLimiter = new RateLimiter(120, 15);

/**
 * The only client identifier a Worker can trust (`X-Forwarded-For` is
 * caller-supplied and must not be used). When it is absent there is no honest
 * key, and bucketing everyone together would let one abuser deny service to
 * all callers — so the throttle stands down instead.
 */
function clientKey(request: Request): string | null {
  const ip = request.headers.get("CF-Connecting-IP");
  return ip === null || ip === "" ? null : ip;
}

/**
 * `/emne/<code>/` pages are built with the catalog's own casing, uppercase for
 * all 5 470 codes, so a lowercase link 404s on a page that exists one casing
 * change away. Returns the canonical path when it differs, else `null`.
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

/**
 * The name in a `/…/<navn>` path, decoded.
 *
 * Same reason as `parseCode` in routes.ts: the WHATWG URL spec keeps path
 * segments percent-encoded, and a name is validated after decoding. The
 * patterns are anchored — `/api/sync/martin/public` must never read as an
 * account named `martin/public` OR as the account `martin`, or a DELETE of the
 * public copy would delete the whole account.
 */
function nameIn(pattern: RegExp, pathname: string): string | null {
  const match = pattern.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

const SYNC_PATH = /^\/api\/sync\/([^/]+)\/?$/;
/** The share toggle: PUT turns it on with a copy to serve, DELETE turns it off. */
const PUBLIC_TOGGLE_PATH = /^\/api\/sync\/([^/]+)\/public\/?$/;
/** The viewer's data source. No credential — that is what being public means. */
const PUBLIC_READ_PATH = /^\/api\/plan\/([^/]+)\/?$/;
/** The page itself, which the worker rewrites to one static shell. */
const PUBLIC_PAGE_PATH = /^\/user\/([^/]+)\/?$/;

/**
 * A shared plan is a room-and-hour record attached to a name the student chose,
 * so it is kept out of search by HEADER rather than by `robots.txt`. Blocking
 * the crawl would mean Google never reads the directive and can still list the
 * bare URL — the exact failure this avoids.
 */
function withNoIndex(response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set("X-Robots-Tag", "noindex, nofollow");
  return next;
}

/**
 * Dispatches one `/api/sync/<navn>` request. `env.SYNC` absent is reported
 * as 503 rather than silently falling back to memory — a planner that
 * looked like it saved but didn't is worse than one that says it cannot.
 */
function syncDeps(kv: SyncKv): SyncDeps {
  return {
    kv,
    now: () => new Date().toISOString(),
    // `limiter` and `monotonic` must always be supplied as a pair:
    // `authorise` in sync.ts falls back to a frozen `now` of 0 when
    // `monotonic` is missing, so a limiter without a clock produces a
    // lockout `until` that a frozen `now` can never reach — a silent
    // permanent lock until the isolate recycles.
    limiter: authLimiter,
    monotonic: () => Date.now(),
  };
}

async function handleSync(request: Request, env: Env, name: string): Promise<Response> {
  // `syncUnavailable`, not a hand-built `Response`: this was the one answer on
  // the sync surface that shipped without `Cache-Control: no-store`.
  if (!env.SYNC) return syncUnavailable();
  const deps = syncDeps(env.SYNC);
  const auth = request.headers.get("x-np-auth");

  switch (request.method) {
    case "POST":
      return handleSyncClaim(name, await request.json().catch(() => null), deps);
    case "GET":
      return handleSyncGet(name, auth, deps);
    case "PUT":
      return handleSyncPut(name, auth, await request.json().catch(() => null), deps);
    case "DELETE":
      return handleSyncDelete(name, auth, deps);
    default:
      return methodNotAllowed();
  }
}

/** The share toggle. Both halves need the account's own credential. */
async function handlePublicToggle(request: Request, env: Env, name: string): Promise<Response> {
  if (!env.SYNC) return syncUnavailable();
  const deps = syncDeps(env.SYNC);
  const auth = request.headers.get("x-np-auth");
  if (request.method === "PUT") {
    return handlePublish(name, auth, await request.json().catch(() => null), deps);
  }
  if (request.method === "DELETE") return handleUnpublish(name, auth, deps);
  return methodNotAllowed();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    // `/user/<navn>` — one static shell for every name, kept out of search.
    // Before the asset branch below, which would serve the 404 page: the build
    // emits `/user/index.html` and nothing else under `/user/`.
    if (PUBLIC_PAGE_PATH.test(pathname)) {
      const shell = await env.ASSETS.fetch(new Request(new URL("/user/index.html", url), request));
      return withNoIndex(withSecurityHeaders(shell));
    }

    // `/api` (no trailing slash) is part of the API surface too: falling
    // through to ASSETS answered it with the HTML 404 page while every other
    // /api path answered with the JSON envelope.
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

    // `/api/sync/*` is the one part of `/api` that is not read-only, so it is
    // dispatched before the GET/HEAD-only gate below applies to everything else.
    //
    // Behind the SAME per-IP throttle as the rest of `/api`, which it used to
    // skip entirely: the limiter was constructed further down, after this
    // branch had already returned. `AuthLimiter` is not a substitute — it is
    // per NAME and only counts credential failures, so it never sees
    // `handleSyncClaim`, which needs no credential at all. `POST
    // /api/sync/<random>` in a loop was unbounded anonymous KV writes.
    const accountName = nameIn(SYNC_PATH, pathname);
    const shareName = nameIn(PUBLIC_TOGGLE_PATH, pathname);
    if (accountName !== null || shareName !== null) {
      const syncKey = clientKey(request);
      if (syncKey !== null) {
        const decision = rateLimiter.take(syncKey);
        if (!decision.allowed) {
          return withSecurityHeaders(rateLimited(decision.retryAfterSeconds));
        }
      }
      if (accountName !== null) {
        return withSecurityHeaders(await handleSync(request, env, accountName));
      }
      if (shareName !== null) {
        return withSecurityHeaders(await handlePublicToggle(request, env, shareName));
      }
    }

    // Read-only surface: anything but GET/HEAD used to be served as a GET,
    // payload and all, marked publicly cacheable.
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed();
    }

    if (pathname === "/api/health") {
      return handleHealth();
    }

    // The public page's data source. Below the GET/HEAD gate on purpose — it is
    // a read like every other route here, and the write side is the toggle
    // above, which needs the account's credential.
    const publicName = nameIn(PUBLIC_READ_PATH, pathname);
    if (publicName !== null) {
      if (!env.SYNC) return withSecurityHeaders(syncUnavailable());
      return withSecurityHeaders(await handlePublicRead(publicName, syncDeps(env.SYNC)));
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
