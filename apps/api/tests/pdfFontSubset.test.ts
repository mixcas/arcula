// The fallback subset's own decisions: what a request normalizes to, the
// bounds of the warm-Lambda cache, and the one thing the bytes must be able to
// do — answer a character with a glyph. fontkit's subsetting is not exercised,
// but its output is: the subsetter leaves `cmap` out, and a renderer handed a
// font without one throws on the first text run, which no layout sees and no
// review reads.

import * as fontkit from "fontkit";
import { describe, expect, it } from "vitest";
import { ApiError } from "../src/errors";
import {
  createSubsetCache,
  fontSubsetFor,
  subsetCharacters,
} from "../src/pdfFontSubset";

const TTL_MS = 24 * 60 * 60 * 1000;

function validationOf(text: string): string | null {
  try {
    subsetCharacters(text);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    return (error as ApiError).code;
  }
}

describe("the request text", () => {
  it("keeps distinct non-ASCII code points, sorted by code point", () => {
    // ★ U+2605, ☆ U+2606, the emoji U+1F600 — and the duplicate ☆ drops.
    expect(subsetCharacters("a☆★b☆😀")).toBe("★☆😀");
    // A private-use BMP code point sorts before the astral emoji by code
    // point, though a UTF-16 code-unit sort would put the emoji first.
    expect(subsetCharacters("😀\uE000")).toBe("\uE000😀");
  });

  it("drops ASCII entirely, DEL included", () => {
    expect(validationOf("abc 123\u007f")).toBe("validation");
  });

  it("is empty when the text is empty", () => {
    expect(validationOf("")).toBe("validation");
  });

  it("rejects 513 distinct code points but accepts 512", () => {
    const run = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        String.fromCodePoint(0x4e00 + index),
      ).join("");

    expect(validationOf(run(512))).toBeNull();
    expect(validationOf(run(513))).toBe("validation");
  });
});

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
    // Noto Sans SC has no emoji, so an emoji title asks for a code point with
    // no glyph. The subset must answer .notdef rather than fail the renderer.
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
