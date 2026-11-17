// The Artwork fields registry, tier 1: which record fields a Catalogue can
// switch, and the per-Kind defaults it switches them from.
//
// This is the only seam that can pin the three-Kind × twelve-field table
// without one request per cell, so the literal table below is the independent
// source of truth: a default that moves must be changed here on purpose.
// Availability joins the registry in its own ticket and is deliberately absent.

import { describe, expect, it } from "vitest";
import {
  ARTWORK_FIXED_FIELDS,
  ARTWORK_FIELD_DEFAULTS,
  ARTWORK_FIELD_KEYS,
  disabledArtworkFieldsIn,
  normaliseArtworkFields,
  resolveArtworkFields,
  type ArtworkFieldKey,
} from "../src/artworkFields";

const FIELDS: readonly ArtworkFieldKey[] = [
  "serie",
  "dateOfCreation",
  "medium",
  "dimensions",
  "editions",
  "acquisitionDate",
  "acquisitionPrice",
  "placeOfOrigin",
  "provenance",
  "notes",
  "condition",
  "currentValue",
];

const on = (): Record<ArtworkFieldKey, boolean> =>
  Object.fromEntries(FIELDS.map((field) => [field, true])) as Record<
    ArtworkFieldKey,
    boolean
  >;

describe("the registry's field list", () => {
  it("lists the twelve togglable fields in registry order", () => {
    expect([...ARTWORK_FIELD_KEYS]).toEqual(FIELDS);
  });

  it("never offers the two fixed fields or the status as switches", () => {
    // Title and Artist Name are always recorded (the status is the
    // Draft/Published stamp and is not a record field at all).
    expect([...ARTWORK_FIXED_FIELDS]).toEqual(["title", "artistName"]);
    for (const fixed of [...ARTWORK_FIXED_FIELDS, "status", "availability"]) {
      expect(ARTWORK_FIELD_KEYS).not.toContain(fixed);
    }
  });
});

describe("the per-Kind defaults", () => {
  it("pins the exact table: acquisitions off on a Portfolio and an Inventory", () => {
    const everythingOn = on();

    expect(ARTWORK_FIELD_DEFAULTS.portfolio).toEqual({
      ...everythingOn,
      acquisitionDate: false,
      acquisitionPrice: false,
    });
    expect(ARTWORK_FIELD_DEFAULTS.inventory).toEqual({
      ...everythingOn,
      acquisitionDate: false,
      acquisitionPrice: false,
    });
    expect(ARTWORK_FIELD_DEFAULTS.collection).toEqual(everythingOn);
  });
});

describe("resolveArtworkFields", () => {
  it("answers the Kind's defaults for a catalogue that never deviated", () => {
    const resolved = resolveArtworkFields("portfolio", null);

    expect(resolved.enabled).toEqual(ARTWORK_FIELD_DEFAULTS.portfolio);
    expect(resolved.customised).toBe(false);
  });

  it("treats an empty map as pure defaults", () => {
    const resolved = resolveArtworkFields("inventory", {});

    expect(resolved.enabled).toEqual(ARTWORK_FIELD_DEFAULTS.inventory);
    expect(resolved.customised).toBe(false);
  });

  it("lets an explicit true beat a default false", () => {
    const resolved = resolveArtworkFields("portfolio", {
      acquisitionPrice: true,
    });

    expect(resolved.enabled.acquisitionPrice).toBe(true);
    expect(resolved.customised).toBe(true);
  });

  it("lets an explicit false beat a default true", () => {
    const resolved = resolveArtworkFields("collection", { provenance: false });

    expect(resolved.enabled.provenance).toBe(false);
    // Every other field keeps following the Kind.
    expect(resolved.enabled.serie).toBe(true);
    expect(resolved.customised).toBe(true);
  });

  it("is not customised when an entry only restates the Kind's default", () => {
    const resolved = resolveArtworkFields("portfolio", {
      acquisitionDate: false,
      serie: true,
    });

    expect(resolved.enabled).toEqual(ARTWORK_FIELD_DEFAULTS.portfolio);
    expect(resolved.customised).toBe(false);
  });

  it("resolves the same map against the Kind it is given", () => {
    // The same buffer means different things on two Kinds: acquisition
    // defaults are exactly the pair Portfolio and Inventory drop.
    expect(
      resolveArtworkFields("collection", null).enabled.acquisitionDate,
    ).toBe(true);
    expect(
      resolveArtworkFields("inventory", null).enabled.acquisitionDate,
    ).toBe(false);
  });
});

describe("normaliseArtworkFields", () => {
  it("answers null when nothing deviates", () => {
    expect(normaliseArtworkFields("portfolio", {})).toBeNull();
    expect(
      normaliseArtworkFields("inventory", { acquisitionPrice: false }),
    ).toBeNull();
  });

  it("drops the entries equal to the Kind's default and keeps the choices", () => {
    expect(
      normaliseArtworkFields("portfolio", {
        acquisitionPrice: true,
        serie: true,
        acquisitionDate: false,
      }),
    ).toEqual({ acquisitionPrice: true });
  });

  it("keeps an explicit false against a default true", () => {
    expect(normaliseArtworkFields("collection", { notes: false })).toEqual({
      notes: false,
    });
  });
});

describe("disabledArtworkFieldsIn", () => {
  const allOff = (): Record<ArtworkFieldKey, boolean> =>
    Object.fromEntries(FIELDS.map((field) => [field, false])) as Record<
      ArtworkFieldKey,
      boolean
    >;

  it("answers every registry field a payload names, whichever value it carries", () => {
    const payload = Object.fromEntries(
      FIELDS.map((field) => [field, field === "provenance" ? null : "a value"]),
    );

    expect(disabledArtworkFieldsIn(allOff(), payload)).toEqual(FIELDS);
  });

  it("never answers an absent key or a key outside the registry", () => {
    expect(disabledArtworkFieldsIn(allOff(), {})).toEqual([]);
    expect(
      disabledArtworkFieldsIn(allOff(), { provenance: undefined }),
    ).toEqual([]);
    // Title, Artist Name and the status are outside the registry and are
    // never refused, whatever a save carries them as.
    const fixedPayload: Record<string, unknown> = {
      title: "A Work",
      artistName: "A. Artist",
      status: "draft",
    };
    expect(disabledArtworkFieldsIn(allOff(), fixedPayload)).toEqual([]);
  });

  it("never answers an enabled field", () => {
    expect(
      disabledArtworkFieldsIn(on(), { provenance: "The artist's studio" }),
    ).toEqual([]);
  });
});
