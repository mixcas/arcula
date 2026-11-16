// The staged-media routes: presign, process, discard — photos and documents —
// driven in-process with app.request() against the real stack (real Postgres
// rows, real S3 objects, real Sharp), and with a real `fetch` PUT for the
// bytes because that is the browser's half of the hop.
//
// **What a green test here does and does not prove.** The local storage
// stand-in (SeaweedFS) runs anonymous and does not verify presigned
// signatures: it accepts a PUT with a mismatched content type, a tampered
// signature, or no signature at all. So the suite proves the URL our client
// mints is usable, that the headers it answers are the ones that make the
// object store with the declared type and name, and that process re-derives
// the truth from the stored object. The REFUSAL half — real S3 rejecting a
// wrong `content-type` or a missing signed metadata header — is the
// signature's job and is asserted on the URL's signed-header set in
// `storage.test.ts`; it cannot be exercised here.
//
// Catalogues and artworks are inserted directly through drizzle: the resource
// routes that create them have their own suites, and this suite is about the
// staging contract.

import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { closeDb } from "../src/db";
import {
  stagedOriginalPrefix,
  stagedVariantPrefix,
  stagingOriginalKey,
  stagingVariantKey,
} from "../src/media/keys";
import { MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES } from "@arcula/shared";
import { listObjects, putObject } from "../src/storage";
import { API, freshUser, json } from "./helpers/api";
import {
  discardEntry,
  makeArtwork,
  makeCatalogue,
  makeJpeg,
  presignEntry,
  processEntry,
  putEntry,
  stageDocument,
  stagePhoto,
  type PresignedEntry,
} from "./helpers/fixtures";

afterAll(async () => {
  await closeDb();
});

// The two staged originals' keys, named the way the routes name them.
const originalKeyOf = (url: string): string =>
  new URL(url, API).searchParams.get("key") ?? "";

// ---------------------------------------------------------------------------
// Stage: presign
// ---------------------------------------------------------------------------

describe("POST …/photos/stage", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let stranger: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned catalogue and artwork", async () => {
    owner = await freshUser("Media");
    stranger = await freshUser("Media");
    cid = await makeCatalogue(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  it("answers a usable upload target and stores the PUT under the staged key", async () => {
    const bytes = await makeJpeg(400, 300);
    const res = await presignEntry("photos", owner.cookies, cid, aid, {
      entryId: "photo1",
      contentType: "image/jpeg",
      size: bytes.length,
      name: "scan.jpg",
    });
    expect(res.status).toBe(200);
    const target = await json<PresignedEntry>(res);

    expect(target.entryId).toBe("photo1");
    expect(target.method).toBe("PUT");
    // The type is pinned in the headers the client must send, and the name
    // rides the same way (see storage.test.ts for the signed-header proof).
    expect(target.headers["content-type"]).toBe("image/jpeg");
    expect(target.headers["x-amz-meta-name"]).toBe("scan.jpg");
    // The proxy path names the staged original: the form renders the entry
    // before the bytes are processed, and the save addresses it the same way.
    expect(originalKeyOf(target.url)).toBe(
      stagingOriginalKey(owner.userId, cid, aid, "photo1", "jpg"),
    );
    // The expiry is an instant in the future, not the lifetime.
    expect(new Date(target.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const put = await putEntry(target, bytes);
    expect(put.status).toBe(200);

    const originals = await listObjects(
      stagedOriginalPrefix(owner.userId, cid, aid, "photo1"),
    );
    expect(originals).toHaveLength(1);
    expect(originals[0].endsWith("photo1.jpg")).toBe(true);
  });

  it("rejects an unaccepted declared type before anything is stored", async () => {
    const res = await presignEntry("photos", owner.cookies, cid, aid, {
      entryId: "photosvg",
      contentType: "image/svg+xml",
      size: 10,
      name: "evil.svg",
    });
    expect(res.status).toBe(400);
    const body = await json<{ error: { code: string; fields?: object } }>(res);
    expect(body.error.code).toBe("validation");
    // The form surfaces `fields.file`; "unsupported type" is its vocabulary.
    expect(body.error.fields).toMatchObject({ file: "unsupported type" });
    expect(
      await listObjects(
        stagedOriginalPrefix(owner.userId, cid, aid, "photosvg"),
      ),
    ).toHaveLength(0);
  });

  it("rejects a declared size over the cap", async () => {
    const res = await presignEntry("photos", owner.cookies, cid, aid, {
      entryId: "photobig",
      contentType: "image/jpeg",
      size: MAX_IMAGE_BYTES + 1,
      name: "big.jpg",
    });
    expect(res.status).toBe(400);
    const body = await json<{ error: { fields?: object } }>(res);
    expect(body.error.fields).toMatchObject({ file: "too large" });
  });

  it("rejects a malformed declared size as malformed, not as too large", async () => {
    // A byte count of zero or a fraction is not a file that needs shrinking;
    // reporting "too large" would send someone looking for a smaller file.
    for (const size of [0, 1.5, -1]) {
      const res = await presignEntry("photos", owner.cookies, cid, aid, {
        entryId: "photozero",
        contentType: "image/jpeg",
        size,
      });
      expect(res.status, String(size)).toBe(400);
      const body = await json<{ error: { fields?: object } }>(res);
      expect(body.error.fields).toMatchObject({ file: "invalid size" });
    }
  });

  it("requires a valid entryId", async () => {
    for (const entryId of ["", "bad/slash", "a".repeat(65)]) {
      const res = await presignEntry("photos", owner.cookies, cid, aid, {
        entryId,
        contentType: "image/jpeg",
        size: 100,
      });
      expect(res.status, entryId).toBe(400);
    }
  });

  it("requires a session, and refuses a non-member", async () => {
    const anon = await presignEntry("photos", "", cid, aid, {
      entryId: "photonon",
      contentType: "image/jpeg",
      size: 100,
    });
    expect(anon.status).toBe(401);
    expect((await json<{ error: { code: string } }>(anon)).error.code).toBe(
      "unauthorized",
    );

    const strangerRes = await presignEntry(
      "photos",
      stranger.cookies,
      cid,
      aid,
      {
        entryId: "photox",
        contentType: "image/jpeg",
        size: 100,
      },
    );
    expect(strangerRes.status).toBe(403);
    expect(
      (await json<{ error: { code: string } }>(strangerRes)).error.code,
    ).toBe("forbidden");
  });

  it("404s an unknown catalogue; an unknown artwork id still presigns", async () => {
    const badCatalogue = await presignEntry(
      "photos",
      owner.cookies,
      "nope",
      aid,
      {
        entryId: "e",
        contentType: "image/jpeg",
        size: 100,
      },
    );
    expect(badCatalogue.status).toBe(404);

    // Staging does not require the artwork row: the Add flow mints the
    // artwork id and creates the row at save. The artwork segment only has
    // to be id-shaped — its existence is the save route's check.
    const otherCid = await makeCatalogue(owner.userId);
    const unknownArtwork = await presignEntry(
      "photos",
      owner.cookies,
      otherCid,
      "nope",
      { entryId: "e", contentType: "image/jpeg", size: 100 },
    );
    expect(unknownArtwork.status).toBe(200);
    const target = await json<PresignedEntry>(unknownArtwork);
    const bytes = await makeJpeg(10, 10);
    await putEntry(target, bytes);
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

  it("sets up an owned catalogue and artwork", async () => {
    owner = await freshUser("Media");
    cid = await makeCatalogue(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  const PDF = new Uint8Array([
    ...[0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34], // %PDF-1.4
    ...Array.from({ length: 64 }, () => 0),
  ]);

  it("presigns a PDF, and the bytes land under a .pdf key", async () => {
    const target = await json<PresignedEntry>(
      await presignEntry("documents", owner.cookies, cid, aid, {
        entryId: "docpdf",
        contentType: "application/pdf",
        size: PDF.length,
        name: "condition-report.pdf",
      }),
    );
    expect(target.headers["content-type"]).toBe("application/pdf");

    expect((await putEntry(target, PDF)).status).toBe(200);
    const originals = await listObjects(
      stagedOriginalPrefix(owner.userId, cid, aid, "docpdf"),
    );
    expect(originals[0].endsWith("docpdf.pdf")).toBe(true);
  });

  it("enforces the document cap from the declaration", async () => {
    const atCap = await presignEntry("documents", owner.cookies, cid, aid, {
      entryId: "doccap",
      contentType: "application/pdf",
      size: MAX_DOCUMENT_BYTES,
      name: "cap.pdf",
    });
    expect(atCap.status).toBe(200);

    const over = await presignEntry("documents", owner.cookies, cid, aid, {
      entryId: "docover",
      contentType: "application/pdf",
      size: MAX_DOCUMENT_BYTES + 1,
      name: "over.pdf",
    });
    expect(over.status).toBe(400);
    expect(
      (await json<{ error: { fields?: object } }>(over)).error.fields,
    ).toMatchObject({ file: "too large" });
  });

  it("refuses an image/svg+xml document at presign", async () => {
    const res = await presignEntry("documents", owner.cookies, cid, aid, {
      entryId: "docsvg",
      contentType: "image/svg+xml",
      size: 10,
      name: "a.svg",
    });
    expect(res.status).toBe(400);
    expect(
      (await json<{ error: { fields?: object } }>(res)).error.fields,
    ).toMatchObject({ file: "unsupported type" });
  });
});

// ---------------------------------------------------------------------------
// Process: photos
// ---------------------------------------------------------------------------

describe("POST …/photos/process", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let stranger: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned catalogue and artwork", async () => {
    owner = await freshUser("Media");
    stranger = await freshUser("Media");
    cid = await makeCatalogue(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  it("generates all six variants and answers the original's measured metadata", async () => {
    const bytes = await makeJpeg(400, 300);
    await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "pgen",
      new File([bytes], "a.jpg", { type: "image/jpeg" }),
    );

    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "pgen" }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      entryId: string;
      name: string;
      width: number | null;
      height: number | null;
      size: number;
      contentType: string;
      url: string;
      variants: {
        key: string;
        url: string;
        width: number;
        height: number;
        size: number;
        contentType: string;
      }[];
    }>(res);
    expect(body.entryId).toBe("pgen");
    // The name came back off the object's signed metadata — the process body
    // carried only the entry id.
    expect(body.name).toBe("a.jpg");
    // Measured from the stored object, which is the one thing presign never
    // saw. A declaration is a claim; this is the fact.
    expect({ width: body.width, height: body.height }).toEqual({
      width: 400,
      height: 300,
    });
    expect(body.size).toBe(bytes.length);
    expect(body.contentType).toBe("image/jpeg");
    expect(originalKeyOf(body.url)).toBe(
      stagingOriginalKey(owner.userId, cid, aid, "pgen", "jpg"),
    );

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
        stagingVariantKey(owner.userId, cid, aid, "pgen", v.key, "webp"),
      );
      expect(v.size).toBeGreaterThan(0);
    }

    const staged = await listObjects(
      stagedVariantPrefix(owner.userId, cid, aid, "pgen"),
    );
    expect(staged).toHaveLength(6);
    expect(staged.every((k) => k.endsWith(".webp"))).toBe(true);
  });

  it("accepts an object past the payload a multipart stage could carry", async () => {
    // The reason for the whole hop: a Lambda's invocation payload is ~6 MB and
    // a base64 body inflates by a third, so a phone photo used to be refused
    // before Hono read it. Here the bytes go browser → storage and only the
    // declaration touches the API. 5 MB is past that old ceiling and inside
    // the population's cap; the answer's size is the stored object's own.
    const jpeg = await makeJpeg(400, 300);
    const padding = new Uint8Array(5 * 1024 * 1024 - jpeg.length).fill(7);
    const bytes = Uint8Array.from([...jpeg, ...padding]);

    const target = await json<PresignedEntry>(
      await presignEntry("photos", owner.cookies, cid, aid, {
        entryId: "pbig",
        contentType: "image/jpeg",
        size: bytes.length,
        name: "phone.jpg",
      }),
    );
    const put = await putEntry(target, bytes);
    expect(put.status).toBe(200);

    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "pbig" }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      size: number;
      width: number;
      variants: unknown[];
    }>(res);
    expect(body.size).toBe(bytes.length);
    expect(body.width).toBe(400);
    expect(body.variants).toHaveLength(6);
  });

  it("carries a non-ASCII filename through the object's metadata", async () => {
    // A header is not a place for arbitrary UTF-8: the value is percent-encoded
    // into the signed metadata and decoded on the way out, so an accented name
    // survives the hop instead of arriving mangled. Nothing else in the flow
    // touches the name, so this is the only place the pair is proven.
    const bytes = await makeJpeg(50, 40);
    await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "punicode",
      new File([bytes], "résumé d'atelier.jpg", { type: "image/jpeg" }),
    );
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "punicode" }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ name: string }>(res)).name).toBe(
      "résumé d'atelier.jpg",
    );
  });

  it("is idempotent: re-processing overwrites", async () => {
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "pgen" }),
    );
    expect(res.status).toBe(200);
    expect((await json<{ variants: unknown[] }>(res)).variants).toHaveLength(6);
    expect(
      await listObjects(stagedVariantPrefix(owner.userId, cid, aid, "pgen")),
    ).toHaveLength(6);
  });

  it("refuses an object that got bigger than the cap after the presign", async () => {
    // The declaration said "under the cap" and the presigned URL accepted the
    // bytes that followed: presign cannot weigh what it never sees. Process
    // reads the object's own length, so the oversize is caught here. The body
    // is random on purpose — if the size check ran after the decode, this
    // would answer "could not be decoded" instead.
    const target = await json<PresignedEntry>(
      await presignEntry("photos", owner.cookies, cid, aid, {
        entryId: "perrbig",
        contentType: "image/jpeg",
        size: 512,
        name: "big.jpg",
      }),
    );
    await putEntry(target, new Uint8Array(MAX_IMAGE_BYTES + 1));

    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "perrbig" }),
    );
    expect(res.status).toBe(400);
    const body = await json<{ error: { message: string; fields?: object } }>(
      res,
    );
    expect(body.error.message).toContain("too large");
    expect(body.error.fields).toMatchObject({ file: "too large" });
  });

  it("refuses an object whose stored type is outside the allowlist", async () => {
    // A declaration of image/jpeg, then a PUT of HTML: the local stand-in does
    // not verify signatures, so this is exactly the out-of-band object real S3
    // would have refused at the PUT. Process must refuse it too, because the
    // object is what a later read would serve.
    const target = await json<PresignedEntry>(
      await presignEntry("photos", owner.cookies, cid, aid, {
        entryId: "perrtype",
        contentType: "image/jpeg",
        size: 20,
        name: "page.jpg",
      }),
    );
    await putEntry(target, new TextEncoder().encode("<script>x</script>"), {
      ...target.headers,
      "content-type": "text/html",
    });

    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "perrtype" }),
    );
    expect(res.status).toBe(400);
    expect(
      (await json<{ error: { fields?: object } }>(res)).error.fields,
    ).toMatchObject({ file: "unsupported type" });
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

  it("requires a session, refuses a non-member, and 404s an unknown catalogue", async () => {
    const body = JSON.stringify({ entryId: "pgen" });

    const anon = await processEntry("", cid, aid, "photos", body);
    expect(anon.status).toBe(401);
    expect((await json<{ error: { code: string } }>(anon)).error.code).toBe(
      "unauthorized",
    );

    // Membership is asked before the object is touched: a stranger's 403 is
    // not a hint about whether anything was staged.
    const other = await processEntry(
      stranger.cookies,
      cid,
      aid,
      "photos",
      body,
    );
    expect(other.status).toBe(403);
    expect((await json<{ error: { code: string } }>(other)).error.code).toBe(
      "forbidden",
    );

    const missing = await processEntry(
      owner.cookies,
      "nope",
      aid,
      "photos",
      body,
    );
    expect(missing.status).toBe(404);
  });

  it("400s an undecodable staged original", async () => {
    // Seed the staged object directly: a presign would have admitted the type
    // and the size, and only the bytes are wrong.
    const key = `staging/${owner.userId}/${cid}/${aid}/pbad.jpg`;
    await putObject(key, new Uint8Array(256), "image/jpeg");
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "photos",
      JSON.stringify({ entryId: "pbad" }),
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

// ---------------------------------------------------------------------------
// Process: documents
// ---------------------------------------------------------------------------

describe("POST …/documents/process", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned catalogue and artwork", async () => {
    owner = await freshUser("Media");
    cid = await makeCatalogue(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  it("generates the two document variants for an image, with its metadata", async () => {
    const bytes = await makeJpeg(1200, 900);
    await stageDocument(
      owner.cookies,
      cid,
      aid,
      "dimg",
      new File([bytes], "plate.jpg", { type: "image/jpeg" }),
    );
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "documents",
      JSON.stringify({ entryId: "dimg" }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      name: string;
      width: number | null;
      height: number | null;
      size: number;
      variants: { key: string }[];
    }>(res);
    expect(body.variants.map((v) => v.key)).toEqual(["square_sm", "large"]);
    expect(body.name).toBe("plate.jpg");
    expect({ width: body.width, height: body.height }).toEqual({
      width: 1200,
      height: 900,
    });
    expect(body.size).toBe(bytes.length);
  });

  it("processes a PDF to no variants and null dimensions, having still validated it", async () => {
    const PDF = new Uint8Array([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34,
    ]);
    await stageDocument(
      owner.cookies,
      cid,
      aid,
      "dpdf",
      new File([PDF], "r.pdf", { type: "application/pdf" }),
    );
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "documents",
      JSON.stringify({ entryId: "dpdf" }),
    );
    expect(res.status).toBe(200);
    const body = await json<{
      name: string;
      width: number | null;
      height: number | null;
      size: number;
      contentType: string;
      variants: unknown[];
    }>(res);
    expect(body.variants).toEqual([]);
    expect(body.width).toBeNull();
    expect(body.height).toBeNull();
    expect(body.name).toBe("r.pdf");
    expect(body.size).toBe(PDF.length);
    expect(body.contentType).toBe("application/pdf");
  });

  it("refuses a document whose PUT exceeded the document cap", async () => {
    // The declaration said one byte, so presign admitted it; the object that
    // landed is over the cap. The cap is the population's — judged against the
    // route the entry was staged for, not against the type.
    const target = await json<PresignedEntry>(
      await presignEntry("documents", owner.cookies, cid, aid, {
        entryId: "dpdfbig",
        contentType: "application/pdf",
        size: 1,
        name: "huge.pdf",
      }),
    );
    await putEntry(
      target,
      new Uint8Array(MAX_DOCUMENT_BYTES + 1),
      target.headers,
    );
    const res = await processEntry(
      owner.cookies,
      cid,
      aid,
      "documents",
      JSON.stringify({ entryId: "dpdfbig" }),
    );
    expect(res.status).toBe(400);
    expect(
      (await json<{ error: { fields?: object } }>(res)).error.fields,
    ).toMatchObject({ file: "too large" });
  });
});

// ---------------------------------------------------------------------------
// Discard + re-stage
// ---------------------------------------------------------------------------

describe("DELETE …/{population}/{entryId}", () => {
  let owner: Awaited<ReturnType<typeof freshUser>>;
  let cid: string;
  let aid: string;

  it("sets up an owned catalogue and artwork", async () => {
    owner = await freshUser("Media");
    cid = await makeCatalogue(owner.userId);
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
    for (const entryId of ["abc", "abcd"]) {
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
      await listObjects(stagedOriginalPrefix(owner.userId, cid, aid, "abcd")),
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

  it("sets up an owned catalogue and artwork", async () => {
    owner = await freshUser("Media");
    cid = await makeCatalogue(owner.userId);
    aid = await makeArtwork(owner.userId, cid);
  });

  it("a second presign of the same entry leaves exactly one original", async () => {
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

  it("a refused re-declaration leaves the entry that was already staged", async () => {
    // Discarding runs only once the new declaration is admitted: a mistyped
    // re-upload must not destroy the upload that is already there.
    const bytes = await makeJpeg(120, 90);
    await stagePhoto(
      owner.cookies,
      cid,
      aid,
      "keepme",
      new File([bytes], "keep.jpg", { type: "image/jpeg" }),
    );

    const refused = await presignEntry("photos", owner.cookies, cid, aid, {
      entryId: "keepme",
      contentType: "image/svg+xml",
      size: 10,
    });
    expect(refused.status).toBe(400);

    const originals = await listObjects(
      stagedOriginalPrefix(owner.userId, cid, aid, "keepme"),
    );
    expect(originals).toHaveLength(1);
    expect(originals[0].endsWith("keepme.jpg")).toBe(true);
  });
});
