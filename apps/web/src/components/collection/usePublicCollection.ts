/**
 * The public views' data layer.
 *
 * ## Why the state is a union, and why half of it is pure
 *
 * The page this replaces tracked six overlapping booleans (`loading`, `error`,
 * `denied`, the collection, the artworks, the password prompt) and picked a
 * branch out of them in the render body, where two of them could be true at
 * once and the ordering of the conditionals was doing real work. `permission-
 * denied` in particular only reached the right screen because the `!collection`
 * branch happened to be skipped for it.
 *
 * A single discriminated union removes the ordering problem: exactly one status
 * holds, and the render is a switch. But a union is only worth having if the
 * decisions can be tested, and a hook that both fetches and decides can only be
 * tested against Firestore. So the *decisions* are pure functions over
 * already-fetched values — `publicCollectionState`, `publicArtworkState` — and
 * the hooks are thin wrappers that call the services and hand the results over.
 *
 * ## The sequencing that matters
 *
 * The collection is read first, and the artworks are requested only once it is
 * known to be published. That is not an optimisation: a private collection's
 * name and description must never reach an unauthenticated client, and the
 * rules deny that read outright — so the denial happens before the second round
 * trip is ever issued. See the sequencing note in `firestore.rules`.
 */

import { useEffect, useState } from "react";

import { artworkService } from "@/services/artworkService";
import { collectionService } from "@/services/collectionService";
import { isPermissionDenied } from "@/utils/firestoreErrors";
import type { Artwork, Collection } from "@/types";

/** The only status a page ever renders. */
export type PublicStatus =
  "invalid" | "loading" | "error" | "private" | "notFound" | "ready";

export type PublicState<T> =
  { status: Exclude<PublicStatus, "ready"> } | { status: "ready"; value: T };

export interface PublicCollectionData {
  collection: Collection;
  artworks: Artwork[];
}

export interface PublicArtworkData {
  collection: Collection;
  artwork: Artwork;
}

/**
 * A read that was refused, or that failed for any other reason.
 *
 * `permission-denied` is the rules doing their job, not a malfunction, so it
 * gets its own state rather than an error message: telling a visitor a public
 * page "failed" when the real answer is "this collection is not published" both
 * reads badly and invites a retry that cannot succeed.
 */
export const publicFailure = (error: unknown): PublicState<never> =>
  isPermissionDenied(error) ? { status: "private" } : { status: "error" };

/**
 * Fold a published-collection read into a state.
 *
 * `isPublic !== true` is the `private` state rather than `notFound`, for two
 * reasons. It is the honest description — a collection that is not published has
 * nothing to show a visitor — and it is where an owner previewing their *own*
 * private collection lands, since the rules let them read it. They are told it
 * is private, which is true, rather than shown a "not available" page for a
 * document that plainly exists.
 *
 * `artworks` is null only when the collection was not published, in which case
 * the second read never happened; the ready branch coalesces it so the shape
 * does not leak the sequencing.
 */
export const publicCollectionState = (
  collection: Collection | null,
  artworks: Artwork[] | null,
): PublicState<PublicCollectionData> => {
  if (collection === null) {
    return { status: "notFound" };
  }
  if (collection.isPublic !== true) {
    return { status: "private" };
  }
  return {
    status: "ready",
    value: { collection, artworks: artworks ?? [] },
  };
};

/**
 * Fold a single-artwork read into a state.
 *
 * The parent check is not redundant. `firestore.rules` admits a public,
 * un-deleted artwork by its own id *whatever collection it is in* — that is
 * deliberate, so an owner can keep one work public inside a private collection —
 * which means the rules cannot enforce "this work belongs to the collection in
 * the address bar". Without this comparison a public work would render on
 * another collection's URL.
 *
 * The artwork read has no `private` state: a refused read here means *this
 * artwork* is not public, not that the collection is, and the caller maps that
 * to `notFound` — which is the right thing to tell someone about a link to a
 * work that is not published.
 */
export const publicArtworkState = (
  collection: Collection | null,
  artwork: Artwork | null,
  collectionId: string,
): PublicState<PublicArtworkData> => {
  if (collection === null || artwork === null) {
    return { status: "notFound" };
  }
  if (collection.isPublic !== true) {
    return { status: "private" };
  }
  if (artwork.collectionId !== collectionId) {
    return { status: "notFound" };
  }
  return { status: "ready", value: { collection, artwork } };
};

/**
 * The published artworks of a collection, in the order the page shows them.
 *
 * Sorted by title here rather than with `orderBy`, and the reason is unchanged
 * from the page this replaces: the service query already carries two `where()`
 * constraints, and adding an `orderBy` on a third field would need yet another
 * composite index deployed before the public page works. `title` is required on
 * `Artwork`, so it is always safe to compare.
 */
const byTitle = (artworks: Artwork[]): Artwork[] =>
  [...artworks].sort((a, b) => a.title.localeCompare(b.title));
/**
 * Read a published collection and its public artworks.
 *
 * Sequential on purpose, and not for latency: the artworks are requested only
 * once the collection is known to be published, so a private collection's name
 * and description never reach an unauthenticated client. The rules deny that
 * first read outright, so the denial happens before the second round trip is
 * ever issued.
 *
 * Throws whatever the services throw, so the caller can map it with
 * `publicFailure` — the collection read is the one whose error code says
 * something.
 */
const loadCollection = async (
  collectionId: string,
): Promise<PublicState<PublicCollectionData>> => {
  const collection = await collectionService.getCollection(collectionId);
  if (collection === null) {
    return { status: "notFound" };
  }
  if (collection.isPublic !== true) {
    return { status: "private" };
  }
  const artworks =
    await artworkService.getPublicCollectionArtworks(collectionId);
  return publicCollectionState(collection, byTitle(artworks));
};

/** The public state of a whole collection. */
export const usePublicCollection = (
  collectionId: string,
): PublicState<PublicCollectionData> => {
  const [state, setState] = useState<PublicState<PublicCollectionData>>({
    status: "loading",
  });

  useEffect(() => {
    if (!collectionId) {
      return;
    }
    // Without this, navigating between two collections can land the first
    // fetch's result after the second one has already rendered.
    let cancelled = false;
    const apply = (next: PublicState<PublicCollectionData>) => {
      if (!cancelled) {
        setState(next);
      }
    };
    void loadCollection(collectionId).then(apply, (error: unknown) => {
      apply(publicFailure(error));
    });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  // A missing id is decided from the argument rather than stored, so there is no
  // state to set and no extra render to schedule for a case the route has
  // already decided.
  return collectionId ? state : { status: "invalid" };
};

/**
 * Read one published artwork together with its published collection.
 *
 * The artwork read distinguishes two failures that are easy to conflate. A
 * *denial* becomes `notFound`, which is deliberate: a refused artwork may be
 * private, soft-deleted, or simply not exist, and telling a visitor which of
 * those would be a disclosure — and routing it through `publicFailure` would
 * report "this collection is private" about a collection that is public. A
 * *transport* failure is re-thrown instead, because reporting "this artwork
 * does not exist" for a dropped connection is a claim the app cannot support,
 * and it costs the visitor a retry that would have worked.
 */
const loadArtwork = async (
  collectionId: string,
  artworkId: string,
): Promise<PublicState<PublicArtworkData>> => {
  const collection = await collectionService.getCollection(collectionId);
  if (collection === null) {
    return { status: "notFound" };
  }
  if (collection.isPublic !== true) {
    return { status: "private" };
  }
  let artwork: Artwork | null;
  try {
    artwork = await artworkService.getArtwork(artworkId);
  } catch (error) {
    // Only a *denial* is folded into `notFound`. A transport failure is
    // re-thrown so the caller reports it as an error, because silently turning
    // "the network is down" into "this artwork does not exist" is a claim the
    // app cannot support — and it costs the visitor a retry that would have
    // worked.
    if (isPermissionDenied(error)) {
      return { status: "notFound" };
    }
    throw error;
  }
  return publicArtworkState(collection, artwork, collectionId);
};

/**
 * The public state of one artwork.
 *
 * Only the single work is fetched, not the collection's list. That saves a round
 * trip and skips the `(collectionId, isPublic, deletedAt)` composite index
 * entirely, and nothing on the artwork view needs a neighbour: it offers a link
 * back to the collection and nothing else. A skin that did want neighbours would
 * need the list here, which is a deliberate cost, not an oversight.
 */
export const usePublicArtwork = (
  collectionId: string,
  artworkId: string,
): PublicState<PublicArtworkData> => {
  const [state, setState] = useState<PublicState<PublicArtworkData>>({
    status: "loading",
  });

  useEffect(() => {
    if (!collectionId || !artworkId) {
      return;
    }
    let cancelled = false;
    const apply = (next: PublicState<PublicArtworkData>) => {
      if (!cancelled) {
        setState(next);
      }
    };
    void loadArtwork(collectionId, artworkId).then(apply, (error: unknown) => {
      apply(publicFailure(error));
    });
    return () => {
      cancelled = true;
    };
  }, [collectionId, artworkId]);

  return collectionId && artworkId ? state : { status: "invalid" };
};
