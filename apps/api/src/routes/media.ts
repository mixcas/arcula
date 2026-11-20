// The media proxy: GET /api/v1/media?key={objectKey}.
//
// The key parses back into its segments (the name is self-describing by
// construction) and authz is checked per request, then the object
// streams. The final key's second segment is the catalogue's media
// namespace, not an authorization fact: access is answered by the
// catalogue, the work and the file's population:
//
//   final photo    — the catalogue's owner or a collaborator, or a visitor
//                    when access.ts's verdict admits the work (published,
//                    live, in a public catalogue, and — if that catalogue is
//                    Protected — with a valid Access grant, which is why the
//                    proxy reads the grant cookie too). A draft, a deleted
//                    work, a work inside a private catalogue and a work
//                    behind a password the reader has not entered 404 for a
//                    non-member, uniformly: saying which was refused would be
//                    a disclosure (the same call as the single-artwork read).
//
//                    A photo URL may also carry `&selection={id}`, the scope a
//                    Selection's works read puts on it. When the Catalogue
//                    verdict refuses — the Draft case, the feature — the
//                    Selection's own verdict is asked: live Selection and
//                    source Catalogue, the same Catalogue as the key, a live
//                    work with a curation row, and the reader admitted by
//                    `canSeeSelection` with the Selection's grant cookie. The
//                    scope is photos only, and every refused scope is the same
//                    404 the photo branch always answers.
//   final document — the owner and collaborators ONLY. Documents are never
//                    public; the proxy 403s everyone else so a future UI that
//                    forgot to hide them renders a 403 rather than a leak.
//                    The `selection` scope is deliberately not read here: a
//                    Selection never makes a certificate public. A deleted
//                    catalogue's document is 404: nothing holds it any more.
//   staged object  — the uploader's in-progress work: a session, the key's
//                    own uploader segment, and membership of the catalogue
//                    the entry was staged under. No row exists yet, so there
//                    is no artwork-level visibility to consult, and one
//                    collaborator never reads another's unsaved upload.
//
// 404 for a key that does not parse, names no row, or names no object.
// Headers come from the stored row (final objects) or the object's own
// recorded metadata (staged objects, which have no row yet).

import { and, eq } from "drizzle-orm";
import type { Context } from "hono";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  selectionWorks as selectionWorksTable,
} from "@arcula/db";
import { Hono } from "hono";
import {
  canReadArtworkDocuments,
  canSeeArtwork,
  type Membership,
} from "../access";
import {
  grantHeld,
  loadArtworkInCatalogue,
  loadCatalogue,
  loadMembership,
  loadSelectionWithCatalogue,
  selectionGrantHeld,
  type ArtworkRow,
} from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { parseMediaKey, type ParsedFinalKey } from "../media/keys";
import { kindOf } from "../media/populations";
import { canSeeSelection } from "../selectionAccess";
import { isObjectMissing, streamObject } from "../storage";
import { resolveSession } from "../session";

export const mediaRoutes = new Hono();

// Final objects are re-encodable under the same key only when the owner
// re-saves the same entry, which the client does not do (a re-upload mints
// a new entry id): one hour of edge caching is the stale window, at most.
// Staged objects are per-session previews: no cache at all.
//
// `public` is only honest where the same URL answers the same bytes to any
// reader. Two populations do not: a Protected catalogue's photo was admitted
// by the reader's Access grant, and a document is a member's at every status.
// Those go to the reader's own cache for the same hour, so a shared cache can
// never hand the bytes to someone the verdict would refuse.
const FINAL_CACHE = "public, max-age=3600";
const PRIVATE_CACHE = "private, max-age=3600";
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
  const viewer = session?.user.id ?? null;

  if (parsed.kind === "staging") {
    // No row yet: access is the uploader's own prefix plus membership of the
    // catalogue it was staged under.
    if (session === null) {
      throw new ApiError("unauthorized", "A session is required");
    }
    const catalogue = await loadCatalogue(parsed.catalogueId);
    if (!catalogue) {
      throw new ApiError("not-found", "The catalogue does not exist");
    }
    const membership = await loadMembership(
      parsed.catalogueId,
      catalogue,
      viewer,
    );
    if (parsed.uploaderId !== viewer || membership === null) {
      throw new ApiError(
        "forbidden",
        "You do not have access to this catalogue",
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
  const artwork = await loadArtworkInCatalogue(
    parsed.catalogueId,
    parsed.artworkId,
  );
  if (!artwork) {
    throw new ApiError(
      "not-found",
      "The object key does not name a stored object",
    );
  }

  const catalogue = await loadCatalogue(parsed.catalogueId);
  if (!catalogue) {
    throw new ApiError(
      "not-found",
      "The object key does not name a stored object",
    );
  }
  const membership = await loadMembership(
    parsed.catalogueId,
    catalogue,
    viewer,
  );

  // Which cache may keep these bytes: a document is a member's at every
  // status, a Protected catalogue's photo was admitted by the reader's grant,
  // and a Selection-scoped photo is bounded by the Selection's state — so none
  // of them is the same answer to every reader.
  let cacheControl = FINAL_CACHE;

  if (parsed.population === "documents") {
    // Never public, members only — and the refusal is a 403, not a 404:
    // the key names a row, and the point of the split is that a
    // forgotten-to-hide UI fails closed. A deleted catalogue is the one
    // exception: there is no catalogue to hold a document, so the key names
    // nothing that exists (the same not-found the photo branch answers).
    // The `selection` query is deliberately not read on this branch: the
    // scope is photos only, so a Selection can never make a certificate
    // public.
    cacheControl = PRIVATE_CACHE;
    if (!canReadArtworkDocuments(membership)) {
      throw new ApiError(
        "forbidden",
        "Documents are private to the catalogue's owner and collaborators",
      );
    }
  } else {
    // The same verdict as the row, which is the whole point of the proxy: a
    // Protected catalogue's bytes are behind the same challenge as its page,
    // so the grant the reader holds (if any) is a fact this asks for too.
    const hasValidGrant = await grantHeld(c, parsed.catalogueId);
    const selectionId = c.req.query("selection");
    if (!canSeeArtwork(membership, catalogue, artwork, hasValidGrant)) {
      // The Catalogue verdict refuses. A Selection URL is the second gate: a
      // Draft in a readable Selection renders, and nothing else moves.
      const admitted =
        selectionId !== undefined &&
        (await admitsSelectionScope(c, {
          selectionId,
          catalogueId: parsed.catalogueId,
          artwork,
          membership,
        }));
      if (!admitted) {
        throw new ApiError(
          "not-found",
          "The object key does not name a stored object",
        );
      }
    }
    // A scoped URL is never shared: its right to the bytes is the Selection's,
    // and the curator can end it by unpublishing or removing the work. This
    // holds even when the Catalogue verdict alone would have admitted the
    // photo — the query string is part of the cache key, and a `public` answer
    // would outlive the Selection. A bad scope on an otherwise-admitted photo
    // is harmless: the Catalogue verdict was the gate, and the answer is
    // private only.
    if (
      selectionId !== undefined ||
      (catalogue.isPublic && catalogue.passwordHash !== null)
    ) {
      cacheControl = PRIVATE_CACHE;
    }
  }

  const meta = await rowMetadata(parsed, artwork.id);
  const res = await getOr404(rawKey);
  return c.newResponse(bodyOf(res), 200, {
    "Content-Type": meta.contentType,
    "Content-Length": String(meta.size),
    "Cache-Control": cacheControl,
  });
});

interface SelectionScopeRequest {
  /** The `selection` query value: a whole id, as the serializer wrote it. */
  selectionId: string;
  /** The key's Catalogue, which the Selection must be cut from. */
  catalogueId: string;
  artwork: ArtworkRow;
  /** The viewer's membership in that Catalogue — the Selection verdict's fact. */
  membership: Membership;
}

/**
 * The second gate, asked only after the Catalogue verdict refused: does this
 * Selection admit this photo to this reader?
 *
 * Every fact is load-bearing. The Selection and its source Catalogue must both
 * be live (the loader joins them), the Selection must be cut from the key's
 * own Catalogue (a readable Selection elsewhere says nothing about these
 * bytes), the work must be live — `loadArtworkInCatalogue` deliberately does
 * not filter the tombstone, and a deleted work keeps its curation row — and a
 * curation row must actually exist. Only then is the pure verdict asked, with
 * the **Selection's** grant cookie: the Catalogue's grant is a different
 * scope and must never stand in for it.
 *
 * The source Catalogue's visibility is not consulted: `canSeeSelection` is
 * deliberately indifferent to it (ADR-0015).
 */
async function admitsSelectionScope(
  c: Context,
  request: SelectionScopeRequest,
): Promise<boolean> {
  const { selectionId, catalogueId, artwork, membership } = request;
  const pair = await loadSelectionWithCatalogue(selectionId);
  if (!pair) return false;
  if (pair.catalogue.id !== catalogueId) return false;
  if (artwork.deletedAt !== null) return false;

  const curated = (
    await db
      .select({ selectionId: selectionWorksTable.selectionId })
      .from(selectionWorksTable)
      .where(
        and(
          eq(selectionWorksTable.selectionId, selectionId),
          eq(selectionWorksTable.artworkId, artwork.id),
        ),
      )
  )[0];
  if (!curated) return false;

  const hasSelectionGrant = await selectionGrantHeld(c, selectionId);
  return canSeeSelection(
    membership,
    pair.catalogue,
    pair.selection,
    hasSelectionGrant,
  );
}

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
