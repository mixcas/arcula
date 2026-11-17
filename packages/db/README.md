# @arcula/db

The Drizzle schema for the Arcula backend: fourteen tables, including the two
sharing tables from
[ADR-0004](../../docs/adr/0004-collections-are-shared-by-membership.md), the
two password tables from
[ADR-0005](../../docs/adr/0005-a-password-is-a-second-condition-on-a-public-collection.md)
and the write limiter's counter from
[ADR-0013](../../docs/adr/0013-agents-reach-arcula-through-a-hosted-mcp-server.md).

Four **Better Auth core tables** — `user`, `session`, `account`, `verification`
— with `user` extended by the four typed custom columns (`firstName`,
`lastName`, `tier`, `settings`) the API declares to the adapter. Ten **domain
tables**: `collections`, `collection_collaborators`,
`collection_invitations`, `collection_access_grants`,
`collection_unlock_attempts`, `account_write_windows`, `artworks`,
`artwork_photos`, `artwork_photo_variants`, `artwork_documents`. The sharing
tables are in the schema, and the feature code reads them on every access
question and writes them through the invitation, removal, leaving and transfer
routes. The two password tables and `collections.passwordHash` are read and
written by the password routes — and `collection_unlock_attempts` by the unlock
route alone, which is the throttle's whole surface. `account_write_windows` has
no reader and no writer yet: it ships alone, ahead of the MCP write limiter
that will claim it, per the rule that a schema change is deployed before the
code that reads it.

The Drizzle entity is **`catalogues`** and every sharing table is exported under
its Catalogue name (`catalogueCollaborators`, `catalogueInvitations`,
`catalogueAccessGrants`, `catalogueUnlockAttempts`), while the physical tables
keep their `collections` / `collection_*` names: renaming a table is a
non-additive migration that collides with deploy-before-migrate, and the
physical name is invisible (ADR-0010). The rule is worth stating once: **the
Drizzle entity is `catalogues`; the physical Postgres table is still
`collections`**, and the same holds for the four `collection_*` tables and for
every relation's `catalogueId` property, whose physical column stays
`"collectionId"`. A TS-only rename of a property or export therefore generates
no SQL.

Layout:

- `src/index.ts` — the schema. The single source of truth: the API imports it
  over a live driver, `drizzle-kit` reads it to generate migrations, and the
  tests assert its shape.
- `migrations/` — generated SQL (`drizzle-kit generate --name init`),
  committed. Hand edits are limited to three documented cases: a **data
  backfill** appended after generation, because drizzle-kit renders schema and
  never data (the `0001_artwork_status` migration's
  `UPDATE … SET "status" = 'draft'` from the retired per-work flag, and
  `0003_shared_collections`'s
  `UPDATE … SET "mediaNamespaceId" = "userId"`), the
  **add-nullable → backfill → set-not-null** sequence for a column that cannot
  be added `NOT NULL` on an existing table, and a **grant revoke** that
  drizzle-kit cannot render. The sharing schema splits the second across two
  migrations, one per release: `0003_shared_collections` creates the two
  sharing tables, replaces the owner-list index and adds `mediaNamespaceId`
  nullable, backfilled from `userId`; `0004_media_namespace_not_null`
  backfills only the rows the old code wrote in between
  (`WHERE "mediaNamespaceId" IS NULL`, so a namespace the new code minted
  survives) and then sets the column `NOT NULL`. `0003` shipped alone, the
  feature code followed, and `0004` tightened the column afterwards.
  `0005_collection_passwords` is the contrast: it adds
  `collections.passwordHash` nullable and creates the two password tables, and
  it needs **no** tightening step, because a catalogue without a password is
  the normal state rather than a gap to backfill. `0006_enable_rls` is the
  third hand edit: `enableRLS()` on each declaration makes drizzle-kit generate
  the `ENABLE ROW LEVEL SECURITY` statements for the tables that exist when it
  is generated, but a **grant** lives in
  Postgres's ACL, not in the schema declaration, so there is no schema-level
  fact for it to render — the guarded `DO` block that revokes `anon` and
  `authenticated` is appended by hand. The guard is deliberate: Supabase creates
  those roles, while the local stack and CI have neither, so an unguarded
  `REVOKE … FROM anon` would fail every `db:migrate` with `role "anon" does not
exist`. `0011_account_write_windows` repeats that append for the one table that
  ships after `0006`: the generated half is the `CREATE TABLE`, the primary key
  and the check, and the revoke is added by hand, because a migration can only
  lock down the tables it can see. `0009_catalogue_kind` and
  `0010_artwork_availability` are the other
  contrast: both are pure `generate` output. `kind` is `NOT NULL` with a constant
  default, so the existing rows are already right and no backfill is owed;
  `availability` is nullable, so a work without a market state is the normal
  state rather than a gap to tighten. Nothing else is edited by hand.
- `tests/` — the structural contract: the in-memory schema and the committed
  migration are asserted against each other's ground truth (the table shapes,
  the CHECKs, the indexes behind the artwork lists, the collaborator `userId`
  index and the partial unique pending-invitation index, the
  nullable → backfill → `NOT NULL` order, timestamptz, the defaults, the write
  limiter's `(userId, bucket, windowStart)` key, and the
  lock-down: RLS on all fourteen tables plus the guarded revoke and the absence
  of `FORCE ROW LEVEL SECURITY`).

Decisions the schema encodes: timestamptz everywhere a timestamp is stored;
money as `text` (the string that was typed — no float drift); `deletedAt` NULL
means live; `photos`/`documents` are tables, not array columns;
`artwork_photo_variants` keys on `(parentId, key)`, which is what makes a
re-save an idempotent upsert; `collections.userId` is the one owner fact and a
collaborator is a row in `collection_collaborators`;
`collections.mediaNamespaceId` is fixed at creation, so a transfer moves no
object; and `collection_invitations` stores the token's hash, never the token,
with one pending offer per catalogue and address as a partial unique index.
`catalogues.kind` is fixed at creation (`portfolio`, `collection`, `inventory`)
and `artworks.availability` is nullable (`available`, `reserved`, `sold`,
`on-consignment`), each guarded by a CHECK.
`artworks.userId` is a mirror of the catalogue owner, not an authorization
fact. `collections.passwordHash` is nullable and holds a one-way hash with its
salt and parameters in the string — there is no read-back and no default, and
`collection_access_grants` keeps a grant's hash, never its token, with the
catalogue indexed so a password change revokes in one statement.
`collections.deletedAt` is nullable, with no default and no backfill: a
catalogue without a stamp is live. `account_write_windows` keys on
`(userId, bucket, windowStart)`, with `count` defaulting to zero: one counter
row per account, bucket and window, so one atomic `INSERT … ON CONFLICT` is a
claim and no second table is needed for the import cap. Two buckets —
`write` (the per-second bucket every write spends) and `import` (the hourly
cap an import spends as well) — differ only in the value and in how the route
floors `windowStart`; the window lengths are policy, not schema, exactly as the
unlock throttle's are.

Every table enables RLS with zero policies, and `0006_enable_rls` revokes the
PostgREST roles' grants on what exists and on the defaults for what comes next;
a table that ships later carries the same guarded revoke in its own migration.
The API connects as the table **owner**, which bypasses RLS, so the lock-down is
invisible to the product; `FORCE ROW LEVEL SECURITY` must never be added,
because it would subject the owner to the empty policy set and blank every
read. A table added by hand outside the schema is still open — RLS defaults to
off — which is one reason the schema stays the single source of truth.

The revoke reaches `postgres`'s defaults only, and that is **accepted, not
overlooked** (#181). `ALTER DEFAULT PRIVILEGES` is per-grantor: a default ACL
governs the objects _its own role_ creates. `0006_enable_rls` runs as `postgres`,
which is not a member of `supabase_admin`, so the platform's second book of
defaults survives on both hosted projects — `supabase_admin` keeps full grants
for both client roles on tables and sequences it creates, and function `EXECUTE`
survives from both grantors (Postgres grants it to `PUBLIC`; no `public`
function exists today, and `0006` touches tables and sequences only by design).
The residue is accepted because every table in the schema is created by
`drizzle-kit migrate` as `postgres`, so the product's own path starts closed,
and the surviving grants become reachable only with the Data API enabled **and**
a table created in `public` by `supabase_admin` outside this schema. Closing it
would be dashboard state, not repository state: the statements must run as
`supabase_admin`, drizzle-kit cannot model a grant, and a fresh Supabase project
starts with the defaults again — so nothing in the tree could keep that promise.
Read `supabase_admin`'s rows in the post-deploy check as this known state rather
than as a failed revoke; the measurement and the reasoning are on #181.

The schema must stay **runtime-free**: no driver, no driver-specific types, no
DOM. Node types are available to the package (its tests read the migration off
disk) — the DOM-free guarantee is the `lib` array, and `@arcula/shared` is the
client-contract side of the same wall.

Regenerating a migration: `cd packages/db && bunx drizzle-kit generate` (after
sourcing the root `.env` if `migrate`/`studio` need `DATABASE_URL`). Change
`src/index.ts` and regenerate; the hand-added statements are the data backfill,
appended with a comment saying what it reads, the
add-nullable → backfill → set-not-null sequence above, and the guarded grant
revoke in `0006_enable_rls`.
