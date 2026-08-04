/**
 * Link-preview text for a shared plan.
 *
 * **Indexing and unfurling are different crawlers, and that is what lets both
 * requirements hold at once.** `X-Robots-Tag: noindex` governs Googlebot and
 * search results. Slack, iMessage, Discord, WhatsApp and Facebook's unfurlers
 * fetch the URL and read `og:` tags; they do not consult it. So a shared plan
 * previews richly in a chat and never appears in a search result.
 *
 * Pure, and free of Workers globals, so the Node typecheck pass can compile it
 * — `HTMLRewriter` lives in `server.ts` and must stay there.
 */

/** The fields of a published plan this module reads. Deliberately narrow. */
interface UnfurlablePlan {
  semesterLabel?: unknown;
  courses?: Array<{ credits?: unknown }>;
}

export function unfurlMeta(plain: string, navn: string): { title: string; description: string } {
  // The name is escaped even though `validateName` already refuses everything
  // but `[a-z0-9-]`: this string lands in an HTML attribute, and a defence that
  // depends on a check made in another file is a defence that expires.
  const title = `${escapeAttr(navn)} deler en plan`;
  try {
    const plan = JSON.parse(plain) as UnfurlablePlan;
    const courses = Array.isArray(plan.courses) ? plan.courses : [];
    const credits = courses.reduce(
      (sum, c) => sum + (typeof c?.credits === "number" ? c.credits : 0),
      0,
    );
    const label = typeof plan.semesterLabel === "string" ? plan.semesterLabel : "";
    const parts = [
      `${courses.length} ${courses.length === 1 ? "emne" : "emner"}`,
      // Omitted rather than printed as "0 sp": nobody published a figure, and
      // DR-6's honest gap does not become a zero because a preview wants one.
      ...(credits > 0 ? [`${formatCredits(credits)} sp`] : []),
      ...(label === "" ? [] : [label]),
    ];
    return { title, description: escapeAttr(parts.join(" · ")) };
  } catch {
    return { title, description: "Delt semesterplan" };
  }
}

/** Comma decimals, no trailing zero — `formatCreditNumber`'s rule, in a file
 *  the worker can compile. Rounded first, so float addition cannot print
 *  "22,499999999999996 sp". */
function formatCredits(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(".", ",");
}

/** Course names and semester labels are upstream strings and the account name
 *  is a stranger's — never trust any of them in an attribute. */
function escapeAttr(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
