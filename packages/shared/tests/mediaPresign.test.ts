// The staged-media wire shapes: presign, and the process answer.
//
// The shapes are the contract both sides compile against, so these pin the
// facts a client would break on rather than the whole document: the presign
// request names one entry and declares one type and size (and stays silent on
// the allowlist and the cap — `checkDeclaredUpload` is their authority, and a
// second copy here could only disagree), the answer points at one `PUT`, and
// the process answer carries the original's metadata beside its variants.

import { describe, expect, it } from "vitest";
import {
  mediaPresignRequestSchema,
  mediaPresignResponseSchema,
  mediaProcessResponseSchema,
} from "../src/schemas/media";

const presignRequest = (overrides: Record<string, unknown> = {}) => ({
  entryId: "aB3d9Kx2Qp",
  contentType: "image/jpeg",
  size: 5_242_880,
  ...overrides,
});

const presignResponse = (overrides: Record<string, unknown> = {}) => ({
  entryId: "aB3d9Kx2Qp",
  uploadUrl:
    "http://localhost:9000/arcula-media/staging/u/c/a/aB3d9Kx2Qp.jpg?X-Amz-Signature=…",
  method: "PUT",
  headers: { "Content-Type": "image/jpeg" },
  url: "/api/v1/media?key=staging/u/c/a/aB3d9Kx2Qp.jpg",
  expiresAt: "2026-01-01T00:05:00.000Z",
  ...overrides,
});

const processResponse = (overrides: Record<string, unknown> = {}) => ({
  entryId: "aB3d9Kx2Qp",
  name: "nocturne.jpg",
  width: 3024,
  height: 4032,
  size: 5_242_880,
  contentType: "image/jpeg",
  url: "/api/v1/media?key=staging/u/c/a/aB3d9Kx2Qp.jpg",
  variants: [
    {
      key: "large",
      url: "/api/v1/media?key=staging/u/c/a/aB3d9Kx2Qp_large.webp",
      width: 1200,
      height: 1600,
      size: 90_000,
      contentType: "image/webp",
    },
  ],
  ...overrides,
});

describe("the presign request", () => {
  it("reads an entry's type and size, with the original's name optional", () => {
    expect(mediaPresignRequestSchema.parse(presignRequest()).entryId).toBe(
      "aB3d9Kx2Qp",
    );
    expect(
      mediaPresignRequestSchema.parse(presignRequest({ name: "nocturne.jpg" }))
        .name,
    ).toBe("nocturne.jpg");
    expect(mediaPresignRequestSchema.parse(presignRequest()).name).toBe(
      undefined,
    );
  });

  it("refuses an entry id the staging key cannot carry", () => {
    // The id is a segment of the staging key and an own-property question on
    // the row's table, so a hyphen or a path separator is not a rename — it is
    // a different key. `MINTED_ID_RE` is the single owner of that set.
    expect(
      mediaPresignRequestSchema.safeParse(presignRequest({ entryId: "a-b" }))
        .success,
    ).toBe(false);
    expect(
      mediaPresignRequestSchema.safeParse(presignRequest({ entryId: "" }))
        .success,
    ).toBe(false);
  });

  it("requires the declared size and type a presigner has to sign", () => {
    expect(
      mediaPresignRequestSchema.safeParse(presignRequest({ size: undefined }))
        .success,
    ).toBe(false);
    expect(
      mediaPresignRequestSchema.safeParse(
        presignRequest({ contentType: undefined }),
      ).success,
    ).toBe(false);
  });

  it("leaves the allowlist and the cap to the guard", () => {
    // Shape only: an SVG at a gigabyte parses. The API refuses it through
    // `checkDeclaredUpload`, which is where the caps live — a schema that also
    // enumerated types would be the duplication the shared contract exists to
    // remove.
    expect(
      mediaPresignRequestSchema.safeParse(
        presignRequest({ contentType: "image/svg+xml", size: 1024 ** 3 }),
      ).success,
    ).toBe(true);
  });
});

describe("the presign answer", () => {
  it("names one PUT target, the headers to send, the proxy url and the expiry", () => {
    const parsed = mediaPresignResponseSchema.parse(presignResponse());

    expect(parsed.uploadUrl).toContain("X-Amz-Signature");
    expect(parsed.method).toBe("PUT");
    expect(parsed.headers["Content-Type"]).toBe("image/jpeg");
    expect(parsed.url).toBe("/api/v1/media?key=staging/u/c/a/aB3d9Kx2Qp.jpg");
    expect(parsed.expiresAt).toBe("2026-01-01T00:05:00.000Z");
  });

  it("requires every field a client needs to complete the upload", () => {
    for (const field of [
      "uploadUrl",
      "method",
      "headers",
      "url",
      "expiresAt",
    ]) {
      expect(
        mediaPresignResponseSchema.safeParse(
          presignResponse({ [field]: undefined }),
        ).success,
      ).toBe(false);
    }
  });
});

describe("the process answer", () => {
  it("carries the original's metadata beside its variants", () => {
    // The presign step never held the bytes, so process is the first place the
    // dimensions and the real size are known: the form reads them from here.
    const parsed = mediaProcessResponseSchema.parse(processResponse());

    expect(parsed.width).toBe(3024);
    expect(parsed.height).toBe(4032);
    expect(parsed.size).toBe(5_242_880);
    expect(parsed.contentType).toBe("image/jpeg");
    expect(parsed.name).toBe("nocturne.jpg");
    expect(parsed.url).toBe("/api/v1/media?key=staging/u/c/a/aB3d9Kx2Qp.jpg");
    expect(parsed.variants.map((variant) => variant.key)).toEqual(["large"]);
  });

  it("reads a PDF with no dimensions and no variants", () => {
    // A document that is not an image has no size to measure in pixels and
    // nothing to generate; the original is the whole entry.
    const parsed = mediaProcessResponseSchema.parse(
      processResponse({
        name: "condition-report.pdf",
        width: null,
        height: null,
        contentType: "application/pdf",
        variants: [],
      }),
    );

    expect(parsed.width).toBe(null);
    expect(parsed.height).toBe(null);
    expect(parsed.variants).toEqual([]);
  });
});
