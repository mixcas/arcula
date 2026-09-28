# Custodia

Collection management for people who actually own the work.

Custodia is a web app for cataloguing a private art collection: your collections, the
artworks in them, and the details that make each one worth recording. It is free and
open source, self-hosted on your own Firebase project, and built for independent
collectors rather than galleries.

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

Custodia is built on the opposite assumption. The fields are the ones a collector
actually has, the types leave room for the awkward cases, and the data model refuses to
treat an unset field and an empty field as the same thing. It is a web app, so it is
not tied to one laptop, and it is open source, so the schema is yours to argue with.

## Project status

This is an early project. Both sides read and write Firestore; neither side is secured.
Here is the honest version:

| Area                                                 | State                                 |
| ---------------------------------------------------- | ------------------------------------- |
| Email/password auth, protected routes                | Working                               |
| Create, list, view collections                       | Working                               |
| Rename collection, set public/private flag           | Working                               |
| List a collection's artworks                         | Working                               |
| Add an artwork                                       | Working                               |
| Edit an artwork (writes to Firestore)                | Working                               |
| Public collection page (`/collection/:collectionId`) | Reads Firestore, renders, not secured |
| Password-protected collections                       | UI only, not enforced                 |
| Photo and certificate uploads                        | Not implemented                       |
| Deleting artworks or collections                     | Service functions exist, no UI        |
| Firestore security rules                             | **Not provided — see below**          |
| Tests                                                | None yet                              |

Two of those deserve emphasis because they are easy to misread from the code:

- **There are no Firestore security rules, and the public page is now the first
  unauthenticated reader in the app.** A rule set is the only thing that actually
  protects anything here. The public/private flag is a _rendering gate_, not access
  control: `PublicCollectionPage` checks `isPublic` and renders "This collection is
  private" when it is false, but the document was already read to find that out, and
  anyone who knows a document id can read it directly from the SDK. What the current
  ordering does buy you is narrower than it looks — a private collection's artworks are
  never even requested, so an unauthenticated visitor can pull down the collection
  document and nothing else. That is the exposure reduced, not removed. Write the rules
  before putting real data in.
- **The password control does not work.** The switch and the password field on the
  settings page hold local component state and are never saved; the page submits only
  `{ name, isPublic }`. `passwordHash` exists in the type definition, and the public
  page's prompt reads that real field, but nothing ever writes it. Note also that the
  prompt could not be a client-side check even once it is written: by the time it
  renders, the artworks are already in the browser. Real enforcement needs rules plus a
  verification path, or a callable function.

The public page renders artwork metadata but no images. Firebase Storage is
initialised and exported and then never used, so `photos` is always `[]` and the list
view shows placeholder blocks where a carousel will eventually go.

## Tech stack

- **Frontend**: React 19, TypeScript
- **UI**: Mantine v9
- **Forms**: `@mantine/form` with [Zod](https://zod.dev) v4 schemas
- **Routing**: React Router v7
- **Auth**: Firebase Authentication (email/password)
- **Database**: Firestore
- **Build**: Vite
- **Typography**: [Poppins](https://fonts.google.com/specimen/Poppins) for body text and
  [Gravitas One](https://fonts.google.com/specimen/Gravitas+One) for headings, loaded
  via `<link>` in `index.html` and applied in `src/theme.ts`

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
- A Firebase project

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

5. Before adding real data, write Firestore security rules. See
   [Project status](#project-status).

## Scripts

| Command           | Description                               |
| ----------------- | ----------------------------------------- |
| `bun run dev`     | Start the development server on port 3000 |
| `bun run build`   | Typecheck and build for production        |
| `bun run preview` | Preview the production build              |
| `bun run check`   | Typecheck, lint, and check formatting     |
| `bun run lint`    | ESLint, with type-aware rules             |
| `bun run format`  | Rewrite files with Prettier               |

## Project structure

```
src/
├── main.tsx                          # Entry point; wires theme + router
├── App.tsx                           # Routes
├── theme.ts                          # Mantine theme: fonts, sizes, spacing
├── components/
│   ├── ProductPage.tsx               # Public landing page
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
│       └── collection/NewCollectionPage.tsx
├── context/AuthContext.tsx           # Auth state provider, read via useAuth()
├── hooks/useAuth.ts                  # Context consumer hook
├── schemas/artwork.ts                # Zod schema + Firestore payload shaping
├── services/
│   ├── firebase.ts                   # Firebase init, exports db/auth/storage
│   ├── authService.ts
│   ├── collectionService.ts
│   └── artworkService.ts
├── types/index.ts                    # Artwork, Collection, ArtworkUpdate, FileReference
└── utils/slug.ts                     # {slug}-{id} route params ⇄ bare document ids
```

There is no global stylesheet. Typography, spacing and component defaults all come from
the Mantine theme, so a change to a font or size is a one-line change in `src/theme.ts`
rather than a hunt through CSS.

`firebase.ts` exports `db`, `auth` and `storage`. `storage` is the odd one out: it is
initialised and never used, which is why every artwork's `photos` array is empty.

## Roadmap

Roughly in order of how much they matter:

- Firestore security rules, and an index on any query that needs one — the public page
  reads without authentication, so this is the gap that matters most
- Real password protection for shared collections, with a server-side verification path
  rather than a prompt
- Photo and certificate uploads to Firebase Storage
- Delete for artworks and collections
- Export, so you are never locked in
- Search and filtering, once there are enough works for it to matter
- Tests around the schema and the load/save paths

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
- [Poppins](https://fonts.google.com/specimen/Poppins) and
  [Gravitas One](https://fonts.google.com/specimen/Gravitas+One)
