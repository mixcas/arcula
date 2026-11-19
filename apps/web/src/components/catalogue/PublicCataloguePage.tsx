import React, { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Container, Text } from "@mantine/core";

import LockScreen from "@/components/LockScreen";
import SkinHost from "./SkinHost";
import PublicStateMessage from "./PublicStateMessage";
import { usePublicCatalogue } from "./usePublicCatalogue";
import { artworkSlug, catalogueSlug, parseId } from "@arcula/shared";
import { catalogueService } from "@/services/catalogueService";

/**
 * The public view of a whole catalogue.
 *
 * A thin shell: load, decide, hand over. The layout, the type and the
 * interaction all belong to the catalogue's skin (see `SkinHost`), which is why
 * this file has no presentation of its own beyond the states where there is
 * nothing to present — and the lock screen, which is about the catalogue
 * rather than its presentation (ADR-0005).
 *
 * The canonical-URL rewrite below is the one behaviour that has to live here
 * rather than in a skin, because it is about the address rather than about the
 * catalogue's presentation — and it is deliberately gated on the catalogue
 * being published, because rewriting first would write a private catalogue's
 * name into the URL and the browser history while the body says it is private.
 */
const PublicCataloguePage: React.FC = () => {
  const { catalogueId: param } = useParams<{ catalogueId: string }>();
  // Routes carry "{slug}-{id}" but the API only ever knows the id.
  const catalogueId = parseId(param ?? "");
  const navigate = useNavigate();

  const { state, reload } = usePublicCatalogue(catalogueId);
  // Read once so the effect below and the render agree on the same object.
  // `state.value` only changes identity when the load completes, so this is
  // stable across re-renders and safe as an effect dependency.
  const ready = state.status === "ready" ? state.value : null;

  useEffect(() => {
    if (!param || !ready) {
      return;
    }
    const { catalogue } = ready;
    if (catalogue.isPublic !== true) {
      return;
    }
    const canonical = catalogueSlug(catalogue.name, catalogue.id);
    if (canonical === param) {
      return;
    }
    void navigate(`/catalogue/${canonical}`, { replace: true });
  }, [param, ready, navigate]);

  if (state.status === "locked") {
    // App chrome, and the same load on success: the catalogue read is still
    // the first thing requested, and the artwork list follows it. The attempt
    // is this page's — the screen itself calls nothing.
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
    return <PublicStateMessage status={state.status} />;
  }

  const { catalogue, artworks } = state.value;

  if (artworks.length === 0) {
    // A skin with an empty stage and a title in the nav would look like a
    // loading failure. Saying so plainly is the kinder read, and it is what
    // this page has always done.
    return (
      <Container size="xl" py="2rem">
        <Text>This catalogue has no artworks yet.</Text>
      </Container>
    );
  }

  const cataloguePath = `/catalogue/${catalogueSlug(
    catalogue.name,
    catalogue.id,
  )}`;

  return (
    <SkinHost
      view="home"
      catalogue={catalogue}
      artworks={artworks}
      cataloguePath={cataloguePath}
      artworkPath={(artwork) =>
        `${cataloguePath}/artwork/${artworkSlug(artwork.title, artwork.id)}`
      }
    />
  );
};

export default PublicCataloguePage;
