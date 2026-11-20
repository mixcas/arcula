// The public Selection layer's two pure folds.
//
// A page test can show the states rendering, but the decisions themselves are
// worth pinning without a DOM: a private Selection is not rejected client-side
// (a member's preview is legitimate), a `password-required` refusal is a
// challenge that carries the name, and the name is parsed rather than read
// loosely so a reshaped detail cannot render "undefined".
//
// The works are carried exactly as the read answered them. That is not a
// tautology to be tidied away: the server's rule is `position, artworkId`, and
// a client that sorted by title would silently destroy the curator's order —
// which is the content of a Selection.

import { describe, expect, it } from "vitest";

import { ApiRequestError } from "@/services/api";
import {
  publicSelectionArtworkState,
  publicSelectionFailure,
  publicSelectionState,
} from "@/components/catalogue/usePublicSelection";
import type { Artwork, SelectionPublicRead } from "@arcula/shared";

const document = (
  overrides: Partial<SelectionPublicRead> = {},
): SelectionPublicRead => ({
  selection: {
    id: "SSSSSSSSSSSSSSSSSSSS",
    name: "Winter shortlist",
    isPublic: true,
  },
  catalogueName: "Flores Solares",
  ...overrides,
});

const work = (id: string, title: string, status?: "draft" | "published") =>
  ({
    id,
    userId: "UUUUUUUUUUUUUUUUUUUU",
    catalogueId: "CCCCCCCCCCCCCCCCCCCC",
    title,
    artistName: "C. Cas",
    status,
    photos: [],
    documents: [],
  }) satisfies Artwork;

describe("publicSelectionState", () => {
  it("is notFound for a missing, deleted or hidden Selection", () => {
    expect(publicSelectionState(null, [])).toEqual({ status: "notFound" });
  });

  it("is ready for a document, private or not", () => {
    // The API only answers a private Selection to a member, so the page must
    // render it rather than second-guess the server with an `isPublic` gate.
    const privateDocument = document({
      selection: {
        id: "SSSSSSSSSSSSSSSSSSSS",
        name: "Winter shortlist",
        isPublic: false,
      },
    });
    expect(publicSelectionState(privateDocument, [])).toEqual({
      status: "ready",
      value: { selection: privateDocument, artworks: [] },
    });
  });

  it("carries the works in the order the server answered, Drafts included", () => {
    // Deliberately anti-title-order (Bravo before Alpha) and with a Draft:
    // the fold must not sort, filter or re-status them.
    const artworks = [
      work("WWWWWWWWWWWWWWWWWWW2", "Bravo", "draft"),
      work("WWWWWWWWWWWWWWWWWWW1", "Alpha", "published"),
    ];
    expect(publicSelectionState(document(), artworks)).toEqual({
      status: "ready",
      value: { selection: document(), artworks },
    });
  });
});

describe("publicSelectionArtworkState", () => {
  const one = work("WWWWWWWWWWWWWWWWWWW1", "Alpha", "draft");

  it("is ready for the Selection and its one work, whatever the work's status", () => {
    const pair = { selection: document(), artwork: one };
    expect(publicSelectionArtworkState(pair.selection, one)).toEqual({
      status: "ready",
      value: pair,
    });
  });

  it("is one not-found for a refused Selection and for a work it does not curate", () => {
    // The route folds every refusal to 404, so the fold cannot tell them apart
    // — which is the point: no address confirms what is hidden.
    expect(publicSelectionArtworkState(null, one)).toEqual({
      status: "notFound",
    });
    expect(publicSelectionArtworkState(document(), null)).toEqual({
      status: "notFound",
    });
  });
});

describe("publicSelectionFailure", () => {
  it("folds a password-required refusal into a named lock", () => {
    const error = new ApiRequestError(
      403,
      "password-required",
      "This selection is protected",
      undefined,
      { selectionName: "Winter shortlist" },
    );
    expect(publicSelectionFailure(error)).toEqual({
      status: "locked",
      selectionName: "Winter shortlist",
    });
  });

  it("keeps a generic lock when the detail is absent or reshaped", () => {
    // Parsed, never read loosely: a reshaped detail leaves the generic line
    // rather than putting the string "undefined" on screen.
    for (const details of [undefined, { catalogueName: "Wrong noun" }]) {
      const error = new ApiRequestError(
        403,
        "password-required",
        "This selection is protected",
        undefined,
        details,
      );
      expect(publicSelectionFailure(error)).toEqual({ status: "locked" });
    }
  });

  it("treats a plain forbidden as private and anything else as an error", () => {
    expect(
      publicSelectionFailure(
        new ApiRequestError(403, "forbidden", "This selection is private"),
      ),
    ).toEqual({ status: "private" });
    expect(publicSelectionFailure(new TypeError("fetch failed"))).toEqual({
      status: "error",
    });
    expect(
      publicSelectionFailure(
        new ApiRequestError(500, "internal", "Something went wrong"),
      ),
    ).toEqual({ status: "error" });
  });
});
