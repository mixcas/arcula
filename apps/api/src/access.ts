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
//     public AND the work is published AND live. A **Protected** collection
//     (public with a password) adds a second condition in front of that gate:
//     a non-member also needs a valid Access grant (ADR-0005). Signing in buys
//     nothing here, which is why the two are one membership (`null`) — and a
//     grant buys entry through the gate, not membership: once through, the
//     visitor rule decides what is inside.
//
// The grant arrives as a fact, never as a database read: the caller loads the
// grant row and asks `collectionGrants.isGrantUsable`, so an absent, malformed
// or wrong-collection grant is simply `hasValidGrant = false` here.
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
  "userId" | "isPublic" | "passwordHash"
>;

/** A collection with a second condition: a password (ADR-0005). */
const hasPassword = (collection: CollectionFacts): boolean =>
  collection.passwordHash != null;

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
 * How a collection read may address the viewer: a member is shown the
 * password state, a visitor is not. This is the membership fact in the one
 * place a read needs it as a word rather than a boolean.
 */
export type CollectionAudience = "member" | "visitor";

export const audienceOf = (membership: Membership): CollectionAudience =>
  isMember(membership) ? "member" : "visitor";

/**
 * The collection itself: open to every member (public or private, protected
 * or not), and to a non-member exactly when the collection is public and —
 * if it is protected — the reader holds a valid grant. A private collection
 * stays closed even to a grant holder: the password is a condition on Public,
 * not a third visibility state.
 */
export const canSeeCollection = (
  membership: Membership,
  collection: CollectionFacts,
  hasValidGrant = false,
): boolean =>
  isMember(membership) ||
  (collection.isPublic && (!hasPassword(collection) || hasValidGrant));

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
 * else, the visitor rule: published AND live AND the collection readable —
 * which for a Protected collection also needs a valid grant. The grant never
 * reaches past the visitor rule, so it cannot admit a draft or a deleted work.
 */
export const canSeeArtwork = (
  membership: Membership,
  collection: CollectionFacts,
  artwork: ArtworkFacts,
  hasValidGrant = false,
): boolean =>
  isMember(membership) ||
  (canSeeCollection(membership, collection, hasValidGrant) &&
    artwork.deletedAt === null &&
    artwork.status === "published");

/** Documents are the owner's and collaborators' only: status and the
 *  collection's flag never move them, and a visitor never reads one. */
export const canReadArtworkDocuments = (membership: Membership): boolean =>
  isMember(membership);
