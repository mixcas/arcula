import {
  collection,
  addDoc,
  getDocs,
  getDoc,
  doc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";
import { Collection, CollectionUpdate } from "../types";

const COLLECTIONS_COLLECTION = "collections";

export const collectionService = {
  // Create a new collection
  async createCollection(
    collectionData: Omit<Collection, "id">,
  ): Promise<string> {
    try {
      // Defaults first so an explicit caller value still wins; timestamps
      // stamped last so a caller cannot override them. Collections are public
      // by default — flip Privacy in Settings to make one private.
      const docRef = await addDoc(collection(db, COLLECTIONS_COLLECTION), {
        isPublic: true,
        artworks: [],
        ...collectionData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (error) {
      console.error("Error creating collection:", error);
      throw error;
    }
  },

  // Get all collections for a user
  async getUserCollections(userId: string): Promise<Collection[]> {
    try {
      const q = query(
        collection(db, COLLECTIONS_COLLECTION),
        where("userId", "==", userId),
        orderBy("name"),
      );

      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Collection[];
    } catch (error) {
      console.error("Error fetching user collections:", error);
      throw error;
    }
  },

  // Get a specific collection by ID
  async getCollection(collectionId: string): Promise<Collection | null> {
    try {
      const docRef = doc(db, COLLECTIONS_COLLECTION, collectionId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data(),
        } as Collection;
      }

      return null;
    } catch (error) {
      console.error("Error fetching collection:", error);
      throw error;
    }
  },

  // Update a collection
  async updateCollection(
    collectionId: string,
    updateData: CollectionUpdate,
  ): Promise<void> {
    try {
      const docRef = doc(db, COLLECTIONS_COLLECTION, collectionId);
      await updateDoc(docRef, {
        ...updateData,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error("Error updating collection:", error);
      throw error;
    }
  },

  // Delete a collection
  async deleteCollection(collectionId: string): Promise<void> {
    try {
      const docRef = doc(db, COLLECTIONS_COLLECTION, collectionId);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("Error deleting collection:", error);
      throw error;
    }
  },
};
