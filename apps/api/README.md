# @arcula/api

The Arcula backend: a Hono app that runs on Bun in development and on a Node 24
Lambda in production. It owns the resource API, Better Auth, the server-side
media pipeline, and — in production — serving the built SPA.

## Entry points

- `src/main.ts` — local dev: `Bun.serve({ port, fetch: app.fetch })` on `PORT`
  (default `8000`).
- `src/lambda.ts` — production: adapts an API Gateway HTTP API event (payload
  format 2.0) to a `Request` and back. Two details carry the weight: `Set-Cookie`
  travels in the response's top-level `cookies` array (not `multiValueHeaders`),
  and binary bodies are base64-encoded.
- `src/app.ts` — the Hono app: the `onError` error envelope, the canonical-host
  (`www` → configured origin) 308 redirect, CORS for the dev origin,
  `GET /api/health`, and the mounts (`/api/auth` → Better Auth; `/api/v1` →
  the resource routes; then the SPA).
- `src/spa.ts` — serves the built SPA for every non-`/api`, non-`/.well-known`
  path (deep links included): `index.html` is never cached, hashed assets are
  immutable, and a missing dist tree leaves the middleware inert (Vite is the
  SPA in dev).
- `src/mcp/` — the agent surface: `guard.ts` verifies the access token and the
  Connection's consent row, `server.ts` is the per-request MCP transport,
  `dispatcher.ts` runs a tool by name with a verified subject, `tool.ts`
  declares one, and `registry.ts` lists the tool groups under `tools/`.

## Routes

`/api/auth/*` is Better Auth's own handler — its response shape is the one
`@better-auth/react` consumes, so it is not wrapped in the app envelope.

`/.well-known/*` is OAuth discovery, routed to the auth handler (the plugins
answer it from an `onRequest` hook). An unmatched path is a 404, never the SPA
shell.

`/api/mcp` is the MCP endpoint: Streamable HTTP, stateless, one JSON answer per
request. An unauthenticated call answers `401` with the RFC 9728
`resource_metadata` challenge; a call whose Connection was revoked answers `401`
too, before the transport reads the body.

`/api/v1/*` is the resource API, all under the error envelope:

| Method                     | Path                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| `GET` / `PATCH`            | `/me`                                                               |
| `GET`                      | `/connections/request` — the verified OAuth consent query           |
| `GET`                      | `/media?key=` — the object proxy (re-checks visibility per request) |
| `GET` / `POST`             | `/catalogues`                                                       |
| `GET` / `PATCH` / `DELETE` | `/catalogues/:catalogueId`                                          |
| `POST`                     | `/catalogues/:catalogueId/unlock`                                   |
| `POST`                     | `/catalogues/:catalogueId/import/csv`                               |
| `GET`                      | `/catalogues/:catalogueId/deleted-artworks`                         |
| `POST`                     | `/catalogues/:catalogueId/artworks/bulk-delete`                     |
| `POST`                     | `/catalogues/:catalogueId/artworks/bulk-restore`                    |
| `POST`                     | `/catalogues/:catalogueId/artworks/:artworkId/restore`              |
| `POST`                     | `/catalogues/:catalogueId/maintenance/sweep`                        |
| `GET` / `POST`             | `/catalogues/:catalogueId/artworks`                                 |
| `GET` / `PATCH`            | `/catalogues/:catalogueId/artworks/:artworkId`                      |
| `POST`                     | `…/artworks/:artworkId/photos/stage` · `…/process`                  |
| `DELETE`                   | `…/artworks/:artworkId/photos/:entryId`                             |
| `POST` / `DELETE`          | the same three under `/documents`                                   |

A save is one Postgres transaction: the field write, the per-entry S3 copy
(staged → final) and the row upserts, then the row deletes for dropped entries.
S3 copies cannot roll back with the rows, so a failed save may leave final
objects with no row — the accepted residual the staging lifecycle and the sweep
route exist to clean up.

## Agent access

The MCP endpoint is one stateless transport per request. `guard.ts` wraps it
with `requireMcpAuth` (JWT verification against `/api/auth/jwks`, audience
`${AUTH_BASE_URL origin}/api/mcp`) and then reads the `oauthConsent` row for the
token's `(sub, client_id)`: absent means the Connection was revoked and the
answer is a `401` JSON-RPC error carrying the same `resource_metadata`
challenge, so a client reconnects. That read is also where "last acted" comes
from — `oauthConsent.updatedAt` is touched at most once a minute.

A tool is a `defineTool` declaration in `src/mcp/tools/`, listed in
`registry.ts`. Its `call` receives the Zod-parsed arguments and the verified
user id, and throws the app's `ApiError`; `server.ts` answers it as an MCP error
result whose text is `code: message`. No tool sees the access token, and no
tool takes a Hono `Context` — the user-id-taking cores in `authorize.ts`
(`memberCatalogueFor`, `memberArtworkFor`, `readableCatalogueFor`) are how a
write asks the app's own authorization question.

The consent screen is app-owned; `GET /api/v1/connections/request` verifies the
signed authorize query the provider redirected with (`verifyOAuthQueryParams`
against the auth instance's secret) and answers the client's public metadata,
the signed redirect host and the exact `oauth_query` to post back.

## Sharing

Sharing is built: the read and write sides, the member-readable access read,
the invitation loop — create, mail, preview, accept and decline — the owner's
administration of the offers (resend, revoke), access ending (removal and
leaving), ownership transfer and the invitee's in-app list. The settings page's
access card drives inviting, resending, revoking, removing, leaving and
transferring.
[ADR-0004](../../docs/adr/0004-collections-are-shared-by-membership.md) is the
accepted design for all of it.

Access is membership. `access.ts` answers the visitor and access questions as
pure functions over the catalogue, the viewer's membership and the row:
the owner (`catalogues.userId`) and every row of `catalogueCollaborators`
read every live work in the catalogue — drafts included — and a deleted work by
id, and its documents, at every status, never a visitor. A catalogue's
**Deleted** view lists the works carrying a deletion stamp, most recently
deleted first, and restores one or several; it is member-only, even on a public
catalogue. `authorize.ts` loads the catalogue and the viewer's membership row
for every read, and every write path asks the same membership question through
`requireMemberCatalogue` / `requireMemberArtwork`: a collaborator changes every
setting (public/private included), creates, edits, imports, bulk-deletes,
restores and sweeps exactly as the owner does, while a non-member gets `403`
and a missing catalogue `404`. Only deleting the catalogue and the
access-administration routes below stay owner-only. A save records
`artworks.userId` as the catalogue's owner, never the session user:
it is a mirror, not an authorization fact. `GET /catalogues` returns owned
and shared catalogues together, name-ordered, each row with `role` and — on
a shared row — the owner's display name as `ownerName`; the public list keeps
its shape, and the dashboard's cap counter counts owned live catalogues only.
Final media keys use the catalogue's fixed `mediaNamespaceId`, staging is per
uploader, and the proxy's staging branch admits the uploader whose prefix holds
the object while they are still a member of the catalogue.

The invitation loop is built: `POST /catalogues/:id/invitations` writes a
pending row and mails `CLIENT_ORIGIN/invite/:token`; the public
`GET /invitations/:token` previews it, and the invited account accepts or
declines with that token. The raw token is never stored — only its SHA-256
hash — and acceptance needs both the token and a session whose email matches.
`GET /catalogues/:id/access` is the access read: the caller's role, the owner
and the collaborators to every member, plus the pending invitations (expired
ones included) to the owner alone. Resend rotates the token, the expiry and the
issue time on the same pending row, once every 60 seconds; revoke records the
resolution. The invitee's `GET /me/invitations` lists the pending, unexpired
offers for their own address, each with the catalogue's name and the inviter's
display name — never a token and never the inviter's address — and the in-app
decline answers `not-found` for anything that is not their own live offer. Access ends in two
places: the owner's `DELETE /catalogues/:id/collaborators/:userId` (removal,
`409` when the target is not a collaborator or is the owner) and the
collaborator's `DELETE /catalogues/:id/collaborators/me` (leaving, `409` for
the owner — transfer first — and `403` for a non-member). Both delete the
membership row, so the account is a visitor on its next request, and discard
that account's staging prefix for the catalogue, best effort: a storage failure
does not fail the action, and the staging lifecycle is the backstop. Saved works
and their final objects are untouched. The owner hands the catalogue over with
`POST /catalogues/:id/transfer`: the target must already be a collaborator
(`409` otherwise), and one transaction moves `catalogues.userId`, mirrors
`artworks.userId`, removes the recipient's membership row and inserts the
previous owner's. The media namespace is fixed, so no object moves and every
existing URL keeps serving its bytes; the new owner is mailed a manage-page link
after the commit, and `emailSent: false` does not undo the transfer.

| Method   | Path                                                         |
| -------- | ------------------------------------------------------------ |
| `GET`    | `/catalogues/:catalogueId/access`                            |
| `POST`   | `/catalogues/:catalogueId/invitations`                       |
| `POST`   | `/catalogues/:catalogueId/invitations/:invitationId/resend`  |
| `DELETE` | `/catalogues/:catalogueId/invitations/:invitationId`         |
| `DELETE` | `/catalogues/:catalogueId/collaborators/:userId`             |
| `DELETE` | `/catalogues/:catalogueId/collaborators/me`                  |
| `POST`   | `/catalogues/:catalogueId/transfer`                          |
| `GET`    | `/invitations/:token`                                        |
| `POST`   | `/invitations/:token/accept` · `/invitations/:token/decline` |
| `GET`    | `/me/invitations`                                            |
| `POST`   | `/me/invitations/:invitationId/decline`                      |

A malformed email is `validation` (400); a state conflict is `conflict` (409); a
collaborator attempting an owner-only access change is `forbidden` (403); a
wrong-account acceptance is `forbidden` with the invited email in `details`; an
invalid, expired, revoked, consumed or unknown invitation token is one
`not-found`, and so is the in-app decline of anything that is not the caller's
own live offer. The SPA's landing page is `/invite/:token`; the API preview is
`GET /invitations/:token`.

## Protected catalogues

A **Protected** catalogue is a **Public** catalogue with a password: the
password is a second condition on the catalogue's gate, never a third
visibility state
([ADR-0005](../../docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md)).
A **Private** catalogue stays shut to a grant holder exactly as it is to every
other visitor.

**The password write is the catalogue update.** `PATCH
/catalogues/:catalogueId` takes `password` with the three meanings the
settings form needs: a string sets or overwrites it (eight characters minimum,
deliberately not trimmed), `null` removes it, and an absent key leaves the
column alone — which is why taking a catalogue private and public again
returns it to Protected. The plaintext is hashed with `scrypt`, the cost
parameters encoded in the stored string, before the transaction; the settings
write and the deletion of **every** Access grant row for the catalogue then
commit in one transaction, so a password change can never leave a reader
holding a grant to the old password. A `null` write revokes too, though there
is nothing left to admit. The hash itself is never a wire field.

**Reading a Protected catalogue.** `isPasswordProtected` is on every
member-audience catalogue document — each signed-in `GET /catalogues` row,
`GET /catalogues/:catalogueId` for the owner or a collaborator, and the
`POST /catalogues` and `PATCH /catalogues/:catalogueId` responses — derived
from the hash's presence. A visitor's document does not carry the field at
all, not even `false`. The anonymous `GET /catalogues` omits a Protected
catalogue exactly as it omits a Private one, so a Protected catalogue is
reachable only by its direct link.
Membership bypasses the challenge; a non-member needs a valid Access grant. A
refused catalogue read is `403 password-required` with the catalogue's name
in `details.catalogueName`, which the public pages fold to the lock screen. A
refused work, artwork list or media object is not that challenge: the list
answers `403 forbidden` (as a Private catalogue does), and a single work or a
photo object answers `404` (a document is `403` to a non-member, whatever the
catalogue).

**Unlocking.** `POST /catalogues/:catalogueId/unlock` takes
`{ "password": "…" }` — any non-empty guess, not the eight-character rule,
because a short guess is a wrong password rather than a malformed request. A
right password answers `201` `{ "unlocked": true }` and sets the Access grant
cookie. A wrong one is `403 invalid-password`, deliberately distinct from the
uniform `not-found` an invitation token gets: the lock screen already named the
catalogue, so it can say "that is not it". A catalogue with no password, or a
Private one, has nothing to get past and answers `409 conflict`; an unknown
catalogue is `404`. A grant admits exactly what a visitor sees — published,
live works, and never a draft or a document.

**The Access grant.** The cookie is `arcula_grant_{catalogueId}`:
`HttpOnly`, `SameSite=Lax`, `Path=/api/v1`, `Max-Age=43200` (twelve hours), and
`Secure` in production. Its value is a 32-byte random token; the row stores
only its SHA-256 hash, with the same twelve-hour expiry, so the cookie lapses
when the row does. The cookie's name is its scope: each route reads only the
name for the catalogue it serves and looks the row up by catalogue id and
token hash, so the broad path does not admit one catalogue's grant to
another's reads. An expired or revoked grant lands the reader back on the lock
screen.

**The unlock throttle.** Guessing is counted in `catalogueUnlockAttempts`,
one row per address, catalogue and **fixed** ten-minute window, floored from
the attempt's own time. Ten failures spend the window and the eleventh attempt
is refused unread — before the password is checked — as `429
too-many-attempts` with `details.windowMinutes`. The refusal states the window
and not the time left in it, and sends no `Retry-After`. A right password
deletes every counter row for that address and catalogue, so a member who
mistyped carries no debt; the pair is the key, so one catalogue's throttle
cannot lock a shared address out of another's. The address is the gateway's
`sourceIp`, carried by the Lambda entry in `x-arcula-client-ip` and never read
from a forwarding header (`clientAddress.ts`).

## Modules

- `auth.ts` · `session.ts` · `access.ts` · `authorize.ts` — the Better Auth
  instance (Drizzle adapter), session resolution, the pure access verdicts, and
  the catalogue, membership and row checks the routes share.
- `cataloguePassword.ts` — the stored password's two facts: `hashPassword`
  (scrypt, with the cost encoded in the string) and `verifyPassword`. No
  plaintext is stored or logged, and a malformed hash is a failed check, not a
  `500`.
- `catalogueGrants.ts` — the Access grant's pure facts: the 32-byte token,
  its SHA-256 hash, the cookie name and path, the twelve-hour lifetime, and
  whether a row is still usable. No database and no Hono.
- `unlockThrottle.ts` — the throttle's policy: the fixed ten-minute window and
  the flooring that names the span an attempt belongs to.
- `clientAddress.ts` — the address the unlock throttle counts against, read
  from the gateway-written `x-arcula-client-ip` header and never from a
  client-supplied forwarding header.
- `artworkRead.ts` — the single read path for works, one and listed, with the
  access verdict applied over the rows it loads. It carries no HTTP type; the
  route owns the wire codes.
- `invitations.ts` — the invitation token algebra and the usability and
  resendability questions the routes ask of a row.

- `media/keys.ts` — the object-key algebra (final and staging) and its parser;
  the parser is what makes the proxy's per-request authorization work from the
  key alone. With sharing, final keys use the catalogue's fixed
  `mediaNamespaceId` and staging keys use the uploader's id.
- `media/pipeline.ts` — Sharp: one decode, EXIF orientation, WebP variants.
- `media/variants.ts` — the variant geometry; one table drives the encoder, the
  tests and the key algebra.
- `media/promote.ts` — staged → final at save.
- `media/populations.ts` — what differs between Photos and documents in one
  record: caps, accepted types, the entry table, the variant specs, the key
  shape and whether a non-image is admissible.
- `storage.ts` — the single S3 client. `S3_ENDPOINT` is required (it refuses to
  fall through to AWS's default); credentials come from `S3_ACCESS_KEY`/
  `S3_SECRET_KEY` in dev and the Lambda's IAM role in production.
- `db.ts` — postgres.js + Drizzle over `@arcula/db`.
- `email/provider.ts` — SMTP locally, Resend in production; the invitation and
  transfer mails go through it, with `emailSent: false` on a provider failure.
- `serialize.ts` — the exact wire shape of the `GET` responses.
- `errors.ts` · `http.ts` · `env.ts` — the error envelope, body parsing +
  transactions, and the parsed environment.
- `responsePolicy.ts` — the environment-derived response decisions as pure
  functions: the canonical-host redirect, the health body, and the noindex
  flag. `env.ts` reads their inputs once at import; the app hands them in, so
  no environment's hostname or commit is written into the source.

## Development

From the repo root: `bun run dev` brings up the local stack and the API on
`8000`. `bun run db:migrate` / `db:reset` / `db:seed` / `db:studio` drive Drizzle
against the local Postgres. `bun run test:api` runs the integration suite against
the real local stack (Postgres, SeaweedFS, Mailpit).
