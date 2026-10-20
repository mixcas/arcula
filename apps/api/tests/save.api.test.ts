// The save transaction and the read routes: create/patch with staged-entry
// promotion, the serializer's exact wire shape, and the owner/visitor
// reads — driven in-process with app.request() against the real stack
// (real Postgres rows, real S3 objects, real Sharp).
//
// The media suite is about the staging contract; this one is about what
// happens AT SAVE: one transaction, order reindexed from position, the
// exact document shape on the wire.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artworks as artworksTable } from "@arcula/db";
import { MAX_ARTWORK_PHOTOS } from "@arcula/shared";
import { canSeeArtwork } from "../src/access";
import { loadArtworkInCollection, loadCollection } from "../src/authorize";
import { closeDb, db } from "../src/db";
import {
  finalDocumentKey,
  finalPhotoKey,
  finalPhotoPrefix,
  mediaUrl,
  parseMediaKey,
  stagedOriginalPrefix,
  stagedVariantPrefix,
} from "../src/media/keys";
import { listObjects } from "../src/storage";
import { freshUser, json, req, uuid } from "./helpers/api";
import {
  makeCollection,
  makeJpeg,
  processEntry,
  stageDocument,
  stagePhoto,
} from "./helpers/fixtures";

// Entry ids are global primary keys (artwork_photos.id,
// artwork_documents.id), and the test stack persists across runs — so
// each run gets its own id namespace. Reusing a previous run's id is
// exactly the collision the save routes refuse, and a leaked row from
// an earlier run would skew the very shapes these tests assert.
const RUN = Math.random().toString(36).slice(2, 10);
const entry = (label: string): string => `${label}-${RUN}`;

const pOne = entry("p-one");
const pShape = entry("p-shape");
const dPdf = entry("d-pdf");
const dImg = entry("d-img");
// Two ids that sort cleanly against each other, for the document-order test:
// "aa-…" < "zz-…" lexicographically, whatever the run suffix is.
const dAa = entry("aa-doc");
const dZz = entry("zz-doc");
const pReal = entry("p-real");
const pGhost = entry("p-ghost");
const pX = entry("p-x");
const twoC = entry("two-c");
const raceA = entry("race-a");
const raceB = entry("race-b");

// ---------------------------------------------------------------------------
// Wire shapes (the exact wire document shapes)
// ---------------------------------------------------------------------------

interface WireTimestamp {
  seconds: number;
  nanoseconds: number;
}

interface WireVariant {
  key: string;
  url: string;
  width: number;
  height: number;
  size: number;
  contentType: string;
}

interface WirePhoto {
  id: string;
  order: number;
  name: string;
  size: number;
  contentType: string;
  width: number;
  height: number;
  original: { url: string; size: number; contentType: string };
  variants: WireVariant[];
}

interface WireDocument {
  id: string;
  kind: "file" | "image";
  name: string;
  size: number;
  contentType: string;
  original: { url: string; size: number; contentType: string };
  width?: number;
  height?: number;
  variants?: WireVariant[];
}

interface WireArtwork {
  id: string;
  userId: string;
  title: string;
  artistName: string;
  collectionId: string;
  status: string;
  deletedAt: WireTimestamp | null;
  createdAt: WireTimestamp;
  updatedAt: WireTimestamp;
  photos: WirePhoto[];
  documents: WireDocument[];
  [key: string]: unknown;
}

interface WireError {
  error: { code: string; message: string; fields?: Record<string, string> };
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let owner: Awaited<ReturnType<typeof freshUser>>;
let visitor: Awaited<ReturnType<typeof freshUser>>;
let cid: string;
let privateCid: string;

beforeAll(async () => {
  owner = await freshUser("Save");
  visitor = await freshUser("SaveVisitor");
  cid = await makeCollection(owner.userId, { isPublic: true });
  privateCid = await makeCollection(owner.userId, { isPublic: false });
});

afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Save helpers
// ---------------------------------------------------------------------------

async function stageAndProcessPhoto(
  aid: string,
  entryId: string,
  width = 400,
  height = 300,
): Promise<void> {
  const staged = await stagePhoto(
    owner.cookies,
    cid,
    aid,
    entryId,
    new File([await makeJpeg(width, height)], "scan.jpg", {
      type: "image/jpeg",
    }),
  );
  expect(staged.status).toBe(200);
  const processed = await processEntry(
    owner.cookies,
    cid,
    aid,
    "photos",
    JSON.stringify({ entryId }),
  );
  expect(processed.status).toBe(200);
}

async function stageAndProcessDocument(
  aid: string,
  entryId: string,
): Promise<void> {
  const staged = await stageDocument(
    owner.cookies,
    cid,
    aid,
    entryId,
    new File([await makeJpeg(400, 300)], "plate.jpg", {
      type: "image/jpeg",
    }),
  );
  expect(staged.status).toBe(200);
  const processed = await processEntry(
    owner.cookies,
    cid,
    aid,
    "documents",
    JSON.stringify({ entryId }),
  );
  expect(processed.status).toBe(200);
}

function createArtwork(body: Record<string, unknown>): Promise<Response> {
  return req("POST", `/api/v1/collections/${cid}/artworks`, {
    cookies: owner.cookies,
    body: JSON.stringify(body),
  });
}

function patchArtwork(
  aid: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return req("PATCH", `/api/v1/collections/${cid}/artworks/${aid}`, {
    cookies: owner.cookies,
    body: JSON.stringify(body),
  });
}

function getArtwork(aid: string, cookies?: string): Promise<Response> {
  return req("GET", `/api/v1/collections/${cid}/artworks/${aid}`, { cookies });
}

function listArtworks(cookies?: string): Promise<Response> {
  return req("GET", `/api/v1/collections/${cid}/artworks`, { cookies });
}

/**
 * A fresh artwork with two promoted photos at orders 0, 1. The entry ids
 * are fresh per call: they are global primary keys, and the save routes
 * refuse an id another artwork already holds — so no two tests may share
 * a pair.
 */
async function makeTwoPhotoArtwork(): Promise<{
  aid: string;
  a: string;
  b: string;
}> {
  const aid = uuid();
  const a = entry(`two-a-${uuid().slice(0, 8)}`);
  const b = entry(`two-b-${uuid().slice(0, 8)}`);
  await stageAndProcessPhoto(aid, a);
  await stageAndProcessPhoto(aid, b);
  const res = await createArtwork({
    artworkId: aid,
    title: "Two",
    artistName: "C. Cas",
    photos: [
      { entryId: a, name: "a.jpg" },
      { entryId: b, name: "b.jpg" },
    ],
  });
  expect(res.status).toBe(201);
  return { aid, a, b };
}

/** A bare artwork row, inserted directly (the route's job is tested elsewhere). */
async function insertRow(
  collectionId: string,
  opts: { status?: "draft" | "published"; deleted?: boolean } = {},
): Promise<string> {
  const id = uuid();
  const now = new Date();
  await db.insert(artworksTable).values({
    id,
    userId: owner.userId,
    collectionId,
    title: "Direct Row",
    artistName: "C. Cas",
    status: opts.status ?? "published",
    deletedAt: opts.deleted ? now : null,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

// ---------------------------------------------------------------------------
// POST — create + promote
// ---------------------------------------------------------------------------

describe("POST …/artworks", () => {
  it("creates the work and promotes the staged photo at order 0", async () => {
    const aid = uuid();
    await stageAndProcessPhoto(aid, pOne);
    const res = await createArtwork({
      artworkId: aid,
      title: "Study in Red",
      artistName: "C. Cas",
      status: "published",
      photos: [{ entryId: pOne, name: "scan.jpg" }],
    });
    expect(res.status).toBe(201);
    const body = await json<WireArtwork>(res);
    expect(body.id).toBe(aid);
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].id).toBe(pOne);
    expect(body.photos[0].order).toBe(0);

    // The staged objects are gone; the final objects are in place, and
    // every one of them parses back to its segments.
    expect(
      await listObjects(stagedOriginalPrefix(owner.userId, cid, aid, pOne)),
    ).toEqual([]);
    expect(
      await listObjects(stagedVariantPrefix(owner.userId, cid, aid, pOne)),
    ).toEqual([]);
    const finals = await listObjects(
      finalPhotoPrefix(owner.userId, cid, aid, pOne),
    );
    expect(finals).toHaveLength(6);
    for (const key of finals) {
      const parsed = parseMediaKey(key);
      expect(parsed?.kind).toBe("final");
      expect(parsed?.entryId).toBe(pOne);
    }
  });

  it("answers with the exact wire document shape", async () => {
    const aid = uuid();
    await stageAndProcessPhoto(aid, pShape);
    const res = await createArtwork({
      artworkId: aid,
      title: "Study in Red",
      artistName: "C. Cas",
      serie: "Early works",
      status: "published",
      photos: [{ entryId: pShape, name: "scan.jpg" }],
    });
    expect(res.status).toBe(201);
    const body = await json<WireArtwork>(res);

    // The top level: the Artwork document's key set, no more, no less —
    // blank text fields are ABSENT keys, not nulls.
    expect(Object.keys(body).sort()).toEqual([
      "artistName",
      "collectionId",
      "createdAt",
      "deletedAt",
      "documents",
      "id",
      "photos",
      "serie",
      "status",
      "title",
      "updatedAt",
      "userId",
    ]);
    expect(body.userId).toBe(owner.userId);
    expect(body.collectionId).toBe(cid);
    expect(body.status).toBe("published");
    expect(body.deletedAt).toBe(null);
    expect(body.serie).toBe("Early works");
    for (const ts of [body.createdAt, body.updatedAt]) {
      expect(Object.keys(ts).sort()).toEqual(["nanoseconds", "seconds"]);
      expect(ts.seconds).toBeGreaterThan(0);
    }

    // The photo: the ArtworkPhoto shape, the original/variants split.
    const [photo] = body.photos;
    expect(Object.keys(photo).sort()).toEqual([
      "contentType",
      "height",
      "id",
      "name",
      "order",
      "original",
      "size",
      "variants",
      "width",
    ]);
    expect(photo.id).toBe(pShape);
    expect(photo.order).toBe(0);
    expect(photo.name).toBe("scan.jpg");
    expect(photo.width).toBe(400);
    expect(photo.height).toBe(300);
    expect(photo.contentType).toBe("image/jpeg");
    expect(photo.size).toBeGreaterThan(0);
    expect(Object.keys(photo.original).sort()).toEqual([
      "contentType",
      "size",
      "url",
    ]);
    expect(photo.original.contentType).toBe("image/jpeg");
    expect(photo.original.url).toBe(
      mediaUrl(
        finalPhotoKey(owner.userId, cid, aid, pShape, "original", "jpg"),
      ),
    );

    // The variants: exactly the five keys, spec order, webp, proxy urls.
    expect(photo.variants.map((v) => v.key)).toEqual([
      "xlarge",
      "square_lg",
      "square_sm",
      "large",
      "medium",
    ]);
    // 400x300 source: the inside fits stay at source scale, the squares
    // cover their boxes.
    const geometry: Record<string, [number, number]> = {
      xlarge: [400, 300],
      square_lg: [800, 800],
      square_sm: [400, 400],
      large: [400, 300],
      medium: [400, 300],
    };
    for (const v of photo.variants) {
      expect(Object.keys(v).sort()).toEqual([
        "contentType",
        "height",
        "key",
        "size",
        "url",
        "width",
      ]);
      expect(v.contentType).toBe("image/webp");
      expect([v.width, v.height]).toEqual(geometry[v.key]);
      expect(v.size).toBeGreaterThan(0);
      expect(v.url).toBe(
        mediaUrl(finalPhotoKey(owner.userId, cid, aid, pShape, v.key, "webp")),
      );
    }

    expect(body.documents).toEqual([]);
  });

  it("writes the status the owner chose, and published when they say nothing", async () => {
    const draft = await createArtwork({
      artworkId: uuid(),
      title: "Work in Progress",
      artistName: "C. Cas",
      status: "draft",
    });
    expect(draft.status).toBe(201);
    expect((await json<WireArtwork>(draft)).status).toBe("draft");

    const silent = await createArtwork({
      artworkId: uuid(),
      title: "Unstated",
      artistName: "C. Cas",
    });
    expect(silent.status).toBe(201);
    expect((await json<WireArtwork>(silent)).status).toBe("published");
  });

  it("promotes a staged PDF document as a file with no variants", async () => {
    const aid = uuid();
    // The magic header is enough: stage checks type + size only, and
    // process is a no-op for a PDF.
    const pdf = new Uint8Array([
      ...[0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], // %PDF-1.4
      ...Array.from({ length: 64 }, () => 0),
    ]);
    const staged = await stageDocument(
      owner.cookies,
      cid,
      aid,
      dPdf,
      new File([pdf], "condition-report.pdf", {
        type: "application/pdf",
      }),
    );
    expect(staged.status).toBe(200);
    const processed = await processEntry(
      owner.cookies,
      cid,
      aid,
      "documents",
      JSON.stringify({ entryId: dPdf }),
    );
    expect(processed.status).toBe(200);
    const proc = await json<{ variants: unknown[] }>(processed);
    expect(proc.variants).toEqual([]);

    const res = await createArtwork({
      artworkId: aid,
      title: "T",
      artistName: "C. Cas",
      documents: [{ entryId: dPdf, name: "condition-report.pdf" }],
    });
    expect(res.status).toBe(201);
    const body = await json<WireArtwork>(res);
    expect(body.documents).toHaveLength(1);
    const doc = body.documents[0];
    // A file document: no width/height, no variants — the kind decides.
    expect(Object.keys(doc).sort()).toEqual([
      "contentType",
      "id",
      "kind",
      "name",
      "original",
      "size",
    ]);
    expect(doc.kind).toBe("file");
    expect(doc.name).toBe("condition-report.pdf");
    expect(doc.contentType).toBe("application/pdf");
    expect(doc.size).toBe(pdf.length);
    expect(doc.original.url).toBe(
      mediaUrl(
        finalDocumentKey(owner.userId, cid, aid, dPdf, "original", "pdf"),
      ),
    );
  });

  it("promotes a staged image document with its two variants", async () => {
    const aid = uuid();
    await stageAndProcessDocument(aid, dImg);
    const res = await createArtwork({
      artworkId: aid,
      title: "T",
      artistName: "C. Cas",
      documents: [{ entryId: dImg, name: "plate.jpg" }],
    });
    expect(res.status).toBe(201);
    const body = await json<WireArtwork>(res);
    const doc = body.documents[0];
    expect(doc.kind).toBe("image");
    expect(doc.width).toBe(400);
    expect(doc.height).toBe(300);
    expect(doc.variants?.map((v) => v.key)).toEqual(["square_sm", "large"]);
    expect(doc.variants?.[0].url).toBe(
      mediaUrl(
        finalDocumentKey(owner.userId, cid, aid, dImg, "square_sm", "webp"),
      ),
    );
  });

  it("fails on an unknown staged entry and commits nothing", async () => {
    const aid = uuid();
    await stageAndProcessPhoto(aid, pReal);
    const res = await createArtwork({
      artworkId: aid,
      title: "T",
      artistName: "C. Cas",
      photos: [
        { entryId: pGhost, name: "ghost.jpg" },
        { entryId: pReal, name: "real.jpg" },
      ],
    });
    expect(res.status).toBe(400);
    const err = await json<WireError>(res);
    expect(err.error.code).toBe("validation");
    // Nothing committed: no row, no final object for the valid entry.
    expect((await getArtwork(aid, owner.cookies)).status).toBe(404);
    expect(
      await listObjects(finalPhotoPrefix(owner.userId, cid, aid, pReal)),
    ).toEqual([]);
    // The valid entry's staged objects remain: the save is retryable.
    expect(
      await listObjects(stagedOriginalPrefix(owner.userId, cid, aid, pReal)),
    ).toHaveLength(1);
  });

  it("rejects a reused artwork id", async () => {
    const first = uuid();
    expect(
      (
        await createArtwork({
          artworkId: first,
          title: "T",
          artistName: "C. Cas",
        })
      ).status,
    ).toBe(201);
    const res = await createArtwork({
      artworkId: first,
      title: "Again",
      artistName: "C. Cas",
    });
    expect(res.status).toBe(400);
    const err = await json<WireError>(res);
    expect(err.error.code).toBe("validation");
    expect(err.error.fields?.artworkId).toBeDefined();
  });

  it("rejects an entry id another artwork already holds", async () => {
    const holder = uuid();
    const entryId = entry("taken");
    await stageAndProcessPhoto(holder, entryId);
    expect(
      (
        await createArtwork({
          artworkId: holder,
          title: "Holder",
          artistName: "C. Cas",
          photos: [{ entryId, name: "taken.jpg" }],
        })
      ).status,
    ).toBe(201);

    const res = await createArtwork({
      artworkId: uuid(),
      title: "Thief",
      artistName: "C. Cas",
      photos: [{ entryId, name: "taken.jpg" }],
    });
    expect(res.status).toBe(400);
    const err = await json<WireError>(res);
    expect(err.error.code).toBe("validation");
    expect(err.error.fields?.photos).toBeDefined();
  });

  it("refuses more photos than the cap", async () => {
    const photos = Array.from({ length: MAX_ARTWORK_PHOTOS + 1 }, (_, i) => ({
      entryId: `p-${i}`,
      name: `p${i}.jpg`,
    }));
    const res = await createArtwork({
      artworkId: uuid(),
      title: "T",
      artistName: "C. Cas",
      photos,
    });
    expect(res.status).toBe(400);
    const err = await json<WireError>(res);
    expect(err.error.code).toBe("validation");
  });

  it("refuses a duplicate entry id in the payload", async () => {
    const res = await createArtwork({
      artworkId: uuid(),
      title: "T",
      artistName: "C. Cas",
      photos: [
        { entryId: pX, name: "a.jpg" },
        { entryId: pX, name: "b.jpg" },
      ],
    });
    expect(res.status).toBe(400);
    const err = await json<WireError>(res);
    expect(err.error.code).toBe("validation");
  });
});

// ---------------------------------------------------------------------------
// PATCH — the edit form
// ---------------------------------------------------------------------------

describe("PATCH …/artworks/{aid}", () => {
  it("reindexes order by payload position and promotes new entries", async () => {
    const { aid, a, b } = await makeTwoPhotoArtwork();
    await stageAndProcessPhoto(aid, twoC);
    const res = await patchArtwork(aid, {
      title: "Two",
      artistName: "C. Cas",
      photos: [
        { entryId: twoC, name: "c.jpg" },
        { entryId: b, name: "b.jpg" },
        { entryId: a, name: "a.jpg" },
      ],
    });
    expect(res.status).toBe(200);
    const body = await json<WireArtwork>(res);
    expect(body.photos.map((p) => [p.id, p.order])).toEqual([
      [twoC, 0],
      [b, 1],
      [a, 2],
    ]);
    expect(
      await listObjects(finalPhotoPrefix(owner.userId, cid, aid, twoC)),
    ).toHaveLength(6);
  });

  it("drops a removed photo: its row and its final objects go", async () => {
    const { aid, a, b } = await makeTwoPhotoArtwork();
    const res = await patchArtwork(aid, {
      title: "Two",
      artistName: "C. Cas",
      photos: [{ entryId: a, name: "a.jpg" }],
    });
    expect(res.status).toBe(200);
    const body = await json<WireArtwork>(res);
    expect(body.photos.map((p) => [p.id, p.order])).toEqual([[a, 0]]);
    // b: row gone (the response), final objects gone (the bucket).
    expect(
      await listObjects(finalPhotoPrefix(owner.userId, cid, aid, b)),
    ).toEqual([]);
    expect(
      await listObjects(finalPhotoPrefix(owner.userId, cid, aid, a)),
    ).toHaveLength(6);
  });

  it("clears a text field with null and leaves absent fields alone", async () => {
    const aid = uuid();
    expect(
      (
        await createArtwork({
          artworkId: aid,
          title: "T",
          artistName: "C. Cas",
          serie: "Series A",
          media: "Oil on canvas",
        })
      ).status,
    ).toBe(201);
    const res = await patchArtwork(aid, {
      title: "T",
      artistName: "C. Cas",
      serie: null,
    });
    expect(res.status).toBe(200);
    const body = await json<WireArtwork>(res);
    // Cleared: the key is ABSENT, not null.
    expect("serie" in body).toBe(false);
    expect(body.media).toBe("Oil on canvas");
    expect(body.title).toBe("T");
  });

  it("leaves the sequences alone when the payload omits them", async () => {
    const { aid, a, b } = await makeTwoPhotoArtwork();
    const res = await patchArtwork(aid, {
      title: "Renamed",
      artistName: "C. Cas",
    });
    expect(res.status).toBe(200);
    const body = await json<WireArtwork>(res);
    expect(body.title).toBe("Renamed");
    expect(body.photos.map((p) => [p.id, p.order])).toEqual([
      [a, 0],
      [b, 1],
    ]);
  });

  it("sets the status a PATCH names and leaves it alone when omitted", async () => {
    const aid = uuid();
    expect(
      (
        await createArtwork({
          artworkId: aid,
          title: "Work in Progress",
          artistName: "C. Cas",
          status: "draft",
        })
      ).status,
    ).toBe(201);

    // Omitted: the draft stays a draft — an edit form that never touched the
    // choice cannot publish the work by saving it.
    const kept = await patchArtwork(aid, {
      title: "Work in Progress",
      artistName: "C. Cas",
    });
    expect(kept.status).toBe(200);
    expect((await json<WireArtwork>(kept)).status).toBe("draft");

    const published = await patchArtwork(aid, {
      title: "Work in Progress",
      artistName: "C. Cas",
      status: "published",
    });
    expect(published.status).toBe(200);
    expect((await json<WireArtwork>(published)).status).toBe("published");
  });

  it("answers an omitted document sequence in id order, whatever the rows sit in", async () => {
    // The client-visible contract: a PATCH that omits `documents` answers with
    // the kept set in id order, not in whatever order the rows physically sit
    // in. Documents carry no position column, so id order is the only sequence
    // they have. Seeded and created in DESCENDING lexicographic order here, so
    // the rows sit backwards against the order the answer must carry.
    //
    // The order comes from the serializer (`loadJoined`), not from the
    // handler's read — so this pins the answer, which is what the client
    // depends on, not that one query.
    const aid = uuid();
    const pdf = new Uint8Array([
      ...[0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], // %PDF-1.4
      ...Array.from({ length: 64 }, () => 0),
    ]);
    // Seed descending: zz-doc before aa-doc.
    for (const [entryId, name] of [
      [dZz, "zz.pdf"],
      [dAa, "aa.pdf"],
    ] as const) {
      const staged = await stageDocument(
        owner.cookies,
        cid,
        aid,
        entryId,
        new File([pdf], name, { type: "application/pdf" }),
      );
      expect(staged.status).toBe(200);
      const processed = await processEntry(
        owner.cookies,
        cid,
        aid,
        "documents",
        JSON.stringify({ entryId }),
      );
      expect(processed.status).toBe(200);
    }
    // Create listing them the same way: the rows physically sit zz, aa —
    // the reverse of the id order.
    const created = await createArtwork({
      artworkId: aid,
      title: "Two reports",
      artistName: "C. Cas",
      documents: [
        { entryId: dZz, name: "zz.pdf" },
        { entryId: dAa, name: "aa.pdf" },
      ],
    });
    expect(created.status).toBe(201);

    const res = await patchArtwork(aid, {
      title: "Two reports",
      artistName: "C. Cas",
    });
    expect(res.status).toBe(200);
    const body = await json<WireArtwork>(res);
    expect(body.documents.map((d) => d.id)).toEqual([dAa, dZz]);
  });

  it("a duplicate order from a concurrent save fails loudly and commits nothing", async () => {
    const { aid, a, b } = await makeTwoPhotoArtwork();
    await stageAndProcessPhoto(aid, raceA);
    await stageAndProcessPhoto(aid, raceB);
    // Two saves both claiming order 0 for different new photos: exactly
    // one can win the UNIQUE (artworkId, order) slot; the other hits it.
    const [r1, r2] = await Promise.all([
      patchArtwork(aid, {
        title: "Two",
        artistName: "C. Cas",
        photos: [
          { entryId: raceA, name: "a.jpg" },
          { entryId: a, name: "a.jpg" },
          { entryId: b, name: "b.jpg" },
        ],
      }),
      patchArtwork(aid, {
        title: "Two",
        artistName: "C. Cas",
        photos: [
          { entryId: raceB, name: "b.jpg" },
          { entryId: a, name: "a.jpg" },
          { entryId: b, name: "b.jpg" },
        ],
      }),
    ]);
    expect([r1.status, r2.status].sort((a, b) => a - b)).toEqual([200, 500]);
    const loser = r1.status === 500 ? r1 : r2;
    const loserErr = await json<WireError>(loser);
    expect(loserErr.error.code).toBe("internal");
    // The survivor's state: a clean 0..n-1 permutation, no lost work.
    const winner = r1.status === 200 ? r1 : r2;
    const body = await json<WireArtwork>(winner);
    expect(body.photos.map((p) => p.order).sort((a, b) => a - b)).toEqual(
      body.photos.map((_, i) => i),
    );
    expect(new Set(body.photos.map((p) => p.id)).size).toBe(body.photos.length);
  });
});

// ---------------------------------------------------------------------------
// GET — owner and visitor reads
// ---------------------------------------------------------------------------

describe("GET reads", () => {
  it("lists the owner's live works only; a visitor sees the published ones", async () => {
    const pub = await insertRow(cid, { status: "published" });
    const draft = await insertRow(cid, { status: "draft" });
    const del = await insertRow(cid, { deleted: true });

    const asOwner = await json<WireArtwork[]>(
      await listArtworks(owner.cookies),
    );
    const ownerIds = asOwner.map((a) => a.id);
    expect(ownerIds).toContain(pub);
    expect(ownerIds).toContain(draft);
    expect(ownerIds).not.toContain(del);

    const asVisitor = await json<WireArtwork[]>(await listArtworks(undefined));
    const visitorIds = asVisitor.map((a) => a.id);
    expect(visitorIds).toContain(pub);
    expect(visitorIds).not.toContain(draft);
    expect(visitorIds).not.toContain(del);
  });

  it("answers the visitor list, the single read and the verdict the same way for one fixture", async () => {
    // The two declarations meet here: the list is a SQL filter over `status`
    // and `deletedAt`, the single read is the pure verdict in access.ts over
    // the loaded rows. A draft or a deleted work of a public collection is in
    // none of the three answers; a published, live one is in all of them.
    const pub = await insertRow(cid, { status: "published" });
    const draft = await insertRow(cid, { status: "draft" });
    const del = await insertRow(cid, { status: "published", deleted: true });

    const collection = await loadCollection(cid);
    if (!collection) throw new Error("the fixture collection is missing");

    const visitorList = await json<WireArtwork[]>(
      await listArtworks(undefined),
    );
    const visitorIds = visitorList.map((a) => a.id);

    for (const [id, listed] of [
      [pub, true],
      [draft, false],
      [del, false],
    ] as const) {
      const row = await loadArtworkInCollection(cid, id);
      if (!row) throw new Error("the fixture row is missing");
      const verdict = canSeeArtwork(null, collection, row);
      expect(verdict).toBe(listed);
      expect(visitorIds.includes(id)).toBe(verdict);
      expect((await getArtwork(id)).status).toBe(verdict ? 200 : 404);
    }
  });

  it("403s a visitor's list on a private collection", async () => {
    await insertRow(privateCid, { status: "published" });
    const res = await req("GET", `/api/v1/collections/${privateCid}/artworks`);
    expect(res.status).toBe(403);
    const err = await json<WireError>(res);
    expect(err.error.code).toBe("forbidden");
  });

  it("hides a published work inside a private collection from a stranger and an anonymous reader", async () => {
    // The case ADR-0003 removes: the collection is the whole gate, so a
    // direct id read no longer reaches a work hidden behind it.
    const aid = await insertRow(privateCid, { status: "published" });
    const path = `/api/v1/collections/${privateCid}/artworks/${aid}`;

    const anon = await req("GET", path);
    expect(anon.status).toBe(404);

    const asVisitor = await req("GET", path, { cookies: visitor.cookies });
    expect(asVisitor.status).toBe(404);

    const asOwner = await req("GET", path, { cookies: owner.cookies });
    expect(asOwner.status).toBe(200);
    expect((await json<WireArtwork>(asOwner)).id).toBe(aid);
  });

  it("404s a visitor on a draft or deleted work; the owner still reads the deleted one", async () => {
    const draft = await insertRow(cid, { status: "draft" });
    const draftRes = await req(
      "GET",
      `/api/v1/collections/${cid}/artworks/${draft}`,
    );
    expect(draftRes.status).toBe(404);

    const del = await insertRow(cid, { deleted: true });
    expect(
      (await req("GET", `/api/v1/collections/${cid}/artworks/${del}`)).status,
    ).toBe(404);

    const asOwner = await getArtwork(del, owner.cookies);
    expect(asOwner.status).toBe(200);
    const body = await json<WireArtwork>(asOwner);
    expect(body.deletedAt).not.toBeNull();
    expect(Object.keys(body.deletedAt as object).sort()).toEqual([
      "nanoseconds",
      "seconds",
    ]);
  });

  it("404s an artwork addressed under the wrong collection", async () => {
    const otherCid = await makeCollection(owner.userId, { isPublic: true });
    const aid = uuid();
    expect(
      (
        await createArtwork({
          artworkId: aid,
          title: "T",
          artistName: "C. Cas",
        })
      ).status,
    ).toBe(201);
    const res = await req(
      "GET",
      `/api/v1/collections/${otherCid}/artworks/${aid}`,
      { cookies: owner.cookies },
    );
    expect(res.status).toBe(404);
  });

  it("401s an unauthenticated write", async () => {
    const res = await req("POST", `/api/v1/collections/${cid}/artworks`, {
      body: JSON.stringify({
        artworkId: uuid(),
        title: "T",
        artistName: "C. Cas",
      }),
    });
    expect(res.status).toBe(401);
    const err = await json<WireError>(res);
    expect(err.error.code).toBe("unauthorized");
  });
});
