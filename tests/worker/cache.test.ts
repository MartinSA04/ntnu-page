/**
 * `TTLCache` is a module-level singleton in `server.ts`, so its eviction
 * behaviour — not just its hit/miss behaviour — is what keeps a long-lived
 * isolate inside its 128 MB budget.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TTLCache } from "../../worker/src/cache.js";

const TTL = 60_000;

afterEach(() => {
  vi.useRealTimers();
});

describe("TTLCache", () => {
  it("returns a stored value inside its TTL", () => {
    const cache = new TTLCache();
    cache.set("a", { v: 1 });
    expect(cache.get("a", TTL)).toEqual({ v: 1 });
  });

  it("returns null for an unknown key", () => {
    expect(new TTLCache().get("nope", TTL)).toBeNull();
  });

  it("drops an expired entry on read instead of leaving it in the map", () => {
    vi.useFakeTimers();
    const cache = new TTLCache();
    cache.set("a", "value");
    vi.advanceTimersByTime(TTL + 1);

    expect(cache.get("a", TTL)).toBeNull();
    // A longer TTL must not resurrect it: the expired read deleted the entry.
    expect(cache.get("a", TTL * 10)).toBeNull();
  });

  it("evicts in insertion order once the cap is exceeded", () => {
    const cache = new TTLCache();
    for (let i = 0; i < 520; i++) cache.set(`k${i}`, i);

    expect(cache.get("k0", TTL)).toBeNull();
    expect(cache.get("k19", TTL)).toBeNull();
    expect(cache.get("k20", TTL)).toBe(20);
    expect(cache.get("k519", TTL)).toBe(519);
  });

  it("re-setting a key moves it to the back of the eviction queue", () => {
    const cache = new TTLCache();
    for (let i = 0; i < 500; i++) cache.set(`k${i}`, i);
    cache.set("k0", "refreshed");
    cache.set("new", 1);

    // k1 was the oldest once k0 was re-stamped, so k1 goes and k0 survives.
    expect(cache.get("k1", TTL)).toBeNull();
    expect(cache.get("k0", TTL)).toBe("refreshed");
  });
});
