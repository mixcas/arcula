// The media proxy and the staged sweep:
// `GET /api/v1/media?key=` streamed against the real stack with the authz
// table (final photo: owner-or-public; final document: owner only, 403;
// staged: the owning session), and the sweep of staged entries that name
// no row.

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artworks as artworksTable,
  collectionCollaborators as collaboratorsTable,
} from "@arcula/db";
import { closeDb, db } from "../src/db";
import {
  finalDocumentKey,
  finalPhotoKey,
  finalPhotoPrefix,
  mediaUrl,
  stagedOriginalPrefix,
  stagingOriginalKey,
  stagingVariantKey,
} from "../src/media/keys";
import { deleteObject, listObjects, putObject } from "../src/storage";
import { err, freshUser, json, req, uuid } from "./helpers/api";
import {
  makeCollection,
  makeJpeg,
  processEntry,
  stageEntry,
  stagePhoto,
} from "./helpers/fixtures";

const RUN = Math.random().toString(36).slice(2, 10);
const entry = (label: string): string => `${label}-${RUN}`;

const pA = entry("media-a");
const pB = entry("media-b");
const pC = entry("media-c");
const pD = entry("media-d");
const pE = entry("media-e");
const pF = entry("media-f");
const pOrph = entry("media-orph");
const pKept = entry("media-kept");
const dA = entry("media-doc");
const dB = entry("media-doc-draft");

const makePdf = (): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(new TextEncoder().encode("%PDF-1.4 (test) %%EOF"));

let owner: { cookies: string; userId: string };
let stranger: { cookies: string; userId: string };
let mate: { cookies: string; userId: string };
let cid = "";
let privCid = "";

/** Share `collection` with the mate: one membership row, no API for it yet. */
async function shareWith(collectionId: string, userId: string) {
  await db.insert(collaboratorsTable).values({ collectionId, userId });
}

async function stage(
  population: "photos" | "documents",
  aid: string,
  entryId: string,
  file: File,
): Promise<void> {
  const staged = await stageEntry(
    population,
    owner.cookies,
    cid,
    aid,
    entryId,
    file,
  );
  expect(staged.status).toBe(200);
  const processed = await processEntry(
    owner.cookies,
    cid,
    aid,
    population,
    JSON.stringify({ entryId }),
  );
  expect(processed.status).toBe(200);
}

async function createWork(
  aid: string,
  photos: { entryId: string; name: string }[],
  opts: {
    status?: "draft" | "published";
    documents?: { entryId: string; name: string }[];
  } = {},
): Promise<void> {
  const res = await req("POST", `/api/v1/collections/${cid}/artworks`, {
    cookies: owner.cookies,
    body: JSON.stringify({
      artworkId: aid,
      title: "Media Work",
      artistName: "C. Cas",
      status: opts.status ?? "published",
      photos,
      documents: opts.documents ?? [],
    }),
  });
  expect(res.status).toBe(201);
}

const sourceJpeg = (async () => makeJpeg())();

let pubWorkId = "";
let draftWorkId = "";
let delWorkId = "";
let privCollWorkId = "";

beforeAll(async () => {
  owner = await freshUser("Media");
  stranger = await freshUser("Media");
  mate = await freshUser("Media");
  cid = await makeCollection(owner.userId, { isPublic: true });
  privCid = await makeCollection(owner.userId, { isPublic: false });
  await shareWith(cid, mate.userId);
  await shareWith(privCid, mate.userId);

  // pubWork: public + live, one photo and one PDF document.
  pubWorkId = uuid();
  await stage(
    "photos",
    pubWorkId,
    pA,
    new File([await sourceJpeg], "a.jpg", { type: "image/jpeg" }),
  );
  await stage(
    "documents",
    pubWorkId,
    dA,
    new File([makePdf()], "report.pdf", { type: "application/pdf" }),
  );
  await createWork(pubWorkId, [{ entryId: pA, name: "a.jpg" }], {
    documents: [{ entryId: dA, name: "report.pdf" }],
  });

  // draftWork: a draft, live, one photo and one PDF document — so the
  // documents verdict is proved at a status the work itself hides.
  draftWorkId = uuid();
  await stage(
    "photos",
    draftWorkId,
    pB,
    new File([await sourceJpeg], "b.jpg", { type: "image/jpeg" }),
  );
  await stage(
    "documents",
    draftWorkId,
    dB,
    new File([makePdf()], "draft.pdf", { type: "application/pdf" }),
  );
  await createWork(draftWorkId, [{ entryId: pB, name: "b.jpg" }], {
    status: "draft",
    documents: [{ entryId: dB, name: "draft.pdf" }],
  });

  // delWork: public but tombstoned, one photo.
  delWorkId = uuid();
  await stage(
    "photos",
    delWorkId,
    pC,
    new File([await sourceJpeg], "c.jpg", { type: "image/jpeg" }),
  );
  await createWork(delWorkId, [{ entryId: pC, name: "c.jpg" }]);
  await db
    .update(artworksTable)
    .set({ deletedAt: new Date() })
    .where(eq(artworksTable.id, delWorkId));

  // privCollWork: a public work inside a PRIVATE collection.
  privCollWorkId = uuid();
  await stagePhotosIn(privCid, privCollWorkId, pD);
  await createWorkIn(privCid, privCollWorkId, [{ entryId: pD, name: "d.jpg" }]);
});

// The two helpers above are collection-scoped; these are the variants
// that stage/create in a specific collection.
async function stagePhotosIn(
  c: string,
  aid: string,
  entryId: string,
): Promise<void> {
  const staged = await stagePhoto(
    owner.cookies,
    c,
    aid,
    entryId,
    new File([await sourceJpeg], "d.jpg", { type: "image/jpeg" }),
  );
  expect(staged.status).toBe(200);
  const processed = await processEntry(
    owner.cookies,
    c,
    aid,
    "photos",
    JSON.stringify({ entryId }),
  );
  expect(processed.status).toBe(200);
}

async function createWorkIn(
  c: string,
  aid: string,
  photos: { entryId: string; name: string }[],
): Promise<void> {
  const res = await req("POST", `/api/v1/collections/${c}/artworks`, {
    cookies: owner.cookies,
    body: JSON.stringify({
      artworkId: aid,
      title: "Media Work",
      artistName: "C. Cas",
      photos,
    }),
  });
  expect(res.status).toBe(201);
}

afterAll(async () => {
  await closeDb();
});

const get = (key: string, cookies?: string) =>
  req("GET", mediaUrl(key), { cookies });

describe("GET /api/v1/media — final photos", () => {
  it("streams a public final photo to a visitor with the row's metadata", async () => {
    const key = finalPhotoKey(
      owner.userId,
      cid,
      pubWorkId,
      pA,
      "original",
      "jpg",
    );
    const res = await get(key);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Cache-Control")).toMatch(/^public/);
    const bytes = new Uint8Array(await res.arrayBuffer());
    // The exact source bytes, and the row's recorded size as the length.
    expect(Array.from(bytes)).toEqual(Array.from(await sourceJpeg));
    const wire = await json<Record<string, unknown>>(
      await req("GET", `/api/v1/collections/${cid}/artworks/${pubWorkId}`, {
        cookies: owner.cookies,
      }),
    );
    const photo = (wire.photos as Record<string, unknown>[])[0];
    expect(res.headers.get("Content-Length")).toBe(String(photo.size));
  });

  it("streams a variant key from its own recorded row", async () => {
    const wire = await json<Record<string, unknown>>(
      await req("GET", `/api/v1/collections/${cid}/artworks/${pubWorkId}`, {
        cookies: owner.cookies,
      }),
    );
    const photo = (wire.photos as Record<string, unknown>[])[0];
    const xlarge = (photo.variants as Record<string, unknown>[]).find(
      (v) => v.key === "xlarge",
    )!;
    const key = finalPhotoKey(
      owner.userId,
      cid,
      pubWorkId,
      pA,
      "xlarge",
      "webp",
    );
    const res = await get(key);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    expect(res.headers.get("Content-Length")).toBe(String(xlarge.size));
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(
      Number(xlarge.size),
    );
  });

  it("404s a visitor on a draft; the owner still reads it", async () => {
    const key = finalPhotoKey(
      owner.userId,
      cid,
      draftWorkId,
      pB,
      "original",
      "jpg",
    );
    const anon = await get(key);
    expect(anon.status).toBe(404);
    const visitor = await get(key, stranger.cookies);
    expect(visitor.status).toBe(404);
    const own = await get(key, owner.cookies);
    expect(own.status).toBe(200);
  });

  it("404s a visitor on a deleted work; the owner still reads it", async () => {
    const key = finalPhotoKey(
      owner.userId,
      cid,
      delWorkId,
      pC,
      "original",
      "jpg",
    );
    const anon = await get(key);
    expect(anon.status).toBe(404);
    const own = await get(key, owner.cookies);
    expect(own.status).toBe(200);
  });

  it("is the collection's gate on the bytes: a public work inside a private collection 404s", async () => {
    // ADR-0003's case, from the bytes side: the work's own `published`
    // status does not open a key its collection keeps closed. Before this
    // change the proxy already refused these bytes while the single-work
    // read admitted the row — the divergence the ADR removes.
    const key = finalPhotoKey(
      owner.userId,
      privCid,
      privCollWorkId,
      pD,
      "original",
      "jpg",
    );
    const anon = await get(key);
    expect(anon.status).toBe(404);
    const visitor = await get(key, stranger.cookies);
    expect(visitor.status).toBe(404);
    expect((await err(visitor)).code).toBe("not-found");
    const own = await get(key, owner.cookies);
    expect(own.status).toBe(200);
  });

  it("admits a collaborator to a draft, a deleted work and a private collection", async () => {
    // The membership matrix, on the bytes: a collaborator is inside the
    // collection, so the visitor rule's three refusals do not apply to them.
    const keys = [
      finalPhotoKey(owner.userId, cid, draftWorkId, pB, "original", "jpg"),
      finalPhotoKey(owner.userId, cid, delWorkId, pC, "original", "jpg"),
      finalPhotoKey(
        owner.userId,
        privCid,
        privCollWorkId,
        pD,
        "original",
        "jpg",
      ),
    ];
    for (const key of keys) {
      const res = await get(key, mate.cookies);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    }
  });
});

describe("GET /api/v1/media — final documents", () => {
  it("403s everyone but the owner, and streams the exact bytes", async () => {
    const key = finalDocumentKey(
      owner.userId,
      cid,
      pubWorkId,
      dA,
      "original",
      "pdf",
    );
    const anon = await get(key);
    expect(anon.status).toBe(403);
    const visitor = await get(key, stranger.cookies);
    expect(visitor.status).toBe(403);
    expect((await err(visitor)).code).toBe("forbidden");

    const own = await get(key, owner.cookies);
    expect(own.status).toBe(200);
    expect(own.headers.get("Content-Type")).toBe("application/pdf");
    const pdf = makePdf();
    expect(Array.from(new Uint8Array(await own.arrayBuffer()))).toEqual(
      Array.from(pdf),
    );
    expect(own.headers.get("Content-Length")).toBe(String(pdf.byteLength));
  });

  it("refuses a draft's document exactly as it refuses a published one's", async () => {
    // The documents verdict ignores status and the collection's flag: a
    // draft hides its bytes no further than a published work does.
    const key = finalDocumentKey(
      owner.userId,
      cid,
      draftWorkId,
      dB,
      "original",
      "pdf",
    );
    expect((await get(key)).status).toBe(403);
    expect((await get(key, stranger.cookies)).status).toBe(403);
    expect((await get(key, owner.cookies)).status).toBe(200);
  });

  it("streams a document to a collaborator at every status", async () => {
    // Documents stop being owner-only: membership is the verdict, so a
    // draft's certificate reads for a collaborator exactly as a published
    // one's does.
    for (const key of [
      finalDocumentKey(owner.userId, cid, pubWorkId, dA, "original", "pdf"),
      finalDocumentKey(owner.userId, cid, draftWorkId, dB, "original", "pdf"),
    ]) {
      const res = await get(key, mate.cookies);
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/pdf");
    }

    // …and a visitor still reads none of them.
    expect(
      (
        await get(
          finalDocumentKey(
            owner.userId,
            cid,
            draftWorkId,
            dB,
            "original",
            "pdf",
          ),
          stranger.cookies,
        )
      ).status,
    ).toBe(403);
  });
});

describe("GET /api/v1/media — staged objects", () => {
  it("serves the staged original and variants to the owning session only", async () => {
    await stage(
      "photos",
      pubWorkId,
      pE,
      new File([await sourceJpeg], "e.jpg", { type: "image/jpeg" }),
    );

    const originalKey = stagingOriginalKey(
      owner.userId,
      cid,
      pubWorkId,
      pE,
      "jpg",
    );
    const own = await get(originalKey, owner.cookies);
    expect(own.status).toBe(200);
    expect(own.headers.get("Cache-Control")).toBe("no-store");
    expect(Array.from(new Uint8Array(await own.arrayBuffer()))).toEqual(
      Array.from(await sourceJpeg),
    );

    const variantKey = stagingVariantKey(
      owner.userId,
      cid,
      pubWorkId,
      pE,
      "xlarge",
      "webp",
    );
    expect((await get(variantKey, owner.cookies)).status).toBe(200);

    // No row exists yet: the collection's ownership is the whole of the
    // authorisation.
    expect((await get(originalKey, stranger.cookies)).status).toBe(403);
    expect((await get(originalKey)).status).toBe(401);

    // A collaborator is inside the collection but not under this prefix: the
    // key names the owner as its uploader, so the other member reads nothing.
    expect((await get(originalKey, mate.cookies)).status).toBe(403);

    // …and the uploader must still be a member: a staged object under the
    // member's own prefix reads for them, and the same key is refused once
    // their membership row is gone. The uploader's prefix alone is not
    // enough. The object is written directly rather than staged: the proxy's
    // verdict is about the key and the row, not about how the bytes got
    // there.
    await shareWith(cid, stranger.userId);
    const stagedByThem = stagingOriginalKey(
      stranger.userId,
      cid,
      pubWorkId,
      pF,
      "jpg",
    );
    await putObject(stagedByThem, await sourceJpeg, "image/jpeg");
    expect((await get(stagedByThem, stranger.cookies)).status).toBe(200);
    await db
      .delete(collaboratorsTable)
      .where(
        and(
          eq(collaboratorsTable.collectionId, cid),
          eq(collaboratorsTable.userId, stranger.userId),
        ),
      );
    expect((await get(stagedByThem, stranger.cookies)).status).toBe(403);
    await deleteObject(stagedByThem);

    // Give the entry its row: the sweep test's expectation is about
    // entries that have no row, not about this one. The entry was staged
    // under pubWork, so it is promoted by extending pubWork's sequence.
    const saved = await req(
      "PATCH",
      `/api/v1/collections/${cid}/artworks/${pubWorkId}`,
      {
        cookies: owner.cookies,
        body: JSON.stringify({
          title: "Media Work",
          artistName: "C. Cas",
          photos: [
            { entryId: pA, name: "a.jpg" },
            { entryId: pE, name: "e.jpg" },
          ],
        }),
      },
    );
    expect(saved.status).toBe(200);
  });
});

describe("GET /api/v1/media — keys that name nothing", () => {
  it("404s a missing key, unparseable keys, and a parseable key with no object", async () => {
    expect((await req("GET", "/api/v1/media")).status).toBe(404);
    expect((await get("garbage")).status).toBe(404);
    // Five segments would parse; this one has one too few.
    expect((await get("staging/a/b/p.webp")).status).toBe(404);
    // A valid final shape under a wrong extension: the row exists, the
    // object never did.
    const key = finalPhotoKey(
      owner.userId,
      cid,
      pubWorkId,
      pA,
      "original",
      "bin",
    );
    expect((await get(key, owner.cookies)).status).toBe(404);
  });
});

describe("POST /collections/{cid}/maintenance/sweep", () => {
  it("deletes the staged entries that have no row and keeps the rest", async () => {
    // orph: staged, never saved — no row.
    await stage(
      "photos",
      pubWorkId,
      pOrph,
      new File([await sourceJpeg], "o.jpg", { type: "image/jpeg" }),
    );
    // kept: staged, then saved — its row exists and the save already
    // deleted its staged objects.
    const keptWorkId = uuid();
    await stage(
      "photos",
      keptWorkId,
      pKept,
      new File([await sourceJpeg], "k.jpg", { type: "image/jpeg" }),
    );
    await createWork(keptWorkId, [{ entryId: pKept, name: "k.jpg" }]);
    // pC: re-staged under the entry that HAS a row (a tombstoned work's) —
    // the row is what a restore would point at, so the staged object stays.
    await stage(
      "photos",
      delWorkId,
      pC,
      new File([await sourceJpeg], "c2.jpg", { type: "image/jpeg" }),
    );

    const res = await req(
      "POST",
      `/api/v1/collections/${cid}/maintenance/sweep`,
      { cookies: owner.cookies },
    );
    expect(res.status).toBe(200);
    // orph's original + five variants: six objects. Nothing else goes.
    expect(await json(res)).toEqual({ swept: 6 });

    expect(
      await listObjects(
        stagedOriginalPrefix(owner.userId, cid, pubWorkId, pOrph),
      ),
    ).toEqual([]);
    expect(
      await listObjects(
        `staging/${owner.userId}/${cid}/${pubWorkId}/${pOrph}_`,
      ),
    ).toEqual([]);
    // pC's re-staged original survived the sweep…
    expect(
      await listObjects(stagedOriginalPrefix(owner.userId, cid, delWorkId, pC)),
    ).toHaveLength(1);
    // …and so did its final objects.
    expect(
      await listObjects(finalPhotoPrefix(owner.userId, cid, delWorkId, pC)),
    ).toHaveLength(6);

    // Idempotent: a second sweep finds nothing to remove.
    const again = await req(
      "POST",
      `/api/v1/collections/${cid}/maintenance/sweep`,
      { cookies: owner.cookies },
    );
    expect(await json(again)).toEqual({ swept: 0 });
  });

  it("403s a non-owner", async () => {
    const res = await req(
      "POST",
      `/api/v1/collections/${cid}/maintenance/sweep`,
      { cookies: stranger.cookies },
    );
    expect(res.status).toBe(403);
  });
});
