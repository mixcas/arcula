# Custodia Agent Guide

This is a React + TypeScript + Vite project using Firebase for authentication and Firestore for data storage.

## Key Commands

- `bun run dev` - Start development server (port 3000)
- `bun run build` - Build for production
- `bun run preview` - Preview production build

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
- **Authentication Context**: `src/context/AuthContext.ts`
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

## Mantine Context

Mantine guidelines are saved in `@.opencode/docs/mantine-llms.txt`. Reference this file whenever building UI components or form controls.

## Custodia Firebase Integration

### Summary

Custodia is a React 19 + Vite + Mantine SPA. Firebase provides all
persistence and auth. Firebase is initialized once in
`src/services/firebase.ts` from `VITE_FIREBASE_*` env vars and exposes
`db` (Firestore), `auth`, and `storage` (Storage, wired but unused).

### When to use

- Adding or changing auth, login, logout, or protected routes
- Reading/writing the `collections` or `artworks` Firestore data
- Touching any file that imports from `src/services/firebase`
- Adding new collections, storage uploads, or security rules

### Where to find it

- Init + exports: `src/services/firebase.ts` (do NOT re-initialize the app)
- Auth: `src/services/authService.ts`, `src/context/AuthContext.tsx` (useAuth)
- Data: `src/services/collectionService.ts`, `src/services/artworkService.ts`
- Types: `src/types/index.ts` (User, Collection, Artwork, FileReference)
- Env vars: `.env`, `.env.development` (VITE_FIREBASE_*)

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

### Gotchas

- Never re-run `initializeApp`; import `db`/`auth`/`storage` from
  `src/services/firebase.ts`.
- Config comes from `VITE_FIREBASE_*` env vars — never hardcode or copy
  real values.
- `storage` is exported but unused; `Artwork.photos`/`certificates`
  (`FileReference[]`) are the most likely place storage will be used next.
- No Firestore security rules exist in the repo — client reads are
  unguarded; flag before exposing data.
- `AGENTS.md` lists `AuthContext.ts`; the real file is `.tsx`.
- No tests for the Firebase layer; "dev" = run `bun run build`
  (tsc typecheck) to validate.

### Validation

- `bun run build` (runs `tsc && vite build`) for typecheck.
- Confirm no second `initializeApp` and that new code imports `db`/`auth`
  from the shared module.
