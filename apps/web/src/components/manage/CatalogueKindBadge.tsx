/**
 * A catalogue's kind, named on the colour the surface module gives it.
 *
 * The one badge that names a kind, so the dashboard row and the Settings
 * General tab cannot drift apart: the label and the colour both come from
 * `catalogueSurface`. It fills with the kind's shade-3 background and keeps
 * The badge's own defaults supply the size, radius and pill shape (the app
 * theme's `defaultRadius: 0` does not reach them), and the colours come from
 * style props rather than a variant: `light` is the near-white shade 0 chip
 * this replaces, and any variant's theme colour would have to be overridden
 * anyway.
 */

import React from "react";
import { Badge } from "@mantine/core";
import type { CatalogueKind } from "@arcula/shared";
import { catalogueSurface } from "@/catalogueSurface";

interface CatalogueKindBadgeProps {
  kind: CatalogueKind;
}

const CatalogueKindBadge: React.FC<CatalogueKindBadgeProps> = ({ kind }) => {
  const { kindLabel, kindColor } = catalogueSurface(kind);

  return (
    <Badge bg={`var(--mantine-color-${kindColor}-3)`} c="dark.9">
      {kindLabel}
    </Badge>
  );
};

export default CatalogueKindBadge;
