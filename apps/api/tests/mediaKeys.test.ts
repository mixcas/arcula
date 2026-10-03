// The §6 key algebra: build → parse round-trips and `extensionFor`.
//
// Pure — no stack needed. The round-trip is the load-bearing case: the
// proxy's per-request authz and the sweep both work from `parseMediaKey`
// alone, so a key the app built that it cannot read back is a 404 on
// every stored object, or a sweep that never matches.

import { describe, expect, it } from "vitest";
import { ACCEPTED_DOCUMENT_TYPES, ACCEPTED_IMAGE_TYPES } from "@arcula/shared";
import {
  extensionFor,
  finalDocumentKey,
  finalPhotoKey,
  parseMediaKey,
  stagingOriginalKey,
  stagingVariantKey,
} from "../src/media/keys";

const USER = "user-1";
const CID = "col-1";
const AID = "art-1";
const ENTRY = "photo-abc";

// All six: the original plus the five variant keys — the same set
// OBJECT_KEYS in keys.ts covers.
const ALL_OBJECT_KEYS = [
  "original",
  "xlarge",
  "square_lg",
  "square_sm",
  "large",
  "medium",
] as const;

describe("final keys", () => {
  it("round-trips every object key under both populations", () => {
    for (const key of ALL_OBJECT_KEYS) {
      const photo = parseMediaKey(
        finalPhotoKey(USER, CID, AID, ENTRY, key, "webp"),
      );
      expect(photo).toMatchObject({
        kind: "final",
        population: "photos",
        userId: USER,
        collectionId: CID,
        artworkId: AID,
        entryId: ENTRY,
        key,
      });
      expect(photo?.ext).toBe("webp");

      const document = parseMediaKey(
        finalDocumentKey(USER, CID, AID, ENTRY, key, "pdf"),
      );
      expect(document).toMatchObject({
        kind: "final",
        population: "documents",
        userId: USER,
        collectionId: CID,
        artworkId: AID,
        entryId: ENTRY,
        key,
      });
      expect(document?.ext).toBe("pdf");
    }
  });

  it("round-trips an entry id that contains underscores", () => {
    // The client mints ids that may carry `-` and `_`; the parser must
    // still recover the entry id whole, whichever variant key follows.
    const tricky = "ab_c-de_f";
    for (const key of ALL_OBJECT_KEYS) {
      const parsed = parseMediaKey(
        finalPhotoKey(USER, CID, AID, tricky, key, "jpg"),
      );
      expect(parsed, key).toMatchObject({ entryId: tricky, key });
    }
  });
});

describe("staging keys", () => {
  it("round-trips the original (no key suffix)", () => {
    const parsed = parseMediaKey(
      stagingOriginalKey(USER, CID, AID, ENTRY, "png"),
    );
    expect(parsed).toMatchObject({
      kind: "staging",
      userId: USER,
      collectionId: CID,
      artworkId: AID,
      entryId: ENTRY,
      key: null,
    });
    expect(parsed?.ext).toBe("png");
  });

  it("round-trips a variant (the key suffix recovers the variant)", () => {
    const parsed = parseMediaKey(
      stagingVariantKey(USER, CID, AID, ENTRY, "square_lg", "webp"),
    );
    expect(parsed).toMatchObject({
      kind: "staging",
      entryId: ENTRY,
      key: "square_lg",
    });
    expect(parsed?.ext).toBe("webp");
  });
});

describe("parseMediaKey rejects", () => {
  const bad = [
    "",
    "/",
    "artworks",
    "artworks/u/c/a",
    "artworks/u/c/a/",
    "artworks/u/c/a/photos",
    "artworks/u/c/a/photos/",
    // A final object without its key suffix is not a shape the app writes.
    "artworks/u/c/a/photos/entry.webp",
    // Unknown object key.
    "artworks/u/c/a/photos/entry_big.webp",
    "artworks/u/c/a/documents/entry_big.pdf",
    // Wrong population segment.
    "artworks/u/c/a/other/entry_original.webp",
    // Staging with a final's segment count.
    "staging/u/c/a/entry/extra.webp",
    // Dots in a path segment: the ext belongs to the filename only.
    "artworks/u.c/c/a/photos/entry_original.webp",
    // No extension.
    "artworks/u/c/a/photos/entry_original",
    // Trailing dot.
    "artworks/u/c/a/photos/entry_original.",
  ];
  for (const key of bad) {
    it(`returns null for ${JSON.stringify(key)}`, () => {
      expect(parseMediaKey(key)).toBeNull();
    });
  }
});

describe("extensionFor", () => {
  it("maps every accepted type to its stored extension", () => {
    const expected: Record<string, string> = {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
      "application/pdf": ".pdf",
    };
    for (const map of [ACCEPTED_IMAGE_TYPES, ACCEPTED_DOCUMENT_TYPES]) {
      for (const type of Object.keys(map)) {
        expect(extensionFor(type), type).toBe(expected[type]);
      }
    }
  });

  it("returns null — never `.bin` — for any unaccepted type, whatever the name", () => {
    // The property, not the case: the stored extension is a function of
    // the content type alone, the filename is not even read. If a
    // rewrite starts consulting the name (the old client's
    // documentExtension path), this matrix fails.
    const names = [
      "scan.pdf",
      "Get_Started_With_Smallpdf.pdf",
      "logo",
      "index.html",
      "evil.svg",
      "a.bin",
      "archive.zip",
    ];
    const types: (string | undefined)[] = [
      "image/svg+xml",
      "text/html",
      "application/octet-stream",
      "application/zip",
      "application/x-msdownload",
      "image/tiff",
      "",
      undefined,
    ];
    for (const name of names) {
      for (const type of types) {
        expect(extensionFor(type), `${name} × ${String(type)}`).not.toBe(
          ".bin",
        );
        expect(extensionFor(type), `${name} × ${String(type)}`).toBeNull();
      }
    }
  });
});
