// What a catalogue's kind means for the surface, as pure data (tier 1).
//
// The answers the app derives from one kind: the two field labels that name
// whose catalogue it is, and what a create form starts with. Availability is no
// longer a Kind answer — all four states are offered everywhere, and whether a
// new work starts with one follows the Catalogue's resolved Artwork fields.

import { describe, expect, it } from "vitest";
import { ARTWORK_FIELD_DEFAULTS, EMPTY_ARTWORK_FORM } from "@arcula/shared";
import {
  ARTWORK_AVAILABILITY_LABELS,
  ARTWORK_AVAILABILITY_STATES,
  CATALOGUE_KINDS,
  catalogueSurface,
  newArtworkForm,
} from "@/catalogueSurface";
import type { ArtworkFieldStates, CatalogueKind } from "@arcula/shared";

/** The catalogue's resolved fields, with Availability at the state under test. */
const enabled = (
  kind: CatalogueKind,
  availability: boolean,
): ArtworkFieldStates => ({
  ...ARTWORK_FIELD_DEFAULTS[kind],
  availability,
});

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
});

describe("the market states", () => {
  it("offers the same four, in one order, on every kind", () => {
    // The Kind no longer answers which states it offers: the form renders the
    // whole list wherever Availability is enabled, so a Portfolio may record
    // on-consignment and a Collection any state.
    expect([...ARTWORK_AVAILABILITY_STATES]).toEqual([
      "available",
      "reserved",
      "sold",
      "on-consignment",
    ]);
    expect(
      ARTWORK_AVAILABILITY_STATES.map(
        (state) => ARTWORK_AVAILABILITY_LABELS[state],
      ),
    ).toEqual(["Available", "Reserved", "Sold", "On consignment"]);
  });
});

/**
 * What a create form starts as is a per-kind answer, not a derived fact: a
 * Portfolio's name *is* the artist's name (ADR-0010), so its works start
 * credited to it; an Inventory's name is the gallery's and a Collection's is
 * the collector's, so neither can be guessed. The market state is not a Kind
 * answer: it starts at `available` exactly when the Catalogue records
 * Availability, and is `null` otherwise.
 */
describe("newArtworkForm", () => {
  it("starts a Portfolio work credited to the portfolio, at available", () => {
    expect(
      newArtworkForm("portfolio", "Flores Solares", enabled("portfolio", true)),
    ).toEqual({
      ...EMPTY_ARTWORK_FORM,
      artistName: "Flores Solares",
      availability: "available",
    });
  });

  it("leaves an Inventory's Artist Name empty, with its market state", () => {
    // An Inventory sells work it represents, so the state is still there;
    // only the artist is unknown.
    expect(
      newArtworkForm("inventory", "Galería Sur", enabled("inventory", true)),
    ).toEqual({
      ...EMPTY_ARTWORK_FORM,
      availability: "available",
    });
  });

  it("gives a Collection with Availability off exactly the empty form", () => {
    // Nothing prefilled and no market state: a kind that gains no default must
    // not lose the ones the form already had.
    expect(
      newArtworkForm(
        "collection",
        "Colección Privada",
        enabled("collection", false),
      ),
    ).toEqual(EMPTY_ARTWORK_FORM);
  });

  it("starts a Collection that records Availability at available too", () => {
    // The flattening: a Collection's market state is the same field as any
    // other Catalogue's, not a Kind that carries nothing.
    expect(
      newArtworkForm(
        "collection",
        "Colección Privada",
        enabled("collection", true),
      ),
    ).toEqual({
      ...EMPTY_ARTWORK_FORM,
      availability: "available",
    });
  });

  it("holds no state on a Portfolio that switched Availability off", () => {
    // The enabled set, not the Kind, decides: a default-on Kind can still say
    // nothing, because the form that follows it has no control to fill.
    expect(
      newArtworkForm(
        "portfolio",
        "Flores Solares",
        enabled("portfolio", false),
      ),
    ).toEqual({
      ...EMPTY_ARTWORK_FORM,
      artistName: "Flores Solares",
    });
  });
});
