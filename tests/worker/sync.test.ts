import { describe, expect, it } from "vitest";
import { validateName } from "../../worker/src/sync.js";

describe("validateName", () => {
  it("lowercases and accepts a plain name", () => {
    expect(validateName("Martin")).toBe("martin");
    expect(validateName("  martin-h26 ")).toBe("martin-h26");
  });

  it("rejects names that cannot sit in a URL segment", () => {
    expect(validateName("ma")).toBeNull(); // too short
    expect(validateName("a".repeat(25))).toBeNull(); // too long
    expect(validateName("martin_h26")).toBeNull(); // underscore
    expect(validateName("-martin")).toBeNull(); // leading dash
    expect(validateName("martin-")).toBeNull(); // trailing dash
    expect(validateName("martin/../etc")).toBeNull();
    expect(validateName("mårten")).toBeNull(); // ASCII only, it is a URL
  });

  it("rejects reserved words", () => {
    expect(validateName("api")).toBeNull();
    expect(validateName("user")).toBeNull();
  });
});
