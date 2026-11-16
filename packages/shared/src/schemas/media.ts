import { z } from "zod";
import type { ImageVariant } from "../types";
import { MINTED_ID_RE } from "./artwork";
import { wireImageVariant } from "./document";

/**
 * The staged-media wire shapes, for the direct-to-storage upload.
 *
 * A file used to travel inside the request body, so the API held the bytes
 * before it answered. It now goes straight from the browser to the media
 * bucket: `presign` declares what is about to be uploaded and receives a
 * short-lived URL, the browser PUTs the file to that URL, and `process` is the
 * first point the server sees the bytes — which is why the process answer, not
 * the presign answer, carries the original's measured metadata.
 *
 * These schemas are the declaration and the two answers, shared so both sides
 * compile against one description of them. They are SHAPE only: whether a
 * declared type and size are allowed is `checkDeclaredUpload` in `caps.ts`,
 * and repeating either table here would be the duplication this contract
 * exists to remove.
 */

/**
 * The presign call's body. `entryId` is client-minted and becomes a segment of
 * the staged object's key, so it carries the same character set the save
 * payloads do — `MINTED_ID_RE` owns that set.
 *
 * `name` is the original's filename: metadata the form shows and the row
 * records, never part of a key (the extension is minted from the admitted
 * content type instead), so it is optional and a nameless upload is
 * "untitled".
 */
export const mediaPresignRequestSchema = z.object({
  entryId: z.string().regex(MINTED_ID_RE, "Invalid entry id"),
  contentType: z.string().min(1),
  /**
   * The declared length in bytes. Checked against the population's cap by the
   * guard; the stored object's own length is what process trusts. Not signed
   * into the URL: `content-length` is a forbidden header for `fetch`, so a
   * browser cannot honour a signed value.
   */
  size: z.number(),
  name: z.string().optional(),
});

export type MediaPresignRequest = z.infer<typeof mediaPresignRequestSchema>;

/**
 * The presign answer: one upload target, and what the form needs before the
 * PUT so it can show the entry while it is still in flight.
 *
 * `uploadUrl` is the presigned storage URL and `headers` are the ones the
 * signature covers — the client must send them exactly, `Content-Type`
 * included, or storage refuses the PUT and stores the wrong type. `url` is the
 * app's own proxy path for the object, the same `url` every other wire shape
 * uses, so once the bytes land the preview and the save both address the
 * object the ordinary way.
 *
 * The URL is a bearer token scoped to one method and one key: it is never
 * logged, and it expires — `expiresAt` is the ISO-8601 instant, so the client
 * can tell a stale link from a live one instead of discovering it at the PUT.
 */
export const mediaPresignResponseSchema = z.object({
  entryId: z.string(),
  /** The presigned storage URL. Treat as a secret. */
  uploadUrl: z.string(),
  /** The one method the signature covers. */
  method: z.literal("PUT"),
  /** Headers the client must send verbatim with the PUT. */
  headers: z.record(z.string(), z.string()),
  /** The staged object's proxy path, for previews and the save. */
  url: z.string(),
  /** ISO-8601 UTC instant at which `uploadUrl` stops working. */
  expiresAt: z.string(),
});

export type MediaPresignResponse = z.infer<typeof mediaPresignResponseSchema>;

/**
 * The process answer: the generated variants, and the original as the server
 * measured it.
 *
 * The presign step held no bytes, so this is where `width`, `height` and
 * `size` become facts — from the stored object, not the declaration — and the
 * form reads them from here to record the row. A non-image document (a PDF)
 * answers null dimensions and `variants: []`: the original is the whole entry.
 */
export const mediaProcessResponseSchema = z.object({
  entryId: z.string(),
  /** The original's filename, as staged. */
  name: z.string(),
  /** Measured pixels; null for a document that is not an image. */
  width: z.number().nullable(),
  height: z.number().nullable(),
  /** The stored object's length in bytes — the authoritative size. */
  size: z.number(),
  contentType: z.string(),
  /** The staged original's proxy path. */
  url: z.string(),
  variants: z.array(wireImageVariant),
});

export type MediaProcessResponse = z.infer<typeof mediaProcessResponseSchema>;

// The process answer's variants are the wire's variant shape, not a second
// description of it: `wireImageVariant` already names the key space, so a new
// variant key is a change in one place.
type ProcessVariantsAreImageVariants =
  MediaProcessResponse["variants"] extends ImageVariant[] ? true : never;
const processVariantsAreImageVariants: ProcessVariantsAreImageVariants = true;
void processVariantsAreImageVariants;
