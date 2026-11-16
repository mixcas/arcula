// A work's market state: the save routes record it, the serializer carries it,
// and it is never a gate. The kind decides only whether the form surfaces the
// field (ADR-0010); the API accepts availability on every kind and validates
// it against nothing but the four-word enum.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArtworkRead } from "@arcula/shared";
import { closeDb } from "../src/db";
import { freshUser, json, req, uuid } from "./helpers/api";
import { makeCatalogue } from "./helpers/fixtures";

let owner: Awaited<ReturnType<typeof freshUser>>;
let portfolio: string;
let inventory: string;
let collection: string;

beforeAll(async () => {
  owner = await freshUser("Availability");
  portfolio = await makeCatalogue(owner.userId, {
    kind: "portfolio",
    isPublic: true,
  });
  inventory = await makeCatalogue(owner.userId, {
    kind: "inventory",
    isPublic: true,
  });
  collection = await makeCatalogue(owner.userId, {
    kind: "collection",
    isPublic: true,
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
    body: JSON.stringify(body),
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
    { cookies: owner.cookies, body: JSON.stringify(body) },
  );
}

function getArtwork(
  catalogueId: string,
  artworkId: string,
  cookies?: string,
): Promise<Response> {
  return req("GET", `/api/v1/catalogues/${catalogueId}/artworks/${artworkId}`, {
    cookies,
  });
}

function listArtworks(
  catalogueId: string,
  cookies?: string,
): Promise<Response> {
  return req("GET", `/api/v1/catalogues/${catalogueId}/artworks`, { cookies });
}

/** A create with nothing but the required fields and the state under test. */
const save = (catalogueId: string, availability: unknown): Promise<Response> =>
  createArtwork(catalogueId, {
    artworkId: uuid(),
    title: "For Sale",
    artistName: "A. Artist",
    availability,
  });

describe.each([
  ["Portfolio", () => portfolio],
  ["Inventory", () => inventory],
])("a %s work", (_kind, catalogue) => {
  it("round-trips its availability through create, PATCH and read", async () => {
    const cid = catalogue();
    const aid = uuid();
    const created = await createArtwork(cid, {
      artworkId: aid,
      title: "For Sale",
      artistName: "A. Artist",
      availability: "available",
    });
    expect(created.status).toBe(201);
    expect((await json<ArtworkRead>(created)).availability).toBe("available");

    const patched = await patchArtwork(cid, aid, {
      title: "For Sale",
      artistName: "A. Artist",
      availability: "sold",
    });
    expect(patched.status).toBe(200);
    expect((await json<ArtworkRead>(patched)).availability).toBe("sold");

    const read = await getArtwork(cid, aid);
    expect(read.status).toBe(200);
    expect((await json<ArtworkRead>(read)).availability).toBe("sold");
  });
});

describe("a Collection's work", () => {
  it("reads a null availability when the save says nothing", async () => {
    const created = await createArtwork(collection, {
      artworkId: uuid(),
      title: "Owned",
      artistName: "A. Collector",
    });
    expect(created.status).toBe(201);
    const body = await json<ArtworkRead>(created);
    expect(body.availability).toBeNull();

    const read = await getArtwork(collection, body.id);
    expect((await json<ArtworkRead>(read)).availability).toBeNull();
  });

  it("is accepted and round-tripped anyway — the API is a superset", async () => {
    // The kind shapes the form, not the contract: a client that names a state
    // on a Collection's work is not refused, and the value is stored.
    const created = await save(collection, "reserved");
    expect(created.status).toBe(201);
    const body = await json<ArtworkRead>(created);
    expect(body.availability).toBe("reserved");
  });
});

describe("PATCH and the three states of a market state", () => {
  it("leaves an omitted availability alone", async () => {
    const aid = uuid();
    await createArtwork(inventory, {
      artworkId: aid,
      title: "Held",
      artistName: "A. Artist",
      availability: "on-consignment",
    });

    const patched = await patchArtwork(inventory, aid, {
      title: "Held",
      artistName: "A. Artist",
    });
    expect(patched.status).toBe(200);
    expect((await json<ArtworkRead>(patched)).availability).toBe(
      "on-consignment",
    );

    const read = await getArtwork(inventory, aid);
    expect((await json<ArtworkRead>(read)).availability).toBe("on-consignment");
  });

  it("clears it with null", async () => {
    const aid = uuid();
    await createArtwork(inventory, {
      artworkId: aid,
      title: "Held",
      artistName: "A. Artist",
      availability: "reserved",
    });

    const patched = await patchArtwork(inventory, aid, {
      title: "Held",
      artistName: "A. Artist",
      availability: null,
    });
    expect(patched.status).toBe(200);
    expect((await json<ArtworkRead>(patched)).availability).toBeNull();

    const read = await getArtwork(inventory, aid);
    expect((await json<ArtworkRead>(read)).availability).toBeNull();
  });
});

describe("a visitor and a work's market state", () => {
  it("still sees a published sold work, on the read and on the list", async () => {
    const aid = uuid();
    const created = await createArtwork(portfolio, {
      artworkId: aid,
      title: "Sold But Shown",
      artistName: "A. Artist",
      availability: "sold",
    });
    expect(created.status).toBe(201);

    // No session: availability is a member-facing fact, never a second gate.
    const read = await getArtwork(portfolio, aid);
    expect(read.status).toBe(200);
    expect((await json<ArtworkRead>(read)).availability).toBe("sold");

    const list = await listArtworks(portfolio);
    expect(list.status).toBe(200);
    const rows = await json<ArtworkRead[]>(list);
    const row = rows.find((entry) => entry.id === aid);
    expect(row?.availability).toBe("sold");
  });

  it("still refuses a draft, whatever its availability", async () => {
    const aid = uuid();
    await createArtwork(portfolio, {
      artworkId: aid,
      title: "Draft For Sale",
      artistName: "A. Artist",
      status: "draft",
      availability: "available",
    });

    // The status remains the only per-work gate.
    expect((await getArtwork(portfolio, aid)).status).toBe(404);
  });
});
