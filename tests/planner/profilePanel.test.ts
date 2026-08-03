import { describe, expect, it } from "vitest";
import { deviceLabel, pinIsValid } from "../../src/components/planner/profilePanel.js";

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
