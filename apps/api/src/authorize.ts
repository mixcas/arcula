// Resource authorization for /api/v1 (plan §7): load a row, check the
// caller against it, and hand the route a row it can trust.
//
// Two access shapes, mirroring the storage rules the proxy will
// replace:
//
//   owner   — the session user owns the collection. Every write path
//             (stage/process/discard/save/sweep) goes through here.
//   visitor — the resource is public. The read paths in S4 combine
//             this with their own per-resource rule (a collection's
//             isPublic hides its page; an artwork's isPublic admits it
//             by id even inside a private collection).
//
// The split between "does not exist" (404) and "you may not see it"
// matters for visitors: a private collection 403s, never 404s — the
// web client maps that refusal to its "private" state, exactly as it
// mapped the storage rules' permission-denied.

import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import {
  artworks as artworksTable,
  collections as collectionsTable,
} from "@arcula/db";
import { db } from "./db";
import { ApiError } from "./errors";
import { resolveSession } from "./session";

export type CollectionRow = typeof collectionsTable.$inferSelect;
export type ArtworkRow = typeof artworksTable.$inferSelect;

export const loadCollection = async (
  collectionId: string,
): Promise<CollectionRow | null> =>
  (
    await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, collectionId))
  )[0] ?? null;

export const loadArtworkInCollection = async (
  collectionId: string,
  artworkId: string,
): Promise<ArtworkRow | null> =>
  (
    await db
      .select()
      .from(artworksTable)
      .where(
        and(
          eq(artworksTable.collectionId, collectionId),
          eq(artworksTable.id, artworkId),
        ),
      )
  )[0] ?? null;

/** The artwork by global id, any collection. The create route's
 *  collision check: an id is a primary key, and reusing one would
 *  promote the new save's staged entries under the existing row's id. */
export const loadArtworkById = async (
  artworkId: string,
): Promise<ArtworkRow | null> =>
  (
    await db.select().from(artworksTable).where(eq(artworksTable.id, artworkId))
  )[0] ?? null;

/**
 * The read-side check: the collection exists, and the caller is the owner
 * or is looking at something public. A private collection the caller does
 * not own 403s — never 404s, the web client maps that refusal to its
 * "private" state, exactly as it mapped the old rules' permission-denied.
 */
export async function requireReadableCollection(
  c: Context,
  collectionId: string,
): Promise<CollectionRow> {
  const collection = await loadCollection(collectionId);
  if (!collection) {
    throw new ApiError("not-found", "The collection does not exist");
  }
  const session = await resolveSession(c);
  const isOwner = session !== null && collection.userId === session.user.id;
  if (!isOwner && !collection.isPublic) {
    throw new ApiError("forbidden", "This collection is private");
  }
  return collection;
}

/** The write-side check: the collection exists and the session user owns it. */
export async function requireOwnedCollection(
  c: Context,
  collectionId: string,
): Promise<CollectionRow> {
  const user = c.get("user");
  const collection = await loadCollection(collectionId);
  if (!collection) {
    throw new ApiError("not-found", "The collection does not exist");
  }
  if (collection.userId !== user.id) {
    throw new ApiError(
      "forbidden",
      "You do not have access to this collection",
    );
  }
  return collection;
}

/** Owner check plus the artwork existing inside that collection. */
export async function requireOwnedArtwork(
  c: Context,
  collectionId: string,
  artworkId: string,
): Promise<{ collection: CollectionRow; artwork: ArtworkRow }> {
  const collection = await requireOwnedCollection(c, collectionId);
  const artwork = await loadArtworkInCollection(collectionId, artworkId);
  if (!artwork) {
    throw new ApiError("not-found", "The artwork does not exist");
  }
  // Defensive: an artwork in an owned collection is written with the
  // owner's userId, but the check costs one comparison and the failure
  // mode (promoting a stranger's staged entry under your id) is the
  // kind of thing that should be impossible-by-construction.
  if (artwork.userId !== collection.userId) {
    throw new ApiError("forbidden", "You do not have access to this artwork");
  }
  return { collection, artwork };
}
