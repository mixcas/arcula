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
 * The one thing documents *do* share with photos is the image half: a document
 * that is an image gets generated variants, and those are rendered by the same
 * pipeline. So the variant subset is defined next to the full table in
 * `imageVariants.ts`, and the pipeline is shared rather than duplicated.
 */

import { photoUrl } from "./artworkPhotos";
import {
  ACCEPTED_IMAGE_TYPES,
  DOCUMENT_IMAGE_VARIANT_KEYS,
  IMAGE_VARIANTS,
  isAcceptedImageType,
} from "./imageVariants";
import type { ImageVariantSpec } from "./imageVariants";
import type { ArtworkDocument, ArtworkDocumentImage } from "@/types";

/** Hard cap on documents per artwork. Enforced in the form, not by the rules. */
export const MAX_ARTWORK_DOCUMENTS = 10;

/**
 * Per-file size cap for a document.
 *
 * Deliberately larger than `MAX_IMAGE_BYTES`. A scanned catalogue raisonné or a
 * high-resolution condition report is a normal thing to attach to a work and is
 * routinely larger than a photograph, and 10 MiB would reject it in the form
 * with no way to proceed.
 *
 * Must stay in step with `acceptableDocumentUpload` in `storage.rules`. The rule
 * reads `size <= 25 * 1024 * 1024`, so this is a ceiling the client may hit
 * exactly rather than one the server rejects a byte under.
 */
export const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

/**
 * The types the form accepts, for the Dropzone `accept` map.
 *
 * Images plus PDF, and nothing else. The narrower this list is, the less the
 * rules have to allow and the fewer things a download URL can hand a browser to
 * render — SVG and HTML are the two that matter here, because both execute in
 * the storage origin when navigated to directly, and neither appears below.
 *
 * That is a real control, not a complete one: `contentType` is supplied by the
 * client and is forgeable, so what the rules can actually bind the declared type
 * to is the filename. The extension allowlist in `storage.rules` is that check.
 */
export const ACCEPTED_DOCUMENT_TYPES: Record<string, string[]> = {
  ...ACCEPTED_IMAGE_TYPES,
  "application/pdf": [".pdf"],
};

/** True when the browser-reported type is one the form accepts. */
export const isAcceptedDocumentType = (type: string | undefined): boolean =>
  type !== undefined && type in ACCEPTED_DOCUMENT_TYPES;

/** True for a type that gets variants rather than an icon. */
export const isDocumentImageType = (type: string | undefined): boolean =>
  isAcceptedImageType(type);

/**
 * The variant specs a document image is rendered into.
 *
 * A subset of the photo table rather than a second table: the geometry stays
 * defined in one place, and `isDocumentName` in `storage.rules` already permits
 * the full key list, so narrowing the set needs no rule change.
 */
export const documentImageSpecs = (): ImageVariantSpec[] => {
  const wanted = new Set<string>(DOCUMENT_IMAGE_VARIANT_KEYS);
  return IMAGE_VARIANTS.filter((spec) => wanted.has(spec.key));
};

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
 * A `photoUrl` ladder, exactly as photos use, so a document written by an older
 * build — or one whose variant failed to generate — still renders something.
 * The argument is a `Pick` because neither `order` nor `id` has anything to do
 * with choosing a URL, and requiring them would mean documents carrying a field
 * they cannot maintain honestly.
 */
export const documentImageUrl = (document: ArtworkDocument): string | null =>
  isDocumentImage(document) ? photoUrl(document, "square_sm") : null;

/**
 * The file extension of a name, lowercased and without the dot.
 *
 * Off the *name*, not the stored content type, because the badge is there to
 * tell the user which file they picked. A `.pdf` that arrived as
 * `application/octet-stream` is still a PDF as far as they are concerned, and an
 * empty string is handled at the call site rather than here.
 */
export const fileExtension = (name: string): string => {
  const dot = name.lastIndexOf(".");
  // A dot with nothing after it is a trailing dot, not an extension, and a
  // leading one is a dotfile rather than a named file.
  if (dot < 1 || dot === name.length - 1) {
    return "";
  }
  return name.slice(dot + 1).toLowerCase();
};

/**
 * The extensions a document object may be stored under.
 *
 * A literal mirror of the alternation in `isDocumentName` in `storage.rules`,
 * and deliberately *not* derived from `ACCEPTED_DOCUMENT_TYPES` above: that map
 * also lists `.jpeg`, which the rules do not permit as a stored extension. The
 * difference is harmless for images, whose name comes from their reported type
 * and is therefore always `jpg`, but the point of this list is to be the same
 * four values the server checks, so it is written out.
 *
 * This is the only thing standing between a picked file and a 403, so it is
 * worth being explicit about what it is not: a fallback extension of `bin` — what
 * `extensionFor` returns for any type it does not know — is *not* in this list
 * and never could be. `contentType` is client-supplied and forgeable, so the
 * allowlist is the only thing binding the declared type to the name an object is
 * written under; a name that can be anything stops binding anything, and an
 * uploaded SVG or HTML file navigated to directly executes in the storage
 * origin. Derive honestly, and reject what cannot be derived.
 */
export const DOCUMENT_EXTENSIONS = ["webp", "jpg", "png", "pdf"] as const;

export type DocumentExtension = (typeof DOCUMENT_EXTENSIONS)[number];

/** Whether a value is one the storage rules will accept as a stored extension. */
export const isDocumentExtension = (
  value: string,
): value is DocumentExtension =>
  (DOCUMENT_EXTENSIONS as readonly string[]).includes(value);

/**
 * The extension a document's stored object carries, or null if it has none.
 *
 * Two sources, in order, because neither is sufficient alone:
 *
 * 1. The filename's own extension, when the rules would accept it. A PDF is a
 *    PDF because of what it is called, and `Get_Started_With_Smallpdf.pdf` is the
 *    only honest description of those bytes.
 * 2. The reported type, for the one case the name cannot cover — a file with no
 *    extension in its name at all, which the browser cannot be asked about and
 *    which therefore has to be taken on the type's word.
 *
 * Images are not resolved here. They go up through `uploadImage`, which names
 * each object from the *type* rather than the filename, so that a `.jpg` which
 * is really a PNG is stored as the PNG it is. That is the property worth
 * keeping, and asking this function to also handle them would put the two
 * policies side by side where one of them would have to lose.
 */
export const documentExtension = (
  name: string,
  type: string,
): DocumentExtension | null => {
  const byName = fileExtension(name);
  if (byName !== "") {
    // A name that claims an extension is taken at its word, and if that word is
    // not one the rules permit there is nothing to fall back to. This is the
    // case that makes the type fallback below narrow rather than a loophole: a
    // `payload.html` reported as `application/pdf` is refused, because a file
    // that calls itself HTML is not a PDF however the client typed it.
    return isDocumentExtension(byName) ? byName : null;
  }
  // Only a name with no extension at all, where the name cannot answer and the
  // type is all there is. The single non-image type the form accepts has exactly
  // one honest extension.
  return type === "application/pdf" ? "pdf" : null;
};

/**
 * Whether the stored documents differ from a candidate list, by id.
 *
 * The Edit page writes `documents` only when this is true, for the same reason
 * photos do it: `updateDoc` merges, so an absent key leaves the stored array
 * alone rather than rewriting every storage URL on a save that only touched the
 * title.
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
