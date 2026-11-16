// What a catalogue's kind means for the surface, as pure data (tier 1).
//
// The three answers the app derives from one kind: the two field labels that
// name whose catalogue it is, whether a work carries a market state at all,
// and which artwork fields the form shows. v1 changes only the words and the
// availability axis — every existing artwork field stays visible on every
// kind, and only title and artist name are required.

import { describe, expect, it } from "vitest";
import {
  CATALOGUE_KINDS,
  catalogueSurface,
  type ArtworkField,
} from "@/catalogueSurface";

/** The artwork form's fields, in the order the form presents them. */
const ALL_ARTWORK_FIELDS: ArtworkField[] = [
  "title",
  "artistName",
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
  "status",
];

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

  it("shows every artwork field on every kind in v1", () => {
    for (const kind of CATALOGUE_KINDS) {
      expect(
        catalogueSurface(kind).artworkFields.map(({ field }) => field),
      ).toEqual(ALL_ARTWORK_FIELDS);
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
