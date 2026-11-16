// The app's single S3 client.
//
// One module owns every object operation the app performs — put, get,
// head, delete, copy, list, and the presigned upload URL that lets a
// browser write straight to storage. It knows nothing about photos,
// documents or catalogues: keys are built by `media/keys.ts`, and everything
// above this layer reads them back through that module's parser.
//
// The client reads its config at import time, like env.ts. The `test`
// and `dev` scripts source the root .env first, so every entry point
// sees the same values; a missing endpoint or bucket throws here rather
// than silently falling through to AWS's default endpoint.
//
// Credentials have two sources, in order: the explicit
// S3_ACCESS_KEY/S3_SECRET_KEY pair (local dev — .env points the client
// at the SeaweedFS stand-in), and, when absent, the SDK's default
// credential chain — which on the Lambda is its IAM role, so the
// production environment carries no long-lived keys. A deployment
// without either fails on the first object operation with the SDK's
// no-credentials error, not silently.

import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in the environment`);
  return value;
}

// S3_FORCE_PATH_STYLE defaults to on: the local SeaweedFS stand-in
// requires it, and the deployed environment inherits the same path-style
// address (its S3_ENDPOINT is the regional endpoint), so the presigned
// URL names the bucket as the first path segment in both. A
// virtual-hosted deployment has to set it to "false" explicitly.
export const BUCKET = process.env.S3_BUCKET ?? "arcula";

export const s3 = new S3Client({
  endpoint: required("S3_ENDPOINT"),
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== "false",
  // Static keys when the env carries them (local dev), otherwise the
  // default chain — the Lambda's IAM role in production.
  credentials:
    process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY,
          secretAccessKey: process.env.S3_SECRET_KEY,
        }
      : undefined,
  // The SDK computes a CRC32 checksum for every request by default, and a
  // presigned PUT has no body yet: it signs the checksum of an empty
  // string, so the real object's bytes fail `BadDigest` at upload time.
  // "WHEN_REQUIRED" leaves checksums off unless an operation demands one,
  // which is the price of presigning with this client. Normal put/get
  // behaviour is unchanged (S3 never required a checksum there).
  requestChecksumCalculation: "WHEN_REQUIRED",
});

/**
 * Write bytes under a key. The content type is recorded on the object:
 * it is what the proxy later serves back, and what a console reader
 * sees without fetching the body.
 */
export const putObject = (
  key: string,
  body: Uint8Array | string,
  contentType: string,
) =>
  s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

/** The raw object stream plus its recorded metadata (the proxy's path). */
export const streamObject = (key: string) =>
  s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));

/** The bytes, the recorded content type and the object's metadata, in one
 *  request. The metadata is what `presignPut` recorded at upload time — the
 *  staged original's name, read back when the bytes are validated. */
export async function readObject(key: string): Promise<{
  bytes: Uint8Array;
  contentType: string | null;
  metadata: Record<string, string> | undefined;
}> {
  const res = await streamObject(key);
  const body: unknown = res.Body;
  let bytes: Uint8Array;
  if (body instanceof ReadableStream) {
    bytes = new Uint8Array(await new Response(body).arrayBuffer());
  } else if (body instanceof Readable) {
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(chunk as Buffer);
    bytes = new Uint8Array(Buffer.concat(chunks));
  } else {
    throw new Error("unconsumable S3 response body");
  }
  return {
    bytes,
    contentType: res.ContentType ?? null,
    metadata: res.Metadata,
  };
}

/** Read an object back as bytes. Rejects on a missing object — see `isObjectMissing`. */
export const objectBytes = async (key: string): Promise<Uint8Array> =>
  (await readObject(key)).bytes;

export const headObject = (key: string) =>
  s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));

/** Best-effort: deleting a key that is already gone is a 204, not an error. */
export const deleteObject = (key: string) =>
  s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));

/**
 * Copy within the bucket. `MetadataDirective: "REPLACE"` with an
 * explicit content type: the destination's record is what the caller
 * passes, not whatever headers the source object happens to carry.
 */
export const copyObject = (
  fromKey: string,
  toKey: string,
  contentType: string,
) =>
  s3.send(
    new CopyObjectCommand({
      Bucket: BUCKET,
      CopySource: `${BUCKET}/${fromKey}`,
      Key: toKey,
      MetadataDirective: "REPLACE",
      ContentType: contentType,
    }),
  );

/**
 * Mint a short-lived, single-object `PUT` URL for a staged upload.
 *
 * This is the same client, bucket and credentials every other operation
 * uses — endpoint, region and path style all come from `s3`, so local and
 * production sign the same way (static keys locally, the Lambda's role in
 * production).
 *
 * The URL is a bearer token with write authority over one key until it
 * expires: **never log it**, and never put it in an error message. If it
 * leaks it can overwrite that one staged object and nothing else.
 *
 * The signature pins the declared content type, so a client cannot obtain
 * a URL for `image/jpeg` and upload `text/html`: the object is stored with
 * the type the media proxy will later serve. Two details make that work:
 *
 * - `signableHeaders` re-adds `content-type` to the signed set. The SDK's
 *   presigner marks it unsignable by default, which would leave the type
 *   free to differ from the signature.
 * - The declared length is deliberately **not** signed. `content-length`
 *   is a forbidden header for `fetch`: the browser sets it itself, or
 *   omits it entirely under HTTP/2, so a signed value would make the
 *   upload flaky. The size is enforced from the declaration at presign
 *   time and, authoritatively, from the stored object's own length when
 *   the bytes are processed.
 *
 * SeaweedFS (the local stand-in) runs anonymous and does not verify the
 * signature, so it accepts a PUT to these URLs with any content type; real
 * S3 rejects a mismatch. The staged object is therefore always validated
 * again at process time, never trusted from the presign call.
 *
 * `metadata` is recorded ON the object (`x-amz-meta-{key}`) and signed the
 * same way as the content type, which is what makes the object
 * self-describing across the hop. The values must be header-safe — ASCII is
 * all a header carries — so a caller with a human string encodes it first.
 * `unhoistableHeaders` is load-bearing: without it the SDK moves `x-amz-meta-*`
 * into the URL's query string, where a filename would join the bearer token in
 * every access log. Signed headers stay in the request, and the client sends
 * them verbatim because `headers` below is the whole signed set.
 *
 * Five minutes is long enough for a phone photograph on a slow connection
 * and short enough that a leaked URL is worth little. It is the one number
 * behind the URL's `X-Amz-Expires`.
 */
export const PRESIGNED_PUT_TTL_SECONDS = 300;

export type PresignedPut = {
  url: string;
  /** The headers to send verbatim with the `PUT`: every signed one. */
  headers: Record<string, string>;
};

export async function presignPut(
  key: string,
  contentType: string,
  metadata: Record<string, string> = {},
): Promise<PresignedPut> {
  // The SDK names the headers itself (`x-amz-meta-{key}`), so the map is
  // keyed by the bare name and built once, here, for both the command and
  // the signed set — the two cannot drift.
  const metaHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(metadata)) {
    metaHeaders[`x-amz-meta-${name}`] = value;
  }
  const signed = ["content-type", ...Object.keys(metaHeaders)];

  const url = await getSignedUrl(
    s3,
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ContentType: contentType,
      ...(Object.keys(metadata).length > 0 ? { Metadata: metadata } : {}),
    }),
    {
      expiresIn: PRESIGNED_PUT_TTL_SECONDS,
      signableHeaders: new Set(signed),
      unhoistableHeaders: new Set(Object.keys(metaHeaders)),
    },
  );
  return { url, headers: { "content-type": contentType, ...metaHeaders } };
}

/** Every object under a prefix, fully paginated. */
export async function listObjects(prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  for (;;) {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) if (obj.Key) keys.push(obj.Key);
    if (!res.IsTruncated) break;
    token = res.NextContinuationToken;
  }
  return keys;
}

/**
 * S3 reports a missing object with different error names depending on
 * the operation: Get says `NoSuchKey`, Head says `NotFound` — and both
 * carry a 404 in the http metadata.
 */
export const isObjectMissing = (err: unknown): boolean => {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e.name === "NoSuchKey" ||
    e.name === "NotFound" ||
    e.$metadata?.httpStatusCode === 404
  );
};
