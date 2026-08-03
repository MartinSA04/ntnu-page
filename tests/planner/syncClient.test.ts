import { describe, expect, it, vi } from "vitest";
import type { StorageLike } from "../../src/lib/planner/store.js";
import {
  applySyncable,
  collectSyncable,
  createSyncClient,
} from "../../src/lib/planner/syncClient.js";

function fakeStorage(
  seed: Record<string, string> = {},
): StorageLike & { map: Map<string, string> } {
  const map = new Map(Object.entries(seed));
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
  };
}

describe("collectSyncable", () => {
  it("takes the plan, the profile and the last semester", () => {
    const storage = fakeStorage({
      "np:profile": '{"program":{"code":"MTDT","name":"Datateknologi","cohort":2026}}',
      "np:plans": '{"26h":[{"code":"TDT4120","name":"Algoritmer"}]}',
      "np:lastSemester": "26h",
    });
    expect(collectSyncable(storage)).toEqual({
      profile: '{"program":{"code":"MTDT","name":"Datateknologi","cohort":2026}}',
      plans: '{"26h":[{"code":"TDT4120","name":"Algoritmer"}]}',
      lastSemester: "26h",
    });
  });

  it("never carries per-device view state", () => {
    const storage = fakeStorage({
      "np:plans": "{}",
      "np:weekView": "tavle",
      "np:weekBox": '{"kolonner":829}',
    });
    // `SyncPayload` is a closed interface (three known string fields), so a
    // direct `as Record<string, unknown>` is a type error under strict mode
    // (no index signature to satisfy the target). The `unknown` hop is the
    // standard way to assert past that without weakening `SyncPayload` itself
    // — the test's job is checking absence of stray keys, which needs the
    // object treated as an open record.
    const payload = collectSyncable(storage) as unknown as Record<string, unknown>;
    expect(Object.keys(payload)).not.toContain("weekView");
    expect(Object.keys(payload)).not.toContain("weekBox");
    expect(JSON.stringify(payload)).not.toContain("829");
  });
});

describe("applySyncable", () => {
  it("writes the three keys and leaves view state alone", () => {
    const storage = fakeStorage({ "np:weekView": "tavle" });
    applySyncable(storage, { profile: "{}", plans: '{"26h":[]}', lastSemester: "26h" });
    expect(storage.map.get("np:plans")).toBe('{"26h":[]}');
    expect(storage.map.get("np:weekView")).toBe("tavle");
  });
});

describe("createSyncClient", () => {
  it("signs up, stores the session, and pushes ciphertext rather than the plan", async () => {
    const storage = fakeStorage({ "np:plans": '{"26h":[{"code":"TDT4120","name":"Algo"}]}' });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ version: 1 }), { status: 201 });
    }) as unknown as typeof fetch;

    const client = createSyncClient({ storage, fetch: fetchMock });
    const result = await client.signup("martin", "482913", "iPhone · Safari");

    expect(result.ok).toBe(true);
    expect(client.session()?.navn).toBe("martin");
    expect(calls[0]?.url).toBe("/api/sync/martin");
    expect(String(calls[0]?.init?.body)).not.toContain("TDT4120");
  }, 30_000);

  it("reports a taken name without storing a session", async () => {
    const storage = fakeStorage();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "taken" }), { status: 409 }),
    ) as unknown as typeof fetch;

    const client = createSyncClient({ storage, fetch: fetchMock });
    const result = await client.signup("martin", "482913", "iPhone · Safari");

    expect(result).toEqual({ ok: false, reason: "taken" });
    expect(client.session()).toBeNull();
  }, 30_000);

  it("reports a wrong PIN on login as bad_pin, not as a missing account", async () => {
    const storage = fakeStorage();
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ error: "unauthorised" }), { status: 401 }),
    ) as unknown as typeof fetch;

    const client = createSyncClient({ storage, fetch: fetchMock });
    expect(await client.login("martin", "000000", "Mac")).toEqual({ ok: false, reason: "bad_pin" });
  }, 30_000);

  it("pulls, decrypts and applies a remote plan", async () => {
    const storage = fakeStorage({ "np:plans": '{"26h":[]}' });
    const uploads: string[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        uploads.push(String(JSON.parse(String(init.body)).blob));
        return new Response(JSON.stringify({ version: 1 }), { status: 201 });
      }
      return new Response(JSON.stringify({ blob: uploads[0], version: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createSyncClient({ storage, fetch: fetchMock });
    await client.signup("martin", "482913", "Mac");
    storage.map.set("np:plans", '{"26h":[{"code":"WRONG","name":"x"}]}');

    expect(await client.pull()).toEqual({ ok: true });
    expect(storage.map.get("np:plans")).toBe('{"26h":[]}');
  }, 30_000);

  it("adopts the server copy when a push is stale", async () => {
    const storage = fakeStorage({ "np:plans": '{"26h":[]}' });
    let stored = "";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        stored = String(JSON.parse(String(init.body)).blob);
        return new Response(JSON.stringify({ version: 1 }), { status: 201 });
      }
      return new Response(JSON.stringify({ error: "stale", blob: stored, version: 7 }), {
        status: 409,
      });
    }) as unknown as typeof fetch;

    const client = createSyncClient({ storage, fetch: fetchMock });
    await client.signup("martin", "482913", "Mac");
    expect(await client.push()).toEqual({ ok: false, reason: "stale" });
    expect(client.session()?.version).toBe(7);
  }, 30_000);
});
