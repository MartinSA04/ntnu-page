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

function fakeKv(): SyncKv & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (key) => map.get(key) ?? null,
    put: async (key, value) => void map.set(key, value),
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
  expect((await handleSyncGet("martin", OTHER, withLimiter)).status).toBe(429);
  // …and a correct key is refused too while the lockout stands.
  expect((await handleSyncGet("martin", AUTH, withLimiter)).status).toBe(429);
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
  });

  it("405s an unsupported method", async () => {
    const res = await worker.fetch(
      new Request("https://x/api/sync/martin", { method: "PATCH" }),
      envWith(fakeKv()),
    );
    expect(res.status).toBe(405);
  });
});
