// Enough of the WOFF2 header to list a file's sfnt table tags.
//
// It lives in its own module because two callers need it and only one of them
// may touch the network: `fetch-fonts.mjs` asserts on the bytes it just
// downloaded, and `tests/fonts.test.ts` asserts the same invariant against the
// files actually committed — which is the only run that happens on every CI
// build. Importing the fetch script from a test would re-fetch Google Fonts.
//
import { brotliDecompressSync } from "node:zlib";

// Known tables are encoded as a 6-bit index into the list below; 0x3f means a
// literal 4-byte tag follows. (WOFF2 spec §4.1, "Known Table Tags".)
const KNOWN_TABLES = [
  "cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post",
  "cvt ", "fpgm", "glyf", "loca", "prep", "CFF ", "VORG", "EBDT",
  "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea",
  "vmtx", "BASE", "GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH",
  "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt", "avar",
  "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar",
  "gvar", "hsty", "just", "lcar", "mort", "morx", "opbd", "prop",
  "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
];

function readUIntBase128(buf, cursor) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    const byte = buf[cursor.p++];
    value = ((value << 7) | (byte & 0x7f)) >>> 0;
    if ((byte & 0x80) === 0) return value;
  }
  throw new Error("malformed UIntBase128");
}

/**
 * The woff2 table directory: one `{ tag, length, offset }` per table, where
 * `offset` is into the DECOMPRESSED table stream (tables are concatenated
 * there in directory order, with no padding — WOFF2 spec §4.2).
 */
function woff2Directory(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a woff2 file");
  const numTables = buf.readUInt16BE(12);
  const cursor = { p: 48 }; // fixed header is 48 bytes
  const entries = [];
  let offset = 0;
  for (let i = 0; i < numTables; i++) {
    const flags = buf[cursor.p++];
    const known = flags & 0x3f;
    let tag;
    if (known === 0x3f) {
      tag = buf.toString("latin1", cursor.p, cursor.p + 4);
      cursor.p += 4;
    } else {
      tag = KNOWN_TABLES[known];
    }
    let length = readUIntBase128(buf, cursor); // origLength
    // glyf/loca are transformed by default (version 0); everything else is
    // only transformed when the version is non-zero. A transformed table
    // carries a second length, and that is the one it occupies in the stream.
    const version = (flags >> 6) & 0x03;
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    if (transformed) length = readUIntBase128(buf, cursor); // transformLength
    entries.push({ tag, length, offset });
    offset += length;
  }
  return { entries, streamStart: cursor.p };
}

/** Every sfnt table tag in a woff2 buffer, in file order. Throws on non-woff2. */
export function woff2Tables(buf) {
  return woff2Directory(buf).entries.map((e) => e.tag);
}

/**
 * The vertical metrics a metric-matched fallback face needs, in font units
 * plus the em they are measured against.
 *
 * Read straight from the file rather than kept in a table beside it, because
 * the two have to agree for the fallback to do its job at all: the whole point
 * of `ascent-override`/`descent-override` is that a line of Arial standing in
 * for a line of Schibsted Grotesk occupies exactly the same height, and a
 * refresh that shifted the real ascender by 20 units would otherwise leave the
 * override quietly wrong. `tests/fonts.test.ts` asserts fonts.css against what
 * this returns, so a drift fails CI instead.
 *
 * `hhea` is the source for ascent/descent, not OS/2's sTypo* pair: hhea is
 * what browsers use for the default line box on the platforms this ships to,
 * and it is what the override descriptors are compared against.
 */
export function woff2Metrics(buf) {
  const { entries, streamStart } = woff2Directory(buf);
  const compressed = buf.subarray(streamStart, buf.length);
  // Node ships brotli; woff2's whole table stream is one brotli block.
  const stream = brotliDecompressSync(compressed);

  const table = (tag) => {
    const entry = entries.find((e) => e.tag === tag);
    if (!entry) throw new Error(`no ${tag} table`);
    return stream.subarray(entry.offset, entry.offset + entry.length);
  };

  const head = table("head");
  const hhea = table("hhea");
  const os2 = table("OS/2");
  return {
    unitsPerEm: head.readUInt16BE(18),
    ascent: hhea.readInt16BE(4),
    descent: hhea.readInt16BE(6),
    lineGap: hhea.readInt16BE(8),
    // OS/2 v3+ defines this as the mean advance of every non-zero-width glyph.
    // It is what `size-adjust` is derived from — see scripts/fetch-fonts.mjs.
    xAvgCharWidth: os2.readInt16BE(2),
  };
}
