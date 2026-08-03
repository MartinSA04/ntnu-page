import { describe, expect, it } from "vitest";
import { attemptAuth, deviceLabel, pinIsValid } from "../../src/components/planner/profilePanel.js";
import type { SyncClient, SyncResult } from "../../src/lib/planner/syncClient.js";

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

/** A `SyncClient` double: every method resolves/no-ops by default, so a test
 *  only has to override the one method it cares about. */
function fakeSyncClient(overrides: Partial<SyncClient> = {}): SyncClient {
  return {
    session: () => null,
    signup: async () => ({ ok: true }),
    login: async () => ({ ok: true }),
    push: async () => ({ ok: true }),
    pull: async () => ({ ok: true }),
    logout: () => {},
    ...overrides,
  };
}

describe("attemptAuth", () => {
  it("resolves ok on a normal successful signup", async () => {
    const sync = fakeSyncClient({ signup: async () => ({ ok: true }) as SyncResult });
    await expect(attemptAuth(sync, "signup", "Ola", "482913", "Mac · Safari")).resolves.toEqual({
      ok: true,
    });
  });

  it("maps a named failure reason to its Norwegian copy, through login as well as signup", async () => {
    const sync = fakeSyncClient({
      login: async () => ({ ok: false, reason: "bad_pin" }) as SyncResult,
    });
    await expect(attemptAuth(sync, "login", "Ola", "482913", "Mac · Safari")).resolves.toEqual({
      ok: false,
      hint: "Feil PIN.",
    });
  });

  /**
   * The same three fields feed both buttons, and Enter's `type="submit"`
   * routes to `signup` regardless of which the student meant (see the
   * comment above `signupBtn.type = "submit"` in `profilePanel.ts`) — so a
   * returning student setting up a second device is exactly as likely to
   * land on `taken` as a first-time student is to land on `no_account`.
   * Stopping at the fact ("Det navnet er tatt.") tells a student who already
   * owns the account nothing about how to get in; the copy has to name the
   * other button, on both sides, or one of the two populations dead-ends.
   */
  it("taken names Logg inn — the account already exists, so the way out is the other button", async () => {
    const sync = fakeSyncClient({
      signup: async () => ({ ok: false, reason: "taken" }) as SyncResult,
    });
    await expect(attemptAuth(sync, "signup", "Ola", "482913", "Mac · Safari")).resolves.toEqual({
      ok: false,
      hint: "Det navnet er tatt. Har du kontoen alt? Logg inn i stedet.",
    });
  });

  it("no_account names Opprett konto — the mirror of `taken`", async () => {
    const sync = fakeSyncClient({
      login: async () => ({ ok: false, reason: "no_account" }) as SyncResult,
    });
    await expect(attemptAuth(sync, "login", "Ola", "482913", "Mac · Safari")).resolves.toEqual({
      ok: false,
      hint: "Fant ingen konto med det navnet. Opprett konto i stedet.",
    });
  });

  /**
   * The regression this function exists to close: `syncClient.ts`'s
   * `signup`/`login` wrap no try/catch around their `fetch`, so offline/DNS/
   * CORS reject the promise outright instead of resolving
   * `{ ok: false, reason: "unavailable" }`. Before `attemptAuth` existed,
   * `submit()`'s bare `await deps.sync.signup(...)` threw past the two lines
   * that re-enable the buttons, leaving them permanently disabled with no
   * message — exactly the failure a student on a flaky phone connection is
   * most likely to hit.
   *
   * There is no DOM in this test environment (`document` is undefined here —
   * DOM assembly is covered by e2e, per this file's sibling tests), so this
   * asserts the guarantee `submit()`'s button-reset relies on directly: the
   * promise this function returns always RESOLVES, with the same generic
   * retry copy the catch-all "failed" reason already renders. A caller that
   * unconditionally runs its re-enable code right after `await`ing this
   * (as `submit()` does) can never be left with dead buttons.
   */
  it("never rejects — a signup that throws resolves the same generic retry copy a failed response would", async () => {
    const sync = fakeSyncClient({ signup: () => Promise.reject(new Error("network")) });
    await expect(attemptAuth(sync, "signup", "Ola", "482913", "Mac · Safari")).resolves.toEqual({
      ok: false,
      hint: "Noe gikk galt. Prøv igjen.",
    });
  });
});
