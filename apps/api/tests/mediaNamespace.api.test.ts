// The collection's media namespace end to end: a collection created by the
// current code mints a fresh namespace, final objects are keyed by it while
// staged objects stay under their uploader, a dropped entry is swept by it,
// and changing only the owner leaves every URL pointing at the same object.
//
// The pure suite pins the algebra; this one asserts the routes and the save
// actually use it — a serializer or a promotion that reached for `userId`
// still round-trips its own keys and would only show up here.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { collections as collectionsTable } from "@arcula/db";
import { MINTED_ID_RE, type ArtworkRead } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import {
  finalPhotoPrefix,
  parseMediaKey,
  type ParsedMediaKey,
} from "../src/media/keys";
import { listObjects } from "../src/storage";
import { freshUser, json, req, uuid } from "./helpers/api";
import { makeJpeg, processEntry, stagePhoto } from "./helpers/fixtures";

const RUN = Math.random().toString(36).slice(2, 10);
const pKeep = `keep-${RUN}`;
const pDrop = `drop-${RUN}`;

let owner: Awaited<ReturnType<typeof freshUser>>;
let successor: Awaited<ReturnType<typeof freshUser>>;
let cid = "";
let aid = "";
let namespace = "";
let stagedKeepUrl = "";
let keepUrl = "";

/** The object key a proxy URL names. */
function keyOf(url: string): string {
  const key = new URL(url, "http://localhost").searchParams.get("key");
  if (key === null) throw new Error(`The URL names no object key: ${url}`);
  return key;
}

function parsedKeyOf(url: string): ParsedMediaKey {
  const parsed = parseMediaKey(keyOf(url));
  if (parsed === null) throw new Error(`The URL names no known key: ${url}`);
  return parsed;
}

async function stageAndProcess(entryId: string): Promise<string> {
  const staged = await stagePhoto(
    owner.cookies,
    cid,
    aid,
    entryId,
    new File([await makeJpeg()], "scan.jpg", { type: "image/jpeg" }),
  );
  expect(staged.status).toBe(200);
  const body = await json<{ url: string }>(staged);
  const processed = await processEntry(
    owner.cookies,
    cid,
    aid,
    "photos",
    JSON.stringify({ entryId }),
  );
  expect(processed.status).toBe(200);
  return body.url;
}

beforeAll(async () => {
  owner = await freshUser("NsOwner");
  successor = await freshUser("NsSuccessor");

  const created = await req("POST", "/api/v1/collections", {
    cookies: owner.cookies,
    body: JSON.stringify({ name: "Namespaced Wall" }),
  });
  expect(created.status).toBe(201);
  cid = (await json<{ id: string }>(created)).id;

  const row = (
    await db.select().from(collectionsTable).where(eq(collectionsTable.id, cid))
  )[0];
  namespace = row.mediaNamespaceId ?? "";

  aid = uuid();
  stagedKeepUrl = await stageAndProcess(pKeep);
  await stageAndProcess(pDrop);

  const saved = await req("POST", `/api/v1/collections/${cid}/artworks`, {
    cookies: owner.cookies,
    body: {
      artworkId: aid,
      title: "Namespaced Work",
      artistName: "C. Cas",
      status: "published",
      photos: [
        { entryId: pKeep, name: "keep.jpg" },
        { entryId: pDrop, name: "drop.jpg" },
      ],
    },
  });
  expect(saved.status).toBe(201);
});

afterAll(async () => {
  await closeDb();
});

describe("a collection's media namespace", () => {
  it("is minted fresh when the collection is created", () => {
    expect(namespace).toMatch(MINTED_ID_RE);
    // Not the owner and not the collection id: the namespace outlives the
    // owner, so it cannot be derived from either.
    expect(namespace).not.toBe(owner.userId);
    expect(namespace).not.toBe(cid);
  });

  it("keys the promoted objects by the namespace and staged objects by the uploader", async () => {
    const staged = parsedKeyOf(stagedKeepUrl);
    expect(staged).toMatchObject({ kind: "staging", uploaderId: owner.userId });

    const photo = await json<ArtworkRead>(
      await req("GET", `/api/v1/collections/${cid}/artworks/${aid}`, {
        cookies: owner.cookies,
      }),
    );
    const [kept] = photo.photos.filter((p) => p.id === pKeep);
    const urls = [kept.original.url, ...kept.variants.map((v) => v.url)];
    for (const url of urls) {
      expect(parsedKeyOf(url)).toMatchObject({
        kind: "final",
        namespaceId: namespace,
        collectionId: cid,
        artworkId: aid,
      });
    }
  });

  it("deletes a dropped entry's final objects by the namespace", async () => {
    const patched = await req(
      "PATCH",
      `/api/v1/collections/${cid}/artworks/${aid}`,
      {
        cookies: owner.cookies,
        body: {
          title: "Namespaced Work",
          artistName: "C. Cas",
          photos: [{ entryId: pKeep, name: "keep.jpg" }],
        },
      },
    );
    expect(patched.status).toBe(200);
    const body = await json<ArtworkRead>(patched);
    keepUrl = body.photos[0].original.url;

    expect(
      await listObjects(finalPhotoPrefix(namespace, cid, aid, pDrop)),
    ).toEqual([]);
    expect(
      await listObjects(finalPhotoPrefix(namespace, cid, aid, pKeep)),
    ).not.toEqual([]);
  });

  it("keeps every media URL serving the same object when only the owner changes", async () => {
    const before = keepUrl;
    await db
      .update(collectionsTable)
      .set({ userId: successor.userId })
      .where(eq(collectionsTable.id, cid));

    const read = await json<ArtworkRead>(
      await req("GET", `/api/v1/collections/${cid}/artworks/${aid}`, {
        cookies: successor.cookies,
      }),
    );
    expect(read.photos[0].original.url).toBe(before);

    // The URL is not merely unchanged: it still resolves to the object.
    const object = await req("GET", before, { cookies: successor.cookies });
    expect(object.status).toBe(200);
    expect(object.headers.get("Content-Type")).toBe("image/jpeg");
  });
});
