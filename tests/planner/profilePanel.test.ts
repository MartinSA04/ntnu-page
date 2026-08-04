import { describe, expect, it } from "vitest";
import {
  attemptAuth,
  collisionLines,
  creditsFor,
  deviceLabel,
  pinIsValid,
} from "../../src/components/planner/profilePanel.js";
import type {
  LoginResult,
  SyncClient,
  SyncPayload,
  SyncResult,
} from "../../src/lib/planner/syncClient.js";

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

describe("creditsFor", () => {
  const withCredits = (rows: unknown[]): SyncPayload => ({
    profile: "{}",
    plans: JSON.stringify({ "26h": rows }),
    lastSemester: "26h",
    devices: [],
  });

  it("sums the semester's credits", () => {
    expect(
      creditsFor(
        withCredits([
          { code: "TDT4100", name: "A", credits: 7.5 },
          { code: "TDT4120", name: "B", credits: 7.5 },
        ]),
        "26h",
      ),
    ).toBe(15);
  });

  // The collision prompt is the one place these numbers are shown, and it
  // used to contradict the page: `activeCourses` is what "counts" everywhere
  // else, and a dropped course counts for nothing.
  it("does not count a dropped course", () => {
    expect(
      creditsFor(
        withCredits([
          { code: "TDT4100", name: "A", source: "program", credits: 7.5 },
          { code: "TDT4120", name: "B", source: "program", credits: 7.5, dropped: true },
        ]),
        "26h",
      ),
    ).toBe(7.5);
  });

  it("reads a missing or malformed semester as zero rather than throwing", () => {
    expect(creditsFor(withCredits([]), "27v")).toBe(0);
    expect(
      creditsFor({ profile: "{}", plans: "not json", lastSemester: "26h", devices: [] }, "26h"),
    ).toBe(0);
  });
});

/**
 * The one prompt this design keeps, and the copy defect that made it dangerous:
 * "Behold denne enheten" / "Behold <den andre>" swap the WHOLE `np:plans` map,
 * but the question described `lastSemester` alone. A student with a full 25h
 * plan and an empty 26h read "Denne enheten — 0 emner · 0 sp" against "MacBook
 * — 5 emner · 30 sp", pressed the obvious button, and lost the 25h draft the
 * prompt had never mentioned.
 */
describe("collisionLines", () => {
  const plans = (byId: Record<string, Array<{ code: string; credits?: number }>>): string =>
    JSON.stringify(
      Object.fromEntries(
        Object.entries(byId).map(([id, rows]) => [
          id,
          rows.map((row) => ({ ...row, name: row.code })),
        ]),
      ),
    );

  it("names every semester the choice would replace, not just the current one", () => {
    const local: SyncPayload = {
      profile: "{}",
      plans: plans({
        "25h": [
          { code: "TDT4100", credits: 7.5 },
          { code: "TDT4120", credits: 7.5 },
        ],
        "26h": [],
      }),
      lastSemester: "26h",
      devices: [],
    };
    const remote: SyncPayload = {
      profile: "{}",
      plans: plans({ "26h": [] }),
      lastSemester: "26h",
      devices: [],
    };

    expect(collisionLines(local, remote, "Mac · Safari")).toEqual([
      {
        semester: "Høst 2025",
        local: "Denne enheten — 2 emner · 15 sp",
        remote: "Mac · Safari — ingen emner · mangler TDT4100, TDT4120",
      },
    ]);
  });

  it("says what each side would lose, in both directions, with comma decimals", () => {
    const local: SyncPayload = {
      profile: "{}",
      plans: plans({ "27v": [{ code: "TMA4105", credits: 7.5 }] }),
      lastSemester: "27v",
      devices: [],
    };
    const remote: SyncPayload = {
      profile: "{}",
      plans: plans({ "27v": [{ code: "TMA4115", credits: 7.5 }] }),
      lastSemester: "27v",
      devices: [],
    };

    expect(collisionLines(local, remote, "iPhone · Safari")).toEqual([
      {
        semester: "Vår 2027",
        local: "Denne enheten — 1 emne · 7,5 sp · mangler TMA4115",
        remote: "iPhone · Safari — 1 emne · 7,5 sp · mangler TMA4105",
      },
    ]);
  });

  /** The load-bearing property: an ordinary second-device login, where this
   *  device holds nothing, is never asked anything at all. */
  it("has nothing to say when this device holds nothing", () => {
    const local: SyncPayload = { profile: "{}", plans: "{}", lastSemester: "", devices: [] };
    const remote: SyncPayload = {
      profile: "{}",
      plans: plans({ "26h": [{ code: "TDT4120", credits: 7.5 }] }),
      lastSemester: "26h",
      devices: [],
    };
    expect(collisionLines(local, remote, "Mac · Safari")).toEqual([]);
  });
});

/** A `SyncClient` double: every method resolves/no-ops by default, so a test
 *  only has to override the one method it cares about. */
function fakeSyncClient(overrides: Partial<SyncClient> = {}): SyncClient {
  return {
    session: () => null,
    signup: async () => ({ ok: true }),
    login: async () => ({ ok: true }),
    resolveLogin: async () => ({ ok: true }),
    changePin: async () => ({ ok: true }),
    push: async () => ({ ok: true }),
    fetchRemote: async () => ({ ok: false, reason: "no_session" }),
    applyRemote: () => {},
    setPublic: async () => ({ ok: true }),
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

  /**
   * §6 step 5's collision is a THIRD outcome, not a failure: it must reach
   * the caller with `local`/`remote` intact so the panel can render the
   * question, not collapse into `reasonCopy`'s generic retry hint the way
   * every other named `reason` does.
   */
  it("passes a login collision through as its own outcome, not a generic hint", async () => {
    const local: SyncPayload = { profile: "{}", plans: "{}", lastSemester: "26h", devices: [] };
    const remote: SyncPayload = { profile: "{}", plans: "{}", lastSemester: "26h", devices: [] };
    const sync = fakeSyncClient({
      login: async () => ({ ok: false, reason: "collision", local, remote }) as LoginResult,
    });
    await expect(attemptAuth(sync, "login", "Ola", "482913", "Mac · Safari")).resolves.toEqual({
      ok: false,
      collision: { local, remote },
    });
  });
});
