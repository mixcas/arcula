// The access question, answered once: may this viewer read this?
//
// Pure over rows a caller has already loaded — no database, no session, no
// Hono — so the single-work read, the artwork list, the photo proxy, the
// document proxy and the collection read all consume one rule instead of
// each spelling out a predicate of its own.
//
// Two matrices meet here, and the membership fact decides which one applies:
//
//   - **Inside a collection** — the owner and every collaborator. The owner
//     is `collections.userId`; anyone else with access is a
//     `collection_collaborators` row. Both see the whole collection: every
//     work, drafts and soft-deleted works included, and its documents.
//   - **Outside it** — a Visitor (a signed-in somebody else) and Anonymous
//     (no session). The visitor rule is unchanged (ADR-0003): the collection
//     is the only gate, so a work is visible exactly when the collection is
//     public AND the work is published AND live. Signing in buys nothing here,
//     which is why the two are one membership (`null`).
//
// Documents carry no visitor rule at all: they are readable by the owner and
// collaborators only, at every status, in every collection — which is why that
// verdict takes nothing but the membership.
//
// `artworks.userId` is never consulted. It mirrors the collection's owner for
// the wire document and the transfer's convenience, not for authorization: a
// row's own id must not be able to admit someone the membership does not.
//
// Not-found vs forbidden is the caller's call, not this module's: a private
// collection answers 403 (the web client maps it to "private"), while a
// refused work or object answers 404.

import type {
  collectionCollaborators as collectionCollaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";

/** The session user's id, or `null` for a reader with no session. */
export type Viewer = string | null;

/** The collection row's access-relevant shape. */
export type CollectionFacts = Pick<
  typeof collectionsTable.$inferSelect,
  "userId" | "isPublic"
>;

/** The membership row, as `authorize.ts` loads it (or `null` for none). */
export type CollaboratorRow = Pick<
  typeof collectionCollaboratorsTable.$inferSelect,
  "userId"
>;

/**
 * What the viewer is to this collection: its owner, a collaborator, or
 * nobody. This is the one fact the verdicts below branch on — the owner and a
 * collaborator are the same answer everywhere inside the collection, and the
 * distinction exists for the `role` the dashboard shows.
 */
export type Membership = "owner" | "collaborator" | null;

/**
 * The membership fact, from the two rows that carry it. `collaborator` is the
 * viewer's own row for this collection, loaded by the caller — a row naming
 * another account is not this viewer's membership and fails closed.
 */
export const membershipOf = (
  viewer: Viewer,
  collection: CollectionFacts,
  collaborator: CollaboratorRow | null,
): Membership => {
  if (viewer !== null && viewer === collection.userId) return "owner";
  if (viewer !== null && collaborator?.userId === viewer) {
    return "collaborator";
  }
  return null;
};

/** A member of the collection: the owner or a collaborator. */
export const isMember = (membership: Membership): boolean =>
  membership !== null;

/**
 * The collection itself: open to every member (public or private), and to a
 * non-member exactly when the collection is public.
 */
export const canSeeCollection = (
  membership: Membership,
  collection: CollectionFacts,
): boolean => isMember(membership) || collection.isPublic;

/** What the visitor rule reads off an artwork row. `status` is the database's
 *  text column: anything but `published` is not published, so an unknown value
 *  fails closed. */
export interface ArtworkFacts {
  status: string;
  deletedAt: Date | null;
}

/**
 * A work inside the collection: any work at all, to a member — a draft, a
 * soft-deleted work and a work in a private collection included. To anyone
 * else, the visitor rule: published AND live AND the collection public.
 */
export const canSeeArtwork = (
  membership: Membership,
  collection: CollectionFacts,
  artwork: ArtworkFacts,
): boolean =>
  isMember(membership) ||
  (collection.isPublic &&
    artwork.deletedAt === null &&
    artwork.status === "published");

/** Documents are the owner's and collaborators' only: status and the
 *  collection's flag never move them, and a visitor never reads one. */
export const canReadArtworkDocuments = (membership: Membership): boolean =>
  isMember(membership);
