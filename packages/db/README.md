# @arcula/db

The Drizzle schema for the Arcula backend (plan §4): nine tables. Four Better
Auth core tables (`user`, `session`, `account`, `verification`) — `user`
extended with the four typed custom columns of §0.3 — plus the five domain
tables: `collections`, `artworks`, `artwork_photos`, `artwork_photo_variants`,
`artwork_documents`.

Layout:

- `src/index.ts` — the schema. The single source of truth: the API imports it
  over a live driver, `drizzle-kit` reads it to generate migrations, and the
  tests assert its shape.
- `migrations/` — generated SQL (`drizzle-kit generate --name init`), committed.
  `db:reset`/`db:migrate` (in `apps/api`) apply it.
- `tests/` — the structural contract: the in-memory schema and the committed
  migration are asserted against each other's ground truth (the plan's table
  shapes, the two CHECKs, the composite indexes that replace the Firestore
  composites, timestamptz, the defaults).

The schema must stay **runtime-free**: no driver, no driver-specific types,
no DOM. Node types are available to the package (its tests read the
migration off disk) — the DOM-free guarantee is the `lib` array, and the
`shared` package is the client-contract side of the same wall.

Regenerating a migration: `cd packages/db && bunx drizzle-kit generate`
(after sourcing the root `.env` if `migrate`/`studio` need `DATABASE_URL`).
Never hand-edit `migrations/` — change `src/index.ts` and regenerate.
