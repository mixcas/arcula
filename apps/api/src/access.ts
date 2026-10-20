// The visitor question, answered once: may this viewer see this work?
//
// Pure over rows a caller has already loaded — no database, no session, no
// Hono — so the single-work read, the artwork list, the photo proxy, the
// document proxy and the collection read all consume one rule instead of
// each spelling out a predicate of its own.
//
// The rule (ADR-0003): the collection is the only gate. The owner of a row
// always sees it; anyone else sees a work exactly when the work is published
// and live AND its collection is public. Whether that someone is a signed-in
// Visitor or an Anonymous reader does not enter into it — no session is just
// a viewer who owns nothing.
//
// Documents are not part of that story: they are owner-only at every status,
// in every collection, which is why the verdict below takes no collection.
//
// Not-found vs forbidden is the caller's call, not this module's: a private
// collection answers 403 (the web client maps it to "private"), while a
// refused work or object answers 404.

/** The session user's id, or `null` for a reader with no session. */
export type Viewer = string | null;

/** What the gate reads off a collection row. */
export interface CollectionFacts {
  userId: string;
  isPublic: boolean;
}

/** What the gate reads off an artwork row. `status` is the database's text
 *  column: anything but `published` is not published, so an unknown value
 *  fails closed. */
export interface ArtworkFacts {
  userId: string;
  status: string;
  deletedAt: Date | null;
}

/** Ownership is a property of the row: its `userId` is the viewer's. */
export const isOwner = (viewer: Viewer, row: { userId: string }): boolean =>
  viewer !== null && viewer === row.userId;

/** A public collection is open to everyone; a private one to its owner. */
export const canSeeCollection = (
  viewer: Viewer,
  collection: CollectionFacts,
): boolean => isOwner(viewer, collection) || collection.isPublic;

/** A published, live work of a public collection; any work, to its owner. */
export const canSeeArtwork = (
  viewer: Viewer,
  collection: CollectionFacts,
  artwork: ArtworkFacts,
): boolean =>
  isOwner(viewer, artwork) ||
  (collection.isPublic &&
    artwork.deletedAt === null &&
    artwork.status === "published");

/** Documents are owner-only: status and the collection's flag never move
 *  them. */
export const canReadArtworkDocuments = (
  viewer: Viewer,
  artwork: { userId: string },
): boolean => isOwner(viewer, artwork);
