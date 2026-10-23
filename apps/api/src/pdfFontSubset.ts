// The Collection PDF's fallback face, subset on demand.
//
// Darker Grotesque is Latin-only, and the PDF renderer embeds its own font
// data, so the browser's fallback never runs: a glyph the brand face lacks
// draws blank. The export collects the distinct non-ASCII code points it will
// draw and asks this module for a TrueType subset of a bundled Noto Sans SC.
//
// Three decisions live here, and they are ours rather than fontkit's:
//
//  - what the request text normalizes to — distinct non-ASCII code points,
//    sorted by code point, capped at 512;
//  - the warm-Lambda cache — the sorted character string is the key, 32
//    entries, a 24-hour TTL, oldest inserted evicted first;
//  - a subsetting failure is the API's `internal` error (500), never a leak.
//
// The face itself ships beside the bundle (see scripts/build-lambda.sh), so
// resolution is `import.meta.url`-relative: in production that is
// /var/task/index.js and /var/task/assets/fonts. Nothing is fetched remotely
// and the request's characters are never logged.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MAX_PDF_FALLBACK_CODE_POINTS } from "@arcula/shared";
import * as fontkit from "fontkit";
import type { Font } from "fontkit";
import { ApiError } from "./errors";

/** The client sends the document's set in chunks of this size. */
export const MAX_FALLBACK_CODE_POINTS = MAX_PDF_FALLBACK_CODE_POINTS;

const CACHE_LIMIT = 32;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const FONT_FILE = fileURLToPath(
  new URL("./assets/fonts/NotoSansSC-Regular.ttf", import.meta.url),
);

/**
 * Distinct non-ASCII code points, sorted by code point and joined back into a
 * string. ASCII belongs to Darker Grotesque; asking for it would only grow
 * the subset and can shift a glyph off the brand face.
 */
export function subsetCharacters(text: string): string {
  const codePoints = new Set<number>();
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (codePoint > 0x7f) codePoints.add(codePoint);
  }
  if (codePoints.size === 0) {
    throw new ApiError("validation", "No non-ASCII text to cover");
  }
  if (codePoints.size > MAX_FALLBACK_CODE_POINTS) {
    throw new ApiError(
      "validation",
      `At most ${MAX_FALLBACK_CODE_POINTS} distinct non-ASCII characters per request`,
    );
  }
  return [...codePoints]
    .sort((a, b) => a - b)
    .map((codePoint) => String.fromCodePoint(codePoint))
    .join("");
}

interface CacheEntry {
  bytes: Uint8Array<ArrayBuffer>;
  at: number;
}

export interface SubsetCache {
  get(key: string): Uint8Array<ArrayBuffer> | null;
  set(key: string, bytes: Uint8Array<ArrayBuffer>): void;
}

/**
 * The subset cache's policy: 32 entries, a 24-hour TTL, oldest insertion
 * evicted first. `now` is a parameter so the policy is testable without a
 * clock, and a cache hit does not reorder the entries — eviction is by
 * insertion, not by use.
 */
export function createSubsetCache(now: () => number = Date.now): SubsetCache {
  const entries = new Map<string, CacheEntry>();

  return {
    get(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (now() - entry.at > CACHE_TTL_MS) {
        entries.delete(key);
        return null;
      }
      return entry.bytes;
    },
    set(key, bytes) {
      // An overwrite is a fresh insertion, so it moves to the newest slot.
      entries.delete(key);
      entries.set(key, { bytes, at: now() });
      while (entries.size > CACHE_LIMIT) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) return;
        entries.delete(oldest);
      }
    },
  };
}

const cache = createSubsetCache();

let fontPromise: Promise<Font> | null = null;

/** Read the bundled face once per warm process. */
function loadFont(): Promise<Font> {
  if (fontPromise !== null) return fontPromise;

  const pending: Promise<Font> = readFile(FONT_FILE).then((buffer) => {
    const font = fontkit.create(buffer);
    // A collection has no single face to subset; the shipped asset is a TTF.
    if (font.type !== "TTF") {
      throw new Error("The fallback font asset is not a TrueType face");
    }
    return font;
  });
  // A failed read is not a permanent verdict for this process: the next
  // request tries again rather than inheriting a rejected promise.
  pending.catch(() => {
    if (fontPromise === pending) fontPromise = null;
  });
  fontPromise = pending;
  return pending;
}

async function subsetFont(
  characters: string,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const font = await loadFont();
    const subset = font.createSubset();
    for (const char of characters) {
      subset.includeGlyph(font.glyphForCodePoint(char.codePointAt(0) ?? 0));
    }
    // fontkit's declaration widens to ArrayBufferLike; copy into an owned
    // buffer so the response body is Hono's Uint8Array<ArrayBuffer>.
    return new Uint8Array(subset.encode());
  } catch {
    // Deliberately no character detail in the message or the log: the text
    // is the caller's document, not ours to echo.
    throw new ApiError("internal", "The fallback font could not be prepared");
  }
}

/** The TrueType subset for the request text, from cache or freshly built. */
export async function fontSubsetFor(
  text: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const characters = subsetCharacters(text);
  const cached = cache.get(characters);
  if (cached) return cached;

  const bytes = await subsetFont(characters);
  cache.set(characters, bytes);
  return bytes;
}
