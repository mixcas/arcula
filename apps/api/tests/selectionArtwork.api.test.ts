// The public single-work read:
// `GET /selections/{sid}/artworks/{aid}`.
//
// It is the Selection's counterpart of the Catalogue's artwork address: a work
// is readable here exactly when it is live and the Selection curates it, and
// **every refusal is the same 404**. A work that is not in the Selection, a
// work deleted in its Catalogue, a Selection that is private, deleted, or
// protected without its grant — a visitor learns only "not here", because
// saying which refused would confirm what is hidden.
//
// The lock screen is not this route's job: the page reads the Selection first,
// and that read is the one that answers `password-required` with its name.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artworkDocuments as artworkDocumentsTable,
  artworkPhotoVariants as variantsTable,
  artworkPhotos as photosTable,
  artworks as artworksTable,
  selectionWorks as selectionWorksTable,
  selections as selectionsTable,
} from "@arcula/db";
import type { ArtworkRead, Selection } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { freshUser, json, req, sessionCookies, uuid } from "./helpers/api";
import { makeCatalogue } from "./helpers/fixtures";

type Account = { email: string; cookies: string; userId: string };

let owner: Account;
let stranger: Account;

const run = uuid();
const inWork = `${run}a`;
const draftWork = `${run}b`;
const notInWork = `${run}c`;
const goneWork = `${run}d`;

const PASSWORD = "open-sesame";

let cid = "";
let otherCid = "";
let sid = "";

const selectionsPath = (catalogueId: string) =>
  `/api/v1/catalogues/${catalogueId}/selections`;

const selectionPath = (catalogueId: string, selectionId: string) =>
  `${selectionsPath(catalogueId)}/${selectionId}`;

const publicWorkPath = (selectionId: string, artworkId: string) =>
  `/api/v1/selections/${selectionId}/artworks/${artworkId}`;

async function insertWork(
  id: string,
  opts: {
    catalogueId?: string;
    title?: string;
    status?: "published" | "draft";
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
    deletedAt: opts.deletedAt ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

/** One photo with its original/medium variants, and one PDF document. */
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

async function newSelection(
  name: string,
  artworkIds: string[],
): Promise<Selection> {
  const created = await req("POST", selectionsPath(cid), {
    cookies: owner.cookies,
    body: { name },
  });
  expect(created.status).toBe(201);
  const selection = await json<Selection>(created);
  const added = await req("POST", `${selectionPath(cid, selection.id)}/works`, {
    cookies: owner.cookies,
    body: { artworkIds },
  });
  expect(added.status).toBe(200);
  return selection;
}

const getWork = (selectionId: string, artworkId: string, cookies?: string) =>
  req(
    "GET",
    publicWorkPath(selectionId, artworkId),
    cookies === undefined ? {} : { cookies },
  );

beforeAll(async () => {
  owner = await freshUser("SingleWorkOwner");
  stranger = await freshUser("SingleWorkOther");

  cid = await makeCatalogue(owner.userId, {
    isPublic: false,
    name: "Single Work Wall",
  });
  otherCid = await makeCatalogue(owner.userId, {
    isPublic: false,
    name: "Other Single Work Wall",
  });

  await insertWork(inWork, { title: "In The Selection" });
  await insertWork(draftWork, { title: "A Draft", status: "draft" });
  await insertWork(notInWork, { title: "Never Curated", status: "draft" });
  await insertWork(goneWork, { title: "Deleted After Curation" });
  await insertWork(`${run}e`, {
    catalogueId: otherCid,
    title: "Another Catalogue",
  });
  await attachMedia(inWork);

  sid = (
    await newSelection("Single Work Shortlist", [inWork, draftWork, goneWork])
  ).id;
  // Published: the visitor's read is the subject of this suite.
  expect(
    (
      await req("PATCH", selectionPath(cid, sid), {
        cookies: owner.cookies,
        body: { isPublic: true },
      })
    ).status,
  ).toBe(200);

  await db
    .update(artworksTable)
    .set({ deletedAt: new Date() })
    .where(eq(artworksTable.id, goneWork));
});

afterAll(closeDb);

describe("GET /selections/{sid}/artworks/{aid} — the work in the Selection", () => {
  it("reads a published work at the visitor's audience, photo scoped to the Selection", async () => {
    const res = await getWork(sid, inWork);
    expect(res.status).toBe(200);
    const artwork = await json<ArtworkRead>(res);
    expect(artwork.id).toBe(inWork);
    expect(artwork.catalogueId).toBe(cid);
    expect(artwork.photos[0].original.url).toContain(`selection=${sid}`);
    // A visitor never learns a work has documents at all.
    expect(artwork.documents).toEqual([]);
    expect(artwork).not.toHaveProperty("availability");
  });

  it("reads a Draft — the point of the Selection", async () => {
    const res = await getWork(sid, draftWork);
    expect(res.status).toBe(200);
    expect((await json<ArtworkRead>(res)).id).toBe(draftWork);
  });

  it("gives a member the documents and the Draft's status", async () => {
    const res = await getWork(sid, inWork, owner.cookies);
    expect(res.status).toBe(200);
    const artwork = await json<ArtworkRead>(res);
    expect(artwork.documents).toHaveLength(1);
    expect(artwork.documents[0].original.url).not.toContain("selection=");
  });
});

describe("GET /selections/{sid}/artworks/{aid} — every refusal is one 404", () => {
  it("answers not-found for a work in the Catalogue but not in the Selection", async () => {
    expect((await getWork(sid, notInWork)).status).toBe(404);
  });

  it("answers not-found for a work from another Catalogue", async () => {
    expect((await getWork(sid, `${run}e`)).status).toBe(404);
  });

  it("answers not-found for a work deleted in its Catalogue", async () => {
    // The curation row was kept on purpose; the work left the read.
    const rows = await db
      .select()
      .from(selectionWorksTable)
      .where(eq(selectionWorksTable.artworkId, goneWork));
    expect(rows.length).toBe(1);
    expect((await getWork(sid, goneWork)).status).toBe(404);
  });

  it("answers not-found for a private Selection", async () => {
    const secret = await newSelection("Private Work Shortlist", [inWork]);
    expect((await getWork(secret.id, inWork)).status).toBe(404);
  });

  it("answers the same not-found to a signed-in non-member", async () => {
    // A session the caller happens to hold changes nothing: a public Selection
    // admits anyone, a private one admits only a member of its Catalogue.
    const secret = await newSelection("Signed In Private Shortlist", [inWork]);
    expect((await getWork(secret.id, inWork, stranger.cookies)).status).toBe(
      404,
    );
  });

  it("answers not-found for a deleted Selection", async () => {
    const doomed = await newSelection("Doomed Work Shortlist", [inWork]);
    await db
      .update(selectionsTable)
      .set({ deletedAt: new Date() })
      .where(eq(selectionsTable.id, doomed.id));
    expect((await getWork(doomed.id, inWork)).status).toBe(404);
  });

  it("answers not-found for a Selection that never existed, and for a missing work id", async () => {
    expect((await getWork("doesnotexist1234567890", inWork)).status).toBe(404);
    expect((await getWork(sid, "doesnotexist1234567890")).status).toBe(404);
  });

  it("folds a protected Selection's challenge into the same not-found", async () => {
    const curated = await newSelection("Protected Work Shortlist", [inWork]);
    const patched = await req("PATCH", selectionPath(cid, curated.id), {
      cookies: owner.cookies,
      body: { isPublic: true, password: PASSWORD },
    });
    expect(patched.status).toBe(200);

    // The page reads the Selection first; that read is what names the lock.
    expect((await getWork(curated.id, inWork)).status).toBe(404);

    const unlocked = await req(
      "POST",
      `/api/v1/selections/${curated.id}/unlock`,
      { body: { password: PASSWORD } },
    );
    expect(unlocked.status).toBe(201);
    expect(
      (await getWork(curated.id, inWork, sessionCookies(unlocked))).status,
    ).toBe(200);
  });
});
