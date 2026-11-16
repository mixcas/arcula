// The access question, answered once: may this viewer read this?
//
// Pure over rows a caller has already loaded — no database, no session, no
// Hono — so the single-work read, the artwork list, the photo proxy, the
// document proxy and the catalogue read all consume one rule instead of
// each spelling out a predicate of its own.
//
// Two matrices meet here, and the membership fact decides which one applies:
//
//   - **Inside a catalogue** — the owner and every collaborator. The owner
//     is `collections.userId`; anyone else with access is a
//     `collection_collaborators` row. Both see the whole catalogue: every
//     work, drafts and soft-deleted works included, and its documents.
//   - **Outside it** — a Visitor (a signed-in somebody else) and Anonymous
//     (no session). The visitor rule is unchanged (ADR-0003): the catalogue
//     is the only gate, so a work is visible exactly when the catalogue is
//     public AND the work is published AND live. A **Protected** catalogue
//     (public with a password) adds a second condition in front of that gate:
//     a non-member also needs a valid Access grant (ADR-0005). Signing in buys
//     nothing here, which is why the two are one membership (`null`) — and a
//     grant buys entry through the gate, not membership: once through, the
//     visitor rule decides what is inside.
//
// The grant arrives as a fact, never as a database read: the caller loads the
// grant row and asks `catalogueGrants.isGrantUsable`, so an absent, malformed
// or wrong-catalogue grant is simply `hasValidGrant = false` here.
//
// Documents carry no visitor rule at all: they are readable by the owner and
// collaborators only, at every status, in every catalogue — which is why that
// verdict takes nothing but the membership.
//
// `artworks.userId` is never consulted. It mirrors the catalogue's owner for
// the wire document and the transfer's convenience, not for authorization: a
// row's own id must not be able to admit someone the membership does not.
//
// Not-found vs forbidden is the caller's call, not this module's: a private
// catalogue answers 403 (the web client maps it to "private"), while a
// refused work or object answers 404.

import type {
  catalogueCollaborators as catalogueCollaboratorsTable,
  catalogues as cataloguesTable,
} from "@arcula/db";

/** The session user's id, or `null` for a reader with no session. */
export type Viewer = string | null;

/** The catalogue row's access-relevant shape. */
export type CatalogueFacts = Pick<
  typeof cataloguesTable.$inferSelect,
  "userId" | "isPublic" | "passwordHash"
>;

/** A catalogue with a second condition: a password (ADR-0005). */
const hasPassword = (catalogue: CatalogueFacts): boolean =>
  catalogue.passwordHash != null;

/** The membership row, as `authorize.ts` loads it (or `null` for none). */
export type CollaboratorRow = Pick<
  typeof catalogueCollaboratorsTable.$inferSelect,
  "userId"
>;

/**
 * What the viewer is to this catalogue: its owner, a collaborator, or
 * nobody. This is the one fact the verdicts below branch on — the owner and a
 * collaborator are the same answer everywhere inside the catalogue, and the
 * distinction exists for the `role` the dashboard shows.
 */
export type Membership = "owner" | "collaborator" | null;

/**
 * The membership fact, from the two rows that carry it. `collaborator` is the
 * viewer's own row for this catalogue, loaded by the caller — a row naming
 * another account is not this viewer's membership and fails closed.
 */
export const membershipOf = (
  viewer: Viewer,
  catalogue: CatalogueFacts,
  collaborator: CollaboratorRow | null,
): Membership => {
  if (viewer !== null && viewer === catalogue.userId) return "owner";
  if (viewer !== null && collaborator?.userId === viewer) {
    return "collaborator";
  }
  return null;
};

/** A member of the catalogue: the owner or a collaborator. */
export const isMember = (membership: Membership): boolean =>
  membership !== null;

/**
 * How a catalogue read may address the viewer: a member is shown the
 * password state, a visitor is not. This is the membership fact in the one
 * place a read needs it as a word rather than a boolean.
 */
export type CatalogueAudience = "member" | "visitor";

export const audienceOf = (membership: Membership): CatalogueAudience =>
  isMember(membership) ? "member" : "visitor";

/**
 * The catalogue itself: open to every member (public or private, protected
 * or not), and to a non-member exactly when the catalogue is public and —
 * if it is protected — the reader holds a valid grant. A private catalogue
 * stays closed even to a grant holder: the password is a condition on Public,
 * not a third visibility state.
 */
export const canSeeCatalogue = (
  membership: Membership,
  catalogue: CatalogueFacts,
  hasValidGrant = false,
): boolean =>
  isMember(membership) ||
  (catalogue.isPublic && (!hasPassword(catalogue) || hasValidGrant));

/** What the visitor rule reads off an artwork row. `status` is the database's
 *  text column: anything but `published` is not published, so an unknown value
 *  fails closed. */
export interface ArtworkFacts {
  status: string;
  deletedAt: Date | null;
}

/**
 * A work inside the catalogue: any work at all, to a member — a draft, a
 * soft-deleted work and a work in a private catalogue included. To anyone
 * else, the visitor rule: published AND live AND the catalogue readable —
 * which for a Protected catalogue also needs a valid grant. The grant never
 * reaches past the visitor rule, so it cannot admit a draft or a deleted work.
 */
export const canSeeArtwork = (
  membership: Membership,
  catalogue: CatalogueFacts,
  artwork: ArtworkFacts,
  hasValidGrant = false,
): boolean =>
  isMember(membership) ||
  (canSeeCatalogue(membership, catalogue, hasValidGrant) &&
    artwork.deletedAt === null &&
    artwork.status === "published");

/** Documents are the owner's and collaborators' only: status and the
 *  catalogue's flag never move them, and a visitor never reads one. */
export const canReadArtworkDocuments = (membership: Membership): boolean =>
  isMember(membership);
