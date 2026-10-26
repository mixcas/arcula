# Collection PDF

**Status: implementation-ready.** This is the contract for the Collection PDF
feature. It is precise enough to ticket without further design decisions; the
prototype branch and the design templates are evidence, not the source of truth.

The product vocabulary is [GLOSSARY.md](../../GLOSSARY.md)'s: **Collection**,
**Artwork**, **Artwork photo**, **Visitor**, **Owner**, **Collaborator**, and the
**Collection PDF** it defines. "Catalogue" is not used for a Collection.

The design record, in order:

- Decision: [ADR-0006](../adr/0006-the-collection-pdf-prints-from-its-own-variant.md)
  — the photo box, the 0.75 in margin, and why the export has its own
  `xxlarge` variant.
- Map: [#125 Collection PDF export](https://github.com/mixcas/arcula/issues/125).
- Research: [#126 renderer viability](https://github.com/mixcas/arcula/issues/126)
  and [#127 fonts and the oblique Title](https://github.com/mixcas/arcula/issues/127).
- Grilling: [#128 access and edge cases](https://github.com/mixcas/arcula/issues/128).
- Prototype: [#129 one real collection end to end](https://github.com/mixcas/arcula/issues/129),
  on the branch `prototype/pdf-export` (never merged). Its measured tables are in
  `docs/prototypes/pdf-export/README.md` on that branch; the sample PDFs and
  rendered pages are beside it. The template this document was measured from is
  `docs/templates/pdf/arcula-pdf-template.pdf`, with
  `artwork-page.png` and `artworks-grid.png` beside it.

## What it is

A **Collection PDF** is the public-facing export of a Collection's published,
live Artworks as one document: a photo page for each of an Artwork's first three
photos, then a 2 × 3 grid of the Artworks that have no photos. It is an export of
the Collection, never a second presentation of it.

It is generated **in the browser**. There is no server-side PDF generation and
no endpoint that answers `application/pdf`; the API's only role is the font
subset described under **Fonts**.

The decisions with their rejected alternatives are the map (#125) and the
grilling (#128): server-side generation, a raw `application/pdf` response, a
hard page cap, a Google-hosted fallback font and a link on the public page were
all considered and rejected there. No separate ADR is written because the
feature changes no system-wide invariant: the Collection remains the only
visitor gate ([ADR-0003](../adr/0003-the-collection-gates.md)), the
export is a read, and no schema or deploy shape changes.

The route is a viewer page:

```
/collection/:collectionId/pdf
```

`:collectionId` is the same `{urlizeName(name)}-{id}` parameter the public
Collection page uses, read with `parseId` (`packages/shared/src/slug.ts`), so a
link may carry either the slugged or the bare id.

### The decisions the map left open

| Question                            | Decision                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------- |
| Memory policy and warning threshold | Release converted blobs and the URL; warn at 30 photo pages (15 on a low-memory device); no cap |
| A wrapped Title inside the margin   | The paint-time skew stands; 72 pt is a layout margin, not an ink boundary; no baked oblique     |
| Production font fallback            | A self-hosted Noto Sans SC subset served by the API, cached; no Google call per export          |
| The subset's missing tables         | Not ours: hb-subset (via `subset-font`) writes a complete font, `cmap` and `post` included      |
| Font serving                        | Keep `public/fonts/` under the one-hour cache; add `font/ttf`; no hashing or preload            |
| iOS hardware                        | The mobile shell never embeds an iframe; confirm the blob popup once on a device                |
| The renderer's `Buffer` warning     | Leave it; do not add a polyfill                                                                 |
| The right column's first row        | The Title row (Dimensions at 641.32), not the Artist row                                        |
| The grid `--`                       | A fixed, absolutely positioned rule at Title + 157.2 pt                                         |
| Typography                          | 12 pt body / 10 pt header; the compact scale is not shipped                                     |

## Access

The route is public chrome, not a `ProtectedRoute`. Access is decided by the two
ordinary reads, exactly as the public Collection page decides it.

| Caller                                      | May export                                                        |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Owner or Collaborator                       | Any Collection they can read — public, private or Protected       |
| Visitor                                     | A public Collection, or a Protected one with a valid Access grant |
| Visitor, private Collection                 | No — the private state                                            |
| Visitor, Protected Collection without grant | No — the lock screen, then the ordinary load on success           |

An Owner or Collaborator is never challenged by a Collection's password, and
sees the manage entry point (below) on private and Protected Collections too.
The route, not the link, is what enforces this.

**Content is always published, live Artworks only.** For both an Owner or
Collaborator and a Visitor: no drafts, no deleted Artworks, no Artwork
documents. A missing `status` reads as `published` (the model's rule
everywhere); a missing or `null` `deletedAt` reads as live. The list read for an
Owner or Collaborator includes drafts, so the export filters them again on the
client; the Visitor's list is already public-only. Neither caller gets a
different document because of who they are — "published, live only" is one
rule.

### The two reads

1. `GET /api/v1/collections/:collectionId` — through
   `collectionService.getCollection`. A `404` resolves `null` and is the
   **notFound** state; a `403` with code `password-required` is the **locked**
   state and opens `CollectionLockScreen`; any other `403` is **private**; any
   other failure is **error**.
2. `GET /api/v1/collections/:collectionId/artworks` — through
   `artworkService.getCollectionArtworks`, only once the Collection read has
   succeeded. The service returns live works (drafts included for an Owner or
   Collaborator, published only for a Visitor).

The page reuses `publicFailure` from
`apps/web/src/components/collection/usePublicCollection.ts` for the
`locked`/`private`/`error` decision rather than re-deriving it. On unlock, the
lock screen's `onUnlocked` runs the same load again; the grant cookie is now
set, and the export restarts from the beginning.

## The page plan

The plan is pure data over the loaded Artworks. It is the part of the feature
worth testing hardest, because it is the document's structure and it has no
library underneath it.

### Filtering

```ts
isExportable(artwork) =
  (artwork.status ?? "published") === "published" && !artwork.deletedAt;
```

### Ordering

One `Intl.Collator` for the whole document:

```ts
new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
```

The comparison is:

1. `artistName`
2. `title`
3. `id`

`sensitivity: "base"` makes the order case- and accent-insensitive;
`numeric: true` makes `2` sort before `10`. The `id` tie-break makes two works
with identical artist and title stable. A blank artist name is not a case:
`artistName` is required and trimmed by the schema.

### Photo pages

For each exportable Artwork **with at least one photo**, in sorted order:

- take the first **three** photos in the Artwork's stored order (`sortPhotos`
  from `packages/shared/src/artworkPhotos.ts`);
- emit one page per photo, so a work with one photo is one page, and a work with
  three is three pages;
- the Artwork's metadata block is repeated on every one of its pages.

A fourth and later photo is never used. A work is classified by the photos it
**has**, not by whether they load: a non-empty `photos` array whose every URL is
missing or fails still gets its photo pages, with placeholders.

### The no-photo grid

After every photo page, the exportable Artworks **with no photos** follow in the
same sorted order, six per page: a 2-column × 3-row grid, filled left to right,
top to bottom. A partial last page keeps the same geometry and the repeated
header; a page never spills a seventh block.

A work with photos never appears in the grid, and a work without photos never
gets a photo page.

### An empty Collection

A Collection with zero exportable Artworks — including one that holds only
drafts — produces a **one-page, header-only PDF**: the Collection name at the
header position and nothing else. The viewer generates it like any other export,
keeps Download, and shows "This collection has no published artworks." above the
preview. There is no separate empty state and no disabled control; an Owner or
Collaborator and a Visitor see the same thing.

### Page count

```
photoPages = Σ min(3, |photos(artwork)|)   over exportable works with photos
gridPages  = ceil(|exportable works with no photos| / 6)
pages      = photoPages + gridPages       (or 1 when both are zero)
```

The count depends only on the data, never on whether an image loads, so a
successful export and one with failed images have the same page count.

## Page geometry

US Letter portrait, all values in points (`1 pt = 1/72 in`), origin at the
page's top-left. Every page is **612 × 792 pt** (8.5 × 11 in).

| Element                          | Value                               |
| -------------------------------- | ----------------------------------- |
| Page                             | 612 × 792 pt                        |
| Left and right margin            | 54 pt                               |
| Content width                    | 504 pt                              |
| Header baseline                  | 45.38 pt from the top               |
| Photo box                        | left 54 pt, top 60 pt, 504 × 580 pt |
| Photo-page Title baseline        | 665 pt layout; ink about 663.8 pt   |
| Photo-page right-column baseline | 665 pt from the top                 |
| Photo-page Artist baseline       | 693.8 pt from the top               |
| Metadata columns                 | left 54 pt / right 324 pt           |
| Metadata column width            | 234 pt                              |
| Grid first Title baseline        | 83.52 pt from the top               |
| Grid columns                     | 54 pt and 324 pt, 234 pt wide       |
| Grid block pitch                 | 191.52 pt                           |
| Grid `--` baseline               | Title baseline + 157.2 pt           |

Two rows moved off the template's own numbers and the rest did not. The
**margin** is 0.75 in rather than 1 in, which gives the photo box 36 pt on each
side; the **metadata band** starts 23.68 pt lower (665 rather than 641.32), which
is what pays for the photo box's extra 61 pt of height. Both are the whole trade
of that band: it is the only knob on the photo's size, and 665 is the last step
that leaves a 3-line Title with every field present **29 pt** above the paper's
edge (690 would leave 4 pt). The metadata columns widen from 216 to 234 pt so the
gutter stays 36 pt across the wider content.

The **photo box is the whole free rectangle, not a shape chosen for one
orientation.** A photo is `contain` fitted, so the box's own aspect crops
nothing: a wider box is free for every work narrower than it, and it is the only
box a tall work can grow into. What a work actually prints at:

| Work (`xxlarge`) | Prints at    | Bound by |
| ---------------- | ------------ | -------- |
| 3:4 portrait     | 435 × 580 pt | height   |
| 1:1 square       | 504 × 504 pt | width    |
| 3:2 landscape    | 504 × 336 pt | width    |

React-PDF lays a line box out from its top, with the baseline at
`fontSize × 1.06` inside it. A block that wants a baseline at `b` with type size
`s` is therefore positioned at `top = b − s × 1.06`. This is measured from the
template and is part of the implementation, not an approximation to rediscover.

### The header

The Collection name, once per page, including every grid continuation and the
empty page:

- `fontFamily` Darker Grotesque, **400**, **10 pt**, line-height 1.2;
- left 72 pt, width 468 pt, baseline 45.38 pt;
- one line. A name that does not fit 468 pt is ellipsized; it is not wrapped
  into the photo box. The full name remains the PDF's Title and the filename's
  source.

There is no "continued" marker, no page number and no other continuation
signal: the repeated header alone is the signal.

## Typography

The scale is the template's own, at 100%:

| Token            |    Value |
| ---------------- | -------: |
| Body             |    12 pt |
| Header           |    10 pt |
| Line height      | 16.27 pt |
| Title rhythm     |    30 pt |
| `--` below Title | 157.2 pt |

The charted 9 pt body / 7.5 pt header scale (the template's rhythm × 0.75) was
rejected; it is not shipped and there are no size options in the URL or the UI.

Darker Grotesque **Regular 400** is the body face and **Bold 700** the Title.
Hyphenation is off: register `Font.registerHyphenationCallback((word) => [word])`
so the renderer never invents a hyphen in a title.

### The Title and its oblique

The Title is:

- Bold 700 at the body size, line-height `16.27 / 12`;
- `transform: "skewX(-14.04deg)"` — the template's text matrix is
  `1 0 0.25 -1`, and `atan(0.25) = 14.04°`;
- 6 pt of right padding so the last glyph's ink does not enter the next column.

The skew is applied at paint time, so it moves no row. Its consequences are
accepted and are not defects:

- the Title's ink baseline sits about 1.4 pt above its layout baseline (the
  shear pivots at the default origin);
- a wrapped second line starts left of the first by about **4.07 pt** per line
  at the 16.27 pt line height. A three-line Title may put its last line about
  4 pt inside the 72 pt left margin. **The 72 pt value is a layout margin, not a
  hard ink boundary**; the Title is not baked into an oblique, not clipped, and
  not auto-shrunk.
- Titles are never truncated. A title long enough to flow past the available
  vertical space is allowed to do so and is clipped by the page. The design is a
  fixed export template; it does not reflow the page.

### Metadata fields

The fields, in the order the design lists them:

| Field            | Source           | Required |
| ---------------- | ---------------- | -------- |
| Title            | `title`          | yes      |
| Artist Name      | `artistName`     | yes      |
| Serie            | `serie`          | no       |
| Media            | `media`          | no       |
| Dimensions       | `dimensions`     | no       |
| Editions         | `editions`       | no       |
| Date of Creation | `dateOfCreation` | no       |
| Place of Origin  | `placeOfOrigin`  | no       |

Only the values are printed; there are no field labels. An optional field is
omitted when it is absent, `null`, or empty after trimming. Omitting a field
moves the fields after it up; it does not leave a blank row. `title` and
`artistName` are always printed (both are required and trimmed by the schema).

Acquisition date, acquisition price, current value, provenance, condition and
notes are not in the document.

### Photo-page metadata block

Two columns, both starting at baseline **641.32 pt** — the right column begins
on the **Title row**, not the Artist row. This is the measured template and is
the decision.

- **Left column** (left 72 pt, width 216 pt): Title at the 641.32 pt layout
  baseline, then Artist Name at **670.12 pt**, then Serie and Media 16.27 pt
  apart. The template's 30 pt rhythm is the source, but the measured baseline is
  the acceptance: Artist sits 28.8 pt below the Title's layout baseline and
  30 pt below its ink. A wrapped Title pushes the rows below it down by its
  extra lines.
- **Right column** (left 324 pt, width 216 pt): Dimensions, Editions, Date of
  Creation, Place of Origin, one 16.27 pt line each, beginning at the 641.32 pt
  baseline. When Dimensions is empty, Editions begins on that row.

The Title wraps within 216 pt and the rows below it move down in flow. The
right column is independent of the left column's height.

### Grid block

Each block is a single column of 216 pt:

- Title at the block's first baseline, then the same 30 pt Title rhythm as the
  photo page;
- Artist Name, Serie, Media, Dimensions, Editions, Date of Creation, Place of
  Origin, one 16.27 pt line each, empty fields omitted;
- a `--` (two hyphens, Regular 400, body size) at **Title baseline + 157.2 pt**,
  **absolutely positioned**, not in flow. It is identical in both columns and
  does not drift when a work omits fields. The template's `--` exists only in
  the PNG, so this is the PNG measurement.
- block baselines: `83.52 + row × 191.52` for row 0, 1, 2; column x is 72 pt for
  the left block and 324 pt for the right.

The `--` is a grid divider only; photo pages have no `--`.

A block whose content is taller than the 191.52 pt pitch (a very long title plus
many fields) is allowed to overrun the pitch and cross the `--`; nothing is
truncated. This is a fixed template's boundary, recorded rather than hidden by
auto-sizing.

## Photos

### Source

The ladder is **`xxlarge` → `xlarge` → `original`**, walked by
`scheduledPhotoSource` in `apps/web/src/components/pdf/photoPipeline.ts`.

- **`xxlarge`** (max 3000 px) is the export's own size, and the reason it
  exists: the box is 504 × 580 pt, which at 300 dpi needs **2100 × 2417 px**, and
  `xlarge`'s 2400 cap falls 17 px short of the height. Without it the largest
  page would print 3 pt under its box.
- **`xlarge`** (max 2400 px) is the fallback for a photo uploaded before
  `xxlarge` existed. It prints the same picture, up to 3 pt shorter.
- **`original`** is the last resort, and is never embedded directly, even when
  it is JPEG or PNG:

  - it may be WebP (the API's variants are WebP and the original is whatever was
    uploaded);
  - it may carry EXIF orientation, which the renderer does not apply;
  - it can be up to 10 MiB and arbitrarily large.

Both variants are already oriented. If neither exists, the ladder's `original`
is the single fallback; if there is no URL at all, the page is a placeholder.
There is no second attempt at another variant when a chosen URL fails.

### Conversion

React-PDF decodes JPEG, PNG and SVG and **silently drops** a WebP, a 404 or a
403: `toBlob()` still resolves with a missing photo and only a `console.warn`.
The app therefore owns the image bytes.

For each distinct scheduled photo, with at most **four** conversions in flight:

1. `fetch(url, { credentials: "same-origin", signal })` — the same-origin grant
   cookie rides along. A non-`ok` response is a failure.
2. Fit inside the print box at **300 dpi** without enlarging:
   `scale = min(1, boxW / width, boxH / height)`, rounded, at least 1 px.
   The box is 504 × 580 pt = **2100 × 2417 px** at 300 dpi.
3. `createImageBitmap(blob, { imageOrientation: "from-image", resizeWidth,
resizeHeight, resizeQuality: "high" })` — **decoded to the box**, not to the
   source. The source's size is already on the wire (the variant row records its
   encoded pixels, the photo its original's), so step 2 runs before the decode:
   a 3000 px `xxlarge` never lands in memory whole, and the peak per conversion
   is the box's 4.4 Mpx rather than the source's 6.8. A record with no dimensions
   decodes at its own size and fits afterwards — the same picture, a larger peak.
4. Paint white, then the bitmap, onto an `OffscreenCanvas`; fall back to a DOM
   `<canvas>` when `OffscreenCanvas` is unavailable. JPEG has no alpha, so the
   white ground is required or a transparent source turns black.
5. Encode `image/jpeg` at **quality 0.9** and keep the `Blob`.

The target box is the hard upper bound; never ask the canvas for more than
2100 × 2417. `xxlarge` at 3000 × 2250 already exceeds it. The converted JPEG
keeps its own pixel size; on the page it is placed at its print size
(`px × 72 / 300` pt), centred in the 504 × 580 pt box, capped at the box and
never enlarged. This is `contain` with no upscaling: no crop, no distortion.

`ImageBitmap.close()` runs as soon as the JPEG is encoded. Converted blobs are
released after `toBlob()` resolves (or on cancel/unmount); they are not kept for
a second generation.

### Failure and the placeholder

A failed fetch, decode or encode is **not** an export failure. That photo's page
keeps its place in the plan and draws:

- the same 504 × 580 pt box at left 54 / top 60;
- a 0.75 pt `#c9c9c9` border;
- "Image unavailable" centred, body size, `#666666`.

The Artwork's metadata and the Collection header still render. There is no
filename, error code or other internal detail on the page. One failed photo is
one placeholder page; the page count never changes.

The exception is access. See below.

### An expired Access grant

The media proxy answers a missing or unauthorised object with **404**, not
`403 password-required`; only the Collection read carries that code. So a media
`404` or `403` is not immediately a placeholder:

1. re-read the Collection with `collectionService.getCollection`;
2. if it rejects `403 password-required`, the grant died: **stop the export,
   discard the work, show `CollectionLockScreen`**, and on unlock reload and
   restart the export from the beginning — never a document full of
   placeholders;
3. if it rejects any other `403`, access was lost mid-export (the Collection
   became private): **stop and show the private state**, not placeholders;
4. if it resolves `null` (`404`), the Collection is no longer available: **stop
   and show the notFound state**;
5. if the re-read succeeds, the refusal was a genuinely missing object: draw the
   placeholder and continue;
6. any other re-read failure (network, 500) is treated as a broken image:
   placeholder and continue. It does not imply lost access; a retry is the
   reader's next action, not a state change here.

## Fonts

### The brand face

Darker Grotesque ships as the upstream static instances from
`bettergui/DarkerGrotesque`, pinned to the commit
`a5c3584b44ab3a7d272565662139ee07bb72e8e8` (not `master`):

- `apps/web/public/fonts/DarkerGrotesque-Regular.ttf` (400, 78,736 B, SHA-256
  `5a33d1839921b327d503cace71e6693403df5f5f39d47f10c25bf7265c8bef52`);
- `apps/web/public/fonts/DarkerGrotesque-Bold.ttf` (700, 79,460 B, SHA-256
  `27c8e3e7dda7a96729c851e32b4d133c018f3c982191d700c6d810c51c916914`);
- `apps/web/public/fonts/OFL.txt` (the project's OFL 1.1; no Reserved Font
  Name, so bundled use and embedded PDFs are permitted).

Fetch them from the pinned raw URLs under
`https://raw.githubusercontent.com/bettergui/DarkerGrotesque/a5c3584b44ab3a7d272565662139ee07bb72e8e8/`.
Both files are `fsType 0` (installable embedding), so embedding them in a PDF is
expressly allowed.

The variable font on Google Fonts must not be used: React-PDF renders it as its
default Light 300 for every requested weight, silently. The statics select
400/700 correctly.

Registration:

```ts
Font.register({
  family: "Darker Grotesque",
  fonts: [
    { src: "/fonts/DarkerGrotesque-Regular.ttf", fontWeight: 400 },
    { src: "/fonts/DarkerGrotesque-Bold.ttf", fontWeight: 700 },
  ],
});
```

Serving: the files stay in `apps/web/public/fonts/` under the existing generic
one-hour cache. They are not hashed and not preloaded: only the lazy PDF route
needs them, they total about 158 kB, and a one-hour cache is enough for a
returning viewer. `apps/api/src/spa.ts` must add `".ttf": "font/ttf"` to its
content-type map; without it the file is served as
`application/octet-stream`. A missing font path falls through to `index.html`
(200 HTML), which surfaces as a fontkit parse error, so the content type and the
real files are part of the nav.

### The fallback face

Darker Grotesque is Latin-only. React-PDF embeds its own font data, so the
browser's fallback never runs: a glyph the brand face lacks draws as `.notdef`
(blank). React-PDF _does_ substitute per code point across a `fontFamily` stack,
so the export registers a second family for exactly the characters it draws.

Production shape (this replaces the prototype's call to Google Fonts):

- Ship a static **Noto Sans SC Regular** TTF in
  `apps/api/src/assets/fonts/NotoSansSC-Regular.ttf`, with its `OFL.txt` beside
  it. Commit the file (it is about 10 MB) rather than fetching it at build or
  request time. It is the one fallback face: it covers Han, kana and a wide
  symbol range; color emoji and scripts it lacks remain a documented `.notdef`
  limitation.
- Add `GET /api/v1/pdf/font-fallback?text=<characters>` to the API. It is public
  (a Visitor needs it too), takes the distinct **non-ASCII** characters, and
  answers a TrueType subset (`font/ttf`) of the bundled face. It never fetches
  a remote font. The subsetting is harfbuzz's (`subset-font`), which writes a
  complete font — see **The subsetter** below.
- Cap the request at **512 distinct code points**. The client requests the
  document's set in chunks of 512 and stacks the resulting families, so a
  pathological collection still covers every character it can.
- Cache the subset in memory, keyed by the sorted character string, 32 entries
  and a 24-hour TTL per warm Lambda; send
  `Cache-Control: public, max-age=86400`.
- Missing/empty non-ASCII text is `400 validation`; a subsetting failure is
  `500 internal`. The route does not log the characters.

The asset must ship with the Lambda bundle. Place it under `apps/api/src/assets/`
and resolve it from a module in `apps/api/src/` with
`new URL("./assets/fonts/NotoSansSC-Regular.ttf", import.meta.url)`, and have
`scripts/build-lambda.sh` copy `apps/api/src/assets/fonts/` to
`$STAGE/assets/fonts/` after the bundle. The bundle is a single `index.js`, so a
path relative to a source module would otherwise break in production.

Client side:

- `collectionPdfTexts` collects every string the document draws — the Collection name,
  every Title, every metadata value, and the fixed placeholder copy. It does
  **not** include the photo filename (which is not printed).
- Keep the distinct non-ASCII code points, sorted.
- Fetch each chunk, convert the response to a data URL, and register it as
  `Arcula Fallback 1`, `2`, … in chunk order, with the same source for 400 and 700.
- Render the document with
  `fontFamily: ["Darker Grotesque", ...fallbackFamilies]`, where
  `fallbackFamilies` is every family registered for this export, in order; with
  no non-ASCII text it is just `"Darker Grotesque"`. Never name only the first
  chunk, or the chunks after 512 code points are silently dropped.
- The fallback is one regular face registered for both weights, so a fallback
  glyph in the Title is not truly bold; that is accepted. The brand face still
  carries every Latin glyph, which is the ordinary case.
- A fallback fetch failure is **not** fatal: continue on Darker Grotesque alone
  and let the affected glyphs be `.notdef`. This is the same behaviour as a
  missing brand glyph today; it must never turn a successful export into an
  error.

#### The subsetter

The endpoint answers a subset built by **harfbuzz** (`hb-subset`, through
`subset-font`), not by `fontkit`.

`fontkit`'s TrueType subsetter is glyph-only: it emits head, hhea, loca, maxp,
cvt, prep, fpgm, glyf and hmtx and stops, because a PDF _writer_ supplies its
own encoding and font descriptor. The client is not that writer — it lays text
out and then embeds the face again — so a glyph-only subset failed twice, one
throw hidden behind the other, and neither was visible in review, in a
screenshot, or in the API's own response: the bytes are a valid-looking font.

- **`cmap`.** React-PDF resolves a `fontFamily` stack by asking each family
  `hasGlyphForCodePoint`, which reads `font.tables.cmap`. A subset straight out
  of `fontkit`'s `subset.encode()` throws `Cannot read properties of undefined
(reading 'tables')` on the first text run, so **every collection whose text
  has one non-ASCII character failed to export**.
- **`post`.** PDFKit reads `post.isFixedPitch` and the italic angle while it
  embeds the face. Without the table it throws
  `Cannot read properties of undefined (reading 'isFixedPitch')` after every
  page is already laid out — the latest possible place to fail.

harfbuzz's subset is a complete font — `cmap`, `post`, `name`, `OS/2`, the
metrics and the hints all survive — so there are no tables to write by hand and
no sfnt directory, checksum or `head.checkSumAdjustment` to rebuild. What that
costs: the subset is about 2.4 kB where a stripped one was 0.5 kB, the Lambda
package carries a 683 kB wasm asset, and `scripts/build-lambda.sh` grows one
line — `--external harfbuzzjs`, because Bun otherwise emits the wasm beside the
bundle while baking the **build machine's absolute path** into the
`require.resolve` that loads it, which is nothing in `/var/task`. External, it
resolves through the package the deploy installs, exactly like Sharp. What it
buys: 220 fewer lines of binary table writing, and `fontkit` leaves the runtime
bundle (−230 kB).

Two details are decided here rather than inherited:

- **The subset always includes a space.** hb-subset writes a `cmap` with _no
  subtable_ when none of the requested code points have a glyph — an emoji-only
  title, say — and a `cmap` with no subtable makes the renderer throw instead of
  falling back to `.notdef`. A space is the one code point a text face is
  guaranteed to draw; it costs one glyph.
- **Every table harfbuzz writes is kept.** Dropping the layout and variation
  tables would shave a kilobyte and leave one more table the renderer might
  reach for.

A code point the face cannot draw (color emoji) maps to glyph 0 and stays
`.notdef`, which is the honest answer rather than a throw.

The correctness floor is a test on the **served bytes**: parse the response,
assert each requested character answers a non-zero glyph, that an unrequested
one answers none, that the `post` header is readable, and that a request for a
code point the face cannot draw answers `.notdef` instead of throwing. The last
one is the space sentinel's guard.

Emoji outside Noto Sans SC, and any script it does not cover, are an accepted
limitation of this release. Adding more fallback faces is future work, not a
blocker.

## Document metadata and filename

The `Document` carries:

| Property   | Value               |
| ---------- | ------------------- |
| `title`    | the Collection name |
| `creator`  | `Arcula`            |
| `producer` | `Arcula`            |
| `author`   | omitted             |
| `subject`  | omitted             |

The author is omitted deliberately: the Owner's name is not public data and is
absent from a Visitor's payload, so the document must not describe itself
differently depending on who exported it.

The downloaded filename is:

```ts
`${urlizeName(collection.name) || "collection"}.pdf`;
```

For example `flores-solares.pdf`. A name with nothing ASCII-urlizable
(`收藏`, `!!!`) becomes `collection.pdf`.

## The viewer

`apps/web/src/App.tsx` mounts the route lazily:

```tsx
const CollectionPdfPage = React.lazy(
  () => import("./components/pdf/CollectionPdfPage"),
);
```

The renderer is a separate chunk (about 450 kB gzip; see **Performance**), so it
must not be in the main bundle and must not be imported from any page that is
not the PDF route. The `Suspense` fallback is a centred Mantine `Loader`.

The page is app chrome, in the app's Mantine theme, never a skin. It reuses
`CollectionLockScreen` and `PublicStateMessage`; it does not render `SkinHost`.

### The shell and the bar

Every state renders inside `ManageLayout`
(`apps/web/src/components/manage/layout/ManageLayout.tsx`) — the `AppShell`
every `/manage` page already uses — so the viewer has the app's fixed header
rather than a second definition of it.

- **The header is a slot.** The layout takes an optional `header` node that
  defaults to `ManageNavBar`, so no `/manage` page changes; the viewer passes
  its own bar instead of forking the shell.
- **One height.** The layout exports `MANAGE_HEADER_HEIGHT` (60 px), which
  configures the fixed header. It is the one number a body that fills the window
  under the bar sizes against, so the preview writes no second 60.
- **A fluid body.** The viewer passes a fluid container, so the shared lock
  screen and state message keep their own measure instead of being boxed
  twice.

The bar is shaped like the header it replaces: the Collection's name on the
left, in the wordmark's seat, as the page's one top-level heading (`h1`), with
**Collection PDF** dimmed beneath it. The body carries no title block — the bar
names the page. The bar's right-hand side holds whatever the export is doing,
and the rule for what belongs there is one sentence: **the bar reports work in
flight and the file that exists; the body carries the message and the call to
action.** So `preparing` and `rendering` are the bar's alone, over an empty
body, while `idle`, `cancelled`, `failed` and a failed load keep their copy and
their buttons in the body and report nothing in the bar. A finished file on a
desktop is reported there too, under **Preview, download and mobile**. The
bar's view is `pdfBarView(state, run, mobile)` in
`apps/web/src/components/pdf/pdfBarView.ts` — one pure function, so the rules
are testable without a renderer, and the bar component renders its answer and
owns no state, taking only the cancel handler that the one stoppable step needs.

The bar names the Collection whenever a read disclosed it: a `ready` read, or
the name a `locked` refusal carries
([ADR-0005](../adr/0005-a-password-is-a-second-condition-on-a-public-collection.md)).
It says only **Collection PDF** when nothing did — `loading`, `invalid`,
`notFound`, `private`, `error`, and a locked refusal with no usable name — and
then has no subtitle, because there is no Collection to name. The name is a
link to the Collection's canonical page — `/collection/` plus
`collectionSlug(name, id)` from `packages/shared/src/slug.ts` — only when the
read succeeded; a locked, private, missing or invalid Collection is named (or
not) but is not a link.

### States

Every state renders under that one bar; only what sits in the body changes.

| State      | The bar                                                | What the body shows                                                       |
| ---------- | ------------------------------------------------------ | ------------------------------------------------------------------------- |
| `loading`  | **Collection PDF**                                     | centred `Loader`                                                          |
| `invalid`  | **Collection PDF**                                     | `PublicStateMessage` with the invalid-link copy                           |
| `notFound` | **Collection PDF**                                     | `PublicStateMessage` with the not-found copy                              |
| `private`  | **Collection PDF**                                     | `PublicStateMessage` with the private copy                                |
| `locked`   | the name from the refusal                              | `CollectionLockScreen`; `onUnlocked` reloads and restarts the export      |
| `error`    | **Collection PDF**, and nothing of the failure         | `PublicStateMessage` (error) plus a **Retry** button that reruns the load |
| `ready`    | the name, plus the work in flight or the finished file | nothing while work is in flight; otherwise the generation state's own     |

On `ready` the export starts automatically, unless the large-export warning
(below) needs an answer first. The viewer does not ask the reader to press
"Generate" on the ordinary path.

### Generation states

| State       | The bar                                                                                    | The body                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `preparing` | `Preparing photos {done} of {total}`, a progress line along the bar's edge, and **Cancel** | empty                                                                                                      |
| `rendering` | `Building PDF…`, with no **Cancel** — the renderer is atomic and cannot be interrupted     | empty                                                                                                      |
| `done`      | desktop: `{pages} pages · {size}`, **Download** and **Open PDF**; mobile: nothing          | desktop: the preview alone; mobile: the card's sentence, `{pages} pages · {size}` and the same two buttons |
| `cancelled` | nothing                                                                                    | `Export cancelled.` and a **Generate PDF** button                                                          |
| `failed`    | nothing                                                                                    | `The PDF could not be generated.` and a **Retry** button                                                   |

Progress counts **distinct scheduled photos**. `done` includes failed photos;
`total` is the number of distinct photos. The progress line's value is the
fraction prepared — the same number the label counts — and 0 for a run with
nothing scheduled, so the bar never prints `0 of 0`. With no photos the export
goes straight to `rendering` with no progress frame at all. Cancel during
`preparing` aborts the current fetches, clears the work and produces no PDF; it
does not leave a partial file.

The split is the bar's one rule, not a per-state choice: work in flight is
reported where the export is, over a body that has nothing to say, and every
state that asks the reader to act — `idle` before a start, `cancelled`, `failed`
— is a message and a button together in the body, with the bar silent for it.

The export is one `pdf(<CollectionPdf … />).toBlob()` call after all the
preflight work. The result is held in memory and shown through a `blob:` URL.

### Preview, download and mobile

Two surfaces, and each one offers the actions exactly once.

- **Desktop** (not coarse pointer and wider than 700 px): the bar carries
  `{pages} pages · {size}`, **Download** and **Open PDF**, and the body is the
  document and nothing else — an `iframe` titled **Collection PDF** and pointed
  at the blob URL, filling the window under the fixed bar. (An empty Collection
  keeps the one line that says it has no published artworks above the frame.)
  Its height is the viewport less `MANAGE_HEADER_HEIGHT` and the body's own
  `AppShell` padding, with a floor for short windows, so the page itself does
  not scroll and the document scrolls inside its own frame. The pages-and-size
  line that used to sit above the preview is gone.
- **Mobile** (coarse pointer or `max-width: 700px`): once the file exists the
  bar names the Collection and carries no actions; no iframe either, because
  iOS's embedded PDF view shows only the first page. The card under the bar is
  the phone's one action surface: it says the PDF is ready, repeats
  `{pages} pages · {size}`, and holds **Open PDF** and **Download**. The
  summary travels with the buttons it describes. **Work in flight has no
  card**, so the bar reports it on a phone exactly as on a desktop: the label,
  the line and the **Cancel** while photos are prepared, `Building PDF…` while
  the renderer runs.
- The bar and the card print the summary through one function in
  `pdfBarView.ts`, `pdfFileSummary(pages, size)`, which wraps the byte
  formatter: megabytes to two decimals, anything smaller rounded up to at least
  one kB. One wording, one rounding.
- A run is reported only by a `ready` read, so re-reading the Collection, or
  restarting the export, drops whatever the previous run reported — its
  progress or its file — with it.
- **Download** is an `<a download={filename} href={blobUrl}>`; the blob URL is
  same-origin. The filename is `collectionPdfFileName(name)` — **Download**
  carries the exported file's own name.
- **Open PDF** calls
  `window.open(blobUrl, "_blank", "noopener,noreferrer")`. This is the Safari
  blob path; it must be checked on iOS hardware once before release (a manual
  check, not a design decision). If the tap does not open the blob, **Download**
  is the sanctioned path and the viewer adds no third mechanism. Chrome's PDF
  plugin owns the popup's DOM, so an empty DOM there is expected.
- The blob URL is revoked on unmount, on a new export and when the Collection id
  changes. The blob itself is dropped at the same points.

### The large-export warning

There is **no hard cap** on Artworks or photos. Before the prefetch, count
`photoPages` and call the pure predicate
`shouldWarnForLargeExport(photoPages, deviceMemory, isMobileLayout)`:

- true when `photoPages >= 30`;
- true when `photoPages >= 15` and either `deviceMemory` is a number no greater
  than 4 or `isMobileLayout` is true (`(pointer: coarse)` or
  `max-width: 700px`). The mobile clause is what covers iOS, where
  `navigator.deviceMemory` is undefined;
- false otherwise.

A true answer shows a confirm modal before generating: the export has that many
photo pages at 300 dpi and can use a lot of memory on a small device, with
**Continue** and **Cancel**. **Cancel**, including dismissing the modal, leaves
the viewer on `ready` with a **Generate PDF** button; no work has started.
**Continue** starts the ordinary export.

The threshold is a warning, not a limit: a 63-page export is allowed. The
measured cost is in **Performance**. The check is deliberately based on the page
plan, not on the Collection's artwork count, because photo pages are what cost
memory.

### The manage entry point

On `/manage/collection/:collectionId`, add a **subtle `Button component="a"`
labelled `PDF`** immediately after **View** in the left header group:

```tsx
<Button
  variant="subtle"
  component="a"
  href={`/collection/${collectionSlug(collection.name, collection.id)}/pdf`}
  target="_blank"
  rel="noopener noreferrer"
>
  PDF
</Button>
```

- The two outbound read links sit together; the right group stays mutations.
- It opens in a new tab so the Owner or Collaborator keeps the manage page.
- It is shown to every Owner and Collaborator on public, private and Protected
  Collections. The route enforces access; the link does not pre-decide.
- Nothing is added to the public Collection page.

## Performance

Every figure below was measured against the shipped geometry — the 504 × 580 pt
box, the 2100 × 2417 px decode target and the `xxlarge` source — after it
shipped (#149). None of it is inherited from the prototype.

**The method, because a number without one decays into folklore.** The local
stack (Postgres, SeaweedFS, the API on `:8000`), the web app's **production
build** (`bun run build`, served by `vite preview`, so the react-pdf chunk is the
shipped one), **headless Chrome for Testing 151.0.7922.34** with the HTTP cache
disabled, on an Apple M5 Pro / 48 GB / macOS 26.6.2. One fresh browser per run,
three runs per row, with no other build or browser running. Photos are converted
by the shipped pipeline at the export's fixed **300 dpi**, with
`PHOTO_CONCURRENCY` — four in flight. Prefetch is the viewer's own
**`Preparing photos` → `Building PDF…`**; render is **`Building PDF…` → the
finished file**. Both are stamped from transitions of the page's own rendered
state (`document.body.innerText`), not inferred from the network. Downloaded
bytes are CDP `Network.loadingFinished`'s `encodedDataLength` summed over the
`/api/v1/media` requests; converted bytes are the size of every blob
`OffscreenCanvas.convertToBlob` answered; the PDF is the last blob the route
mints (`URL.createObjectURL`), which is the one its preview and download link
carry. **Whole-browser RSS is the summed resident set of the browser's entire
process tree** (`ps -axo pid,ppid,rss`, sampled every 100 ms), which is the
number that matters — the JS heap under-reports by an order of magnitude; the
heap column is CDP `Performance.getMetrics`' `JSHeapUsedSize`. **Idle** is the
same browser parked on `/manage` — the app, no PDF chunk — allowed to settle for
three seconds and then sampled for one more, the highest of those samples being
the baseline. Every RSS figure below is a peak over the whole visit to the PDF
route, so it includes the viewer itself.

The fixture is **23 works and 63 photo pages** — 20 works with three photos, 3
with one — uploaded into a local Collection through the app's own stage →
process → save routes, so every object is one the pipeline wrote. Its sources
are 12 MP JPEGs in a 3:4 / 1:1 / 4:3 mix (21 photo pages each), so the box is
exercised at both of its bounds: a 3:4 photo fills its height (1813 × 2417 px),
a square and a landscape fill its width (2100 × 2100 and 2100 × 1575). Its 63
`xxlarge` objects are 46.6 MB on the wire, ~740 kB each. A 30-photo-page fixture
and a 24-work, 14-photo one (below) come from the same generator.

| Source                  | dpi | Downloaded | Converted JPEGs |      PDF |    Prefetch |     Render |   Peak JS heap | Peak RSS over idle |
| ----------------------- | --: | ---------: | --------------: | -------: | ----------: | ---------: | -------------: | -----------------: |
| `xxlarge`               | 300 |    46.6 MB |        19.45 MB | 19.53 MB | 4.21–4.33 s | 108–116 ms | 18.06–26.61 MB |      +1179–1184 MB |
| `xlarge` (no `xxlarge`) | 300 |    26.2 MB |        18.31 MB | 18.40 MB | 2.81–2.97 s | 111–116 ms | 26.57–31.81 MB |      +1145–1149 MB |

The two rows are the same 63 pages through the two rungs a real collection
walks. The second is the **fallback**: an identical fixture whose every photo's
`xxlarge` record was removed after the upload, which is what a photo uploaded
before #144 looks like. `original` is not a row: it is the ladder's last resort
for a photo carrying neither variant (`scheduledPhotoSource`), so its cost is
not bounded by the box and is not what this run measured.

**What the ladder's two rungs cost.** The fallback is 44 % smaller on the wire
(26.2 MB against 46.6 MB), 1.4 s faster to prefetch, and prints a PDF 6 %
smaller — the same picture, a little smaller than the box, because `xlarge`
stops at 2400 px where the box wants 2417. The peak is the same within 3 %. That
is the decode-to-box cap doing its one job: what the peak holds does not follow
the source, so a smaller source buys bandwidth and time and no memory. `xxlarge`
is therefore the right source to read wherever it exists — the extra 20.4 MB
across these 63 pages is what fills the box — and the `xlarge` row is the legacy
path's price, not a cheaper export.

**The peak, against the retired +880 MB.** The prototype reported ~1855 MB peak
(+880 MB over a ~972 MB idle) for 63 photo pages at 300 dpi. Measured now, the
same 63 pages peak at **2200–2203 MB, +1179–1184 MB over idle**, and settle at
2099–2102 MB while the viewer holds the blob. So the peak did **not** fall, and
the cap is not what decides it either way: one conversion holds a box, not a
source — four of them, about 80 MB — while the visit's peak is the viewer's own
floor plus the document. The floor is measurable on its own: a **one-page export
with no photos peaks at 1517–1521 MB, +499 MB over the same idle**, and the
photos then take it to ~+1.0 GB. Part of the gap to the retired figure is that
floor, which the prototype's unrecorded method may not have counted; the rest is
real. The claim the cap supports is therefore narrower than "the peak is flat":
**the source's pixels never enter the peak, the box's do.**

**The peak against the page count.** Four exports, same machine, same method:

| Export                   | Peak RSS over idle |
| ------------------------ | -----------------: |
| 1 page, no photos        |        +499–500 MB |
| 17 pages, 14 photo pages |      +1010–1037 MB |
| 30 pages, 30 photo pages |      +1067–1095 MB |
| 63 pages, 63 photo pages |      +1179–1184 MB |

Above the first few photos the peak barely moves: going from 14 to 63 photo pages
grows the PDF 4.5× (4.33 → 19.53 MB) for about 0.15 GB of peak. The steep step is
below that, and this run cannot say whether it belongs to the photos or to the
viewer, because its only photo-free export is also its only one-page one.

**The 17-page sample.** A Collection of 24 live published works — 6 with photos,
14 used photos after the three-photo cap, 18 with no photos — exports as
**17 pages · 4.33 MB** at 300 dpi from `xxlarge`: 10.38 MB downloaded, 4.30 MB
of converted JPEGs, 0.99–1.04 s of prefetch, 63–67 ms of render, and
+1010–1037 MB of peak RSS. Its 14 photo pages are below the warning's threshold,
and indeed no warning appeared.

**The warning's thresholds still hold.** The new peak gives no reason to move
either number: above the first few photos the cost is small and nearly flat
across the range they bracket, so the desktop's 30 is not sitting on a cliff.
What this run cannot supply is a phone — it is a 48 GB desktop browser, and the
phone is the case the warning exists for — so the mobile clause stays on the same
reasoning that put it there. No ticket to move the thresholds is open.

The implementation must release converted blobs after `toBlob()` and revoke the
blob URL. Each run measured here ends holding one finished file and nothing else.

The renderer chunk is **1.21 MB minified / 449.5 kB gzip**, still a separate
chunk from the app's main 335.5 kB gzip one. Both are `bun run build`'s own
report of the production build, which must keep the renderer separate. There is
no server work and no file upload.

### Library pin and a known bug

- `@react-pdf/renderer` is pinned to **4.9.0** in `apps/web/package.json`. Do not
  upgrade without re-measuring the geometry, the font fallback and the page-height
  workaround.
- In 4.9.0 a `<Page wrap={false}>` with no height collapses its MediaBox to
  `[0 0 612 0]`. Every page must set `minHeight: 792`, which restores
  `[0 0 612 792]`. Keep the workaround until upstream fixes it.
- The browser console reports `Buffer is not defined` from the renderer. It is
  harmless and does not affect the output: `@react-pdf/layout` bundles its Node
  build, whose `fetchImage` evaluates `Buffer.isBuffer(source)` inside a
  `try`/`catch`, so the reference throws, is caught, and is printed as a
  `console.warn` **after** the image is already attached. The only visible
  consequence is that `node.image.key` is never set, which costs a per-image
  embed cache nothing needs — a photo prints once. **Do not add a Buffer
  polyfill** for it; that would grow the lazy chunk for a warning.
- Because that warning is the loudest thing in the console, it is not the cause
  of a failed export. See **The fallback font's `cmap`** under **Fonts**.

## Testing

The repo's test doctrine applies: test our decisions, not the library's layout.
A test that would only fail if React-PDF or Mantine changed does not belong.

### Tier 1 — the page plan

`buildCollectionPdfPlan` is pure and gets the bulk of the tests:

- drafts are excluded; `status` absent is published;
- deleted works are excluded; `deletedAt: null` is live;
- ordering is Artist A–Z then Title A–Z, case- and accent-insensitive,
  numeric-aware, with `id` breaking an exact tie;
- a work with 1, 2, 3 and 4 photos yields 1, 2, 3 and 3 pages, in stored order,
  and the fourth photo is not used;
- a work with photos never appears in the grid; a work without photos never
  appears as a photo page;
- no-photo works are grouped six per page, in sorted order, with a partial last
  page;
- an empty (or all-draft) input yields exactly one `empty` page;
- the page-count formula holds for a mixed collection.

Each test must fail if its rule is mutated (swapped order, four photos,
five-per-grid, draft included). That is the acceptance bar.

### Tier 1 — the image fit, the fallback set and the warning

- `fitInsideBox` returns the source size untouched when it is smaller than the
  box, preserves aspect ratio when it is larger, rounds to at least 1 px, and
  uses the 2100 × 2417 target at 300 dpi — the number `xxlarge`'s 3000 px exists
  to reach. Mutating the `min(1, …)` must fail the no-enlarge test.
- `fallbackCharacters` keeps distinct non-ASCII code points only, sorted;
  ASCII-only text returns an empty string; a mixed string returns the non-ASCII
  subset. `fallbackChunks` splits on code points, not UTF-16 units: 0 → no
  chunks, 1 and 512 → one, 513 → two.
- `collectionPdfTexts` includes the Collection name, every Title, every
  metadata value and the placeholder copy, and excludes the photo filename. A
  non-ASCII title reaches the fallback set.
- `shouldWarnForLargeExport` is true at 30 photo pages and false at 29; true at
  15 when `deviceMemory` is 4 or the layout is mobile; false at 14; false at 15
  with `deviceMemory` 8 on desktop; true at 15 on mobile with `deviceMemory`
  undefined (the iOS case). Do not test `Intl.Collator` or
  `createImageBitmap` themselves.

### API integration

The API suite drives the real app against the local stack, so add the wire-level
checks the route needs:

- `GET /api/v1/pdf/font-fallback?text=…` with non-ASCII text answers 200,
  `font/ttf`, and a TrueType header (the `0x00010000` / `true` magic). The
  magic is a correctness floor, not a subsetter test: the PDF embedder cannot
  take a WOFF2, and that failure would otherwise be silent;
- the served bytes answer every requested character with a non-zero glyph and
  an unrequested character with none, carry a readable `post` header, and answer
  `.notdef` rather than throwing for a code point the face cannot draw,
  asserted in `pdfFontSubset.test.ts`. This is the floor above: a subset without
  `cmap` or `post` fails the whole export while looking perfectly valid on the
  wire, and the emoji-only case is what the space sentinel exists for;
- empty or ASCII-only text answers 400; more than 512 distinct code points
  answers 400;
- no session is required (the Visitor's export needs it).

The subsetter itself is harfbuzz's behaviour; do not test glyph outlines.

### Component and manual checks

- Do not assert the rendered PDF's layout, page components, text positions or
  font names in jsdom. Those are the library and the template, not our logic.
- The viewer's load has no pure decision worth a component suite beyond what
  `publicFailure` already covers; do not test the manage link's label or props.
  The bar's wording per state — the name, the fallback title, the progress
  label and its fraction, `Building PDF…`, the file's summary — is
  `pdfBarView`'s own pure suite. The bar's one rendering check is that its
  report appears exactly once: one **Download** with its filename and one
  **Open PDF** for a finished file, a **Cancel** that calls the handler while
  photos are being prepared and none while the renderer runs. A duplicate or a
  missing control is invisible in review and obvious in a query.
- **Visual acceptance**, once, against the template: generate the seeded
  collection at the defaults and compare the photo page and the grid page to
  `docs/templates/pdf/artwork-page.png` and `artworks-grid.png` at 100 %. Check
  the header baseline, the photo box, both metadata baselines, the grid pitch
  and the `--`.
- **Manual device checks** before release: iOS "Open PDF" opens the blob in a
  viewer; a 30+ photo-page export shows the warning; a real 12 MP photo at
  300 dpi is visually acceptable at quality 0.9. These decide no further design
  question; they confirm the decisions above.
- The browser console's `Buffer is not defined` warning is expected.

## What is explicitly out of scope

- Per-field toggles in Collection Settings, or any export options UI.
- Any link, control or change on the public Collection page or its skins.
- A cover page, table of contents, page numbers, running footers or a Collection
  description.
- Drafts, deleted Artworks and Artwork documents in the document.
- Acquisition date, acquisition price, current value, provenance, condition and
  notes.
- Server-side PDF generation, a raw `application/pdf` endpoint, or storing the
  generated file.
- PDF/A, tagged, accessible or encrypted PDFs.
- Emailing, hosting or sharing the generated file; batch or multi-Collection
  export.
- Branding, a logo, or a custom font theme.
- Additional fallback faces for emoji and scripts outside Noto Sans SC.
- URL options for dpi, JPEG quality, typography or image source. The prototype's
  `?dpi=`, `?typography=`, `?source=` and `?quality=` flags are not shipped; the
  only route is the production default: `xxlarge` with `xlarge` as the
  fallback, 300 dpi, quality 0.9, 12/10 pt.
