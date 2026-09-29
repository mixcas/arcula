/**
 * Firebase Storage access for artwork photos.
 *
 * Everything in here follows the same conventions as `artworkService`: the
 * shared `storage` instance (never a second `initializeApp`), and
 * `console.error` + `throw` on failure so the caller decides the message.
 */

import {
  deleteObject,
  getDownloadURL,
  listAll,
  ref,
  uploadBytesResumable,
  type FirebaseStorage,
} from "firebase/storage";
import { collection, doc } from "firebase/firestore";
import { db, storage } from "./firebase";
import { extensionFor, type ProcessedImage } from "@/utils/imageProcessing";
import { reindexPhotos } from "@/utils/artworkPhotos";
import type { ArtworkPhoto, ImageVariant, ImageVariantKey } from "@/types";

/**
 * How many files upload at once.
 *
 * Ten photos is up to fifty objects (the original plus four variants each).
 * Firing all fifty at once saturates the connection, starves every other
 * request the page might make, and on a phone connection is the difference
 * between finishing and appearing to hang. Three keeps the pipe full without
 * monopolising it.
 */
const UPLOAD_CONCURRENCY = 3;

/** Where an artwork's files live, and the name of each object in it. */
const photosPrefix = (
  userId: string,
  collectionId: string,
  artworkId: string,
): string => `artworks/${userId}/${collectionId}/${artworkId}/photos`;

/**
 * The object name for one file of one photo.
 *
 * `{artworkId}` appears here as well as in the path. It is redundant, and that
 * is the point: the name alone identifies both the artwork and the photo, so
 * the object is self-describing when it is downloaded or read in the console,
 * and `storage.rules` can pattern-match the name to refuse anything that does
 * not fit the shape.
 *
 * The `artworkId` prefix is validated against the path's own `artworkId` in the
 * rules, so a name minted for one artwork cannot be written under another.
 */
const objectName = (
  artworkId: string,
  photoId: string,
  key: ImageVariantKey | "original",
  extension: string,
): string => `${artworkId}_${photoId}_${key}.${extension}`;

/**
 * The prefix that identifies every object belonging to one photo.
 *
 * Deletion matches on this rather than reconstructing five filenames, because
 * the extension is not predictable: the same photo is `.webp` on a browser
 * with a WebP encoder and `.jpg` on one without. Listing and filtering is the
 * only approach that is right in both cases — and it is what keeps a re-upload
 * in a different format from orphaning the previous encoding.
 */
const photoPrefix = (artworkId: string, photoId: string): string =>
  `${artworkId}_${photoId}_`;

/**
 * A Firestore-style id, minted without writing anything.
 *
 * `doc(collection(db, ...)).id` generates the same 20-character alphanumeric id
 * Firestore would have assigned, without the write. That is what lets the
 * object name be built before any object exists, and it keeps photo ids
 * indistinguishable from document ids everywhere else.
 */
export const newPhotoId = (): string => doc(collection(db, "artworks")).id;

interface UploadOne {
  blob: Blob;
  name: string;
  contentType: string;
}

/**
 * Upload a set of files, at most `limit` at a time, preserving input order.
 *
 * Order matters because the results are zipped back onto their photos, and a
 * thumbnail that belongs to the wrong artwork is worse than no thumbnail.
 */
const uploadAll = async (
  client: FirebaseStorage,
  prefix: string,
  files: UploadOne[],
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> => {
  const urls = new Array<string>(files.length);
  let next = 0;
  let done = 0;

  const runNext = async (): Promise<void> => {
    while (next < files.length) {
      const index = next++;
      const file = files[index];
      if (!file) {
        return;
      }
      // The reference is kept in a local rather than read back off the task:
      // `UploadTask` does not expose `ref`, and the download URL has to be
      // fetched from the same reference the bytes went to.
      const target = ref(client, `${prefix}/${file.name}`);
      const task = uploadBytesResumable(target, file.blob, {
        contentType: file.contentType,
      });
      await task;
      urls[index] = await getDownloadURL(target);
      onProgress?.(++done, files.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, files.length) }, () =>
      runNext(),
    ),
  );
  return urls;
};

/**
 * Upload one processed image: the original file plus every generated variant.
 *
 * `photoId` is passed in rather than generated here because the caller needs
 * it to build the document that will reference these URLs.
 */
const uploadOne = async (
  client: FirebaseStorage,
  prefix: string,
  artworkId: string,
  photoId: string,
  image: ProcessedImage,
): Promise<ArtworkPhoto> => {
  // The extension comes from the file's own reported content type, never from
  // its name — a `.jpg` that is really a PNG should be stored as the PNG it
  // is — and never from the "requested" type, because a browser that cannot
  // encode WebP substitutes another format rather than failing, and naming the
  // object after the request would store a JPEG under a `.webp` name.
  const originalType = image.file.type || "image/jpeg";

  const files: UploadOne[] = [
    {
      blob: image.file,
      name: objectName(
        artworkId,
        photoId,
        "original",
        extensionFor(originalType),
      ),
      contentType: originalType,
    },
    ...image.variants.map((variant) => ({
      blob: variant.blob,
      name: objectName(
        artworkId,
        photoId,
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
    id: photoId,
    order: 0, // Replaced by reindexPhotos once the whole array exists.
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

export interface UploadPhotosOptions {
  userId: string;
  collectionId: string;
  artworkId: string;
  photos: ProcessedImage[];
  onProgress?: (done: number, total: number) => void;
}

export const imageService = {
  /**
   * Upload every photo's original and variants, in the given order.
   *
   * The returned array is reindexed, so the caller's ordering is already the
   * stored `order` and there is no second place for the two to disagree.
   *
   * A failure part-way through leaves the objects that did upload in place.
   * That is deliberate: they are addressed by photo id, so a retry overwrites
   * the same names, and a half-finished upload costs bytes rather than
   * correctness. Cleaning up on failure would need a delete sweep over photos
   * that were never recorded anywhere.
   */
  async uploadArtworkPhotos({
    userId,
    collectionId,
    artworkId,
    photos,
    onProgress,
  }: UploadPhotosOptions): Promise<ArtworkPhoto[]> {
    try {
      const prefix = photosPrefix(userId, collectionId, artworkId);
      const uploaded: ArtworkPhoto[] = [];

      for (const [index, image] of photos.entries()) {
        // One photo at a time, with a fresh id per photo. The id has to exist
        // before the object name is built, so it cannot be minted in the
        // service's caller and passed in as a list.
        const photoId = newPhotoId();
        uploaded.push(
          await uploadOne(storage, prefix, artworkId, photoId, image),
        );
        onProgress?.(index + 1, photos.length);
      }

      return reindexPhotos(uploaded);
    } catch (error) {
      console.error("Error uploading artwork photos:", error);
      throw error;
    }
  },

  /**
   * Delete every object belonging to one photo.
   *
   * List-and-filter rather than reconstructing names, so it removes whatever
   * encodings actually exist — `.webp` and `.jpg` for the same logical photo,
   * or a stale variant from a previous set of sizes.
   *
   * A missing photo is not an error. Removing an image that was never uploaded
   * successfully should not fail the save that also updates the metadata.
   */
  async deleteArtworkPhoto(
    userId: string,
    collectionId: string,
    artworkId: string,
    photoId: string,
  ): Promise<void> {
    try {
      const prefix = photosPrefix(userId, collectionId, artworkId);
      const match = photoPrefix(artworkId, photoId);
      const listing = await listAll(ref(storage, prefix));
      await Promise.all(
        listing.items
          .filter((item) => item.name.startsWith(match))
          .map((item) => deleteObject(item)),
      );
    } catch (error) {
      console.error("Error deleting artwork photo:", error);
      throw error;
    }
  },

  /**
   * Delete the objects for several photos, listing the prefix only once.
   *
   * Batch form of `deleteArtworkPhoto`, for a save that drops more than one
   * image. `listAll` is a real request, so calling it per photo would cost one
   * round trip each for the same answer.
   */
  async deleteArtworkPhotos(
    userId: string,
    collectionId: string,
    artworkId: string,
    photoIds: string[],
  ): Promise<void> {
    if (photoIds.length === 0) {
      return;
    }
    try {
      const prefix = photosPrefix(userId, collectionId, artworkId);
      const matches = photoIds.map((photoId) =>
        photoPrefix(artworkId, photoId),
      );
      const listing = await listAll(ref(storage, prefix));
      await Promise.all(
        listing.items
          .filter((item) =>
            matches.some((match) => item.name.startsWith(match)),
          )
          .map((item) => deleteObject(item)),
      );
    } catch (error) {
      console.error("Error deleting artwork photos:", error);
      throw error;
    }
  },
};
