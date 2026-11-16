// What a catalogue's kind means for the surface, as pure data (tier 1).
//
// The three answers the app derives from one kind: the two field labels that
// name whose catalogue it is, the market states a work may carry, and which
// artwork fields the form shows. v1 changes only the words and the
// availability axis — every existing artwork field stays visible on every
// kind, and only title and artist name are required.

import { describe, expect, it } from "vitest";
import {
  CATALOGUE_KINDS,
  availabilityFor,
  catalogueSurface,
} from "@/catalogueSurface";

describe("catalogueSurface", () => {
  it("names each kind and calls the name and description by whose they are", () => {
    expect(
      CATALOGUE_KINDS.map((kind) => {
        const surface = catalogueSurface(kind);
        return [surface.kindLabel, surface.nameLabel, surface.descriptionLabel];
      }),
    ).toEqual([
      ["Portfolio", "Artist name", "Bio"],
      ["Collection", "Name", "Description"],
      ["Inventory", "Gallery name", "About"],
    ]);
  });

  it("puts a work's availability in play on a Portfolio and an Inventory only", () => {
    // A Collection records what the collector owns; there is no market state
    // to record, which is a presentation rule now and the artwork form's in
    // #252.
    expect(
      CATALOGUE_KINDS.filter(
        (kind) => catalogueSurface(kind).availabilityInPlay,
      ),
    ).toEqual(["portfolio", "inventory"]);
  });

  it("offers each kind the market states its market has", () => {
    // ADR-0010: a Portfolio sells the artist's own work, so it never offers
    // on-consignment; an Inventory represents work it may hold on consignment;
    // a Collection has no market at all.
    expect(catalogueSurface("portfolio").availabilityValues).toEqual([
      "available",
      "reserved",
      "sold",
    ]);
    expect(catalogueSurface("inventory").availabilityValues).toEqual([
      "available",
      "reserved",
      "sold",
      "on-consignment",
    ]);
    expect(catalogueSurface("collection").availabilityValues).toEqual([]);
  });

  it("shows every artwork field it lists on every kind in v1", () => {
    // The v1 rule is "no hiding yet": the table is the data a later per-kind
    // hiding will read, so what it must say today is that nothing is hidden.
    for (const kind of CATALOGUE_KINDS) {
      const fields = catalogueSurface(kind).artworkFields;
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.filter(({ visible }) => !visible)).toEqual([]);
    }
  });

  it("requires title and artist name and nothing else, on every kind", () => {
    for (const kind of CATALOGUE_KINDS) {
      const required = catalogueSurface(kind)
        .artworkFields.filter(({ required }) => required)
        .map(({ field }) => field);
      expect(required).toEqual(["title", "artistName"]);
    }
  });
});

describe("availabilityFor", () => {
  it("defaults a surfaced work with no stored state to available", () => {
    expect(availabilityFor("portfolio", null)).toBe("available");
    expect(availabilityFor("inventory", undefined)).toBe("available");
  });

  it("keeps a stored state exactly as it is", () => {
    expect(availabilityFor("portfolio", "sold")).toBe("sold");
    expect(availabilityFor("inventory", "on-consignment")).toBe(
      "on-consignment",
    );
  });

  it("hands a kind with no market state nothing", () => {
    // A Collection's form shows no control; its save must carry no key, even
    // if the row happens to hold a state the API accepted.
    expect(availabilityFor("collection", "sold")).toBeNull();
    expect(availabilityFor("collection", null)).toBeNull();
  });
});
