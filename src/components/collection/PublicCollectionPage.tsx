import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Container, Text } from "@mantine/core";

import SkinHost from "./SkinHost";
import PublicStateMessage from "./PublicStateMessage";
import { usePublicCollection } from "./usePublicCollection";
import { artworkSlug, collectionSlug, parseId } from "@/utils/slug";

/**
 * The public view of a whole collection.
 *
 * A thin shell: load, decide, hand over. The layout, the type and the
 * interaction all belong to the collection's skin (see `SkinHost`), which is why
 * this file has no presentation of its own beyond the states where there is
 * nothing to present.
 *
 * The canonical-URL rewrite below is the one behaviour that has to live here
 * rather than in a skin, because it is about the address rather than about the
 * collection's presentation — and it is deliberately gated on the collection
 * being published, because rewriting first would write a private collection's
 * name into the URL and the browser history while the body says it is private.
 */
const PublicCollectionPage: React.FC = () => {
  const { collectionId: param } = useParams<{ collectionId: string }>();
  // Routes carry "{slug}-{id}" but Firestore only ever knows the id.
  const collectionId = parseId(param ?? "");
  const navigate = useNavigate();

  const state = usePublicCollection(collectionId);
  // Read once so the effect below and the render agree on the same object.
  // `state.value` only changes identity when the load completes, so this is
  // stable across re-renders and safe as an effect dependency.
  const ready = state.status === "ready" ? state.value : null;

  useEffect(() => {
    if (!param || !ready) {
      return;
    }
    const { collection } = ready;
    if (collection.isPublic !== true) {
      return;
    }
    const canonical = collectionSlug(collection.name, collection.id);
    if (canonical === param) {
      return;
    }
    void navigate(`/collection/${canonical}`, { replace: true });
  }, [param, ready, navigate]);

  if (state.status !== "ready") {
    return <PublicStateMessage status={state.status} />;
  }

  const { collection, artworks } = state.value;

  if (artworks.length === 0) {
    // A skin with an empty stage and a title in the nav would look like a
    // loading failure. Saying so plainly is the kinder read, and it is what
    // this page has always done.
    return (
      <Container size="xl" py="2rem">
        <Text>No public artworks in this collection yet.</Text>
      </Container>
    );
  }

  const collectionPath = `/collection/${collectionSlug(
    collection.name,
    collection.id,
  )}`;

  return (
    <SkinHost
      view="home"
      collection={collection}
      artworks={artworks}
      collectionPath={collectionPath}
      artworkPath={(artwork) =>
        `${collectionPath}/artwork/${artworkSlug(artwork.title, artwork.id)}`
      }
    />
  );
};

export default PublicCollectionPage;
