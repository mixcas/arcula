// The media proxy: GET /api/v1/media?key={objectKey}.
//
// The key parses back into its segments (the name is self-describing by
// construction) and authz is checked per request, then the object
// streams:
//
//   final photo    — the owner, or a visitor iff
//                    `artwork.status == 'published' && collection.isPublic &&
//                    deletedAt == null`. A draft or deleted work 404s
//                    for a visitor, uniformly: saying which was refused
//                    would be a disclosure (the same call as the
//                    single-artwork read).
//   final document — the owner ONLY. Documents are never public; the
//                    proxy 403s everyone else so a future UI that forgot
//                    to hide them renders a 403 rather than a leak.
//   staged object  — the owner's in-progress work: a session, and the
//                    ownership of the collection the entry was staged
//                    under. No row exists yet, so there is no
//                    artwork-level visibility to consult.
//
// 404 for a key that does not parse, names no row, or names no object.
// Headers come from the stored row (final objects) or the object's own
// recorded metadata (staged objects, which have no row yet).

import { and, eq } from "drizzle-orm";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
} from "@arcula/db";
import { Hono } from "hono";
import { loadArtworkInCollection, loadCollection } from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { parseMediaKey, type ParsedFinalKey } from "../media/keys";
import { kindOf } from "../media/populations";
import { isObjectMissing, streamObject } from "../storage";
import { resolveSession } from "../session";

export const mediaRoutes = new Hono();

// Final objects are re-encodable under the same key only when the owner
// re-saves the same entry, which the client does not do (a re-upload mints
// a new entry id): one hour of edge caching is the stale window, at most.
// Staged objects are per-session previews: no cache at all.
const FINAL_CACHE = "public, max-age=3600";
const STAGED_CACHE = "no-store";

mediaRoutes.get("/media", async (c) => {
  const rawKey = c.req.query("key");
  if (!rawKey) {
    throw new ApiError("not-found", "No object key was given");
  }
  const parsed = parseMediaKey(rawKey);
  if (!parsed) {
    throw new ApiError(
      "not-found",
      "The object key does not name a known object",
    );
  }

  const session = await resolveSession(c);

  if (parsed.kind === "staging") {
    // No row yet: access is the collection's ownership, plain.
    if (!session) {
      throw new ApiError("unauthorized", "A session is required");
    }
    const collection = await loadCollection(parsed.collectionId);
    if (!collection) {
      throw new ApiError("not-found", "The collection does not exist");
    }
    if (collection.userId !== session.user.id) {
      throw new ApiError(
        "forbidden",
        "You do not have access to this collection",
      );
    }
    const res = await getOr404(rawKey);
    // No row to read from: the object's own recorded metadata is all
    // there is.
    return c.newResponse(bodyOf(res), 200, {
      "Content-Type": res.ContentType ?? "application/octet-stream",
      "Cache-Control": STAGED_CACHE,
    });
  }

  // A final object must name a row: the object without one is the orphan
  // residual, and 404 is its shape — owner or visitor.
  const artwork = await loadArtworkInCollection(
    parsed.collectionId,
    parsed.artworkId,
  );
  if (!artwork) {
    throw new ApiError(
      "not-found",
      "The object key does not name a stored object",
    );
  }

  if (parsed.population === "documents") {
    // Never public, owner only — and the refusal is a 403, not a 404:
    // the key names a row, and the point of the split is that a
    // forgotten-to-hide UI fails closed.
    if (session === null || artwork.userId !== session.user.id) {
      throw new ApiError("forbidden", "Documents are private to their owner");
    }
  } else {
    const isOwner = session !== null && artwork.userId === session.user.id;
    if (!isOwner) {
      const collection = await loadCollection(parsed.collectionId);
      if (
        artwork.deletedAt !== null ||
        artwork.status !== "published" ||
        collection?.isPublic !== true
      ) {
        throw new ApiError(
          "not-found",
          "The object key does not name a stored object",
        );
      }
    }
  }

  const meta = await rowMetadata(parsed, artwork.id);
  const res = await getOr404(rawKey);
  return c.newResponse(bodyOf(res), 200, {
    "Content-Type": meta.contentType,
    "Content-Length": String(meta.size),
    "Cache-Control": FINAL_CACHE,
  });
});

// The body as a web stream: Hono's Response accepts one, and under Bun the
// S3 SDK yields one. A null body on a 200 is a server bug, not a variant.
function bodyOf(res: Awaited<ReturnType<typeof streamObject>>): ReadableStream {
  if (res.Body === undefined) {
    throw new ApiError("internal", "The object stream is unavailable");
  }
  return res.Body as unknown as ReadableStream;
}

/** The size and type the write path recorded for this key. */
async function rowMetadata(
  parsed: ParsedFinalKey,
  artworkId: string,
): Promise<{ contentType: string; size: number }> {
  if (parsed.population === "documents" && parsed.key === "original") {
    // Documents have no original variant row: the base row carries the
    // source's size and type (the serializer reads it the same way).
    const row = (
      await db
        .select()
        .from(artworkDocumentsTable)
        .where(
          and(
            eq(artworkDocumentsTable.artworkId, artworkId),
            eq(artworkDocumentsTable.id, parsed.entryId),
          ),
        )
    )[0];
    if (!row || row.contentType === null || row.size === null) {
      throw new ApiError(
        "internal",
        `Document ${parsed.entryId} has no recorded original metadata`,
      );
    }
    return { contentType: row.contentType, size: row.size };
  }

  const parentKind = kindOf(parsed.population);
  const variant = (
    await db
      .select()
      .from(artworkPhotoVariantsTable)
      .where(
        and(
          eq(artworkPhotoVariantsTable.parentKind, parentKind),
          eq(artworkPhotoVariantsTable.parentId, parsed.entryId),
          eq(artworkPhotoVariantsTable.key, parsed.key),
        ),
      )
  )[0];
  if (!variant || variant.contentType === null || variant.size === null) {
    throw new ApiError(
      "internal",
      `The object key names no recorded variant metadata`,
    );
  }
  return { contentType: variant.contentType, size: variant.size };
}

/** A missing object is the 404 this route promises, not an error. */
async function getOr404(key: string) {
  try {
    return await streamObject(key);
  } catch (err) {
    if (isObjectMissing(err)) {
      throw new ApiError("not-found", "The object does not exist");
    }
    throw err;
  }
}
