import { describe, expect, it } from "vitest";
import { deriveKeys, open, seal } from "../../src/lib/planner/syncCrypto.js";

describe("deriveKeys", () => {
  it("is deterministic for the same name and PIN", async () => {
    const a = await deriveKeys("martin", "482913");
    const b = await deriveKeys("martin", "482913");
    expect(a).toEqual(b);
  });

  it("separates the two keys", async () => {
    const { authKey, encKeyRaw } = await deriveKeys("martin", "482913");
    expect(authKey).not.toBe(encKeyRaw);
    expect(authKey).toHaveLength(64);
    expect(encKeyRaw).toHaveLength(64);
  });

  it("changes completely with the PIN and with the name", async () => {
    const base = await deriveKeys("martin", "482913");
    expect((await deriveKeys("martin", "482914")).authKey).not.toBe(base.authKey);
    // Salt is name-derived, so two students who pick the same PIN never collide.
    expect((await deriveKeys("kari", "482913")).authKey).not.toBe(base.authKey);
  });
}, 30_000);

describe("seal/open", () => {
  it("round-trips a plan", async () => {
    const { encKeyRaw } = await deriveKeys("martin", "482913");
    const sealed = await seal(encKeyRaw, JSON.stringify({ courses: ["TDT4120"] }));
    expect(sealed).not.toContain("TDT4120");
    expect(await open(encKeyRaw, sealed)).toBe(JSON.stringify({ courses: ["TDT4120"] }));
  });

  it("returns null rather than throwing for the wrong key", async () => {
    const mine = await deriveKeys("martin", "482913");
    const theirs = await deriveKeys("martin", "999999");
    const sealed = await seal(mine.encKeyRaw, "hemmelig");
    expect(await open(theirs.encKeyRaw, sealed)).toBeNull();
  });

  it("returns null for corrupt input rather than throwing", async () => {
    const { encKeyRaw } = await deriveKeys("martin", "482913");
    expect(await open(encKeyRaw, "not-base64-at-all")).toBeNull();
  });

  it("uses a fresh IV per seal", async () => {
    const { encKeyRaw } = await deriveKeys("martin", "482913");
    expect(await seal(encKeyRaw, "x")).not.toBe(await seal(encKeyRaw, "x"));
  });
}, 30_000);
