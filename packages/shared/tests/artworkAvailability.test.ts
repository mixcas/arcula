// A work's market state on a Portfolio or an Inventory: the four words, the
// nullable form field, and the two save payloads. The kind decides whether the
// form surfaces it; the contract carries it on every work and every member
// read, which is what makes the API a superset (ADR-0010).

import { describe, expect, it } from "vitest";
import {
  artworkAvailabilitySchema,
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

const storedArtwork = (overrides: Partial<Artwork> = {}): Artwork => ({
  id: "a1",
  userId: "u1",
  catalogueId: "c1",
  title: "Nocturne",
  artistName: "Whistler",
  documents: [],
  photos: [],
  ...overrides,
});

const wireArtwork = (overrides: Record<string, unknown> = {}) => ({
  id: "a1",
  userId: "u1",
  title: "Nocturne",
  artistName: "Whistler",
  documents: [],
  photos: [],
  catalogueId: "c1",
  availability: null,
  deletedAt: null,
  createdAt: { seconds: 0, nanoseconds: 0 },
  updatedAt: { seconds: 0, nanoseconds: 0 },
  ...overrides,
});

describe("the four words a market state may be", () => {
  it.each(["available", "reserved", "sold", "on-consignment"])(
    "accepts %s",
    (value) => {
      expect(artworkAvailabilitySchema.parse(value)).toBe(value);
    },
  );

  it("refuses a word outside the four", () => {
    expect(artworkAvailabilitySchema.safeParse("for-sale").success).toBe(false);
  });
});

describe("the form's availability", () => {
  it("a new work starts with no market state", () => {
    expect(EMPTY_ARTWORK_FORM.availability).toBeNull();
  });

  it("carries a chosen state into the payload", () => {
    expect(
      toArtworkPayload({ ...formValues, availability: "on-consignment" })
        .availability,
    ).toBe("on-consignment");
  });

  it("reads a stored state, and an absent one as null", () => {
    expect(
      fromArtwork(storedArtwork({ availability: "sold" })).availability,
    ).toBe("sold");
    expect(fromArtwork(storedArtwork()).availability).toBeNull();
    expect(
      fromArtwork(storedArtwork({ availability: null })).availability,
    ).toBe(null);
  });
});

describe("availability on the save payloads", () => {
  it("a create accepts a state and leaves it unset when absent", () => {
    expect(
      artworkCreateSchema.parse({
        ...formValues,
        availability: "reserved",
        artworkId: "a1",
      }).availability,
    ).toBe("reserved");
    expect(
      artworkCreateSchema.parse({
        title: "Nocturne",
        artistName: "Whistler",
        artworkId: "a1",
      }).availability,
    ).toBeUndefined();
  });

  it("a PATCH sets a state, clears it with null, and leaves it alone when absent", () => {
    const base = { title: "Nocturne", artistName: "Whistler" };
    expect(artworkUpdateSchema.parse(base).availability).toBeUndefined();
    expect(
      artworkUpdateSchema.parse({ ...base, availability: "available" })
        .availability,
    ).toBe("available");
    expect(
      artworkUpdateSchema.parse({ ...base, availability: null }).availability,
    ).toBeNull();
  });

  it("the form schema refuses a state outside the four", () => {
    expect(
      artworkSchema.safeParse({ ...formValues, availability: "for-sale" })
        .success,
    ).toBe(false);
  });
});

describe("availability on the wire", () => {
  it("carries null or one of the four on a member read", () => {
    expect(artworkReadSchema.parse(wireArtwork()).availability).toBeNull();
    expect(
      artworkReadSchema.parse(wireArtwork({ availability: "sold" }))
        .availability,
    ).toBe("sold");
  });

  it("accepts a visitor read, which omits the key", () => {
    // The serializer emits the key on a member read only, so a document
    // without it is the visitor's normal shape, not a reshaped one.
    const { availability: _omitted, ...withoutKey } = wireArtwork();
    expect(artworkReadSchema.safeParse(withoutKey).success).toBe(true);
  });
});
