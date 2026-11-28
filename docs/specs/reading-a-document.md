# Reading a document

**Status: implementation-ready.** This is the build. The decision and its
rejected alternatives are ADR-0017, _Reading a document happens on the member's
device_ — in review as [#381](https://github.com/mixcas/arcula/pull/381); the
file is docs/adr/0017-reading-happens-on-the-members-device.md. The map is
[#375 Reading a document into an artwork](https://github.com/mixcas/arcula/issues/375);
its prototype ([#376](https://github.com/mixcas/arcula/issues/376)), field rules
([#379](https://github.com/mixcas/arcula/issues/379)) and states
([#380](https://github.com/mixcas/arcula/issues/380)) carry the evidence and the
copy decisions this document builds. Nothing here reopens them.

The vocabulary is [GLOSSARY.md](../../GLOSSARY.md)'s: **Read**, **Map values**,
**Import**, **Map columns**, **Artwork**, **Artwork document**, **Draft**,
**Catalogue**. A **document** in this feature is the member's local file before
it is attached; an **Artwork document** is the attachment it may become. The
two nouns never trade places.

## What it is

A member drops one file — an invoice, a gallery label, a certificate of
authenticity, a condition report — at the top of the Add page. Its text is read
**on the device**, the fields the read can place are filled, and the lines the
machine could not place become rows in **Map values**. The form arrives filled
and the work lands as a **Draft**.

There is no server in the path. No route, no queue, no schema change, no
migration, no vendor, no egress, no metering, no read counter. The document is
not uploaded, stored, named to the API or logged; the only requests a read
makes are the same-origin engine assets on first use and the save the form
already sends. The source file may optionally be attached afterwards, through
the Add page's existing uploader, and never by the read.

One document reads into one artwork. There is no batch, no page segmentation
and no `importArtworks` in the path; **Import** stays batch work.

## The entry point

### The Data tab's card

`apps/web/src/components/manage/CatalogueSettingsDataTab.tsx` grows a second
card beside **Import from CSV**, in a two-column grid on `sm` and up and one
column below it. The existing import card keeps its words and its button.

- Title: **Add from a document**
- Body: **Start an artwork from an invoice, certificate, gallery label or
  condition report.**
- Button: **Read a document**, a `Link` to
  `/manage/catalogue/{catalogueParam}/artwork/add?read=document`.

The danger card stays below the grid, unchanged.

### The Add page's control

The Add page mounts one full-width block at the top of the form, above the
fields, in every state: idle, reading, read, nothing, failed, refused. When
idle it is the drop zone; in every other state it is a compact line, so the
form becomes the thing to look at. There is no modal, no toast and no close
button; the block is the entry point and the receipt at once.

`?read=document` is the read intent:

- The form's initial status is **Draft** instead of Published. The status control
  is live and the member may change it.
- The page scrolls the block into view on mount. The query stays in the address,
  so a refresh keeps the intent.
- The query is read from `useSearchParams` and never travels to another
  destination: `artworkSearchSuffix` is built from `q` alone, as today.

The plain Add page keeps Published and shows the same idle block. A read that
completes on it lands a Draft too: if the status still holds the value the page
opened with when the read finishes, it is set to **Draft**; a status the member
has already changed is left alone. There is no second "Read a document" button
on the page — the block is the control.

## The read

### Accepted files

| Type              | Extensions      | Cap                           |
| ----------------- | --------------- | ----------------------------- |
| `image/jpeg`      | `.jpg`, `.jpeg` | `MAX_IMAGE_BYTES` (10 MiB)    |
| `image/png`       | `.png`          | `MAX_IMAGE_BYTES` (10 MiB)    |
| `image/webp`      | `.webp`         | `MAX_IMAGE_BYTES` (10 MiB)    |
| `application/pdf` | `.pdf`          | `MAX_DOCUMENT_BYTES` (25 MiB) |

One file at a time. The drop zone's `accept` is `ACCEPTED_DOCUMENT_TYPES` from
`packages/shared/src/caps.ts`; `multiple` is false and `maxSize` is not set, so
the per-population cap is the shared guard's and the refusal can name the right
size instead of the drop zone's single maximum.

The cap is per population, not per read: an image is judged as a **photo** and
a PDF as a **document**, which is why an image is capped at 10 MiB even though
the uploader would accept a 25 MiB image as an Artwork document. Decoding a
large bitmap for OCR is the reason; the stricter cap is deliberate. The
predicate is one shared function, exported from the new pure module:

```ts
checkReadableDocument(
  contentType: string,
  size: number,
): "allowed" | "unsupported-type" | "too-large" | "invalid-size"
```

It delegates to `checkDeclaredUpload`, choosing the `"document"` population for
`application/pdf` and the `"photo"` population for everything else. No byte
count or type list is restated, so the read's gate and the uploader's cannot
drift.

### The engine

**Tesseract.js 6**, WebAssembly, in a web worker. Added to
`apps/web/package.json` as a runtime dependency, together with **pdfjs-dist**
for a PDF's text layer. Both are `import()`ed for the first time inside the
reader's `read` call; neither appears in the Add page's static import graph.

- **Self-hosted, same origin, never a CDN.** The worker script, wasm core and
  language data are served from the web origin:

  ```text
  /ocr/worker.min.js
  /ocr/core/                     the wasm core files, including the .wasm loader
  /ocr/lang/spa.traineddata.gz
  /ocr/lang/eng.traineddata.gz
  ```

- The two language files are LSTM-only data from `tessdata_best`, tag
  `4.0.0_best_int` (`spa` ≈2.1 MB and `eng` ≈2.95 MB gzipped). They are
  committed under apps/web/public/ocr/lang/, with the upstream Apache-2.0
  notice beside them. The reader requests both languages and the LSTM engine
  (`oem: 1`).
- The worker script and core are generated, not committed: the web package's
  `predev` and `prebuild` run apps/web/scripts/copy-ocr-assets.mjs, which
  copies `tesseract.js/dist/worker.min.js` and the `tesseract.js-core` wasm
  files into the two paths above and fails with a named sentence if the two
  `.traineddata.gz` files are missing. apps/web/public/ocr/worker.min.js and
  apps/web/public/ocr/core/ join `.gitignore`.
- Paths are passed explicitly to `createWorker` as `workerPath`, `corePath` and
  `langPath`. Nothing relies on the library's default CDN URLs. The language
  data must never be mixed with the legacy/OSD file: pointing the LSTM read at
  an OSD-capable directory silently degrades it to the legacy model, which the
  prototype measured as visibly worse.
- One worker per read, terminated in `finally` on success, failure and cancel.
  The engine therefore never outlives the read that loaded it. A 3000×4000 px
  photograph measured 2.0–5.6 s in Chrome; the first read also downloads the
  assets, and a second read pays the engine's startup again.
- The app ships no Content-Security-Policy today. A future policy must allow
  `wasm-unsafe-eval` and the same-origin worker, core and language assets, or
  this feature stops with no code change. That is [ADR-0017](https://github.com/mixcas/arcula/pull/381)'s
  consequence, not a new decision; when a policy lands it earns a test that
  holds it to these assets.

### Images

The image path is the prototype's, because three of its four photographs were
stored sideways:

1. `createImageBitmap(file, { imageOrientation: "from-image" })` — EXIF is baked
   before the engine sees a pixel. This is the orientation fix, not OSD.
2. Draw the bitmap into a canvas at its natural size, with the long edge capped
   at **3000 px** (aspect preserved) so a 40-megapixel phone photo cannot
   exhaust the tab.
3. Hand the canvas to the worker. Do not repair, deskew or otherwise alter the
   pixels; every later mistake is visible in the field and its source line.

A bitmap that cannot be decoded is refused before the engine runs (see **File
refusals**). OSD is not used and no orientation detection is attempted beyond
EXIF.

### PDFs

`pdfjs-dist` extracts the text layer; the page is never rasterised and never
OCR'd.

- Load with `getDocument({ data: await file.arrayBuffer(), isEvalSupported:
false })`.
- The worker is the package's own, imported as a Vite `?url` asset so it is
  hashed, served same-origin and never fetched from a CDN; assign it to
  `GlobalWorkerOptions.workerSrc` once.
- Walk every page's `getTextContent()`. Group items that share a baseline
  (rounded `transform[5]`, tolerance 1 px), sort each group by `transform[4]`,
  and join the items with single spaces. Each resulting line is an `OcrLine`
  with `confidence: 100` — a text layer is exact, not recognised.
- One non-space text item anywhere means the PDF has a text layer. If no page
  produces one, the file is refused before any read (see **File refusals**); a
  scan is an image and follows the image path.

### Progress and cancel

```ts
interface ReadProgress {
  /** "loading" covers the worker and its assets; "reading" is the engine. */
  phase: "loading" | "reading";
  /** 0–1 while reading; null while loading. */
  value: number | null;
}
```

The reader reports `loading` until Tesseract's logger first reports
`recognizing text`; from then on it reports the engine's 0–1 progress. The
block shows a progress bar — animated and striped while loading, tracking the
engine once it reads — and never a percentage.

Cancel aborts the read, terminates the worker, applies nothing and returns the
block to idle with the file cleared. There is no cancellation message: nothing
was applied, so there is nothing to report.

### The injectable seam

The engine sits behind one interface, defined in
apps/web/src/reading/browserReader.ts:

```ts
interface DocumentReader {
  read(
    file: File,
    options: {
      signal: AbortSignal;
      onProgress: (progress: ReadProgress) => void;
    },
  ): Promise<
    | { kind: "lines"; lines: OcrLine[] }
    | { kind: "no-text-layer" }
    | { kind: "unreadable" }
  >;
}
```

`browserReader` is the default implementation: it owns the dynamic imports, the
EXIF bake, the PDF text layer, the worker's life and the abort listener. A
non-abort rejection is an engine failure. A `DOMException` named `AbortError`
is a cancel. `no-text-layer` and `unreadable` are file refusals, not failures:
the first is a PDF with no text, the second a bitmap or PDF the browser cannot
open at all.

`useDocumentRead` takes an optional `reader?: DocumentReader`, defaulting to
`browserReader`; the Add page calls the hook once and passes its state to the
block and the table. The page resolves its reader from
`DocumentReaderContext`, whose default is `browserReader`, so a component test
wraps the real Add page in a provider with a fake. jsdom therefore never loads
Tesseract or pdf.js, and no test mocks a module. The pure half below is where
the text tests live.

The hook is the page's read state:

```ts
interface UseDocumentRead {
  state: "idle" | "reading" | "read" | "nothing" | "failed" | "refused";
  progress: ReadProgress | null;
  refusal:
    | { kind: "unsupported-type" }
    | { kind: "too-large"; cap: number }
    | { kind: "no-text-layer"; name: string }
    | { kind: "unreadable"; name: string }
    | null;
  rows: ClassifiedSegment[];
  mapping: ValueMapping;
  evidence: Partial<Record<ImportFieldKey, string>>;
  chooseFile(file: File): void;
  cancel(): void;
  retry(): void;
  setMapping(mapping: ValueMapping): void;
  clearEvidence(field: ImportFieldKey): void;
  commitRows(): void;
}
```

`chooseFile` is the only entry to the state machine. It refuses before a read
when `checkReadableDocument` says no, and otherwise moves to `reading`; a
resolved `lines` result runs the pure pipeline and applies it, `no-text-layer`
and `unreadable` become `refused`, an `AbortError` returns to `idle` silently,
and any other rejection is `failed`. `retry` re-runs the last file; `cancel`
aborts and returns to idle with the document cleared; `commitRows` is the
table's **Add to form**.

## The pure shared functions

One module, packages/shared/src/documentRead.ts, re-exported from
`packages/shared/src/index.ts`. No React, no DOM, no engine: every function
takes data and returns data.

```ts
interface OcrLine {
  text: string;
  confidence: number; // 0–100, the engine's line confidence
}

interface Segment {
  index: number; // 0-based, assigned after every drop
  text: string; // the kept line, trimmed — the member's evidence
  confidence: number;
  label: ImportFieldKey | null; // the field a recognised label names
  value: string; // the label's value, or text when unlabelled
}

type SegmentTier = "label" | "dimensions" | "row";

interface ClassifiedSegment extends Segment {
  tier: SegmentTier;
  guess: ImportFieldKey; // the natural field, before the catalogue's set
}

type ValueMapping = Partial<Record<number, ImportFieldKey>>;
```

### `segmentLines`

```ts
segmentLines(lines: readonly OcrLine[]): Segment[]
```

Turns engine lines into the kept lines the member can see. A dropped line is
invisible: no row, no count, no toggle. The reasons a line may drop are closed
to four — a noise shape, boilerplate, the words rule, the confidence floor —
and every drop below is one of them.

1. **Trim and drop empties.** Collapse inner whitespace, trim, drop a blank
   line.
2. **Find a label on the trimmed line, before trimming its edges.** Every colon
   is a candidate, from right to left. Take the text before it, normalize it
   (NFD, combining marks stripped, lowercased, every non-alphanumeric run
   collapsed to one space, trimmed) and match a label that is the **whole** text
   or a **suffix of it at a word boundary**. The longest matching label wins. On
   a match, `label` is the field, `value` is the text after that colon, trimmed
   — and edge-trimmed by step 3's rule unless it is already a value shape, so a
   price keeps its `€` — and `text` is the whole line after step 3's edge trim,
   for evidence. A pair whose value is empty drops as a noise shape. A line with
   no match is unlabelled.
3. **Trim the noise stuck to the edges, unless the line is a value shape.** A
   line carrying a dimensions run, or a whole line that is a bare year, a full
   date or a money shape, is kept exactly as read. Every other line drops
   leading tokens until the first word-like token — one that passes the word
   test (three or more letters with a vowel) or has at least two letters and a
   vowel, which keeps `La`, `No` and `sé` — and drops trailing tokens that
   contain no letter or digit. The article in `La obra…` survives because
   dropping it flips the sentence; a stray dash before `Cenefa floral` does not.
4. **An unlabelled line drops as a noise shape** when it is all punctuation, a
   line containing `@`, a URL or `.com`/`.org`/`.net`/`www.`, or a phone-number
   shape (an optional `+` and seven or more digits with spaces, dots,
   parentheses or dashes).
5. **An unlabelled line below confidence 45 drops.** A labelled line is exempt.
6. **An unlabelled value shape is kept as read.** A dimensions run anywhere in
   the line, or a whole line that is a bare year, a full date or a money shape,
   is not asked to look like words. The floor above has already applied.
7. **An unlabelled line containing a boilerplate phrase drops.** The list is a
   closed set of normalized word-boundary patterns, and the only alternation is
   the last one:

   ```text
   certificado de autenticidad      la obra reproducida
   certificate of authenticity      no es una obra de arte
   este documento certifica         derechos de autor
   este certificado                 este certificado debe acompanar
   firma del artista                firmado y expedido
   doy fe                           se describe como una creacion
   mano de l[ax]?s? autor[ex]
   ```

8. **The words rule drops the rest.** It passes when both hold:
   - letters are at least **55%** of the line's non-space glyphs;
   - at least **two** tokens of three or more letters carry a vowel
     (`a e i o u á é í ó ú ü`), and a token of exactly three letters that is all
     caps is not a word — the artwork's texture reads as `SAT GCA`.

   The engine's confidence is never a noise filter on its own (texture scored
   85–96); it only separates a marginal line from a real one after the words
   rule.

9. **Exact twins collapse.** Fold case, accents, punctuation and whitespace; if
   the folded text has already been kept, drop the later line. A Spanish/English
   pair of the same fact is not a twin and both stay — the text differs, and v1
   has no way to know they are one fact.
10. **Indices are assigned last**, in reading order, after every drop.

A labelled line is exempt from the confidence floor and from the line-level
words rule: a label pair is the line's evidence, and its **value** is judged by
the fileable-value rule in `classifySegments`, not the line. So `TÍTULO: ✳`
survives as a row, while a texture line with no label and no shape does not.

A collapsed twin is the duplicate rule, not a fifth drop reason: the line was a
duplicate, not unusable, and the first occurrence keeps its place.

### The label table

Normalization is `labelKey`: NFD, combining marks stripped, lowercased,
non-alphanumerics collapsed to single spaces, trimmed. Labels are matched
against that key, so accents and case do not matter (`TÍTULO`, `Titulo` and
`título` are one label).

The table is the probe's own synonym list — every label the four samples print,
plus the obvious near-misses and each field's own name. The seven observed heads
are a subset: `titulo`, `tecnica`, `medidas`, `ano`, `lugar de produccion`,
`consta de`, `caracteristicas materiales`.

| Field              | Keys                                                                                                                   |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `title`            | `titulo`, `title`, `titulo de la obra`, `obra`, `nombre`                                                               |
| `artistName`       | `author`, `artist`, `artist name`, `autor`, `autora`, `autorx`, `artista`                                              |
| `serie`            | `serie`, `series`, `coleccion`                                                                                         |
| `dateOfCreation`   | `ano`, `ano de creacion`, `fecha`, `fecha de creacion`, `year`, `date`, `date of creation`                             |
| `medium`           | `tecnica`, `technique`, `medio`, `medium`, `materiales`                                                                |
| `dimensions`       | `medidas`, `medida`, `dimensiones`, `dimensions`, `tamano`                                                             |
| `editions`         | `edicion`, `ediciones`, `edition`, `ejemplar`, `copias`                                                                |
| `acquisitionDate`  | `fecha de adquisicion`, `fecha de compra`, `acquisition date`                                                          |
| `acquisitionPrice` | `precio`, `importe`, `price`, `precio de compra`, `acquisition price`                                                  |
| `placeOfOrigin`    | `lugar de produccion`, `lugar`, `procedencia`, `origin`, `ciudad`, `place of origin`                                   |
| `provenance`       | `proveniencia`, `provenance`, `historial`                                                                              |
| `notes`            | `notas`, `observaciones`, `descripcion`, `consta de`, `caracteristicas materiales`, `caracteristicas`, `note`, `notes` |
| `condition`        | `estado de conservacion`, `condicion`, `condition`, `estado`                                                           |
| `currentValue`     | `valor actual`, `tasacion`, `valuation`, `current value`, `current price`                                              |

`procedencia` is a place of origin, not a provenance; the probe measured the
distinction. `caracteristicas materiales` is a notes label. `availability` and
`status` have no labels at all.

### Value shapes

- **Dimensions**: a **run anywhere** in the line — a number, `x`/`×`/`*`, a
  number, optionally a third number, optionally a unit:

  ```text
  (\d+(?:[.,]\d+)?)\s*(?:x|×|\*)\s*(\d+(?:[.,]\d+)?)(?:\s*(?:x|×|\*)\s*(\d+(?:[.,]\d+)?))?\s*(cm|mm|m|in|pulg|pulgadas)?
  ```

  Decimal point or comma; the unit may be missing or garbled. The whole line is
  the value, not the run. `100x80`, `100 x 80 cm`, `100 × 80 × 5 cm`,
  `100,5 x 80 cm`, `11 x11 cm c/u` and `Losetas (4) 20x20x1em cada una` are all
  dimensions shapes — the last is the document that reads `cm` as `em`, and its
  whole line is the right value for the field.

- **Bare year**: `^(19|20)\d{2}$`, case-insensitively. A full line, never a run.

- **Full date**:
  `^(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2} de [a-záéíóú]+ de \d{4}|\d{4}-\d{2})$`,
  case-insensitively.

- **Money**:
  `^([€$£]\s?\d[\d.,]*|\d[\d.,]*\s?[€$£]|\d[\d.,]*\s?(mxn|usd|eur|pesos?|dolares?)|(mxn|usd|eur)\s?\d[\d.,]*)$`,
  case-insensitively. A bare integer is not money.

- **Name**: two to five tokens, no digits, every token starting with a capital
  except the particles `de`, `del`, `la`, `las`, `los`, `van`, `von`, `da`,
  `di`, `y`, `e`. A single word is never a name.

- **Prose**: eight words or more.

### `classifySegments`

```ts
classifySegments(segments: readonly Segment[]): ClassifiedSegment[]
```

Assigns the tier and the natural guess. The catalogue's field set is not
consulted here; a guess names the field the evidence points at, even when the
catalogue does not record it.

| Condition                                                            | Tier         | Guess              |
| -------------------------------------------------------------------- | ------------ | ------------------ |
| a label for `acquisitionPrice`, `currentValue` or `acquisitionDate`  | `row`        | the label          |
| a label whose value is a value shape or a fileable label value       | `label`      | the label          |
| a label whose value is neither (a symbol, a glyph run, a stray char) | `row`        | the label          |
| no label, dimensions shape                                           | `dimensions` | `dimensions`       |
| otherwise: money shape                                               | `row`        | `acquisitionPrice` |
| otherwise: name shape                                                | `row`        | `artistName`       |
| otherwise: bare year or full date                                    | `row`        | `dateOfCreation`   |
| otherwise: prose                                                     | `row`        | `notes`            |
| otherwise                                                            | `row`        | `title`            |

A **fileable label value** is a value shape, or a value that has at least two
letters, letters at least 55% of its non-space glyphs, and at least one token
of three or more letters carrying a vowel. The two-token floor of the words
rule is waived for a labelled value because a value is often one word (`Óleo`,
`Bronce`, `Madrid`); the letter ratio and the vowel test are what reject a
symbol or a glyph run.

The three tiers are the whole assignment model:

1. **A label pair** fills the field it names without a click.
2. **The dimensions shape** fills `dimensions` without a click.
3. **Everything else is a row** in Map values, carrying a guessed field.

Money never fills, from a shape or from a label; the row's guess is the money
field and the member's click is what writes it. Dates never fill
`acquisitionDate`, even when a label names acquisition; that row's guess is
`acquisitionDate`. A certificate's issue date is never an acquisition date.

The first line to claim a field wins (see `applyRead`); a later line for the
same field becomes a row with the same guess, so the member can swap them.

### `guessValueMapping`

```ts
guessValueMapping(
  segments: readonly ClassifiedSegment[],
  enabled: ArtworkFieldStates,
): ValueMapping
```

The Map values table's initial mapping, keyed by `Segment.index`. It is the
projection of the classifier's guesses onto the fields this catalogue records,
so the auto-guess and the dropdown cannot disagree.

- A row's guess is used when it is offered by `enabledImportFields(enabled)` and
  when its value can be filed into that field. `acquisitionDate` is offered only
  when `parseAcquisitionDate(row.value).ok`; the import's own normalizer decides.
- A guess that is not offered falls back to `title`, which is always offered.
- A field already claimed by an earlier row is left out of the mapping (first
  row wins), exactly as `guessColumnMapping` gives a header to the first column
  that matches and leaves the later ones unmapped.
- `title` and `artistName` are fixed fields and are always offered.

A row omitted from the mapping shows **Don't use this line** and the member may
choose any field the claims allow.

`valueFieldOptions` is exported beside it for the table, so the options and the
mapping cannot part:

```ts
valueFieldOptions(
  segment: ClassifiedSegment,
  enabled: ArtworkFieldStates,
): ImportFieldKey[]
```

It is `enabledImportFields(enabled)` mapped to keys, minus `acquisitionDate` when
that row's value does not parse.

### `applyRead`

```ts
applyRead(
  segments: readonly ClassifiedSegment[],
  current: Readonly<Record<ImportFieldKey, string>>,
  enabled: ArtworkFieldStates,
): { writes: ReadWrite[]; rows: ClassifiedSegment[] }

interface ReadWrite {
  field: ImportFieldKey;
  value: string; // exactly as read, trimmed; never repaired
  source: ClassifiedSegment; // the whole line, for the evidence
}
```

Walks the classified segments once, in index order:

- A `label` or `dimensions` segment writes when its guess is offered, the
  current value for that field is blank (`trim() === ""`), and no earlier write
  claimed the field.
- Every other segment is a row: a `row` tier, a disabled field, a field that
  already holds a value, or a field an earlier write claimed.
- A write's value is the label's `value`; a dimensions write's value is its
  `text` (there is no label), exactly as read.
- `status` and `availability` are not fields here and are never touched.

Rows keep their original order and their `index`, so the table and the mapping
stay stable. A read fills only blank fields; a field with a value — typed by the
member, or prefilled by the catalogue, as a Portfolio's artist name is — is not
overwritten, and its line becomes a row with the same guess. The row is the
member's deliberate swap.

### `rowValue`

```ts
rowValue(field: ImportFieldKey, segment: ClassifiedSegment): string | null
```

The value a Map values row writes. It is `segment.value` for every field except
`acquisitionDate`, where it is the normalized date
`parseAcquisitionDate(segment.value)` returns (`YYYY-MM-DD`, a bare year becoming
January 1), or `null` when the value does not parse. A row offered
`acquisitionDate` by `valueFieldOptions` always parses; the `null` is the guard,
not a second path.

## Map values

The table is a staging list between the read block and the fields. It is
**skipped entirely when `rows.length === 0`**: no heading, no empty table. A read
that placed everything, or placed nothing at all, has no table.

It renders only after a successful read, from the `rows` `applyRead` returned.

### The rows

Two columns:

| Line (the context)                                          | File as                 |
| ----------------------------------------------------------- | ----------------------- |
| the segment's `text`, dimmed, clamped to two lines, as read | a `Select`, one per row |

The line **is** the row's context: it is what the member is filing, quoted from
the document, and it is never an editable input. There is no separate sample
column and no line count. The Select's options are, in order:

1. **Don't use this line** — the empty mapping.
2. Every field in `valueFieldOptions(row, enabled)`, by the label
   `ARTWORK_IMPORT_FIELDS` carries, with the required marker on Title and Artist
   name.

The claimed-field behaviour is `MapColumnsStep`'s: a field selected by another
row is disabled in this row's options, so two rows cannot file one field.
Clearing a row frees its field for another. Fields already filled by the read,
or already typed by the member, are **not** disabled: choosing one is the
member's deliberate replacement, and the row's line becomes the field's new
evidence.

A field the catalogue does not record has no option at all, because
`enabledImportFields` is the one list the mapping and the dropdown read.

### Committing

One button, **Add to form**, below the table. It is enabled whenever the table
has a row, and it is `type="button"` — like every control in the block, so only
Save submits the artwork. Pressing it:

1. Writes each mapped row through `rowValue` and `form.setFieldValue`.
2. Sets that field's evidence to the row's whole `text`.
3. Clears the table. The lines have moved into the form; the table's work is
   done. Rows left on **Don't use this line** are dismissed with it.

A second read replaces the table whether or not it was committed (see **A second
read**). There is no per-row save and no confirmation step.

## Filling the form

The read touches the fourteen writable fields of
`ARTWORK_IMPORT_FIELDS` and nothing else:

`title`, `artistName`, `serie`, `dateOfCreation`, `medium`, `dimensions`,
`editions`, `acquisitionDate`, `acquisitionPrice`, `placeOfOrigin`,
`provenance`, `notes`, `condition`, `currentValue`.

- Only fields the catalogue records are written (`enabledImportFields`); a label
  for a field the catalogue does not record becomes a row instead.
- Only blank fields are written. A field with a value becomes a row, as above.
- The value is the read text, trimmed, written exactly as read. OCR typos are
  not repaired.
- A write is `form.setFieldValue`, which in the form's uncontrolled mode bumps
  the field's `form.key` and repaints the input with the new default. Nothing
  here reaches for controlled inputs.
- **Evidence**: every field the read or a Map values row wrote carries its
  source line under the input — the document's line, curly-quoted, dimmed,
  clamped to one line. The member's first edit of the field clears it. The line
  is the whole marking: no badge, no icon, no stored flag, and once it is gone
  the record does not know the value's origin. Evidence is page state; it is
  never saved.
- `availability` and `status` are form state, never read. Status moves to
  **Draft** by the entry-point rule above; the control stays live.

The Add page owns the evidence map, passes it to `ArtworkFields`, and renders
the quote under each input. Editing a field calls back into the page, which
drops that field's evidence. The same map is what a second read clears.

## The optional attachment

The read never attaches anything. The Add page's existing **Other documents**
uploader (`DocumentsUploader`, fed by `useArtworkDocuments`) is the only,
optional, unchecked route to an Artwork document, and it is unchanged. A
member who wants both reads the document in the block, then adds the file
again under Other documents.

The copy keeps the two apart:

- The block's helper: **An invoice, certificate, gallery label or condition
  report. The text is read in your browser.** Under it, at every non-reading
  state: **The file isn't uploaded. To keep it with the artwork, add it under
  Other documents.**
- The uploader keeps its existing description: **Condition reports, receipts,
  provenance notes. Only you can see these.**

"Read in your browser" and "isn't uploaded" belong to the read; "Other
documents" and "Only you can see these" belong to the attachment. The block
never offers a checkbox to attach the source, in any outcome.

## Failure states

### The three outcomes

Only one is an error.

| State       | When                                                           | What the member reads                                                                  | Control                     |
| ----------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------- |
| **Read**    | at least one line kept — a field filled or a row in Map values | **Document read**                                                                      | **Choose another document** |
| **Nothing** | zero lines kept                                                | **No readable text in this document. Type the values in, or choose another document.** | **Choose another document** |
| **Failed**  | the engine or its assets could not run                         | A red alert: **Could not read the document. Nothing was changed — try again.**         | **Try again**               |

- **Read** is a status, not a sentence: no period, no filename, no counts. The
  form and Map values are the report. **Choose another document** returns the
  block to idle and clears the document; the filled fields and the table stay
  until the next successful read.
- **Nothing** is normal, not an error, and is said in no alert color. The form
  is exactly as it was. It offers no "Try again": OCR is deterministic on the
  same pixels, so the same file would produce the same nothing. After a
  failure, "Try again" re-runs the same file, because the engine is what failed.
- **Failed** applies nothing — application happens only after a successful read.
- The read never states a count, a list of what it could not fill, or an absent
  field. A price, an acquisition date or a provenance that was never on the
  document is simply empty. A partial read is just a read.
- **Cancel** returns to idle, clears the document and shows no message. Nothing
  was applied, by construction.

Confidence is never shown: no percentage, no dot, no "low confidence". The
source line is the evidence the member can check.

### Idle, reading and the block's words

| State   | What the member reads                                                                                                                              | Control    |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Idle    | **Drop a document here, or choose one.** Helper: **An invoice, certificate, gallery label or condition report. The text is read in your browser.** | the zone   |
| Reading | **Reading…** with the progress bar                                                                                                                 | **Cancel** |

### File refusals

A refusal happens before a read. It is one file-level sentence on a plain
surface, never the failure alert, and it names the file's problem rather than
the engine's. The drop zone stays.

| Reason                        | What the member reads                                                  |
| ----------------------------- | ---------------------------------------------------------------------- |
| unsupported type              | **That file cannot be read. Choose an image or a PDF.**                |
| image too large               | **That image is larger than 10 MB. Choose a smaller one.**             |
| PDF too large                 | **That PDF is larger than 25 MB. Choose a smaller one.**               |
| PDF has no text layer         | **“{name}” has no text to read. Choose an image of the page instead.** |
| image or PDF cannot be opened | **“{name}” could not be opened. Choose another file.**                 |

A refusal applies nothing and changes nothing in the form.

### The prototype's failures, and what catches each

- **A sideways photograph read as noise** — three of four samples. Caught by
  baking EXIF orientation before the engine runs. Without EXIF the read may
  come back **Nothing**; OSD is deferred (map's _Not yet specified_).
- **A texture-only read** — the artwork's surface scored 85–96 confidence and
  produced rows. Caught by the words rule and the closed drop reasons. The
  visible result is **Nothing**, or a short table.
- **A label whose value is a symbol** — caught by the fileable-value rule; the
  line becomes a row, not a filled field.
- **A label value cut mid-sentence** — cannot be detected; the value fills as
  read and the member edits it. No message.
- **A dimensions fill carrying an OCR typo** — written exactly as read; the
  member edits it. No message.
- **A bilingual certificate's duplicated values** — both rows stay; collapsing a
  translation is deferred (map's _Not yet specified_).
- **An unreadable engine failure** — the red alert above, with **Try again**.
- **An empty or partial read** — the **Read** / **Nothing** states above, never
  an explanation.

## A second read

One read per form; the latest replaces the last.

- A **successful** new read first clears every field still showing a source line
  — the read-owned fields — and its evidence, then applies the new read from
  those now-blank fields. Fields the member has edited have no source line and
  survive; their values are theirs. The new table replaces the old one.
- A **nothing**, **failed**, **refused** or **cancelled** read applies nothing,
  so the previous read's fields, evidence and table stay exactly as they were.
- The block names only the latest document through the member's last action;
  there is no confirmation for the replacement. Picking the file is the
  confirmation, the first read's values can be read again, and the member's own
  edits are never at risk.
- There is no "Read again" after a successful read; choosing another document is
  the only path, because the engine would produce the same result from the same
  file.

## Implementation inventory

**Shared**

| Path                                       | Change                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/shared/src/documentRead.ts        | New: `OcrLine`, `Segment`, `ClassifiedSegment`, `segmentLines`, `classifySegments`, `valueFieldOptions`, `guessValueMapping`, `applyRead`, `rowValue`, `checkReadableDocument`. |
| packages/shared/src/index.ts               | Re-export the module.                                                                                                                                                           |
| packages/shared/tests/documentRead.test.ts | New: the pure suite below.                                                                                                                                                      |

**Web**

| Path                                                        | Change                                                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| apps/web/src/reading/browserReader.ts                       | New: `DocumentReader`, `browserReader`, the only file importing Tesseract and pdf.js.          |
| apps/web/src/reading/DocumentReaderContext.ts               | New: the provider whose default is `browserReader`; the tests replace it.                      |
| apps/web/src/reading/pdfLines.ts                            | New: pure text-item → line grouping, tested without a browser.                                 |
| apps/web/src/reading/useDocumentRead.ts                     | New: the state machine, the reader call, `applyRead`, evidence, table state and commit.        |
| apps/web/src/reading/DocumentReadBlock.tsx                  | New: idle, reading, read, nothing, failed and refusal rendering.                               |
| apps/web/src/reading/MapValuesTable.tsx                     | New: the rows, Selects, claims and **Add to form**.                                            |
| apps/web/src/components/manage/ArtworkAddPage.tsx           | Mount the block and table; `?read=document`; status, evidence and the second-read replacement. |
| apps/web/src/components/manage/artwork/ArtworkFields.tsx    | Optional `readEvidence` and `onFieldEdited`; the quote under a field.                          |
| apps/web/src/components/manage/CatalogueSettingsDataTab.tsx | The second card and its link.                                                                  |
| apps/web/package.json                                       | `tesseract.js`, `pdfjs-dist`; `predev` and `prebuild` run the copy script.                     |
| apps/web/scripts/copy-ocr-assets.mjs                        | New: copies the worker and core; asserts the language data.                                    |
| apps/web/public/ocr/lang/*.traineddata.gz                   | New: the two committed LSTM files and their notice.                                            |
| apps/web/tests/documentReadBlock.test.tsx                   | New: the component and seam tests below.                                                       |
| apps/web/tests/catalogueSettingsDataTab.test.tsx            | New: the Data tab's card and its link.                                                         |
| apps/web/tests/pdfLines.test.ts                             | New: the grouping test.                                                                        |

Nothing in `packages/db`, `apps/api`, `infra/cdk` or the route table changes.
The block and table live inside the existing Add form; the copy lives behind the
existing uploader.

## Tests

The tiers are [docs/testing.md](../testing.md)'s: pure logic first, and a test
of a library's behaviour never. Every test below carries its mutation: break the
named line, watch it go red, restore it.

### Pure — packages/shared/tests/documentRead.test.ts

| Test                                | Fixture text / input                                                                        | Assertion                                                         | Mutation that must redden it                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------- |
| texture is not words                | `SAT GCA XKR 77 ·` at confidence 95                                                         | no segment                                                        | remove the three-letter all-caps exclusion                             |
| words rule keeps a short real line  | `Membrana óleo` at 95                                                                       | one segment                                                       | raise the token floor from 2 to 3                                      |
| letter ratio                        | `12 34 56 Membrana óleo 7890` at 95                                                         | dropped                                                           | lower 55% to 10%                                                       |
| confidence floor                    | `Marco de madera` at 44 and at 45                                                           | 44 dropped, 45 kept                                               | change 45 to 0, then to 100                                            |
| a label is exempt from the floor    | `TÍTULO: Membrana` at confidence 10                                                         | one segment, label `title`                                        | apply the floor to labelled lines                                      |
| a label is found at the line's tail | `GALERÍA X TÍTULO: Membrana` at 80                                                          | label `title`, value `Membrana`                                   | require the whole prefix to equal a label, not a suffix                |
| the longest label wins              | `FECHA DE ADQUISICIÓN: 12/03/2020` at 90                                                    | label `acquisitionDate`, not `dateOfCreation`                     | take the first/shortest match                                          |
| a label value must be fileable      | `TÍTULO: ✳` at 90                                                                           | row, guess `title`                                                | treat any non-empty label value as a fill                              |
| an empty label value drops          | `TÍTULO:` at 90                                                                             | no segment                                                        | keep a pair with an empty value                                        |
| boilerplate is a phrase             | `CERTIFICADO DE AUTENTICIDAD · Madrid` and `CERTIFICADO DE PROCEDENCIA`                     | first dropped, second kept                                        | match only when the whole line is the phrase                           |
| leading texture trims               | `\|\|\| Galería Marta 2024` at 90                                                           | text `Galería Marta 2024`                                         | trim nothing before the label check                                    |
| a leading article survives          | `La obra se encuentra en buen estado` at 90                                                 | text unchanged                                                    | drop every leading token until a 4+ letter word                        |
| a value shape is never trimmed      | `11 x11 cm c/u` at 90                                                                       | text unchanged                                                    | run the edge trim on a value shape                                     |
| dimensions shape                    | `100 x 80 cm`, `100x80`, `100 × 80 × 5 cm`, `100,5 x 80 cm`                                 | tier `dimensions`                                                 | require a trailing unit, so `100x80` fails                             |
| a dimensions run anywhere counts    | `Losetas (4) 20x20x1em cada una`                                                            | tier `dimensions`, value is the whole line                        | anchor the run at the start of the line                                |
| money is never filled               | `PRECIO: 1.200 €` at 90                                                                     | row, guess `acquisitionPrice`                                     | let a money label fill                                                 |
| an acquisition date is never filled | `FECHA DE ADQUISICIÓN: 12/03/2020` at 90                                                    | row, guess `acquisitionDate`                                      | let the label fill                                                     |
| row guesses, in order               | `Galería Marta`, `1889`, `una frase larga que tiene exactamente ocho palabras`, `Una línea` | `artistName`, `dateOfCreation`, `notes`, `title`                  | remove one shape rule → that line falls to `title`                     |
| exact twins collapse                | `Óleo sobre lienzo` + `óleo sobre lienzo`; `Óleo sobre lienzo` + `Óleo sobre papel`         | one segment; two segments                                         | fold case only, or fold accents only                                   |
| first claim wins                    | `TÍTULO: Membrana` + `TÍTULO: Otra`, `current.title === ""`                                 | one write (`Membrana`), one row for the second                    | let the last write win                                                 |
| blank fields only                   | `TÍTULO: Otra`, `current.title === "Membrana"`                                              | no write; one row guessed `title`                                 | write unconditionally                                                  |
| a disabled field is a row           | Portfolio, `PROCEDENCIA: Colección privada`                                                 | no write on `placeOfOrigin`; row; mapping falls back to `title`   | use the natural guess when the field is off                            |
| a fixed field is always offered     | a Portfolio and a `TÍTULO:` line                                                            | the write lands on `title`                                        | read `enabled.title` (undefined) instead of the fixed list             |
| the mapping is first-wins           | two rows both guessed `title`                                                               | `guessValueMapping` maps the first, omits the second              | let both map to `title`                                                |
| acquisitionDate is conditional      | `12/03/2020` and `not a date`                                                               | `valueFieldOptions` offers the date for the first, not the second | offer it on every row                                                  |
| `rowValue` normalizes a date        | `12/03/2020` → `2020-03-12`; `2020` → `2020-01-01`                                          | the import's normalized date                                      | write the raw text into the date field                                 |
| `checkReadableDocument`             | 10 MiB jpeg, 25 MiB jpeg, 25 MiB PDF, `.docx`                                               | allowed, too large, allowed, unsupported                          | use one cap for both populations, or the document allowlist for images |

The fixture lines are invented. No sentence, name, price or value from a sample
document enters the tree; the prototype's samples stay outside it.

### Web pure — apps/web/tests/pdfLines.test.ts

| Test                     | Fixture                                                     | Assertion                         | Mutation                                |
| ------------------------ | ----------------------------------------------------------- | --------------------------------- | --------------------------------------- |
| items on a baseline join | two items with the same `transform[5]`, one above the other | one line, left to right           | group by item order instead of baseline |
| a new baseline splits    | the same x, `transform[5]` differing by more than 1         | two lines                         | widen the tolerance to 100              |
| a text layer is exact    | one non-space item                                          | one `OcrLine` with confidence 100 | reuse the engine's confidence           |

### Component — documentReadBlock.test.tsx and the Data tab

The fake `DocumentReader` returns fixed `OcrLine[]` or rejects. The tests mount
the real Add page in `MantineProvider`, wrapped in a `DocumentReaderContext`
provider with the fake; where the page's catalogue load is irrelevant, a
harness calls `useDocumentRead` directly and renders the block, table and
fields. Every test has its own `afterEach(cleanup)` and the empty-`matchMedia`
stub. The entry-point row lives in
apps/web/tests/catalogueSettingsDataTab.test.tsx; the rest in
apps/web/tests/documentReadBlock.test.tsx.

| Test                 | What it proves                                                                                  | Mutation                                  |
| -------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| an empty read        | says **No readable text…**, leaves the form intact                                              | show the failure alert instead            |
| a failed read        | shows the red alert; **Try again** re-calls the fake                                            | drop the retry, or apply a partial result |
| cancel               | aborts, applies nothing, returns to idle with no message                                        | apply after the abort                     |
| fill and evidence    | a title label fills Title and quotes the line under it                                          | write the value without evidence          |
| edit clears evidence | typing in Title removes the quote                                                               | keep the quote after an edit              |
| the second read      | replaces read-owned fields and rows, keeps an edited field                                      | clear every field, including the member's |
| Map values claims    | a field chosen by one row is disabled in another                                                | remove the claimed set                    |
| **Add to form**      | writes the mapped rows and clears the table                                                     | render the table empty after the click    |
| no rows              | a read with no rows renders no **Map values** heading                                           | render the heading unconditionally        |
| the entry point      | the Data tab card links to `/artwork/add?read=document`                                         | link without the query                    |
| Draft                | the query opens Draft; a plain page's read sets Draft if untouched; a chosen Published survives | always Published, or always Draft         |

The mutation is the acceptance bar, not an extra: a test whose named mutation
stays green is removed or rewritten. The mechanics (cleanup, `matchMedia`,
`ModalsProvider`) are [docs/testing.md](../testing.md)'s.

## What is deferred

The map's **Not yet specified** is the owner; this list only names what is
deliberately not built here, so an implementer does not reopen it:

- Orientation detection for a sideways image with no EXIF (OSD, the legacy core,
  ≈4.3 MB) — revisit only when such a document is a real input.
- Rasterise-and-OCR for a PDF with no text layer.
- Whether **Map values** and **Map columns** become one component, and whether
  the artist field's autocomplete merges with the document's candidates.
- Reading a second document without leaving the form — the 200-work loop.
- Recognising the English half of a bilingual document as a translation and
  collapsing it, rather than showing a second row.

## Out of scope

The map's **Out of scope**, restated so the boundary is visible: camera →
record, paste-a-URL, a better CSV template and guided onboarding; multi-work
documents and page segmentation; using a document's own image as the artwork's
photo; server-side extraction, any model provider and any metering; attaching
the source document automatically.
