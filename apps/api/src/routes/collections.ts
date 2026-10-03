// The collection resource routes (plan §7):
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
  artworks as artworksTable,
  collections as collectionsTable,
} from "@arcula/db";
import {
  COLLECTION_LIMITS,
  UPDATABLE_TEXT_FIELDS,
  artworkBulkDeleteSchema,
  artworkImportSchema,
  collectionCreateSchema,
  collectionUpdateSchema,
  artworkSchema,
  type ArtworkBulkDeletePayload,
  type ArtworkImportPayload,
  type CollectionCreatePayload,
  type CollectionUpdatePayload,
  type CollectionTier,
} from "@arcula/shared";
import { Hono, type Context } from "hono";
import {
  loadCollection,
  requireOwnedArtwork,
  requireOwnedCollection,
  requireReadableCollection,
} from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { parseBody, safeTx } from "../http";
import { requireSession, resolveSession } from "../session";
import { serializeCollection } from "../serialize";

export const collectionRoutes = new Hono();

// The route patterns guarantee these segments; `?? ""` only exists to
// satisfy Hono's optional param type. An empty segment 404s at the row
// lookup.
const param = (c: Context, key: string): string => c.req.param(key) ?? "";

// GET /collections — signed in: the owner's own list, name-ordered (the
// query the service layer used); anonymous: the public list. A signed-in
// visitor never sees other people's collections through this route.
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

// POST /collections — the cap check comes FIRST (§7): the count is over the
// caller's own collections, the limit is read off the caller's tier.
collectionRoutes.post("/collections", requireSession, async (c) => {
  const user = c.get("user");
  const payload: CollectionCreatePayload = await parseBody(
    c,
    collectionCreateSchema,
  );

  const limit =
    user.tier in COLLECTION_LIMITS
      ? COLLECTION_LIMITS[user.tier as CollectionTier]
      : COLLECTION_LIMITS.free;
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

  const id = crypto.randomUUID();
  const now = new Date();
  await db.insert(collectionsTable).values({
    id,
    userId: user.id,
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
      const parsed = artworkSchema.safeParse(row);
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
        id: crypto.randomUUID(),
        userId: user.id,
        collectionId: collection.id,
        title: values.title,
        artistName: values.artistName,
        isPublic: values.isPublic,
        // Always written, as null: the list filters on it, and a missing
        // field is not a null (the write-path doctrine, §4).
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
// `updatedAt` (the old batch-of-400 writeBatch was this, minus the
// chunking). Already-deleted or foreign ids are not in the WHERE clause's
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
