import { FieldValue, Timestamp } from "firebase/firestore";

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
  passwordHash?: string; // Optional password protection
  artworks?: string[]; // Array of artwork IDs
  // Stamped by collectionService, not by callers. Firestore returns a
  // Timestamp on read — a `Date` written by the client comes back as one.
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

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
  // page, not in the public artwork view, and refused by storage.rules to
  // anyone but the owner.
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
  // by default in every write path — see the schema in src/schemas/artwork.ts.
  // Always written by the creating paths.
  isPublic: boolean;
  // Soft delete. `null` means live; a timestamp means deleted and the document
  // is kept (reversible). Stamped and cleared by artworkService only — the
  // Add/Edit form has no such field, so editing a deleted work leaves it
  // deleted. Written explicitly as null by every create path: the list queries
  // filter on `deletedAt == null`, and a *missing* field is not equivalent to
  // null there (the emulator does not match it at all), so leaving it out would
  // risk hiding the work from every list. Artworks written before this field
  // existed have no `deletedAt`; rules tolerate that via
  // data.get("deletedAt", null), so they stay publicly readable.
  deletedAt?: Timestamp | null;
  // Stamped by artworkService, not by callers.
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// Payload for artworkService.updateArtwork.
//
// `updateDoc` merges, so a key that is simply absent leaves the stored field
// alone — which would make it impossible to clear a value once it is set. Any
// field may therefore also carry a `deleteField()` sentinel to remove it.
// Written as a mapped type rather than `Record<string, unknown>` so the usual
// type checking survives: a wrong value type or an unknown key is still an
// error, it just widens to accept the sentinel.
export type ArtworkUpdate = {
  [K in keyof Omit<Artwork, "id">]?: Artwork[K] | FieldValue;
};

// Fields shared by both kinds of "other document".
interface ArtworkDocumentBase {
  // Firestore-style id, minted client-side. It appears in every generated
  // filename, which is what makes a document's objects findable and safe to
  // delete as a group.
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
// The keys are the contract: they name the generated files in Firebase Storage
// and they are matched by `storage.rules`, so adding a variant means changing
// that rule too. The sizes live in `IMAGE_VARIANTS` (src/utils/imageVariants.ts)
// — this type is only the key space.
export type ImageVariantKey = "square_lg" | "square_sm" | "large" | "medium";

// One generated derivative of an uploaded image.
//
// `contentType` is recorded per variant rather than assumed, because the
// encoder is a capability check and not every browser agrees: WebP where the
// canvas can encode it, JPEG everywhere else. See src/utils/imageProcessing.ts.
export interface ImageVariant {
  key: ImageVariantKey;
  url: string; // Firebase Storage download URL
  width: number; // Actual encoded pixels, not the nominal target
  height: number;
  size: number; // Bytes
  contentType: string;
}

// An image attached to an artwork.
//
// `order` is the explicit sequence; index 0 is the primary thumbnail used
// across the app. It is kept consistent with the array position by
// `reindexPhotos` on every write — see src/utils/artworkPhotos.ts for why the
// field and the array are not allowed to disagree.
export interface ArtworkPhoto {
  // Firestore-style document id, minted client-side. It appears in every
  // generated filename, so it is what makes a photo's objects findable and
  // safe to delete as a group.
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
