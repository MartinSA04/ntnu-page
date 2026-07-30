import { describe, expect, it } from "vitest";
import { hueForIndex, PLAN_HUES } from "../../src/lib/planner/hues.js";

describe("hueForIndex", () => {
  it("assigns the six categorical hues in order", () => {
    expect(hueForIndex(0)).toBe("--hue-blue");
    expect(hueForIndex(1)).toBe("--hue-cyan");
    expect(hueForIndex(2)).toBe("--hue-purple");
    expect(hueForIndex(3)).toBe("--hue-magenta");
    expect(hueForIndex(4)).toBe("--hue-orange");
    expect(hueForIndex(5)).toBe("--hue-yellow");
  });

  it("cycles back to the first hue at index 6", () => {
    expect(hueForIndex(6)).toBe("--hue-blue");
    expect(hueForIndex(7)).toBe("--hue-cyan");
  });

  it("cycles again at 12", () => {
    expect(hueForIndex(12)).toBe("--hue-blue");
    expect(hueForIndex(13)).toBe(PLAN_HUES[1]);
  });

  it("never assigns the verdict or the collision ink", () => {
    // Both are spoken for: green says the term fits, red says two things
    // cannot coexist, and a course wearing either would make an identity look
    // like a judgement. The retired --accent is still listed — it is gone
    // (REWORK-2026-07-30), and a resurrected name must not quietly become
    // assignable.
    for (let i = 0; i < 20; i++) {
      expect(hueForIndex(i)).not.toBe("--verdict");
      expect(hueForIndex(i)).not.toBe("--accent");
      expect(hueForIndex(i)).not.toBe("--clash");
    }
  });
});
