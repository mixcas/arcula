# Custodia Agent Guide

This is a React + TypeScript + Vite project using Firebase for authentication and Firestore for data storage.

## Key Commands

- `bun run dev` - Start development server (port 3000)
- `bun run build` - Build for production
- `bun run preview` - Preview production build
- `bun run check` - Typecheck, lint, and check formatting
- `bun run test:rules` - Run the Firestore rules suite against the emulators (needs Java)
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
- Tests: `tests/firestore.rules.test.ts` (run via `bun run test:rules`)
- Env vars: `.env`, `.env.development` (VITE_FIREBASE_*)

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
  trigger). Cloud Functions require the Blaze plan, so that is a billing
  decision, not just a technical one.

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

### Gotchas

- Never re-run `initializeApp`; import `db`/`auth`/`storage` from
  `src/services/firebase.ts`.
- Config comes from `VITE_FIREBASE_*` env vars — never hardcode or copy
  real values.
- `storage` is exported but unused; `Artwork.photos`/`certificates`
  (`FileReference[]`) are the most likely place storage will be used next.
  `storage.rules` currently admits **no** uploads until that path lands.
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
- `bun run test:rules` for the security rules suite against the emulators.
  It starts the emulators and then runs **all** tests, including the
  pure-logic and component ones (`npx vitest run tests/<file>` runs a single
  file with no emulators, which is the fast loop for UI work).
- Confirm no second `initializeApp` and that new code imports `db`/`auth`
  from the shared module.
