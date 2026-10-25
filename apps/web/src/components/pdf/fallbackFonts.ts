/**
 * The PDF's fallback font families.
 *
 * React-PDF embeds its own fonts, so the browser's fallback never runs: a glyph
 * Darker Grotesque lacks — Han, kana, most symbols — draws as `.notdef`. The
 * renderer does substitute per code point across a `fontFamily` stack, so the
 * export asks the API for a TrueType subset of exactly the non-ASCII
 * characters the document draws and registers one family per 512-code-point
 * chunk, in chunk order. See `docs/specs/pdf-export.md`.
 *
 * A failed fetch is deliberately not fatal: the export continues on Darker
 * Grotesque alone and the affected glyphs stay blank, which is exactly today's
 * behaviour. It never turns a successful export into an error.
 */

import { Font } from "@react-pdf/renderer";

import { fallbackCharacters, fallbackChunks } from "./collectionPdfPreflight";
import { throwIfAborted } from "./photoPipeline";

const FALLBACK_ENDPOINT = "/api/v1/pdf/font-fallback";

/**
 * Registered subsets, keyed by their character string.
 *
 * `Font.register` appends sources rather than replacing them, so re-registering
 * a family name on a second export would keep serving the first export's
 * subset. Reusing the family for identical text is safe; new text gets a new
 * family name.
 */
const registered = new Map<string, string>();
let nextFamily = 1;

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
    reader.onerror = () =>
      reject(reader.error ?? new Error("the font could not be read"));
    reader.readAsDataURL(blob);
  });

/**
 * Every fallback family for this export, in chunk order.
 *
 * An empty array means the text is all ASCII, every fetch failed, or there was
 * nothing to cover — the document then names only Darker Grotesque.
 *
 * A cancel is the one failure that is not swallowed: the viewer has already
 * discarded the run, and continuing to fetch more chunks would leave work
 * behind for a document that will never be rendered.
 */
export async function loadFallbackFamilies(
  texts: string[],
  signal?: AbortSignal,
): Promise<string[]> {
  const chunks = fallbackChunks(fallbackCharacters(texts));
  const families: string[] = [];

  for (const chunk of chunks) {
    throwIfAborted(signal);

    const existing = registered.get(chunk);
    if (existing) {
      families.push(existing);
      continue;
    }

    try {
      const response = await fetch(
        `${FALLBACK_ENDPOINT}?text=${encodeURIComponent(chunk)}`,
        { signal },
      );
      if (!response.ok) {
        continue;
      }
      const src = await toDataUrl(await response.blob());
      const family = `Arcula Fallback ${nextFamily}`;
      nextFamily += 1;
      Font.register({
        family,
        fonts: [
          { src, fontWeight: 400 },
          { src, fontWeight: 700 },
        ],
      });
      registered.set(chunk, family);
      families.push(family);
    } catch {
      // Not fatal: the brand face carries every Latin glyph, and an uncovered
      // glyph stays `.notdef` rather than failing the document. A cancel is
      // not a font failure, though.
      if (signal?.aborted) {
        throwIfAborted(signal);
      }
    }
  }

  return families;
}
