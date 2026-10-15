// The S3 primitives against the real stand-in: the local stack is
// the test environment — no MSW, no stubbed object layer.
//
// The keys are random per run, so the suite never collides with what a
// dev server has stored, and its afterAll removes only what it created;
// `db:reset` remains the full clean.

import { afterAll, describe, expect, it } from "vitest";
import {
  copyObject,
  deleteObject,
  headObject,
  isObjectMissing,
  listObjects,
  objectBytes,
  putObject,
} from "../src/storage";
import {
  finalPhotoKey,
  stagingOriginalKey,
  stagingVariantKey,
} from "../src/media/keys";

const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
const USER = `u-${stamp}`;
const CID = `c-${stamp}`;
const AID = `a-${stamp}`;

const created: string[] = [];
function track(key: string): string {
  created.push(key);
  return key;
}

afterAll(async () => {
  for (const key of created) {
    try {
      await deleteObject(key);
    } catch {
      // A sweep failure is not this suite's concern; db:reset cleans up.
    }
  }
});

const BANNER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("put / get / head", () => {
  it("puts and gets the same bytes back, with the recorded content type", async () => {
    const key = track(stagingOriginalKey(USER, CID, AID, "e1", "png"));
    await putObject(key, BANNER, "image/png");

    const head = await headObject(key);
    expect(head.ContentType).toBe("image/png");
    expect(head.ContentLength).toBe(BANNER.byteLength);

    const bytes = await objectBytes(key);
    expect(Array.from(bytes)).toEqual(Array.from(BANNER));
  });

  it("reports a missing object as missing, on get and head", async () => {
    const missing = stagingOriginalKey(USER, CID, AID, "absent", "png");
    await expect(objectBytes(missing)).rejects.toThrow();
    await expect(headObject(missing)).rejects.toThrow();

    for (const op of [
      () => objectBytes(missing).catch((e: unknown) => e),
      () => headObject(missing).catch((e: unknown) => e),
    ]) {
      expect(isObjectMissing(await op())).toBe(true);
    }
  });
});

describe("copy", () => {
  it("copies within the bucket and serves the destination's content type", async () => {
    const from = track(
      stagingVariantKey(USER, CID, AID, "e2", "square_lg", "webp"),
    );
    const to = track(finalPhotoKey(USER, CID, AID, "e2", "square_lg", "webp"));
    await putObject(from, BANNER, "image/webp");

    await copyObject(from, to, "image/webp");

    const head = await headObject(to);
    expect(head.ContentType).toBe("image/webp");
    expect(Array.from(await objectBytes(to))).toEqual(Array.from(BANNER));
  });
});

describe("list / delete", () => {
  it("lists exactly the objects under a prefix, and delete removes", async () => {
    // A dedicated artwork: the copy test above already writes a final
    // object under this suite's `{USER}/{CID}/{AID}/photos/` prefix, and
    // the listing must be exact.
    const listAid = `${AID}-list`;
    const prefix = `artworks/${USER}/${CID}/${listAid}/photos/`;
    const inPrefix = [
      track(finalPhotoKey(USER, CID, listAid, "e3", "original", "jpg")),
      track(finalPhotoKey(USER, CID, listAid, "e3", "medium", "webp")),
      track(finalPhotoKey(USER, CID, listAid, "e4", "medium", "webp")),
    ];
    const elsewhere = track(
      finalPhotoKey(USER, CID, "other-art", "e3", "medium", "webp"),
    );
    for (const key of [...inPrefix, elsewhere]) {
      await putObject(key, BANNER, "image/webp");
    }

    expect(await listObjects(prefix)).toEqual(expect.arrayContaining(inPrefix));
    expect((await listObjects(prefix)).length).toBe(inPrefix.length);

    await deleteObject(inPrefix[0]);
    expect(await listObjects(prefix)).toEqual(
      expect.arrayContaining(inPrefix.slice(1)),
    );
    // Deleting a missing key is a no-op, not an error.
    await expect(deleteObject(inPrefix[0])).resolves.toBeDefined();
  });
});
