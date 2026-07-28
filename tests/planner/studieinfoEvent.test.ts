/**
 * perf-4 split the open-studieinfo event name into its own leaf module so
 * `Layout.astro` stops dragging the whole dialog into every page's bundle.
 * Until `studieinfo.ts` imports it from there (routed), the literal exists in
 * two files — and two copies of an event name that drift apart is a silently
 * dead topbar chip, so pin them to each other here.
 */
import { describe, expect, it } from "vitest";
import { OPEN_STUDIEINFO_EVENT as fromDialog } from "../../src/components/planner/studieinfo.js";
import { OPEN_STUDIEINFO_EVENT as fromLeaf } from "../../src/components/planner/studieinfoEvent.js";

describe("OPEN_STUDIEINFO_EVENT", () => {
  it("is the same string the dialog listens for", () => {
    expect(fromLeaf).toBe(fromDialog);
  });

  it("is the documented np: event name", () => {
    expect(fromLeaf).toBe("np:open-studieinfo");
  });
});
