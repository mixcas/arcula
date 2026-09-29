# Custodia Art Collection Management - Project Plan

> This document is a mix of a design plan and a description of what is built. Where
> those two disagree, the **Status Update** section above is the one that is current.
> For the detailed product specification, see [FULLSPEC.md](FULLSPEC.md).

## Overview

Custodia is an art collection management software that will allow users to manage their
artwork collections with detailed information tracking and file attachments for
certificates and photos. Accounts arrive through their own sign-up page and carry a
name; during the beta an account is capped at one collection, and multiple collections
per user arrive with account tiers rather than at the start.

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
- Mantine theme with Darker Grotesque body text and BBH Bartle headings

**Known gaps**

- **No Firestore security rules exist.** This is the most serious gap, because the
  public page reads Firestore without authenticating. `isPublic` is a rendering gate
  only; see the note in **Data Flow & Architecture** below.
- **Password protection is not implemented.** The settings page collects a password and
  never saves it, and nothing writes `passwordHash`. The public page's prompt is wired
  to the real field but unreachable.
- **Storage is used for photos only.** Four variants plus the original are generated
  client-side in a Web Worker and uploaded on save. `certificates` remain unwired, so
  every artwork still has `certificates: []`.
- **No deletes in the UI.** The service functions exist; nothing calls them.
- **No tests.**
- **No `users` Firestore collection.** Ownership is a `userId` field on each collection
  and each artwork, filtered with `where("userId", "==", uid)`. The `User` type exists
  in `src/types/index.ts` but is never persisted, so there is nowhere for a profile
  (name, last name) or a plan to live, and no page that edits one.
- **No sign-up path.** Nothing calls `createUserWithEmailAndPassword`, so an account
  can only be made by hand in the Firebase console. `/login` sends people who have no
  account to the product page, because there is nothing else to send them to.
- **No account recovery or password change.** `updatePassword` and
  `sendPasswordResetEmail` are both uncalled, and there is no settings page for the
  account as opposed to a collection.
- **No limit on collections per account.** Every account may create as many as it
  likes, in the interface and in the rules alike. See **Planned: the beta release**.

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

Type only today — there is no `users` Firestore collection and it is never written. The
type as it stands:

- uid (unique identifier)
- email
- name
- collections (array of collection IDs)

Three of those four fields do not survive contact with the planned document, and the
type should change when the document does (see **Planned: the beta release**):

- **`collections: string[]` becomes `collectionId?: string`.** An array is the wrong
  shape under a one-collection cap, and it is a second copy of a relationship that
  `collections.userId` already expresses in the other direction. If tiers arrive it
  becomes an array again, which is exactly the kind of change that is cheap to make
  while there is no data and annoying afterwards.
- **`uid` goes away.** The planned document is keyed by uid (`users/{uid}`), so the id
  is already the uid, and the read convention (`{ id: doc.id, ...data }`) returns it.
- **`email` does not move into Firestore.** Firebase Auth owns it and can change it;
  a mirrored copy would go stale silently, and a stale email on a user document is
  worse than no email at all.

### 1a. The planned user document

Not built. This is the shape the beta work lands on — `users/{uid}`, one document per
account, no list query ever needed:

- id (= the uid; not stored in the document)
- displayName (what the navbar shows)
- firstName?
- lastName?
- tier (`"free"` throughout the beta; the hook a collection quota reads later)
- createdAt?, updatedAt? (stamped by the service layer, not by callers, and verified
  against `request.time` by the rules exactly as they already are for collections)

Deliberately absent: `email` and `emailVerified`, both of which Auth already holds and
both of which Auth is the authority for. `collections`/`collectionId` is also absent for
the reason above — the `collections` documents already carry `userId`, and a
denormalised copy is a second thing to keep correct.

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
- photos (array of `ArtworkPhoto`, max 10; `order` is the sequence and index 0 is the
  primary thumbnail app-wide; each entry carries the source dimensions, an unmodified
  `original` and four generated `variants` — `square_lg` 800x800 cover, `square_sm`
  400x400 cover, `large` max-1200 inside, `medium` max-800 inside)
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
   - Collections per account — unlimited today; capped at one for the beta, in the
     interface only

2. **Artwork Management** — _implemented, except certificate uploads_
   - Detailed artwork entry forms using Mantine UI components
   - File upload for photos (images only) — _implemented_: drag-and-drop, up to 10,
     drag to reorder, click for a full-screen preview
   - File upload for certificates (images/PDFs) — **not implemented**
   - Data validation for various formats — _implemented_ via the shared Zod schema

3. **Data Persistence** — _partially implemented_
   - Firebase Firestore for structured data — implemented
   - Firebase Storage for artwork photos — implemented; certificates still pending

4. **Authentication & Security** — _partially implemented_
   - User authentication system — implemented
   - Private collection password protection — **UI only, not enforced**
   - Firestore security rules — **not implemented**

5. **Public Access** — _implemented, unsecured_
   - Public collection viewing — implemented
   - Toggle between list and mosaic views — implemented
   - Optional password protection — **not implemented**

6. **Accounts** — _planned, next_
   - Self-service sign up — **not implemented**; accounts are made in the console
   - User profiles (name, last name) on a `users/{uid}` document — **not implemented**
   - Change password, and account recovery — **not implemented**
   - Collection cap per account — **not implemented**; see **Planned: the beta release**
     below

## Planned: the beta release

Three pieces of work, in this order. They are specified here rather than left as
roadmap bullets because each one constrains the others: the collection cap is what
gives the user document a reason to exist, the profile page is where the account UI
goes, and sign-up is what starts writing user documents at all.

Nothing in this section is built. It is written the way the rest of this document
describes finished work — decisions first, then the consequences that are easy to get
wrong — so that it can be checked against the code later without being rewritten.

### 1. One collection per account, capped in the interface

**The decision.** An account gets **one** collection during the beta. The cap lives in
the UI: the dashboard stops offering "New collection" once one exists, a direct hit on
`/manage/collection/new` redirects to the collection the account already has, and
there is no route a user can follow to the form.

**What this is not.** The rules do not change, so nothing _stops_ a second collection
from being written: the Firebase console, a direct SDK call, or a form left open in a
stale tab will all still create one. That is a reasonable trade while the beta is free
and self-hosted, because a second collection is a self-inflicted inconvenience rather
than an exposure of somebody else's data. Two consequences follow, and they are the
reason this is written down rather than just done:

- The cap must never be described as enforced. The existing vocabulary in this
  repository is careful about that difference — the password switch is called "UI only,
  not enforced" rather than working — and the collection cap belongs to the same
  category.
- The dashboard has to keep rendering whatever the query returns rather than assuming
  a single row. The cap is applied at the entry point and nowhere else, so the list
  must survive a second document existing.

**When tiers arrive.** A cap that is sold has to be something the rules can check, and
Firestore rules cannot count documents. That leaves two options, and this is the one
decision in the beta work worth getting right early:

- Store the one collection at a deterministic id (`collections/{uid}`) and gate
  `create` with `!exists(...)`. Race-free and assertable in the existing emulator
  suite, which is the part that has kept mattering: that suite covers rules and
  nothing else, so the other option's count would be untested by it. The cost is
  a one-time migration: existing collection
  documents move to the uid-keyed id, and every artwork's `collectionId` has to be
  repointed, which is precisely the field FULLSPEC §10 warns is silently broken by
  getting wrong. Cheap now, annoying later.
- Move collection creation into a callable function that counts with admin
  credentials. Authoritative, and it leaves the document ids alone. It was also
  the option that needed the Blaze plan, which used to be the tie-breaker — and
  the project is now on Blaze, so that argument is gone and the emulator
  coverage in the option above stands. What is left to do is build the
  `functions/` scaffold and accept that the count itself is then only testable
  by hand.

Either way the number itself should live in one place the UI reads for its messaging (a
`COLLECTION_LIMITS` map keyed by tier), while the rules hold their own copy of the
number, because rules cannot import TypeScript. A rules test per tier is what keeps
those two copies from drifting apart.

### 2. Account profiles on a `users/{uid}` document

**The decision.** A new top-level `users` collection — FULLSPEC §7 has listed it from
the start — with one document per account at `users/{uid}`. The document owns display
metadata; Firebase Auth keeps owning the credentials and the email address.

Keying by uid earns its place twice over. It makes the profile a pure point-read, so
the rules can grant `get` and `update` to the owner and grant **no `list` at all** — a
users collection that can be enumerated is a directory of everyone's real name, and
nothing in this product ever needs to enumerate one. And it makes `uid` redundant, so
the `User` type's `uid` field retires in favour of the `id` the read convention already
returns.

**Rules.** A new `match /users/{userId}`, with `create`, `get` and `update` restricted
to `isOwner(userId)`, `timestampsValid()` on writes so the server-stamped guarantee
the other collections already have keeps holding, and no `list` clause. The update
needs one thing beyond an ownership check:

```
allow update: if isOwner(userId)
              && request.resource.data.updatedAt == request.time
              && request.resource.data.diff(resource.data).affectedKeys()
                   .hasOnly(["displayName", "firstName", "lastName", "updatedAt"]);
```

Without the `affectedKeys()` clause, "you may edit your own document" also means "you
may edit your own `tier`" — a free upgrade to whatever the paid tier grants, by anyone
willing to open the console. This is the one place in the rules where ownership and
field checks are not the same question, which makes it worth a rules test of its own.

**Change password** is Auth, not Firestore, and is the fiddliest part of the page.
`updatePassword` fails with `auth/requires-recent-login` unless the session is fresh,
so the form re-authenticates first with
`reauthenticateWithCredential(EmailAuthProvider.credential(email, currentPassword))`,
and `auth/invalid-credential` and `auth/wrong-password` are mapped separately because
they are different mistakes. Changing the email address is a different decision and
should not be bundled in: it belongs to Auth (`verifyBeforeUpdateEmail`), it is the one
account change that has to survive the user document being wrong, and it is the one
that needs a confirmation email to be worth anything.

**Where the page hangs.** `/manage/profile`, inside `ManageLayout` like every other
`/manage` route, linked from the user menu in `ManageNavBar` — which today offers only
Logout, and shows an empty `Avatar` with the email address as its label. The profile
fields are what those two are waiting for.

### 3. Sign up

**The decision.** A `/signup` page beside `/login`, calling
`createUserWithEmailAndPassword` and then writing the `users/{uid}` document from the
same submission. `/login` gets a link to it in place of the "Learn more" link to the
product page, which is where a visitor without an account is currently sent.

The form follows `src/schemas/artwork.ts`, because that file is already the answer to
"how does a form work in this project": a Zod v4 schema in `src/schemas/user.ts`,
`schemaResolver(..., { sync: true })` against a hand-written `SignUpFormValues`
interface so no field is ever `undefined`, `transformValues` so the schema's output _is_
the payload, and the same compile-time guards. The error codes to map, in the style
`LoginPage` already sets: `auth/email-already-in-use`, `auth/invalid-email`,
`auth/weak-password`, and `auth/operation-not-allowed` — the last being exactly what a
self-hoster sees before they have switched Email/Password on in the console, so it
deserves a real message rather than the generic fallback.

**The ordering problem.** The Auth user exists before the Firestore document does, and
the two writes are not atomic. If the document write fails, the account still signs in
and the profile is simply blank. That is recoverable — make the write idempotent, and
treat a missing document as "finish setting up your profile" rather than as an error —
but it is a decision to make rather than to discover. The alternative is an
`auth.onCreate` trigger in `functions/`, the only way to guarantee a document for every
account; the Blaze plan it used to be gated on is already in place, so what it needs now
is the scaffold built and the trigger deployed (and it must not be reasoned about as if
billing were still open). It is worth weighing on its own merits, because the same
trigger is where a tier claim would be assigned.

**The trap this sets for the quota.** A user whose document is missing is a user the
rules cannot read a `tier` from. So if the `collections` `create` rule ever consults
`users/{uid}` to decide a quota, it has to treat a missing document as the free tier
(`!exists(...) || ...`) rather than denying outright — otherwise a Firestore write that
failed during sign-up silently costs somebody their only collection. Decide this before
the rule exists, not after it denies a real account.

**Verification is a separate decision.** `sendEmailVerification` is one line, but an
unverified address is still a fully valid Firestore principal, so gating the UI on
`emailVerified` gates nothing that matters. If verification is meant to mean anything,
the collections `create` rule needs `request.auth.token.email_verified` too — and then
an account that never clicked the link owns a real collection but cannot create a
second one, which is a sharp edge to have live at the same time as the cap.

Password reset (`sendPasswordResetEmail`) belongs on the same page and is one line.
Account deletion does not, and nothing on either page should imply that it exists.

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

This tree is what exists, not what is planned. The beta work adds four files to it —
`components/auth/SignUpPage.tsx`, `components/manage/ProfilePage.tsx`,
`schemas/user.ts` and `services/userService.ts` — and changes none of the existing
entries, though `authService` stops being imported by nothing once it grows
`register` and `changePassword`.

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
- `/login` - Simple login form. Also links to `/signup` for visitors without an
  account — today it links to the product page instead, because no sign-up exists
- `/signup` - Registration form (planned): name, last name, email, password. Creates the
  Auth user, then the `users/{uid}` document, then lands on `/manage`
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
- `/manage/profile` - Account settings (planned): edit name and last name, change
  password, send a password-reset email. Account-level, as distinct from the collection
  settings above

Anything unmatched redirects to `/`.

## Component Breakdown

### Auth Components:

- `LoginPage` - Simple login form for user authentication
- `SignUpPage` - Registration form and the `users/{uid}` write (planned)
- `ProtectedRoute` - Wraps `/manage/*`, redirects to `/login` when unauthenticated

### Management Components:

- `ManagePage` - Main dashboard showing all collections
- `CollectionPage` - Detail view of a single collection with artworks
- `ArtworkAddPage` - Form to add new artwork items
- `ArtworkEditPage` - Form to edit existing artwork items
- `CollectionSettingsPage` - Settings for collection privacy and protection
- `ProfilePage` - Account profile and password change (planned)
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
     `users` collection; ownership is a `userId` field. A `users` collection keyed by
     uid is the first thing the beta work adds, along with its `match /users/{userId}`
     rules (owner-only `create`/`get`/`update`, no `list`, and an `affectedKeys()`
     restriction so a user cannot raise their own `tier`)
   - Implement file storage for photos — done; certificates still not done
   - Configure security rules — **not done, and the most urgent item here**

2. **Authentication System**:
   - Implement Firebase Authentication — _done_
   - Create user sessions — _done_ (Firebase Auth; session in `AuthContext`)
   - Handle login/logout flows — _done_
   - Self-service registration — **not done**; no code calls
     `createUserWithEmailAndPassword`
   - Change password, and password reset — **not done**; both are Auth rather than
     Firestore, and the first needs a re-authentication step to be usable at all

3. **Data Services**:
   - Create collectionService.ts for collection operations — _done_
   - Create artworkService.ts for artwork operations — _done_
   - Create authService.ts for authentication operations — _done but imported by
     nothing_; `AuthContext` reimplements the same calls inline
   - Create userService.ts for the profile document — **not done**. `authService` is
     where `register` and `changePassword` belong when the beta work starts

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
   - Sign-up and the first profile write are the one place where an Auth action and a
     Firestore write have to agree, and they are not atomic — see **Planned: the beta
     release**

2. **Collection Management**:
   - Fetch all collections for a user from Firestore, filtered by `userId`
   - Create new collection with a `userId` reference
   - Update/delete existing collections (delete has no UI)
   - The beta cap on how many collections an account may have — **not implemented**, and
     applied at the entry point rather than in the rules

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
   - Not a first step, and not compatible with the beta as specified: an account is
     capped at one collection until account tiers exist, and the relationship to widen
     first is `User.collections` back into an array. Until then the honest summary is
     that the data model already supports several collections per user and the product
     chooses not to offer it

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

5. **Account credentials** (planned, for the sign-up form):
   - Password and confirmation must match before the Auth call is made
   - Firebase's own floor is six characters, and `auth/weak-password` is only raised if
     the project raises the policy in the console — so an app-side length rule is a
     usability choice, not a security control, and should be described as one
   - Name fields are free text, so the same trim-and-drop-when-blank treatment the
     artwork schema uses applies; an account's display name is not a place for
     structure the data model cannot hold

Item 2's open question — which currency a price is in — has no home yet. It belongs on
the user document as a per-account default (`locale`/`currency`), which is the reason
the profile work is worth doing before export and reporting rather than after.
