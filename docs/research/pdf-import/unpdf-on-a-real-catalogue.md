# unpdf on a real catalogue

**Ticket**: [#234](https://github.com/mixcas/arcula/issues/234)
**Date**: 2026-11-15
**Status**: research only. `unpdf` is not a dependency of this repository; it was measured in a throwaway directory. Nothing here is a decision to adopt it.

## Method and environment

Measured with **unpdf 2.2.1**, which bundles its own serverless build of **PDF.js 6.5.438** (`unpdf@2.2.1` `package.json` and `README.md`, "How It Works"). No `pdfjs-dist` was installed; unpdf's bundled build was used throughout.

| Runtime                                         | Version                    |
| ----------------------------------------------- | -------------------------- |
| Node                                            | 24.22.1                    |
| Bun                                             | 1.4.4                      |
| Chrome (headless, via `puppeteer-core` 25.17.0) | 157.0.8103.51              |
| Vite (the repository's own version)             | 8.3.1                      |
| Machine                                         | macOS 26.6.2, Apple M5 Pro |

Two fixtures, both read from the repository working tree and never committed:

- **A** — `Colección Luis Corzo 2026-sm.pdf`: 5 pages, 19,320,044 bytes, `Creator: PDF.js`, `Producer: Firefox`, PDF 1.7. Five artwork pages, each with one painted image (page 4 with two).
- **B** — `docs/templates/pdf/arcula-pdf-template.pdf`: 2 pages, 232,735 bytes, `Producer: Skia/PDF m158 Google Docs Renderer`, PDF 1.4.

Ground truth for text and geometry came from **PyMuPDF** (`pymupdf`), which reads fixture A cleanly; **pypdf** was only used to read the raw font resources. Browser numbers are a real Chrome run: the scratch Vite build was served over `http://localhost:8123` with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` set so `performance.measureUserAgentSpecificMemory()` was available (`crossOriginIsolated === true`). Main-thread blocking was measured two ways: a 50 ms `setInterval` ticker recording the largest gap, and a `PerformanceObserver` for `longtask`. Node and Bun were measured with the same scripts under each runtime.

Unless a paragraph says "extrapolated" or "not measured", the numbers below are direct measurements.

## 1. Text

`extractText` recovers all five caption blocks, with **no character or accent mangling**. The differences from PyMuPDF are whitespace only.

| Fixture A page | PyMuPDF                                                                                                             | unpdf `extractText`                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1              | `2026` after 177 leading spaces / `COLECCIÓN` + 44 spaces + `LUIS CORZO`                                            | `2026` / `COLECCIÓN LUIS CORZO`                             |
| 2              | `JORDIN ALANIS (MEX) ` / `Night dreams, 2022 ` / `Oil on paper ` / `23 x  30.5 cm` / `Without certificate (Signed)` | same lines, trailing spaces dropped, double space collapsed |
| 3              | `22 x  16 x 16 cm`                                                                                                  | `22 x 16 x 16 cm`                                           |
| 4              | `NOGAL,2021` (no space after the comma)                                                                             | `NOGAL,2021` (preserved)                                    |
| 5              | `20.5 x  15 cm`                                                                                                     | `20.5 x 15 cm`                                              |

What is lost is **whitespace**: PDF.js collapses a run of spaces to one and trims leading and trailing whitespace before unpdf sees it, so this is inherited from `getTextContent()`, not added by unpdf. It shows in both `extractText` and `extractTextItems.item.str`. It matters for the dimension strings (`23 x  30.5 cm` → `23 x 30.5 cm`) only if the importer's parser is sensitive to the double space; the digits are intact.

Accents survive: page 1 returns `COLECCIÓN`. `pypdf`'s mojibake (`'ÁightNdreamsZNfdffN'`) is **not** reproduced by unpdf; unpdf behaves like PyMuPDF for characters.

### Raw output for fixture A page 2, verbatim

`extractText` (page 2, JSON-quoted exactly as returned):

```
"JORDIN ALANIS (MEX)\nNight dreams, 2022\nOil on paper\n23 x 30.5 cm\nWithout certificate (Signed)"
```

`extractTextItems` page 2 returned 9 items: five text items and four empty-string items carrying `hasEOL: true`. The five real items:

```
{"str":"JORDIN ALANIS (MEX)","x":137.3651,"y":628.0781,"width":255.225,"height":25,"fontSize":25,"fontFamily":"sans-serif","dir":"ltr","hasEOL":false}
{"str":"Night dreams, 2022","x":137.3651,"y":578.0781,"width":226.8,"height":25,"fontSize":25,"fontFamily":"sans-serif","dir":"ltr","hasEOL":false}
{"str":"Oil on paper","x":137.3651,"y":528.0781,"width":138.025,"height":25,"fontSize":25,"fontFamily":"sans-serif","dir":"ltr","hasEOL":false}
{"str":"23 x 30.5 cm","x":137.3651,"y":503.0781,"width":148.05,"height":25,"fontSize":25,"fontFamily":"sans-serif","dir":"ltr","hasEOL":false}
{"str":"Without certificate (Signed)","x":137.3651,"y":453.0781,"width":316.7,"height":25,"fontSize":25,"fontFamily":"sans-serif","dir":"ltr","hasEOL":false}
```

For comparison, PyMuPDF's spans for the same page are `x≈137.4`, font size 25, at `y0` 432.3 / 482.3 / 532.3 / 557.3 / 607.3 in its top-left origin, with `Akkurat-Bold` on the first two lines and `Akkurat-Regular` on the last three.

Fixture B reads cleanly too: page 1 is the nine labels (`Collection Title` … `Place of Origin`), page 2 contains six label blocks — the first also carries `Collection Title`, the other five have the eight remaining fields — with six `Artist Name` occurrences, 105 items, 122 items over the two pages, separated by `--` rules. There is no mojibake there either.

**Reading order is the library's, not the document's logical order.** On fixture B page 2 the items come out column-major within each block, so a consumer that trusts `extractText`'s sequence gets labels interleaved in an order that does not match the visual work grid. Positions are available to fix that (next section), but the plain text is not a reliable record order.

## 2. Positions

**Yes — unpdf exposes coordinates, and it also exposes the underlying document.** `extractTextItems` returns one record per text item with `str`, `x`, `y`, `width`, `height`, `fontSize`, `fontFamily`, `dir`, `hasEOL` (`unpdf@2.2.1` `dist/index.d.mts`, `StructuredTextItem`). The `x`/`y` are documented as PDF user space with the origin at the bottom left.

For page 2 the numbers line up exactly with PyMuPDF's geometry:

- `x` = 137.3651, matching PyMuPDF's 137.4 left edge.
- Baselines step 50 pt apart (628.0781, 578.0781, 528.0781) and 25 pt from `Oil on paper` to `23 x 30.5 cm` (528.0781 → 503.0781), matching PyMuPDF's 50 pt and 25 pt line spacing.
- `fontSize` = 25 for every line, matching PyMuPDF's 25.0.
- `y` is the **baseline**, not the top of a bounding box. PyMuPDF's span for line 1 is `(137.4, 432.3, 397.8, 457.3)` top-left; the PDF-space top is `1080 − 432.3 = 647.7`, and unpdf's `y` is 628.078, i.e. 19.6 pt below the top — the ascent. A bbox has to be reconstructed (`x … x+width`, `y−descent … y+ascent`), or taken from PDF.js's own transform.

The underlying document is reachable, which matters because it gives the **full text matrix** rather than just `fontSize`:

```js
import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
const pdf = await getDocumentProxy(bytes);
const page = await pdf.getPage(2);
const { items, styles } = await page.getTextContent();
// items[0].transform === [25, 0, 0, 25, 137.3651, 628.0781]
```

`getResolvedPDFJS()` returns the bundled PDF.js module, and `getDocumentProxy()` returns a normal `PDFDocumentProxy`; `page.getOperatorList()`, `page.objs.get()` and `page.getTextContent()` all worked against it. `getTextContent()` also gives `fontName` ids (`g_d0_f3` for `Akkurat-Bold`, `g_d0_f2` for `Akkurat-Regular`) and `styles[fontName]` with `ascent`/`descent`/`vertical`; unpdf's `fontSize` is the scale out of the text matrix (25 here), not the font's nominal size.

**The one thing that is not exposed is the font itself.** The PDF's font resources are `/AAAAAD+Akkurat-Bold` and `/AAAAAC+Akkurat-Regular` (read with `pypdf`), but unpdf reports `fontFamily: "sans-serif"` for both, and `page.commonObjs.get("g_d0_f3")` carries only `fallbackName: "sans-serif"` and a `loadedName`. Neither unpdf nor PDF.js's `getTextContent()` surfaces the `/BaseFont` name or the weight/style. In this fixture every caption line is the **same 25 pt size at the same x**, so bold-versus-regular is the only typographic signal distinguishing the artist/title lines from medium/dimensions lines, and unpdf drops it. Fixture B shows the same flattening: `ArialMT` and `DarkerGrotesque-Regular` both come back as `sans-serif`.

**Image bounds are in the same coordinate space**, which is what makes the geometric pairing tractable: `ExtractedImage.bounds` is `{x, y, width, height}` in PDF user space with the origin bottom-left, "unrotated by `/Rotate`, unscaled by `/UserUnit`" (`dist/index.d.mts`, `Bounds`). For page 4, unpdf returns `(1452.358, 281.0858, 423.8606, 530.0586)`, which is PyMuPDF's top-left `(1452.4, 268.9, 1876.2, 798.9)` after flipping the y axis: `1080 − 798.9 = 281.1`. The text baselines and the image boxes can therefore be compared without a coordinate conversion, only a `pageHeight − y` if a top-left view is wanted.

One boundary case: image bounds are not clipped to the page. Page 1 of fixture A returns `(-120, -314, 2161, 1708)` on a 1920 × 1080 page — the image is painted past all four edges. Any pairing or cropping rule needs to clamp.

## 3. Images

`extractImages` returns **decoded pixels, never the original stream**. `data` is raw RGBA by default, or PNG with `{ format: 'png' }`; there is no option that returns the embedded JPEG/PNG bytes. `width` and `height` are the image's native pixel dimensions; `bounds` is where it is painted. `key` is PDF.js's object id (`img_p3_1`, …), `null` for a small inline image.

Fixture A, page by page, measured in Chrome 157 (PNG, one page at a time):

| Page | Objects | Native pixels | Painted bounds (PDF space, bottom-left) | Original bytes in the PDF | unpdf PNG bytes | Extraction    |
| ---- | ------- | ------------- | --------------------------------------- | ------------------------- | --------------- | ------------- |
| 1    | 1       | 3758 × 2970   | −120, −314, 2161 × 1708                 | JPEG, 4,471,227           | 10,934,792      | 1,258 ms      |
| 2    | 1       | 3024 × 4032   | 1023.699, 0, 810 × 1080                 | JPEG, 3,238,564           | 9,572,375       | 570 ms        |
| 3    | 1       | 2716 × 2716   | 840.066, 0, 1080 × 1080                 | JPEG, 2,850,956           | 8,123,519       | 1,023 ms      |
| 4    | **2**   | 910 × 1138    | 1452.358, 281.086, 423.861 × 530.059    | JPEG, 519,613             | 924,337         | 242 ms (both) |
| 4    |         | 1600 × 1220   | 679.622, 246.783, 769.095 × 586.435     | **PNG**, 3,911,750        | 4,391,658       |               |
| 5    | 1       | 4032 × 3024   | 665.450, 70.200, 1252.8 × 939.6         | JPEG, 4,213,916           | 16,567,966      | 875 ms        |

Totals: 6 image objects, 45.91 megapixels, 19,206,026 bytes of original image data (the file is 19,320,044 bytes), **50,514,647 bytes of PNG output — 2.63× the originals**, and 175.1 MiB if the RGBA is held at once.

**Page 4 does yield exactly two images, in this order: the 910 × 1138 photo first, the 1600 × 1220 composite second.** Both are returned at native pixel size, not resampled to their painted size, and both native aspects match their painted bounds (910/1138 = 0.7996 vs 423.861/530.059 = 0.7997), so the placement is a uniform scale, not a stretch; `bounds` is the image's own box, not a page clip. The composite is a **diptych of two photographs side by side, with a white gutter**, returned whole as one object; the 910 × 1138 photograph is a third, separate view. I rendered both to confirm this, and it is the most consequential image fact for the import: **one image object is not one photograph.** Page 4's one caption covers three photographic views, and one image object contains two of them.

The bytes are a re-encode in every case:

- `format: 'rgba'` returns `width × height × 4` bytes (verified: page 4's first image is exactly 910 × 1138 × 4 = 4,142,320 bytes).
- `format: 'png'` returns a hand-written PNG: signature, `IHDR` with bit depth 8 / colour type 6, **one** `IDAT` chunk holding `CompressionStream("deflate")` output over filter-type-0 scanlines, and `IEND` (`dist/index.mjs`, `encodePNG`). A chunk dump of the extracted files shows only `IHDR`, `IDAT`, `IEND` — no `iCCP`, `sRGB`, `gAMA`, `pHYs` or text chunks.
- No JPEG magic appears in any output; the original embedded bytes are not reachable through the public API.

That re-encode is lossless but costly: the five JPEG images become 1.78×–3.93× larger PNGs (page 1: 4.47 MB → 10.93 MB; page 4's 519 kB JPEG → 924 kB; page 5: 4.21 MB → 16.57 MB), and the one original PNG grows 3.91 MB → 4.39 MB. If the import stores what unpdf hands out, it stores roughly 50 MB per 19 MB catalogue. Getting back to a compact format means a second encode (canvas → JPEG/WebP), which introduces generation loss and needs a canvas.

**Fixture B:**

- Page 1 (photo page): **one** image, 1536 × 2048, bounds `(111, 199.5, 390, 519)` on a 612 × 792 page, original JPEG 203,108 bytes, unpdf PNG 1,783,123 bytes (8.8×), 134 ms.
- Page 2 (the six-work grid): **zero images**. It is a text-only grid of six label blocks, 105 items, 6.6 ms. The template does not exercise image pairing on a grid page; only page 1 has a photograph.

**The biggest behavioural trap: in a browser, `extractImages` can return an empty array with no error.** Passing a document proxy from `getDocumentProxy(bytes)` (the API shape the README's own text example encourages) returned **0 images on every page** of fixture A — 263 ms of work, no throw, no console warning. PDF.js decodes images to `ImageBitmap`s in browser environments, and unpdf skips bitmaps (`dist/index.d.mts`, `extractImages` remarks; README, "Extract Images as PNG"). The documented workarounds both work and both cost the same as each other:

- `getDocumentProxy(bytes, { isOffscreenCanvasSupported: false, isImageDecoderSupported: false })` then `extractImages(proxy, page)`, or
- pass a **fresh copy** of the bytes to `extractImages(bytes, page)` on each call.

Measured in Chrome: default proxy → 0 images on all 5 pages; either workaround → the 6 objects above. Node and Bun do not hit this because they have no browser bitmap path.

Related ownership trap, measured on Node 24 and Bun: PDF.js **takes ownership of the input `Uint8Array`**. Calling `getDocumentProxy(bytes)` and then `extractImages(bytes, 1)` on the same buffer throws `DataCloneError: Cannot transfer object of unsupported type` / `The object can not be cloned`. It is documented ("PDF.js takes ownership of binary data, so it works for one call only" — README, "Use Cases") but the failure is an opaque `DataCloneError`, not a clear message. Keep the proxy, or clone the bytes per call.

## 4. Cost

### Bundle contribution

Built with **Vite 8.3.1**, the repository's own version, default build settings apart from the output directory, a scratch entry that statically imports `getDocumentProxy`, `extractText`, `extractTextItems` and `extractImages`:

gzip figures below are `gzip -9` of the built files, so they differ by a few kB from the sizes Vite prints.

| Chunk                                     | Raw            | gzip         |
| ----------------------------------------- | -------------- | ------------ |
| `index` (entry + unpdf wrapper)           | 11.02 kB       | 4.71 kB      |
| `pdfjs` (bundled PDF.js 6.5.438)          | 1,643.35 kB    | 501.77 kB    |
| `pdfjs` runtime + decoder loader          | 1.13 kB        | 0.72 kB      |
| JBIG2 / OpenJPEG decoders (4 lazy chunks) | 901.27 kB      | 288.09 kB    |
| **First call, text or images**            | **1,655.5 kB** | **507.2 kB** |
| **All decoders fetched as well**          | **2,556.8 kB** | **795.3 kB** |

The `pdfjs` chunk is a dynamic import inside unpdf, so it is not part of the initial SPA bundle; it is fetched on first use of any unpdf function. Vite emits its ">500 kB" warning for it. The four decoder chunks are fetched only when a CCITT/JBIG2/JPEG-2000 image appears; with fixture A they were **not** requested (resource timing shows only `index` and `pdfjs`). A Bun build of the same entry was 2.59 MB raw / 813,989 bytes gzip.

**Web Worker path changes the figure.** Running extraction in a worker is the only way to keep the SPA responsive (see below). With Vite's default worker format (`iife`), the worker is a single inlined bundle of **2,565.41 kB raw / 798.75 kB gzip**, and I verified by substring that the JBIG2 and OpenJPEG decoder code is inside it — dynamic imports are not split in an IIFE worker. With `worker: { format: 'es' }` the worker entry is only 6.16 kB and shares the 1,651.78 kB / 502.6 kB gzip `pdfjs` chunk, with decoders back to lazy chunks. If the app ships both a main-thread and a worker path, PDF.js is duplicated.

### Wall clock and memory in a real browser

Chrome 157, fixture A, local HTTP server so transfer is not the variable:

| Step                                | Time                               |
| ----------------------------------- | ---------------------------------- |
| `fetch` 19.3 MB                     | 63 ms                              |
| `getDocumentProxy`                  | 52 ms                              |
| `extractText`, all 5 pages          | 24–26 ms                           |
| `extractTextItems`, all 5 pages     | 1.5 ms                             |
| `extractImages` as PNG, all 5 pages | 3,968–4,047 ms                     |
| per page                            | 1,258 / 570 / 1,023 / 242 / 875 ms |

That is **86.4 ms per megapixel** and **~794 ms per page** for a photo page that is about 9.2 MP. Text is negligible: the whole 5-page file opens and yields text in about 79 ms.

Node 24 on the same machine is essentially identical for images (4,046 ms for the same five pages) and slightly faster for text (open 33–73 ms, `extractText` 15 ms). Bun 1.4.4 matches too (page 4 PNG in 206 ms, page 1 RGBA in 309 ms).

Memory, measured with `performance.measureUserAgentSpecificMemory()` under cross-origin isolation (whole-agent bytes, including the 19 MB input and decoded caches):

| Strategy                                                      | Peak         | After the run |
| ------------------------------------------------------------- | ------------ | ------------- |
| One proxy, all 5 pages                                        | **183.7 MB** | 183.6 MB      |
| Re-open per page (fresh bytes, document destroyed after each) | **63.6 MB**  | 63.5 MB       |
| Default proxy, bitmaps skipped (0 images)                     | 27.3 MB      | 27.3 MB       |

With one proxy, memory grows about **31.6 MB per page** even when the PNG bytes are dropped, because PDF.js caches decoded images on the page proxy. Re-opening per page keeps memory flat at about **64 MB** and costs the same wall clock (3,979 ms vs 3,968 ms), so the cheap fix is to make one document per page.

**Extrapolation to a 60-page file** (fixture A's per-page mix, ×12; the 60-page file itself was not measured):

- 551 MP of image, **~48–49 s** of PNG extraction (12 × 4.09 s).
- ~606 MB of PNG output if all of it is retained (12 × 50.5 MB); it has to be streamed out per page, not accumulated.
- One proxy would reach **~1.9 GB** (25.5 MB + 60 × 31.6 MB, extrapolated) and is very likely to be killed. Per-page re-opening stays near **64 MB** whatever the page count (one-page peak measured; 60-page peak not measured).
- Text-only for 60 pages: ~0.3 s (extrapolated from 26 ms / 5 pages).

### Main-thread blocking

The serverless PDF.js build has no separate worker; parsing and decoding run on the caller's event loop (README, "How It Works", and "with the serverless build, parsing runs on your event loop (no worker)" under "Process Untrusted PDFs"). In Chrome, extracting fixture A on the main thread produced a **maximum 1,286 ms gap** in a 50 ms ticker and **7 long tasks totalling 3,923 ms** of the 4,047 ms run — the UI is frozen for the duration.

Moved into a module Web Worker, the same work took **4,089 ms wall** with a **maximum main-thread gap of 2 ms**. A worker is not optional if the import runs in the SPA rather than on the API.

## 5. Caveats

- **Licence.** unpdf is MIT; the bundled PDF.js is Apache-2.0; the JBIG2 and OpenJPEG decoder chunks ship their own licences (`LICENSE_PDFJS_JBIG2` Apache-2.0, `LICENSE_JBIG2` PDFium BSD, `LICENSE_OPENJPEG` 2-clause BSD, `LICENSE_PDFJS_OPENJPEG` BSD). All permissive, but the notices have to travel with the bundle. `package.json` declares `engines.node >= 24`.
- **Browser vs Node.** Node 24 and Bun run the same API without the bitmap problem; the browser's default proxy silently returns zero images. The browser path needs either the two `isOffscreenCanvasSupported`/`isImageDecoderSupported` flags set to `false` or per-call binary data. This is the single most likely way an implementation ships "working" code that imports no photographs.
- **Buffer ownership.** PDF.js detaches the input buffer. Reusing it after `getDocumentProxy` throws `DataCloneError`; clone per call or keep the proxy.
- **No canvas is needed for `extractImages`** — PNG encoding is `CompressionStream("deflate")` plus a hand-built PNG, which is why it runs in Workers. `renderPageAsImage` is the canvas path (and needs `@napi-rs/canvas` in Node); it was **not measured** here.
- **Colour.** Every image in fixture A is `ICCBased` RGB: Adobe RGB (1998) on pages 1 and 4's JPEG, Display P3 on pages 2, 3 and 5, sRGB on page 4's PNG. The extracted PNG carries **no ICC profile** (only `IHDR`/`IDAT`/`IEND`), so a browser renders it in sRGB. Colours can shift relative to the original PDF; I did not measure the delta. OpenJPEG's `nowasm` fallbacks and the JBIG2 path were not exercised by either fixture.
- **PNG cost.** 2.63× the original image bytes, from decoded RGBA, with no filtering/adaptive scanline choice. Storing the output as-is inflates a 19 MB catalogue to ~50 MB. Re-encoding to JPEG needs a canvas and loses a generation.
- **Vite build.** With the repository's Vite 8.3.1 and default config, the production build succeeds with no Node polyfills and no special config; the `pdfjs` chunk is 501.8 kB gzip and trips Vite's 500 kB warning. The `#pdfjs-decoders` import resolves under Vite's default conditions. A worker needs `worker.format: 'es'` to avoid a single 799 kB gzip worker bundle with both decoders inlined.
- **Browser support.** `unpdf`'s README states the serverless bundle requires the global `Iterator` constructor (Safari 18.4+), and PNG output needs `CompressionStream`; older Safari would throw at import or at encode. Not measured in Safari or Firefox.
- **Resource limits are the caller's.** `maxImageSize` is unlimited by default, `numPages` is not capped by these APIs, and there is no timeout: a crafted PDF that declares a huge image can allocate gigabytes, and `extractText`/`extractTextItems` process every page in one call. The README's "Process Untrusted PDFs" section recommends `maxImageSize` (e.g. 16,777,216), a page cap and a raced timeout. Fixture A alone reaches 184 MB for 5 pages.
- **Text fidelity.** Runs of spaces collapse and leading/trailing whitespace is trimmed; `fontFamily` is `sans-serif` for every font in both fixtures, and the real `/BaseFont` (`Akkurat-Bold` vs `Akkurat-Regular`) is not exposed. Any rule that depends on bold versus regular, or on the exact double space in a dimensions string, cannot be built on unpdf's text API as it stands.
- **One image object is not one photograph.** Page 4's 1600 × 1220 object is a two-panel diptych; splitting it is the importer's job, and nothing in unpdf marks the panels.

### Not measured / unknown

- A real 60-page file; all 60-page figures are linear extrapolations from fixture A.
- Safari, Firefox, iOS; only Chrome 157 was run.
- Rotated text, `/Rotate`-ed pages, CJK fonts, encrypted/password-protected PDFs, scanned pages with OCR layers, inline images and image masks, CMYK/JPEG-2000/JBIG2 images — neither fixture contains one.
- Network transfer cost of a real catalogue over the internet (the 63 ms fetch was local).
- Node/Bun peak memory (only browser memory was measured reliably; RSS deltas were discarded as too noisy).
- `renderPageAsImage`, `inspectPages`, `extractLinks`, `getMeta` beyond reading `Creator`/`Producer`.
- Colour-management delta between the embedded ICC profile and the profile-less PNG.
- Whether a worker build keeps the same memory profile (expected ~one page, 64 MB; not measured).

## What the measurements imply for the import design

Not a decision, just the reading of the numbers above:

- **Geometric pairing is possible.** `extractTextItems` and `extractImages` both report in the same PDF-space, bottom-left coordinate system, with matching x positions, baselines and image boxes; only the baseline-versus-box convention and page clipping need handling.
- **The import must run in a Web Worker.** Main-thread extraction freezes the UI for 1.3 s on a 5-page file, and ~49 s on a 60-page one.
- **It must reopen or destroy per page.** A single proxy accumulates ~31.6 MB per page; per-page re-opening is flat at ~64 MB and costs nothing measurable in time.
- **It must not trust bold/regular.** That distinction is absent from unpdf's text output even though it is in the PDF.
- **It must not assume one image = one photo.** The fixture's composite is a diptych.
- **It must store or re-encode deliberately.** unpdf hands out decoded RGBA/PNG, never the embedded JPEG; 19 MB of originals become 50 MB of PNG with no ICC profile.
- **It must pass the flags or fresh bytes.** Passing a default proxy yields zero images silently in a browser.
