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
(the name and description labels, and whether a work carries an availability) —
it is not an account role, because one account may hold all three at once
([ADR-0010](docs/adr/0010-collector-artist-and-gallery-are-catalogue-kinds-not-account-roles.md)).
A work in a Portfolio or an Inventory carries an **availability** beside its
published/draft status; a Collection's works do not.

The design bet, stated in the README, is that art is not tidy data: an unset
field is not an empty one, `acquisitionDate` is a string ("circa 1889") rather
than a date, and money is stored as the text that was typed rather than parsed
into a float. The schema below is that bet made concrete.

## Architecture at a glance

A Bun workspaces monorepo. In production one Lambda serves both the API and the
built SPA behind one HTTP API, so the app is same-origin and there is no CORS.
Postgres holds the rows, S3 holds the media, and **every** read — row or byte —
goes through the API so one authorization layer covers both.

```
browser → API Gateway (custom domain) → Lambda (Hono) → Postgres / S3
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

Thirteen tables in Postgres with sharing and password protection, defined in
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

### `collections`

`id`, `userId`, `mediaNamespaceId`, `name`, `kind` (default `collection`),
`description?`, `skin?`, `skinOptions` (jsonb), `isPublic` (default `true`),
`passwordHash?`, `deletedAt?`, `createdAt`, `updatedAt`.

`kind` is `portfolio`, `collection` or `inventory`, `NOT NULL` with a constant
default (every row that predates it is a collector's) and CHECK-constrained to
the three values. Nothing writes it after create: a catalogue never changes
meaning underneath the works it holds. `0009_catalogue_kind` is pure generated
SQL — a constant default needs no backfill.

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
state, which is every Collection work, so `0010_artwork_availability` is pure
generated SQL and needs no backfill. The API accepts it on any work and never
checks it against the catalogue's kind; which kinds surface it is a presentation
decision.

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

All under `/api/v1`, in the app's error envelope; `/api/auth/*` is Better Auth's
own handler. The full route table is in `apps/api/README.md`. The shape of a
`GET` response is fixed by `apps/api/src/serialize.ts`, which emits the wire
types in `packages/shared/src/types.ts` (including the `{ seconds, nanoseconds }`
timestamp and the media-proxy `url` fields).

An artwork save carries `availability` like any other optional field: create
writes the value it names and null when it names none; PATCH sets a value,
clears it with `null`, and leaves the column alone when the key is absent. The
API never checks it against the catalogue's kind — the kind shapes the form,
not the schema — so a Collection's work may carry a state and keeps it. A
member read always emits the key, null included; a visitor's document does not
carry it at all, and no route gates on it.

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

The catalogue artwork list takes an optional member-only `q`. A present query
is a member condition ahead of the visitor verdict — a missing catalogue is
`404`, no session `401`, and a signed-in non-member (an Access grant holder
included) `403` — and a query over 200 characters or 10 terms is `400
validation` attributed to `q`. Matching normalizes both sides (NFD, diacritics
stripped, lowercased), splits the query on punctuation and requires every term
to appear somewhere in the joined text of the ten declared fields (title,
artist name, serie, medium, editions, date of creation, acquisition date, place
of origin, provenance, notes); terms may match different fields, and a query
that normalizes to no terms matches nothing. The acquisition date is searched in
both its stored `YYYY-MM-DD` and its displayed `MMMM D, YYYY` form. Deleted
works are never candidates and a member's drafts are. The filter runs in the API
over the rows the list already reads, after the visibility verdict, so only
matching works load their photos and documents; there is no SQL pushdown, no
extension and no migration, and the list read remains the single seam to
replace if catalogue sizes demand it. No matches is `200 []`, and an absent,
empty or whitespace-only `q` leaves the list unchanged.

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

## The frontend

`apps/web` is the SPA. `src/App.tsx` holds the routes:

- **Public** — `/` (product page), `/login`, `/signup`,
  `/reset-password` (the request) and `/reset-password/:token` (the form the
  mailed link lands on), `/invite/:token` (the invitation landing page, which
  shows the catalogue and invited email before sign-in), and the skin-rendered
  `/catalogue/:catalogueId` and `/catalogue/:catalogueId/artwork/:artworkId`.
- **Protected** — everything under `/manage`: the dashboard, a catalogue and its
  settings, artwork add/edit, the CSV import, and the account profile.

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

One pure module answers what a kind means for the surface.
`src/catalogueSurface.ts` returns, for a kind, the kind's own label and colour,
the labels of `name` and `description`, the market states that kind offers, and
whether that name is the artist's name. The colour
is a name from a literal union, never a Mantine type or a hex, and the record's
key type makes a fourth kind a build error until it has one; one presentational
badge renders it as a shade-3 fill with dark text, and that badge is the only
kind badge in the app. What screens read is the labels, the availability values
and the two creation defaults: `availabilityFor`, the one default that starts a
surfaced work at `available` and hands a Collection nothing, and
`newArtworkForm`, which answers what a create form starts as on one kind — in
one call, so a screen has no per-kind branch that could skip a kind. On a
Portfolio its new work starts credited to the portfolio's artist — the
catalogue's own name, because on that kind the two are the same fact; on an
Inventory and a Collection the field starts empty. The artist default is a
starting value, never a derived fact: the field stays editable and required, so
a work credited to a guest, an estate or an attribution saves exactly as typed,
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

Availability is the one artwork field the kind gates. On a Portfolio the
artwork form offers Available, Reserved and Sold beside Status — a Portfolio
sells the artist's own work, so it never offers on-consignment — and an
Inventory offers those three plus On consignment, for work it represents but
does not own. A work with no stored state starts Available; a stored value is
shown as it is and never overwritten by opening the form. A Collection's form
renders nothing for it and sends no key, so its works keep a null. The manage
list, the grid and the Deleted view badge a work's availability beside its
Draft badge on the two kinds only: the page derives one `showAvailability` from
the catalogue's kind and passes it down, so a value a Collection's work happens
to carry is never shown. The public views render none of it — availability is a
member-facing market fact, never a second gate, so a sold published work stays
visible to a visitor and the API leaves the key off a visitor's document
altogether.

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
**General** (the name and description its kind labels, public or private, and
the password control), **Public view** (the skin and the options the selected
skin declares, with the notice that some stored options are unused), **Access**
(the card described below) and **Data** (the CSV import card). Each tab is an
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
- **Rate limiting.** The unlock route is throttled per address and catalogue (a
  fixed ten-minute window in Postgres), but neither the invitation create route
  nor the password-reset mail is: both still go out at server speed. And the
  unlock throttle's identity is an address, which is shared behind a proxy and
  cheap to multiply, so it raises the cost of guessing rather than proving
  anything.
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
