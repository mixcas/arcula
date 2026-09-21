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
  isPublic: boolean;
  passwordHash?: string; // Optional password protection
  artworks: string[]; // Array of artwork IDs
}

// Artwork type
export interface Artwork {
  id: string;
  title: string;
  serie: string;
  artistName: string;
  dateOfCreation: string;
  medium: string;
  dimensions: string;
  acquisitionDate: string;
  acquisitionPrice: number;
  placeOfOrigin: string;
  certificates: FileReference[]; // Array of file references
  notes: string;
  condition: string;
  currentValue: number;
  photos: FileReference[]; // Array of file references
  collectionId: string; // Reference to parent collection
}

// File reference type (could be URL or metadata)
export interface FileReference {
  url?: string;
  name?: string;
  size?: number;
  type?: string;
  metadata?: any;
}