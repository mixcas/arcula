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
import { Artwork } from "../types";

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

  // Get all artworks for a collection
  async getCollectionArtworks(collectionId: string): Promise<Artwork[]> {
    try {
      const q = query(
        collection(db, ARTWORKS_COLLECTION),
        where("collectionId", "==", collectionId),
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
  async updateArtwork(
    artworkId: string,
    updateData: Partial<Artwork>,
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
