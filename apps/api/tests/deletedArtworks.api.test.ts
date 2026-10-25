// The collection's Deleted view, over HTTP against the real stack: the
// member-only read of a collection's deleted works in deletion order, the
// batch restore that moves a selection's stamps, and the single restore that
// takes one work back out of the view.
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

async function createWork(
  target: string,
  cookies: string,
  values: {
    title: string;
    artistName?: string;
    status?: "draft" | "published";
    serie?: string;
  },
): Promise<string> {
  const res = await req("POST", `/api/v1/collections/${target}/artworks`, {
    cookies,
    body: JSON.stringify({
      artworkId: uuid(),
      ...values,
      // A work named only by its title uses the title as the artist too.
      artistName: values.artistName ?? values.title,
    }),
  });
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

/**
 * The refusal every member-only route owes, whatever its method: a signed-in
 * non-member is forbidden (deliberately on a public collection, so a missing
 * membership check cannot hide behind the collection gate), an anonymous
 * caller is unauthorized, and a missing collection is not found. Shared so the
 * Deleted list and the batch restore are pinned to the same contract.
 */
async function expectRefusal(input: {
  method: "GET" | "POST";
  target: string;
  path: (collectionId: string) => string;
  memberCookies: string;
  strangerCookies: string;
  body?: string;
}): Promise<void> {
  const { method, target, path, memberCookies, strangerCookies, body } = input;

  const foreign = await req(method, path(target), {
    cookies: strangerCookies,
    body,
  });
  expect(foreign.status).toBe(403);
  expect((await err(foreign)).code).toBe("forbidden");

  const anonymous = await req(method, path(target), { body });
  expect(anonymous.status).toBe(401);
  expect((await err(anonymous)).code).toBe("unauthorized");

  const missing = await req(method, path(crypto.randomUUID()), {
    cookies: memberCookies,
    body,
  });
  expect(missing.status).toBe(404);
  expect((await err(missing)).code).toBe("not-found");
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

  newestId = await createWork(collectionId, owner.cookies, {
    title: "Newest Out",
    artistName: "N. Out",
    status: "published",
    serie: "Red Series",
  });
  middleId = await createWork(collectionId, owner.cookies, {
    title: "Middle Out",
    artistName: "M. Out",
    status: "published",
  });
  oldestDraftId = await createWork(collectionId, owner.cookies, {
    title: "Oldest Draft",
    artistName: "O. Draft",
    status: "draft",
  });
  liveId = await createWork(collectionId, owner.cookies, {
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
    await expectRefusal({
      method: "GET",
      target: collectionId,
      path: (id) => `/api/v1/collections/${id}/deleted-artworks`,
      memberCookies: owner.cookies,
      strangerCookies: stranger.cookies,
    });
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

// Bulk restore over a selection. The count is the works this call moved, so a
// live id, an id from another collection and an id a previous call already
// restored do not count. Its own collection keeps these assertions independent
// of the single-restore tests below, which mutate the shared one.
describe("POST /collections/{cid}/artworks/bulk-restore", () => {
  // The free tier owns one collection per account, so this suite signs up its
  // own owner and its own stranger rather than reusing the pair above.
  let bulkOwner: { cookies: string; userId: string };
  let bulkStranger: { cookies: string; userId: string };
  let bulkCollectionId = "";
  let firstId = "";
  let secondId = "";
  let liveId = "";
  let foreignCollectionId = "";
  let foreignDeletedId = "";

  /** The work's deletion stamp as the member reads it. */
  const stampOf = async (
    target: string,
    artworkId: string,
    cookies: string,
  ): Promise<unknown> => {
    const res = await req(
      "GET",
      `/api/v1/collections/${target}/artworks/${artworkId}`,
      { cookies },
    );
    expect(res.status).toBe(200);
    return artworkReadSchema.parse(await json(res)).deletedAt;
  };

  beforeAll(async () => {
    bulkOwner = await freshUser("BulkRestore");
    bulkStranger = await freshUser("BulkRestore");

    const created = await req("POST", "/api/v1/collections", {
      cookies: bulkOwner.cookies,
      body: JSON.stringify({ name: "The Bulk Restore" }),
    });
    expect(created.status).toBe(201);
    bulkCollectionId = String(
      (await json<Record<string, unknown>>(created)).id,
    );

    firstId = await createWork(bulkCollectionId, bulkOwner.cookies, {
      title: "Restore Me",
    });
    secondId = await createWork(bulkCollectionId, bulkOwner.cookies, {
      title: "Restore Me Too",
    });
    liveId = await createWork(bulkCollectionId, bulkOwner.cookies, {
      title: "Never Deleted",
    });
    await stampDeleted(firstId, "2026-02-01T10:00:00.000Z");
    await stampDeleted(secondId, "2026-02-02T10:00:00.000Z");

    const foreign = await req("POST", "/api/v1/collections", {
      cookies: bulkStranger.cookies,
      body: JSON.stringify({ name: "Someone Else's Restore" }),
    });
    expect(foreign.status).toBe(201);
    foreignCollectionId = String(
      (await json<Record<string, unknown>>(foreign)).id,
    );
    foreignDeletedId = await createWork(
      foreignCollectionId,
      bulkStranger.cookies,
      { title: "Not Yours" },
    );
    await stampDeleted(foreignDeletedId, "2026-02-03T10:00:00.000Z");
  });

  it("restores the deleted works of the collection and counts only them", async () => {
    const res = await req(
      "POST",
      `/api/v1/collections/${bulkCollectionId}/artworks/bulk-restore`,
      {
        cookies: bulkOwner.cookies,
        body: JSON.stringify({
          artworkIds: [firstId, secondId, liveId, foreignDeletedId],
        }),
      },
    );
    expect(res.status).toBe(200);
    // Two were deleted in this collection; the live id did not move and the
    // foreign id is another collection's.
    expect(await json(res)).toEqual({ restored: 2 });

    expect(
      await stampOf(bulkCollectionId, firstId, bulkOwner.cookies),
    ).toBeNull();
    expect(
      await stampOf(bulkCollectionId, secondId, bulkOwner.cookies),
    ).toBeNull();
    // The live work was already live: untouched and uncounted.
    expect(
      await stampOf(bulkCollectionId, liveId, bulkOwner.cookies),
    ).toBeNull();
    // The foreign work is still deleted: another collection's row was not
    // moved by this call.
    expect(
      await stampOf(
        foreignCollectionId,
        foreignDeletedId,
        bulkStranger.cookies,
      ),
    ).not.toBeNull();

    const deleted = await json<{ id: string }[]>(
      await req(
        "GET",
        `/api/v1/collections/${bulkCollectionId}/deleted-artworks`,
        { cookies: bulkOwner.cookies },
      ),
    );
    expect(deleted).toEqual([]);
  });

  it("counts zero when every id is already live or belongs to another collection", async () => {
    const res = await req(
      "POST",
      `/api/v1/collections/${bulkCollectionId}/artworks/bulk-restore`,
      {
        cookies: bulkOwner.cookies,
        body: JSON.stringify({
          artworkIds: [firstId, liveId, foreignDeletedId],
        }),
      },
    );
    expect(res.status).toBe(200);
    // Restoring a restored work is a no-op, not an error, and it is not
    // counted; the foreign row is still deleted.
    expect(await json(res)).toEqual({ restored: 0 });
    expect(
      await stampOf(
        foreignCollectionId,
        foreignDeletedId,
        bulkStranger.cookies,
      ),
    ).not.toBeNull();
  });

  it("refuses a non-member, an anonymous caller and 404s a missing collection", async () => {
    await expectRefusal({
      method: "POST",
      target: bulkCollectionId,
      path: (id) => `/api/v1/collections/${id}/artworks/bulk-restore`,
      memberCookies: bulkOwner.cookies,
      strangerCookies: bulkStranger.cookies,
      body: JSON.stringify({ artworkIds: [secondId] }),
    });
  });

  it("rejects an empty selection", async () => {
    const res = await req(
      "POST",
      `/api/v1/collections/${bulkCollectionId}/artworks/bulk-restore`,
      {
        cookies: bulkOwner.cookies,
        body: JSON.stringify({ artworkIds: [] }),
      },
    );
    expect(res.status).toBe(400);
    const e = await err(res);
    expect(e.code).toBe("validation");
    expect(e.fields?.artworkIds).toBeTruthy();
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
