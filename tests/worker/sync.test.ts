import { describe, expect, it } from "vitest";
import worker, { type Env } from "../../worker/src/server.js";
import {
  AuthLimiter,
  handleSyncClaim,
  handleSyncDelete,
  handleSyncGet,
  handleSyncPut,
  type SyncDeps,
  type SyncKv,
  validateName,
} from "../../worker/src/sync.js";

describe("validateName", () => {
  it("lowercases and accepts a plain name", () => {
    expect(validateName("Martin")).toBe("martin");
    expect(validateName("  martin-h26 ")).toBe("martin-h26");
  });

  it("rejects names that cannot sit in a URL segment", () => {
    expect(validateName("ma")).toBeNull(); // too short
    expect(validateName("a".repeat(25))).toBeNull(); // too long
    expect(validateName("martin_h26")).toBeNull(); // underscore
    expect(validateName("-martin")).toBeNull(); // leading dash
    expect(validateName("martin-")).toBeNull(); // trailing dash
    expect(validateName("martin/../etc")).toBeNull();
    expect(validateName("mårten")).toBeNull(); // ASCII only, it is a URL
  });

  it("rejects reserved words", () => {
    expect(validateName("api")).toBeNull();
    expect(validateName("user")).toBeNull();
  });
});

/**
 * `calls` counts every KV operation, so a test whose whole point is that KV
 * was never reached can assert that rather than infer it from a status code
 * (a 429 and a 404 both "look right" while still having read the record).
 */
function fakeKv(): SyncKv & { map: Map<string, string>; calls: { get: number; put: number } } {
  const map = new Map<string, string>();
  const calls = { get: 0, put: 0 };
  return {
    map,
    calls,
    get: async (key) => {
      calls.get += 1;
      return map.get(key) ?? null;
    },
    put: async (key, value) => {
      calls.put += 1;
      map.set(key, value);
    },
    delete: async (key) => void map.delete(key),
  };
}

function deps(kv: SyncKv): SyncDeps {
  return { kv, now: () => "2026-08-03T09:00:00.000Z" };
}

const AUTH = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("sync account lifecycle", () => {
  it("claims a free name and returns version 1", async () => {
    const kv = fakeKv();
    const res = await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ version: 1 });
  });

  it("refuses a name already taken", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    const res = await handleSyncClaim("martin", { authKey: OTHER, blob: "x" }, deps(kv));
    expect(res.status).toBe(409);
  });

  it("reads the blob back with the right authKey and 401s with the wrong one", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));

    const ok = await handleSyncGet("martin", AUTH, deps(kv));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ blob: "cipher", version: 1 });

    expect((await handleSyncGet("martin", OTHER, deps(kv))).status).toBe(401);
    expect((await handleSyncGet("martin", null, deps(kv))).status).toBe(401);
  });

  it("404s an unknown name rather than leaking that it is free", async () => {
    const kv = fakeKv();
    expect((await handleSyncGet("nobody", AUTH, deps(kv))).status).toBe(404);
  });

  it("writes when version matches and 409s with the server copy when it does not", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "v1" }, deps(kv));

    const ok = await handleSyncPut("martin", AUTH, { blob: "v2", version: 1 }, deps(kv));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ version: 2 });

    const stale = await handleSyncPut("martin", AUTH, { blob: "v2b", version: 1 }, deps(kv));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ blob: "v2", version: 2 });
  });

  it("replaces authHash when the PUT body carries a new authKey — a PIN change", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "v1" }, deps(kv));

    const changed = await handleSyncPut(
      "martin",
      AUTH,
      { blob: "v2", version: 1, authKey: OTHER },
      deps(kv),
    );
    expect(changed.status).toBe(200);
    expect(await changed.json()).toEqual({ version: 2 });

    // The old credential no longer authorises this record...
    expect((await handleSyncGet("martin", AUTH, deps(kv))).status).toBe(401);
    // ...and the new one does, reading back the blob the same request wrote.
    const withNewKey = await handleSyncGet("martin", OTHER, deps(kv));
    expect(withNewKey.status).toBe(200);
    expect(await withNewKey.json()).toMatchObject({ blob: "v2", version: 2 });
  });

  it("leaves authHash untouched when the PUT body omits authKey", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "v1" }, deps(kv));
    await handleSyncPut("martin", AUTH, { blob: "v2", version: 1 }, deps(kv));
    expect((await handleSyncGet("martin", AUTH, deps(kv))).status).toBe(200);
  });

  it("does not swap the credential on a stale write — the old PIN still works", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "v1" }, deps(kv));

    // Version 1 is already gone (the record is at version 1, so a PUT
    // claiming version 2 is stale) — the credential swap it was carrying
    // must not have happened.
    const stale = await handleSyncPut(
      "martin",
      AUTH,
      { blob: "v2", version: 2, authKey: OTHER },
      deps(kv),
    );
    expect(stale.status).toBe(409);
    expect((await handleSyncGet("martin", AUTH, deps(kv))).status).toBe(200);
    expect((await handleSyncGet("martin", OTHER, deps(kv))).status).toBe(401);
  });

  it("deletes only with the right authKey", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    expect((await handleSyncDelete("martin", OTHER, deps(kv))).status).toBe(401);
    expect((await handleSyncDelete("martin", AUTH, deps(kv))).status).toBe(204);
    expect(kv.map.size).toBe(0);
  });

  it("rejects an invalid name before touching KV", async () => {
    const kv = fakeKv();
    const res = await handleSyncClaim("ma", { authKey: AUTH, blob: "x" }, deps(kv));
    expect(res.status).toBe(400);
    expect(kv.map.size).toBe(0);
  });

  it("never stores the authKey itself", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    expect(kv.map.get("user:martin")).not.toContain(AUTH);
  });
});

describe("AuthLimiter", () => {
  it("blocks after the configured number of failures and recovers after the window", () => {
    const limiter = new AuthLimiter(3, 60_000);
    for (let i = 0; i < 3; i++) {
      expect(limiter.check("martin", 1000)).toBe(true);
      limiter.fail("martin", 1000);
    }
    expect(limiter.check("martin", 1000)).toBe(false);
    expect(limiter.check("martin", 62_000)).toBe(true);
  });

  it("buckets per name", () => {
    const limiter = new AuthLimiter(1, 60_000);
    limiter.fail("martin", 0);
    expect(limiter.check("martin", 0)).toBe(false);
    expect(limiter.check("kari", 0)).toBe(true);
  });

  it("clears on a successful authentication", () => {
    const limiter = new AuthLimiter(1, 60_000);
    limiter.fail("martin", 0);
    limiter.clear("martin");
    expect(limiter.check("martin", 0)).toBe(true);
  });
});

it("429s a locked-out name without touching KV", async () => {
  const kv = fakeKv();
  await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
  const limiter = new AuthLimiter(1, 60_000);
  const withLimiter: SyncDeps = { ...deps(kv), limiter, monotonic: () => 0 };

  expect((await handleSyncGet("martin", OTHER, withLimiter)).status).toBe(401);
  // The first 401 had to read the record to compare the digest; everything
  // after the lockout must not — which is the half of this test's title the
  // status codes alone never checked.
  const readsAfterFirst401 = kv.calls.get;
  expect((await handleSyncGet("martin", OTHER, withLimiter)).status).toBe(429);
  // …and a correct key is refused too while the lockout stands.
  expect((await handleSyncGet("martin", AUTH, withLimiter)).status).toBe(429);
  expect(kv.calls.get).toBe(readsAfterFirst401);
});

/**
 * A `blob` is base64 ciphertext of a course list; a real one is a few KB.
 * Neither claim nor PUT bounded it, and claim needs no credential — so
 * `POST /api/sync/<random>` with a multi-megabyte body was unbounded
 * anonymous KV writes.
 */
describe("blob size", () => {
  const HUGE = "x".repeat(512 * 1024 + 1);

  it("refuses an oversized claim with 413, without writing to KV", async () => {
    const kv = fakeKv();
    const res = await handleSyncClaim("martin", { authKey: AUTH, blob: HUGE }, deps(kv));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "blob_too_large" });
    expect(kv.calls.put).toBe(0);
    expect(kv.map.size).toBe(0);
  });

  it("refuses an oversized PUT with 413, leaving the stored blob intact", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "v1" }, deps(kv));
    const putsAfterClaim = kv.calls.put;

    const res = await handleSyncPut("martin", AUTH, { blob: HUGE, version: 1 }, deps(kv));
    expect(res.status).toBe(413);
    expect(kv.calls.put).toBe(putsAfterClaim);
    expect(await (await handleSyncGet("martin", AUTH, deps(kv))).json()).toMatchObject({
      blob: "v1",
      version: 1,
    });
  });

  it("still accepts a blob comfortably larger than any real plan", async () => {
    const kv = fakeKv();
    const res = await handleSyncClaim(
      "martin",
      { authKey: AUTH, blob: "x".repeat(64 * 1024) },
      deps(kv),
    );
    expect(res.status).toBe(201);
  });
});

describe("sync response headers", () => {
  it("never lets a per-user blob be cached, and varies on the credential", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    const res = await handleSyncGet("martin", AUTH, deps(kv));
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    // The body is a function of `x-np-auth`; a shared cache that did not know
    // that could hand one student's blob to the next request.
    expect(res.headers.get("Vary")).toBe("x-np-auth");
  });

  it("marks a refusal no-store too", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    expect((await handleSyncGet("martin", OTHER, deps(kv))).headers.get("Cache-Control")).toBe(
      "no-store",
    );
  });
});

function envWith(kv: SyncKv): Env {
  return {
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
    SYNC: kv,
  } as Env;
}

describe("worker dispatch for /api/sync", () => {
  it("claims, reads back and rejects a wrong key end to end", async () => {
    const kv = fakeKv();
    const env = envWith(kv);

    const claim = await worker.fetch(
      new Request("https://x/api/sync/martin", {
        method: "POST",
        body: JSON.stringify({ authKey: AUTH, blob: "cipher" }),
      }),
      env,
    );
    expect(claim.status).toBe(201);

    const read = await worker.fetch(
      new Request("https://x/api/sync/martin", { headers: { "x-np-auth": AUTH } }),
      env,
    );
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ blob: "cipher" });

    const wrong = await worker.fetch(
      new Request("https://x/api/sync/martin", { headers: { "x-np-auth": OTHER } }),
      env,
    );
    expect(wrong.status).toBe(401);
  });

  it("503s when no KV namespace is bound rather than pretending to save", async () => {
    const env = { ASSETS: { fetch: async () => new Response("asset") } } as Env;
    const res = await worker.fetch(
      new Request("https://x/api/sync/martin", { headers: { "x-np-auth": AUTH } }),
      env,
    );
    expect(res.status).toBe(503);
    // …and it is not cacheable. This branch built its own `Response` by hand
    // and was the one sync answer missing the header every other one sets; a
    // shared cache holding it would keep answering "unavailable" after the
    // binding came back.
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("405s an unsupported method", async () => {
    const res = await worker.fetch(
      new Request("https://x/api/sync/martin", { method: "PATCH" }),
      envWith(fakeKv()),
    );
    expect(res.status).toBe(405);
  });

  /**
   * The sync branch used to return before `clientKey`/`rateLimiter` were even
   * constructed, so the throttle guarding the rest of `/api` never applied to
   * it. `handleSyncClaim` needs no credential, so nothing else bounded an
   * anonymous write loop.
   *
   * A distinct IP per test keeps this off the module-level bucket every other
   * test in the process shares.
   */
  it("throttles a client hammering the sync surface", async () => {
    const kv = fakeKv();
    const env = envWith(kv);
    const ip = "203.0.113.77";
    let lastStatus = 0;
    // The bucket is 120 tokens; the 121st request inside the same millisecond
    // cannot have refilled.
    for (let i = 0; i < 130; i++) {
      const res = await worker.fetch(
        new Request(`https://x/api/sync/ingen-slik-konto`, {
          headers: { "CF-Connecting-IP": ip, "x-np-auth": AUTH },
        }),
        env,
      );
      lastStatus = res.status;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });

  it("leaves an unthrottleable client (no CF-Connecting-IP) alone, as the rest of /api does", async () => {
    const env = envWith(fakeKv());
    for (let i = 0; i < 130; i++) {
      const res = await worker.fetch(
        new Request("https://x/api/sync/ingen-slik-konto", { headers: { "x-np-auth": AUTH } }),
        env,
      );
      // 404, never 429: with no honest key, bucketing everyone together would
      // let one abuser deny service to all callers.
      expect(res.status).toBe(404);
    }
  });
});
