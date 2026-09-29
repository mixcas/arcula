// Storage security rules tests, run against the emulators.
//
// Executed via `bun run test:rules`, which wraps vitest in
// `firebase emulators:exec --only firestore,auth,storage --project demo-custodia`.
// The storage emulator is on 9199 (firebase.json) and was previously left out
// of that script entirely, so these rules shipped with no CI coverage at all —
// which is how the read bug described below survived.
//
// THE BUG THESE TESTS EXIST FOR: the previous storage.rules combined reads and
// writes into one `allow read, write` whose condition dereferenced
// `request.resource.size`. `request.resource` is null on a read, so `null.size`
// is a rules evaluation error and the whole request is denied. The owner could
// upload a photo and then never read it back, and every rendered image would
// break. Nothing caught it because nothing tested storage rules.
//
// Two emulator behaviours worth knowing, both measured while writing these:
//   1. `request.resource` is also null on a delete, so a write condition that
//      checks size or content type denies deletes unless the null case is
//      admitted explicitly. `acceptableUpload` in storage.rules does that.
//   2. A Firestore `get()` from a storage rule is a real cross-service call and
//      is billed/exercised per request. It is still the right tool here: the
//      storage rules have to know whether an artwork is public, and that lives
//      on the Firestore document. The cost is a handful of reads per image
//      view, which is the same trade the Firestore rules already make.
import { readFileSync } from "node:fs";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { collection, doc, serverTimestamp, setDoc } from "firebase/firestore";
import {
  getBytes,
  ref as storageRef,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";

const PROJECT_ID = "demo-custodia";
const RULES = readFileSync("storage.rules", "utf8");

const OWNER = "owner-1";
const OTHER = "other-1";
const COLLECTION_ID = "collection-1";

// The `{userId}` path segment is the owner's auth uid. It is not the same
// thing as `request.auth.uid` from the rules' point of view — the rules only
// compare the artwork document's `userId` against the caller's token — so
// keeping them equal here is simply the realistic case, and the "rejects a
// different account" tests are what prove the distinction matters.
const USER_ID = OWNER;

const ARTWORK_ID = "artwork0000000001";
const PHOTO_ID = "photo0000000000001aa";
const OTHER_PHOTO_ID = "photo0000000000002bb";

const PUBLIC_ARTWORK_ID = "artwork0000000002";
const PRIVATE_ARTWORK_ID = "artwork0000000003";
const DELETED_ARTWORK_ID = "artwork0000000004";

const photoPath = (artworkId: string, name: string): string =>
  `artworks/${USER_ID}/${COLLECTION_ID}/${artworkId}/photos/${name}`;
const photoName = (photoId: string, key: string, ext = "webp"): string =>
  `${ARTWORK_ID}_${photoId}_${key}.${ext}`;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

let env: RulesTestEnvironment;

/**
 * A Storage client for a caller.
 *
 * The token is attached as `sub`, not `uid`. Passing `uid` now throws ("The
 * \"uid\" field is no longer supported by mockUserToken"), and the distinction
 * matters: it is `sub` that the rules engine compares against
 * `request.auth.uid`, so a context authenticated with the wrong claim would
 * fail every owner assertion for reasons unrelated to the rules under test.
 */
const storageFor = (userId: string | null): FirebaseStorage => {
  const context =
    userId === null
      ? env.unauthenticatedContext()
      : env.authenticatedContext(userId, { sub: userId });
  return context.storage();
};

const put = async (storage: FirebaseStorage, path: string, data = PNG) =>
  uploadBytes(storageRef(storage, path), data, { contentType: "image/png" });

const seedArtwork = async (
  artworkId: string,
  data: Record<string, unknown>,
): Promise<void> => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(collection(context.firestore(), "artworks"), artworkId), {
      userId: USER_ID,
      collectionId: COLLECTION_ID,
      title: "Seeded",
      certificates: [],
      photos: [],
      isPublic: true,
      deletedAt: null,
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  });
};

// The negative tests here provoke a denied request, and a denial is loudly
// correct — the SDK logs it and the rejected promise surfaces it. `test:rules`
// gates `deploy:rules`, so that on stderr means a *successful* deploy prints
// red PERMISSION_DENIED blocks, and that is how people learn to ignore the one
// run where it actually mattered. Assertions still fail loudly; only the noise
// is dropped. Unlike the Firestore SDK, `firebase/storage` exports no
// `setLogLevel`, so the `console.error` spy is the whole mechanism here.
beforeAll(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
    storage: { rules: RULES },
  });
});

afterEach(async () => {
  await env.clearStorage();
  await env.clearFirestore();
});

afterAll(async () => {
  vi.restoreAllMocks();
  await env.cleanup();
});

describe("storage rules — owner writes", () => {
  it("accepts a well-formed photo upload", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(storage, photoPath(ARTWORK_ID, photoName(PHOTO_ID, "original"))),
    ).resolves.toBeDefined();
  });

  it("accepts every variant key the app generates", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    for (const key of [
      "square_lg",
      "square_sm",
      "large",
      "medium",
      "original",
    ]) {
      await expect(
        put(storage, photoPath(ARTWORK_ID, photoName(PHOTO_ID, key))),
      ).resolves.toBeDefined();
    }
  });

  it("accepts a jpg variant, for browsers without a WebP encoder", async () => {
    // Safari cannot encode WebP through a canvas, so the JPEG fallback is a
    // real code path rather than a theoretical one. The rules must admit the
    // same extensions the encoder can emit.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(storage, photoPath(ARTWORK_ID, photoName(PHOTO_ID, "large", "jpg"))),
    ).resolves.toBeDefined();
  });

  it("accepts a png original, which keeps its alpha in the archive", async () => {
    // A PNG source is stored as the PNG it is rather than re-encoded, so it
    // can keep transparency. The extension list has to include it or every
    // transparent original is rejected at upload.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(
        storage,
        photoPath(ARTWORK_ID, photoName(PHOTO_ID, "original", "png")),
      ),
    ).resolves.toBeDefined();
  });

  it("rejects an extension the app never produces", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(
        storage,
        photoPath(ARTWORK_ID, photoName(PHOTO_ID, "original", "gif")),
      ),
    ).rejects.toThrow();
  });

  it("rejects an upload from a different account", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OTHER);

    await expect(
      put(storage, photoPath(ARTWORK_ID, photoName(PHOTO_ID, "original"))),
    ).rejects.toThrow();
  });

  it("rejects an anonymous upload", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(null);

    await expect(
      put(storage, photoPath(ARTWORK_ID, photoName(PHOTO_ID, "original"))),
    ).rejects.toThrow();
  });
});

describe("storage rules — the filename is a contract, not a suggestion", () => {
  it("rejects a name whose photoId is not the expected shape", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    // Right prefix, wrong id length. Without the character class a client
    // could scatter arbitrary keys under an artwork's prefix.
    await expect(
      put(storage, photoPath(ARTWORK_ID, `${ARTWORK_ID}_x_original.webp`)),
    ).rejects.toThrow();
  });

  it("rejects an unknown variant key", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(storage, photoPath(ARTWORK_ID, photoName(PHOTO_ID, "thumbnail"))),
    ).rejects.toThrow();
  });

  it("rejects a name that omits the artwork id prefix", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(storage, photoPath(ARTWORK_ID, `${PHOTO_ID}_original.webp`)),
    ).rejects.toThrow();
  });

  it("rejects a path traversal attempt in the name", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(
        storage,
        photoPath(
          ARTWORK_ID,
          `${ARTWORK_ID}_${PHOTO_ID}_original.webp/../../evil`,
        ),
      ),
    ).rejects.toThrow();
  });
});

describe("storage rules — owner reads", () => {
  it("accepts a read of the owner's own photo", async () => {
    // This is the assertion the old rules could not pass. A combined
    // `allow read, write` dereferencing request.resource denies this, because
    // request.resource is null on a read.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    const path = photoPath(ARTWORK_ID, photoName(PHOTO_ID, "square_sm"));
    await put(storage, path);

    await expect(getBytes(storageRef(storage, path))).resolves.toBeDefined();
  });

  it("rejects a read by another account of a private artwork", async () => {
    // Deliberately PRIVATE, so this asserts ownership rather than visibility.
    // On a public artwork a different account is *supposed* to read it — that
    // is the visitor rule — so seeding a public one here would have asserted
    // the opposite of what the test name claims.
    await seedArtwork(PRIVATE_ARTWORK_ID, { isPublic: false });
    const ownerStorage = storageFor(OWNER);
    const otherStorage = storageFor(OTHER);

    const name = `${PRIVATE_ARTWORK_ID}_${PHOTO_ID}_large.webp`;
    const path = photoPath(PRIVATE_ARTWORK_ID, name);
    await put(ownerStorage, path);

    await expect(getBytes(storageRef(otherStorage, path))).rejects.toThrow();
  });

  it("admits another account on a public artwork, by the visitor rule", async () => {
    // The counterpart to the test above, so the pair pins down that visibility
    // — not ownership — is what separates the two cases.
    await seedArtwork(PUBLIC_ARTWORK_ID, { isPublic: true });
    const ownerStorage = storageFor(OWNER);
    const otherStorage = storageFor(OTHER);

    const name = `${PUBLIC_ARTWORK_ID}_${PHOTO_ID}_large.webp`;
    const path = photoPath(PUBLIC_ARTWORK_ID, name);
    await put(ownerStorage, path);

    await expect(
      getBytes(storageRef(otherStorage, path)),
    ).resolves.toBeDefined();
  });
});

describe("storage rules — visitor reads", () => {
  it("lets a visitor read a photo of a public artwork", async () => {
    // The public collection page renders these, so without this the page
    // loads and every image is broken.
    await seedArtwork(PUBLIC_ARTWORK_ID, { isPublic: true });
    const ownerStorage = storageFor(OWNER);
    const anonStorage = storageFor(null);

    const path = photoPath(
      PUBLIC_ARTWORK_ID,
      `${PUBLIC_ARTWORK_ID}_${PHOTO_ID}_medium.webp`,
    );
    await put(ownerStorage, path);

    await expect(
      getBytes(storageRef(anonStorage, path)),
    ).resolves.toBeDefined();
  });

  it("denies a visitor a photo of a private artwork", async () => {
    await seedArtwork(PRIVATE_ARTWORK_ID, { isPublic: false });
    const ownerStorage = storageFor(OWNER);
    const anonStorage = storageFor(null);

    const path = photoPath(
      PRIVATE_ARTWORK_ID,
      `${PRIVATE_ARTWORK_ID}_${PHOTO_ID}_medium.webp`,
    );
    await put(ownerStorage, path);

    await expect(getBytes(storageRef(anonStorage, path))).rejects.toThrow();
  });

  it("denies a visitor a photo of a soft-deleted artwork", async () => {
    // Mirrors the Firestore rule: a soft-deleted artwork is hidden from
    // visitors, and its photos must be too, or the images outlive the work.
    await seedArtwork(DELETED_ARTWORK_ID, {
      isPublic: true,
      deletedAt: new Date(),
    });
    const ownerStorage = storageFor(OWNER);
    const anonStorage = storageFor(null);

    const path = photoPath(
      DELETED_ARTWORK_ID,
      `${DELETED_ARTWORK_ID}_${PHOTO_ID}_medium.webp`,
    );
    await put(ownerStorage, path);

    await expect(getBytes(storageRef(anonStorage, path))).rejects.toThrow();
  });

  it("denies a visitor reading a private artwork even if signed in as another user", async () => {
    await seedArtwork(PRIVATE_ARTWORK_ID, { isPublic: false });
    const ownerStorage = storageFor(OWNER);
    const otherStorage = storageFor(OTHER);

    const path = photoPath(
      PRIVATE_ARTWORK_ID,
      `${PRIVATE_ARTWORK_ID}_${PHOTO_ID}_large.webp`,
    );
    await put(ownerStorage, path);

    await expect(getBytes(storageRef(otherStorage, path))).rejects.toThrow();
  });
});

describe("storage rules — per-photo isolation", () => {
  it("keeps one photo's name from being used to overwrite another's slot", async () => {
    // The name embeds the artwork id, so a name minted for one artwork cannot
    // be validated against another. Asserted because the two ids differ only
    // by suffix here.
    await seedArtwork(ARTWORK_ID, {});
    await seedArtwork(PUBLIC_ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    const mismatched = photoPath(
      ARTWORK_ID,
      `${PUBLIC_ARTWORK_ID}_${PHOTO_ID}_original.webp`,
    );
    await expect(put(storage, mismatched)).rejects.toThrow();
  });

  it("accepts a second photo alongside the first", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await put(storage, photoPath(ARTWORK_ID, photoName(PHOTO_ID, "original")));
    await expect(
      put(
        storage,
        photoPath(ARTWORK_ID, photoName(OTHER_PHOTO_ID, "original")),
      ),
    ).resolves.toBeDefined();
  });
});
