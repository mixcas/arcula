// The staged-media routes: stage, process, discard — photos and
// documents — driven in-process with app.request() against the real
// stack (real Postgres rows, real S3 objects, real Sharp).
//
// Collections and artworks are inserted directly through drizzle: the
// resource routes that create them have their own suites, and this suite
// is about the staging contract.

import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { app } from "../src/app";
import { closeDb } from "../src/db";
import {
  stagedOriginalPrefix,
  stagedVariantPrefix,
  stagingOriginalKey,
  stagingVariantKey,
} from "../src/media/keys";
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES } from "@arcula/shared";
import { listObjects, putObject } from "../src/storage";
import { API, ORIGIN, freshUser, json } from "./helpers/api";
import {
  discardEntry,
  makeArtwork,
  makeCollection,
  makeJpeg,
  processEntry,
  stageDocument,
  stagePhoto,
} from "./helpers/fixtures";

afterAll(async () => {
  await closeDb();
});

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

describe("POST …/photos/stage", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let stranger: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned collection and artwork", async () => {
    owner = await freshUser("Media");
    stranger = await freshUser("Media");
    cid = await makeCollection(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  it("stores the original under the staged key and answers with its metadata", async () => {
    const bytes = await makeJpeg(400, 300);
    const res = await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "photo-1",
      new File([bytes], "scan.jpg", { type: "image/jpeg" }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      entryId: string;
      name: string;
      width: number;
      height: number;
      size: number;
      contentType: string;
      url: string;
    }>(res);
    expect(body.entryId).toBe("photo-1");
    expect(body.name).toBe("scan.jpg");
    expect({ width: body.width, height: body.height }).toEqual({
      width: 400,
      height: 300,
    });
    expect(body.size).toBe(bytes.length);
    expect(body.contentType).toBe("image/jpeg");
    // mediaUrl percent-encodes the key; the proxy decodes it via
    // c.req.query, so assert the decoded key is exactly the staged one.
    expect(new URL(body.url, API).searchParams.get("key")).toBe(
      stagingOriginalKey(owner.userId, cid, aid, "photo-1", "jpg"),
    );

    const originals = await listObjects(
      stagedOriginalPrefix(owner.userId, cid, aid, "photo-1"),
    );
    expect(originals).toHaveLength(1);
    expect(originals[0].endsWith("photo-1.jpg")).toBe(true);
  });

  it("rejects an unaccepted type before anything is stored", async () => {
    const res = await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "photo-svg",
      new File([new Uint8Array(10)], "evil.svg", { type: "image/svg+xml" }),
    );
    expect(res.status).toBe(400);
    const body = await json<{ error: { code: string; fields?: object } }>(res);
    expect(body.error.code).toBe("validation");
    expect(body.error.fields).toBeDefined();
    expect(
      await listObjects(
        stagedOriginalPrefix(owner.userId, cid, aid, "photo-svg"),
      ),
    ).toHaveLength(0);
  });

  it("rejects an oversized photo with the size message, not the decode one", async () => {
    // Random bytes: if the decode ran before the size check, this would
    // fail with "could not be decoded" instead.
    const res = await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "photo-big",
      new File([new Uint8Array(MAX_IMAGE_BYTES + 1)], "big.jpg", {
        type: "image/jpeg",
      }),
    );
    expect(res.status).toBe(400);
    const body = await json<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe("validation");
    expect(body.error.message).toContain("too large");
  });

  it("rejects an undecodable image", async () => {
    const res = await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "photo-bad",
      new File([new Uint8Array(512)], "not-image.jpg", { type: "image/jpeg" }),
    );
    expect(res.status).toBe(400);
    const body = await json<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe("validation");
    expect(body.error.message).toContain("decoded");
  });

  it("requires a valid entryId", async () => {
    const bytes = await makeJpeg(10, 10);
    for (const entryId of ["", "bad/slash", "a".repeat(65)]) {
      const form = new FormData();
      form.append("entryId", entryId);
      form.append("file", new File([bytes], "x.jpg", { type: "image/jpeg" }));
      const res = await app.request(
        `${API}/api/v1/collections/${cid}/artworks/${aid}/photos/stage`,
        {
          method: "POST",
          headers: { Cookie: owner.cookies, Origin: ORIGIN },
          body: form,
        },
      );
      expect(res.status, entryId).toBe(400);
    }
  });

  it("requires a session, and refuses a non-owner", async () => {
    const bytes = await makeJpeg(10, 10);
    const anon = await app.request(
      `${API}/api/v1/collections/${cid}/artworks/${aid}/photos/stage`,
      { method: "POST", headers: { Origin: ORIGIN }, body: new FormData() },
    );
    expect(anon.status).toBe(401);
    expect((await json<{ error: { code: string } }>(anon)).error.code).toBe(
      "unauthorized",
    );

    const strangerRes = await stagePhoto(
      stranger.cookies,
      cid,
      aid,
      "photo-x",
      new File([bytes], "x.jpg", { type: "image/jpeg" }),
    );
    expect(strangerRes.status).toBe(403);
    expect(
      (await json<{ error: { code: string } }>(strangerRes)).error.code,
    ).toBe("forbidden");
  });

  it("404s an unknown collection; an unknown artwork id still stages", async () => {
    const bytes = await makeJpeg(10, 10);
    const file = new File([bytes], "x.jpg", { type: "image/jpeg" });
    const badCollection = await stagePhoto(
      owner.cookies,
      "nope",
      aid,
      "e",
      file,
    );
    expect(badCollection.status).toBe(404);

    // Staging does not require the artwork row: the Add flow mints the
    // artwork id and creates the row at save. The artwork segment only has
    // to be id-shaped — its existence is the save route's check.
    const otherCid = await makeCollection(owner.userId);
    const unknownArtwork = await stagePhoto(
      owner.cookies,
      otherCid,
      "nope",
      "e",
      file,
    );
    expect(unknownArtwork.status).toBe(200);
    await discardEntry(owner.cookies, otherCid, "nope", "photos", "e");
  });
});

// ---------------------------------------------------------------------------
// Stage: documents
// ---------------------------------------------------------------------------

describe("POST …/documents/stage", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned collection and artwork", async () => {
    owner = await freshUser("Media");
    cid = await makeCollection(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  const PDF = new Uint8Array([
    ...[0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], // %PDF-1.4
    ...Array.from({ length: 64 }, () => 0),
  ]);

  it("stores a PDF with no dimensions", async () => {
    const res = await stageDocument(
      owner.cookies,
      cid,
      aid,
      "doc-pdf",
      new File([PDF], "condition-report.pdf", { type: "application/pdf" }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      width: number | null;
      height: number | null;
      contentType: string;
      url: string;
    }>(res);
    expect(body.width).toBeNull();
    expect(body.height).toBeNull();
    expect(body.contentType).toBe("application/pdf");
    const originals = await listObjects(
      stagedOriginalPrefix(owner.userId, cid, aid, "doc-pdf"),
    );
    expect(originals[0].endsWith("doc-pdf.pdf")).toBe(true);
  });

  it("answers dimensions for an image document", async () => {
    const bytes = await makeJpeg(200, 150);
    const res = await stageDocument(
      owner.cookies,
      cid,
      aid,
      "doc-img",
      new File([bytes], "plate.png", { type: "image/png" }),
    );
    // The declared type names the extension; the bytes are what the
    // pipeline decodes (Sharp sniffs the real format).
    expect(res.status).toBe(200);
    const body = await json<{ width: number; height: number }>(res);
    expect({ width: body.width, height: body.height }).toEqual({
      width: 200,
      height: 150,
    });
  });

  it("enforces the document cap at the boundary", async () => {
    const atCap = new Uint8Array(MAX_DOCUMENT_BYTES);
    const ok = await stageDocument(
      owner.cookies,
      cid,
      aid,
      "doc-cap",
      new File([atCap], "cap.pdf", { type: "application/pdf" }),
    );
    expect(ok.status).toBe(200);

    const over = await stageDocument(
      owner.cookies,
      cid,
      aid,
      "doc-over",
      new File([new Uint8Array(MAX_DOCUMENT_BYTES + 1)], "over.pdf", {
        type: "application/pdf",
      }),
    );
    expect(over.status).toBe(400);
    expect(
      (await json<{ error: { message: string } }>(over)).error.message,
    ).toContain("too large");
  });

  it("refuses an image/svg+xml document", async () => {
    const res = await stageDocument(
      owner.cookies,
      cid,
      aid,
      "doc-svg",
      new File([new Uint8Array(10)], "a.svg", { type: "image/svg+xml" }),
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Process
// ---------------------------------------------------------------------------

describe("POST …/photos/process", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned collection and artwork", async () => {
    owner = await freshUser("Media");
    cid = await makeCollection(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  it("generates all six variants into staging, in spec order", async () => {
    const bytes = await makeJpeg(400, 300);
    await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "p-gen",
      new File([bytes], "a.jpg", { type: "image/jpeg" }),
    );

    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "p-gen" }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      entryId: string;
      variants: {
        key: string;
        url: string;
        width: number;
        height: number;
        size: number;
        contentType: string;
      }[];
    }>(res);
    expect(body.entryId).toBe("p-gen");
    // 400x300 source: the inside fits are all at source scale, the
    // squares cover the box.
    const expected: [string, number, number][] = [
      ["xxlarge", 400, 300],
      ["xlarge", 400, 300],
      ["square_lg", 800, 800],
      ["square_sm", 400, 400],
      ["large", 400, 300],
      ["medium", 400, 300],
    ];
    expect(body.variants.map((v) => [v.key, v.width, v.height])).toEqual(
      expected,
    );
    for (const v of body.variants) {
      expect(v.contentType).toBe("image/webp");
      expect(new URL(v.url, API).searchParams.get("key")).toBe(
        stagingVariantKey(owner.userId, cid, aid, "p-gen", v.key, "webp"),
      );
      expect(v.size).toBeGreaterThan(0);
    }

    const staged = await listObjects(
      stagedVariantPrefix(owner.userId, cid, aid, "p-gen"),
    );
    expect(staged).toHaveLength(6);
    expect(staged.every((k) => k.endsWith(".webp"))).toBe(true);
  });

  it("is idempotent: re-processing overwrites", async () => {
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "p-gen" }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ variants: unknown[] }>(res)).variants).toHaveLength(6);
    expect(
      await listObjects(stagedVariantPrefix(owner.userId, cid, aid, "p-gen")),
    ).toHaveLength(6);
  });

  it("404s a never-staged entry", async () => {
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "never" }),
    );
    expect(res.status).toBe(404);
    expect((await json<{ error: { code: string } }>(res)).error.code).toBe(
      "not-found",
    );
  });

  it("400s an undecodable staged original", async () => {
    // Seed the staged object directly: stage would have refused it.
    const key = `staging/${owner.userId}/${cid}/${aid}/p-bad.jpg`;
    await putObject(key, new Uint8Array(256), "image/jpeg");
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "p-bad" }),
    );
    expect(res.status).toBe(400);
    expect(
      (await json<{ error: { message: string } }>(res)).error.message,
    ).toContain("decoded");
  });

  it("rejects a malformed body", async () => {
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      "{not json",
    );
    expect(res.status).toBe(400);
  });
});

describe("POST …/documents/process", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned collection and artwork", async () => {
    owner = await freshUser("Media");
    cid = await makeCollection(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  it("generates the two document variants for an image", async () => {
    const bytes = await makeJpeg(1200, 900);
    await stageDocument(
      owner.cookies,
      cid,
      aid,
      "d-img",
      new File([bytes], "plate.jpg", { type: "image/jpeg" }),
    );
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "documents",
      JSON.stringify({ entryId: "d-img" }),
    );
    expect(res.status).toBe(200);
    const body = await json<{ variants: { key: string }[] }>(res);
    expect(body.variants.map((v) => v.key)).toEqual(["square_sm", "large"]);
  });

  it("answers no variants for a PDF", async () => {
    const PDF = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
    ]);
    await stageDocument(
      owner.cookies,
      cid,
      aid,
      "d-pdf",
      new File([PDF], "r.pdf", { type: "application/pdf" }),
    );
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "documents",
      JSON.stringify({ entryId: "d-pdf" }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ variants: unknown[] }>(res)).variants).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Discard + re-stage
// ---------------------------------------------------------------------------

describe("DELETE …/{population}/{entryId}", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned collection and artwork", async () => {
    owner = await freshUser("Media");
    cid = await makeCollection(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  it("removes the entry's original and every variant, and is idempotent", async () => {
    const bytes = await makeJpeg(300, 200);
    await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "gone",
      new File([bytes], "g.jpg", { type: "image/jpeg" }),
    );
    await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "gone" }),
    );
    expect(
      (await listObjects(stagedOriginalPrefix(owner.userId, cid, aid, "gone")))
        .length +
        (await listObjects(stagedVariantPrefix(owner.userId, cid, aid, "gone")))
          .length,
    ).toBe(7);

    const res = await discardEntry(owner.cookies, cid, aid, "photos", "gone");
    expect(res.status).toBe(200);
    expect(
      (await json<{ entryId: string; deleted: number }>(res)).deleted,
    ).toBe(7);
    expect(
      await listObjects(stagedOriginalPrefix(owner.userId, cid, aid, "gone")),
    ).toHaveLength(0);
    expect(
      await listObjects(stagedVariantPrefix(owner.userId, cid, aid, "gone")),
    ).toHaveLength(0);

    // Second discard: nothing to do, not an error.
    const again = await discardEntry(owner.cookies, cid, aid, "photos", "gone");
    expect(again.status).toBe(200);
    expect((await json<{ deleted: number }>(again)).deleted).toBe(0);
  });

  it("does not sweep a sibling entry whose id starts with this one's", async () => {
    const bytes = await makeJpeg(300, 200);
    for (const entryId of ["abc", "abc_d"]) {
      await stagePhoto(
        owner.cookies,
        cid,
        aid,
        entryId,
        new File([bytes], "s.jpg", { type: "image/jpeg" }),
      );
    }
    await discardEntry(owner.cookies, cid, aid, "photos", "abc");
    expect(
      await listObjects(stagedOriginalPrefix(owner.userId, cid, aid, "abc")),
    ).toHaveLength(0);
    expect(
      await listObjects(stagedOriginalPrefix(owner.userId, cid, aid, "abc_d")),
    ).toHaveLength(1);
  });

  it("401s without a session", async () => {
    const res = await discardEntry("", cid, aid, "photos", "abc");
    expect(res.status).toBe(401);
  });
});

describe("re-staging replaces", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned collection and artwork", async () => {
    owner = await freshUser("Media");
    cid = await makeCollection(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  it("a second stage of the same entry leaves exactly one original", async () => {
    const jpeg = await makeJpeg(100, 100);
    const png = Uint8Array.from(
      (
        await sharp({
          create: {
            width: 50,
            height: 50,
            channels: 3,
            background: { r: 5, g: 5, b: 200 },
          },
        })
          .png()
          .toBuffer({ resolveWithObject: true })
      ).data,
    );

    await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "reswap",
      new File([jpeg], "a.jpg", { type: "image/jpeg" }),
    );
    await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "reswap" }),
    );
    // Now the same entry, a different format: the previous original and
    // its variants must not survive to be swept into the save.
    await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "reswap",
      new File([png], "a.png", { type: "image/png" }),
    );

    const originals = await listObjects(
      stagedOriginalPrefix(owner.userId, cid, aid, "reswap"),
    );
    expect(originals).toHaveLength(1);
    expect(originals[0].endsWith("reswap.png")).toBe(true);
    expect(
      await listObjects(stagedVariantPrefix(owner.userId, cid, aid, "reswap")),
    ).toHaveLength(0);

    // The fresh original is processable on its own.
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "reswap" }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ variants: unknown[] }>(res)).variants).toHaveLength(6);
  });
});
