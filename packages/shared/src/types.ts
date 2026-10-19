// `Timestamp` is the wire shape the API serializer emits:
// `{ seconds, nanoseconds }`. The plain interface carries those two fields and
// nothing else — no methods for the client to ignore.
export interface Timestamp {
  seconds: number;
  nanoseconds: number;
}

// User type
export interface User {
  uid: string;
  email: string;
  name: string;
  collections: string[]; // Array of collection IDs
}

// Collection type
export interface Collection {
  id: string;
  name: string;
  userId: string; // Reference to the owner
  description?: string;
  isPublic?: boolean;
  artworks?: string[]; // Array of artwork IDs
  // Which skin renders this collection's public view. An unknown or absent id
  // falls back to DEFAULT_SKIN_ID — see apps/web/src/skins/registry.ts.
  //
  // Nothing ever queries on `skin`: it is read off a row already fetched by id
  // and defaulted at read time, so a collection that never set it simply
  // renders the default skin. A backfill would buy nothing.
  skin?: string;
  // The chosen skin's own option vocabulary, validated at read time against
  // that skin's `options` — an unknown key is dropped and a wrong type falls
  // back to the default, so a stale or hand-edited value cannot corrupt a
  // collection. Nothing outside the skin reads it.
  skinOptions?: Record<string, boolean | number | string>;
  // Stamped by collectionService, not by callers.
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// The owner's choice for a work: `published` puts it in front of the
// collection's gate, `draft` keeps it inside. Absent on a document written
// before the field existed, and absent reads as `published` — the same reading
// the old per-work flag gets.
export type ArtworkStatus = "draft" | "published";

// Artwork type
//
// Only `title` and `artistName` are required; every other descriptive field is
// optional so an absent key can be distinguished from a set-but-empty value.
// `documents` and `photos` are always written — as [] when the artwork has
// none — so a reader never has to distinguish an absent field from an empty
// list, and collectionId/userId are always supplied by the creating code path.
export interface Artwork {
  id: string;
  userId: string; // Reference to the owner
  title: string;
  serie?: string;
  artistName: string;
  dateOfCreation?: string;
  media?: string;
  dimensions?: string;
  editions?: string;
  acquisitionDate?: string;
  // Money is stored as the string that was typed, not as a number. Nothing
  // does arithmetic on these yet, and keeping them textual avoids binary float
  // drift on values that are decimal by nature.
  acquisitionPrice?: string;
  placeOfOrigin?: string;
  provenance?: string;
  // Up to MAX_ARTWORK_DOCUMENTS. Never public: not in the public collection
  // page, not in the public artwork view, and served only to the owner —
  // media reads re-check visibility per request.
  documents: ArtworkDocument[];
  notes?: string;
  condition?: string;
  currentValue?: string;
  photos: ArtworkPhoto[]; // Ordered, up to MAX_ARTWORK_PHOTOS. Index 0 is the primary thumbnail
  collectionId: string; // Reference to parent collection
  // Public visibility, owned by the artwork — independent of its collection's
  // isPublic. A public collection may keep individual works private (and, by
  // symmetry, a work flagged public stays readable by direct id even inside a
  // private collection; the collection gate hides it from the page). Public
  // by default in every write path — see packages/shared/src/schemas/artwork.ts.
  // Always written by the creating paths.
  isPublic: boolean;
  // The owner's choice a visitor is gated on. Present beside the old flag
  // while the sequence moves the API and the web onto it; absent on an older
  // document and read as `published`. No code on this release branches on it —
  // it is carried, not obeyed.
  status?: ArtworkStatus;
  // Soft delete. `null` means live; a timestamp means deleted and the row is
  // kept (reversible). Stamped and cleared by artworkService only — the
  // Add/Edit form has no such field, so editing a deleted work leaves it
  // deleted. Every create path writes it explicitly as null: the list queries
  // filter on `deletedAt IS NULL`, so leaving it out would hide the work from
  // every list.
  deletedAt?: Timestamp | null;
  // Stamped by artworkService, not by callers.
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// Fields shared by both kinds of "other document".
interface ArtworkDocumentBase {
  // An opaque, hyphen-free id, minted client-side. It appears in every
  // generated filename, which is what makes a document's objects findable and
  // safe to delete as a group.
  id: string;
  // The user's original filename, preserved. This field cares about it, unlike
  // photos, where it is only a label. Still metadata only — it is never used to
  // build a storage path, so no sanitization of it is needed anywhere.
  name: string;
  size: number;
  contentType: string;
  // The unmodified upload. For an image this is the archival source; the
  // variants beside it are display derivatives.
  original: { url: string; size: number; contentType: string };
}

// A non-image attachment (a PDF, today). No variants, no dimensions, no
// `order`: this list has no sequence and no primary thumbnail, so there is
// nothing for those fields to mean.
export interface ArtworkDocumentFile extends ArtworkDocumentBase {
  kind: "file";
}

// An image attached as a document. Structurally a photo minus `order`, which
// is what lets it reuse `photoUrl` and the preview modal — both of which are
// typed on the variants, not on the sequence.
export interface ArtworkDocumentImage extends ArtworkDocumentBase {
  kind: "image";
  width: number;
  height: number;
  variants: ImageVariant[];
}

// A discriminated union rather than one shape with optional fields: "does this
// have variants" decides both the tile and the open behaviour, and making them
// optional would mean re-checking the same condition at every call site.
export type ArtworkDocument = ArtworkDocumentFile | ArtworkDocumentImage;

// The standard image variants generated for every artwork photo.
//
// The keys are the contract: they name the objects the API writes under S3
// (`apps/api/src/media/keys.ts`) and the geometry each gets
// (`apps/api/src/media/variants.ts`), so adding a variant is a change to the
// API's table. This type is only the key space.
//
// Reads still go through `photoUrl`/`photoSrcSet` rather than indexing
// `variants` by key.
export type ImageVariantKey =
  "xlarge" | "square_lg" | "square_sm" | "large" | "medium";

// One generated derivative of an uploaded image.
//
// `contentType` is recorded per variant rather than assumed: the server's
// encoder picks the format (WebP today) and the client only ever displays
// what it was told.
export interface ImageVariant {
  key: ImageVariantKey;
  url: string; // The API media proxy path that serves this object
  width: number; // Actual encoded pixels, not the nominal target
  height: number;
  size: number; // Bytes
  contentType: string;
}

// An image attached to an artwork.
//
// `order` is the explicit sequence; index 0 is the primary thumbnail used
// across the app. It is kept consistent with the array position by
// `reindexPhotos` on every write — see packages/shared/src/artworkPhotos.ts for why the
// field and the array are not allowed to disagree.
export interface ArtworkPhoto {
  // An opaque, hyphen-free document id, minted client-side. It appears in
  // every generated filename, so it is what makes a photo's objects findable
  // and safe to delete as a group.
  id: string;
  order: number;
  // The user's original filename. Metadata only — it is never used to build a
  // storage path, so no sanitization of it is needed anywhere.
  name: string;
  size: number; // Original bytes
  contentType: string; // Source MIME type
  width: number; // Source pixel dimensions
  height: number;
  // The unmodified upload, kept alongside the variants. For a catalogue the
  // source is the archival record; the variants are display derivatives.
  original: { url: string; size: number; contentType: string };
  variants: ImageVariant[];
}
