/**
 * Firebase Storage access for artwork documents.
 *
 * The same conventions as `imageService`: the shared `storage` instance, and
 * `console.error` + `throw` on failure so the caller decides the message. The
 * naming, concurrency and delete sweep come from `artworkFiles`.
 *
 * ## Why the two features have separate services
 *
 * A document is either a processed image or a file that goes up untouched, and
 * the two halves of that branch are what makes it different from a photo — not
 * the storage calls, which are identical. The alternative was one service with a
 * `kind` argument threaded through every function, which hides the branch
 * instead of putting it where it can be read.
 */

import type { FirebaseStorage } from "firebase/storage";
import { storage } from "./firebase";
import {
  artworkFilesPrefix,
  deleteEntries,
  entryPrefix,
  newEntryId,
  objectName,
  uploadAll,
  type UploadOne,
} from "./artworkFiles";
import { extensionFor, type ProcessedImage } from "@/utils/imageProcessing";
import { documentExtension } from "@/utils/artworkDocuments";
import type {
  ArtworkDocument,
  ArtworkDocumentFile,
  ArtworkDocumentImage,
  ImageVariant,
} from "@/types";

/** Where an artwork's documents live. */
const documentsPrefix = (
  userId: string,
  collectionId: string,
  artworkId: string,
): string => artworkFilesPrefix(userId, collectionId, artworkId, "documents");

/** A Firestore-style id, minted without writing anything. */
export const newDocumentId = (): string => newEntryId();

/** One file on its way to Storage. The union is what `upload` branches on. */
export type PendingDocument =
  { kind: "file"; file: File } | { kind: "image"; image: ProcessedImage };

/**
 * Upload one file, untouched.
 *
 * The extension comes from `documentExtension`, which asks the filename first and
 * the reported type only when the name has nothing to say. It does *not* come
 * from `extensionFor`, which is the image helper: that one knows three types and
 * answers `bin` for anything else, and routing a PDF through it produced
 * `{artworkId}_{docId}_original.bin`, which `isDocumentName` rejects — a 403 on
 * every single PDF while images worked fine. A `bin` name is not a degraded
 * upload, it is a denied one, so there is no fallback to reach for.
 *
 * Null is a refusal rather than a guess: `uploadArtworkDocuments` is exported,
 * and a caller who bypassed the form's accept list gets told so instead of
 * discovering it from the server.
 */
const uploadFile = async (
  client: FirebaseStorage,
  prefix: string,
  artworkId: string,
  documentId: string,
  file: File,
): Promise<ArtworkDocumentFile> => {
  const extension = documentExtension(file.name, file.type);
  if (extension === null) {
    // The mutation check: reverting the two lines above to the `extensionFor`
    // form this replaced must turn this suite red, which is the point of the
    // suite existing. `uploadArtworkDocuments` is called from the Add and Edit
    // pages only.
    throw new Error(`Cannot store ${file.name}: unsupported file type.`);
  }
  // Not a guess: the only non-image document this app accepts is a PDF, so when
  // the browser declines to name the type the extension already says what it is.
  const contentType = file.type || "application/pdf";

  const [url] = await uploadAll(client, prefix, [
    {
      blob: file,
      name: objectName(artworkId, documentId, "original", extension),
      contentType,
    },
  ]);

  if (!url) {
    throw new Error("Upload failed.");
  }

  return {
    id: documentId,
    kind: "file",
    name: file.name,
    size: file.size,
    contentType,
    original: { url, size: file.size, contentType },
  };
};

/**
 * Upload one processed image: the original file plus its generated variants.
 *
 * The same shape as a photo's upload, and the reason `isDocumentName` in
 * `storage.rules` allows the full variant key list: an image document writes
 * whatever subset it was given and the rules do not care which.
 */
const uploadImage = async (
  client: FirebaseStorage,
  prefix: string,
  artworkId: string,
  documentId: string,
  image: ProcessedImage,
): Promise<ArtworkDocumentImage> => {
  // Never the requested type but the file's own — a `.jpg` that is really a PNG
  // should be stored as the PNG it is. See the note in imageService.
  const originalType = image.file.type || "image/jpeg";

  const files: UploadOne[] = [
    {
      blob: image.file,
      name: objectName(
        artworkId,
        documentId,
        "original",
        extensionFor(originalType),
      ),
      contentType: originalType,
    },
    ...image.variants.map((variant) => ({
      blob: variant.blob,
      name: objectName(
        artworkId,
        documentId,
        variant.key,
        extensionFor(variant.contentType),
      ),
      contentType: variant.contentType,
    })),
  ];

  const urls = await uploadAll(client, prefix, files);
  const originalUrl = urls[0];
  if (!originalUrl) {
    throw new Error("Upload failed.");
  }

  const variants: ImageVariant[] = image.variants.map((variant, index) => {
    const url = urls[index + 1];
    if (!url) {
      throw new Error("Upload failed.");
    }
    return {
      key: variant.key,
      url,
      width: variant.width,
      height: variant.height,
      size: variant.blob.size,
      contentType: variant.contentType,
    };
  });

  return {
    id: documentId,
    kind: "image",
    name: image.file.name,
    size: image.file.size,
    contentType: originalType,
    width: image.width,
    height: image.height,
    original: {
      url: originalUrl,
      size: image.file.size,
      contentType: originalType,
    },
    variants,
  };
};

export interface UploadDocumentsOptions {
  userId: string;
  collectionId: string;
  artworkId: string;
  documents: PendingDocument[];
  onProgress?: (done: number, total: number) => void;
  /**
   * The Storage instance to write through.
   *
   * A parameter with a default rather than a hardcoded `storage`, for the same
   * reason `Migration.run` takes the `Firestore` it runs against: it lets the
   * rules suite point this at the emulator. That is the only way to test the
   * thing that actually broke — `uploadFile` deriving a name the rules refuse —
   * because every other test of this path either stubs the whole service or
   * hand-writes the name the way the rules expect it. Left hardcoded, that bug
   * shipped with a green suite.
   */
  client?: FirebaseStorage;
}

export const documentService = {
  /**
   * Upload every document, in the given order.
   *
   * A failure part-way through leaves the objects that did upload in place, for
   * the same reason photos do: they are addressed by document id, so a retry
   * overwrites the same names and a half-finished upload costs bytes rather
   * than correctness.
   */
  async uploadArtworkDocuments({
    userId,
    collectionId,
    artworkId,
    documents,
    onProgress,
    client = storage,
  }: UploadDocumentsOptions): Promise<ArtworkDocument[]> {
    try {
      const prefix = documentsPrefix(userId, collectionId, artworkId);
      const uploaded: ArtworkDocument[] = [];

      for (const [index, entry] of documents.entries()) {
        const documentId = newDocumentId();
        uploaded.push(
          entry.kind === "image"
            ? await uploadImage(
                client,
                prefix,
                artworkId,
                documentId,
                entry.image,
              )
            : await uploadFile(
                client,
                prefix,
                artworkId,
                documentId,
                entry.file,
              ),
        );
        onProgress?.(index + 1, documents.length);
      }

      return uploaded;
    } catch (error) {
      console.error("Error uploading artwork documents:", error);
      throw error;
    }
  },

  /**
   * Delete the objects for one or more documents.
   *
   * List-and-filter rather than reconstructing names, so a file whose type the
   * browser did not report — stored under a name derived from its extension —
   * is still found. An empty list is not an error: removing something that was
   * never uploaded should not fail the save that also updates the metadata.
   */
  async deleteArtworkDocuments(
    userId: string,
    collectionId: string,
    artworkId: string,
    documentIds: string[],
  ): Promise<void> {
    try {
      await deleteEntries(
        storage,
        documentsPrefix(userId, collectionId, artworkId),
        documentIds.map((documentId) => entryPrefix(artworkId, documentId)),
      );
    } catch (error) {
      console.error("Error deleting artwork documents:", error);
      throw error;
    }
  },
};
