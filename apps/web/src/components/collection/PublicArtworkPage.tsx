import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import SkinHost from "./SkinHost";
import PublicStateMessage from "./PublicStateMessage";
import { usePublicArtwork } from "./usePublicCollection";
import { artworkSlug, collectionSlug, parseId } from "@/utils/slug";

/**
 * The public view of a single artwork.
 *
 * The same shell as the collection page with one item instead of many, which is
 * the point: a skin is written once and given either `view`, and on this route
 * `artworks` is a one-element array. Nothing here fetches the collection's list,
 * which is what lets this page work on an artwork whose parent has since gained
 * a hundred other works.
 *
 * The three failure states it can reach are all inherited from the data layer
 * and none of them is new: a private *collection* is still "private" (the
 * collection read is what failed), while a private or soft-deleted *artwork* is
 * "not found", because the collection is public and the artwork is the thing
 * that cannot be shown. See `publicArtworkState` for why the parent check is
 * needed at all — the rules admit a public artwork by id whatever collection it
 * is in, so nothing server-side stops a work rendering on the wrong URL.
 */
const PublicArtworkPage: React.FC = () => {
  const { collectionId: collectionParam, artworkId: artworkParam } = useParams<{
    collectionId: string;
    artworkId: string;
  }>();
  // Both segments are parsed independently: the collection and artwork parts of
  // a nested route each carry their own "{slug}-{id}".
  const collectionId = parseId(collectionParam ?? "");
  const artworkId = parseId(artworkParam ?? "");
  const navigate = useNavigate();

  const state = usePublicArtwork(collectionId, artworkId);
  // See PublicCollectionPage: read once so the effect and the render share an
  // object, and so the identity is stable across re-renders.
  const ready = state.status === "ready" ? state.value : null;

  useEffect(() => {
    if (!ready) {
      return;
    }
    const { collection, artwork } = ready;
    const canonicalCollection = collectionSlug(collection.name, collection.id);
    const canonicalArtwork = artworkSlug(artwork.title, artwork.id);
    if (
      canonicalCollection === collectionParam &&
      canonicalArtwork === artworkParam
    ) {
      return;
    }
    void navigate(
      `/collection/${canonicalCollection}/artwork/${canonicalArtwork}`,
      { replace: true },
    );
  }, [ready, collectionParam, artworkParam, navigate]);

  if (state.status !== "ready") {
    return (
      <PublicStateMessage
        status={state.status}
        labels={{
          private: "This collection is private.",
          notFound: "This artwork is not available.",
        }}
      />
    );
  }

  const { collection, artwork } = state.value;
  const collectionPath = `/collection/${collectionSlug(
    collection.name,
    collection.id,
  )}`;

  return (
    <SkinHost
      view="artwork"
      collection={collection}
      artworks={[artwork]}
      collectionPath={collectionPath}
      artworkPath={(other) =>
        `${collectionPath}/artwork/${artworkSlug(other.title, other.id)}`
      }
    />
  );
};

export default PublicArtworkPage;
