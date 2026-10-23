# Collection PDF prototype — findings

Throwaway prototype for [#129](https://github.com/mixcas/arcula/issues/129),
on the branch `prototype/pdf-export`. **Do not merge this branch.** The sample
files live beside this document.

- Branch: <https://github.com/mixcas/arcula/tree/prototype/pdf-export>
- Sample, 17 pages, real photos and grid:
  [flores-solares-200dpi.pdf](flores-solares-200dpi.pdf)
- Sample, 2 pages, six-up and a partial continuation:
  [grid-continuation.pdf](grid-continuation.pdf)
- Rendered pages: [grid-page.png](grid-page.png),
  [grid-continuation-page.png](grid-continuation-page.png),
  [placeholder-page.png](placeholder-page.png)

## Verdict

`@react-pdf/renderer` can produce the collection PDF in the browser, and the
measured geometry lands on the template. The remaining costs are not layout
problems; they are a **font-coverage gap** (a non-Latin title renders blank) and
a **library page-height bug** under `wrap={false}`. Both have known workarounds.
The renderer chunk is 494.2 kB gzip and lazy-loads, so it costs nothing on the
normal pages.

The photo path is the surprise: the `xlarge` WebP is the better source at both
200 and 300 dpi. The 12 MP original downloads 42 % more bytes, takes ~30–50 %
longer, and adds only 1.2 % to the PDF at 300 dpi (4.3 % at 200 dpi), because
the printed box is smaller than the `xlarge` variant.

## What was built

- A lazy route `/collection/:collectionId/pdf`, its own `PdfExportPage` chunk.
- The page plan (`plan.ts`): published and live only, Artist A–Z then Title A–Z
  through one `Intl.Collator` with an id tie-break, at most three photos per
  Artwork, one photo per page, no-photo Artworks in a 2 × 3 grid after them,
  header-only page for an empty collection.
- Both templates: `compact` (9 pt body / 7.5 pt header, 12.2 pt line, 22.5 pt
  Title gap) and `template` (the template's own 12 / 10 pt, 16.27 pt line, 30 pt
  Title gap).
- Photo prefetch and conversion: same-origin fetch (the grant cookie rides
  along), `createImageBitmap(..., { imageOrientation: "from-image" })`,
  `OffscreenCanvas` with a DOM `<canvas>` fallback, white flatten, JPEG.
- Progress per photo and cancellation, a single `pdf().toBlob()`, an iframe
  viewer, Download, and the mobile “Open PDF” path.
- A fixed header on every page and the `Image unavailable` placeholder.
- Grant-expiry detection: a 404/403 media response asks the collection read
  again and re-locks on `403 password-required`.

Run it locally with the stack up, then open
`/collection/<id>/pdf`. The URL also accepts `?auto=1&source=xlarge|original&dpi=150|200|300&typography=compact|template&quality=0.8|0.9|0.95`.

## The collection used

`flores-solares-743b2238c86f425182cc06c6b68ef95c` was not reachable (404), so
the prototype used the seeded local collection **Flores Solares**
(`dc22fb42d2cd416fbfb94770487f4964`):

- 24 live, published works.
- 6 with photos; 20 stored photos, 14 used because each work contributes at most
  its first three.
- 18 without photos, so the grid is three full six-up pages.
- Real long titles, accents, sparse metadata, and one title (`☆⼺`) outside the
  font's coverage — the hard cases, not a tidy fixture.

## Geometry against the template

All values in points. The template values were measured from
`docs/templates/pdf/arcula-pdf-template.pdf`'s text matrices and image
placement, and cross-checked against the PNGs' ink extents. The prototype was
measured from its generated PDF.

| Element                     |                      Template |         Compact |   Template type |
| --------------------------- | ----------------------------: | --------------: | --------------: |
| Page                        |                     612 × 792 |       612 × 792 |       612 × 792 |
| Left/right margin           |                            72 |              72 |              72 |
| Header baseline             |                         45.38 |           45.38 |           45.38 |
| Photo box                   | left 111, top 73.5, 390 × 519 |            same |            same |
| Title/right-column baseline |               640.12 / 641.32 | 639.88 / 641.32 | 639.88 / 641.32 |
| Artist baseline             |                        670.12 |          663.82 |          670.12 |
| Metadata line               |                         16.27 |            12.2 |           16.27 |
| Grid first Title            |                         83.52 |           83.52 |           83.52 |
| Grid columns                |                      72 / 324 |        72 / 324 |        72 / 324 |
| Grid block pitch            |                        191.52 |          191.52 |          191.52 |
| `--` baseline               |                         240.7 |          240.72 |          240.72 |

Two findings that change the written spec:

1. **The right column starts on the Title row, not the Artist row.** The
   template's Dimensions baseline is 641.32, the same row as the Title; #125
   says the right column begins on Artist Name. The prototype follows the
   measured template. If the intent really is the Artist row, every right-hand
   field moves down one row; that is a design decision, not a measurement.
2. **The template's Title shear is 14.04°, not 10°.** Its content stream uses
   the text matrix `1 0 0.25 -1` for the Title glyphs; `atan(0.25) = 14.04°`.
   The PNG's ink slope is ~0.28 (anti-aliasing makes it read a little steeper).
   The prototype uses `skewX(-14.04deg)`. The 3.35 pt stagger quoted in #129
   does not match the template's 16.27 pt line at either 10° (2.87 pt) or
   14.04° (4.07 pt); it is the stagger of a 19 pt line at 10°. With the
   measured angle the stagger is **4.07 pt** at the template line and
   **3.05 pt** at the compact 12.2 pt line.

Other geometry notes:

- The Title's ink baseline is 1.4 pt above its layout baseline because the
  shear pivots at the default origin. That is why the compact Title reads
  639.88 against the 641.32 layout baseline; the template reads 640.12.
- The `--` is a **fixed block rule**, not a flowing row. Placed in flow, it
  drifted by up to ~49 pt between two columns when one Artwork omitted fields
  (page 15: left `--` at 142.62, right at 191.42). It is now absolutely
  positioned at Title + 157.2 pt, which is the PNG's measured 240.7 and keeps
  every column aligned. A title long enough to wrap six lines would reach it;
  five lines still clear it (measured with a 150-character title).
- The template's `--` is only in the PNG, not in the template PDF, so its
  baseline is the PNG measurement.

## Typography and the skew

- Compact is 9 pt / 7.5 pt with a 12.2 pt line and a 22.5 pt Title-to-Artist
  gap; template is 12 / 10, 16.27, 30. The compact scale is the template's
  rhythm × 0.75, and all field baselines matched the arithmetic exactly.
- Darker Grotesque Regular/Bold statics are shipped in
  `apps/web/public/fonts/` with `OFL.txt`. The browser build emits a separate
  494.2 kB gzip chunk for the whole PDF route.
- **Missing glyphs are the real typographic defect.** The title `☆⼺` has no
  coverage in Darker Grotesque and renders as a blank/`??` in the PDF; the
  sample's first page is that artwork. A fallback font (a Latin+CJK or symbol
  face) is needed before this is usable for arbitrary collection titles, or the
  product must state a Latin-only limitation.
- Real long titles wrap in both columns; rows below move down, and the second
  line of a wrapped title moves **left** by the stagger (3.05 pt compact,
  4.07 pt template). The right column is not invaded; the lower line moves
  away from it. The visible effect is that a wrapped second line starts
  ~2.4 pt (compact) or ~4.1 pt (template) inside the 72 pt left margin. A
  three-line title measured 68.09, i.e. 3.9 pt into the margin.
- Visually the skew reads as a clean bold italic, not a broken effect. On this
  evidence a baked oblique is **not** required for legibility; it would only be
  worth it if the 72 pt margin is a hard rule or a wrapped title must not move.

## Photos

`contain` was tested with all three shapes; there is no crop and no distortion:

| Source                | Rendered box | Position                      |
| --------------------- | ------------ | ----------------------------- |
| 4000 × 3000 landscape | 390 × 294    | vertically centred, y 186–480 |
| 3000 × 4000 portrait  | 390 × 520    | fills the 390 × 519 box       |
| 3200 × 3200 square    | 390 × 390    | vertically centred, y 138–528 |

Print box in pixels (the number a future implementation should size to):

| Density |  Target box |
| ------- | ----------: |
| 150 dpi |  813 × 1081 |
| 200 dpi | 1083 × 1442 |
| 300 dpi | 1625 × 2163 |

The box is 5.4167 × 7.2083 in, so 300 dpi is the hard upper bound; there is no
reason to ask the canvas for more. The renderer's `maxPx` can simply be that
table, with `fitInsideBox` never enlarging a smaller source.

### Original vs `xlarge`

63 photo pages (23 works: 20 with three photos and 3 with one), on the local
stack, headless Chrome, four parallel conversions:

| Source       | dpi | Downloaded |   JPEGs |          PDF |    Prefetch |     Render | Peak JS heap |
| ------------ | --: | ---------: | ------: | -----------: | ----------: | ---------: | -----------: |
| xlarge       | 200 |    45.6 MB | 22.8 MB | **22.86 MB** | 1.31–1.78 s | 136–143 ms |   111–115 MB |
| original     | 200 |    64.6 MB | 23.8 MB |     23.85 MB |      1.99 s |     137 ms |       113 MB |
| xlarge       | 300 |    45.6 MB | 41.5 MB | **41.55 MB** | 1.53–1.98 s | 156–163 ms |   109–110 MB |
| original     | 300 |    64.6 MB | 42.0 MB |     42.06 MB |      1.96 s |     159 ms |       122 MB |
| xlarge, q0.8 | 200 |    45.6 MB | 15.4 MB | **15.45 MB** |      1.31 s |     131 ms |       113 MB |

- `xlarge` is enough: its 2400 × 1800 / 1800 × 2400 (and 2400 × 2400 square)
  pixels are above the 1625 × 2163 box at 300 dpi. The original only adds bytes.
- At 200 dpi the original is 4.3 % larger; at 300 dpi 1.2 %. q0.8 cuts the
  200 dpi PDF by 32 % (22.86 → 15.45 MB) with the usual JPEG trade-off; use it
  only after a real-photo quality check, which the synthetic fixtures cannot
  answer.
- **EXIF orientation is honored.** The original of the `EXIF orientation 6`
  fixture still reports `orientation: 6` from Sharp and is stored 4000 × 3000;
  `createImageBitmap(..., "from-image")` produced an upright 390 × 520 page,
  identical to the already-oriented `xlarge` page. Both sources agree. A
  browser or decoder that ignored EXIF would rotate the original; using
  `xlarge` removes that class of bug entirely.
- The server's upload pipeline reports rotated dimensions (3000 × 4000) for the
  same photo, so the API metadata and the rendered result agree.

### Whole-browser memory

`performance.memory` only measures the JS heap (≈110 MB). The useful figure is
the browser process RSS, sampled with `ps`:

- Idle headless browser: ~972 MB.
- 63 pages at 200 dpi, `xlarge`: peak ~1732 MB (+760 MB), ~1777 MB after the
  export.
- 63 pages at 300 dpi, `xlarge`: peak ~1855 MB (+880 MB), ~1884 MB after.

The retained total after the export is the important number: the blob and the
converted images are still alive while the viewer shows the PDF. On a phone
this is the risk, not the layout. A production implementation should release
the converted blobs after `toBlob()` unless “Generate again” needs them, and
should not hold 300 dpi output for a 60-page collection on a low-memory device
without a warning.

The 49.7 MB figure in the research was full-resolution photos. Sizing to the
printed box gives 2.32 MB for the 17-page real sample and 22.86 MB for 63 pages
at 200 dpi.

## Viewer, progress and cancellation

- The route is lazy; the renderer chunk is 1.39 MB minified / **494.2 kB gzip**,
  separate from the main 409 kB gzip chunk. This confirms the #126 condition.
- The iframe receives a `blob:` URL. Download is an `<a download>` with
  `pdf-large-sources.pdf` (the URLized collection name).
- “Open PDF” calls `window.open(blobUrl, "_blank", "noopener,noreferrer")`.
  Playwright sees a popup whose URL is the blob URL; Chrome's PDF plugin owns
  the content, so its DOM is empty — that is the expected viewer, not a failure.
- With an iPhone viewport/profile the iframe is replaced by the mobile alert,
  and the “Open PDF” button is present. This was not tested on iOS hardware;
  the blob-popup path is the standard Safari workaround but should be checked
  on a device before shipping.
- Progress updates per photo, and cancel during the prefetch aborts the fetch,
  clears the run and leaves no PDF. Initial progress now reports `0 / N`
  instead of `0 / 0`.
- Rendering is atomic: cancel during “Building PDF” cannot interrupt the
  renderer; it aborts only after the render resolves, then discards the result.
  At 63 pages that is 136–163 ms, so it is negligible, but the Cancel button is
  still enabled while the copy says it cannot be interrupted. Disable it during
  the render phase in production.

## Edge cases

- **Placeholder.** Aborting one media request left the plan intact: 17 pages,
  13 converted, 1 unavailable. The page shows the same 390 × 519 outlined box,
  “Image unavailable”, and the source filename. The filename is useful in a
  prototype but leaks an internal name in a public PDF; drop it or replace it
  with a neutral line in production.
- **Empty collection.** One header-only page; 6,010 bytes.
- **Partial grid page.** Seven no-photo works produced 2 pages (six, then one),
  with the header repeated on page 2 and the `--` aligned.
- **Expired grant.** On a password-protected collection, unlocking and then
  removing the grant cookie made the next export re-lock instead of degrading
  into placeholders; no PDF was produced.
- **`wrap={false}` page-height bug.** In `@react-pdf/renderer` 4.9.0 a
  `Page` with `wrap={false}` and no height collapses its MediaBox to the
  content height (`[0 0 612 0]`). `minHeight: 792` restores `[0 0 612 792]`;
  every final page is 612 × 792. Pin the version until this is fixed, and keep
  the `minHeight` workaround.

## What is still open

- A real, photographic 12 MP comparison at 300 dpi to decide q0.8 vs q0.9;
  the synthetic fixtures show size but not grain.
- A fallback font strategy for titles outside Darker Grotesque's coverage, and
  the resulting font bytes in the PDF.
- Whether the right column really starts on Title (template) or Artist (#125).
- iOS hardware confirmation of the blob “Open PDF” path.
- The exact memory ceiling for a 60-page 300 dpi export on a phone; the desktop
  browser retained ~900 MB after the run.
- Font caching: `/fonts/*.ttf` is currently unhashed with the generic one-hour
  cache. A hashed asset or preload is the obvious production improvement; the
  API's SPA content map now serves `.ttf` as `font/ttf`.

## Files

- `apps/web/src/prototype/pdf/plan.ts` — the pure page plan.
- `apps/web/src/prototype/pdf/photoToJpeg.ts` — fetch, decode, fit, encode,
  with per-phase timings.
- `apps/web/src/prototype/pdf/CollectionPdf.tsx` — both templates, geometry,
  the skew, the fixed header, the placeholder.
- `apps/web/src/prototype/pdf/exportCollection.tsx` — orchestration, progress,
  cancellation, grant expiry, stats.
- `apps/web/src/prototype/pdf/PdfExportPage.tsx` — the throwaway shell.
- `apps/web/src/App.tsx` — the lazy route.
- `apps/web/public/fonts/` — Darker Grotesque statics and `OFL.txt`.
- `apps/api/src/spa.ts` — `.ttf` → `font/ttf`.
