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
  deleteObject,
  getBytes,
  ref as storageRef,
  uploadBytes,
  type FirebaseStorage,
} from "firebase/storage";
// The client's own half of the naming contract, imported rather than
// reimplemented. The seam tests below are only meaningful if the name comes from
// the same functions production calls — a second hand-written copy here would
// reproduce the exact gap they are meant to close.
import { documentService } from "@/services/documentService";
import { objectName } from "@/services/artworkFiles";
import { documentExtension } from "@/utils/artworkDocuments";

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

const documentPath = (artworkId: string, name: string): string =>
  `artworks/${USER_ID}/${COLLECTION_ID}/${artworkId}/documents/${name}`;
const documentName = (documentId: string, key: string, ext = "webp"): string =>
  `${ARTWORK_ID}_${documentId}_${key}.${ext}`;

// Exactly 20 alphanumeric characters, as `isDocumentName` requires. A real id
// comes from `doc(collection(db, "artworks")).id`, which is 20 — and a fixture
// of the wrong length is denied by the name check rather than by the
// permission it is meant to be testing, which is a spectacularly unhelpful way
// to learn that a rule works.
const DOCUMENT_ID = "document0000000001aa";
const OTHER_DOCUMENT_ID = "document0000000002bb";

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

/** A document upload with a caller-chosen type and size, for the cap tests. */
const putTyped = async (
  storage: FirebaseStorage,
  path: string,
  contentType: string,
  bytes: number,
) =>
  uploadBytes(storageRef(storage, path), new Uint8Array(bytes), {
    contentType,
  });

const MB = 1024 * 1024;

const seedArtwork = async (
  artworkId: string,
  data: Record<string, unknown>,
): Promise<void> => {
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(collection(context.firestore(), "artworks"), artworkId), {
      userId: USER_ID,
      collectionId: COLLECTION_ID,
      title: "Seeded",
      documents: [],
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
      "xlarge",
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

// Documents ("Other Documents") are private to the owner and are the only
// artwork objects a visitor can never reach, so the whole suite below is about
// two separate claims: that the owner can do everything, and that nobody else
// can do anything — on a *public* artwork, where the photo rules deliberately
// admit visitors. Every visitor test here uses a public artwork on purpose: on a
// private one the assertion would pass for the wrong reason, and would still
// pass if someone widened the documents block to the visitor rule.
describe("storage rules — other documents", () => {
  it("accepts a document image's original and both generated variants", async () => {
    // Only two of the photo table's five keys. square_lg, medium and xlarge
    // exist for the public collection views, and a document never appears
    // there, so generating them would write objects nothing can read. The rules
    // permit the full list and the app uses a subset, so the subset is all that
    // is asserted.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    for (const key of ["square_sm", "large", "original"]) {
      await expect(
        put(storage, documentPath(ARTWORK_ID, documentName(DOCUMENT_ID, key))),
      ).resolves.toBeDefined();
    }
  });

  it("accepts a PDF", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      putTyped(
        storage,
        documentPath(ARTWORK_ID, documentName(DOCUMENT_ID, "original", "pdf")),
        "application/pdf",
        4,
      ),
    ).resolves.toBeDefined();
  });

  it("uploads a picked PDF under a name the rules accept", async () => {
    // The test that was missing, and the one that should have existed before the
    // first PDF was ever picked. Every other case in this file builds its name by
    // hand with `documentName(…, "pdf")` — the *rules* side, written out to match
    // what the rules expect. This one hands a real `File` to the real service and
    // lets the client derive the name itself, so a derivation the rules refuse
    // fails here as the 403 it actually was.
    //
    // `uploadFile` once asked `extensionFor` — an image helper that answers `bin`
    // for any type it does not know — so every PDF went up as `_original.bin` and
    // was denied, while the hand-written `.pdf` fixtures all passed. Twenty-one
    // rule cases and twenty-seven component cases, and no test anywhere compared
    // the name the client *produces* with the name the rules *accept*.
    //
    // The emulator is the only place both halves exist, which is why this is here
    // rather than in tests/artworkDocuments.test.ts.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    // The filename from the original report, verbatim: the bug was never about the
    // name, but pinning the exact string means this fails if the derivation ever
    // starts depending on something other than the extension.
    const picked = new File(
      [new Uint8Array([1, 2, 3, 4])],
      "Get_Started_With_Smallpdf.pdf",
      {
        type: "application/pdf",
      },
    );

    const [document] = await documentService.uploadArtworkDocuments({
      userId: USER_ID,
      collectionId: COLLECTION_ID,
      artworkId: ARTWORK_ID,
      documents: [{ kind: "file", file: picked }],
      client: storage,
    });

    expect(document.name).toBe("Get_Started_With_Smallpdf.pdf");
    expect(document.original.url).toContain(
      `${ARTWORK_ID}_${document.id}_original.pdf`,
    );
    // And the object is really there, so the assertion above is not just that a
    // URL string was built correctly.
    await expect(
      getBytes(storageRef(storage, document.original.url)),
    ).resolves.toBeDefined();
  });

  it("accepts a PDF under the name the client actually derives", async () => {
    // The pairing itself, asserted without going through the service: the
    // client's own `objectName` and the client's own `documentExtension`, against
    // the rules. The service-level test above is the one that would have caught
    // the regression; this one localises a failure to the two functions rather
    // than to the upload.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    const extension = documentExtension(
      "Get_Started_With_Smallpdf.pdf",
      "application/pdf",
    );
    expect(extension).not.toBeNull();

    const name = objectName(
      ARTWORK_ID,
      DOCUMENT_ID,
      "original",
      extension ?? "",
    );
    expect(name).toBe(`${ARTWORK_ID}_${DOCUMENT_ID}_original.pdf`);

    await expect(
      putTyped(storage, documentPath(ARTWORK_ID, name), "application/pdf", 4),
    ).resolves.toBeDefined();
  });

  it("derives a name the rules reject for no type the form accepts", async () => {
    // The other half of the same seam, as a negative. `bin` is what the buggy
    // derivation produced for a PDF, and asserting it is still refused is what
    // keeps the allowlist from being widened to make the error go away: `bin` is
    // not a degraded upload, it is a hole. A forged `text/html` payload named
    // `.bin` would otherwise be storable, which is the stored-XSS primitive the
    // extension check exists to block.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    for (const name of [
      documentName(DOCUMENT_ID, "original", "bin"),
      documentName(DOCUMENT_ID, "original", "html"),
      documentName(DOCUMENT_ID, "original", "svg"),
    ]) {
      await expect(
        putTyped(storage, documentPath(ARTWORK_ID, name), "application/pdf", 4),
      ).rejects.toThrow(/storage\/unauthorized/);
    }
  });

  it("accepts a second document alongside the first", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await put(
      storage,
      documentPath(ARTWORK_ID, documentName(DOCUMENT_ID, "original")),
    );
    await expect(
      put(
        storage,
        documentPath(ARTWORK_ID, documentName(OTHER_DOCUMENT_ID, "original")),
      ),
    ).resolves.toBeDefined();
  });

  it("lets the owner read their own document back", async () => {
    // The same assertion the photo block could not pass before the read/write
    // split. A combined condition dereferencing request.resource denies this,
    // because request.resource is null on a read.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    const path = documentPath(
      ARTWORK_ID,
      documentName(DOCUMENT_ID, "square_sm"),
    );
    await put(storage, path);

    await expect(getBytes(storageRef(storage, path))).resolves.toBeDefined();
  });

  it("accepts a 20 MB PDF", async () => {
    // The document cap is 25 MB against the photos' 10 MB, and this is the test
    // that distinguishes them. A scanned catalogue raisonné is a normal
    // attachment and 20 MB is not exotic for one — if the cap were ever unified
    // back to 10 MB, this is what would fail, and the failure would be a
    // legitimate file the app refused with no way to proceed.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      putTyped(
        storage,
        documentPath(ARTWORK_ID, documentName(DOCUMENT_ID, "original", "pdf")),
        "application/pdf",
        20 * MB,
      ),
    ).resolves.toBeDefined();
  });

  it("rejects a PDF over the 25 MB cap", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      putTyped(
        storage,
        documentPath(ARTWORK_ID, documentName(DOCUMENT_ID, "original", "pdf")),
        "application/pdf",
        26 * MB,
      ),
    ).rejects.toThrow();
  });

  it("rejects the same 20 MB under the photos folder", async () => {
    // The pair that pins the two ceilings to their own blocks. Without the
    // second half, "documents allow 25 MB" would also be satisfied by a single
    // shared 25 MB ceiling applied to everything.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      putTyped(
        storage,
        photoPath(ARTWORK_ID, photoName(PHOTO_ID, "original")),
        "image/png",
        20 * MB,
      ),
    ).rejects.toThrow();
  });

  it("rejects a PDF written into the photos folder", async () => {
    // The photos block no longer admits application/pdf. The name check would
    // reject it too, but the type check is the one carrying that intent, and the
    // two were separated deliberately so neither hides the other.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      putTyped(
        storage,
        photoPath(ARTWORK_ID, photoName(PHOTO_ID, "original", "pdf")),
        "application/pdf",
        4,
      ),
    ).rejects.toThrow();
  });

  it("rejects an SVG, which would be stored XSS from the storage origin", async () => {
    // The form never accepts SVG, and the rules never permit it, so a
    // hand-rolled client cannot add one either. An uploaded SVG navigated to
    // directly executes script in the storage origin, so this is a real control
    // rather than tidiness — and the content type is client-supplied, so the
    // filename allowlist is the only thing that can be bound to it.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      putTyped(
        storage,
        documentPath(ARTWORK_ID, documentName(DOCUMENT_ID, "original", "svg")),
        "image/svg+xml",
        64,
      ),
    ).rejects.toThrow();
  });

  it("rejects an HTML document, for the same reason", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      putTyped(
        storage,
        documentPath(ARTWORK_ID, documentName(DOCUMENT_ID, "original", "html")),
        "text/html",
        64,
      ),
    ).rejects.toThrow();
  });

  it("rejects a document name that omits the artwork id prefix", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(storage, documentPath(ARTWORK_ID, `${DOCUMENT_ID}_original.webp`)),
    ).rejects.toThrow();
  });

  it("rejects a document id that is not the expected shape", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(storage, documentPath(ARTWORK_ID, `${ARTWORK_ID}_x_original.webp`)),
    ).rejects.toThrow();
  });

  it("rejects a document name minted for a different artwork", async () => {
    // The name embeds the artwork id, so a name minted for one artwork cannot
    // pass the check against another.
    await seedArtwork(ARTWORK_ID, {});
    await seedArtwork(PUBLIC_ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    await expect(
      put(
        storage,
        documentPath(
          ARTWORK_ID,
          `${PUBLIC_ARTWORK_ID}_${DOCUMENT_ID}_original.webp`,
        ),
      ),
    ).rejects.toThrow();
  });

  it("rejects an upload from a different account", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OTHER);

    await expect(
      put(
        storage,
        documentPath(ARTWORK_ID, documentName(DOCUMENT_ID, "original")),
      ),
    ).rejects.toThrow();
  });

  it("rejects an anonymous upload", async () => {
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(null);

    await expect(
      put(
        storage,
        documentPath(ARTWORK_ID, documentName(DOCUMENT_ID, "original")),
      ),
    ).rejects.toThrow();
  });

  it("denies a visitor a document of a PUBLIC artwork", async () => {
    // The load-bearing test for "never public". A public artwork is exactly the
    // case where the photo rules admit a visitor, so seeding a private one here
    // would pass even if the documents block were widened to the visitor rule.
    await seedArtwork(PUBLIC_ARTWORK_ID, { isPublic: true });
    const ownerStorage = storageFor(OWNER);
    const anonStorage = storageFor(null);

    const path = documentPath(
      PUBLIC_ARTWORK_ID,
      `${PUBLIC_ARTWORK_ID}_${DOCUMENT_ID}_large.webp`,
    );
    await put(ownerStorage, path);

    await expect(getBytes(storageRef(anonStorage, path))).rejects.toThrow();
  });

  it("denies a signed-in visitor a document of a public artwork", async () => {
    // Not the same test as the anonymous one: an authenticated caller is a
    // different branch through the rules engine, and "only the owner" is a
    // stronger claim than "only signed-out users".
    await seedArtwork(PUBLIC_ARTWORK_ID, { isPublic: true });
    const ownerStorage = storageFor(OWNER);
    const otherStorage = storageFor(OTHER);

    const path = documentPath(
      PUBLIC_ARTWORK_ID,
      `${PUBLIC_ARTWORK_ID}_${DOCUMENT_ID}_large.webp`,
    );
    await put(ownerStorage, path);

    await expect(getBytes(storageRef(otherStorage, path))).rejects.toThrow();
  });

  it("denies a visitor a PDF of a public artwork", async () => {
    // The same claim for the non-image half. A condition report is the most
    // sensitive thing this app can hold, so the "never public" promise has to
    // cover the file case and not only the image one.
    await seedArtwork(PUBLIC_ARTWORK_ID, { isPublic: true });
    const ownerStorage = storageFor(OWNER);
    const anonStorage = storageFor(null);

    const path = documentPath(
      PUBLIC_ARTWORK_ID,
      `${PUBLIC_ARTWORK_ID}_${DOCUMENT_ID}_original.pdf`,
    );
    await putTyped(ownerStorage, path, "application/pdf", 4);

    await expect(getBytes(storageRef(anonStorage, path))).rejects.toThrow();
  });

  it("denies a visitor a document of a soft-deleted public artwork", async () => {
    await seedArtwork(DELETED_ARTWORK_ID, {
      isPublic: true,
      deletedAt: new Date(),
    });
    const ownerStorage = storageFor(OWNER);
    const anonStorage = storageFor(null);

    const path = documentPath(
      DELETED_ARTWORK_ID,
      `${DELETED_ARTWORK_ID}_${DOCUMENT_ID}_large.webp`,
    );
    await put(ownerStorage, path);

    await expect(getBytes(storageRef(anonStorage, path))).rejects.toThrow();
  });

  it("lets the owner delete a document", async () => {
    // The Edit form's sweep depends on this, and it is the case the
    // `request.resource == null` admission exists for: a delete carries no
    // resource and no new name to check, so a write condition that tested size
    // or content type without admitting the null case would deny it and orphan
    // every removed document.
    await seedArtwork(ARTWORK_ID, {});
    const storage = storageFor(OWNER);

    const path = documentPath(
      ARTWORK_ID,
      documentName(DOCUMENT_ID, "original"),
    );
    await put(storage, path);

    await expect(
      deleteObject(storageRef(storage, path)),
    ).resolves.toBeUndefined();
    await expect(getBytes(storageRef(storage, path))).rejects.toThrow();
  });

  it("rejects a delete from a different account", async () => {
    // The counterpart to the test above: a document's objects are the owner's to
    // remove and nobody else's, which is what keeps one account's sweep from
    // reaching another's.
    await seedArtwork(ARTWORK_ID, {});
    const ownerStorage = storageFor(OWNER);
    const otherStorage = storageFor(OTHER);

    const path = documentPath(
      ARTWORK_ID,
      documentName(DOCUMENT_ID, "original"),
    );
    await put(ownerStorage, path);

    await expect(
      deleteObject(storageRef(otherStorage, path)),
    ).rejects.toThrow();
    await expect(
      getBytes(storageRef(ownerStorage, path)),
    ).resolves.toBeDefined();
  });
});
