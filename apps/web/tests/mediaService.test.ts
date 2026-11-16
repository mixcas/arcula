import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mediaService } from "@/services/mediaService";
import { ApiRequestError } from "@/services/api";
import { MediaUploadError } from "@/services/uploadError";

/**
 * The direct hop, at the service's own seam.
 *
 * The uploader suites mock this module, so the three steps it owns — presign,
 * the PUT to storage, process — are invisible from there. Two of the things
 * this file pins are the kind a review cannot see:
 *
 *   - the session cookie is NOT sent to the storage origin (`credentials:
 *     "omit"`). Sending it would hand the app's credential to a third host,
 *     and both the PUT and the page would still work perfectly.
 *   - the PUT carries exactly the headers the presign answered, because real
 *     S3 compares them with the signature. Re-casing one, or dropping the
 *     signed `x-amz-meta-name`, is a refusal no local test would notice.
 *
 * `fetch` is the browser's HTTP client here, not a collaborator: stubbing it
 * is how each transport is told apart, and it is the only way to see that the
 * bytes go to the presigned URL rather than through the API.
 */

const CATALOGUE_ID = "catalogue-1";
const ARTWORK_ID = "artwork-1";
const ENTRY_ID = "entry1";
const UPLOAD_URL =
  "http://127.0.0.1:9000/arcula/staging/u/c/a/entry1.jpg?X-Amz-Signature=secret";

const presignAnswer = {
  entryId: ENTRY_ID,
  uploadUrl: UPLOAD_URL,
  method: "PUT" as const,
  headers: {
    "content-type": "image/jpeg",
    "x-amz-meta-name": "scan.jpg",
  },
  url: `/api/v1/media?key=${encodeURIComponent("staging/u/c/a/entry1.jpg")}`,
  expiresAt: new Date(Date.now() + 300_000).toISOString(),
};

const processAnswer = {
  entryId: ENTRY_ID,
  name: "scan.jpg",
  width: 400,
  height: 300,
  size: 3,
  contentType: "image/jpeg",
  url: `/api/v1/media?key=${encodeURIComponent("staging/u/c/a/entry1.jpg")}`,
  variants: [],
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const file = () =>
  new File([new Uint8Array([1, 2, 3])], "scan.jpg", { type: "image/jpeg" });

let calls: { url: string; init: RequestInit | undefined }[];

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stagePhoto", () => {
  it("declares the file, PUTs it to the presigned URL, and answers the proxy path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (url.endsWith("/stage")) {
          return Promise.resolve(jsonResponse(200, presignAnswer));
        }
        if (url === UPLOAD_URL) {
          return Promise.resolve(new Response(null, { status: 200 }));
        }
        throw new Error(`unexpected request to ${url}`);
      }),
    );

    const staged = await mediaService.stagePhoto(
      CATALOGUE_ID,
      ARTWORK_ID,
      ENTRY_ID,
      file(),
    );

    // The JSON declaration replaces the multipart body entirely: type, size
    // and name are claims the API checks, not measurements.
    const presignBody: unknown = JSON.parse(calls[0]?.init?.body as string);
    expect(calls[0]?.url).toBe(
      `/api/v1/catalogues/${CATALOGUE_ID}/artworks/${ARTWORK_ID}/photos/stage`,
    );
    expect(presignBody).toEqual({
      entryId: ENTRY_ID,
      contentType: "image/jpeg",
      size: 3,
      name: "scan.jpg",
    });

    // The bytes go straight to storage with the signed headers, and without
    // the app's cookie.
    expect(calls[1]?.url).toBe(UPLOAD_URL);
    expect(calls[1]?.init?.method).toBe("PUT");
    expect(calls[1]?.init?.headers).toEqual(presignAnswer.headers);
    expect(calls[1]?.init?.credentials).toBe("omit");

    // What the caller gets is the proxy path and the entry id — never the
    // presigned URL, which is a bearer token the form has no use for.
    expect(staged).toEqual({ entryId: ENTRY_ID, url: presignAnswer.url });
    expect(JSON.stringify(staged)).not.toContain("X-Amz-Signature");
  });

  it("rejects with an upload error when storage refuses the PUT", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/stage")) {
          return Promise.resolve(jsonResponse(200, presignAnswer));
        }
        return Promise.resolve(new Response(null, { status: 403 }));
      }),
    );

    await expect(
      mediaService.stagePhoto(CATALOGUE_ID, ARTWORK_ID, ENTRY_ID, file()),
    ).rejects.toBeInstanceOf(MediaUploadError);
  });

  it("rejects with an upload error when the PUT cannot reach storage", async () => {
    // A CORS refusal or a dead connection rejects the fetch itself. It has no
    // status, and it is still the PUT failing — not an API error.
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.endsWith("/stage")) {
          return Promise.resolve(jsonResponse(200, presignAnswer));
        }
        return Promise.reject(new TypeError("Failed to fetch"));
      }),
    );

    await expect(
      mediaService.stagePhoto(CATALOGUE_ID, ARTWORK_ID, ENTRY_ID, file()),
    ).rejects.toBeInstanceOf(MediaUploadError);
  });

  it("surfaces a presign refusal as the API's own error, without a PUT", async () => {
    // The declaration is refused before any URL is minted: the form shows the
    // API's field-level reason, and no byte is sent anywhere.
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse(400, {
          error: {
            code: "validation",
            message: "The file is too large",
            fields: { file: "too large" },
          },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await mediaService
      .stagePhoto(CATALOGUE_ID, ARTWORK_ID, ENTRY_ID, file())
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).fields).toEqual({ file: "too large" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("processDocument", () => {
  it("asks the process route with only the entry id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve(jsonResponse(200, processAnswer));
      }),
    );

    const processed = await mediaService.processDocument(
      CATALOGUE_ID,
      ARTWORK_ID,
      ENTRY_ID,
    );

    expect(calls[0]?.url).toBe(
      `/api/v1/catalogues/${CATALOGUE_ID}/artworks/${ARTWORK_ID}/documents/process`,
    );
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      entryId: ENTRY_ID,
    });
    // The measurements come from the process answer — the presign had no
    // bytes to measure.
    expect(processed).toEqual(processAnswer);
  });
});
