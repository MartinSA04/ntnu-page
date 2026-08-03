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
