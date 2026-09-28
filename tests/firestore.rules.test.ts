// Firestore security rules tests, run against the emulators.
//
// Executed via `bun run test:rules`, which wraps vitest in
// `firebase emulators:exec --only firestore,auth --project demo-custodia`.
// The PROJECT_ID here must match the emulator project so the rules-unit-testing
// contexts talk to the same Firestore. The emulator is seeded with rules
// disabled (admin credentials) and every assertion below goes through a
// real client context so the rules are enforced.
//
// Note on composite queries: the emulator does not build the composite indexes
// from firestore.indexes.json, so the list tests use single-field queries
// (`where userId == uid`, `where isPublic == true`) to exercise the list-rule
// logic without an index. The full composite query list lives in the app
// services and is validated by `firebase deploy --only firestore` (indexes).
//
// Note on list rules: the rules authorize lists with per-document field checks
// (`resource.data.userId` / `resource.data.isPublic`), not
// `request.query.where` constraints — the emulator does not populate
// `request.query.where`, so query-constraint rules would deny every list and
// could never be asserted here. "Rules are not filters": a list whose result
// set spans a document the caller may not read fails the whole query.
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
} from "firebase/firestore";

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
    await seed();
    const db = testEnv.unauthenticatedContext().firestore();
    const snap = await getDoc(doc(db, "artworks/public-work"));
    expect(snap.exists()).toBe(true);
    expect(snap.data()?.isPublic).toBe(true);
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
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }),
    ).resolves.toBeDefined();
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
