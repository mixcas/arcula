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
- `src/spa.ts` — serves the built SPA for every non-`/api` path (deep links
  included): `index.html` is never cached, hashed assets are immutable, and a
  missing dist tree leaves the middleware inert (Vite is the SPA in dev).

## Routes

`/api/auth/*` is Better Auth's own handler — its response shape is the one
`@better-auth/react` consumes, so it is not wrapped in the app envelope.

`/api/v1/*` is the resource API, all under the error envelope:

| Method            | Path                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `GET` / `PATCH`   | `/me`                                                               |
| `GET`             | `/media?key=` — the object proxy (re-checks visibility per request) |
| `GET` / `POST`    | `/collections`                                                      |
| `GET` / `PATCH`   | `/collections/:collectionId`                                        |
| `POST`            | `/collections/:collectionId/import/csv`                             |
| `POST`            | `/collections/:collectionId/artworks/bulk-delete`                   |
| `POST`            | `/collections/:collectionId/artworks/:artworkId/restore`            |
| `POST`            | `/collections/:collectionId/maintenance/sweep`                      |
| `GET` / `POST`    | `/collections/:collectionId/artworks`                               |
| `GET` / `PATCH`   | `/collections/:collectionId/artworks/:artworkId`                    |
| `POST`            | `…/artworks/:artworkId/photos/stage` · `…/process`                  |
| `DELETE`          | `…/artworks/:artworkId/photos/:entryId`                             |
| `POST` / `DELETE` | the same three under `/documents`                                   |

A save is one Postgres transaction: the field write, the per-entry S3 copy
(staged → final) and the row upserts, then the row deletes for dropped entries.
S3 copies cannot roll back with the rows, so a failed save may leave final
objects with no row — the accepted residual the staging lifecycle and the sweep
route exist to clean up.

## Sharing (access administration built)

The read and write sides of sharing are built, and so is the invitation loop —
create, mail, preview, accept and decline — with the owner's administration of
the offers (the access read, resend, revoke), access ending (removal and
leaving) and the invitee's in-app list.
Ownership transfer and the access card's UI are not.
[ADR-0004](../../docs/adr/0004-collections-are-shared-by-membership.md) is the
accepted design for all of it.

Access is membership. `access.ts` answers the visitor and access questions as
pure functions over the collection, the viewer's membership and the row:
the owner (`collections.userId`) and every row of `collection_collaborators`
see the whole collection — drafts and soft-deleted works included — and its
documents, at every status, never a visitor. `authorize.ts` loads the
collection and the viewer's membership row for every read, and every write
path asks the same membership question through `requireMemberCollection` /
`requireMemberArtwork`: a collaborator changes every setting (public/private
included), creates, edits, imports, bulk-deletes, restores and sweeps exactly
as the owner does, while a non-member gets `403` and a missing collection
`404`. Only the access-administration routes below stay owner-only. A save
records `artworks.userId` as the collection's owner, never the session user:
it is a mirror, not an authorization fact. `GET /collections` returns owned
and shared collections together, name-ordered, each row with `role` and — on
a shared row — the owner's display name as `ownerName`; the public list keeps
its shape, and the dashboard's cap counter counts owned collections only.
Final media keys use the collection's fixed `mediaNamespaceId`, staging is per
uploader, and the proxy's staging branch admits the uploader whose prefix holds
the object while they are still a member of the collection.

The invitation loop is built: `POST /collections/:id/invitations` writes a
pending row and mails `CLIENT_ORIGIN/invite/:token`; the public
`GET /invitations/:token` previews it, and the invited account accepts or
declines with that token. The raw token is never stored — only its SHA-256
hash — and acceptance needs both the token and a session whose email matches.
`GET /collections/:id/access` is the access read: the caller's role, the owner
and the collaborators to every member, plus the pending invitations (expired
ones included) to the owner alone. Resend rotates the token, the expiry and the
issue time on the same pending row, once every 60 seconds; revoke records the
resolution. The invitee's `GET /me/invitations` lists the pending, unexpired
offers for their own address — never a token — and the in-app decline answers
`not-found` for anything that is not their own live offer. Access ends in two
places: the owner's `DELETE /collections/:id/collaborators/:userId` (removal,
`409` when the target is not a collaborator or is the owner) and the
collaborator's `DELETE /collections/:id/collaborators/me` (leaving, `409` for
the owner — transfer first — and `403` for a non-member). Both delete the
membership row, so the account is a visitor on its next request, and discard
that account's staging prefix for the collection, best effort: a storage failure
does not fail the action, and the staging lifecycle is the backstop. Saved works
and their final objects are untouched. Still not built: ownership transfer.

| Method   | Path                                                          |
| -------- | ------------------------------------------------------------- |
| `GET`    | `/collections/:collectionId/access`                           |
| `POST`   | `/collections/:collectionId/invitations`                      |
| `POST`   | `/collections/:collectionId/invitations/:invitationId/resend` |
| `DELETE` | `/collections/:collectionId/invitations/:invitationId`        |
| `DELETE` | `/collections/:collectionId/collaborators/:userId`            |
| `DELETE` | `/collections/:collectionId/collaborators/me`                 |
| `POST`   | `/collections/:collectionId/transfer`                         |
| `GET`    | `/invitations/:token`                                         |
| `POST`   | `/invitations/:token/accept` · `/invitations/:token/decline`  |
| `GET`    | `/me/invitations`                                             |
| `POST`   | `/me/invitations/:invitationId/decline`                       |

A malformed email is `validation` (400); a state conflict is `conflict` (409); a
collaborator attempting an owner-only access change is `forbidden` (403); a
wrong-account acceptance is `forbidden` with the invited email in `details`; an
invalid, expired, revoked, consumed or unknown invitation token is one
`not-found`, and so is the in-app decline of anything that is not the caller's
own live offer. The SPA's landing page is `/invite/:token`; the API preview is
`GET /invitations/:token`.

## Modules

- `auth.ts` · `session.ts` · `access.ts` · `authorize.ts` — the Better Auth
  instance (Drizzle adapter), session resolution, the pure access verdicts, and
  the collection, membership and row checks the routes share.
- `media/keys.ts` — the object-key algebra (final and staging) and its parser;
  the parser is what makes the proxy's per-request authorization work from the
  key alone. With sharing, final keys use the collection's fixed
  `mediaNamespaceId` and staging keys use the uploader's id.
- `media/pipeline.ts` — Sharp: one decode, EXIF orientation, WebP variants.
- `media/variants.ts` — the variant geometry; one table drives the encoder, the
  tests and the key algebra.
- `media/promote.ts` — staged → final at save.
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
