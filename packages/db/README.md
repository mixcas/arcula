# @arcula/db

The Drizzle schema for the Arcula backend: nine tables.

Four **Better Auth core tables** — `user`, `session`, `account`, `verification`
— with `user` extended by the four typed custom columns (`firstName`,
`lastName`, `tier`, `settings`) the API declares to the adapter. Five **domain
tables**: `collections`, `artworks`, `artwork_photos`,
`artwork_photo_variants`, `artwork_documents`.

Layout:

- `src/index.ts` — the schema. The single source of truth: the API imports it
  over a live driver, `drizzle-kit` reads it to generate migrations, and the
  tests assert its shape.
- `migrations/` — generated SQL (`drizzle-kit generate --name init`),
  committed. `db:reset`/`db:migrate` (in `apps/api`) apply it.
- `tests/` — the structural contract: the in-memory schema and the committed
  migration are asserted against each other's ground truth (the table shapes,
  the CHECKs, the composite indexes behind the owner and visitor lists,
  timestamptz, the defaults).

Decisions the schema encodes: timestamptz everywhere a timestamp is stored;
money as `text` (the string that was typed — no float drift); `deletedAt` NULL
means live; `photos`/`documents` are tables, not array columns; and
`artwork_photo_variants` keys on `(parentId, key)`, which is what makes a
re-save an idempotent upsert.

The schema must stay **runtime-free**: no driver, no driver-specific types, no
DOM. Node types are available to the package (its tests read the migration off
disk) — the DOM-free guarantee is the `lib` array, and `@arcula/shared` is the
client-contract side of the same wall.

Regenerating a migration: `cd packages/db && bunx drizzle-kit generate` (after
sourcing the root `.env` if `migrate`/`studio` need `DATABASE_URL`). Never
hand-edit `migrations/` — change `src/index.ts` and regenerate.
