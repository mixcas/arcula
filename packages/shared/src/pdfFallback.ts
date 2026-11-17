/**
 * The Catalogue PDF fallback face's character rule.
 *
 * The export draws text in a Latin-only brand face, so every non-Latin
 * character it draws needs a TrueType subset of a bundled fallback face: the
 * web app asks the API for one subset per chunk of this rule's answer. Both
 * sides read the rule from here, so a character one side counts and the other
 * drops cannot silently draw blank.
 *
 * Pure by construction — no Node built-in and no DOM global — because the web
 * bundle and the API Lambda both import it. See `docs/specs/pdf-export.md`.
 */

import { MAX_PDF_FALLBACK_CODE_POINTS } from "./caps";

/**
 * The distinct non-ASCII code points in the drawn texts, ascending.
 *
 * Iterating with `for…of` walks code points, so an astral character is one
 * entry rather than two surrogate halves. The threshold is `> U+007F`, which
 * keeps DEL out along with the rest of ASCII: the brand face owns every ASCII
 * code point, and asking for one would only grow the subset.
 */
export const pdfFallbackCharacters = (texts: string[]): string => {
  const codePoints = new Set<number>();
  for (const text of texts) {
    for (const character of text) {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined && codePoint > 0x7f) {
        codePoints.add(codePoint);
      }
    }
  }
  return [...codePoints]
    .sort((a, b) => a - b)
    .map((codePoint) => String.fromCodePoint(codePoint))
    .join("");
};

/**
 * Split a character string into the chunks one subset request may carry.
 *
 * The cap is `MAX_PDF_FALLBACK_CODE_POINTS`, the same number the API refuses a
 * larger request with — the rule is not the cap, and the cap is not the rule.
 * Walking code points rather than UTF-16 code units is what keeps an astral
 * character from being split across two requests.
 */
export const pdfFallbackChunks = (characters: string): string[] => {
  const codePoints = Array.from(characters);
  const chunks: string[] = [];
  for (
    let index = 0;
    index < codePoints.length;
    index += MAX_PDF_FALLBACK_CODE_POINTS
  ) {
    chunks.push(
      codePoints.slice(index, index + MAX_PDF_FALLBACK_CODE_POINTS).join(""),
    );
  }
  return chunks;
};
