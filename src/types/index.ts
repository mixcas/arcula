import { Timestamp } from "firebase/firestore";

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
  acquisitionPrice?: number;
  placeOfOrigin?: string;
  provenance?: string;
  certificates: FileReference[]; // Array of file references
  notes?: string;
  condition?: string;
  currentValue?: number;
  photos: FileReference[]; // Array of file references
  collectionId: string; // Reference to parent collection
  // Stamped by artworkService, not by callers.
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

// File reference type (could be URL or metadata)
export interface FileReference {
  url?: string;
  name?: string;
  size?: number;
  type?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
}
