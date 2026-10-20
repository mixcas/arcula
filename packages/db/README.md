# @arcula/db

The Drizzle schema for the Arcula backend: eleven tables, including the two
sharing tables from
[ADR-0004](../../docs/adr/0004-collections-are-shared-by-membership.md).

Four **Better Auth core tables** — `user`, `session`, `account`, `verification`
— with `user` extended by the four typed custom columns (`firstName`,
`lastName`, `tier`, `settings`) the API declares to the adapter. Seven **domain
tables** with sharing: `collections`, `collection_collaborators`,
`collection_invitations`, `artworks`, `artwork_photos`,
`artwork_photo_variants`, `artwork_documents`. The sharing tables are in the
schema; the feature code that reads and writes them is not built yet.

Layout:

- `src/index.ts` — the schema. The single source of truth: the API imports it
  over a live driver, `drizzle-kit` reads it to generate migrations, and the
  tests assert its shape.
- `migrations/` — generated SQL (`drizzle-kit generate --name init`),
  committed. Hand edits are limited to two documented cases: a **data
  backfill** appended after generation, because drizzle-kit renders schema and
  never data (the `0001_artwork_status` migration's
  `UPDATE … SET "status" = 'draft'` from the retired per-work flag, and
  `0003_shared_collections`'s
  `UPDATE … SET "mediaNamespaceId" = "userId"`), and the
  **add-nullable → backfill → set-not-null** sequence for a column that cannot
  be added `NOT NULL` on an existing table. The sharing design splits it across
  two migrations, one per release: `0003_shared_collections` adds
  `mediaNamespaceId` nullable and backfills it, and
  `0004_media_namespace_not_null` backfills the rows written in between and
  sets it `NOT NULL`. Nothing else is edited by hand.
- `tests/` — the structural contract: the in-memory schema and the committed
  migration are asserted against each other's ground truth (the table shapes,
  the CHECKs, the indexes behind the artwork lists, timestamptz, the defaults).

Decisions the schema encodes: timestamptz everywhere a timestamp is stored;
money as `text` (the string that was typed — no float drift); `deletedAt` NULL
means live; `photos`/`documents` are tables, not array columns;
`artwork_photo_variants` keys on `(parentId, key)`, which is what makes a
re-save an idempotent upsert; `collections.userId` is the one owner fact and a
collaborator is a row in `collection_collaborators`; and
`collections.mediaNamespaceId` is fixed at creation, so a transfer moves no
object. `artworks.userId` is a mirror of the collection owner, not an
authorization fact.

The schema must stay **runtime-free**: no driver, no driver-specific types, no
DOM. Node types are available to the package (its tests read the migration off
disk) — the DOM-free guarantee is the `lib` array, and `@arcula/shared` is the
client-contract side of the same wall.

Regenerating a migration: `cd packages/db && bunx drizzle-kit generate` (after
sourcing the root `.env` if `migrate`/`studio` need `DATABASE_URL`). Change
`src/index.ts` and regenerate; the hand-added statements are the data backfill,
appended with a comment saying what it reads, and — rarely — the
add-nullable → backfill → set-not-null sequence above.
