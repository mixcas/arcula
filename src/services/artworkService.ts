import {
  collection,
  addDoc,
  getDoc,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { Artwork, ArtworkUpdate } from "../types";

const ARTWORKS_COLLECTION = "artworks";

export const artworkService = {
  // Create a new artwork
  async createArtwork(artworkData: Omit<Artwork, "id">): Promise<string> {
    try {
      // Timestamps are stamped last so a caller cannot override them.
      const docRef = await addDoc(collection(db, ARTWORKS_COLLECTION), {
        ...artworkData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (error) {
      console.error("Error creating artwork:", error);
      throw error;
    }
  },

  // Get a collection's artworks for its owner.
  //
  // Filters on the owner too so the rules can authorize the query with a pure
  // `isOwner(resource.data.userId)` field check rather than a dependent read.
  // This needs the (collectionId, userId) composite index.
  async getCollectionArtworks(
    collectionId: string,
    userId: string,
  ): Promise<Artwork[]> {
    try {
      const q = query(
        collection(db, ARTWORKS_COLLECTION),
        where("collectionId", "==", collectionId),
        where("userId", "==", userId),
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Artwork[];
    } catch (error) {
      console.error("Error fetching collection artworks:", error);
      throw error;
    }
  },

  // Get the publicly visible artworks of a collection, for a logged-out
  // visitor. isPublic is each artwork's own flag (independent of the
  // collection's); the rules authorize this share of the list with a pure
  // `resource.data.isPublic == true` check. Needs the (collectionId, isPublic)
  // composite index.
  async getPublicCollectionArtworks(collectionId: string): Promise<Artwork[]> {
    try {
      const q = query(
        collection(db, ARTWORKS_COLLECTION),
        where("collectionId", "==", collectionId),
        where("isPublic", "==", true),
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Artwork[];
    } catch (error) {
      console.error("Error fetching public collection artworks:", error);
      throw error;
    }
  },

  // Get a specific artwork by ID
  async getArtwork(artworkId: string): Promise<Artwork | null> {
    try {
      const docRef = doc(db, ARTWORKS_COLLECTION, artworkId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data(),
        } as Artwork;
      }

      return null;
    } catch (error) {
      console.error("Error fetching artwork:", error);
      throw error;
    }
  },

  // Update an artwork
  //
  // Takes ArtworkUpdate rather than Partial<Artwork> so callers can pass a
  // deleteField() sentinel for a field they cleared — `updateDoc` merges, so
  // merely omitting a key would leave the stored value in place. `updatedAt`
  // is stamped last so a caller cannot override it, but a `deleteField()` for
  // that exact key would still take precedence; no caller sends one.
  async updateArtwork(
    artworkId: string,
    updateData: ArtworkUpdate,
  ): Promise<void> {
    try {
      const docRef = doc(db, ARTWORKS_COLLECTION, artworkId);
      await updateDoc(docRef, {
        ...updateData,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error updating artwork:", error);
      throw error;
    }
  },

  // Delete an artwork
  async deleteArtwork(artworkId: string): Promise<void> {
    try {
      const docRef = doc(db, ARTWORKS_COLLECTION, artworkId);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("Error deleting artwork:", error);
      throw error;
    }
  },
};
