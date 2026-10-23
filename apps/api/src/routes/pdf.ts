// The Collection PDF's fallback font: GET /pdf/font-fallback?text=…
//
// Public on purpose: a Visitor's export needs it too, so there is no
// session and no collection to authorize — the answer depends only on the
// characters, which are capped and cached by pdfFontSubset.ts. The body is a
// TrueType subset of the bundled Noto Sans SC, never a remote font.

import { Hono } from "hono";
import { fontSubsetFor } from "../pdfFontSubset";

export const pdfRoutes = new Hono();

const SUBSET_CACHE = "public, max-age=86400";

pdfRoutes.get("/pdf/font-fallback", async (c) => {
  const bytes = await fontSubsetFor(c.req.query("text") ?? "");
  return c.body(bytes, 200, {
    "Content-Type": "font/ttf",
    "Cache-Control": SUBSET_CACHE,
  });
});
