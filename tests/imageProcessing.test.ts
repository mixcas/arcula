import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JPEG_TYPE,
  WEBP_QUALITY,
  WEBP_TYPE,
  PROBE_SIZE,
  decodeImage,
  probeWebpEncoding,
  probeWithCanvas,
  releaseImage,
  renderVariants,
  supportsWebpEncoding,
} from "@/utils/imageRender";
import { extensionFor, processImages } from "@/utils/imageProcessing";

// Only the four functions the main-thread fallback leans on. Everything else is
// spread through from the real module, so the probe suites below still exercise
// the genuine encoder path — those tests inject a canvas factory and an encoder
// precisely so they do not need a browser, and stubbing `probeWebpEncoding`
// away would defeat the point of having them.
vi.mock("@/utils/imageRender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/utils/imageRender")>()),
  decodeImage: vi.fn(),
  renderVariants: vi.fn(),
  releaseImage: vi.fn(),
  supportsWebpEncoding: vi.fn(),
}));

const blobOfType = (type: string) =>
  new Blob([new Uint8Array([1, 2, 3])], { type });

describe("probeWebpEncoding", () => {
  it("returns true when the encoder really produced WebP", async () => {
    const encode = (type: string) => Promise.resolve(blobOfType(type));
    await expect(probeWebpEncoding(encode)).resolves.toBe(true);
  });

  it("returns false when the encoder substitutes PNG, as Safari does", async () => {
    // The behaviour the HTML spec mandates: an unsupported type is not an
    // error, it is silently replaced. This is the whole reason the probe
    // exists — trusting the request would name a PNG `photo.webp`.
    const encode = (requested: string) =>
      Promise.resolve(
        requested === WEBP_TYPE
          ? blobOfType("image/png")
          : blobOfType(requested),
      );
    await expect(probeWebpEncoding(encode)).resolves.toBe(false);
  });

  it("returns false when the encoder returns null", async () => {
    const encode = () => Promise.resolve(null);
    await expect(probeWebpEncoding(encode)).resolves.toBe(false);
  });

  it("returns false when the canvas throws rather than encoding", async () => {
    const encode = () => Promise.reject(new Error("no canvas"));
    await expect(probeWebpEncoding(encode)).resolves.toBe(false);
  });

  it("asks for WebP at the high-quality setting", async () => {
    const asked: Array<[string, number]> = [];
    await probeWebpEncoding((type, quality) => {
      asked.push([type, quality]);
      return Promise.resolve(blobOfType(type));
    });
    expect(asked).toEqual([[WEBP_TYPE, WEBP_QUALITY]]);
  });
});

/**
 * The probe's own behaviour, which the four tests above never touched.
 *
 * Those all inject the *encoder*, which is the half that was right. The half
 * that was wrong — the canvas it encodes — had no test at all, and it is what
 * decides the format for every upload on the page. A 1x1 canvas that has never
 * been drawn to is a placeholder, and asking it to encode one is asking about
 * the degenerate case rather than the encoder: the probe answers "no WebP",
 * every variant is written `.jpg`, and the app looks like it simply chose
 * JPEG.
 */
describe("probeWithCanvas", () => {
  interface FakeContext {
    fillStyle: string;
    fillRect: (x: number, y: number, w: number, h: number) => void;
    imageSmoothingQuality?: string;
  }

  /** A canvas that records what was done to it before it was encoded. */
  const fakeCanvas = (size: number) => {
    const fills: Array<[number, number, number, number]> = [];
    const context: FakeContext = {
      fillStyle: "",
      fillRect: (...args) => {
        fills.push(args);
      },
    };
    return {
      canvas: {
        width: size,
        height: size,
        getContext: (kind: string) => (kind === "2d" ? context : null),
        convertToBlob: () => Promise.resolve(blobOfType(WEBP_TYPE)),
      },
      fills,
    };
  };

  it("probes a canvas larger than a single pixel", () => {
    // Asserted on the constant rather than through an injected canvas,
    // because the size comes from the real factory. A 1x1 encode is the
    // degenerate case this probe used to ask about.
    expect(PROBE_SIZE).toBeGreaterThan(1);
  });

  it("paints the canvas before encoding it", async () => {
    // A canvas that has never been drawn to is a placeholder canvas, which is
    // exactly what a 1x1 probe encoded. The encoder was never asked a real
    // question, and the answer came back "no WebP".
    const { canvas, fills } = fakeCanvas(PROBE_SIZE);
    await probeWithCanvas(() => canvas)(WEBP_TYPE, WEBP_QUALITY);
    expect(fills).toHaveLength(1);
  });

  it("paints the whole canvas rather than one pixel of it", async () => {
    const { canvas, fills } = fakeCanvas(PROBE_SIZE);
    await probeWithCanvas(() => canvas)(WEBP_TYPE, WEBP_QUALITY);
    expect(fills[0]).toEqual([0, 0, PROBE_SIZE, PROBE_SIZE]);
  });

  it("asks for a 2D context, and reports no WebP if it cannot get one", async () => {
    const asked: string[] = [];
    const canvas = {
      width: 8,
      height: 8,
      getContext: (kind: string) => {
        asked.push(kind);
        return null;
      },
      convertToBlob: () => Promise.resolve(blobOfType(WEBP_TYPE)),
    };

    // Not "WebP is supported" — a browser with no canvas at all cannot encode
    // anything, so the honest answer is no.
    await expect(
      probeWebpEncoding(probeWithCanvas(() => canvas)),
    ).resolves.toBe(false);
    expect(asked).toEqual(["2d"]);
  });

  it("answers from the blob it gets, not the type it asked for", async () => {
    // The whole reason the probe reads the type back. A browser that
    // substitutes rather than failing is indistinguishable from one that
    // encodes WebP unless the blob is inspected.
    const { canvas } = fakeCanvas(8);
    const substituting = {
      ...canvas,
      convertToBlob: () => Promise.resolve(blobOfType("image/png")),
    };
    await expect(
      probeWebpEncoding(probeWithCanvas(() => substituting)),
    ).resolves.toBe(false);
  });

  it("reports no WebP where there is no canvas to encode", async () => {
    await expect(probeWebpEncoding(probeWithCanvas(() => null))).resolves.toBe(
      false,
    );
  });
});

describe("extensionFor", () => {
  it("maps each format to its extension", () => {
    expect(extensionFor(WEBP_TYPE)).toBe("webp");
    expect(extensionFor(JPEG_TYPE)).toBe("jpg");
  });

  it("maps PNG, which only ever appears on an original upload", () => {
    // The encoder never produces a PNG — every generated variant is lossy WebP
    // or JPEG — but an original is stored as the format it already is, so a
    // transparent source keeps its alpha in the archive.
    expect(extensionFor("image/png")).toBe("png");
  });

  it("falls back to bin for anything unmapped", () => {
    expect(extensionFor("image/gif")).toBe("bin");
    expect(extensionFor("")).toBe("bin");
  });

  // No test that every listed format has an extension. It was here as a loop
  // over `[WEBP_TYPE, JPEG_TYPE, "image/png"]`, and two of those three are the
  // map's own keys — so it asserted that a record has the fields it is declared
  // with. The one case worth asserting, PNG, is already the assertion directly
  // above it.
});

/**
 * The worker path, with a stand-in for the worker itself.
 *
 * The point of these is one number. In the worker path the page *cannot* work
 * out the output format for itself — the probe runs over there, in a different
 * global, on a different canvas — so the boolean has to come back with the
 * batch. If it were dropped here, the form would have nothing truthful to
 * report and would fall back on the probe's guess, which is exactly how a
 * browser quietly writing JPEG comes to look like it chose WebP.
 */
describe("the worker path", () => {
  /** What the fake worker should answer with, for the request it is sent. */
  let nextResponse: (request: { id: number }) => unknown = () => ({});

  class FakeWorker {
    private readonly listeners: Array<(event: MessageEvent) => void> = [];

    addEventListener(type: string, fn: (event: MessageEvent) => void): void {
      if (type === "message") {
        this.listeners.push(fn);
      }
    }

    postMessage(request: { id: number }): void {
      // Synchronously, because that is the shape of the real thing for a
      // `pending.set` that happens before the post.
      const data = nextResponse(request);
      for (const fn of [...this.listeners]) {
        fn({ data } as MessageEvent);
      }
    }
  }

  beforeEach(() => {
    // The orchestrator caches its worker in a module-level variable, so a fresh
    // import per test is the only way to get a fresh one.
    vi.resetModules();
    nextResponse = () => ({});
    vi.stubGlobal("Worker", FakeWorker);
    vi.stubGlobal("OffscreenCanvas", class {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports the format the worker wrote, not the one that was requested", async () => {
    const { processImages } = await import("@/utils/imageProcessing");
    const file = new File([new Uint8Array([1])], "a.jpg", {
      type: "image/jpeg",
    });

    // The interesting case: WebP was asked for and JPEG is what came back.
    // The caller is told the truth, so it can say so.
    nextResponse = (request) => ({
      id: request.id,
      kind: "result",
      webp: false,
      items: [
        {
          file,
          width: 2000,
          height: 1500,
          variants: [
            {
              key: "square_lg",
              blob: new Blob([new Uint8Array([2])]),
              width: 800,
              height: 800,
              contentType: "image/jpeg",
            },
          ],
        },
      ],
    });

    const results = await processImages([file]);
    expect(results[0]?.webp).toBe(false);
    // And the variant keeps the type it actually has, so the object name can
    // never say `.webp` over JPEG bytes.
    expect(results[0]?.variants[0]?.contentType).toBe("image/jpeg");
  });

  it("reports WebP when that is what the worker wrote", async () => {
    const { processImages } = await import("@/utils/imageProcessing");
    const file = new File([new Uint8Array([1])], "a.jpg", {
      type: "image/jpeg",
    });

    nextResponse = (request) => ({
      id: request.id,
      kind: "result",
      webp: true,
      items: [
        {
          file,
          width: 2000,
          height: 1500,
          variants: [
            {
              key: "square_lg",
              blob: new Blob([new Uint8Array([2])]),
              width: 800,
              height: 800,
              contentType: "image/webp",
            },
          ],
        },
      ],
    });

    const results = await processImages([file]);
    expect(results[0]?.webp).toBe(true);
  });

  it("takes the format from the worker's own probe", async () => {
    const { variantFormatIsWebp } = await import("@/utils/imageProcessing");
    nextResponse = (request) => ({
      id: request.id,
      kind: "probeResult",
      webp: true,
    });
    await expect(variantFormatIsWebp()).resolves.toBe(true);
  });

  it("answers the probe with JPEG when the worker cannot be reached", async () => {
    const { variantFormatIsWebp } = await import("@/utils/imageProcessing");
    // A worker that never replies would otherwise hang the form's first paint
    // forever, so a failed probe has to be an answer.
    nextResponse = (request) => ({
      id: request.id,
      kind: "error",
      message: "no worker",
    });
    await expect(variantFormatIsWebp()).resolves.toBe(false);
  });
});

/**
 * The main-thread fallback — which, in this environment, is the default.
 *
 * Both jsdom and node lack `Worker` and `OffscreenCanvas`, so `workerAvailable()`
 * is false here and every unstubbed `processImages` call takes the fallback. That
 * makes this the honest way to test it: the branch is not a contrived
 * arrangement injected for the tests, it is the branch this file runs by default,
 * and the stubbing above has to remove the worker's advantage deliberately.
 *
 * What is under test is the orchestrator's own decisions — where it routes, what
 * it stamps on the results, what order it pairs files in, and what it releases.
 * How a variant is actually drawn and encoded is `imageRender`'s business, and
 * is covered in `tests/imageVariants.test.ts`.
 */
describe("the main-thread fallback", () => {
  /** A picked photo, which is all `decodeImage` is ever handed. */
  const photoFile = (name: string) =>
    new File([new Uint8Array([1])], name, { type: "image/jpeg" });

  /**
   * A stand-in for a decoded bitmap.
   *
   * `Drawable` is `ImageBitmap | HTMLImageElement`, neither of which jsdom can
   * construct, and `releaseImage` is stubbed — so all that matters is that each
   * decode hands back a distinguishable object, so the release assertions can
   * prove *which* bitmaps were closed rather than merely how many.
   */
  const bitmap = (size: number) =>
    ({ width: size, height: size }) as unknown as ImageBitmap;

  beforeEach(() => {
    // No `resetModules` here, and none is needed: the fallback path keeps no
    // module state. `resolveWebpSupport` skips its cache when there is no worker
    // and probes directly, and `worker` and `pending` stay untouched. That is
    // the opposite of the worker path, which caches a worker in a module-level
    // variable and so needs a fresh import per test.
    vi.mocked(decodeImage).mockReset().mockResolvedValue(bitmap(4000));
    vi.mocked(renderVariants).mockReset().mockResolvedValue([]);
    vi.mocked(releaseImage).mockReset();
    vi.mocked(supportsWebpEncoding).mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes on the main thread when the environment has neither capability", async () => {
    // The default state, asserted rather than assumed: if a future test
    // environment gains a real `Worker`, this stops being the fallback and
    // every test below would quietly pass for the wrong reason.
    expect(typeof Worker).toBe("undefined");
    expect(typeof OffscreenCanvas).toBe("undefined");

    const file = photoFile("a.jpg");
    await processImages([file]);

    expect(decodeImage).toHaveBeenCalledWith(file);
    expect(renderVariants).toHaveBeenCalledTimes(1);
  });

  it("still falls back when a Worker exists but OffscreenCanvas does not", async () => {
    // The two capabilities are checked with `&&`, and this is the half that
    // would be wrong as `||`. A `Worker` is no use on its own: every variant
    // is drawn on an `OffscreenCanvas`, so an environment with one and not the
    // other cannot encode anything and must take the main-thread path. Getting
    // this backwards would construct a worker, post to it, and never resolve —
    // the form's first paint hangs with no error.
    vi.stubGlobal("Worker", class {});
    expect(typeof OffscreenCanvas).toBe("undefined");

    await processImages([photoFile("a.jpg")]);

    expect(renderVariants).toHaveBeenCalledTimes(1);
  });

  it("stamps the probed format on the results, and hands it to the encoder", async () => {
    // Both halves of one claim. Stamping the result is what the form displays;
    // passing the same value into `renderVariants` is what actually decides the
    // bytes. Asserting only the first would pass against a bug that labels every
    // image `.webp` while writing JPEG — the exact mismatch the extension is
    // read back off the blob to prevent.
    vi.mocked(supportsWebpEncoding).mockResolvedValue(false);
    const [jpeg] = await processImages([photoFile("a.jpg")]);
    expect(jpeg?.webp).toBe(false);
    expect(vi.mocked(renderVariants).mock.calls[0]?.[1]).toBe(false);

    vi.mocked(renderVariants).mockClear();
    vi.mocked(supportsWebpEncoding).mockResolvedValue(true);
    const [webp] = await processImages([photoFile("b.jpg")]);
    expect(webp?.webp).toBe(true);
    expect(vi.mocked(renderVariants).mock.calls[0]?.[1]).toBe(true);
  });

  it("pairs each result with its own file and dimensions, in order", async () => {
    // Order is a contract the worker path also has to keep, because it re-maps
    // the batch against the input by index. Getting it wrong does not throw — a
    // photo's variants land on the neighbouring photo, and every thumbnail in a
    // ten-photo artwork is subtly the wrong image.
    const files = [photoFile("a.jpg"), photoFile("b.jpg")];
    vi.mocked(decodeImage)
      .mockResolvedValueOnce(bitmap(4000))
      .mockResolvedValueOnce(bitmap(100));

    const results = await processImages(files);

    expect(results.map((result) => result.file)).toEqual(files);
    expect(results.map((result) => result.width)).toEqual([4000, 100]);
  });

  it("reports progress per file, with the total it was given", async () => {
    // Once per file rather than once per variant: one file's four variants
    // encode in well under a second, ten files do not, and a progress bar that
    // only moves every 400ms is a progress bar nobody can read.
    const progress: Array<[number, number]> = [];

    await processImages(
      [photoFile("a.jpg"), photoFile("b.jpg")],
      (done, total) => progress.push([done, total]),
    );

    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });

  it("closes every bitmap it decoded", async () => {
    // The memory invariant, and the reason `releaseImage` is called at all:
    // ten unclosed 12-megapixel `ImageBitmap`s is roughly 360 MB. Which bitmaps
    // were closed is the point — a release of the wrong object leaks just as
    // surely as no release at all.
    const decoded = [bitmap(4000), bitmap(100)];
    vi.mocked(decodeImage)
      .mockResolvedValueOnce(decoded[0])
      .mockResolvedValueOnce(decoded[1]);

    await processImages([photoFile("a.jpg"), photoFile("b.jpg")]);

    expect(
      vi.mocked(releaseImage).mock.calls.map(([source]) => source),
    ).toEqual(decoded);
  });

  it("closes the bitmap even when encoding throws", async () => {
    // The `finally`, which is the whole reason the release is in one. A decode
    // that throws partway through a batch — one corrupt file, one canvas that
    // will not allocate — would otherwise strand every bitmap decoded before
    // it, and the failure is exactly when the browser is already under memory
    // pressure.
    const decoded = bitmap(4000);
    vi.mocked(decodeImage).mockResolvedValueOnce(decoded);
    vi.mocked(renderVariants).mockRejectedValueOnce(new Error("no canvas"));

    await expect(processImages([photoFile("a.jpg")])).rejects.toThrow(
      "no canvas",
    );
    expect(releaseImage).toHaveBeenCalledWith(decoded);
  });

  it("probes once for a whole batch", async () => {
    // Probed before the loop, so ten photos cost one encode rather than ten.
    // Small — an 8x8 fill — but it is on the critical path of the form's first
    // paint, and per-file would multiply it by the batch size.
    await processImages([
      photoFile("a.jpg"),
      photoFile("b.jpg"),
      photoFile("c.jpg"),
    ]);

    expect(supportsWebpEncoding).toHaveBeenCalledTimes(1);
  });
});
