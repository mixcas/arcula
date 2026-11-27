/**
 * The Artwork fields registry: which of an Artwork's record fields a Catalogue
 * can switch, and the per-Kind defaults it starts from.
 *
 * One module owns the whole answer — the togglable keys, the two fixed ones,
 * the per-Kind defaults, the resolver and the normaliser — so the server that
 * refuses a disabled field and the client that renders the form cannot
 * disagree about what a Catalogue records. Pure by construction: no React, no
 * database, no API.
 *
 * Availability is the thirteenth key, and the last one: its four states are the
 * same on every Kind, so whether a Catalogue records a market state is a choice
 * like any other field's.
 */

import type { ArtworkFormValues } from "./schemas/artwork";
import type { CatalogueKind } from "./types";

/**
 * The fields that are always recorded and are never switches. Title and Artist
 * Name are a work's identity: lists, addresses and the PDF name it by them.
 */
export const ARTWORK_FIXED_FIELDS = ["title", "artistName"] as const;

export type ArtworkFixedField = (typeof ARTWORK_FIXED_FIELDS)[number];

/**
 * The togglable field keys, derived from the Artwork form's values with the
 * fixed fields and `status` (the Draft/Published stamp, not a record field)
 * excluded. A field added to the form therefore joins this type automatically,
 * and the exhaustiveness guard below fails the build until it is placed in
 * `ARTWORK_FIELD_KEYS`.
 */
export type ArtworkFieldKey = Exclude<
  keyof ArtworkFormValues,
  ArtworkFixedField | "status"
>;

/** The thirteen keys, in the order the registry and the settings card read them. */
export const ARTWORK_FIELD_KEYS = [
  "serie",
  "dateOfCreation",
  "medium",
  "dimensions",
  "editions",
  "acquisitionDate",
  "acquisitionPrice",
  "placeOfOrigin",
  "provenance",
  "notes",
  "condition",
  "currentValue",
  "availability",
] as const satisfies readonly ArtworkFieldKey[];

// Every togglable field is listed exactly once. The first direction catches a
// form field added and not placed here; the second catches a key this list
// carries and the form does not.
type EveryArtworkFieldIsListed =
  Exclude<ArtworkFieldKey, (typeof ARTWORK_FIELD_KEYS)[number]> extends never
    ? true
    : never;
type EveryListedFieldIsAnArtworkField =
  (typeof ARTWORK_FIELD_KEYS)[number] extends ArtworkFieldKey ? true : never;
const everyArtworkFieldIsListed: EveryArtworkFieldIsListed = true;
const everyListedFieldIsAnArtworkField: EveryListedFieldIsAnArtworkField = true;
void everyArtworkFieldIsListed;
void everyListedFieldIsAnArtworkField;

/**
 * The product's sentence-case label for every togglable field, keyed by the
 * registry so a newly added field cannot ship without one. The settings card
 * and the refusal's prose read the same words, so a field is not called one
 * thing where it is chosen and another where a save is refused.
 */
export const ARTWORK_FIELD_LABELS: Readonly<Record<ArtworkFieldKey, string>> = {
  serie: "Serie",
  dateOfCreation: "Date of creation",
  medium: "Medium",
  dimensions: "Dimensions",
  editions: "Editions",
  acquisitionDate: "Acquisition date",
  acquisitionPrice: "Acquisition price",
  placeOfOrigin: "Place of origin",
  provenance: "Provenance",
  notes: "Notes",
  condition: "Condition",
  currentValue: "Current price",
  availability: "Availability",
};

/**
 * A Catalogue's choices, as stored: an entry means the member decided this
 * field, and an absent key means "follow the Kind's default". The map is sparse
 * by design — a full snapshot could not survive a later change to the defaults
 * without overwriting choices nobody made.
 */
export type ArtworkFieldDeviations = Partial<Record<ArtworkFieldKey, boolean>>;

/** Every field's state, resolved: what a form renders and a save may carry. */
export type ArtworkFieldStates = Record<ArtworkFieldKey, boolean>;

/**
 * The per-Kind defaults start minimal: Date of creation, Medium, Dimensions and
 * Notes are on everywhere, because they are what makes a work legible, and
 * every other field is one switch away in Settings. Serie, Editions, Condition
 * and Current price start off on every Kind; expansion is the member's move,
 * and an untouched Catalogue follows a later default change.
 *
 * The Kind adds its own shape. A Portfolio drops the market fields a solo artist
 * rarely records for their own work — the acquisition pair, place of origin,
 * provenance and availability. A Collection keeps the acquisition pair and the
 * two fields that give a bought work its history, while Availability starts off
 * (a collector records what they own, not a market state). An Inventory records
 * what the gallery represents: place of origin, provenance and Availability,
 * but not the acquisition pair, because on consignment it never held title.
 *
 * `Record<ArtworkFieldKey, boolean>` makes a field the registry forget a build
 * error, and `Record<CatalogueKind, …>` makes a fourth Kind one too.
 */
export const ARTWORK_FIELD_DEFAULTS: Readonly<
  Record<CatalogueKind, Readonly<ArtworkFieldStates>>
> = {
  portfolio: {
    serie: false,
    dateOfCreation: true,
    medium: true,
    dimensions: true,
    editions: false,
    acquisitionDate: false,
    acquisitionPrice: false,
    placeOfOrigin: false,
    provenance: false,
    notes: true,
    condition: false,
    currentValue: false,
    availability: false,
  },
  collection: {
    serie: false,
    dateOfCreation: true,
    medium: true,
    dimensions: true,
    editions: false,
    acquisitionDate: true,
    acquisitionPrice: true,
    placeOfOrigin: true,
    provenance: true,
    notes: true,
    condition: false,
    currentValue: false,
    availability: false,
  },
  inventory: {
    serie: false,
    dateOfCreation: true,
    medium: true,
    dimensions: true,
    editions: false,
    acquisitionDate: false,
    acquisitionPrice: false,
    placeOfOrigin: true,
    provenance: true,
    notes: true,
    condition: false,
    currentValue: false,
    availability: true,
  },
};

export interface ArtworkFieldResolution {
  /** Every field's resolved state: the set of fields a form renders. */
  enabled: ArtworkFieldStates;
  /** True when the stored map names at least one real deviation. */
  customised: boolean;
}

/**
 * What a Catalogue records, given its Kind and its stored deviations.
 *
 * An explicit entry beats the Kind's default in both directions — the map can
 * say "on although the default is off", which a disabled list could not — and
 * an entry that merely restates the default is not a customisation.
 */
export function resolveArtworkFields(
  kind: CatalogueKind,
  deviations: ArtworkFieldDeviations | null | undefined,
): ArtworkFieldResolution {
  const defaults = ARTWORK_FIELD_DEFAULTS[kind];
  const enabled = {} as ArtworkFieldStates;
  for (const field of ARTWORK_FIELD_KEYS) {
    enabled[field] = deviations?.[field] ?? defaults[field];
  }
  return {
    enabled,
    customised: normaliseArtworkFields(kind, deviations) !== null,
  };
}

/**
 * The map the write path stores: entries equal to the Kind's default are
 * dropped, and an empty result is `null` — the state of a Catalogue that never
 * deviated. Normalising on the way in is what makes "back to defaults" a place
 * the member lands rather than an action they must find.
 */
export function normaliseArtworkFields(
  kind: CatalogueKind,
  deviations: ArtworkFieldDeviations | null | undefined,
): ArtworkFieldDeviations | null {
  const defaults = ARTWORK_FIELD_DEFAULTS[kind];
  const normalised: ArtworkFieldDeviations = {};
  for (const field of ARTWORK_FIELD_KEYS) {
    const choice = deviations?.[field];
    if (choice !== undefined && choice !== defaults[field]) {
      normalised[field] = choice;
    }
  }
  return Object.keys(normalised).length === 0 ? null : normalised;
}

/**
 * The togglable fields a save payload names that the Catalogue does not
 * record. The one predicate the create and the update routes share, so the
 * two refusals cannot disagree about which key count as a field.
 *
 * Derived from the registry rather than a second list: a field added to
 * `ARTWORK_FIELD_KEYS` is covered by construction. A key is named when it is
 * present with any value, `null` included — a clear names the field as surely
 * as a set does — while an absent key leaves the field alone. Fixed fields,
 * the status and any other key outside the registry are not togglable and
 * never answer.
 */
export function disabledArtworkFieldsIn(
  enabled: ArtworkFieldStates,
  payload: Partial<Record<ArtworkFieldKey, unknown>>,
): ArtworkFieldKey[] {
  return ARTWORK_FIELD_KEYS.filter(
    (field) => !enabled[field] && payload[field] !== undefined,
  );
}
