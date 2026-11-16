// What a population is, in one place.
//
// "Photos" and "documents" differ in more than their path segment: the table an
// entry id has to be free in, the variants process generates, the final-key
// shape, and whether a non-image is even admissible. Each of those was a
// question a different module answered with its own ternary — several of them,
// and one of the answers (`parentKind` in the proxy) had to re-derive the
// singular the rows use from the plural the key parser speaks.
//
// The byte cap and the accepted types are deliberately NOT here: they are the
// shared `checkDeclaredUpload` guard's facts (`packages/shared/src/caps.ts`), so
// presign, process and the form all read one table rather than a copy per
// population record. This module keeps what the API itself branches on.
//
// The rows and the variant table record the SINGULAR (`parentKind`), the keys
// and the wire use the PLURAL, and both are the domain's names for the same
// population. `kindOf` is the one place that translates between them; the
// record is keyed by the singular because that is the name the route builder,
// the save and the promotion all hold.

import { artworkDocuments, artworkPhotos } from "@arcula/db";
import {
  finalDocumentKey,
  finalDocumentPrefix,
  finalPhotoKey,
  finalPhotoPrefix,
  type MediaPopulation,
} from "./keys";
import {
  DOCUMENT_VARIANT_SPECS,
  IMAGE_VARIANTS,
  type ImageVariantSpec,
} from "./variants";

/** The singular: what `parentKind` and the variant table record. */
export type PopulationKind = "photo" | "document";

export interface Population {
  /** The path segment, and the artwork field the entries serialize into. */
  population: MediaPopulation;
  /** The table an entry id has to be free in. */
  table: typeof artworkPhotos | typeof artworkDocuments;
  /** What process generates for an image of this population. */
  specs: readonly ImageVariantSpec[];
  /** A non-image is inadmissible (photos). A document may be a `file`. */
  imagesOnly: boolean;
  finalKey: (
    namespaceId: string,
    catalogueId: string,
    artworkId: string,
    entryId: string,
    key: string,
    ext: string,
  ) => string;
  finalPrefix: (
    namespaceId: string,
    catalogueId: string,
    artworkId: string,
    entryId: string,
  ) => string;
}

export const POPULATIONS: Record<PopulationKind, Population> = {
  photo: {
    population: "photos",
    table: artworkPhotos,
    specs: IMAGE_VARIANTS,
    imagesOnly: true,
    finalKey: finalPhotoKey,
    finalPrefix: finalPhotoPrefix,
  },
  document: {
    population: "documents",
    table: artworkDocuments,
    specs: DOCUMENT_VARIANT_SPECS,
    imagesOnly: false,
    finalKey: finalDocumentKey,
    finalPrefix: finalDocumentPrefix,
  },
};

/** The singular, for the callers holding the plural the key parser speaks. */
export const kindOf = (population: MediaPopulation): PopulationKind =>
  population === "photos" ? "photo" : "document";

/** Both kinds, for the places that sweep the two in a fixed order. */
export const POPULATION_KINDS = ["photo", "document"] as const;
