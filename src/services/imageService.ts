/**
 * Firebase Storage access for artwork photos.
 *
 * Everything in here follows the same conventions as `artworkService`: the
 * shared `storage` instance (never a second `initializeApp`), and
 * `console.error` + `throw` on failure so the caller decides the message.
 *
 * The naming, concurrency and list-and-filter sweep all live in
 * `artworkFiles`, shared with artwork documents — see the note there for why
 * they are not duplicated.
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
import { reindexPhotos } from "@/utils/artworkPhotos";
import type { ArtworkPhoto, ImageVariant } from "@/types";

/** Where an artwork's photos live. */
const photosPrefix = (
  userId: string,
  collectionId: string,
  artworkId: string,
): string => artworkFilesPrefix(userId, collectionId, artworkId, "photos");

/**
 * A Firestore-style id, minted without writing anything.
 *
 * Re-exported under the photo-specific name because the photo pipeline is
 * where a caller needs one, and the underlying generator is shared.
 */
export const newPhotoId = (): string => newEntryId();

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
      await deleteEntries(
        storage,
        photosPrefix(userId, collectionId, artworkId),
        [entryPrefix(artworkId, photoId)],
      );
    } catch (error) {
      console.error("Error deleting artwork photo:", error);
      throw error;
    }
  },

  /**
   * Delete the objects for several photos, listing the folder only once.
   */
  async deleteArtworkPhotos(
    userId: string,
    collectionId: string,
    artworkId: string,
    photoIds: string[],
  ): Promise<void> {
    try {
      await deleteEntries(
        storage,
        photosPrefix(userId, collectionId, artworkId),
        photoIds.map((photoId) => entryPrefix(artworkId, photoId)),
      );
    } catch (error) {
      console.error("Error deleting artwork photos:", error);
      throw error;
    }
  },
};
