# Arcula

Art management for real people.

Arcula is a web app for cataloguing a private art collection: your collections, the
artworks in them, and the details that make each one worth recording. It is free and
open source, self-hosted on your own Firebase project, and built for independent
collectors rather than galleries.

## Naming

The product is **Arcula**, at [arcula.art](https://arcula.art). It was called
_Custodia_ until 28 September 2026, when the domain was bought and the
user-visible name changed with it: page title, landing page, both nav bars, and
the web app manifest.

The internal identifiers are still `custodia` — the Firebase project id, the
emulator project id, and the package and repository names. Renaming the Firebase
project is a migration rather than an edit, so it was deferred deliberately.
[RENAME.md](RENAME.md) holds the checklist and the migration runbook.

## Why this exists

Once you own more than a handful of works, you need a record. The trouble is that the
three usual answers each break in a different way.

**Commercial platforms.** Artlogic and its competitors are genuinely good software,
built for galleries and institutions. The pricing is calibrated to that market —
per-seat, per-year, frequently with paid modules. For a collector with forty works and
no employees, that is a lot of money for software built around a workflow you do not
have.

**FileMaker.** Flexible, and it will fit almost anything you ask of it. It also becomes
yours to maintain. The file lives on one machine, backups are whatever you remembered
to schedule, and whoever built it stops being available right when you need a change. A
database is not a plan.

**A spreadsheet.** This is where most independent collectors actually land, and it is
the worst of the three for a reason that has little to do with the software. A
spreadsheet makes a hard promise about your collection: that it is a table. One row per
work, one column per attribute, every value in a column the same shape as every other
value in it.

That promise is the problem, because art is not tidy data. The date is "circa 1889",
not a date. A work may be attributed to a workshop rather than a named artist. What you
paid and what you think it is worth now are different numbers, and a single "value"
column destroys the distinction. Provenance is a chain, not a cell. Condition is a
slow-moving fact about a physical object, not a property.

Spreadsheets do not fail at storing this. They fail silently. They let you flatten it,
and then you lose the distinctions without noticing, because a spreadsheet never tells
you that what you entered is worse than what you know.

Arcula is built on the opposite assumption. The fields are the ones a collector
actually has, the types leave room for the awkward cases, and the data model refuses to
treat an unset field and an empty field as the same thing. It is a web app, so it is
not tied to one laptop, and it is open source, so the schema is yours to argue with.

## Project status

This is an early project, but access control is no longer the open gap: Firestore
reads and writes are enforced by security rules (`firestore.rules`), and rules deploys
are gated on a test suite run against the emulators. Here is the honest version:

| Area                                                 | State                                         |
| ---------------------------------------------------- | --------------------------------------------- |
| Email/password auth, protected routes                | Working                                       |
| Sign up                                              | Not implemented (accounts are made by hand)   |
| Account profile, change password                     | Not implemented                               |
| Create, list, view collections                       | Working                                       |
| Collections per account                              | Unlimited (the beta cap is interface-only)    |
| Rename collection, set public/private flag           | Working                                       |
| List a collection's artworks                         | Working                                       |
| Add an artwork                                       | Working                                       |
| Edit an artwork (writes to Firestore)                | Working                                       |
| Per-artwork visibility flag                          | Working (independent of the collection's)     |
| Public collection page (`/collection/:collectionId`) | Reads via rules; denied reads → private state |
| Password-protected collections                       | UI only, not enforced                         |
| Photo uploads                                        | Working (4 variants + original, Web Worker)   |
| "Other Documents" uploads (images and PDFs)          | Working; owner-only, enforced by the rules    |
| Deleting artworks                                    | Working; soft delete, in bulk                 |
| Deleting collections                                 | Service function exists, no UI                |
| CSV import of artworks                               | Working                                       |
| Artwork documents on the public pages                | Never rendered, and the rules refuse them     |
| Firestore + Storage security rules                   | Provided for collections/artworks             |
| Rules test suite                                     | `bun run test:rules` (emulator-gated deploy)  |

Several of those deserve emphasis, because they are easy to misread from the code:

- **Access control lives in `firestore.rules`, not in the rendering gate.** Collections
  and artworks are readable by non-owners only when explicitly public, and each artwork
  carries its **own** `isPublic` flag, independent of its collection's: a public
  collection may keep individual works private, and `PublicCollectionPage` only ever
  reads a collection as an anonymous visitor, so a private collection is denied by the
  rules _before_ its name reaches the browser. The page maps that `permission-denied`
  to the same "This collection is private." state as the `isPublic` check. This matters
  because the development server points at the same Firestore database the deploy
  pipeline does — see [Deploying rules](#deploying-rules).
- **The password control does not work.** The switch and the password field on the
  settings page hold local component state and are never saved; the page submits only
  `{ name, isPublic }`. `passwordHash` exists in the type definition, and the public
  page's prompt reads that real field, but nothing ever writes it. Note also that the
  prompt could not be a client-side check even once it is written: by the time it
  renders, the artworks are already in the browser. Real enforcement needs rules plus a
  verification path, or a callable function — a Cloud Functions scaffold exists
  (`functions/`) with the callables designed but not built.
- **Uploads and Storage are subject to rules the same way reads are.** Photo objects
  are readable by a non-owner exactly when the artwork is public and not soft-deleted —
  the same two conditions the Firestore rules check, so a photo is never more readable
  than the artwork it belongs to. **Artwork documents are owner-only for reads _and_
  writes**, enforced in `storage.rules` rather than merely left out of the public pages:
  a condition report, a receipt or a provenance note that a future UI forgot to hide
  would leak nothing, because those rules still say no. The extension allowlist on
  stored object names is a real control too, not tidiness — an uploaded SVG navigated to
  directly executes script in the storage origin, and `contentType` is client-supplied,
  so the filename is the only thing the rules can bind to it.
- **The write order differs between Add and Edit, and it is not incidental.** Add is
  three writes — create, then upload and record photos, then upload and record documents
  — because the document must exist before Storage has an id to put objects under. Edit
  does the opposite, uploading and sweeping Storage _before_ the Firestore write, because
  the document is the record of what exists and should only be updated once the objects
  it points at are there. A save also writes `photos` and `documents` only when they
  actually changed, so a title edit does not rewrite every stored URL.
- **Deleting an artwork does not remove it.** The row leaves the collection table and
  `deletedAt` is stamped; nothing is ever deleted from Firestore. A visitor's reads are
  gated on `deletedAt == null`, so a soft-deleted work disappears from the public pages
  without the document itself going anywhere. There is no trash or restore view yet.

## Tech stack

- **Frontend**: React 19, TypeScript
- **UI**: Mantine v9
- **Forms**: `@mantine/form` with [Zod](https://zod.dev) v4 schemas
- **Routing**: React Router v7
- **Auth**: Firebase Authentication (email/password)
- **Database**: Firestore
- **Build**: Vite
- **Typography**: [Darker Grotesque](https://fonts.google.com/specimen/Darker+Grotesque)
  for body text and [BBH Bartle](https://fonts.google.com/specimen/BBH+Bartle) for
  headings, loaded via `<link>` in `index.html` and applied in `src/theme.ts`

Validation lives in a single shared schema (`src/schemas/artwork.ts`) used by both the
add and edit forms, so the two write identical documents for identical input.

## URL scheme

Every collection and artwork route carries a readable segment alongside the document
id:

```
/manage/collection/van-gogh-collection-7aV9xKqL2mP4nR8tY1zC
/manage/collection/van-gogh-collection-7aV9xKqL2mP4nR8tY1zC/artwork/the-potato-eaters-Yh8kD2mL5vN9qR
```

The name is cosmetic. **Firestore only ever stores the raw document id** — the slug
lives in the URL and nowhere else, and that is what makes a rename safe: changing a
collection's name cannot orphan the artworks that point at it. Three consequences
worth knowing:

- **Bare ids still work.** An older link of the form
  `/collection/7aV9xKqL2mP4nR8tY1zC` loads fine and the page rewrites the address bar to
  the canonical slug using `replace`, so it corrects in place rather than pushing a
  history entry.
- **Parsing splits on the last hyphen**, not at a fixed offset, so it depends on neither
  the length nor the alphabet of the id, and a param with no hyphen in it comes back
  unchanged.
- **The slug is never a lookup key.** Pass the parsed id to Firestore and the route
  param to `Link`/`navigate()`. Reversing those two is how a slug once ended up written
  into documents as a `collectionId`.

`src/utils/slug.ts` is the only place that knows how the two relate. The convention is
specified in [FULLSPEC.md](FULLSPEC.md) §10.

One migration note, if you already have data: a document written before this change may
hold a slug in its `collectionId`, in which case a bare-id query will not find it. Check
existing artworks for a `collectionId` that is not a plain Firestore auto-id.

## Getting started

### Prerequisites

- [Bun](https://bun.sh)
- A Firebase project on the [Blaze](https://firebase.google.com/pricing) plan —
  see [Firebase plan](#firebase-plan)

### Installation

1. Clone the repository:

```bash
git clone <repository-url>
cd custodia
bun install
```

2. Create a `.env` file in the project root with your Firebase web app config, found
   under Project settings → Your apps in the [Firebase console](https://console.firebase.google.com/):

```env
VITE_FIREBASE_API_KEY=your_api_key
VITE_FIREBASE_AUTH_DOMAIN=your_auth_domain
VITE_FIREBASE_PROJECT_ID=your_project_id
VITE_FIREBASE_STORAGE_BUCKET=your_storage_bucket
VITE_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
VITE_FIREBASE_APP_ID=your_app_id
```

3. In the Firebase console, enable **Authentication → Email/Password** and create a
   **Firestore Database**.

4. Start the development server on [localhost:3000](http://localhost:3000):

```bash
bun run dev
```

5. Deploy the security rules once, so the database is locked down before real data
   goes in. The test suite runs first and the deploy is refused if it fails:

```bash
bun run deploy:rules
```

### Firebase plan

Arcula is developed and deployed on the **Blaze** (pay-as-you-go) plan, and a
project that intends to use Cloud Functions should be too. Blaze is not a
subscription and not a feature tier: it is the plan with a payment method
attached, and Firebase bills per use past the free quotas every plan includes.
What it buys this project is Cloud Functions — the `functions/` scaffold, and
the password-protection and account paths designed against it — plus the option
of a server-side Admin SDK backfill. Everything currently built (Auth,
Firestore, its security rules, Hosting, the emulator suite) runs on the free
plan unchanged, so switching plans is not a prerequisite for reading or running
the app.

Two consequences are worth spelling out:

- **Almost nothing that happens here bills.** `bun run test:rules` runs
  entirely on local emulators against a throwaway project, and deploying rules
  or static files is not a metered operation. The billable surfaces are a
  functions deploy, function invocations, and Storage traffic once uploads land
  — which is the argument for keeping a budget alert on the project and for
  running the rules suite before a deploy rather than after.
- **Enabling it is console work, not repository work.** No script here
  provisions billing and nothing depends on it being enabled, so a self-hoster
  can stay on the free plan and lose nothing that works today.

Roadmap items that used to be described as "requiring the Blaze plan" are now
waiting only on their other prerequisites — Anonymous Auth for the collection
password path, and the `functions/` scaffold being actually built.

## Scripts

| Command                  | Description                                                 |
| ------------------------ | ----------------------------------------------------------- |
| `bun run dev`            | Start the development server on port 3000                   |
| `bun run build`          | Typecheck and build for production                          |
| `bun run preview`        | Preview the production build                                |
| `bun run check`          | Typecheck, lint, and check formatting                       |
| `bun run lint`           | ESLint, with type-aware rules                               |
| `bun run format`         | Rewrite files with Prettier                                 |
| `bun run test:rules`     | Run every test against the Firestore/Auth/Storage emulators |
| `bun run emulators`      | Start the full emulator suite with the web UI (port 4000)   |
| `bun run deploy:rules`   | Run the rules suite, then deploy Firestore + Storage rules  |
| `bun run deploy:hosting` | Build, then deploy hosting to the configured project        |
| `bun run deploy`         | `deploy:rules` first (gated on the suite), then hosting     |

## Deploying rules

`bun run test:rules` starts the Firestore, Auth and Storage emulators and runs **every**
test file — the rules suites, the pure logic and the components. A single file runs
without emulators via `npx vitest run tests/<file>`, which is the fast loop for UI work.
The emulators need a Java runtime; if none is installed, the Firebase CLI offers to
download one.

`bun run deploy:rules` runs that suite and then deploys
`firebase deploy --only firestore,storage`. Because the rules test first, a broken
rule set — one that would, say, deny the owner's own dashboard — cannot be shipped
through this script. Every deploy script is explicitly scoped with `--only`, so a
rules deploy never touches hosting or functions.

The Firebase project is pinned in `.firebaserc` (`custodia-67307`) and the emulator
scripts above use a throwaway `demo-custodia` project, so tests never touch real data.
Keep `bun run check` passing before and after any rules change; the build output will
fail loudly on a malformed rule file.

## Project structure

```
firebase.json                          # Rules, emulators, hosting, functions config
firestore.rules                        # Collections/artworks access control
firestore.indexes.json                 # Composite query indexes
storage.rules                         # Storage access for photos and documents
functions/                            # Cloud Functions source (scaffold only)
  └── src/index.ts                    # No functions exported yet
tests/                                # 13 files: rules, pure logic, components
  ├── firestore.rules.test.ts         # Firestore rules (vitest + emulators)
  ├── storage.rules.test.ts          # Storage rules, and the client/rules naming seam
  ├── artworkDocuments.test.ts        # Document caps, extension derivation, change detection
  ├── documentsUploader.test.tsx     # The "Other Documents" list
  ├── photoUploader.test.tsx         # Photo ordering, the merge, upload failures
  └── ...
vitest.config.ts                       # Vitest config; no `globals`, so tests clean up explicitly
src/
├── main.tsx                          # Entry point; wires theme + router
├── App.tsx                           # Routes
├── theme.ts                          # Mantine theme: fonts, sizes, spacing
├── components/
│   ├── ProductPage.tsx               # Public landing page
│   ├── AppTitle.tsx                  # The wordmark; the only place the name is written
│   ├── PublicNavBar.tsx              # Title-only header for the landing page
│   ├── ProtectedRoute.tsx            # Auth gate for /manage routes
│   ├── auth/
│   │   └── LoginPage.tsx             # Email/password sign-in
│   ├── collection/
│   │   └── PublicCollectionPage.tsx  # Unauthenticated view of a public collection
│   └── manage/
│       ├── layout/
│       │   ├── ManageLayout.tsx      # Shared shell for all /manage routes
│       │   └── ManageNavBar.tsx      # Header, user menu, sign out
│       ├── ManagePage.tsx            # Dashboard: your collections
│       ├── CollectionPage.tsx        # One collection and its artworks
│       ├── CollectionSettingsPage.tsx # Rename, public/private
│       ├── ArtworkAddPage.tsx        # Add an artwork
│       ├── ArtworkEditPage.tsx       # Edit an artwork
│       ├── MigrationsPage.tsx        # Run pending data migrations
│       ├── artwork/
│       │   ├── PhotoUploader.tsx     # The photo grid: drop, reorder, preview
│       │   ├── DocumentsUploader.tsx # The "Other Documents" list
│       │   └── PhotoPreviewModal.tsx # Full-screen preview, shared with document images
│       ├── collection/
│       │   ├── NewCollectionPage.tsx
│       │   └── ArtworksTable.tsx     # Sortable, selectable; batch soft delete
│       └── import/                   # CSV import: CsvImportPage, four steps, EditableCell
├── context/AuthContext.tsx           # Auth state provider, read via useAuth()
├── hooks/
│   ├── useAuth.ts                    # Context consumer hook
│   ├── useArtworkPhotos.ts           # Photo list state for the Add/Edit forms
│   └── useArtworkDocuments.ts        # The same for documents
├── schemas/
│   ├── artwork.ts                    # Zod schema + Firestore payload shaping
│   └── artworkImport.ts              # CSV header matching, coercion, row validation
├── services/
│   ├── firebase.ts                   # Firebase init, exports db/auth/storage
│   ├── artworkService.ts
│   ├── artworkFiles.ts               # Storage machinery shared by photos and documents
│   ├── imageService.ts               # Photo uploads
│   ├── documentService.ts            # Document uploads
│   ├── authService.ts                # Defined but imported by nothing
│   └── collectionService.ts
├── types/index.ts                    # Artwork, Collection, ArtworkPhoto, ArtworkDocument
├── migrations/                       # Data migration registry; a new field is a schema change
│   ├── types.ts                      # The Migration shape, and why db is a parameter
│   └── backfillArtworkDeletedAt.ts
└── utils/
    ├── slug.ts                       # {slug}-{id} route params ⇄ bare document ids
    ├── firestoreErrors.ts            # isPermissionDenied() helper
    ├── imageVariants.ts              # The variant table, the geometry, and the caps
    ├── imageRender.ts                # Canvas encoding; shared by the worker and the fallback
    ├── imageWorker.ts                # The Web Worker itself
    ├── imageProcessing.ts            # Spawns the worker, falls back to the main thread
    ├── artworkPhotos.ts              # The order invariant and the photoUrl ladder
    ├── artworkDocuments.ts           # Caps, the accepted types, and the extension allowlist
    ├── csv.ts                        # In-browser CSV parsing
    └── maintenanceAccess.ts          # isMaintenanceAdmin() allowlist for the maintenance screens
```

There is no global stylesheet. Typography, spacing and component defaults all come from
the Mantine theme, so a change to a font or size is a one-line change in `src/theme.ts`
rather than a hunt through CSS.

`firebase.ts` exports `db`, `auth` and `storage`. All three are used; `storage` backs
both `Artwork.photos` and `Artwork.documents`, through the shared machinery in
`artworkFiles.ts` rather than a second copy of the naming and delete sweep.

## Roadmap

### For the beta release

- **Sign up** — a `/signup` page beside `/login`, so a new collector can enroll
  without opening the Firebase console
- **One collection per account** — capped in the interface during the beta, raised when
  account tiers arrive. The cap is a product limit, not access control: nothing stops a
  second collection being written, so the dashboard still has to cope with a second one
  existing
- **Account profiles** — name and last name on a `users/{uid}` document, a page to edit
  it, and change password

### Everything else

Roughly in order of how much they matter:

- ✅ Firestore security rules with an emulator-gated deploy (`deploy:rules`) — the
  public page now reads through rules rather than around them
- ✅ Per-artwork visibility flag, independent of the collection's
- Real password protection for shared collections, with a server-side verification path
  — the functions scaffold in `functions/` is built for this (bcrypt + short-lived
  grants; the Blaze plan is already in place, so Anonymous Auth is the only
  outstanding prerequisite)
- Trash and restore for soft-deleted artworks, and a purge for long-dead ones
- Delete for collections
- Account tiers and billing — this is what turns the collection cap above into a quota
  the rules can actually check
- Export, so you are never locked in
- Search and filtering, once there are enough works for it to matter
- Tests for the two artwork forms and the CSV import run — the rules, the pure logic,
  and the photo, artwork-table and document components are covered

The design decisions behind the beta items, and the ones that are still open, are
written up in [project-plan.md](project-plan.md).

## Contributing

Contributions are welcome, particularly from people who collect. If something in the
schema does not match how you actually think about your own collection, that is a bug
worth reporting.

1. Fork the repository
2. Create a branch (`git checkout -b feature/my-change`)
3. Commit your changes
4. Push and open a pull request

Before opening a PR, `bun run check` must pass. It runs `tsc`, ESLint with type-aware
rules, and Prettier, so a type error, a lint warning, or a formatting diff will each
fail it.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

- [React](https://react.dev/)
- [Mantine](https://mantine.dev/)
- [React Router](https://reactrouter.com/)
- [Firebase](https://firebase.google.com/)
- [Vite](https://vite.dev/)
- [Zod](https://zod.dev/)
- [Darker Grotesque](https://fonts.google.com/specimen/Darker+Grotesque) and
  [BBH Bartle](https://fonts.google.com/specimen/BBH+Bartle)
