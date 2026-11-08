// @vitest-environment jsdom
// The remembered Artworks manage view, as one total parser over the one stored
// key. No component and no fetch — what a screenshot cannot pin: that a missing
// key, corrupt JSON, a non-object, an unknown version or a partial object all
// answer a complete settings object rather than a half-read one, that a write
// keeps the keys it was not asked to change, and that blocked storage degrades
// to the defaults instead of failing the page.

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_KEY,
  fromArtworksSort,
  parseUserSettings,
  readUserSettings,
  toArtworksSort,
  writeArtworksSort,
  writeArtworksView,
} from "@/userSettings";

// What every reader that cannot get a real answer lands on.
const DEFAULTS = {
  version: 1,
  artworksView: "grid",
  artworksSort: "title-asc",
};

const stored = (): unknown =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");

describe("parseUserSettings", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("answers the defaults for every input that is not our object", () => {
    // Each of these is a real failure mode: no key yet, a torn write, a value
    // some other script left under our key, and a version we do not know —
    // including a v2 whose keys happen to look familiar, which is exactly the
    // case a version gate exists to refuse.
    const bad = [
      null,
      "{not json",
      "[]",
      "42",
      '"grid"',
      JSON.stringify({
        version: 2,
        artworksView: "grid",
        artworksSort: "title-desc",
      }),
    ];
    for (const raw of bad) {
      expect(parseUserSettings(raw)).toEqual(DEFAULTS);
    }
  });

  it("keeps a valid view and sort", () => {
    expect(
      parseUserSettings(
        JSON.stringify({
          version: 1,
          artworksView: "grid",
          artworksSort: "artist-desc",
        }),
      ),
    ).toEqual({
      version: 1,
      artworksView: "grid",
      artworksSort: "artist-desc",
    });
  });

  it("fills a missing or invalid key from the defaults and keeps the rest", () => {
    // A partial object is what a future preference added to the object would
    // read as on an older install; one broken key must not reset the others.
    expect(
      parseUserSettings(JSON.stringify({ version: 1, artworksView: "grid" })),
    ).toEqual({ ...DEFAULTS, artworksView: "grid" });
    for (const artworksSort of ["nope", "size-asc"]) {
      expect(
        parseUserSettings(
          JSON.stringify({ version: 1, artworksView: "grid", artworksSort }),
        ),
      ).toEqual({ ...DEFAULTS, artworksView: "grid" });
    }
    // A view from a vocabulary we do not have is the same as a missing one.
    expect(
      parseUserSettings(
        JSON.stringify({
          version: 1,
          artworksView: "board",
          artworksSort: "title-desc",
        }),
      ),
    ).toEqual({ ...DEFAULTS, artworksSort: "title-desc" });
    expect(
      parseUserSettings(
        JSON.stringify({
          version: 1,
          artworksView: true,
          artworksSort: "artist-asc",
        }),
      ),
    ).toEqual({ ...DEFAULTS, artworksSort: "artist-asc" });
  });
});

describe("readUserSettings / the writes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("reads what a previous visit stored", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        artworksView: "grid",
        artworksSort: "artist-asc",
      }),
    );
    expect(readUserSettings()).toEqual({
      version: 1,
      artworksView: "grid",
      artworksSort: "artist-asc",
    });
  });

  it("merges a write into the stored object instead of replacing it", () => {
    // The view is remembered independently of the sort: writing one must not
    // send the other back to its default, or a collector who chose Grid and
    // then Artist Z-A would lose the first choice on the second click.
    writeArtworksView("grid");
    writeArtworksSort("artist-desc");

    expect(stored()).toEqual({
      version: 1,
      artworksView: "grid",
      artworksSort: "artist-desc",
    });

    writeArtworksView("table");
    expect(stored()).toEqual({
      version: 1,
      artworksView: "table",
      artworksSort: "artist-desc",
    });
  });

  it("writes over a corrupt stored value from a clean slate", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    writeArtworksView("grid");
    expect(stored()).toEqual({ ...DEFAULTS, artworksView: "grid" });
  });

  it("degrades to the defaults when storage cannot be read or written", () => {
    // Safari's private mode throws on access; a full quota throws on write.
    // Neither may fail the page.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readUserSettings()).toEqual(DEFAULTS);

    vi.restoreAllMocks();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    // The write is best effort and returns nothing to report: the in-memory
    // state the caller already holds is this visit's answer.
    expect(() => writeArtworksView("grid")).not.toThrow();
    vi.restoreAllMocks();
    expect(readUserSettings()).toEqual(DEFAULTS);
  });
});

describe("the sort mapping", () => {
  it.each([
    [{ field: "title", direction: "asc" }, "title-asc"],
    [{ field: "title", direction: "desc" }, "title-desc"],
    [{ field: "artistName", direction: "asc" }, "artist-asc"],
    [{ field: "artistName", direction: "desc" }, "artist-desc"],
  ] as const)("maps %o to %s and back", (sort, value) => {
    expect(toArtworksSort(sort)).toBe(value);
    expect(fromArtworksSort(value)).toEqual(sort);
  });
});
