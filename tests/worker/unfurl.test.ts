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
      description: "2 emner, 15 sp, Høst 2026",
    });
  });

  it("uses a comma decimal for a half credit", () => {
    const odd = JSON.stringify({
      semesterId: "26h",
      semesterLabel: "Høst 2026",
      courses: [{ code: "TDT4120", name: "Algoritmer", credits: 7.5 }],
    });
    expect(unfurlMeta(odd, "kari").description).toBe("1 emne, 7,5 sp, Høst 2026");
  });

  it("omits a credit total nobody published rather than claiming 0 sp (DR-6)", () => {
    const unpriced = JSON.stringify({
      semesterId: "26h",
      semesterLabel: "Høst 2026",
      courses: [{ code: "TDT4120", name: "Algoritmer" }],
    });
    expect(unfurlMeta(unpriced, "kari").description).toBe("1 emne, Høst 2026");
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
    const meta = unfurlMeta(nasty, "x");
    expect(meta.description).not.toContain("<script>");
    expect(meta.description).not.toContain('"');
  });

  it("escapes the NAME too — it is a URL segment a stranger chose", () => {
    // `validateName` already refuses anything but `[a-z0-9-]`, so this is
    // belt and braces on a value that reaches an HTML attribute. Defence that
    // depends on a check made in another file is defence that expires.
    expect(unfurlMeta(PLAN, '"><img src=x onerror=alert(1)>').title).not.toContain("<img");
  });
});
