/**
 * Reading and classifying helpers for `Artwork.documents`.
 *
 * ## Why this is not `artworkPhotos.ts`
 *
 * Photos have a sequence and a primary thumbnail. Documents have neither: there
 * is nothing to reorder and nothing for index 0 to mean, so there is no `order`
 * field to keep honest against the array position — which is the entire reason
 * `artworkPhotos.ts` reads the way it does. Sharing a module would mean either
 * pretending documents are ordered or threading a flag through every helper.
 *
 * What this module does not do anymore: name a document's stored object. The
 * server mints the object key from the content type it decoded (plan §6), so
 * the client has no extension to choose and no allowlist to keep in step with
 * the rules — the accepted-type checks below are the form's only gate, and the
 * stage route enforces the same lists at the boundary.
 */

import {
  isAcceptedImageType,
  photoUrl,
  type ArtworkDocument,
  type ArtworkDocumentImage,
} from "@arcula/shared";
import { ACCEPTED_DOCUMENT_TYPES } from "@arcula/shared";

// The caps (`MAX_ARTWORK_DOCUMENTS`, `MAX_DOCUMENT_BYTES`) live in
// `@arcula/shared/src/caps.ts`, shared by every side that enforces them; the
// forms import them from there.

/** True when the browser-reported type is one the form accepts. */
export const isAcceptedDocumentType = (type: string | undefined): boolean =>
  type !== undefined && type in ACCEPTED_DOCUMENT_TYPES;

/** True for a type that gets variants rather than an icon. */
export const isDocumentImageType = (type: string | undefined): boolean =>
  isAcceptedImageType(type);

/**
 * The stored documents, defensively.
 *
 * Artworks written before this field existed have no `documents` key at all, and
 * a stored array is trusted no more than any other stored data — so a reader
 * must not have to know either.
 *
 * Order is array order, left alone. There is nothing to sort by.
 */
export const sortDocuments = (
  documents: ArtworkDocument[] | undefined,
): ArtworkDocument[] => (Array.isArray(documents) ? documents : []);

/** Narrow an entry to the image variant of the union. */
export const isDocumentImage = (
  document: ArtworkDocument,
): document is ArtworkDocumentImage => document.kind === "image";

/**
 * The image to render for an entry, or null for a non-image.
 *
 * The `square_sm` variant is the only one a document tile ever draws, so it is
 * named here rather than taking a parameter: a function whose only caller
 * passes one constant is a parameter nobody can change anyway.
 */
export const documentImageUrl = (document: ArtworkDocument): string | null =>
  isDocumentImage(document) ? photoUrl(document, "square_sm") : null;

/**
 * Whether the stored documents differ from a candidate list, by id.
 *
 * The Edit save sends `documents` only when this is true: a patch that leaves
 * the key out leaves the stored set alone, and re-sending it would rewrite
 * every object for no change.
 *
 * A set comparison rather than photos' ordered one, because documents have no
 * sequence — reordering the list in the UI is not a change worth a write.
 */
export const documentsChanged = (
  stored: ArtworkDocument[] | undefined,
  candidate: ArtworkDocument[],
): boolean => {
  const before = new Set(sortDocuments(stored).map((entry) => entry.id));
  const after = new Set(candidate.map((entry) => entry.id));
  return before.size !== after.size || [...after].some((id) => !before.has(id));
};
