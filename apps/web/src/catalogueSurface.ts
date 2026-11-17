/**
 * What a catalogue's kind means for the surface, as pure data.
 *
 * One module answers the questions a screen would otherwise answer inline:
 * what to call the catalogue's kind, which colour it wears, what its two
 * existing fields mean (`name` names whose art it is, `description` says what
 * it is), what a new work starts with, and the words for a work's market
 * state.
 *
 * The market state is deliberately *not* a kind answer: every Kind offers the
 * same four states, and whether a Catalogue records one is the Artwork fields
 * registry's decision. Screens read the labels and the availability words; the
 * create form asks for the enabled state it resolved.
 */

import type {
  ArtworkAvailability,
  ArtworkFieldStates,
  ArtworkFormValues,
  CatalogueKind,
} from "@arcula/shared";
import { EMPTY_ARTWORK_FORM } from "@arcula/shared";

/**
 * The colour a kind wears, as a name rather than a Mantine type: this module
 * stays free of React and of Mantine, and a screen turns the name into a CSS
 * variable through `kindColorVar` instead of writing a hex.
 */
export type CatalogueKindColor = "orange" | "lime" | "indigo";

/**
 * The CSS variable for a kind's colour at one shade. The one place the
 * `--mantine-color-…` spelling lives, so a screen names a colour and a shade
 * rather than repeating the variable's shape at every call site.
 */
export function kindColorVar(color: CatalogueKindColor, shade: 3 | 7): string {
  return `var(--mantine-color-${color}-${shade})`;
}

/** The three kinds, in the order a selector offers them. */
export const CATALOGUE_KINDS = [
  "portfolio",
  "inventory",
  "collection",
] as const satisfies readonly CatalogueKind[];

// Every kind the type knows is in the list above — adding a member to
// `CatalogueKind` fails here until the selector offers it.
type EveryKindIsOffered = CatalogueKind extends (typeof CATALOGUE_KINDS)[number]
  ? true
  : never;
const everyKindIsOffered: EveryKindIsOffered = true;
void everyKindIsOffered;

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
  /**
   * Whether the catalogue's own name is the artist's name on this kind — a
   * Portfolio's is (ADR-0010), so a work added to one starts credited to it.
   * The same fact `nameLabel` states in words: a kind whose `name` is labelled
   * "Artist name" is exactly the kind whose new works arrive prefilled, and
   * `newArtworkForm` is the one place the two are read together.
   */
  readonly artistNameIsCatalogueName: boolean;
}

/** The market state's four words, and only those: the record's key type makes
 *  a value the contract names but the surface forgot a build error. */
export const ARTWORK_AVAILABILITY_LABELS: Record<ArtworkAvailability, string> =
  {
    available: "Available",
    reserved: "Reserved",
    sold: "Sold",
    "on-consignment": "On consignment",
  };

/** The four states, in the order a form offers them. One list for every Kind:
 *  Availability stopped being a per-Kind rule in the flattened field set. The
 *  guard makes a state the contract gains a build error until it is offered. */
export const ARTWORK_AVAILABILITY_STATES = [
  "available",
  "reserved",
  "sold",
  "on-consignment",
] as const satisfies readonly ArtworkAvailability[];

type EveryAvailabilityStateIsOffered =
  Exclude<
    ArtworkAvailability,
    (typeof ARTWORK_AVAILABILITY_STATES)[number]
  > extends never
    ? true
    : never;
const everyAvailabilityStateIsOffered: EveryAvailabilityStateIsOffered = true;
void everyAvailabilityStateIsOffered;

/** The words and the colours, per kind. ADR-0010: a Portfolio sells the
 *  artist's own work, an Inventory sells what a gallery represents — including
 *  work it holds on consignment — and a Collection records what the collector
 *  owns. A Portfolio's name is also its artist's name, which is why its new
 *  works start credited to it. */
const SURFACES: Record<CatalogueKind, Omit<CatalogueSurface, "kind">> = {
  portfolio: {
    kindLabel: "Portfolio",
    kindColor: "orange",
    nameLabel: "Artist name",
    descriptionLabel: "Bio",
    artistNameIsCatalogueName: true,
  },
  collection: {
    kindLabel: "Collection",
    kindColor: "indigo",
    nameLabel: "Name",
    descriptionLabel: "Description",
    artistNameIsCatalogueName: false,
  },
  inventory: {
    kindLabel: "Inventory",
    kindColor: "lime",
    nameLabel: "Gallery name",
    descriptionLabel: "About",
    artistNameIsCatalogueName: false,
  },
};

/** Everything the surface derives from one kind. */
export function catalogueSurface(kind: CatalogueKind): CatalogueSurface {
  return { kind, ...SURFACES[kind] };
}

/**
 * What a create form starts as on one kind: every field at its empty default,
 * the Artist Name credited to the catalogue's own name where that name *is* the
 * artist's — a Portfolio — and a market state exactly when the Catalogue
 * records Availability.
 *
 * This is a creation-time default, never a derived fact: the field stays
 * editable and required, so a Portfolio work credited to a guest, an estate or
 * an attribution saves exactly as typed, and a stored work keeps the artist it
 * records. Only a create surface reads it; prefilling the Edit page would
 * rewrite a work's recorded artist on a save that never touched the field.
 *
 * `enabled` is the resolved Artwork fields, not the Kind: a Portfolio that
 * switched Availability off, and a Collection that switched it on, each get
 * what their own configuration says. A Collection with it off comes out as
 * exactly `EMPTY_ARTWORK_FORM`.
 */
export function newArtworkForm(
  kind: CatalogueKind,
  catalogueName: string,
  enabled: ArtworkFieldStates,
): ArtworkFormValues {
  return {
    ...EMPTY_ARTWORK_FORM,
    artistName: catalogueSurface(kind).artistNameIsCatalogueName
      ? catalogueName
      : "",
    availability: enabled.availability ? "available" : null,
  };
}
