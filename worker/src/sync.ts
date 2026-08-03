/**
 * Pure handlers for `/api/sync/*` — the opt-in account surface.
 *
 * The server stores `sha256(authKey)` and an opaque ciphertext blob: it can
 * prove who is writing and cannot read what is written. No Workers-only
 * ambient types here (same rule as `routes.ts`), so this file type-checks
 * under both passes.
 */

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
  /** Absent = unthrottled, which is what the unit tests of Task 2 pass. */
  limiter?: AuthLimiter;
  /** Monotonic ms for the limiter, injected so tests are not clock-dependent. */
  monotonic?: () => number;
}

export function recordKey(name: string): string {
  return `user:${name}`;
}

/** Hex SHA-256. The stored credential is a hash, so a KV dump yields nothing usable. */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The largest `blob` this surface will store, ~512 KB.
 *
 * Neither claim nor PUT bounded it before, and `handleSyncClaim` needs no
 * credential — so `POST /api/sync/<random>` with a multi-megabyte body, in a
 * loop, was unbounded anonymous KV writes. The bound is generous by three
 * orders of magnitude against real content: a 30-course plan plus a device
 * registry seals to a few KB. Anything near this ceiling is not a semester
 * plan.
 */
const MAX_BLOB_CHARS = 512 * 1024;

/**
 * Every response from this module is per-user private data behind a
 * credential, so `no-store` — the one thing `routes.ts`'s own `json()` gets
 * right that this local copy did not. `Vary` is set by `handleSyncGet` on top
 * of this: the body is a function of `x-np-auth`, and a shared cache that did
 * not know that could hand one student's blob to the next request.
 */
function json(body: unknown, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extra,
    },
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

/**
 * "There is no KV binding, so this surface cannot save anything" — 503, in the
 * same envelope as every other answer from this module.
 *
 * It lives here rather than in `server.ts`, which built its own `Response` by
 * hand and was the one sync answer without `Cache-Control: no-store`. Nothing
 * private leaks through a cached 503, but a shared cache holding one is worse
 * than pointless: it keeps answering "unavailable" after the binding is back,
 * and the client maps that to `unavailable`, which the panel words as "prøv
 * igjen senere". One `json()` for the whole surface means the next header this
 * module needs cannot be added to eight responses and missed on the ninth.
 */
export function syncUnavailable(): Response {
  return json({ error: "sync_unavailable" }, 503);
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
  // Before the KV read, let alone the write: an oversized claim must cost
  // nothing but the parse.
  if (blob.length > MAX_BLOB_CHARS) return json({ error: "blob_too_large" }, 413);
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
  return json({ blob: found.blob, version: found.version, updatedAt: found.updatedAt }, 200, {
    Vary: "x-np-auth",
  });
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
  // Optional: a PIN change re-credentialing this record. `authKey` here is
  // the NEW credential to swap in, not the one that just authorised this
  // request (that one travelled in the header, as always) — the two are
  // deliberately different fields so a PIN change is one PUT rather than a
  // separate route.
  const newAuthKey = fields?.authKey;
  if (typeof blob !== "string" || typeof version !== "number") {
    return json({ error: "bad_body" }, 400);
  }
  if (newAuthKey !== undefined && typeof newAuthKey !== "string") {
    return json({ error: "bad_body" }, 400);
  }
  if (blob.length > MAX_BLOB_CHARS) return json({ error: "blob_too_large" }, 413);
  // Stale write: hand back the server's copy so the client can reconcile
  // rather than guess. This is the stale-tab guard, not an offline merge.
  // Checked BEFORE any credential swap: a stale PUT writes nothing at all,
  // so a PIN change that loses this race leaves `authHash` untouched and the
  // caller's OLD credential still works — the atomicity `syncClient.ts`'s
  // `changePin` relies on.
  if (version !== found.version) {
    return json({ error: "stale", blob: found.blob, version: found.version }, 409);
  }

  const next: SyncRecord = {
    ...found,
    blob,
    version: found.version + 1,
    updatedAt: deps.now(),
    ...(newAuthKey !== undefined ? { authHash: await sha256Hex(newAuthKey) } : {}),
  };
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
