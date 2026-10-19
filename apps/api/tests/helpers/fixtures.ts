// The media fixtures: rows inserted straight through drizzle, and the two
// staging calls that hang off them.
//
// Collections and artworks go in through drizzle rather than the API — the
// routes that create them have their own suites, and these ones are about what
// happens to the media afterwards.

import sharp from "sharp";
import {
  artworks as artworksTable,
  collections as collectionsTable,
} from "@arcula/db";
import { app } from "../../src/app";
import { db } from "../../src/db";
import { API, ORIGIN, req, uuid } from "./api";

export async function makeCollection(
  userId: string,
  opts: { isPublic?: boolean; name?: string } = {},
): Promise<string> {
  const id = uuid();
  await db.insert(collectionsTable).values({
    id,
    userId,
    name: opts.name ?? "Test Collection",
    isPublic: opts.isPublic ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

export async function makeArtwork(
  userId: string,
  collectionId: string,
): Promise<string> {
  const id = uuid();
  await db.insert(artworksTable).values({
    id,
    userId,
    collectionId,
    title: "Test Artwork",
    artistName: "Test Artist",
    status: "published",
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

// `Uint8Array.from` (not a view over Sharp's Buffer): File's BlobPart wants an
// ArrayBuffer-backed view.
export const makeJpeg = async (
  width = 400,
  height = 300,
  background = { r: 40, g: 90, b: 200 },
): Promise<Uint8Array<ArrayBuffer>> =>
  Uint8Array.from(
    (
      await sharp({
        create: { width, height, channels: 3, background },
      })
        .jpeg()
        .toBuffer({ resolveWithObject: true })
    ).data,
  );

type Population = "photos" | "documents";

/**
 * Stage one file against the route for `population`. The named wrappers below
 * cover the two callers that always know which; the save sweep and the proxy
 * suite pass it through.
 */
export async function stageEntry(
  population: Population,
  cookies: string,
  cid: string,
  aid: string,
  entryId: string,
  file: File,
): Promise<Response> {
  const form = new FormData();
  form.append("entryId", entryId);
  form.append("file", file);
  return await app.request(
    `${API}/api/v1/collections/${cid}/artworks/${aid}/${population}/stage`,
    {
      method: "POST",
      headers: { Cookie: cookies, Origin: ORIGIN },
      body: form,
    },
  );
}

export async function stagePhoto(
  cookies: string,
  cid: string,
  aid: string,
  entryId: string,
  file: File,
): Promise<Response> {
  return await stageEntry("photos", cookies, cid, aid, entryId, file);
}

export async function stageDocument(
  cookies: string,
  cid: string,
  aid: string,
  entryId: string,
  file: File,
): Promise<Response> {
  return await stageEntry("documents", cookies, cid, aid, entryId, file);
}

export async function processEntry(
  cookies: string,
  cid: string,
  aid: string,
  population: Population,
  body: string,
): Promise<Response> {
  return req(
    "POST",
    `/api/v1/collections/${cid}/artworks/${aid}/${population}/process`,
    {
      cookies,
      headers: { "Content-Type": "application/json" },
      body,
    },
  );
}

export async function discardEntry(
  cookies: string,
  cid: string,
  aid: string,
  population: Population,
  entryId: string,
): Promise<Response> {
  return req(
    "DELETE",
    `/api/v1/collections/${cid}/artworks/${aid}/${population}/${entryId}`,
    {
      cookies,
    },
  );
}
