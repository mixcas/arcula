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
  design (no sync/cascade). Default is `false` in every write path.
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
  collection's `isPublic`. Default is `false` on every write path
  (`src/schemas/artwork.ts` keeps it in the schema and payloads). The
  rules authorize the public reads on this field alone.
- Artwork reads split by caller (both in `src/services/artworkService.ts`):
  - owner: `getCollectionArtworks(collectionId, userId)` — where()
    `collectionId` + `userId` (needs the `(collectionId, userId)` index)
  - visitor: `getPublicCollectionArtworks(collectionId)` — where()
    `collectionId` + `isPublic == true` (needs the
    `(collectionId, isPublic)` index)
    Both indexes are declared in `firestore.indexes.json`.

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
  `where isPublic == true` for visitor queries). A list that would span a
  document the caller may not read is denied outright, not silently
  trimmed.
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

### Validation

- `bun run build` (runs `tsc && vite build`) for typecheck.
- `bun run check` (tsc + eslint + prettier) must pass before and after a
  rules change.
- `bun run test:rules` for the security rules suite against the emulators.
- Confirm no second `initializeApp` and that new code imports `db`/`auth`
  from the shared module.
