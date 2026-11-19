import {
  PaletteIcon,
  PresentationIcon,
  RugIcon,
  type Icon,
} from "@phosphor-icons/react";
import type { CatalogueKind } from "@arcula/shared";

/**
 * The glyph each kind wears.
 *
 * It lives beside `catalogueSurface.ts` rather than in it because that module
 * is pure data and may not hold React components. The create-catalogue picker
 * introduced the glyphs and was their only consumer; the landing page's kind
 * cards are the second, so the table moved here instead of being copied — a
 * kind that gains a different glyph gains it on both screens at once.
 */
export const KIND_ICONS: Record<CatalogueKind, Icon> = {
  portfolio: PaletteIcon,
  inventory: PresentationIcon,
  collection: RugIcon,
};
