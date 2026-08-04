import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BrowserContext, Route } from "@playwright/test";

/**
 * Record/replay for the `/api/*` surface, so the browser suite runs hermetically
 * and instantly by default.
 *
 * The suite exists to assert things about REAL NTNU data — TMA4400 partitioning
 * its lectures by programme cluster, EXPH0300's groups spread over three
 * cities, a course that vanished from this year's catalog. Every one of those
 * was a discovery, and a fixture written from what we already believed would
 * have shipped the bug green. So the facts are not abandoned: they move to
 * `contract.pw.ts`, which runs against live upstream and fails by NAME when one
 * of them stops being true. Everything else — does the modal close, do the
 * columns quantise, does the plan survive a navigation — does not care whose
 * data it is, and replays from disk.
 *
 * Three modes:
 *   default        replay from `e2e/fixtures/api/`; a miss falls through to the
 *                  worker and fails the run in teardown, so a fixture gap is
 *                  never silently a network call.
 *   E2E_RECORD=1   pass through and write what comes back.
 *   E2E_LIVE=1     pass through, write nothing. What CI's nightly run uses.
 *
 * `/data/search-index.json` is deliberately NOT intercepted: it is our own build
 * artifact, served out of `dist/`, and already deterministic for a given crawl.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, "fixtures", "api");
/** Keys served live because no fixture existed. Read by the global teardown. */
const MISSES = join(HERE, "fixtures", ".misses");

export const RECORDING = process.env.E2E_RECORD === "1";
export const LIVE = RECORDING || process.env.E2E_LIVE === "1";

/**
 * Routes about the transport rather than the data — see `handle`.
 *
 * `/api/sync/*` is ours, not NTNU's: replaying it would assert against a
 * recording of our own worker, and the account tests need real KV round trips.
 * `wrangler dev` provisions a local namespace from the `SYNC` binding, so these
 * hit the real handler with no network beyond localhost.
 *
 * `/api/plan/*` is the same surface read from the other side — the published
 * plan `/user/<navn>` fetches. Replaying it would answer the publish test with
 * a recording instead of the copy the test just wrote.
 */
const PASS_THROUGH = new Set(["GET /api/health"]);
const PASS_THROUGH_PREFIXES = ["/api/sync/", "/api/plan/"];

interface Fixture {
  /** The request this answers, for review — the file name is a digest. */
  url: string;
  status: number;
  contentType: string;
  body: unknown;
}

/**
 * Identity of a request: method, decoded path, and query in sorted order.
 *
 * Decoded because the worker decodes too (`parseCode`), so `MTIØT` and
 * `MTI%C3%98T` are one upstream resource and must not be two fixtures. Sorted
 * because `?year=&version=` and `?version=&year=` are the same question, and
 * the planner does not promise an order.
 */
export function fixtureKey(method: string, rawUrl: string): string {
  const url = new URL(rawUrl);
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  let path = url.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape is a route the worker 400s; key it as it arrived.
  }
  return `${method} ${path}${query === "" ? "" : `?${query}`}`;
}

/** Readable stem plus a digest, so two long codes cannot collide on one file. */
function fileFor(key: string): string {
  const stem = key
    .replace(/^GET /, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return join(DIR, `${stem}.${createHash("sha1").update(key).digest("hex").slice(0, 8)}.json`);
}

function write(key: string, fixture: Fixture): void {
  mkdirSync(DIR, { recursive: true });
  writeFileSync(fileFor(key), `${JSON.stringify(fixture, null, 2)}\n`);
}

function read(key: string): Fixture | null {
  const file = fileFor(key);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Fixture;
  } catch {
    return null;
  }
}

/**
 * Installs the layer on a whole context.
 *
 * On the CONTEXT rather than the page, because Playwright resolves page routes
 * before context routes — so a test that stubs a 503 for one course
 * (`flows.pw.ts`'s failure-honesty tests) still wins over this without having to
 * know it exists.
 */
export async function installApiFixtures(context: BrowserContext): Promise<void> {
  if (LIVE && !RECORDING) return;

  await context.route("**/api/**", async (route) => {
    try {
      await handle(route);
    } catch {
      // The page outlived the test and this request went with it. Nothing is
      // waiting on the answer, so give up quietly rather than fail a run that
      // has already finished.
      await route.abort().catch(() => undefined);
    }
  });

  async function handle(route: Route): Promise<void> {
    const request = route.request();
    const key = fixtureKey(request.method(), request.url());

    // `/api/health` reaches no upstream and carries no data — it is the route
    // `navigation.pw.ts` reads the worker's own security headers off. Replaying
    // it would answer that test with headers recorded at some past moment, so
    // it would pass over a worker that had stopped sending them.
    //
    // `/api/sync/*` is the other carve-out — see `PASS_THROUGH`'s own comment.
    const url = new URL(request.url());
    if (PASS_THROUGH.has(key) || PASS_THROUGH_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      await route.fallback();
      return;
    }

    if (!RECORDING) {
      const hit = read(key);
      if (hit) {
        await route.fulfill({
          status: hit.status,
          contentType: hit.contentType,
          body: JSON.stringify(hit.body),
        });
        return;
      }
      // A miss is recorded, not merely reported: a new test then works on the
      // first run and the store is hermetic on the second, instead of the gap
      // reappearing every time. The teardown still names it, so nothing is
      // added to the store without being told about it.
      mkdirSync(dirname(MISSES), { recursive: true });
      appendFileSync(MISSES, `${key}\n`);
    }

    const response = await route.fetch();
    const body = await response.text();
    const contentType = response.headers()["content-type"] ?? "application/json";
    if (contentType.includes("json")) {
      try {
        write(key, { url: request.url(), status: response.status(), contentType, body: JSON.parse(body) });
      } catch {
        // A non-JSON body under a JSON content type is upstream nonsense; let
        // the response through unrecorded rather than writing a broken fixture.
      }
    }
    await route.fulfill({ response, body });
  }
}

/**
 * Fails the run when anything had to be fetched live. The requests have been
 * written to the store by then, so the failure is "the store changed, look at
 * it and commit it" — which is a review step, not a rerun. A run that says
 * nothing is a run that touched no network.
 */
export function reportFixtureMisses(): void {
  if (!existsSync(MISSES)) return;
  const keys = [...new Set(readFileSync(MISSES, "utf8").split("\n").filter(Boolean))];
  writeFileSync(MISSES, "");
  if (keys.length === 0 || LIVE) return;
  throw new Error(
    [
      `${keys.length} request(s) had no fixture and were fetched live:`,
      ...keys.map((k) => `  ${k}`),
      "",
      "They are recorded now — review `git status e2e/fixtures/` and commit.",
      "To refresh the whole store against live upstream: npm run e2e:record",
    ].join("\n"),
  );
}
