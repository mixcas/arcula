// The fallback subset's own decisions: the bytes a request serves, and the
// bounds of the warm-Lambda cache. What a request text normalizes to is the
// shared rule's, tested beside it in `packages/shared/tests`; the route's
// refusals are `pdfFont.api.test.ts`. Harfbuzz's subsetting is not exercised,
// but its output is: `fontkit` parses the served bytes the way the renderer
// does, so a complete font is asserted rather than assumed.

import * as fontkit from "fontkit";
import { describe, expect, it } from "vitest";
import {
  createSubsetCache,
  fontSubsetFor,
  subsetCharacters,
} from "../src/pdfFontSubset";

const TTL_MS = 24 * 60 * 60 * 1000;

describe("the served subset", () => {
  // The served bytes are parsed exactly as the renderer parses them, so a
  // table the subsetter leaves out fails here rather than in a browser.
  const served = async (text: string) =>
    fontkit.create(
      Buffer.from(await fontSubsetFor(subsetCharacters(text))),
    ) as fontkit.Font;

  it("answers every requested character with a glyph", async () => {
    // A Latin accent, Han, a symbol and kana: four scripts the brand face
    // cannot draw, and one map only covers them if it is built from the
    // subset's own renumbered glyphs.
    const font = await served("é中★ア");

    for (const char of "é中★ア") {
      const codePoint = char.codePointAt(0)!;
      expect(font.hasGlyphForCodePoint(codePoint)).toBe(true);
      // 0 is .notdef: a real answer, not the missing-glyph fallback.
      expect(font.glyphForCodePoint(codePoint).id).toBeGreaterThan(0);
    }
  });

  it("carries the PostScript header the embedder reads", async () => {
    // PDFKit takes `post.isFixedPitch` and the italic angle from this table
    // while embedding; without it the document fails after every page is laid
    // out, which is the last place a missing table should surface.
    const font = await served("☆");
    const post = (font as unknown as { post?: { isFixedPitch: number } }).post;

    expect(post).toBeDefined();
    expect([0, 1]).toContain(post?.isFixedPitch);
  });

  it("answers nothing for a character that was not requested", async () => {
    const font = await served("é中");

    expect(font.hasGlyphForCodePoint(0x41)).toBe(false);
  });

  it("answers a requested character the face cannot draw without throwing", async () => {
    // Noto Sans SC has no emoji, so an emoji-only title asks for code points
    // with no glyph at all — the case where hb-subset writes a `cmap` with no
    // subtable, which makes the renderer throw instead of drawing `.notdef`.
    // The space the subset always asks for is what keeps the map non-empty.
    const font = await served("😀");

    expect(font.hasGlyphForCodePoint(0x1f600)).toBe(false);
  });
});

describe("the subset cache", () => {
  const bytes = (value: number) => new Uint8Array([value]);

  it("expires an entry after 24 hours", () => {
    let time = 0;
    const cache = createSubsetCache(() => time);

    cache.set("☆", bytes(1));
    time = TTL_MS;
    expect(cache.get("☆")).toEqual(bytes(1));

    time = TTL_MS + 1;
    expect(cache.get("☆")).toBeNull();
  });

  it("holds at most 32 entries and evicts the oldest insertion", () => {
    let time = 0;
    const cache = createSubsetCache(() => time);

    for (let index = 0; index < 32; index += 1) {
      time = index;
      cache.set(`k${index}`, bytes(index));
    }
    expect(cache.get("k0")).toEqual(bytes(0));

    time = 32;
    cache.set("k32", bytes(32));

    expect(cache.get("k0")).toBeNull();
    expect(cache.get("k1")).toEqual(bytes(1));
    expect(cache.get("k32")).toEqual(bytes(32));
  });
});
