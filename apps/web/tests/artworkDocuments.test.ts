// Pure-logic tests for the "Other Documents" helpers. No DOM, no canvas, no
// emulator — the geometry and the encoder are covered in tests/imageVariants.test.ts
// and tests/imageProcessing.test.ts, and the list behaviour in
// tests/documentsUploader.test.tsx.
//
// These exist because the helpers encode decisions that are easy to make and
// hard to notice being wrong: which variants a document gets, what a stored
// filename is read for, and when a save is allowed to skip the field.

import { describe, expect, it } from "vitest";
import {
  ACCEPTED_DOCUMENT_TYPES,
  DOCUMENT_EXTENSIONS,
  MAX_DOCUMENT_BYTES,
  documentExtension,
  documentImageSpecs,
  documentImageUrl,
  documentsChanged,
  fileExtension,
  isAcceptedDocumentType,
  isDocumentExtension,
  isDocumentImage,
  isDocumentImageType,
  sortDocuments,
} from "@/utils/artworkDocuments";
import { extensionFor } from "@/utils/imageProcessing";
import { MAX_IMAGE_BYTES } from "@/utils/imageVariants";
import {
  rulesByteCeiling,
  rulesExtensionList,
  rulesNamePattern,
} from "./helpers/rulesSource";
import type {
  ArtworkDocument,
  ArtworkDocumentFile,
  ArtworkDocumentImage,
} from "@/types";

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

describe("the document variant subset", () => {
  it("generates only the two a document actually renders", () => {
    // `square_lg`, `medium` and `xlarge` exist for the public collection views,
    // and a document is refused to visitors by the storage rules — so generating
    // them would write up to three objects per image that nothing can ever read.
    expect(documentImageSpecs().map((spec) => spec.key)).toEqual([
      "square_sm",
      "large",
    ]);
  });

  it("sizes a document's tile at `square_sm` and its preview at `large`", () => {
    // Written out rather than derived, deliberately. `documentImageSpecs()`
    // filters `IMAGE_VARIANTS` rather than building a second table, so the
    // sharing needs no test — what needs pinning is the geometry a document
    // ends up with, since `square_lg` and `medium` are pinned by the photo
    // grid's own tests and nothing else would notice these two moving. The
    // reasoning about *why* it is a subset lives in `imageVariants.ts`.
    const byKey = new Map(documentImageSpecs().map((spec) => [spec.key, spec]));
    expect(byKey.get("square_sm")).toMatchObject({
      fit: "cover",
      width: 400,
      height: 400,
    });
    expect(byKey.get("large")).toMatchObject({ fit: "inside", max: 1200 });
  });
});

describe("the accepted types", () => {
  it("takes the image types photos take, plus PDF", () => {
    expect(ACCEPTED_DOCUMENT_TYPES["image/jpeg"]).toEqual([".jpg", ".jpeg"]);
    expect(ACCEPTED_DOCUMENT_TYPES["image/png"]).toEqual([".png"]);
    expect(ACCEPTED_DOCUMENT_TYPES["image/webp"]).toEqual([".webp"]);
    expect(ACCEPTED_DOCUMENT_TYPES["application/pdf"]).toEqual([".pdf"]);
  });

  it("accepts no type that can execute in the storage origin", () => {
    // SVG and HTML are the two that matter, and the reason the rules' extension
    // allowlist is a control rather than tidiness. Neither is in the form's
    // list, and neither is permitted by the rules.
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

describe("the size and count caps", () => {
  it("allows a larger document than a photo, because the rules do", () => {
    // Both ceilings are read out of `storage.rules` rather than written here.
    // A scanned catalogue raisonné is a normal attachment and is routinely
    // larger than a photograph, so the document ceiling is deliberately
    // higher — and "deliberately" only means something if it is pinned to the
    // number the server actually enforces. A literal on both sides would agree
    // with itself while the two drifted apart, and the symptom would be a
    // rejected upload nobody can act on.
    expect(MAX_DOCUMENT_BYTES).toBe(
      rulesByteCeiling("acceptableDocumentUpload"),
    );
    expect(MAX_IMAGE_BYTES).toBe(rulesByteCeiling("acceptablePhotoUpload"));
    // The relationship is the point, so it is asserted rather than left to two
    // literals happening to differ.
    expect(MAX_DOCUMENT_BYTES).toBeGreaterThan(MAX_IMAGE_BYTES);
  });

  // The ten-per-list caps used to be asserted here against the literal 10, in
  // a test that also duplicated the one in `imageVariants.test.ts`. Neither
  // could fail without editing the constant it asserted, and the caps are a
  // product choice: `storage.rules` counts nothing, so there is nothing to
  // cross-check them against. The separate-caps decision they were documenting
  // is carried by the two constants themselves.
});

describe("fileExtension", () => {
  it("reads the extension off the filename, lowercased", () => {
    expect(fileExtension("condition-report.pdf")).toBe("pdf");
    expect(fileExtension("SCAN.JPG")).toBe("jpg");
    expect(fileExtension("a.b.c.webp")).toBe("webp");
  });

  it("treats a leading dot as a dotfile, not an extension", () => {
    // `.gitignore` has no extension. Returning "gitignore" would put a page
    // glyph on it and, worse, an `.gitignore` name off the extension map.
    expect(fileExtension(".gitignore")).toBe("");
  });

  it("treats a trailing dot as no extension", () => {
    expect(fileExtension("report.")).toBe("");
  });

  it("returns nothing for a name with no dot at all", () => {
    expect(fileExtension("README")).toBe("");
  });
});

describe("documentExtension", () => {
  it("names a PDF off its own filename", () => {
    // The regression this whole function exists for: the extension used to come
    // from `extensionFor`, an image helper, which answers `bin` for a type it
    // does not know. Every PDF then went up as `{artworkId}_{docId}_original.bin`
    // and `isDocumentName` rejected it — a 403 on 100% of PDFs, while images
    // worked, which is a shape of bug that reads as "the rules are wrong".
    expect(
      documentExtension("Get_Started_With_Smallpdf.pdf", "application/pdf"),
    ).toBe("pdf");
    expect(documentExtension("condition-report.pdf", "application/pdf")).toBe(
      "pdf",
    );
  });

  it("ignores the case of the filename's extension", () => {
    expect(documentExtension("SCAN.PDF", "application/pdf")).toBe("pdf");
  });

  it("falls back to the type only when the name has no extension", () => {
    // A name with no dot is the one case the filename cannot answer, and the
    // single non-image type this app accepts has exactly one honest extension.
    expect(documentExtension("scan", "application/pdf")).toBe("pdf");
  });

  it("refuses rather than guessing", () => {
    // Null, not a fallback. A name outside the allowlist is a denied upload, so
    // there is nothing to fall back *to* — the honest answer is to refuse and let
    // the caller say so.
    expect(documentExtension("archive.zip", "application/zip")).toBeNull();
    expect(documentExtension("page.html", "text/html")).toBeNull();
    expect(documentExtension("vector.svg", "image/svg+xml")).toBeNull();
  });

  it("never derives `bin`, whatever the file", () => {
    // The original bug stated as a property rather than a case, so it cannot come
    // back through a refactor of the function body: `extensionFor` answers `bin`
    // for any type it does not know, every PDF went through it, and `bin` is not
    // on the allowlist so every one of them was denied.
    const names = [
      "scan.pdf",
      "SCAN.PDF",
      "a.b.pdf",
      "scan",
      "no-extension",
      "trailing.",
      ".hidden",
      "archive.zip",
      "payload.html",
      "",
    ];
    const types = [
      "application/pdf",
      "application/octet-stream",
      "",
      "image/jpeg",
      "text/html",
    ];

    for (const name of names) {
      for (const type of types) {
        const extension = documentExtension(name, type);
        expect(
          extension === null || isDocumentExtension(extension),
          `${name} (${type}) derived ${extension}`,
        ).toBe(true);
      }
    }
  });

  it("does not let an accepted type launder a name the rules would deny", () => {
    // The fallback is for a name with no extension, not a licence to ignore one.
    // `contentType` is client-supplied and forgeable, so the extension is the only
    // thing the server can bind to the name: a `payload.html` that claims to be a
    // PDF must not become `_original.pdf`, or the allowlist is doing nothing.
    expect(documentExtension("payload.html", "application/pdf")).toBeNull();
    expect(documentExtension("payload.svg", "application/pdf")).toBeNull();
  });

  it("takes the name over the type when the name is nameable", () => {
    // A `.pdf` the browser called an image is still stored as a PDF: the type is
    // the client-supplied half, the name is what the user recognises.
    expect(documentExtension("scan.pdf", "image/jpeg")).toBe("pdf");
  });

  it("normalises a `.jpeg` name to the `jpg` the rules permit", () => {
    // The accept map offers `.jpeg` and `EXTENSION_BY_TYPE` has no `jpeg` entry,
    // so a `photo.jpeg` reaches `uploadImage` as an image/jpeg and is named from
    // its *type* — `jpg`, which the rules allow. `isDocumentName` never sees the
    // `.jpeg`, so there is nothing to normalise here; this pins that the two
    // halves of the extension story do not need reconciling.
    expect(documentExtension("photo.jpeg", "image/jpeg")).toBeNull();
    expect(extensionFor("image/jpeg")).toBe("jpg");
  });
});

describe("DOCUMENT_EXTENSIONS", () => {
  it("pins the allowlist to those four, so it cannot be widened unnoticed", () => {
    // Written out rather than derived, and deliberately not built from
    // ACCEPTED_DOCUMENT_TYPES: that map also lists `.jpeg`, which the rules do
    // not accept as a stored extension.
    //
    // The title used to say this "mirrors the extensions `isDocumentName`
    // permits", which it never checked — it reads no rules at all, and the test
    // below is the one that does. What this *is* for is the other direction:
    // the two together assert client == rules, but only this one notices the
    // rules being widened. That is the XSS control `AGENTS.md` describes, and
    // adding `html` to fix a client error would make the test below pass.
    expect([...DOCUMENT_EXTENSIONS]).toEqual(["webp", "jpg", "png", "pdf"]);
  });

  it("permits exactly what the storage rules permit", () => {
    // The seam that was untested, and the one that was untested *wrongly*: this
    // used to assert every `DOCUMENT_EXTENSIONS` member against
    // `isDocumentExtension`, which is `DOCUMENT_EXTENSIONS.includes` — the set
    // against itself, true by construction whatever the rules say. The claim in
    // the name is about `storage.rules`, so that is what it now reads.
    expect([...DOCUMENT_EXTENSIONS]).toEqual(
      rulesExtensionList("isDocumentName"),
    );
  });

  it("names an object the rules will accept, for every extension it produces", () => {
    // And the same claim one step further out: not just "our set equals the
    // rules' set" but "a name built the way the client builds one passes the
    // pattern the rules actually apply". The set comparison above would survive
    // the two lists agreeing on a name the pattern rejects — `isDocumentName`
    // checks the whole shape, and the set is only the extensions half of it.
    const artworkId = "art1";
    const documentId = "aaaaaaaaaaaaaaaaaaaa";
    const pattern = rulesNamePattern("isDocumentName", artworkId);

    for (const extension of DOCUMENT_EXTENSIONS) {
      const name = `${artworkId}_${documentId}_original.${extension}`;
      expect(pattern.test(name), `${name} is not an accepted name`).toBe(true);
    }
  });

  it("refuses an extension the rules would reject, whatever the name", () => {
    // The negative direction, and the XSS control: `contentType` is
    // client-supplied and forgeable, so the name is the only thing the rule can
    // bind the declared type to. Allowing `svg` or `html` here would make an
    // uploaded SVG navigated to directly execute in the storage origin.
    const artworkId = "art1";
    const documentId = "aaaaaaaaaaaaaaaaaaaa";
    const pattern = rulesNamePattern("isDocumentName", artworkId);

    for (const extension of ["bin", "jpeg", "gif", "svg", "html", "exe"]) {
      const name = `${artworkId}_${documentId}_original.${extension}`;
      expect(pattern.test(name), `${name} was accepted`).toBe(false);
      // The client's own predicate has to agree, or a rejected name would be
      // one the form still offers.
      expect(isDocumentExtension(extension)).toBe(false);
    }
  });

  it("has an extension for every type the form accepts", () => {
    // The one that would have caught the original bug at the point it was
    // introduced. An image type reaches `uploadImage`, which names objects from
    // the type; a new type added to the accept map without a matching entry in
    // EXTENSION_BY_TYPE would silently start producing `.bin` names, exactly as
    // the PDF path did.
    const pattern = rulesNamePattern("isDocumentName", "art1");
    for (const type of Object.keys(ACCEPTED_DOCUMENT_TYPES)) {
      const extension = type === "application/pdf" ? "pdf" : extensionFor(type);
      // The rules' pattern, not only the client's predicate: the question is
      // whether such a name would be *accepted*, and the two are different
      // files.
      expect(
        pattern.test(`art1_aaaaaaaaaaaaaaaaaaaa_original.${extension}`),
        `${type} would be stored as _original.${extension}, which is not accepted`,
      ).toBe(true);
      expect(isDocumentExtension(extension)).toBe(true);
    }
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
    // The counterpart to `photoOrderChanged`. Reordering the UI is not a change
    // worth a write, and treating it as one would rewrite every storage URL for
    // nothing.
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
