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

import {
  LAST_SEMESTER_KEY,
  PLANS_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  type StorageLike,
} from "./store.js";
import { deriveKeys, open, seal } from "./syncCrypto.js";

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

/**
 * A 64-hex-char check on `encKeyRaw`, applied whenever a session comes back
 * out of storage.
 *
 * `syncCrypto.ts`'s `fromHex` does not validate its input: an odd-length hex
 * string silently truncates and a non-hex character coerces to 0 via `NaN`,
 * rather than either one throwing. That was harmless while `encKeyRaw` stayed
 * inside one call stack, but this module round-trips it through
 * `JSON.stringify`/`localStorage`/`JSON.parse` — a boundary a bit-flipped
 * byte, a truncated write (quota, a killed tab mid-write) or a hand-edited
 * value can all cross. A corrupted key does not throw anywhere: `open()`
 * degrades it to a normal wrong-key `null`, which reads as "not mine" instead
 * of "my session is broken" and would otherwise let a garbled session sit in
 * storage forever, failing every pull with no diagnosable cause. Rejecting it
 * on read means a corrupt session is discarded once, back to "logged out",
 * rather than wedged.
 */
const HEX_64 = /^[0-9a-f]{64}$/i;

function isValidSession(value: unknown): value is SyncSession {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.navn === "string" &&
    typeof s.authKey === "string" &&
    typeof s.encKeyRaw === "string" &&
    HEX_64.test(s.encKeyRaw) &&
    typeof s.version === "number" &&
    typeof s.deviceId === "string" &&
    typeof s.label === "string"
  );
}

export interface SyncClient {
  session(): SyncSession | null;
  signup(navn: string, pin: string, label: string): Promise<SyncResult>;
  login(navn: string, pin: string, label: string): Promise<SyncResult>;
  push(): Promise<SyncResult>;
  pull(): Promise<SyncResult>;
  logout(): void;
}

export function createSyncClient(deps: { storage: StorageLike; fetch: typeof fetch }): SyncClient {
  let session: SyncSession | null = readSession();

  function readSession(): SyncSession | null {
    const raw = deps.storage.getItem(SYNC_STORAGE_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isValidSession(parsed) ? parsed : null;
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
      const { keys, blob } = await begin(navn, pin);
      const res = await deps.fetch(`/api/sync/${encodeURIComponent(navn)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authKey: keys.authKey, blob }),
      });
      if (res.status === 409) return { ok: false, reason: "taken" };
      if (res.status === 503) return { ok: false, reason: "unavailable" };
      if (!res.ok) return { ok: false, reason: "failed" };
      const { version } = (await res.json()) as { version: number };
      writeSession({
        navn,
        authKey: keys.authKey,
        encKeyRaw: keys.encKeyRaw,
        version,
        deviceId: deviceId(),
        label,
      });
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
