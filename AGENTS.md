# Custodia Agent Guide

This is a React + TypeScript + Vite project using Firebase for authentication and Firestore for data storage.

## Key Commands

- `bun run dev` - Start development server (port 3000)
- `bun run build` - Build for production
- `bun run preview` - Preview production build
- `bun run check` - Typecheck, lint, and check formatting
- `bun run test:rules` - Run the Firestore + Storage rules suites against the emulators (needs Java)
- `bun run emulators` - Start the full emulator suite with web UI (port 4000)
- `bun run deploy:rules` - Test rules, then deploy `firebase deploy --only firestore,storage`
- `bun run deploy:hosting` - Build, then deploy hosting
- `bun run deploy` - Rules first (gated on the suite), then hosting

## Project Structure

- **Frontend**: React 19 with TypeScript
- **UI Framework**: Mantine UI Components (@mantine/core)
- **Routing**: react-router-dom v7
- **State Management**: React Hooks + Context API
- **Authentication**: Firebase Authentication
- **Database**: Firestore

## Important Details

- **Entry Point**: `src/App.tsx` - Main routing configuration
- **Firebase Setup**: Configured in `src/services/firebase.ts`
- **Authentication Context**: `src/context/AuthContext.tsx`
- **Management Interface**: All `/manage` routes use `src/components/manage/layout/ManageLayout.tsx` for consistent header with user menu and logout

## Key Files

- `src/App.tsx` - Routing configuration (update this to add new routes)
- `src/components/manage/layout/ManageLayout.tsx` - Consistent header layout for management interface
- `src/components/manage/ManagePage.tsx` - Main dashboard showing collections
- `src/components/manage/collection/NewCollectionPage.tsx` - New collection creation form
- `src/components/manage/CollectionPage.tsx` - Collection detail; loads the collection + its live artworks
- `src/components/manage/collection/ArtworksTable.tsx` - Sortable/selectable artwork table, batch soft delete
- `src/migrations/index.ts` - Data migration registry (see Migrations)
- `src/components/manage/MigrationsPage.tsx` - Runs pending migrations for the signed-in account
- `src/services/artworkService.ts` - Artwork reads (owner vs visitor) and `softDeleteArtworks`
- `src/utils/imageVariants.ts` - The variant table, the geometry, and the caps
- `src/utils/artworkPhotos.ts` - `order` invariant and the read helpers
- `src/utils/imageRender.ts` / `imageWorker.ts` / `imageProcessing.ts` - Canvas encoding, worker, orchestrator
- `src/services/imageService.ts` - Storage upload and delete sweeps
- `src/hooks/useArtworkPhotos.ts` - Photo list state for the Add/Edit forms
- `src/components/manage/artwork/PhotoUploader.tsx` - The image list UI

## Firebase Integration

All Firebase services are imported from `src/services/firebase.ts`:

- `db` for Firestore database
- `auth` for Authentication
- Environment variables must be configured in `.env` file

## Testing and Development

- Development server runs on port 3000
- Source code in `src/` directory
- Build output in `dist/` directory (auto-cleaned)
- No additional test setup required - uses Vite + React testing library

## Architecture Notes

- Management routes (`/manage/*`) are wrapped with consistent layout
- Layout includes user menu with avatar and logout functionality
- Collection creation uses Firestore `addDoc()` to create new documents in "collections" collection
- Redirects after creation use URLized name + ID format: `/manage/collection/{urlized-name}-{collection-id}`
- All management pages are protected by ProtectedRoute component

## Development Environment

- Uses Vite for fast development server
- TypeScript type checking included
- React 19 with modern hooks and features

## Utilities (Lodash)

Lodash (`lodash@^4.18.1`) is a dependency and available for utility functions.

- Prefer subpath imports for smaller bundles: `import debounce from "lodash/debounce"`.
- Full-package imports (`import { debounce } from "lodash"`) also work but pull in more code.
- `@types/lodash` is **not** installed — importing lodash in code will fail `bun run build` (tsc) until it is added via `bun add -d @types/lodash`.

## Mantine Context

Mantine guidelines are saved in `.opencode/docs/mantine-llms.txt`. Reference this file whenever building UI components or form controls.

## Custodia Firebase Integration

> The product is named **Arcula** (arcula.art) as of 28 September 2026, but this
> document and the internal identifiers still say Custodia — the Firebase project
> (`custodia-67307`), the emulator project (`demo-custodia`), and the package and
> repository names. That split is deliberate; see [RENAME.md](RENAME.md) before
> renaming any of them.

### Summary

Custodia is a React 19 + Vite + Mantine SPA. Firebase provides all
persistence and auth. Firebase is initialized once in
`src/services/firebase.ts` from `VITE_FIREBASE_*` env vars and exposes
`db` (Firestore), `auth`, and `storage` (Storage, wired but unused).
Firestore access is enforced by `firestore.rules` (with
`firestore.indexes.json` for composite queries); the rule suite in
`tests/` runs against the emulators and gates every rules deploy.

### When to use

- Adding or changing auth, login, logout, or protected routes
- Reading/writing the `collections` or `artworks` Firestore data
- Touching any file that imports from `src/services/firebase`
- Adding new collections, storage uploads, or security rules
- Changing read/write patterns that the rules must authorize (rules live
  in `firestore.rules`; list rules are per-document field checks, so keep
  the client's `where(...)` filters in sync — a list whose result set spans
  a document the caller may not read fails the whole query)
- Running or extending the rules suite (`tests/firestore.rules.test.ts`)

### Where to find it

- Init + exports: `src/services/firebase.ts` (do NOT re-initialize the app)
- Auth: `src/services/authService.ts`, `src/context/AuthContext.tsx` (useAuth)
- Data: `src/services/collectionService.ts`, `src/services/artworkService.ts`
- Types: `src/types/index.ts` (User, Collection, Artwork, FileReference)
- Rules: `firestore.rules`, `firestore.indexes.json`, `storage.rules`
- Tests: `tests/firestore.rules.test.ts`, `tests/storage.rules.test.ts` (via `bun run test:rules`)
- Env vars: `.env`, `.env.development` (VITE_FIREBASE_*)

### Plan and billing (Blaze)

The project (`custodia-67307`, pinned in `.firebaserc`) is on the **Blaze**
(pay-as-you-go) plan, not Spark. That is already true, so Blaze is never a
reason to choose one design over another.

- Blaze is a payment method, not a subscription and not a product tier:
  usage bills past the free quotas every plan includes. It is console state —
  nothing in the repository provisions it, and no script depends on it.
- What it unblocks: Cloud Functions (the `functions/` scaffold — the collection
  password grants, an `auth.onCreate` profile trigger, a quota count with admin
  credentials) and an Admin SDK server-side backfill. Everything built so far
  (Auth, Firestore, rules deploys, Hosting, the emulators) runs on Spark.
- Nothing local bills. The emulators and `bun run test:rules` are free, and
  deploying rules or static files is not metered. The billable surfaces are a
  functions deploy, function invocations, and Storage traffic once uploads
  land. No script in `package.json` deploys functions at all — `deploy` is
  `deploy:rules` then `deploy:hosting`, each `--only` scoped — which is
  deliberate, not an oversight.
- Consequence for prose: anywhere a note says a feature "needs the Blaze
  plan", read that as already satisfied and look for the _other_
  prerequisite instead (Anonymous Auth, a built `functions/` scaffold). Do not
  re-raise billing as the open question.

### Security rules model

The rules authorize list queries with per-document field checks
(`resource.data.userId`, `resource.data.isPublic`) rather than
`request.query.where(...)` constraints. Reason: rules are not filters, so a
per-document rule already denies any list whose result set could span a
document the caller may not read — and the emulator (which runs the
deploy-gating suite) does not populate `request.query.where`, so
query-constraint rules would be untestable. No `get()`/`exists()` on any
read path (that keeps list evaluation free of dependent document reads):

- `collections`: owner lists add `where("userId","==",uid)`; visitors can
  only `get` one document whose `isPublic == true`.
- `artworks`: owner (list/get/update/delete) vs `isPublic == true`
  (visitor get/list). One `get()` only exists — on the artwork `create`
  path, to prove the parent collection belongs to the writer.
- `isPublic` is per-artwork and independent of the collection's flag by
  design (no sync/cascade). Default is `true` in every write path — new
  collections and artworks are publicly reachable unless flipped off via
  Settings (collections) or the Add/Edit form Switch (artworks). The
  rules never validate the flag on write; visitor reads gate on it.
- The service layer is where server timestamps get stamped
  (`serverTimestamp()` last), and the rules verify
  `createdAt/updatedAt == request.time` on create/update so the client
  cannot spoof them.
- `bun run test:rules` starts Firestore+Auth emulators with a throwaway
  `demo-custodia` project (`.firebaserc` pins the real one for deploys)
  and asserts every rule above. `bun run deploy:rules` runs the suite
  first, so a failing rule set is never deployed.
- Deploys are always `--only` scoped: `deploy:rules` =
  `--only firestore,storage`, `deploy:hosting` = hosting only.

### Access patterns (IMPORTANT)

Two patterns coexist; follow the surrounding code:

- Service layer: call `collectionService` / `artworkService` / `authService`.
- Direct SDK: import `db`/`auth` and call Firestore/Auth APIs in components
  (see ManagePage, NewCollectionPage, LoginPage, ManageNavBar).
  Note: `authService.login/onAuthChange` and
  `collectionService.createCollection` are defined but currently unused —
  components call the SDK directly instead. Prefer the service layer for new code.

### Auth

- Provider: email/password only.
- App-wide state: wrap app in `AuthProvider`, read via `useAuth()` in
  `AuthContext.tsx`.
- Sign in: `signInWithEmailAndPassword(auth, email, password)`
  (LoginPage maps err.code to user messages).
- Sign out: `signOut(auth)` (ManageNavBar, NewCollectionPage).
- Gate routes with `ProtectedRoute` (redirects to /login when unauth),
  wired in `src/App.tsx`.

### Data model

- Collections: `collections`, `artworks` (top-level Firestore collections).
- Ownership filter: `where("userId", "==", currentUser.uid)`.
- Reads return `{ id: doc.id, ...doc.data() }`; creates use `addDoc`
  and return `docRef.id`.
- Route link for a collection: `/manage/collection/{urlizedName}-{docId}`
  (urlize: lowercase, non-alphanumerics -> "-", trim hyphens).
- `Artwork.isPublic` is a per-work boolean, **independent** of the
  collection's `isPublic`. Default is `true` on every write path
  (`src/schemas/artwork.ts` keeps it in the schema and payloads;
  `artworkService.createArtworks` inherits it for CSV imports). The
  rules authorize the public reads on this field alone.
- Artwork reads split by caller (both in `src/services/artworkService.ts`):
  - owner: `getCollectionArtworks(collectionId, userId)` — where()
    `collectionId` + `userId` + `deletedAt == null` (needs the
    `(collectionId, userId, deletedAt)` index)
  - visitor: `getPublicCollectionArtworks(collectionId)` — where()
    `collectionId` + `isPublic == true` + `deletedAt == null` (needs the
    `(collectionId, isPublic, deletedAt)` index)
    Both indexes are declared in `firestore.indexes.json`. The `deletedAt`
    clause is mandatory, not cosmetic: see Soft delete below.

### Soft delete (artworks)

Artworks are never removed from Firestore. `Artwork.deletedAt` is a
`Timestamp | null`, and **live means `deletedAt == null`**. The owner's
collection page lists only live works, so a soft-deleted row leaves the table
but stays in the database.

- **Every create path writes `deletedAt: null` explicitly** (never omits the
  field). This is the crux, and it cuts both ways: reading an absent field in a
  _rule_ is an evaluation error that denies, and `where("deletedAt","==",null)`
  does not match an absent field either (verified against the emulator:
  explicit nulls only). The rules tolerate legacy documents through
  `resource.data.get("deletedAt", null) == null`, but the **query** does not —
  so every artwork written before this field existed was hidden in the app
  until `backfillArtworkDeletedAt` ran. Adding a field to a document type is
  a schema change even though Firestore has no schema: see Migrations below.
- `artworkService.softDeleteArtworks(ids)` — `writeBatch` in chunks of 400,
  stamping `deletedAt: serverTimestamp()` with `updatedAt: serverTimestamp()`
  last. The hard `deleteArtwork` remains exported but unused; same for
  `collectionService.deleteCollection`. Do not reach for them.
- Restoring is `updateArtwork(id, { deletedAt: null })` — deliberately _not_
  `deleteField()`, for the reason above. There is no trash/restore UI yet.
- The rules gate only the **visitor** branches of `match /artworks` (the `get`
  and the `isPublic` list) on `resource.data.get("deletedAt", null) == null`.
  Owner branches are untouched, so a future trash view over
  `where("deletedAt","!="...)` needs no rules work.
- Not built yet (deliberately): a trash/restore view, a `deletedAt != null`
  index, a public single-artwork route (which is why the row **View** button
  is disabled), and a Cloud Function that purges long-dead works.

### Migrations

**Adding a field to a document type is a schema change, even though Firestore
has no schema.** Nothing backfills: documents written before the field existed
keep their old shape forever, and nothing complains — a query on the new field
just quietly stops matching them. The symptom ("all my artworks are gone")
looks nothing like the cause, so treat "data written before this change" as a
first-class suspect whenever a list comes back unexpectedly empty.

Firebase has no migration runner. This app does, in three pieces:

- `src/migrations/types.ts` — the `Migration` shape: `id`, `label`,
  `description`, `countPending(db, userId)`, `run(db, userId)`. The `Firestore`
  instance is a _parameter_, never the app's imported `db`, so the rules suite
  can point a migration at the emulator.
- `src/migrations/index.ts` — the registry, oldest first. Append new entries;
  never renumber or reorder an existing `id`.
- `src/components/manage/MigrationsPage.tsx`, routed at `/manage/migrations`
  (protected, linked from a collection's Settings page) — lists each migration
  with its pending count and a Run button, disabled while the count is unknown
  so a migration is never run blind.
- `src/utils/maintenanceAccess.ts` — `isMaintenanceAdmin(email)`, the
  allowlist of who sees the maintenance screens (currently just
  casska@gmail.com). **A UI gate, not a security boundary**, and safe as one:
  a migration only writes the signed-in account's own documents through the
  same owner rules as any other write, so running one you shouldn't have would
  only rewrite your own data. `firestore.rules` is the real boundary. The check
  is applied both to the card and to the page itself, since hiding a link does
  nothing about someone typing the URL; a non-allowlisted user gets redirected
  to `/manage` rather than told the tool exists. Match is case- and
  whitespace-insensitive, because a strict compare would hide the screen from
  its own owner over a capital letter.

Rules for writing one:

- **Idempotent, always.** `countPending` is a _content_ check ("how many
  documents still have the old shape"), not a "has run" marker: the data says
  whether it is current, so there is no bookkeeping to keep in sync and no
  second place for the truth to be wrong. `tests/firestore.rules.test.ts`
  asserts a second run updates nothing.
- **Select on `userId` alone, with no filter on the field being migrated.**
  That is the only way to reach a legacy document: the app's own list queries
  filter on the new field and therefore cannot see the documents that lack it.
  A `where("userId","==",uid)` list is single-field (automatic index) and
  passes `isOwner` for every document it returns.
- **Writes still go through the rules**, so a migration is an ordinary owner
  update: stamp `updatedAt: serverTimestamp()` last, batch in chunks of 400.
  A migration that needs to bypass the rules is out of scope for this design —
  that would need the Admin SDK, below.
- Write the field as an explicit `null`/default, never `deleteField()`: a
  missing field is exactly what this whole mechanism exists to remove.

Scope and alternatives, for when this stops being enough:

- These run as the **signed-in owner**, so each account migrates its own
  documents from its own browser. That is fine for this app and needs no
  infrastructure, but it is not a fleet-wide backfill.
- A server-side backfill would use the **Admin SDK** (a script with a service
  account, bypassing the rules) or a **Cloud Function** (an `onDeploy`
  trigger). Both are unblocked by the Blaze plan (already in place), so what
  is left is a credentials-and-rollout decision — who runs it, and which
  service account it uses — not a billing one.

### Artwork table (owner view)

`src/components/manage/CollectionPage.tsx` renders
`src/components/manage/collection/ArtworksTable.tsx` (it replaced the Card
list). The datatable itself does **neither sorting nor pagination** — the
caller sorts the full dataset and then slices the page:

- Sort state lives in the table (`useState<DataTableSortStatus<Artwork>>`,
  default `{ columnAccessor: "title", direction: "asc" }`); a new sort resets
  `page` to 1. Comparison is `Intl.Collator(undefined, { sensitivity: "base",
numeric: true })` with an `id` tie-break — titles are free text in any
  language, so `<`/`>` would sort "Study 10" before "Study 2".
- A column must declare `sortable: true` to be clickable. It is **not** the
  default: without it the header renders as plain text and clicking it does
  nothing at all. The actions column is `sortable: false`,
  `pinned: "right"` (this version has no `frozen` prop), `width: 220`.
- Selection is held as `string[]` of ids rather than record objects, so the
  post-delete refetch cannot silently empty it. Cancelling the confirm dialog
  deliberately leaves the selection alone.
- Every delete goes through `modals.openConfirmModal` with a stable
  `DELETE_MODAL_ID`, so a second click cannot stack dialogs. `ConfirmModal`
  ignores the promise returned by `onConfirm` and closes immediately, so the
  modal uses `closeOnConfirm: false` and drives `loading` / error state
  itself via `modals.updateModal`, then `modals.close(DELETE_MODAL_ID)`.
  `loadArtworks` in `CollectionPage` (passed as `onDeleted`) reports its own
  failure instead of throwing — a rejection there would be caught by the
  delete handler and misreported as a failed delete.

### CSV import (artworks)

The `{urlizedName}-{id}` pattern extends to
`/manage/collection/{urlizedName}-{id}/import/csv` (a single protected,
ManageLayout route added in `src/App.tsx`).

- Entry point from CollectionSettingsPage; flow lives in
  `src/components/manage/import/` (`CsvImportPage` + four Stepper steps +
  `EditableCell`). State is in-memory only — leaving the URL discards the
  whole import, and the file itself is parsed in-browser and never
  uploaded (`@mantine/dropzone` + papaparse in `src/utils/csv.ts`).
- Pure logic is testable and lives in `src/schemas/artworkImport.ts`:
  header matching/auto-map, `parseAcquisitionDate` (bare year →
  `YYYY-01-01`, year-first and DMY/MDY heuristics — both-≤-12 reads
  day-first — each conversion flagged as "converted from …" for the
  review step), row building/validation (reuses `artworkSchema` with
  `isPublic: true`).
- The review step is a `mantine-datatable`; rows are editable cell by
  cell, all selected by default, and Confirm stays blocked while any
  _selected_ row has a validation issue (fix in-cell or deselect).
  Duplicate titles are **never** compared — same-title works are
  legitimate in art and placeholder phrasing varies by language, so the
  only title rule is that a Title exists (blank rows are flagged by the
  schema and block import until filled, by the user or the CSV).
- `isPublic` is **not** a mappable column; imported artworks inherit the
  public default via `toImportArtwork`.
- Bulk write is `artworkService.createArtworks()` — `writeBatch` chunks
  of 400 docs with `serverTimestamp()` stamped last. The rules suite
  asserts batch + timestamp guards pass (`tests/firestore.rules.test.ts`
  has explicit batch-create cases), so no client-side fallback is needed.
- Keeping the accepted `acquisitionDate` value strict `YYYY-MM-DD` is
  deliberate; `dateOfCreation` stays free text. Schema (`artworkSchema`)
  still validates import rows, so a pure-logic change that drifts from
  the schema is caught by `tests/artworkImport.test.ts` at CI time.

### Artwork photos (uploads, variants, ordering)

`Artwork.photos` is an `ArtworkPhoto[]`, **not** `FileReference[]`.
`certificates` keeps `FileReference[]` and is still unwired. The split is
deliberate: a photo needs its generated sizes and its position in the
sequence, and `FileReference.metadata?: any` - the codebase's only `any` - is
the wrong home for both, because an untyped field is a field nothing checks.

**The data shape.** Each entry has `id`, `order`, `name`, the source
`width`/`height`, an unmodified `original`, and `variants[]`
(`{key, url, width, height, size, contentType}`). The source dimensions are
recorded separately from the variants on purpose: a variant cannot stand in
for them, because `square_lg` is a crop and the bounded variants are clamped
by the never-upscale rule.

**`order` and the array position must not disagree.** Firestore already
preserves array order, so `order` is a second source of truth that can drift
the moment anything writes one without the other - and the failure is silent
(a photo claims to be first while sitting third, and the "primary thumbnail"
renders the wrong image). The rule is therefore narrower than "store the
order": **the array position is the truth**, and `reindexPhotos()` rewrites
`order` from it on every write. Every read goes through `sortPhotos()`, which
sorts by `order` with array position as a tie-break so the result is
deterministic. Index 0 is the primary thumbnail app-wide.

**The variant table** (`src/utils/imageVariants.ts`) is the only place a
pixel size appears. Nothing else hardcodes one:

| key         | geometry                | why                                        |
| ----------- | ----------------------- | ------------------------------------------ |
| `square_lg` | 800x800, `cover`        | thumbnail fills the box, never letterboxed |
| `square_sm` | 400x400, `cover`        | ditto, for dense grids                     |
| `large`     | max side 1200, `inside` | no crop, no upscale                        |
| `medium`    | max side 800, `inside`  | no crop, no upscale                        |

`fit: "inside"` **never enlarges**. A 300x300 book plate stays 300x300:
scaling it to 800x800 would invent pixels that do not exist, and a catalogue
is a poor place to store a blurry blowup of the record. `variantSize` and
`coverCrop` are pure arithmetic, deliberately separated from the canvas so
they run in a plain node test - `coverCrop` returns a rect in **source**
pixels, which is what the 9-arg `drawImage` actually takes.

**The WebP probe is not defensive padding - it is the only thing standing
between the app and a broken upload.** Safari has no WebP canvas encoder, and
the HTML spec's response to an unsupported `type` in `toBlob` is not an error:
the browser silently substitutes `image/png`. No throw, no null, no warning.
So `probeWebpEncoding()` encodes a probe and reads back the resulting blob's
`type`; a variant is only named `.webp` after that assert. The extension
always comes from the **blob's** type, never from the requested one - which is
the second half of the same trap. The rules admit `webp|jpg|png` because those
are the only three an upload can honestly be (PNG only ever on an `original`,
stored as the format it already is so it keeps its alpha).

**The probe encodes a painted 8x8, and never a 1x1.** A canvas that has never
been drawn to is a _placeholder_ canvas, and a 1x1 one is the smallest
degenerate case there is - too small for an encoder to be exercised the way an
800x800 thumbnail will exercise it. The original probe asked about exactly
that, and it fails **silently**: the probe reports "no WebP", every variant is
written `.jpg`, and the app looks like it simply chose JPEG. Nothing mislabels

- the extension always comes from the blob - so the only symptom is a
  downgrade nobody is told about, found weeks later in the Storage console.

**The probe is a hint; the batch is the truth.** In the worker path the page
cannot work the format out for itself: the probe runs over there, in another
global, on another canvas. So the worker reports `webp` back with the batch
(`BatchResponse.webp`), `processImages` stamps it on every `ProcessedImage`,
and `useArtworkPhotos` writes it to `variantWebp` - overuling the mount-time
probe if the two disagree. `PhotoUploader` shows a yellow warning when it is
false. Two sources on purpose: the probe answers early enough to warn _before_
anyone uploads ten photos, and the encode answers truthfully about the bytes
that were actually written.

**Why a Web Worker.** Four variants for ten 12-megapixel photos is several
seconds of solid CPU, which on the main thread is several seconds of frozen
form. `imageWorker.ts` does the work; `imageProcessing.ts` spawns it and
falls back to the main thread when `Worker`/`OffscreenCanvas` are missing.
`imageRender.ts` holds the shared canvas code, split out precisely so the
worker and the fallback have no import cycle. `releaseImage()` in a `finally`
is not optional: ten un-closed `ImageBitmap`s at 12 MP is roughly 360 MB.
A package that does this for you was evaluated and rejected - see the note at
the end of this section.

**The variants are generated exactly once, when the file is added.** Not at
save. `addFiles` runs the pipeline and keeps the result on the entry
(`PhotoEntry.processed`); the pages hand `photos.pendingImages` straight to
`imageService`. Regenerating at save was doing every decode and resize twice
per photo for nothing. Each pending entry also carries a transient
`ArtworkPhoto` built from its variants (`PhotoEntry.preview`), so a photo that
is not uploaded yet renders, and opens in the preview modal, through the same
`photoUrl` ladder as one that is - which is also why the form tile shows the
WebP rather than the `.jpg` that was picked from disk. Object URLs for those
blobs are registered in the hook's `previewUrls` ref: `revokeEntry()` releases
the file's URL _and_ every variant's, and a `File` alone is not the only thing
pinning memory.

**`imageSmoothingQuality = "high"` is set on every variant.** Without it the
browser picks, and the default is bilinear - which throws away exactly the
fine detail a painting is made of when a 12-megapixel source is halved for
`medium`.

**The storage path is flat**, one object per file, no per-image folder:

```
artworks/{userId}/{collectionId}/{artworkId}/photos/{artworkId}_{photoId}_{key}.{ext}
```

The `{artworkId}` prefix in the _filename_ is redundant and that is the
point: the name alone identifies both the artwork and the photo, so an object
is self-describing when read in the console, and `storage.rules` can
pattern-match the name to refuse anything that does not fit. The name is
validated against the path's own `artworkId`, so a name minted for one
artwork cannot be written under another - `tests/storage.rules.test.ts`
asserts exactly that.

**Deletion lists and filters; it never reconstructs names.** The extension
is not predictable (the same logical photo is `.webp` on one browser and
`.jpg` on one without a WebP encoder), so `deleteArtworkPhoto` `listAll`s the
`photos/` prefix and matches the `{artworkId}_{photoId}_` prefix. Rebuilding
five filenames would be right in exactly one of the two cases and would
orphan the previous encoding in the other.

**`storage.rules` splits read from write, and that is a bug fix, not a
style choice.** The previous rule combined them into one `allow read, write`
whose condition dereferenced `request.resource.size`. `request.resource` is
`null` on a read _and_ on a delete, so `null.size` is an evaluation error and
the whole request is denied: the owner could upload a photo and then never
read it back, and every rendered image would break. `acceptableUpload()`
admits the `null` case explicitly. Never fold a read and a write back into one
condition.

**Storage reads mirror the Firestore visitor rule** - `isPublic == true` and
`deletedAt == null` - so a photo is never more readable than the artwork it
belongs to. This costs a `firestore.get()` per request, which is the same
trade the Firestore rules already make.

**Photos live outside `useForm`.** A `File` cannot survive
`mode: "uncontrolled"`: it is not serialisable, it is not a Zod value, and
the inputs are remounted on every `initialize`, which would drop any
component holding one. `useArtworkPhotos` owns the list; the page merges it
into the payload at submit.

- **Add** is two writes by necessity: the document must exist before Storage
  has an id to put objects under, and the id is not knowable until the
  document exists. `createArtwork` with `photos: []`, then upload, then
  `updateArtwork(id, { photos })`. A failure between the two leaves a valid
  artwork with no photos that the Edit form can fix; the reverse order would
  leave orphaned objects nothing can reach.
- **Edit** uploads and sweeps Storage **before** the Firestore write. The
  document is the record of what exists, so it must only be updated once the
  objects it will point at are there. A photo removed from the document but
  left in Storage is invisible and never cleaned up; an object deleted a
  moment too early is at worst re-uploadable.
- `toNewArtwork` now takes a `photos` parameter instead of hardcoding `[]`
  after the payload spread. The CSV import path passes nothing and keeps
  writing `photos: []` - it is not wired to uploads.
- On save, `photos` is written **only when the id order differs from what was
  loaded** (`commit()` returns `null` otherwise). `updateDoc` merges, so an
  absent key leaves the stored array alone rather than rewriting fifty storage
  URLs on a save that only touched the title.
- The Edit save builds the list with `mergeUploaded(uploaded)`, which **walks
  the working list** rather than concatenating. `uploaded.push(...stored)` puts
  every newly added photo at the front, so a photo the user dragged into third
  place is stored first and becomes the primary thumbnail - the one thing the
  form exists to let someone change, lost on save. `uploaded` is in
  `pendingImages` order, which is entry order, so the two line up position for
  position. `tests/photoUploader.test.tsx` covers the middle-of-the-list case
  specifically: promoting to the front happens to agree with "uploads first",
  so a test written only for that would pass against the bug.
- A failed upload leaves the objects that did upload in place, deliberately:
  they are addressed by photo id, so a retry overwrites the same names, and a
  half-finished upload costs bytes rather than correctness.
- `@dnd-kit` supplies the drag-and-drop. The whole tile is the drag handle
  (the only one that works on touch) with a `distance: 4` activation
  constraint, and a `KeyboardSensor` so the list is reorderable without a
  mouse. The overlay buttons `stopPropagation` on pointerdown, or a click
  would be swallowed by the handle's pointer capture.
- Object URLs are revoked on removal **and** on unmount. The pending list
  holds a `Set` in a ref for exactly that cleanup. `revokeEntry()` must release
  the picked file's URL _and_ every variant's: a pending entry owns several,
  and revoking one leaves the rest pinned.
- A file that cannot be decoded is **removed from the grid** and pushed onto
  `AddPhotosResult.rejected`, not left sitting there looking fine. It cannot be
  uploaded, and the alternative is a save that fails and reports itself as a
  failed save rather than a bad file. Nothing consumes that result today
  (`PhotoUploader` does `void photos.addFiles(files)`).
- The preview modal shows the `large` variant, not the original - pulling a
  12-megapixel source to fill a screen is slower and heavier for no visible
  gain. `photoUrl()` falls back through `large` to `original`, which is what
  makes a document written by an older build, or a photo whose variant failed
  to generate, still render something. It also works for a photo that has not
  been uploaded yet, via the transient `PhotoEntry.preview`.
- **`image-resize-compress` (npm) was evaluated and rejected**, so the next
  person does not re-derive it. It is a good library and its `fit: 'cover'`
  crop arithmetic is character-for-character our `coverCrop`. Three blockers:
  one blob in and one blob out, so four variants means four `createImageBitmap`
  decodes per photo where we do one (and `runPipeline` is not exported, so
  there is no way around it); it returns a `Blob` and never the source
  dimensions `ArtworkPhoto.width`/`height` record, so measuring separately
  would be a fifth decode; and its worker is a `blob:` URL needing
  `worker-src blob:`, which this app has no CSP for and which its own docs say
  falls back to the main thread **silently** - the same invisible-downgrade
  class of bug described above. Worth stealing, and now taken: it checks
  `blob.type !== mime` and throws rather than trusting the request.

### Gotchas

- Never re-run `initializeApp`; import `db`/`auth`/`storage` from
  `src/services/firebase.ts`.
- Config comes from `VITE_FIREBASE_*` env vars — never hardcode or copy
  real values.
- `storage` is used for `Artwork.photos`; `certificates` are still unwired
  (`[]`). See **Artwork photos** below.
- Firestore rules exist now and are enforced. Pre-rule client reads are
  gone; list rules are per-document field checks and **rules are not
  filters**, so **every client list query must carry the matching
  `where(...)` filter the rules check** (`where userId` for owner queries,
  `where isPublic == true` for visitor queries, plus
  `where deletedAt == null` for both artwork lists). A list that would span a
  document the caller may not read is denied outright, not silently
  trimmed.
- Reading an **absent** field in a rules expression is an evaluation error
  that denies the request — `resource.data.deletedAt == null` is not the same
  as `resource.data.get("deletedAt", null) == null`, and the first one breaks
  on legacy documents written before the field existed. Always use
  `map.get(key, default)`.
- The two new artwork composites (`(collectionId, userId, deletedAt)` and
  `(collectionId, isPublic, deletedAt)`) must be deployed with
  `bun run deploy:rules` before the three-clause artwork queries work in
  production. They are not built locally.
- `createdAt`/`updatedAt` are server-stamped by the service layer and the
  rules verify `== request.time`; never write them from a component.
- Creating an artwork requires owning the parent collection — the rules
  `get()` that document during the create write.
- `PublicCollectionPage` maps Firestore `permission-denied` to the
  "This collection is private." state via `isPermissionDenied` in
  `src/utils/firestoreErrors.ts`.
- `AGENTS.md` lists `AuthContext.ts`; the real file is `.tsx`.
- Rules suite: `bun run test:rules` needs a Java runtime for the
  emulators; firebase-tools offers to download one if missing. The suite
  uses a throwaway `demo-custodia` project and never touches real data.
- **A denied request in a test is expected output, not a failure**, and the
  rules suites silence it on purpose. `test:rules` is the gate in front of
  `deploy:rules`, so a _successful_ deploy used to print a dozen red
  `PERMISSION_DENIED` blocks with stack traces — which is how people learn to
  ignore stderr, exactly where the one run that mattered would land. Two
  separate sources, so two fixes: the Firestore SDK's own logger via
  `setLogLevel("silent")`, and the service layer's `console.error` via
  `vi.spyOn(console, "error")`. `firebase/storage` exports **no**
  `setLogLevel` — checked, not assumed — so the storage suite relies on the
  spy alone. Put a new negative test inside the existing `beforeAll` rather
  than letting it leak. Where a test genuinely asserts on the logging (the
  ArtworksTable delete-failure case), assert on the spy instead: same run,
  strictly more coverage.
- **`test:rules` runs vitest with `--no-file-parallelism`, and that flag is
  load-bearing.** The two rules suites each build their own
  `RulesTestEnvironment` against the _same_ emulators, and several of those
  settings are global rather than per-context:
  `withSecurityRulesDisabled` turns rules off for the whole emulator, and
  `clearFirestore`/`clearStorage` wipe data another file's test is about to
  read. Run in parallel, the two files silently corrupt each other - the
  storage suite's negative assertions start passing because the Firestore
  suite happened to have rules disabled at that moment, and its positive ones
  fail for reasons that have nothing to do with the rules. Do not "speed this
  up" by dropping the flag.
- The emulator does not build the composite indexes from
  `firestore.indexes.json`; the list tests deliberately use single-field
  queries. Composite-query validation happens at deploy time.
- Two emulator behaviours diverge from production, both measured and both
  documented at the top of `tests/firestore.rules.test.ts`: `where(field,
"==", null)` does **not** match an absent field there, and the emulator
  does not enforce the soft-delete clause per-document on a list (an
  anonymous `where isPublic == true` returns a soft-deleted work, where
  production denies the whole query). So the rules suite does not replay the
  app's exact three-clause query — read that header before adding a list test.
- Component tests run per file with a `// @vitest-environment jsdom`
  docblock, and `vitest.config.ts` deliberately does **not** set `globals`, so
  Testing Library's automatic cleanup never registers. Every component test
  file needs an explicit `afterEach(cleanup)`, or each render stays in the
  document and the next test's queries match the previous test's rows and
  dialogs. DOM matchers come from `import "@testing-library/jest-dom/vitest"`.
- In jsdom, a `matchMedia` stub that answers `matches: false` for everything
  makes every `mantine-datatable` column vanish, leaving only the selection
  column. The datatable resolves a column's `visibleMediaQuery` through
  Mantine's `useMediaQuery`, which for a column without one calls
  `window.matchMedia("")` in an effect and overwrites its optimistic `true`
  with the stub's answer; Chrome answers an empty query with `true` (verified
  in Chrome). Stub `matches: query === ""`.
- `useModals()` throws without `ModalsProvider`, so any component under test
  that (transitively) renders a `modals.openConfirmModal` call needs
  `MantineProvider` + `ModalsProvider` + `MemoryRouter` wrapped around it.
- `@mantine/modals` ships **no** stylesheet in v9 — Modal and Overlay styles
  come from `@mantine/core/styles.css`. `@mantine/notifications` does ship
  one, and `<Notifications />` must be mounted (it is, in `src/main.tsx`)
  for `notifications.show` to render.

### Validation

- `bun run build` (runs `tsc && vite build`) for typecheck.
- `bun run check` (tsc + eslint + prettier) must pass before and after a
  rules change.
- `bun run test:rules` for the security rules suites against the emulators.
  It starts Firestore, Auth **and Storage**, then runs **all** tests,
  including the pure-logic and component ones (`npx vitest run tests/<file>`
  runs a single file with no emulators, which is the fast loop for UI work).
- `bun run build` also proves the Web Worker bundles: the image worker must
  appear in `dist/assets/` as its own chunk. A silently-dropped worker would
  leave the app running on the main-thread fallback with no other signal.
- Confirm no second `initializeApp` and that new code imports `db`/`auth`
  from the shared module.
