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

import { buildPublicPlan, type PublicPlan } from "./publicPlan.js";
import { semesterYear } from "./schedule.js";
import {
  activeCourses,
  LAST_SEMESTER_KEY,
  PLANS_STORAGE_KEY,
  type PlanCourse,
  type PlanProgram,
  type PlanState,
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
   * Sharing is on: `/user/<navn>` serves a readable copy of this plan, and
   * every push has to refresh it (see `pushInternal`) — that is what makes the
   * page a live mirror rather than a snapshot of the moment it was turned on.
   *
   * Mirrored from the server on every authorised read, not just written here,
   * because the toggle is per ACCOUNT and this field is per device: turning
   * sharing off on a phone must not leave a laptop believing it is still on
   * and quietly re-publishing every edit.
   */
  public: boolean;
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

/**
 * One semester where the two sides hold different courses — a row of the
 * collision question.
 *
 * Both `missing…` lists are kept because the choice is symmetrical: keeping
 * the account's copy drops `missingFromRemote`, keeping this device drops
 * `missingFromLocal`, and a prompt that named only one of them would still be
 * describing less than the button it sits above.
 */
export interface CollisionSemester {
  semesterId: string;
  /** Active codes on each side — dropped rows excluded, per `activeCodesIn`. */
  localCodes: string[];
  remoteCodes: string[];
  /** Only on this device; lost by "Behold <den andre enheten>". */
  missingFromRemote: string[];
  /** Only on the account; lost by "Behold denne enheten". */
  missingFromLocal: string[];
}

export interface CollisionSummary {
  /**
   * EVERY semester the two sides disagree about, oldest first — not just the
   * one this device happens to be looking at. `applySyncable` replaces the
   * whole `np:plans` map, so this is the smallest honest description of what
   * either button does.
   */
  semesters: CollisionSemester[];
}

/**
 * The `plans` field parsed back into its semester → courses map. Malformed
 * JSON reads as an empty map rather than throwing: this only ever runs on a
 * payload this client just decrypted or holds locally, and a mistake
 * elsewhere must not crash the login flow.
 */
function plansOf(payload: SyncPayload): Record<string, PlanCourse[]> {
  try {
    const parsed = JSON.parse(payload.plans) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return parsed as Record<string, PlanCourse[]>;
  } catch {
    return {};
  }
}

/**
 * The readable copy that goes out beside the ciphertext while sharing is on —
 * built from THE SAME payload the push is about, so the two cannot describe
 * different plans.
 *
 * It shows the semester the owner is planning (`lastSemester`), which is the
 * only honest reading of "a live copy of my plan": a stored per-semester choice
 * would be a second thing to keep in sync and a second thing to get wrong.
 * Returns `null` when the payload holds no usable plan at all, and the caller
 * then sends no `plain` rather than an empty one.
 */
export function publicPlanOf(payload: SyncPayload): PublicPlan | null {
  const semesterId = payload.lastSemester.trim();
  if (semesterId === "") return null;
  const courses = plansOf(payload)[semesterId];
  const plan: PlanState = {
    semesterId,
    courses: Array.isArray(courses) ? courses : [],
    ...(programOf(payload) ?? {}),
  };
  return buildPublicPlan(plan);
}

/** The programme out of the payload's own `np:profile` string, or nothing. */
function programOf(payload: SyncPayload): { program: PlanProgram } | null {
  try {
    const parsed: unknown = JSON.parse(payload.profile);
    if (typeof parsed !== "object" || parsed === null) return null;
    const program = (parsed as { program?: unknown }).program;
    if (typeof program !== "object" || program === null) return null;
    const row = program as Record<string, unknown>;
    if (typeof row.code !== "string" || typeof row.name !== "string") return null;
    return {
      program: {
        code: row.code,
        name: row.name,
        cohort: typeof row.cohort === "number" ? row.cohort : 0,
      },
    };
  } catch {
    return null;
  }
}

/**
 * One semester's course codes, DROPPED ROWS EXCLUDED — `activeCourses` is the
 * same definition of "what actually counts" the whole planner uses, reused
 * here rather than re-derived. Counting a deliberately-dropped course would
 * inflate the collision prompt's own numbers and list a course the student
 * already said no to under "mangler".
 */
export function activeCodesIn(plans: Record<string, PlanCourse[]>, semesterId: string): string[] {
  const rows = plans[semesterId];
  if (!Array.isArray(rows)) return [];
  return activeCourses({ courses: rows })
    .map((course) => course.code)
    .filter((code): code is string => typeof code === "string");
}

/**
 * Chronological order, oldest first — the order `candidateSemesters` puts the
 * planner's own semester picker in, so the prompt reads like the rest of the
 * app. A plain string sort would put `"26h"` before `"26v"`, i.e. an autumn
 * before the spring that precedes it. Anything that is not a semester id keeps
 * its own relative order at the end rather than claiming a year.
 */
function semesterOrder(semesterId: string): number {
  const year = semesterYear(semesterId);
  if (year === null) return Number.POSITIVE_INFINITY;
  return year * 10 + (/h$/i.test(semesterId.trim()) ? 1 : 0);
}

/**
 * Two independent histories meeting at login — NOT a conflict, and the one
 * prompt this design keeps. `null` means there is nothing to ask about: this
 * device holds nothing the account does not already have, so adopting the
 * remote copy costs nothing and the ordinary "add my second device" login
 * stays promptless. That property is deliberate; do not regress it.
 *
 * Both the DECISION to ask and the DESCRIPTION the student is asked to answer
 * span the whole `np:plans` map, because that is exactly what `applySyncable`
 * replaces. There used to be a `semesterId` parameter here and the answer
 * summarised that one semester: with a full 25h plan and an empty 26h —
 * `lastSemester` = "26h" — the question read "Denne enheten — 0 emner · 0 sp"
 * over a device holding a 25h draft, and the obvious answer destroyed it. The
 * parameter is gone rather than fixed at the call site: a per-semester
 * question about a whole-map decision cannot be made safe by choosing a better
 * semester.
 *
 * The trigger stays ASYMMETRIC — only work this device would lose raises the
 * prompt — while the description is symmetrical, listing every semester that
 * differs in either direction. A second device that holds a subset of the
 * account is still asked nothing.
 */
export function describeCollision(
  local: SyncPayload,
  remote: SyncPayload,
): CollisionSummary | null {
  const localPlans = plansOf(local);
  const remotePlans = plansOf(remote);
  const ids = [...new Set([...Object.keys(localPlans), ...Object.keys(remotePlans)])].sort(
    (a, b) => semesterOrder(a) - semesterOrder(b),
  );

  const semesters: CollisionSemester[] = [];
  let atRisk = false;
  for (const semesterId of ids) {
    const localCodes = activeCodesIn(localPlans, semesterId);
    const remoteCodes = activeCodesIn(remotePlans, semesterId);
    const missingFromRemote = localCodes.filter((code) => !remoteCodes.includes(code));
    const missingFromLocal = remoteCodes.filter((code) => !localCodes.includes(code));
    if (missingFromRemote.length === 0 && missingFromLocal.length === 0) continue;
    if (missingFromRemote.length > 0) atRisk = true;
    semesters.push({ semesterId, localCodes, remoteCodes, missingFromRemote, missingFromLocal });
  }
  return atRisk ? { semesters } : null;
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
    typeof s.public === "boolean" &&
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

/**
 * A decrypted remote payload and the version it arrived at, handed back by
 * `fetchRemote` for the caller to apply LATER — or never.
 *
 * The split exists because a GET has a round trip and the student keeps
 * editing during it. A single `pull()` fetched and overwrote `np:plans` in one
 * uninterruptible-looking step, so an edit made inside that window was
 * destroyed by the response to a request that predated it — and the push
 * that followed reported success, because it re-read the clobbered storage
 * at the version the pull had just adopted. A check AFTER `pull()` returns
 * cannot help: storage is already gone. So `fetchRemote` writes NOTHING, and
 * the caller decides — against its own generation counter — whether the
 * answer is still about the plan it asked about.
 */
export interface RemoteSnapshot {
  payload: SyncPayload;
  version: number;
  /** The account's share flag as the server holds it — see `SyncSession.public`. */
  public: boolean;
}

export type FetchResult = { ok: true; snapshot: RemoteSnapshot } | { ok: false; reason: string };

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
   * moment ago, under the OLD pin. The one exception is a 401, which is not
   * a failure to change the PIN but proof someone else already did
   * (`authFailure`): the old credential is gone, and pretending otherwise is
   * what wedges a device.
   */
  changePin(oldPin: string, newPin: string): Promise<SyncResult>;
  push(): Promise<SyncResult>;
  /** Fetches and decrypts the account's copy. Writes nothing — see `RemoteSnapshot`. */
  fetchRemote(): Promise<FetchResult>;
  /**
   * Applies a snapshot `fetchRemote` returned. The caller owns the decision.
   *
   * There is deliberately NO `pull()` convenience that does both: an
   * unguarded fetch-and-overwrite is the exact Critical this split exists to
   * remove, and while it stayed on the interface — with a doc comment
   * inviting its use — it was a standing invitation to relocate the bug into
   * the next caller. A caller with nothing concurrent to protect (a test)
   * composes the two itself, which costs one line and cannot be reached by
   * accident from the app.
   */
  applyRemote(snapshot: RemoteSnapshot): void;
  /**
   * Turns sharing on or off for the whole account (§5).
   *
   * On: uploads the readable copy with the same call, so `/user/<navn>` is
   * serving something the moment the switch flips rather than at the next
   * push. Off: the server clears `plain` outright — nobody may read it, so it
   * has no business staying in the record.
   *
   * The state lives on the ACCOUNT, so this is not a per-device preference:
   * every other device learns about it on its next authorised read.
   */
  setPublic(next: boolean): Promise<SyncResult>;
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
  /** The account's share flag, read with the blob and carried onto the session. */
  public: boolean;
  /**
   * Minted here rather than in `resolveLogin`, so this device keeps ONE
   * identity across a retried resolve: the id is what `mergeDevice` matches on
   * for every later push, and a failed attempt has already written a session
   * carrying it.
   *
   * It does NOT prevent a duplicate registry row, which an earlier comment
   * here claimed — `resolveLogin`'s `writeSession` rebuilds the list from
   * `p.remote.devices` on every attempt, so even a fresh id per attempt would
   * still yield exactly one row for this device. That is why the test on this
   * asserts the stable id itself rather than a row count that cannot move.
   */
  deviceId: string;
}

export function createSyncClient(deps: { storage: StorageLike; fetch: typeof fetch }): SyncClient {
  let session: SyncSession | null = readSession();
  let pending: PendingLogin | null = null;

  function readSession(): SyncSession | null {
    const raw = deps.storage.getItem(SYNC_STORAGE_KEY);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      // `public` arrived after the first sessions were written. Defaulting it
      // rather than failing validation means a session that predates sharing
      // stays signed in, private — which is both the safe answer and the true
      // one, since its account has never been made public either.
      const filled =
        typeof parsed === "object" && parsed !== null ? { public: false, ...parsed } : parsed;
      return isValidSession(filled) ? filled : null;
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

  /**
   * A non-2xx (and non-409) answer to a request that carried `x-np-auth`.
   *
   * **401 is the revocation path, not a transient error.** `changePin` is the
   * feature's only way to drop a device (§4 / §6 step 8) and it works by
   * making every other device's `authKey` wrong — so a 401 here means this
   * session is over, permanently, until the student types the new PIN. It was
   * previously folded into `"failed"`, which left the session in storage:
   * every load, every visibility flip and every edit retried it, the panel
   * still read "Sist synkronisert nå", and the advice was "prøv igjen", which
   * could never work. Worse, the worker's `AuthLimiter` is PER NAME, so ten
   * of those retries inside 15 minutes locked the account's GOOD devices out
   * too and made re-login with the new PIN answer "For mange forsøk."
   *
   * Dropping the session is what actually stops the retry loop: with
   * `session` null, `schedulePush` returns early, `shouldPullOnVisible` is
   * false and a reload starts logged out. The panel then shows the login form
   * with `"unauthorised"`'s own copy, which is the way back in.
   *
   * 429 deliberately does NOT drop the session — that is the lockout above,
   * and the record was never even read. Nor does 404: the account is not
   * there right now, which is not proof this credential is wrong.
   */
  function authFailure(status: number): { ok: false; reason: string } {
    if (status === 401) {
      writeSession(null);
      return { ok: false, reason: "unauthorised" };
    }
    if (status === 404) return { ok: false, reason: "no_account" };
    if (status === 429) return { ok: false, reason: "too_many_attempts" };
    if (status === 503) return { ok: false, reason: "unavailable" };
    return { ok: false, reason: "failed" };
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
    // The readable copy rides along ONLY while sharing is on. A private
    // account's push carries ciphertext and nothing else — the server refuses
    // to store a `plain` for one either (`handleSyncPut`), so this is the near
    // half of a rule enforced at both ends.
    const publicPlan = session.public ? publicPlanOf(payload) : null;
    const res = await safeFetch(`/api/sync/${encodeURIComponent(session.navn)}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-np-auth": session.authKey },
      body: JSON.stringify({
        blob,
        version: session.version,
        ...(publicPlan ? { plain: JSON.stringify(publicPlan) } : {}),
      }),
    });
    if (res === null) return { ok: false, reason: "failed" };
    if (res.status === 409) {
      const body = (await res.json()) as { version: number };
      writeSession({ ...session, version: body.version });
      return { ok: false, reason: "stale" };
    }
    if (!res.ok) return authFailure(res.status);
    const { version } = (await res.json()) as { version: number };
    writeSession({ ...session, version, devices: payload.devices });
    return { ok: true };
  }

  /** `fetchRemote`, as a plain declaration so it can sit beside the other half
   *  of a pull, `applyRemoteInternal`. */
  async function fetchRemoteInternal(): Promise<FetchResult> {
    if (!session) return { ok: false, reason: "no_session" };
    const res = await safeFetch(`/api/sync/${encodeURIComponent(session.navn)}`, {
      headers: { "x-np-auth": session.authKey },
    });
    if (res === null) return { ok: false, reason: "failed" };
    if (!res.ok) return authFailure(res.status);
    const body = (await res.json()) as { blob: string; version: number; public?: boolean };
    // Re-checked AFTER the round trip, exactly as `applyRemoteInternal` does
    // and for the same reason: 401-as-revocation calls `writeSession(null)`,
    // so a concurrent push's 401 can empty `session` while this GET is on the
    // wire. TypeScript keeps the narrowing from the top of the function across
    // an `await` and would have let this compile straight into a TypeError —
    // which, from `void pullAndRefresh()`, surfaces as an unhandled rejection
    // rather than as this module's own total `{ ok: false, reason }` contract.
    if (!session) return { ok: false, reason: "no_session" };
    const plain = await open(session.encKeyRaw, body.blob);
    if (plain === null) return { ok: false, reason: "undecryptable" };
    return {
      ok: true,
      snapshot: {
        payload: JSON.parse(plain) as SyncPayload,
        version: body.version,
        public: body.public === true,
      },
    };
  }

  /** `applyRemote`, as a plain declaration for the same reason. */
  function applyRemoteInternal(snapshot: RemoteSnapshot): void {
    // `fetchRemote` and this call are separated by a network round trip the
    // caller may have spent logging out (or being logged out by a 401 on
    // another request), so the session it was fetched under has to still be
    // here for the version/registry write below to mean anything.
    if (!session) return;
    applySyncable(deps.storage, snapshot.payload);
    const self: DeviceEntry = {
      id: session.deviceId,
      label: session.label,
      lastSeen: new Date().toISOString(),
    };
    writeSession({
      ...session,
      version: snapshot.version,
      // The server's answer about sharing wins over this device's memory of
      // it: the toggle is per account, and a phone that turned it off is not
      // going to tell this tab any other way.
      public: snapshot.public,
      devices: mergeDevice(snapshot.payload.devices, self),
    });
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
        // A new account is PRIVATE. Sharing is something the student turns on,
        // never something signing up did for them.
        public: false,
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

      const body = (await res.json()) as { blob: string; version: number; public?: boolean };
      const plain = await open(keys.encKeyRaw, body.blob);
      // Decryption failing with a server-accepted authKey means the record was
      // written under a different encKey — not reachable today, but better a
      // named refusal than silently replacing the student's plan with noise.
      if (plain === null) return { ok: false, reason: "undecryptable" };
      const remote = JSON.parse(plain) as SyncPayload;

      // §6 step 5: this device's OWN current plan, compared against what the
      // account already holds, across every semester either side has.
      // `describeCollision` is null (no prompt) for an empty device or two
      // sides that already agree — an ordinary "add my second device" login
      // never reaches the branch below.
      const local = collectSyncable(deps.storage);
      const summary = describeCollision(local, remote);
      if (summary) {
        pending = {
          navn,
          keys,
          label,
          version: body.version,
          remote,
          public: body.public === true,
          deviceId: crypto.randomUUID(),
        };
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
        // Adopted from the account, not assumed: this device may be the second
        // one on an account that is already shared, and its pushes have to keep
        // the readable copy current from the first edit.
        public: body.public === true,
        devices: mergeDevice(remote.devices, { id, label, lastSeen: new Date().toISOString() }),
      });
      return { ok: true };
    },

    /**
     * `pending` is cleared only once this actually SUCCEEDS.
     *
     * Clearing it up front made a failed `resolveLogin("local")` unwinnable:
     * the panel showed "Prøv igjen", and every retry answered `no_pending`
     * — the same dead-end class Task 7 fixed on the auth buttons. The session
     * is still written before the push (that half did land, and this device is
     * logged in either way); what is held is the material a retry needs.
     * `p.deviceId` is stable across attempts, so retrying re-writes the same
     * registry row rather than adding one.
     */
    async resolveLogin(choice) {
      const p = pending;
      if (!p) return { ok: false, reason: "no_pending" };

      const self: DeviceEntry = {
        id: p.deviceId,
        label: p.label,
        lastSeen: new Date().toISOString(),
      };
      if (choice === "remote") applySyncable(deps.storage, p.remote);
      // choice === "local": storage already holds this device's own plan,
      // untouched since `login()` — nothing to apply, it is what gets pushed
      // below.
      writeSession({
        navn: p.navn,
        authKey: p.keys.authKey,
        encKeyRaw: p.keys.encKeyRaw,
        version: p.version,
        deviceId: p.deviceId,
        label: p.label,
        public: p.public,
        devices: mergeDevice(p.remote.devices, self),
      });
      if (choice === "local") {
        const result = await pushInternal();
        if (!result.ok) {
          // `pushInternal` corrects `session.version` on a 409; carrying it
          // back onto the pending login is what lets the retry start from the
          // version the server actually holds rather than re-sending a stale one.
          if (session) p.version = session.version;
          return result;
        }
      }
      pending = null;
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
      // 401 here means someone else already changed the PIN — the old
      // credential this request authorised with is gone. Same revocation, same
      // honest answer as `push`/`fetchRemote` (see `authFailure`); the
      // atomicity note above still holds, since nothing was written server-side.
      if (!res.ok) return authFailure(res.status);
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

    fetchRemote: fetchRemoteInternal,

    applyRemote: applyRemoteInternal,

    async setPublic(next) {
      if (!session) return { ok: false, reason: "no_session" };
      const url = `/api/sync/${encodeURIComponent(session.navn)}/public`;
      const headers = { "content-type": "application/json", "x-np-auth": session.authKey };

      if (!next) {
        const res = await safeFetch(url, { method: "DELETE", headers });
        if (res === null) return { ok: false, reason: "failed" };
        if (!res.ok) return authFailure(res.status);
        writeSession({ ...session, public: false });
        return { ok: true };
      }

      // The copy goes up WITH the switch, not on the next push: a link handed
      // over in the same gesture has to lead somewhere immediately, and an
      // account that is public with nothing to serve answers 404 — the same
      // thing a wrong name answers.
      const plan = publicPlanOf(collectSyncable(deps.storage));
      if (plan === null) return { ok: false, reason: "no_plan" };
      const res = await safeFetch(url, {
        method: "PUT",
        headers,
        body: JSON.stringify({ plain: JSON.stringify(plan) }),
      });
      if (res === null) return { ok: false, reason: "failed" };
      if (!res.ok) return authFailure(res.status);
      // Re-read: `authFailure`'s 401 branch can have emptied the session while
      // this request was on the wire (same rule as `fetchRemoteInternal`).
      if (!session) return { ok: false, reason: "no_session" };
      writeSession({ ...session, public: true });
      return { ok: true };
    },

    logout() {
      writeSession(null);
    },
  };
}
