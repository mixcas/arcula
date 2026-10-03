/**
 * The document state behind the Add and Edit Artwork forms.
 *
 * ## Why this is separate from `useArtworkPhotos`
 *
 * Both lists live outside `useForm` for the same reason — a `File` is not
 * serialisable, is not a Zod value, and would be dropped when uncontrolled
 * inputs are remounted on `initialize` — so that part is not a reason to
 * duplicate anything.
 *
 * What is different is everything after that. Photos have a sequence and a
 * primary thumbnail, so they carry `order`, a reorder, a make-primary and the
 * `reindexPhotos` invariant that keeps the two in step. Documents have none of
 * those, and a hook that offered them would be offering operations that silently
 * do nothing. A shared generic `useFileList` with a config object was the other
 * option; the configuration would have been most of the code, and the parts it
 * switched on are the parts a reader needs to see side by side to tell them
 * apart.
 *
 * The object-URL lifecycle *is* shared logic in spirit, and it is duplicated
 * here deliberately: it is twenty lines, it is the part that leaks if it is
 * wrong, and the two lists release different sets of URLs. Both copies carry the
 * same comment about why.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { processImages, type ProcessedImage } from "@/utils/imageProcessing";
import { JPEG_TYPE } from "@/utils/imageRender";
import {
  MAX_ARTWORK_DOCUMENTS,
  documentExtension,
  documentImageSpecs,
  documentsChanged,
  isAcceptedDocumentType,
  isDocumentImageType,
  sortDocuments,
} from "@/utils/artworkDocuments";
import type { PendingDocument } from "@/services/documentService";
import type {
  ArtworkDocument,
  ArtworkDocumentImage,
  ImageVariant,
} from "@/types";

/**
 * One entry in the form's document list.
 *
 * A discriminated union for the same reason `PhotoEntry` is one: "has this been
 * uploaded yet" decides whether there is a document to save or a file to upload
 * first, and two optionals would mean re-checking the same condition at every
 * call site.
 */
export type DocumentEntry =
  | {
      key: string;
      status: "stored";
      document: ArtworkDocument;
    }
  | {
      key: string;
      status: "pending";
      file: File;
      /** Object URL for the local original. Revoked on removal or unmount. */
      previewUrl: string;
      /**
       * A transient stand-in `ArtworkDocument`, so a document that has not been
       * uploaded yet renders and opens through exactly the same path as one that
       * has. Built from blobs for an image, so the tile shows the WebP that will
       * be stored rather than the `.jpg` picked from disk. `null` until
       * processing lands — an image shows a spinner in the meantime, and a
       * non-image never waits, because there is nothing to process.
       */
      preview: ArtworkDocument | null;
      /**
       * The generated variants, kept.
       *
       * This is the whole reason the hook exists rather than a `File` list: a
       * save uploads these directly instead of generating them a second time.
       */
      processed: ProcessedImage | null;
    };

export interface AddDocumentsResult {
  added: DocumentEntry[];
  /** Files rejected, with the reason. Shown to the user; never swallowed. */
  rejected: Array<{ file: File; reason: string }>;
}

let keyCounter = 0;
const nextKey = (): string => {
  keyCounter += 1;
  return `document-${keyCounter}`;
};

/**
 * Revoke every object URL a pending entry owns, and forget them.
 *
 * Not just the picked file's: a pending image also holds object URLs for the
 * generated variants its tile displays, and each of those pins a blob. Revoking
 * only the file leaves the rest alive for the life of the page — a leak the
 * user triggers by removing a document, in a form meant to be used repeatedly.
 *
 * A plain function over the tracking set rather than a hook: it touches no
 * component state, so there is nothing to memoise and nothing to depend on.
 */
const revokeEntryUrls = (entry: DocumentEntry, tracked: Set<string>): void => {
  if (entry.status === "stored") {
    return;
  }
  for (const url of [
    entry.previewUrl,
    ...(entry.preview
      ? "variants" in entry.preview
        ? entry.preview.variants.map((variant) => variant.url)
        : []
      : []),
  ]) {
    URL.revokeObjectURL(url);
    tracked.delete(url);
  }
};

/**
 * Assemble a stand-in `ArtworkDocument` for a file that has not been uploaded.
 *
 * Two shapes, because the union is the point: a non-image needs nothing built
 * for it — the object URL *is* the document — while an image is built from its
 * generated variants so it renders and opens through the same `photoUrl` ladder
 * as one already in Storage. That is also what makes the tile show the WebP that
 * will be stored rather than the `.jpg` that was picked from disk.
 *
 * The variant URLs are registered for revocation with everything else, because
 * an object URL pins its blob in memory.
 */
const transientPreview = (
  file: File,
  fileUrl: string,
  image: ProcessedImage | null,
  register: (url: string) => void,
): ArtworkDocument => {
  const contentType = file.type || "application/pdf";

  if (!image) {
    return {
      // Deliberately empty: this document is not in Firestore, and an id here
      // would be a lie the save path could act on.
      id: "",
      kind: "file",
      name: file.name,
      size: file.size,
      contentType,
      original: { url: fileUrl, size: file.size, contentType },
    };
  }

  const originalType = image.file.type || JPEG_TYPE;
  const variants: ImageVariant[] = image.variants.map((variant) => {
    const url = URL.createObjectURL(variant.blob);
    register(url);
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
    id: "",
    kind: "image",
    name: image.file.name,
    size: image.file.size,
    contentType: originalType,
    width: image.width,
    height: image.height,
    original: {
      url: fileUrl,
      size: image.file.size,
      contentType: originalType,
    },
    variants,
  } satisfies ArtworkDocumentImage;
};

export interface UseArtworkDocumentsOptions {
  /** The documents already on the artwork, when editing. */
  initialDocuments?: ArtworkDocument[];
  onError?: (message: string) => void;
}

export const useArtworkDocuments = ({
  initialDocuments = [],
  onError,
}: UseArtworkDocumentsOptions = {}) => {
  // The stored documents as loaded, kept apart from the working list so a save
  // can tell "the user removed one" from "nothing about them changed" and leave
  // the field alone in the second case.
  const [loaded, setLoaded] = useState<ArtworkDocument[]>(() =>
    sortDocuments(initialDocuments),
  );
  const [entries, setEntries] = useState<DocumentEntry[]>(() =>
    sortDocuments(initialDocuments).map((document) => ({
      key: nextKey(),
      status: "stored" as const,
      document,
    })),
  );
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // Live preview URLs, so unmount can revoke every one of them. Held in a ref
  // because the cleanup effect must see the current list without re-running on
  // every edit.
  const previewUrls = useRef<Set<string>>(new Set());

  useEffect(
    () => () => {
      for (const url of previewUrls.current) {
        URL.revokeObjectURL(url);
      }
      previewUrls.current = new Set();
    },
    [],
  );

  /** Add files, rejecting anything over the cap, of the wrong type, or too big. */
  const addFiles = useCallback(
    async (files: File[]): Promise<AddDocumentsResult> => {
      const rejected: AddDocumentsResult["rejected"] = [];
      const accepted: File[] = [];

      // Counted against the cap as we go, so a drop of twenty files with a
      // limit of ten keeps the first ten rather than rejecting all twenty.
      let room = MAX_ARTWORK_DOCUMENTS - entries.length;

      for (const file of files) {
        if (room <= 0) {
          rejected.push({
            file,
            reason: `Only ${MAX_ARTWORK_DOCUMENTS} documents per artwork`,
          });
          continue;
        }
        if (
          !isAcceptedDocumentType(file.type) ||
          // The type is what the form accepts; the *extension* is what the
          // object gets named after, and `isDocumentName` in `storage.rules`
          // rejects anything outside its four. Both have to hold, because a name
          // the rules will not accept is not a degraded upload but a 403 at save
          // time, with no way for the user to act on a console error.
          documentExtension(file.name, file.type) === null
        ) {
          rejected.push({ file, reason: "Not a supported file type" });
          continue;
        }
        accepted.push(file);
        room -= 1;
      }

      if (accepted.length === 0) {
        return { added: [], rejected };
      }

      const added: DocumentEntry[] = accepted.map((file) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrls.current.add(previewUrl);
        return {
          key: nextKey(),
          status: "pending" as const,
          file,
          previewUrl,
          preview: null,
          processed: null,
        };
      });

      setEntries((current) => [...current, ...added]);

      // Only the images go through the pipeline. A PDF is uploaded as it was
      // picked — there is nothing to resize, and running it through a decoder
      // would reject a perfectly good file for having no pixels.
      const images = accepted.filter((file) => isDocumentImageType(file.type));
      const register = (url: string) => previewUrls.current.add(url);

      // Everything non-image is ready immediately, so the list is usable while a
      // large image is still encoding rather than blocked behind it.
      setEntries((current) =>
        current.map((entry) =>
          entry.status === "pending" &&
          !isDocumentImageType(entry.file.type) &&
          entry.preview === null
            ? {
                ...entry,
                preview: transientPreview(
                  entry.file,
                  entry.previewUrl,
                  null,
                  register,
                ),
              }
            : entry,
        ),
      );

      let processed: ProcessedImage[] = [];
      if (images.length > 0) {
        setProcessing(true);
        setProgress({ done: 0, total: images.length });
        try {
          processed = await processImages(
            images,
            (done, total) => setProgress({ done, total }),
            // Two variants, not four: square_lg and medium only ever render on
            // the public collection grid, and a document is never public.
            documentImageSpecs(),
          );
        } catch (error) {
          console.error("Error processing document images:", error);
          onError?.("The images could not be prepared for upload.");
        } finally {
          setProcessing(false);
          setProgress(null);
        }
      }

      // An image that could not be decoded cannot be uploaded, so it leaves the
      // list rather than sitting there looking fine and failing at save — where
      // the failure would be reported as a failed save rather than a bad file.
      const byFile = new Map(processed.map((image) => [image.file, image]));
      const ready = new Map<string, DocumentEntry>();
      for (const entry of added) {
        if (entry.status !== "pending") {
          continue;
        }
        const result = byFile.get(entry.file);
        if (!isDocumentImageType(entry.file.type)) {
          ready.set(entry.key, {
            ...entry,
            preview:
              entry.preview ??
              transientPreview(entry.file, entry.previewUrl, null, register),
          });
          continue;
        }
        if (result) {
          ready.set(entry.key, {
            ...entry,
            processed: result,
            preview: transientPreview(
              entry.file,
              entry.previewUrl,
              result,
              register,
            ),
          });
          continue;
        }
        revokeEntryUrls(entry, previewUrls.current);
        rejected.push({
          file: entry.file,
          reason: "This file could not be read as an image",
        });
      }

      const addedKeys = new Set(added.map((entry) => entry.key));
      setEntries((current) =>
        current.flatMap((entry) => {
          const resolved = ready.get(entry.key);
          if (resolved) {
            return [resolved];
          }
          // One of ours that failed: drop it. Anything else is untouched, which
          // includes a document the user removed while the batch was running.
          return addedKeys.has(entry.key) ? [] : [entry];
        }),
      );

      return { added: [...ready.values()], rejected };
    },
    [entries.length, onError],
  );

  /** Remove one document, revoking its object URLs and reporting a stored id. */
  const remove = useCallback((key: string): string | null => {
    let removedId: string | null = null;
    setEntries((current) =>
      current.filter((entry) => {
        if (entry.key !== key) {
          return true;
        }
        if (entry.status === "stored") {
          removedId = entry.document.id;
        } else {
          revokeEntryUrls(entry, previewUrls.current);
        }
        return false;
      }),
    );
    return removedId;
  }, []);

  /** The stored documents still referenced by the working list. */
  const remainingStoredIds = useMemo(
    () =>
      entries.flatMap((entry) =>
        entry.status === "stored" ? [entry.document.id] : [],
      ),
    [entries],
  );

  /** Documents the user removed, so their objects can be swept on save. */
  const removedStoredIds = useMemo(() => {
    const remaining = new Set(remainingStoredIds);
    return loaded.flatMap((document) =>
      remaining.has(document.id) ? [] : [document.id],
    );
  }, [loaded, remainingStoredIds]);

  /**
   * Everything awaiting upload, in list order, tagged with what it is.
   *
   * A plain projection rather than a promise, which is the point: an image's work
   * was done when the file was added, so a save has nothing left to compute. The
   * tag is the union `documentService` branches on, so the two stay in step
   * without either side inspecting a MIME type.
   */
  const pendingUploads = useMemo<PendingDocument[]>(
    () =>
      entries.flatMap((entry): PendingDocument[] => {
        if (entry.status !== "pending") {
          return [];
        }
        return entry.processed
          ? [{ kind: "image", image: entry.processed }]
          : [{ kind: "file", file: entry.file }];
      }),
    [entries],
  );

  /**
   * Whether the documents differ from what was loaded.
   *
   * A set comparison, not photos' ordered one: this list has no sequence, so
   * removing a document is a change and reordering the UI is not. The comparison
   * itself lives in `documentsChanged` and is unit-tested there — inlined here
   * it would have been the second place for the same rule to live, and the
   * second place is the one that drifts.
   */
  const dirty = useMemo(
    () =>
      documentsChanged(
        loaded,
        entries.flatMap((entry) =>
          entry.status === "stored" ? [entry.document] : [],
        ),
      ),
    [entries, loaded],
  );

  /**
   * The document list, once the pending ones uploaded.
   *
   * Walks the working list rather than concatenating. The obvious version —
   * `uploaded.push(...stored)` — silently puts every newly added document at
   * the front, which is invisible for photos and merely wrong here; walking the
   * list is what keeps the order the user sees the order that is saved.
   *
   * `uploaded` is in `pendingUploads` order, which is entry order, so the two
   * line up position for position.
   */
  const mergeUploaded = useCallback(
    (uploaded: ArtworkDocument[]): ArtworkDocument[] => {
      let next = 0;
      return entries.flatMap((entry) => {
        if (entry.status === "stored") {
          return [entry.document];
        }
        const document = uploaded[next];
        next += 1;
        return document ? [document] : [];
      });
    },
    [entries],
  );

  /**
   * Commit the list.
   *
   * Returns the documents to store, or `null` when nothing about them changed
   * and the caller should leave the field out of the update entirely — `updateDoc`
   * merges, so an absent key leaves the stored array alone rather than rewriting
   * every storage URL on a save that only touched the title.
   */
  const commit = useCallback((): ArtworkDocument[] | null => {
    if (!dirty) {
      return null;
    }
    return entries.flatMap((entry) =>
      entry.status === "stored" ? [entry.document] : [],
    );
  }, [dirty, entries]);

  /** Re-seed from a freshly loaded artwork, e.g. after a load completes. */
  const hydrate = useCallback((documents: ArtworkDocument[]) => {
    const sorted = sortDocuments(documents);
    setLoaded(sorted);
    setEntries(
      sorted.map((document) => ({
        key: nextKey(),
        status: "stored" as const,
        document,
      })),
    );
  }, []);

  return {
    entries,
    count: entries.length,
    processing,
    progress,
    dirty,
    pendingUploads,
    removedStoredIds,
    hasRoom: entries.length < MAX_ARTWORK_DOCUMENTS,
    mergeUploaded,
    addFiles,
    remove,
    commit,
    hydrate,
  };
};

export type UseArtworkDocuments = ReturnType<typeof useArtworkDocuments>;
