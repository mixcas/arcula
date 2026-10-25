// The tables a fontkit subset does not carry, and a renderer needs.
//
// fontkit's TrueType subsetter is glyph-only on purpose: it writes head, hhea,
// loca, maxp, cvt, prep, fpgm, glyf and hmtx, and stops, because a PDF writer
// supplies the encoding and the font descriptor itself. The client is not that
// writer — it is a renderer that lays text out and then embeds the font again:
//
//  - `cmap`, or React-PDF cannot answer "does this family have this glyph?"
//    and throws on the first text run;
//  - `post`, or PDFKit throws half-way through `embed()` on `post.isFixedPitch`
//    and the whole document fails after every page is laid out.
//
// So this module puts both back: the character → glyph pairs the subsetter
// returned, as a format 12 `cmap` (Unicode, full repertoire), and a version 3.0
// `post` carrying the source face's header fields. Both are spliced into the
// sfnt by the same rebuilt directory.
//
// The binary work here is ours to get right, so it is pure and tested: the
// table records are sorted by tag, every table is four-byte aligned, checksums
// are taken over the padded table, and `head`'s `checkSumAdjustment` is
// recomputed over the finished file.

/** One character the renderer must be able to look up in the served font. */
export interface CharacterMapEntry {
  codePoint: number;
  /** The glyph id in the *subset*, not in the source face. */
  glyphId: number;
}

const SFNT_HEADER_SIZE = 12;
const TABLE_RECORD_SIZE = 16;
/** Per the OpenType spec, the whole file must sum to this. */
const SFNT_CHECKSUM_MAGIC = 0xb1b0afba;

const pad4 = (length: number): number => (length + 3) & ~3;

const sum32 = (bytes: Uint8Array): number => {
  let sum = 0;
  for (let index = 0; index + 4 <= bytes.length; index += 4) {
    const word =
      (bytes[index] << 24) |
      (bytes[index + 1] << 16) |
      (bytes[index + 2] << 8) |
      bytes[index + 3];
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum;
};

const tagBytes = (tag: string): Uint8Array =>
  Uint8Array.from([...tag].map((char) => char.charCodeAt(0)));

const tagAt = (bytes: Uint8Array, offset: number): string =>
  String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );

/**
 * A format 12 `cmap`: one subtable, Windows platform, UCS-4 encoding, one
 * group per code point.
 *
 * A group is a range, and a single code point is a range of one, which lets
 * scattered characters share one map without a format 4 segment search — and
 * covers astral code points, which format 4 cannot.
 */
export function buildCharacterMap(
  entries: CharacterMapEntry[],
): Uint8Array<ArrayBuffer> {
  const groups = [...entries].sort((a, b) => a.codePoint - b.codePoint);
  const subtableLength = 16 + groups.length * 12;
  const table = new Uint8Array(12 + subtableLength);
  const view = new DataView(table.buffer);

  view.setUint16(0, 0); // version
  view.setUint16(2, 1); // numTables
  view.setUint16(4, 3); // platformID: Windows
  view.setUint16(6, 10); // encodingID: Unicode UCS-4
  view.setUint32(8, 12); // the single subtable starts here

  view.setUint16(12, 12); // format
  view.setUint16(14, 0); // reserved
  view.setUint32(16, subtableLength);
  view.setUint32(20, 0); // language
  view.setUint32(24, groups.length);

  groups.forEach((entry, index) => {
    const base = 28 + index * 12;
    view.setUint32(base, entry.codePoint);
    view.setUint32(base + 4, entry.codePoint);
    view.setUint32(base + 8, entry.glyphId);
  });

  return table;
}

interface TableBody {
  tag: string;
  data: Uint8Array;
  padded: Uint8Array;
  offset: number;
}

/**
 * The font with `tag` set to `table`, every table relocated.
 *
 * The sfnt version is copied from the input, so a `true` or `OTTO` file keeps
 * its flavour. `head` is checksummed with its `checkSumAdjustment` zeroed, as
 * the spec requires, and the finished file's adjustment is written last.
 */
export function appendTable(
  font: Uint8Array,
  tag: string,
  table: Uint8Array,
): Uint8Array<ArrayBuffer> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const version = view.getUint32(0);
  const numTables = view.getUint16(4);

  const copied: Array<{ tag: string; data: Uint8Array }> = [];
  for (let index = 0; index < numTables; index += 1) {
    const record = SFNT_HEADER_SIZE + index * TABLE_RECORD_SIZE;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    copied.push({
      tag: tagAt(font, record),
      data: font.slice(offset, offset + length),
    });
  }
  copied.push({ tag, data: table });
  copied.sort((a, b) => (a.tag < b.tag ? -1 : 1));

  const count = copied.length;
  const entrySelector = Math.floor(Math.log2(count));
  const searchRange = TABLE_RECORD_SIZE * 2 ** entrySelector;

  let total = SFNT_HEADER_SIZE + count * TABLE_RECORD_SIZE;
  const bodies: TableBody[] = copied.map(({ tag: name, data }) => {
    // The spec checksums `head` as if the adjustment were zero.
    const bytes = name === "head" ? Uint8Array.from(data) : data;
    if (name === "head") {
      bytes.fill(0, 8, 12);
    }
    const padded = new Uint8Array(pad4(bytes.length));
    padded.set(bytes);
    const body = { tag: name, data: bytes, padded, offset: total };
    total += padded.length;
    return body;
  });

  const out = new Uint8Array(total);
  const outView = new DataView(out.buffer);
  outView.setUint32(0, version);
  outView.setUint16(4, count);
  outView.setUint16(6, searchRange);
  outView.setUint16(8, entrySelector);
  outView.setUint16(10, count * TABLE_RECORD_SIZE - searchRange);

  bodies.forEach((body, index) => {
    const record = SFNT_HEADER_SIZE + index * TABLE_RECORD_SIZE;
    out.set(tagBytes(body.tag), record);
    outView.setUint32(record + 4, sum32(body.padded));
    outView.setUint32(record + 8, body.offset);
    outView.setUint32(record + 12, body.data.length);
    out.set(body.padded, body.offset);
  });

  const head = bodies.find((body) => body.tag === "head");
  if (head) {
    outView.setUint32(
      head.offset + 8,
      (SFNT_CHECKSUM_MAGIC - sum32(out)) >>> 0,
    );
  }

  return out;
}

/** The `post` header fields PDFKit reads when it embeds the face. */
export interface PostHeader {
  /** A 16.16 fixed-point angle, as the source face carries it. */
  italicAngle: number;
  underlinePosition: number;
  underlineThickness: number;
  isFixedPitch: boolean;
}

/**
 * A version 3.0 `post` table: the header only, no glyph names.
 *
 * Version 3 is the right shape here — the subset's glyphs are renumbered, so
 * any name table would name the wrong glyphs — and everything PDFKit reads
 * (fixed pitch, italic angle, underline placement) lives in the header.
 */
export function buildPostTable(header: PostHeader): Uint8Array<ArrayBuffer> {
  const table = new Uint8Array(32);
  const view = new DataView(table.buffer);
  view.setUint32(0, 0x00030000); // version 3.0
  view.setInt32(4, Math.round(header.italicAngle * 65536));
  view.setInt16(8, header.underlinePosition);
  view.setInt16(10, header.underlineThickness);
  view.setUint32(12, header.isFixedPitch ? 1 : 0);
  // The four MIN/MAX memory hints mean nothing for a subset and stay zero.
  return table;
}

/** The subset with the tables its renderer needs and the subsetter omits. */
export function withRendererTables(
  font: Uint8Array,
  entries: CharacterMapEntry[],
  post: PostHeader,
): Uint8Array<ArrayBuffer> {
  return appendTable(
    appendTable(font, "cmap", buildCharacterMap(entries)),
    "post",
    buildPostTable(post),
  );
}
