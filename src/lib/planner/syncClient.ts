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

/** One row of the device registry — labelled by platform and browser
 *  (`profilePanel.ts`'s `deviceLabel`), because a second browser on one
 *  machine is a second entry, not a second "device" in the OS sense. */
export interface DeviceEntry {
  id: string;
  label: string;
  lastSeen: string;
}

export interface SyncPayload {
  profile: string;
  plans: string;
  lastSemester: string;
  /**
   * The device registry, carried INSIDE the encrypted blob rather than in
   * server metadata (§6 step 6) — the list of a student's devices is as
   * private as the plan itself. There is no per-device revocation: dropping
   * a device is a PIN change (`changePin`, below), not an edit to this list.
   */
  devices: DeviceEntry[];
}

export interface SyncSession {
  navn: string;
  authKey: string;
  encKeyRaw: string;
  version: number;
  deviceId: string;
  label: string;
  /**
   * The last-known registry, cached here so the profile panel can render it
   * without a round trip and so a push between pulls still has "the list it
   * carries" to merge this device's own entry into (`mergeDevice`, below).
   */
  devices: DeviceEntry[];
}

export type SyncResult = { ok: true } | { ok: false; reason: string };

/**
 * `login`'s third outcome (§6 step 5): two independent histories met, and
 * the caller has to ask which one wins. Kept as its own type rather than
 * folded into `SyncResult`'s loose `reason: string` — narrowing a `string`
 * discriminant back down to `"collision"` would still leave the OTHER union
 * member's `reason: string` shape in play (TS does not exclude it), which
 * would make `local`/`remote` unreachable without an `as`. Callers use an
 * explicit type predicate to pick this member out instead (`attemptAuth`'s
 * `isCollisionResult` in `profilePanel.ts`) — a plain `"local" in result`
 * check alone still leaves TS widening the OTHER member to an intersection
 * with `Record<"local", unknown>` rather than excluding it.
 */
export type LoginResult =
  | SyncResult
  | { ok: false; reason: "collision"; local: SyncPayload; remote: SyncPayload };

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

/**
 * The three keys that travel.
 *
 * `np:weekView` and `np:weekBox` are deliberately absent. The first is *how*
 * you are looking at the plan, not *what* you are looking at — a phone picks
 * Liste because it is a phone, and forcing that onto a desktop is the same
 * error the product already refuses elsewhere. The second is a per-device,
 * per-width layout measurement; a remembered box from the wrong geometry costs
 * 0.14 CLS, which is worse than reserving nothing.
 *
 * `self`/`known` build the fourth field, `devices`: `self` is this call's own
 * `{ id, label, lastSeen }` (omitted where there is no session yet to name it,
 * e.g. comparing a not-yet-logged-in device against a remote payload), `known`
 * is the registry already carried (typically `session.devices`, the last
 * registry this client has seen). Merging by id — not appending — is what
 * keeps two pushes in the same tab from duplicating this device's own row.
 */
export function collectSyncable(
  storage: StorageLike,
  self: DeviceEntry | null = null,
  known: DeviceEntry[] = [],
): SyncPayload {
  return {
    profile: storage.getItem(PROFILE_STORAGE_KEY) ?? "{}",
    plans: storage.getItem(PLANS_STORAGE_KEY) ?? "{}",
    lastSemester: storage.getItem(LAST_SEMESTER_KEY) ?? "",
    devices: self ? mergeDevice(known, self) : known,
  };
}

/** Replaces this device's own row (matched by id), keeping every other one —
 *  idempotent, so pushing twice in the same tab never grows a duplicate. */
function mergeDevice(existing: DeviceEntry[], self: DeviceEntry): DeviceEntry[] {
  return [...existing.filter((d) => d.id !== self.id), self];
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

function isValidDeviceEntry(value: unknown): value is DeviceEntry {
  if (typeof value !== "object" || value === null) return false;
  const d = value as Record<string, unknown>;
  return typeof d.id === "string" && typeof d.label === "string" && typeof d.lastSeen === "string";
}

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
    typeof s.label === "string" &&
    Array.isArray(s.devices) &&
    s.devices.every(isValidDeviceEntry)
  );
}

export interface SyncClient {
  session(): SyncSession | null;
  signup(navn: string, pin: string, label: string): Promise<SyncResult>;
  login(navn: string, pin: string, label: string): Promise<LoginResult>;
  /** Settles the collision `login` just raised: `"remote"` adopts the other
   *  device's plan, `"local"` keeps this one and pushes it over the remote's. */
  resolveLogin(choice: "local" | "remote"): Promise<SyncResult>;
  /**
   * The only way to drop a device (§4 / §6 step 8): there is no per-device
   * revocation, because every device shares one derived key. This re-derives
   * both key sets, re-encrypts the current payload under the new `encKey`,
   * and replaces the stored credential — which logs every OTHER device out
   * until it is given the new PIN. Atomic from the student's view: nothing
   * about `session` changes unless the re-credentialing PUT actually lands,
   * so a failed attempt leaves this device exactly as logged in as it was a
   * moment ago, under the OLD pin.
   */
  changePin(oldPin: string, newPin: string): Promise<SyncResult>;
  push(): Promise<SyncResult>;
  pull(): Promise<SyncResult>;
  logout(): void;
}

/**
 * The collision `login` raised, held until `resolveLogin` settles it. Not
 * part of `SyncSession`: nothing here is written to storage or trusted for
 * anything until the student picks a side. No `local` payload: `"local"`
 * resolves by pushing whatever is CURRENTLY in storage (`pushInternal`
 * re-reads it fresh), and the copy `login()` compared against is already
 * unchanged in storage — there is nothing this slot needs to remember it for.
 */
interface PendingLogin {
  navn: string;
  keys: { authKey: string; encKeyRaw: string };
  label: string;
  version: number;
  remote: SyncPayload;
}

export function createSyncClient(deps: { storage: StorageLike; fetch: typeof fetch }): SyncClient {
  let session: SyncSession | null = readSession();
  let pending: PendingLogin | null = null;

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

  /**
   * Every `deps.fetch` call goes through here. `signup`/`login`/`push`/`pull`
   * previously called `deps.fetch` directly with no try/catch, so a network
   * failure (offline, DNS, CORS) rejected the returned promise instead of
   * resolving it — breaking the `SyncResult` contract every one of those
   * methods advertises (`{ ok: true } | { ok: false; reason: string }` is
   * total, a promise that can reject is not). `profilePanel.ts`'s
   * `attemptAuth` already had to defend against that locally; this closes it
   * at the source so every future caller inherits a contract that is actually
   * true, rather than the same trap. Returns `null` on rejection — callers
   * turn that into `{ ok: false, reason: "failed" }`, exactly what a non-2xx
   * response already produces, so there is no new failure vocabulary.
   */
  async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
    try {
      return await deps.fetch(url, init);
    } catch {
      return null;
    }
  }

  /** Shared by `push()` and `resolveLogin("local")`, which pushes the local
   *  payload over the remote's after the student keeps this device's plan. */
  async function pushInternal(): Promise<SyncResult> {
    if (!session) return { ok: false, reason: "no_session" };
    const self: DeviceEntry = {
      id: session.deviceId,
      label: session.label,
      lastSeen: new Date().toISOString(),
    };
    const payload = collectSyncable(deps.storage, self, session.devices);
    const blob = await seal(session.encKeyRaw, JSON.stringify(payload));
    const res = await safeFetch(`/api/sync/${encodeURIComponent(session.navn)}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-np-auth": session.authKey },
      body: JSON.stringify({ blob, version: session.version }),
    });
    if (res === null) return { ok: false, reason: "failed" };
    if (res.status === 409) {
      const body = (await res.json()) as { version: number };
      writeSession({ ...session, version: body.version });
      return { ok: false, reason: "stale" };
    }
    if (!res.ok) return { ok: false, reason: "failed" };
    const { version } = (await res.json()) as { version: number };
    writeSession({ ...session, version, devices: payload.devices });
    return { ok: true };
  }

  return {
    session: () => session,

    async signup(navn, pin, label) {
      const keys = await deriveKeys(navn, pin);
      const id = crypto.randomUUID();
      const payload = collectSyncable(deps.storage, {
        id,
        label,
        lastSeen: new Date().toISOString(),
      });
      const blob = await seal(keys.encKeyRaw, JSON.stringify(payload));
      const res = await safeFetch(`/api/sync/${encodeURIComponent(navn)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ authKey: keys.authKey, blob }),
      });
      if (res === null) return { ok: false, reason: "failed" };
      if (res.status === 409) return { ok: false, reason: "taken" };
      if (res.status === 503) return { ok: false, reason: "unavailable" };
      if (!res.ok) return { ok: false, reason: "failed" };
      const { version } = (await res.json()) as { version: number };
      writeSession({
        navn,
        authKey: keys.authKey,
        encKeyRaw: keys.encKeyRaw,
        version,
        deviceId: id,
        label,
        devices: payload.devices,
      });
      return { ok: true };
    },

    async login(navn, pin, label) {
      const keys = await deriveKeys(navn, pin);
      const res = await safeFetch(`/api/sync/${encodeURIComponent(navn)}`, {
        headers: { "x-np-auth": keys.authKey },
      });
      if (res === null) return { ok: false, reason: "failed" };
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
      const remote = JSON.parse(plain) as SyncPayload;

      // §6 step 5: this device's OWN current plan, compared against what the
      // account already holds, on the semester this device last looked at.
      // `describeCollision` is null (no prompt) for an empty device or two
      // sides that already agree — an ordinary "add my second device" login
      // never reaches the branch below.
      const local = collectSyncable(deps.storage);
      const summary = describeCollision(local, remote, local.lastSemester);
      if (summary) {
        pending = { navn, keys, label, version: body.version, remote };
        return { ok: false, reason: "collision", local, remote };
      }

      applySyncable(deps.storage, remote);
      const id = crypto.randomUUID();
      writeSession({
        navn,
        authKey: keys.authKey,
        encKeyRaw: keys.encKeyRaw,
        version: body.version,
        deviceId: id,
        label,
        devices: mergeDevice(remote.devices, { id, label, lastSeen: new Date().toISOString() }),
      });
      return { ok: true };
    },

    async resolveLogin(choice) {
      const p = pending;
      if (!p) return { ok: false, reason: "no_pending" };
      pending = null;

      const id = crypto.randomUUID();
      const self: DeviceEntry = { id, label: p.label, lastSeen: new Date().toISOString() };
      if (choice === "remote") applySyncable(deps.storage, p.remote);
      // choice === "local": storage already holds this device's own plan,
      // untouched since `login()` — nothing to apply, it is what gets pushed
      // below.
      writeSession({
        navn: p.navn,
        authKey: p.keys.authKey,
        encKeyRaw: p.keys.encKeyRaw,
        version: p.version,
        deviceId: id,
        label: p.label,
        devices: mergeDevice(p.remote.devices, self),
      });
      if (choice === "local") return pushInternal();
      return { ok: true };
    },

    async changePin(oldPin, newPin) {
      if (!session) return { ok: false, reason: "no_session" };
      const oldKeys = await deriveKeys(session.navn, oldPin);
      if (oldKeys.authKey !== session.authKey) return { ok: false, reason: "bad_pin" };
      const newKeys = await deriveKeys(session.navn, newPin);

      const self: DeviceEntry = {
        id: session.deviceId,
        label: session.label,
        lastSeen: new Date().toISOString(),
      };
      const payload = collectSyncable(deps.storage, self, session.devices);
      const blob = await seal(newKeys.encKeyRaw, JSON.stringify(payload));
      const res = await safeFetch(`/api/sync/${encodeURIComponent(session.navn)}`, {
        method: "PUT",
        // Authorised with the OLD credential — the worker has not swapped
        // anything yet, so this still has to prove it is who it says it is.
        headers: { "content-type": "application/json", "x-np-auth": session.authKey },
        body: JSON.stringify({ blob, version: session.version, authKey: newKeys.authKey }),
      });
      if (res === null) return { ok: false, reason: "failed" };
      if (res.status === 409) {
        const body = (await res.json()) as { version: number };
        // Only `version` moved on. `authKey`/`encKeyRaw` are untouched — this
        // device is exactly as logged in, under the same OLD pin, as before
        // the attempt; the worker never wrote a new `authHash` because the
        // version check runs first (`handleSyncPut`).
        writeSession({ ...session, version: body.version });
        return { ok: false, reason: "stale" };
      }
      if (!res.ok) return { ok: false, reason: "failed" };
      const { version } = (await res.json()) as { version: number };
      writeSession({
        ...session,
        authKey: newKeys.authKey,
        encKeyRaw: newKeys.encKeyRaw,
        version,
        devices: payload.devices,
      });
      return { ok: true };
    },

    async push() {
      return pushInternal();
    },

    async pull() {
      if (!session) return { ok: false, reason: "no_session" };
      const res = await safeFetch(`/api/sync/${encodeURIComponent(session.navn)}`, {
        headers: { "x-np-auth": session.authKey },
      });
      if (res === null) return { ok: false, reason: "failed" };
      if (!res.ok) return { ok: false, reason: "failed" };
      const body = (await res.json()) as { blob: string; version: number };
      const plain = await open(session.encKeyRaw, body.blob);
      if (plain === null) return { ok: false, reason: "undecryptable" };
      const remote = JSON.parse(plain) as SyncPayload;
      applySyncable(deps.storage, remote);
      const self: DeviceEntry = {
        id: session.deviceId,
        label: session.label,
        lastSeen: new Date().toISOString(),
      };
      writeSession({
        ...session,
        version: body.version,
        devices: mergeDevice(remote.devices, self),
      });
      return { ok: true };
    },

    logout() {
      writeSession(null);
    },
  };
}
