# Custodia Agent Guide

This is a React + TypeScript + Vite project using Firebase for authentication and Firestore for data storage.

## Key Commands

- `bun run dev` - Start development server (port 3000)
- `bun run build` - Build for production
- `bun run preview` - Preview production build
- `bun run check` - Typecheck, lint, and check formatting
- `bun run test:rules` - Run the Firestore + Storage rules suites against the emulators (needs Java)
- `bun run emulators` - Start the full emulator suite with web UI (port 4000)
- `bun run deploy:rules` - Test rules, then deploy `firebase deploy --only firestore,storage`. **Required for the `xlarge` photo variant** — its key must be in `storage.rules`, or every new photo upload 403s on that object
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
- `src/skins/types.ts` - The skin contract (`SkinDefinition`, `SkinProps`, `SkinOptionSpec`)
- `src/skins/registry.ts` - `SKINS`, `resolveSkin`, `resolveSkinOptions`
- `src/skins/basicx/` - The first skin. See "Public collection views" below
- `src/components/collection/SkinHost.tsx` - Resolves the skin and applies the scoped theme
- `src/components/collection/usePublicCollection.ts` - The public data layer and its state union
- `src/components/collection/PublicCollectionPage.tsx` / `PublicArtworkPage.tsx` - The two route shells
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

## What to test

The non-emulator suite is 313 tests in about 2.2 seconds, so volume is
not the problem. **Altitude** is: every test is something a reader has to
keep true as the libraries underneath it move, and something to reason
about when it goes red. The question to ask before writing one is
therefore not "is this worth covering?" but:

> **Would this fail if Mantine changed, or only if we changed?**

A test that answers _Mantine_ is asserting the library's behaviour. It
costs a reader and buys nothing — Mantine tests itself, and when ours
goes red we have learned nothing that was not visible in the diff.

Three tiers, and the first is where nearly everything belongs:

1. **Pure logic over our own data.** Test directly, no DOM: `variantSize`,
   `coverCrop`, `parseAcquisitionDate`, `sortPhotos`, `reindexPhotos`,
   `publicCollectionState`, `resolveSkinOptions`, `entryPrefix`. Ours end
   to end, and where a real regression lives.
2. **Our value going into the library — only when the failure is invisible
   in review or in a screenshot.** `tests/skinHost.test.tsx` reads the
   emitted style tags to prove `cssVariablesSelector` is not `:root`,
   because a skin's type scale leaking onto `/manage` appears in no
   screenshot anyone takes. The Basicx chrome tests read computed
   `pointer-events`, because jsdom does no hit testing and the bug was a
   link that looked live and went nowhere. The `?warn` strip is the same:
   leaving the param in place looks harmless and silently re-raises an
   alarm on every refresh.
3. **Everything else — don't.** Copy that a `Text` renders, props handed
   to Mantine, a mock's call count with no behavioural meaning, a constant
   asserted against its own value.

**Mutation testing is the acceptance bar for anything new.** Change the
line the test claims to cover; if it stays green, the test was not
covering that. A test that fails its own mutation earns its place. One
that needs three separate mutations to kill is usually two tests.

**What this has removed**, so the bar is legible rather than theoretical —
each of these could only fail by editing the thing it read:

- A constant against its own value. `MAX_ARTWORK_PHOTOS` was asserted to
  be `10`. The caps are a product choice and `storage.rules` counts
  nothing, so there was nothing to cross-check them against. Compare
  `PROBE_SIZE > 1`, which looks identical and **stayed**: that is a
  correctness floor rather than an arbitrary value, and getting it wrong
  is a _silent_ Safari downgrade.
- A set against itself. Looping `Object.keys(ACCEPTED_IMAGE_TYPES)`
  through `isAcceptedImageType`, which is `type in ACCEPTED_IMAGE_TYPES`.
- A duplicate, checked at the stronger one first. The nav's absent login
  link was asserted in two files; the unknown-skin fallback in two, where
  `skinRegistry.test.ts` tests it at the function.
- Copy. Rendering an empty component and checking a string we wrote
  appeared.
- A title claiming more than its assertion. Six were renamed in one pass,
  and three of the claims turned out to be **untestable at this
  altitude**: `documentImageSpecs()` is a `filter()` over
  `IMAGE_VARIANTS`, so there is no restatement to detect; `createTheme`
  deep-merges, so an overridden `md` is indistinguishable from a default
  unless you compare against Mantine's own values. In those cases the
  title shrank and the reasoning stayed in the comment — or, where it
  belonged next to the keys, in the source.

**What has not moved**, because the rule cuts one way and it is easy to
overshoot it in a tidy-up:

- **Both rules suites — all 88 tests.** `storage.rules` and
  `firestore.rules` are ours, and the failures they guard are the ones
  with teeth: a variant key missing from `isPhotoName` 403s every new
  photo upload, and a `read, write` block that dereferences
  `request.resource.size` denies reads too, because that field is `null`
  on both a read and a delete. Tier 1 in the strictest sense — the thing
  under test is this repository.
- The pure-logic half, essentially in full.
- Every tier-2 DOM test.
- Correct-altitude cases that happen to be near neighbours of deleted
  ones — `publicCollectionPage`'s empty collection, whose null
  `navigation` assertion is what proves the empty state renders outside
  the skin.

Test **mechanics** — `afterEach(cleanup)`, the `matches: query === ""`
stub, `ModalsProvider`, `--no-file-parallelism` — are in **Gotchas**
below and are not restated here. `vitest.config.ts` sets
`dangerouslyIgnoreUnhandledErrors: false`: an unhandled rejection inside
a test should fail the run, not be filtered out of it.

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
- Types: `src/types/index.ts` (User, Collection, Artwork, ArtworkPhoto, ArtworkDocument)
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
  index, and a Cloud Function that purges long-dead works. (The public
  single-artwork route _was_ on this list and is now built — see "Public
  collection views" below.)

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

### Artwork forms (Add and Edit)

Both forms are a `<Grid>` of 14+ fields ending in `currentValue`, which is below
the fold on a laptop. `FormActionsBar` is the fixed Save/Cancel bar both render,
inside the `<form>` so Save is still a real submit control.

**Why not `AppShell.Footer`.** `ManageLayout` is shared by every `/manage` route,
so a footer there would put Save and Cancel on the collection page, the settings
page and the import too. A bar the two forms choose to render is one line each
and cannot appear where it has no meaning.

**`BAR_HEIGHT` is exported and used twice**, as the bar's own height and as the
form's `paddingBottom` (`BAR_HEIGHT + 24`). A fixed bar occupies no space in the
flow, so without the padding it would sit permanently on top of the last field
_and_ the error alerts — the content most needed after a failure. Two numbers that
must agree are one constant. The alerts stay in the form flow rather than moving
into the bar: they are content, they can be three lines tall, and the padding is
what keeps the last one clear of the bar.

**Add redirects on every outcome; Edit does not redirect at all.** Add is a
three-write sequence (create, upload photos, upload documents), and past the
first write the document exists — so holding the form open and saying "open it to
try again" pointed at a page the user was not on. Instead:

| outcome                  | Add does                                      | Edit shows                            |
| ------------------------ | --------------------------------------------- | ------------------------------------- |
| all writes succeeded     | toast, redirect                               | —                                     |
| photos failed            | yellow toast, redirect with `?warn=photos`    | "its images could not be uploaded"    |
| documents failed         | yellow toast, redirect with `?warn=documents` | "its documents could not be uploaded" |
| the create itself failed | stays on the form, red alert                  | —                                     |

Only the first branch stays put, and it is the only one where nothing was
written and the form still holds everything the user typed.

**The toast is raised before `navigate`**, on both pages. A notification raised
on a page that immediately unmounts is never seen.

**`?warn` is a query param, not state, and it is captured once on mount.** The
message has to survive a refresh or a pasted URL — the user who is told "its
images could not be uploaded" needs that warning to still be there when they come
back — so state is wrong. But it is _read_ once: `useState(() => WARNINGS[warn])`
rather than deriving from `searchParams` each render. Deriving it looks equivalent
and is not: the effect below strips the param on mount, so a derived value blanks
the message the instant it appears, and it flashes and vanishes unread. Both
halves are mutation-tested in `tests/artworkWarnParam.test.tsx`.

**The param is stripped once shown, with `replace`.** `warn` says an upload
failed and the fix is on the very page it points at, so leaving it in place would
re-raise the warning on every refresh, long after the photos were uploaded — a
stale alarm that teaches the reader to ignore the one message that matters.
`replace` so it does not also spend a history entry: Back from a fixed page
returns to wherever the user came from.

**The value is read through a table lookup, not an `if`.** An unrecognised
`?warn=anything` must render nothing at all rather than reach a visitor as an
alert about their uploads, and `WARNINGS[warn ?? ""]` is that by construction.

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
- **`RECORDS_PER_PAGE_OPTIONS` is `[25, 50]` and the state initialises from
  index 0**, so the default and the offered options cannot drift: a reordering
  would silently change the page size every collection opens at. 10 is
  deliberately absent — a 10-row page reads as empty beside a 50-row one. The
  same array and the same coupling are in `ReviewRowsStep` for the import
  review step.
- **The row's View link is a plain `href` with `target="_blank"`, not a router
  `Link`**, and the header View on `CollectionPage` is too. It leaves the app, so
  the new tab gets a full document load and cannot be left as a half-working
  public page under the manage session's history. `rel="noopener noreferrer"` is
  not optional: without `noopener` the opened page gets a handle on this window
  via `window.opener` (see the same argument in `DocumentsUploader`).
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

### Public collection views ("skins")

A collection's public view is rendered by a **skin**: a component tree that
owns the layout, type and interaction, and nothing else. Two routes render one,
both unwrapped by `ProtectedRoute` and `ManageLayout`:

- `/collection/:collectionId` — the collection homepage
- `/collection/:collectionId/artwork/:artworkId` — one artwork

`src/skins/` holds the contract (`types.ts`), the registry (`registry.ts`) and
one folder per skin. `SkinHost` is the whole of the boundary in the running app;
the shell loads the data and decides what is visible, and everything past
`SkinHost` is presentation the skin owns.

**A skin is a component, not a config.** A skin is `{ id, label, options,
theme, Home, Artwork }` — two React components and an optional nested theme.
The alternative, one generic engine driven by JSON, would need a vocabulary for
overlays, cursor zones and nested scroll behaviour, and that vocabulary would end
up being most of the code while still being less expressive than React. What
_is_ data-driven is the narrow part that varies per collection: options, which
each skin declares for itself.

**`Home` and `Artwork` are usually the same component.** They differ only in how
many sections the shell hands over (every public work, versus a one-element
array), which is what makes "the artwork view may show more" a property of the
skin rather than a second code path to keep in step. A skin may still branch on
`view` — that is what the field is for.

**Options belong to the skin, not to the app.** A global option list would have
to be honoured by every skin, so it could only grow to the _intersection_ of
what skins can express — and an option a skin ignores is worse than one it does
not offer, because the settings form would advertise a control that does
nothing. `resolveSkinOptions` is a flat per-key default: unknown keys are
dropped and reported (`dropped`, surfaced in the settings page), a wrong type
falls back to the default, and a number outside its bounds is _clamped_ rather
than defaulted. The settings form is generated from the specs, so a skin with
different options needs no settings-page code.

**A skin must not use a portaled Mantine component.** `Modal`, `Drawer`,
`Menu`, `Popover`, `Select`, `Combobox`, `Tooltip` and `Notifications` all
render into `document.body`, outside the skin's scope, and would silently pick
up the app theme. See the scoping note below.

#### The scoping mechanism (verified, and load-bearing)

`MantineProvider`'s `cssVariablesSelector` **defaults to `:root`** (checked in
`@mantine/core@9`). So a nested provider with a different theme overwrites the
_whole app's_ `--mantine-*` variables for as long as it is mounted — a skin's
type scale would apply to `/manage` too. `SkinHost` therefore points the
selector at `.skin-scope` on a wrapper element, which emits the variables onto
that subtree instead. `tests/skinHost.test.tsx` asserts this by reading the
emitted style tags, and fails if the selector is ever set to `:root`.

One limit worth stating: `@mantine/carousel/styles.css` uses hashed _global_
classes and is imported in `main.tsx`, so the carousel's base CSS is global for
the whole app. Nothing in `/manage` uses a `Carousel`, so there is no clash
today — but "cannot clash" is a property of the theme, not of that stylesheet.

#### `Collection.skin` needs no migration (deliberate)

`skin` and `skinOptions` are optional, read off a document already fetched by
id, and defaulted at read time. **Nothing ever queries on `skin`**, so this is
the deliberate contrast with `deletedAt` (see **Soft delete**): the migration
doctrine bites when a `where(...)` filter stops matching documents that lack the
field, and there is no such filter here. A collection written before this field
existed renders the default skin. Adding a backfill would be cargo cult.

#### Basicx

A full-bleed slideshow: one `100dvh` section per artwork, each containing that
work's photos, with a fixed nav and a fixed footer pinned over the whole
scroll. The design was built to a written spec (type scale, padding, control
styling and image sizing, all recorded in `src/skins/basicx/theme.ts` and
`BasicxChrome.tsx`), and the numbers are deliberately explicit constants rather
than inherited defaults, so a future revision of the look is a diff against
those constants instead of an archaeology exercise.

The type scale is two named sizes on the theme — `bodycopy` (1.05rem / 550 /
1.2) and `caption` (0.8rem / 450 / 1.2) — at weights the font actually has.
Font is Darker Grotesque for body _and_ headings; the latter is set explicitly
because a nested theme deep-merges and would otherwise inherit `BBH Bartle`,
which ships a single 400 weight and would fake-bold the 550 above.

**`Carousel` is used, not a hand-rolled slideshow**, and the sizing works out
because `Carousel.Slide` is `flex: 0 0 var(--carousel-slide-size, 100%)` — a
plain block with no `align-items`. So an `Image` sized `w="auto" h="auto"
maw="100%" mah="100dvh"` keeps its aspect ratio, shrinks to fit both caps and
sits top-left by ordinary block layout, with no `object-fit` and no alignment
override. embla also supplies drag, `loop` and per-instance arrow keys for free.

**The stage is its own scroller** (`overflow-y: auto`), _not_ the document —
`scroll-snap-type` on `html` would apply to `/manage` too. So the document never
scrolls, no global CSS is needed, and the observer `root` is the stage.

Four things in Basicx that look like choices but are not:

- **embla's `duration` counts frames, not milliseconds.** Its `ScrollBody` does
  `scrollVelocity += displacement / scrollDuration` once per frame, so the
  default of 25 is ~0.4s at 60fps. `transitionSeconds` converts with
  `seconds * 60`; passing `500` for half a second would give an eight-second
  slide. `0` is special-cased by embla into an instant jump, which is what both
  `transitionSeconds: 0` and `prefers-reduced-motion` use.
- **The slide _slides_; there is no crossfade.** `embla-carousel` as installed
  ships no plugins (its only export is `EmblaCarousel` plus types), so
  `Carousel`'s `plugins` prop cannot be given embla's `Fade`. Reproducing a
  crossfade means dropping `Carousel` and hand-rolling on core `Transition`,
  losing drag, loop and the arrow keys for one effect.
- **The cursor zones are real `<button>`s** (`UnstyledButton` with an
  `aria-label`), not `aria-hidden` divs with the carousel's own `Control`s
  behind them. On desktop those controls are switched off, so hidden zones
  would be the only way through and unreachable by keyboard or screen reader.
  They cover the image, which also blocks dragging and selection on it — the
  custom chevron cursor is what tells the visitor the image is clickable. On a
  phone the zones are not rendered at all and the round `Control` buttons take
  over, because a half-screen tap zone on a touchscreen is a coin flip.
- **The footer is `position: fixed`.** With one section a footer at the end of
  the content looks pinned anyway; with N sections a non-fixed footer would
  scroll away after the first artwork, which is why it is explicit here rather
  than inherited.

**The footer is the artwork in view, on two lines**: the title bold on top and
the artist beneath it, dimmer because it is the quieter of the two. The title
links to that artwork's own public view, which is what makes the homepage a way
_into_ its works rather than only past them — and it needed no layering change,
because the footer is a separate fixed bar at `z-index: 2` and the click zones
sit at `1`. It is a link on `home` only: on the artwork view that path _is_ the
current URL, so a link there is a control that navigates nowhere, and the plain
`Text` branch is the same line with the same styling.

**Both bars are `pointer-events: none`, and every link inside one must set
`pointerEvents: "auto"` on itself.** The property is inherited, so the bar's
`none` reaches any link that does not override it — and the resulting bug is
invisible: the element is still a real `<a>` with the right `href`, still
focusable, and Mantine's `Anchor` sets `cursor: pointer` unconditionally, so it
looks live. The click instead falls through to the section's click zones and
_steps the carousel_, or hits nothing at all on a single-photo artwork. The
footer title shipped this way and was unclickable until
`tests/basicxSkin.test.tsx` asserted it. The test checks every link in the
chrome on both views (jsdom does no hit testing, so computed `pointer-events` is
the only signal), and a second case pins the bars at `none` — because the
obvious wrong fix is to delete the `none` from the bar, which restores the link
and silently breaks every click zone.

The chrome takes an `artwork: { title, artistName, path } | null` view model
rather than an `Artwork` or a pre-joined label string, so it renders three
fields and never learns how a URL is built — `BasicxSkin` assembles it from the
active artwork and the shell's `artworkPath`. The `+`-joined
`"${title} + ${artistName}"` label it replaced was a stand-in for the line split
that now exists.

**The nav's right-hand slot holds a "Powered by Arcula" link to
`https://arcula.art`, in a new tab.** It is not attribution for its own sake: it
occupies the slot the owner link will replace. The intended behaviour is in a
`TODO` in `BasicxChrome` — signed in _and_ owning the collection, show a link to
the manage side (the collection page on `home`, the artwork's edit page on
`artwork`); anyone else, the attribution. Not built, because it needs `useAuth`
plus manage-side paths on `SkinProps`, and a second pair of paths in the contract
is not a trade worth making before anything needs it. The slot was left
occupied rather than hidden so the eventual change is a swap rather than a new
element, and so the homepage nav never renders an empty right-hand column.

`showPoweredBy` was **removed** for the same reason: what belongs in that slot is
decided by _who is looking_, not by an owner preference, so an option for it
would be a control that does nothing. Removing it left Basicx with
`transitionSeconds` as its only option. (A collection that stored
`showPoweredBy: true` is unaffected — it is simply reported as a dropped key by
`resolveSkinOptions`, and the settings page says so.)

**The chevron cursor is a drawn data URI, not a font glyph.** It is built once
in `BasicxSection.tsx` to match the `Control` buttons it sits alongside
(`rgba(255,255,255,.9)`, `stroke-width 1.5`) with `w-resize`/`e-resize` as the
fallback for a browser that rejects an SVG cursor. The hotspot is `12 12` — the
tip of the chevron, not the top-left of its 24x24 box — so the pointer lands
where the visitor is aiming.

`useActiveSection` mounts a section's carousel only once it has been within a
viewport of the stage, because a fifty-artwork collection would otherwise create
fifty embla instances and five hundred `<img>` elements up front. `nearIds` only
ever grows: unmounting on scroll-away would hand the visitor back the first
photo every time they scrolled back to a work they had already been through. It
takes `ids` as an argument rather than reading them from a ref so the
no-`IntersectionObserver` fallback works at _render_ time — jsdom reports every
section as mounted, which is also what a browser without the API should do.

**`useCarousel` does not exist in `@mantine/carousel` v9.** The index exports
only `Carousel`, `useCarouselContext` and `CarouselSlide`; you capture the API
with the `getEmblaApi` callback prop and hold it in a ref. (`vertical` was
renamed `orientation` in the same version.) Planning from v7 docs gets both
wrong.

#### The public state is one union, and half of it is pure

Both public pages replace a set of overlapping booleans with
`PublicState<T>` (`usePublicCollection.ts`): `invalid | loading | error |
private | notFound | ready`. A union is only worth having if the decisions can
be tested, and a hook that both fetches and decides can only be tested against
Firestore — so the _decisions_ are pure functions over already-fetched values
(`publicCollectionState`, `publicArtworkState`, `publicFailure`) and the hooks
are thin wrappers.

- `private` is not "an error". It is the rules denying on purpose, and telling a
  visitor a public page "failed" invites a retry that cannot succeed. It covers
  both a denied read _and_ a readable-but-unpublished collection — which is also
  where an owner previewing their own private collection lands, so they are told
  the truth rather than "not available" for a document that plainly exists.
- The collection is read **first** and the artworks requested only once it is
  known to be published. Not latency: a private collection's name and
  description must never reach an unauthenticated client, and the rules deny
  that read before the second round trip is ever issued.
- On the artwork view, a _denied_ artwork read becomes `notFound` (a refused
  artwork may be private, soft-deleted, or absent, and saying which is a
  disclosure) but a _transport_ failure is re-thrown and reported as an error —
  reporting "this artwork does not exist" for a dropped connection costs the
  visitor a retry that would have worked.
- `publicArtworkState` compares `artwork.collectionId` to the requested one. Not
  redundant with the rules: `firestore.rules` admits a public, un-deleted
  artwork by id _whatever collection it is in_ (deliberate, so an owner can keep
  one work public inside a private collection), so nothing server-side stops a
  work rendering on the wrong URL.
- The non-ready states render **outside the skin** in the app theme
  (`PublicStateMessage`). They are the absence of a presentation, and a visitor
  who hit "This collection is private." has not reached anything a skin should
  be styling. The empty case is here too: a skin with an empty stage and a title
  in the nav reads as a loading failure.

The artwork view fetches **only the single work**, not the collection's list.
That saves a round trip and skips the `(collectionId, isPublic, deletedAt)`
composite index entirely, and nothing on that view needs a neighbour — there is
no previous/next, because the artwork view offers a link back to the collection
and nothing else. A skin wanting neighbours would need the list there, which is a
deliberate cost, not an oversight.

**The rules needed no work for the artwork view.** `firestore.rules` already
admits a visitor `get` on a public, un-deleted artwork, and
`artworkService.getArtwork` already existed unused. The route, the page and the
`ArtworksTable` View link were the whole change. (The View button was `disabled`
with a comment saying the page did not exist; that comment is gone, and
`tests/artworksTable.test.tsx` now asserts the href rather than that the button
is enabled — the link is the only thing in that table that leaves the app, so a
wrong path would be silent.)

### Artwork photos (uploads, variants, ordering)

`Artwork.photos` is an `ArtworkPhoto[]`, and `Artwork.documents` is an
`ArtworkDocument[]` - two shapes, not one. The split is deliberate: a photo
needs its generated sizes **and** its position in the sequence, so it carries
`order`; a document has neither, and giving it an `order` would be a field
nobody can maintain honestly. See **Artwork documents** below.

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
| `xlarge`    | max side 2400, `inside` | the fullscreen slideshow                   |
| `square_lg` | 800x800, `cover`        | thumbnail fills the box, never letterboxed |
| `square_sm` | 400x400, `cover`        | ditto, for dense grids                     |
| `large`     | max side 1200, `inside` | no crop, no upscale                        |
| `medium`    | max side 800, `inside`  | no crop, no upscale                        |

**`xlarge` is the newest key and the only one with a rules consequence.** It
exists because `large`'s 1200px cap is smaller than a 1440px display and visibly
soft on a detail-heavy painting. Two things about it:

- The key list in `storage.rules` (`isPhotoName` _and_ `isDocumentName`) must
  include it, or **every new photo upload 403s** on that object.
  `tests/imageVariants.test.ts` reads the rules off disk and asserts the
  alternation equals `VARIANT_KEYS`, so a forgotten edit fails CI instead of
  production — the same client↔rules gap that once let a `.bin` PDF name
  through. `tests/storage.rules.test.ts` also asserts the emulator admits it.
- **Photos uploaded before it existed are not backfilled.** `photoSrcSet`
  offers only the variants a photo actually has, so a legacy photo offers
  `large` + the original and the browser picks. A backfill would be a
  client-side download/re-encode/upload across every artwork — Storage egress
  for a fidelity gain the browser already covers.

It is also the one key `DOCUMENT_IMAGE_VARIANT_KEYS` excludes: `isDocumentName`
permits the full list, so the subset needs no matching rule change.

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
read it back, and every rendered image would break. `acceptablePhotoUpload()`
and `acceptableDocumentUpload()` each admit the `null` case explicitly. Never
fold a read and a write back into one condition.

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

### Artwork documents ("Other Documents")

`Artwork.documents` is the former `certificates`, renamed when uploads landed.
`FileReference` is deleted rather than deprecated - it had exactly one consumer
and carried the codebase's only `any` (`metadata?: any`). **No migration
exists and none is needed**: the field was written as `[]` by every code path
and uploads were never wired, so every stored value is provably empty. Readers
still go through `sortDocuments(artwork.documents)`, which treats an absent
field as `[]`, because artworks written before the rename have no `documents`
key at all and a reader should not have to know that.

**`ArtworkDocument` is a union on `kind`**, not one shape with optionals:
`{kind: "file", ...}` carries no variants, `kind: "image"` carries `variants`
plus source dimensions. A union mirrors the `PhotoEntry` precedent and means
"does this have a thumbnail" is decided once, at the type, rather than
re-checked with `&&` at every call site.

**Documents have no `order`, and that is not an oversight.** There is no
sequence and no primary thumbnail, so there is nothing for an index to mean -
which is exactly the invariant `artworkPhotos.ts` spends its `reindexPhotos` /
`sortPhotos` pair maintaining. A shared generic hook with a config object was
rejected: the config would have been most of the code, and the parts it
switched on are the parts a reader needs to see side by side. So
`useArtworkDocuments` is a separate hook, and the object-URL lifecycle (~20
lines) is the one thing deliberately duplicated - it is the part that leaks if
it is wrong.

**The storage path mirrors photos exactly**, one object per generated file:

```
artworks/{userId}/{collectionId}/{artworkId}/documents/{artworkId}_{docId}_{key}.{ext}
```

`key` is `original` always, plus variant keys for images, so one filename
regex and one delete sweep serve both features. The shared machinery - prefix
building, `objectName`, `newEntryId`, `uploadAll` and the list-and-filter
`deleteEntries` - was lifted out of `imageService` into
`src/services/artworkFiles.ts` rather than copied into a document service;
two `uploadAll`s to keep in step is two chances to drift.

**The filename is metadata only, never in the object path.** This field cares
about the original filename, but "cares about" means preserved and displayed,
not interpolated into a path. User-controlled path segments bring traversal,
length limits, and collisions (two files both called `scan.pdf` would overwrite
each other) - and the `{docId}` in the name is what makes an object
self-describing without any of that.

**Images get only `square_sm` and `large`** (`DOCUMENT_IMAGE_VARIANT_KEYS`) -
the two a document actually renders: the list tile and the preview modal.
`square_lg` and `medium` exist for the public collection grid, and a document
is refused to visitors outright, so generating them would write up to two
objects per image that nothing can ever read. It is a _subset_ of the photo
table rather than a second table, so the geometry stays defined once and
`isDocumentName` - which permits the full key list - needs no matching change.

**Never public, and that is enforced rather than merely omitted.**
`storage.rules` gives `documents/` its own block reading `ownedByCaller` only,
for read and write. A future UI that forgot to hide documents would render
broken rather than leak. The rules suite seeds a **public** artwork for every
visitor-denial case on purpose: on a private one the assertion would pass even
if the block were widened to the visitor rule, and would keep passing.

**Two upload functions, not one taking a size.** `acceptablePhotoUpload()` is
10 MiB and `image/.*`; `acceptableDocumentUpload()` is 25 MiB and
`image/.*|application/pdf`. A rules language with no closures makes a parameter
read like configuration, after which nobody can see from the block which ceiling
it is under. The photo block also _loses_ `application/pdf` in the same change,
a drive-by tightening with identical behaviour since `isPhotoName` already
made a `.pdf` name impossible there. `MAX_DOCUMENT_BYTES` in
`src/utils/artworkDocuments.ts` must match the 25 MiB rule exactly; the suite
pins both directions (a 20 MB PDF accepted as a document and rejected as a
photo, 26 MB rejected as a document).

**The extension allowlist in `isDocumentName` is an XSS control.** `pdf` joins
the three image formats, and nothing else does. `contentType` is
client-supplied and forgeable, so the only thing the rules _can_ bind it to is
the name being written - which is what makes the allowlist load-bearing. An
uploaded SVG or HTML file navigated to directly executes in the storage
origin. Neither is accepted by the form and neither is permitted by the rules,
so a hand-rolled client cannot add one either. It is a speed bump, not a
guarantee: the `getDownloadURL` bearer token is long-lived, so a pasted link is
shareable. That is pre-existing from photos, not new here.

**Never widen `isDocumentName` to make a client error go away.** Documents were
the first feature to route a _non-image_ through the image pipeline's naming, and
it cost a 403 on 100% of PDFs: `uploadFile` asked `extensionFor` — which knows
three image types and answers `bin` for anything else — so a perfectly valid
`Get_Started_With_Smallpdf.pdf` went up as `{artworkId}_{docId}_original.bin` and
`isDocumentName` denied it. The fix is on the client, and adding `bin` to the
allowlist would have "fixed" it by deleting the XSS control: `contentType` is
forgeable, so the extension is the only thing binding the declared type to the
name. A `text/html` payload named `.bin` is storable, and that is precisely the
stored-XSS primitive the allowlist exists to block.

`documentExtension(name, type)` in `src/utils/artworkDocuments.ts` is the one
place a document's stored extension is decided: the filename first, and the
reported type only when the name has no extension at all. It returns `null` rather
than guessing, and `uploadFile` throws on `null`. Images are deliberately _not_
resolved there — `uploadImage` names each object from the reported type, so a
`.jpg` which is really a PNG is stored as the PNG it is, and routing that through
a name-based function would lose it.

**The gap that let the `.bin` bug through: nothing compared the name the client
produces with the name the rules accept.** Every rules case hand-wrote its
fixture names with a local `documentName(…, "pdf")` helper (the rules side, written
out to match) and every component test stubbed the service, so 21 rule cases and
27 component cases could all be green while every PDF failed in production. Two
tests now close it, and both are worth keeping:

- `tests/storage.rules.test.ts` "uploads a picked PDF under a name the rules
  accept" drives the **real `documentService`** with a real `File` and asserts
  the object exists. This is the one that fails the way production did, which is
  why `UploadDocumentsOptions` takes an optional `client` — a parameter with a
  `storage` default, the same reason `Migration.run` takes the `Firestore` it
  runs against.
- `tests/artworkDocuments.test.ts` "never derives `bin`, whatever the file" states
  the property rather than the case, over a name × type matrix, so a refactor of
  the function body cannot reintroduce a fallback. Verified red by reintroducing
  the `extensionFor` call: the rules suite failed with the same
  `storage/unauthorized` and the same `.bin` filename as the original report.

Note the empty-type branch is **not** a real case. `file-selector` backfills a
MIME type from the filename's extension before the Dropzone's `onDrop` fires
(measured: a `File` constructed with `type: ""` arrives as `application/pdf`), so
a typeless file only ever reaches the hook when its name has no dot — and the hook
rejects those. `isAcceptedDocumentType("")` is `false` and that is correct.

**Add is three writes, not one merged write**: create, then upload+record
photos, then upload+record documents. Merging the last two would mean a
document failure either reports a save that partly succeeded, or - if swallowed
to avoid that - leaves the photo references unrecorded and the photo objects
orphaned. Separately, `ArtworkAddPage` tracks a `stage` variable rather than
inferring which upload failed from the pending lists: those still hold their
files after a successful upload, so "photos are pending" cannot distinguish
"the photos failed" from "the documents did".

**`documents` is written on save only when it changed** (`commit()` returns
`null` otherwise), and the comparison is a _set_ of ids rather than photos'
ordered one - reordering the UI is not a change worth rewriting every storage
URL for. `mergeUploaded` walks the working list for the same reason photos'
does: concatenating puts every new document at the front.

**Rejections are surfaced, on both paths.** `addFiles` reports an unsupported
type and an undecodable image, and the component _also_ handles Dropzone's
`onReject` - which is the path that actually fires for an oversized file, since
Dropzone checks `maxSize` itself and never calls `onDrop`. Dropping that
handler is how a 30 MB condition report produces a one-frame flicker and a
file that silently does not appear.

### Gotchas

- Never re-run `initializeApp`; import `db`/`auth`/`storage` from
  `src/services/firebase.ts`.
- Config comes from `VITE_FIREBASE_*` env vars — never hardcode or copy
  real values.
- `storage` backs both `Artwork.photos` and `Artwork.documents`, through the
  shared machinery in `src/services/artworkFiles.ts`. See **Artwork photos**
  and **Artwork documents** below.
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
- Before writing a test, read **What to test** above. A green suite is not
  the goal; a test that fails only when we change something is.
- `bun run build` also proves the Web Worker bundles: the image worker must
  appear in `dist/assets/` as its own chunk. A silently-dropped worker would
  leave the app running on the main-thread fallback with no other signal.
- Confirm no second `initializeApp` and that new code imports `db`/`auth`
  from the shared module.
- Skin work: run `tests/skinHost.test.tsx` after touching `SkinHost` or a skin
  theme. It is the only thing that fails if `cssVariablesSelector` is ever set
  back to `:root`, and the leak it prevents is invisible in a screenshot of
  `/manage`. A skin's own suite needs the repo's standard jsdom setup
  (`// @vitest-environment jsdom`, explicit `afterEach(cleanup)`, and the
  `matches: query === ""` matchMedia stub) plus a mock for `@mantine/carousel` —
  embla measures real rects, so a real `Carousel` initialises against nothing in
  jsdom. `tests/helpers/carouselMock.tsx` is that mock; it is loaded through an
  `async` `vi.mock` factory because `vi.mock` is hoisted above the imports.
