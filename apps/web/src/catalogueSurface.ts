/**
 * What a catalogue's kind means for the surface, as pure data.
 *
 * One module answers the questions a screen would otherwise answer inline:
 * what to call the catalogue's kind, which colour it wears, what its two
 * existing fields mean
 * (`name` names whose art it is, `description` says what it is), whether a
 * work carries an availability at all (and which states that kind's form
 * offers), and what Artist Name a new work starts with.
 *
 * Screens read the labels and the availability axis: the create form, the
 * settings General tab and the dashboard use the words, the artwork form
 * offers the availability values, and the manage views read whether
 * availability is in play at all.
 */

import type {
  ArtworkAvailability,
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
  /** Whether a work in this kind carries a market state. Derived from
   *  `availabilityValues`, so the two cannot disagree. */
  readonly availabilityInPlay: boolean;
  /** The market states this kind's form offers, in order; empty for a kind
   *  with no market state. The API accepts all four on every kind — this is a
   *  presentation rule, not a validation one. */
  readonly availabilityValues: readonly ArtworkAvailability[];
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

/** The words and the market states, per kind. ADR-0010: a Portfolio sells the
 *  artist's own work, an Inventory sells what a gallery represents — including
 *  work it holds on consignment — and a Collection records what the collector
 *  owns, so it has no market state at all. A Portfolio's name is also its
 *  artist's name, which is why its new works start credited to it. */
const SURFACES: Record<
  CatalogueKind,
  Omit<CatalogueSurface, "kind" | "availabilityInPlay">
> = {
  portfolio: {
    kindLabel: "Portfolio",
    kindColor: "orange",
    nameLabel: "Artist name",
    descriptionLabel: "Bio",
    availabilityValues: ["available", "reserved", "sold"],
    artistNameIsCatalogueName: true,
  },
  collection: {
    kindLabel: "Collection",
    kindColor: "indigo",
    nameLabel: "Name",
    descriptionLabel: "Description",
    availabilityValues: [],
    artistNameIsCatalogueName: false,
  },
  inventory: {
    kindLabel: "Inventory",
    kindColor: "lime",
    nameLabel: "Gallery name",
    descriptionLabel: "About",
    availabilityValues: ["available", "reserved", "sold", "on-consignment"],
    artistNameIsCatalogueName: false,
  },
};

/** Everything the surface derives from one kind. */
export function catalogueSurface(kind: CatalogueKind): CatalogueSurface {
  const surface = SURFACES[kind];
  return {
    kind,
    ...surface,
    availabilityInPlay: surface.availabilityValues.length > 0,
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

/**
 * What a create form starts as on one kind: every field at its empty default,
 * the Artist Name credited to the catalogue's own name where that name *is* the
 * artist's — a Portfolio — and a market state where the kind carries one.
 *
 * This is a creation-time default, never a derived fact: the field stays
 * editable and required, so a Portfolio work credited to a guest, an estate or
 * an attribution saves exactly as typed, and a stored work keeps the artist it
 * records. Only a create surface reads it; prefilling the Edit page would
 * rewrite a work's recorded artist on a save that never touched the field.
 *
 * One answer for every kind, so a screen has no per-kind branch that could skip
 * one. A Collection comes out as exactly `EMPTY_ARTWORK_FORM`: it prefills
 * nothing and has no market state.
 */
export function newArtworkForm(
  kind: CatalogueKind,
  catalogueName: string,
): ArtworkFormValues {
  return {
    ...EMPTY_ARTWORK_FORM,
    artistName: catalogueSurface(kind).artistNameIsCatalogueName
      ? catalogueName
      : "",
    availability: availabilityFor(kind, null),
  };
}
