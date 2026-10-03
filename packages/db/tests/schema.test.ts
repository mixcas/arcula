// Structural contract for the schema (plan §4, §0.3).
//
// Two sources are asserted, because they can drift apart: the in-memory
// Drizzle object — what the API and the Better Auth adapter import — and the
// committed generated migration — what is actually applied to Postgres. A
// schema edit that is not regenerated shows up here as a mismatch; a column
// that the plan makes load-bearing (the (artworkId, order) uniqueness that
// enforces "array position is the truth", the variant composite PK, the two
// CHECKs, the indexes that replace the Firestore composites) missing from
// either source fails here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  account,
  artworkDocuments,
  artworkPhotoVariants,
  artworkPhotos,
  artworks,
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

const TABLE_NAMES = [
  "user",
  "session",
  "account",
  "verification",
  "collections",
  "artworks",
  "artworkPhotos",
  "artworkPhotoVariants",
  "artworkDocuments",
];

// The committed init migration: the DDL as it will actually be applied.
const INIT_SQL = (() => {
  const pkgRoot = fileURLToPath(new URL("..", import.meta.url));
  return readFileSync(pkgRoot + "migrations/0000_init.sql", "utf8");
})();

describe("the nine-table schema (§4)", () => {
  it("declares exactly the nine tables, and `user` is singular (§0.3)", () => {
    expect(Object.keys(schema)).toEqual(TABLE_NAMES);
  });

  it("user carries the four custom columns typed, not bagged (§0.3)", () => {
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
    expect(a.provider.notNull).toBe(true);
    expect(a.method.notNull).toBe(true);
    expect(a.type.notNull).toBe(true);
    expect(a.password).toBeDefined();
    expect(a.clientId).toBeDefined();
    const v = cols(verification);
    expect(v.identifier.notNull).toBe(true);
    expect(v.value.notNull).toBe(true);
    expect(v.expiresAt.notNull).toBe(true);
  });

  it("artworks is field-for-field with the shared Artwork type, and has no array columns", () => {
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
      "isPublic",
      "deletedAt",
      "createdAt",
      "updatedAt",
    ]);
    expect(c.title.notNull).toBe(true);
    expect(c.artistName.notNull).toBe(true);
    // Money stays text (§4).
    expect(c.currentValue.dataType).toBe("string");
    expect(c.isPublic.notNull).toBe(true);
    expect(c.isPublic.default).toBe(true);
    // NULL = live.
    expect(c.deletedAt.notNull).toBe(false);
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
  });
});

describe("the committed migration (§4 as it will actually be applied)", () => {
  it("creates the nine tables with the plan's names, and never a `users` table", () => {
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

  it("carries the indexes that replace the Firestore composites", () => {
    expect(INIT_SQL).toContain(
      'USING btree ("collectionId","userId","deletedAt")',
    );
    expect(INIT_SQL).toContain(
      'USING btree ("collectionId","isPublic","deletedAt")',
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

  it("uses timestamptz for every timestamp and the plan's defaults", () => {
    // Every `timestamp` in the DDL must be `timestamp with time zone`.
    expect(INIT_SQL.replace(/timestamp with time zone/g, "")).not.toContain(
      "timestamp",
    );
    expect(INIT_SQL).toContain("DEFAULT 'free'");
    expect(INIT_SQL.match(/DEFAULT true NOT NULL/g)).toHaveLength(2);
    expect(INIT_SQL).toContain("DEFAULT false NOT NULL");
  });
});
