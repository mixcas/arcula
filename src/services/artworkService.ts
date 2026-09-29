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
  writeBatch,
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
        // Soft-delete marker, live from the start. Written *explicitly* as null
        // rather than left out, because the list queries filter on
        // `deletedAt == null` and a missing field is not reliably equivalent to
        // null on the query side (the Firestore emulator does not match it at
        // all, which is how this was found). Rules treat an absent field as
        // null too, via data.get("deletedAt", null), so writing it out costs
        // nothing there and keeps the create path independent of that
        // ambiguity.
        deletedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return docRef.id;
    } catch (error) {
      console.error("Error creating artwork:", error);
      throw error;
    }
  },

  // Bulk-create artworks (CSV import). Each document is written exactly as the
  // single-create path would — server timestamps stamped last — but inside a
  // writeBatch, so a whole chunk commits atomically and costs one round trip
  // per chunk rather than one per artwork. Firestore batches are capped at 500
  // writes per commit; chunks of 400 stay safely under that. A failed chunk
  // stops the run and reports the remainder as failed rather than continuing.
  async createArtworks(
    artworks: Omit<Artwork, "id">[],
    onProgress?: (done: number, total: number) => void,
  ): Promise<{ created: number; failed: number }> {
    const CHUNK_SIZE = 400;
    let created = 0;
    let failed = 0;

    for (let i = 0; i < artworks.length; i += CHUNK_SIZE) {
      const chunk = artworks.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const artworkData of chunk) {
        batch.set(doc(collection(db, ARTWORKS_COLLECTION)), {
          ...artworkData,
          // Same explicit live marker as the single-create path — see the note
          // there on why this is null rather than absent.
          deletedAt: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      try {
        await batch.commit();
        created += chunk.length;
      } catch (error) {
        console.error("Error creating artwork batch:", error);
        // Stop on the first failing chunk; everything left counts as failed.
        failed += artworks.length - created;
        break;
      }
      onProgress?.(created, artworks.length);
    }

    return { created, failed };
  },

  // Get a collection's artworks for its owner.
  //
  // Filters on the owner too so the rules can authorize the query with a pure
  // `isOwner(resource.data.userId)` field check rather than a dependent read.
  // Needs the (collectionId, userId, deletedAt) composite index.
  //
  // `deletedAt == null` is what keeps soft-deleted works out of the list. It is
  // not decoration: the rules deny a visitor read of a deleted work, and rules
  // are not filters, so a list whose result set could span one is denied
  // outright. Documents created before soft deletes existed have no such field
  // at all, which is why every create path now writes it explicitly as null
  // rather than relying on absent-field matching (see createArtwork).
  async getCollectionArtworks(
    collectionId: string,
    userId: string,
  ): Promise<Artwork[]> {
    try {
      const q = query(
        collection(db, ARTWORKS_COLLECTION),
        where("collectionId", "==", collectionId),
        where("userId", "==", userId),
        where("deletedAt", "==", null),
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

  // Get the publicly visible, not-deleted artworks of a collection, for a
  // logged-out visitor. isPublic is each artwork's own flag (independent of the
  // collection's); the rules authorize this share of the list with a pure
  // `resource.data.isPublic == true` check. Needs the
  // (collectionId, isPublic, deletedAt) composite index.
  async getPublicCollectionArtworks(collectionId: string): Promise<Artwork[]> {
    try {
      const q = query(
        collection(db, ARTWORKS_COLLECTION),
        where("collectionId", "==", collectionId),
        where("isPublic", "==", true),
        where("deletedAt", "==", null),
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

  // Soft-delete artworks: stamp `deletedAt` and keep the document. Reversible —
  // restoring is a plain `updateArtwork(id, { deletedAt: null })`, the mirror
  // image of this write (and deliberately *not* `deleteField()`, which would
  // leave a document the list queries cannot see). Chunked like createArtworks,
  // so a large batch still commits in a handful of round trips. The whole batch
  // is rejected if any single document is denied (the rules check the parent
  // collection only on create, so an owner soft-deleting their own works always
  // passes) — a failure here is thrown, never partially applied.
  async softDeleteArtworks(artworkIds: string[]): Promise<void> {
    const CHUNK_SIZE = 400;

    for (let i = 0; i < artworkIds.length; i += CHUNK_SIZE) {
      const chunk = artworkIds.slice(i, i + CHUNK_SIZE);
      const batch = writeBatch(db);
      for (const artworkId of chunk) {
        batch.update(doc(db, ARTWORKS_COLLECTION, artworkId), {
          deletedAt: serverTimestamp(),
          // Stamped last, like every other write path: the rules require
          // updatedAt == request.time on update.
          updatedAt: serverTimestamp(),
        });
      }
      try {
        await batch.commit();
      } catch (error) {
        console.error("Error soft-deleting artworks:", error);
        throw error;
      }
    }
  },

  // Permanently remove an artwork. Unused — the UI only ever soft-deletes —
  // but kept because the rules admit it for the owner and a permanent purge
  // (with a Cloud Function) may want it.
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
