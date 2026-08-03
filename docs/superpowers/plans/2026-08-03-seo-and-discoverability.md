# SEO and Discoverability — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Independent of** the sync and publish plans. Can land at any time.

**Goal:** The site is fully described to search engines and to link unfurlers, its 5470 course pages are reachable by crawlers without the sitemap, and it never once claims to be NTNU.

**Architecture:** `Layout.astro` gains a complete meta block (canonical, Open Graph, Twitter card) driven by per-page props. `/emne/[code]/` gains `BreadcrumbList` JSON-LD. `/emner/` gains a server-rendered index of every course so crawlers have a real link path. Nothing is asserted that Google no longer renders.

**Tech Stack:** Astro static build, JSON-LD, vitest.

## Global Constraints

- UI copy is **Norwegian bokmål, sentence case, comma decimals** ("7,5 sp").
- `mise run check` and `mise run e2e` must both stay green.
- **The site must never present itself as NTNU.** It is unofficial (PRODUCT §2). `provider: { "@type": "CollegeOrUniversity", "name": "NTNU" }` inside a `Course` entity is a factual statement about who teaches the course and is fine. `Organization` or `EducationalOrganization` markup naming this site as NTNU is impersonation of a real institution and must not be written.
- **No fabricated signals** (§8): no `aggregateRating`, no `review`, no enrolment or price markup. This rules out the only surviving Course rich result.
- Do not add `Disallow: /user/` to `robots.txt` — see the publish plan.
- JSON-LD only. Google recommends no other format.

## Two facts that bound this work

1. **`Course` rich results no longer exist.** Google retired Course Info in June 2025; only Course *review* snippets survive, and those need ratings this product refuses to invent. So `Course` JSON-LD is written for general machine readability, **not** because it will render a card. Do not promise one in a commit message.
2. **The hostname is a placeholder.** `astro.config.mjs`'s `site` and `public/robots.txt`'s `Sitemap:` both say `ntnu.martinsundal.no`, and `tests/site/discoverability.test.ts` asserts they agree. Everything here is inert until those change together at the first real deploy. Task 1 makes that a single point of change instead of two.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/lib/siteMeta.ts` (new) | One source of truth for the canonical origin, plus `pageMeta()` building the tag set. |
| `src/layouts/Layout.astro` (modify) | Render canonical + Open Graph + Twitter tags from props. |
| `src/pages/emne/[code].astro` (modify) | Per-course meta and `BreadcrumbList` JSON-LD. |
| `src/pages/emner/index.astro` (modify) | Server-rendered crawlable index of all courses. |
| `public/og-card.png` (new) | The default preview image, 1200×630. |
| `tests/site/discoverability.test.ts` (modify) | Extend the existing host-agreement assertions. |
| `tests/site/meta.test.ts` (new) | Built-HTML assertions over `dist/`. |

---

### Task 1: One origin, and the meta builder

**Files:**
- Create: `src/lib/siteMeta.ts`
- Test: `tests/site/meta.test.ts`
- Modify: `tests/site/discoverability.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `SITE_ORIGIN: string`
  - `canonicalUrl(pathname: string): string`
  - `pageMeta(input: { title: string; description: string; pathname: string; image?: string }): PageMeta`
  - `interface PageMeta { canonical: string; ogTitle: string; ogDescription: string; ogUrl: string; ogImage: string; twitterCard: "summary_large_image" }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/site/meta.test.ts
import { describe, expect, it } from "vitest";
import { canonicalUrl, pageMeta, SITE_ORIGIN } from "../../src/lib/siteMeta.js";

describe("canonicalUrl", () => {
  it("builds an absolute URL with a trailing slash, matching what the sitemap emits", () => {
    expect(canonicalUrl("/emne/TDT4120/")).toBe(`${SITE_ORIGIN}/emne/TDT4120/`);
    expect(canonicalUrl("/emne/TDT4120")).toBe(`${SITE_ORIGIN}/emne/TDT4120/`);
    expect(canonicalUrl("/")).toBe(`${SITE_ORIGIN}/`);
  });

  it("never doubles a slash", () => {
    expect(canonicalUrl("//emner//")).not.toContain("//emner");
  });
});

describe("pageMeta", () => {
  it("fills every tag the layout renders", () => {
    const meta = pageMeta({
      title: "TDT4120 · Semesterplan",
      description: "Algoritmer og datastrukturer",
      pathname: "/emne/TDT4120/",
    });
    expect(meta).toEqual({
      canonical: `${SITE_ORIGIN}/emne/TDT4120/`,
      ogTitle: "TDT4120 · Semesterplan",
      ogDescription: "Algoritmer og datastrukturer",
      ogUrl: `${SITE_ORIGIN}/emne/TDT4120/`,
      ogImage: `${SITE_ORIGIN}/og-card.png`,
      twitterCard: "summary_large_image",
    });
  });

  it("takes an explicit image over the default", () => {
    const meta = pageMeta({
      title: "t",
      description: "d",
      pathname: "/",
      image: "/annet.png",
    });
    expect(meta.ogImage).toBe(`${SITE_ORIGIN}/annet.png`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/site/meta.test.ts`
Expected: FAIL — cannot resolve the module.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/siteMeta.ts
/**
 * One source of truth for the site's absolute origin.
 *
 * It is duplicated in `astro.config.mjs` (`site`, which the sitemap uses) and
 * in `public/robots.txt` (`Sitemap:`), and all three are still the placeholder
 * `ntnu.martinsundal.no`. `tests/site/discoverability.test.ts` asserts they
 * agree, so changing one alone fails the build — which is the point, because a
 * mismatched origin publishes canonical tags for a host that does not exist.
 */
export const SITE_ORIGIN = "https://ntnu.martinsundal.no";

/**
 * Absolute, trailing-slashed. Astro's sitemap emits trailing slashes, and a
 * canonical that disagrees with the sitemap is worse than no canonical.
 */
export function canonicalUrl(pathname: string): string {
  const clean = `/${pathname.split("/").filter(Boolean).join("/")}`;
  return clean === "/" ? `${SITE_ORIGIN}/` : `${SITE_ORIGIN}${clean}/`;
}

export interface PageMeta {
  canonical: string;
  ogTitle: string;
  ogDescription: string;
  ogUrl: string;
  ogImage: string;
  twitterCard: "summary_large_image";
}

export function pageMeta(input: {
  title: string;
  description: string;
  pathname: string;
  image?: string;
}): PageMeta {
  const url = canonicalUrl(input.pathname);
  return {
    canonical: url,
    ogTitle: input.title,
    ogDescription: input.description,
    ogUrl: url,
    ogImage: `${SITE_ORIGIN}${input.image ?? "/og-card.png"}`,
    twitterCard: "summary_large_image",
  };
}
```

Then extend `tests/site/discoverability.test.ts` so `SITE_ORIGIN` joins the existing host-agreement assertion — read the file first and add to the assertion it already makes rather than writing a second one.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/site/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/siteMeta.ts tests/site/meta.test.ts tests/site/discoverability.test.ts
git commit -m "feat(seo): single canonical origin and page meta builder"
```

---

### Task 2: Render the meta block

**Files:**
- Modify: `src/layouts/Layout.astro`
- Create: `public/og-card.png`
- Test: `tests/site/meta.test.ts`

**Interfaces:**
- Consumes: `pageMeta` (Task 1).
- Produces: every page emits `<link rel="canonical">`, `og:title`, `og:description`, `og:url`, `og:image`, `og:type`, `og:site_name`, `og:locale`, `twitter:card`.

The layout already takes `title` and `description` props (`Layout.astro:89`). Add an optional `image` and derive the path from `Astro.url.pathname`.

`og:locale` is `nb_NO` — the UI is Norwegian bokmål and saying so costs one line.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/site/meta.test.ts
import { readFileSync } from "node:fs";

/** Reads the BUILT page — `mise run e2e` builds `dist/`, and so does `npm run build`. */
function built(path: string): string {
  return readFileSync(`dist/${path}`, "utf8");
}

describe("built pages carry a complete meta block", () => {
  it("gives the planner a canonical URL and Open Graph tags", () => {
    const html = built("planlegger/index.html");
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/planlegger/"`);
    expect(html).toMatch(/property="og:title"/);
    expect(html).toMatch(/property="og:description"/);
    expect(html).toContain(`property="og:url" content="${SITE_ORIGIN}/planlegger/"`);
    expect(html).toContain('property="og:locale" content="nb_NO"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
  });

  it("gives a course page its own canonical, not the site root's", () => {
    const html = built("emne/TDT4120/index.html");
    expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/emne/TDT4120/"`);
  });

  it("never claims to be NTNU", () => {
    const html = built("index.html");
    expect(html).not.toMatch(/"@type"\s*:\s*"(Educational)?Organization"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run tests/site/meta.test.ts`
Expected: FAIL — no canonical tag in the built HTML.

- [ ] **Step 3: Write minimal implementation**

In `src/layouts/Layout.astro`'s frontmatter:

```ts
import { pageMeta } from "../lib/siteMeta.js";
const meta = pageMeta({ title, description, pathname: Astro.url.pathname, image });
```

and in `<head>`, beside the existing `<meta name="description">`:

```astro
<link rel="canonical" href={meta.canonical} />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Semesterplan" />
<meta property="og:locale" content="nb_NO" />
<meta property="og:title" content={meta.ogTitle} />
<meta property="og:description" content={meta.ogDescription} />
<meta property="og:url" content={meta.ogUrl} />
<meta property="og:image" content={meta.ogImage} />
<meta name="twitter:card" content={meta.twitterCard} />
```

Add `image?: string` to the layout's `Props`. Create `public/og-card.png` at 1200×630 on DESIGN.md's calendar ground — the product name and the one-line promise, no NTNU marks or logotype.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx vitest run tests/site/meta.test.ts && npm run lint`
Expected: PASS (5 tests), lint clean.

- [ ] **Step 5: Commit**

```bash
git add src/layouts/Layout.astro public/og-card.png tests/site/meta.test.ts
git commit -m "feat(seo): canonical, Open Graph and Twitter meta on every page"
```

---

### Task 3: `BreadcrumbList` on course pages

**Files:**
- Modify: `src/pages/emne/[code].astro`
- Test: `tests/site/meta.test.ts`

**Interfaces:**
- Consumes: `SITE_ORIGIN` (Task 1).
- Produces: a `<script type="application/ld+json">` carrying `BreadcrumbList`, and a `Course` entity for general machine readability.

**`BreadcrumbList` is the only rich result available here.** `Course` is written because it is true and machine-readable, **not** because Google will render it — Course Info was retired in June 2025. No `aggregateRating` and no `offers`: §8 forbids fabricated signals, and we have no price.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/site/meta.test.ts
describe("course page structured data", () => {
  it("emits a breadcrumb trail to the course", () => {
    const html = built("emne/TDT4120/index.html");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
      (m) => JSON.parse(m[1] as string),
    );
    const crumbs = blocks.find((b) => b["@type"] === "BreadcrumbList");
    expect(crumbs).toBeDefined();
    expect(crumbs.itemListElement).toHaveLength(3);
    expect(crumbs.itemListElement[2]).toMatchObject({
      position: 3,
      name: "TDT4120",
      item: `${SITE_ORIGIN}/emne/TDT4120/`,
    });
  });

  it("names NTNU as the course provider but never as this site", () => {
    const html = built("emne/TDT4120/index.html");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
      (m) => JSON.parse(m[1] as string),
    );
    const course = blocks.find((b) => b["@type"] === "Course");
    expect(course.provider).toMatchObject({ "@type": "CollegeOrUniversity", name: "NTNU" });
    expect(course.publisher).toBeUndefined();
  });

  it("fabricates no ratings or offers", () => {
    const html = built("emne/TDT4120/index.html");
    expect(html).not.toMatch(/aggregateRating|"offers"|"review"/);
  });

  it("escapes a closing script tag inside a course name", () => {
    // `</script` inside JSON-LD ends the block early — same hazard the planner
    // already guards in `index.astro`'s `programOptionsJson`.
    const html = built("emne/TDT4120/index.html");
    expect(html).not.toMatch(/<\/script>\s*[^<\s]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run tests/site/meta.test.ts`
Expected: FAIL — no `application/ld+json` block on the page.

- [ ] **Step 3: Write minimal implementation**

In `src/pages/emne/[code].astro`'s frontmatter, build both entities and serialise them with the same `</script` guard the planner already uses (`planlegger/index.astro:28` — `.replaceAll("<", "\\u003c")` keeps the JSON valid while the parser sees the original character):

```ts
import { canonicalUrl, SITE_ORIGIN } from "../../lib/siteMeta.js";

const breadcrumbs = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Semesterplan", item: `${SITE_ORIGIN}/` },
    { "@type": "ListItem", position: 2, name: "Emner", item: `${SITE_ORIGIN}/emner/` },
    { "@type": "ListItem", position: 3, name: code, item: canonicalUrl(`/emne/${code}/`) },
  ],
};

// Written because it is true and machine-readable. Google retired the Course
// rich result in June 2025, so this renders no card — do not add ratings to
// chase one.
const courseEntity = {
  "@context": "https://schema.org",
  "@type": "Course",
  name: `${code} — ${courseName}`,
  courseCode: code,
  url: canonicalUrl(`/emne/${code}/`),
  inLanguage: "nb",
  provider: { "@type": "CollegeOrUniversity", name: "NTNU", url: "https://www.ntnu.no" },
};

const ldJson = (value: unknown): string =>
  JSON.stringify(value).replaceAll("<", "\\u003c");
```

and in the template:

```astro
<script type="application/ld+json" set:html={ldJson(breadcrumbs)} />
<script type="application/ld+json" set:html={ldJson(courseEntity)} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx vitest run tests/site/meta.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/pages/emne/\[code\].astro tests/site/meta.test.ts
git commit -m "feat(seo): breadcrumb and course structured data"
```

---

### Task 4: Make the 5470 course pages crawlable without the sitemap

**Files:**
- Modify: `src/pages/emner/index.astro`
- Modify: `public/robots.txt`
- Test: `tests/site/meta.test.ts`

**Interfaces:**
- Consumes: the same course list `/emner/` already loads.
- Produces: a server-rendered `<a href>` to every course page.

**This is the highest-value item in the plan and it is not markup.** `public/robots.txt` records the problem in its own first line: *"The 5470 course pages are only reachable through the sitemap: /emner/ builds its rows in the browser, so no server-rendered page links to /emne/."* A sitemap gets a page crawled; internal links are what make it worth ranking. Every course page currently sits at crawl-depth infinity.

Render the full list at build time inside the existing register markup, and let the client-side search continue to filter it — the rows exist in the HTML either way, so this also removes a whole class of no-JS emptiness.

If 5470 anchors proves too heavy for one document, fall back to a paginated `/emner/side/N/` set, still fully linked. **Do not** silently ship a truncated list: `log` what was dropped, or the register claims a completeness it does not have.

- [ ] **Step 1: Write the failing test**

```ts
// append to tests/site/meta.test.ts
describe("course pages are reachable by a crawler", () => {
  it("links to course pages from server-rendered HTML", () => {
    const html = built("emner/index.html");
    const links = [...html.matchAll(/href="\/emne\/([A-ZÆØÅ0-9-]+)\//g)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(1000);
    expect(links).toContain("TDT4120");
  });

  it("keeps robots.txt honest once the links exist", () => {
    const robots = readFileSync("public/robots.txt", "utf8");
    expect(robots).not.toMatch(/only reachable through the sitemap/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npx vitest run tests/site/meta.test.ts`
Expected: FAIL — zero `/emne/` links in the built register.

- [ ] **Step 3: Write minimal implementation**

In `src/pages/emner/index.astro`, read the crawled course list in the frontmatter (the same artifact the page already fetches at runtime, available at build time under `data/`) and render every row as a real anchor. Keep the client-side filter operating on the rendered rows rather than replacing them.

Then rewrite `public/robots.txt`'s opening comment: the pages are now linked from `/emner/`, and the sitemap is a supplement rather than the only path.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npx vitest run tests/site/ && mise run e2e`
Expected: PASS. Watch `e2e/cls.pw.ts` — a much larger `/emner/` document changes that page's layout timing, and its budget is asserted. If it regresses, reserve the list's height rather than loosening the budget.

- [ ] **Step 5: Commit**

```bash
git add src/pages/emner/index.astro public/robots.txt tests/site/meta.test.ts
git commit -m "feat(seo): link every course page from the register"
```

---

## Documentation follow-up (do this before opening a PR)

- [ ] **`docs/SPEC.md`** — record `src/lib/siteMeta.ts` as the single origin, and that `astro.config.mjs`, `robots.txt` and it are asserted to agree.
- [ ] **`CLAUDE.md`** — add: `Course` structured data renders no rich result (retired June 2025) and exists for machine readability only; never add ratings or offers to chase one; the site must never carry `Organization` markup naming NTNU.
- [ ] **`docs/ROADMAP.md`** — note the hostname swap as a first-deploy checklist item touching three files.
