// Structural contract for the schema.
//
// Two sources are asserted, because they can drift apart: the in-memory
// Drizzle object — what the API and the Better Auth adapter import — and the
// committed generated migration — what is actually applied to Postgres. A
// schema edit that is not regenerated shows up here as a mismatch; a
// load-bearing column (the (artworkId, order) uniqueness that enforces "array
// position is the truth", the three composite PKs, the seven CHECKs, the
// composite indexes behind the artwork lists, the partial unique pending-
// invitation index) missing from either source fails here.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  account,
  accountWriteWindows,
  artworkDocuments,
  artworkPhotoVariants,
  artworkPhotos,
  artworks,
  catalogueAccessGrants,
  catalogueCollaborators,
  catalogueInvitations,
  catalogueUnlockAttempts,
  catalogues,
  jwks,
  oauthAccessToken,
  oauthClient,
  oauthClientAssertion,
  oauthClientResource,
  oauthConsent,
  oauthRefreshToken,
  oauthResource,
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
  "jwks",
  "oauthClient",
  "oauthResource",
  "oauthClientResource",
  "oauthRefreshToken",
  "oauthAccessToken",
  "oauthConsent",
  "oauthClientAssertion",
  "catalogues",
  "catalogueCollaborators",
  "catalogueInvitations",
  "catalogueAccessGrants",
  "catalogueUnlockAttempts",
  "accountWriteWindows",
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

// Every committed migration, in order: the lock-down asks a question about the
// whole history (is each table closed by *some* migration?), because a table
// that ships after 0006 is locked down by its own migration, not by 0006.
const allMigrationsSql = (): string =>
  readdirSync(fileURLToPath(new URL("../migrations", import.meta.url)))
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readMigration(file.replace(/\.sql$/, "")))
    .join("\n");

// The hand-appended existence guard in a migration, isolated from the
// generated DDL above it: the `DO $$ … $$;` body is where every revoke must
// live.
const guardBlock = (sql: string): string => {
  const start = sql.indexOf("DO $$");
  expect(start).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
};

// The statements between a role's `IF … THEN` and the `END IF;` that closes
// it. Bounding a revoke to this slice is the only assertion that proves it
// belongs to that role: ordered against the guard alone it could drift into
// the other branch, or past `END IF;` and out of the guard, and still sit
// after some existence check.
const roleBranch = (block: string, role: string): string => {
  const guard = `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN`;
  const start = block.indexOf(guard);
  expect(start).toBeGreaterThan(-1);
  const open = start + guard.length;
  const end = block.indexOf("END IF;", open);
  expect(end).toBeGreaterThan(open);
  return block.slice(open, end);
};

// The data statements a migration runs, in order: DDL is not a row write.
const dataWrites = (sql: string): string[] =>
  [...sql.matchAll(/\b(UPDATE|INSERT|DELETE|TRUNCATE)\b/g)].map((m) => m[1]);

// The row writes alone: a foreign key's `ON DELETE … ON UPDATE …` clause names
// two of the same verbs and is not a data write, so it is stripped first.
const rowWrites = (sql: string): string[] =>
  dataWrites(sql.replace(/ON (DELETE|UPDATE) [a-z ]+/g, ""));

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

// The committed lock-down: RLS on every table, the client grants revoked.
const RLS_SQL = readMigration("0006_enable_rls");

// The committed stamp that retires a whole catalogue.
const DELETION_SQL = readMigration("0007_collection_deletion_stamp");

// The committed kind: whose art a catalogue holds and why.
const KIND_SQL = readMigration("0009_catalogue_kind");

// The committed availability: a work's market state, absent on every Collection
// work and on every work written before the column existed.
const AVAILABILITY_SQL = readMigration("0010_artwork_availability");

// The committed artwork fields: a catalogue's sparse map of deviations from its
// Kind's defaults, absent on every catalogue that never deviated.
const ARTWORK_FIELDS_SQL = readMigration("0011_catalogue_artwork_fields");

// The committed write limiter's counter: one additive table, alone.
const WRITE_WINDOWS_SQL = readMigration("0012_account_write_windows");

// The OAuth provider and JWT plugin's eight tables: additive, alone, ahead of
// the MCP code that reads them.
const AGENT_ACCESS_SQL = readMigration("0013_agent_access");

// The four market states, as the spec names them. Shared by the Drizzle check
// assertion and the committed migration, so the two cannot disagree.
const AVAILABILITY_CHECK = `"availability" in ('available', 'reserved', 'sold', 'on-consignment')`;

describe("the twenty-two-table schema", () => {
  it("declares exactly the twenty-two tables, and `user` is singular", () => {
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
      "catalogueId",
      "title",
      "artistName",
      "serie",
      "dateOfCreation",
      "medium",
      "dimensions",
      "editions",
      "acquisitionDate",
      "acquisitionPrice",
      "placeOfOrigin",
      "provenance",
      "notes",
      "condition",
      "currentValue",
      "availability",
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

  it("artworks carries a nullable availability, with no default to hide a gap", () => {
    const c = cols(artworks);
    // Nullable is the whole point: every existing work, and every Collection
    // work, has no market state. A default would invent one.
    expect(c.availability.dataType).toBe("string");
    expect(c.availability.notNull).toBe(false);
    expect(c.availability.hasDefault).toBe(false);
  });

  it("artworks restricts `status` to draft or published in the Drizzle object", () => {
    expect(checksOf(artworks)).toContainEqual({
      name: "artworks_status_check",
      sql: "\"status\" in ('draft', 'published')",
    });
  });

  it("artworks restricts `availability` to the four market states", () => {
    expect(checksOf(artworks)).toContainEqual({
      name: "artworks_availability_check",
      sql: AVAILABILITY_CHECK,
    });
  });

  it("artworks carries the visitor index over the catalogue, the status and the deletion stamp", () => {
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

  it("catalogues defaults to public; skin stays nullable (read-time default)", () => {
    const c = cols(catalogues);
    expect(c.isPublic.notNull).toBe(true);
    expect(c.isPublic.default).toBe(true);
    expect(c.skin.notNull).toBe(false);
    expect(c.skinOptions.dataType).toBe("json");
    // Fixed at creation and required once 0004 has run. The reader still
    // tolerates null, because the Lambda deploys before the migration does.
    expect(c.mediaNamespaceId.dataType).toBe("string");
    expect(c.mediaNamespaceId.notNull).toBe(true);
  });

  it("catalogues carries a nullable password hash, with no default to hide a gap", () => {
    const c = cols(catalogues);
    // Nullable is the whole point: a catalogue without a password is the
    // normal state, so no backfill and no NOT NULL step is owed later. A
    // default would invent a password none was set for.
    expect(c.passwordHash.dataType).toBe("string");
    expect(c.passwordHash.notNull).toBe(false);
    expect(c.passwordHash.hasDefault).toBe(false);
  });

  it("catalogues carries a nullable deletion stamp, with no default to hide a gap", () => {
    const c = cols(catalogues);
    // Nullable is the whole point: a catalogue without a stamp is live, so
    // no backfill and no NOT NULL step is owed later. A default would stamp a
    // deletion no owner asked for.
    expect(c.deletedAt.dataType).toBe("date");
    expect(c.deletedAt.notNull).toBe(false);
    expect(c.deletedAt.hasDefault).toBe(false);
  });

  it("catalogues carries a kind, required and defaulting to collection", () => {
    const c = cols(catalogues);
    // Every row that existed before the column was a collector's, so the
    // constant default is the truth, not a placeholder awaiting a backfill.
    expect(c.kind.dataType).toBe("string");
    expect(c.kind.notNull).toBe(true);
    expect(c.kind.default).toBe("collection");
  });

  it("catalogues restricts `kind` to portfolio, collection or inventory", () => {
    expect(checksOf(catalogues)).toContainEqual({
      name: "collections_kind_check",
      sql: "\"kind\" in ('portfolio', 'collection', 'inventory')",
    });
  });

  it("catalogues carries a nullable artwork-fields map, with no default to hide a gap", () => {
    const c = cols(catalogues);
    // Sparse by design: an absent key follows the Kind default, so null is the
    // normal state and no backfill or NOT NULL step is owed later. A default
    // would store a choice no member made.
    expect(c.artworkFields.dataType).toBe("json");
    expect(c.artworkFields.notNull).toBe(false);
    expect(c.artworkFields.hasDefault).toBe(false);
  });

  it("catalogue_access_grants keeps the token's hash, and indexes the catalogue for revocation", () => {
    const c = cols(catalogueAccessGrants);
    expect(Object.keys(c)).toEqual([
      "catalogueId",
      "tokenHash",
      "createdAt",
      "expiresAt",
    ]);
    expect(c.catalogueId.notNull).toBe(true);
    // The raw token exists only in the reader's cookie, as with an invitation.
    expect(c.tokenHash.notNull).toBe(true);
    expect(c.tokenHash.isUnique).toBe(true);
    expect(c.createdAt.notNull).toBe(true);
    expect(c.createdAt.hasDefault).toBe(true);
    // Expiry is computed from the timestamp, never stored as a status.
    expect(c.expiresAt.dataType).toBe("date");
    expect(c.expiresAt.notNull).toBe(true);
    // One statement deletes a catalogue's grants on a password change.
    expect(indexesOf(catalogueAccessGrants)).toMatchObject({
      collection_access_grants_collection_id_idx: ["collectionId"],
    });
  });

  it("catalogue_unlock_attempts is keyed by address, catalogue and window", () => {
    const c = cols(catalogueUnlockAttempts);
    expect(Object.keys(c)).toEqual([
      "ip",
      "catalogueId",
      "windowStart",
      "attempts",
    ]);
    expect(c.ip.notNull).toBe(true);
    expect(c.catalogueId.notNull).toBe(true);
    expect(c.windowStart.dataType).toBe("date");
    expect(c.windowStart.notNull).toBe(true);
    expect(c.attempts.dataType).toBe("number");
    expect(c.attempts.notNull).toBe(true);
    expect(c.attempts.default).toBe(0);
    // The triple is the key: one counter per address, catalogue and window.
    const pk = getTableConfig(catalogueUnlockAttempts).primaryKeys[0];
    expect(pk.columns.map((col) => col.name)).toEqual([
      "ip",
      "collectionId",
      "windowStart",
    ]);
  });

  it("account_write_windows counts one account's writes per bucket and window", () => {
    const c = cols(accountWriteWindows);
    expect(Object.keys(c)).toEqual([
      "userId",
      "bucket",
      "windowStart",
      "count",
    ]);
    // The unit is the account, never the address: a hosted agent's calls all
    // arrive from one cloud, so an address bucket would be one for everyone.
    expect(c.userId.notNull).toBe(true);
    // A row must name its bucket. A default would quietly spend a write's
    // count in another bucket's counter.
    expect(c.bucket.notNull).toBe(true);
    expect(c.bucket.hasDefault).toBe(false);
    // The window's start, floored by the route to its own window length. No
    // default: the schema cannot know whether this row is a second or an hour.
    expect(c.windowStart.dataType).toBe("date");
    expect(c.windowStart.notNull).toBe(true);
    expect(c.windowStart.hasDefault).toBe(false);
    expect(c.count.dataType).toBe("number");
    expect(c.count.notNull).toBe(true);
    expect(c.count.default).toBe(0);
    // The triple is the upsert's conflict target, in this order: one counter
    // per account, bucket and window, and a claim is one INSERT … ON CONFLICT.
    const pk = getTableConfig(accountWriteWindows).primaryKeys[0];
    expect(pk.columns.map((col) => col.name)).toEqual([
      "userId",
      "bucket",
      "windowStart",
    ]);
  });

  it("account_write_windows restricts the bucket to the two fixed windows", () => {
    // Two windows, one table: the per-second write bucket and the hourly
    // import cap differ only in which bucket they spend and how the route
    // floors `windowStart`. The database refuses a third value even when it
    // arrives from outside the route that writes the rows.
    expect(checksOf(accountWriteWindows)).toContainEqual({
      name: "account_write_windows_bucket_check",
      sql: "\"bucket\" in ('write', 'import')",
    });
  });

  it("catalogue_collaborators is keyed by (catalogueId, userId), with the dashboard index on user", () => {
    const c = cols(catalogueCollaborators);
    // The owner is `collections.userId`; this table holds everyone else.
    expect(Object.keys(c)).toEqual(["catalogueId", "userId", "createdAt"]);
    expect(c.catalogueId.notNull).toBe(true);
    expect(c.userId.notNull).toBe(true);
    expect(c.createdAt.dataType).toBe("date");
    expect(c.createdAt.notNull).toBe(true);
    expect(c.createdAt.hasDefault).toBe(true);
    const pk = getTableConfig(catalogueCollaborators).primaryKeys[0];
    expect(pk.getName()).toBe(
      "collection_collaborators_collectionId_userId_pk",
    );
    expect(pk.columns.map((col) => col.name)).toEqual([
      "collectionId",
      "userId",
    ]);
    expect(indexesOf(catalogueCollaborators)).toMatchObject({
      collection_collaborators_user_id_idx: ["userId"],
    });
  });

  it("catalogue_invitations carries the offer, its status and its unique token hash", () => {
    const c = cols(catalogueInvitations);
    expect(Object.keys(c)).toEqual([
      "id",
      "catalogueId",
      "email",
      "invitedByUserId",
      "tokenHash",
      "status",
      "createdAt",
      "expiresAt",
      "resolvedAt",
    ]);
    expect(c.id.primary).toBe(true);
    expect(c.catalogueId.notNull).toBe(true);
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

  it("catalogue_invitations limits status to the four lifecycle values", () => {
    expect(checksOf(catalogueInvitations)).toContainEqual({
      name: "collection_invitations_status_check",
      sql: "\"status\" in ('pending', 'accepted', 'declined', 'revoked')",
    });
  });

  it("catalogue_invitations allows one pending invitation per catalogue and address", () => {
    const pending = getTableConfig(catalogueInvitations).indexes.find(
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

  it("artworks' owner list is indexed by catalogue and deletion, not by user", () => {
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

  it("jwks keeps the signing key pair the jwt plugin mints", () => {
    const c = cols(jwks);
    expect(Object.keys(c)).toEqual([
      "id",
      "publicKey",
      "privateKey",
      "createdAt",
      "expiresAt",
      "alg",
      "crv",
    ]);
    expect(c.id.primary).toBe(true);
    expect(c.publicKey.notNull).toBe(true);
    expect(c.privateKey.notNull).toBe(true);
    expect(c.expiresAt.notNull).toBe(false);
  });

  it("oauth_client is keyed by the client's own id and keeps its discovery origin", () => {
    const c = cols(oauthClient);
    expect(c.id.primary).toBe(true);
    // The CIMD client id is the URL the client hosts: unique by definition.
    expect(c.clientId.notNull).toBe(true);
    expect(c.clientId.isUnique).toBe(true);
    expect(c.redirectUris.notNull).toBe(true);
    expect(c.redirectUris.dataType).toBe("array");
    // `"cimd"` marks a client the metadata document owns; a hand-registered
    // one leaves it null. The tool guard reads neither, but the plugin does.
    expect(c.clientDiscoveryId.notNull).toBe(false);
    // Capitalised exactly as the plugin's field name: the adapter addresses
    // columns by property name, so `requirePkce` would be a missing column.
    expect(c.requirePKCE).toBeDefined();
    expect(c.metadata.dataType).toBe("json");
    expect(indexesOf(oauthClient)).toMatchObject({
      oauth_client_user_id_idx: ["userId"],
    });
  });

  it("oauth_resource is keyed by its identifier, with a policy version", () => {
    const c = cols(oauthResource);
    expect(c.identifier.notNull).toBe(true);
    expect(c.identifier.isUnique).toBe(true);
    expect(c.name.notNull).toBe(true);
    expect(c.allowedScopes.dataType).toBe("array");
    expect(c.customClaims.dataType).toBe("json");
    expect(c.policyVersion.notNull).toBe(true);
    expect(c.policyVersion.default).toBe(1);
  });

  it("oauth_client_resource pairs a client and a resource once", () => {
    const c = cols(oauthClientResource);
    expect(c.clientId.notNull).toBe(true);
    expect(c.resourceId.notNull).toBe(true);
    expect(c.metadata.dataType).toBe("json");
    expect(indexesOf(oauthClientResource)).toMatchObject({
      oauth_client_resource_client_id_resource_id_key: [
        "clientId",
        "resourceId",
      ],
    });
    const unique = getTableConfig(oauthClientResource).indexes.find(
      (i) =>
        i.config.name === "oauth_client_resource_client_id_resource_id_key",
    );
    expect(unique?.config.unique).toBe(true);
  });

  it("oauth_refresh_token is the live connection's family, indexed for rotation", () => {
    const c = cols(oauthRefreshToken);
    expect(c.token.notNull).toBe(true);
    expect(c.token.isUnique).toBe(true);
    expect(c.userId.notNull).toBe(true);
    expect(c.clientId.notNull).toBe(true);
    expect(c.scopes.notNull).toBe(true);
    expect(c.scopes.dataType).toBe("array");
    // The rotation's identity: every refresh in one connect inherits the
    // authorization code's id (the Connection key the account surface lists).
    expect(c.authorizationCodeId.notNull).toBe(false);
    expect(indexesOf(oauthRefreshToken)).toMatchObject({
      oauth_refresh_token_user_id_idx: ["userId"],
      oauth_refresh_token_client_id_idx: ["clientId"],
      oauth_refresh_token_session_id_idx: ["sessionId"],
      oauth_refresh_token_authorization_code_id_idx: ["authorizationCodeId"],
    });
  });

  it("oauth_access_token is the opaque-token table the JWT plugin leaves empty", () => {
    const c = cols(oauthAccessToken);
    expect(c.token.isUnique).toBe(true);
    expect(c.clientId.notNull).toBe(true);
    expect(c.scopes.notNull).toBe(true);
    expect(c.refreshId.notNull).toBe(false);
    expect(indexesOf(oauthAccessToken)).toMatchObject({
      oauth_access_token_client_id_idx: ["clientId"],
      oauth_access_token_refresh_id_idx: ["refreshId"],
    });
  });

  it("oauth_consent is one row per account and client, with no unique index", () => {
    const c = cols(oauthConsent);
    expect(c.clientId.notNull).toBe(true);
    expect(c.userId.notNull).toBe(false);
    expect(c.scopes.notNull).toBe(true);
    expect(c.resources.dataType).toBe("array");
    expect(c.updatedAt.notNull).toBe(true);
    // The plugin upserts on (clientId, userId, referenceId?) and declares no
    // unique index; adding one would refuse the row a second connect needs.
    const unique = getTableConfig(oauthConsent).indexes.filter(
      (i) => i.config.unique,
    );
    expect(unique).toEqual([]);
    expect(indexesOf(oauthConsent)).toMatchObject({
      oauth_consent_client_id_idx: ["clientId"],
      oauth_consent_user_id_idx: ["userId"],
    });
  });

  it("oauth_client_assertion carries the assertion's expiry, and nothing else", () => {
    const c = cols(oauthClientAssertion);
    expect(Object.keys(c)).toEqual(["id", "expiresAt"]);
    expect(c.expiresAt.notNull).toBe(true);
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

  it("builds the visitor index over the catalogue, the status and the deletion stamp", () => {
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

  it("replaces the owner-list index and leaves the visitor and catalogue indexes alone", () => {
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
    // Nullable is load-bearing: a catalogue without a password is normal.
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

  it("carries the revocation index over the catalogue", () => {
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

describe("the committed deletion-stamp migration (as it will actually be applied)", () => {
  it("adds the stamp nullable, with no default and no NOT NULL step", () => {
    expect(DELETION_SQL).toContain(
      'ALTER TABLE "collections" ADD COLUMN "deletedAt" timestamp with time zone;',
    );
    // Nullable is load-bearing: every row that existed before the migration
    // keeps reading as live, so the column cannot arrive with a value.
    expect(DELETION_SQL).not.toMatch(/ADD COLUMN "deletedAt"[^;]*NOT NULL/);
    expect(DELETION_SQL).not.toMatch(/ADD COLUMN "deletedAt"[^;]*DEFAULT/);
    expect(DELETION_SQL).not.toContain("SET NOT NULL");
  });

  it("is additive and forward-only: no row write, no drop, no constraint change", () => {
    // The release ships alone, ahead of the code that uses the column, so
    // every statement here must leave the old code's rows and queries intact.
    expect(dataWrites(DELETION_SQL)).toEqual([]);
    expect(DELETION_SQL).not.toMatch(/\b(DROP|TRUNCATE)\b/);
    expect(DELETION_SQL).not.toMatch(/ALTER COLUMN/);
  });
});

describe("the committed kind migration (as it will actually be applied)", () => {
  it("adds `kind` required, defaulting to collection, checked to the three kinds", () => {
    expect(KIND_SQL).toContain(
      `ALTER TABLE "collections" ADD COLUMN "kind" text DEFAULT 'collection' NOT NULL;`,
    );
    expect(KIND_SQL).toContain(
      `ALTER TABLE "collections" ADD CONSTRAINT "collections_kind_check" CHECK ("kind" in ('portfolio', 'collection', 'inventory'));`,
    );
  });

  it("is additive and forward-only: no row write, no drop, no default to backfill", () => {
    // The column ships alone, ahead of the code that reads it: every existing
    // row takes the constant default, so there is nothing to backfill and
    // nothing to reverse.
    expect(dataWrites(KIND_SQL)).toEqual([]);
    expect(KIND_SQL).not.toMatch(/\b(DROP|TRUNCATE)\b/);
    expect(KIND_SQL).not.toMatch(/ALTER COLUMN/);
  });
});

describe("the committed availability migration (as it will actually be applied)", () => {
  it("adds a nullable `availability` with the four-value check and no default", () => {
    expect(AVAILABILITY_SQL).toContain(
      `ALTER TABLE "artworks" ADD COLUMN "availability" text;`,
    );
    expect(AVAILABILITY_SQL).toContain(
      `ALTER TABLE "artworks" ADD CONSTRAINT "artworks_availability_check" CHECK (${AVAILABILITY_CHECK});`,
    );
    expect(AVAILABILITY_SQL).not.toMatch(/DEFAULT/);
  });

  it("is additive and forward-only: no row write, no drop, no alter column", () => {
    // The column ships alone, ahead of the code that reads it: null is already
    // the truth for every existing work, so there is nothing to backfill and
    // nothing to reverse.
    expect(dataWrites(AVAILABILITY_SQL)).toEqual([]);
    expect(AVAILABILITY_SQL).not.toMatch(/\b(DROP|TRUNCATE)\b/);
    expect(AVAILABILITY_SQL).not.toMatch(/ALTER COLUMN/);
  });
});

describe("the committed artwork-fields migration (as it will actually be applied)", () => {
  it("adds a nullable jsonb map of deviations, with no default and no NOT NULL step", () => {
    expect(ARTWORK_FIELDS_SQL).toContain(
      'ALTER TABLE "collections" ADD COLUMN "artworkFields" jsonb;',
    );
    // Nullable is load-bearing: a catalogue that never deviated stores nothing,
    // so every existing row is already right. A default would store a choice no
    // member made, and NOT NULL would fail on every existing row.
    expect(ARTWORK_FIELDS_SQL).not.toMatch(
      /ADD COLUMN "artworkFields"[^;]*NOT NULL/,
    );
    expect(ARTWORK_FIELDS_SQL).not.toMatch(
      /ADD COLUMN "artworkFields"[^;]*DEFAULT/,
    );
  });

  it("is additive and forward-only: no row write, no drop, no alter column", () => {
    // The column ships alone, ahead of the code that reads it: null is already
    // the truth for every existing catalogue, so there is nothing to backfill
    // and nothing to reverse.
    expect(dataWrites(ARTWORK_FIELDS_SQL)).toEqual([]);
    expect(ARTWORK_FIELDS_SQL).not.toMatch(/\b(DROP|TRUNCATE)\b/);
    expect(ARTWORK_FIELDS_SQL).not.toMatch(/ALTER COLUMN/);
  });
});

describe("the committed write-limiter migration (as it will actually be applied)", () => {
  it("creates the counter with the triple primary key and the two-bucket check", () => {
    expect(WRITE_WINDOWS_SQL).toMatch(
      /CREATE TABLE "account_write_windows" \([\s\S]*CONSTRAINT "account_write_windows_userId_bucket_windowStart_pk" PRIMARY KEY\("userId","bucket","windowStart"\)/,
    );
    expect(WRITE_WINDOWS_SQL).toContain(
      `CONSTRAINT "account_write_windows_bucket_check" CHECK ("bucket" in ('write', 'import'))`,
    );
    // Domain tables stay reference-free, like the ones before them.
    expect(WRITE_WINDOWS_SQL).not.toContain("FOREIGN KEY");
  });

  it("types the columns as the schema declares them, and writes no rows", () => {
    // The other half of the two-source contract: a changed column type, a
    // lost zero default or a stray backfill must not survive.
    expect(WRITE_WINDOWS_SQL).toContain('"userId" text NOT NULL');
    expect(WRITE_WINDOWS_SQL).toContain('"bucket" text NOT NULL');
    expect(WRITE_WINDOWS_SQL).toContain(
      '"windowStart" timestamp with time zone NOT NULL',
    );
    expect(WRITE_WINDOWS_SQL).toContain('"count" integer DEFAULT 0 NOT NULL');
    expect(
      WRITE_WINDOWS_SQL.replace(/timestamp with time zone/g, ""),
    ).not.toContain("timestamp");
    // The table ships alone, ahead of the code that writes it: nothing to
    // backfill, so a data write would be a bug.
    expect(dataWrites(WRITE_WINDOWS_SQL)).toEqual([]);
  });

  it("enables RLS and revokes both client roles inside the existence guard", () => {
    // 0006 locked down what existed then; this table ships after it, so its
    // own migration carries the treatment (the generated enablement above the
    // hand-appended revoke).
    expect(WRITE_WINDOWS_SQL).toContain(
      'ALTER TABLE "account_write_windows" ENABLE ROW LEVEL SECURITY;',
    );
    const block = guardBlock(WRITE_WINDOWS_SQL);
    for (const role of ["anon", "authenticated"]) {
      // Inside this role's own branch: local Postgres and CI have neither
      // role, so an unguarded revoke would fail every `db:migrate`.
      expect(roleBranch(block, role)).toContain(
        `REVOKE ALL ON "account_write_windows" FROM ${role};`,
      );
    }
    // No revoke escapes the guard.
    expect(
      WRITE_WINDOWS_SQL.slice(0, WRITE_WINDOWS_SQL.indexOf("DO $$")),
    ).not.toMatch(/REVOKE/);
  });

  it("does not force RLS onto the table owner", () => {
    const statements = WRITE_WINDOWS_SQL.replace(/--[^\n]*/g, "");
    expect(statements.toUpperCase()).not.toContain("FORCE ROW LEVEL SECURITY");
  });
});

describe("the committed agent-access migration (as it will actually be applied)", () => {
  it("creates the eight plugin tables, with the plugin's own names", () => {
    const created = [
      ...AGENT_ACCESS_SQL.matchAll(/CREATE TABLE "([^"]+)"/g),
    ].map((m) => m[1]);
    expect(created.sort()).toEqual(
      [
        "jwks",
        "oauthClient",
        "oauthResource",
        "oauthClientResource",
        "oauthRefreshToken",
        "oauthAccessToken",
        "oauthConsent",
        "oauthClientAssertion",
      ].sort(),
    );
  });

  it("is additive and forward-only: no row write, no drop, no alter column", () => {
    // The release ships alone, ahead of the code that reads the tables:
    // every statement must leave the old code's rows and queries intact.
    expect(rowWrites(AGENT_ACCESS_SQL)).toEqual([]);
    expect(AGENT_ACCESS_SQL).not.toMatch(/\b(DROP|TRUNCATE)\b/);
    expect(AGENT_ACCESS_SQL).not.toMatch(/ALTER COLUMN/);
  });

  it("keys the client, the refresh token and the resource by their unique facts", () => {
    expect(AGENT_ACCESS_SQL).toContain(
      `CONSTRAINT "oauthClient_clientId_unique" UNIQUE("clientId")`,
    );
    expect(AGENT_ACCESS_SQL).toContain(
      `CONSTRAINT "oauthRefreshToken_token_unique" UNIQUE("token")`,
    );
    expect(AGENT_ACCESS_SQL).toContain(
      `CONSTRAINT "oauthResource_identifier_unique" UNIQUE("identifier")`,
    );
    // One (client, resource) pair: the provider's per-client resource policy
    // reads this row, and a duplicate would split the policy in two.
    expect(AGENT_ACCESS_SQL).toMatch(
      /CREATE UNIQUE INDEX "oauth_client_resource_client_id_resource_id_key" ON "oauthClientResource" USING btree \("clientId","resourceId"\)/,
    );
  });

  it("carries the indexes the rotation and the consent lookup read", () => {
    expect(AGENT_ACCESS_SQL).toMatch(
      /CREATE INDEX "oauth_refresh_token_authorization_code_id_idx" ON "oauthRefreshToken" USING btree \("authorizationCodeId"\)/,
    );
    expect(AGENT_ACCESS_SQL).toMatch(
      /CREATE INDEX "oauth_consent_client_id_idx" ON "oauthConsent" USING btree \("clientId"\)/,
    );
    expect(AGENT_ACCESS_SQL).toMatch(
      /CREATE INDEX "oauth_consent_user_id_idx" ON "oauthConsent" USING btree \("userId"\)/,
    );
  });

  it("cascades a deleted client or resource, and nulls a deleted session", () => {
    // The plugin's declared references: the schema test asserts the Drizzle
    // object, this asserts the SQL that is actually applied.
    expect(AGENT_ACCESS_SQL).toMatch(
      /CONSTRAINT "oauthClientResource_clientId_oauthClient_clientId_fk" FOREIGN KEY \("clientId"\) REFERENCES "public"\."oauthClient"\("clientId"\) ON DELETE cascade/,
    );
    expect(AGENT_ACCESS_SQL).toMatch(
      /CONSTRAINT "oauthRefreshToken_sessionId_session_id_fk" FOREIGN KEY \("sessionId"\) REFERENCES "public"\."session"\("id"\) ON DELETE set null/,
    );
  });

  it("uses timestamptz for every timestamp", () => {
    expect(
      AGENT_ACCESS_SQL.replace(/timestamp with time zone/g, ""),
    ).not.toContain("timestamp");
  });

  it("enables RLS and revokes both client roles inside the existence guard", () => {
    const tables = [
      "jwks",
      "oauthClient",
      "oauthResource",
      "oauthClientResource",
      "oauthRefreshToken",
      "oauthAccessToken",
      "oauthConsent",
      "oauthClientAssertion",
    ];
    for (const table of tables) {
      expect(AGENT_ACCESS_SQL).toContain(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`,
      );
    }
    const block = guardBlock(AGENT_ACCESS_SQL);
    for (const role of ["anon", "authenticated"]) {
      const branch = roleBranch(block, role);
      for (const table of tables) {
        expect(branch).toContain(`REVOKE ALL ON "${table}" FROM ${role};`);
      }
      // One revoke per table, and no fifth statement smuggled in beside them.
      expect(branch.match(/REVOKE ALL/g)).toHaveLength(tables.length);
    }
    // No revoke escapes the guard.
    expect(
      AGENT_ACCESS_SQL.slice(0, AGENT_ACCESS_SQL.indexOf("DO $$")),
    ).not.toMatch(/REVOKE/);
  });

  it("does not force RLS onto the table owner", () => {
    const statements = AGENT_ACCESS_SQL.replace(/--[^\n]*/g, "");
    expect(statements.toUpperCase()).not.toContain("FORCE ROW LEVEL SECURITY");
  });
});

describe("the committed lock-down migration (as it will actually be applied)", () => {
  // The schema's own table names, which the committed migrations must render
  // one enablement per. Derived from the Drizzle object, so a table added there
  // without regenerating shows up as a missing statement below.
  const schemaTableNames = Object.values(schema).map(
    (table) => getTableConfig(table as PgTable).name,
  );

  // Across the whole history, not 0006 alone: a table that ships later is
  // locked down by its own migration, and folding them together is what keeps
  // "every table is closed" true as the schema grows.
  const enabledTableNames = [
    ...allMigrationsSql().matchAll(
      /ALTER TABLE "([^"]+)" ENABLE ROW LEVEL SECURITY;/g,
    ),
  ].map((match) => match[1]);

  it("enables RLS on every table in the Drizzle object, with no table opted out", () => {
    const disabled = Object.values(schema)
      .filter((table) => !getTableConfig(table as PgTable).enableRLS)
      .map((table) => getTableConfig(table as PgTable).name);
    // All twenty-two, not a sample: a new table is closed unless its
    // declaration omits `enableRLS()`, which this turns red.
    expect(disabled).toEqual([]);
    expect(schemaTableNames).toHaveLength(22);
  });

  it("renders one enablement statement per table, matching the schema", () => {
    expect(enabledTableNames).toEqual(expect.arrayContaining(schemaTableNames));
    expect(enabledTableNames).toHaveLength(schemaTableNames.length);
    expect(enabledTableNames).toHaveLength(22);
  });

  it("revokes tables, sequences and defaults for both client roles, inside the pg_roles guard", () => {
    const block = guardBlock(RLS_SQL);
    for (const role of ["anon", "authenticated"]) {
      const branch = roleBranch(block, role);

      const statements = [
        `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${role};`,
        `REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM ${role};`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${role};`,
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM ${role};`,
      ];
      for (const statement of statements) {
        // Inside this role's own branch: local Postgres and CI have neither
        // role, so an unguarded revoke would fail every `db:migrate`.
        expect(branch).toContain(statement);
      }
      // All four, and no fifth statement smuggled in beside them.
      expect(branch.match(/REVOKE ALL/g)).toHaveLength(4);
    }

    // No revoke escapes the guard: the block above is the only place one runs.
    const outsideGuard =
      RLS_SQL.slice(0, RLS_SQL.indexOf("DO $$")) +
      RLS_SQL.slice(RLS_SQL.indexOf("$$;"));
    expect(outsideGuard).not.toMatch(/REVOKE ALL/);
  });

  it("does not force RLS onto the table owner", () => {
    // The app connects as the owner, which bypasses RLS. FORCE would subject
    // it to the empty policy set and blank every read in production. Comments
    // are stripped first: the note above the block says why it is absent, and
    // that sentence must not read as the statement itself.
    const statements = RLS_SQL.replace(/--[^\n]*/g, "");
    expect(statements.toUpperCase()).not.toContain("FORCE ROW LEVEL SECURITY");
  });
});
