// The wire shape of GET responses: the exact wire document shape — same
// keys, same nesting — with the `url` fields filled with proxy paths. That
// is what keeps the client's types (`Artwork`, `Collection` in
// @arcula/shared) working against the API unmodified.
//
// The return types ARE the contract: this file constructs the shared read
// types (`ArtworkRead`, `CollectionRead`), so `bun run check` refuses a field
// the read schema does not have, or a required one this file forgets. There
// is no parse here — the compiler is the whole check, and the server does not
// re-validate what it just constructed.
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
// variant row, a null where a number is required, an unknown status or
// document kind) throws `internal`: a malformed row is a server bug and
// deserves a 500, not a half-shaped document on the wire.

import {
  artworks as artworksTable,
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  artworkPhotos as artworkPhotosTable,
  collectionInvitations as collectionInvitationsTable,
  collections as collectionsTable,
} from "@arcula/db";
import {
  UPDATABLE_TEXT_FIELDS,
  type ArtworkRead,
  type ArtworkStatus,
  type CollectionRead,
  type CollectionRole,
  type CollectionMember,
  type ImageVariantKey,
  type InvitationSummary,
  type Timestamp,
} from "@arcula/shared";
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
export type InvitationRow = typeof collectionInvitationsTable.$inferSelect;

/** The dashboard list's per-row extras. Absent on every other read, which is
 *  what keeps the otherwise-identical documents distinguishable: a shared row
 *  carries `role` and `ownerName`, an owned one `role` alone. */
export interface SerializeCollectionOptions {
  role?: CollectionRole;
  ownerName?: string;
}

/** The joined shape the read routes hand to the serializer. */
export interface ArtworkJoined {
  artwork: ArtworkRow;
  /** In `order` — index 0 is the primary thumbnail. */
  photos: PhotoRow[];
  documents: DocumentRow[];
  /** Photo + document variant rows, ungrouped; grouped by `parentId` here. */
  variants: VariantRow[];
}

/** A text field the write paths may leave null; the document omits it then. */
type UpdatableTextField = (typeof UPDATABLE_TEXT_FIELDS)[number];

/** The nested contract shapes, taken from the read type itself. */
type PhotoRead = ArtworkRead["photos"][number];
type DocumentRead = ArtworkRead["documents"][number];
type VariantRead = PhotoRead["variants"][number];

export const wireTimestamp = (t: Date): Timestamp => {
  const ms = t.getTime();
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
  };
};

const wireTimestampOrNull = (t: Date | null): Timestamp | null =>
  t === null ? null : wireTimestamp(t);

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

/** The status the schema's check constraint permits. */
const statusOf = (status: string): ArtworkStatus => {
  if (status !== "draft" && status !== "published") {
    throw new ApiError("internal", `Unrecognized artwork status ${status}`);
  }
  return status;
};

/** The document kind the schema's check constraint permits. */
const kindOf = (kind: string): DocumentRead["kind"] => {
  if (kind !== "file" && kind !== "image") {
    throw new ApiError("internal", `Unrecognized document kind ${kind}`);
  }
  return kind;
};

/** The skin-option value vocabulary `collectionUpdateSchema` admits. */
const isSkinOptions = (
  value: unknown,
): value is NonNullable<CollectionRead["skinOptions"]> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (option) =>
      typeof option === "boolean" ||
      typeof option === "number" ||
      typeof option === "string",
  );
};

/**
 * The optional text fields that are set, as a partial document.
 *
 * A blank field is an ABSENT key, not a key holding `undefined`: the object
 * spread below must not name it at all.
 */
const presentTextFields = (
  artwork: ArtworkRow,
): Pick<ArtworkRead, UpdatableTextField> => {
  const fields: Partial<Pick<ArtworkRead, UpdatableTextField>> = {};
  for (const field of UPDATABLE_TEXT_FIELDS) {
    const value = artwork[field];
    if (value !== null) fields[field] = value;
  }
  return fields;
};

/** The variant rows in the spec-table order the write paths record them in. */
const orderedBy = (
  specs: readonly { key: ImageVariantKey }[],
  variants: VariantRow[],
): { key: ImageVariantKey; row: VariantRow }[] =>
  specs.flatMap((spec) => {
    const row = variants.find((variant) => variant.key === spec.key);
    return row === undefined ? [] : [{ key: spec.key, row }];
  });

/** A variant row, rendered as the document's `ImageVariant` entry. */
const variantEntry = (
  key: ImageVariantKey,
  v: VariantRow,
  url: string,
): VariantRead => ({
  key,
  url,
  width: present(v.width, `variant ${key} width`),
  height: present(v.height, `variant ${key} height`),
  size: present(v.size, `variant ${key} size`),
  contentType: present(v.contentType, `variant ${key} content type`),
});

function serializePhoto(
  row: PhotoRow,
  variants: VariantRow[],
  namespaceId: string,
  collectionId: string,
  artworkId: string,
): PhotoRead {
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
      namespaceId,
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
    variants: orderedBy(IMAGE_VARIANTS, variants).map(({ key, row: v }) =>
      variantEntry(
        key,
        v,
        mediaUrl(
          finalPhotoKey(
            namespaceId,
            collectionId,
            artworkId,
            row.id,
            key,
            extOf(v.contentType, `photo ${row.id} variant ${key}`),
          ),
        ),
      ),
    ),
  };
}

function serializeDocument(
  row: DocumentRow,
  variants: VariantRow[],
  namespaceId: string,
  collectionId: string,
  artworkId: string,
): DocumentRead {
  const kind = kindOf(row.kind);
  const base = {
    id: row.id,
    name: row.name,
    size: row.size,
    contentType: row.contentType,
    original: {
      url: mediaUrl(
        finalDocumentKey(
          namespaceId,
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
  if (kind === "image") {
    return {
      ...base,
      kind,
      width: present(row.width, `document ${row.id} width`),
      height: present(row.height, `document ${row.id} height`),
      variants: orderedBy(DOCUMENT_VARIANT_SPECS, variants).map(
        ({ key, row: v }) =>
          variantEntry(
            key,
            v,
            mediaUrl(
              finalDocumentKey(
                namespaceId,
                collectionId,
                artworkId,
                row.id,
                key,
                extOf(v.contentType, `document ${row.id} variant ${key}`),
              ),
            ),
          ),
      ),
    };
  }
  return { ...base, kind };
}

/** The exact wire document shape, urls filled with proxy paths.
 *
 *  `namespaceId` is the collection's fixed media namespace
 *  (`mediaNamespaceOf`), not the artwork's `userId`: a transfer changes the
 *  owner and must leave every URL pointing at the same object. */
export function serializeArtwork(
  joined: ArtworkJoined,
  namespaceId: string,
): ArtworkRead {
  const { artwork, photos, documents, variants } = joined;
  const byParent = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const list = byParent.get(v.parentId);
    if (list) list.push(v);
    else byParent.set(v.parentId, [v]);
  }

  return {
    id: artwork.id,
    userId: artwork.userId,
    title: artwork.title,
    artistName: artwork.artistName,
    documents: documents.map((d) =>
      serializeDocument(
        d,
        byParent.get(d.id) ?? [],
        namespaceId,
        artwork.collectionId,
        artwork.id,
      ),
    ),
    photos: photos.map((p) =>
      serializePhoto(
        p,
        byParent.get(p.id) ?? [],
        namespaceId,
        artwork.collectionId,
        artwork.id,
      ),
    ),
    collectionId: artwork.collectionId,
    status: statusOf(artwork.status),
    deletedAt: wireTimestampOrNull(artwork.deletedAt),
    createdAt: wireTimestamp(artwork.createdAt),
    updatedAt: wireTimestamp(artwork.updatedAt),
    // A blank field is an ABSENT key, not a null value — the document shape.
    ...presentTextFields(artwork),
  };
}

/** The exact wire collection document shape.
 *
 *  `role`/`ownerName` are the dashboard list's additions: the signed-in list
 *  passes the viewer's role on every row, and the owner's display name on a
 *  shared one. Every other read — the public list, the single read — is
 *  anonymous, so it emits the plain document, which is the shape the public
 *  pages have always parsed. */
export function serializeCollection(
  row: CollectionRow,
  opts: SerializeCollectionOptions = {},
): CollectionRead {
  const out: CollectionRead = {
    id: row.id,
    name: row.name,
    userId: row.userId,
    isPublic: row.isPublic,
    createdAt: wireTimestamp(row.createdAt),
    updatedAt: wireTimestamp(row.updatedAt),
  };
  if (opts.role !== undefined) out.role = opts.role;
  if (opts.ownerName !== undefined) out.ownerName = opts.ownerName;
  if (row.description !== null) out.description = row.description;
  // `skin`/`skinOptions` are read-time defaulted on the client side
  // (resolveSkin), so an unset value is an absent key.
  if (row.skin !== null) out.skin = row.skin;
  if (row.skinOptions !== null) {
    if (!isSkinOptions(row.skinOptions)) {
      throw new ApiError("internal", "Malformed collection skin options");
    }
    out.skinOptions = row.skinOptions;
  }
  return out;
}

/** A person's display name, falling back to their email — the rule the
 *  dashboard uses for a shared collection's owner, and the offer previews use
 *  for the inviter. */
export const displayName = (name: string | null, email: string): string => {
  const trimmed = name?.trim();
  return trimmed ? trimmed : email;
};

/** One account with access, as the access read names it. */
export function serializeMember(row: {
  id: string;
  name: string | null;
  email: string;
}): CollectionMember {
  return {
    userId: row.id,
    name: displayName(row.name, row.email),
    email: row.email,
  };
}

/** The invitation summary: the owner's access view and the create response's
 *  offer. The token is absent by construction — the row only holds its hash. */
export function serializeInvitation(row: InvitationRow): InvitationSummary {
  return {
    id: row.id,
    collectionId: row.collectionId,
    email: row.email,
    invitedByUserId: row.invitedByUserId,
    status: row.status as InvitationSummary["status"],
    createdAt: wireTimestamp(row.createdAt),
    expiresAt: wireTimestamp(row.expiresAt),
    resolvedAt: row.resolvedAt === null ? null : wireTimestamp(row.resolvedAt),
  };
}
