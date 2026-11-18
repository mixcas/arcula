# Arcula — design

This document describes the product and the code as they stand. Where it and the
code disagree, the code is right — but a disagreement is a doc bug worth fixing.

> **Sharing is built.** Access is membership: `catalogues.userId` is the owner
> fact, a `catalogueCollaborators` row is everyone else, and the owner and
> every collaborator read and edit the whole catalogue, documents included.
> Inviting, resending, revoking, removing and transferring stay owner-only. The
> invitation loop, the invitee's in-app list, ownership transfer and the
> settings page's access card are built; the two mails are the invitation and
> the transfer notice. The model is accepted in
> [ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md), and the
> two-migration release order below is what shipped.

For the user-facing overview and setup, see [README.md](README.md). For the agent
working guide, see [AGENTS.md](AGENTS.md); the product's vocabulary is in
[GLOSSARY.md](GLOSSARY.md). Per-package detail lives in each package's own
`README.md` (`apps/api`, `packages/shared`, `packages/db`, `infra/cdk`), and the
implementation-ready contracts for individual features are in `docs/specs/`.

## What the product is

A catalogue manager for independent collectors, artists and galleries.
Accounts sign themselves up, own catalogues (ten on the free tier), invite
collaborators by email, and record the artworks in it: title, artist, and the
descriptive fields a real catalogue needs — with photos and other documents
attached. A catalogue can be shared with collaborators, who edit it alongside
the owner, and given a public page whose presentation is chosen by a "skin".

A catalogue carries a **kind**, fixed at creation: a **Portfolio** is one
artist's body of work, a **Collection** is what a collector owns, and an
**Inventory** is what a gallery represents for sale. The kind shapes the surface
(the name and description labels, and the defaults a new Catalogue's **Artwork
fields** start from) — it is not an account role, because one account may hold
all three at once
([ADR-0010](docs/adr/0010-collector-artist-and-gallery-are-catalogue-kinds-not-account-roles.md)).
Which fields a Catalogue's works record is then the Catalogue's own choice,
made from one fixed registry and resolved against those defaults
([ADR-0013](docs/adr/0013-artwork-fields-are-a-per-catalogue-choice.md)). A
work's **availability** — the market state beside its published/draft status —
is one of those fields, on every kind.

The design bet, stated in the README, is that art is not tidy data: an unset
field is not an empty one, `acquisitionDate` is a string ("circa 1889") rather
than a date, and money is stored as the text that was typed rather than parsed
into a float. The schema below is that bet made concrete.

## Architecture at a glance

A Bun workspaces monorepo. In production one Lambda serves both the API and the
built SPA behind one HTTP API, so the app is same-origin and there is no CORS.
Postgres holds the rows, S3 holds the media, and **every** read — row or byte —
goes through the API so one authorization layer covers both. An agent is a
second client, not a second deploy: its MCP endpoint is a route on that same
Lambda, on the same origin, and every tool calls the module a route calls.

```
browser → API Gateway (custom domain) → Lambda (Hono) → Postgres / S3
agent   → API Gateway (custom domain) → Lambda (Hono) → the same modules
```

- `apps/web` — React 19 + Vite + Mantine v9.
- `apps/api` — Hono; Bun in dev, Node 24 Lambda in prod.
- `packages/shared` — the client⇄server contract.
- `packages/db` — the Drizzle schema.
- `infra/cdk` — the AWS stack.

## Environments

Two permanent environments of one deploy shape — production on `main`, dev on
`dev` — with the branch model, the deploy identity and the forward-only
migration rule, are described in
[AGENTS.md](AGENTS.md#branches-and-environments). The reasoning and the rejected
alternatives are in
[ADR-0001](docs/adr/0001-two-branches-two-environments.md) and
[ADR-0002](docs/adr/0002-one-account-one-bootstrap.md); the first-run order is in
`infra/cdk/README.md`.

## The data model

Twenty-two tables in Postgres: the domain model with sharing, password
protection and the write limiter's counter, plus the eight tables the agent
access surface's OAuth provider and JWT plugin write. All are defined in
`packages/db/src/index.ts` and migrated in `packages/db/migrations/`.

**The entity is a Catalogue; the physical table is `collections`.** The Drizzle
entity is exported as `catalogues`, and its relations are
`catalogueCollaborators`, `catalogueInvitations`, `catalogueAccessGrants` and
`catalogueUnlockAttempts`; the relation property is `catalogueId`. The physical
Postgres tables keep their `collections` / `collection_*` names and the physical
column keeps `"collectionId"`, because renaming storage is a non-additive
migration that collides with deploy-before-migrate, and the physical name is
invisible ([ADR-0010](docs/adr/0010-collector-artist-and-gallery-are-catalogue-kinds-not-account-roles.md)).
The section headings below name the physical table, as the storage record does;
the prose says catalogue.

Every row id is short and opaque: ten base62 characters minted by `mintId` in
`packages/shared/src/ids.ts`, never a sequence or a UUID. Ids minted before that
shape existed are permanent, so both forms remain valid
([ADR-0007](docs/adr/0007-ids-are-ten-base62-characters.md)).

Every table enables RLS with zero policies, and `0006_enable_rls` revokes the
Supabase client roles' grants — `anon` and `authenticated`, on the tables, the
sequences and the defaults for future tables — guarded on the role existing, so
a database without them still migrates. The API connects as the table **owner**
and therefore bypasses RLS, which is what keeps every read and write working;
replacing that connection with a non-owner role would need policies first.
`FORCE ROW LEVEL SECURITY` must never be added: it would subject the owner to the
empty policy set and blank every read. The revoke reaches `postgres`'s default
privileges only; `supabase_admin`'s survive, because default ACLs are
per-grantor — accepted and written down in `packages/db/README.md` (#181).

### Auth (Better Auth core)

`user`, `session`, `account`, `verification`. `user` is extended with four typed
columns the API declares to the adapter: `firstName`, `lastName`, `tier`
(default `"free"`), and `settings` (jsonb). Email and the password credential
belong to Better Auth; nothing in the domain tables mirrors them.

`verification` exists even though email verification is off, so turning it on is
a config flip rather than a schema change.

### Agent access (`jwks` and the `oauth*` tables)

Eight tables the JWT and OAuth provider plugins write, hand-authored because
`@better-auth/cli` is deprecated with no 1.7.x release: `jwks` (the signing key
pair the session JWT plugin mints) and the provider's `oauthClient`,
`oauthResource`, `oauthClientResource`, `oauthRefreshToken`, `oauthAccessToken`,
`oauthConsent` and `oauthClientAssertion`. The adapter addresses each table by
its exported key and each column by its property name, so the names are the
plugin's, exactly — including `oauthClient.requirePKCE`.
`apps/api/tests/adapter.test.ts` asserts every model and field
`getAuthTables()` returns exists here, which is the generator a missing release
would otherwise provide.

A **Connection** is the account's approval of one MCP client: the
`oauthConsent` row the guard reads on every call. One row per (account, client)
is the design, but the plugin finds then creates and declares no unique index,
so two approvals racing can leave a duplicate; the account surface collapses
them to the newest and Revoke deletes every row for the pair. The same read is
why Revoke is immediate although an access token is a JWT that lives for its
full hour: the row is gone, so the next call answers `401` and the client
reconnects. A Connection's tokens are the `oauthRefreshToken` family — each
rotation revokes the old row and inserts the next with the same
`authorizationCodeId` — and Revoke stamps every live row for the pair revoked.
The account surface lists consent rows, never refresh tokens. With `jwt()` in
play, `oauthAccessToken` stays empty: access tokens are JWTs, not rows.

The limitation is said plainly: the token's claims carry the account's `sub`
and the client's `client_id`, and nothing identifies an installation, so two
installs of the same client share one Connection — one row, one "last acted",
one Revoke. Different clients are separate rows. Per-install listing and
revocation would need an install identity the protocol does not supply here, so
it is not implemented.

`0013_agent_access` is additive and landed alone, ahead of the MCP code, per
[A schema change ships alone](AGENTS.md#migrations-are-forward-only).

### `collections`

`id`, `userId`, `mediaNamespaceId`, `name`, `kind` (default `collection`),
`artworkFields?` (jsonb), `description?`, `skin?`, `skinOptions` (jsonb),
`isPublic` (default `true`), `passwordHash?`, `deletedAt?`, `createdAt`,
`updatedAt`.

`kind` is `portfolio`, `collection` or `inventory`, `NOT NULL` with a constant
default (every row that predates it is a collector's) and CHECK-constrained to
the three values. Nothing writes it after create: a catalogue never changes
meaning underneath the works it holds. `0009_catalogue_kind` is pure generated
SQL — a constant default needs no backfill.

`artworkFields` is the Catalogue's sparse map of deviations from its Kind's
Artwork-field defaults: a nullable jsonb whose entries are the fields the member
decided, an absent key meaning "follow the Kind", and `null` or `{}` meaning pure
defaults. The registry — the thirteen togglable keys, the two fixed ones, the
per-Kind defaults, the resolver, the normaliser and the refusal predicate — lives
in `packages/shared/src/artworkFields.ts`, not in the row: the column stores the
choice, it does not define the vocabulary. The write path normalises on save, so
an entry equal to the Kind's default is dropped and an empty map is stored as
`null`; every audience's read carries the map, visitors included, because the
public Catalogue PDF resolves the same enabled set from it. The feature's
decision and rejected alternatives are in
[ADR-0013](docs/adr/0013-artwork-fields-are-a-per-catalogue-choice.md).
`0011_catalogue_artwork_fields` added the column nullable and read by nothing, in
its own release; the registry, the contract, the API and the web surfaces shipped
in the next one, because the deploy replaces the Lambda before it migrates.
Nothing backfills: a Catalogue that never deviated is the normal state.

`userId` is the owner. `mediaNamespaceId` is fixed at creation and is the
namespace every final media key uses. The schema shipped in two releases:
`0003_shared_collections` adds it nullable and backfills existing rows from
`userId`; `0004_media_namespace_not_null` backfills any row the old code wrote
in between (scoped to nulls, so a namespace the new code minted survives) and
makes the column `NOT NULL`. The feature code keeps the
`mediaNamespaceId ?? userId` fallback because the Lambda still deploys before
the migration. A transfer changes the owner but not the namespace, so no object
moves and existing URLs keep working.

`skin` is read-time defaulted to the default skin and is never queried on, so it
needs no backfill — the deliberate contrast with `deletedAt`. `skinOptions` is
validated at read time against the selected skin's declared options; an unknown
key is dropped and a wrong type falls back to the default, so a stale or
hand-edited value cannot corrupt a catalogue.

`deletedAt` is the catalogue's deletion stamp: null while it is live, a
timestamp once its owner deletes it. It is nullable with no default and no
backfill — a live catalogue is the normal state, so nothing needed tightening
later — and it carries no index, because the signed-in list and the cap count
already narrow on the owner column, the anonymous public list narrows on the
visibility flags, and deleted rows are rare. The stamp is the whole
record of the act. The shared loader refuses a stamped row, so every address
that named the catalogue answers not-found for every viewer, and the four raw
queries that bypass the loader filter it themselves: the two lists, the cap
count and the invitee's inbox. Nothing cascades — the works, their photo and
document rows, the media objects and the collaborator rows stay — which is what
makes an operator's restore of the catalogue a one-column update. The deletion
transaction also withdraws the catalogue's pending invitations and deletes its
Access grant rows
([ADR-0008](docs/adr/0008-a-collection-is-deleted-by-its-owner.md)).

`passwordHash` is nullable text — a one-way scrypt hash with its salt and cost
parameters encoded in the string — so a catalogue with no password is the
normal state rather than a gap to backfill. The plaintext is never stored and
never reaches a client under any read, for any viewer, the owner included.

### `collection_access_grants` and `collection_unlock_attempts`

`collection_access_grants`: `collectionId`, `tokenHash` (unique), `createdAt`,
`expiresAt`, with an index on `collectionId` so a password change revokes a
catalogue's grants in one statement. It holds the SHA-256 hash of a 32-byte
token, never the token: a database leak is a set of unguessable hashes, not a
set of working grants. Expiry is computed from `expiresAt`, never stored as a
status.

`collection_unlock_attempts`: `(ip, collectionId, windowStart)` as the primary
key, plus `attempts` — the unlock throttle's counter, keyed by the pair so one
catalogue's throttle cannot lock visitors out of another's through a shared
address. The window length is the route's policy, not the schema's
(`unlockThrottle.ts`), and the unlock route is the only writer and reader.

### `account_write_windows`

`(userId, bucket, windowStart)` as the primary key, plus `count` defaulting to
zero — the write limiter's counter for the agent surface. `bucket` is `write`
(the per-second bucket every write spends) or `import` (the hourly cap an import
spends in addition), which is what lets one table serve both windows: one row
per account, bucket and window, and a claim is one `INSERT … ON CONFLICT` that
adds to `count`. Keyed by the account, never the address, because a hosted
agent's calls all arrive from one cloud. The window lengths are the surface's
policy, not the schema's: `agentLimiter.ts` floors `windowStart`, spends a
write in the current whole second (a rolling 20-write / 20-second window) or an
import in the current UTC hour (5 an hour), and prunes the rows that can no
longer count. `0012_account_write_windows` is additive and landed alone, ahead
of the limiter that reads it.

### `collection_collaborators` and `collection_invitations`

`collection_collaborators`: `collectionId`, `userId`, `createdAt`, primary key
`(collectionId, userId)`, with an index on `userId` for the dashboard. The owner
is not duplicated here; a row is what makes an account a collaborator and is the
authorization fact for everything inside the catalogue.

`collection_invitations`: `id`, `collectionId`, `email`, `invitedByUserId`,
`tokenHash`, `status` (`pending` | `accepted` | `declined` | `revoked`),
`createdAt`, `expiresAt`, `resolvedAt?`, with a unique `tokenHash`. There is at
most one pending invitation per catalogue and email (stored trimmed and
lowercased), enforced by a partial unique index on
`(collectionId, lower(email)) WHERE status = 'pending'`. Resending rotates the
token, the expiry and the issue time on that row, which is also the 60-second
cooldown's clock. Accepted, declined and revoked rows are kept as history.
Expiry is computed from `expiresAt`, not a status. The raw token exists only in
the mail.

### `artworks`

`id`, `userId`, `collectionId`, `title`, `artistName` (both required), and the
optional descriptive fields `serie`, `dateOfCreation`, `medium`, `dimensions`,
`editions`, `acquisitionDate`, `acquisitionPrice`, `placeOfOrigin`, `provenance`,
`notes`, `condition`, `currentValue` — all `text`, so the string that was typed
is the string that is stored — plus `availability` (nullable), `status`
(`published` or `draft`, default `published`), `deletedAt` (nullable),
`createdAt`, `updatedAt`.

`availability` is `available`, `reserved`, `sold` or `on-consignment`, nullable
with no default and CHECK-constrained to the four values. Null means no market
state recorded. It is the thirteenth **Artwork field**: all four states exist on
every Kind, and whether a Catalogue records one is that Catalogue's choice, not
its Kind's. `0010_artwork_availability` is pure generated SQL and needs no
backfill. The API accepts it on every work whose Catalogue records the field and
never validates it against the Kind.

`userId` is a mirror of the catalogue owner, kept in step when a catalogue is
transferred; no route authorizes on it, and media URLs no longer derive their
namespace from it. No per-work creator is recorded.

The catalogue is the only gate on a visitor: a visitor sees a published, live
work exactly when its catalogue is public. There is no per-work visibility
flag — a work's only choice of its own is published or draft, and a draft counts
as part of its catalogue.

Three indexes back the two list queries and the create-time check: the owner
list (`collectionId, deletedAt`), the visitor list (`collectionId, status,
deletedAt`), and `collectionId` alone. The owner list lost its `userId` segment
with sharing: every collaborator reads the same list.

### `artwork_photos` and `artwork_documents`

`artwork_photos`: `id`, `artworkId`, `order`, `name`, with a **unique
`(artworkId, order)`**. The array position is the truth: index 0 is the primary
thumbnail app-wide, and the unique constraint is what makes the save's four-pass
reindex safe. `name` is metadata only (the user's original filename); it never
reaches an object path.

`artwork_documents`: `id`, `artworkId`, `kind` (`file` | `image`), `name`,
`size`, `contentType`, `width?`, `height?`. There is **no `order`** — documents
have no sequence and no primary thumbnail, so there is nothing for an index to
mean.

### `artwork_photo_variants`

One table serves both populations (photo variants and image-document variants):
`parentKind` (`photo` | `document`), `parentId`, `key`, `width`, `height`,
`size`, `contentType`. Its primary key is **`(parentId, key)`** — a parent has at
most one object per key, which is exactly what makes promote-at-save an
idempotent upsert.

## Media: staging, promotion, and the proxy

Media is a three-step flow, and the object-key algebra in
`apps/api/src/media/keys.ts` is the spine of it. Every key is self-describing:
segments are ids and variant keys, and no user-supplied filename ever reaches a
path.

```
final:    artworks/{mediaNamespaceId}/{catalogueId}/{artworkId}/{photos|documents}/{entryId}_{key}.{ext}
staging:  staging/{uploaderId}/{catalogueId}/{artworkId}/{entryId}[_{key}].{ext}
```

The final namespace is the catalogue's `mediaNamespaceId`, fixed at creation:
a transfer changes the owner but never the key, so no object moves. Staging is
per uploader, so one collaborator's staged object is never under another's
prefix, and the sweep lists only the caller's prefix.

The `staging/` prefix leads deliberately: object-store lifecycle rules match
literal prefixes, so one rule expires every staged object everywhere.

The bytes never pass through the API. They used to, and a Lambda's 6 MB
synchronous invocation payload — reached after base64 inflation of the
multipart body — refused every phone photograph over roughly 4.5 MB with a
`413` the app never emitted ([ADR-0012](docs/adr/0012-media-uploads-go-direct-to-storage.md)).
The browser now writes the original straight to the bucket, and the API keeps
the two decisions that need authority: what may be uploaded, and what the
uploaded bytes actually are.

1. **Stage** — presign, PUT, and the declaration. The browser POSTs a
   _declaration_ (`entryId`, `contentType`, `size`, and optionally the original
   `name`) to `…/{photos|documents}/stage`. The API checks membership, the
   declared type against the accepted map and the declared size against the
   cap, discards the entry's earlier staged objects (so re-staging replaces),
   derives the extension from the _declared type_ (never the filename), and
   answers a short-lived presigned `PUT` for
   `staging/…/{entryId}.{ext}`. The browser then PUTs the file straight to the
   bucket (`apps/web/src/services/mediaService.ts`), with no session cookie and
   with exactly the headers the signature covers: `content-type`, which pins
   what the object is stored as, and `x-amz-meta-name`, the original's filename
   percent-encoded. That header is the name's only home — the process call
   carries just the entry id — and it is signed and deliberately unhoistable
   into the query string, where a filename would join the token in every access
   log. The URL is a bearer token scoped to one method, one key and
   `PRESIGNED_PUT_TTL_SECONDS` (300 s): it is never logged, and session replay
   redacts both the presign call and the bucket `PUT`
   ([ADR-0011](docs/adr/0011-session-replay-is-redacted-at-the-client.md)). The
   bucket's CORS rule allows `PUT` from the app's origin with exactly those two
   headers, and `deploy-verify` asks the deployed bucket that preflight
   question, because nothing in-process can. Locally the SeaweedFS stand-in
   runs anonymous and does not verify signatures, so it accepts a tampered PUT;
   only real S3 refuses one, which is why nothing presign answered is trusted
   later.
2. **Process** — the first point the server sees the bytes, and the only place
   they are measured. Before Sharp decodes, the stored content type is checked
   against the same allowlist and the object's own length against the same cap,
   so a forged declaration at presign buys nothing but a failed process and an
   object the sweep removes. Sharp then decodes once, applies the EXIF
   orientation, and encodes every variant to WebP at quality 95. The variants:
   `xxlarge` (max 3000, inside), `xlarge` (max 2400, inside), `square_lg`
   (800 cover), `square_sm` (400 cover), `large` (max 1200, inside), `medium`
   (max 800, inside).
   `xxlarge` is the Catalogue PDF's source — its photo box needs 2417 px at
   300 dpi, past `xlarge`'s cap
   ([ADR-0006](docs/adr/0006-the-collection-pdf-prints-from-its-own-variant.md)) —
   and the widest `srcSet` candidate the slideshow offers. The answer carries
   the original's measured metadata — `width`, `height`, `size`,
   `contentType`, `name`, `url` — beside the variants, because presign held no
   bytes to measure. A document image gets only `square_sm` and `large` — the
   two a document actually renders with. A PDF has no variants; the original
   is the whole entry.
3. **Save** — one Postgres transaction writes the artwork fields, copies each
   entry's staged objects to their final keys, and upserts the rows; dropped
   entries lose their rows, and their final objects are deleted after commit.
   Staged objects are deleted after commit too. An S3 copy cannot roll back with
   the rows, so a failed save may leave final objects with no row — the accepted
   residual that the staging lifecycle (7 days) and the catalogue sweep route
   exist to clear.

Reads never touch S3 directly. `GET /api/v1/media?key=…` parses the key back into
its segments, re-checks visibility against the row, and streams the object:

- **final photo** — a member of the catalogue (the owner or a collaborator),
  or a visitor when the work is published **and** live **and** its catalogue is
  public;
- **final document** — the catalogue's members only (a visitor gets a `403`, so
  a forgotten-to-hide UI fails closed);
- **staged object** — the uploader whose staging prefix holds it, while they are
  still a member of the catalogue the entry was staged under.

## Access control

There is no rules language to audit: **the API is the only path to the data.**
`requireSession` / `resolveSession` establish the caller; `authorize.ts` loads
the catalogue, the viewer's membership row and the rows every write route
shares, and `access.ts` answers the access questions as pure functions over
those rows.

Access is membership, and the membership fact (`membershipOf`) says which of
two matrices applies. **Inside a catalogue** — the owner, and every account
with a `catalogueCollaborators` row — see the catalogue: every live work,
drafts included, and a deleted work by id; and its documents, at every status.
`artworks.userId` is never consulted for authorization; it mirrors the owner for
the wire document, nothing more. The read paths load the viewer's membership,
and every write path asks the same question through `requireMemberCatalogue`:
a collaborator changes every setting (public/private included), creates, edits,
imports, bulk-deletes, restores and sweeps exactly as the owner does. Only
access administration stays owner-only. Staging is per uploader, so
stage/process/discard and the sweep reach only the caller's own unsaved
uploads (ADR-0004).

**Outside it**, the visitor rule lives in `apps/api/src/access.ts`, pure over
rows a caller has already loaded: no database, no session, no framework. **The
catalogue is the only gate.** A visitor sees a published, live work exactly
when its catalogue is public; a draft, a deleted work and a private catalogue
are one answer to them, and a blocked work answers a uniform `404` — saying
which was refused would be a disclosure. (A private _catalogue_ answers `403`,
which the web client maps to its "private" state.) Signing in buys nothing here:
a Visitor and an anonymous reader are one membership, `null`. The list route
keeps its SQL filter, and a test pins the filter and the verdict to the same
answer ([ADR-0003](docs/adr/0003-the-collection-gates.md)).

**Protected** is that gate with a second condition in front of it, not a third
visibility state: a public catalogue whose `passwordHash` is set is readable by
a non-member only when the request carries a valid **Access grant**
([ADR-0005](docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md)).
Membership bypasses the challenge entirely, the grant admits exactly what a
visitor sees — published, live works, and never a draft or a document — and a
private catalogue stays closed to a grant holder. `canSeeCatalogue` and
`canSeeArtwork` take the grant as a fact beside membership; `authorize.ts`'s
`grantHeld` reads it off the cookie named for the catalogue (`arcula_grant_{id}`,
`Path=/api/v1`, because the media proxy is one route for every catalogue's
bytes, so the name rather than the path is the scope) and looks the row up by
the catalogue id and the token's hash. The catalogue read, the artwork list, the
single-artwork read and the media proxy all ask that one verdict, so the password
covers the row and the bytes alike. The anonymous list filters on public **and
not protected**, exactly as it excludes a private catalogue: a protected
catalogue is shared as a link, not found in an index. A refused catalogue read
answers `403 password-required` with the catalogue's name —
a challenge the lock screen answers, and the deliberate contrast with the
invitation token's uniform `not-found`, because here the artefact is not the
secret.

A collaborator is a row in `catalogueCollaborators`, never a second `userId` on
the catalogue, and the owner is not duplicated there. Documents are readable
by the owner and collaborators at every status, never by a visitor
([ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md)). The
dashboard reads `GET /catalogues` — owned and shared together, name-ordered,
each row with `role` and a shared row with the owner's `ownerName` — and its
cap counter counts owned catalogues only, because the tier cap gates creation.

Soft delete is a `deletedAt` stamp: the work leaves every live list, the bytes
stay, and the catalogue's **Deleted** view lists the stamped works, most
recently deleted first, where one or several are restored. A deleted work's Edit
page says so, disables Save and the media uploaders, and offers Restore in
place, keeping any unsaved input. Restore clears the stamp and touches nothing
else, so the work returns with its status, fields, photos and documents as they
were. No purge and no retention window exist: a deleted row lives until it is
restored.

### Access administration and the grant

Access administration is the owner's alone. `GET /catalogues/:id/access` is a
member read — who has access — with the pending offers serialized to the owner
alone; `DELETE /catalogues/:id/collaborators/:userId` is the owner removing
someone and `DELETE /catalogues/:id/collaborators/me` the collaborator leaving,
both immediate and both discarding only the departing account's staging prefix,
best effort; and `POST /catalogues/:id/transfer` moves ownership to an existing
collaborator, never to a fresh invitee, so a transfer can never stand in for
consent. One transaction moves the owner column, mirrors `artworks.userId`,
swaps the two membership rows (the previous owner stays a collaborator) and
persists the media namespace unchanged — fixed at creation and the prefix of
every final key, so no object moves and every saved URL keeps serving its bytes.
The recipient's tier is not consulted: the cap gates creation, not receiving
([ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md)).

An invitation is an offer whose raw token exists only in the mailed link,
`<CLIENT_ORIGIN>/invite/:token`; the row holds its SHA-256 hash, a seven-day
expiry and a status that becomes history on acceptance, decline or revocation,
so a resolved offer never blocks a fresh one. Acceptance is the mail's job and
needs a session whose normalized address is the invited one; the accepted
status and the membership row land in one transaction. A decline may also come
from the invitee's inbox, `GET /me/invitations`, and a resend rotates the
token, the expiry and the issue time on the same row, no sooner than 60 seconds
after the last issue. Invalid, expired, revoked and consumed tokens are one
uniform `not-found`, so the token's state is never disclosed. Sharing sends
exactly two mails — the invitation, and the notice to a catalogue's new owner
with a link to the manage page — and both are best effort through
`apps/api/src/email/provider.ts` (SMTP locally, Resend in production): the row
or the transfer is the durable fact, so a provider failure answers
`emailSent: false` and leaves the offer pending and resendable rather than
failing the write.

The grant's cookie is `arcula_grant_{id}`, `Path=/api/v1`, `HttpOnly`,
`SameSite=Lax`, `Secure` in production, and lives twelve hours — `GRANT_TTL_MS`
feeds both the cookie's `Max-Age` and the row's `expiresAt`. Its token is 32
random bytes in base64url, stored only as a SHA-256 hash, so a database leak is a
set of unguessable hashes rather than working grants; `isGrantUsable` is the
expiry instant and nothing else. The path is broad because the media proxy is one
route for every catalogue's bytes; the cookie's name is the scope
([ADR-0005](docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md)).

The unlock throttle counts in `catalogueUnlockAttempts`, one row per address,
catalogue and **fixed** ten-minute window, and **ten** failures spend it: the
attempt past the tenth is refused before its password is read, `429
too-many-attempts`, which names the window and never the time left in it. A right
password clears the pair's rows, so a member who mistyped carries no debt. The
address is the gateway's `sourceIp`, carried into `x-arcula-client-ip` by the
Lambda entry; no forwarding header is trusted
([ADR-0005](docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md)).

## The API

The resource API is under `/api/v1`, in the app's error envelope; `/api/auth/*`
is Better Auth's own handler, and `/api/mcp` is the agent endpoint (below). The
full route table is in `apps/api/README.md`. The shape of a
`GET` response is fixed by `apps/api/src/serialize.ts`, which emits the wire
types in `packages/shared/src/types.ts` (including the `{ seconds, nanoseconds }`
timestamp and the media-proxy `url` fields).

An artwork save carries `availability` like any other optional field: create
writes the value it names and null when it names none; PATCH sets a value,
clears it with `null`, and leaves the column alone when the key is absent. Which
fields a save may name is the Catalogue's Artwork fields rather than its Kind:
the create and update routes resolve the enabled set and refuse any payload key
the Catalogue turned off with `400 field-disabled`, naming the fields in
`error.fields` and in the message (`apps/api/src/artworkFieldRefusal.ts`). That
is a separate code from `field-not-writable` because the remedy differs — a stale
form must re-read the Catalogue, not stop sending a server-managed field. A
member read always emits `availability`, null included; a visitor's document does
not carry it, and no route gates on it.

Sharing is built. The owner creates an invitation; the mail is the only place
the raw token exists, and the invited account previews, accepts or declines it.
The owner administers the offers from `GET /catalogues/:id/access` (the
caller's role, the owner and the collaborators, plus the pending invitations to
the owner alone), resends (a fresh token, expiry and issue time on the same
row, once every 60 seconds) and revokes. The invitee's `GET /me/invitations`
lists their pending, unexpired offers — each with its catalogue and inviter —
and can decline one in app; acceptance is the mailed link's job. Access ends
when the owner removes a collaborator
(`DELETE /catalogues/:id/collaborators/:userId`) or a collaborator leaves
(`DELETE /catalogues/:id/collaborators/me`), both immediately and both
discarding only the departing account's staging prefix for that catalogue,
best effort. Ownership moves to an existing collaborator through
`POST /catalogues/:id/transfer`: one transaction updates the owner, mirrors
the artwork rows, persists the media namespace and swaps the two membership
rows; the namespace never moves, so every URL keeps working. The new owner is
mailed a link to the manage page (a failed notice answers `emailSent: false`
without undoing the transfer). These two mails — the invitation and the
transfer notice — are the only ones sharing sends, and both are best effort.
The error envelope gains `conflict` (409) for state conflicts; an invalid,
expired, revoked or consumed invitation token answers `not-found` like an
unknown one, as does an in-app decline of anything but the caller's own live
offer.

The settings write is partial. `PATCH /catalogues/:id` makes every field
optional — name and visibility included: an absent key leaves the column
alone, a present key validates as before (a name still trims and still cannot
be blank), and a body that names nothing is a valid, successful no-op that
changes no column and does not move the record's timestamp, so "updated"
continues to mean something was. The relaxation is strictly additive: a
bundle cached from before it still sends both fields and is still accepted,
and the two halves cannot skew, because the client and the server ship as one
Lambda.

The same write carries the Artwork fields. `artworkFields` is the sparse map of
deviations, keyed by the registry's thirteen names, so an unknown key is a
validation error rather than a silently stored one; it is optional and nullable
like the other keys, and an absent key leaves the column alone. The route
normalises it against the row's own Kind — an entry that restates a default is
dropped, and `null` or `{}` becomes `null` when nothing is left — so "back to the
defaults" is a state the member lands in rather than a value the column keeps.
The create contract does not accept the map: a new Catalogue is its Kind's
defaults with nothing stored.

The kind is chosen once. `POST /catalogues` accepts `kind` — `portfolio`,
`collection` or `inventory` — defaulting to `collection`, the collector's case
the product started with, so a client that names none keeps the old behaviour.
The insert stores it and every catalogue document carries it. `PATCH` does not
carry `kind`: the update schema has no such key, so a body naming one is a
successful no-op and the stored kind survives. The serializer validates a
row's kind against the three values and answers `internal` for an unknown one,
the same rule the artwork's status and a document's kind follow — a malformed
row is a server bug, not a document to render.

Catalogue passwords ride the same write. A string sets (or overwrites) the
password, `null` removes it, and an absent key leaves it alone; the write
revokes the catalogue's grants in the same transaction, and the member read
carries `isPasswordProtected`, derived from the hash's presence, the hash
itself never leaving the server. `POST /catalogues/:id/unlock`
takes a password and answers `201` with the grant cookie or `403
invalid-password`; a catalogue with no password (or a private one) answers
`409`, because there is nothing to get past. Those new codes are `403`
(`password-required` for the challenge, `invalid-password` for a failed
attempt), and the envelope's fixed set gained them rather than overloading
`forbidden`.

Guessing is throttled. Each unlock attempt claims a failure slot for its
**(address, catalogue)** pair in `catalogueUnlockAttempts`, in a **fixed**
ten-minute window floored from the attempt's own time: ten failures spend the
window and the eleventh attempt is refused unread with `429
too-many-attempts`, whose message states the window and nothing about the time
left in it (no `Retry-After` either, for the same reason). The claim is one
atomic upsert (`ON CONFLICT … DO UPDATE … WHERE attempts < 10`), so two attempts
racing the tenth failure cannot both get through, and a right password clears
the pair's counter rows, so a member who mistyped carries no debt. The address
is the gateway's own `sourceIp`, which the Lambda entry passes to the app in
`x-arcula-client-ip` (overwriting anything a client sent under that name); a
forwarding header is never trusted, because it is client-supplied. The identity
is honest rather than complete: an address is shared behind a proxy and cheap to
multiply, so this raises the cost of guessing without being a proof.

The catalogue artwork list answers one read in two layers. Its free text is an
optional member-only `q`: a present query is a member condition ahead of the
visitor verdict — a missing catalogue is `404`, no session `401`, and a signed-in
non-member (an Access grant holder included) `403` — and a query over 200
characters or 10 terms is `400 validation` attributed to `q`. Matching
normalizes both sides (NFD, diacritics stripped, lowercased), splits the query
on punctuation and requires every term to appear somewhere in the joined text of
the ten declared fields (title, artist name, serie, medium, editions, date of
creation, acquisition date, place of origin, provenance, notes); terms may match
different fields, and a query that normalizes to no terms matches nothing. Title
and Artist Name always contribute; the other eight contribute only while the
Catalogue records them, so a field it turned off is not found even when the
stored row still holds its text. The acquisition date is searched in both its
stored `YYYY-MM-DD` and its displayed `MMMM D, YYYY` form. An absent, empty or
whitespace-only `q` leaves the search unchanged.

Its structured half — the contract an agent's search builds on — filters on the
same ten text fields plus `status` and `availability`. A repeated parameter
means OR within that field and different fields AND, so either artist with an
oil medium is one request; at most 20 values in a field and 8 fields are
allowed. A text value is normalized and matched within its own field only
(`medium=oil` finds "Oil on canvas"; a work's note never answers a title
filter), while an enumerated value is compared exactly and one outside its list
is `400 validation`, never ignored. Filters and facets read the same enabled set
the free text does: a field the Catalogue does not record matches no filter and
yields no facet entries. `q` ANDs with the filters. `sort` is `updated` (the
default, newest first), `title`, `artistName` or `dateOfCreation`, compared
normalized, each ending on `id`, so the order is total and a paged read can
neither skip nor repeat a row. An absent `limit` is every match — which is what
the web reads — a present one is capped at 100, and `offset` without `limit` is
`400 validation`. The answer is the page envelope `{ artworks, total, limit,
offset }`: `total` counts the matches before paging and `limit` is `null` when
the caller named none. `facets` names one or more filterable fields and adds
`facets: { <field>: [{ value, count }] }`, counted over the filtered set rather
than the page, ordered by count descending then value and capped at 500 per
field; an unknown field or facet is `400 validation` naming it.

Deleted works are never candidates and a member's drafts are; a visitor filters
published works only, exactly the verdict the unfiltered read gives. Both halves
run in the API over the rows the list already reads, after the visibility
verdict, so only answering works load their photos and documents; there is no
SQL pushdown, no index, no extension and no migration, and the list read
remains the single seam to replace if catalogue sizes demand it. No matches is
`200` with an empty `artworks` and `total: 0`.

The artwork form's Artist Name suggestions are the caller's own vocabulary, not
a catalogue's: `GET /api/v1/artist-names` takes no catalogue id and no
parameter, answers `401` without a session and `200 []` for a caller with no
catalogues, and reads the names recorded in the catalogues the caller owns or
collaborates on — the scope decided in
[ADR-0009](docs/adr/0009-artist-name-suggestions-are-caller-scoped.md). Inside
that scope it counts live works only — drafts contribute, deleted works and
deleted catalogues never — grouping the exact spellings with their live-work
count and newest update, then collapsing case and accent variants to one artist
through the shared catalogue-search normalization (`normalizeSearchText`). The
spelling offered for each artist is its most-used one, with ties falling to the
most recently updated work and then to lexicographic order; the list is ordered
by use and then display name, case-insensitively, and silently cut at 2,000. The
response is the names alone, parsed through a shared schema of non-blank
strings: counts order the list and are never serialized. No migration, index or
extension is involved — the grouping is over exact spellings and the collapse
is pure, behind a module with no Hono type, so a future curated index can
replace its source without changing the wire.

## Agent access (MCP)

Arcula hosts an MCP server on the existing origin and the existing Lambda:
`POST /api/mcp`, Streamable HTTP, protocol revision 2026-07-28, stateless — a
fresh server per request, one JSON result, nothing held between calls. It is not
a second API; every tool calls the module a route calls, under the same
membership verdicts. `@modelcontextprotocol/server` (v2 of the SDK) serves it
with `legacy: "reject"` and `responseMode: "json"` — API Gateway cannot stream,
so a tool either answers once or fails. The endpoint mounts in the Hono app as
an `all` route, because the SDK answers a GET or DELETE with its own `405`; the
path is under `/api`, which the SPA already refuses, and `/.well-known/*` is the
second refusal — OAuth discovery must answer metadata or `404`, never
`index.html`. The app routes the well-known namespace to `auth.handler` and
`/api/mcp` to the guard.

The **resource** — the token audience — is `${apiOrigin}/api/mcp` per
environment, derived once in `env.ts` from `AUTH_BASE_URL` (the deployment's
`PUBLIC_URL`); the plugin's resource, the guard's audience and the challenge's
pointer all read that one value. In dev and production each deployment mints its
own; nothing is shared between them.

### Authorization

`@better-auth/mcp` 1.7.7 is the OAuth 2.1 provider configured for MCP, with
`@better-auth/cimd` for client identity and `jwt()` for the access tokens. The
provider publishes RFC 9728 protected-resource metadata and RFC 8414
authorization-server metadata from an `onRequest` hook that only runs for
requests the auth handler sees. PKCE (S256) is on, dynamic client registration
is off, and client identity is a **Client ID Metadata Document**: the client's
id is an HTTPS URL it hosts, and the plugin fetches and validates that document.
Every token is bound to the resource audience and refreshed. An unauthenticated
`POST /api/mcp` answers `401` with
`WWW-Authenticate: Bearer resource_metadata="…"` before the transport reads the
body.

The session JWT's own mint is closed (`/api/auth/token` is a `404`), so a
session JWT cannot be issued as an access token. The session token is also not
an API bearer in a deployment: `bearer()` is mounted only outside production
(`sessionBearerEnabled` is `NODE_ENV !== "production"`). Local development and
the suites keep it, where their helpers sign in with it; a deploy does not, and
`deploy-verify` signs in with cookies and asserts that a deploy refuses the
token as an `Authorization` bearer.

The consent screen is the app's, not the plugin's. The provider redirects to
`/consent` with the whole authorization query re-signed (`sig` and the names in
`ba_param` are the signature's envelope), and the SPA cannot verify a signature,
so the page asks `GET /api/v1/connections/request`. That route rebuilds the
signed subset, verifies it against the auth instance's secret, and answers the
client's public metadata, the signed redirect host and the exact
`oauth_query` to post back. The page renders the client's name beside the
redirect host — both are client-chosen, so the host is the fact to compare —
and only `https:` links, then posts `{ accept, oauth_query }` to
`/api/auth/oauth2/consent` and follows the URL the provider answers. An
unauthenticated authorize redirects to `/login` with the same query as its
querystring, and `loginReturnPath` resumes at `/consent` with it intact after
sign-in.

The tool layer receives a **verified subject** and never a token:
`requireMcpAuth` verifies signature, issuer, audience and expiry and hands the
guard its claims; the guard proves the Connection (below) and passes
`authInfo.extra.sub` to a per-request server. `dispatcher.ts` has no MCP type in
its signature: it parses the arguments through the tool's Zod schema, calls the
same module a route calls, and throws the app's `ApiError`, which the transport
answers as an MCP error result whose text is `code: message`.

### The Connection

A Connection is the account's approval of one MCP client — the `oauthConsent`
row the guard reads on every call. It is one per (account, client) in the
design, but the plugin finds then creates and declares no unique index, so a
race can leave a duplicate; the account surface collapses them to the newest and
Revoke deletes every row for the pair. The profile lists each Connection with
the client that made it, when it connected and when it last acted, and Revoke
ends it alone. The endpoint it hands the person comes from the API's own
environment (`mcpResource`), not from `window.location`, because in dev the SPA
and the API are different ports.

The guard's read is what makes Revoke immediate even though an access token is a
JWT that lives for its full hour: the consent row is gone, so the next call
answers `401` with the same RFC 9728 challenge and the client reconnects. The
same read touches `updatedAt` at most once a minute
(`CONNECTION_TOUCH_INTERVAL_MS`), which is where "last acted" comes from and why
a busy agent is not one write per call. Revoke deletes the consent rows and
stamps every live refresh token for the pair revoked; the browser session is a
different credential and is never touched.

The limitation is real and stated: the token's claims carry the account's `sub`
and the client's `client_id`, and nothing identifies an installation. Two
installs of the same client therefore share one Connection — one row, one "last
acted", one Revoke — while different clients are separate rows. Per-install
listing and revocation would need an install identity the protocol does not
supply here, so it is not implemented.

### The nine tools

The names are the contract; the descriptions are prompt text and are reviewed
like UI copy. Every write asks the member verdict (the owner and every
Collaborator may write, exactly as in the app), and every read calls the module
its route calls, so there is one authorization verdict and one place where "a
visitor sees published works only" is true.

| Tool               | Arguments                                                          | Answers                                                        |
| ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------- |
| `list_catalogues`  | —                                                                  | the caller's owned and shared Catalogues, with their role      |
| `get_catalogue`    | `catalogueId`                                                      | one Catalogue: Kind, visibility, role, works counted by status |
| `create_catalogue` | `name`, `kind`, `description?`, `isPublic?`                        | the new Catalogue                                              |
| `update_catalogue` | `catalogueId`, `name?`, `description?`, `isPublic?`                | the Catalogue as written                                       |
| `search_artworks`  | `catalogueId`, `filters?`, `sort?`, `limit?`, `offset?`, `facets?` | a page of work summaries, the match count and any facets       |
| `get_artwork`      | `catalogueId`, `artworkId`                                         | one work, the full record with photos, documents and Variants  |
| `create_artwork`   | `catalogueId`, the Add form's fields                               | the new work                                                   |
| `update_artwork`   | `catalogueId`, `artworkId`, the fields to change                   | the work as written                                            |
| `import_artworks`  | `catalogueId`, `rows[]`, `status?` (default `draft`)               | `{ inserted, rejected }`                                       |

`kind` is **required** on `create_catalogue`: a default is a coin flip the agent
cannot see, and the Kind is fixed at creation — `update_catalogue` has no such
argument, and a body naming one changes only the fields the tool owns. The
descriptions carry the three rules the schemas cannot:

- **Kind is fixed at creation.** A Portfolio's name is the artist's name and its
  description their bio; an Inventory's are the gallery's.
- **A Catalogue records a chosen set of Artwork fields.** `create_artwork` and
  `update_artwork` name only fields the Catalogue records; one it has turned off
  is refused with `field-disabled`. Availability is one of those fields — on by
  default for a Portfolio or an Inventory, off for a Collection — and the
  registry behind the choice (`@arcula/shared`) is the one the forms, the CSV
  import, the PDF and the tools all resolve.
- **The free tier owns ten Catalogues**, and a `limit-reached` refusal is
  terminal: it is relayed to the person, never retried.

What is deliberately absent: no media tool (an agent can carry a decision but
not a file), no delete, no ownership transfer, no invitation and no password.
The agent reads the PDF or PowerPoint itself and sends rows; Arcula never sees
the file.

### The search contract

`search_artworks` is not a second search: it runs the structured list read the
API section describes, through `artworkRead.ts` and the shared
`packages/shared/src/artworkSearch.ts`, so the filters, caps, normalized text,
exact enums, order, page envelope and facets are one contract.

- **Filters** are the same ten text fields plus `status` and `availability`. A
  repeated value means OR within its field and different fields AND; at most 20
  values per field and 8 fields per request.
- **Text matches normalized** (NFD, diacritics stripped, lowercased) within its
  own field; an enumerated value is compared exactly, and one outside its list
  is `validation`, never ignored.
- **`q` still works and ANDs with the filters**, but it is the route's
  member-only condition; the tool does not expose it, so an agent's question is
  always structured.
- **`sort`** is `updated` (the default, newest first), `title`, `artistName` or
  `dateOfCreation`, each with `id` as the tiebreak, so offset paging can neither
  skip nor repeat a row.
- **The answer is `{ artworks, total, limit, offset, facets? }`**, where `total`
  is the match count before paging. `facets` names filterable fields and counts
  their distinct values over the **filtered** set — not the page — ordered by
  count descending then value and capped at 500 per field; a text facet's value
  is normalized, so it can be sent back as a filter.
- **A member sees drafts; a visitor sees published works of a public Catalogue
  only; a Deleted work is never a candidate.** The filtering runs in the API
  over the rows the read already loaded, after the visibility verdict: no SQL
  pushdown, no index, no migration. `get_artwork` refuses a deleted row the
  same way, even to a member: the app's Deleted view is not exposed to an
  agent.

One thing is the tool's own: an agent pays for every row it receives, so
`search_artworks` always names a page — **50 rows when the caller names no
limit** — while a caller-named limit is still capped at 100, and an offset
stands alone because the tool supplied the limit. The route keeps the web's
behaviour: absent `limit` means every match, present is at most 100, and
`offset` without `limit` is `validation`.

### The import rule

`import_artworks` calls the same core as the CSV route. The payload is the
import's plus `status?: "published" | "draft"`, defaulting at the route to
`IMPORTED_WORK_STATUS` (`published`): a person's CSV import sends nothing and is
unchanged, exactly as before. The agent's tool defaults to `draft`, so a
hallucinated artist or a misread caption is a row the member deletes rather
than a page the public reads; the member publishes when satisfied, and the tool
may name `published` explicitly when the person asks for it.

The status the payload names wins over any status a row carries. Each row is
parsed against the shared `artworkSchema`; a failing row lands in `rejected`
with its position in the posted array and the fields that failed, while a row's
own failure never withholds its neighbours. The accepted rows commit in one
transaction. The tool's own schema caps a call at **200 rows** and a larger
request is a validation error naming the cap; the route has no cap, because its
review step has already shown the person the batch. The route's path is still
`/import/csv`.

### Errors

Every tool failure is an MCP error result whose text is `code: message`, so the
agent can relay it verbatim. The codes this surface can answer:

| Code                | Meaning for the agent                                                                                     |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `validation`        | terminal — fix the arguments                                                                              |
| `forbidden`         | terminal — this account may not do this here                                                              |
| `not-found`         | terminal — no such Catalogue or work                                                                      |
| `password-required` | a Protected public Catalogue's challenge; the agent cannot satisfy it, so tell the person to open the app |
| `limit-reached`     | terminal — the tier's allowance is spent; tell the person                                                 |
| `rate-limited`      | retryable after the window                                                                                |
| `internal`          | retryable once; then tell the person                                                                      |

`unauthorized` is the endpoint's own answer rather than a tool's: the `401`
challenge before the transport runs, or a revoked Connection's `401`. `conflict`
is in the envelope, but no tool path raises it in this release.

`password-required` is the one refusal with no agent-side fix. `get_catalogue`
asks the readable verdict, and an account that is not a member holds no Access
grant cookie, so the tool relays "This catalogue is protected" and the person
must open the catalogue in the app. The list read maps the same protected
catalogue to `forbidden`, because its verdict is the visitor rule without a
grant.

### The write limiter

Writes are metered per account, keyed by the token's verified subject and never
by address: a hosted agent's calls arrive from one cloud address range, so an
address bucket would be one bucket for every account in the product. Reads are
unmetered.

- **20 writes in a rolling 20-second window** — capacity 20, refilled one per
  second, so 60 a minute sustained. The rows are `account_write_windows`, one
  per account, bucket and whole second, and the claim sums the rows inside the
  window, so the window really rolls.
- **5 imports per UTC hour**, in addition to the write the import already
  spends. The import bucket is one fixed hourly row, floored from the UTC hour.
- The dispatcher claims the write **after the arguments validate and before the
  tool touches a row**, so a refused call writes nothing. `import_artworks`
  claims the hourly import on top.
- Exhaustion is `429 rate-limited`, whose message names the allowance and the
  window (`20 writes in 20 seconds`, `5 imports in an hour`) and whose details
  carry `allowance` and `windowSeconds`. There is no `Retry-After` header, the
  product's one precedent (`too-many-attempts`) being the same.

### Schema and release

`0012_account_write_windows` and `0013_agent_access` (the eight OAuth/JWKS
tables) are both additive and landed alone, ahead of the code that reads them,
per [A schema change ships alone](AGENTS.md#migrations-are-forward-only). No
release has shipped either separately: a single dev→main release carrying a
migration together with the code that reads it would deploy the Lambda before
it migrates, which is exactly what the rule forbids, so the release that
carries the migrations must still precede the MCP code's. The twenty-two tables
above are the result: the limiter's counter, and the eight agent tables the
provider and JWT plugin write, hand-authored against `getAuthTables()`.

## The frontend

`apps/web` is the SPA. `src/App.tsx` holds the routes:

- **Public** — `/` (product page), `/login`, `/signup`,
  `/reset-password` (the request) and `/reset-password/:token` (the form the
  mailed link lands on), `/invite/:token` (the invitation landing page, which
  shows the catalogue and invited email before sign-in), `/consent` (the
  Connection approval screen, which sends a signed-out visitor back to `/login`
  with the signed query), and the skin-rendered
  `/catalogue/:catalogueId` and `/catalogue/:catalogueId/artwork/:artworkId`.
- **Protected** — everything under `/manage`: the dashboard, a catalogue and its
  settings, artwork add/edit, the CSV import, and the account profile, whose
  agent-access card carries the endpoint and the Connected apps list.

App chrome has one header shape — the same bar, wordmark on the left and a
session-following right side — rendered by the shared layout modules, while a
skin-rendered Catalogue and the PDF viewer keep their own chrome because the
presentation belongs to the Catalogue.

`src/services/` is the client layer (`api.ts` is the transport the domain
services share); `src/auth/` is the Better Auth React client; `src/skins/` is the
public-view system. A skin renders a public catalogue through `SkinHost`, which
scopes the skin's CSS variables so its type scale cannot leak onto `/manage`; a
skin must not use a portaled Mantine component, which would render outside that
scope. Skins are registered in `src/skins/registry.ts` (`basicx` is the default),
and a catalogue's stored options are resolved against the skin's declared specs
with an unknown key reported rather than silently dropped.

A Protected catalogue's lock screen is app chrome, not a skin: the public page
renders it beside the canonical-URL rewrite, outside the skin's scope, because
the lock is about the catalogue rather than how it is presented, and because a
prompt is the portaled component a skin may not use. It is reached as a state,
not an error: the catalogue read's `403 password-required` folds to `locked`,
the screen names the catalogue the refusal named, and a wrong password is the
one attempt failure with its own sentence. On success it calls the hook's
`reload`, which re-runs the ordinary load — catalogue first, artworks second —
with the grant cookie now set, so there is one path to ready. An expired grant
re-enters the same way: the next read is refused again and the reader lands back
on the lock screen rather than on an error page.

The dashboard lists owned and shared catalogues together with a kind badge, a
role badge and the owner's name on a shared row; its cap counter counts owned
catalogues only. The kind badge wears the kind's colour — Portfolio orange,
Inventory lime, Collection indigo — while the role badge stays neutral grey, so
a row carries one colour axis. A shared catalogue is readable and editable: the
manage page's write controls work for a collaborator exactly as for the owner,
because the server answers them by membership. Above that list sit the pending
invitations addressed to the signed-in account, each naming its catalogue and
inviter and offering decline only — acceptance is the mailed link, and the card
says so.

One pure module answers what a kind means for the surface, and one answers what
a Catalogue records. `src/catalogueSurface.ts` returns, for a kind, the kind's
own label and colour, the labels of `name` and `description`, the four market
state words, and whether that name is the artist's name. The colour
is a name from a literal union, never a Mantine type or a hex, and the record's
key type makes a fourth kind a build error until it has one; one presentational
badge renders it as a shade-3 fill with dark text, and that badge is the only
kind badge in the app. The market state is deliberately not a kind answer: every
kind offers the same four states, and whether a Catalogue records one is the
**Artwork fields** registry's decision. `packages/shared/src/artworkFields.ts`
owns the thirteen togglable fields, the two fixed ones, the per-Kind defaults,
`resolveArtworkFields`, `normaliseArtworkFields` and the predicate the save routes
refuse with; the form, the settings card, search, the PDF and the import all call
it, so no screen and no route keeps its own field list. `newArtworkForm` takes the
kind, the catalogue's name and the resolved fields, and answers what a create form
starts as — in one call, so a screen has no per-kind branch that could skip a
kind. On a Portfolio its new work starts credited to the portfolio's artist — the
catalogue's own name, because on that kind the two are the same fact; on an
Inventory and a Collection the field starts empty, and a new work starts with a
market state exactly when the Catalogue records Availability. The artist default
is a starting value, never a derived fact: the field stays editable and required,
so a work credited to a guest, an estate or an attribution saves exactly as typed,
and only the create form reads it.

The create form asks the kind with three cards
and no default, and the two fields below them stay away until one is chosen:
each card carries the kind's icon, its persona (Artist, Gallery, Art Collector)
and its name, and its kind's colour is on it in both states — the 1px border
and the shade-7 glyph over a body-coloured fill with dark text when unselected,
and a shade-3 fill with near-black text when selected — so the picker teaches
the code the badges wear. Once a kind is chosen the two fields appear labelled
by its surface (Artist name/Bio, Gallery name/About, Name/Description); Create
is always rendered and stays disabled until a kind is chosen, and nothing on the
page says the kind is fixed, because the General tab says it. The General tab
relabels from the catalogue's stored kind and shows it as the same fixed,
colour-coded badge, so what the catalogue is stays clear after creation; the
dashboard badges every row with that badge. Nothing writes the kind after
creation.

Availability is the thirteenth Artwork field, not a gate its kind sets. Every
kind offers the same four states — Available, Reserved, Sold and On consignment —
and a Catalogue records the field or it does not. On a Catalogue that records it,
the artwork form offers all four beside Status and starts a work with no stored
state at Available; a stored value is shown as it is and is never overwritten by
opening the form. On a Catalogue that does not, the form renders no control and
its save omits the key, so a stored value is kept and never cleared. The Add and
Edit forms render every field the same way: a disabled field's input is simply
not there, and the save omits its key, so a hidden value survives. The manage
list, the grid and the Deleted view badge a work's availability beside its Draft
badge exactly when the Catalogue records the field: the page resolves the enabled
set from the catalogue's kind and stored deviations and passes `showAvailability`
down, so a value the Catalogue does not record is never shown. The public views
render none of it — availability is a member-facing market fact, never a second
gate, so a sold published work stays visible to a visitor and the API leaves the
key off a visitor's document altogether.

The **Catalogue PDF** prints the fields the Catalogue records. Title and Artist
Name always print; each metadata line the design prints appears only while its
field is enabled, and a disabled field's line simply disappears from the column —
the photo pages, the grid and the layout do not move. A visitor building the PDF
resolves the same set from the deviations the public catalogue read carries, so
the exported document is the Catalogue it claims to be.

The catalogue page's search is address state, not component state: `q` in the
URL is the source of truth. The query is written as the collector types,
debounced, replacing the current history entry so a live search does not fill
the Back stack; the X clears it; and the canonical `{slug}-{id}` rewrite
preserves it. The input mirrors the committed query on load and after
Back/Forward without overwriting a draft still being typed, so a reload, a
bookmark or a shared address lands on the same results.
With a query active the count reads `Found X artworks` (`Found 1 artwork` in the
singular); zero matches shows a no-results panel naming the query with a Clear
search action, while a catalogue with no works and no query keeps the ordinary
empty state. A list read in flight keeps the previous rows on screen
under the fetching indicator, a stale answer is discarded, and a failure keeps
those rows with an inline Alert and Retry; with no previous rows the Alert
replaces the table. A new query resets the table to page 1 and clears the row
selection, keeping the chosen sort. The return path is deliberately narrow: row
Edit links and Add Artwork carry the active query, Cancel on either page returns
to the same search, and a successful Add carries it into the new work's Edit
page, whose canonical rewrite preserves it. Settings, Deleted, the public View
links and the PDF do not carry it — `q` is inert on those pages.

The artwork form's Artist Name field is an `Autocomplete` over the caller's
artist names, fetched once per form mount and filtered in the browser. It stays
uncontrolled like every field in the form, so choosing an option fills only the
Artist Name and an unrecorded name still saves exactly as typed; `limit={20}`
bounds the dropdown and there is no minimum length. On the Add page a Portfolio
opens with the field holding the portfolio's own name; the other two kinds open
empty. A typed name wins: what is saved is the artist the work records, nothing
is backfilled, and the Edit page shows the recorded artist rather than the
catalogue's name. The hook makes no
per-keystroke request and keeps no cross-mount cache — reopening the form is what
refreshes the list — and a failed fetch is silent: the list is empty, the field
remains a working text input and no notification appears, with the `loading`
prop showing progress while the one request is in flight. Filtering is Mantine's
default accent-sensitive substring match, so the server's accent-insensitive
collapse and the client's matching deliberately differ: typing `maria` misses a
recorded "María López".

The catalogue settings page is four tabs, each with its own save:
**General** (the name and description its kind labels, public or private, the
password control, and the Artwork fields card), **Public view** (the skin and the
options the selected skin declares, with the notice that some stored options are
unused), **Access** (the card described below) and **Data** (the CSV import
card, whose mapping offers only the fields the Catalogue records and whose run
summary names the columns it skipped). Each tab is an
address —
`/settings/general`, `/settings/public`, `/settings/access`,
`/settings/data` — and a bare or unknown segment lands on General through the
effect that rewrites the catalogue's name-and-id in the address, so an old
settings link needs no redirect route of its own. Each tab saves only its own
half of the catalogue update, as the pure decision beside the page answers
it: a save leaves the member on the tab it saved from, names the tab in the
confirmation, and re-canonicalises the name in the address in place; a failed
save keeps the input on screen; and the Save is off while the tab's decision
answers an empty payload. The inactive panels are not kept mounted, which is
why the access card fetches nothing until its tab is reached and a tab left
mid-edit comes back to the stored values.

The General tab's **Artwork fields** card is a sibling card after the privacy
section. It opens with the statement that Title and Artist Name are always
recorded, groups the thirteen switches into _About the work_ and _Market &
acquisition_ (the four market fields carrying a line of explanation each), and
heads them with "Using the Portfolio defaults" or "Customised · Reset to
defaults". Reset puts the switches back on the kind's defaults in the buffer; the
card saves with the tab's existing Save, because a second save button on one tab
would break the page's one-save rule. The tab's pure save fold compares the
normalised maps, so a switch that merely restates a default writes nothing and a
Reset sends an empty map, which the API stores as `null`. Any member may change
it, owner and collaborator alike, like the rest of Settings; a field that still
holds a value is explained by one static line rather than a count, and it gets no
affordance in the Artwork form — the settings card is the one place the record's
shape is decided.

The settings page's access card carries the access administration: the owner
sees the invite form, every pending offer (expired ones marked, with resend
and revoke) and the collaborators with remove and transfer; a collaborator
sees the owner and the collaborators and can leave. Both endings confirm
first and warn that the departing account's unsaved uploads are discarded. Transfer also confirms, and
warns that it is immediate and that the previous owner becomes a collaborator;
after it the card re-reads itself as the collaborator's view.

## Tiers and quotas

`packages/shared/src/limits.ts` holds `CATALOGUE_LIMITS` and
`catalogueLimitForTier`. One map, imported by both sides, so the API's
enforcement and the client's messaging cannot disagree. The API checks the cap on
create and returns `limit-reached` (409); the client reads the same table to
reflect the cap in the UI. The cap counts owned catalogues that are **live**;
collaborations do not count, a transfer may take the recipient over the cap
without being refused, and a deleted catalogue frees its slot immediately
([ADR-0008](docs/adr/0008-a-collection-is-deleted-by-its-owner.md)). The free
tier is ten owned catalogues.

## What is not built

Roughly in order of how much it matters. This list is the technical and
access-model gaps a reader might expect to find; product-facing gaps and the
larger feature ideas are in [README's Roadmap](README.md#roadmap).

- **A read-only collaborator role.** Every collaborator can edit; a viewer would
  need a second permission matrix on the server and in every management screen.
- **Per-work attribution or an audit trail.** `artworks.userId` mirrors the
  catalogue owner, so the record does not say who added or edited a work.
- **Accepting or declining an ownership transfer.** A transfer is immediate and
  sends a notice; reversing it is another transfer.
- **Rate limiting beyond the two that exist.** Agent writes are metered per
  account (the rolling write window and the hourly import cap), and the unlock
  route is throttled per address and catalogue (a fixed ten-minute window in
  Postgres), but neither the invitation create route nor the password-reset
  mail is: both still go out at server speed. And the unlock throttle's identity
  is an address, which is shared behind a proxy and cheap to multiply, so it
  raises the cost of guessing rather than proving anything.
- **A collaborator cap.** A catalogue may invite any number of collaborators.
- **Account deletion**, and what it means for a catalogue's owner or a
  collaborator.
- **Restoring a deleted catalogue from the app.** Deletion is a stamp an
  operator clears by hand
  ([ADR-0008](docs/adr/0008-a-collection-is-deleted-by-its-owner.md)); there is
  no trash view, no undo and no script.
- **Reclaiming a deleted catalogue's storage.** Deletion keeps every object so
  the catalogue can be restored, and nothing purges them.

## Open decisions

- **Which currency a price is in.** Prices are free text today. A per-account
  default (`locale`/`currency`) belongs on the `user.settings` jsonb column,
  which is the reason to settle it before export and reporting.
- **Email-verification's meaning.** `verification` exists and Better Auth can
  send the mail, but an unverified address is still a fully valid principal, so
  enabling it changes nothing unless a route also gates on it.
