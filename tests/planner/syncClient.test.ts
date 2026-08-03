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

    // …and the two payloads the panel is handed describe the 25h draft, not
    // the empty 26h this device happens to be looking at. Asserting only
    // `reason: "collision"` is what let the prompt go on summarising
    // `lastSemester` while the buttons replaced everything.
    const collision = result as { local: SyncPayload; remote: SyncPayload };
    expect(describeCollision(collision.local, collision.remote)?.semesters).toEqual([
      {
        semesterId: "25h",
        localCodes: ["TDT4100", "TDT4120"],
        remoteCodes: [],
        missingFromRemote: ["TDT4100", "TDT4120"],
        missingFromLocal: [],
      },
    ]);
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
    expect(describeCollision(payload([]), payload(["TDT4120"]))).toBeNull();
  });

  it("is null when the two sides already agree", () => {
    expect(describeCollision(payload(["TDT4120"]), payload(["TDT4120"]))).toBeNull();
  });

  it("names the semester and both sides' courses, in both directions", () => {
    const summary = describeCollision(payload(["TDT4120", "TDT4100"]), payload(["TDT4100"]));
    expect(summary?.semesters).toEqual([
      {
        semesterId: "26h",
        localCodes: ["TDT4120", "TDT4100"],
        remoteCodes: ["TDT4100"],
        missingFromRemote: ["TDT4120"],
        missingFromLocal: [],
      },
    ]);
  });

  // The ordinary second-device login: this device holds a subset of what the
  // account already has, so adopting the remote copy loses nothing and the
  // student is asked nothing. This is the branch's best product property.
  it("stays null when the remote already contains everything this device has", () => {
    expect(describeCollision(payload(["TDT4100"]), payload(["TDT4100", "TDT4120"]))).toBeNull();
  });

  /**
   * `applySyncable` replaces the WHOLE `np:plans` map, but the question used
   * to be asked about one semester only. A student with a full 25h plan and an
   * empty 26h — `lastSemester` = "26h" — first got no prompt at all, and then
   * (once the DECISION was widened) got a prompt that still described 26h:
   * "Denne enheten — 0 emner · 0 sp" over a device holding a 25h draft, with
   * the obvious answer wired to destroy it.
   *
   * So it is not enough that this asks. What it answers has to NAME the
   * semester at risk, or the prompt describes less than the button does.
   */
  it("describes the semester at risk, not the one this device is looking at", () => {
    const local = multiPayload({ "25h": ["TDT4100", "TDT4120"], "26h": [] }, "26h");
    const remote = multiPayload({ "26h": [] }, "26h");
    const summary = describeCollision(local, remote);
    expect(summary?.semesters).toEqual([
      {
        semesterId: "25h",
        localCodes: ["TDT4100", "TDT4120"],
        remoteCodes: [],
        missingFromRemote: ["TDT4100", "TDT4120"],
        missingFromLocal: [],
      },
    ]);
  });

  /**
   * "Behold denne enheten" replaces the account's copy just as thoroughly as
   * the other button replaces this device's, so a semester only the ACCOUNT
   * has is at risk too and has to be listed — even though it is never what
   * raises the prompt.
   */
  it("lists a semester only the account has, once something else raised the question", () => {
    const local = multiPayload({ "26h": ["TDT4100"] }, "26h");
    const remote = multiPayload({ "25h": ["TMA4100"], "26h": [] }, "26h");
    const summary = describeCollision(local, remote);
    expect(summary?.semesters.map((s) => s.semesterId)).toEqual(["25h", "26h"]);
    expect(summary?.semesters[0]).toMatchObject({
      localCodes: [],
      remoteCodes: ["TMA4100"],
      missingFromLocal: ["TMA4100"],
    });
  });

  /** Chronological, like the planner's own semester picker — a plain string
   *  sort puts "26h" before the "26v" that precedes it. */
  it("orders semesters oldest first", () => {
    const local = multiPayload(
      { "26h": ["TDT4100"], "25h": ["TMA4100"], "26v": ["TMA4105"] },
      "26h",
    );
    const remote = multiPayload({}, "26h");
    expect(describeCollision(local, remote)?.semesters.map((s) => s.semesterId)).toEqual([
      "25h",
      "26v",
      "26h",
    ]);
  });

  it("asks even when lastSemester is unset, so plans[''] is empty", () => {
    const local = multiPayload({ "25h": ["TDT4100"] }, "");
    const remote = multiPayload({ "25h": [] }, "");
    expect(describeCollision(local, remote)).not.toBeNull();
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
    expect(describeCollision(withDrop, payload(["TDT4100"]))).toBeNull();

    expect(describeCollision(withDrop, payload([]))?.semesters).toEqual([
      {
        semesterId: "26h",
        localCodes: ["TDT4100"],
        remoteCodes: [],
        missingFromRemote: ["TDT4100"],
        missingFromLocal: [],
      },
    ]);
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

  /**
   * The revocation path made this reachable: a 401 on ANY request now calls
   * `writeSession(null)`, and a GET is typically in flight when the push next
   * to it gets one (the visibility trigger fires both). `fetchRemote` read
   * `session.encKeyRaw` after its own `await` — TypeScript keeps the narrowing
   * from the top of the function across an await, so it compiled, and at
   * runtime it threw a TypeError. From `void pullAndRefresh()` that is an
   * unhandled rejection rather than the total `{ ok: false, reason }` contract
   * every method here advertises.
   */
  it("answers rather than throwing when a concurrent 401 empties the session mid-GET", async () => {
    const storage = fakeStorage({ "np:plans": '{"26h":[]}' });
    let claimed = false;
    let releaseGet = (): void => {};
    const getGate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (!claimed && method === "POST") {
        claimed = true;
        return new Response(JSON.stringify({ version: 1 }), { status: 201 });
      }
      // The push: someone changed the PIN elsewhere, so this credential is gone.
      if (method === "PUT") {
        return new Response(JSON.stringify({ error: "unauthorised" }), { status: 401 });
      }
      // The GET, held open until the 401 above has dropped the session.
      await getGate;
      return new Response(JSON.stringify({ blob: "not-read", version: 1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const client = createSyncClient({ storage, fetch: fetchMock });
    await client.signup("martin", "482913", "Mac");

    const inFlight = client.fetchRemote();
    expect(await client.push()).toEqual({ ok: false, reason: "unauthorised" });
    expect(client.session()).toBeNull();
    releaseGet();

    await expect(inFlight).resolves.toEqual({ ok: false, reason: "no_session" });
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
    // The failed attempt still wrote a session — this device IS logged in, it
    // just has not pushed yet — so its device id is observable from here on.
    const idAfterFailure = deviceB.session()?.deviceId;
    expect(idAfterFailure).toBeTruthy();

    // The retry the panel's own "Prøv igjen" invites now works, instead of
    // answering `no_pending` forever.
    expect(await deviceB.resolveLogin("local")).toEqual({ ok: true });

    // …and it is the same device throughout. This used to be asserted as "one
    // registry row per device, not one per attempt", which no `resolveLogin`
    // could ever fail: `writeSession` rebuilds the list from
    // `p.remote.devices` on every attempt, so a fresh id per attempt still
    // produced exactly one row. `p.deviceId`'s real job is the identity
    // itself — the key `mergeDevice` matches on for every later push, and the
    // id a failed attempt already committed to storage.
    expect(deviceB.session()?.deviceId).toBe(idAfterFailure);
    const devices = deviceB.session()?.devices ?? [];
    expect(devices.filter((d) => d.label === "iPhone")).toHaveLength(1);
  }, 60_000);
});
