// The single read path for one Artwork.
//
// One module owns reading a work: the Collection, the work itself, its
// photos, its documents and their Variants — at most five queries. The
// child loader takes a set of Artwork ids even when the set holds one, so a
// page of works can batch through the same loader instead of growing a
// second one.
//
// The visibility verdict is the pure rule in access.ts over the rows loaded
// here; this module reports `not-found` for every refusal and carries no
// HTTP code or framework type. The route owns the 404.
//
// No transaction spans the reads: a work or child added or removed between
// them is a torn read the product tolerates, and no caller may assume a
// snapshot. Ordering is part of the document: photos in `order`, documents
// and their Variants grouped by parent in the serializer.
//
// The save routes read their own work back through `readArtwork`, so a save
// answers exactly what a read of the same work would.

import { asc, inArray } from "drizzle-orm";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  artworkPhotos as artworkPhotosTable,
} from "@arcula/db";
import type { ArtworkRead } from "@arcula/shared";
import { canSeeArtwork, type Viewer } from "./access";
import { loadArtworkInCollection, loadCollection } from "./authorize";
import { db } from "./db";
import { serializeArtwork, type ArtworkJoined } from "./serialize";

/** What a single read answers: the document, or one uniform refusal. */
export type ArtworkReadResult =
  | { readonly status: "ok"; readonly artwork: ArtworkRead }
  | { readonly status: "not-found" };

type ArtworkChildren = Pick<ArtworkJoined, "photos" | "documents" | "variants">;

/**
 * The children of every Artwork in `artworkIds`: one photos query, one
 * documents query and one Variants query, whatever the size of the set.
 */
async function loadChildren(
  artworkIds: readonly string[],
): Promise<ArtworkChildren> {
  if (artworkIds.length === 0) {
    return { photos: [], documents: [], variants: [] };
  }
  const photos = await db
    .select()
    .from(artworkPhotosTable)
    .where(inArray(artworkPhotosTable.artworkId, [...artworkIds]))
    .orderBy(asc(artworkPhotosTable.order));
  const documents = await db
    .select()
    .from(artworkDocumentsTable)
    .where(inArray(artworkDocumentsTable.artworkId, [...artworkIds]))
    .orderBy(asc(artworkDocumentsTable.id));
  const parentIds = [...photos.map((p) => p.id), ...documents.map((d) => d.id)];
  const variants =
    parentIds.length > 0
      ? await db
          .select()
          .from(artworkPhotoVariantsTable)
          .where(inArray(artworkPhotoVariantsTable.parentId, parentIds))
      : [];
  return { photos, documents, variants };
}

/**
 * One Artwork as its Viewer sees it, or `not-found`.
 *
 * A missing Collection, a missing work, a Draft, a Deleted work, a work
 * behind a Private Collection and a work under the wrong Collection are one
 * answer for anyone but the Owner: saying which was refused would be a
 * disclosure. The Owner reads every work of their own Collection, deleted
 * ones included.
 *
 * The Collection, the work and the three child reads run without a
 * transaction: a row added or removed between them is a torn read the
 * product tolerates, and no caller may treat the document as a snapshot.
 */
export async function readArtwork(
  collectionId: string,
  artworkId: string,
  viewer: Viewer,
): Promise<ArtworkReadResult> {
  const collection = await loadCollection(collectionId);
  if (!collection) return { status: "not-found" };
  const artwork = await loadArtworkInCollection(collectionId, artworkId);
  if (!artwork) return { status: "not-found" };
  if (!canSeeArtwork(viewer, collection, artwork)) {
    return { status: "not-found" };
  }
  const children = await loadChildren([artworkId]);
  return {
    status: "ok",
    artwork: serializeArtwork({ artwork, ...children }),
  };
}
