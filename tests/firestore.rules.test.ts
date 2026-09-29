// Firestore security rules tests, run against the emulators.
//
// Executed via `bun run test:rules`, which wraps vitest in
// `firebase emulators:exec --only firestore,auth --project demo-custodia`.
// The PROJECT_ID here must match the emulator project so the rules-unit-testing
// contexts talk to the same Firestore. That string lives in two files — here and
// the `test:rules` script in package.json — and they must change together.
// TODO(arcula-rename): both still say demo-custodia; see RENAME.md.
// The emulator is seeded with rules
// disabled (admin credentials) and every assertion below goes through a
// real client context so the rules are enforced.
//
// Note on list rules: the rules authorize lists with per-document field checks
// (`resource.data.userId` / `resource.data.isPublic`), not
// `request.query.where` constraints — the emulator does not populate
// `request.query.where`, so query-constraint rules would deny every list and
// could never be asserted here. "Rules are not filters": a list whose result
// set spans a document the caller may not read fails the whole query.
//
// Note on the soft-delete rules — two emulator behaviours were measured while
// writing these tests, and both are worth knowing before trusting a green run:
//   1. A `where("deletedAt", "==", null)` clause does NOT match a document where
//      the field is missing on the emulator (it matches explicit nulls only).
//      That is why every create path in artworkService writes `deletedAt: null`
//      out right, and why the list tests below cannot replay the app's exact
//      three-clause query against a legacy document.
//   2. For a list, the emulator does not enforce the soft-delete clause
//      per-document: an anonymous `where isPublic == true` query comes back
//      *with* a soft-deleted work in the result, where production would deny
//      the whole query. The visitor `get` denial below is the part that is
//      genuinely enforced here, so that is what is asserted.
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Firestore,
  type QuerySnapshot,
} from "firebase/firestore";
import { backfillArtworkDeletedAt } from "@/migrations/backfillArtworkDeletedAt";

const PROJECT_ID = "demo-custodia";

const OWNER = "owner-1";
const OTHER = "other-1";

const RULES = readFileSync(
  new URL("../firestore.rules", import.meta.url),
  "utf8",
);

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES },
  });
});

afterEach(async () => {
  // Wipe the data so each test starts from a clean emulator, but keep the
  // environment alive — cleanup() in afterAll destroys it outright.
  await testEnv.clearFirestore();
});

afterAll(async () => {
  await testEnv.cleanup();
});

/**
 * Seed baseline documents with rules disabled. Write timestamps as plain
 * values — the rule's request.time guard only applies to client writes; the
 * seeded docs are only read by the assertions below.
 */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();

    // Collections
    await setDoc(doc(db, "collections/own-private"), {
      name: "Owner Private",
      userId: OWNER,
      isPublic: false,
    });
    await setDoc(doc(db, "collections/own-public"), {
      name: "Owner Public",
      userId: OWNER,
      isPublic: true,
    });
    await setDoc(doc(db, "collections/other"), {
      name: "Other Collection",
      userId: OTHER,
      isPublic: false,
    });

    // Artworks
    await setDoc(doc(db, "artworks/public-work"), {
      title: "Public Work",
      artistName: "Owner",
      collectionId: "own-public",
      userId: OWNER,
      isPublic: true,
    });
    await setDoc(doc(db, "artworks/private-work"), {
      title: "Private Work",
      artistName: "Owner",
      collectionId: "own-public",
      userId: OWNER,
      isPublic: false,
    });
    await setDoc(doc(db, "artworks/others-work"), {
      title: "Other Work",
      artistName: "Other",
      collectionId: "other",
      userId: OTHER,
      isPublic: true,
    });
  });
}

/**
 * Seed a soft-deleted artwork on top of `seed()`.
 *
 * Kept out of `seed()` so the visitor-list test that asserts exactly which
 * public works come back keeps asserting that — this document exists precisely
 * to make one list fail. A plain `Date` stands in for the `deletedAt` timestamp
 * the service stamps: rules only ever compare it against null, so the concrete
 * timestamp type is irrelevant here. */
async function seedDeleted() {
  await seed();
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "artworks/deleted-work"), {
      title: "Deleted Work",
      artistName: "Owner",
      collectionId: "own-public",
      userId: OWNER,
      isPublic: true,
      deletedAt: new Date(),
    });
  });
}

// ---- collections: writes ----------------------------------------------

describe("collections — writes", () => {
  it("lets the owner create a collection in their own name", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const ref = collection(db, "collections");
    await expect(
      addDoc(ref, {
        name: "New Collection",
        userId: OWNER,
        isPublic: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ).resolves.toBeDefined();
  });

  it("rejects creating a collection in someone else's name", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await expect(
      addDoc(collection(db, "collections"), {
        name: "Not Mine",
        userId: OTHER,
        isPublic: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ).rejects.toThrowError();
  });

  it("rejects client-supplied createdAt/updatedAt (timestamp guard)", async () => {
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await expect(
      addDoc(collection(db, "collections"), {
        name: "Spoofed Timestamps",
        userId: OWNER,
        isPublic: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrowError();
  });

  it("rejects an unauthenticated create", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await expect(
      addDoc(collection(db, "collections"), {
        name: "Anonymous",
        userId: "anon",
        isPublic: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ).rejects.toThrowError();
  });
});

// ---- collections: reads -----------------------------------------------

describe("collections — reads", () => {
  it("lets the owner read their own collection", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const snap = await getDoc(doc(db, "collections/own-private"));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.name).toBe("Owner Private");
  });

  it("hides a private collection from other users", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await expect(
      getDoc(doc(db, "collections/own-private")),
    ).rejects.toThrowError();
  });

  it("hides a private collection from anonymous visitors", async () => {
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    await expect(
      getDoc(doc(db, "collections/own-private")),
    ).rejects.toThrowError();
  });

  it("lets anonymous visitors read a public collection", async () => {
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await getDoc(doc(db, "collections/own-public"));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.isPublic).toBe(true);
  });

  it("allows an owner list only with a matching userId constraint", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();

    // The app's exact pattern (ManagePage): where userId == uid. Only the
    // caller's own collections match — "other" belongs to OTHER.
    const allowed = await getDocs(
      query(collection(db, "collections"), where("userId", "==", OWNER)),
    );
    expect(allowed.docs.map((d) => d.id).sort()).toEqual([
      "own-private",
      "own-public",
    ]);

    // A filter that cannot be satisfied by this caller's ownership.
    await expect(
      getDocs(
        query(collection(db, "collections"), where("userId", "==", OTHER)),
      ),
    ).rejects.toThrowError();

    // No constraint at all (scans everything) is denied closed.
    await expect(getDocs(collection(db, "collections"))).rejects.toThrowError();
  });

  it("denies an anonymous list of collections", async () => {
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    await expect(
      getDocs(
        query(collection(db, "collections"), where("userId", "==", OWNER)),
      ),
    ).rejects.toThrowError();
  });
});

// ---- artworks: reads --------------------------------------------------

describe("artworks — reads", () => {
  it("lets anonymous visitors read a public artwork", async () => {
    // This document has no `deletedAt` field at all — the legacy case, and the
    // canary for the soft-delete gate. Reading `resource.data.deletedAt` on a
    // missing field is an evaluation error in rules (which denies); the rule
    // therefore has to ask with `data.get("deletedAt", null)`, which answers
    // null for absent and for explicit null alike. If that regressed, this test
    // would fail.
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await getDoc(doc(db, "artworks/public-work"));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.isPublic).toBe(true);
  });

  it("hides a soft-deleted artwork from anonymous visitors", async () => {
    await seedDeleted();
    const db = testEnv.unauthenticatedContext().firestore();
    await expect(
      getDoc(doc(db, "artworks/deleted-work")),
    ).rejects.toThrowError();
  });

  it("keeps a soft-deleted artwork readable by its owner", async () => {
    // The owner branches of the match block are deliberately left without a
    // deletedAt check, so a trash/restore view can come later without touching
    // the rules. Only the visitor branches hide deleted works.
    await seedDeleted();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const snap = await getDoc(doc(db, "artworks/deleted-work"));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.deletedAt).toBeTruthy();
  });

  it("hides a private artwork from anonymous visitors", async () => {
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    await expect(
      getDoc(doc(db, "artworks/private-work")),
    ).rejects.toThrowError();
  });

  it("hides any artwork from a user who does not own it", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await expect(
      getDoc(doc(db, "artworks/private-work")),
    ).rejects.toThrowError();
  });

  it("lets an anonymous visitor list only isPublic == true artworks (one constraint)", async () => {
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();

    // The app's exact pattern (PublicCollectionPage): where isPublic == true,
    // over the collection. Single-field here so the emulator needs no index.
    const publicWorks = await getDocs(
      query(collection(db, "artworks"), where("isPublic", "==", true)),
    );
    expect(publicWorks.docs.map((d) => d.id).sort()).toEqual([
      "others-work",
      "public-work",
    ]);

    // Filtering for private works is not a path to the private list.
    await expect(
      getDocs(
        query(collection(db, "artworks"), where("isPublic", "==", false)),
      ),
    ).rejects.toThrowError();

    // No constraint is denied closed.
    await expect(getDocs(collection(db, "artworks"))).rejects.toThrowError();
  });

  it("lets the owner list all their own artworks", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const owned = await getDocs(
      query(collection(db, "artworks"), where("userId", "==", OWNER)),
    );
    expect(owned.docs.map((d) => d.id).sort()).toEqual([
      "private-work",
      "public-work",
    ]);
  });
});

// ---- artworks: writes -------------------------------------------------

describe("artworks — writes", () => {
  it("lets the owner add an artwork to their own collection", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await expect(
      addDoc(collection(db, "artworks"), {
        title: "New Work",
        artistName: "Owner",
        collectionId: "own-public",
        userId: OWNER,
        isPublic: false,
        // What artworkService.createArtwork actually writes: the live marker is
        // present and explicitly null, never absent. Asserted here so that a
        // future hasOnly-style create rule cannot start rejecting it.
        deletedAt: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ).resolves.toBeDefined();
  });

  it("lets a visitor read a newly created, live artwork", async () => {
    // The explicit `deletedAt: null` above has to satisfy the visitor gate too:
    // data.get("deletedAt", null) is null, so the work is public as written.
    await seed();
    const ownerDb = testEnv.authenticatedContext(OWNER).firestore();
    const ref = await addDoc(collection(ownerDb, "artworks"), {
      title: "Fresh Work",
      artistName: "Owner",
      collectionId: "own-public",
      userId: OWNER,
      isPublic: true,
      deletedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const visitorDb = testEnv.unauthenticatedContext().firestore();
    const snap = await getDoc(doc(visitorDb, `artworks/${ref.id}`));
    expect(snap.exists()).toBe(true);
  });

  it("rejects adding an artwork to someone else's collection", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await expect(
      addDoc(collection(db, "artworks"), {
        title: "Intrusion",
        artistName: "Owner",
        collectionId: "other",
        userId: OWNER,
        isPublic: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ).rejects.toThrowError();
  });

  it("lets the owner batch-create artworks into their own collection", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const batch = writeBatch(db);
    for (let i = 0; i < 3; i += 1) {
      const ref = doc(collection(db, "artworks"));
      batch.set(ref, {
        title: `Batch Work ${i}`,
        artistName: "Owner",
        collectionId: "own-public",
        userId: OWNER,
        isPublic: true,
        // The CSV import's createArtworks stamps timestamps via
        // serverTimestamp() inside a writeBatch; the rules require
        // createdAt/updatedAt == request.time, so this asserts the batch
        // path satisfies the same timestamp guard as single addDoc writes.
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await expect(batch.commit()).resolves.toBeUndefined();
  });

  it("rejects a batch where the writer does not own the parent collection", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    const batch = writeBatch(db);
    const ref = doc(collection(db, "artworks"));
    batch.set(ref, {
      title: "Batch Intrusion",
      artistName: "Other",
      collectionId: "own-public",
      userId: OTHER,
      isPublic: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // Any denied operation makes the whole batch fail atomically.
    await expect(batch.commit()).rejects.toThrowError();
  });

  it("rejects a mismatch between writer and artwork userId", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await expect(
      addDoc(collection(db, "artworks"), {
        title: "Spoofed Owner",
        artistName: "Other",
        collectionId: "own-public",
        userId: OWNER,
        isPublic: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ).rejects.toThrowError();
  });

  it("rejects client-supplied artwork timestamps", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await expect(
      addDoc(collection(db, "artworks"), {
        title: "Spoofed Timestamps",
        artistName: "Owner",
        collectionId: "own-public",
        userId: OWNER,
        isPublic: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrowError();
  });

  it("lets the owner update and delete their own artwork", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    const ref = doc(db, "artworks/private-work");

    await expect(
      updateDoc(ref, {
        title: "Renamed",
        updatedAt: serverTimestamp(),
      }),
    ).resolves.toBeUndefined();

    await expect(deleteDoc(ref)).resolves.toBeUndefined();
  });

  it("lets the owner soft-delete their own artwork, and restore it", async () => {
    await seed();
    const ownerDb = testEnv.authenticatedContext(OWNER).firestore();
    const ref = doc(ownerDb, "artworks/public-work");

    // A soft delete is an ordinary update with one extra field — the same
    // timestamp guard as any other write applies.
    await expect(
      updateDoc(ref, {
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ).resolves.toBeUndefined();

    // Gone from a visitor's view, whatever its isPublic flag says.
    const visitorDb = testEnv.unauthenticatedContext().firestore();
    await expect(
      getDoc(doc(visitorDb, "artworks/public-work")),
    ).rejects.toThrowError();

    // Still the owner's to read, and to bring back. The restore is the mirror
    // image of the delete — `deletedAt: null`, NOT deleteField(): the client
    // list queries filter on `deletedAt == null`, and a *missing* field is not
    // equivalent to null there, so removing the field would hide the restored
    // work from its own lists.
    await expect(getDoc(ref)).resolves.toBeDefined();
    await expect(
      updateDoc(ref, {
        deletedAt: null,
        updatedAt: serverTimestamp(),
      }),
    ).resolves.toBeUndefined();
    await expect(
      getDoc(doc(visitorDb, "artworks/public-work")),
    ).resolves.toBeDefined();
  });

  it("lets the owner batch soft-delete their own artworks", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    // The path artworkService.softDeleteArtworks takes: one writeBatch of
    // update() calls, each stamping deletedAt and a fresh server timestamp.
    const batch = writeBatch(db);
    for (const id of ["public-work", "private-work"]) {
      batch.update(doc(db, `artworks/${id}`), {
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await expect(batch.commit()).resolves.toBeUndefined();

    const visitorDb = testEnv.unauthenticatedContext().firestore();
    await expect(
      getDoc(doc(visitorDb, "artworks/public-work")),
    ).rejects.toThrowError();
    await expect(
      getDoc(doc(visitorDb, "artworks/private-work")),
    ).rejects.toThrowError();
  });

  it("rejects another user soft-deleting the owner's artwork", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await expect(
      updateDoc(doc(db, "artworks/public-work"), {
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ).rejects.toThrowError();
  });

  it("lets the owner flip their artwork's public flag", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await expect(
      updateDoc(doc(db, "artworks/private-work"), {
        isPublic: true,
        updatedAt: serverTimestamp(),
      }),
    ).resolves.toBeUndefined();
  });

  it("lets the owner update their collection", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await expect(
      updateDoc(doc(db, "collections/own-private"), {
        name: "Renamed Collection",
        updatedAt: serverTimestamp(),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects a stale update without the server timestamp", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OWNER).firestore();
    await expect(
      updateDoc(doc(db, "artworks/private-work"), { title: "No Stamp" }),
    ).rejects.toThrowError();
  });

  it("rejects another user updating or deleting the owner's artwork", async () => {
    await seed();
    const db = testEnv.authenticatedContext(OTHER).firestore();
    const ref = doc(db, "artworks/private-work");
    await expect(
      updateDoc(ref, {
        title: "Theft",
        updatedAt: serverTimestamp(),
      }),
    ).rejects.toThrowError();
    await expect(deleteDoc(ref)).rejects.toThrowError();
  });
});

// ---- artwork data migrations -------------------------------------------

/**
 * Adding a field to a document type does not retroactively add it: documents
 * written before keep their old shape, and a list query that filters on the
 * new field stops matching them. These tests pin down that failure and the
 * migration that fixes it, because the symptom ("all the artworks are gone")
 * looks nothing like its cause.
 */
describe("artwork data migrations", () => {
  /**
   * A deliberately mixed set covering every shape an artwork can be in once
   * soft delete exists — plus another account's work. Self-contained rather
   * than built on `seed()`, whose baseline documents are themselves all
   * pre-migration, so the counts below test the migration and not the fixture.
   */
  async function seedMixed() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "collections/own-public"), {
        name: "Owner Public",
        userId: OWNER,
        isPublic: true,
      });
      await setDoc(doc(db, "collections/other"), {
        name: "Other Collection",
        userId: OTHER,
        isPublic: false,
      });
      const artwork = (id: string, over: Record<string, unknown>) =>
        setDoc(doc(db, `artworks/${id}`), {
          title: id,
          artistName: "Owner",
          collectionId: "own-public",
          userId: OWNER,
          isPublic: true,
          ...over,
        });

      // Written before the field existed: no deletedAt at all.
      await artwork("legacy-live", {});
      await artwork("legacy-private", { isPublic: false });
      // Written after it: an explicit null (live) and a timestamp (deleted).
      await artwork("migrated-live", { deletedAt: null });
      await artwork("migrated-deleted", { deletedAt: new Date() });
      // Another account, already migrated.
      await artwork("others-work", { userId: OTHER, deletedAt: null });
    });
  }

  /** The exact query `getCollectionArtworks` runs, as the owner. */
  function appListQuery(db: Firestore) {
    return query(
      collection(db, "artworks"),
      where("collectionId", "==", "own-public"),
      where("userId", "==", OWNER),
      where("deletedAt", "==", null),
    );
  }

  const ids = (snapshot: QuerySnapshot) => snapshot.docs.map((d) => d.id);

  it("hides a pre-migration artwork from the very list meant to show it", async () => {
    await seedMixed();
    const db = testEnv.authenticatedContext(OWNER).firestore();

    // The document is there, and the rules let its owner read it...
    const unfiltered = await getDocs(
      query(collection(db, "artworks"), where("userId", "==", OWNER)),
    );
    expect(ids(unfiltered)).toContain("legacy-live");

    // ...but the list the app actually runs filters it out, because the
    // `deletedAt == null` clause does not match a missing field. Only the
    // already-migrated live work comes back.
    expect(ids(await getDocs(appListQuery(db)))).toEqual(["migrated-live"]);
  });

  it("brings them back, through a write the rules accept", async () => {
    await seedMixed();
    const db = testEnv.authenticatedContext(OWNER).firestore();

    // Both legacy works, and nothing else.
    expect(await backfillArtworkDeletedAt.countPending(db, OWNER)).toBe(2);
    expect((await backfillArtworkDeletedAt.run(db, OWNER)).updated).toBe(2);

    // The `updatedAt == request.time` guard applies to this batch exactly as it
    // does to any other update: a rejected commit fails the test here rather
    // than silently leaving data unmigrated. And the soft-deleted work is still
    // hidden — the migration is not a restore.
    expect(ids(await getDocs(appListQuery(db)))).toEqual([
      "legacy-live",
      "legacy-private",
      "migrated-live",
    ]);
  });

  it("is idempotent — a second run finds nothing to do", async () => {
    await seedMixed();
    const db = testEnv.authenticatedContext(OWNER).firestore();

    await backfillArtworkDeletedAt.run(db, OWNER);

    expect(await backfillArtworkDeletedAt.countPending(db, OWNER)).toBe(0);
    expect((await backfillArtworkDeletedAt.run(db, OWNER)).updated).toBe(0);
  });

  it("never resurrects a soft-deleted work", async () => {
    await seedMixed();
    const db = testEnv.authenticatedContext(OWNER).firestore();

    await backfillArtworkDeletedAt.run(db, OWNER);

    const snap = await getDocs(
      query(collection(db, "artworks"), where("userId", "==", OWNER)),
    );
    const deleted = snap.docs.find((d) => d.id === "migrated-deleted");
    // Still a timestamp, not the null the migration writes for live works.
    expect(deleted?.data().deletedAt).not.toBeNull();
    expect(ids(await getDocs(appListQuery(db)))).not.toContain(
      "migrated-deleted",
    );
  });

  it("cannot touch another account's artworks", async () => {
    await seedMixed();
    const other = testEnv.authenticatedContext(OTHER).firestore();

    // The migration selects on the *signed-in* uid. This account's own work is
    // already migrated, so there is nothing to do...
    expect(await backfillArtworkDeletedAt.countPending(other, OTHER)).toBe(0);
    expect((await backfillArtworkDeletedAt.run(other, OTHER)).updated).toBe(0);

    // ...and the owner's legacy works are still waiting for them.
    const owner = testEnv.authenticatedContext(OWNER).firestore();
    expect(await backfillArtworkDeletedAt.countPending(owner, OWNER)).toBe(2);
  });
});
