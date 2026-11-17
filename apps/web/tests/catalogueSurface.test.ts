// What a catalogue's kind means for the surface, as pure data (tier 1).
//
// The answers the app derives from one kind: the two field labels that name
// whose catalogue it is, the market states a work may carry, and what a create
// form starts with.

import { describe, expect, it } from "vitest";
import { EMPTY_ARTWORK_FORM } from "@arcula/shared";
import {
  CATALOGUE_KINDS,
  availabilityFor,
  catalogueSurface,
  newArtworkForm,
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
      ["Inventory", "Gallery name", "About"],
      ["Collection", "Name", "Description"],
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
});

/**
 * What a create form starts as is a per-kind answer, not a derived fact: a
 * Portfolio's name *is* the artist's name (ADR-0010), so its works start
 * credited to it; an Inventory's name is the gallery's and a Collection's is
 * the collector's, so neither can be guessed. One call answers every kind, so
 * a screen has no branch to skip one with.
 */
describe("newArtworkForm", () => {
  it("starts a Portfolio work credited to the portfolio", () => {
    expect(newArtworkForm("portfolio", "Flores Solares")).toEqual({
      ...EMPTY_ARTWORK_FORM,
      artistName: "Flores Solares",
      availability: "available",
    });
  });

  it("leaves an Inventory's Artist Name empty, with its market state", () => {
    // An Inventory sells work it represents, so the state is still there;
    // only the artist is unknown.
    expect(newArtworkForm("inventory", "Galería Sur")).toEqual({
      ...EMPTY_ARTWORK_FORM,
      availability: "available",
    });
  });

  it("gives a Collection exactly the empty form", () => {
    // Nothing prefilled and no market state: a kind that gains no default must
    // not lose the ones the form already had.
    expect(newArtworkForm("collection", "Colección Privada")).toEqual(
      EMPTY_ARTWORK_FORM,
    );
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
