import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Container, Text } from "@mantine/core";

import LockScreen from "@/components/LockScreen";
import SkinHost from "./SkinHost";
import PublicStateMessage from "./PublicStateMessage";
import { usePublicSelection } from "./usePublicSelection";
import { artworkSlug, parseId, selectionSlug } from "@arcula/shared";
import { selectionService } from "@/services/selectionService";

/**
 * The public view of a Selection.
 *
 * The same shell as the Catalogue page: load, decide, hand over. Its subject is
 * the Selection's own name and description, its works arrive in the curator's
 * order, and its presentation is the source Catalogue's skin and options. The
 * Catalogue is credited by name and never linked — its address is a different
 * gate, often a private one.
 *
 * The canonical rewrite is gated on the document being readable by this caller,
 * never on `isPublic`: a member previewing their own Private Selection must
 * still get the legible address, and rewriting first would write a private
 * document's name into the URL and the browser history.
 *
 * The works read arrives in #352; this slice renders the Selection's subject
 * and an empty stage, and says plainly that there is nothing in it yet.
 */
const PublicSelectionPage: React.FC = () => {
  const { selectionId: param } = useParams<{ selectionId: string }>();
  // Routes carry "{slug}-{id}" but the API only ever knows the id.
  const selectionId = parseId(param ?? "");
  const navigate = useNavigate();

  const { state, reload } = usePublicSelection(selectionId);
  // Read once so the effect below and the render agree on the same object.
  const ready = state.status === "ready" ? state.value : null;

  useEffect(() => {
    if (!param || !ready) {
      return;
    }
    const canonical = selectionSlug(ready.selection.name, ready.selection.id);
    if (canonical === param) {
      return;
    }
    void navigate(`/selection/${canonical}`, { replace: true });
  }, [param, ready, navigate]);

  if (state.status === "locked") {
    // App chrome, and the same load on success: the unlock sets the grant
    // cookie and this page re-runs the ordinary read. The attempt is the page's
    // — the screen itself calls nothing.
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
          invalid: "That selection link is not valid.",
          error: "Could not load this selection. Try again.",
          private: "This selection is private.",
          notFound: "This selection is not available.",
        }}
      />
    );
  }

  const { selection, catalogueName, skin, skinOptions } = state.value;
  const selectionPath = `/selection/${selectionSlug(
    selection.name,
    selection.id,
  )}`;

  return (
    <>
      {/*
        An empty Selection still shows its own name and description through the
        skin; this line is app chrome, because the skin's empty stage would
        otherwise read as a loading failure. One sentence is the whole state.
      */}
      <Container size="xl" pt="4rem">
        <Text>This selection has no works yet.</Text>
      </Container>

      <SkinHost
        view="selection"
        subject={{
          name: selection.name,
          description: selection.description,
          catalogueName,
        }}
        artworks={[]}
        selectionPath={selectionPath}
        artworkPath={(artwork) =>
          `${selectionPath}/artwork/${artworkSlug(artwork.title, artwork.id)}`
        }
        skin={skin}
        skinOptions={skinOptions}
      />
    </>
  );
};

export default PublicSelectionPage;
