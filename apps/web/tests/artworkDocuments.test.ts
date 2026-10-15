// Pure-logic tests for the "Other Documents" helpers. No DOM, no canvas, no
// server — the helpers encode decisions that are easy to make and hard to
// notice being wrong: which types the form admits, what an image tile reads,
// and when a save is allowed to skip the field.
//
// What this file does not test: naming a document's stored object. The server
// mints the object key from the content type it decoded, so the client has no
// extension to choose and no allowlist to keep in step with the rules — the
// accepted-type checks below are the form's only gate, and the stage route
// enforces the same lists at the boundary.

import { describe, expect, it } from "vitest";
import {
  ACCEPTED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
} from "@arcula/shared";
import {
  documentImageUrl,
  documentsChanged,
  isAcceptedDocumentType,
  isDocumentImage,
  isDocumentImageType,
  sortDocuments,
} from "@/utils/artworkDocuments";
import type {
  ArtworkDocument,
  ArtworkDocumentFile,
  ArtworkDocumentImage,
} from "@arcula/shared";

const imageDocument: ArtworkDocumentImage = {
  id: "a",
  kind: "image",
  name: "reverse.jpg",
  size: 1000,
  contentType: "image/jpeg",
  width: 2000,
  height: 1500,
  original: {
    url: "https://example.test/a-original.jpg",
    size: 1000,
    contentType: "image/jpeg",
  },
  variants: [
    {
      key: "square_sm",
      url: "https://example.test/a-square_sm.webp",
      width: 400,
      height: 400,
      size: 100,
      contentType: "image/webp",
    },
  ],
};

const fileDocument: ArtworkDocumentFile = {
  id: "f",
  kind: "file",
  name: "condition-report.pdf",
  size: 5000,
  contentType: "application/pdf",
  original: {
    url: "https://example.test/f-original.pdf",
    size: 5000,
    contentType: "application/pdf",
  },
};

describe("the accepted types", () => {
  it("takes the image types photos take, plus PDF", () => {
    expect(ACCEPTED_DOCUMENT_TYPES["image/jpeg"]).toEqual([".jpg", ".jpeg"]);
    expect(ACCEPTED_DOCUMENT_TYPES["image/png"]).toEqual([".png"]);
    expect(ACCEPTED_DOCUMENT_TYPES["image/webp"]).toEqual([".webp"]);
    expect(ACCEPTED_DOCUMENT_TYPES["application/pdf"]).toEqual([".pdf"]);
  });

  it("accepts no type that can execute in the origin", () => {
    // SVG and HTML are the two that matter, and neither is in the form's list:
    // an uploaded SVG or HTML file navigated to directly would execute on the
    // media origin.
    const types = Object.keys(ACCEPTED_DOCUMENT_TYPES);
    expect(types).not.toContain("image/svg+xml");
    expect(types).not.toContain("text/html");
    expect(types.some((type) => type.includes("html"))).toBe(false);
  });

  it("does not accept a type the browser did not report", () => {
    expect(isAcceptedDocumentType("application/pdf")).toBe(true);
    expect(isAcceptedDocumentType("image/jpeg")).toBe(true);
    // Browsers hand over an empty type for a dragged file. Rejecting it would
    // make a perfectly good PDF unusable depending on how it arrived.
    expect(isAcceptedDocumentType(undefined)).toBe(false);
  });

  it("routes a PDF past the image pipeline and an image into it", () => {
    expect(isDocumentImageType("image/jpeg")).toBe(true);
    expect(isDocumentImageType("image/png")).toBe(true);
    expect(isDocumentImageType("image/webp")).toBe(true);
    expect(isDocumentImageType("application/pdf")).toBe(false);
  });
});

describe("the size caps", () => {
  it("allows a larger document than a photo", () => {
    // A scanned catalogue raisonné is a normal attachment and is routinely
    // larger than a photograph, so the document ceiling is deliberately higher.
    // "Deliberately" only means something if it is pinned: a refactor that
    // equalises the two would silently start rejecting attachments the form
    // advertised as fine.
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(MAX_IMAGE_BYTES);
  });
});

describe("sortDocuments", () => {
  it("reads an absent field as an empty list", () => {
    // Every artwork written before this field existed has no `documents` key, and
    // a reader must not have to know that.
    expect(sortDocuments(undefined)).toEqual([]);
  });

  it("reads a non-array as an empty list", () => {
    // A stored array is trusted no more than any other stored data.
    expect(sortDocuments(null as unknown as ArtworkDocument[])).toEqual([]);
    expect(sortDocuments("nope" as unknown as ArtworkDocument[])).toEqual([]);
  });

  it("leaves the order alone", () => {
    // There is no `order` field on a document, so there is nothing to sort by.
    // Sorting would be inventing a sequence the data does not claim to have.
    const documents = [imageDocument, fileDocument];
    expect(sortDocuments(documents)).toEqual(documents);
  });
});

describe("documentsChanged", () => {
  it("is false when the same set is stored and proposed", () => {
    expect(
      documentsChanged(
        [imageDocument, fileDocument],
        [{ ...imageDocument }, { ...fileDocument }],
      ),
    ).toBe(false);
  });

  it("ignores order, because this list has no sequence", () => {
    // The counterpart to the photos' ordered comparison. Reordering the UI is
    // not a change worth a write, and treating it as one would rewrite every
    // object for nothing.
    expect(
      documentsChanged(
        [imageDocument, fileDocument],
        [fileDocument, imageDocument],
      ),
    ).toBe(false);
  });

  it("is true when one was removed", () => {
    expect(
      documentsChanged([imageDocument, fileDocument], [imageDocument]),
    ).toBe(true);
  });

  it("is true when one was added", () => {
    expect(
      documentsChanged([imageDocument], [imageDocument, fileDocument]),
    ).toBe(true);
  });

  it("treats an absent field as an empty list, not as a change", () => {
    // An artwork written before the field existed, saved without touching its
    // documents, must not have the field written for the first time.
    expect(documentsChanged(undefined, [])).toBe(false);
  });
});

describe("documentImageUrl", () => {
  it("gives the tile the square variant", () => {
    expect(documentImageUrl(imageDocument)).toBe(
      "https://example.test/a-square_sm.webp",
    );
  });

  it("falls back to the original when the variant is missing", () => {
    // A document written by an older build, or one whose variant failed to
    // generate, still has to render something rather than a broken image.
    expect(documentImageUrl({ ...imageDocument, variants: [] })).toBe(
      "https://example.test/a-original.jpg",
    );
  });

  it("has nothing to offer for a non-image", () => {
    expect(documentImageUrl(fileDocument)).toBeNull();
  });
});

describe("isDocumentImage", () => {
  it("narrows on the stored kind, not on the file extension", () => {
    // A `.jpg` named document is still whatever it was stored as, and a stored
    // record does not get re-interpreted because the name looks like something
    // else.
    expect(isDocumentImage(imageDocument)).toBe(true);
    expect(isDocumentImage(fileDocument)).toBe(false);
  });
});
