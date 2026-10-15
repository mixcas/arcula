// The app's single S3 client.
//
// One module owns every object operation the app performs — put, get,
// head, delete, copy, list. It knows nothing about photos, documents or
// collections: keys are built by `media/keys.ts`, and everything above
// this layer reads them back through that module's parser.
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
import { Readable } from "node:stream";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required in the environment`);
  return value;
}

// S3_FORCE_PATH_STYLE defaults to on: the local SeaweedFS stand-in
// requires it, and prod sets it to "false" explicitly for real S3 — so
// the missing-value failure is a virtual-hosted URL to the wrong place,
// not a quiet misroute.
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

/** The bytes and the recorded content type, in one request. */
export async function readObject(
  key: string,
): Promise<{ bytes: Uint8Array; contentType: string | null }> {
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
  return { bytes, contentType: res.ContentType ?? null };
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
