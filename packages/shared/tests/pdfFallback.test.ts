import { describe, expect, it } from "vitest";
import { MAX_PDF_FALLBACK_CODE_POINTS } from "../src/caps";
import { pdfFallbackCharacters, pdfFallbackChunks } from "../src/pdfFallback";

/**
 * The fallback face's character rule, pure (tier 1): the web app sends these
 * chunks and the API subsets the face from one of them, so a drift in which
 * characters count, in what order, or where a chunk ends draws a blank glyph
 * in an exported catalogue PDF. The fixed inputs come from the two suites this
 * rule replaces — the web preflight and the API subsetter — so the module is
 * pinned against what those two answer today.
 */
describe("pdfFallbackCharacters", () => {
  it("keeps distinct non-ASCII code points, duplicates dropped", () => {
    expect(pdfFallbackCharacters(["aéé中中"])).toBe("é中");
    expect(pdfFallbackCharacters(["Café 123 日本"])).toBe("é日本");
  });

  it("combines several texts into one set", () => {
    expect(pdfFallbackCharacters(["é", "abc", "中"])).toBe("é中");
  });

  it("sorts ascending by code point, so an astral character follows a BMP private-use one", () => {
    // ★ U+2605, ☆ U+2606, the emoji U+1F600 — and the duplicate ☆ drops.
    expect(pdfFallbackCharacters(["a☆★b☆😀"])).toBe("★☆😀");
    // A UTF-16 code-unit sort would put the emoji's lead surrogate (U+D83D)
    // before U+E000; by code point the private-use character comes first.
    expect(pdfFallbackCharacters(["😀\uE000"])).toBe("\uE000😀");
  });

  it("excludes U+007F (DEL) along with the rest of ASCII", () => {
    expect(pdfFallbackCharacters(["Cafe 123", "plain", "\u007f"])).toBe("");
    expect(pdfFallbackCharacters(["\u007f\u0080"])).toBe("\u0080");
  });

  it("is empty for no texts, empty texts and ASCII-only texts", () => {
    expect(pdfFallbackCharacters([])).toBe("");
    expect(pdfFallbackCharacters(["", "Cafe 123", "plain"])).toBe("");
  });

  it("keeps an astral character whole rather than as two surrogate halves", () => {
    const characters = pdfFallbackCharacters(["a😀b😀"]);

    expect(characters).toBe("😀");
    expect(Array.from(characters)).toHaveLength(1);
    expect(characters.codePointAt(0)).toBe(0x1f600);
  });

  it("answers the fixed inputs of the suites it replaces unchanged", () => {
    // The texts the web's preflight suite builds for a mixed-script catalogue.
    expect(
      pdfFallbackCharacters(["收藏", "Été 日本", "Ana", "Image unavailable"]),
    ).toBe("Éé收日本藏");

    // The full set the API suite admits at the cap: it answers itself, so a
    // long non-Latin catalogue keeps every character it asked for.
    const atCap = Array.from(
      { length: MAX_PDF_FALLBACK_CODE_POINTS },
      (_, index) => String.fromCodePoint(0x4e00 + index),
    ).join("");

    expect(pdfFallbackCharacters([atCap])).toBe(atCap);
  });

  it("answers a set one past the cap whole, rather than truncating at it", () => {
    // The cap is a request's, not the rule's: 513 distinct Han characters must
    // all come back, ascending and whole, or the character that fell off the
    // end draws blank in an exported catalogue PDF.
    const pastCap = Array.from(
      { length: MAX_PDF_FALLBACK_CODE_POINTS + 1 },
      (_, index) => String.fromCodePoint(0x4e00 + index),
    ).join("");

    const characters = pdfFallbackCharacters([pastCap]);

    expect(characters).toBe(pastCap);
    expect(Array.from(characters)).toHaveLength(
      MAX_PDF_FALLBACK_CODE_POINTS + 1,
    );

    // One past the cap is two chunks, and the second is the one character.
    const chunks = pdfFallbackChunks(characters);

    expect(chunks.map((chunk) => Array.from(chunk).length)).toEqual([
      MAX_PDF_FALLBACK_CODE_POINTS,
      1,
    ]);
    expect(chunks.join("")).toBe(pastCap);
  });
});

describe("pdfFallbackChunks", () => {
  it("answers no chunks for the empty string", () => {
    expect(pdfFallbackChunks("")).toEqual([]);
  });

  it("keeps one chunk for one character", () => {
    expect(pdfFallbackChunks("é")).toEqual(["é"]);
  });

  it("keeps one chunk at exactly the cap", () => {
    const atCap = "é".repeat(MAX_PDF_FALLBACK_CODE_POINTS);

    expect(pdfFallbackChunks(atCap)).toEqual([atCap]);
  });

  it("splits two chunks one code point past the cap", () => {
    expect(
      pdfFallbackChunks("é".repeat(MAX_PDF_FALLBACK_CODE_POINTS + 1)),
    ).toEqual(["é".repeat(MAX_PDF_FALLBACK_CODE_POINTS), "é"]);
  });

  it("splits by code point, never by UTF-16 unit, so an astral character stays whole", () => {
    // Each emoji is two UTF-16 units, so a string-length chunker would break
    // one in half and the API would receive a lone surrogate.
    const chunks = pdfFallbackChunks(
      "😀".repeat(MAX_PDF_FALLBACK_CODE_POINTS + 1),
    );

    expect(chunks).toHaveLength(2);
    expect(Array.from(chunks[0])).toHaveLength(MAX_PDF_FALLBACK_CODE_POINTS);
    expect(chunks[0]).toBe("😀".repeat(MAX_PDF_FALLBACK_CODE_POINTS));
    expect(chunks[1]).toBe("😀");
  });
});
