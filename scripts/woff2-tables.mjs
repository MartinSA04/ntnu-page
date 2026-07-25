// Enough of the WOFF2 header to list a file's sfnt table tags.
//
// It lives in its own module because two callers need it and only one of them
// may touch the network: `fetch-fonts.mjs` asserts on the bytes it just
// downloaded, and `tests/fonts.test.ts` asserts the same invariant against the
// files actually committed — which is the only run that happens on every CI
// build. Importing the fetch script from a test would re-fetch Google Fonts.
//
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

/** Every sfnt table tag in a woff2 buffer, in file order. Throws on non-woff2. */
export function woff2Tables(buf) {
  if (buf.toString("latin1", 0, 4) !== "wOF2") throw new Error("not a woff2 file");
  const numTables = buf.readUInt16BE(12);
  const cursor = { p: 48 }; // fixed header is 48 bytes
  const tags = [];
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
    tags.push(tag);
    readUIntBase128(buf, cursor); // origLength
    // glyf/loca are transformed by default (version 0); everything else is
    // only transformed when the version is non-zero. A transformed table
    // carries a second length.
    const version = (flags >> 6) & 0x03;
    const transformed = tag === "glyf" || tag === "loca" ? version === 0 : version !== 0;
    if (transformed) readUIntBase128(buf, cursor); // transformLength
  }
  return tags;
}
