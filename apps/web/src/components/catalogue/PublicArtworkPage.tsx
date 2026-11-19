import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import LockScreen from "@/components/LockScreen";
import SkinHost from "./SkinHost";
import PublicStateMessage from "./PublicStateMessage";
import { usePublicArtwork } from "./usePublicCatalogue";
import { artworkSlug, catalogueSlug, parseId } from "@arcula/shared";
import { catalogueService } from "@/services/catalogueService";

/**
 * The public view of a single artwork.
 *
 * The same shell as the catalogue page with one item instead of many, which is
 * the point: a skin is written once and given either `view`, and on this route
 * `artworks` is a one-element array. Nothing here fetches the catalogue's list,
 * which is what lets this page work on an artwork whose parent has since gained
 * a hundred other works.
 *
 * The three failure states it can reach are all inherited from the data layer
 * and none of them is new: a private *catalogue* is still "private" (the
 * catalogue read is what failed), while a private or soft-deleted *artwork* is
 * "not found", because the catalogue is public and the artwork is the thing
 * that cannot be shown. See `publicArtworkState` for why the parent check is
 * needed at all — the rules admit a public artwork by id whatever catalogue it
 * is in, so nothing server-side stops a work rendering on the wrong URL.
 */
const PublicArtworkPage: React.FC = () => {
  const { catalogueId: catalogueParam, artworkId: artworkParam } = useParams<{
    catalogueId: string;
    artworkId: string;
  }>();
  // Both segments are parsed independently: the catalogue and artwork parts of
  // a nested route each carry their own "{slug}-{id}".
  const catalogueId = parseId(catalogueParam ?? "");
  const artworkId = parseId(artworkParam ?? "");
  const navigate = useNavigate();

  const { state, reload } = usePublicArtwork(catalogueId, artworkId);
  // See PublicCataloguePage: read once so the effect and the render share an
  // object, and so the identity is stable across re-renders.
  const ready = state.status === "ready" ? state.value : null;

  useEffect(() => {
    if (!ready) {
      return;
    }
    const { catalogue, artwork } = ready;
    const canonicalCatalogue = catalogueSlug(catalogue.name, catalogue.id);
    const canonicalArtwork = artworkSlug(artwork.title, artwork.id);
    if (
      canonicalCatalogue === catalogueParam &&
      canonicalArtwork === artworkParam
    ) {
      return;
    }
    void navigate(
      `/catalogue/${canonicalCatalogue}/artwork/${canonicalArtwork}`,
      { replace: true },
    );
  }, [ready, catalogueParam, artworkParam, navigate]);

  if (state.status === "locked") {
    // The same challenge as the catalogue page, because a work's own link is
    // not a way around the catalogue's lock (ADR-0005). The attempt and the
    // reload are this page's; the screen only asks.
    return (
      <LockScreen
        noun="catalogue"
        name={state.catalogueName}
        onUnlock={async (password) => {
          await catalogueService.unlockCatalogue(catalogueId, password);
          reload();
        }}
      />
    );
  }

  if (state.status !== "ready") {
    return (
      <PublicStateMessage
        status={state.status}
        labels={{
          private: "This catalogue is private.",
          notFound: "This artwork is not available.",
        }}
      />
    );
  }

  const { catalogue, artwork } = state.value;
  const cataloguePath = `/catalogue/${catalogueSlug(
    catalogue.name,
    catalogue.id,
  )}`;

  return (
    <SkinHost
      view="artwork"
      subject={{ name: catalogue.name, description: catalogue.description }}
      catalogue={catalogue}
      artworks={[artwork]}
      cataloguePath={cataloguePath}
      artworkPath={(other) =>
        `${cataloguePath}/artwork/${artworkSlug(other.title, other.id)}`
      }
    />
  );
};

export default PublicArtworkPage;
