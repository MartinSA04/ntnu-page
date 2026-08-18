/**
 * Per-isolate in-memory TTL cache, plus a two-tier (memory + optional KV)
 * cache in front of it. Ported from `ntnu-mcp/src/cache.ts` (same author) —
 * the shape is identical; only the TTL constants below are specific to this
 * worker's routes.
 */
interface CacheEntry {
  value: unknown;
  storedAt: number;
}

/**
 * Upper bound on live entries. The cache is module-level and lives for the
 * isolate's whole lifetime; without a cap a long-lived isolate serving many
 * distinct codes grows until the 128 MB limit kills it.
 */
const MAX_ENTRIES = 500;

export class TTLCache {
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * Returns the cached value, or `null` if absent or older than `ttlMs`.
   * An expired entry is dropped on read: TTLs are per-route, so nothing else
   * ever revisits a key that has fallen out of use.
   */
  get(key: string, ttlMs: number): unknown | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (Date.now() - entry.storedAt > ttlMs) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  /**
   * Stores `value` stamped with the current time, evicting in insertion order
   * past `MAX_ENTRIES`. Re-setting an existing key deletes first so the
   * refreshed entry moves to the back — otherwise a hot key keeps its original
   * position and is evicted while colder keys survive.
   */
  set(key: string, value: unknown): void {
    this.entries.delete(key);
    this.entries.set(key, { value, storedAt: Date.now() });
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}

/** TTL for scraped course-detail pages — exam rooms/notices update within a term. */
export const DETAILS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** TTL for per-course weekly timetables — may shift during term planning. */
export const TIMETABLE_CACHE_TTL_MS = 60 * 60 * 1000;

/** TTL for study plans — change a few times a year. */
export const PLAN_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The slice of Cloudflare's `KVNamespace` this cache needs, typed structurally
 * so files without `@cloudflare/workers-types` loaded can still reference it.
 */
export interface KVCacheBinding {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

/**
 * Version prefix for KV keys — bump when cached shapes change incompatibly.
 *
 * NAMED AFTER THIS SERVICE, and that half is not cosmetic. ntnu-mcp caches the
 * same upstream against the same grammar — `v1:` plus
 * `JSON.stringify(["details", CODE, year, …])` — so under a bare `v1:` the two
 * were one keyspace apart only by accident: `details` is 3 elements here and 4
 * there, `timetable` 4 here and 3 there. Add an argument on either side and
 * each service starts reviving the other's payload as its own shape, which
 * surfaces as garbled course data with nothing in either repo pointing at the
 * cause. They are bound to separate namespaces now as well (wrangler.jsonc says
 * why); this is the belt to that pair of braces, and it costs one cold fetch
 * per course on the deploy that introduces it.
 */
const KV_KEY_PREFIX = "v1:page:";

/**
 * Two-tier TTL cache: per-isolate memory in front of a shared Workers KV
 * namespace, so each upstream resource is fetched roughly once per TTL
 * globally rather than once per isolate.
 *
 * - KV failures degrade to a cache miss, never to a request failure.
 * - A KV hit is re-stamped into memory with a fresh TTL, so worst-case
 *   staleness is just under 2× the TTL.
 * - Values must be JSON-serializable; callers revive rich types after a
 *   round-trip.
 */
export class TieredCache {
  private readonly memory: TTLCache;
  private readonly kv?: KVCacheBinding;

  constructor(memory: TTLCache = new TTLCache(), kv?: KVCacheBinding) {
    this.memory = memory;
    this.kv = kv;
  }

  async get(key: string, ttlMs: number): Promise<unknown | null> {
    const hit = this.memory.get(key, ttlMs);
    if (hit !== null) return hit;
    if (!this.kv) return null;
    try {
      const raw = await this.kv.get(`${KV_KEY_PREFIX}${key}`, "text");
      if (raw === null) return null;
      const value: unknown = JSON.parse(raw);
      this.memory.set(key, value);
      return value;
    } catch (err) {
      console.warn(`KV cache read failed for ${key}: ${String(err)}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlMs: number): Promise<void> {
    this.memory.set(key, value);
    if (!this.kv) return;
    try {
      await this.kv.put(`${KV_KEY_PREFIX}${key}`, JSON.stringify(value), {
        // KV enforces a 60s minimum; every TTL here is far above it anyway.
        expirationTtl: Math.max(60, Math.ceil(ttlMs / 1000)),
      });
    } catch (err) {
      console.warn(`KV cache write failed for ${key}: ${String(err)}`);
    }
  }
}
