import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import LockScreen from "@/components/LockScreen";
import SkinHost from "./SkinHost";
import PublicStateMessage from "./PublicStateMessage";
import { usePublicSelectionArtwork } from "./usePublicSelection";
import { artworkSlug, parseId, selectionSlug } from "@arcula/shared";
import { selectionService } from "@/services/selectionService";

/**
 * One work under a Selection's own address.
 *
 * The same shell as the Catalogue's artwork page with a different document
 * behind it: the Selection supplies the subject, the credit line and the
 * presentation it inherits from its source Catalogue, and the works array is
 * the one work. Nothing here fetches the Selection's list — the single-work
 * read already refuses a work the Selection does not curate.
 *
 * **One not-found.** A work outside the Selection, a work deleted in its
 * Catalogue, a private Selection and a stamped one all answer the same 404, so
 * this page has one "not available" state and never confirms what is hidden. A
 * Protected Selection is the exception the lock screen handles, and its
 * challenge arrives from the Selection read — which necessarily runs first.
 *
 * The address is the Selection's, not the Catalogue's: both segments parse
 * independently (each carries its own `{slug}-{id}`) and both are canonicalised
 * in place, so a work's link here can never drift into a Catalogue route.
 */
const PublicSelectionArtworkPage: React.FC = () => {
  const { selectionId: selectionParam, artworkId: artworkParam } = useParams<{
    selectionId: string;
    artworkId: string;
  }>();
  // Both segments are parsed independently: the Selection and artwork parts of
  // a nested route each carry their own "{slug}-{id}".
  const selectionId = parseId(selectionParam ?? "");
  const artworkId = parseId(artworkParam ?? "");
  const navigate = useNavigate();

  const { state, reload } = usePublicSelectionArtwork(selectionId, artworkId);
  // Read once so the effect below and the render agree on the same object.
  const ready = state.status === "ready" ? state.value : null;

  useEffect(() => {
    if (!ready) {
      return;
    }
    const { selection, artwork } = ready;
    const canonicalSelection = selectionSlug(
      selection.selection.name,
      selection.selection.id,
    );
    const canonicalArtwork = artworkSlug(artwork.title, artwork.id);
    if (
      canonicalSelection === selectionParam &&
      canonicalArtwork === artworkParam
    ) {
      return;
    }
    void navigate(
      `/selection/${canonicalSelection}/artwork/${canonicalArtwork}`,
      { replace: true },
    );
  }, [ready, selectionParam, artworkParam, navigate]);

  if (state.status === "locked") {
    // The same challenge as the Selection's page: a work's own link is not a
    // way around the Selection's lock. The attempt and the reload are this
    // page's; the screen only asks, and it names the Selection.
    return (
      <LockScreen
        noun="selection"
        name={state.selectionName}
        onUnlock={async (password) => {
          await selectionService.unlockSelection(selectionId, password);
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
          invalid: "That artwork link is not valid.",
          error: "Could not load this artwork. Try again.",
          private: "This selection is private.",
          notFound: "This artwork is not available.",
        }}
      />
    );
  }

  const { selection: selectionDocument, artwork } = state.value;
  const { selection, catalogueName, skin, skinOptions } = selectionDocument;
  const selectionPath = `/selection/${selectionSlug(
    selection.name,
    selection.id,
  )}`;

  return (
    <SkinHost
      view="selection"
      subject={{
        name: selection.name,
        description: selection.description,
        catalogueName,
      }}
      artworks={[artwork]}
      selectionPath={selectionPath}
      artworkPath={(other) =>
        `${selectionPath}/artwork/${artworkSlug(other.title, other.id)}`
      }
      skin={skin}
      skinOptions={skinOptions}
    />
  );
};

export default PublicSelectionArtworkPage;
