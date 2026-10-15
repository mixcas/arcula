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
- `src/app.ts` — the Hono app: the `onError` error envelope, the `www.` → apex
  308 redirect, CORS for the dev origin, `GET /api/health`, and the mounts
  (`/api/auth` → Better Auth; `/api/v1` → the resource routes; then the SPA).
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

## Modules

- `auth.ts` · `session.ts` · `authorize.ts` — the Better Auth instance (Drizzle
  adapter), session resolution, and the ownership/visibility checks.
- `media/keys.ts` — the object-key algebra (final and staging) and its parser;
  the parser is what makes the proxy's per-request authorization work from the
  key alone.
- `media/pipeline.ts` — Sharp: one decode, EXIF orientation, WebP variants.
- `media/variants.ts` — the variant geometry; one table drives the encoder, the
  tests and the key algebra.
- `media/promote.ts` — staged → final at save.
- `storage.ts` — the single S3 client. `S3_ENDPOINT` is required (it refuses to
  fall through to AWS's default); credentials come from `S3_ACCESS_KEY`/
  `S3_SECRET_KEY` in dev and the Lambda's IAM role in production.
- `db.ts` — postgres.js + Drizzle over `@arcula/db`.
- `email/provider.ts` — SMTP locally, Resend in production.
- `serialize.ts` — the exact wire shape of the `GET` responses.
- `errors.ts` · `http.ts` · `env.ts` — the error envelope, body parsing +
  transactions, and the parsed environment.

## Development

From the repo root: `bun run dev` brings up the local stack and the API on
`8000`. `bun run db:migrate` / `db:reset` / `db:seed` / `db:studio` drive Drizzle
against the local Postgres. `bun run test:api` runs the integration suite against
the real local stack (Postgres, SeaweedFS, Mailpit).
