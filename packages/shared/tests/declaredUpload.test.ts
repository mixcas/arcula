// The declared-upload guard, pure (tier 1).
//
// A presign call never carries the bytes, so the only thing the API can check
// when it mints a URL is what the client DECLARES: a content type and a size.
// This is the one function both the web form and the API ask, and these tests
// pin the two facts that make it worth having — each population's cap boundary
// (the cap itself is allowed, one byte over is not) and each population's
// allowlist (its own types in, everything else out). Flip either comparison or
// widen either table and a case below goes red.

import { describe, expect, it } from "vitest";
import {
  ACCEPTED_DOCUMENT_TYPES,
  ACCEPTED_IMAGE_TYPES,
  checkDeclaredUpload,
  isDeclaredUploadAllowed,
  MAX_DOCUMENT_BYTES,
  MAX_IMAGE_BYTES,
} from "../src/caps";

const WELL_UNDER_CAP = 1024;

describe("the size cap", () => {
  it("admits a photo exactly at the 10 MiB cap and refuses one byte more", () => {
    expect(checkDeclaredUpload("photo", "image/jpeg", MAX_IMAGE_BYTES)).toBe(
      "allowed",
    );
    expect(
      checkDeclaredUpload("photo", "image/jpeg", MAX_IMAGE_BYTES + 1),
    ).toBe("too-large");
  });

  it("admits a document exactly at the 25 MiB cap and refuses one byte more", () => {
    // The larger of the two caps, and the one the old transport never reached:
    // a document at the cap must be admitted by this guard, not just the
    // photo's number.
    expect(
      checkDeclaredUpload("document", "application/pdf", MAX_DOCUMENT_BYTES),
    ).toBe("allowed");
    expect(
      checkDeclaredUpload(
        "document",
        "application/pdf",
        MAX_DOCUMENT_BYTES + 1,
      ),
    ).toBe("too-large");
  });

  it("judges each population by its own cap, not the other's", () => {
    // A byte count between the two caps is legal for a document and illegal
    // for a photo. One shared ceiling would pass one of these and fail the
    // other.
    const between = MAX_IMAGE_BYTES + 1;
    expect(checkDeclaredUpload("photo", "image/png", between)).toBe(
      "too-large",
    );
    expect(checkDeclaredUpload("document", "image/png", between)).toBe(
      "allowed",
    );
  });

  it("refuses a size that is not a positive whole number of bytes", () => {
    // An empty file is not an upload, and a negative, fractional or
    // non-numeric one is a malformed declaration rather than an honest file
    // that is too big: it must not be able to slip past `size > cap`.
    for (const size of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkDeclaredUpload("photo", "image/jpeg", size)).toBe(
        "invalid-size",
      );
      expect(checkDeclaredUpload("document", "application/pdf", size)).toBe(
        "invalid-size",
      );
    }
  });
});

describe("the allowlists", () => {
  it("admits exactly the types the photos' allowlist carries", () => {
    for (const contentType of Object.keys(ACCEPTED_IMAGE_TYPES)) {
      expect(checkDeclaredUpload("photo", contentType, WELL_UNDER_CAP)).toBe(
        "allowed",
      );
    }
  });

  it("admits exactly the types the documents' allowlist carries, PDF included", () => {
    for (const contentType of Object.keys(ACCEPTED_DOCUMENT_TYPES)) {
      expect(checkDeclaredUpload("document", contentType, WELL_UNDER_CAP)).toBe(
        "allowed",
      );
    }
  });

  it("refuses the types that execute when navigated to, for both populations", () => {
    // The reason the list is narrow: both of these run script in the origin
    // that serves them, and the media proxy serves from the app's own origin.
    for (const contentType of ["image/svg+xml", "text/html"]) {
      expect(checkDeclaredUpload("photo", contentType, WELL_UNDER_CAP)).toBe(
        "unsupported-type",
      );
      expect(checkDeclaredUpload("document", contentType, WELL_UNDER_CAP)).toBe(
        "unsupported-type",
      );
    }
  });

  it("refuses a PDF as a photo, though the documents' list admits it", () => {
    expect(
      checkDeclaredUpload("photo", "application/pdf", WELL_UNDER_CAP),
    ).toBe("unsupported-type");
  });

  it("refuses a type that is only an inherited object key", () => {
    // The allowlist is a plain object literal, so `"toString" in table` is
    // true. Membership has to be an own-property question, or the guard
    // admits anything whose name matches Object.prototype.
    for (const contentType of ["toString", "constructor", "hasOwnProperty"]) {
      expect(checkDeclaredUpload("photo", contentType, WELL_UNDER_CAP)).toBe(
        "unsupported-type",
      );
      expect(checkDeclaredUpload("document", contentType, WELL_UNDER_CAP)).toBe(
        "unsupported-type",
      );
    }
  });

  it("refuses an empty, case-flipped or unbounded type", () => {
    // The declared type becomes the stored object's content type, which the
    // proxy serves back, so the match is exact — no trimming, no folding.
    for (const contentType of ["", "IMAGE/JPEG", "image/jpeg ", "*/*"]) {
      expect(checkDeclaredUpload("photo", contentType, WELL_UNDER_CAP)).toBe(
        "unsupported-type",
      );
    }
  });
});

describe("the failed type ahead of the failed size", () => {
  it("names the type when both the type and the size are refused", () => {
    // A forged type is a different failure from an honest file that is too
    // big, and the two reach the form as different reasons. The type is the
    // one that decides whether an extension is minted at all, so it is the
    // one reported.
    expect(checkDeclaredUpload("photo", "text/html", MAX_IMAGE_BYTES + 1)).toBe(
      "unsupported-type",
    );
  });
});

describe("the boolean form", () => {
  it("is true exactly when the verdict is allowed", () => {
    // The web form only needs a yes or no; it must not be able to disagree
    // with the verdict the API would give the same declaration.
    expect(isDeclaredUploadAllowed("photo", "image/webp", 5_000)).toBe(true);
    expect(isDeclaredUploadAllowed("photo", "image/webp", 0)).toBe(false);
    expect(isDeclaredUploadAllowed("document", "text/html", 5_000)).toBe(false);
    expect(
      isDeclaredUploadAllowed(
        "document",
        "application/pdf",
        MAX_DOCUMENT_BYTES,
      ),
    ).toBe(true);
  });
});
