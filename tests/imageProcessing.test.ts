import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EXTENSION_BY_TYPE,
  JPEG_TYPE,
  WEBP_QUALITY,
  WEBP_TYPE,
  PROBE_SIZE,
  probeWebpEncoding,
  probeWithCanvas,
} from "@/utils/imageRender";
import { extensionFor } from "@/utils/imageProcessing";

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

  it("has an extension for every format an upload can be", () => {
    for (const type of [WEBP_TYPE, JPEG_TYPE, "image/png"]) {
      expect(EXTENSION_BY_TYPE[type]).toBeDefined();
    }
  });
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
