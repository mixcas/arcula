// Curating a Selection's works, against the real app and the real stack.
//
//   POST /catalogues/{cid}/selections/{sid}/works     append
//   PUT  /catalogues/{cid}/selections/{sid}/works     replace (reorder, remove)
//   GET  /selections/{sid}/artworks                   the one ordered read
//
// The read is one rule for every audience: live works only, ordered by
// position, **no status filter** — a Draft is the point of the feature. A work
// deleted in its Catalogue leaves the list without a row being removed, and
// returns on restore without a second curation step. The append is idempotent
// and ordered; the replace is the reorder and the remove, and may empty.
//
// Every fixture names its own Catalogue and rows are never cleaned up, as the
// suite's convention goes. Works are inserted straight through drizzle except
// where the route itself is the subject.

import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as variantsTable,
  artworkPhotos as photosTable,
  artworks as artworksTable,
  catalogueCollaborators as collaboratorsTable,
  selectionWorks as selectionWorksTable,
} from "@arcula/db";
import type { ArtworkRead, Selection } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, uuid } from "./helpers/api";
import { makeCatalogue } from "./helpers/fixtures";

type Account = { email: string; cookies: string; userId: string };

let owner: Account;
let mate: Account;
let stranger: Account;
let cid = "";
let otherCid = "";
let sid = "";

// Minted, hyphen-free ids with a deliberate order: the per-run prefix makes
// them unique across runs (the suite never cleans up), and the last character
// makes A < B < C by id — so an implementation that wrote every position as 0
// would fall back to the id tie-break and produce A, B, C whatever it was
// asked for.
const run = uuid();
const workA = `${run}a`;
const workB = `${run}b`;
const workC = `${run}c`;
const workDraft = `${run}d`;
const workGone = `${run}e`;
const foreignWork = `${run}f`;

const selectionsPath = (catalogueId: string) =>
  `/api/v1/catalogues/${catalogueId}/selections`;

const worksPath = (catalogueId: string, selectionId: string) =>
  `${selectionsPath(catalogueId)}/${selectionId}/works`;

const publicWorksPath = (selectionId: string) =>
  `/api/v1/selections/${selectionId}/artworks`;

/** Insert a work in the source Catalogue, straight through drizzle. */
async function insertWork(
  id: string,
  opts: {
    catalogueId?: string;
    title?: string;
    status?: "published" | "draft";
    availability?: "available" | "sold" | null;
    deletedAt?: Date | null;
  } = {},
): Promise<void> {
  await db.insert(artworksTable).values({
    id,
    userId: owner.userId,
    catalogueId: opts.catalogueId ?? cid,
    title: opts.title ?? id,
    artistName: "Test Artist",
    status: opts.status ?? "published",
    availability: opts.availability ?? null,
    deletedAt: opts.deletedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** One photo with its original and medium variants, and one PDF document. */
async function attachMedia(artworkId: string): Promise<void> {
  const photoId = uuid();
  await db.insert(photosTable).values({
    id: photoId,
    artworkId,
    order: 0,
    name: "photo.jpg",
  });
  await db.insert(variantsTable).values([
    {
      parentKind: "photo",
      parentId: photoId,
      key: "original",
      width: 400,
      height: 300,
      size: 12_345,
      contentType: "image/jpeg",
    },
    {
      parentKind: "photo",
      parentId: photoId,
      key: "medium",
      width: 200,
      height: 150,
      size: 4_321,
      contentType: "image/jpeg",
    },
  ]);
  await db.insert(artworkDocumentsTable).values({
    id: uuid(),
    artworkId,
    kind: "file",
    name: "certificate.pdf",
    size: 9_999,
    contentType: "application/pdf",
  });
}

/** What the works rows say: the stored curation order, not the wire's. */
async function storedPositions(
  selectionId: string,
): Promise<{ artworkId: string; position: number }[]> {
  return await db
    .select({
      artworkId: selectionWorksTable.artworkId,
      position: selectionWorksTable.position,
    })
    .from(selectionWorksTable)
    .where(eq(selectionWorksTable.selectionId, selectionId))
    .orderBy(
      asc(selectionWorksTable.position),
      asc(selectionWorksTable.artworkId),
    );
}

async function addWorks(
  ids: string[],
  account: Account = owner,
): Promise<Response> {
  return await req("POST", worksPath(cid, sid), {
    cookies: account.cookies,
    body: { artworkIds: ids },
  });
}

async function replaceWorks(
  ids: string[],
  account: Account = owner,
): Promise<Response> {
  return await req("PUT", worksPath(cid, sid), {
    cookies: account.cookies,
    body: { artworkIds: ids },
  });
}

/** The read's ids, in the order the API answered them. */
async function readIds(path: string, cookies?: string): Promise<string[]> {
  const res = await req("GET", path, cookies === undefined ? {} : { cookies });
  expect(res.status).toBe(200);
  const body = await json<{ artworks: ArtworkRead[] }>(res);
  return body.artworks.map((artwork) => artwork.id);
}

const memberWorks = () => readIds(publicWorksPath(sid), owner.cookies);

beforeAll(async () => {
  owner = await freshUser("WorksOwner");
  mate = await freshUser("WorksMate");
  stranger = await freshUser("WorksStranger");

  // A private Catalogue: the Selection's audience never consults it, which is
  // the whole point of the Selection's own visibility.
  cid = await makeCatalogue(owner.userId, {
    isPublic: false,
    name: "Works Wall",
  });
  otherCid = await makeCatalogue(owner.userId, {
    isPublic: false,
    name: "Other Wall",
  });
  await db
    .insert(collaboratorsTable)
    .values({ catalogueId: cid, userId: mate.userId });

  await insertWork(workA, { title: "Alpha" });
  await insertWork(workB, { title: "Bravo" });
  await insertWork(workC, { title: "Charlie" });
  await insertWork(workDraft, {
    title: "Delta",
    status: "draft",
    availability: "available",
  });
  await attachMedia(workA);
  await insertWork(workGone, { title: "Gone", deletedAt: new Date() });
  await insertWork(foreignWork, { catalogueId: otherCid, title: "Elsewhere" });

  const res = await req("POST", selectionsPath(cid), {
    cookies: owner.cookies,
    body: { name: "Fair Shortlist" },
  });
  expect(res.status).toBe(201);
  sid = (await json<Selection>(res)).id;
});

afterAll(closeDb);

describe("POST …/selections/{sid}/works — append", () => {
  it("appends in the order it was given and numbers the positions from zero", async () => {
    const res = await addWorks([workC, workA]);
    expect(res.status).toBe(200);

    const body = await json<{ artworks: ArtworkRead[] }>(res);
    // C then A, though the id tie-break alone would have said A then C.
    expect(body.artworks.map((artwork) => artwork.id)).toEqual([workC, workA]);
    expect(await storedPositions(sid)).toEqual([
      { artworkId: workC, position: 0 },
      { artworkId: workA, position: 1 },
    ]);
  });

  it("appends a second batch after the first, renumbering the whole list", async () => {
    const res = await addWorks([workB]);
    expect(res.status).toBe(200);
    expect(
      (await json<{ artworks: ArtworkRead[] }>(res)).artworks.map(
        (artwork) => artwork.id,
      ),
    ).toEqual([workC, workA, workB]);
    expect(await storedPositions(sid)).toEqual([
      { artworkId: workC, position: 0 },
      { artworkId: workA, position: 1 },
      { artworkId: workB, position: 2 },
    ]);
  });

  it("is harmless when the same work is appended twice", async () => {
    const res = await addWorks([workC]);
    expect(res.status).toBe(200);
    expect(
      (await json<{ artworks: ArtworkRead[] }>(res)).artworks.map(
        (artwork) => artwork.id,
      ),
    ).toEqual([workC, workA, workB]);
    expect(await storedPositions(sid)).toHaveLength(3);
  });

  it("skips a work already present and appends only the new one", async () => {
    const res = await addWorks([workB, workDraft]);
    expect(res.status).toBe(200);
    expect(
      (await json<{ artworks: ArtworkRead[] }>(res)).artworks.map(
        (artwork) => artwork.id,
      ),
    ).toEqual([workC, workA, workB, workDraft]);
  });

  it("refuses a work that belongs to another Catalogue", async () => {
    const res = await addWorks([foreignWork]);
    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("validation");
    expect(body.details?.artworkIds).toEqual([foreignWork]);
  });

  it("refuses a work deleted in the source Catalogue", async () => {
    const res = await addWorks([workGone]);
    expect(res.status).toBe(400);
    expect((await err(res)).details?.artworkIds).toEqual([workGone]);
  });

  it("refuses an empty append", async () => {
    const res = await addWorks([]);
    expect(res.status).toBe(400);
    expect((await err(res)).code).toBe("validation");
  });

  it("lets a collaborator append, and answers the same ordered envelope", async () => {
    const res = await addWorks([workA], mate);
    // A collaborator curates exactly as the owner (ADR-0004); A is already
    // present, so the answer is the unchanged list.
    expect(res.status).toBe(200);
    expect(
      (await json<{ artworks: ArtworkRead[] }>(res)).artworks.map(
        (artwork) => artwork.id,
      ),
    ).toEqual([workC, workA, workB, workDraft]);
  });
});

describe("PUT …/selections/{sid}/works — replace", () => {
  it("rewrites the list and its positions: the reorder and the remove", async () => {
    const res = await replaceWorks([workB, workC]);
    expect(res.status).toBe(200);
    expect(
      (await json<{ artworks: ArtworkRead[] }>(res)).artworks.map(
        (artwork) => artwork.id,
      ),
    ).toEqual([workB, workC]);
    expect(await storedPositions(sid)).toEqual([
      { artworkId: workB, position: 0 },
      { artworkId: workC, position: 1 },
    ]);
    // The read the manage page would make agrees with the write's answer.
    expect(await memberWorks()).toEqual([workB, workC]);
  });

  it("empties the Selection with an empty list", async () => {
    const res = await replaceWorks([]);
    expect(res.status).toBe(200);
    expect((await json<{ artworks: ArtworkRead[] }>(res)).artworks).toEqual([]);
    expect(await storedPositions(sid)).toEqual([]);
  });

  it("refuses a list naming the same work twice", async () => {
    const res = await replaceWorks([workA, workA]);
    expect(res.status).toBe(400);
    expect((await err(res)).code).toBe("validation");
  });

  it("refuses a work that belongs to another Catalogue", async () => {
    const res = await replaceWorks([workA, foreignWork]);
    expect(res.status).toBe(400);
    expect((await err(res)).details?.artworkIds).toEqual([foreignWork]);
  });
});

describe("a work deleted in its Catalogue", () => {
  it("leaves the read and returns on restore without re-curating", async () => {
    expect((await replaceWorks([workA, workB])).status).toBe(200);

    await db
      .update(artworksTable)
      .set({ deletedAt: new Date() })
      .where(eq(artworksTable.id, workB));
    expect(await memberWorks()).toEqual([workA]);

    // The curation row is kept on purpose: the work leaving is the Catalogue's
    // deletion, not a removal from the Selection.
    expect(await storedPositions(sid)).toEqual([
      { artworkId: workA, position: 0 },
      { artworkId: workB, position: 1 },
    ]);

    await db
      .update(artworksTable)
      .set({ deletedAt: null })
      .where(eq(artworksTable.id, workB));
    expect(await memberWorks()).toEqual([workA, workB]);
  });
});

describe("the audience's two reads", () => {
  it("gives a member the Draft's status, its availability and its documents", async () => {
    expect((await replaceWorks([workA, workDraft])).status).toBe(200);

    const res = await req("GET", publicWorksPath(sid), {
      cookies: owner.cookies,
    });
    const body = await json<{ artworks: ArtworkRead[] }>(res);
    const [alpha, draft] = body.artworks;
    expect(alpha.id).toBe(workA);
    expect(alpha.status).toBe("published");
    expect(alpha.availability).toBeNull();
    expect(alpha.documents).toHaveLength(1);
    expect(draft.id).toBe(workDraft);
    expect(draft.status).toBe("draft");
    expect(draft.availability).toBe("available");
  });

  it("gives a visitor the Drafts, in the curator's order, and no availability or documents", async () => {
    const res = await req("PATCH", `${selectionsPath(cid)}/${sid}`, {
      cookies: owner.cookies,
      body: { isPublic: true },
    });
    expect(res.status).toBe(200);

    // No cookies: the Selection is public, and its Catalogue's privacy is not
    // the visitor's question.
    const resPublic = await req("GET", publicWorksPath(sid));
    expect(resPublic.status).toBe(200);
    const body = await json<{ artworks: ArtworkRead[] }>(resPublic);
    expect(body.artworks.map((artwork) => artwork.id)).toEqual([
      workA,
      workDraft,
    ]);
    const draft = body.artworks[1];
    expect(draft.status).toBe("draft");
    expect(draft).not.toHaveProperty("availability");
    // A visitor never learns a work has documents at all.
    expect(draft.documents).toEqual([]);
    expect(body.artworks[0].documents).toEqual([]);
  });

  it("carries the Selection's scope on every photo URL and on no document URL", async () => {
    const res = await req("GET", publicWorksPath(sid), {
      cookies: owner.cookies,
    });
    const body = await json<{ artworks: ArtworkRead[] }>(res);
    const alpha = body.artworks[0];
    expect(alpha.photos).toHaveLength(1);
    expect(alpha.photos[0].original.url).toContain(`selection=${sid}`);
    expect(alpha.photos[0].variants).not.toHaveLength(0);
    for (const variant of alpha.photos[0].variants) {
      expect(variant.url).toContain(`selection=${sid}`);
    }
    expect(alpha.documents).toHaveLength(1);
    expect(alpha.documents[0].original.url).not.toContain("selection=");
  });

  it("reads the same list for a signed-in non-member", async () => {
    // A public Selection is readable by anyone; a session the caller happens
    // to hold changes nothing about what it admits.
    expect(await readIds(publicWorksPath(sid), stranger.cookies)).toEqual([
      workA,
      workDraft,
    ]);
  });
});

describe("a stranger on the member routes", () => {
  it("gets not-found before the payload is read", async () => {
    const res = await req("POST", worksPath(cid, sid), {
      cookies: stranger.cookies,
      body: { artworkIds: ["not-even-an-id"] },
    });
    expect(res.status).toBe(404);
  });
});
