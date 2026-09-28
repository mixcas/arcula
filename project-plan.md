# Custodia Art Collection Management - Project Plan

> This document is a mix of a design plan and a description of what is built. Where
> those two disagree, the **Status Update** section above is the one that is current.
> For the detailed product specification, see [FULLSPEC.md](FULLSPEC.md).

## Overview

Custodia is an art collection management software that will allow users to manage their
artwork collections with detailed information tracking, file attachments for
certificates and photos, and future support for multiple collections per user.

## Status Update

Everything below is a description of the code as it stands, not a target.

**Built and working**

- Complete routing system, with the collection and artwork segments in place
- Firebase Authentication (email/password), with `/manage/*` behind a `ProtectedRoute`
- Firestore integration for `collections` and `artworks`, read and write
- Create, list, view, rename collections; set the public/private flag
- Add and edit artworks, with artwork list and mosaic views on both the manage and
  public pages
- A public collection page that reads real Firestore data
- Shared Zod schema (`src/schemas/artwork.ts`) used by both artwork forms
- `{urlizedName}-{id}` route params throughout, with bare ids still accepted
- Mantine theme with Poppins body text and Gravitas One headings

**Known gaps**

- **No Firestore security rules exist.** This is the most serious gap, because the
  public page reads Firestore without authenticating. `isPublic` is a rendering gate
  only; see the note in **Data Flow & Architecture** below.
- **Password protection is not implemented.** The settings page collects a password and
  never saves it, and nothing writes `passwordHash`. The public page's prompt is wired
  to the real field but unreachable.
- **Firebase Storage is unused.** It is initialised and exported but never called, so
  every artwork has `photos: []` and the public list view renders placeholders.
- **No deletes in the UI.** The service functions exist; nothing calls them.
- **No tests.**
- **No `users` Firestore collection.** Ownership is a `userId` field on each collection
  and each artwork, filtered with `where("userId", "==", uid)`. The `User` type exists
  in `src/types/index.ts` but is never persisted.

## Tech Stack

- **Frontend**: React 19 + TypeScript + Mantine UI v9 + react-router-dom v7
- **Backend**: Firebase (Firestore for data, Firebase Storage for files — wired but not
  yet called)
- **Forms**: `@mantine/form` with Zod v4
- **Utility Library**: Lodash is a dependency but **nothing imports it yet**; treat it
  as available rather than in use
- **Build Tool**: Vite

## Core Data Models

The authoritative definitions are in `src/types/index.ts`, and they are **camelCase**,
matching the code. An earlier revision of this document listed these fields in
snake_case with `medium` for what the code calls `media`; both are corrected below.

### 1. User

Type only — there is no `users` Firestore collection and this is never written.

- uid (unique identifier)
- email
- name
- collections (array of collection IDs)

### 2. Collection

- id (unique identifier)
- name
- userId (reference to the owner)
- description? (optional)
- isPublic? (boolean; absent reads as private)
- passwordHash? (declared but never written)
- artworks? (array of artwork IDs; initialised to `[]` on create and never appended to)
- createdAt?, updatedAt? (stamped by `collectionService`, not by callers)

### 3. Artwork

Only `title` and `artistName` are required. Every other descriptive field is optional,
so an unset key stays distinguishable from a set-but-empty one.

- id (unique identifier)
- userId (reference to the owner)
- title
- artistName
- serie?
- dateOfCreation?
- media?
- dimensions?
- editions?
- acquisitionDate?
- acquisitionPrice?
- placeOfOrigin?
- provenance?
- condition?
- currentValue?
- notes?
- certificates (array of `FileReference`; always written, `[]` until uploads land)
- photos (array of `FileReference`; always written, `[]` until uploads land)
- collectionId (reference to the parent collection)
- createdAt?, updatedAt? (stamped by `artworkService`)

### 4. FileReference

- url? (empty for local-only entries, which is all that exist today)
- name?
- size?
- type?
- metadata?

### Invariants worth stating explicitly

- **`Artwork.collectionId` holds a bare Firestore document id, never a route param.**
  This is the single rule most easily broken, and breaking it is silent: the artwork
  simply stops appearing in its collection.
- **`acquisitionPrice` and `currentValue` are stored as the string that was typed**, not
  as numbers. Nothing does arithmetic on them yet, and keeping them textual avoids
  binary float drift on values that are decimal by nature.
- `createdAt`/`updatedAt` are set by the service layer. Callers do not pass them.
- `isPublic` is only ever granted by an explicit `true`; a document written before the
  field existed reads as private.

## Key Features

1. **Collection Management** — _implemented_
   - Create, view, edit (rename), set public/private
   - Associate artworks with collections

2. **Artwork Management** — _implemented, except uploads_
   - Detailed artwork entry forms using Mantine UI components
   - File upload for certificates (images/PDFs) and photos (images only) — **not
     implemented**
   - Data validation for various formats — _implemented_ via the shared Zod schema

3. **Data Persistence** — _partially implemented_
   - Firebase Firestore for structured data — implemented
   - Firebase Storage for file attachments — **not implemented**

4. **Authentication & Security** — _partially implemented_
   - User authentication system — implemented
   - Private collection password protection — **UI only, not enforced**
   - Firestore security rules — **not implemented**

5. **Public Access** — _implemented, unsecured_
   - Public collection viewing — implemented
   - Toggle between list and mosaic views — implemented
   - Optional password protection — **not implemented**

## Folder Structure

```
/src
  main.tsx          (entry point; wires the Mantine theme and the router)
  theme.ts          (Mantine theme: fonts, font sizes, spacing)
  utils/slug.ts     ({slug}-{id} route params ⇄ bare document ids)
  schemas/artwork.ts (Zod schema + Firestore payload shaping)
  /components
    ProductPage.tsx
    ProtectedRoute.tsx
    auth/
      LoginPage.tsx
    collection/
      PublicCollectionPage.tsx
    manage/
      ManagePage.tsx
      CollectionPage.tsx
      ArtworkAddPage.tsx
      ArtworkEditPage.tsx
      CollectionSettingsPage.tsx
      collection/
        NewCollectionPage.tsx
      layout/
        ManageLayout.tsx
        ManageNavBar.tsx
  /context
    AuthContext.tsx
  /hooks
    useAuth.ts
  /services
    firebase.ts (Firebase initialization)
    collectionService.ts
    artworkService.ts
    authService.ts
  /types
    index.ts (Type definitions)
  App.tsx (Routes)
```

There is no `index.tsx` and no `index.css`. The entry point is `main.tsx`, and styling
comes entirely from the Mantine theme rather than a global stylesheet.

Note that the service layer is not used consistently. `authService` is exported but
imported by nothing: `AuthContext` imports `auth` from `services/firebase.ts` and
implements `onAuthStateChanged`, `signInWithEmailAndPassword` and sign-out inline
instead. `ManagePage` likewise imports `db` and runs its collection query directly.
`NewCollectionPage` reaches for `getAuth()` from `firebase/auth` rather than the shared
`auth` export (same underlying instance, but a second import path to keep straight).
Everything else goes through `collectionService`/`artworkService`. Prefer the service
layer for new code.

## URL Conventions

Routes carry a readable name alongside the document id, per FULLSPEC §10:

- Collections: `/manage/collection/{URLized collection name}-{collection ID}`
- Artworks: `/manage/collection/{collection slug}/artwork/{URLized art work title}-{artwork ID}`
- Public view: `/collection/{URLized collection name}-{collection ID}`

**Firestore stores only the raw document id.** The slug exists in the URL and nowhere
else, which is what makes a rename safe — changing a collection's name cannot orphan
the artworks pointing at it.

Bare-id URLs (`/collection/7aV9xKqL2mP4nR8tY1zC`) still load; the page then rewrites the
address bar to the canonical slug with `replace`, so it corrects in place rather than
pushing a history entry. Parsing splits on the last hyphen rather than at a fixed
offset, so it depends on neither the length nor the alphabet of the id, and a param with
no hyphen in it is returned unchanged.

`utils/slug.ts` is the only module that knows how a slug and an id relate. The rule at
every call site: the **parsed id** goes to Firestore, the **route param** goes to `Link`
and `navigate()`.

## Routing Structure

### Public Pages

- `/` - Product page. We present the product and link to `/login`. But for now it should
  be a very simple page. We will worry about this later. The only important thing right
  now is the login link.
- `/login` - Simple login form
- `/collection/{URLized collection name}-{collection ID}` - Public page for viewing a
  collection. Name on the top. Toggle to switch between List / Mosaic view.
  - List view: Expanded list of all artworks
    - Title and Artist
    - Photos in a carousel
    - Extra info
  - Mosaic: Only First Photo, Title and Artist
  - If the collection is private display a Private message. If password protected prompt
    for password.

### Protected Pages

- `/manage` - Main management page. Nothing much for now but the list of current
  collections
- `/manage/collection/new` - Form page to create a new Collection:
  - Name
  - Public status
- `/manage/collection/{URLized collection name}-{collection ID}` - Main management page
  for a collection. List/Mosaic view of Artworks in Collection, with Edit button. Button
  to add Artworks. Link to Collection Settings
- `/manage/collection/{collection slug}/artwork/add` - Form page to create a new artwork
- `/manage/collection/{collection slug}/artwork/{URLized art work title}-{artwork ID}` -
  Edit page to edit artwork
- `/manage/collection/{collection slug}/settings` - Page to manage collection settings:
  - Edit collection title
  - Edit collection privacy settings (public/private)
    - Private allow for a password protected collection: When this is enabled the public
      page for a collection would be password protected

Anything unmatched redirects to `/`.

## Component Breakdown

### Auth Components:

- `LoginPage` - Simple login form for user authentication
- `ProtectedRoute` - Wraps `/manage/*`, redirects to `/login` when unauthenticated

### Management Components:

- `ManagePage` - Main dashboard showing all collections
- `CollectionPage` - Detail view of a single collection with artworks
- `ArtworkAddPage` - Form to add new artwork items
- `ArtworkEditPage` - Form to edit existing artwork items
- `CollectionSettingsPage` - Settings for collection privacy and protection
- `NewCollectionPage` - Form to create a collection

### Public Components:

- `PublicCollectionPage` - Public-facing view of a collection with list/mosaic toggle

### Utility Components:

- `ProductPage` - Landing page that links to login

### Layout Components:

- `ManageLayout` - Shared shell for every `/manage` route
- `ManageNavBar` - Header, user menu, sign out

## Firebase Implementation Plan

1. **Firebase Setup**:
   - Initialize Firebase in the React app — _done_
   - Set up Firestore collections: `collections`, `artworks` — _done_. There is no
     `users` collection; ownership is a `userId` field
   - Implement file storage for certificates and photos — **not done**
   - Configure security rules — **not done, and the most urgent item here**

2. **Authentication System**:
   - Implement Firebase Authentication — _done_
   - Create user sessions — _done_ (Firebase Auth; session in `AuthContext`)
   - Handle login/logout flows — _done_

3. **Data Services**:
   - Create collectionService.ts for collection operations — _done_
   - Create artworkService.ts for artwork operations — _done_
   - Create authService.ts for authentication operations — _done but imported by
     nothing_; `AuthContext` reimplements the same calls inline

4. **Security Considerations**:
   - Configure Firestore security rules to protect data — **not done**
   - Implement password protection for collections — **not done**, and it cannot be done
     client-side: a prompt gates nothing once the artworks are in the browser. Needs
     rules plus a verification path, or a callable function
   - Secure file uploads and access — pending, since uploads are not implemented

## Data Flow & Architecture

1. **User Authentication**:
   - User logs in via Firebase Auth
   - Session maintained through React context (`AuthContext`/`useAuth`). TanStack Query is
     not used and is not a dependency

2. **Collection Management**:
   - Fetch all collections for a user from Firestore, filtered by `userId`
   - Create new collection with a `userId` reference
   - Update/delete existing collections (delete has no UI)

3. **Artwork Management**:
   - Fetch artworks for a specific collection
   - Add artwork with all metadata fields (including certificates and photos, both
     written as `[]`)
   - Upload files to Firebase Storage — not implemented
   - Save references to files in Firestore — not implemented

4. **Public Access**:
   - Check collection privacy settings on load
   - Display password protection prompt if needed — unreachable, nothing writes
     `passwordHash`
   - Render artworks in either list or mosaic view

   The fetch is sequenced rather than parallel: the collection is read first, and its
   artworks are requested only if `isPublic === true`. So an unauthenticated visitor can
   pull down a private collection's document but never its artworks. This narrows the
   exposure — **it does not close it.** Without security rules the collection document
   is readable by anyone who knows its id, so the "This collection is private" message is
   a rendering decision, not a guarantee.

## Timeline Considerations

> The original sequencing. It records the order things were planned in, not their
> current state; see **Status Update** for what is actually outstanding.

1. **Week 1**: Setup environment, basic components, and Firebase integration
   - React + TypeScript setup
   - Install dependencies (Mantine UI, Firebase)
   - Implement routes and basic UI components
   - Connect Firebase and set up authentication

2. **Week 2**: Implement collection management features
   - Full collection CRUD operations
   - Collection settings (privacy, password protection)
   - Public collection view with access controls — the view is built; the access controls
     are not

3. **Week 3**: Implement artwork management + file uploads
   - Complete artwork forms with all required fields
   - File upload components for certificates and photos — outstanding
   - Data validation for dates, prices, etc.

4. **Week 4**: Add authentication, improve UX, testing
   - Secure routing with authentication checks
   - Improve UI/UX based on user feedback
   - Complete documentation and testing

## Future Enhancements

1. **Multi-collection support**:
   - Expand user-to-collection relationship to many-to-many
   - Allow artworks to be in multiple collections

2. **Advanced search & filtering**:
   - Search by artist, medium, period, etc.
   - Advanced filtering options

3. **Export functionality**:
   - Export collection data as CSV or PDF
   - Generate collection reports

4. **Mobile support**:
   - Responsive design for mobile devices
   - Mobile-optimized workflows

5. **Collaboration features**:
   - Share collections with other users
   - Collaborative editing permissions

## Data Validation Requirements

1. **Date formats**:
   - Acquisition dates should follow consistent format (dd/mm/yyyy)
   - Creation dates should be validated

2. **Price formats**:
   - Currency formatting for acquisition price and current value
   - Support for different currency types

3. **File validation**:
   - Certificate uploads: PDF, JPG, PNG
   - Photo uploads: JPG, PNG, WebP
   - File size limits

4. **Text fields**:
   - Required fields validation
   - Length constraints
   - Proper sanitization

Item 4 is partially implemented: `title` and `artistName` are required and the rest are
optional, enforced by the shared Zod schema so both artwork forms agree. Length
constraints and sanitization are not addressed.
