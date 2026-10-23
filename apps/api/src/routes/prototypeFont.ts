// PROTOTYPE (#129): a font fallback for the Collection PDF.
//
// Darker Grotesque has no glyph for everything a title can contain. The PDF
// renderer lays text out from font data it embeds, so the browser's own font
// fallback never runs; react-pdf substitutes only across a `fontFamily` stack.
// This route mints the missing tail of that stack: it asks Google Fonts for a
// TTF subset of exactly the code points the export uses, so a title like
// `☆⼺` costs about 2 kB rather than a 17 MB CJK font.
//
// Throwaway: a production version should own the subsetting (a local Noto
// face and fontkit, or a cached edge function) rather than call Google on the
// request path, and should allow-list the families it serves.
import { Hono } from "hono";
import { ApiError } from "../errors";

export const prototypeFontRoutes = new Hono();

/** The export's own cap. A collection's titles are short; a megabyte of URL
 *  is abuse, not a collection. */
const MAX_CHARS = 512;
const CACHE_LIMIT = 32;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CachedFont {
  bytes: ArrayBuffer;
  at: number;
}

const cache = new Map<string, CachedFont>();

const cacheGet = (key: string): ArrayBuffer | null => {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  // Refresh insertion order: Map iteration is the eviction order.
  cache.delete(key);
  cache.set(key, hit);
  return hit.bytes;
};

const cachePut = (key: string, bytes: ArrayBuffer): void => {
  cache.set(key, { bytes, at: Date.now() });
  while (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) return;
    cache.delete(oldest);
  }
};

const uniqueCodePoints = (text: string): string => {
  const chars = new Set<string>();
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    // ASCII is Darker Grotesque's home turf; asking for it only makes the
    // subset bigger and can shift a glyph off the brand face.
    if (codePoint > 0x7e) chars.add(char);
  }
  return [...chars].sort().join("");
};

/**
 * Google Fonts answers with a format chosen from the User-Agent, and its
 * modern answer is WOFF2 — which the PDF embedder cannot take. A legacy UA
 * gets the TrueType subset, which it can.
 */
const FONT_CSS_UA = "Mozilla/4.0 (compatible; Arcula PDF prototype)";

const fontUrlFrom = (css: string): string | null => {
  const match = /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/.exec(css);
  return match?.[1] ?? null;
};

prototypeFontRoutes.get("/prototype/font-fallback", async (c) => {
  const chars = uniqueCodePoints(c.req.query("text") ?? "");
  if (!chars) {
    throw new ApiError("validation", "No non-ASCII text to cover");
  }
  if ([...chars].length > MAX_CHARS) {
    throw new ApiError(
      "validation",
      `At most ${MAX_CHARS} distinct non-ASCII characters per request`,
    );
  }

  const cached = cacheGet(chars);
  if (cached) {
    return c.body(cached, 200, {
      "content-type": "font/ttf",
      "cache-control": "public, max-age=86400",
    });
  }

  const cssUrl =
    "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400" +
    `&text=${encodeURIComponent(chars)}`;
  let cssResponse: Response;
  try {
    cssResponse = await fetch(cssUrl, {
      headers: { "user-agent": FONT_CSS_UA },
    });
  } catch {
    throw new ApiError("internal", "The fallback font service is unreachable");
  }
  if (!cssResponse.ok) {
    throw new ApiError("internal", "The fallback font service refused");
  }
  const fontUrl = fontUrlFrom(await cssResponse.text());
  if (!fontUrl) {
    throw new ApiError("internal", "The fallback font service named no font");
  }

  let fontResponse: Response;
  try {
    fontResponse = await fetch(fontUrl);
  } catch {
    throw new ApiError("internal", "The fallback font file is unreachable");
  }
  if (!fontResponse.ok) {
    throw new ApiError("internal", "The fallback font file was refused");
  }
  const bytes = await fontResponse.arrayBuffer();
  if (bytes.byteLength < 12) {
    throw new ApiError("internal", "The fallback font file is empty");
  }
  const magic = new DataView(bytes).getUint32(0);
  // 0x00010000 or 'true'/'ttcf' — a TTF, never the WOFF2 the CSS avoids.
  if (magic !== 0x00010000 && magic !== 0x74727565) {
    throw new ApiError("internal", "The fallback font is not a TrueType file");
  }

  cachePut(chars, bytes);
  return c.body(bytes, 200, {
    "content-type": "font/ttf",
    "cache-control": "public, max-age=86400",
  });
});
