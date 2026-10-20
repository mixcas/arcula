// The contract speaks **status**: `draft` or `published`. These pin the two
// words and the published default at every seam: the form and its payload, the
// PATCH body, and the wire read.
//
// The collection is the only gate, so there is no per-work visibility field
// left to disagree with it (ADR-0003).

import { describe, expect, it } from "vitest";
import {
  artworkCreateSchema,
  artworkSchema,
  artworkUpdateSchema,
  EMPTY_ARTWORK_FORM,
  fromArtwork,
  toArtworkPayload,
} from "../src/schemas/artwork";
import { artworkReadSchema } from "../src/schemas/document";
import type { Artwork } from "../src/types";

const formValues = {
  ...EMPTY_ARTWORK_FORM,
  title: "Nocturne",
  artistName: "Whistler",
};

const wireArtwork = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  userId: "u1",
  title: "Nocturne",
  artistName: "Whistler",
  documents: [],
  photos: [],
  collectionId: "c1",
  deletedAt: null,
  createdAt: { seconds: 0, nanoseconds: 0 },
  updatedAt: { seconds: 0, nanoseconds: 0 },
  ...overrides,
});

const storedArtwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: "a1",
  userId: "u1",
  collectionId: "c1",
  title: "Nocturne",
  artistName: "Whistler",
  documents: [],
  photos: [],
  ...overrides,
});

describe("the form's status", () => {
  it("a new work starts published", () => {
    expect(
      artworkSchema.parse({ title: "Nocturne", artistName: "Whistler" }).status,
    ).toBe("published");
    expect(toArtworkPayload(formValues).status).toBe("published");
  });

  it("carries an explicit draft through the form and its payload", () => {
    const values = { ...formValues, status: "draft" as const };
    expect(toArtworkPayload(values).status).toBe("draft");
  });

  it("refuses a status that is neither draft nor published", () => {
    expect(
      artworkSchema.safeParse({ ...formValues, status: "archived" }).success,
    ).toBe(false);
  });

  it("reads a stored work with no status as published", () => {
    expect(fromArtwork(storedArtwork()).status).toBe("published");
    expect(fromArtwork(storedArtwork({ status: "draft" })).status).toBe(
      "draft",
    );
  });
});

describe("the status on save payloads", () => {
  it("the create payload defaults it to published", () => {
    const body = artworkCreateSchema.parse({
      ...formValues,
      artworkId: "a1",
    });
    expect(body.status).toBe("published");
  });

  it("a PATCH accepts a status and leaves it alone when absent", () => {
    const base = { title: "Nocturne", artistName: "Whistler" };
    expect(artworkUpdateSchema.parse(base).status).toBeUndefined();
    expect(artworkUpdateSchema.parse({ ...base, status: "draft" }).status).toBe(
      "draft",
    );
  });
});

describe("the status on the wire", () => {
  it("reads a stored status, and an absent one as published", () => {
    expect(artworkReadSchema.parse(wireArtwork()).status).toBe("published");
    expect(
      artworkReadSchema.parse(wireArtwork({ status: "draft" })).status,
    ).toBe("draft");
  });
});
