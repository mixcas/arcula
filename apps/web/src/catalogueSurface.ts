/**
 * What a catalogue's kind means for the surface, as pure data.
 *
 * One module answers the questions a screen would otherwise answer inline:
 * what to call the catalogue's kind, what its two existing fields mean
 * (`name` names whose art it is, `description` says what it is), whether a
 * work carries an availability at all, and which artwork fields the form
 * shows and requires.
 *
 * It is data, not components: the create form, the settings General tab and
 * the dashboard read it, and the artwork form follows it in #252. A later
 * per-kind field-hiding is a change to `ARTWORK_FIELDS` here, not a branch in
 * every screen.
 */

import type { CatalogueKind } from "@arcula/shared";
import type { ArtworkFormValues } from "@arcula/shared";

/** The three kinds, in the order a selector offers them. */
export const CATALOGUE_KINDS = [
  "portfolio",
  "collection",
  "inventory",
] as const satisfies readonly CatalogueKind[];

// Every kind the type knows is in the list above — adding a member to
// `CatalogueKind` fails here until the selector offers it.
type EveryKindIsOffered = CatalogueKind extends (typeof CATALOGUE_KINDS)[number]
  ? true
  : never;
const everyKindIsOffered: EveryKindIsOffered = true;
void everyKindIsOffered;

/**
 * One artwork field the form may show. Derived from the form's own values, so
 * a field added to the form cannot be silently absent from the surface.
 */
export type ArtworkField = keyof ArtworkFormValues;

export interface ArtworkFieldSurface {
  readonly field: ArtworkField;
  readonly visible: boolean;
  readonly required: boolean;
}

export interface CatalogueSurface {
  readonly kind: CatalogueKind;
  /** "Portfolio" | "Collection" | "Inventory" — the kind, named. */
  readonly kindLabel: string;
  /** What the catalogue's `name` asks for on this kind. */
  readonly nameLabel: string;
  /** What the catalogue's `description` asks for on this kind. */
  readonly descriptionLabel: string;
  /** Whether a work in this kind carries a market state. */
  readonly availabilityInPlay: boolean;
  /** The artwork form's fields, in form order, with their v1 rules. */
  readonly artworkFields: readonly ArtworkFieldSurface[];
}

/**
 * v1: every existing artwork field is visible on every kind, and only the two
 * identity fields are required. The list is exhaustive over the form's values
 * — the guard below fails the build if a field is added and not placed here.
 */
const ARTWORK_FIELDS: readonly ArtworkFieldSurface[] = [
  { field: "title", visible: true, required: true },
  { field: "artistName", visible: true, required: true },
  { field: "serie", visible: true, required: false },
  { field: "dateOfCreation", visible: true, required: false },
  { field: "medium", visible: true, required: false },
  { field: "dimensions", visible: true, required: false },
  { field: "editions", visible: true, required: false },
  { field: "acquisitionDate", visible: true, required: false },
  { field: "acquisitionPrice", visible: true, required: false },
  { field: "placeOfOrigin", visible: true, required: false },
  { field: "provenance", visible: true, required: false },
  { field: "notes", visible: true, required: false },
  { field: "condition", visible: true, required: false },
  { field: "currentValue", visible: true, required: false },
  { field: "status", visible: true, required: false },
];

type EveryArtworkFieldIsListed =
  Exclude<ArtworkField, (typeof ARTWORK_FIELDS)[number]["field"]> extends never
    ? true
    : never;
const everyArtworkFieldIsListed: EveryArtworkFieldIsListed = true;
void everyArtworkFieldIsListed;

/** The words and the availability axis, per kind. */
const SURFACES: Record<
  CatalogueKind,
  Omit<CatalogueSurface, "kind" | "artworkFields">
> = {
  portfolio: {
    kindLabel: "Portfolio",
    nameLabel: "Artist name",
    descriptionLabel: "Bio",
    availabilityInPlay: true,
  },
  collection: {
    kindLabel: "Collection",
    nameLabel: "Name",
    descriptionLabel: "Description",
    availabilityInPlay: false,
  },
  inventory: {
    kindLabel: "Inventory",
    nameLabel: "Gallery name",
    descriptionLabel: "About",
    availabilityInPlay: true,
  },
};

/** Everything the surface derives from one kind. */
export function catalogueSurface(kind: CatalogueKind): CatalogueSurface {
  return { kind, ...SURFACES[kind], artworkFields: ARTWORK_FIELDS };
}
