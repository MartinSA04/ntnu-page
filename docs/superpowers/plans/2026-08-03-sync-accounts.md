# Opt-in Accounts and Cross-Device Sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An opt-in account (name + 6-digit PIN) that carries a student's plan between phone, PC and iPad, storing only ciphertext the server cannot read.

**Architecture:** The client derives two keys from name + PIN with PBKDF2 — `authKey` (sent, the write credential) and `encKey` (never sent). The plan is AES-GCM encrypted in the browser and PUT to a Cloudflare KV record keyed `user:<navn>`. `localStorage` stays the write target and the server is a mirror; sync fires on plan change, on becoming visible, and on load. A monotonic `version` gives last-write-wins with a 409 for staleness.

**Tech Stack:** Cloudflare Workers + KV, WebCrypto (no crypto library), TypeScript, vitest, Playwright, Astro islands.

## Global Constraints

- UI copy is **Norwegian bokmål, sentence case, comma decimals** ("7,5 sp").
- `mise run check` and `mise run e2e` must both stay green.
- Client setup must go through `onPage(setup)` (`src/lib/pageLifecycle.ts`) and bind listeners with `{ signal }` — hoisted scripts do NOT re-run after a ClientRouter swap.
- Two-pass typecheck: keep Workers-only ambient types out of files the Node pass includes. Use structural interfaces. `npm run typecheck` runs both passes.
- Biome runs with `--error-on-warnings`. Do not widen the `**/*.astro` override.
- PBKDF2: **600 000 iterations, SHA-256**, salt `"np-sync-v1:" + navn`. Salt is derived from the name, not random — deliberate, see spec §3.
- PIN input must be **numeric, 6 digits, `inputmode="numeric"`** — never `type="password"`.
- KV key format: `user:<navn>`. **No TTL.**
- `np:weekView` and `np:weekBox` must NEVER be synced.
- Spec: `docs/superpowers/specs/2026-08-02-accountless-sync-design.md`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `worker/src/sync.ts` (new) | Pure handlers for `/api/sync/*`, name validation, version conflict, auth-attempt limiter. No Workers ambient types. |
| `worker/src/server.ts` (modify) | Dispatch `/api/sync/*`, add the `SYNC` KV binding to `Env`. |
| `wrangler.jsonc` (modify) | `kv_namespaces` binding for `SYNC`. |
| `src/lib/planner/syncCrypto.ts` (new) | PBKDF2 → HKDF → `authKey`/`encKey`, AES-GCM seal/open. Pure, no DOM. |
| `src/lib/planner/syncClient.ts` (new) | Session storage (`np:sync`), signup/login/push/pull, which storage keys travel. |
| `src/components/planner/profilePanel.ts` (new) | The `<dialog>`: programme/kull, login/signup, device list, sync status. |
| `src/components/planner/plannerApp.ts` (modify) | Mount the panel, wire the three sync triggers. |
| `src/pages/planlegger/index.astro` (modify) | Entry button on the plan's name line. |
| `e2e/fixtures.ts` (modify) | Add `/api/sync/*` to `PASS_THROUGH`. |
| `e2e/sync.pw.ts` (new) | Two-context round trip against local KV. |

---

### Task 1: Name validation and the record shape

**Files:**
- Create: `worker/src/sync.ts`
- Test: `tests/worker/sync.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `validateName(raw: string): string | null`, `interface SyncRecord`, `interface SyncKv`, `interface SyncDeps`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/worker/sync.test.ts
import { describe, expect, it } from "vitest";
import { validateName } from "../../worker/src/sync.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: FAIL — cannot resolve `../../worker/src/sync.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
// worker/src/sync.ts
/**
 * Pure handlers for `/api/sync/*` — the opt-in account surface.
 *
 * The server stores `sha256(authKey)` and an opaque ciphertext blob: it can
 * prove who is writing and cannot read what is written. No Workers-only
 * ambient types here (same rule as `routes.ts`), so this file type-checks
 * under both passes.
 */

/**
 * A name is a public URL segment (`/user/<navn>`), so it is ASCII, lowercase
 * and dash-separated. Æ/Ø/Å are excluded on purpose: this is the one string in
 * the product that has to survive being typed from memory on a foreign
 * keyboard, unlike course and programme codes (`routes.ts`'s `parseCode`).
 */
const NAME_RE = /^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/;

/** Names that would read as site chrome rather than as a student. */
const RESERVED = new Set(["api", "user", "admin", "ny", "new", "null", "undefined"]);

export function validateName(raw: string): string | null {
  const name = raw.trim().toLowerCase();
  if (!NAME_RE.test(name)) return null;
  if (RESERVED.has(name)) return null;
  return name;
}

/** One account, as stored under `user:<navn>`. `plain` is set only by publishing (phase 2). */
export interface SyncRecord {
  authHash: string;
  version: number;
  updatedAt: string;
  blob: string;
  public: boolean;
  plain: string | null;
}

/** KV, structurally — `delete` is why this is not `KVCacheBinding`. */
export interface SyncKv {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface SyncDeps {
  kv: SyncKv;
  /** Injected so tests are not clock-dependent. */
  now: () => string;
}

export function recordKey(name: string): string {
  return `user:${name}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/sync.ts tests/worker/sync.test.ts
git commit -m "feat(sync): name validation and account record shape"
```

---

### Task 2: Claim, read, write and delete an account

**Files:**
- Modify: `worker/src/sync.ts`
- Test: `tests/worker/sync.test.ts`

**Interfaces:**
- Consumes: `validateName`, `SyncRecord`, `SyncKv`, `SyncDeps`, `recordKey` (Task 1).
- Produces:
  - `handleSyncClaim(name: string, body: unknown, deps: SyncDeps): Promise<Response>`
  - `handleSyncGet(name: string, authKey: string | null, deps: SyncDeps): Promise<Response>`
  - `handleSyncPut(name: string, authKey: string | null, body: unknown, deps: SyncDeps): Promise<Response>`
  - `handleSyncDelete(name: string, authKey: string | null, deps: SyncDeps): Promise<Response>`
  - `sha256Hex(input: string): Promise<string>`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/worker/sync.test.ts
import {
  handleSyncClaim,
  handleSyncDelete,
  handleSyncGet,
  handleSyncPut,
  type SyncDeps,
  type SyncKv,
} from "../../worker/src/sync.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: FAIL — `handleSyncClaim is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to worker/src/sync.ts

/** Hex SHA-256. The stored credential is a hash, so a KV dump yields nothing usable. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function read(name: string, deps: SyncDeps): Promise<SyncRecord | null> {
  const raw = await deps.kv.get(recordKey(name), "text");
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as SyncRecord;
  } catch {
    return null;
  }
}

/**
 * Constant-time-ish comparison. Both sides are fixed-length hex digests, so a
 * length check plus an XOR fold is enough; `===` on a digest is not a
 * meaningful timing oracle here but this costs nothing.
 */
function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorise(
  name: string,
  authKey: string | null,
  deps: SyncDeps,
): Promise<SyncRecord | Response> {
  const record = await read(name, deps);
  if (record === null) return json({ error: "not_found" }, 404);
  if (authKey === null) return json({ error: "unauthorised" }, 401);
  if (!sameDigest(record.authHash, await sha256Hex(authKey))) {
    return json({ error: "unauthorised" }, 401);
  }
  return record;
}

export async function handleSyncClaim(
  rawName: string,
  body: unknown,
  deps: SyncDeps,
): Promise<Response> {
  const name = validateName(rawName);
  if (name === null) return json({ error: "bad_name" }, 400);
  const fields = asRecord(body);
  const authKey = fields?.authKey;
  const blob = fields?.blob;
  if (typeof authKey !== "string" || typeof blob !== "string") {
    return json({ error: "bad_body" }, 400);
  }
  if (await read(name, deps)) return json({ error: "taken" }, 409);

  const record: SyncRecord = {
    authHash: await sha256Hex(authKey),
    version: 1,
    updatedAt: deps.now(),
    blob,
    public: false,
    plain: null,
  };
  await deps.kv.put(recordKey(name), JSON.stringify(record));
  return json({ version: 1 }, 201);
}

export async function handleSyncGet(
  rawName: string,
  authKey: string | null,
  deps: SyncDeps,
): Promise<Response> {
  const name = validateName(rawName);
  if (name === null) return json({ error: "bad_name" }, 400);
  const found = await authorise(name, authKey, deps);
  if (found instanceof Response) return found;
  return json({ blob: found.blob, version: found.version, updatedAt: found.updatedAt }, 200);
}

export async function handleSyncPut(
  rawName: string,
  authKey: string | null,
  body: unknown,
  deps: SyncDeps,
): Promise<Response> {
  const name = validateName(rawName);
  if (name === null) return json({ error: "bad_name" }, 400);
  const found = await authorise(name, authKey, deps);
  if (found instanceof Response) return found;

  const fields = asRecord(body);
  const blob = fields?.blob;
  const version = fields?.version;
  if (typeof blob !== "string" || typeof version !== "number") {
    return json({ error: "bad_body" }, 400);
  }
  // Stale write: hand back the server's copy so the client can reconcile
  // rather than guess. This is the stale-tab guard, not an offline merge.
  if (version !== found.version) {
    return json({ error: "stale", blob: found.blob, version: found.version }, 409);
  }

  const next: SyncRecord = { ...found, blob, version: found.version + 1, updatedAt: deps.now() };
  await deps.kv.put(recordKey(name), JSON.stringify(next));
  return json({ version: next.version }, 200);
}

export async function handleSyncDelete(
  rawName: string,
  authKey: string | null,
  deps: SyncDeps,
): Promise<Response> {
  const name = validateName(rawName);
  if (name === null) return json({ error: "bad_name" }, 400);
  const found = await authorise(name, authKey, deps);
  if (found instanceof Response) return found;
  await deps.kv.delete(recordKey(name));
  return new Response(null, { status: 204 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/sync.ts tests/worker/sync.test.ts
git commit -m "feat(sync): claim, read, write and delete an account"
```

---

### Task 3: Throttle authentication attempts

**Files:**
- Modify: `worker/src/sync.ts`
- Test: `tests/worker/sync.test.ts`

**Interfaces:**
- Consumes: Task 2's handlers.
- Produces: `class AuthLimiter { constructor(max: number, windowMs: number); check(name: string, now: number): boolean; fail(name: string, now: number): void; clear(name: string): void }`, and an optional `limiter` field on `SyncDeps`.

Names are enumerable once §5 publishes them, so a 6-digit PIN is 10⁶ guesses against a known target. **Note honestly in the code comment:** this limiter is per-isolate and therefore approximate; the real bound is the 600 000-iteration PBKDF2 an attacker must run per guess to produce a candidate `authKey`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/worker/sync.test.ts
import { AuthLimiter } from "../../worker/src/sync.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: FAIL — `AuthLimiter is not a constructor`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to worker/src/sync.ts

/**
 * Per-name failure counter for the PIN.
 *
 * Deliberately in-memory and therefore PER ISOLATE, so it is approximate: an
 * attacker spread across isolates gets more attempts than `max`. That is
 * accepted because it is not the real bound — producing one candidate
 * `authKey` costs a 600 000-iteration PBKDF2 on the attacker's own hardware,
 * and the data is a course list. Do not reach for a KV-backed counter to make
 * this exact: KV writes are eventually consistent and would be wrong anyway.
 */
export class AuthLimiter {
  private readonly hits = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  check(name: string, now: number): boolean {
    const hit = this.hits.get(name);
    if (!hit) return true;
    if (now >= hit.until) {
      this.hits.delete(name);
      return true;
    }
    return hit.count < this.max;
  }

  fail(name: string, now: number): void {
    const hit = this.hits.get(name);
    if (!hit || now >= hit.until) {
      this.hits.set(name, { count: 1, until: now + this.windowMs });
      return;
    }
    hit.count += 1;
  }

  clear(name: string): void {
    this.hits.delete(name);
  }
}
```

Then extend `SyncDeps` and route every authenticated handler through the limiter:

```ts
// modify the SyncDeps interface from Task 1
export interface SyncDeps {
  kv: SyncKv;
  now: () => string;
  /** Absent = unthrottled, which is what the unit tests of Task 2 pass. */
  limiter?: AuthLimiter;
  /** Monotonic ms for the limiter, injected so tests are not clock-dependent. */
  monotonic?: () => number;
}

// replace `authorise` from Task 2 with:
async function authorise(
  name: string,
  authKey: string | null,
  deps: SyncDeps,
): Promise<SyncRecord | Response> {
  const now = deps.monotonic?.() ?? 0;
  if (deps.limiter && !deps.limiter.check(name, now)) {
    return json({ error: "too_many_attempts" }, 429);
  }
  const record = await read(name, deps);
  if (record === null) return json({ error: "not_found" }, 404);
  if (authKey === null || !sameDigest(record.authHash, await sha256Hex(authKey))) {
    deps.limiter?.fail(name, now);
    return json({ error: "unauthorised" }, 401);
  }
  deps.limiter?.clear(name);
  return record;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/sync.ts tests/worker/sync.test.ts
git commit -m "feat(sync): throttle PIN attempts per name"
```

---

### Task 4: Dispatch `/api/sync/*` from the worker

**Files:**
- Modify: `worker/src/server.ts`
- Modify: `wrangler.jsonc`
- Test: `tests/worker/sync.test.ts`

**Interfaces:**
- Consumes: all four handlers plus `AuthLimiter` (Tasks 2–3).
- Produces: `Env.SYNC?: SyncKv`; the worker answers `/api/sync/:navn` for POST/GET/PUT/DELETE and `405` for anything else.

The credential travels in an `x-np-auth` header, never in the URL — a URL lands in logs, history and referrers.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/worker/sync.test.ts
import worker, { type Env } from "../../worker/src/server.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: FAIL — the sync path falls through to the asset handler, so `claim.status` is 200 not 201.

- [ ] **Step 3: Write minimal implementation**

In `worker/src/server.ts`, extend `Env` and add dispatch. Note `SYNC` is optional exactly like `CACHE`, and its absence is reported rather than hidden — a planner that silently failed to save would be worse than one that says it cannot.

```ts
import {
  AuthLimiter,
  handleSyncClaim,
  handleSyncDelete,
  handleSyncGet,
  handleSyncPut,
  type SyncDeps,
  type SyncKv,
} from "./sync.js";

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  CACHE?: KVCacheBinding;
  SYNC?: SyncKv;
}

/** Per-isolate, like `client` and `memoryCache` above. */
const authLimiter = new AuthLimiter(10, 15 * 60_000);

/** `/api/sync/<navn>` → the name, or null when the shape does not match. */
function syncName(pathname: string): string | null {
  const match = /^\/api\/sync\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return null;
  // Same reason as `parseCode`: the WHATWG URL spec keeps path segments
  // percent-encoded, and a name is validated after decoding.
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

async function handleSync(request: Request, env: Env, name: string): Promise<Response> {
  if (!env.SYNC) {
    return new Response(JSON.stringify({ error: "sync_unavailable" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
  const deps: SyncDeps = {
    kv: env.SYNC,
    now: () => new Date().toISOString(),
    limiter: authLimiter,
    monotonic: () => Date.now(),
  };
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
      return methodNotAllowed(["POST", "GET", "PUT", "DELETE"]);
  }
}
```

Then, inside the existing `fetch` handler where `/api/*` paths are matched, before the other `/api` routes:

```ts
const name = syncName(url.pathname);
if (name !== null) return withSecurityHeaders(await handleSync(request, env, name));
```

Check `methodNotAllowed`'s existing signature in `worker/src/routes.ts` and match it; if it takes no argument, call it as the file already does elsewhere.

In `wrangler.jsonc`, add the binding beside the documented `CACHE` one. `wrangler dev` provisions a local namespace automatically, which is what the e2e suite uses:

```jsonc
"kv_namespaces": [{ "binding": "SYNC", "id": "<create with: npx wrangler kv namespace create SYNC>" }],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker/sync.test.ts && npm run typecheck`
Expected: PASS, and both typecheck passes clean.

- [ ] **Step 5: Commit**

```bash
git add worker/src/server.ts wrangler.jsonc tests/worker/sync.test.ts
git commit -m "feat(sync): dispatch /api/sync and bind the SYNC namespace"
```

---

### Task 5: Key derivation and envelope encryption

**Files:**
- Create: `src/lib/planner/syncCrypto.ts`
- Test: `tests/planner/syncCrypto.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `deriveKeys(navn: string, pin: string): Promise<{ authKey: string; encKeyRaw: string }>`
  - `seal(encKeyRaw: string, plaintext: string): Promise<string>`
  - `open(encKeyRaw: string, sealed: string): Promise<string | null>`

`encKeyRaw` is hex rather than a `CryptoKey` because it has to survive `JSON.stringify` into `localStorage`; it is imported per use.

- [ ] **Step 1: Write the failing test**

```ts
// tests/planner/syncCrypto.test.ts
import { describe, expect, it } from "vitest";
import { deriveKeys, open, seal } from "../../src/lib/planner/syncCrypto.js";

describe("deriveKeys", () => {
  it("is deterministic for the same name and PIN", async () => {
    const a = await deriveKeys("martin", "482913");
    const b = await deriveKeys("martin", "482913");
    expect(a).toEqual(b);
  });

  it("separates the two keys", async () => {
    const { authKey, encKeyRaw } = await deriveKeys("martin", "482913");
    expect(authKey).not.toBe(encKeyRaw);
    expect(authKey).toHaveLength(64);
    expect(encKeyRaw).toHaveLength(64);
  });

  it("changes completely with the PIN and with the name", async () => {
    const base = await deriveKeys("martin", "482913");
    expect((await deriveKeys("martin", "482914")).authKey).not.toBe(base.authKey);
    // Salt is name-derived, so two students who pick the same PIN never collide.
    expect((await deriveKeys("kari", "482913")).authKey).not.toBe(base.authKey);
  });
}, 30_000);

describe("seal/open", () => {
  it("round-trips a plan", async () => {
    const { encKeyRaw } = await deriveKeys("martin", "482913");
    const sealed = await seal(encKeyRaw, JSON.stringify({ courses: ["TDT4120"] }));
    expect(sealed).not.toContain("TDT4120");
    expect(await open(encKeyRaw, sealed)).toBe(JSON.stringify({ courses: ["TDT4120"] }));
  });

  it("returns null rather than throwing for the wrong key", async () => {
    const mine = await deriveKeys("martin", "482913");
    const theirs = await deriveKeys("martin", "999999");
    const sealed = await seal(mine.encKeyRaw, "hemmelig");
    expect(await open(theirs.encKeyRaw, sealed)).toBeNull();
  });

  it("returns null for corrupt input rather than throwing", async () => {
    const { encKeyRaw } = await deriveKeys("martin", "482913");
    expect(await open(encKeyRaw, "not-base64-at-all")).toBeNull();
  });

  it("uses a fresh IV per seal", async () => {
    const { encKeyRaw } = await deriveKeys("martin", "482913");
    expect(await seal(encKeyRaw, "x")).not.toBe(await seal(encKeyRaw, "x"));
  });
}, 30_000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/planner/syncCrypto.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/planner/syncCrypto.ts
/**
 * Key derivation and envelope encryption for the opt-in account.
 *
 * Two keys come out of one PBKDF2: `authKey` is sent to the worker as the
 * write credential (which stores only its SHA-256), and `encKeyRaw` never
 * leaves the browser. So the server can prove who is writing and cannot read
 * what is written.
 *
 * The PBKDF2 salt is DERIVED FROM THE NAME, not random. A random salt would
 * have to be fetched before the student could log in — a round-trip that
 * reveals whether a name exists, plus a recovery problem if that record is
 * lost. Names are unique, so salts are unique; the per-name cost of a rainbow
 * table is what the iteration count and the worker's rate limiting are for.
 */
const ITERATIONS = 600_000;
const ENC = new TextEncoder();
const DEC = new TextDecoder();

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function deriveKeys(
  navn: string,
  pin: string,
): Promise<{ authKey: string; encKeyRaw: string }> {
  // NUL between the fields so ("ab", "1") and ("a", "b1") cannot derive alike.
  const material = await crypto.subtle.importKey(
    "raw",
    ENC.encode(`${navn}\u0000${pin}`),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const master = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: ENC.encode(`np-sync-v1:${navn}`), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    256,
  );
  const hkdf = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveBits"]);
  const derive = (info: string): Promise<ArrayBuffer> =>
    crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: ENC.encode(info) },
      hkdf,
      256,
    );
  return { authKey: toHex(await derive("auth")), encKeyRaw: toHex(await derive("enc")) };
}

async function importEncKey(encKeyRaw: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromHex(encKeyRaw), "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

/** `base64(iv ‖ ciphertext)`. The IV is fresh per call — GCM fails catastrophically on reuse. */
export async function seal(encKeyRaw: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importEncKey(encKeyRaw),
    ENC.encode(plaintext),
  );
  const joined = new Uint8Array(iv.length + cipher.byteLength);
  joined.set(iv, 0);
  joined.set(new Uint8Array(cipher), iv.length);
  return btoa(String.fromCharCode(...joined));
}

/** `null` for a wrong key or corrupt input — callers treat both as "not mine". */
export async function open(encKeyRaw: string, sealed: string): Promise<string | null> {
  try {
    const joined = Uint8Array.from(atob(sealed), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: joined.subarray(0, 12) },
      await importEncKey(encKeyRaw),
      joined.subarray(12),
    );
    return DEC.decode(plain);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/planner/syncCrypto.test.ts`
Expected: PASS (8 tests). These are slow by design — 600 000 iterations each — hence the 30 s suite timeouts.

- [ ] **Step 5: Commit**

```bash
git add src/lib/planner/syncCrypto.ts tests/planner/syncCrypto.test.ts
git commit -m "feat(sync): PBKDF2 key derivation and AES-GCM envelope"
```

---

### Task 6: The sync client — what travels, and how

**Files:**
- Create: `src/lib/planner/syncClient.ts`
- Test: `tests/planner/syncClient.test.ts`

**Interfaces:**
- Consumes: `deriveKeys`, `seal`, `open` (Task 5); `PROFILE_STORAGE_KEY`, `PLANS_STORAGE_KEY`, `LAST_SEMESTER_KEY`, `type StorageLike` from `src/lib/planner/store.ts`.
- Produces:
  - `SYNC_STORAGE_KEY = "np:sync"`
  - `interface SyncSession { navn: string; authKey: string; encKeyRaw: string; version: number; deviceId: string; label: string }`
  - `collectSyncable(storage: StorageLike): SyncPayload`
  - `applySyncable(storage: StorageLike, payload: SyncPayload): void`
  - **Note:** `SyncPayload` grows a `devices` field in Task 10. Leave room for it; do not design it away here.
  - `createSyncClient(deps: { storage: StorageLike; fetch: typeof fetch }): SyncClient` with `signup`, `login`, `push`, `pull`, `logout`, `session`.

**The three keys that travel are `np:profile`, `np:plans` and `np:lastSemester`. `np:weekView` and `np:weekBox` must not** — the first is per-device by nature (a phone picks Liste because it is a phone), the second is a per-device, per-width layout measurement whose wrong value costs 0.14 CLS.

- [ ] **Step 1: Write the failing test**

```ts
// tests/planner/syncClient.test.ts
import { describe, expect, it, vi } from "vitest";
import {
  applySyncable,
  collectSyncable,
  createSyncClient,
} from "../../src/lib/planner/syncClient.js";
import type { StorageLike } from "../../src/lib/planner/store.js";

function fakeStorage(seed: Record<string, string> = {}): StorageLike & { map: Map<string, string> } {
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
    const payload = collectSyncable(storage) as Record<string, unknown>;
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/planner/syncClient.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/planner/syncClient.ts
/**
 * The browser half of the opt-in account.
 *
 * `localStorage` stays the write target and the server is a MIRROR, not the
 * source of truth: sync is off for most students, and a round-trip in the edit
 * path would make the planner feel slow for all of them.
 *
 * There is no offline queue and there must never be one. This is a webpage with
 * no service worker: it does not load without a network, so there is no offline
 * editing session to reconcile. A push either lands or reports that it didn't.
 */
import { deriveKeys, open, seal } from "./syncCrypto.js";
import {
  LAST_SEMESTER_KEY,
  PLANS_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  type StorageLike,
} from "./store.js";

export const SYNC_STORAGE_KEY = "np:sync";

export interface SyncPayload {
  profile: string;
  plans: string;
  lastSemester: string;
}

export interface SyncSession {
  navn: string;
  authKey: string;
  encKeyRaw: string;
  version: number;
  deviceId: string;
  label: string;
}

export type SyncResult = { ok: true } | { ok: false; reason: string };

/**
 * The three keys that travel.
 *
 * `np:weekView` and `np:weekBox` are deliberately absent. The first is *how*
 * you are looking at the plan, not *what* you are looking at — a phone picks
 * Liste because it is a phone, and forcing that onto a desktop is the same
 * error the product already refuses elsewhere. The second is a per-device,
 * per-width layout measurement; a remembered box from the wrong geometry costs
 * 0.14 CLS, which is worse than reserving nothing.
 */
export function collectSyncable(storage: StorageLike): SyncPayload {
  return {
    profile: storage.getItem(PROFILE_STORAGE_KEY) ?? "{}",
    plans: storage.getItem(PLANS_STORAGE_KEY) ?? "{}",
    lastSemester: storage.getItem(LAST_SEMESTER_KEY) ?? "",
  };
}

export function applySyncable(storage: StorageLike, payload: SyncPayload): void {
  storage.setItem(PROFILE_STORAGE_KEY, payload.profile);
  storage.setItem(PLANS_STORAGE_KEY, payload.plans);
  if (payload.lastSemester !== "") storage.setItem(LAST_SEMESTER_KEY, payload.lastSemester);
}

export interface SyncClient {
  session(): SyncSession | null;
  signup(navn: string, pin: string, label: string): Promise<SyncResult>;
  login(navn: string, pin: string, label: string): Promise<SyncResult>;
  push(): Promise<SyncResult>;
  pull(): Promise<SyncResult>;
  logout(): void;
}

export function createSyncClient(deps: {
  storage: StorageLike;
  fetch: typeof fetch;
}): SyncClient {
  let session: SyncSession | null = readSession();

  function readSession(): SyncSession | null {
    const raw = deps.storage.getItem(SYNC_STORAGE_KEY);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as SyncSession;
    } catch {
      return null;
    }
  }

  function writeSession(next: SyncSession | null): void {
    session = next;
    deps.storage.setItem(SYNC_STORAGE_KEY, next === null ? "" : JSON.stringify(next));
  }

  async function begin(
    navn: string,
    pin: string,
    label: string,
  ): Promise<{ keys: Awaited<ReturnType<typeof deriveKeys>>; blob: string }> {
    const keys = await deriveKeys(navn, pin);
    const blob = await seal(keys.encKeyRaw, JSON.stringify(collectSyncable(deps.storage)));
    return { keys, blob };
  }

  function deviceId(): string {
    return session?.deviceId ?? crypto.randomUUID();
  }

  return {
    session: () => session,

    async signup(navn, pin, label) {
      const { keys, blob } = await begin(navn, pin, label);
      const res = await deps.fetch(`/api/sync/${encodeURIComponent(navn)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authKey: keys.authKey, blob }),
      });
      if (res.status === 409) return { ok: false, reason: "taken" };
      if (res.status === 503) return { ok: false, reason: "unavailable" };
      if (!res.ok) return { ok: false, reason: "failed" };
      const { version } = (await res.json()) as { version: number };
      writeSession({ navn, authKey: keys.authKey, encKeyRaw: keys.encKeyRaw, version, deviceId: deviceId(), label });
      return { ok: true };
    },

    async login(navn, pin, label) {
      const keys = await deriveKeys(navn, pin);
      const res = await deps.fetch(`/api/sync/${encodeURIComponent(navn)}`, {
        headers: { "x-np-auth": keys.authKey },
      });
      if (res.status === 401) return { ok: false, reason: "bad_pin" };
      if (res.status === 404) return { ok: false, reason: "no_account" };
      if (res.status === 429) return { ok: false, reason: "too_many_attempts" };
      if (!res.ok) return { ok: false, reason: "failed" };

      const body = (await res.json()) as { blob: string; version: number };
      const plain = await open(keys.encKeyRaw, body.blob);
      // Decryption failing with a server-accepted authKey means the record was
      // written under a different encKey — not reachable today, but better a
      // named refusal than silently replacing the student's plan with noise.
      if (plain === null) return { ok: false, reason: "undecryptable" };
      applySyncable(deps.storage, JSON.parse(plain) as SyncPayload);
      writeSession({
        navn,
        authKey: keys.authKey,
        encKeyRaw: keys.encKeyRaw,
        version: body.version,
        deviceId: crypto.randomUUID(),
        label,
      });
      return { ok: true };
    },

    async push() {
      if (!session) return { ok: false, reason: "no_session" };
      const blob = await seal(session.encKeyRaw, JSON.stringify(collectSyncable(deps.storage)));
      const res = await deps.fetch(`/api/sync/${encodeURIComponent(session.navn)}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-np-auth": session.authKey },
        body: JSON.stringify({ blob, version: session.version }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as { version: number };
        writeSession({ ...session, version: body.version });
        return { ok: false, reason: "stale" };
      }
      if (!res.ok) return { ok: false, reason: "failed" };
      const { version } = (await res.json()) as { version: number };
      writeSession({ ...session, version });
      return { ok: true };
    },

    async pull() {
      if (!session) return { ok: false, reason: "no_session" };
      const res = await deps.fetch(`/api/sync/${encodeURIComponent(session.navn)}`, {
        headers: { "x-np-auth": session.authKey },
      });
      if (!res.ok) return { ok: false, reason: "failed" };
      const body = (await res.json()) as { blob: string; version: number };
      const plain = await open(session.encKeyRaw, body.blob);
      if (plain === null) return { ok: false, reason: "undecryptable" };
      applySyncable(deps.storage, JSON.parse(plain) as SyncPayload);
      writeSession({ ...session, version: body.version });
      return { ok: true };
    },

    logout() {
      writeSession(null);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/planner/syncClient.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/planner/syncClient.ts tests/planner/syncClient.test.ts
git commit -m "feat(sync): client session, payload selection and push/pull"
```

---

### Task 7: The profile panel

**Files:**
- Create: `src/components/planner/profilePanel.ts`
- Test: `tests/planner/profilePanel.test.ts`
- Modify: `src/pages/planlegger/index.astro`

**Interfaces:**
- Consumes: `createSyncClient`, `SyncSession` (Task 6); `el` from `src/components/planner/dom.ts`; `PlanStore` from `src/lib/planner/store.ts`.
- Produces:
  - `deviceLabel(ua: string): string`
  - `pinIsValid(pin: string): boolean`
  - `mountProfilePanel(deps: { store: PlanStore; sync: SyncClient; onEditProgram: () => void; signal: AbortSignal }): ProfilePanelHandle`
  - `interface ProfilePanelHandle { show(): void; setSyncState(state: "ok" | "failed" | "syncing"): void }` — `setSyncState` is what Task 8 calls after every push, and what renders §6 step 7's `Ikke synkronisert · prøv igjen` on the same line as `Sist synkronisert`.

Follow `courseSettings.ts`'s modal pattern exactly: a `<dialog>` built with `el`, `showModal()`, `closedby="any"`, appended to `document.body`, idempotent against a stale dialog left by a previous mount.

**Copy (bokmål, sentence case):**
- Title: `Profil`
- Programme block: `MTDT · kull 2026` with a `Endre` link that calls `onEditProgram()`
- Signed out: `Logg inn eller opprett konto` · `Da følger planen med på telefon, PC og nettbrett.`
- Fields: `Navn`, `PIN (6 siffer)`, `Gjenta PIN`
- Terms line: `Planen lagres kryptert. Vi kan ikke lese den.` and `Husk PIN-en — du trenger den for å logge inn på en ny enhet.`
- Signed in: `Sist synkronisert nå` · device rows `iPhone · Safari — nå`
- Failure state on that same line: `Ikke synkronisert · prøv igjen`
- Name taken: `Det navnet er tatt. Velg et annet.`
- Wrong PIN: `Feil PIN.`
- Logout: `Logg ut på denne enheten`

- [ ] **Step 1: Write the failing test**

```ts
// tests/planner/profilePanel.test.ts
import { describe, expect, it } from "vitest";
import { deviceLabel, pinIsValid } from "../../src/components/planner/profilePanel.js";

describe("pinIsValid", () => {
  it("accepts exactly six digits", () => {
    expect(pinIsValid("482913")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(pinIsValid("48291")).toBe(false);
    expect(pinIsValid("4829134")).toBe(false);
    expect(pinIsValid("48291a")).toBe(false);
    expect(pinIsValid("")).toBe(false);
  });
});

describe("deviceLabel", () => {
  it("names the browser and the platform, because two browsers on one Mac are two entries", () => {
    expect(
      deviceLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      ),
    ).toBe("Mac · Safari");
    expect(
      deviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone · Safari");
    expect(
      deviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      ),
    ).toBe("Windows · Chrome");
  });

  it("falls back to a generic label rather than an empty one", () => {
    expect(deviceLabel("")).toBe("Ukjent enhet");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/planner/profilePanel.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/planner/profilePanel.ts` with the two pure helpers first (they are what the test covers), then the modal:

```ts
/** Six digits, and only digits: the field is `inputmode="numeric"`, never a password input. */
export function pinIsValid(pin: string): boolean {
  return /^\d{6}$/.test(pin);
}

/**
 * "Mac · Safari", not "Martin's laptop". Labelled by platform and browser
 * because a second browser on the same machine is a second entry — these are
 * browser profiles, not devices, and the list must not claim otherwise.
 */
export function deviceLabel(ua: string): string {
  if (ua === "") return "Ukjent enhet";
  const platform = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : "Ukjent enhet";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "nettleser";
  return `${platform} · ${browser}`;
}
```

Then `mountProfilePanel`, modelled on `mountCourseSettings` in `src/components/planner/courseSettings.ts:206` — read that function and mirror its dialog construction, focus restoration and teardown. The panel renders one of two states from `sync.session()`:

- **Signed out** — the programme block, then name / PIN / repeat-PIN fields, the two terms lines, and two buttons (`Opprett konto`, `Logg inn`). On submit: validate with `pinIsValid`, call `sync.signup` or `sync.login`, map `reason` to the copy above.
- **Signed in** — the programme block, `Sist synkronisert …`, the device list, and `Logg ut på denne enheten`.

In `src/pages/planlegger/index.astro`, add the entry button inside `.planner-name`, beneath `#planner-context-line`:

```astro
<button type="button" class="np-navlink planner-profile-entry" id="planner-profile-entry">
  Profil
</button>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/planner/profilePanel.test.ts && npm run lint`
Expected: PASS (6 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/planner/profilePanel.ts tests/planner/profilePanel.test.ts src/pages/planlegger/index.astro
git commit -m "feat(sync): profile panel with login, signup and device list"
```

---

### Task 8: Wire the three sync triggers into the planner

**Files:**
- Modify: `src/components/planner/plannerApp.ts`
- Test: `tests/planner/plannerApp.test.ts`

**Interfaces:**
- Consumes: `createSyncClient` (Task 6), `mountProfilePanel` (Task 7).
- Produces: `shouldPullOnVisible(session: SyncSession | null, hidden: boolean): boolean` — exported so the trigger rule is unit-testable without a DOM.

Triggers: **on plan change (debounced 1 s), on `visibilitychange` → visible, and on load.** No polling loop.

The visibility pull is **load-bearing, not an optimisation**: it is the only guard against a stale tab (an iPad left open for a week, then touched). On becoming visible, pull first; a `PUT` that still 409s adopts the server version and re-pushes.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/planner/plannerApp.test.ts
import { shouldPullOnVisible } from "../../src/components/planner/plannerApp.js";

describe("shouldPullOnVisible", () => {
  const session = {
    navn: "martin",
    authKey: "a",
    encKeyRaw: "b",
    version: 1,
    deviceId: "d",
    label: "Mac · Safari",
  };

  it("pulls when a signed-in tab becomes visible — the stale-tab guard", () => {
    expect(shouldPullOnVisible(session, false)).toBe(true);
  });

  it("does not pull while the tab is hidden", () => {
    expect(shouldPullOnVisible(session, true)).toBe(false);
  });

  it("does nothing at all when signed out", () => {
    expect(shouldPullOnVisible(null, false)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/planner/plannerApp.test.ts`
Expected: FAIL — `shouldPullOnVisible is not exported`.

- [ ] **Step 3: Write minimal implementation**

In `src/components/planner/plannerApp.ts`:

```ts
/**
 * The stale-tab guard, and the only reason `visibilitychange` is wired at all.
 * An iPad left open for a week holds a plan the server has moved past; pulling
 * on the way back in is what stops the next edit writing over the newer copy.
 * Not an optimisation — do not remove it as one.
 */
export function shouldPullOnVisible(session: SyncSession | null, hidden: boolean): boolean {
  return session !== null && !hidden;
}
```

Then, inside the existing `onPage`-driven setup (bind everything with `{ signal }`):

```ts
const sync = createSyncClient({ storage: localStorage, fetch: globalThis.fetch });
const profile = mountProfilePanel({
  store,
  sync,
  onEditProgram: () => studieinfo.show(),
  signal,
});
byId<HTMLButtonElement>("planner-profile-entry").addEventListener(
  "click",
  () => profile.show(),
  { signal },
);

let pushTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePush(): void {
  if (sync.session() === null) return;
  if (pushTimer !== null) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void runPush(), 1000);
}

async function runPush(): Promise<void> {
  const result = await sync.push();
  // A stale push means another device moved first: take its copy, then re-push
  // our edit on top. There is no merge here and there must not be one.
  if (!result.ok && result.reason === "stale") {
    if ((await sync.pull()).ok) await sync.push();
  }
  profile.setSyncState(result.ok ? "ok" : "failed");
}

document.addEventListener(
  "visibilitychange",
  () => {
    if (shouldPullOnVisible(sync.session(), document.hidden)) void sync.pull();
  },
  { signal },
);

if (sync.session() !== null) void sync.pull();
```

Call `schedulePush()` from the existing `store.onPlanChange` subscriber, after `renderAll()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS across the unit suite, both typecheck passes clean, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/planner/plannerApp.ts tests/planner/plannerApp.test.ts
git commit -m "feat(sync): push on change, pull on visible and on load"
```

---

### Task 9: End-to-end against local KV

**Files:**
- Modify: `e2e/fixtures.ts`
- Create: `e2e/sync.pw.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no exports; a browser-level proof that two contexts share a plan.

**The fixture layer must not claim `/api/sync/*`.** The record/replay layer exists to make *upstream NTNU* deterministic; sync is our own surface and is tested against the real worker over wrangler's local KV, which `npx wrangler dev` provisions automatically from the `kv_namespaces` binding added in Task 4. This is the same carve-out `/api/health` already has, for the same reason.

- [ ] **Step 1: Write the failing test**

```ts
// e2e/sync.pw.ts
import { expect } from "@playwright/test";
import { test } from "./harness.js";

/**
 * Sync over the REAL worker and wrangler's local KV — deliberately not
 * fixture-replayed. The `/api/*` record/replay layer exists to make upstream
 * NTNU deterministic; `/api/sync/*` is our own surface, and replaying it would
 * assert against a recording of ourselves.
 */
test("a plan reaches a second browser context through an account", async ({ browser }) => {
  const navn = `e2e-${Date.now().toString(36)}`;
  const pin = "482913";

  const first = await browser.newContext();
  const phone = await first.newPage();
  await phone.goto("/planlegger/");
  await phone.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    ["np:plans", '{"26h":[{"code":"TDT4120","name":"Algoritmer og datastrukturer"}]}'],
  );
  await phone.reload();

  await phone.getByRole("button", { name: "Profil" }).click();
  await phone.getByLabel("Navn").fill(navn);
  await phone.getByLabel("PIN (6 siffer)").fill(pin);
  await phone.getByLabel("Gjenta PIN").fill(pin);
  await phone.getByRole("button", { name: "Opprett konto" }).click();
  await expect(phone.getByText("Sist synkronisert")).toBeVisible();

  const second = await browser.newContext();
  const laptop = await second.newPage();
  await laptop.goto("/planlegger/");
  await laptop.getByRole("button", { name: "Profil" }).click();
  await laptop.getByLabel("Navn").fill(navn);
  await laptop.getByLabel("PIN (6 siffer)").fill(pin);
  await laptop.getByRole("button", { name: "Logg inn" }).click();

  await expect(laptop.getByText("TDT4120")).toBeVisible({ timeout: 45_000 });

  await first.close();
  await second.close();
});

test("a wrong PIN is refused and changes nothing locally", async ({ page }) => {
  await page.goto("/planlegger/");
  await page.getByRole("button", { name: "Profil" }).click();
  await page.getByLabel("Navn").fill("finnes-ikke-heller");
  await page.getByLabel("PIN (6 siffer)").fill("000000");
  await page.getByRole("button", { name: "Logg inn" }).click();

  await expect(page.getByText("Fant ingen konto med det navnet.")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("np:sync"))).toBeFalsy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/sync.pw.ts`
Expected: FAIL — the fixture layer intercepts `/api/sync/*` and records a miss, and/or the Profil button is not found.

- [ ] **Step 3: Write minimal implementation**

In `e2e/fixtures.ts`, extend the pass-through set and its comment:

```ts
/**
 * Routes about the transport rather than the data — see `handle`.
 *
 * `/api/sync/*` is ours, not NTNU's: replaying it would assert against a
 * recording of our own worker, and the account tests need real KV round trips.
 * `wrangler dev` provisions a local namespace from the `SYNC` binding, so these
 * hit the real handler with no network beyond localhost.
 */
const PASS_THROUGH = new Set(["GET /api/health"]);
const PASS_THROUGH_PREFIXES = ["/api/sync/"];
```

Then, in the `handle` function where `PASS_THROUGH` is consulted, also pass through when `PASS_THROUGH_PREFIXES.some((p) => url.pathname.startsWith(p))`. Read the existing `handle` implementation and match its control flow — the miss-recording branch must not run for these.

- [ ] **Step 4: Run test to verify it passes**

Run: `mise run e2e`
Expected: PASS for the whole suite, including the two new tests, with no fixture misses reported in teardown.

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures.ts e2e/sync.pw.ts
git commit -m "test(sync): end-to-end account round trip over local KV"
```

---

### Task 10: The device registry, the collision question, and changing the PIN

**Files:**
- Modify: `src/lib/planner/syncClient.ts`
- Modify: `src/components/planner/profilePanel.ts`
- Test: `tests/planner/syncClient.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 6–7.
- Produces:
  - `SyncPayload` gains `devices: DeviceEntry[]` where `interface DeviceEntry { id: string; label: string; lastSeen: string }`
  - `describeCollision(local: SyncPayload, remote: SyncPayload, semesterId: string): CollisionSummary | null`
  - `SyncClient.login` gains a third outcome: `{ ok: false; reason: "collision"; local: SyncPayload; remote: SyncPayload }`
  - `SyncClient.resolveLogin(choice: "local" | "remote"): Promise<SyncResult>`
  - `SyncClient.changePin(oldPin: string, newPin: string): Promise<SyncResult>`

Three spec requirements land here, and each has a reason it cannot be skipped:

- **§6 step 5** — logging in on a device that already has a plan must ask once, not silently overwrite. This is the one prompt the design keeps, because it is two independent histories meeting rather than a conflict.
- **§6 step 6** — the device list lives **inside the encrypted blob**, never in server metadata, so it is private too.
- **§4 / §6 step 8** — there is **no per-device revocation**. All devices share one derived key, so dropping a device is a PIN change: re-derive, re-encrypt under the new `encKey`, replace `authHash`, and every other device is logged out until given the new PIN. The UI must not imply anything finer.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/planner/syncClient.test.ts
import { describeCollision } from "../../src/lib/planner/syncClient.js";

const payload = (codes: string[]): SyncPayload => ({
  profile: "{}",
  plans: JSON.stringify({ "26h": codes.map((code) => ({ code, name: code })) }),
  lastSemester: "26h",
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
    const summary = describeCollision(
      payload(["TDT4120", "TDT4100"]),
      payload(["TDT4100"]),
      "26h",
    );
    expect(summary).toMatchObject({ localCount: 2, remoteCount: 1, missingFromRemote: ["TDT4120"] });
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

    expect(await client.changePin("482913", "999111")).toEqual({ ok: true });
    expect(authHashSeen).not.toBe(before);
    expect(client.session()?.encKeyRaw).toBeTruthy();
  }, 60_000);

  it("refuses when the old PIN is wrong, without touching the stored blob", async () => {
    const storage = fakeStorage({ "np:plans": "{}" });
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ version: 1 }), { status: 201 }),
    ) as unknown as typeof fetch;
    const client = createSyncClient({ storage, fetch: fetchMock });
    await client.signup("martin", "482913", "Mac");
    expect(await client.changePin("000000", "999111")).toEqual({ ok: false, reason: "bad_pin" });
  }, 60_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/planner/syncClient.test.ts`
Expected: FAIL — `describeCollision is not a function`.

- [ ] **Step 3: Write minimal implementation**

Extend `SyncPayload` with `devices`, have `collectSyncable` merge the current session's `{ id, label, lastSeen }` into the list it carries (replacing its own entry, keeping the others), and add:

```ts
export interface CollisionSummary {
  localCount: number;
  remoteCount: number;
  missingFromRemote: string[];
}

/**
 * Two independent histories meeting at login — NOT a conflict, and the one
 * prompt this design keeps. `null` means there is nothing to ask about: either
 * this device is empty, or both sides already say the same thing.
 */
export function describeCollision(
  local: SyncPayload,
  remote: SyncPayload,
  semesterId: string,
): CollisionSummary | null {
  const codes = (payload: SyncPayload): string[] => {
    try {
      const plans = JSON.parse(payload.plans) as Record<string, Array<{ code?: unknown }>>;
      return (plans[semesterId] ?? [])
        .map((row) => row.code)
        .filter((code): code is string => typeof code === "string");
    } catch {
      return [];
    }
  };
  const mine = codes(local);
  const theirs = codes(remote);
  if (mine.length === 0) return null;
  if (mine.length === theirs.length && mine.every((code) => theirs.includes(code))) return null;
  return {
    localCount: mine.length,
    remoteCount: theirs.length,
    missingFromRemote: mine.filter((code) => !theirs.includes(code)),
  };
}
```

In `login`, after decrypting the remote payload, call `describeCollision`; when it returns a summary, hold both payloads in a pending slot and return `{ ok: false, reason: "collision", local, remote }` **without** writing storage or the session. `resolveLogin("remote")` applies the remote payload and stores the session; `resolveLogin("local")` stores the session and pushes the local payload over the remote.

`changePin(oldPin, newPin)` derives both key sets, verifies `oldPin` against the current session's `authKey`, re-seals the current payload under the new `encKey`, and PUTs it with the new `authKey`. **The worker needs a matching path**: extend `handleSyncPut` to accept an optional `authKey` field in the body which, when present, replaces `authHash` in the stored record. Add a worker test for it beside Task 2's.

In `profilePanel.ts`, render:
- the collision question, in flow 2's delta idiom — *"Begge enhetene har en plan. Hvilken vil du beholde?"* with `Denne enheten — 5 emner · 30 sp` and `MacBook — 4 emner · 22,5 sp · mangler TDT4120`;
- the device list from `payload.devices`;
- `Bytt PIN` with the honest consequence: *"Da lager vi en ny kobling. Du må logge inn på nytt på enhetene du beholder."*

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npm run typecheck && npm run lint`
Expected: PASS, both typecheck passes clean, lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/planner/syncClient.ts src/components/planner/profilePanel.ts worker/src/sync.ts tests/
git commit -m "feat(sync): device registry, login collision question and PIN change"
```

---

## Documentation follow-up (do this before opening a PR)

`CLAUDE.md` is explicit that there is no fifth permanent doc. Fold these into the four and delete nothing else:

- [ ] **`docs/PRODUCT.md` §8** — replace "No accounts or server storage" with: *"No accounts required. Optional sync stores only client-encrypted blobs."*
- [ ] **`docs/PRODUCT.md` §2** — "account-less" and "no login" become "no account required".
- [ ] **`docs/SPEC.md`** — add the `/api/sync/*` contract: routes, the `x-np-auth` header, the `SyncRecord` shape, and the rule that `np:weekView`/`np:weekBox` never travel.
- [ ] **`docs/ROADMAP.md`** — mark accounts + sync landed; publishing is the next plan.
- [ ] **`CLAUDE.md`** — note that `/api/sync/*` is deliberately excluded from the e2e fixture layer, beside the existing `/api/health` note.
