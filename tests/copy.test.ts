/**
 * The copy gate.
 *
 * Two bans hold across every string a student can read:
 *
 *  - **No `—` and no `·`**, and no substitute mark. They were doing three
 *    unrelated jobs at once — sentence punctuation, field separation and brand
 *    separation — so none of them read as deliberate. The rewrite rule is
 *    "prose becomes sentences, data rows become spaced fields".
 *  - **No "tegne uka"**. The verb is wrong for this product: we assemble a week
 *    that already exists in NTNU's data, we do not invent one. The replacement
 *    idiom is "så er uka klar".
 *
 * This is a mechanism test, not a design assertion (CLAUDE.md): its failure
 * means someone reintroduced a banned mark or a struck word, which is a real
 * regression rather than a change of mind.
 *
 * Comments are stripped before scanning. The four docs and the code comments
 * are written in a heavily em-dashed register on purpose and rewriting ~900 of
 * them would bury the rule in a mechanical diff without changing anything
 * anyone reads.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Banned in user-facing strings, with no substitute mark permitted. */
const BANNED_MARKS = /[—·]/;
/**
 * "Tegne uka" and every inflection of it, including the one that puts a
 * pronoun in the middle ("så tegner vi uka di").
 */
const BANNED_PHRASE = /tegn\w*(\s+\w+){0,2}\s+uk[ae]/i;

/**
 * Removes block and line comments so the scan sees only code and strings.
 *
 * `//` is left alone when preceded by `:`, so a `https://` inside a string
 * literal does not swallow the rest of its line and hide a mark behind it.
 * Astro's braced template comments are block comments wrapped in braces, so
 * the first rule takes them too and leaves a bare pair of braces behind.
 *
 * A block comment is replaced by its OWN newlines rather than by nothing, so
 * the reported line numbers still point at the real file. Without that, every
 * offence in a heavily commented file is reported hundreds of lines above
 * where it lives, and the failure message sends its reader to the wrong place.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => "\n".repeat((block.match(/\n/g) ?? []).length))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every hand-written source file that can carry a user-facing string. */
function sourceFiles(): string[] {
  const out: string[] = [];
  for (const base of [join(ROOT, "src"), join(ROOT, "worker", "src")]) {
    walk(base, out);
  }
  return out;
}

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|astro)$/.test(entry.name)) out.push(full);
  }
}

describe("user-facing copy", () => {
  it("uses no em dash and no middle dot", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const stripped = stripComments(readFileSync(file, "utf8"));
      stripped.split("\n").forEach((line, i) => {
        if (BANNED_MARKS.test(line)) {
          offenders.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("never says tegne uka", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      if (BANNED_PHRASE.test(stripComments(readFileSync(file, "utf8")))) {
        offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
