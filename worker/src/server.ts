/**
 * Worker entry point: routes `/api/*` to `routes.ts` handlers, everything
 * else to the static Astro build via the `ASSETS` binding.
 *
 * `NTNUClient`/`TTLCache` are module-level singletons shared per isolate (no
 * options → library defaults); a fresh `TieredCache` wraps the shared memory
 * tier around the per-request `env.CACHE` KV binding (optional — absent
 * locally, so the cache degrades to memory-only).
 */
import { NTNUClient } from "ntnu-api";
import { type KVCacheBinding, TieredCache, TTLCache } from "./cache.js";
import {
  handleCourseDetails,
  handleCourseGrades,
  handleCourseSchedule,
  handleCourseTimetable,
  handleHealth,
  handleProgramPlan,
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

function notFound(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;

    if (!pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (pathname === "/api/health") {
      return handleHealth();
    }

    const cache = new TieredCache(memoryCache, env.CACHE);
    const deps = { client, cache };
    const year = url.searchParams.get("year");
    const version = url.searchParams.get("version");

    const courseMatch = pathname.match(
      /^\/api\/course\/([^/]+)(?:\/(grades|timetable|schedule))?$/,
    );
    if (courseMatch) {
      const [, code, sub] = courseMatch;
      if (code === undefined) return notFound();
      switch (sub) {
        case undefined:
          return handleCourseDetails(deps, code, year);
        case "grades":
          return handleCourseGrades(deps, code);
        case "timetable":
          return handleCourseTimetable(deps, code, year, version);
        case "schedule":
          return handleCourseSchedule(deps, code, year, version);
        default:
          return notFound();
      }
    }

    const programMatch = pathname.match(/^\/api\/program\/([^/]+)\/plan$/);
    if (programMatch) {
      const [, code] = programMatch;
      if (code === undefined) return notFound();
      return handleProgramPlan(deps, code, year);
    }

    return notFound();
  },
};
