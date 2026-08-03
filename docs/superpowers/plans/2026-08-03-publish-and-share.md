# Publish, View, and Delete the Hash — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Depends on:** `docs/superpowers/plans/2026-08-03-sync-accounts.md` must land first. Publishing needs the account, so nothing here can ship on its own.

**Goal:** Sharing becomes one mechanism — publish your plan, send `/user/<navn>`. The recipient *views* it and their own storage is never touched. The `#v2;…` hash grammar is deleted outright.

**Architecture:** Publishing writes a plaintext copy into the existing `user:<navn>` record beside the ciphertext, which stays the private source of truth. `/user/<navn>` is rewritten by the worker to a static shell that fetches the published plan and renders it with the planner's own grid modules, read-only. Search engines are refused by header, not by `robots.txt`.

**Tech Stack:** Cloudflare Workers + KV, Astro static shell with a worker rewrite, TypeScript, vitest, Playwright.

## Carried from the sync plan (landed 2026-08-03) — read before Task 5

Four facts from the sync build that this plan collides with. None are
rediscoverable from the code alone.

1. **`formatPlanHash` has a second job now.** The planner's pull-repaint gate
   compares `formatPlanHash(next)` against `formatPlanHash(plan)` to decide
   whether a pulled plan is actually different, so it can repaint once and not
   at all when nothing moved. Task 5 deletes `formatPlanHash` with the rest of
   the grammar. Replace the comparison with an equivalent — serialising the
   `SyncPayload` will do — and do **not** simply drop the gate: without it every
   pull repaints the week, which is the gratuitous-repaint problem the sync
   plan spent a fix round closing.
2. **Two live defects will disappear with the hash; confirm they do.** Fix wave
   2 found and deliberately left them, because this plan deletes their home:
   the search-index name backfill clears `replacedPlan`, so "Behold min egen"
   vanishes shortly after a real shared link loads; and signing up while
   viewing a link uploads *the link's* plan as the new account's. Verify both
   are gone once §5 lands rather than assuming it.
3. **The viewed-link sync suppression is vestigial after §5.** Sync currently
   carries a mechanism ensuring a tab showing a link it only *opened* neither
   pushes nor pulls — needed because a one-line settle was defeated by the name
   backfill re-arming the push for every link. Once the hash is gone there are
   no viewed links, so that flag and its tests must be removed with it, not
   left behind as a mystery.
4. **The e2e fixture layer has a `/api/sync/*` carve-out.** If this plan adds
   `/api/plan/:navn` or `/api/sync/:navn/public`, decide deliberately whether
   they join it. The public read is our own surface too, so the same reasoning
   applies — see `CLAUDE.md`'s note.

One methodological warning, earned the hard way: **`git stash` is not a
baseline.** A regression this session introduced was called "pre-existing" for
many turns because three agents verified it against a `main` that already
contained the commit that caused it. To test whether something predates your
work, check out the session's true starting commit in a worktree.

## Global Constraints

- UI copy is **Norwegian bokmål, sentence case, comma decimals** ("7,5 sp").
- `mise run check` and `mise run e2e` must both stay green.
- Client setup goes through `onPage(setup)` and binds with `{ signal }`.
- Two-pass typecheck; structural interfaces in worker files.
- Biome with `--error-on-warnings`.
- **Never `Disallow: /user/` in `robots.txt`** — a blocked crawl means the noindex directive is never read, and the URL can still be listed. Allow the crawl, refuse the index.
- The published copy is **per-semester**: `/user/<navn>` shows the semester that was published, not whatever the owner is looking at now.
- Spec: `docs/superpowers/specs/2026-08-02-accountless-sync-design.md` §5.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `worker/src/sync.ts` (modify) | `handlePublish`, `handleUnpublish`, `handlePublicRead`. |
| `worker/src/server.ts` (modify) | `/api/sync/:navn/public` dispatch, `/user/:navn` rewrite, `X-Robots-Tag`. |
| `src/pages/user/index.astro` (new) | The static shell the rewrite serves. |
| `src/components/planner/publicPlan.ts` (new) | Fetches the published plan and renders it read-only with the grid modules. |
| `src/components/planner/plannerApp.ts` (modify) | Del reworked to publish; all hash handling deleted. |
| `src/lib/planner/store.ts` (modify) | Hash grammar deleted. |
| `e2e/publish.pw.ts` (new) | Publish → view in a fresh context → viewer's storage untouched. |

---

### Task 1: Publish, unpublish, and the public read

**Files:**
- Modify: `worker/src/sync.ts`
- Test: `tests/worker/sync.test.ts`

**Interfaces:**
- Consumes: `validateName`, `SyncRecord`, `SyncDeps`, `recordKey`, `authorise` behaviour from the sync plan.
- Produces:
  - `handlePublish(name: string, authKey: string | null, body: unknown, deps: SyncDeps): Promise<Response>`
  - `handleUnpublish(name: string, authKey: string | null, deps: SyncDeps): Promise<Response>`
  - `handlePublicRead(name: string, deps: SyncDeps): Promise<Response>`

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/worker/sync.test.ts
import {
  handlePublicRead,
  handlePublish,
  handleUnpublish,
} from "../../worker/src/sync.js";

const PLAN = JSON.stringify({ semesterId: "26h", courses: [{ code: "TDT4120" }] });

describe("publishing", () => {
  it("publishes a plaintext copy and serves it without any credential", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));

    expect((await handlePublish("martin", AUTH, { plain: PLAN }, deps(kv))).status).toBe(200);

    const res = await handlePublicRead("martin", deps(kv));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ plain: PLAN });
  });

  it("404s an unpublished account, so a name cannot be probed for existence", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    expect((await handlePublicRead("martin", deps(kv))).status).toBe(404);
    expect((await handlePublicRead("finnes-ikke", deps(kv))).status).toBe(404);
  });

  it("refuses to publish without the right authKey", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    expect((await handlePublish("martin", OTHER, { plain: PLAN }, deps(kv))).status).toBe(401);
    expect((await handlePublicRead("martin", deps(kv))).status).toBe(404);
  });

  it("unpublishes and stops serving, without touching the private blob", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    await handlePublish("martin", AUTH, { plain: PLAN }, deps(kv));

    expect((await handleUnpublish("martin", AUTH, deps(kv))).status).toBe(204);
    expect((await handlePublicRead("martin", deps(kv))).status).toBe(404);

    const still = await handleSyncGet("martin", AUTH, deps(kv));
    expect(await still.json()).toMatchObject({ blob: "cipher" });
  });

  it("never exposes the ciphertext on the public route", async () => {
    const kv = fakeKv();
    await handleSyncClaim("martin", { authKey: AUTH, blob: "cipher" }, deps(kv));
    await handlePublish("martin", AUTH, { plain: PLAN }, deps(kv));
    expect(JSON.stringify(await (await handlePublicRead("martin", deps(kv))).json())).not.toContain(
      "cipher",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: FAIL — `handlePublish is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// append to worker/src/sync.ts

/**
 * Publishing writes a PLAINTEXT copy beside the ciphertext, because the public
 * page has to be readable by someone who has no key. `blob` stays the private
 * source of truth and is never served here.
 */
export async function handlePublish(
  rawName: string,
  authKey: string | null,
  body: unknown,
  deps: SyncDeps,
): Promise<Response> {
  const name = validateName(rawName);
  if (name === null) return json({ error: "bad_name" }, 400);
  const found = await authorise(name, authKey, deps);
  if (found instanceof Response) return found;

  const plain = asRecord(body)?.plain;
  if (typeof plain !== "string") return json({ error: "bad_body" }, 400);

  const next: SyncRecord = { ...found, public: true, plain, updatedAt: deps.now() };
  await deps.kv.put(recordKey(name), JSON.stringify(next));
  return json({ published: true }, 200);
}

export async function handleUnpublish(
  rawName: string,
  authKey: string | null,
  deps: SyncDeps,
): Promise<Response> {
  const name = validateName(rawName);
  if (name === null) return json({ error: "bad_name" }, 400);
  const found = await authorise(name, authKey, deps);
  if (found instanceof Response) return found;

  const next: SyncRecord = { ...found, public: false, plain: null, updatedAt: deps.now() };
  await deps.kv.put(recordKey(name), JSON.stringify(next));
  return new Response(null, { status: 204 });
}

/**
 * No credential, and a uniform 404 for "no such account" and "not published":
 * an unpublished account must not be distinguishable from a free name, or the
 * public route becomes a name-enumeration oracle.
 */
export async function handlePublicRead(rawName: string, deps: SyncDeps): Promise<Response> {
  const name = validateName(rawName);
  if (name === null) return json({ error: "not_found" }, 404);
  const raw = await deps.kv.get(recordKey(name), "text");
  if (raw === null) return json({ error: "not_found" }, 404);
  let record: SyncRecord;
  try {
    record = JSON.parse(raw) as SyncRecord;
  } catch {
    return json({ error: "not_found" }, 404);
  }
  if (!record.public || record.plain === null) return json({ error: "not_found" }, 404);
  return json({ plain: record.plain, updatedAt: record.updatedAt }, 200);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: PASS (20 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/src/sync.ts tests/worker/sync.test.ts
git commit -m "feat(publish): publish, unpublish and public read"
```

---

### Task 2: Route `/user/:navn` and refuse indexing

**Files:**
- Modify: `worker/src/server.ts`
- Test: `tests/worker/sync.test.ts`

**Interfaces:**
- Consumes: Task 1's three handlers.
- Produces: `PUT|DELETE /api/sync/:navn/public`, `GET /api/plan/:navn`, and a `/user/:navn` → `/user/index.html` rewrite carrying `X-Robots-Tag: noindex, nofollow`.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/worker/sync.test.ts
describe("public routing", () => {
  it("serves the shell for /user/:navn and refuses indexing by header", async () => {
    const env = envWith(fakeKv());
    const res = await worker.fetch(new Request("https://x/user/martin"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("publishes over the API and reads back without a credential", async () => {
    const kv = fakeKv();
    const env = envWith(kv);
    await worker.fetch(
      new Request("https://x/api/sync/martin", {
        method: "POST",
        body: JSON.stringify({ authKey: AUTH, blob: "cipher" }),
      }),
      env,
    );
    const pub = await worker.fetch(
      new Request("https://x/api/sync/martin/public", {
        method: "PUT",
        headers: { "x-np-auth": AUTH },
        body: JSON.stringify({ plain: PLAN }),
      }),
      env,
    );
    expect(pub.status).toBe(200);

    const read = await worker.fetch(new Request("https://x/api/plan/martin"), env);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ plain: PLAN });
  });

  it("does not disallow /user/ in robots.txt — that would hide the noindex", async () => {
    const { readFileSync } = await import("node:fs");
    const robots = readFileSync("public/robots.txt", "utf8");
    expect(robots).not.toMatch(/Disallow:\s*\/user/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker/sync.test.ts`
Expected: FAIL — `/user/martin` falls through to `ASSETS` with no `x-robots-tag`.

- [ ] **Step 3: Write minimal implementation**

In `worker/src/server.ts`, before the asset fallthrough:

```ts
/** `/user/<navn>` → the name. Decoded first, like `parseCode` and `syncName`. */
function publicPlanName(pathname: string): string | null {
  const match = /^\/user\/([^/]+)\/?$/.exec(pathname);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

/**
 * A published plan is a room-and-hour record attached to a name the student
 * chose, so it is refused by HEADER rather than by robots.txt. Blocking the
 * crawl would mean Google never reads the directive and can still list the bare
 * URL — the exact failure this avoids.
 */
function withNoIndex(response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set("X-Robots-Tag", "noindex, nofollow");
  return next;
}
```

Then in `fetch`, alongside the existing route matching:

```ts
// /api/sync/<navn>/public
const publicApi = /^\/api\/sync\/([^/]+)\/public\/?$/.exec(url.pathname);
if (publicApi?.[1]) {
  const name = decodeURIComponent(publicApi[1]);
  if (!env.SYNC) return withSecurityHeaders(syncUnavailable());
  const deps: SyncDeps = { kv: env.SYNC, now: () => new Date().toISOString() };
  const auth = request.headers.get("x-np-auth");
  if (request.method === "PUT") {
    return withSecurityHeaders(
      await handlePublish(name, auth, await request.json().catch(() => null), deps),
    );
  }
  if (request.method === "DELETE") {
    return withSecurityHeaders(await handleUnpublish(name, auth, deps));
  }
  return withSecurityHeaders(methodNotAllowed(["PUT", "DELETE"]));
}

// /api/plan/<navn> — the viewer's data source, no credential
const publicRead = /^\/api\/plan\/([^/]+)\/?$/.exec(url.pathname);
if (publicRead?.[1]) {
  if (!env.SYNC) return withSecurityHeaders(syncUnavailable());
  return withSecurityHeaders(
    await handlePublicRead(decodeURIComponent(publicRead[1]), {
      kv: env.SYNC,
      now: () => new Date().toISOString(),
    }),
  );
}

// /user/<navn> — serve the static shell, refuse indexing
if (publicPlanName(url.pathname) !== null) {
  const shell = await env.ASSETS.fetch(new Request(new URL("/user/index.html", url), request));
  return withNoIndex(withSecurityHeaders(shell));
}
```

Extract the `503` body from the sync plan's `handleSync` into a shared `syncUnavailable()` helper so both call sites agree.

Confirm `public/robots.txt` exists and contains no `/user` rule; if the file does not exist, create it with `User-agent: *` and `Allow: /` plus the sitemap line the site already advertises. Exclude `/user/*` from the sitemap generator.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker/sync.test.ts && npm run typecheck`
Expected: PASS (23 tests), both typecheck passes clean.

- [ ] **Step 5: Commit**

```bash
git add worker/src/server.ts public/robots.txt tests/worker/sync.test.ts
git commit -m "feat(publish): route /user/:navn and refuse indexing by header"
```

---

### Task 3: The read-only view

**Files:**
- Create: `src/pages/user/index.astro`
- Create: `src/components/planner/publicPlan.ts`
- Test: `tests/planner/publicPlan.test.ts`

**Interfaces:**
- Consumes: the grid rendering modules already used by the planner (`src/components/planner/grid.ts`, `columnGrid.ts`), `loadPlannerIndex` from `src/lib/planner/data.ts`.
- Produces:
  - `parsePublishedPlan(raw: string): PublishedPlan | null`
  - `mountPublicPlan(deps: { navn: string; fetch: typeof fetch; root: HTMLElement; signal: AbortSignal }): void`

**This module must never import `PlanStore` and never write to `localStorage`.** That is the whole point of the change: a shared link shows you someone else's plan and leaves yours alone. Add the assertion as a test, not just as a comment.

- [ ] **Step 1: Write the failing test**

```ts
// tests/planner/publicPlan.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePublishedPlan } from "../../src/components/planner/publicPlan.js";

describe("parsePublishedPlan", () => {
  it("reads a published plan", () => {
    const plan = parsePublishedPlan(
      JSON.stringify({
        semesterId: "26h",
        courses: [{ code: "TDT4120", name: "Algoritmer og datastrukturer", credits: 7.5 }],
      }),
    );
    expect(plan?.semesterId).toBe("26h");
    expect(plan?.courses[0]?.code).toBe("TDT4120");
  });

  it("returns null for junk rather than throwing", () => {
    expect(parsePublishedPlan("not json")).toBeNull();
    expect(parsePublishedPlan("{}")).toBeNull();
    expect(parsePublishedPlan(JSON.stringify({ semesterId: "26h" }))).toBeNull();
  });

  it("drops malformed course rows instead of failing the whole plan", () => {
    const plan = parsePublishedPlan(
      JSON.stringify({ semesterId: "26h", courses: [{ code: "TDT4120" }, { nope: true }] }),
    );
    expect(plan?.courses).toHaveLength(1);
  });
});

describe("the viewer never writes", () => {
  it("does not reference localStorage or the plan store", () => {
    const source = readFileSync("src/components/planner/publicPlan.ts", "utf8");
    expect(source).not.toMatch(/localStorage/);
    expect(source).not.toMatch(/createPlanStore|PlanStore/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/planner/publicPlan.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/planner/publicPlan.ts`:

```ts
/**
 * The read-only view behind `/user/<navn>`.
 *
 * A shared link SHOWS you someone else's plan. It never writes to yours — no
 * store, no `localStorage`, no prompt about replacing anything. If the viewer
 * wants this plan they build their own, which is five clicks, and the CTA at
 * the bottom is how they start.
 */
export interface PublishedCourse {
  code: string;
  name: string;
  credits?: number;
}

export interface PublishedPlan {
  semesterId: string;
  courses: PublishedCourse[];
}

export function parsePublishedPlan(raw: string): PublishedPlan | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.semesterId !== "string" || !Array.isArray(obj.courses)) return null;

  const courses: PublishedCourse[] = [];
  for (const entry of obj.courses) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.code !== "string") continue;
    courses.push({
      code: row.code,
      name: typeof row.name === "string" ? row.name : row.code,
      ...(typeof row.credits === "number" ? { credits: row.credits } : {}),
    });
  }
  return { semesterId: obj.semesterId, courses };
}
```

Then `mountPublicPlan`, which fetches `/api/plan/<navn>`, and on:
- **200** — renders the week with the same grid modules the planner uses, plus a heading *"Delt plan"*, the owner's name, the credit total, and a CTA button *"Lag din egen plan"* linking to `/planlegger/`.
- **404** — *"Fant ingen delt plan her. Lenken kan være fjernet."*
- **failure** — *"Kunne ikke hente planen."* with a retry.

Create `src/pages/user/index.astro` as the shell: the standard `Layout`, an empty `<div id="public-plan">`, and a hoisted script calling `mountPublicPlan` through `onPage`. Read the name from `location.pathname`, not from an Astro param — the page is static and the worker rewrites every `/user/*` to it.

Reserve the week's height on the frame exactly as `/emne/[code]/` does, or this page ships the CLS regression the planner was fixed for. The viewer has no plan probe value to work from (`--plan-courses` reflects *their* plan, not the one being viewed), so reserve from the fetched course count with a `data-reserve` lease released on first draw.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/planner/publicPlan.test.ts && npm run lint`
Expected: PASS (5 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/planner/publicPlan.ts src/pages/user/index.astro tests/planner/publicPlan.test.ts
git commit -m "feat(publish): read-only view for a shared plan"
```

---

### Task 4: Del publishes

**Files:**
- Modify: `src/components/planner/plannerApp.ts`
- Test: `tests/planner/plannerApp.test.ts`

**Interfaces:**
- Consumes: `SyncClient` (sync plan Task 6), `publish`/`unpublish` methods added here.
- Produces: `shareTarget(session: SyncSession | null): { kind: "signup" } | { kind: "publish"; url: string }`

Del on an account-less plan offers signup rather than failing. That does not violate "never a prerequisite" — the rule is about using the planner, and the planner is untouched.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/planner/plannerApp.test.ts
import { shareTarget } from "../../src/components/planner/plannerApp.js";

describe("shareTarget", () => {
  it("sends a signed-out student to signup rather than failing", () => {
    expect(shareTarget(null)).toEqual({ kind: "signup" });
  });

  it("builds the public URL from the account name", () => {
    expect(
      shareTarget({
        navn: "martin",
        authKey: "a",
        encKeyRaw: "b",
        version: 3,
        deviceId: "d",
        label: "Mac · Safari",
      }),
    ).toEqual({ kind: "publish", url: "/user/martin" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/planner/plannerApp.test.ts`
Expected: FAIL — `shareTarget is not exported`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/components/planner/plannerApp.ts
/**
 * There is one sharing mechanism: publish, then send `/user/<navn>`. Del on an
 * account-less plan opens signup instead of failing — sharing is the one thing
 * that needs the account, and saying so is better than a disabled button.
 */
export function shareTarget(
  session: SyncSession | null,
): { kind: "signup" } | { kind: "publish"; url: string } {
  if (session === null) return { kind: "signup" };
  return { kind: "publish", url: `/user/${session.navn}` };
}
```

Rework the existing Del handler (the `navigator.share`/clipboard block, currently around `plannerApp.ts:900-970`): call `shareTarget`, open the profile panel on `signup`, and on `publish` await `sync.publish(currentPlanAsPublished())` before sharing or copying the absolute URL. Keep the existing two-state label swap and its width-stability trick — it exists because the button growing shoved the Uke/Liste switch sideways.

Add `publish`/`unpublish` to `SyncClient` in `src/lib/planner/syncClient.ts`, calling `PUT`/`DELETE` on `/api/sync/<navn>/public`, and surface an `Ikke delt lenger` action in the profile panel.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npm run typecheck`
Expected: PASS, both typecheck passes clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/planner/plannerApp.ts src/lib/planner/syncClient.ts tests/planner/plannerApp.test.ts
git commit -m "feat(publish): Del publishes and copies /user/<navn>"
```

---

### Task 5: Delete the hash

**Files:**
- Modify: `src/lib/planner/store.ts`
- Modify: `src/components/planner/plannerApp.ts`
- Modify: `src/pages/planlegger/index.astro`
- Modify: `src/layouts/Layout.astro`
- Modify: `tests/planner/store.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing. This task is pure deletion.

**There are no links in the wild to keep working** — the project is not connected to Cloudflare (`wrangler.jsonc`), so no plan link has ever been sent. No back-compat shim.

Delete:
- `store.ts` — `parsePlanHash`, `formatPlanHash`, `ParsedPlanHash`, the semester/course token regexes and the whole hash-grammar block.
- `plannerApp.ts` — `syncHash`, `lastWrittenHash`, the `hashchange` listener, `planFromHash`, `withStoredFacts`, `replacedPlan`, `hashPlan`/`hashHasPlan` and the boot branch that saved from the hash, `renderLinkNote`'s replaced-plan half and the `Behold min egen` button, and the `replacedPlan = null` line in `onPlanChange`.
- `index.astro` — `#planner-link-note` only if `linkNote`'s remaining C4 semester-substitution use also disappears; **keep it if that message survives**, and check before deleting.
- `Layout.astro` — the pre-paint script's `location.hash` branch, which suppresses the first-run screen for a load whose plan arrives by hash (see `docs/superpowers/specs/2026-08-03-onboarding-and-empty-state-design.md` §1). After this task the first-run predicate is purely `html:not([data-plan])`, and §5's "nothing in the CLS machinery depends on the hash" is true again. Delete the e2e case that guards it too — a shared link can no longer reach `/planlegger/` at all.
- `tests/planner/store.test.ts` — every `parsePlanHash`/`formatPlanHash` test.

Keep: `linkNote` itself if the C4 "we substituted a semester" message still has a source. After the hash goes, the only writer was `planFromHash`, so it very likely becomes dead — verify by grep before removing, and remove the element and its CSS with it.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/planner/store.test.ts
import { readFileSync } from "node:fs";

describe("the plan hash is gone", () => {
  it("exports no hash grammar", async () => {
    const store = await import("../../src/lib/planner/store.js");
    expect("parsePlanHash" in store).toBe(false);
    expect("formatPlanHash" in store).toBe(false);
  });

  it("leaves no hash handling in the planner", () => {
    const source = readFileSync("src/components/planner/plannerApp.ts", "utf8");
    expect(source).not.toMatch(/hashchange/);
    expect(source).not.toMatch(/replacedPlan/);
    expect(source).not.toMatch(/withStoredFacts/);
    expect(source).not.toMatch(/syncHash/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/planner/store.test.ts`
Expected: FAIL — all four symbols are still present.

- [ ] **Step 3: Perform the deletions**

Work top-down, running `npm run typecheck` after each file so the compiler finds every call site. Expect `plannerApp.ts` to shed roughly 120 lines and `store.ts` roughly 190.

Then re-point the comment at `plannerApp.ts:704`: it justifies keeping `weekView` out of *the hash*, and the rule now applies to sync. Rewrite it to say the week view is not carried between devices because it is how you are looking at the plan, not what you are looking at.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run && npm run typecheck && npm run lint && mise run e2e`
Expected: all green. If an e2e spec drove a plan through the URL hash, rewrite it to seed `localStorage` instead — `e2e/flows.pw.ts` is the likely site.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete the plan hash, superseded by published plans"
```

---

### Task 6: Unfurl — rich link previews without being indexed

**Files:**
- Modify: `worker/src/server.ts`
- Create: `worker/src/unfurl.ts`
- Test: `tests/worker/unfurl.test.ts`

**Interfaces:**
- Consumes: `handlePublicRead`'s record shape (Task 1).
- Produces: `unfurlMeta(plain: string, navn: string): { title: string; description: string }`, and an `HTMLRewriter` pass over the `/user/:navn` shell.

**Indexing and unfurling are different crawlers, and that is what makes both of your requirements hold at once.** `X-Robots-Tag: noindex` governs Googlebot and search results. Slack, iMessage, Discord, WhatsApp and Facebook's unfurlers fetch the URL and read `og:` tags; they do not consult it. So a published plan previews richly in a chat and never appears in search.

`HTMLRewriter` is a Workers-only global. Keep it out of `worker/src/sync.ts` (which the Node pass compiles) — `unfurl.ts` exports the pure `unfurlMeta` for tests, and the rewriter itself lives in `server.ts` behind a structural type.

**No per-plan `og:image`.** Rendering a week to PNG on a Worker is not worth it; use one static card at `/og-card.png`. Say so rather than leaving a reader to wonder why it isn't dynamic.

- [ ] **Step 1: Write the failing test**

```ts
// tests/worker/unfurl.test.ts
import { describe, expect, it } from "vitest";
import { unfurlMeta } from "../../worker/src/unfurl.js";

const PLAN = JSON.stringify({
  semesterId: "26h",
  semesterLabel: "Høst 2026",
  courses: [
    { code: "TDT4120", name: "Algoritmer", credits: 7.5 },
    { code: "TDT4100", name: "Objektorientert", credits: 7.5 },
  ],
});

describe("unfurlMeta", () => {
  it("names the sharer, the count and the credit total with a comma decimal", () => {
    expect(unfurlMeta(PLAN, "martin")).toEqual({
      title: "martin deler en plan",
      description: "2 emner · 15 sp · Høst 2026",
    });
  });

  it("uses a comma decimal for a half credit", () => {
    const odd = JSON.stringify({
      semesterId: "26h",
      semesterLabel: "Høst 2026",
      courses: [{ code: "TDT4120", name: "Algoritmer", credits: 7.5 }],
    });
    expect(unfurlMeta(odd, "kari").description).toBe("1 emne · 7,5 sp · Høst 2026");
  });

  it("degrades to a safe title rather than throwing on junk", () => {
    expect(unfurlMeta("not json", "martin")).toEqual({
      title: "martin deler en plan",
      description: "Delt semesterplan",
    });
  });

  it("escapes markup so a course name cannot break out of the attribute", () => {
    const nasty = JSON.stringify({
      semesterId: "26h",
      semesterLabel: '"><script>alert(1)</script>',
      courses: [],
    });
    expect(unfurlMeta(nasty, "x").description).not.toContain("<script>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/worker/unfurl.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write minimal implementation**

```ts
// worker/src/unfurl.ts
/**
 * Link-preview text for a published plan.
 *
 * Unfurlers (Slack, iMessage, Discord, Facebook) fetch the page and read `og:`
 * tags; they do not read `X-Robots-Tag`. So this coexists with the noindex on
 * the same response, which is the whole point: rich in a chat, absent from
 * search.
 *
 * Pure and free of Workers globals so the Node typecheck pass can compile it.
 */
export function unfurlMeta(
  plain: string,
  navn: string,
): { title: string; description: string } {
  const title = `${navn} deler en plan`;
  try {
    const plan = JSON.parse(plain) as {
      semesterLabel?: unknown;
      courses?: Array<{ credits?: unknown }>;
    };
    const courses = Array.isArray(plan.courses) ? plan.courses : [];
    const credits = courses.reduce(
      (sum, c) => sum + (typeof c.credits === "number" ? c.credits : 0),
      0,
    );
    const label = typeof plan.semesterLabel === "string" ? plan.semesterLabel : "";
    const parts = [
      `${courses.length} ${courses.length === 1 ? "emne" : "emner"}`,
      `${String(credits).replace(".", ",")} sp`,
      ...(label === "" ? [] : [label]),
    ];
    return { title, description: escapeAttr(parts.join(" · ")) };
  } catch {
    return { title, description: "Delt semesterplan" };
  }
}

/** Course names and semester labels are upstream strings — never trust them in an attribute. */
function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
```

In `src/pages/user/index.astro`, give the shell replaceable defaults:

```astro
<meta property="og:title" content="Delt semesterplan" data-unfurl="title" />
<meta property="og:description" content="En semesterplan delt fra Semesterplan." data-unfurl="description" />
<meta property="og:type" content="website" />
<meta property="og:image" content="/og-card.png" />
<meta name="twitter:card" content="summary_large_image" />
```

In `worker/src/server.ts`, in the `/user/:navn` branch from Task 2, read the record and rewrite before returning:

```ts
const shell = await env.ASSETS.fetch(new Request(new URL("/user/index.html", url), request));
const record = env.SYNC ? await readPublic(name, env.SYNC) : null;
const withMeta =
  record === null
    ? shell
    : new HTMLRewriter()
        .on('meta[data-unfurl="title"]', {
          element: (e) => e.setAttribute("content", unfurlMeta(record.plain, name).title),
        })
        .on('meta[data-unfurl="description"]', {
          element: (e) => e.setAttribute("content", unfurlMeta(record.plain, name).description),
        })
        .transform(shell);
return withNoIndex(withSecurityHeaders(withMeta));
```

Add a static `public/og-card.png` (1200×630, the site name on the calendar ground from DESIGN.md).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/worker/unfurl.test.ts && npm run typecheck`
Expected: PASS (4 tests). If the Node pass complains about `HTMLRewriter`, the reference has leaked out of `server.ts` — move it back.

- [ ] **Step 5: Commit**

```bash
git add worker/src/unfurl.ts worker/src/server.ts src/pages/user/index.astro public/og-card.png tests/worker/unfurl.test.ts
git commit -m "feat(publish): rich link previews for shared plans"
```

---

### Task 7: End-to-end publish and view

**Files:**
- Create: `e2e/publish.pw.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: no exports.

- [ ] **Step 1: Write the failing test**

```ts
// e2e/publish.pw.ts
import { expect } from "@playwright/test";
import { test } from "./harness.js";

test("a published plan is viewable by a stranger and changes nothing for them", async ({
  browser,
}) => {
  const navn = `e2e-pub-${Date.now().toString(36)}`;
  const pin = "482913";

  const owner = await browser.newContext();
  const ownerPage = await owner.newPage();
  await ownerPage.goto("/planlegger/");
  await ownerPage.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    ["np:plans", '{"26h":[{"code":"TDT4120","name":"Algoritmer og datastrukturer"}]}'],
  );
  await ownerPage.reload();

  await ownerPage.getByRole("button", { name: "Profil" }).click();
  await ownerPage.getByLabel("Navn").fill(navn);
  await ownerPage.getByLabel("PIN (6 siffer)").fill(pin);
  await ownerPage.getByLabel("Gjenta PIN").fill(pin);
  await ownerPage.getByRole("button", { name: "Opprett konto" }).click();
  await ownerPage.keyboard.press("Escape");
  await ownerPage.getByRole("button", { name: "Del" }).click();

  const viewer = await browser.newContext();
  const viewerPage = await viewer.newPage();
  await viewerPage.evaluate(() =>
    localStorage.setItem("np:plans", '{"26h":[{"code":"MIN-EGEN","name":"Min egen"}]}'),
  );
  await viewerPage.goto(`/user/${navn}`);

  await expect(viewerPage.getByText("TDT4120")).toBeVisible({ timeout: 45_000 });
  await expect(viewerPage.getByRole("link", { name: "Lag din egen plan" })).toBeVisible();

  // The whole point: the viewer's own plan is untouched, and no prompt appeared.
  expect(await viewerPage.evaluate(() => localStorage.getItem("np:plans"))).toBe(
    '{"26h":[{"code":"MIN-EGEN","name":"Min egen"}]}',
  );
  await expect(viewerPage.getByText("Behold min egen")).toHaveCount(0);

  await owner.close();
  await viewer.close();
});

test("an unpublished name is a plain not-found, not an error page", async ({ page }) => {
  await page.goto("/user/finnes-ikke-i-det-hele-tatt");
  await expect(page.getByText("Fant ingen delt plan her.")).toBeVisible();
});

test("a published plan refuses indexing by header", async ({ request }) => {
  const res = await request.get("/user/whoever");
  expect(res.headers()["x-robots-tag"]).toBe("noindex, nofollow");
});

test("…and still unfurls richly, because those are different crawlers", async ({
  browser,
  request,
}) => {
  const navn = `e2e-unfurl-${Date.now().toString(36)}`;
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/planlegger/");
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    ["np:plans", '{"26h":[{"code":"TDT4120","name":"Algoritmer og datastrukturer"}]}'],
  );
  await page.reload();
  await page.getByRole("button", { name: "Profil" }).click();
  await page.getByLabel("Navn").fill(navn);
  await page.getByLabel("PIN (6 siffer)").fill("482913");
  await page.getByLabel("Gjenta PIN").fill("482913");
  await page.getByRole("button", { name: "Opprett konto" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Del" }).click();

  // What an unfurler sees: raw HTML, no JavaScript run.
  const html = await (await request.get(`/user/${navn}`)).text();
  expect(html).toContain(`content="${navn} deler en plan"`);
  expect(html).toMatch(/property="og:description" content="1 emne · /);

  await context.close();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/publish.pw.ts`
Expected: FAIL — no Del publish flow yet if Task 4 is incomplete; otherwise passes.

- [ ] **Step 3: Fix what the test finds**

No new production code should be needed. If the viewer's `localStorage` assertion fails, something in the view is still writing — find it and remove it rather than adjusting the assertion.

- [ ] **Step 4: Run the full suite**

Run: `mise run check && mise run e2e`
Expected: all green, no fixture misses in teardown.

- [ ] **Step 5: Commit**

```bash
git add e2e/publish.pw.ts
git commit -m "test(publish): a shared link views and never writes"
```

---

## Documentation follow-up (do this before opening a PR)

- [ ] **`docs/PRODUCT.md` §4 flow 5** — rewrite. The three actions (bruk denne / slå sammen / behold min egen) are gone; a link views. "Re-editable canonical plan" is now delivered by `/user/<navn>`.
- [ ] **`docs/PRODUCT.md` §6** — delete the hash-grammar section entirely and describe the published plan instead.
- [ ] **`docs/PRODUCT.md` D1** — amend: the shared plan stays co-primary, but as an artefact to view, not to adopt.
- [ ] **`docs/PRODUCT.md` §8** — **D13's "breaks shared-URL parity" veto no longer applies.** The week-scrubber and personal fixed blocks were killed partly on that ground. Do not revive them here; record that the argument is gone and would have to be remade on its own merits.
- [ ] **`docs/SPEC.md`** — remove the hash grammar from the data contracts; add `/api/sync/:navn/public`, `/api/plan/:navn` and the `/user/:navn` rewrite.
- [ ] **`CLAUDE.md`** — delete the hash references, and add the `robots.txt` trap: never `Disallow: /user/`, because a blocked crawl hides the noindex.
