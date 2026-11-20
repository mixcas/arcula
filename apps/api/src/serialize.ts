// The wire shape of GET responses: the exact wire document shape — same
// keys, same nesting — with the `url` fields filled with proxy paths. That
// is what keeps the client's types (`Artwork`, `Catalogue` in
// @arcula/shared) working against the API unmodified.
//
// The return types ARE the contract: this file constructs the shared read
// types (`ArtworkRead`, `CatalogueRead`), so `bun run check` refuses a field
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
  catalogueInvitations as catalogueInvitationsTable,
  catalogues as cataloguesTable,
} from "@arcula/db";
import {
  UPDATABLE_TEXT_FIELDS,
  artworkAvailabilitySchema,
  artworkFieldDeviationsSchema,
  catalogueKindSchema,
  type ArtworkAvailability,
  type ArtworkRead,
  type ArtworkStatus,
  type CatalogueKind,
  type CatalogueRead,
  type CatalogueRole,
  type CatalogueMember,
  type ImageVariantKey,
  type InvitationSummary,
  type Timestamp,
} from "@arcula/shared";
import { ApiError } from "./errors";
import type { CatalogueAudience } from "./access";
import {
  extensionFor,
  finalDocumentKey,
  finalPhotoKey,
  mediaUrl,
} from "./media/keys";
import { DOCUMENT_VARIANT_SPECS, IMAGE_VARIANTS } from "./media/variants";

export type CatalogueRow = typeof cataloguesTable.$inferSelect;
export type ArtworkRow = typeof artworksTable.$inferSelect;
export type PhotoRow = typeof artworkPhotosTable.$inferSelect;
export type DocumentRow = typeof artworkDocumentsTable.$inferSelect;
export type VariantRow = typeof artworkPhotoVariantsTable.$inferSelect;
export type InvitationRow = typeof catalogueInvitationsTable.$inferSelect;

/** The dashboard list's per-row extras. Absent on every other read, which is
 *  what keeps the otherwise-identical documents distinguishable: a shared row
 *  carries `role` and `ownerName`, an owned one `role` alone.
 *
 *  `audience` is not per-row data: it says the caller is the owner or a
 *  collaborator, which is what makes the catalogue's password state theirs
 *  to see. The value itself is derived below from `passwordHash` — the hash is
 *  never a document field, under any read. */
export interface SerializeCatalogueOptions {
  role?: CatalogueRole;
  ownerName?: string;
  audience?: CatalogueAudience;
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

/** The catalogue kind the schema's check constraint permits. Deliberately
 *  named for the catalogue: `kindOf` above is the document's kind. */
const catalogueKindOf = (kind: string): CatalogueKind => {
  const parsed = catalogueKindSchema.safeParse(kind);
  if (!parsed.success) {
    throw new ApiError("internal", `Unrecognized catalogue kind ${kind}`);
  }
  return parsed.data;
};

/** The market state the schema's check constraint permits; null is the
 *  absence of one, which is a fact the member read carries. A stored value
 *  outside the four words is a server bug. */
const availabilityOf = (value: string | null): ArtworkAvailability | null => {
  if (value === null) return null;
  const parsed = artworkAvailabilitySchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      "internal",
      `Unrecognized artwork availability ${value}`,
    );
  }
  return parsed.data;
};

/** The skin-option value vocabulary `catalogueUpdateSchema` admits. */
export const isSkinOptions = (
  value: unknown,
): value is NonNullable<CatalogueRead["skinOptions"]> => {
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
  catalogueId: string,
  artworkId: string,
  selectionId?: string,
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
      catalogueId,
      artworkId,
      row.id,
      "original",
      extOf(originalType, `photo ${row.id} original`),
    ),
    selectionId,
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
            catalogueId,
            artworkId,
            row.id,
            key,
            extOf(v.contentType, `photo ${row.id} variant ${key}`),
          ),
          selectionId,
        ),
      ),
    ),
  };
}

function serializeDocument(
  row: DocumentRow,
  variants: VariantRow[],
  namespaceId: string,
  catalogueId: string,
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
          catalogueId,
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
                catalogueId,
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
 *  `namespaceId` is the catalogue's fixed media namespace
 *  (`mediaNamespaceOf`), not the artwork's `userId`: a transfer changes the
 *  owner and must leave every URL pointing at the same object.
 *
 *  `audience` decides whether `availability` — a member-facing market fact —
 *  is on the document at all: a member read carries the key (null included),
 *  and a visitor's read does not, though the row stores the value either way.
 *
 *  `options.selectionId` is the Selection scope: every **photo** URL gains
 *  `&selection={id}`, so the media proxy can admit a Draft's image through the
 *  Selection that curates it. Documents never take it — a Selection is a way to
 *  read works, not a second way to read their certificates. */
export interface SerializeArtworkOptions {
  /** The Selection whose works read is emitting this document. */
  selectionId?: string;
}

export function serializeArtwork(
  joined: ArtworkJoined,
  namespaceId: string,
  audience: CatalogueAudience,
  options: SerializeArtworkOptions = {},
): ArtworkRead {
  const { artwork, photos, documents, variants } = joined;
  const byParent = new Map<string, VariantRow[]>();
  for (const v of variants) {
    const list = byParent.get(v.parentId);
    if (list) list.push(v);
    else byParent.set(v.parentId, [v]);
  }

  const document: ArtworkRead = {
    id: artwork.id,
    userId: artwork.userId,
    title: artwork.title,
    artistName: artwork.artistName,
    documents: documents.map((d) =>
      serializeDocument(
        d,
        byParent.get(d.id) ?? [],
        namespaceId,
        artwork.catalogueId,
        artwork.id,
      ),
    ),
    photos: photos.map((p) =>
      serializePhoto(
        p,
        byParent.get(p.id) ?? [],
        namespaceId,
        artwork.catalogueId,
        artwork.id,
        options.selectionId,
      ),
    ),
    catalogueId: artwork.catalogueId,
    status: statusOf(artwork.status),
    deletedAt: wireTimestampOrNull(artwork.deletedAt),
    createdAt: wireTimestamp(artwork.createdAt),
    updatedAt: wireTimestamp(artwork.updatedAt),
    // A blank field is an ABSENT key, not a null value — the document shape.
    ...presentTextFields(artwork),
  };
  // A member sees the absence of a market state as a fact (null, not a missing
  // key); a visitor does not see the key at all.
  if (audience === "member") {
    document.availability = availabilityOf(artwork.availability);
  }
  return document;
}

/** The exact wire catalogue document shape.
 *
 *  `role`/`ownerName` are the dashboard list's additions: the signed-in list
 *  passes the viewer's role on every row, and the owner's display name on a
 *  shared one. Every other read — the public list, the single read — is
 *  anonymous, so it emits the plain document, which is the shape the public
 *  pages have always parsed. */
export function serializeCatalogue(
  row: CatalogueRow,
  opts: SerializeCatalogueOptions = {},
): CatalogueRead {
  const out: CatalogueRead = {
    id: row.id,
    name: row.name,
    kind: catalogueKindOf(row.kind),
    userId: row.userId,
    isPublic: row.isPublic,
    createdAt: wireTimestamp(row.createdAt),
    updatedAt: wireTimestamp(row.updatedAt),
  };
  if (opts.role !== undefined) out.role = opts.role;
  if (opts.ownerName !== undefined) out.ownerName = opts.ownerName;
  // A member's fact, derived from the hash's presence. An anonymous read does
  // not carry it at all — not even `false` — and the hash itself is never on
  // the wire.
  if (opts.audience === "member") {
    out.isPasswordProtected = row.passwordHash !== null;
  }
  if (row.description !== null) out.description = row.description;
  // `skin`/`skinOptions` are read-time defaulted on the client side
  // (resolveSkin), so an unset value is an absent key.
  if (row.skin !== null) out.skin = row.skin;
  if (row.skinOptions !== null) {
    if (!isSkinOptions(row.skinOptions)) {
      throw new ApiError("internal", "Malformed catalogue skin options");
    }
    out.skinOptions = row.skinOptions;
  }
  // The deviations ride every audience — a visitor building the public PDF
  // resolves the same enabled set from them. They reveal only which fields a
  // catalogue records, and an absent column is an absent key (pure defaults).
  if (row.artworkFields !== null) {
    const parsed = artworkFieldDeviationsSchema.safeParse(row.artworkFields);
    if (!parsed.success) {
      throw new ApiError("internal", "Malformed catalogue artwork fields");
    }
    out.artworkFields = parsed.data;
  }
  return out;
}

/** A person's display name, falling back to their email — the rule the
 *  dashboard uses for a shared catalogue's owner, and the offer previews use
 *  for the inviter. */
export const displayName = (name: string | null, email: string): string => {
  const trimmed = name?.trim();
  return trimmed ? trimmed : email;
};

/** How an inviter is named to somebody who is not a member yet. The address is
 *  deliberately NOT the fallback — `displayName`'s rule would hand the
 *  inviter's email to the invited account, and to a visitor on the public
 *  preview. */
export const inviterDisplayName = (name: string | null): string => {
  const trimmed = name?.trim();
  return trimmed ? trimmed : "An Arcula member";
};

/** One account with access, as the access read names it. */
export function serializeMember(row: {
  id: string;
  name: string | null;
  email: string;
}): CatalogueMember {
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
    catalogueId: row.catalogueId,
    email: row.email,
    invitedByUserId: row.invitedByUserId,
    status: row.status as InvitationSummary["status"],
    createdAt: wireTimestamp(row.createdAt),
    expiresAt: wireTimestamp(row.expiresAt),
    resolvedAt: row.resolvedAt === null ? null : wireTimestamp(row.resolvedAt),
  };
}
