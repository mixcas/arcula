/**
 * The storage machinery shared by artwork photos and artwork documents.
 *
 * Both features are the same shape — a flat folder of objects per artwork, a
 * generated name per file, a list-and-filter sweep to delete — and differ only
 * in which folder they write to and which fields they record. That machinery
 * used to live in `imageService`, and the alternative was a second copy of it
 * in a document service: two `uploadAll` implementations to keep in step, and
 * the second one would drift.
 *
 * Nothing here knows what a photo or a document is. It moves bytes and names
 * them.
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
import { db } from "./firebase";
import type { ImageVariantKey } from "@/types";

/**
 * How many files upload at once.
 *
 * Ten photos is up to fifty objects (the original plus four variants each).
 * Firing all fifty at once saturates the connection, starves every other
 * request the page might make, and on a phone connection is the difference
 * between finishing and appearing to hang. Three keeps the pipe full without
 * monopolising it.
 */
export const UPLOAD_CONCURRENCY = 3;

/** The two folders an artwork's files live in, under its own prefix. */
export type ArtworkFileFolder = "photos" | "documents";

/**
 * Where an artwork's files live.
 *
 * The folder is the last path segment rather than being interpolated from the
 * caller, so a folder name can never be taken from user input — the value comes
 * from this union and nothing else.
 */
export const artworkFilesPrefix = (
  userId: string,
  collectionId: string,
  artworkId: string,
  folder: ArtworkFileFolder,
): string => `artworks/${userId}/${collectionId}/${artworkId}/${folder}`;

/**
 * The object name for one file of one entry.
 *
 * `{artworkId}` appears here as well as in the path. It is redundant, and that
 * is the point: the name alone identifies both the artwork and the entry, so
 * the object is self-describing when it is downloaded or read in the console,
 * and `storage.rules` can pattern-match the name to refuse anything that does
 * not fit the shape.
 *
 * The `artworkId` prefix is validated against the path's own `artworkId` in the
 * rules, so a name minted for one artwork cannot be written under another.
 *
 * `key` is a variant name or `original`. Documents always write `original` and
 * images add a variant key, which is what lets one regex and one delete sweep
 * serve both.
 */
export const objectName = (
  artworkId: string,
  entryId: string,
  key: ImageVariantKey | "original",
  extension: string,
): string => `${artworkId}_${entryId}_${key}.${extension}`;

/**
 * The prefix that identifies every object belonging to one entry.
 *
 * Deletion matches on this rather than reconstructing names, because the
 * extension is not predictable: the same photo is `.webp` on a browser with a
 * WebP encoder and `.jpg` on one without. Listing and filtering is the only
 * approach that is right in both cases — and it is what keeps a re-upload in a
 * different format from orphaning the previous encoding.
 */
export const entryPrefix = (artworkId: string, entryId: string): string =>
  `${artworkId}_${entryId}_`;

/**
 * A Firestore-style id, minted without writing anything.
 *
 * `doc(collection(db, ...)).id` generates the same 20-character alphanumeric id
 * Firestore would have assigned, without the write. That is what lets the
 * object name be built before any object exists, and it keeps entry ids
 * indistinguishable from document ids everywhere else.
 */
export const newEntryId = (): string => doc(collection(db, "artworks")).id;

export interface UploadOne {
  blob: Blob;
  name: string;
  contentType: string;
}

/**
 * Upload a set of files, at most `UPLOAD_CONCURRENCY` at a time, preserving
 * input order.
 *
 * Order matters because the results are zipped back onto their entries, and a
 * thumbnail that belongs to the wrong artwork is worse than no thumbnail.
 */
export const uploadAll = async (
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
 * Delete every object belonging to the given entries, listing the folder once.
 *
 * List-and-filter rather than reconstructing names, so it removes whatever
 * encodings actually exist — `.webp` and `.jpg` for the same logical photo, or
 * a stale variant from a previous set of sizes.
 *
 * `listAll` is a real request, so batching the ids into one call matters on a
 * save that drops several images. An empty list returns without asking: removing
 * something that was never uploaded should not fail the save that also updates
 * the metadata.
 */
export const deleteEntries = async (
  client: FirebaseStorage,
  prefix: string,
  matches: string[],
): Promise<void> => {
  if (matches.length === 0) {
    return;
  }
  const listing = await listAll(ref(client, prefix));
  await Promise.all(
    listing.items
      .filter((item) => matches.some((match) => item.name.startsWith(match)))
      .map((item) => deleteObject(item)),
  );
};
