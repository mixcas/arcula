import { describe, expect, it } from "vitest";

import {
  publicArtworkState,
  publicCatalogueState,
  publicFailure,
} from "@/components/catalogue/usePublicCatalogue";
import { ApiRequestError } from "@/services/api";
import type { Artwork, Catalogue } from "@arcula/shared";

const CATALOGUE_ID = "catalogue-1";

const catalogue = (overrides: Partial<Catalogue> = {}): Catalogue => ({
  id: CATALOGUE_ID,
  name: "Flores Solares",
  userId: "owner-1",
  isPublic: true,
  ...overrides,
});

const artwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: "artwork-1",
  userId: "owner-1",
  collectionId: CATALOGUE_ID,
  title: "Estudio en rojo",
  artistName: "María López",
  status: "published",
  photos: [],
  documents: [],
  ...overrides,
});

const denied = (): ApiRequestError =>
  new ApiRequestError(403, "forbidden", "Missing or insufficient permissions.");

/** The refusal a Public, Protected catalogue makes to a reader with no
 *  grant: a challenge, carrying the name the lock screen puts on screen. */
const passwordRequired = (catalogueName?: string): ApiRequestError =>
  new ApiRequestError(
    403,
    "password-required",
    "This catalogue is protected",
    undefined,
    catalogueName === undefined ? {} : { collectionName: catalogueName },
  );

describe("publicFailure", () => {
  it("maps a 403 to `private`, and nothing else", () => {
    // A refused read is the API doing its job, not a malfunction. Reporting it
    // as an error both reads badly to a visitor and invites a retry that
    // cannot succeed.
    expect(publicFailure(denied())).toEqual({ status: "private" });
  });

  it("maps a password-required 403 to `locked`, naming the catalogue", () => {
    // The other 403: not a refusal but a challenge, and the one screen that
    // can pass it has to name what is being unlocked (ADR-0005).
    expect(publicFailure(passwordRequired("Flores Solares"))).toEqual({
      status: "locked",
      catalogueName: "Flores Solares",
    });
  });

  it("is still `locked`, without a name, when the refusal carries no usable one", () => {
    // The status comes from the code, which is the decision; the name is
    // copy. A reshaped or absent detail must not turn a challenge into
    // "private" — or into the string "undefined" on screen.
    expect(publicFailure(passwordRequired())).toEqual({ status: "locked" });
    expect(
      publicFailure(
        new ApiRequestError(403, "password-required", "…", undefined, {
          collectionName: 42,
        }),
      ),
    ).toEqual({ status: "locked" });
  });

  it("maps every other failure to `error`", () => {
    for (const error of [
      new ApiRequestError(404, "not-found", "The catalogue does not exist."),
      new ApiRequestError(500, "internal", "Something went wrong"),
      new TypeError("fetch failed"),
      "a bare string",
      undefined,
    ]) {
      expect(publicFailure(error)).toEqual({ status: "error" });
    }
  });
});

describe("publicCatalogueState", () => {
  it("is `notFound` when the catalogue read returned nothing", () => {
    expect(publicCatalogueState(null, [])).toEqual({ status: "notFound" });
  });

  it("is `private` for a readable but unpublished catalogue", () => {
    // Not `notFound`. The catalogue plainly exists, and an owner previewing
    // their own private catalogue lands here too — the rules let them read it.
    // They are told it is private, which is true.
    expect(publicCatalogueState(catalogue({ isPublic: false }), [])).toEqual({
      status: "private",
    });
  });

  it("is `private` for isPublic absent, not merely false", () => {
    // A catalogue written before the field existed reads as private rather
    // than as an error, which is the safe direction.
    expect(
      publicCatalogueState(catalogue({ isPublic: undefined }), []),
    ).toEqual({ status: "private" });
  });

  it("is `ready` with the artworks for a published catalogue", () => {
    const works = [artwork({ id: "b" }), artwork({ id: "a" })];
    const state = publicCatalogueState(catalogue(), works);
    expect(state.status).toBe("ready");
    // Order is passed through, not re-sorted: the caller sorts, because the
    // sort's reason (avoiding a composite index) belongs beside the query.
    if (state.status === "ready") {
      expect(state.value.artworks.map((a) => a.id)).toEqual(["b", "a"]);
    }
  });

  it("coalesces a null artwork list rather than leaking the sequencing", () => {
    // `artworks: null` means the second read never happened. The ready branch
    // still has to produce the same shape, or every caller would have to handle
    // a third possibility.
    const state = publicCatalogueState(catalogue(), null);
    expect(state).toEqual({
      status: "ready",
      value: { catalogue: catalogue(), artworks: [] },
    });
  });
});

describe("publicArtworkState", () => {
  it("is `ready` with the single artwork", () => {
    const work = artwork();
    expect(publicArtworkState(catalogue(), work, CATALOGUE_ID)).toEqual({
      status: "ready",
      value: { catalogue: catalogue(), artwork: work },
    });
  });

  it("is `notFound` when either read returned nothing", () => {
    expect(publicArtworkState(null, artwork(), CATALOGUE_ID)).toEqual({
      status: "notFound",
    });
    expect(publicArtworkState(catalogue(), null, CATALOGUE_ID)).toEqual({
      status: "notFound",
    });
  });

  it("is `private` for an unpublished catalogue, whatever the artwork is", () => {
    // The catalogue read is the gate, so its answer wins.
    expect(
      publicArtworkState(
        catalogue({ isPublic: false }),
        artwork(),
        CATALOGUE_ID,
      ),
    ).toEqual({ status: "private" });
  });

  it("is `notFound` for a published artwork from a *different* catalogue", () => {
    // Not redundant with the API. The single read serves a work by its own id,
    // and nothing server-side stops one rendering on another catalogue's URL
    // — so this comparison is the whole check.
    expect(
      publicArtworkState(
        catalogue(),
        artwork({ collectionId: "some-other-catalogue" }),
        CATALOGUE_ID,
      ),
    ).toEqual({ status: "notFound" });
  });

  it("does not re-check the artwork's own status", () => {
    // The API already refuses a draft or soft-deleted work with the same 404,
    // so by the time a document arrives here it passed that gate. Asserted
    // because it looks like a gap: re-checking `status` here would be defence
    // in depth with no reachable failure.
    const state = publicArtworkState(
      catalogue(),
      artwork({ status: "draft" }),
      CATALOGUE_ID,
    );
    expect(state.status).toBe("ready");
  });
});
