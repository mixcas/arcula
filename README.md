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

| Area                                        | State                                                         |
| ------------------------------------------- | ------------------------------------------------------------- |
| Email/password auth, protected routes       | ✅                                                            |
| Sign up                                     | ✅                                                            |
| Sign in / sign out, password reset by email | ✅                                                            |
| Account profile (name), change password     | ✅                                                            |
| Create, list, view, rename collections      | ✅                                                            |
| Share a collection with collaborators       | ✅                                                            |
| Collections per account                     | Free tier cap: one owned collection; shared ones do not count |
| Public/private flag per collection          | ✅                                                            |
| List a collection's artworks                | ✅                                                            |
| Search a collection                         | ✅                                                            |
| Artwork list                                | ✅                                                            |
| Add and edit an artwork                     | ✅                                                            |
| Published/draft status per artwork          | ✅                                                            |
| Public collection and single-artwork pages  | ✅                                                            |
| Collection PDF                              | ✅                                                            |
| Photo uploads                               | ✅                                                            |
| "Other Documents" uploads (images and PDFs) | ✅                                                            |
| Soft delete of artworks (in bulk)           | ✅                                                            |
| Restore a soft-deleted artwork              | ✅                                                            |
| CSV import of artworks                      | ✅                                                            |
| Protected collections (password on Public)  | ✅                                                            |
| Delete a collection                         | ✅                                                            |
| Portable data export                        | Not implemented (see the roadmap)                             |

### How access control works

There is no security-rules layer to read: **the API is the only way to the
data.** Every read and write goes through a route that resolves the caller's
session and checks membership or visibility before it touches a row. Media is the
same — nothing is served straight from object storage. `GET /api/v1/media?key=…`
proxies each object and re-checks visibility per request, so one authorization
rule covers both the database row and the bytes. A photo is never more readable
than the artwork it belongs to, and a document is visible to the collection's
members only.

Collaboration is built: an account with a `collection_collaborators`
row reads every live work in the collection — drafts included — and a deleted
work by id, and edits the collection's works and settings as the owner does
([ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md)). What a
collaborator does not do is administer access: only the owner invites, resends
or revokes an offer, removes a collaborator, and transfers the collection.
The owner can invite an address by email; the link carries a single-use token,
and the invited account accepts or declines it. The invitation mail is the only
place the raw token exists, and accepting needs both that link and a signed-in
account whose address matches the invitation. The dashboard lists the offers
addressed to you and can decline them; acceptance is the mail's job. The
collection settings page's access card lets the owner resend or revoke an offer,
remove a collaborator, and transfer the collection to a collaborator; the
previous owner stays as a collaborator and can leave. A transfer mails the new
owner a link to the collection; a failed mail answers `emailSent: false` and
never undoes the invitation or the transfer.

Today the collection is the only gate: a visitor sees a published, live work
exactly when its collection is public, and a draft, a deleted work and a private
collection are one answer to them. A work is published or draft; it carries no
visibility flag of its own. Soft delete is a `deletedAt` stamp, not a removal: a
deleted work disappears from every live list without its bytes going anywhere.
Each collection's **Deleted** view lists its deleted works, most recently
deleted first, and restores one or several.

**The Collection PDF asks the same question.** The PDF route is public chrome,
not behind the sign-in guard: the ordinary collection and artwork reads decide
access, and the document always holds published, live works only — never a
draft, a deleted work or a document. It is generated in the browser, so the
API's only role is a font subset; the file is never stored.

**Protected** is a second condition on a **Public** collection, not a third
visibility state. The works and the visitor rule are unchanged; a non-member
must also get past the **Lock screen**. Membership bypasses the challenge, and a
**Private** collection stays closed even to an **Access grant**. The grant is
what a right password buys: a 32-byte token kept only as its SHA-256 hash,
delivered in the cookie `arcula_grant_{id}`, scoped to `/api/v1`
(`HttpOnly`, `SameSite=Lax`) and good for twelve hours. The path is that broad
because the media proxy is one route for every collection's bytes, so the same
grant covers the page and the bytes behind it. A grant admits exactly what a
visitor sees — published, live works, never a draft and never a document — and
the anonymous collection list excludes a Protected collection as it excludes a
Private one, so it is reachable only by its direct link. A refused collection
read answers `403 password-required` and folds to the Lock screen; unlock
attempts are throttled per address and collection in a fixed ten-minute
window, and changing the password revokes every outstanding grant. The
decision, and the alternatives it rejected, are in
[ADR-0005](docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md).

## Mail

Every mail Arcula sends is composed in one place, so the four that exist —
password reset, address verification, an invitation and an ownership-transfer
notice — arrive with one identity:

- **Sender.** `Arcula <noreply@arcula.art>`, read from `EMAIL_FROM`. A bare
  address is normalised to that form, so a configuration slip cannot send an
  anonymous-looking message.
- **Reply-To.** `Arcula <hello@arcula.art>` in production, read from
  `EMAIL_REPLY_TO`. The variable is optional; when it is unset, no Reply-To
  header is sent.
- **Body.** The hosted black wordmark on a white header, one call-to-action
  button with the same URL written out beneath it, a short line saying why the
  recipient got the message, and a plain-text twin built from the same facts. No
  tracking pixel, no remote fonts, and every URL — the logo's included — on the
  web app's origin.

`EMAIL_PROVIDER` is `mailpit` locally or `resend` in production; anything else
is a configuration error rather than a silent fallback. The work that is
deliberately not built yet — DMARC reporting and enforcement, and one-click
opt-out — is recorded with its exact records in [docs/mail.md](docs/mail.md),
which points back to [#75](https://github.com/mixcas/arcula/issues/75).

## Architecture

Arcula is a **Bun workspaces monorepo**. One product, a few packages, and two
environments of the same deploy shape — one Lambda behind one HTTP API:

- **`apps/web`** — the React 19 + Vite single-page app (Mantine v9), including
  the public collection pages (the "skins").
- **`apps/api`** — the Hono backend. Bun runs it in development; a Node 24
  Lambda runs it in production, and that same function serves the built SPA.
- **`packages/shared`** — the client⇄server contract: wire types, Zod schemas,
  file caps, the tier quota, and the pure ordering/slug helpers.
- **`packages/db`** — the Drizzle schema and the generated migrations.
- **`infra/cdk`** — the AWS CDK stack.
- **`scripts`** — the local stack, the Lambda build, and both deploys.

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
- **PDF**: [@react-pdf/renderer](https://react-pdf.org/) — generated in the browser
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
/manage/collection/van-gogh-collection-7aV9xKqL2m
/manage/collection/van-gogh-collection-7aV9xKqL2m/artwork/the-potato-eaters-Yh8kD2mL5v
```

The name is cosmetic, and **only the id is ever a lookup key.** The slug lives in
the URL and nowhere else, which is what makes a rename safe: changing a
collection's name cannot orphan the artworks that point at it. Four
consequences worth knowing:

- **Bare ids still work.** An older link of the form
  `/collection/7aV9xKqL2m` loads fine and the page rewrites the address bar to
  the canonical slug using `replace`.
- **New ids are ten base62 characters.** A minted id is ten characters of
  `0-9A-Za-z` (`packages/shared/src/ids.ts`); the longer hex ids minted before
  that change are permanent, and both lengths load, so old links keep working.
  See [ADR-0007](docs/adr/0007-ids-are-ten-base62-characters.md).
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

```bash
brew install colima docker docker-compose seaweedfs mailpit
colima start            # the Docker daemon — a Linux VM, so it must be started
                        # after every reboot
```

SeaweedFS and Mailpit run as native binaries, not containers — only Postgres
needs Docker.

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
EMAIL_PROVIDER=mailpit
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
EMAIL_FROM=Arcula <noreply@arcula.test>
# Optional: the monitored inbox a recipient can answer. Unset sends no
# Reply-To header, and the code never invents an address.
# EMAIL_REPLY_TO=Arcula <hello@arcula.test>

# The seed account (`bun run db:seed`)
SEED_EMAIL=owner@example.test
SEED_NAME=Owner
SEED_PASSWORD=changeme123
```

Never commit real secrets. `infra/cdk/.env` (which holds the production
`DATABASE_URL`, `AUTH_SECRET`, `CERT_ARN`, …) is gitignored.

### Run it

On a fresh database, apply the migration and seed the owner account first:

```bash
bun run stack:up      # Postgres, SeaweedFS, Mailpit
bun run db:migrate
bun run db:seed
```

Then start the app:

```bash
bun run dev
```

`dev` runs `stack:up` again (it is idempotent — services already up are left
alone) and then starts the API on [localhost:8000](http://localhost:8000) and
the web app on [localhost:3000](http://localhost:3000). Sign in with the
`SEED_EMAIL` / `SEED_PASSWORD` from `.env`.

### The local stack

`bun run stack:up` starts three services and `bun run stack:down` stops them.
Both are safe to re-run, and both take a list of service names to act on that
subset only (`sh scripts/stack-up.sh s3 mailpit`):

| Service    | Role             | Runs as                     | Address                  |
| ---------- | ---------------- | --------------------------- | ------------------------ |
| `postgres` | the database     | `docker-compose`, colima VM | `:5432`                  |
| `s3`       | object storage   | native SeaweedFS binary     | `:9000` (S3 API)         |
| `mailpit`  | the mail catcher | Homebrew service            | `:1025` SMTP, `:8025` UI |

- **Postgres is the only service that needs Docker.** Its container is defined
  in `docker-compose.yml`, keeps its data in the `postgres-data` volume, and
  collides with any other Postgres already holding `:5432`.
- **Any mail the app sends is caught by Mailpit** — open
  [localhost:8025](http://localhost:8025) to read password resets, address
  verifications and invitations. Nothing leaves the machine.
- **A missing Docker socket means colima is stopped.** That is the most common
  first failure:

  ```
  failed to connect to the docker API at unix:///Users/…/.colima/default/docker.sock
  ```

  Start it with `colima start`, then re-run. To have it start at login instead:
  `brew services start colima`. If it reports running but the socket is still
  missing, the VM is stale — `colima stop && colima delete && colima start`
  recreates it (and the `postgres-data` volume with it), after which migrate and
  seed again.

- **`ECONNREFUSED` from the API means Postgres is not published on `:5432`**,
  not that the credentials are wrong. If `stack:up` says `postgres: already up`
  but every query is refused, the container came back from a saved state with
  its port mapping missing — `docker-compose up -d --force-recreate postgres`
  rebuilds the mapping and keeps the `postgres-data` volume, so the data stays.
- **A recreated volume is an empty database.** If the tables are gone
  (`/api` login fails with `relation "user" does not exist`), the volume was
  replaced — recreated by `colima delete`, or swapped for a worktree's
  differently-named project volume. Recover with `bun run db:migrate` then
  `bun run db:seed`; nothing can bring back rows that lived in the old volume.
- **SeaweedFS binds a LAN address at start.** If the machine changes networks
  (a laptop that moved), storage calls fail with nothing pointing at the cause.
  Restart just that service: `pkill -f "weed server"` then
  `sh scripts/stack-up.sh s3`.
- **State lives in `.stack/`** (SeaweedFS data, pid files, logs) and is
  gitignored. Logs for a service that will not come up are in `.stack/logs/`.
- **`stack:down` keeps data.** It stops the containers and processes but leaves
  the volumes and `.stack/`. `bun run db:reset` is what wipes the tables and the
  objects, then migrates and seeds again — a clean slate in one command. It
  starts Postgres and SeaweedFS itself.

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

An environment is one Lambda (API + SPA) behind an HTTP API, an S3 media
bucket, and an optional custom domain, all described in `infra/cdk`. There are
two:

| Environment | Address                  | Deploys from | Purpose                                           |
| ----------- | ------------------------ | ------------ | ------------------------------------------------- |
| dev         | `https://dev.arcula.art` | `dev`        | a rehearsal space, public and kept out of indexes |
| production  | `https://arcula.art`     | `main`       | the product a collector uses                      |

They are the same thing twice. Dev has its own database, media bucket,
certificate, auth secret and mail key, so nothing done there can reach
production's data — and it is disposable: dev's schema and bucket can be
dropped and rebuilt from the branch.

`dev` is the integration branch and the repository's default. Changes land
there first, and a release is a pull request from `dev` into `main`. Merging is
deploying: CI deploys whichever environment's branch moved, through the same
scripts you can run yourself. The scripts, not a bare `cdk deploy`:

```bash
sh scripts/build-lambda.sh prod   # or: dev — each writes its own artifact
sh scripts/deploy-prod.sh         # or: sh scripts/deploy-dev.sh
```

The two deploy scripts are thin wrappers over one shared sequence
(`scripts/deploy.sh`): build the environment's CDK app, deploy, resolve the
URL, apply the migration, seed the owner account, re-deploy with the real
public URL, and run `deploy-verify` — a full end-to-end pass against the live
site. Values come from `infra/cdk/.env.<env>` (`infra/cdk/.env` is
production's fallback), which is gitignored; see `infra/cdk/README.md` for the
stack's context values, its outputs and the first-run order.

`scripts/provision-cert.mjs <host>` provisions a host's TLS certificate and
prints the DNS records to publish, `scripts/provision-oidc.mjs` provisions the
GitHub OIDC provider and the two branch-pinned deploy roles,
`sh scripts/setup-dev.sh` walks dev's first run, and
`sh scripts/reset-dev.sh --yes` drops the dev schema and empties the dev
bucket.

The reasoning behind two branches and two environments, and behind their
sharing one AWS account, is in
[ADR-0001](docs/adr/0001-two-branches-two-environments.md) and
[ADR-0002](docs/adr/0002-one-account-one-bootstrap.md); the product's
vocabulary is in [GLOSSARY.md](GLOSSARY.md).

## Project structure

```
apps/
  web/                       # React 19 + Vite SPA
    src/
      App.tsx                # routes
      auth/                  # the Better Auth React client
      components/            # ProductPage, auth/, manage/, collection/,
                             # invitation/, pdf/
      hooks/                 # useAuth, useArtworkPhotos, useArtworkDocuments,
                             # useUploadPool
      schemas/               # form schemas
      services/              # the API clients (api.ts is the transport)
      skins/                 # the public-view system
      theme.ts               # Mantine theme: fonts, sizes, spacing
      userSettings.ts        # the stored Table/Grid view and sort
      utils/                 # artworkDocuments, csv, invitation, returnPath
  api/                       # Hono backend (Bun dev / Node 24 Lambda prod)
    src/
      app.ts                 # the Hono app: envelope, www redirect, mounts
      main.ts / lambda.ts    # the two entry points
      spa.ts                 # serves the built SPA in production
      access.ts authorize.ts artworkRead.ts auth.ts invitations.ts
      collectionPassword.ts collectionGrants.ts unlockThrottle.ts
      session.ts clientAddress.ts
      routes/                # me, access, invitations, media, collections,
                             # artworkMedia, artworkSave, artworks, pdf
      media/                 # keys, pipeline, populations, variants, promote
      email/                 # SMTP locally, Resend in production
      db.ts storage.ts serialize.ts errors.ts env.ts pdfFontSubset.ts
packages/
  shared/                    # the client⇄server contract
  db/                        # the Drizzle schema + the generated migrations
infra/
  cdk/                       # the AWS CDK stack
  Dockerfile                 # the scale-up container (documented, not deployed)
scripts/                     # stack, build, provision, reset, deploy
docs/adr/                    # decision records, with rejected alternatives
docs/specs/                  # implementation-ready feature specs
docs/plans/                  # working plans
docs/mail.md                 # mail identity, and the deferred DMARC/opt-out work
GLOSSARY.md                  # the product's own vocabulary
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

The three larger product features below are ideas, not commitments; none is
built. The smaller items follow, roughly in order of how much they matter.

### Quick look

A side panel on a collection's manage page that opens an artwork without leaving
the list: the full record, with shortcuts to its public page and its Edit form.
A reading and navigation aid, not a second editor.

### Catalogues

A **Catalogue** is a curated subset of a Collection's artworks, published on its
own address with its own audience. It would reuse the Collection's model —
Public or Private, an optional password, collaborators — and have its own PDF.
It selects from the Collection rather than copying or owning the works.

- A collector shortlisting works for a gallery considering an exhibition,
  shared as a password-protected link or a PDF.
- A collector or gallerist taking five works to an art fair, with a public page
  carrying those works' information.

Giving a Catalogue its own public address would make it the first public surface
besides a Collection, so its access model needs its own decision before
implementation.

### Artwork location

Where each work is now — at home, in storage, on loan or in transit — with the
place (a gallery, storage facility, art fair, another address), the dates, and
the moves that keep the inventory accurate as works travel. Distinct from
**Place of origin**, which records where the work came from.

### Smaller items

- Purge and a retention window for soft-deleted artworks (the Deleted view
  restores them)
- A portable data export (CSV/JSON), so you are never locked in — the Collection
  PDF is a printed document, not your data
- Filtering beyond the collection search that exists today
- Account tiers and billing — this is what turns the per-tier collection cap
  into a sold allowance
- An always-on container (`infra/Dockerfile`) as the scale-up path from Lambda:
  documented today, not deployed

The design decisions behind the product — the data model, the media pipeline,
and what is still open — are written up in the [design record](DESIGN.md).

## Contributing

Contributions are welcome, particularly from people who collect. If something in
the schema does not match how you actually think about your own collection, that
is a bug worth reporting.

1. Fork the repository
2. Branch from `dev`, the default branch (`git checkout dev`, then
   `git checkout -b feat/my-change`)
3. Commit your changes
4. Push and open a pull request **against `dev`**

Before opening a PR, `bun run check` must pass. It runs `tsc`, ESLint with
type-aware rules, and Prettier, so a type error, a lint warning, or a formatting
diff will each fail it. CI runs the same command, so green locally means green
in the pipeline.

A change reaches production only by release: a pull request from `dev` into
`main`, merged by the maintainer. The working rules — branch model, the two
things never to commit, and why a revert is only safe for an additive schema
change — are in [AGENTS.md](AGENTS.md), which is written for contributors as
well as agents.

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
