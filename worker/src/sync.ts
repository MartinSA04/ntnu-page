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
