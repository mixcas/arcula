/**
 * The staged-media operations of the service layer (Phase 4 S3, plan §6).
 *
 * A file that lands in a form is PUT to staging the moment it is added —
 * `stage` — and the server generates its display variants on demand —
 * `process` — so the form never decodes or resizes a byte. Neither call
 * touches the artwork's rows: the entries only become rows in the save
 * transaction, which is why staging needs only collection ownership, not an
 * existing artwork. An entry the form drops is `discard`ed; a save that
 * fails after promoting its entries leaves the final objects in place, and
 * that residual is the sweep's job (plan §6), not this module's.
 *
 * The methods come in photo/document pairs rather than one parameterised
 * call: the two populations have different caps and accepted types on the
 * server, and a pair of names makes a wrong population a compile error
 * rather than a 400 that the form would have to explain.
 */

import type { ImageVariant } from "@arcula/shared";
import { apiRequest } from "./api";

/** The stage route's answer: the staged original's metadata and proxy url. */
export interface StagedOriginal {
  entryId: string;
  name: string;
  /** Null for a non-image document (a PDF has no dimensions). */
  width: number | null;
  height: number | null;
  size: number;
  contentType: string;
  url: string;
}

/** The process route's answer: the generated variants; `[]` for a PDF. */
export interface StagedVariants {
  entryId: string;
  variants: ImageVariant[];
}

const base = (
  collectionId: string,
  artworkId: string,
  population: "photos" | "documents",
) => `/api/v1/collections/${collectionId}/artworks/${artworkId}/${population}`;

const stage = async (
  collectionId: string,
  artworkId: string,
  population: "photos" | "documents",
  entryId: string,
  file: File,
): Promise<StagedOriginal> => {
  // The browser sets the multipart content type and boundary; sending the
  // JSON one instead is how the route 400s with "a file field is required".
  const form = new FormData();
  form.append("entryId", entryId);
  form.append("file", file);
  return apiRequest<StagedOriginal>(
    `${base(collectionId, artworkId, population)}/stage`,
    {
      method: "POST",
      form,
    },
  );
};

const process = async (
  collectionId: string,
  artworkId: string,
  population: "photos" | "documents",
  entryId: string,
): Promise<StagedVariants> =>
  apiRequest<StagedVariants>(
    `${base(collectionId, artworkId, population)}/process`,
    { method: "POST", body: { entryId } },
  );

const discard = async (
  collectionId: string,
  artworkId: string,
  population: "photos" | "documents",
  entryId: string,
): Promise<void> => {
  await apiRequest(
    `${base(collectionId, artworkId, population)}/${encodeURIComponent(entryId)}`,
    { method: "DELETE" },
  );
};

export const mediaService = {
  /** PUT the original into staging. Re-runnable for the same entry: the
   *  server discards the previous objects first. */
  stagePhoto: (
    collectionId: string,
    artworkId: string,
    entryId: string,
    file: File,
  ) => stage(collectionId, artworkId, "photos", entryId, file),

  /** Generate the photo's variants. The server owns the geometry and the
   *  encoder; the answer is the truth for what the form renders. */
  processPhoto: (collectionId: string, artworkId: string, entryId: string) =>
    process(collectionId, artworkId, "photos", entryId),

  /** Remove a staged photo entry. Idempotent — nothing to delete answers 200. */
  discardPhoto: (collectionId: string, artworkId: string, entryId: string) =>
    discard(collectionId, artworkId, "photos", entryId),

  /** PUT the original into staging, document flavour (25 MiB, PDFs admitted). */
  stageDocument: (
    collectionId: string,
    artworkId: string,
    entryId: string,
    file: File,
  ) => stage(collectionId, artworkId, "documents", entryId, file),

  /** Generate the variants of a document image; `[]` for a PDF. */
  processDocument: (collectionId: string, artworkId: string, entryId: string) =>
    process(collectionId, artworkId, "documents", entryId),

  /** Remove a staged document entry. Idempotent. */
  discardDocument: (collectionId: string, artworkId: string, entryId: string) =>
    discard(collectionId, artworkId, "documents", entryId),
};
