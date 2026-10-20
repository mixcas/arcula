// Resource authorization for /api/v1: load a row, check the caller
// against it, and hand the route a row it can trust.
//
//   readable — the collection exists and the viewer is a member of it or is
//              looking at something public (the visitor rule in access.ts).
//   member   — the collection exists and the caller is its owner or one of
//              its collaborators. Every write path — the collection's
//              settings, artwork create/edit/restore/bulk-delete, CSV import,
//              stage/process/discard/save/sweep — asks this one question, so a
//              collaborator can do the job they were invited to do and a
//              non-member cannot.
//
// The access verdicts themselves are not spelled out here: the read paths
// call the pure functions in access.ts over rows they have already loaded,
// and the viewer's membership row loads here so those verdicts have their one
// extra fact.
//
// The split between "does not exist" (404) and "you may not see it"
// matters for visitors: a private collection 403s, never 404s — the web
// client maps that refusal to its "private" state.
//
// `artworks.userId` is never compared with the caller: it mirrors the
// collection's owner (ADR-0004), and a row's own id must not admit anyone the
// membership does not.

import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import {
  artworks as artworksTable,
  collectionCollaborators as collectionCollaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";
import {
  canSeeCollection,
  isMember,
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
 * The write-side check: the collection exists and the caller is a member of
 * it — its owner, or an account with a `collection_collaborators` row.
 *
 * Membership is the whole verdict (ADR-0004): a collaborator may change every
 * setting, public/private included, and every work, exactly as the owner does,
 * because there is no narrower write role to hand out. Only access
 * administration — invitations, removal, transfer — will stay owner-only when
 * those routes land, and they will say so with a check of their own.
 *
 * A missing collection is `404`; a non-member is `403`, matching the read
 * side's refusal for a private collection.
 */
export async function requireMemberCollection(
  c: Context,
  collectionId: string,
): Promise<CollectionRow> {
  const collection = await loadCollection(collectionId);
  if (!collection) {
    throw new ApiError("not-found", "The collection does not exist");
  }
  const membership = await loadMembership(
    collectionId,
    collection,
    c.get("user").id,
  );
  if (!isMember(membership)) {
    throw new ApiError(
      "forbidden",
      "You do not have access to this collection",
    );
  }
  return collection;
}

/**
 * The owner-only check for access administration — invitations today, and
 * collaborator removal, leaving and transfer when those routes land. A
 * collaborator is a member (and may edit everything), but only the owner
 * decides who else gets in (ADR-0004).
 */
export async function requireOwnerCollection(
  c: Context,
  collectionId: string,
): Promise<CollectionRow> {
  const collection = await requireMemberCollection(c, collectionId);
  if (collection.userId !== c.get("user").id) {
    throw new ApiError(
      "forbidden",
      "Only the collection's owner can manage access",
    );
  }
  return collection;
}

/** The membership check plus the artwork existing inside that collection. */
export async function requireMemberArtwork(
  c: Context,
  collectionId: string,
  artworkId: string,
): Promise<{ collection: CollectionRow; artwork: ArtworkRow }> {
  const collection = await requireMemberCollection(c, collectionId);
  const artwork = await loadArtworkInCollection(collectionId, artworkId);
  if (!artwork) {
    throw new ApiError("not-found", "The artwork does not exist");
  }
  // `artworks.userId` is not checked: it mirrors the collection owner, and no
  // authorization reads it (ADR-0004). The row's collection is the fact.
  return { collection, artwork };
}
