// The wire shape of GET responses: the exact wire document shape — same
// keys, same nesting — with the `url` fields filled with proxy paths. That
// is what keeps the client's types (`Artwork`, `Collection` in
// @arcula/shared) working against the API unmodified.
//
// Three transforms, row → document:
//
//   - timestamps: a Postgres `Date` (millisecond precision, which is how
//     every write stamps) becomes the wire timestamp shape
//     `{ seconds, nanoseconds }`;
//   - blank text fields: an ABSENT key, never a null value — that is the
//     document shape (`blankText` → undefined → the key is not there);
//   - `url`: computed from the key algebra. No row ever stores a URL; the
//     key builders are the single owner of object names, and the proxy is
//     the only thing that reads them back.
//
// A row the write paths could not have produced (a photo with no original
// variant row, a null where a number is required) throws `internal`: a
// malformed row is a server bug and deserves a 500, not a half-shaped
// document on the wire.

import {
  artworks as artworksTable,
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  artworkPhotos as artworkPhotosTable,
  collections as collectionsTable,
} from "@arcula/db";
import { UPDATABLE_TEXT_FIELDS } from "@arcula/shared";
import { ApiError } from "./errors";
import {
  extensionFor,
  finalDocumentKey,
  finalPhotoKey,
  mediaUrl,
} from "./media/keys";
import { DOCUMENT_VARIANT_SPECS, IMAGE_VARIANTS } from "./media/variants";

export type CollectionRow = typeof collectionsTable.$inferSelect;
export type ArtworkRow = typeof artworksTable.$inferSelect;
export type PhotoRow = typeof artworkPhotosTable.$inferSelect;
export type DocumentRow = typeof artworkDocumentsTable.$inferSelect;
export type VariantRow = typeof artworkPhotoVariantsTable.$inferSelect;

/** The joined shape the read routes hand to the serializer. */
export interface ArtworkJoined {
  artwork: ArtworkRow;
  /** In `order` — index 0 is the primary thumbnail. */
  photos: PhotoRow[];
  documents: DocumentRow[];
  /** Photo + document variant rows, ungrouped; grouped by `parentId` here. */
  variants: VariantRow[];
}

type WireTimestamp = { seconds: number; nanoseconds: number };

const wireTimestamp = (t: Date | null): WireTimestamp | null => {
  if (t === null) return null;
  const ms = t.getTime();
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
  };
};

/** A stored value the write paths guarantee; null is a server bug. */
const present = <T>(value: T | null, what: string): T => {
  if (value === null) {
    throw new ApiError("internal", `Missing ${what}`);
  }
  return value;
};

/** The extension a recorded content type must yield (the allowlist closed
 *  it); a null or unaccepted type is a server bug, thrown on the spot. */
const extOf = (contentType: string | null, what: string): string => {
  const ext = extensionFor(contentType ?? undefined);
  if (ext === null) {
    throw new ApiError("internal", `Unrecognized content type on ${what}`);
  }
  return ext;
};

/** The variant rows in the spec-table order the write paths record them in. */
const orderedBy = (
  specs: readonly { key: string }[],
  variants: VariantRow[],
): VariantRow[] =>
  specs
    .map((spec) => variants.find((v) => v.key === spec.key))
    .filter((v): v is VariantRow => v !== undefined);

/** A variant row, rendered as the document's `ImageVariant` entry. */
const variantEntry = (v: VariantRow, url: string): Record<string, unknown> => ({
  key: v.key,
  url,
  width: present(v.width, `variant ${v.key} width`),
  height: present(v.height, `variant ${v.key} height`),
  size: present(v.size, `variant ${v.key} size`),
  contentType: present(v.contentType, `variant ${v.key} content type`),
});

function serializePhoto(
  row: PhotoRow,
  variants: VariantRow[],
  userId: string,
  collectionId: string,
  artworkId: string,
): Record<string, unknown> {
  // The photo row carries no metadata: the `original` variant row is where
  // the source's size/type/dimensions live.
  const original = variants.find((v) => v.key === "original");
  if (!original) {
    throw new ApiError(
      "internal",
      `Photo ${row.id} has no original variant row`,
    );
  }
  const originalType = original.contentType;
  if (originalType === null) {
    throw new ApiError(
      "internal",
      `Photo ${row.id} original has no content type`,
    );
  }
  const originalUrl = mediaUrl(
    finalPhotoKey(
      userId,
      collectionId,
      artworkId,
      row.id,
      "original",
      extOf(originalType, `photo ${row.id} original`),
    ),
  );
  const size = present(original.size, `photo ${row.id} original size`);
  return {
    id: row.id,
    order: row.order,
    name: row.name,
    size,
    contentType: originalType,
    width: present(original.width, `photo ${row.id} width`),
    height: present(original.height, `photo ${row.id} height`),
    original: { url: originalUrl, size, contentType: originalType },
    variants: orderedBy(IMAGE_VARIANTS, variants).map((v) =>
      variantEntry(
        v,
        mediaUrl(
          finalPhotoKey(
            userId,
            collectionId,
            artworkId,
            row.id,
            v.key,
            extOf(v.contentType, `photo ${row.id} variant ${v.key}`),
          ),
        ),
      ),
    ),
  };
}

function serializeDocument(
  row: DocumentRow,
  variants: VariantRow[],
  userId: string,
  collectionId: string,
  artworkId: string,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    size: row.size,
    contentType: row.contentType,
    original: {
      url: mediaUrl(
        finalDocumentKey(
          userId,
          collectionId,
          artworkId,
          row.id,
          "original",
          extOf(row.contentType, `document ${row.id} original`),
        ),
      ),
      size: row.size,
      contentType: row.contentType,
    },
  };
  if (row.kind === "image") {
    return {
      ...base,
      kind: "image",
      width: present(row.width, `document ${row.id} width`),
      height: present(row.height, `document ${row.id} height`),
      variants: orderedBy(DOCUMENT_VARIANT_SPECS, variants).map((v) =>
        variantEntry(
          v,
          mediaUrl(
            finalDocumentKey(
              userId,
              collectionId,
              artworkId,
              row.id,
              v.key,
              extOf(v.contentType, `document ${row.id} variant ${v.key}`),
            ),
          ),
        ),
      ),
    };
  }
  return { ...base, kind: "file" };
}

/** The exact wire document shape, urls filled with proxy paths. */
export function serializeArtwork(
  joined: ArtworkJoined,
): Record<string, unknown> {
  const { artwork, photos, documents, variants } = joined;
  const byParent = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const list = byParent.get(v.parentId);
    if (list) list.push(v);
    else byParent.set(v.parentId, [v]);
  }

  const out: Record<string, unknown> = {
    id: artwork.id,
    userId: artwork.userId,
    title: artwork.title,
    artistName: artwork.artistName,
    documents: documents.map((d) =>
      serializeDocument(
        d,
        byParent.get(d.id) ?? [],
        artwork.userId,
        artwork.collectionId,
        artwork.id,
      ),
    ),
    photos: photos.map((p) =>
      serializePhoto(
        p,
        byParent.get(p.id) ?? [],
        artwork.userId,
        artwork.collectionId,
        artwork.id,
      ),
    ),
    collectionId: artwork.collectionId,
    isPublic: artwork.isPublic,
    deletedAt: wireTimestamp(artwork.deletedAt),
    createdAt: wireTimestamp(artwork.createdAt),
    updatedAt: wireTimestamp(artwork.updatedAt),
  };
  // A blank field is an ABSENT key, not a null value — the document shape.
  for (const field of UPDATABLE_TEXT_FIELDS) {
    if (artwork[field] !== null) out[field] = artwork[field];
  }
  return out;
}

/** The exact wire collection document shape. */
export function serializeCollection(
  row: CollectionRow,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    userId: row.userId,
    isPublic: row.isPublic,
    createdAt: wireTimestamp(row.createdAt),
    updatedAt: wireTimestamp(row.updatedAt),
  };
  if (row.description !== null) out.description = row.description;
  // `skin`/`skinOptions` are read-time defaulted on the client side
  // (resolveSkin), so an unset value is an absent key.
  if (row.skin !== null) out.skin = row.skin;
  if (row.skinOptions !== null) out.skinOptions = row.skinOptions;
  return out;
}
