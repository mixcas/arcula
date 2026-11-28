# Reading a document happens on the member's device

**Status**: accepted

The Add form asks for facts the member usually already holds on paper: an
invoice, a gallery label, a certificate of authenticity, a condition report.
Retyping them is the barrier this feature removes. The member drops the file on
the Add page, its text is read, values are suggested, and whatever the machine
cannot place becomes a row in **Map values** for the member to map by hand. The
form arrives filled and opens as a Draft.

The question this record settles is **where the read happens**. It is not an
implementation detail. A **document** here is the member's local file — an
invoice, a label, a certificate, a condition report — before it is attached to
anything; once attached it is an **Artwork document**, and that is a different
noun for a different state. The document is the most private input in the
product: an invoice carries names, prices and sometimes signatures; a
certificate carries an owner's details; a condition report carries a work's
faults. A server-side read is a copy in flight, in a log, in a queue, under a
vendor's terms. A local read is none of those.

Arcula is one Lambda serving the SPA, the API and the MCP endpoint on one origin.
It holds no document-processing infrastructure: no OCR service, no model
provider, no queue and no metering. The decision keeps it that way.

## Decision

**The read runs in the member's browser, on Tesseract.js.** WebAssembly, in a
web worker, consuming the member's CPU: the page stays usable while it works and
the engine has nothing to queue, scale or time out. The probe measured 2.0–5.6 s
per 3000×4000 px document in Chrome, engine start included.

**The engine is served from Arcula's own origin.** The worker script, the wasm
core and the language data are assets in the web build, fetched same-origin.
They are lazy-loaded on the first read, so a member who never reads a document
downloads none of them. No CDN, no third-party script, no external service is
involved in a read.

**Inputs are an image or a text-layer PDF.** Images are jpeg, png or webp. A PDF
is read by `pdfjs-dist`, which extracts the text layer; it is not OCR'd. A PDF
with no text layer is refused, and the copy says why. `pdfjs-dist` is the one
new runtime dependency. A photographed page is an image and follows the image
path.

**One document reads into one artwork.** The surface is the Add page, which
already owns the minted id, the staged uploaders, the status control and the one
`POST`. There is no batch and no `importArtworks` in the path, no page
segmentation and no multi-work document.

**The document stays local through the read.** It is a local `File`, read into
memory and drawn to a canvas; it is not uploaded, stored, named to the server or
logged. Whether a copy is attached to the artwork is a separate, unchecked
choice, offered through the uploader the Add page already mounts. A read
therefore creates no row, no object and no server-side log line — only the
suggestions the form is about to save.

**The mapping step is local and pure.** OCR text becomes typed segments, and
segments become suggestions, in functions that take a string and return data.
Label pairs and dimensions fill themselves; money, dates, name-shaped and
title-shaped lines, and prose become rows in **Map values**; money is never
filled from shape alone. The engine sits behind an injectable seam so jsdom can
fake it, and the tests live on the pure half: a string in, typed segments out.

**No server, no model provider, no egress, no metering.** There is no route, no
queue, no vendor account, no credential, no per-call bill and no read counter to
add. Nothing the interaction sends leaves the origin: its only requests are the
save the Add form already sends and the same-origin assets a first read
downloads.

## Consequences

- **The weight reaches only the members who use it.** The probe's two languages
  came to 2.1 MB and 2.95 MB gzipped of LSTM-only data, beside the wasm core.
  Lazy loading keeps that out of the first paint and out of every member's
  download; what it costs is deploy size and the first read's wait.
- **A future Content-Security-Policy must keep this working.** The app ships no
  CSP today. One that lands must allow `wasm-unsafe-eval` for the core, and if it
  narrows workers or connections it must admit the same-origin worker, core and
  language data. Otherwise the feature stops with no code change, so the policy
  earns a test that holds it to these assets.
- **The promise is public copy and cannot be quietly withdrawn.** A page that
  says the document is read on the member's device, or never leaves it, is
  making a claim a future refactor cannot contradict. A server-side reader is a
  new record and a visible change to that copy, never an implementation swap
  behind the same words.
- **Recall is bounded by the document's layout.** Across four real documents,
  dimensions was the only shape fill that worked (3 of 4, and two carried an OCR
  typo into the field); label pairs existed on one document of four, in Spanish;
  no price and no acquisition date appeared anywhere; artist and title landed in
  **Map values**, or not at all. A vision model would generalise further. This
  engine cannot learn, and its mistakes are literal — a wrapped label fills half
  a sentence. The mapping table is the mitigation, and the manual step is the
  price of the privacy.
- **The document leaves no evidence on the server; its values can.** The read
  sends no document, text or derived value anywhere, so a wrong read cannot be
  reproduced from our logs and support has nothing to inspect. Once a suggestion
  is in the form, though, it is an ordinary form value, and session replay
  records form text by design ([ADR-0011](0011-session-replay-is-redacted-at-the-client.md)).
  The document never travels; the fields it filled can appear in a replay
  exactly as if the member had typed them. That is the cost of the boundary, not
  a gap to close by logging more.
- **The device pays.** CPU, battery and time are the member's, a low-end phone
  will be slower than the measured desktop Chrome, and the tab must stay open —
  there is no background read. The engine's quality is also not tested here; the
  tests fake it, and its real behaviour is a browser fact rather than a unit.
- **There is nothing to meter.** A read costs Arcula nothing, so there is no
  quota, no counter and no bill to run up; equally, the product cannot
  rate-limit a member who loops the feature. The 200-work loop is deferred as a
  product question, not a cost one.
- **Not built here.** Orientation detection for a sideways image with no EXIF
  orientation (OSD and the legacy core, about 4.3 MB more), rasterise-and-OCR
  for a PDF with no text layer, batches and page segmentation, and any
  server-side or vendor reader.

## Rejected alternatives

- **A server-side vision model.** Best recall by a wide margin, and it puts a
  member's invoice — names, prices, signatures — in flight to a vendor, under
  that vendor's terms, at a per-call bill, behind a metering problem that does
  not exist today. Rejected for this feature. It is genuinely attractive for a
  different one whose input is not a member's private document, or whose member
  explicitly chooses to send it.
- **A vendor OCR API.** The same flight without the understanding: the document
  leaves the device, a vendor relationship and a per-page bill arrive, and the
  output still needs the mapping table. The worst of both.
- **A CDN-hosted engine.** A smaller build and a faster first read, because the
  browser may already hold a popular copy; but the engine is executable code, so
  a CDN URL puts a third party inside the origin's trust boundary, makes every
  read depend on their availability and logging, and turns "the app reads it"
  into "a vendor's script runs here". The request falsifies the feature's own
  promise. Serving the several megabytes ourselves is the point.
- **Server-side Tesseract on the existing Lambda.** It keeps the vendor out and
  still puts the document in flight to our server: a route, the 6 MB synchronous
  payload ceiling ([ADR-0012](0012-media-uploads-go-direct-to-storage.md)), a
  several-megabyte engine on a cold start, a timeout and retry story, and
  infrastructure that handles a private file for the length of a read. More
  machinery for a weaker promise.
- **Show the OCR text and let the member copy it.** No pretence and no value:
  the member still retypes every value, now from a panel instead of paper, and
  the form does not arrive filled. The **Map values** table is the answer to it,
  because it keeps the machine's guess editable and puts it in the field the
  member chooses.
- **Do nothing and shorten the form further.** The form is already minimal by
  default ([ADR-0016](0016-artwork-field-defaults-start-minimal.md)), and the
  fields a document fills are the ones members need. The barrier is the
  retyping, and no default removes it.
- **Read several documents in one pass.** Another feature: multi-work documents
  and page segmentation need a review queue and a rule for which artwork each
  page belongs to. One document to one artwork is the smallest useful unit and
  the one the Add page's single `POST` can land.
