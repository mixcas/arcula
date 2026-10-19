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
 * server-side reindex that numbers the sequence from array position at save.
 * Documents have none of those: the save compares the two id SETS, because a
 * list with no sequence has nothing to reorder, and a hook that offered a
 * reorder would be offering an operation that silently does nothing.
 *
 * The upload itself the two lists do agree on — the three-file pool, the
 * progress bar, the `.catch(() => {})` discard — and that half is
 * `useUploadPool`. What stays here is the list: which files are admitted,
 * what they cost against the cap, how an entry is shaped, and what the save
 * sends. One `useFileList` with a config object was the other option; the
 * configuration would have been most of the code, and the parts it switched
 * on are the parts a reader needs to see side by side to tell them apart.
 *
 * ## What changed when the pipeline moved server-side
 *
 * An attachment that lands in the form is PUT to staging **the moment it is
 * added** — not at save — and the server generates an image's variants on
 * demand, so there is no object-URL lifecycle, no worker, and no local decode:
 * a PDF is a stage and nothing else (the client skips the process call for it
 * on purpose — a process answer for a non-image would be a `[]` the server had
 * to special-case for no information), and an image that cannot be decoded is
 * rejected by the stage route rather than by a canvas here. An entry the user
 * drops is `discard`ed on removal, best-effort, for the same reason the photo
 * one is.
 */

import { useCallback, useState } from "react";
import {
  MAX_ARTWORK_DOCUMENTS,
  type ArtworkDocument,
  type StagedEntry,
} from "@arcula/shared";
import {
  documentsChanged,
  isAcceptedDocumentType,
  isDocumentImageType,
  sortDocuments,
} from "@/utils/artworkDocuments";
import { mediaService } from "@/services/mediaService";
import { ApiRequestError } from "@/services/api";
import {
  keySequence,
  useUploadPool,
  type Rejection,
  type StageOutcome,
} from "./useUploadPool";

/**
 * One entry in the form's document list.
 *
 * A discriminated union for the same reason `PhotoEntry` is one: "has this
 * been saved yet" decides whether there is a document to keep in the set or a
 * staged entry the save will promote, and two optionals would mean re-checking
 * the same condition at every call site.
 */
export type DocumentEntry =
  | {
      /** Stable across reorders, so React keys survive a move. */
      key: string;
      status: "stored";
      document: ArtworkDocument;
    }
  | {
      key: string;
      status: "staged";
      file: File;
      /**
       * A stand-in `ArtworkDocument`, ided with the client-minted entry id, so
       * a document that has not been saved yet renders and opens through
       * exactly the same path as one that has: its `original` is the staged
       * object's proxy url, and for an image its `variants` are the server's
       * own answer for what it generated.
       */
      document: ArtworkDocument;
    };

export interface AddDocumentsResult {
  added: DocumentEntry[];
  rejected: Rejection[];
}

/** The shared counter, prefixed so a failure names the list it came from. */
const nextKey = keySequence("document");

/**
 * One file through stage, and process when it is an image. Resolves to the
 * finished entry on success, or to the rejection on any failure — and
 * discards the staged original when the stage succeeded but the variants did
 * not, so a failed batch does not leave objects behind that no save will ever
 * promote.
 */
async function stageAndProcess(
  collectionId: string,
  artworkId: string,
  file: File,
): Promise<StageOutcome<DocumentEntry>> {
  const entryId = crypto.randomUUID();
  try {
    const staged = await mediaService.stageDocument(
      collectionId,
      artworkId,
      entryId,
      file,
    );
    const base = {
      id: entryId,
      name: staged.name,
      size: staged.size,
      contentType: staged.contentType,
      original: {
        url: staged.url,
        size: staged.size,
        contentType: staged.contentType,
      },
    };
    if (!isDocumentImageType(file.type)) {
      // A PDF is staged and nothing more: there is nothing to generate, so no
      // process call and no variants — the shape the saved document has.
      return {
        entry: {
          key: nextKey(),
          status: "staged",
          file,
          document: { ...base, kind: "file" },
        },
        rejection: null,
      };
    }
    try {
      const { variants } = await mediaService.processDocument(
        collectionId,
        artworkId,
        entryId,
      );
      if (staged.width === null || staged.height === null) {
        // The stage route decodes every image it admits, so a null dimension is
        // a server bug, not a file condition: discard what is up and say the
        // upload failed rather than render a document with no geometry.
        void mediaService
          .discardDocument(collectionId, artworkId, entryId)
          .catch(() => {});
        return { entry: null, rejection: "The image could not be read" };
      }
      return {
        entry: {
          key: nextKey(),
          status: "staged",
          file,
          document: {
            ...base,
            kind: "image",
            width: staged.width,
            height: staged.height,
            variants,
          },
        },
        rejection: null,
      };
    } catch (error) {
      // The original is up and no save will ever name it: discard it now,
      // idempotently, and let the error report the failure.
      void mediaService
        .discardDocument(collectionId, artworkId, entryId)
        .catch(() => {});
      throw error;
    }
  } catch (error) {
    return {
      entry: null,
      rejection:
        error instanceof ApiRequestError
          ? (error.fields?.file ?? error.message)
          : "The file could not be uploaded",
    };
  }
}

export interface UseArtworkDocumentsOptions {
  /** Staging happens at add time, under the collection the form belongs to. */
  collectionId: string;
  /**
   * The artwork id the entries stage under. On the Add page this is the
   * client-minted id the save will create the row with; on the Edit page it
   * is the loaded work's id.
   */
  artworkId: string;
  /** The documents already on the artwork, when editing. */
  initialDocuments?: ArtworkDocument[];
}

export const useArtworkDocuments = ({
  collectionId,
  artworkId,
  initialDocuments = [],
}: UseArtworkDocumentsOptions) => {
  // The stored documents as loaded, kept apart from the working list so a save
  // can tell "the user removed one" from "nothing about them changed" and leave
  // the field out of the patch in the second case. `hydrate` rewrites it
  // together with the entries, so the two can never describe different artworks.
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
  const { processing, progress, run } = useUploadPool();

  /**
   * Add files, staging each one as it is accepted.
   *
   * The pre-checks here are the count cap and the type allowlist — the two
   * things the form knows before spending a round trip. The size cap and the
   * decode are the stage route's to answer, and its refusal arrives on the
   * same `rejected` list with a reason the user can act on. The extension a
   * saved object gets is the server's decision from the content type, so the
   * form does not pre-judge filenames.
   *
   * The pool — three files in flight, appended in drop order once the batch
   * has settled — is `useUploadPool`'s.
   */
  const addFiles = useCallback(
    async (files: File[]): Promise<AddDocumentsResult> => {
      const rejected: Rejection[] = [];
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
        if (!isAcceptedDocumentType(file.type)) {
          rejected.push({ file, reason: "Not a supported file type" });
          continue;
        }
        accepted.push(file);
        room -= 1;
      }

      if (accepted.length === 0) {
        return { added: [], rejected };
      }

      const staged = await run(accepted, (file) =>
        stageAndProcess(collectionId, artworkId, file),
      );

      const { added } = staged;
      if (added.length > 0) {
        setEntries((current) => [...current, ...added]);
      }
      return { added, rejected: [...rejected, ...staged.rejected] };
    },
    [collectionId, artworkId, entries.length, run],
  );

  /**
   * Remove one document. A stored one just leaves the set — the save's PATCH
   * omits its id, and the server deletes the row and sweeps the objects in
   * the same flow. A staged one is discarded now, best-effort: the call is
   * fire-and-forget because a remove must not block on the network, and the
   * staging sweep catches anything the discard lost.
   */
  const remove = useCallback(
    (key: string): string | null => {
      let removedId: string | null = null;
      setEntries((current) =>
        current.filter((entry) => {
          if (entry.key !== key) {
            return true;
          }
          if (entry.status === "stored") {
            removedId = entry.document.id;
          } else {
            void mediaService
              .discardDocument(collectionId, artworkId, entry.document.id)
              .catch(() => {});
          }
          return false;
        }),
      );
      return removedId;
    },
    [collectionId, artworkId],
  );

  /**
   * The save payload for the document set, or `null` when nothing about the
   * ids changed and the patch must leave the field out entirely: an absent key
   * leaves the stored set alone, and re-sending it would rewrite every object
   * for no change.
   *
   * A set comparison, not photos' ordered one: this list has no sequence, so
   * removing a document is a change and reordering the UI is not. The
   * comparison itself lives in `documentsChanged` and is unit-tested there —
   * inlined here it would have been the second place for the same rule to
   * live, and the second place is the one that drifts.
   */
  const commit = useCallback((): StagedEntry[] | null => {
    const stored = entries.flatMap((entry) =>
      entry.status === "stored" ? [entry.document] : [],
    );
    const staged = entries.flatMap((entry) =>
      entry.status === "staged" ? [entry.document] : [],
    );
    // Unchanged-and-nothing-staged is the only "leave the field out" case: a
    // batch that only added is a change the patch has to carry, and the
    // set-comparison alone would miss it (the stored half is untouched).
    if (staged.length === 0 && !documentsChanged(loaded, stored)) {
      return null;
    }
    return [...stored, ...staged].map((document) => ({
      entryId: document.id,
      name: document.name,
    }));
  }, [entries, loaded]);

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
    hasRoom: entries.length < MAX_ARTWORK_DOCUMENTS,
    addFiles,
    remove,
    commit,
    hydrate,
  };
};

export type UseArtworkDocuments = ReturnType<typeof useArtworkDocuments>;
