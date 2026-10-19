/**
 * The photo state behind the Add and Edit Artwork forms.
 *
 * ## Why this is a hook and not form state
 *
 * Both pages run `useForm` in `mode: "uncontrolled"` with
 * `transformValues: toArtworkPayload`, where the Zod schema's output *is* the
 * payload. A `File` cannot survive either half of that: it is not
 * serialisable, it is not a Zod value, and in uncontrolled mode the inputs are
 * remounted on every `initialize`, which would drop any component holding one.
 * So the photos live here, outside the form, and the staged ids are merged
 * into the payload at submit time by the page.
 *
 * ## What changed when the pipeline moved server-side
 *
 * A photo that lands in the form is PUT to staging **the moment it is
 * added** — not at save — so the save has nothing left to generate or
 * upload: it sends the sequence of entry ids and the server promotes the
 * staged objects into rows in the same transaction as the fields it writes.
 * The consequences worth keeping straight:
 *
 * - there is no object-URL lifecycle; every url the tile renders is a server
 *   proxy path, and there is nothing to revoke on removal or unmount;
 * - there is no format probe and no worker: the server owns the encoder and
 *   answers with the variants it actually wrote, so a photo that cannot be
 *   decoded is rejected by the stage route, not by a canvas here;
 * - an entry the user drops is `discard`ed on removal, best-effort: the
 *   staging lifecycle and the sweep are what keep a dropped object from
 *   lingering, and neither of them is this hook's job to verify.
 */

import { useCallback, useState } from "react";
import {
  isAcceptedImageType,
  MAX_ARTWORK_PHOTOS,
  sortPhotos,
  type ArtworkPhoto,
  type ImageVariant,
  type StagedEntry,
} from "@arcula/shared";
import { mediaService } from "@/services/mediaService";
import { ApiRequestError } from "@/services/api";
import {
  keySequence,
  useUploadPool,
  type Rejection,
  type StageOutcome,
} from "./useUploadPool";

/**
 * One entry in the form's photo list.
 *
 * A discriminated union rather than one shape with optional fields: "has this
 * been saved yet" decides whether there is a `photo` to keep in the sequence
 * or a staged entry the save will promote, and making both optional would mean
 * checking the same two conditions at every call site.
 */
export type PhotoEntry =
  | {
      /** Stable across reorders, so React keys and dnd ids survive a move. */
      key: string;
      status: "stored";
      photo: ArtworkPhoto;
    }
  | {
      key: string;
      status: "staged";
      file: File;
      /**
       * A stand-in `ArtworkPhoto`, ided with the client-minted entry id, so a
       * photo that has not been saved yet renders and opens through exactly
       * the same `photoUrl` ladder as one that has: its `original` is the
       * staged object's proxy url and its `variants` are the server's own
       * answer for what it generated. `order` is filled in when the entry is
       * appended, from the position it takes.
       */
      preview: ArtworkPhoto;
    };

export interface AddPhotosResult {
  added: PhotoEntry[];
  rejected: Rejection[];
}

/** The staged arm of the union, named so a helper's return type can say it
 *  without widening to the whole entry type. */
type StagedPhotoEntry = Extract<PhotoEntry, { status: "staged" }>;

/** The shared counter, prefixed so a failure names the list it came from. */
const nextKey = keySequence("photo");

/**
 * One file through stage + process. Resolves to the finished entry on
 * success, or to the rejection on any failure — and discards the staged
 * original when the stage succeeded but the variants did not, so a failed
 * batch does not leave objects behind that no save will ever promote.
 */
async function stageAndProcess(
  collectionId: string,
  artworkId: string,
  file: File,
): Promise<StageOutcome<StagedPhotoEntry>> {
  const entryId = crypto.randomUUID();
  try {
    const staged = await mediaService.stagePhoto(
      collectionId,
      artworkId,
      entryId,
      file,
    );
    let variants: ImageVariant[];
    try {
      ({ variants } = await mediaService.processPhoto(
        collectionId,
        artworkId,
        entryId,
      ));
    } catch (error) {
      // The original is up and no save will ever name it: discard it now,
      // idempotently, and let the error report the failure.
      void mediaService
        .discardPhoto(collectionId, artworkId, entryId)
        .catch(() => {});
      throw error;
    }
    if (staged.width === null || staged.height === null) {
      // The stage route decodes every photo it admits, so a null dimension
      // is a server bug, not a file condition: discard what is up and say
      // the upload failed rather than render a photo with no geometry.
      void mediaService
        .discardPhoto(collectionId, artworkId, entryId)
        .catch(() => {});
      return { entry: null, rejection: "The image could not be read" };
    }
    const entry: StagedPhotoEntry = {
      key: nextKey(),
      status: "staged",
      file,
      preview: {
        id: entryId,
        // Filled when the entry is appended; 0 is only ever a placeholder.
        order: 0,
        name: staged.name,
        size: staged.size,
        contentType: staged.contentType,
        width: staged.width,
        height: staged.height,
        original: {
          url: staged.url,
          size: staged.size,
          contentType: staged.contentType,
        },
        variants,
      },
    };
    return { entry, rejection: null };
  } catch (error) {
    return {
      entry: null,
      rejection:
        error instanceof ApiRequestError
          ? (error.fields?.file ?? error.message)
          : "The image could not be uploaded",
    };
  }
}

export interface UseArtworkPhotosOptions {
  /** Staging happens at add time, under the collection the form belongs to. */
  collectionId: string;
  /**
   * The artwork id the entries stage under. On the Add page this is the
   * client-minted id the save will create the row with; on the Edit page it
   * is the loaded work's id.
   */
  artworkId: string;
  /** The photos already on the artwork, when editing. */
  initialPhotos?: ArtworkPhoto[];
}

export const useArtworkPhotos = ({
  collectionId,
  artworkId,
  initialPhotos = [],
}: UseArtworkPhotosOptions) => {
  // The stored photos as loaded, kept apart from the working list so a save can
  // tell "the user reordered" from "nothing about the photos changed" and
  // leave the field out of the patch in the second case. `hydrate` rewrites it
  // together with the entries, so the two can never describe different artworks.
  const [loaded, setLoaded] = useState<ArtworkPhoto[]>(() =>
    sortPhotos(initialPhotos),
  );
  const [entries, setEntries] = useState<PhotoEntry[]>(() =>
    sortPhotos(initialPhotos).map((photo) => ({
      key: nextKey(),
      status: "stored" as const,
      photo,
    })),
  );
  const { processing, progress, run } = useUploadPool();

  /**
   * Add files, staging each one as it is accepted.
   *
   * The pre-checks here are the count cap and the type allowlist — the two
   * things the form knows before spending a round trip. The size cap and the
   * decode are the stage route's to answer, and its refusal arrives on the
   * same `rejected` list with a reason the user can act on, which is why a
   * too-large file does not need a client-side size check of its own.
   *
   * The pool — three files in flight, appended in drop order once the batch
   * has settled — is `useUploadPool`'s; what stays here is the sequence the
   * appended entries take.
   */
  const addFiles = useCallback(
    async (files: File[]): Promise<AddPhotosResult> => {
      const rejected: Rejection[] = [];
      const accepted: File[] = [];

      // Counted against the cap as we go, so a drop of twenty files with a
      // limit of ten keeps the first ten rather than rejecting all twenty.
      let room = MAX_ARTWORK_PHOTOS - entries.length;

      for (const file of files) {
        if (room <= 0) {
          rejected.push({
            file,
            reason: `Only ${MAX_ARTWORK_PHOTOS} images per artwork`,
          });
          continue;
        }
        if (!isAcceptedImageType(file.type)) {
          rejected.push({ file, reason: "Not a supported image" });
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

      // Drop order, offset by whatever is already in the list: a remove that
      // landed while the batch ran must not collide with a slot, and a failed
      // file must not leave a gap in the numbering.
      const added = staged.added.map((entry, index) => ({
        ...entry,
        preview: { ...entry.preview, order: entries.length + index },
      }));

      if (added.length > 0) {
        setEntries((current) => [...current, ...added]);
      }
      return { added, rejected: [...rejected, ...staged.rejected] };
    },
    [collectionId, artworkId, entries.length, run],
  );

  /**
   * Remove one photo. A stored one just leaves the sequence — the save's
   * PATCH omits its id, and the server deletes the row and sweeps the objects
   * in the same flow. A staged one is discarded now, best-effort: the call is
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
            removedId = entry.photo.id;
          } else {
            void mediaService
              .discardPhoto(collectionId, artworkId, entry.preview.id)
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
   * Reorder the list.
   *
   * `order` is not renumbered here. The saved photos carry their stored order
   * and the staged ones take theirs on append; the save sends only the ids,
   * in array order, and the server numbers them from position — the
   * reindex at the boundary the old `reindexPhotos` did on the client.
   */
  const reorder = useCallback((from: number, to: number) => {
    setEntries((current) => {
      if (from === to || from < 0 || to < 0) {
        return current;
      }
      if (from >= current.length || to >= current.length) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(from, 1);
      if (!moved) {
        return current;
      }
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  /** Move a photo to the front, which makes it the primary thumbnail. */
  const makePrimary = useCallback((key: string) => {
    setEntries((current) => {
      const index = current.findIndex((entry) => entry.key === key);
      if (index <= 0) {
        return current;
      }
      const next = [...current];
      const [moved] = next.splice(index, 1);
      if (!moved) {
        return current;
      }
      next.unshift(moved);
      return next;
    });
  }, []);

  /**
   * The save payload for the photo sequence, or `null` when the ids in the
   * working list are the loaded ones in the loaded order — in which case the
   * patch must leave the field out entirely, for the reason the patch
   * contract gives: an absent key leaves the stored sequence alone, and
   * re-sending it would renumber fifty rows for no change.
   *
   * The comparison is on ids in order, not on the entries: the staged ones
   * carry no `order` of their own, and their position in the array *is* the
   * order the server will write.
   */
  const commit = useCallback((): StagedEntry[] | null => {
    const loadedIds = loaded.map((photo) => photo.id);
    const ids = entries.map((entry) =>
      entry.status === "stored" ? entry.photo.id : entry.preview.id,
    );
    const unchanged =
      ids.length === loadedIds.length &&
      ids.every((id, index) => id === loadedIds[index]);
    if (unchanged) {
      return null;
    }
    return entries.map((entry) => ({
      entryId: entry.status === "stored" ? entry.photo.id : entry.preview.id,
      name: entry.status === "stored" ? entry.photo.name : entry.preview.name,
    }));
  }, [entries, loaded]);

  /** Re-seed from a freshly loaded artwork, e.g. after a load completes. */
  const hydrate = useCallback((photos: ArtworkPhoto[]) => {
    const sorted = sortPhotos(photos);
    setLoaded(sorted);
    setEntries(
      sorted.map((photo) => ({
        key: nextKey(),
        status: "stored" as const,
        photo,
      })),
    );
  }, []);

  return {
    entries,
    count: entries.length,
    processing,
    progress,
    hasRoom: entries.length < MAX_ARTWORK_PHOTOS,
    addFiles,
    remove,
    reorder,
    makePrimary,
    commit,
    hydrate,
  };
};

export type UseArtworkPhotos = ReturnType<typeof useArtworkPhotos>;
