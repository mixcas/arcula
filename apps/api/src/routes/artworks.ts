// The artwork resource routes:
//
//   GET    /catalogues/{cid}/artworks            the catalogue's live works
//   POST   /catalogues/{cid}/artworks            create + promote staged entries
//   GET    /catalogues/{cid}/artworks/{aid}      one work
//   PATCH  /catalogues/{cid}/artworks/{aid}      edit fields + new sequence
//
// A save is one Postgres transaction: field write → per-entry S3 copy
// (staged → final) and row upserts → row deletes for entries dropped
// from the sequence. An S3 copy cannot roll back with the rows, so a
// failed save may leave final objects with no row — the accepted orphan
// residual. Staged objects are deleted only AFTER commit; what a failed
// save leaves behind is exactly what the sweep and the staging lifecycle
// exist to remove.
//
// Reader access: a member of the catalogue always; a visitor on the live
// PUBLISHED works in the list, and a single work of a PUBLIC catalogue
// when the work itself is published and live — the catalogue is the whole
// gate (docs/adr/0003). The single read, the list read and the read-back
// after a save all go through artworkRead.ts, which now owns the list's SQL
// filter too; a test pins that filter and the verdict together.
//
// Writer access: any member, the owner or a collaborator, for every route
// here (ADR-0004). A save by a collaborator promotes THEIR staged entries
// onto the catalogue's final keys, but records `artworks.userId` as the
// catalogue's owner — the mirror, never the session user.

import { asc, eq } from "drizzle-orm";
import {
  artworks as artworksTable,
  artworkDocuments as artworkDocumentsTable,
  artworkPhotos as artworkPhotosTable,
} from "@arcula/db";
import {
  MAX_ARTWORK_DOCUMENTS,
  MAX_ARTWORK_PHOTOS,
  artworkCreateSchema,
  artworkUpdateSchema,
  isBlankSearchQuery,
  parseArtworkSearchQuery,
  resolveArtworkFields,
  type ArtworkCreatePayload,
  type ArtworkUpdatePayload,
  type StagedEntry,
} from "@arcula/shared";
import { Hono } from "hono";
import { assertArtworkFieldsEnabled } from "../artworkFieldRefusal";
import { readArtwork, readArtworkList } from "../artworkRead";
import {
  artworkCreateValues,
  artworkUpdateSet,
  assertArtworkIdFree,
  readSavedArtwork,
} from "../artworkWrite";
import {
  grantHeld,
  requireMemberArtwork,
  requireMemberCatalogue,
} from "../authorize";
import { db } from "../db";
import { ApiError } from "../errors";
import { param, parseBody, safeTx } from "../http";
import { deleteObject } from "../storage";
import { resolveSession, requireSession } from "../session";
import {
  assertEntriesFree,
  checkUniqueEntryIds,
  deleteFinalEntryObjects,
  tooMany,
  writeDocumentSequence,
  writePhotoSequence,
} from "./artworkSave";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const artworkRoutes = new Hono();

// GET one — a member always; a visitor when catalogue and work both admit it.
artworkRoutes.get("/catalogues/:catalogueId/artworks/:artworkId", async (c) => {
  const session = await resolveSession(c);
  const catalogueId = param(c, "catalogueId");
  // The grant is a fact the route reads off the cookie and the verdict
  // takes as one; a member's read never needs it (`grantHeld` still costs
  // nothing without the cookie, and the verdict ignores it for a member).
  const hasValidGrant = await grantHeld(c, catalogueId);
  const read = await readArtwork(
    catalogueId,
    param(c, "artworkId"),
    session?.user.id ?? null,
    hasValidGrant,
  );
  // A draft work, a deleted work and a public work inside a private
  // catalogue are one uniform 404 for a visitor: saying which was
  // refused would be a disclosure.
  if (read.status !== "ok") {
    throw new ApiError("not-found", "The artwork does not exist");
  }
  return c.json(read.artwork);
});

// GET list — member: every live work; non-member: the published ones; a
// private catalogue, or a protected one the visitor holds no grant for: 403
// (never 404 — the client maps the refusal to "private"). An optional `q` is
// the member-only Catalogue search; the structured query (filters, sort,
// limit/offset, facets) is answered within the same verdict for any caller.
// Its questions are answered in order: a missing catalogue is 404, no session
// is 401, a signed-in non-member — grant holder included — is 403, and only
// then is an unanswerable query a 400 validation error attributed to the
// parameter that carries the problem. Absent, empty or whitespace-only `q`
// leaves the search exactly as it was.
//
// The answer is a page envelope — `{ artworks, total, limit, offset }`, plus
// `facets` when asked for — so a caller can page and can tell a page from a
// whole result. The web reads `artworks`, which is what keeps its render
// unchanged.
artworkRoutes.get("/catalogues/:catalogueId/artworks", async (c) => {
  const session = await resolveSession(c);
  const catalogueId = param(c, "catalogueId");
  const rawQuery = c.req.query("q");
  const search =
    rawQuery !== undefined && !isBlankSearchQuery(rawQuery) ? rawQuery : null;
  // The parse is pure and touches nothing; the read still answers the access
  // questions before it consults the result, so a stranger's malformed query
  // is a refusal, not a validation error.
  const structured = parseArtworkSearchQuery(c.req.queries());
  const hasValidGrant = await grantHeld(c, catalogueId);
  const read = await readArtworkList(
    catalogueId,
    session?.user.id ?? null,
    hasValidGrant,
    search,
    structured,
  );
  if (read.status === "not-found") {
    throw new ApiError("not-found", "The catalogue does not exist");
  }
  if (read.status === "unauthorized") {
    throw new ApiError("unauthorized", "Log in to search this catalogue");
  }
  if (read.status === "forbidden") {
    throw new ApiError("forbidden", "You do not have access to this catalogue");
  }
  // The access questions came first; the query's own validity answers only
  // for a caller who may read at all.
  if (read.status === "invalid-search") {
    throw new ApiError("validation", read.problem.message, {
      fields: { [read.problem.field]: read.problem.message },
    });
  }
  return c.json({
    artworks: read.artworks,
    total: read.total,
    limit: read.limit,
    offset: read.offset,
    ...(read.facets === undefined ? {} : { facets: read.facets }),
  });
});

// POST — create the row and promote the staged entries, one transaction.
artworkRoutes.post(
  "/catalogues/:catalogueId/artworks",
  requireSession,
  async (c) => {
    const user = c.get("user");
    const catalogue = await requireMemberCatalogue(c, param(c, "catalogueId"));
    const payload: ArtworkCreatePayload = await parseBody(
      c,
      artworkCreateSchema,
    );
    assertArtworkFieldsEnabled(catalogue, payload);
    // What the Catalogue records, resolved once here for the new work's
    // starting market state. The refusal above answers the same set.
    const { enabled } = resolveArtworkFields(
      catalogue.kind,
      catalogue.artworkFields,
    );

    // An id is a global primary key: reusing one would promote this
    // save's staged entries under the existing row's id.
    await assertArtworkIdFree(payload.artworkId);
    checkUniqueEntryIds(payload.photos, "photos");
    checkUniqueEntryIds(payload.documents, "documents");
    if (payload.photos.length > MAX_ARTWORK_PHOTOS) {
      throw tooMany("photos", MAX_ARTWORK_PHOTOS);
    }
    if (payload.documents.length > MAX_ARTWORK_DOCUMENTS) {
      throw tooMany("documents", MAX_ARTWORK_DOCUMENTS);
    }
    await assertEntriesFree(
      "photo",
      payload.photos.map((e) => e.entryId),
    );
    await assertEntriesFree(
      "document",
      payload.documents.map((e) => e.entryId),
    );

    const now = new Date();
    const stagedKeys = await safeTx(async (tx) => {
      await tx
        .insert(artworksTable)
        .values(
          artworkCreateValues(
            catalogue,
            payload.artworkId,
            payload,
            now,
            enabled,
          ),
        );
      const photos = await writePhotoSequence(
        tx,
        catalogue,
        user.id,
        payload.artworkId,
        payload.photos,
        [],
      );
      const documents = await writeDocumentSequence(
        tx,
        catalogue,
        user.id,
        payload.artworkId,
        payload.documents,
        new Set(),
      );
      return [...photos.stagedKeys, ...documents.stagedKeys];
    });
    for (const key of stagedKeys) {
      await deleteObject(key);
    }

    const artworkRead = await readSavedArtwork(
      catalogue.id,
      payload.artworkId,
      user.id,
    );
    return c.json(artworkRead, 201);
  },
);

// PATCH — the edit form: fields plus the full new sequences.
artworkRoutes.patch(
  "/catalogues/:catalogueId/artworks/:artworkId",
  requireSession,
  async (c) => {
    const catalogueId = param(c, "catalogueId");
    const artworkId = param(c, "artworkId");
    const user = c.get("user");
    const { catalogue, artwork } = await requireMemberArtwork(
      c,
      catalogueId,
      artworkId,
    );
    const payload: ArtworkUpdatePayload = await parseBody(
      c,
      artworkUpdateSchema,
    );
    assertArtworkFieldsEnabled(catalogue, payload);

    // Absent = leave the sequence alone; present = the full new one.
    const currentPhotos = await db
      .select()
      .from(artworkPhotosTable)
      .where(eq(artworkPhotosTable.artworkId, artwork.id))
      .orderBy(asc(artworkPhotosTable.order));
    // Documents carry no position column: id order is their canonical
    // sequence, and the serializer applies it. This read sorts for
    // determinism, but nothing downstream depends on its order —
    // `currentDocs` feeds only `storedDocIds`, the cap check and the
    // uniqueness check.
    const currentDocs = await db
      .select()
      .from(artworkDocumentsTable)
      .where(eq(artworkDocumentsTable.artworkId, artwork.id))
      .orderBy(asc(artworkDocumentsTable.id));
    const storedPhotoIds = new Set(currentPhotos.map((r) => r.id));
    const storedDocIds = new Set(currentDocs.map((r) => r.id));
    const nextPhotos: StagedEntry[] =
      payload.photos ??
      currentPhotos.map((r) => ({ entryId: r.id, name: r.name }));
    const nextDocs: StagedEntry[] =
      payload.documents ??
      currentDocs.map((r) => ({ entryId: r.id, name: r.name }));

    checkUniqueEntryIds(nextPhotos, "photos");
    checkUniqueEntryIds(nextDocs, "documents");
    if (nextPhotos.length > MAX_ARTWORK_PHOTOS) {
      throw tooMany("photos", MAX_ARTWORK_PHOTOS);
    }
    if (nextDocs.length > MAX_ARTWORK_DOCUMENTS) {
      throw tooMany("documents", MAX_ARTWORK_DOCUMENTS);
    }
    // Only the entries this save promotes: an id already stored for THIS
    // artwork is this artwork's own row, not a collision.
    await assertEntriesFree(
      "photo",
      nextPhotos
        .filter((e) => !storedPhotoIds.has(e.entryId))
        .map((e) => e.entryId),
    );
    await assertEntriesFree(
      "document",
      nextDocs
        .filter((e) => !storedDocIds.has(e.entryId))
        .map((e) => e.entryId),
    );

    const now = new Date();
    const result = await safeTx(async (tx) => {
      await tx
        .update(artworksTable)
        .set(artworkUpdateSet(payload, now))
        .where(eq(artworksTable.id, artwork.id));

      const photos =
        payload.photos !== undefined
          ? await writePhotoSequence(
              tx,
              catalogue,
              user.id,
              artwork.id,
              nextPhotos,
              currentPhotos,
            )
          : { stagedKeys: [], removedIds: [] };
      const documents =
        payload.documents !== undefined
          ? await writeDocumentSequence(
              tx,
              catalogue,
              user.id,
              artwork.id,
              nextDocs,
              storedDocIds,
            )
          : { stagedKeys: [], removedIds: [] };
      return {
        stagedKeys: [...photos.stagedKeys, ...documents.stagedKeys],
        removedPhotos: photos.removedIds,
        removedDocuments: documents.removedIds,
      };
    });

    for (const key of result.stagedKeys) {
      await deleteObject(key);
    }
    await deleteFinalEntryObjects(
      catalogue,
      artwork.id,
      "photo",
      result.removedPhotos,
    );
    await deleteFinalEntryObjects(
      catalogue,
      artwork.id,
      "document",
      result.removedDocuments,
    );

    const artworkRead = await readSavedArtwork(
      catalogue.id,
      artwork.id,
      user.id,
    );
    return c.json(artworkRead);
  },
);
