# Arcula Agent Guide

> The design record lives in **`DESIGN.md`** — the as-built description
> of the product, its data model and its architecture. This file is the working
> guide: layout, commands, the sharing rules, and the test doctrine.
> `README.md` is the user-facing overview.
>
> The product is **Arcula** (`arcula.art`), and the packages, the repository
> and the identifiers all say `arcula` too. The product's own vocabulary is in
> **`GLOSSARY.md`**; decisions with their rejected alternatives are in
> **`docs/adr/`**, and implementation-ready feature specs are in
> **`docs/specs/`**.
>
> **Sharing is built.** Access is membership: the owner and every collaborator
> read and edit one catalogue, invitations are mailed single-use tokens, and
> ownership transfers without moving media. The model is accepted in
> [ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md); the
> as-built detail is in **Sharing** below.
>
> **Catalogue passwords are built too.** A password is a second condition on a
> public catalogue, answered by an Access grant in a per-catalogue cookie, and
> the unlock route is throttled per address and catalogue; the design record is
> [ADR-0005](docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md)
> and the as-built detail is under **Protected catalogues**.

Arcula is a **Bun workspaces monorepo**. One product, a few packages, and two
environments of one deploy shape:

- **`apps/web`** — the React 19 + Vite SPA (Mantine v9), including the public
  catalogue pages (the "skins").
- **`apps/api`** — the Hono API, run by Bun in dev and by a Node 24 Lambda in
  prod. It also serves the built SPA.
- **`packages/shared`** — the client⇄server contract: types, Zod schemas, the
  file caps, the photo-ordering helpers.
- **`packages/db`** — the Drizzle schema and the generated migrations.
- **`infra/cdk`** — the CDK stack: one Lambda (API + SPA), an S3 media bucket,
  an HTTP API, and the optional custom domain. One class, instantiated once per
  environment.
- **`scripts`** — the local stack, the Lambda build, and both deploys.

The API and the SPA deploy as **one Lambda behind one HTTP API**, so the app is
same-origin in production and there is no CORS to configure.

## Branches and environments

Two long-lived branches, each feeding one permanent environment. The reasoning
is [ADR-0001](docs/adr/0001-two-branches-two-environments.md); this is the
working rule.

| Branch | Environment               | Deploys on |
| ------ | ------------------------- | ---------- |
| `dev`  | dev — `dev.arcula.art`    | every push |
| `main` | production — `arcula.art` | every push |

- **`dev` is the default branch** and the integration branch. **Cut every
  feature branch from `dev`**, and open the PR against `dev`.
- **Feature PRs are squash-merged into `dev`** — one commit per change, so its
  log stays readable.
- **A release is a PR from `dev` into `main`, merged as a merge commit, never
  squashed.** Squashing it would lose the release boundary and make the next
  release PR replay shipped work as ghosts.
- **A hotfix branches from `main`** and is back-merged into `dev`.
- `main` is production only: its log is the list of what has shipped.
- Both branches are protected: a PR is required, the `check` status is
  required, force pushes and deletion are blocked. Required approvals are off
  (a solo maintainer cannot approve their own PR), and administrator bypass
  stays possible. Squash and merge-commit are enabled, rebase is not, and
  merged branches are deleted.
- **Merging is deploying.** `check.yml` runs the gate on PRs into either
  branch; `deploy-dev.yml` and `deploy-prod.yml` run the gate again on push,
  then build and deploy through `scripts/deploy.sh` — the same script a laptop
  runs. Both can be `workflow_dispatch`ed to re-run a deploy without a new
  commit. Dev cancels a superseded run; production never cancels, so two
  migrations cannot interleave against the production database.
- Dev is public and noindexed, disposable, and has its own database, bucket,
  certificate, `AUTH_SECRET` and Resend key. Its `/api/health` reports the
  deployed commit; production's does not.
- The limits of the isolation are real and recorded: the two environments
  share one AWS account and one CDK bootstrap, so a modified `dev` workflow
  could reach production's stack — but cannot read production's secrets. See
  [ADR-0002](docs/adr/0002-one-account-one-bootstrap.md).

### Two rules that are load-bearing

The repository is public, so both of these are not style preferences:

- **Never commit a secret.** Not in a file, not in a test, not in a workflow,
  not in a logged command. Per-environment values live in `infra/cdk/.env.<env>`
  (gitignored) and in the GitHub Environments; `SEED_*`, `DATABASE_URL`,
  `AUTH_SECRET`, `RESEND_API_KEY` and `CERT_ARN` are secrets or variables
  there, never in the tree.
- **Never use the fork-exposing pull-request event.** A workflow that needs to
  run on a PR uses the plain `pull_request` event, never
  `pull_request_target`: the latter runs with the repository's secrets and
  hands them to a fork's code. `check.yml` is the model — it reads the PR's
  code and needs no secret at all.

### Migrations are forward-only

`packages/db/migrations/` is generated and applied, never reversed. A deploy
runs them forward — dev's on dev's deploy, production's on its own — and
nothing un-migrates a database. So **reverting a commit redeploys the code but
leaves the schema where it was**: a revert is safe only when the release's
change was additive (a new nullable column, a new table, a new index). A revert
of a destructive migration (a dropped column or table, a tightened constraint)
leaves the old code running against a schema that no longer matches it, and
needs a compensating migration written by hand.

Hand edits to a generated migration are deliberately few, and there are exactly
three: a data backfill, the add-nullable → backfill → set-not-null sequence, and
a grant revoke drizzle-kit cannot model; `packages/db/README.md` lists them and
`0006_enable_rls` carries the third.

**A schema change ships alone.** `scripts/deploy.sh` deploys the Lambda before
it migrates, so a release carrying both a new table and the code that reads it
would serve requests against a schema that is not there yet. Ship the migration
in its own release, then the code. When the change is additive — a new nullable
column, a new table, a new index — the intermediate release is safe because the
old code ignores it. A column that must end up `NOT NULL` is added nullable in
that release and tightened in the release that writes it; one migration that
sets `NOT NULL` would break the old code's inserts.

## Key commands

All from the repo root (`bun run <script>`):

| Command                                                     | What it does                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `bun run dev`                                               | Bring up the local stack, then the API (`:8000`) and web (`:3000`)                   |
| `bun run stack:up` / `stack:down`                           | The local stack alone                                                                |
| `bun run check`                                             | Typecheck all packages + ESLint + Prettier — **the gate before a PR**                |
| `bun run test`                                              | All suites in parallel: `test:shared`, `test:db`, `test:api`, `test:web`, `test:cdk` |
| `bun run build`                                             | Build the web app                                                                    |
| `bun run db:migrate` / `db:reset` / `db:seed` / `db:studio` | Drizzle against the local DB                                                         |

Deploy is a shell script, not a package script. `sh scripts/deploy-prod.sh` and
`sh scripts/deploy-dev.sh` are thin wrappers over the one sequence in
**`scripts/deploy.sh`** (cdk build → `cdk deploy` → resolve the URL → migrate →
seed → re-deploy with the real `PUBLIC_URL` → `deploy-verify`). CI calls the
same two scripts, so the sequence has one definition.
`sh scripts/build-lambda.sh <prod|dev>` builds that environment's zip first;
`scripts/lambda-smoke.mjs` smokes it in a glibc container before it ships —
except on a CI runner, which sets `SKIP_LAMBDA_SMOKE=1` (it has no local
stand-ins), where the deploy's own end-to-end pass on the deployed Lambda is
the equivalent proof. `scripts/write-env-file.sh <env>` writes the
environment's file from a CI run's GitHub Environment values.
`scripts/provision-cert.mjs` and `scripts/provision-oidc.mjs` provision a
host's certificate and the GitHub deploy roles; `scripts/reset-dev.sh --yes`
drops the dev schema and empties the dev bucket; `scripts/setup-dev.sh` walks
dev's first run interactively. The first-run order, in the order it must be
performed, is in `infra/cdk/README.md`.

The **local stack** is Postgres (a docker/colima container), SeaweedFS (the S3
stand-in, native on `:9000`) and Mailpit (native SMTP on `:1025`, UI `:8025`).
`scripts/stack-up.sh` is idempotent.

## Where things live

**`apps/api/src/`**

- `app.ts` — the Hono app: the error envelope, the `www`→configured-origin
  redirect, CORS, route mounting. `main.ts` runs it under Bun; `lambda.ts` is
  the Lambda handler. `env.ts` reads the configuration once; `responsePolicy.ts`
  holds the pure decisions derived from it.
- `access.ts` — the access verdicts, pure over loaded rows: the membership
  fact (owner, collaborator, nobody) and the visitor rule (the catalogue is
  the only gate, with an Access grant as the second condition on a Protected
  one); `authorize.ts` loads the catalogue, the viewer's membership row and
  the row each route acts on, reads the grant (`grantHeld`, from the cookie
  named for that catalogue) where a visitor needs one, and answers the one
  write question — `requireMemberCatalogue` / `requireMemberArtwork`, owner or
  collaborator — that every write path asks.
- `catalogueGrants.ts` — the Access grant's pure facts: `mintGrantToken`,
  `hashGrantToken`, `grantCookieName` and `isGrantUsable` (not past
  `expiresAt`); `GRANT_TTL_MS` (twelve hours) is the one number behind both the
  cookie's `Max-Age` and the row's expiry. No database and no Hono — the unlock
  route mints and stores, the read paths load the row and ask this.
- `cataloguePassword.ts` — hashing (`hashPassword`) and the check
  (`verifyPassword`) for a catalogue's password.
- `catalogueScope.ts` — the membership scope the reads share: the left join
  to the caller's collaborator row and the live-catalogues where-clause — the
  catalogues the caller owns or collaborates on — used by the signed-in
  `/catalogues` list and the Artist Name aggregate so the two cannot drift.
- `unlockThrottle.ts` — the throttle's policy and nothing else: `UNLOCK_WINDOW_MS`
  (ten minutes, **fixed**, and why not sliding) and `unlockWindowStart`, which
  floors an attempt to the window it belongs to. `clientAddress.ts` — the
  address the counter is keyed by: the Lambda entry writes the gateway's
  `sourceIp` into `x-arcula-client-ip` with `set`, so a client cannot choose its
  own, and no forwarding header is ever trusted; locally the header is absent
  and every attempt shares one bucket.
- `artworkRead.ts` — the single read path for Artworks: one work (the
  Catalogue, the work, its photos, documents and Variants), or a Catalogue's
  list — live, or the member-only Deleted one, most recently deleted first —
  loading the Catalogue and each child table once for the whole page (at most
  five queries, six for a collaborator's membership row) and returning ok,
  not-found, unauthorized or forbidden for the list. The live list also takes
  an optional member-only search (`q`), refused ahead of the visitor verdict and
  filtering the rows the list already read — drafts included, deleted works
  never. The verdict is
  `access.ts`'s over rows the module loads through `authorize.ts`, with the
  request's grant validity handed in as a fact; the module carries no Hono type
  and the route owns the wire code. The save routes read their work back
  through it.
- `artistNames.ts` — the caller's Artist Name suggestions for the artwork form:
  the aggregate read over live works in the live catalogues the caller owns or
  collaborates on (the caller scope recorded in
  [ADR-0009](docs/adr/0009-artist-name-suggestions-are-caller-scoped.md)), and
  the pure collapse of case and accent variants to one most-used spelling,
  ordered by use then display name and silently capped at 2,000. No Hono type;
  the route owns the wire and `401`, and the future curated index can replace
  the module's source behind the same contract.
- `spa.ts` — splits `/api/*` from the SPA and serves `WEB_DIST`.
- `auth.ts` — the Better Auth instance (Drizzle adapter). `session.ts` resolves
  the caller.
- `invitations.ts` — the pure token algebra (`mintInvitationToken`,
  `hashInvitationToken`) and the two questions the routes ask
  of a row: `isInvitationUsable` (pending and not past `expiresAt`) and
  `isInvitationResendable` (pending, and the last issue older than the
  60-second cooldown — expiry is deliberately not part of it).
- `routes/` — `catalogues` (the reads, the settings write, `…/unlock`, the
  import, the Deleted list and the batch delete/restore), `access` (the access
  read, removal, leaving and transfer), `invitations` (create,
  resend, revoke, public preview, accept, decline, the invitee's inbox and
  in-app decline), `artworks`, `artworkSave` (the write half of a save: the
  staged entries promoted, upserted and deleted once the payload validates),
  `artistNames` (the caller's suggestion read), `me`, `media` (the object
  proxy), `artworkMedia` (the presign and process routes: the browser PUTs the
  bytes straight to storage under the caller's own staging prefix, and process
  is the point the server validates them —
  [ADR-0012](docs/adr/0012-media-uploads-go-direct-to-storage.md)).
- `media/` — `keys.ts` (the object-key algebra), `pipeline.ts` (Sharp),
  `populations.ts` (what distinguishes photos from documents: tables, variants
  and key shape; the caps and types are the shared guard's),
  `variants.ts` (the geometry), `promote.ts`
  (staged → final), `stagedName.ts` (the original's filename, the one thing
  that rides a signed header rather than a key or a query).
- `email/provider.ts` — SMTP locally, Resend in production. Sharing adds exactly
  two mails, the invitation and the ownership-transfer notice; a provider
  failure surfaces as `emailSent: false`, never as a failed write.
- `storage.ts` — the S3 client (`S3_ENDPOINT` is required; it refuses a default)
  and `presignPut`, the short-lived single-object URL the browser PUTs a staged
  original to ([ADR-0012](docs/adr/0012-media-uploads-go-direct-to-storage.md)).

**`packages/shared/src/`** — the contract: `schemas/` (access, artwork,
artworkImport, artistNames, catalogue, invitation, document, media, user),
`artworkPhotos.ts` (the `order` invariant, `sortPhotos`/`reindexPhotos`, the
`photoUrl` ladder), `artworkSearch.ts` (the ten-field Catalogue search
predicate, its caps, the query suffix helper and `normalizeSearchText`, which
Artist Name suggestions also collapse on), `caps.ts` (file caps + accepted
types), `stagedUpload.ts` (the headers a staged presigned PUT signs — the list
the media bucket's CORS rule must allow, read by path from `infra/cdk`'s test
because that package is not a workspace member), `limits.ts` (the
per-tier catalogue cap), `email.ts` (`normalizeEmail`, the trim-and-lowercase
both sides use),
`invitationTime.ts` (the invitation durations and the two questions the access
card asks of a row), `ids.ts` (the one mint — `ID_LENGTH`, `ID_ALPHABET`,
`MINTED_ID_SHAPE_RE`, `mintId`; ten base62 characters, older ids permanent),
`slug.ts`, `types.ts`. `schemas/artwork.ts` holds `artworkStatusSchema` and
`artworkAvailabilitySchema` (`available`/`reserved`/`sold`/`on-consignment`,
both pinned to their client types); the save schemas accept availability as
`.nullable()`, the create treating an absent key as null and the update as
"leave it alone", and the read schema requires the key because the serializer
always emits it. The API never validates it against the catalogue's kind — a
Collection's work may carry one. `schemas/catalogue.ts` holds
`catalogueKindSchema` (`portfolio`/`collection`/`inventory`, pinned to
`CatalogueKind`); the create
schema accepts `kind` defaulting to `collection` and the update schema does
not, so the kind is the one field fixed at creation. `schemas/document.ts`'s
`catalogueReadSchema` carries it, and the API's serializer validates a row
against the three values (`catalogueKindOf`) before emitting it.

**`apps/web/src/`** — `App.tsx` routes; `catalogueSurface.ts` is what a kind
means for the surface, as data: the kind's colour (`kindColor`, a literal union
the screens turn into a CSS variable through `kindColorVar`), the labels, the
market states a kind offers (a Portfolio's three, an Inventory's four, a
Collection's none) with their words, whether the catalogue's name is the
artist's name, and the v1 artwork field table — every
field visible, only `title` and `artistName` required. The field table is the
data a later per-kind hiding will read; no v1 screen consumes
`visible`/`required`, and a screen that reads the module uses the labels, the
availability values, `availabilityFor`'s default and `newArtworkForm` — what a
create form starts as on one kind, values and Artist Name line together.
`services/` are the API
clients (`api.ts` is the transport); `auth/` is the Better Auth React client;
`telemetry/logRocket.ts` is the session-replay hook, redacted at the client
([ADR-0011](docs/adr/0011-session-replay-is-redacted-at-the-client.md));
`components/manage` and `components/catalogue`; `skins/` is the public-view
system. The artwork Add and Edit pages load the catalogue for its kind; a
Collection's form renders no availability control and sends no key, while a
Portfolio or an Inventory defaults a surfaced work with no stored state to
`available` through `availabilityFor`, and offers only the states that kind
carries. The Add page also opens a Portfolio's new work credited to the
portfolio's artist, and it builds every kind's form from that one surface answer
rather than branching on the market state; a typed name wins, and the Edit page
shows the artist the work records.
The manage page and the Deleted view pass `showAvailability` down from
the kind; no public page renders availability at all, and the API emits it on a
member read only.

**`packages/db/src/index.ts`** — the Drizzle tables (`user`, `session`,
`account`, `verification`, `catalogues`, `catalogueCollaborators`,
`catalogueInvitations`, `catalogueAccessGrants`, `catalogueUnlockAttempts`,
`artworks`, `artworkPhotos`, `artworkPhotoVariants`, `artworkDocuments`) and the
`schema` object the adapter consumes. The Drizzle entity is `catalogues` and the
relation property is `catalogueId`, but the physical Postgres tables keep their
`collections` / `collection_*` names and the physical column stays
`"collectionId"` — a storage rename is a non-additive migration (ADR-0010). The
two sharing tables are in the schema
and `catalogueCollaborators` is read on every
access question; the invitation routes write `catalogueInvitations`, while the
code that writes `catalogueCollaborators` covers acceptance, removal, leaving
and transfer, which swaps the two membership rows and rewrites the owner.
`catalogues.passwordHash` is the one password fact; `catalogueAccessGrants`
holds a grant's token hash and its expiry, and `catalogueUnlockAttempts` is the
unlock throttle's counter — `(ip, catalogueId, windowStart)` with `attempts`,
written and read by the unlock route alone.
`packages/db/migrations/` is generated; hand edits are the documented exception,
and there are exactly three: a data backfill appended to the generated file, the
add-nullable → backfill → set-not-null sequence for a column that cannot be
added `NOT NULL` on an existing table, and a grant revoke drizzle-kit cannot
model — it renders schema, never grants, so `0006_enable_rls` appends its
guarded block by hand. The sharing schema is the worked example of the first
two: those migrations are described under **Sharing** below and in
`packages/db/README.md`; the third is in that README and `0006_enable_rls.sql`.

**`infra/cdk/src/arcula-stack.ts`** — the stack. `contextValue("DOMAIN")` gates
the custom domain; the apex and `www` are **separate** `DomainName` pairs that
each get their own regional endpoint — an HTTP-API custom domain serves only its
exact host, so pointing `www` at the apex target is the `403` the layout is built
to avoid.

## How a request flows

```
browser → API Gateway (custom domain) → Lambda (Hono) → Postgres / S3
```

In production the SPA is part of that same Lambda: a non-`/api` path returns the
built `index.html` (deep links included), and `/api/*` runs the routes. Media
never goes straight from S3 — `GET /api/v1/media?key=…` proxies the object and
re-checks visibility per request, which is what lets one authorization layer
cover both the row and the bytes.

## Sharing

Sharing is membership, and it is built. `catalogues.userId` is the one owner
fact; `catalogueCollaborators` holds everyone else, the owner is not
duplicated there, and a membership row is the authorization fact for everything
inside the catalogue. `access.ts` answers the questions over loaded rows and
`authorize.ts` loads the catalogue and the viewer's row, so the owner and every
collaborator read every live work in the catalogue — drafts included — and a
deleted work by id, and read its documents at every status. A deleted work is in
no live list; the catalogue's **Deleted** view lists the stamped works, most
recently deleted first, and restores one or many, and a deleted work's Edit page
disables Save and the media uploaders and restores in place. Every write path
asks the same membership question through `requireMemberCatalogue` /
`requireMemberArtwork`.

The boundary is access administration. A collaborator changes every setting
(public/private included), creates, edits, imports, bulk-deletes, restores and
sweeps exactly as the owner does, and may leave; the owner alone invites,
resends, revokes, removes and transfers, and cannot leave without transferring.
`GET /catalogues/:id/access` is member-readable: the owner and collaborators
see who has access, while the pending offers are the owner's alone.
`GET /catalogues` returns owned and shared rows together, each with `role` and
a shared row with `ownerName`; the tier cap counts owned live catalogues only,
so deleting a catalogue frees the slot. The visitor rule is unchanged: a
collaborator is never a visitor, and the catalogue remains the visitor's only
gate
([ADR-0003](docs/adr/0003-the-collection-gates.md)).

`catalogueInvitations` carries the offer: one pending row per catalogue and
lowercased email, the SHA-256 hash of a single-use token, a seven-day expiry
and a status. The raw token exists only in the mail. Acceptance needs the
mailed token and a session whose email matches the invited address; the
invitee's `GET /me/invitations` lists their live offers and can decline one,
because acceptance is the mail's job.

**Two mails, best effort.** Sharing adds exactly two: the invitation mail, which
links to `CLIENT_ORIGIN/invite/:token`, and the ownership-transfer notice, which
links the new owner to the manage page. Both go through `email/provider.ts`
(SMTP locally, Resend in production). The invitation row is written before the
mail is attempted, so a provider failure answers `emailSent: false` and the
owner can resend once the 60-second cooldown has passed; a transfer commits
before its notice, so a failed notice never undoes the transfer.

**The media namespace and the two migrations.** Final object keys use the
catalogue's `mediaNamespaceId`, fixed at creation, so a transfer changes the
owner and the artwork mirror and moves no object: existing URLs keep working.
Staging keys use the uploader's id, so one collaborator's unsaved upload is
never under another's prefix. The schema shipped in two releases, one per step:
`0003_shared_collections` created the two sharing tables and added
`mediaNamespaceId` nullable, backfilled from `userId`; the feature code read
`mediaNamespaceId ?? userId` through the gap; and
`0004_media_namespace_not_null` backfilled only the rows the old code wrote in
between (`WHERE "mediaNamespaceId" IS NULL`) and set the column `NOT NULL`.
`0003` shipped alone, the code followed, and `0004` tightened afterwards — the
worked example of the forward-only rule above. The full schema narrative is in
`DESIGN.md`; the migration detail is in `packages/db/README.md`.

## Protected catalogues

A password is a **second condition on a public catalogue**, never a third
visibility state ([ADR-0005](docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md)).
`catalogues.passwordHash` nullable is the whole of the stored protection — a
catalogue without one is the normal state — and the member read carries
`isPasswordProtected`, derived from the hash's presence, while the hash never
leaves the server. Membership bypasses the challenge; a visitor needs an
**Access grant**.

The grant is a 32-byte token in the cookie named for its catalogue
(`arcula_grant_{id}`, `Path=/api/v1`, `HttpOnly`, `SameSite=Lax`, twelve
hours), and the row stores only its SHA-256 hash with the same expiry. The
cookie's path is broad because the media proxy is one route for every
catalogue's bytes; the **name** is the scope, and `grantHeld` reads only the
name for the catalogue it serves and looks the row up by catalogue id and
token hash, so a grant minted elsewhere is never consulted. The verdict is still
`access.ts`'s: `canSeeCatalogue` and `canSeeArtwork` take the grant as a fact
beside membership, and the catalogue read, the artwork list, the single-artwork
read and the media proxy all ask it — so a grant admits exactly what a visitor
sees (published, live works; never a draft, never a document) and a private
catalogue stays shut to a grant holder.

`POST /catalogues/:id/unlock` takes the password: `201` and the cookie on
success, `403 invalid-password` on a wrong one, `409` on a catalogue with no
password (or a private one, where there is nothing to get past), and `429
too-many-attempts` once the window is spent. A refused catalogue read is `403
password-required` with `details.catalogueName`, which the public pages fold to
the lock screen — app chrome, not a skin — and whose success calls the hook's
`reload` to re-run the ordinary load, catalogue read first. An expired grant
lands back on the lock screen the same way. A password write (`PATCH
/catalogues/:id`) revokes the catalogue's grants in the same transaction, so
changing the password closes every open cookie.

**The unlock throttle.** Guessing is counted in `catalogueUnlockAttempts`,
one row per `(address, catalogue, window)` — the pair is the key precisely so
one catalogue's throttle cannot lock visitors out of another's through a
shared address. The window is **fixed**, ten minutes, floored from the
attempt's own time (`unlockThrottle.ts`), so a row names the span it counts
instead of the span depending on the clock. Ten failures spend it and the
eleventh is refused unread, in one atomic claim (`setWhere` on the upsert), so
two attempts racing the tenth failure cannot both get through; a right password
deletes the pair's counter rows, so a member who mistyped carries no debt. The
refusal states the window and never the time left in it, and sends no
`Retry-After`, which would be the same countdown. The address is the gateway's
`sourceIp`, carried by the Lambda entry in `x-arcula-client-ip`
(`clientAddress.ts`), which a client cannot set; the residual weakness is
recorded in `DESIGN.md` — an address is shared behind a proxy and cheap
to multiply, so this raises the cost of guessing without being a proof.

## What to test

The suite is fast, so volume is not the problem. **Altitude** is: every test is
something a reader has to keep true as the libraries underneath it move, and
something to reason about when it goes red. The question to ask before writing
one is therefore not "is this worth covering?" but:

> **Would this fail if Mantine (or Hono, or Drizzle) changed, or only if we
> changed?**

A test that answers _the library_ is asserting the library's behaviour. It costs
a reader and buys nothing — the library tests itself, and when ours goes red we
have learned nothing that was not visible in the diff.

**Mutation testing is the acceptance bar for anything new.** Change the line the
test claims to cover; if it stays green, the test was not covering that.

The tiers, the catalogue of tests that do not earn their place, what the gate
catches and what it does not, and the mechanics a test file has to get right are
in [docs/testing.md](docs/testing.md). Read it before writing a test, and when
reviewing a diff.

## Gotchas

- Mantine guidelines are saved in **`.opencode/docs/mantine-llms.txt`** —
  reference it when building UI components or form controls.
- `lodash` is a dependency of `apps/web` and `@types/lodash` is installed.
  Prefer subpath imports (`import debounce from "lodash/debounce"`) for smaller
  bundles.
- Config comes from the repo-root `.env`; `VITE_*` vars are web-only and are
  inlined at build time. The repo-root file is the local fallback: a deploy
  reads `infra/cdk/.env.<env>` instead (`infra/cdk/.env` is production's
  fallback, and dev deliberately has none — falling back would put
  production's database URL into a dev deploy). Never commit real secrets; see
  **Two rules that are load-bearing** above.

## Validation

- `bun run check` (tsc over every package + ESLint + Prettier) must pass before
  and after any change, and before a PR. The `infra/cdk` package is deliberately
  not a workspace member and installs its own dependencies, so run
  `cd infra/cdk && bun install` once before the check can resolve
  `aws-cdk-lib`.
- `bun run test` runs every suite; the API and web suites need the local stack
  (see **What to test** above). `npx vitest run <file>` inside a package runs a
  single file.
- **Deploy**: `sh scripts/deploy-prod.sh` (production) or
  `sh scripts/deploy-dev.sh` (dev). Both end by running
  `cd apps/api && bun scripts/deploy-verify.ts <url>` — the 19-step end-to-end
  pass (health, SPA, sign-up, the `Secure` session cookie, a real 12 MP photo
  through presign → direct PUT → process → save with the bucket's CORS
  preflight probed against the deployment, a visitor read, and the reset-mail
  path).
  The catalogue cap is covered by the API integration suite instead, since
  reaching it would mean ten creates per run. It takes the URL, not an environment, so it runs against
  either one by hand. It creates a throwaway `verify-<ts>@example.test` account
  per run, so treat it as a write against the environment. A deploy whose host
  does not resolve yet prints the DNS records and exits successfully instead of
  verifying — that is the first dev deploy's shape, not a failure.
- Custom-domain changes: the apex and `www` are distinct `DomainName` resources
  with distinct regional endpoints; the stack emits both
  (`ApiRegionalDomainName`, `ApiRegionalDomainNameForwww`) and
  `scripts/deploy.sh` prints each against the matching Porkbun record.
  Those DNS records are console-only (no API access), and the apex and `www`
  targets are **different** `d-…` values — do not point one at the other.

## Agent skills

### GitHub CLI

**Before every `gh` call, confirm the active account is `mixcas` and no other.**
This machine is logged in to more than one GitHub account, and an inactive one
being active would act as the wrong person against a public repository. Check
with `gh auth status` and read the `Active account: true` line; if it is not
`mixcas`, switch with `gh auth switch --user mixcas` before running the command.
Never pass `--hostname` or a token env var to sidestep the check, and do not run
a `gh` command whose side effects land on the wrong account.

### Issue tracker

Issues live in GitHub Issues (`mixcas/arcula`), driven by the `gh` CLI. See
`docs/agents/issue-tracker.md`.

### Triage labels

The five default triage roles, unchanged: `needs-triage`, `needs-info`,
`ready-for-agent`, `ready-for-human`, `wontfix`. See
`docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. Both exist
now. The glossary holds the product's own vocabulary — the nouns in the data
model and the design record — and **not** deployment, branch or process
vocabulary, which belongs in this file. ADRs hold decisions with their rejected
alternatives: two long-lived branches feeding two permanent environments, both
environments sharing one AWS account and CDK bootstrap, the catalogue as the
only visitor gate, and catalogues shared by membership. See
`docs/agents/domain.md`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:

- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

# External docs — fetch on demand

Use web fetch / browser / search tools to load these when implementing or
debugging third-party behavior. Do not paste full upstream docs into the chat.

## Index URLs (read these first)

| Area    | llms.txt                     |
| ------- | ---------------------------- |
| Mantine | https://mantine.dev/llms.txt |
| Hono    | https://hono.dev/llms.txt    |

## Read order

1. Fetch the **llms.txt** for the dependency that owns the question.
2. Follow **only** links from that file (or obvious `/docs/*.md` siblings) for
   depth.
3. Prefer Markdown sources over scraping marketing HTML.
4. If types exist locally (`node_modules`, stubs), use them **after** you know
   which API surface applies (avoids guessing wrong symbols).

## Scope

- Questions about **our** repo layout → /graphify codebase search, not llms.txt.
- Questions about **their** API/version/docs → use the table above.
