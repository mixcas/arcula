// The collection resource routes:
//
//   GET    /collections                              the owner's list / the public list
//   POST   /collections                              create (cap check first)
//   GET    /collections/{cid}                        one collection
//   PATCH  /collections/{cid}                        update
//   POST   /collections/{cid}/import/csv             the CSV import's bulk write
//   POST   /collections/{cid}/artworks/bulk-delete   the batch soft delete
//   POST   /collections/{cid}/artworks/{aid}/restore deletedAt → NULL (present, unused in beta)
//
// Collections are never deleted (there is no trash for them in this model),
// so the cap check counts every collection the owner has.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotos as artworkPhotosTable,
  artworks as artworksTable,
  collections as collectionsTable,
} from "@arcula/db";
import {
  UPDATABLE_TEXT_FIELDS,
  artworkBulkDeleteSchema,
  artworkImportSchema,
  collectionCreateSchema,
  collectionUpdateSchema,
  collectionLimitForTier,
  artworkSchema,
  IMPORTED_WORK_STATUS,
  type ArtworkBulkDeletePayload,
  type ArtworkImportPayload,
  type CollectionCreatePayload,
  type CollectionUpdatePayload,
} from "@arcula/shared";
import { Hono } from "hono";
import {
  loadCollection,
  requireOwnedArtwork,
  requireOwnedCollection,
  requireReadableCollection,
} from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { param, parseBody, safeTx } from "../http";
import { parseMediaKey } from "../media/keys";
import { deleteObject, listObjects } from "../storage";
import { requireSession, resolveSession } from "../session";
import { serializeCollection } from "../serialize";

export const collectionRoutes = new Hono();

/**
 * A fresh row id: a UUID with its hyphens removed.
 *
 * The hyphen-free shape is load-bearing, not cosmetic. Routes carry the id in
 * a `{urlizedName}-{id}` segment, and the client recovers it by cutting at the
 * LAST hyphen (`parseId` in `packages/shared`) — a hyphenated id would put that
 * cut inside the id itself and the recovered "id" would be its last segment.
 * The client mints the same shape for the artwork ids it supplies, so both
 * sides of a route segment obey one rule.
 */
const mintId = (): string => crypto.randomUUID().replace(/-/g, "");

// GET /collections — signed in: the owner's own list, name-ordered;
// anonymous: the public list. A signed-in visitor never sees other
// people's collections through this route.
//
// The anonymous filter is the SQL form of `canSeeCollection(null, row)` in
// access.ts; collections.api.test.ts asserts the two agree.
collectionRoutes.get("/collections", async (c) => {
  const session = await resolveSession(c);
  const rows =
    session !== null
      ? await db
          .select()
          .from(collectionsTable)
          .where(eq(collectionsTable.userId, session.user.id))
          .orderBy(asc(collectionsTable.name))
      : await db
          .select()
          .from(collectionsTable)
          .where(eq(collectionsTable.isPublic, true))
          .orderBy(asc(collectionsTable.name));
  return c.json(rows.map(serializeCollection));
});

// POST /collections — the cap check comes FIRST: the count is over the
// caller's own collections, the limit is read off the caller's tier.
collectionRoutes.post("/collections", requireSession, async (c) => {
  const user = c.get("user");
  const payload: CollectionCreatePayload = await parseBody(
    c,
    collectionCreateSchema,
  );

  const limit = collectionLimitForTier(user.tier);
  const owned = await db
    .select({ id: collectionsTable.id })
    .from(collectionsTable)
    .where(eq(collectionsTable.userId, user.id));
  if (owned.length >= limit) {
    throw new ApiError(
      "limit-reached",
      `Your plan allows at most ${limit} collection${limit === 1 ? "" : "s"}`,
    );
  }

  const id = mintId();
  const now = new Date();
  await db.insert(collectionsTable).values({
    id,
    userId: user.id,
    // Fixed at creation: the second segment of every final media key, so a
    // later transfer of the collection moves no object. A fresh opaque id,
    // not the owner's — the owner may change, the namespace may not.
    mediaNamespaceId: mintId(),
    name: payload.name,
    description: payload.description ?? null,
    isPublic: payload.isPublic,
    createdAt: now,
    updatedAt: now,
  });
  // The insert just committed; read-back failure is a server bug.
  const row = await loadCollection(id);
  if (!row) {
    throw new ApiError(
      "internal",
      "The created collection could not be read back",
    );
  }
  return c.json(serializeCollection(row), 201);
});

// GET one — owner always; a visitor when the collection is public.
collectionRoutes.get("/collections/:collectionId", async (c) => {
  const collection = await requireReadableCollection(
    c,
    param(c, "collectionId"),
  );
  return c.json(serializeCollection(collection));
});

// PATCH — owner only. Present sets (or, as null, clears); absent leaves
// the column, which is what makes the settings form's "write only what
// changed" payloads safe.
collectionRoutes.patch(
  "/collections/:collectionId",
  requireSession,
  async (c) => {
    const collection = await requireOwnedCollection(
      c,
      param(c, "collectionId"),
    );
    const payload: CollectionUpdatePayload = await parseBody(
      c,
      collectionUpdateSchema,
    );

    const set: Partial<typeof collectionsTable.$inferInsert> = {
      name: payload.name,
      isPublic: payload.isPublic,
      updatedAt: new Date(),
    };
    if (payload.description !== undefined) {
      set.description = payload.description ?? null;
    }
    if (payload.skin !== undefined) {
      set.skin = payload.skin ?? null;
    }
    if (payload.skinOptions !== undefined) {
      set.skinOptions = payload.skinOptions ?? null;
    }
    await db
      .update(collectionsTable)
      .set(set)
      .where(eq(collectionsTable.id, collection.id));

    const row = await loadCollection(collection.id);
    if (!row) {
      throw new ApiError(
        "internal",
        "The saved collection could not be read back",
      );
    }
    return c.json(serializeCollection(row));
  },
);

// POST …/import/csv — one row per validated artwork. Each row is checked
// against the shared `artworkSchema` the Add/Edit forms use: a failing row
// lands in `rejected` (its index plus the failed fields) and the accepted
// rows are written in one transaction. The ids are minted here — the
// client's review step has no say in them, and the shared schema is the
// only place a row's validity is decided.
collectionRoutes.post(
  "/collections/:collectionId/import/csv",
  requireSession,
  async (c) => {
    const user = c.get("user");
    const collection = await requireOwnedCollection(
      c,
      param(c, "collectionId"),
    );
    const payload: ArtworkImportPayload = await parseBody(
      c,
      artworkImportSchema,
    );

    const now = new Date();
    const rejected: { row: number; errors: Record<string, string> }[] = [];
    const accepted: (typeof artworksTable.$inferInsert)[] = [];
    payload.rows.forEach((row, index) => {
      // The import's own status wins over anything a row says: every
      // imported work is published (see IMPORTED_WORK_STATUS). A row that is
      // not an object fails the schema as a missing title.
      const fields =
        row !== null && typeof row === "object"
          ? (row as Record<string, unknown>)
          : {};
      const parsed = artworkSchema.safeParse({
        ...fields,
        status: IMPORTED_WORK_STATUS,
      });
      if (!parsed.success) {
        const errors: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          errors[issue.path.join(".")] = issue.message;
        }
        rejected.push({ row: index, errors });
        return;
      }
      const values = parsed.data;
      const inserted: typeof artworksTable.$inferInsert = {
        id: mintId(),
        userId: user.id,
        collectionId: collection.id,
        title: values.title,
        artistName: values.artistName,
        status: values.status,
        // Always written, as null: the list filters on it, and a missing
        // field is not a null (the write-path doctrine).
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      for (const field of UPDATABLE_TEXT_FIELDS) {
        inserted[field] = values[field] ?? null;
      }
      accepted.push(inserted);
    });

    if (accepted.length > 0) {
      await safeTx(async (tx) => {
        for (const row of accepted) {
          await tx.insert(artworksTable).values(row);
        }
      });
    }

    return c.json({ inserted: accepted.length, rejected });
  },
);

// POST …/artworks/bulk-delete — one transaction stamps `deletedAt`/
// `updatedAt`. Already-deleted or foreign ids are not in the WHERE clause's
// result and do not count: the response is how many works this call
// actually moved.
collectionRoutes.post(
  "/collections/:collectionId/artworks/bulk-delete",
  requireSession,
  async (c) => {
    const collection = await requireOwnedCollection(
      c,
      param(c, "collectionId"),
    );
    const payload: ArtworkBulkDeletePayload = await parseBody(
      c,
      artworkBulkDeleteSchema,
    );

    const now = new Date();
    const result = await safeTx(
      async (tx) =>
        await tx
          .update(artworksTable)
          .set({ deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(artworksTable.collectionId, collection.id),
              inArray(artworksTable.id, payload.artworkIds),
              isNull(artworksTable.deletedAt),
            ),
          )
          .returning({ id: artworksTable.id }),
    );
    return c.json({ deleted: result.length });
  },
);

// POST …/artworks/{aid}/restore — `deletedAt → NULL`, idempotent on a
// live work (restoring it is a no-op the route does not special-case).
// Present but unused in beta: there is no trash UI yet.
collectionRoutes.post(
  "/collections/:collectionId/artworks/:artworkId/restore",
  requireSession,
  async (c) => {
    const collectionId = param(c, "collectionId");
    const artworkId = param(c, "artworkId");
    const { collection, artwork } = await requireOwnedArtwork(
      c,
      collectionId,
      artworkId,
    );
    await db
      .update(artworksTable)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(artworksTable.id, artwork.id),
          eq(artworksTable.collectionId, collection.id),
        ),
      );
    return c.json({ restored: true });
  },
);

// POST …/maintenance/sweep — delete this collection's staged objects
// whose entryId has no row. An entry that DOES have a row keeps its staged
// objects even under a soft-deleted work: the row is what a restore would
// point at, and the staged object may be the entry's newest version.
collectionRoutes.post(
  "/collections/:collectionId/maintenance/sweep",
  requireSession,
  async (c) => {
    const collection = await requireOwnedCollection(
      c,
      param(c, "collectionId"),
    );

    // Every staged object under the caller's prefix. Staging names the
    // uploader, not the collection owner, so this is the caller's own
    // space; the parser still does the entry-id recovery, never the
    // character-wise prefix (sibling entry ids share prefixes).
    const keys = await listObjects(
      `staging/${c.get("user").id}/${collection.id}/`,
    );
    const byEntry = new Map<string, string[]>();
    for (const key of keys) {
      const parsed = parseMediaKey(key);
      if (!parsed || parsed.kind !== "staging") continue;
      const list = byEntry.get(parsed.entryId);
      if (list) list.push(key);
      else byEntry.set(parsed.entryId, [key]);
    }

    let swept = 0;
    if (byEntry.size > 0) {
      const entryIds = [...byEntry.keys()];
      const photoRows = await db
        .select({ id: artworkPhotosTable.id })
        .from(artworkPhotosTable)
        .where(inArray(artworkPhotosTable.id, entryIds));
      const documentRows = await db
        .select({ id: artworkDocumentsTable.id })
        .from(artworkDocumentsTable)
        .where(inArray(artworkDocumentsTable.id, entryIds));
      const withRow = new Set([
        ...photoRows.map((r) => r.id),
        ...documentRows.map((r) => r.id),
      ]);
      for (const [entryId, entryKeys] of byEntry) {
        if (withRow.has(entryId)) continue;
        for (const key of entryKeys) {
          await deleteObject(key);
          swept++;
        }
      }
    }

    return c.json({ swept });
  },
);
