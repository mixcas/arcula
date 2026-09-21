import { 
  collection, 
  addDoc, 
  getDocs, 
  doc, 
  updateDoc, 
  deleteDoc,
  query,
  where,
  orderBy
} from 'firebase/firestore';
import { db } from './firebase';
import { Collection } from '../types';

const COLLECTIONS_COLLECTION = 'collections';

export const collectionService = {
  // Create a new collection
  async createCollection(collectionData: Omit<Collection, 'id'>): Promise<string> {
    try {
      const docRef = await addDoc(collection(db, COLLECTIONS_COLLECTION), collectionData);
      return docRef.id;
    } catch (error) {
      console.error('Error creating collection:', error);
      throw error;
    }
  },

  // Get all collections for a user
  async getUserCollections(userId: string): Promise<Collection[]> {
    try {
      const q = query(
        collection(db, COLLECTIONS_COLLECTION),
        where("userId", "==", userId),
        orderBy("name")
      );
      
      const querySnapshot = await getDocs(q);
      return querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Collection[];
    } catch (error) {
      console.error('Error fetching user collections:', error);
      throw error;
    }
  },

  // Get a specific collection by ID
  async getCollection(collectionId: string): Promise<Collection | null> {
    try {
      const docRef = doc(db, COLLECTIONS_COLLECTION, collectionId);
      const docSnap = await getDocs(docRef);
      
      if (docSnap.exists()) {
        return {
          id: docSnap.id,
          ...docSnap.data()
        } as Collection;
      }
      
      return null;
    } catch (error) {
      console.error('Error fetching collection:', error);
      throw error;
    }
  },

  // Update a collection
  async updateCollection(collectionId: string, updateData: Partial<Collection>): Promise<void> {
    try {
      const docRef = doc(db, COLLECTIONS_COLLECTION, collectionId);
      await updateDoc(docRef, updateData);
    } catch (error) {
      console.error('Error updating collection:', error);
      throw error;
    }
  },

  // Delete a collection
  async deleteCollection(collectionId: string): Promise<void> {
    try {
      const docRef = doc(db, COLLECTIONS_COLLECTION, collectionId);
      await deleteDoc(docRef);
    } catch (error) {
      console.error('Error deleting collection:', error);
      throw error;
    }
  }
};