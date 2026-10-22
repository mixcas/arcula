# Is `@react-pdf/renderer` viable in this app?

Research for [#126](https://github.com/mixcas/arcula/issues/126), in service of the
Collection PDF export charted in [#125](https://github.com/mixcas/arcula/issues/125).
Researched 2026-10-22 against the primary docs and the published package source,
with a local Chromium check.

## Verdict

**Yes — viable, with three non-negotiable conditions.**

1. **Lazy-load it.** The renderer is a ~512 kB gzip chunk on its own (measured
   below). It must sit behind the PDF route's dynamic `import()`, not in the app's
   initial bundle.
2. **Never let react-pdf fetch an image.** The renderer accepts only JPEG, PNG
   and SVG. The API's photo variants are WebP, and a WebP or a failed request is
   **silently dropped** — the PDF still resolves, with a blank where the photo
   belongs. The app must fetch, check and convert every photo to JPEG itself,
   then hand react-pdf a `Blob`. That preflight is also where the "Image
   unavailable" placeholder and the progress/cancel UI live.
3. **Generate once with `pdf(...).toBlob()` and render the blob in our own
   iframe.** `PDFViewer` is only that same iframe plus an internal `usePDF`; owning
   the blob gives us Download, error handling, and a mobile fallback. Treat the
   iframe as a desktop convenience, not the mobile story.

With those conditions the renderer does what the design needs: Letter portrait,
one photo per page, six-up grid, fixed metadata, a real downloadable PDF. No
Vite config, worker, WASM asset or top-level-await plugin is required.

## What was checked, and how

| Thing                 | Value                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| `@react-pdf/renderer` | `4.9.0` (published 2026-08-27, the latest at research time)                                      |
| Peer dependency       | `react: ^16.8.0 \|\| ^17.0.0 \|\| ^18.0.0 \|\| ^19.0.0`                                          |
| React support         | React 19 since v4.1.0 (docs), verified in the local check with React 19.3.1                      |
| Local check           | bare Vite 8.3.5 + React 19.3.1 app, built with Vite's defaults and run in headless Chromium 1234 |
| Toolchain             | Bun 1.4.2, Node 24.17.0, macOS arm64                                                             |
| Scratch project       | a temp directory outside the repo; no app source, lockfile or `package.json` was touched         |

The check app rendered one- and multi-page documents, fetched a PNG and a WebP
from a same-origin endpoint that required a cookie, converted the WebP through
`createImageBitmap` + `OffscreenCanvas`, and passed the resulting blob back to
`<Image>`. The reproduced results are in the sections below.

## 1. Version and React 19

`npm view @react-pdf/renderer version peerDependencies` reports `4.9.0` with
React 16.8 through 19 in its peer range. The compatibility page states React 19
support explicitly, "since v4.1.0" ([compatibility][1]). The renderer carries its
own bundled React reconciler (`@react-pdf/reconciler`) and does not use the host
React's DOM renderer; no `react-dom` peer is declared. In the check, React 19.3.1
rendered documents in both `vite dev` and `vite build` without a warning.

Node support is documented as 18/20/21 (the package is older than Node 24);
Bun is described as not officially supported but reported to work. Both the Vite
build and the Chromium check ran under Bun/Node 24 without incident. This is a
browser-side feature, so the Node support matrix is mostly relevant to the
optional test renderer (see §6).

## 2. Vite 8: no special configuration

`vite build` succeeded with the default config, no `optimizeDeps`, no `target`,
no worker and no WASM plugin. `vite dev` also worked. The measured output of the
bare app:

```
dist/assets/index-*.js   1,421.01 kB │ gzip: 512.35 kB
(!) Some chunks are larger than 500 kB after minification.
```

Why nothing special is needed:

- **Yoga's WASM is inlined, not a separate asset.** `yoga-layout@3.2.1` (the
  renderer's layout engine) imports `binaries/yoga-wasm-base64-esm.js`, a base64
  embedding of the module. There is no `.wasm` file to copy or serve and no
  `vite-plugin-wasm`/`vite-plugin-top-level-await` requirement.
- **Yoga does use top-level await.** `packages/yoga-layout/dist/src/index.js`
  ends with `const Yoga = wrapAssembly(await loadYoga())`. Vite 8's default
  `build.target` is `baseline-widely-available` ([build options][13]), which is
  well past the first browsers with top-level await (Safari 15, Chrome 89), so
  the build does not error. If the app ever lowers `build.target`, this is the
  first thing that will break.
- **No worker is used.** Layout, parsing and PDF assembly run on the main thread.
  That matters for the progress story (§5), not for bundling.

**Consequence:** import the renderer and its document module only from the PDF
route, via `React.lazy(() => import("./pdf/..."))` or an equivalent dynamic
import. Then the 512 kB gzip chunk is fetched when the PDF page is opened, not on
every app load. The app's existing Vite config needs no change.

## 3. Images: WebP is not supported, and failure is silent

### What `<Image>` decodes

The docs say "JPG or PNG images, as well as base64 encoded image strings"
([Image][2]). The published browser resolver is narrower than the docs' prose but
still excludes WebP. Its `isValidFormat` accepts exactly `jpg`, `jpeg`, `png`,
`svg`, `svg+xml`, and `getImageFormat` sniffs only JPEG, PNG and SVG
([`packages/image/src/resolve.ts`][8]). A remote URL goes through
`getImageFormat`, and on WebP:

```js
const format = getImageFormat(data);
if (!format) {
  throw new Error("Not valid image extension");
}
```

That error does not reach the caller of `pdf(...).toBlob()`. The layout layer's
`fetchImage` wraps resolution in `try/catch` and does `console.warn(e.message)`
([`packages/layout/src/image/fetchImage.ts`][9]). The node then has no image and
the page renders without it.

Measured in Chromium, with a 1-page A4 document:

| Image source             | `pdf(...).toBlob()` | PDF contains an image | Console                         |
| ------------------------ | ------------------- | --------------------- | ------------------------------- |
| no image                 | resolves, 1,606 B   | no                    | —                               |
| same-origin PNG          | resolves, 2,015 B   | yes                   | warning `Buffer is not defined` |
| same-origin WebP         | resolves, 1,618 B   | **no**                | `Not valid image extension`     |
| 404 URL                  | resolves, 1,618 B   | **no**                | `Not valid image extension`     |
| 403 URL (grant required) | resolves, 1,618 B   | **no**                | `Not valid image extension`     |

So a WebP photo, an expired grant, a 404 or a dropped request all produce the
same result: a PDF that looks complete and is quietly missing the artwork. This
fails the design's "Image unavailable placeholder page" requirement unless the
app knows about the failure before react-pdf does.

There is a second upstream wart: every image, successful or not, logs
`Buffer is not defined`. `fetchImage` sets `node.image` and then evaluates
`Buffer.isBuffer(source)`; `Buffer` is not a global in the browser, so the
`ReferenceError` is caught by the same `try` and warned. The image still renders
(the assignment happened first), but the console is polluted on every image and a
real failure is easy to miss. This is present in 4.9.0 and should be watched
upstream; it does not change the recommendation.

### The reliable conversion path

All current browsers decode WebP. The app already has a right-sized source: the
`xlarge` variant is `fit: "inside", max: 2400` (`apps/api/src/media/variants.ts`),
and `photoUrl(photo, "xlarge")` in `packages/shared/src/artworkPhotos.ts` already
falls back down the ladder. Convert that variant rather than `original`.

```ts
async function photoToJpeg(url: string, maxPx: number): Promise<Blob> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    // 403 password-required means the Access grant expired mid-export:
    // surface it as an export error, not as one missing photo.
    throw new ImageFetchError(res.status);
  }

  const bitmap = await createImageBitmap(await res.blob());
  const scale = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  // JPEG has no alpha; without this a transparent source turns black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  return canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
}
```

- `createImageBitmap` + `OffscreenCanvas.convertToBlob` is the shortest path and
  works off the main thread if the conversion is ever moved to a worker.
  `convertToBlob` is Baseline Widely Available; Safari has it since 16.4
  ([MDN][10]). The Vite 8 default target is newer than that.
- If support below Safari 16.4 is required, fall back to an `HTMLImageElement` +
  a DOM `<canvas>` + `canvas.toBlob("image/jpeg", 0.9)`. The mathematics and the
  white background are the same.
- **Hand the result to `<Image>` as a `Blob`.** `ImageSrc` includes `Blob`
  ([`packages/image/src/types.ts`][8]) and `resolveBlobImage` reads
  `blob.type` (`image/jpeg`) and sniffs the bytes. Measured: a converted JPEG
  blob produced a PDF containing the image. A `data:image/jpeg;base64,…` string
  also works, but inflates memory by a third and parses synchronously. Do **not**
  pass `{ data: Uint8Array, format: "jpg" }`: the browser path expects Node's
  `Buffer` methods (`readUInt16BE`), which a `Uint8Array` does not have.
- **Cap the pixel size.** Measured with a 3000×2000 JPEG: converting it took
  ~78 ms, and placing it on 10 pages produced a **49.7 MB** PDF (~5 MB per page)
  because each page embeds the full JPEG. That is the full-resolution original,
  not a print-sized image. Size to the printed box — roughly 2000 px on the long
  side is ~300 dpi for a 500 pt-wide photo, and 1400–1700 px is usually
  indistinguishable in print. Re-measure on the prototype's real page geometry.
  This is the difference between a 5–15 MB export and a 150 MB one.
- **Run conversions with bounded concurrency** (4–6) and keep only the resulting
  `Blob`s. Ninety 2–4 MP bitmaps held at once is an iOS memory failure waiting to
  happen.

### Location: `apps/web/src/pdf/photoToJpeg.ts`

The conversion is app infrastructure, but the pure part — "fit these source
dimensions inside this box, never enlarge" — should be a plain exported function
and unit-tested. The canvas call itself is a browser API, not our logic.

### The Access grant cookie

The renderer's `fetchRemoteFile` passes `credentials` straight through to
`fetch`, defaulting to the browser's default `same-origin`
([`resolve.ts`][8]). The app's media URLs are relative (`/api/v1/media?key=…`):
in development Vite proxies `/api` to the API, in production the SPA and API are
the same Lambda. They are same-origin either way. The Access grant cookie is
`arcula_grant_{collectionId}`, `Path=/api/v1`, `HttpOnly`, `SameSite=Lax`, so it
is in scope for the media proxy.

Measured: an image request from the renderer to `/api/v1/media` carried
`arcula_grant_test=abc` without setting `credentials: "include"`. The same is
true of the preflight `fetch` above, because `same-origin` is the default. Passing
`credentials: "include"` would work too but is unnecessary here and would widen
what a cross-origin error could do; write `"same-origin"` explicitly so the
intent is visible.

The proxy is also the right place to distinguish an access failure from a broken
image: it answers `403 password-required` when a Protected collection's grant is
missing or expired, and `404` for a refused work. The preflight should treat
those statuses as "the export cannot continue" (re-run the unlock flow in the
page) rather than as 30 individual placeholder pages.

## 4. `PDFViewer` vs `usePDF`/`toBlob()` in an iframe

`PDFViewer` is not a different viewer. Its implementation is `usePDF` plus an
`<iframe src={objectUrl + "#toolbar=…"}>` ([`react-pdf.browser.js`][11]); the
browser's built-in PDF viewer does the rendering. `pdf(...).toBlob()` and
`usePDF` therefore produce exactly the same bytes and the same embedded viewer.
The choice is about control, not rendering:

|                     | `PDFViewer`                                                                       | `pdf().toBlob()` + own iframe                               |
| ------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Bytes               | same                                                                              | same                                                        |
| Download            | needs the blob anyway (or a second render)                                        | blob already in hand                                        |
| Loading/error state | internal; only the iframe is exposed                                              | ours to render                                              |
| Re-render control   | `useEffect` on `children` identity; an unstable document re-renders the whole PDF | generated once, explicitly                                  |
| Mobile              | same iframe                                                                       | same iframe, or a download card instead                     |
| Progress/cancel     | none                                                                              | progress in the preflight; the final render is still atomic |

**Recommendation:** generate once with `pdf(<CollectionDocument … />).toBlob()`,
keep the blob, and render it in our own `<iframe>`. That is the same native
viewer with the download already solved, and it leaves room for the mobile
branch. If `PDFViewer` is used, the document element must be memoized; otherwise
every parent render calls `updateInstance(children)` and re-renders the document.

### Long documents

The native PDF viewer handles hundreds of pages; the cost is generation and
image bytes, not viewing. In the scratch check, 100 text-only A4 pages rendered
in ~17 ms; 50 pages with one cached tiny image in ~17 ms; 10 pages with a 5 MB
JPEG produced a 49.7 MB blob in ~60 ms. The blob size is the real risk (and the
memory to hold it), and it comes from full-resolution images, not page count.

`pdf(...).toBlob()` exposes no progress and no cancellation once called. Put both
in the preflight: `Preparing photos 12 / 30`, an `AbortController` around the
fetches and conversions, and a final `Building PDF…` state for the atomic
`toBlob()`. That matches the charted "progress and cancellation on a large
collection" question without fighting the library.

### Mobile

An iframe showing a PDF is unreliable on iOS: the embedded WebKit PDF viewer is
widely reported to show only the first page and not scroll a multi-page document
inside an iframe (for example [this Apple Support thread][12]). This is a
field-reported platform behaviour rather than a written spec, so the prototype
should confirm it on a real device. Design around it:

- Always show **Download** (the blob is already there).
- On a coarse pointer / small viewport, replace the iframe with an "Open PDF"
  card that calls `window.open(blobUrl)` from the user's tap; Safari's own PDF
  viewer handles the blob and all pages correctly. A new tab opened without a
  gesture will be blocked, so it must be a button.
- Optionally keep the iframe on desktop where the native viewer is good.

No PDF.js dependency is needed for this design.

## 5. Document structure

The page plan is the natural seam: a pure function turns the collection into a
list of pages, and the JSX renders that list without deciding anything.

```ts
type PdfPage =
  | { kind: "photo"; artwork: Artwork; photo: ArtworkPhoto | null }
  | { kind: "grid"; artworks: Artwork[] }; // at most six

export function buildPdfPlan(artworks: Artwork[]): PdfPage[] {
  // Published and live only, sorted by Artist Name then Title.
  // Each artwork contributes up to three photo pages (a failed photo is a
  // page with photo: null); artworks with no photos are batched six per page.
}
```

This is testable at the repo's first altitude — our data in, our page list out —
and it is where page count, ordering, the three-photo cap and the six-up grid
actually live. Mutation checks are meaningful: change six to eight, drop the
photo cap, or reorder the comparator and the test goes red.

Rendering is then mechanical:

- `<Page wrap={false}>` for every planned page. React-pdf's default is wrapping
  on, and an over-tall photo page would spill onto a second page; with
  `wrap={false}` a page count that differs from the plan is a bug, not a layout
  adjustment. The docs warn that `wrap={false}` only works for content that fits,
  which is exactly what the plan guarantees ([page wrapping][5]).
- `<Image src={blob} style={{ objectFit: "contain" }} />` inside a fixed box.
  `contain` is the design's no-crop rule; the conversion already preserved the
  aspect ratio.
- A failed photo becomes an explicit placeholder page, because the preflight
  marked it failed before the document was built.

### Test strategy that does not assert library internals

1. **Unit-test `buildPdfPlan`** — the repo's tier 1. Cover: no artworks → no
   pages; photo ordering; a work with three photos; a work with four (only three
   survive); a mix of photo and no-photo works; grid boundaries at 6 and 7; the
   artist-then-title ordering; a failed photo still producing its placeholder.
   Assert the plan, not the DOM or the PDF.
2. **Do not test rendered props or the library's layout.** The
   renderer's pagination is its own; a test that a `<Text>` renders a string is
   tier 3 under the repo's doctrine.
3. **Optional integration check, not required:** a Vitest file with
   `// @vitest-environment node` can import the document component and call
   `renderToBuffer`, then count pages with `pdf-lib`. This worked in the scratch
   check (30 pages → `getPageCount() === 30`) and would catch a developer leaving
   `wrap` on and a photo page silently doubling. It costs a dev dependency and
   renders through a Node-specific build, so it is worth adding only if the
   prototype finds pagination drift. The plan test covers the intended count;
   this covers the renderer agreeing with it.
4. **The browser-only parts** — canvas conversion, cookie-carrying fetch, the
   iframe — are verified in the prototype, not in jsdom. jsdom has no canvas and
   no PDF viewer, so a mock would assert the mock. This is the one place the
   repo has no harness; do not invent one for this feature.

## 6. Costs, risks and what is still uncertain

**Known costs**

- ~512 kB gzip added to the PDF route (lazy chunk), not the app shell.
- A main-thread layout/render pass. Acceptable at this document's size, but the
  UI must not be interactive during the final `toBlob()`.
- Generated PDF size is dominated by the converted photos. The `xlarge` variant
  caps at 2400 px; still downscale to the print box and measure. A 5 MB image on
  ten pages measured 49.7 MB of PDF.
- Upstream console noise: `Buffer is not defined` on every image in 4.9.0.
  Harmless, but it hides the `Not valid image extension` warning that matters.

**Still uncertain (settle in the prototype, [#129](https://github.com/mixcas/arcula/issues/129))**

- The real print size of the photo box and therefore the right `maxPx`; the
  2000 px figure above is an estimate for a 500 pt-wide image at 300 dpi.
- Real-photo timings and peak memory on iOS Safari, including a 30-artwork
  collection with three photos each.
- Whether `wrap={false}` interacts badly with a fixed header/footer on the same
  page (the charter wants a repeated collection header on grid continuations).
- The actual iOS iframe behaviour on the target devices. The plan above avoids
  depending on it, but the prototype should confirm the "Open PDF" path opens a
  blob URL correctly from a tap.
- Whether the installed version should be pinned to `4.9.0` (recommended while
  the Buffer warning is open) or allowed to float within `^4`.

**Not recommended alternatives** (out of scope unless the conditions above are
rejected): server-side PDF generation conflicts with the charted browser-only
decision; pdfmake/jsPDF would need the same image conversion and a hand-built
layout engine. The renderer is the right tool for this document.

## Sources

1. React-pdf, [Compatibility](https://react-pdf.org/docs/v4/compatibility) — React
   19 since v4.1.0; Node 18/20/21; the esbuild/Yoga note.
2. React-pdf, [Image](https://react-pdf.org/docs/v4/components/image) — JPG/PNG
   prose, source object forms including `credentials`.
3. React-pdf, [PDFViewer](https://react-pdf.org/docs/v4/components/pdf-viewer) —
   iframe viewer.
4. React-pdf, [On the fly rendering](https://react-pdf.org/docs/v4/advanced/on-the-fly-rendering)
   — `usePDF`, `BlobProvider`, `pdf().toBlob()`.
5. React-pdf, [Page](https://react-pdf.org/docs/v4/components/page) and
   [Page wrapping](https://react-pdf.org/docs/v4/advanced/page-wrapping) —
   `wrap` defaults to `true`; images are unbreakable.
6. React-pdf, [Fonts](https://react-pdf.org/docs/v4/fonts) — TTF/WOFF only;
   relevant to [#127](https://github.com/mixcas/arcula/issues/127), not this
   ticket.
7. npm registry metadata for `@react-pdf/renderer@4.9.0` — `npm view` output:
   version, peer dependencies, dependency tree (Yoga via `@react-pdf/layout`,
   `@react-pdf/image@3.1.2`, `yoga-layout@3.2.1`).
8. Published source, browser image resolver:
   [`packages/image/src/resolve.ts`](https://github.com/diegomura/react-pdf/blob/master/packages/image/src/resolve.ts)
   and [`types.ts`](https://github.com/diegomura/react-pdf/blob/master/packages/image/src/types.ts)
   — `isValidFormat`, `getImageFormat`, `fetchRemoteFile`, `resolveBlobImage`.
9. Published source, layout image fetch:
   [`packages/layout/src/image/fetchImage.ts`](https://github.com/diegomura/react-pdf/blob/master/packages/layout/src/image/fetchImage.ts)
   — `try/catch` + `console.warn`, and the `Buffer.isBuffer` browser bug.
10. MDN, [`OffscreenCanvas.convertToBlob()`](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob)
    — Baseline Widely Available; Safari 16.4.
11. Published browser bundle:
    `@react-pdf/renderer/lib/react-pdf.browser.js` in 4.9.0 — `PDFViewer` is
    `usePDF` + `<iframe>`, with `useEffect(() => updateInstance(children), [children])`.
12. Apple Support Community, ["PDF file is showing only the first page in iFrame
    in iPad browsers"](https://discussions.apple.com/thread/255078602) — field
    report of the iOS iframe limitation.
13. Vite, [Build Options — `build.target`](https://vite.dev/config/build-options)
    — default `baseline-widely-available`.
14. Arcula context: [#125 Collection PDF export](https://github.com/mixcas/arcula/issues/125),
    `apps/api/src/media/variants.ts` (`xlarge` max 2400),
    `packages/shared/src/artworkPhotos.ts` (`photoUrl` ladder),
    `apps/api/src/routes/media.ts` (the proxy and its 403/404 shapes).

## Reproducing the local check

The scratch project is not committed. It was:

```sh
mkdir /tmp/rpdf-check && cd /tmp/rpdf-check
bun add @react-pdf/renderer@4.9.0 react@19 react-dom@19
bun add -d vite@8 @vitejs/plugin-react playwright
# a Vite app whose page exposes window.makePdf(mode)
bun run build
# serve dist + /api/v1/media (PNG, WebP, 404, 403 + cookie)
node test.mjs   # Chromium: measure toBlob, parse "/Subtype /Image" from the blob
```

The assertions that mattered were: build exit 0 with no Vite config; PNG source →
image present in the PDF; WebP, 404 and 403 → `toBlob` resolves and no image is
present; the media request carries the cookie without `credentials: "include"`;
a converted JPEG blob is accepted; and 10 pages with a 5 MB image produced a
49.7 MB blob. No app source or dependency file was changed.
