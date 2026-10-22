// The single read path for Artworks, single and listed.
//
// One module owns reading works: the Collection, the works, their photos,
// their documents and their Variants — at most five queries for an owner or
// a non-member (a collaborator's membership row is one more), whatever the
// number of works. The child loader takes a set of Artwork ids, so a page of
// works batches through the same loader the single read uses instead of
// growing a second one.
//
// The access verdict is the pure rule in access.ts over the rows loaded here
// — the Collection, the work and the viewer's membership row, loaded by
// `authorize.ts`, plus the Access grant's validity, read off the request's
// cookie by the route and handed in as a fact (a Protected Collection admits a
// non-member only through it, ADR-0005). This module reports `not-found` or
// `forbidden` and carries no HTTP code or framework type. The route owns the
// wire codes. Only the list can answer `forbidden` — a Private Collection the
// viewer is not a member of, or a Protected one the visitor holds no grant for
// — because that is the list's existing wire, and the Collection read answers
// the same refusal so the two reads agree about who is inside; a single read
// answers `not-found` for every refusal (a Private Collection included) so the
// refusal discloses nothing.
//
// No transaction spans the reads: a work or child added or removed between
// them is a torn read the product tolerates, and no caller may assume a
// snapshot. Ordering is part of the document: the list is creation time and
// then id, photos are in `order`, documents by id, and the serializer groups
// Variants by parent.
//
// The save routes read their own work back through `readArtwork`, so a save
// answers exactly what a read of the same work would.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  artworks as artworksTable,
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  artworkPhotos as artworkPhotosTable,
} from "@arcula/db";
import type { ArtworkRead } from "@arcula/shared";
import { canSeeArtwork, canSeeCollection } from "./access";
import {
  loadArtworkInCollection,
  loadCollection,
  loadMembership,
} from "./authorize";
import { db } from "./db";
import { mediaNamespaceOf } from "./media/keys";
import { serializeArtwork, type ArtworkJoined } from "./serialize";

/** What a single read answers: the document, or one uniform refusal. */
export type ArtworkReadResult =
  | { readonly status: "ok"; readonly artwork: ArtworkRead }
  | { readonly status: "not-found" };

/**
 * What a list read answers: every visible work in order, or the one refusal
 * the list can make. A missing Collection is `not-found`; a Private
 * Collection the viewer does not own is `forbidden`.
 */
export type ArtworkListResult =
  | { readonly status: "ok"; readonly artworks: ArtworkRead[] }
  | { readonly status: "forbidden" }
  | { readonly status: "not-found" };

type ArtworkChildren = Pick<ArtworkJoined, "photos" | "documents" | "variants">;

/** An Artwork's no children: a work with nothing attached to it. */
const noChildren = (): ArtworkChildren => ({
  photos: [],
  documents: [],
  variants: [],
});

/**
 * The children of every Artwork in `artworkIds`: one photos query, one
 * documents query and one Variants query, whatever the size of the set.
 */
async function loadChildren(
  artworkIds: readonly string[],
): Promise<ArtworkChildren> {
  if (artworkIds.length === 0) return noChildren();
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
 * The flat child rows split per Artwork, in one pass. Variants hang off a
 * photo or a document, so the parent map assigns them to the work that owns
 * their parent.
 */
function groupChildren(
  artworkIds: readonly string[],
  children: ArtworkChildren,
): Map<string, ArtworkChildren> {
  const grouped = new Map<string, ArtworkChildren>();
  const artworkOfParent = new Map<string, string>();
  for (const artworkId of artworkIds) {
    grouped.set(artworkId, noChildren());
  }
  for (const photo of children.photos) {
    const bucket = grouped.get(photo.artworkId);
    if (!bucket) continue;
    bucket.photos.push(photo);
    artworkOfParent.set(photo.id, photo.artworkId);
  }
  for (const document of children.documents) {
    const bucket = grouped.get(document.artworkId);
    if (!bucket) continue;
    bucket.documents.push(document);
    artworkOfParent.set(document.id, document.artworkId);
  }
  for (const variant of children.variants) {
    const artworkId = artworkOfParent.get(variant.parentId);
    if (artworkId === undefined) continue;
    grouped.get(artworkId)?.variants.push(variant);
  }
  return grouped;
}

/**
 * One Artwork as its Viewer sees it, or `not-found`.
 *
 * A missing Collection, a missing work, a Draft, a Deleted work, a work
 * behind a Private Collection and a work under the wrong Collection are one
 * answer for anyone but a member: saying which was refused would be a
 * disclosure. A member — the Owner or any Collaborator — reads every work of
 * the collection, deleted ones included.
 *
 * The Collection, the work and the three child reads run without a
 * transaction: a row added or removed between them is a torn read the
 * product tolerates, and no caller may treat the document as a snapshot.
 */
export async function readArtwork(
  collectionId: string,
  artworkId: string,
  viewer: string | null,
  hasValidGrant = false,
): Promise<ArtworkReadResult> {
  const collection = await loadCollection(collectionId);
  if (!collection) return { status: "not-found" };
  const artwork = await loadArtworkInCollection(collectionId, artworkId);
  if (!artwork) return { status: "not-found" };
  const membership = await loadMembership(collectionId, collection, viewer);
  if (!canSeeArtwork(membership, collection, artwork, hasValidGrant)) {
    return { status: "not-found" };
  }
  const children = await loadChildren([artworkId]);
  return {
    status: "ok",
    artwork: serializeArtwork(
      { artwork, ...children },
      mediaNamespaceOf(collection),
    ),
  };
}

/**
 * A Collection's Artwork list as its Viewer sees it.
 *
 * The works query keeps the two filters it has always used: a member gets
 * every live work of the collection — no `userId` filter, because every
 * member reads the same list — and a non-member only Published, live works;
 * a Deleted work is in neither. A Private Collection the viewer is not a
 * member of, or a Protected one they hold no grant for, is `forbidden` (never
 * `not-found` — the client maps it to "private"), and a missing Collection is
 * `not-found`.
 *
 * The rows are ordered by creation time and then id, so repeated reads agree,
 * and their children arrive from the same three batched queries as the single
 * read. The verdict still runs over each loaded row, so the list fails closed
 * if the filter and the rule ever disagree.
 */
export async function readArtworkList(
  collectionId: string,
  viewer: string | null,
  hasValidGrant = false,
): Promise<ArtworkListResult> {
  const collection = await loadCollection(collectionId);
  if (!collection) return { status: "not-found" };
  const member = await loadMembership(collectionId, collection, viewer);
  if (!canSeeCollection(member, collection, hasValidGrant)) {
    return { status: "forbidden" };
  }

  const rows = await db
    .select()
    .from(artworksTable)
    .where(
      member !== null
        ? and(
            eq(artworksTable.collectionId, collectionId),
            isNull(artworksTable.deletedAt),
          )
        : and(
            eq(artworksTable.collectionId, collectionId),
            eq(artworksTable.status, "published"),
            isNull(artworksTable.deletedAt),
          ),
    )
    .orderBy(asc(artworksTable.createdAt), asc(artworksTable.id));

  const works = rows.filter((row) =>
    canSeeArtwork(member, collection, row, hasValidGrant),
  );
  const artworkIds = works.map((work) => work.id);
  const grouped = groupChildren(artworkIds, await loadChildren(artworkIds));
  return {
    status: "ok",
    artworks: works.map((work) =>
      serializeArtwork(
        {
          artwork: work,
          ...(grouped.get(work.id) ?? noChildren()),
        },
        mediaNamespaceOf(collection),
      ),
    ),
  };
}
