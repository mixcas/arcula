/**
 * The staged-media operations of the service layer.
 *
 * A file that lands in a form is uploaded to staging the moment it is added —
 * `stage*` — and the server generates its display variants and measures the
 * original on demand — `process*`. Neither call touches the artwork's rows:
 * the entries only become rows in the save transaction, which is why staging
 * needs only catalogue membership, not an existing artwork. An entry the form
 * drops is `discard`ed; a save that fails after promoting its entries leaves
 * the final objects in place, and that residual is the sweep's job, not this
 * module's.
 *
 * ## The direct hop
 *
 * `stage*` is three steps, and this module is the only place they meet:
 *
 *   1. **presign** — a JSON call declaring the file's type, size and name. The
 *      API refuses a declaration the population does not admit and answers a
 *      short-lived URL for one staged key.
 *   2. **PUT** — the file goes straight from the browser to storage with
 *      exactly the headers the presign answered. The bytes never pass through
 *      the API, which is what makes a phone photograph over a Lambda's
 *      payload ceiling possible at all.
 *   3. (separately) **process** — the server reads the object, validates it and
 *      answers its measurements and variants.
 *
 * The PUT is deliberately not `apiRequest`: it goes to a different host, it
 * sends no session cookie (`credentials: "omit"` — the URL is the whole
 * authority for that one object, and an app credential must never be handed to
 * a storage origin), and a failure there is not an API error envelope.
 *
 * The presigned URL is a bearer token. It is not logged, not put in an error
 * message, and not returned to callers: `stage*` answers the staged object's
 * proxy path, which is all the form needs.
 *
 * The methods come in photo/document pairs rather than one parameterised
 * call: the two populations have different caps and accepted types on the
 * server, and a pair of names makes a wrong population a compile error rather
 * than a 400 that the form would have to explain.
 */

import type {
  MediaPresignRequest,
  MediaPresignResponse,
  MediaProcessResponse,
} from "@arcula/shared";
import { apiRequest } from "./api";
import { MediaUploadError } from "./uploadError";

/** A staged original, as the form holds it before save. */
export interface StagedTarget {
  entryId: string;
  /** The staged object's proxy path — not the presigned storage URL. */
  url: string;
}

/** The process answer: the original as measured, and its variants. */
export type StagedMedia = MediaProcessResponse;

const base = (
  catalogueId: string,
  artworkId: string,
  population: "photos" | "documents",
) => `/api/v1/catalogues/${catalogueId}/artworks/${artworkId}/${population}`;

/**
 * The browser's half: PUT the file to the presigned URL.
 *
 * The headers are sent verbatim — storage compares them with the signature, so
 * re-casing or adding one is a refusal (and on real S3, a missing signed
 * `x-amz-meta-name` is too: the name is part of the object, not a decoration).
 * `body: file` streams the blob rather than buffering it in JS.
 */
const upload = async (
  target: MediaPresignResponse,
  file: File,
): Promise<void> => {
  let res: Response;
  try {
    res = await fetch(target.uploadUrl, {
      method: target.method,
      headers: target.headers,
      body: file,
      // The URL is the authority for this one object. Sending the session
      // cookie to a storage host would hand the app's credential to a third
      // origin, and the signature does not need it.
      credentials: "omit",
    });
  } catch {
    // A transport failure (offline, DNS, CORS refusal) has no status: the
    // browser deliberately hides which. "Could not be uploaded" is all there
    // is, and the sweep will not have an object to clean because a failed PUT
    // writes nothing.
    throw new MediaUploadError();
  }
  if (!res.ok) {
    throw new MediaUploadError();
  }
};

const stage = async (
  catalogueId: string,
  artworkId: string,
  population: "photos" | "documents",
  entryId: string,
  file: File,
): Promise<StagedTarget> => {
  const declaration: MediaPresignRequest = {
    entryId,
    contentType: file.type,
    size: file.size,
    name: file.name,
  };
  const target = await apiRequest<MediaPresignResponse>(
    `${base(catalogueId, artworkId, population)}/stage`,
    { method: "POST", body: declaration },
  );
  await upload(target, file);
  return { entryId: target.entryId, url: target.url };
};

const process = async (
  catalogueId: string,
  artworkId: string,
  population: "photos" | "documents",
  entryId: string,
): Promise<StagedMedia> =>
  apiRequest<StagedMedia>(
    `${base(catalogueId, artworkId, population)}/process`,
    { method: "POST", body: { entryId } },
  );

const discard = async (
  catalogueId: string,
  artworkId: string,
  population: "photos" | "documents",
  entryId: string,
): Promise<void> => {
  await apiRequest(
    `${base(catalogueId, artworkId, population)}/${encodeURIComponent(entryId)}`,
    { method: "DELETE" },
  );
};

export const mediaService = {
  /** Presign and PUT the original into staging. Re-runnable for the same
   *  entry: the presign discards the previous objects first. */
  stagePhoto: (
    catalogueId: string,
    artworkId: string,
    entryId: string,
    file: File,
  ) => stage(catalogueId, artworkId, "photos", entryId, file),

  /** Validate the stored photo and generate its variants. The server owns the
   *  geometry and the encoder; the answer is the truth for what the form
   *  renders and records. */
  processPhoto: (catalogueId: string, artworkId: string, entryId: string) =>
    process(catalogueId, artworkId, "photos", entryId),

  /** Remove a staged photo entry. Idempotent — nothing to delete answers 200. */
  discardPhoto: (catalogueId: string, artworkId: string, entryId: string) =>
    discard(catalogueId, artworkId, "photos", entryId),

  /** Presign and PUT the original into staging, document flavour (25 MiB,
   *  PDFs admitted). */
  stageDocument: (
    catalogueId: string,
    artworkId: string,
    entryId: string,
    file: File,
  ) => stage(catalogueId, artworkId, "documents", entryId, file),

  /** Validate the stored document and generate an image's variants; a PDF
   *  answers `[]` and null dimensions. Always called: process is the byte
   *  validation, so a PDF that skipped it would never be checked. */
  processDocument: (catalogueId: string, artworkId: string, entryId: string) =>
    process(catalogueId, artworkId, "documents", entryId),

  /** Remove a staged document entry. Idempotent. */
  discardDocument: (catalogueId: string, artworkId: string, entryId: string) =>
    discard(catalogueId, artworkId, "documents", entryId),
};
