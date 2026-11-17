// The Drizzle schema: thirteen tables. Four Better Auth core tables (extended
// with the typed `user` columns), five domain tables, the two sharing tables
// (`collection_collaborators`, `collection_invitations`) and the two a
// protected catalogue needs (`collection_access_grants`,
// `collection_unlock_attempts`).
//
// The Catalogue entity is exported as `catalogues`; its physical table stays
// `collections` (ADR-0010). Physical names — tables, columns, indexes,
// checks — are storage and never follow a rename.
//
// This package is the single source of truth for the schema: the API imports
// it over a live driver, the migration tooling reads it to generate SQL, and
// the tests assert its shape. It stays **runtime-free** — no driver, no
// driver-specific types, no DOM — so nothing here can leak a client runtime
// into the server or the reverse.
//
// `user` is singular on purpose: the Better Auth drizzle adapter expects its
// core tables under the names `user`, `session`, `account`, `verification`.
// The core tables keep the adapter's generated shape — do not
// hand-roll deviations; if the adapter's documented schema changes, change it
// here in one place and regenerate.
//
// Every table enables RLS with zero policies, and `0006_enable_rls` revokes the
// PostgREST roles' grants. The API connects as the table owner, which bypasses
// RLS, so this is invisible to the product. Never add `FORCE ROW LEVEL
// SECURITY`: it would subject the owner to the empty policy set and blank
// every query.

import { sql } from "drizzle-orm";
import type {
  ArtworkAvailability,
  ArtworkFieldDeviations,
  CatalogueKind,
} from "@arcula/shared";
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

// timestamptz everywhere a timestamp is stored.
const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().defaultNow();

// ---------------------------------------------------------------------------
// Better Auth core tables
// ---------------------------------------------------------------------------

// Extended with the four custom columns: typed, queryable, and declared
// through the adapter's `additionalFields` in apps/api. An undeclared custom
// column is the opaque sign-up failure — the declaration and these columns
// are asserted in tests on both sides.
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  firstName: text("firstName"),
  lastName: text("lastName"),
  tier: text("tier").notNull().default("free"),
  // $type is compile-time only (no SQL, no migration); without it drizzle
  // infers the jsonb as `{}`.
  settings: jsonb("settings").$type<Record<string, unknown> | null>(),
  createdAt: timestamptz("createdAt"),
  updatedAt: timestamptz("updatedAt"),
}).enableRLS();

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
}).enableRLS();

// The 1.7.7 core model, exactly: providerId/accountId, no method/type.
// The adapter validates this at construction time (schema check), so a
// hand-rolled extra NOT NULL column is a hard error, not a silent one.
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  providerId: text("providerId").notNull(),
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
  createdAt: timestamptz("createdAt"),
  updatedAt: timestamptz("updatedAt"),
}).enableRLS();

// Defined even though verification is gated off in beta: that is what makes
// later enablement a config flip, not a schema change.
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  createdAt: timestamptz("createdAt"),
  updatedAt: timestamptz("updatedAt"),
}).enableRLS();

// ---------------------------------------------------------------------------
// Domain tables
// ---------------------------------------------------------------------------

// A catalogue's artwork-field deviations: an entry records a choice the member
// made, and an absent key follows the Kind default, so the map stays sparse.
// `null` and `{}` both mean pure defaults. The keys and the per-Kind defaults
// live in `@arcula/shared`'s registry — the table stores the map, it does not
// define it.

// There is no `artworks: string[]` column: it would be a denormalized list the
// join replaces.
//
// The physical table is still `collections`: renaming it is a non-additive
// migration that collides with deploy-before-migrate, and the name is
// invisible (ADR-0010).
export const catalogues = pgTable(
  "collections",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    // Fixed at creation and the second segment of every final object key, so
    // an ownership transfer moves no object. Required since
    // `0004_media_namespace_not_null`, which backfilled every row the old code
    // wrote in the gap; the reader keeps `mediaNamespaceId ?? userId` because
    // the Lambda still deploys before that migration runs.
    mediaNamespaceId: text("mediaNamespaceId").notNull(),
    name: text("name").notNull(),
    // Whose art this catalogue holds and why, fixed at creation (ADR-0010).
    // Every existing row is a collector's, so the constant default is the
    // truth and no backfill is owed. The check spells the three values out, as
    // `artworks.status` does, so the database refuses an unknown kind even when
    // it arrives from outside the typed reader.
    kind: text("kind").$type<CatalogueKind>().notNull().default("collection"),
    // The catalogue's artwork-field deviations from that Kind's defaults.
    // Nullable on purpose: a catalogue that never deviated is the normal state,
    // so there is no backfill and no tightening step. Nothing reads or writes
    // it yet; the feature that resolves it ships in a later release.
    artworkFields: jsonb(
      "artworkFields",
    ).$type<ArtworkFieldDeviations | null>(),
    description: text("description"),
    // Read-time default `DEFAULT_SKIN_ID`; never queried on, so it needs no
    // backfill — the deliberate contrast with `deletedAt`.
    skin: text("skin"),
    skinOptions: jsonb("skinOptions"),
    isPublic: boolean("isPublic").notNull().default(true),
    // A one-way hash with its salt and parameters in the string, or NULL for a
    // catalogue anyone may read. Nullable on purpose: a catalogue without a
    // password is the normal state, not a gap to backfill, so this column needs
    // no tightening step. The plaintext is never stored, and there is no
    // read-back path by design (ADR-0005).
    passwordHash: text("passwordHash"),
    // NULL = live, as on `artworks`. Nullable with no backfill: a catalogue
    // without a stamp is the normal state, not a gap to tighten later.
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    createdAt: timestamptz("createdAt"),
    updatedAt: timestamptz("updatedAt"),
  },
  (table) => [
    index("collections_user_id_idx").on(table.userId),
    check(
      "collections_kind_check",
      sql`"kind" in ('portfolio', 'collection', 'inventory')`,
    ),
  ],
).enableRLS();

// Everyone with access except the owner. The owner is `catalogues.userId`
// and is never duplicated here: one owner fact, one place.
export const catalogueCollaborators = pgTable(
  "collection_collaborators",
  {
    catalogueId: text("collectionId").notNull(),
    userId: text("userId").notNull(),
    createdAt: timestamptz("createdAt"),
  },
  (table) => [
    primaryKey({ columns: [table.catalogueId, table.userId] }),
    // The dashboard list: the catalogues shared with one account.
    index("collection_collaborators_user_id_idx").on(table.userId),
  ],
).enableRLS();

// The offer: one row per invitation, kept as history after it resolves.
// Expiry is computed from `expiresAt`, never stored as a status.
export const catalogueInvitations = pgTable(
  "collection_invitations",
  {
    id: text("id").primaryKey(),
    catalogueId: text("collectionId").notNull(),
    // Stored trimmed and lowercased; the index below compares lower(email).
    email: text("email").notNull(),
    invitedByUserId: text("invitedByUserId").notNull(),
    // The raw token exists only in the mail; the row keeps its hash.
    tokenHash: text("tokenHash").notNull().unique(),
    status: text("status").notNull().default("pending"),
    // The time of the current issue; refreshed on resend, which is what gives
    // the 60-second cooldown a clock without another column.
    createdAt: timestamptz("createdAt"),
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
  },
  (table) => [
    // One pending invitation per catalogue and address. Resolved rows are
    // history, so they fall outside the partial index.
    uniqueIndex("collection_invitations_pending_collection_email_idx")
      .on(table.catalogueId, sql`lower(${table.email})`)
      .where(sql`${table.status} = 'pending'`),
    check(
      "collection_invitations_status_check",
      sql`"status" in ('pending', 'accepted', 'declined', 'revoked')`,
    ),
  ],
).enableRLS();

// An Access grant: what a reader holds after entering a protected
// catalogue's password. The row keeps the token's hash, never the token, so a
// database leak is a set of unguessable hashes rather than a set of working
// grants. Expiry is computed from `expiresAt` rather than stored as a status,
// and the index below exists so that revoking a catalogue's grants on a
// password change is one statement (ADR-0005).
export const catalogueAccessGrants = pgTable(
  "collection_access_grants",
  {
    catalogueId: text("collectionId").notNull(),
    tokenHash: text("tokenHash").notNull().unique(),
    createdAt: timestamptz("createdAt"),
    // When the grant stops being usable. The TTL is policy, decided by the
    // route that mints the row; the schema only carries the clock.
    expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  },
  (table) => [
    // Revocation: deleting one catalogue's grants in a single statement.
    index("collection_access_grants_collection_id_idx").on(table.catalogueId),
  ],
).enableRLS();

// The unlock throttle's counter: one row per address, catalogue and window.
// `attempts` counts failures, and a window lapses once its start is older than
// the window length — which is policy the unlock route owns, not the schema.
// Keying on both identifiers keeps one catalogue's throttle from locking
// visitors out of another's through a shared address (ADR-0005).
export const catalogueUnlockAttempts = pgTable(
  "collection_unlock_attempts",
  {
    ip: text("ip").notNull(),
    catalogueId: text("collectionId").notNull(),
    // The window's start, floored from the attempt time, so a row names the
    // window it belongs to without a second clock column.
    windowStart: timestamp("windowStart", { withTimezone: true }).notNull(),
    attempts: integer("attempts").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.ip, table.catalogueId, table.windowStart] }),
  ],
).enableRLS();

// `photos`/`documents` are tables, not array columns. Money stays text —
// the string that was typed, no float drift.
export const artworks = pgTable(
  "artworks",
  {
    id: text("id").primaryKey(),
    userId: text("userId").notNull(),
    catalogueId: text("collectionId").notNull(),
    title: text("title").notNull(),
    artistName: text("artistName").notNull(),
    serie: text("serie"),
    dateOfCreation: text("dateOfCreation"),
    medium: text("medium"),
    dimensions: text("dimensions"),
    editions: text("editions"),
    acquisitionDate: text("acquisitionDate"),
    acquisitionPrice: text("acquisitionPrice"),
    placeOfOrigin: text("placeOfOrigin"),
    provenance: text("provenance"),
    notes: text("notes"),
    condition: text("condition"),
    currentValue: text("currentValue"),
    // A work's market state on a Portfolio or an Inventory. Null means no
    // market state — every Collection work, and every work written before the
    // column existed. The check keeps the four values the shared enum names.
    availability: text("availability").$type<ArtworkAvailability>(),
    // The owner's choice, and the only per-work field a visitor is gated on:
    // `published` or `draft`. The catalogue is the whole gate; there is no
    // per-work visibility flag.
    status: text("status").notNull().default("published"),
    // NULL = live. Soft delete: the column is the sole record of deletion.
    deletedAt: timestamp("deletedAt", { withTimezone: true }),
    createdAt: timestamptz("createdAt"),
    updatedAt: timestamptz("updatedAt"),
  },
  (table) => [
    // The owner list: a catalogue's live works, no `userId` filter — the
    // owner and every collaborator see the same list.
    index("artworks_collection_deleted_idx").on(
      table.catalogueId,
      table.deletedAt,
    ),
    // The visitor list: a public catalogue's published, live works.
    index("artworks_collection_status_deleted_idx").on(
      table.catalogueId,
      table.status,
      table.deletedAt,
    ),
    // The artwork-by-id-in-catalogue check (create authorization).
    index("artworks_collection_id_idx").on(table.catalogueId),
    check("artworks_status_check", sql`"status" in ('draft', 'published')`),
    check(
      "artworks_availability_check",
      sql`"availability" in ('available', 'reserved', 'sold', 'on-consignment')`,
    ),
  ],
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

// The schema object drizzle-kit and the Better Auth adapter both read: table
// name → table.
export const schema = {
  user,
  session,
  account,
  verification,
  catalogues,
  catalogueCollaborators,
  catalogueInvitations,
  catalogueAccessGrants,
  catalogueUnlockAttempts,
  artworks,
  artworkPhotos,
  artworkPhotoVariants,
  artworkDocuments,
};
