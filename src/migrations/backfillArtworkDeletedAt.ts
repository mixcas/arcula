import {
  collection,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Firestore,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import type { Migration } from "./types";

const ARTWORKS_COLLECTION = "artworks";
const CHUNK_SIZE = 400;

/**
 * Every artwork this account owns, with no filter on `deletedAt`.
 *
 * This is the query the migration is *for*, and it is the only way to reach a
 * legacy document at all: the app's own list query filters on
 * `deletedAt == null`, which does not match a document that has no such field,
 * so a legacy artwork is invisible to exactly the query that would find it.
 * Selecting on `userId` alone is safe under the rules (`isOwner` passes for
 * every document it returns) and needs no composite index.
 */
function ownerArtworks(db: Firestore, userId: string) {
  return query(
    collection(db, ARTWORKS_COLLECTION),
    where("userId", "==", userId),
  );
}

/**
 * A document is legacy if the field is *absent*. An explicit `null` is the
 * target shape already (`deletedAt: null` means live), so it is left alone —
 * which is what makes this migration idempotent.
 */
function isMissingDeletedAt(snapshot: QueryDocumentSnapshot): boolean {
  return !("deletedAt" in snapshot.data());
}

export const backfillArtworkDeletedAt: Migration = {
  id: "2026-09-28-artwork-deleted-at",
  label: "Add deletedAt to existing artworks",
  description:
    "Artworks saved before soft delete have no deletedAt field, and the " +
    "artwork lists filter on deletedAt == null, so those works are hidden " +
    "from their own collection. This writes an explicit null on every one.",

  async countPending(db, userId) {
    const snapshot = await getDocs(ownerArtworks(db, userId));
    return snapshot.docs.filter(isMissingDeletedAt).length;
  },

  async run(db, userId) {
    const snapshot = await getDocs(ownerArtworks(db, userId));
    const legacy = snapshot.docs.filter(isMissingDeletedAt);

    for (let i = 0; i < legacy.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      for (const artwork of legacy.slice(i, i + CHUNK_SIZE)) {
        batch.update(artwork.ref, {
          deletedAt: null,
          // The rules require `updatedAt == request.time` on every update, and
          // serverTimestamp() resolves to the batch's commit time — the same
          // value. Stamped last, like every other write path.
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
    }

    return { updated: legacy.length };
  },
};
