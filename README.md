# Arcula

Collection management for people who actually own the work.

Arcula is a web app for cataloguing a private art collection: your collections,
the artworks in them, and the details that make each one worth recording. It is
free and open source, self-hostable on your own AWS account, and built for
independent collectors rather than galleries.

## Naming

The product is **Arcula**, at [arcula.art](https://arcula.art). It was called
_Custodia_ until 28 September 2026, when the domain was bought and the
user-visible name changed with it: page title, landing page, both nav bars, and
the web app manifest. The packages (`@arcula/*`), the repository and the root
package were renamed to match, so the name is the same everywhere now.

## Why this exists

Once you own more than a handful of works, you need a record. The trouble is
that the three usual answers each break in a different way.

**Commercial platforms.** Artlogic and its competitors are genuinely good
software, built for galleries and institutions. The pricing is calibrated to
that market — per-seat, per-year, frequently with paid modules. For a collector
with forty works and no employees, that is a lot of money for software built
around a workflow you do not have.

**FileMaker.** Flexible, and it will fit almost anything you ask of it. It also
becomes yours to maintain. The file lives on one machine, backups are whatever
you remembered to schedule, and whoever built it stops being available right
when you need a change. A database is not a plan.

**A spreadsheet.** This is where most independent collectors actually land, and
it is the worst of the three for a reason that has little to do with the
software. A spreadsheet makes a hard promise about your collection: that it is a
table. One row per work, one column per attribute, every value in a column the
same shape as every other value in it.

That promise is the problem, because art is not tidy data. The date is "circa
1889", not a date. A work may be attributed to a workshop rather than a named
artist. What you paid and what you think it is worth now are different numbers,
and a single "value" column destroys the distinction. Provenance is a chain, not
a cell. Condition is a slow-moving fact about a physical object, not a property.

Spreadsheets do not fail at storing this. They fail silently. They let you
flatten it, and then you lose the distinctions without noticing, because a
spreadsheet never tells you that what you entered is worse than what you know.

Arcula is built on the opposite assumption. The fields are the ones a collector
actually has, the types leave room for the awkward cases, and the data model
refuses to treat an unset field and an empty field as the same thing. It is a
web app, so it is not tied to one laptop, and it is open source, so the schema
is yours to argue with.

## Project status

Early, and honest about what is missing:

| Area                                                    | State                                            |
| ------------------------------------------------------- | ------------------------------------------------ |
| Email/password auth, protected routes                   | Working (Better Auth)                            |
| Sign up                                                 | Working                                          |
| Sign in / sign out, password reset by email             | Working                                          |
| Account profile (name), change password                 | Working                                          |
| Create, list, view, rename collections                  | Working                                          |
| Collections per account                                 | One on the free tier, enforced by the API        |
| Public/private flag per collection                      | Working                                          |
| List a collection's artworks                            | Working                                          |
| Add and edit an artwork                                 | Working                                          |
| Per-artwork visibility flag (independent of collection) | Working                                          |
| Public collection and single-artwork pages              | Working (the "skins")                            |
| Photo uploads                                           | Working — server-side variants (5 + original)    |
| "Other Documents" uploads (images and PDFs)             | Working; owner-only, enforced by the media proxy |
| Soft delete of artworks (in bulk)                       | Working                                          |
| Restore a soft-deleted artwork                          | API route present; no trash UI yet               |
| CSV import of artworks                                  | Working                                          |
| Private-collection password protection                  | Not implemented                                  |
| Delete a collection, export, search                     | Not implemented (see the roadmap)                |

### How access control works

There is no security-rules layer to read: **the API is the only way to the
data.** Every read and write goes through a route that resolves the caller's
session and checks ownership or visibility before it touches a row. Media is the
same — nothing is served straight from object storage. `GET /api/v1/media?key=…`
proxies each object and re-checks visibility per request, so one authorization
rule covers both the database row and the bytes. A photo is never more readable
than the artwork it belongs to, and a document is owner-only.

Two visibility flags exist and are independent: a collection may be public while
individual works stay private, and a work flagged public is readable by direct
id even inside a private collection (the collection gate hides it from the page,
not from its own URL). Soft delete is a `deletedAt` stamp, not a removal: a
deleted work disappears from every list without its bytes going anywhere.

## Architecture

Arcula is a **Bun workspaces monorepo**. One product, a few packages, and one
deploy target — one Lambda behind one HTTP API:

- **`apps/web`** — the React 19 + Vite single-page app (Mantine v9), including
  the public collection pages (the "skins").
- **`apps/api`** — the Hono backend. Bun runs it in development; a Node 24
  Lambda runs it in production, and that same function serves the built SPA.
- **`packages/shared`** — the client⇄server contract: wire types, Zod schemas,
  file caps, the tier quota, and the pure ordering/slug helpers.
- **`packages/db`** — the Drizzle schema and the generated migration.
- **`infra/cdk`** — the AWS CDK stack.
- **`scripts`** — the local stack, the Lambda build, and the production deploy.

```
browser → API Gateway (custom domain) → Lambda (Hono) → Postgres / S3
```

Because the API and the SPA live in the same function, the app is same-origin in
production and there is no CORS to configure. A non-`/api` path returns the
built `index.html` (deep links included); `/api/*` runs the routes.

## Tech stack

- **Frontend**: React 19, TypeScript, Vite
- **UI**: Mantine v9, with `@mantine/form` and [Zod](https://zod.dev) v4 schemas
- **Routing**: React Router v7
- **Auth**: [Better Auth](https://www.better-auth.com/) (email/password)
- **API**: [Hono](https://hono.dev/)
- **Database**: PostgreSQL via [Drizzle ORM](https://orm.drizzle.team/)
- **Storage**: S3 (via the AWS SDK)
- **Media**: [Sharp](https://sharp.pixelplumbing.com/)
- **Mail**: Resend in production, SMTP locally
- **Infrastructure**: AWS CDK
- **Typography**: [Darker Grotesque](https://fonts.google.com/specimen/Darker+Grotesque)
  for body text and [BBH Bartle](https://fonts.google.com/specimen/BBH+Bartle)
  for headings, loaded via `<link>` in `index.html` and applied in
  `apps/web/src/theme.ts`

Validation lives in the shared Zod schemas (`packages/shared/src/schemas/`), used
by the API and the forms alike, so both sides accept and reject the same input.

## URL scheme

Every collection and artwork route carries a readable segment alongside the id:

```
/manage/collection/van-gogh-collection-7aV9xKqL2mP4nR8tY1zC
/manage/collection/van-gogh-collection-7aV9xKqL2mP4nR8tY1zC/artwork/the-potato-eaters-Yh8kD2mL5vN9qR
```

The name is cosmetic, and **only the id is ever a lookup key.** The slug lives in
the URL and nowhere else, which is what makes a rename safe: changing a
collection's name cannot orphan the artworks that point at it. Three
consequences worth knowing:

- **Bare ids still work.** An older link of the form
  `/collection/7aV9xKqL2mP4nR8tY1zC` loads fine and the page rewrites the address
  bar to the canonical slug using `replace`.
- **Parsing splits on the last hyphen**, not at a fixed offset, so it depends on
  neither the length nor the alphabet of the id — and ids are minted hyphen-free
  precisely so the cut can never land inside one.
- **The slug is never a lookup key.** Pass the parsed id to the API and the
  route param to `Link`/`navigate()`.

`packages/shared/src/slug.ts` is the only place that knows how the two relate.

## Getting started

### Prerequisites

- [Bun](https://bun.sh)
- Docker (via [colima](https://github.com/abiosoft/colima) on macOS) for the
  local Postgres
- `seaweedfs` and `mailpit` via Homebrew (the S3 stand-in and the mail catcher)

### Installation

```bash
git clone git@github.com:mixcas/arcula.git
cd arcula
bun install
```

Config comes from a single `.env` at the repo root. The values the local stack
needs:

```env
# Database (the local Postgres container)
DATABASE_URL=postgres://arcula:arcula@localhost:5432/arcula

# Auth
AUTH_SECRET=any-long-random-string
AUTH_BASE_URL=http://localhost:8000
CLIENT_ORIGIN=http://localhost:3000
CORS_ORIGINS=http://localhost:3000

# Object storage (SeaweedFS locally)
S3_ENDPOINT=http://127.0.0.1:9000
S3_ACCESS_KEY=any
S3_SECRET_KEY=any
S3_BUCKET=arcula
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true

# Mail (Mailpit locally)
EMAIL_PROVIDER=smtp
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
EMAIL_FROM=Arcula <noreply@arcula.test>

# The seed account (`bun run db:seed`)
SEED_EMAIL=owner@example.test
SEED_NAME=Owner
SEED_PASSWORD=changeme123
```

Never commit real secrets. `infra/cdk/.env` (which holds the production
`DATABASE_URL`, `AUTH_SECRET`, `CERT_ARN`, …) is gitignored.

### Run it

```bash
bun run dev
```

That brings up the local stack (Postgres, SeaweedFS, Mailpit), applies nothing,
and starts the API on [localhost:8000](http://localhost:8000) and the web app on
[localhost:3000](http://localhost:3000). On a fresh database, apply the migration
and seed the owner account first:

```bash
bun run db:migrate
bun run db:seed
```

## Scripts

All from the repo root:

| Command                                                     | Description                                                              |
| ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| `bun run dev`                                               | Bring up the stack, then the API (`:8000`) and web (`:3000`)             |
| `bun run stack:up` / `stack:down`                           | The local stack alone                                                    |
| `bun run build`                                             | Build the web app                                                        |
| `bun run preview`                                           | Preview the production web build                                         |
| `bun run check`                                             | Typecheck all packages + ESLint + Prettier — **the gate before a PR**    |
| `bun run lint` / `lint:fix`                                 | ESLint, with type-aware rules                                            |
| `bun run format` / `format:check`                           | Prettier                                                                 |
| `bun run test`                                              | All suites: `test:shared`, `test:db`, `test:api`, `test:web`, `test:cdk` |
| `bun run db:migrate` / `db:reset` / `db:seed` / `db:studio` | Drizzle against the local DB                                             |

`bun run test:api` and `bun run test:web` need the local stack; `test:web` also
starts an API automatically.

## Deploying

Production is one Lambda (API + SPA) behind an HTTP API, an S3 media bucket, and
an optional custom domain, all described in `infra/cdk`. Deploy through the
script, not a bare `cdk deploy`:

```bash
sh scripts/deploy-prod.sh
```

It builds the Lambda package (`scripts/build-lambda.sh`, smoked in a glibc
container first), deploys via CDK, applies the migration, seeds, re-deploys with
the real public URL, and runs `prod-verify` — a full end-to-end pass against the
live site. See `infra/cdk/README.md` for the stack's context values and outputs.

## Project structure

```
apps/
  web/                       # React 19 + Vite SPA
    src/
      App.tsx                # routes
      auth/                  # the Better Auth React client
      components/            # ProductPage, auth/, manage/, collection/
      hooks/                 # useAuth, useArtworkPhotos, useArtworkDocuments
      schemas/               # form schemas
      services/              # the API clients (api.ts is the transport)
      skins/                 # the public-view system
      theme.ts               # Mantine theme: fonts, sizes, spacing
  api/                       # Hono backend (Bun dev / Node 24 Lambda prod)
    src/
      app.ts                 # the Hono app: envelope, www redirect, mounts
      main.ts / lambda.ts    # the two entry points
      spa.ts                 # serves the built SPA in production
      auth.ts session.ts authorize.ts
      routes/                # me, media, collections, artworkMedia, artworks
      media/                 # keys, pipeline, variants, promote
      db.ts storage.ts serialize.ts errors.ts env.ts
packages/
  shared/                    # the client⇄server contract
  db/                        # the Drizzle schema + the generated migration
infra/
  cdk/                       # the AWS CDK stack
  Dockerfile                 # the scale-up container (documented, not deployed)
scripts/                     # stack, build, deploy
```

There is no global stylesheet. Typography, spacing and component defaults all
come from the Mantine theme, so a change to a font or size is a one-line change
in `apps/web/src/theme.ts` rather than a hunt through CSS.

### Favicon

`apps/web/public/favicon.svg` is the source of truth — a single-path glyph in
`#2B2927`. Every raster size beside it is generated from that file rather than
drawn separately: `favicon.ico` (16/32/48px, PNG-compressed), `favicon-32.png`,
`apple-touch-icon.png` (180×180), `icon-192.png`, `icon-512.png`, and
`icon-maskable-512.png`. The maskable variant is the one to regenerate if the
glyph changes: Android crops a maskable icon to a circle or squircle, so it is
the same path at 80% scale on an opaque `#2B2927` ground in `#F5F2ED`.

## Roadmap

Roughly in order of how much they matter:

- Real password protection for shared collections, with a server-side
  verification path
- Trash and restore for soft-deleted artworks, and a purge for long-dead ones
- Delete for collections
- Export, so you are never locked in
- Search and filtering, once there are enough works for it to matter
- Account tiers and billing — this is what turns the per-tier collection cap
  into a sold allowance
- An always-on container (`infra/Dockerfile`) as the scale-up path from Lambda:
  documented today, not deployed

The design decisions behind the product — the data model, the media pipeline,
and what is still open — are written up in [project-plan.md](project-plan.md).

## Contributing

Contributions are welcome, particularly from people who collect. If something in
the schema does not match how you actually think about your own collection, that
is a bug worth reporting.

1. Fork the repository
2. Create a branch (`git checkout -b feature/my-change`)
3. Commit your changes
4. Push and open a pull request

Before opening a PR, `bun run check` must pass. It runs `tsc`, ESLint with
type-aware rules, and Prettier, so a type error, a lint warning, or a formatting
diff will each fail it.

## License

MIT. See [LICENSE](LICENSE).

## Acknowledgments

- [React](https://react.dev/)
- [Mantine](https://mantine.dev/)
- [React Router](https://reactrouter.com/)
- [Hono](https://hono.dev/)
- [Better Auth](https://www.better-auth.com/)
- [Drizzle ORM](https://orm.drizzle.team/) and [PostgreSQL](https://www.postgresql.org/)
- [AWS](https://aws.amazon.com/) (Lambda, API Gateway, S3, CDK)
- [Sharp](https://sharp.pixelplumbing.com/)
- [Vite](https://vite.dev/)
- [Zod](https://zod.dev/)
- [Darker Grotesque](https://fonts.google.com/specimen/Darker+Grotesque) and
  [BBH Bartle](https://fonts.google.com/specimen/BBH+Bartle)
