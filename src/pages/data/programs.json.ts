import programsData from "../../../data/programs.json";

/**
 * The programme typeahead's catalogue, as a build-time static file.
 *
 * It used to be a `<script type="application/json">` inlined into
 * `/planlegger/`, which was fine while the picker lived on exactly that page.
 * The picker is in the profile panel now, and the panel opens from the topbar
 * on every page — including the 5 470 `/emne/[code]/` documents. Inlining 27 KB
 * into each of those is 148 MB of build output saying the same thing 5 470
 * times; importing `data/programs.json` from a client module ships the whole
 * 332 KB crawler record instead, because a default JSON import is not
 * tree-shaken down to the four fields the picker reads.
 *
 * So: trimmed here, at build time, emitted once, fetched lazily by
 * `studieinfo.ts` the first time a student opens the panel. Same shape as
 * `/data/search-index.json`, which `/emner/` already reads this way.
 *
 * Trimmed tuples, not records: identity plus the two fields that tell two
 * same-named programmes apart. Sorted by name — the order the list renders in.
 */
export function GET(): Response {
  const options: [code: string, name: string, studyLevel: string, cities: string[]][] =
    programsData.programs
      .map((p): [string, string, string, string[]] => [
        p.code,
        p.name,
        p.studyLevel ?? "",
        p.cities ?? [],
      ])
      .sort((a, b) => a[1].localeCompare(b[1], "nb"));

  return new Response(JSON.stringify(options), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
