// The Collection PDF's fallback face, subset on demand.
//
// Darker Grotesque is Latin-only, and the PDF renderer embeds its own font
// data, so the browser's fallback never runs: a glyph the brand face lacks
// draws blank. The export collects the distinct non-ASCII code points it will
// draw and asks this module for a TrueType subset of a bundled Noto Sans SC.
//
// The subsetting itself is harfbuzz (hb-subset, through `subset-font`): its
// output is a complete font — `cmap`, `post`, `name`, `OS/2` and all — which is
// what the renderer needs, and what a glyph-only subsetter leaves out.
//
// Three decisions live here, and they are ours rather than the library's:
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
import subsetFont from "subset-font";
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

let facePromise: Promise<Buffer> | null = null;

/** Read the bundled face once per warm process. */
function loadFace(): Promise<Buffer> {
  if (facePromise !== null) return facePromise;

  const pending = readFile(FONT_FILE);
  // A failed read is not a permanent verdict for this process: the next
  // request tries again rather than inheriting a rejected promise.
  pending.catch(() => {
    if (facePromise === pending) facePromise = null;
  });
  facePromise = pending;
  return pending;
}

/**
 * The code point always added to the subset, drawn or not.
 *
 * hb-subset writes a `cmap` with **no subtable** when none of the requested
 * code points have a glyph — an emoji-only title, say — and a font whose
 * `cmap` has no subtable makes the renderer throw instead of falling back to
 * `.notdef`. A space is the one character a text face is guaranteed to draw,
 * and one more glyph costs nothing.
 */
const SUBSET_SENTINEL = " ";

async function subsetFontForFace(
  characters: string,
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const face = await loadFace();
    // Every table harfbuzz writes is kept: the renderer reads `cmap`, `post`,
    // `name` and `OS/2` while it lays text out and embeds the face, and the
    // subset is about 2 kB either way.
    const subset = await subsetFont(face, characters + SUBSET_SENTINEL, {
      targetFormat: "truetype",
    });
    return new Uint8Array(subset);
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

  const bytes = await subsetFontForFace(characters);
  cache.set(characters, bytes);
  return bytes;
}
