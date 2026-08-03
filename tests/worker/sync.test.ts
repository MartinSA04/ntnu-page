import { describe, expect, it } from "vitest";
import {
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
