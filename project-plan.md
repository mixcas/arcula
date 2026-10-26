# Arcula — design

This document describes the product and the code as they stand. Where it and the
code disagree, the code is right — but a disagreement is a doc bug worth fixing.

> **Sharing is built.** Access is membership: `collections.userId` is the owner
> fact, a `collection_collaborators` row is everyone else, and the owner and
> every collaborator read and edit the whole collection, documents included.
> Inviting, resending, revoking, removing and transferring stay owner-only. The
> invitation loop, the invitee's in-app list, ownership transfer and the
> settings page's access card are built; the two mails are the invitation and
> the transfer notice. The model is accepted in
> [ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md), and the
> two-migration release order below is what shipped.

For the user-facing overview and setup, see [README.md](README.md). For the agent
working guide, see [AGENTS.md](AGENTS.md); the product's vocabulary is in
[GLOSSARY.md](GLOSSARY.md). Per-package detail lives in each package's own
`README.md` (`apps/api`, `packages/shared`, `packages/db`, `infra/cdk`).

## What the product is

An art collection manager for independent collectors. Accounts sign themselves
up, own a collection (one on the free tier), invite collaborators by email, and
record the artworks in it: title, artist, and the descriptive fields a real
collection needs — with photos and other documents attached. A collection can be
shared with collaborators, who edit it alongside the owner, and given a public
page whose presentation is chosen by a "skin".

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

Two permanent environments, and they are the same thing twice: one Lambda
carrying the API and the built SPA, behind one HTTP API, with its own S3 media
bucket and its own optional custom domain. Only what must differ differs.

| Environment | Host             | Stack       | Fed by | Disposable |
| ----------- | ---------------- | ----------- | ------ | ---------- |
| production  | `arcula.art`     | `Arcula`    | `main` | no         |
| dev         | `dev.arcula.art` | `ArculaDev` | `dev`  | yes        |

Dev is a full replica and not a toy: its own Postgres project, media bucket,
certificate, `AUTH_SECRET` and Resend key, so a wrecked dev database, a wiped
dev bucket or a revoked dev mail key cannot touch production's. It is public —
no authentication wall — and noindexed, which is what lets the same client the
product ships and the end-to-end verify pass run against it unchanged. Its
`/api/health` carries the deployed commit; production's carries no such key.
`NODE_ENV=production` on both, because it is what makes the session cookie
`Secure`.

Merging is deploying: a push to a branch deploys that branch's environment
through the same deploy script a laptop runs. Each environment's secrets live
in a GitHub Environment restricted to its branch, and the deploy identity is a
GitHub OIDC role pinned to that branch — no long-lived AWS key exists.

Migrations are forward-only, so a revert redeploys the code but not the schema.
A schema change the next release depends on therefore ships **alone** first:
`scripts/deploy.sh` deploys the Lambda before it migrates, so a release carrying
both would serve requests against tables that do not exist yet. A column that
must end up `NOT NULL` ships nullable first and is tightened in the release that
writes it; one migration that sets `NOT NULL` would break the old code's
inserts.

The reasoning, and the alternatives that were turned down, are not restated
here:

- [ADR-0001 — two long-lived branches, two permanent environments](docs/adr/0001-two-branches-two-environments.md)
- [ADR-0002 — one AWS account and one CDK bootstrap for both](docs/adr/0002-one-account-one-bootstrap.md)

The first-run order is in `infra/cdk/README.md`.

## The data model

Thirteen tables in Postgres with sharing and password protection, defined in
`packages/db/src/index.ts` and migrated in `packages/db/migrations/`.

### Auth (Better Auth core)

`user`, `session`, `account`, `verification`. `user` is extended with four typed
columns the API declares to the adapter: `firstName`, `lastName`, `tier`
(default `"free"`), and `settings` (jsonb). Email and the password credential
belong to Better Auth; nothing in the domain tables mirrors them.

`verification` exists even though email verification is off, so turning it on is
a config flip rather than a schema change.

### `collections`

`id`, `userId`, `mediaNamespaceId`, `name`, `description?`, `skin?`,
`skinOptions` (jsonb), `isPublic` (default `true`), `createdAt`, `updatedAt`.

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
hand-edited value cannot corrupt a collection.

Collections are never deleted in this model. `passwordHash` is nullable text —
a one-way scrypt hash with its salt and cost parameters encoded in the string —
so a collection with no password is the normal state rather than a gap to
backfill. The plaintext is never stored and never reaches a client under any
read, for any viewer, the owner included.

### `collection_access_grants` and `collection_unlock_attempts`

`collection_access_grants`: `collectionId`, `tokenHash` (unique), `createdAt`,
`expiresAt`, with an index on `collectionId` so a password change revokes a
collection's grants in one statement. It holds the SHA-256 hash of a 32-byte
token, never the token: a database leak is a set of unguessable hashes, not a
set of working grants. Expiry is computed from `expiresAt`, never stored as a
status.

`collection_unlock_attempts`: `(ip, collectionId, windowStart)` as the primary
key, plus `attempts` — the unlock throttle's counter, keyed by the pair so one
collection's throttle cannot lock visitors out of another's through a shared
address. The window length is the route's policy, not the schema's
(`unlockThrottle.ts`), and the unlock route is the only writer and reader.

### `collection_collaborators` and `collection_invitations`

`collection_collaborators`: `collectionId`, `userId`, `createdAt`, primary key
`(collectionId, userId)`, with an index on `userId` for the dashboard. The owner
is not duplicated here; a row is what makes an account a collaborator and is the
authorization fact for everything inside the collection.

`collection_invitations`: `id`, `collectionId`, `email`, `invitedByUserId`,
`tokenHash`, `status` (`pending` | `accepted` | `declined` | `revoked`),
`createdAt`, `expiresAt`, `resolvedAt?`, with a unique `tokenHash`. There is at
most one pending invitation per collection and email (stored trimmed and
lowercased), enforced by a partial unique index on
`(collectionId, lower(email)) WHERE status = 'pending'`. Resending rotates the
token, the expiry and the issue time on that row, which is also the 60-second
cooldown's clock. Accepted, declined and revoked rows are kept as history.
Expiry is computed from `expiresAt`, not a status. The raw token exists only in
the mail.

### `artworks`

`id`, `userId`, `collectionId`, `title`, `artistName` (both required), and the
optional descriptive fields `serie`, `dateOfCreation`, `media`, `dimensions`,
`editions`, `acquisitionDate`, `acquisitionPrice`, `placeOfOrigin`, `provenance`,
`notes`, `condition`, `currentValue` — all `text`, so the string that was typed
is the string that is stored. Plus `status` (`published` or `draft`, default
`published`), `deletedAt` (nullable), `createdAt`, `updatedAt`.

`userId` is a mirror of the collection owner, kept in step when a collection is
transferred; no route authorizes on it, and media URLs no longer derive their
namespace from it. No per-work creator is recorded.

The collection is the only gate on a visitor: a visitor sees a published, live
work exactly when its collection is public. There is no per-work visibility
flag — a work's only choice of its own is published or draft, and a draft counts
as part of its collection.

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
final:    artworks/{mediaNamespaceId}/{collectionId}/{artworkId}/{photos|documents}/{entryId}_{key}.{ext}
staging:  staging/{uploaderId}/{collectionId}/{artworkId}/{entryId}[_{key}].{ext}
```

The final namespace is the collection's `mediaNamespaceId`, fixed at creation:
a transfer changes the owner but never the key, so no object moves. Staging is
per uploader, so one collaborator's staged object is never under another's
prefix, and the sweep lists only the caller's prefix.

The `staging/` prefix leads deliberately: object-store lifecycle rules match
literal prefixes, so one rule expires every staged object everywhere.

1. **Stage** — the browser POSTs an original; the API validates the type against
   the accepted map, derives the extension from the _declared type_ (never the
   filename), and writes `staging/…/{entryId}.{ext}`. A decode gives the source
   dimensions. Re-staging the same entry id replaces it.
2. **Process** — Sharp decodes once, applies the EXIF orientation, and encodes
   every variant to WebP at quality 95. The variants: `xxlarge` (max 3000,
   inside), `xlarge` (max 2400, inside), `square_lg` (800 cover), `square_sm`
   (400 cover), `large` (max 1200, inside), `medium` (max 800, inside).
   `xxlarge` is the Collection PDF's source — its photo box needs 2417 px at
   300 dpi, past `xlarge`'s cap — and the widest `srcSet` candidate the
   slideshow offers. A document image gets only `square_sm` and `large` — the
   two a document actually renders with. A PDF has no variants; the original is
   the whole entry.
3. **Save** — one Postgres transaction writes the artwork fields, copies each
   entry's staged objects to their final keys, and upserts the rows; dropped
   entries lose their rows, and their final objects are deleted after commit.
   Staged objects are deleted after commit too. An S3 copy cannot roll back with
   the rows, so a failed save may leave final objects with no row — the accepted
   residual that the staging lifecycle (7 days) and the collection sweep route
   exist to clear.

Reads never touch S3 directly. `GET /api/v1/media?key=…` parses the key back into
its segments, re-checks visibility against the row, and streams the object:

- **final photo** — a member of the collection (the owner or a collaborator),
  or a visitor when the work is published **and** live **and** its collection is
  public;
- **final document** — the collection's members only (a visitor gets a `403`,
  so a forgotten-to-hide UI fails closed);
- **staged object** — the uploader whose staging prefix holds it, while they are
  still a member of the collection the entry was staged under.

## Access control

There is no rules language to audit: **the API is the only path to the data.**
`requireSession` / `resolveSession` establish the caller; `authorize.ts` loads
the collection, the viewer's membership row and the rows every write route
shares, and `access.ts` answers the access questions as pure functions over
those rows.

Access is membership, and the membership fact (`membershipOf`) says which of
two matrices applies. **Inside a collection** — the owner, and every account
with a `collection_collaborators` row — see the collection: every live work,
drafts included, and a deleted work by id; and its documents, at every status.
`artworks.userId` is never consulted for authorization; it mirrors the owner for
the wire document, nothing more. The read paths load the viewer's membership,
and every write path asks the same question through `requireMemberCollection`:
a collaborator changes every setting (public/private included), creates, edits,
imports, bulk-deletes, restores and sweeps exactly as the owner does. Only
access administration stays owner-only. Staging is per uploader, so
stage/process/discard and the sweep reach only the caller's own unsaved
uploads (ADR-0004).

**Outside it**, the visitor rule lives in `apps/api/src/access.ts`, pure over
rows a caller has already loaded: no database, no session, no framework. **The
collection is the only gate.** A visitor sees a published, live work exactly
when its collection is public; a draft, a deleted work and a private collection
are one answer to them, and a blocked work answers a uniform `404` — saying
which was refused would be a disclosure. (A private _collection_ answers `403`,
which the web client maps to its "private" state.) Signing in buys nothing here:
a Visitor and an anonymous reader are one membership, `null`. The list route
keeps its SQL filter, and a test pins the filter and the verdict to the same
answer ([ADR-0003](docs/adr/0003-the-collection-gates.md)).

**Protected** is that gate with a second condition in front of it, not a third
visibility state: a public collection whose `passwordHash` is set is readable by
a non-member only when the request carries a valid **Access grant**
([ADR-0005](docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md)).
Membership bypasses the challenge entirely, the grant admits exactly what a
visitor sees — published, live works, and never a draft or a document — and a
private collection stays closed to a grant holder. `canSeeCollection` and
`canSeeArtwork` take the grant as a fact beside membership; `authorize.ts`'s
`grantHeld` reads it off the cookie named for the collection (`arcula_grant_{id}`,
`Path=/api/v1`, because the media proxy is one route for every collection's
bytes, so the name rather than the path is the scope) and looks the row up by
the collection id and the token's hash. The collection read, the artwork list,
the single-artwork read and the media proxy all ask that one verdict, so the
password covers the row and the bytes alike. The anonymous list filters on
public **and not protected**, exactly as it excludes a private collection: a
protected collection is shared as a link, not found in an index. A refused
collection read answers `403 password-required` with the collection's name —
a challenge the lock screen answers, and the deliberate contrast with the
invitation token's uniform `not-found`, because here the artefact is not the
secret.

A collaborator is a row in `collection_collaborators`, never a second `userId`
on the collection, and the owner is not duplicated there. Documents are readable
by the owner and collaborators at every status, never by a visitor
([ADR-0004](docs/adr/0004-collections-are-shared-by-membership.md)). The
dashboard reads `GET /collections` — owned and shared together, name-ordered,
each row with `role` and a shared row with the owner's `ownerName` — and its
cap counter counts owned collections only, because the tier cap gates creation.

Soft delete is a `deletedAt` stamp: the work leaves every live list, the bytes
stay, and the collection's **Deleted** view lists the stamped works, most
recently deleted first, where one or several are restored. A deleted work's Edit
page says so, disables Save and the media uploaders, and offers Restore in
place, keeping any unsaved input. Restore clears the stamp and touches nothing
else, so the work returns with its status, fields, photos and documents as they
were. No purge and no retention window exist: a deleted row lives until it is
restored.

## The API

All under `/api/v1`, in the app's error envelope; `/api/auth/*` is Better Auth's
own handler. The full route table is in `apps/api/README.md`. The shape of a
`GET` response is fixed by `apps/api/src/serialize.ts`, which emits the wire
types in `packages/shared/src/types.ts` (including the `{ seconds, nanoseconds }`
timestamp and the media-proxy `url` fields).

Sharing is built. The owner creates an invitation; the mail is the only place
the raw token exists, and the invited account previews, accepts or declines it.
The owner administers the offers from `GET /collections/:id/access` (the
caller's role, the owner and the collaborators, plus the pending invitations to
the owner alone), resends (a fresh token, expiry and issue time on the same
row, once every 60 seconds) and revokes. The invitee's `GET /me/invitations`
lists their pending, unexpired offers — each with its collection and inviter —
and can decline one in app; acceptance is the mailed link's job. Access ends
when the owner removes a collaborator
(`DELETE /collections/:id/collaborators/:userId`) or a collaborator leaves
(`DELETE /collections/:id/collaborators/me`), both immediately and both
discarding only the departing account's staging prefix for that collection,
best effort. Ownership moves to an existing collaborator through
`POST /collections/:id/transfer`: one transaction updates the owner, mirrors
the artwork rows, persists the media namespace and swaps the two membership
rows; the namespace never moves, so every URL keeps working. The new owner is
mailed a link to the manage page (a failed notice answers `emailSent: false`
without undoing the transfer). These two mails — the invitation and the
transfer notice — are the only ones sharing sends, and both are best effort.
The error envelope gains `conflict` (409) for state conflicts; an invalid,
expired, revoked or consumed invitation token answers `not-found` like an
unknown one, as does an in-app decline of anything but the caller's own live
offer.

The settings write is partial. `PATCH /collections/:id` makes every field
optional — name and visibility included: an absent key leaves the column
alone, a present key validates as before (a name still trims and still cannot
be blank), and a body that names nothing is a valid, successful no-op that
changes no column and does not move the record's timestamp, so "updated"
continues to mean something was. The relaxation is strictly additive: a
bundle cached from before it still sends both fields and is still accepted,
and the two halves cannot skew, because the client and the server ship as one
Lambda.

Collection passwords ride the same write. A string sets (or overwrites) the
password, `null` removes it, and an absent key leaves it alone; the write
revokes the collection's grants in the same transaction, and the member read
carries `isPasswordProtected`, derived from the hash's presence, the hash
itself never leaving the server. `POST /collections/:id/unlock`
takes a password and answers `201` with the grant cookie or `403
invalid-password`; a collection with no password (or a private one) answers
`409`, because there is nothing to get past. Those new codes are `403`
(`password-required` for the challenge, `invalid-password` for a failed
attempt), and the envelope's fixed set gained them rather than overloading
`forbidden`.

Guessing is throttled. Each unlock attempt claims a failure slot for its
**(address, collection)** pair in `collection_unlock_attempts`, in a **fixed**
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

## The frontend

`apps/web` is the SPA. `src/App.tsx` holds the routes:

- **Public** — `/` (product page), `/login`, `/signup`,
  `/reset-password/:token`, `/invite/:token` (the invitation landing page, which
  shows the collection and invited email before sign-in), and the skin-rendered
  `/collection/:collectionId` and `/collection/:collectionId/artwork/:artworkId`.
- **Protected** — everything under `/manage`: the dashboard, a collection and its
  settings, artwork add/edit, the CSV import, and the account profile.

`src/services/` is the client layer (`api.ts` is the transport the domain
services share); `src/auth/` is the Better Auth React client; `src/skins/` is the
public-view system. A skin renders a public collection through `SkinHost`, which
scopes the skin's CSS variables so its type scale cannot leak onto `/manage`; a
skin must not use a portaled Mantine component, which would render outside that
scope. Skins are registered in `src/skins/registry.ts` (`basicx` is the default),
and a collection's stored options are resolved against the skin's declared specs
with an unknown key reported rather than silently dropped.

A Protected collection's lock screen is app chrome, not a skin: the public page
renders it beside the canonical-URL rewrite, outside the skin's scope, because
the lock is about the collection rather than how it is presented, and because a
prompt is the portaled component a skin may not use. It is reached as a state,
not an error: the collection read's `403 password-required` folds to `locked`,
the screen names the collection the refusal named, and a wrong password is the
one attempt failure with its own sentence. On success it calls the hook's
`reload`, which re-runs the ordinary load — collection first, artworks second —
with the grant cookie now set, so there is one path to ready. An expired grant
re-enters the same way: the next read is refused again and the reader lands back
on the lock screen rather than on an error page.

The dashboard lists owned and shared collections together with a role badge and
the owner's name on a shared row; its cap counter counts owned collections only.
A shared collection is readable and editable: the manage page's write controls
work for a collaborator exactly as for the owner, because the server answers
them by membership. Above that list sit the pending invitations addressed to
the signed-in account, each naming its collection and inviter and offering
decline only — acceptance is the mailed link, and the card says so.

The collection settings page is four tabs, each with its own save:
**General** (name, description, public or private, and the password control),
**Public view** (the skin and the options the selected skin declares, with the
notice that some stored options are unused), **Access** (the card described
below) and **Data** (the CSV import card). Each tab is an address —
`/settings/general`, `/settings/public`, `/settings/access`,
`/settings/data` — and a bare or unknown segment lands on General through the
effect that rewrites the collection's name-and-id in the address, so an old
settings link needs no redirect route of its own. Each tab saves only its own
half of the collection update, as the pure decision beside the page answers
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

`packages/shared/src/limits.ts` holds `COLLECTION_LIMITS` and
`collectionLimitForTier`. One map, imported by both sides, so the API's
enforcement and the client's messaging cannot disagree. The API checks the cap on
create and returns `limit-reached` (409); the client reads the same table to
reflect the cap in the UI. The cap counts collections an account **owns**;
collaborations do not count, and a transfer may take the recipient over the cap
without being refused. The free tier is one owned collection.

## What is not built

Roughly in order of how much it matters:

- **A read-only collaborator role.** Every collaborator can edit; a viewer would
  need a second permission matrix on the server and in every management screen.
- **Per-work attribution or an audit trail.** `artworks.userId` mirrors the
  collection owner, so the record does not say who added or edited a work.
- **Accepting or declining an ownership transfer.** A transfer is immediate and
  sends a notice; reversing it is another transfer.
- **Rate limiting.** The unlock route is throttled per address and collection (a
  fixed ten-minute window in Postgres), but neither the invitation create route
  nor the password-reset mail is: both still go out at server speed. And the
  unlock throttle's identity is an address, which is shared behind a proxy and
  cheap to multiply, so it raises the cost of guessing rather than proving
  anything.
- **A collaborator cap.** A collection may invite any number of collaborators.
- **Account deletion**, and what it means for a collection's owner or a
  collaborator.
- **Purge and retention for deleted works.** The collection's Deleted view lists
  and restores them; nothing purges long-dead rows or promises a retention
  window.
- **Delete a collection.** The model does not delete collections at all.
- **Export**, so a collector is never locked in.
- **Search and filtering**, once a collection is large enough to need it.
- **Account tiers and billing** — the hook the collection cap reads.
- **An always-on container.** `infra/Dockerfile` is the documented scale-up path
  from Lambda; it is not deployed.

## Open decisions

- **Which currency a price is in.** Prices are free text today. A per-account
  default (`locale`/`currency`) belongs on the `user.settings` jsonb column,
  which is the reason to settle it before export and reporting.
- **Email-verification's meaning.** `verification` exists and Better Auth can
  send the mail, but an unverified address is still a fully valid principal, so
  enabling it changes nothing unless a route also gates on it.
