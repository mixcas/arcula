// The collection's Deleted view, over HTTP against the real stack: the
// member-only read of a collection's deleted works in deletion order, and the
// single restore that takes one back out of it.
//
// The fixtures stamp `deletedAt` directly because bulk delete writes one `now`
// for every row — the deletion order this suite pins is the order the list
// route has to produce, not an artefact of a shared timestamp.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as artworkPhotoVariantsTable,
  artworkPhotos as artworkPhotosTable,
  artworks as artworksTable,
  collectionCollaborators as collaboratorsTable,
} from "@arcula/db";
import { artworkReadSchema } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, uuid } from "./helpers/api";

let owner: { cookies: string; userId: string };
let stranger: { cookies: string; userId: string };
let mate: { cookies: string; userId: string };

let collectionId = "";
let newestId = "";
let middleId = "";
let oldestDraftId = "";
let liveId = "";
let photoId = "";
let documentId = "";

async function createWork(values: {
  title: string;
  artistName: string;
  status?: "draft" | "published";
  serie?: string;
}): Promise<string> {
  const res = await req(
    "POST",
    `/api/v1/collections/${collectionId}/artworks`,
    {
      cookies: owner.cookies,
      body: JSON.stringify({ artworkId: uuid(), ...values }),
    },
  );
  expect(res.status).toBe(201);
  return String((await json<Record<string, unknown>>(res)).id);
}

async function stampDeleted(artworkId: string, iso: string): Promise<void> {
  const at = new Date(iso);
  await db
    .update(artworksTable)
    .set({ deletedAt: at, updatedAt: at })
    .where(eq(artworksTable.id, artworkId));
}

beforeAll(async () => {
  owner = await freshUser("Deleted");
  stranger = await freshUser("Deleted");
  mate = await freshUser("Deleted");

  const created = await req("POST", "/api/v1/collections", {
    cookies: owner.cookies,
    body: JSON.stringify({ name: "The Deleted View" }),
  });
  expect(created.status).toBe(201);
  collectionId = String((await json<Record<string, unknown>>(created)).id);

  newestId = await createWork({
    title: "Newest Out",
    artistName: "N. Out",
    status: "published",
    serie: "Red Series",
  });
  middleId = await createWork({
    title: "Middle Out",
    artistName: "M. Out",
    status: "published",
  });
  oldestDraftId = await createWork({
    title: "Oldest Draft",
    artistName: "O. Draft",
    status: "draft",
  });
  liveId = await createWork({
    title: "Still Live",
    artistName: "L. Live",
    status: "published",
  });

  // A photo and a document on the newest deleted work: restore has to bring
  // them back untouched, and the deleted list has to serialize them.
  photoId = uuid();
  documentId = uuid();
  await db.insert(artworkPhotosTable).values({
    id: photoId,
    artworkId: newestId,
    order: 0,
    name: "red.jpg",
  });
  await db.insert(artworkPhotoVariantsTable).values({
    parentKind: "photo",
    parentId: photoId,
    key: "original",
    width: 1200,
    height: 900,
    size: 123456,
    contentType: "image/jpeg",
  });
  await db.insert(artworkDocumentsTable).values({
    id: documentId,
    artworkId: newestId,
    kind: "file",
    name: "provenance.pdf",
    size: 4321,
    contentType: "application/pdf",
  });

  await stampDeleted(newestId, "2026-01-03T10:00:00.000Z");
  await stampDeleted(middleId, "2026-01-02T10:00:00.000Z");
  await stampDeleted(oldestDraftId, "2026-01-01T10:00:00.000Z");
});

afterAll(async () => {
  await closeDb();
});

describe("GET /collections/{cid}/deleted-artworks", () => {
  it("lists only deleted works, most recently deleted first, serialized like the live list", async () => {
    const res = await req(
      "GET",
      `/api/v1/collections/${collectionId}/deleted-artworks`,
      { cookies: owner.cookies },
    );
    expect(res.status).toBe(200);

    const rows = (await json<unknown[]>(res)).map((row) =>
      artworkReadSchema.parse(row),
    );
    expect(rows.map((row) => row.id)).toEqual([
      newestId,
      middleId,
      oldestDraftId,
    ]);
    expect(rows.map((row) => row.id)).not.toContain(liveId);

    // A deleted draft comes back as a draft, not as a published work.
    expect(rows.find((row) => row.id === oldestDraftId)?.status).toBe("draft");
    // Every row carries its deletion stamp, and the newest one its children.
    expect(rows.map((row) => row.deletedAt !== null)).toEqual([
      true,
      true,
      true,
    ]);
    const newest = rows.find((row) => row.id === newestId);
    expect(newest?.photos.map((photo) => photo.id)).toEqual([photoId]);
    expect(newest?.documents.map((document) => document.id)).toEqual([
      documentId,
    ]);
  });

  it("refuses a non-member on a public collection, an anonymous caller, and 404s a missing collection", async () => {
    // Deliberately a public collection: a private one would refuse through
    // the collection gate too, hiding a missing membership check.
    const foreign = await req(
      "GET",
      `/api/v1/collections/${collectionId}/deleted-artworks`,
      { cookies: stranger.cookies },
    );
    expect(foreign.status).toBe(403);
    expect((await err(foreign)).code).toBe("forbidden");

    const anonymous = await req(
      "GET",
      `/api/v1/collections/${collectionId}/deleted-artworks`,
    );
    expect(anonymous.status).toBe(401);
    expect((await err(anonymous)).code).toBe("unauthorized");

    const missing = await req(
      "GET",
      `/api/v1/collections/${crypto.randomUUID()}/deleted-artworks`,
      { cookies: owner.cookies },
    );
    expect(missing.status).toBe(404);
    expect((await err(missing)).code).toBe("not-found");
  });

  it("shows a collaborator the same deleted works", async () => {
    await db
      .insert(collaboratorsTable)
      .values({ collectionId, userId: mate.userId });

    const res = await req(
      "GET",
      `/api/v1/collections/${collectionId}/deleted-artworks`,
      { cookies: mate.cookies },
    );
    expect(res.status).toBe(200);
    const rows = await json<{ id: string }[]>(res);
    expect(rows.map((row) => row.id)).toEqual([
      newestId,
      middleId,
      oldestDraftId,
    ]);
  });
});

describe("POST /collections/{cid}/artworks/{aid}/restore", () => {
  it("brings back a published work with its status, fields, photos and documents, publicly visible again", async () => {
    const restored = await req(
      "POST",
      `/api/v1/collections/${collectionId}/artworks/${newestId}/restore`,
      { cookies: owner.cookies },
    );
    expect(restored.status).toBe(200);
    expect(await json(restored)).toEqual({ restored: true });

    const read = await req(
      "GET",
      `/api/v1/collections/${collectionId}/artworks/${newestId}`,
      { cookies: owner.cookies },
    );
    expect(read.status).toBe(200);
    const artwork = artworkReadSchema.parse(await json(read));
    expect(artwork.deletedAt).toBeNull();
    expect(artwork.status).toBe("published");
    expect(artwork.serie).toBe("Red Series");
    expect(artwork.photos.map((photo) => photo.id)).toEqual([photoId]);
    expect(artwork.documents.map((document) => document.id)).toEqual([
      documentId,
    ]);

    // Restore is the inverse of delete: a published work is public again.
    const publicList = await req(
      "GET",
      `/api/v1/collections/${collectionId}/artworks`,
    );
    expect(publicList.status).toBe(200);
    const publicIds = (await json<{ id: string }[]>(publicList)).map(
      (row) => row.id,
    );
    expect(publicIds).toContain(newestId);
    expect(publicIds).toContain(liveId);

    const deleted = await json<{ id: string }[]>(
      await req("GET", `/api/v1/collections/${collectionId}/deleted-artworks`, {
        cookies: owner.cookies,
      }),
    );
    expect(deleted.map((row) => row.id)).not.toContain(newestId);
  });

  it("keeps a restored draft a draft, still absent from the public list", async () => {
    const restored = await req(
      "POST",
      `/api/v1/collections/${collectionId}/artworks/${oldestDraftId}/restore`,
      { cookies: owner.cookies },
    );
    expect(restored.status).toBe(200);

    const read = await req(
      "GET",
      `/api/v1/collections/${collectionId}/artworks/${oldestDraftId}`,
      { cookies: owner.cookies },
    );
    expect(read.status).toBe(200);
    const artwork = artworkReadSchema.parse(await json(read));
    expect(artwork.deletedAt).toBeNull();
    expect(artwork.status).toBe("draft");

    const publicList = await req(
      "GET",
      `/api/v1/collections/${collectionId}/artworks`,
    );
    const publicIds = (await json<{ id: string }[]>(publicList)).map(
      (row) => row.id,
    );
    expect(publicIds).not.toContain(oldestDraftId);
  });
});
