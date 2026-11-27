// A work's market state: the save routes record it, a member read carries it,
// a visitor read does not, and it is never a gate. Whether a form or a save may
// name the field is the Catalogue's choice (the Artwork fields registry), so a
// Collection whose Availability is on accepts all four states like any other
// Catalogue; the API validates the value against the four-word enum alone, and
// never against the Kind.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ArtworkRead } from "@arcula/shared";
import { closeDb } from "../src/db";
import { err, freshUser, json, listedArtworks, req, uuid } from "./helpers/api";
import { makeCatalogue } from "./helpers/fixtures";

let owner: Awaited<ReturnType<typeof freshUser>>;
let portfolio: string;
let inventory: string;
let collection: string;

beforeAll(async () => {
  owner = await freshUser("Availability");
  // A Portfolio's defaults leave Availability off; these cases are about the
  // field itself, so this one records it.
  portfolio = await makeCatalogue(owner.userId, {
    kind: "portfolio",
    isPublic: true,
    artworkFields: { availability: true },
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

    const read = await getArtwork(cid, aid, owner.cookies);
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

    const read = await getArtwork(collection, body.id, owner.cookies);
    expect((await json<ArtworkRead>(read)).availability).toBeNull();
  });

  it("refuses a state the Catalogue does not record, like any other disabled field", async () => {
    // A Collection's Availability starts off, so the refusal #303 added covers
    // this key now that it is in the registry. It is a configuration rule, not
    // a Kind one: a Collection that switches the field on accepts the same
    // states a Portfolio does.
    const refused = await save(collection, "reserved");
    expect(refused.status).toBe(400);
    const body = await err(refused);
    expect(body.code).toBe("field-disabled");
    expect(body.fields).toHaveProperty("availability");
  });

  it("accepts a state when the Collection switched Availability on", async () => {
    const cid = await makeCatalogue(owner.userId, {
      kind: "collection",
      isPublic: true,
      artworkFields: { availability: true },
    });
    const created = await save(cid, "reserved");
    expect(created.status).toBe(201);
    const body = await json<ArtworkRead>(created);
    expect(body.availability).toBe("reserved");

    const read = await getArtwork(cid, body.id, owner.cookies);
    expect((await json<ArtworkRead>(read)).availability).toBe("reserved");
  });
});

describe("a new work's starting availability", () => {
  it("starts at available where the Catalogue records a market state", async () => {
    const cid = await makeCatalogue(owner.userId, {
      kind: "collection",
      isPublic: true,
      artworkFields: { availability: true },
    });
    const created = await createArtwork(cid, {
      artworkId: uuid(),
      title: "New Work",
      artistName: "A. Collector",
    });
    expect(created.status).toBe(201);
    const body = await json<ArtworkRead>(created);
    expect(body.availability).toBe("available");

    const read = await getArtwork(cid, body.id, owner.cookies);
    expect((await json<ArtworkRead>(read)).availability).toBe("available");
  });

  it("stores no state where the Catalogue's Availability is off", async () => {
    // A Catalogue that leaves the field off gives a new work no market state
    // to be in.
    const cid = await makeCatalogue(owner.userId, {
      kind: "portfolio",
      isPublic: true,
      artworkFields: { availability: false },
    });
    const created = await createArtwork(cid, {
      artworkId: uuid(),
      title: "Not For Sale",
      artistName: "A. Artist",
    });
    expect(created.status).toBe(201);
    const body = await json<ArtworkRead>(created);
    expect(body.availability).toBeNull();
  });

  it("keeps an explicit null in a Catalogue that records availability", async () => {
    const cid = await makeCatalogue(owner.userId, {
      kind: "collection",
      isPublic: true,
      artworkFields: { availability: true },
    });
    const created = await createArtwork(cid, {
      artworkId: uuid(),
      title: "Cleared On Creation",
      artistName: "A. Collector",
      availability: null,
    });
    expect(created.status).toBe(201);
    const body = await json<ArtworkRead>(created);
    expect(body.availability).toBeNull();
  });
});

describe("the four states are the same on every kind", () => {
  it("accepts a Portfolio's on-consignment", async () => {
    // Flattening Availability removed the per-Kind list: a Portfolio can now
    // record work it holds on consignment, and the server validates the state
    // against the enum alone.
    const created = await save(portfolio, "on-consignment");
    expect(created.status).toBe(201);
    const body = await json<ArtworkRead>(created);
    expect(body.availability).toBe("on-consignment");

    const read = await getArtwork(portfolio, body.id, owner.cookies);
    expect((await json<ArtworkRead>(read)).availability).toBe("on-consignment");
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

    const read = await getArtwork(inventory, aid, owner.cookies);
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

    const read = await getArtwork(inventory, aid, owner.cookies);
    expect((await json<ArtworkRead>(read)).availability).toBeNull();
  });
});

describe("a visitor and a work's market state", () => {
  it("sees the published work but not its member-facing market state", async () => {
    const aid = uuid();
    const created = await createArtwork(portfolio, {
      artworkId: aid,
      title: "Sold But Shown",
      artistName: "A. Artist",
      availability: "sold",
    });
    expect(created.status).toBe(201);

    // No session: the work is still visible — availability is a member-facing
    // fact, never a second gate — but the document does not carry the key.
    const read = await getArtwork(portfolio, aid);
    expect(read.status).toBe(200);
    expect(await json<ArtworkRead>(read)).not.toHaveProperty("availability");

    const list = await listArtworks(portfolio);
    expect(list.status).toBe(200);
    const rows = await listedArtworks(list);
    const row = rows.find((entry) => entry.id === aid);
    expect(row).toBeDefined();
    expect(row).not.toHaveProperty("availability");

    // The member read still carries it, and the row still stores it.
    const memberRead = await getArtwork(portfolio, aid, owner.cookies);
    expect((await json<ArtworkRead>(memberRead)).availability).toBe("sold");
    const memberRows = await listedArtworks(
      await listArtworks(portfolio, owner.cookies),
    );
    expect(memberRows.find((entry) => entry.id === aid)?.availability).toBe(
      "sold",
    );
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
