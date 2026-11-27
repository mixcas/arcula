// A write that names an Artwork field its Catalogue turned off is refused,
// and the refusal is the only thing that happens: no row changes, no field is
// stored through these two routes.
//
// The enabled set is the Catalogue's own resolution — the stored deviations
// laid over the Kind's defaults — so a field that is off by default and one a
// member switched off are refused by the same rule, and an explicitly enabled
// field still writes. The refusal carries the field names in `error.fields`,
// the envelope's structured slot, and the prose names them too.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artworks as artworksTable } from "@arcula/db";
import type { ArtworkRead } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, uuid } from "./helpers/api";
import { makeCatalogue } from "./helpers/fixtures";

type ArtworkRow = typeof artworksTable.$inferSelect;

let owner: Awaited<ReturnType<typeof freshUser>>;
/** The acquisition pair is off on a Portfolio by default. */
let portfolio: string;
/** A collection that explicitly switched provenance and medium off. */
let narrowCollection: string;
/** A Portfolio that explicitly switched acquisition price and provenance on. */
let acquisitionPortfolio: string;

beforeAll(async () => {
  owner = await freshUser("FieldRefusal");
  portfolio = await makeCatalogue(owner.userId, {
    kind: "portfolio",
    isPublic: true,
  });
  narrowCollection = await makeCatalogue(owner.userId, {
    kind: "collection",
    isPublic: true,
    artworkFields: { medium: false, provenance: false },
  });
  acquisitionPortfolio = await makeCatalogue(owner.userId, {
    kind: "portfolio",
    isPublic: true,
    artworkFields: { acquisitionPrice: true, provenance: true },
  });
});

afterAll(async () => {
  await closeDb();
});

function createArtwork(
  catalogueId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return req("POST", `/api/v1/catalogues/${catalogueId}/artworks`, {
    cookies: owner.cookies,
    body,
  });
}

function patchArtwork(
  catalogueId: string,
  artworkId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return req(
    "PATCH",
    `/api/v1/catalogues/${catalogueId}/artworks/${artworkId}`,
    { cookies: owner.cookies, body },
  );
}

/** A create with nothing but the required fields. */
async function createSaved(
  catalogueId: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const artworkId = uuid();
  const res = await createArtwork(catalogueId, {
    artworkId,
    title: "Saved Work",
    artistName: "A. Artist",
    ...body,
  });
  expect(res.status).toBe(201);
  return artworkId;
}

async function rowOf(artworkId: string): Promise<ArtworkRow | undefined> {
  const [row] = await db
    .select()
    .from(artworksTable)
    .where(eq(artworksTable.id, artworkId));
  return row;
}

describe("the create route", () => {
  it("refuses a field the Kind's defaults leave off, and writes no row", async () => {
    const artworkId = uuid();
    const res = await createArtwork(portfolio, {
      artworkId,
      title: "Priced Work",
      artistName: "A. Artist",
      acquisitionPrice: "1200 EUR",
    });

    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("field-disabled");
    expect(body.message).toContain("Acquisition price");
    expect(body.fields).toEqual({
      acquisitionPrice: "Acquisition price is not recorded in this catalogue.",
    });
    expect(await rowOf(artworkId)).toBeUndefined();
  });

  it("names every disabled field a write sends, readably", async () => {
    const artworkId = uuid();
    const res = await createArtwork(narrowCollection, {
      artworkId,
      title: "Narrow Work",
      artistName: "A. Artist",
      medium: "Oil on canvas",
      provenance: "The artist's studio",
    });

    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("field-disabled");
    expect(body.message).toContain("Medium");
    expect(body.message).toContain("Provenance");
    expect(body.fields).toEqual({
      medium: "Medium is not recorded in this catalogue.",
      provenance: "Provenance is not recorded in this catalogue.",
    });
    expect(await rowOf(artworkId)).toBeUndefined();
  });

  it("writes an enabled field, including one a deviation switched on", async () => {
    const artworkId = uuid();
    const res = await createArtwork(acquisitionPortfolio, {
      artworkId,
      title: "Acquired Work",
      artistName: "A. Artist",
      acquisitionPrice: "1200 EUR",
      provenance: "The artist's studio",
    });

    expect(res.status).toBe(201);
    const artwork = await json<ArtworkRead>(res);
    expect(artwork.acquisitionPrice).toBe("1200 EUR");
    expect(artwork.provenance).toBe("The artist's studio");
    expect((await rowOf(artworkId))?.acquisitionPrice).toBe("1200 EUR");
  });
});

describe("the PATCH route", () => {
  it("refuses a disabled field and leaves the row exactly as it was", async () => {
    const artworkId = await createSaved(narrowCollection);
    const before = await rowOf(artworkId);
    expect(before).toBeDefined();

    const res = await patchArtwork(narrowCollection, artworkId, {
      title: "Renamed While Refused",
      artistName: "A. Artist",
      provenance: "The artist's studio",
    });

    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("field-disabled");
    expect(body.message).toContain("Provenance");
    expect(body.fields).toEqual({
      provenance: "Provenance is not recorded in this catalogue.",
    });
    expect(await rowOf(artworkId)).toEqual(before);
  });

  it("treats a present null as naming the disabled field", async () => {
    const artworkId = await createSaved(narrowCollection);
    const before = await rowOf(artworkId);
    expect(before).toBeDefined();

    const res = await patchArtwork(narrowCollection, artworkId, {
      title: "Saved Work",
      artistName: "A. Artist",
      provenance: null,
    });

    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("field-disabled");
    expect(body.fields).toEqual({
      provenance: "Provenance is not recorded in this catalogue.",
    });
    expect(await rowOf(artworkId)).toEqual(before);
  });

  it("writes an enabled field normally", async () => {
    const artworkId = await createSaved(narrowCollection);

    const res = await patchArtwork(narrowCollection, artworkId, {
      title: "Saved Work",
      artistName: "A. Artist",
      notes: "Condition report on file",
    });

    expect(res.status).toBe(200);
    const artwork = await json<ArtworkRead>(res);
    expect(artwork.notes).toBe("Condition report on file");
    expect((await rowOf(artworkId))?.notes).toBe("Condition report on file");
  });
});
