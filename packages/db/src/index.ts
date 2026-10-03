// The Drizzle schema: nine tables (plan §4). Four Better Auth core tables
// (extended with the typed `user` columns of §0.3) plus five domain tables.
//
// This package is the single source of truth for the schema: the API imports
// it over a live driver, the migration tooling reads it to generate SQL, and
// the tests assert its shape. It stays **runtime-free** — no driver, no
// driver-specific types, no DOM — so nothing here can leak a client runtime
// into the server or the reverse.
//
// `user` is singular on purpose: the Better Auth drizzle adapter expects its
// core tables under the names `user`, `session`, `account`, `verification`
// (§0.3). The core tables keep the adapter's generated shape — do not
// hand-roll deviations; if the adapter's documented schema changes, change it
// here in one place and regenerate.

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// timestamptz everywhere a timestamp is stored (plan §4).
const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Better Auth core tables
// ---------------------------------------------------------------------------

// Extended with the four custom columns (§0.3): typed, queryable, and
// declared through the adapter's `additionalFields` in apps/api. An
// undeclared custom column is the opaque sign-up failure (§5) — the
// declaration and these columns are asserted in tests on both sides.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  firstName: text("firstName"),
  lastName: text("lastName"),
  tier: text("tier").notNull().default("free"),
  settings: jsonb("settings"),
  createdAt: timestamptz("createdAt"),
  updatedAt: timestamptz("updatedAt"),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamptz("createdAt"),
  updatedAt: timestamptz("updatedAt"),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  accountId: text("accountId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt", {
    withTimezone: true,
  }),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt", {
    withTimezone: true,
  }),
  scope: text("scope"),
  password: text("password"),
  salt: text("salt"),
  verificationMethod: text("verificationMethod"),
  clientId: text("clientId"),
  method: text("method").notNull(),
  type: text("type").notNull(),
});

// Defined even though verification is gated off in beta (§5): that is what
// makes later enablement a config flip, not a schema change (G6).
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamptz("createdAt"),
  updatedAt: timestamptz("updatedAt"),
});

// ---------------------------------------------------------------------------
// Domain tables
// ---------------------------------------------------------------------------

// The Firestore `artworks: string[]` does not become a column: a denormalized
// list that the join replaces (G2). `passwordHash` was dead; if Phase 8 builds
// password-protected collections, its column is added then.
export const collections = pgTable(
  "collections",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // Read-time default `DEFAULT_SKIN_ID`; never queried on, so no backfill
    // was ever needed — the deliberate contrast with `deletedAt`.
    skin: text("skin"),
    skinOptions: jsonb("skinOptions"),
    isPublic: boolean("isPublic").notNull().default(true),
    createdAt: timestamptz("createdAt"),
    updatedAt: timestamptz("updatedAt"),
  },
  (table) => [index("collections_user_id_idx").on(table.userId)],
);

// `photos`/`documents` are tables, not array columns. Money stays text —
// the string that was typed, no float drift (§4).
export const artworks = pgTable(
  "artworks",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    collectionId: text("collectionId").notNull(),
    title: text("title").notNull(),
    artistName: text("artistName").notNull(),
    serie: text("serie"),
    dateOfCreation: text("dateOfCreation"),
    media: text("media"),
    dimensions: text("dimensions"),
    editions: text("editions"),
    acquisitionDate: text("acquisitionDate"),
    acquisitionPrice: text("acquisitionPrice"),
    placeOfOrigin: text("placeOfOrigin"),
    provenance: text("provenance"),
    notes: text("notes"),
    condition: text("condition"),
    currentValue: text("currentValue"),
    // Per-artwork, independent of the collection's flag.
    isPublic: boolean("isPublic").notNull().default(true),
    // NULL = live. Soft delete stays; the column replaces the Firestore field.
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    createdAt: timestamptz("createdAt"),
    updatedAt: timestamptz("updatedAt"),
  },
  (table) => [
    // The owner list: the Firestore composite, now a plain column.
    index("artworks_collection_user_deleted_idx").on(
      table.collectionId,
      table.userId,
      table.deletedAt,
    ),
    // The visitor list.
    index("artworks_collection_public_deleted_idx").on(
      table.collectionId,
      table.isPublic,
      table.deletedAt,
    ),
    // The artwork-by-id-in-collection check (create authorization).
    index("artworks_collection_id_idx").on(table.collectionId),
  ],
);

// The "array position is the truth" invariant, enforced by the database:
// one unique (artworkId, order) per artwork, 0-based.
export const artworkPhotos = pgTable(
  "artwork_photos",
  {
    id: text("id").primaryKey(),
    artworkId: text("artworkId").notNull(),
    order: integer("order").notNull(),
    // The original filename; metadata only, never in an object path.
    name: text("name").notNull(),
  },
  (table) => [
    uniqueIndex("artwork_photos_artwork_id_order_key").on(
      table.artworkId,
      table.order,
    ),
  ],
);

// One variants table serves both populations (photo variants and
// image-document variants). No separate `id`: a parent has at most one object
// per key, so the (parentId, key) pair is the primary key — which is exactly
// what makes promote-at-save an idempotent copy.
export const artworkPhotoVariants = pgTable(
  "artwork_photo_variants",
  {
    parentKind: text("parentKind").notNull(),
    parentId: text("parentId").notNull(),
    key: text("key").notNull(),
    // Actual encoded pixels, not nominal.
    width: integer("width"),
    height: integer("height"),
    size: integer("size"),
    // Recorded, not assumed.
    contentType: text("contentType"),
  },
  (table) => [
    primaryKey({ columns: [table.parentId, table.key] }),
    check(
      "artwork_photo_variants_parent_kind_check",
      sql`"parentKind" in ('photo', 'document')`,
    ),
  ],
);

// No `order` column: there is no sequence and no primary thumbnail for
// documents, so there is nothing for an index to mean.
export const artworkDocuments = pgTable(
  "artwork_documents",
  {
    id: text("id").primaryKey(),
    artworkId: text("artworkId").notNull(),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    contentType: text("contentType").notNull(),
    width: integer("width"),
    height: integer("height"),
  },
  (table) => [
    index("artwork_documents_artwork_id_idx").on(table.artworkId),
    check("artwork_documents_kind_check", sql`"kind" in ('file', 'image')`),
  ],
);

// The schema object drizzle-kit and the Better Auth adapter both read: table
// name → table.
export const schema = {
  user,
  session,
  account,
  verification,
  collections,
  artworks,
  artworkPhotos,
  artworkPhotoVariants,
  artworkDocuments,
};
