// Structural contract for the schema.
//
// Two sources are asserted, because they can drift apart: the in-memory
// Drizzle object — what the API and the Better Auth adapter import — and the
// committed generated migration — what is actually applied to Postgres. A
// schema edit that is not regenerated shows up here as a mismatch; a
// load-bearing column (the (artworkId, order) uniqueness that enforces "array
// position is the truth", the two composite PKs, the four CHECKs, the
// composite indexes behind the artwork lists, the partial unique pending-
// invitation index) missing from either source fails here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  account,
  artworkDocuments,
  artworkPhotoVariants,
  artworkPhotos,
  artworks,
  collectionAccessGrants,
  collectionCollaborators,
  collectionInvitations,
  collectionUnlockAttempts,
  collections,
  schema,
  session,
  user,
  verification,
} from "../src/index";

type Col = {
  name: string;
  notNull: boolean;
  primary: boolean;
  isUnique: boolean;
  hasDefault: boolean;
  default?: unknown;
  dataType: string;
};

const cols = (table: PgTable): Record<string, Col> => getTableColumns(table);

// The table's extra config (indexes / unique indexes / primary keys /
// checks), as drizzle stores it. Drizzle keeps it behind a symbol; matching
// by name keeps this honest if drizzle ever renames the storage — a rename
// would fail the assertions below, not silently pass.
const extraConfigs = (table: PgTable): Array<Record<string, unknown>> => {
  const t = table as unknown as Record<symbol, unknown>;
  for (const sym of Object.getOwnPropertySymbols(t)) {
    if (String(sym).includes("ExtraConfigBuilder")) {
      return (t[sym] as (t: unknown) => unknown[])(t) as Array<
        Record<string, unknown>
      >;
    }
  }
  return [];
};

// A CHECK's predicate as SQL text, off the SQL object drizzle stores: the
// literal chunks are where the predicate lives.
const predicateOf = (value: unknown): string => {
  const chunks =
    (value as { queryChunks?: Array<{ value?: unknown }> }).queryChunks ?? [];
  return chunks
    .map((chunk) => (Array.isArray(chunk.value) ? chunk.value.join("") : ""))
    .join("");
};

const checksOf = (table: PgTable): Array<{ name?: string; sql: string }> =>
  getTableConfig(table).checks.map((c) => ({
    name: c.name,
    sql: predicateOf(c.value),
  }));

// The table's indexes, by name, as their ordered column names.
const indexesOf = (table: PgTable): Record<string, string[]> =>
  Object.fromEntries(
    getTableConfig(table).indexes.map((i) => [
      i.config.name ?? "",
      i.config.columns.map((c) => (c as { name: string }).name),
    ]),
  );

const TABLE_NAMES = [
  "user",
  "session",
  "account",
  "verification",
  "collections",
  "collectionCollaborators",
  "collectionInvitations",
  "collectionAccessGrants",
  "collectionUnlockAttempts",
  "artworks",
  "artworkPhotos",
  "artworkPhotoVariants",
  "artworkDocuments",
];

// A committed migration, read off disk: the DDL as it will actually be applied.
const readMigration = (tag: string): string =>
  readFileSync(
    fileURLToPath(new URL("..", import.meta.url)) + `migrations/${tag}.sql`,
    "utf8",
  );

// The data statements a migration runs, in order: DDL is not a row write.
const dataWrites = (sql: string): string[] =>
  [...sql.matchAll(/\b(UPDATE|INSERT|DELETE|TRUNCATE)\b/g)].map((m) => m[1]);

// The committed init migration.
const INIT_SQL = readMigration("0000_init");

// The committed migration that adds `status`.
const STATUS_SQL = readMigration("0001_artwork_status");

// The committed migration that retires the old per-work visibility column.
const DROP_SQL = readMigration("0002_drop_artwork_ispublic");

// The committed schema-first migration for sharing.
const SHARED_SQL = readMigration("0003_shared_collections");

// The committed follow-up that tightens the media namespace.
const NOT_NULL_SQL = readMigration("0004_media_namespace_not_null");

// The committed schema-first migration for password protection.
const PASSWORD_SQL = readMigration("0005_collection_passwords");

describe("the thirteen-table schema", () => {
  it("declares exactly the thirteen tables, and `user` is singular", () => {
    expect(Object.keys(schema)).toEqual(TABLE_NAMES);
  });

  it("user carries the four custom columns typed, not bagged", () => {
    const c = cols(user);
    expect(c.firstName.dataType).toBe("string");
    expect(c.firstName.notNull).toBe(false);
    expect(c.lastName.dataType).toBe("string");
    expect(c.lastName.notNull).toBe(false);
    expect(c.tier.notNull).toBe(true);
    expect(c.tier.default).toBe("free");
    expect(c.settings.dataType).toBe("json");
    expect(c.settings.notNull).toBe(false);
    // The core shape the adapter writes.
    expect(c.email.notNull).toBe(true);
    expect(c.email.isUnique).toBe(true);
    expect(c.emailVerified.notNull).toBe(true);
    expect(c.emailVerified.default).toBe(false);
  });

  it("session/account/verification keep the adapter's core shape", () => {
    const s = cols(session);
    expect(s.token.notNull).toBe(true);
    expect(s.token.isUnique).toBe(true);
    expect(s.expiresAt.dataType).toBe("date");
    const a = cols(account);
    // The 1.7.7 core model: providerId/accountId, no method/type columns.
    expect(a.providerId.notNull).toBe(true);
    expect(a.accountId.notNull).toBe(true);
    expect(a.password).toBeDefined();
    expect(a.method).toBeUndefined();
    expect(a.type).toBeUndefined();
    const v = cols(verification);
    expect(v.identifier.notNull).toBe(true);
    expect(v.value.notNull).toBe(true);
    expect(v.expiresAt.notNull).toBe(true);
  });

  it("artworks carries the descriptive fields and its status, and no array columns", () => {
    const c = cols(artworks);
    expect(Object.keys(c)).toEqual([
      "id",
      "userId",
      "collectionId",
      "title",
      "artistName",
      "serie",
      "dateOfCreation",
      "media",
      "dimensions",
      "editions",
      "acquisitionDate",
      "acquisitionPrice",
      "placeOfOrigin",
      "provenance",
      "notes",
      "condition",
      "currentValue",
      "status",
      "deletedAt",
      "createdAt",
      "updatedAt",
    ]);
    expect(c.title.notNull).toBe(true);
    expect(c.artistName.notNull).toBe(true);
    // Money stays text.
    expect(c.currentValue.dataType).toBe("string");
    // The owner's gate, required and defaulting to published.
    expect(c.status.notNull).toBe(true);
    expect(c.status.default).toBe("published");
    // NULL = live.
    expect(c.deletedAt.notNull).toBe(false);
  });

  it("artworks restricts `status` to draft or published in the Drizzle object", () => {
    expect(checksOf(artworks)).toContainEqual({
      name: "artworks_status_check",
      sql: "\"status\" in ('draft', 'published')",
    });
  });

  it("artworks carries the visitor index over the collection, the status and the deletion stamp", () => {
    expect(indexesOf(artworks)).toMatchObject({
      artworks_collection_status_deleted_idx: [
        "collectionId",
        "status",
        "deletedAt",
      ],
    });
  });

  it("artwork_photos keeps `order`; the uniqueness on (artworkId, order) is the order invariant", () => {
    const c = cols(artworkPhotos);
    expect(c.order.dataType).toBe("number");
    expect(c.order.notNull).toBe(true);
    expect(c.name.notNull).toBe(true);
  });

  it("artwork_photo_variants is keyed by (parentId, key), with no separate id", () => {
    const c = cols(artworkPhotoVariants);
    expect(c.id).toBeUndefined();
    expect(c.parentId.notNull).toBe(true);
    expect(c.key.notNull).toBe(true);
    expect(c.parentKind.notNull).toBe(true);
    expect(c.width.dataType).toBe("number");
    expect(c.contentType).toBeDefined();
    // The composite primary key lives on the table, not on the columns.
    const pk = extraConfigs(artworkPhotoVariants).find(
      (d) => Array.isArray(d.columns) && (d.columns as unknown[]).length === 2,
    );
    expect(
      (pk?.columns as Array<{ name: string }> | undefined)?.map(
        (col) => col.name,
      ),
    ).toEqual(["parentId", "key"]);
  });

  it("artwork_documents has kind + the source fields, and no order column", () => {
    const c = cols(artworkDocuments);
    expect(c.order).toBeUndefined();
    expect(c.kind.notNull).toBe(true);
    expect(c.name.notNull).toBe(true);
    expect(c.size.dataType).toBe("number");
    expect(c.width.notNull).toBe(false);
  });

  it("collections defaults to public; skin stays nullable (read-time default)", () => {
    const c = cols(collections);
    expect(c.isPublic.notNull).toBe(true);
    expect(c.isPublic.default).toBe(true);
    expect(c.skin.notNull).toBe(false);
    expect(c.skinOptions.dataType).toBe("json");
    // Fixed at creation and required once 0004 has run. The reader still
    // tolerates null, because the Lambda deploys before the migration does.
    expect(c.mediaNamespaceId.dataType).toBe("string");
    expect(c.mediaNamespaceId.notNull).toBe(true);
  });

  it("collections carries a nullable password hash, with no default to hide a gap", () => {
    const c = cols(collections);
    // Nullable is the whole point: a collection without a password is the
    // normal state, so no backfill and no NOT NULL step is owed later. A
    // default would invent a password none was set for.
    expect(c.passwordHash.dataType).toBe("string");
    expect(c.passwordHash.notNull).toBe(false);
    expect(c.passwordHash.hasDefault).toBe(false);
  });

  it("collection_access_grants keeps the token's hash, and indexes the collection for revocation", () => {
    const c = cols(collectionAccessGrants);
    expect(Object.keys(c)).toEqual([
      "collectionId",
      "tokenHash",
      "createdAt",
      "expiresAt",
    ]);
    expect(c.collectionId.notNull).toBe(true);
    // The raw token exists only in the reader's cookie, as with an invitation.
    expect(c.tokenHash.notNull).toBe(true);
    expect(c.tokenHash.isUnique).toBe(true);
    expect(c.createdAt.notNull).toBe(true);
    expect(c.createdAt.hasDefault).toBe(true);
    // Expiry is computed from the timestamp, never stored as a status.
    expect(c.expiresAt.dataType).toBe("date");
    expect(c.expiresAt.notNull).toBe(true);
    // One statement deletes a collection's grants on a password change.
    expect(indexesOf(collectionAccessGrants)).toMatchObject({
      collection_access_grants_collection_id_idx: ["collectionId"],
    });
  });

  it("collection_unlock_attempts is keyed by address, collection and window", () => {
    const c = cols(collectionUnlockAttempts);
    expect(Object.keys(c)).toEqual([
      "ip",
      "collectionId",
      "windowStart",
      "attempts",
    ]);
    expect(c.ip.notNull).toBe(true);
    expect(c.collectionId.notNull).toBe(true);
    expect(c.windowStart.dataType).toBe("date");
    expect(c.windowStart.notNull).toBe(true);
    expect(c.attempts.dataType).toBe("number");
    expect(c.attempts.notNull).toBe(true);
    expect(c.attempts.default).toBe(0);
    // The triple is the key: one counter per address, collection and window.
    const pk = getTableConfig(collectionUnlockAttempts).primaryKeys[0];
    expect(pk.columns.map((col) => col.name)).toEqual([
      "ip",
      "collectionId",
      "windowStart",
    ]);
  });

  it("collection_collaborators is keyed by (collectionId, userId), with the dashboard index on user", () => {
    const c = cols(collectionCollaborators);
    // The owner is `collections.userId`; this table holds everyone else.
    expect(Object.keys(c)).toEqual(["collectionId", "userId", "createdAt"]);
    expect(c.collectionId.notNull).toBe(true);
    expect(c.userId.notNull).toBe(true);
    expect(c.createdAt.dataType).toBe("date");
    expect(c.createdAt.notNull).toBe(true);
    expect(c.createdAt.hasDefault).toBe(true);
    const pk = getTableConfig(collectionCollaborators).primaryKeys[0];
    expect(pk.getName()).toBe(
      "collection_collaborators_collectionId_userId_pk",
    );
    expect(pk.columns.map((col) => col.name)).toEqual([
      "collectionId",
      "userId",
    ]);
    expect(indexesOf(collectionCollaborators)).toMatchObject({
      collection_collaborators_user_id_idx: ["userId"],
    });
  });

  it("collection_invitations carries the offer, its status and its unique token hash", () => {
    const c = cols(collectionInvitations);
    expect(Object.keys(c)).toEqual([
      "id",
      "collectionId",
      "email",
      "invitedByUserId",
      "tokenHash",
      "status",
      "createdAt",
      "expiresAt",
      "resolvedAt",
    ]);
    expect(c.id.primary).toBe(true);
    expect(c.collectionId.notNull).toBe(true);
    expect(c.email.notNull).toBe(true);
    expect(c.invitedByUserId.notNull).toBe(true);
    // The raw token lives only in the mail.
    expect(c.tokenHash.isUnique).toBe(true);
    expect(c.status.notNull).toBe(true);
    expect(c.status.default).toBe("pending");
    expect(c.createdAt.dataType).toBe("date");
    expect(c.createdAt.notNull).toBe(true);
    expect(c.createdAt.hasDefault).toBe(true);
    expect(c.expiresAt.dataType).toBe("date");
    expect(c.expiresAt.notNull).toBe(true);
    // NULL until the invitation is accepted, declined or revoked.
    expect(c.resolvedAt.dataType).toBe("date");
    expect(c.resolvedAt.notNull).toBe(false);
  });

  it("collection_invitations limits status to the four lifecycle values", () => {
    expect(checksOf(collectionInvitations)).toContainEqual({
      name: "collection_invitations_status_check",
      sql: "\"status\" in ('pending', 'accepted', 'declined', 'revoked')",
    });
  });

  it("collection_invitations allows one pending invitation per collection and address", () => {
    const pending = getTableConfig(collectionInvitations).indexes.find(
      (i) =>
        i.config.name === "collection_invitations_pending_collection_email_idx",
    );
    expect(pending?.config.unique).toBe(true);
    // The address half is `lower(email)`, so case cannot buy a second row.
    expect(
      (pending?.config.columns ?? []).map(predicateOf).join(", "),
    ).toContain("lower(");
    // Only pending rows are constrained; resolved rows are history.
    expect(predicateOf(pending?.config.where)).toContain("'pending'");
  });

  it("artworks' owner list is indexed by collection and deletion, not by user", () => {
    const idx = indexesOf(artworks);
    expect(idx.artworks_collection_deleted_idx).toEqual([
      "collectionId",
      "deletedAt",
    ]);
    expect(idx.artworks_collection_user_deleted_idx).toBeUndefined();
    // The visitor index and the by-id index are untouched.
    expect(idx.artworks_collection_status_deleted_idx).toEqual([
      "collectionId",
      "status",
      "deletedAt",
    ]);
    expect(idx.artworks_collection_id_idx).toEqual(["collectionId"]);
  });
});

describe("the committed migration (as it will actually be applied)", () => {
  it("creates the nine tables with the expected names, and never a `users` table", () => {
    const created = [...INIT_SQL.matchAll(/CREATE TABLE "([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(created.sort()).toEqual(
      [
        "user",
        "session",
        "account",
        "verification",
        "collections",
        "artworks",
        "artwork_photos",
        "artwork_photo_variants",
        "artwork_documents",
      ].sort(),
    );
    expect(INIT_SQL).not.toContain('"users"');
  });

  it("enforces the two CHECKs against the real (camelCase) column names", () => {
    expect(INIT_SQL).toContain(
      "CHECK (\"parentKind\" in ('photo', 'document'))",
    );
    expect(INIT_SQL).toContain("CHECK (\"kind\" in ('file', 'image'))");
  });

  it("makes (artworkId, order) unique and (parentId, key) the variant primary key", () => {
    expect(INIT_SQL).toMatch(
      /CREATE UNIQUE INDEX "artwork_photos_artwork_id_order_key" ON "artwork_photos" USING btree \("artworkId","order"\)/,
    );
    expect(INIT_SQL).toContain('PRIMARY KEY("parentId","key")');
  });

  it("carries the owner-list, by-id and lookup indexes the init migration creates", () => {
    expect(INIT_SQL).toContain(
      'USING btree ("collectionId","userId","deletedAt")',
    );
    expect(INIT_SQL).toMatch(
      /CREATE INDEX "artworks_collection_id_idx" ON "artworks" USING btree \("collectionId"\)/,
    );
    expect(INIT_SQL).toMatch(
      /CREATE INDEX "collections_user_id_idx" ON "collections" USING btree \("userId"\)/,
    );
    expect(INIT_SQL).toMatch(
      /CREATE INDEX "artwork_documents_artwork_id_idx" ON "artwork_documents" USING btree \("artworkId"\)/,
    );
  });

  it("uses timestamptz for every timestamp and the expected defaults", () => {
    // Every `timestamp` in the DDL must be `timestamp with time zone`.
    expect(INIT_SQL.replace(/timestamp with time zone/g, "")).not.toContain(
      "timestamp",
    );
    expect(INIT_SQL).toContain("DEFAULT 'free'");
    expect(INIT_SQL.match(/DEFAULT true NOT NULL/g)).toHaveLength(2);
    expect(INIT_SQL).toContain("DEFAULT false NOT NULL");
  });
});

describe("the committed status migration (as it will actually be applied)", () => {
  it("adds a required `status` defaulting to published, checked to draft or published", () => {
    expect(STATUS_SQL).toContain(
      `ALTER TABLE "artworks" ADD COLUMN "status" text DEFAULT 'published' NOT NULL`,
    );
    expect(STATUS_SQL).toContain(
      `CONSTRAINT "artworks_status_check" CHECK ("status" in ('draft', 'published'))`,
    );
  });

  it("backfills the status only after the column exists", () => {
    const adds = STATUS_SQL.indexOf(`ADD COLUMN "status"`);
    const backfill = STATUS_SQL.indexOf(`UPDATE "artworks" SET "status"`);
    expect(adds).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(adds);
  });
});

describe("the committed drop migration (as it will actually be applied)", () => {
  it("retires the old visibility column and the index built on it", () => {
    expect(DROP_SQL).toContain('ALTER TABLE "artworks" DROP COLUMN "isPublic"');
    expect(DROP_SQL).toContain(
      'DROP INDEX "artworks_collection_public_deleted_idx"',
    );
  });

  it("builds the visitor index over the collection, the status and the deletion stamp", () => {
    expect(DROP_SQL).toMatch(
      /CREATE INDEX "artworks_collection_status_deleted_idx" ON "artworks" USING btree \("collectionId","status","deletedAt"\)/,
    );
  });
});

describe("the committed sharing migration (as it will actually be applied)", () => {
  it("creates both sharing tables with no foreign keys", () => {
    expect(SHARED_SQL).toMatch(
      /CREATE TABLE "collection_collaborators" \([\s\S]*CONSTRAINT "collection_collaborators_collectionId_userId_pk" PRIMARY KEY\("collectionId","userId"\)/,
    );
    expect(SHARED_SQL).toMatch(
      /CREATE TABLE "collection_invitations" \([\s\S]*CONSTRAINT "collection_invitations_tokenHash_unique" UNIQUE\("tokenHash"\)/,
    );
    // Domain tables stay reference-free, like the ones before them.
    expect(SHARED_SQL).not.toContain("FOREIGN KEY");
    // Both timestamps are timestamptz defaulting to now(), in the DDL too.
    expect(
      SHARED_SQL.match(
        /"createdAt" timestamp with time zone DEFAULT now\(\) NOT NULL/g,
      ),
    ).toHaveLength(2);
  });

  it("adds the media namespace nullable, then backfills it from the owner", () => {
    expect(SHARED_SQL).toContain(
      'ALTER TABLE "collections" ADD COLUMN "mediaNamespaceId" text;',
    );
    // Nullable is load-bearing: the old code inserts collections without it.
    expect(SHARED_SQL).not.toMatch(
      /ADD COLUMN "mediaNamespaceId" text NOT NULL/,
    );
    const adds = SHARED_SQL.indexOf('ADD COLUMN "mediaNamespaceId"');
    const backfill = SHARED_SQL.indexOf(
      'UPDATE "collections" SET "mediaNamespaceId" = "userId"',
    );
    expect(adds).toBeGreaterThan(-1);
    expect(backfill).toBeGreaterThan(adds);
  });

  it("touches no row beyond the collections backfill", () => {
    // The migration is DDL plus one data write: no insert, delete or truncate
    // can ride along under a title that only checked UPDATE.
    expect(dataWrites(SHARED_SQL)).toEqual(["UPDATE"]);
    expect(SHARED_SQL).toContain(
      'UPDATE "collections" SET "mediaNamespaceId" = "userId"',
    );
  });

  it("carries the collaborator index and the partial unique pending-invitation index", () => {
    expect(SHARED_SQL).toMatch(
      /CREATE INDEX "collection_collaborators_user_id_idx" ON "collection_collaborators" USING btree \("userId"\)/,
    );
    expect(SHARED_SQL).toMatch(
      /CREATE UNIQUE INDEX "collection_invitations_pending_collection_email_idx" ON "collection_invitations" USING btree \("collectionId",lower\("email"\)\) WHERE "collection_invitations"\."status" = 'pending'/,
    );
  });

  it("limits invitation status to the four lifecycle values", () => {
    expect(SHARED_SQL).toContain(
      `CONSTRAINT "collection_invitations_status_check" CHECK ("status" in ('pending', 'accepted', 'declined', 'revoked'))`,
    );
  });

  it("replaces the owner-list index and leaves the visitor and collection indexes alone", () => {
    expect(SHARED_SQL).toContain(
      'DROP INDEX "artworks_collection_user_deleted_idx"',
    );
    expect(SHARED_SQL).toMatch(
      /CREATE INDEX "artworks_collection_deleted_idx" ON "artworks" USING btree \("collectionId","deletedAt"\)/,
    );
    expect(SHARED_SQL).not.toContain(
      'DROP INDEX "artworks_collection_status_deleted_idx"',
    );
    expect(SHARED_SQL).not.toContain('DROP INDEX "artworks_collection_id_idx"');
    expect(SHARED_SQL).not.toContain('DROP INDEX "collections_user_id_idx"');
  });
});

describe("the committed namespace migration (as it will actually be applied)", () => {
  it("backfills only the null rows from the owner, and writes nothing else", () => {
    // Scoped to NULL: the new code mints a namespace at creation, and a
    // backfill without the WHERE would overwrite it with the owner id and
    // strand every key built from it. This is the column 0003 added, not a
    // new one, and the update is the migration's only row write.
    expect(NOT_NULL_SQL).toMatch(
      /UPDATE "collections" SET "mediaNamespaceId" = "userId" WHERE "mediaNamespaceId" IS NULL/,
    );
    expect(NOT_NULL_SQL).not.toContain('ADD COLUMN "mediaNamespaceId"');
    expect(NOT_NULL_SQL).not.toContain('DROP COLUMN "mediaNamespaceId"');
    expect(dataWrites(NOT_NULL_SQL)).toEqual(["UPDATE"]);
  });

  it("sets NOT NULL only after both backfills, across 0003 and 0004", () => {
    const sequence = `${SHARED_SQL}\n${NOT_NULL_SQL}`;
    const adds = sequence.indexOf('ADD COLUMN "mediaNamespaceId" text;');
    const firstBackfill = sequence.indexOf(
      'UPDATE "collections" SET "mediaNamespaceId" = "userId"',
    );
    const finalBackfill = sequence.indexOf(
      'UPDATE "collections" SET "mediaNamespaceId" = "userId" WHERE "mediaNamespaceId" IS NULL',
    );
    const tightens = sequence.indexOf(
      'ALTER TABLE "collections" ALTER COLUMN "mediaNamespaceId" SET NOT NULL',
    );
    // add nullable (0003) → backfill (0003) → gap backfill (0004) → NOT NULL.
    // A SET NOT NULL before the final backfill fails on the first row the old
    // code inserted in the gap.
    expect(adds).toBeGreaterThan(-1);
    expect(firstBackfill).toBeGreaterThan(adds);
    expect(finalBackfill).toBeGreaterThan(firstBackfill);
    expect(tightens).toBeGreaterThan(finalBackfill);
    // Neither half does the other's job: the schema-first release cannot
    // tighten a column the old code still inserts without.
    expect(SHARED_SQL).not.toContain(
      'ALTER COLUMN "mediaNamespaceId" SET NOT NULL',
    );
  });
});

describe("the committed password migration (as it will actually be applied)", () => {
  it("creates both new tables, with no foreign keys", () => {
    expect(PASSWORD_SQL).toMatch(
      /CREATE TABLE "collection_access_grants" \([\s\S]*CONSTRAINT "collection_access_grants_tokenHash_unique" UNIQUE\("tokenHash"\)/,
    );
    expect(PASSWORD_SQL).toMatch(
      /CREATE TABLE "collection_unlock_attempts" \([\s\S]*PRIMARY KEY\("ip","collectionId","windowStart"\)/,
    );
    // Domain tables stay reference-free, like the ones before them.
    expect(PASSWORD_SQL).not.toContain("FOREIGN KEY");
  });

  it("adds the password hash nullable, with no NOT NULL step and no backfill", () => {
    expect(PASSWORD_SQL).toContain(
      'ALTER TABLE "collections" ADD COLUMN "passwordHash" text;',
    );
    // Nullable is load-bearing: a collection without a password is normal.
    expect(PASSWORD_SQL).not.toMatch(/ADD COLUMN "passwordHash" text NOT NULL/);
    expect(PASSWORD_SQL).not.toContain(
      'ALTER COLUMN "passwordHash" SET NOT NULL',
    );
  });

  it("writes no rows — the release is pure DDL", () => {
    // Unlike the sharing release, there is nothing to backfill: the new
    // column's absence IS the intended value, so a data write would be a bug.
    expect(dataWrites(PASSWORD_SQL)).toEqual([]);
  });

  it("carries the revocation index over the collection", () => {
    expect(PASSWORD_SQL).toMatch(
      /CREATE INDEX "collection_access_grants_collection_id_idx" ON "collection_access_grants" USING btree \("collectionId"\)/,
    );
  });

  it("keeps the password hash optional and defaultless in the DDL too", () => {
    // The in-memory schema says nullable with no default; this is the same
    // claim against the SQL actually applied. A `DEFAULT` here would invent a
    // password no owner set, and `NOT NULL` would fail on every existing row.
    expect(PASSWORD_SQL).toMatch(/"passwordHash" text[;,]/);
    expect(PASSWORD_SQL).not.toMatch(/"passwordHash" text[^;]*DEFAULT/);
  });

  it("types the grant and counter columns as the schema declares them", () => {
    // Column types are the other half of the two-source contract: a changed
    // `expiresAt` type or a missing default on `attempts` must not survive.
    expect(PASSWORD_SQL).toContain(
      '"expiresAt" timestamp with time zone NOT NULL',
    );
    expect(PASSWORD_SQL).toContain(
      '"createdAt" timestamp with time zone DEFAULT now() NOT NULL',
    );
    expect(PASSWORD_SQL).toContain('"ip" text NOT NULL');
    expect(PASSWORD_SQL).toContain('"attempts" integer DEFAULT 0 NOT NULL');
  });

  it("uses timestamptz for every timestamp", () => {
    // Stripping the qualified type leaves no bare `timestamp` anywhere.
    expect(PASSWORD_SQL.replace(/timestamp with time zone/g, "")).not.toContain(
      "timestamp",
    );
  });
});
