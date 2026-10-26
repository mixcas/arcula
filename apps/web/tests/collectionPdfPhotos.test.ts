import { describe, expect, it, vi } from "vitest";

import {
  CollectionPdfAccessError,
  type AccessOutcome,
} from "@/components/pdf/collectionPdfAccess";
import { buildCollectionPdfPlan } from "@/components/pdf/collectionPdfPlan";
import {
  convertPhoto,
  MediaRefusal,
  preparePhotos,
  scheduledPhotos,
  scheduledPhotoSource,
  type ConvertedPhoto,
  type PhotoConversionEnv,
  type PhotoConverter,
  type PhotoSurface,
} from "@/components/pdf/photoPipeline";
import type { PixelSize } from "@/components/pdf/collectionPdfPreflight";
import type { Artwork, ArtworkPhoto } from "@arcula/shared";

const variant = (
  id: string,
  key: "xxlarge" | "xlarge",
  width: number,
  height: number,
) => ({
  key,
  url: `/media/${id}/${key}`,
  width,
  height,
  size: 10,
  contentType: "image/webp",
});

const photo = (id: string, order = 0): ArtworkPhoto => ({
  id,
  order,
  name: `${id}.jpg`,
  size: 100,
  contentType: "image/jpeg",
  width: 10,
  height: 10,
  original: {
    url: `/media/${id}/original`,
    size: 100,
    contentType: "image/jpeg",
  },
  variants: [
    variant(id, "xxlarge", 3000, 2250),
    variant(id, "xlarge", 2400, 1800),
  ],
});

const artwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: "artwork-1",
  userId: "owner-1",
  collectionId: "collection-1",
  title: "Untitled",
  artistName: "Unknown",
  photos: [],
  documents: [],
  ...overrides,
});

const converted = (): ConvertedPhoto => ({
  blob: new Blob(["jpeg"], { type: "image/jpeg" }),
  pixels: { width: 10, height: 10 },
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("scheduledPhotoSource", () => {
  it("uses the xxlarge variant and its recorded pixels", () => {
    // 3000 x 2250 covers the box (2100 x 2417) on its long side; the recorded
    // size is what the decoder is asked for, so it travels with the URL.
    expect(scheduledPhotoSource(photo("one"))).toEqual({
      url: "/media/one/xxlarge",
      pixels: { width: 3000, height: 2250 },
    });
  });

  it("falls back to xlarge for a photo uploaded before xxlarge existed", () => {
    const legacy: ArtworkPhoto = {
      ...photo("one"),
      variants: [variant("one", "xlarge", 2400, 1800)],
    };

    expect(scheduledPhotoSource(legacy)).toEqual({
      url: "/media/one/xlarge",
      pixels: { width: 2400, height: 1800 },
    });
  });

  it("falls back to the original, with the photo's own size, when there is neither", () => {
    const bare: ArtworkPhoto = { ...photo("one"), variants: [] };

    expect(scheduledPhotoSource(bare)).toEqual({
      url: "/media/one/original",
      pixels: { width: 10, height: 10 },
    });
  });

  it("is null when the photo has no object at all", () => {
    const empty: ArtworkPhoto = {
      ...photo("one"),
      variants: [],
      original: { url: "", size: 0, contentType: "" },
    };

    expect(scheduledPhotoSource(empty)).toBeNull();
    expect(scheduledPhotoSource(null)).toBeNull();
  });
});

describe("scheduledPhotos", () => {
  it("lists each photo page's photo once, in document order", () => {
    const plan = buildCollectionPdfPlan([
      artwork({
        id: "b",
        artistName: "Bea",
        photos: [photo("second", 1), photo("first", 0)],
      }),
      artwork({ id: "a", artistName: "Ana", photos: [photo("third", 0)] }),
    ]);

    expect(scheduledPhotos(plan).map((entry) => entry.id)).toEqual([
      "third",
      "first",
      "second",
    ]);
  });

  it("skips the grid and the empty page", () => {
    expect(scheduledPhotos(buildCollectionPdfPlan([]))).toEqual([]);
    expect(
      scheduledPhotos(buildCollectionPdfPlan([artwork({ id: "grid" })])),
    ).toEqual([]);
  });
});

describe("convertPhoto", () => {
  const okResponse = (): Response =>
    new Response(new Blob(["source"]), { status: 200 });

  /** A surface that records what the pipeline asked it to do. */
  const recordingSurface = (): {
    surface: PhotoSurface;
    calls: string[];
    size: { width: number; height: number };
  } => {
    const calls: string[] = [];
    const size = { width: 0, height: 0 };
    return {
      calls,
      size,
      surface: {
        fill: (color) => calls.push(`fill:${color}`),
        draw: () => calls.push("draw"),
        encode: (type, quality) => {
          calls.push(`encode:${type}:${quality}`);
          return Promise.resolve(new Blob(["jpeg"], { type }));
        },
      },
    };
  };

  const envWith = (overrides: Partial<PhotoConversionEnv> = {}) => {
    const bitmap = { width: 3250, height: 4326, close: vi.fn() };
    const recording = recordingSurface();
    const fetchMock = vi.fn(() => Promise.resolve(okResponse()));
    const decodeTargets: Array<PixelSize | undefined> = [];
    const env: PhotoConversionEnv = {
      fetch: fetchMock,
      decode: (_blob, target) => {
        decodeTargets.push(target);
        return Promise.resolve(bitmap);
      },
      surface: (width: number, height: number) => {
        recording.size.width = width;
        recording.size.height = height;
        return recording.surface;
      },
      ...overrides,
    };
    return { env, fetchMock, bitmap, recording, decodeTargets };
  };

  it("fetches the photo same-origin, carrying the access grant and the signal", async () => {
    const { env, fetchMock } = envWith();
    const controller = new AbortController();

    await convertPhoto(photo("one"), controller.signal, env);

    expect(fetchMock).toHaveBeenCalledWith("/media/one/xxlarge", {
      credentials: "same-origin",
      signal: controller.signal,
    });
  });

  it("asks the decoder for the print box, not for the source's size", async () => {
    // The memory bound: a 3000 x 2250 xxlarge fitted into 2100 x 2417 is
    // 2100 x 1575, and decoding to it is what keeps four conversions in flight
    // from allocating four sources. A decoder asked for the source would pass
    // this test too, so the assertion is on the target it was handed.
    const { env, decodeTargets } = envWith();

    await convertPhoto(photo("one"), undefined, env);

    expect(decodeTargets).toEqual([{ width: 2100, height: 1575 }]);
  });

  it("draws at the box-fitted size the wire records", async () => {
    const { env, recording } = envWith();

    const result = await convertPhoto(photo("one"), undefined, env);

    expect(recording.size).toEqual({ width: 2100, height: 1575 });
    expect(result.pixels).toEqual({ width: 2100, height: 1575 });
  });

  it("fits the decoded bitmap when the wire records no size", async () => {
    // A record written before dimensions were kept: the decoder cannot be
    // told a target, so the fit happens after the decode — same picture,
    // larger peak.
    const unsized: ArtworkPhoto = {
      ...photo("one"),
      variants: [variant("one", "xxlarge", 0, 0)],
    };
    const { env, decodeTargets, recording } = envWith();

    const result = await convertPhoto(unsized, undefined, env);

    expect(decodeTargets).toEqual([undefined]);
    // 3250 x 4326 into 2100 x 2417: the height binds.
    expect(recording.size).toEqual({ width: 1816, height: 2417 });
    expect(result.pixels).toEqual({ width: 1816, height: 2417 });
  });

  it("paints a white ground before the bitmap and encodes JPEG at quality 0.9", async () => {
    const { env, recording } = envWith();

    const result = await convertPhoto(photo("one"), undefined, env);

    // JPEG has no alpha: without the white ground a transparent source
    // prints black, which no screenshot in the viewer would show.
    expect(recording.calls).toEqual([
      "fill:#ffffff",
      "draw",
      "encode:image/jpeg:0.9",
    ]);
    expect(result.blob.type).toBe("image/jpeg");
  });

  it("releases the bitmap as soon as the JPEG is encoded", async () => {
    const { env, bitmap } = envWith();

    await convertPhoto(photo("one"), undefined, env);

    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["fails", new Error("encoder exploded")],
    [
      "is cancelled",
      Object.assign(new Error("cancelled"), { name: "AbortError" }),
    ],
  ])("releases the bitmap when encoding %s", async (_case, failure) => {
    const { env, bitmap, recording } = envWith();
    env.surface = () => {
      recording.surface.encode = () => Promise.reject(failure);
      return recording.surface;
    };

    await expect(convertPhoto(photo("one"), undefined, env)).rejects.toBe(
      failure,
    );
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });

  it("treats a 404 and a 403 as a possible access loss", async () => {
    for (const status of [404, 403]) {
      const { env } = envWith({
        fetch: () => Promise.resolve(new Response(null, { status })),
      });

      await expect(
        convertPhoto(photo("one"), undefined, env),
      ).rejects.toBeInstanceOf(MediaRefusal);
    }
  });

  it("treats any other refused status as a broken image", async () => {
    const { env } = envWith({
      fetch: () => Promise.resolve(new Response(null, { status: 500 })),
    });

    await expect(
      convertPhoto(photo("one"), undefined, env),
    ).rejects.not.toBeInstanceOf(MediaRefusal);
  });

  it("does not fetch or re-read for a photo that has no object", async () => {
    const { env, fetchMock } = envWith();
    const bare: ArtworkPhoto = {
      ...photo("one"),
      variants: [],
      original: { url: "", size: 0, contentType: "" },
    };

    // No read refused anything, so this is a broken photo, not lost access.
    await expect(convertPhoto(bare, undefined, env)).rejects.not.toBeInstanceOf(
      MediaRefusal,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("preparePhotos", () => {
  it("never runs more than four conversions at once", async () => {
    const photos = Array.from({ length: 9 }, (_, index) =>
      photo(`photo-${index}`),
    );
    const gate = deferred<void>();
    let inFlight = 0;
    let peak = 0;

    const convert = async (): Promise<ConvertedPhoto> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gate.promise;
      inFlight -= 1;
      return converted();
    };

    const run = preparePhotos(photos, { convert });
    // Every worker runs up to its first await synchronously: nine photos and
    // an unbounded scheduler would start all nine here.
    expect(inFlight).toBe(4);

    gate.resolve();
    await run;
    expect(peak).toBe(4);
  });

  it("leaves a failed conversion out and carries on", async () => {
    const photos = [photo("bad"), photo("good")];
    const convert: PhotoConverter = (entry) =>
      entry.id === "bad"
        ? Promise.reject(new Error("decode failed"))
        : Promise.resolve(converted());

    const results = await preparePhotos(photos, { convert });

    // No entry is what the document draws as the placeholder.
    expect(results.has("bad")).toBe(false);
    expect(results.get("good")).toMatchObject({ pixels: { width: 10 } });
  });

  it("reports progress over every scheduled photo, failed ones included", async () => {
    const photos = [photo("a"), photo("bad"), photo("c")];
    const seen: Array<[number, number]> = [];
    const convert: PhotoConverter = (entry) =>
      entry.id === "bad"
        ? Promise.reject(new Error("decode failed"))
        : Promise.resolve(converted());

    await preparePhotos(photos, {
      convert,
      onProgress: (done, total) => seen.push([done, total]),
    });

    // The opening frame is `0 of N`, then one settlement per photo — a failed
    // photo keeps its placeholder page, so it still counts as finished.
    expect(seen[0]).toEqual([0, 3]);
    expect(seen.at(-1)).toEqual([3, 3]);
    expect(seen.map(([done]) => done)).toEqual([0, 1, 2, 3]);
  });

  it("reports no progress at all when there are no photos", async () => {
    const onProgress = vi.fn();

    await preparePhotos([], { onProgress });

    // The viewer goes straight to rendering; a `0 of 0` frame is not shown.
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("stops and re-locks when the Collection re-read demands a password", async () => {
    const photos = [photo("a"), photo("b"), photo("c")];
    const recheckAccess = vi.fn((): Promise<AccessOutcome> =>
      Promise.resolve({ status: "locked", collectionName: "Flores" }),
    );
    const convert = (): Promise<ConvertedPhoto> =>
      Promise.reject(new MediaRefusal(404));

    const run = preparePhotos(photos, { convert, recheckAccess });

    await expect(run).rejects.toBeInstanceOf(CollectionPdfAccessError);
    // One re-read answers every refusal, however many photos are in flight.
    expect(recheckAccess).toHaveBeenCalledTimes(1);
    await run.catch((error: CollectionPdfAccessError) => {
      expect(error.state).toEqual({
        status: "locked",
        collectionName: "Flores",
      });
    });
  });

  it("asks the Collection again when a later refusal follows a successful re-read", async () => {
    // The first refusal finds the collection readable; the second arrives
    // after that answer and must not inherit it, because the grant can die at
    // any point in a long export.
    const firstReRead = deferred<void>();
    let rechecks = 0;
    const recheckAccess = (): Promise<AccessOutcome> => {
      rechecks += 1;
      const outcome: AccessOutcome =
        rechecks === 1
          ? { status: "continue" }
          : { status: "locked", collectionName: "Flores" };
      return Promise.resolve(outcome).finally(() => {
        if (rechecks === 1) {
          firstReRead.resolve();
        }
      });
    };
    const convert: PhotoConverter = (entry) =>
      entry.id === "a"
        ? Promise.reject(new MediaRefusal(404))
        : firstReRead.promise.then(() => Promise.reject(new MediaRefusal(404)));

    await expect(
      preparePhotos([photo("a"), photo("b")], { convert, recheckAccess }),
    ).rejects.toMatchObject({
      name: "CollectionPdfAccessError",
      state: { status: "locked" },
    });
    expect(rechecks).toBe(2);
  });

  it("stops in the private state when access was lost mid-export", async () => {
    const recheckAccess = (): Promise<AccessOutcome> =>
      Promise.resolve({ status: "private" });
    const convert = (): Promise<ConvertedPhoto> =>
      Promise.reject(new MediaRefusal(403));

    const run = preparePhotos([photo("a")], { convert, recheckAccess });

    await expect(run).rejects.toMatchObject({
      name: "CollectionPdfAccessError",
      state: { status: "private" },
    });
  });

  it("draws a placeholder when the re-read says the object is genuinely missing", async () => {
    const recheckAccess = (): Promise<AccessOutcome> =>
      Promise.resolve({ status: "continue" });
    const convert = (): Promise<ConvertedPhoto> =>
      Promise.reject(new MediaRefusal(404));

    const results = await preparePhotos([photo("a"), photo("b")], {
      convert,
      recheckAccess,
    });

    // Both photos are absent, which is one placeholder page each.
    expect(results.size).toBe(0);
  });

  it("rejects with an AbortError and hands the conversion its signal", async () => {
    const controller = new AbortController();
    const signals: Array<AbortSignal | undefined> = [];
    const convert: PhotoConverter = (_entry, signal) => {
      signals.push(signal);
      controller.abort();
      return Promise.reject(
        Object.assign(new Error("cancelled"), { name: "AbortError" }),
      );
    };

    await expect(
      preparePhotos([photo("a")], { convert, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(signals).toEqual([controller.signal]);
  });
});
