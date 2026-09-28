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
// Certificates and photos are always written (as [] until uploads land) and
// collectionId/userId are always supplied by the creating code path.
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
  certificates: FileReference[]; // Array of file references
  notes?: string;
  condition?: string;
  currentValue?: string;
  photos: FileReference[]; // Array of file references
  collectionId: string; // Reference to parent collection
  // Public visibility, owned by the artwork — independent of its collection's
  // isPublic. A public collection may keep individual works private (and, by
  // symmetry, a work flagged public stays readable by direct id even inside a
  // private collection; the collection gate hides it from the page). Always
  // written — see the schema in src/schemas/artwork.ts.
  isPublic: boolean;
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

// File reference type (could be URL or metadata)
export interface FileReference {
  url?: string;
  name?: string;
  size?: number;
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}
