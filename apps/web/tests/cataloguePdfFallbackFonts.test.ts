// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { loadFallbackFamilies } from "@/components/pdf/fallbackFonts";

const FALLBACK_PATH = "/api/v1/pdf/font-fallback";

/** The chunk a request carried, read back out of its URL. */
const requestedText = (url: string): string => {
  const [, query = ""] = url.split("?");
  return decodeURIComponent(query.slice("text=".length));
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadFallbackFamilies chunks", () => {
  it("sends the mixed-script chunks in order and registers one family each", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        blob: () => Promise.resolve(new Blob(["font"])),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // é sorts first (U+00E9); the 513 distinct Han characters start at U+4E00,
    // so é plus 511 of them fill chunk one and the last two ride chunk two.
    const han = Array.from({ length: 513 }, (_, index) =>
      String.fromCodePoint(0x4e00 + index),
    ).join("");

    vi.resetModules();
    const { loadFallbackFamilies } =
      await import("@/components/pdf/fallbackFonts");

    const families = await loadFallbackFamilies(["é" + han]);

    const requests = fetchMock.mock.calls.map(([url]) => String(url));

    expect(requests.map((url) => url.split("?")[0])).toEqual([
      FALLBACK_PATH,
      FALLBACK_PATH,
    ]);
    expect(
      requests.every((url) => url.split("?")[1]?.startsWith("text=")),
    ).toBe(true);
    expect(requests.map(requestedText)).toEqual([
      "é" + han.slice(0, 511),
      han.slice(511),
    ]);
    expect(families).toEqual(["Arcula Fallback 1", "Arcula Fallback 2"]);
  });
});

describe("loadFallbackFamilies cancellation", () => {
  it("stops before fetching when the run is already cancelled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadFallbackFamilies(["é"], controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rethrows a cancelled fetch instead of treating it as a font failure", async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        controller.abort();
        return Promise.reject(
          Object.assign(new Error("cancelled"), { name: "AbortError" }),
        );
      }),
    );

    await expect(
      loadFallbackFamilies(["é"], controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
