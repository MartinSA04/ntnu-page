import { describe, expect, it, vi } from "vitest";
import type { StorageLike } from "../../src/lib/planner/store.js";
import {
  applySyncable,
  collectSyncable,
  createSyncClient,
  describeCollision,
  type SyncClient,
  type SyncPayload,
} from "../../src/lib/planner/syncClient.js";
import { open } from "../../src/lib/planner/syncCrypto.js";

/**
 * `fetchRemote` + `applyRemote`, composed by hand.
 *
 * There is no `pull()` on `SyncClient` any more, and this helper is why it can
 * stay gone: the app's caller has a generation counter to check BETWEEN the two
 * halves (`pullAndRefresh` in `plannerApp.ts`), and a test has nothing
 * concurrent to protect. Keeping the unguarded composition here rather than on
 * the public interface is the whole point — it cannot be reached by accident
 * from the product.
 */
async function pullNow(client: SyncClient): Promise<{ ok: boolean; reason?: string }> {
  const fetched = await client.fetchRemote();
  if (!fetched.ok) return { ok: false, reason: fetched.reason };
  client.applyRemote(fetched.snapshot);
  return { ok: true };
}

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
      devices: [],
    });
  });

  it("never carries per-device view state", () => {
    const storage = fakeStorage({
      "np:plans": "{}",
      "np:weekView": "tavle",
      "np:weekBox": '{"kolonner":829}',
    });
    // `SyncPayload` is a closed interface (four known fields), so a direct
    // `as Record<string, unknown>` is a type error under strict mode (no
    // index signature to satisfy the target). The `unknown` hop is the
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
    applySyncable(storage, {
      profile: "{}",
      plans: '{"26h":[]}',
      lastSemester: "26h",
      devices: [],
    });
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

    // The branch's load-bearing claim, machine-checked rather than re-traced
    // by hand at every review: `encKeyRaw` is derived alongside `authKey` and
    // must NEVER be on the wire — not at signup, not on a later push.
    const encKeyRaw = client.session()?.encKeyRaw ?? "";
    expect(encKeyRaw).not.toBe("");
    expect(String(calls[0]?.init?.body)).not.toContain(encKeyRaw);

    storage.map.set("np:plans", '{"26h":[{"code":"TDT4100","name":"Objekt"}]}');
    await client.push();
    const pushBody = String(calls.at(-1)?.init?.body);
    expect(pushBody).not.toContain(encKeyRaw);
    expect(pushBody).not.toContain("TDT4100");
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

    expect(await pullNow(client)).toEqual({ ok: true });
    expect(storage.map.get("np:plans")).toBe('{"26h":[]}');
  }, 30_000);

  /**
   * `applySyncable` replaces the whole `np:plans` map, and `describeCollision`
   * used to inspect only `lastSemester`. A student with a full 25h plan and an
   * empty 26h — `lastSemester` = "26h" — logged in, was asked nothing, and the
   * 25h plan was gone. This drives the real `login`, not just the predicate.
   */
  it("asks before replacing a plan in a semester the collision question does not name", async () => {
    // Device A owns the account and has only an empty 26h.
    const storageA = fakeStorage({ "np:plans": '{"26h":[]}', "np:lastSemester": "26h" });
    let stored = "";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        stored = String(JSON.parse(String(init.body)).blob);
        return new Response(JSON.stringify({ version: 1 }), { status: 201 });
      }
      return new Response(JSON.stringify({ blob: stored, version: 1 }), { status: 200 });
    }) as unknown as typeof fetch;
    await createSyncClient({ storage: storageA, fetch: fetchMock }).signup(
      "martin",
      "482913",
      "Mac",
    );

    // Device B has a full 25h draft and is currently looking at an empty 26h.
    const storageB = fakeStorage({
      "np:plans": '{"25h":[{"code":"TDT4100","name":"A"},{"code":"TDT4120","name":"B"}],"26h":[]}',
      "np:lastSemester": "26h",
    });
    const deviceB = createSyncClient({ storage: storageB, fetch: fetchMock });
    const result = await deviceB.login("martin", "482913", "iPhone");

    expect(result).toMatchObject({ ok: false, reason: "collision" });
    // Nothing was written: the 25h draft is untouched until the student answers.
    expect(storageB.map.get("np:plans")).toContain("TDT4100");
    expect(deviceB.session()).toBeNull();
  }, 60_000);

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

const payload = (codes: string[]): SyncPayload => ({
  profile: "{}",
  plans: JSON.stringify({ "26h": codes.map((code) => ({ code, name: code })) }),
  lastSemester: "26h",
  devices: [],
});

/** A payload spanning several semesters, which is what `np:plans` really is. */
const multiPayload = (plans: Record<string, string[]>, lastSemester: string): SyncPayload => ({
  profile: "{}",
  plans: JSON.stringify(
    Object.fromEntries(
      Object.entries(plans).map(([id, codes]) => [id, codes.map((code) => ({ code, name: code }))]),
    ),
  ),
  lastSemester,
  devices: [],
});

describe("describeCollision", () => {
  it("is null when this device has nothing to lose", () => {
    expect(describeCollision(payload([]), payload(["TDT4120"]), "26h")).toBeNull();
  });

  it("is null when the two sides already agree", () => {
    expect(describeCollision(payload(["TDT4120"]), payload(["TDT4120"]), "26h")).toBeNull();
  });

  it("counts both sides and names what the remote is missing", () => {
    const summary = describeCollision(payload(["TDT4120", "TDT4100"]), payload(["TDT4100"]), "26h");
    expect(summary).toMatchObject({
      localCount: 2,
      remoteCount: 1,
      missingFromRemote: ["TDT4120"],
    });
  });

  // The ordinary second-device login: this device holds a subset of what the
  // account already has, so adopting the remote copy loses nothing and the
  // student is asked nothing. This is the branch's best product property.
  it("stays null when the remote already contains everything this device has", () => {
    expect(
      describeCollision(payload(["TDT4100"]), payload(["TDT4100", "TDT4120"]), "26h"),
    ).toBeNull();
  });

  /**
   * `applySyncable` replaces the WHOLE `np:plans` map, but the question used
   * to be asked about one semester only. A student with a full 25h plan and an
   * empty 26h — `lastSemester` = "26h" — got no prompt at all and the 25h plan
   * was gone, unasked.
   */
  it("asks when ANOTHER semester holds work the remote lacks, not only the current one", () => {
    const local = multiPayload({ "25h": ["TDT4100", "TDT4120"], "26h": [] }, "26h");
    const remote = multiPayload({ "26h": [] }, "26h");
    expect(describeCollision(local, remote, "26h")).not.toBeNull();
  });

  it("asks even when lastSemester is unset, so plans[''] is empty", () => {
    const local = multiPayload({ "25h": ["TDT4100"] }, "");
    const remote = multiPayload({ "25h": [] }, "");
    expect(describeCollision(local, remote, "")).not.toBeNull();
  });

  /**
   * `activeCourses` is the definition of "what counts" everywhere else. This
   * used to count dropped rows, so the one prompt the design keeps printed an
   * inflated count and listed courses the student had deliberately dropped
   * under "mangler".
   */
  it("ignores dropped courses on both sides", () => {
    const withDrop: SyncPayload = {
      profile: "{}",
      plans: JSON.stringify({
        "26h": [
          { code: "TDT4100", name: "A", source: "program" },
          { code: "TDT4120", name: "B", source: "program", dropped: true },
        ],
      }),
      lastSemester: "26h",
      devices: [],
    };
    // The only difference between the two sides is a course this device
    // dropped, so there is nothing to ask about at all.
    expect(describeCollision(withDrop, payload(["TDT4100"]), "26h")).toBeNull();

    const summary = describeCollision(withDrop, payload([]), "26h");
    expect(summary).toMatchObject({
      localCount: 1,
      remoteCount: 0,
      missingFromRemote: ["TDT4100"],
    });
  });
});

describe("changePin", () => {
  it("re-encrypts under the new PIN and leaves the old one unable to read", async () => {
    const storage = fakeStorage({ "np:plans": '{"26h":[{"code":"TDT4120","name":"Algo"}]}' });
    let stored = "";
    let authHashSeen = "";
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (init?.method === "POST") {
        stored = body.blob;
        authHashSeen = body.authKey;
        return new Response(JSON.stringify({ version: 1 }), { status: 201 });
      }
      if (init?.method === "PUT") {
        stored = body.blob;
        if (body.authKey) authHashSeen = body.authKey;
        return new Response(JSON.stringify({ version: 2 }), { status: 200 });
      }
      return new Response(JSON.stringify({ blob: stored, version: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createSyncClient({ storage, fetch: fetchMock });
    await client.signup("martin", "482913", "Mac");
    const before = authHashSeen;
    const oldEncKeyRaw = client.session()?.encKeyRaw ?? "";

    expect(await client.changePin("482913", "999111")).toEqual({ ok: true });
    expect(authHashSeen).not.toBe(before);

    // "Truthy" was true after ANY successful call and proved nothing. What the
    // title claims is a fact about the ciphertext the PUT left on the server:
    // the new key opens it and the old one does not. Against real crypto.
    const newEncKeyRaw = client.session()?.encKeyRaw ?? "";
    expect(newEncKeyRaw).not.toBe(oldEncKeyRaw);
    expect(await open(newEncKeyRaw, stored)).not.toBeNull();
    expect(await open(oldEncKeyRaw, stored)).toBeNull();
  }, 60_000);

  it("refuses when the old PIN is wrong, without touching the stored blob", async () => {
    const storage = fakeStorage({ "np:plans": "{}" });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ version: 1 }), { status: 201 }),
    );
    const client = createSyncClient({
      storage,
      fetch: fetchMock as unknown as typeof fetch,
    });
    await client.signup("martin", "482913", "Mac");
    // The signup is the only call this test wants on the wire; the refusal
    // below is decided locally, before anything is sent.
    const callsAfterSignup = fetchMock.mock.calls.length;

    expect(await client.changePin("000000", "999111")).toEqual({ ok: false, reason: "bad_pin" });
    expect(fetchMock.mock.calls.length).toBe(callsAfterSignup);
  }, 60_000);
});

/**
 * A PIN change on one device is this feature's ONLY revocation (§4 / §6 step
 * 8) — and every other device keeps its now-wrong `authKey`. Nothing mapped
 * the resulting 401: the session stayed in storage, the panel still read
 * "Sist synkronisert nå", every load/visibility flip/edit retried, and the
 * worker's PER-NAME `AuthLimiter` turned ten of those retries into a lockout
 * that took the account's GOOD devices down with it.
 */
describe("a revoked session", () => {
  async function signedIn(status: number) {
    const storage = fakeStorage({ "np:plans": '{"26h":[]}' });
    let claimed = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      if (!claimed && init?.method === "POST") {
        claimed = true;
        return new Response(JSON.stringify({ version: 1 }), { status: 201 });
      }
      return new Response(JSON.stringify({ error: "unauthorised" }), { status });
    }) as unknown as typeof fetch;
    const client = createSyncClient({ storage, fetch: fetchMock });
    await client.signup("martin", "482913", "Mac");
    return { client, storage };
  }

  it("names a 401 on push as unauthorised and drops the session, so nothing retries", async () => {
    const { client, storage } = await signedIn(401);
    expect(await client.push()).toEqual({ ok: false, reason: "unauthorised" });
    expect(client.session()).toBeNull();
    // …and it is gone from storage too, so a reload starts logged out rather
    // than resuming the retry loop that produces the lockout.
    expect(storage.map.get("np:sync")).toBe("");
  }, 30_000);

  it("names a 401 on fetchRemote the same way", async () => {
    const { client } = await signedIn(401);
    expect(await client.fetchRemote()).toEqual({ ok: false, reason: "unauthorised" });
    expect(client.session()).toBeNull();
  }, 30_000);

  it("does NOT drop the session on a 429 — that is the lockout, not a wrong key", async () => {
    const { client } = await signedIn(429);
    expect(await pullNow(client)).toEqual({ ok: false, reason: "too_many_attempts" });
    expect(client.session()).not.toBeNull();
  }, 30_000);

  it("maps 503 on push to unavailable, as signup already did", async () => {
    const { client } = await signedIn(503);
    expect(await client.push()).toEqual({ ok: false, reason: "unavailable" });
    expect(client.session()).not.toBeNull();
  }, 30_000);
});

/**
 * `resolveLogin` cleared `pending` before acting, so a failed
 * `resolveLogin("local")` showed "Prøv igjen" and every retry answered
 * `no_pending` — the same unwinnable-retry class Task 7 fixed on the auth
 * buttons.
 */
describe("resolveLogin", () => {
  it("keeps the pending login alive so a failed push can actually be retried", async () => {
    // Device A owns the account; device B logs in holding a different plan.
    const storageA = fakeStorage({ "np:plans": '{"26h":[{"code":"TDT4100","name":"A"}]}' });
    let stored = "";
    let version = 1;
    let failNextPut = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") {
        stored = String(JSON.parse(String(init?.body)).blob);
        return new Response(JSON.stringify({ version: 1 }), { status: 201 });
      }
      if (method === "PUT") {
        if (failNextPut) {
          failNextPut = false;
          return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        }
        stored = String(JSON.parse(String(init?.body)).blob);
        version += 1;
        return new Response(JSON.stringify({ version }), { status: 200 });
      }
      return new Response(JSON.stringify({ blob: stored, version }), { status: 200 });
    }) as unknown as typeof fetch;
    await createSyncClient({ storage: storageA, fetch: fetchMock }).signup(
      "martin",
      "482913",
      "Mac",
    );

    const storageB = fakeStorage({ "np:plans": '{"26h":[{"code":"TDT4120","name":"B"}]}' });
    const deviceB = createSyncClient({ storage: storageB, fetch: fetchMock });
    expect(await deviceB.login("martin", "482913", "iPhone")).toMatchObject({
      reason: "collision",
    });

    failNextPut = true;
    expect(await deviceB.resolveLogin("local")).toEqual({ ok: false, reason: "failed" });
    // The retry the panel's own "Prøv igjen" invites now works, instead of
    // answering `no_pending` forever.
    expect(await deviceB.resolveLogin("local")).toEqual({ ok: true });

    // One device row for this device, not one per attempt.
    const devices = deviceB.session()?.devices ?? [];
    expect(devices.filter((d) => d.label === "iPhone")).toHaveLength(1);
  }, 60_000);
});
