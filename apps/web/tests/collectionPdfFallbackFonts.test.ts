import { afterEach, describe, expect, it, vi } from "vitest";

import { loadFallbackFamilies } from "@/components/pdf/fallbackFonts";

afterEach(() => {
  vi.unstubAllGlobals();
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
