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
 * So the photos live here, outside the form, and are merged into the payload at
 * submit time by the page.
 *
 * The hook also owns three things that are easy to get subtly wrong and are
 * each commented where they appear: the object-URL lifecycle, the distinction
 * between a stored photo (a URL) and a pending one (a `File` yet to be
 * uploaded), and the local `order` that is only committed on save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  processImages,
  variantFormatIsWebp,
  type ProcessedImage,
} from "@/utils/imageProcessing";
import { MAX_ARTWORK_PHOTOS, isAcceptedImageType } from "@/utils/imageVariants";
import { JPEG_TYPE } from "@/utils/imageRender";
import { reindexPhotos, sortPhotos } from "@/utils/artworkPhotos";
import type { ArtworkPhoto, ImageVariant } from "@/types";

/**
 * One entry in the form's photo list.
 *
 * A discriminated union rather than one shape with optional fields: "has this
 * been uploaded yet" decides whether there is a `photo` to save or a `pending`
 * blob to upload first, and making both optional would mean checking the same
 * two conditions at every call site.
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
      status: "pending";
      file: File;
      /** Object URL for the local original. Revoked on removal or unmount. */
      previewUrl: string;
      /**
       * A transient stand-in `ArtworkPhoto` assembled from the generated
       * variants, so a photo that has not been uploaded yet renders and opens
       * through exactly the same path as one that has.
       *
       * Built from blobs rather than the local file so the form shows what
       * will actually be stored — including that a variant is a WebP and not
       * the `.jpg` that was picked from disk. `null` until processing lands.
       */
      preview: ArtworkPhoto | null;
      /**
       * The generated variants, kept.
       *
       * This is the whole reason the hook exists rather than a `File` list: a
       * save uploads these directly instead of generating them a second time.
       * Four variants for ten photos is several seconds of CPU, and doing it
       * twice was pure waste.
       */
      processed: ProcessedImage | null;
    };

export interface AddPhotosResult {
  added: PhotoEntry[];
  /** Files rejected, with the reason. Shown to the user; never swallowed. */
  rejected: Array<{ file: File; reason: string }>;
}

let keyCounter = 0;
const nextKey = (): string => {
  keyCounter += 1;
  return `photo-${keyCounter}`;
};

/**
 * Revoke every object URL a pending entry owns, and forget them.
 *
 * Not just the picked file's: a pending entry also holds object URLs for the
 * generated variants its tile displays, and each of those pins a decoded blob.
 * Revoking only the file would leave the rest alive for the life of the page,
 * which is a leak the user triggers by removing a photo — up to ten times
 * over, in a form that is meant to be used repeatedly.
 *
 * A plain function over the tracking set rather than a hook: it touches no
 * component state, so there is nothing to memoise and nothing to depend on.
 */
const revokeEntryUrls = (entry: PhotoEntry, tracked: Set<string>): void => {
  if (entry.status === "stored") {
    return;
  }
  for (const url of [
    entry.previewUrl,
    ...(entry.preview?.variants ?? []).map((variant) => variant.url),
  ]) {
    URL.revokeObjectURL(url);
    tracked.delete(url);
  }
};

/**
 * Assemble a stand-in `ArtworkPhoto` from a processed image that has not been
 * uploaded yet.
 *
 * Built from the generated variants rather than from the local file, so a photo
 * still in the form renders and opens through the same `photoUrl` ladder as one
 * already in Storage — and shows the WebP that will be stored rather than the
 * `.jpg` that was picked from disk. Without it the tile is the only thing
 * displaying a local file, which is what made the format look wrong in the
 * form when the variants were in fact fine.
 *
 * The variant URLs are registered for revocation with everything else, because
 * an object URL pins its blob in memory: ten photos' worth left alive for the
 * life of the page is the alternative.
 */
const transientPreview = (
  image: ProcessedImage,
  fileUrl: string,
  register: (url: string) => void,
): ArtworkPhoto => {
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
    // Deliberately empty: this photo is not in Firestore, and an id here would
    // be a lie the save path could act on.
    id: "",
    order: 0,
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
  };
};

export interface UseArtworkPhotosOptions {
  /** The photos already on the artwork, when editing. */
  initialPhotos?: ArtworkPhoto[];
  onError?: (message: string) => void;
}

export const useArtworkPhotos = ({
  initialPhotos = [],
  onError,
}: UseArtworkPhotosOptions = {}) => {
  // The stored photos as loaded, kept apart from the working list so a save can
  // tell "the user reordered" from "nothing about the photos changed" and
  // leave the field alone in the second case.
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
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  /**
   * The format variants are being stored in, or null while still unknown.
   *
   * Two sources, and the second overwrites the first. On mount the probe is
   * asked, so the form can warn before anything has been added. Then every
   * batch of real encodes reports what it actually wrote, which is the answer
   * that counts — the probe is a guess about a canvas, and the bytes are the
   * fact.
   *
   * Worth having at all because the JPEG fallback is correct, silent, and
   * invisible: a browser that cannot encode WebP writes every variant as
   * `.jpg`, and the only other way to find out is to open the Storage console
   * afterwards and notice.
   */
  const [variantWebp, setVariantWebp] = useState<boolean | null>(null);

  useEffect(() => {
    let live = true;
    void variantFormatIsWebp()
      .then((webp) => {
        if (live) {
          setVariantWebp(webp);
        }
      })
      .catch(() => {
        // The probe's own fallback already answers this; failing to ask is not
        // worth an error, and an unknown state renders as "cannot tell yet".
        if (live) {
          setVariantWebp(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);

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

  /** Add files, rejecting anything over the cap or of the wrong type. */
  const addFiles = useCallback(
    async (files: File[]): Promise<AddPhotosResult> => {
      const rejected: AddPhotosResult["rejected"] = [];
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

      const added: PhotoEntry[] = accepted.map((file) => {
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

      // Generate the variants now rather than at submit, so the save does not
      // freeze for several seconds on a phone with ten large photos. The
      // results stay on the entry and are uploaded as they are, so this is the
      // one and only time they are generated — previously the save ran the
      // whole pipeline again and threw the first pass away.
      const register = (url: string) => previewUrls.current.add(url);
      setProcessing(true);
      setProgress({ done: 0, total: accepted.length });
      let processed: ProcessedImage[] = [];
      try {
        processed = await processImages(accepted, (done, total) =>
          setProgress({ done, total }),
        );
        // The encoder's own report of what it wrote, which is the fact. The
        // probe asked earlier; this overrules it if they disagree.
        if (processed.length > 0) {
          setVariantWebp(processed[0]?.webp ?? null);
        }
      } catch (error) {
        console.error("Error processing images:", error);
        onError?.("The images could not be prepared for upload.");
      } finally {
        setProcessing(false);
        setProgress(null);
      }

      // A file that could not be decoded cannot be uploaded, so it leaves the
      // grid rather than sitting there looking fine and failing at save — where
      // the failure would be reported as a failed save rather than a bad file.
      const byFile = new Map(processed.map((image) => [image.file, image]));
      const ready = new Map<string, PhotoEntry>();
      for (const entry of added) {
        if (entry.status !== "pending") {
          continue;
        }
        const result = byFile.get(entry.file);
        if (result) {
          ready.set(entry.key, {
            key: entry.key,
            status: "pending" as const,
            file: entry.file,
            previewUrl: entry.previewUrl,
            processed: result,
            preview: transientPreview(result, entry.previewUrl, register),
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
          // includes a photo the user removed while the batch was running.
          return addedKeys.has(entry.key) ? [] : [entry];
        }),
      );

      return { added: [...ready.values()], rejected };
    },
    [entries.length, onError],
  );

  /** Remove one photo, revoking its object URLs and reporting a stored id. */
  const remove = useCallback((key: string): string | null => {
    let removedId: string | null = null;
    setEntries((current) =>
      current.filter((entry) => {
        if (entry.key !== key) {
          return true;
        }
        if (entry.status === "stored") {
          removedId = entry.photo.id;
        } else {
          revokeEntryUrls(entry, previewUrls.current);
        }
        return false;
      }),
    );
    return removedId;
  }, []);

  /**
   * Reorder the list.
   *
   * `order` is not renumbered here. It is renumbered by `reindexPhotos` at save
   * time, and the entries are already stored in array order, which is the
   * sequence the app reads. Numbering them on every keystroke-level change
   * would mean the number in state disagrees with the array it describes
   * between the reorder and the save.
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

  /** The stored photos still referenced by the working list. */
  const remainingStoredIds = useMemo(
    () =>
      entries.flatMap((entry) =>
        entry.status === "stored" ? [entry.photo.id] : [],
      ),
    [entries],
  );

  /** Photos the user removed, so their objects can be swept on save. */
  const removedStoredIds = useMemo(
    () =>
      loaded.flatMap((photo) =>
        remainingStoredIds.includes(photo.id) ? [] : [photo.id],
      ),
    [loaded, remainingStoredIds],
  );

  /** Files chosen but not yet uploaded. */
  const pendingFiles = useMemo(
    () =>
      entries.flatMap((entry) =>
        entry.status === "pending" ? [entry.file] : [],
      ),
    [entries],
  );

  /**
   * The generated variants awaiting upload, in list order.
   *
   * A plain projection rather than a promise, which is the point: the work was
   * done when the file was added, so a save has nothing left to compute. Every
   * pending entry carries a result — one that failed is removed, not left
   * waiting — so the order here is the order the photos will be written in.
   */
  const pendingImages = useMemo(
    () =>
      entries.flatMap((entry) =>
        entry.status === "pending" && entry.processed ? [entry.processed] : [],
      ),
    [entries],
  );

  /** Whether the photos differ from what was loaded. */
  const dirty = useMemo(() => {
    const storedIds = entries.flatMap((entry) =>
      entry.status === "stored" ? [entry.photo.id] : [],
    );
    return (
      pendingFiles.length > 0 ||
      storedIds.length !== loaded.length ||
      storedIds.some((id, index) => loaded[index]?.id !== id)
    );
  }, [entries, loaded, pendingFiles.length]);

  /**
   * The photo list in the order the user set, once the pending ones uploaded.
   *
   * Walks the working list rather than concatenating. The obvious version —
   * `uploaded.push(...stored)` — silently puts every newly added photo at the
   * front, so a photo dragged into third place is saved first and becomes the
   * primary thumbnail. The order is the one thing this form exists to let the
   * user change, so it has to survive the save.
   *
   * `uploaded` is in `pendingImages` order, which is entry order, so the two
   * line up position for position.
   */
  const mergeUploaded = useCallback(
    (uploaded: ArtworkPhoto[]): ArtworkPhoto[] => {
      let next = 0;
      return reindexPhotos(
        entries.flatMap((entry) => {
          if (entry.status === "stored") {
            return [entry.photo];
          }
          const photo = uploaded[next];
          next += 1;
          return photo ? [photo] : [];
        }),
      );
    },
    [entries],
  );

  /**
   * Commit the list.
   *
   * Returns the photos to store, or `null` when nothing about them changed and
   * the caller should leave the field out of the update entirely — `updateDoc`
   * merges, so an absent key leaves the stored array alone rather than
   * rewriting fifty storage URLs on a save that only touched the title.
   */
  const commit = useCallback((): ArtworkPhoto[] | null => {
    if (!dirty) {
      return null;
    }
    return reindexPhotos(
      entries.flatMap((entry) =>
        entry.status === "stored" ? [entry.photo] : [],
      ),
    );
  }, [dirty, entries]);

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
    dirty,
    pendingFiles,
    pendingImages,
    removedStoredIds,
    hasRoom: entries.length < MAX_ARTWORK_PHOTOS,
    variantWebp,
    mergeUploaded,
    addFiles,
    remove,
    reorder,
    makePrimary,
    commit,
    hydrate,
  };
};

export type UseArtworkPhotos = ReturnType<typeof useArtworkPhotos>;
