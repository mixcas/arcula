/**
 * What a catalogue's kind means for the surface, as pure data.
 *
 * One module answers the questions a screen would otherwise answer inline:
 * what to call the catalogue's kind, which colour it wears, what its two
 * existing fields mean
 * (`name` names whose art it is, `description` says what it is), whether a
 * work carries an availability at all (and which states that kind's form
 * offers), and the v1 artwork field table.
 *
 * It carries the v1 field table whole — every artwork field visible, only
 * `title` and `artistName` required — as the data a later per-kind hiding
 * would read. No v1 screen reads `visible`/`required` yet: the artwork form
 * renders every field it always has, so a per-kind hiding is a change to
 * `ARTWORK_FIELDS` here plus the one screen that consumes it, not a branch in
 * every screen. What v1 screens do read is the labels and the availability
 * axis: the create form, the settings General tab and the dashboard use the
 * words, the artwork form offers the availability values, and the manage views
 * read whether availability is in play at all.
 */

import type {
  ArtworkAvailability,
  ArtworkFormValues,
  CatalogueKind,
} from "@arcula/shared";

/**
 * The colour a kind wears, as a name rather than a Mantine type: this module
 * stays free of React and of Mantine, and a screen composes the CSS variable
 * from the name (`--mantine-color-{kindColor}-3`) instead of writing a hex.
 */
export type CatalogueKindColor = "orange" | "lime" | "indigo";

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

/**
 * The fields this table covers. `availability` is deliberately not among them:
 * it is not a per-kind field rule but the `availabilityInPlay` axis above,
 * because the form hides the whole control and the API accepts the value on
 * every kind.
 */
type SurfaceArtworkField = Exclude<ArtworkField, "availability">;

export interface ArtworkFieldSurface {
  readonly field: SurfaceArtworkField;
  readonly visible: boolean;
  readonly required: boolean;
}

export interface CatalogueSurface {
  readonly kind: CatalogueKind;
  /** "Portfolio" | "Collection" | "Inventory" — the kind, named. */
  readonly kindLabel: string;
  /** The colour this kind wears wherever it is named. The record's key type
   *  below makes a kind the surface forgot a build error, so a fourth kind
   *  cannot ship colourless. */
  readonly kindColor: CatalogueKindColor;
  /** What the catalogue's `name` asks for on this kind. */
  readonly nameLabel: string;
  /** What the catalogue's `description` asks for on this kind. */
  readonly descriptionLabel: string;
  /** Whether a work in this kind carries a market state. Derived from
   *  `availabilityValues`, so the two cannot disagree. */
  readonly availabilityInPlay: boolean;
  /** The market states this kind's form offers, in order; empty for a kind
   *  with no market state. The API accepts all four on every kind — this is a
   *  presentation rule, not a validation one. */
  readonly availabilityValues: readonly ArtworkAvailability[];
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
  Exclude<
    SurfaceArtworkField,
    (typeof ARTWORK_FIELDS)[number]["field"]
  > extends never
    ? true
    : never;
const everyArtworkFieldIsListed: EveryArtworkFieldIsListed = true;
void everyArtworkFieldIsListed;

/** The market state's four words, and only those: the record's key type makes
 *  a value the contract names but the surface forgot a build error. */
export const ARTWORK_AVAILABILITY_LABELS: Record<ArtworkAvailability, string> =
  {
    available: "Available",
    reserved: "Reserved",
    sold: "Sold",
    "on-consignment": "On consignment",
  };

/** The words and the market states, per kind. ADR-0010: a Portfolio sells the
 *  artist's own work, an Inventory sells what a gallery represents — including
 *  work it holds on consignment — and a Collection records what the collector
 *  owns, so it has no market state at all. */
const SURFACES: Record<
  CatalogueKind,
  Omit<CatalogueSurface, "kind" | "availabilityInPlay" | "artworkFields">
> = {
  portfolio: {
    kindLabel: "Portfolio",
    kindColor: "orange",
    nameLabel: "Artist name",
    descriptionLabel: "Bio",
    availabilityValues: ["available", "reserved", "sold"],
  },
  collection: {
    kindLabel: "Collection",
    kindColor: "indigo",
    nameLabel: "Name",
    descriptionLabel: "Description",
    availabilityValues: [],
  },
  inventory: {
    kindLabel: "Inventory",
    kindColor: "lime",
    nameLabel: "Gallery name",
    descriptionLabel: "About",
    availabilityValues: ["available", "reserved", "sold", "on-consignment"],
  },
};

/** Everything the surface derives from one kind. */
export function catalogueSurface(kind: CatalogueKind): CatalogueSurface {
  const surface = SURFACES[kind];
  return {
    kind,
    ...surface,
    availabilityInPlay: surface.availabilityValues.length > 0,
    artworkFields: ARTWORK_FIELDS,
  };
}

/**
 * The market state a form starts a work with: the stored one when there is
 * one, `available` on a kind that carries a state, and `null` on a kind that
 * does not. Shared by the Add and Edit pages so neither invents its own
 * default — and so a Collection can never be handed a value it does not show.
 */
export function availabilityFor(
  kind: CatalogueKind,
  stored: ArtworkAvailability | null | undefined,
): ArtworkAvailability | null {
  const surface = catalogueSurface(kind);
  if (surface.availabilityValues.length === 0) return null;
  return stored ?? "available";
}
