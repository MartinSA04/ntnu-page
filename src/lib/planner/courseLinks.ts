/**
 * WHERE A QUESTION ABOUT A COURSE GOES, now that it does not go anywhere here.
 *
 * PRODUCT mandate 3: this site draws a week and nothing else. What a course
 * covers, who teaches it, how it is assessed and how its grades fell are all
 * questions two other sites answer properly, so every surface that names a
 * course carries these two links instead of a thinner copy of their pages.
 *
 * The NTNU base URL comes from `ntnu-api`, not from a string here: upstream
 * NTNU endpoints live in that package (CLAUDE.md's layering rule), and the
 * course page is one. Karakterweb is not NTNU and has no business in that
 * package, so it is the one literal in this file.
 */
import { COURSE_PAGE_URL_NB } from "ntnu-api";

/** Karakterweb's NTNU section. Codes are lowercase in its paths. */
const KARAKTERWEB_URL = "https://karakterweb.no/ntnu";

/** One outbound destination for a course, as a row or a card draws it. */
export interface CourseLink {
  /** Visible text. Short: these sit inside a row that already names the course. */
  label: string;
  href: string;
  /** Accessible name, because "ntnu.no" alone does not say which course. */
  ariaLabel: string;
}

/**
 * The emnepage and the grade statistics, in that order.
 *
 * `year` threads through to NTNU's own URL shape (`{base}/{CODE}/{year}`) so a
 * plan for a past term links to the page that term was taught from. It is
 * optional because not every caller has one; without it NTNU redirects to the
 * current year, which is the right answer when we cannot say better.
 *
 * Karakterweb takes no year — its page IS the history, which is the whole
 * reason we link to it rather than drawing one.
 */
export function courseLinks(code: string, name: string, year?: number): CourseLink[] {
  const upper = code.toUpperCase();
  const segment = encodeURIComponent(upper);
  const subject = name === "" ? upper : `${upper} ${name}`;
  return [
    {
      label: "ntnu.no",
      href:
        year === undefined
          ? `${COURSE_PAGE_URL_NB}/${segment}`
          : `${COURSE_PAGE_URL_NB}/${segment}/${year}`,
      ariaLabel: `Emnesiden for ${subject} på ntnu.no`,
    },
    {
      label: "karakterweb",
      href: `${KARAKTERWEB_URL}/${encodeURIComponent(upper.toLowerCase())}`,
      ariaLabel: `Karakterstatistikk for ${subject} på karakterweb.no`,
    },
  ];
}
