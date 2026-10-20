// Resource authorization for /api/v1: load a row, check the caller
// against it, and hand the route a row it can trust.
//
//   owner — the session user owns the collection the row belongs to. Every
//           write path (stage/process/discard/save/sweep) still goes through
//           here: collaborator writes are the next ticket's, so this release
//           admits no write it has not specified and tested.
//
// The access verdicts themselves are not spelled out here: the read paths
// call the pure functions in access.ts over rows they have already loaded,
// and the viewer's membership row loads here so those verdicts have their one
// extra fact.
//
// The split between "does not exist" (404) and "you may not see it"
// matters for visitors: a private collection 403s, never 404s — the web
// client maps that refusal to its "private" state.

import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import {
  artworks as artworksTable,
  collectionCollaborators as collectionCollaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";
import {
  canSeeCollection,
  membershipOf,
  type CollaboratorRow,
  type CollectionFacts,
  type Membership,
} from "./access";
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

/**
 * The viewer's own membership row for a collection, or `null` for none.
 *
 * The owner has no row here — `collections.userId` is the one owner fact —
 * so this is asked only to place everyone else, and the query is keyed by
 * both ids so a row naming somebody else can never come back.
 */
const loadCollaborator = async (
  collectionId: string,
  userId: string,
): Promise<CollaboratorRow | null> =>
  (
    await db
      .select({ userId: collectionCollaboratorsTable.userId })
      .from(collectionCollaboratorsTable)
      .where(
        and(
          eq(collectionCollaboratorsTable.collectionId, collectionId),
          eq(collectionCollaboratorsTable.userId, userId),
        ),
      )
  )[0] ?? null;

/** The viewer's membership in a collection, rows loaded. An owner costs no
 *  query: `collections.userId` is the fact, and the membership row is only
 *  asked about anyone else. */
export const loadMembership = async (
  collectionId: string,
  collection: CollectionFacts,
  viewer: string | null,
): Promise<Membership> => {
  if (viewer === null) return null;
  if (viewer === collection.userId) return "owner";
  return membershipOf(
    viewer,
    collection,
    await loadCollaborator(collectionId, viewer),
  );
};

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
 * The read-side check: the collection exists, and the caller is a member
 * or is looking at something public. A private collection a non-member
 * cannot read 403s — never 404s, the web client maps that refusal to its
 * "private" state.
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
  const membership = await loadMembership(
    collectionId,
    collection,
    session?.user.id ?? null,
  );
  if (!canSeeCollection(membership, collection)) {
    throw new ApiError("forbidden", "This collection is private");
  }
  return collection;
}

/**
 * The write-side check: the collection exists and the session user owns it.
 *
 * Collaborator writes are the next ticket's; the routes keep the owner check
 * until that lands.
 */
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
  // `artworks.userId` is not checked: it mirrors the collection owner, and no
  // authorization reads it (ADR-0004). The row's collection is the fact.
  return { collection, artwork };
}
