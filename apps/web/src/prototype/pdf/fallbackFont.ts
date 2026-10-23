/**
 * PROTOTYPE (#129) — the PDF's font fallback.
 *
 * The renderer embeds its own fonts, so the browser's fallback never runs and
 * a title with a glyph Darker Grotesque lacks renders blank. `@react-pdf`
 * substitutes per code point across a `fontFamily` stack, so this module
 * provides the second family: a TTF subset of exactly the non-ASCII characters
 * the export will draw, minted by the API's prototype route.
 */

import { Font } from "@react-pdf/renderer";

export const FALLBACK_FAMILY = "Arcula Fallback";

/** Distinct non-ASCII characters in the drawn text, sorted. */
export const fallbackCharacters = (texts: string[]): string => {
  const chars = new Set<string>();
  for (const text of texts) {
    for (const char of text) {
      if ((char.codePointAt(0) ?? 0) > 0x7e) chars.add(char);
    }
  }
  return [...chars].sort().join("");
};

const toDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error("the font could not be read as a data URL"));
      }
    };
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });

export interface FallbackFont {
  family: string;
  characters: number;
  bytes: number;
}

/**
 * Registers the fallback family and returns it, or null when the text is all
 * ASCII or the subset could not be fetched. A failure is not fatal: the
 * export proceeds on Darker Grotesque alone, i.e. today's blank glyphs.
 */
export const loadFallbackFont = async (
  texts: string[],
  signal: AbortSignal,
): Promise<FallbackFont | null> => {
  const characters = fallbackCharacters(texts);
  if (!characters) return null;

  try {
    const response = await fetch(
      `/api/v1/prototype/font-fallback?text=${encodeURIComponent(characters)}`,
      { signal },
    );
    if (!response.ok) return null;
    const blob = await response.blob();
    const src = await toDataUrl(blob);
    Font.register({
      family: FALLBACK_FAMILY,
      fonts: [
        { src, fontWeight: 400 },
        { src, fontWeight: 700 },
      ],
    });
    return {
      family: FALLBACK_FAMILY,
      characters: [...characters].length,
      bytes: blob.size,
    };
  } catch {
    return null;
  }
};
