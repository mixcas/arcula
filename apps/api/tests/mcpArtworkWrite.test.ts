// The Artwork write tools at the dispatcher seam: a verified user id and an
// argument bag in, the Artwork as written out.
//
// What is asserted here is what the tools own rather than the route: the Add
// form's whole field set reaches one row, an update writes only the fields it
// names, a Catalogue records the Availability it has switched on, and the write
// allowance is one account bucket for every
// tool. The membership verdicts are the app's own — a collaborator writes, a
// non-member does not — and the route suite (`save.api.test.ts`) keeps the
// media half.
//
// The two tools call `artworkWrite.ts`, the module the save routes call too,
// so a field added to the Add form lands in one place; these cases do not
// re-test the route's staging.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artworks as artworksTable,
  catalogueCollaborators as collaboratorsTable,
} from "@arcula/db";
import { MINTED_ID_RE, type ArtworkRead } from "@arcula/shared";
import { eq } from "drizzle-orm";
import { AGENT_WRITE_CAPACITY } from "../src/agentLimiter";
import { closeDb, db } from "../src/db";
import { ApiError } from "../src/errors";
import { dispatchTool } from "../src/mcp/dispatcher";
import { tools } from "../src/mcp/registry";
import { freshUser } from "./helpers/api";
import { makeArtwork, makeCatalogue } from "./helpers/fixtures";

const call = async (
  userId: string,
  name: string,
  args: unknown,
): Promise<unknown> => dispatchTool({ userId, name, args });

const create = async (userId: string, args: unknown): Promise<ArtworkRead> =>
  (await call(userId, "create_artwork", args)) as ArtworkRead;

const update = async (userId: string, args: unknown): Promise<ArtworkRead> =>
  (await call(userId, "update_artwork", args)) as ArtworkRead;

const getArtwork = async (
  userId: string,
  catalogueId: string,
  artworkId: string,
): Promise<ArtworkRead> =>
  (await call(userId, "get_artwork", {
    catalogueId,
    artworkId,
  })) as ArtworkRead;

/** The Add form's whole field set, as the tool records it. */
const fullWork = {
  title: "The Red Studio",
  artistName: "Henri Matisse",
  serie: "Studio Interiors",
  dateOfCreation: "1911",
  medium: "Oil on canvas",
  dimensions: "181 x 219 cm",
  editions: "Unique",
  acquisitionDate: "1912-03-01",
  acquisitionPrice: "40000 EUR",
  placeOfOrigin: "Issy-les-Moulineaux, France",
  provenance: "Acquired from the artist",
  notes: "Repainted twice",
  condition: "Excellent",
  currentValue: "120000000 EUR",
  status: "draft",
  availability: "on-consignment",
} as const;

let owner: { email: string; cookies: string; userId: string };
let collaborator: { email: string; cookies: string; userId: string };
let stranger: { email: string; cookies: string; userId: string };

let inventoryId = "";
let sharedId = "";

beforeAll(async () => {
  owner = await freshUser("ArtworkOwner");
  collaborator = await freshUser("ArtworkCollaborator");
  stranger = await freshUser("ArtworkStranger");
  // An Inventory drops the acquisition pair by default; these cases record the
  // Add form's whole set, so the Catalogue switches those fields on.
  inventoryId = await makeCatalogue(owner.userId, {
    name: "Agent Inventory",
    kind: "inventory",
    artworkFields: { acquisitionDate: true, acquisitionPrice: true },
  });
  sharedId = await makeCatalogue(owner.userId, {
    name: "Agent Shared",
    kind: "inventory",
    artworkFields: { acquisitionDate: true, acquisitionPrice: true },
  });
  await db
    .insert(collaboratorsTable)
    .values({ catalogueId: sharedId, userId: collaborator.userId });
});

afterAll(async () => {
  await closeDb();
});

describe("create_artwork", () => {
  it("records the Add form's whole field set and answers every field on a second read", async () => {
    const created = await create(owner.userId, {
      catalogueId: inventoryId,
      ...fullWork,
    });

    // The id is minted server-side, in the shape the other tools take.
    expect(created.id).toMatch(MINTED_ID_RE);
    expect(created).toMatchObject({ ...fullWork, catalogueId: inventoryId });

    // The answer is a read-back, not the argument bag echoed: reading the
    // work through the other tool confirms every field reached the row.
    const reread = await getArtwork(owner.userId, inventoryId, created.id);
    expect(reread).toMatchObject({ ...fullWork, id: created.id });
  });

  it("refuses a missing title with a validation error naming the field, and writes nothing", async () => {
    const emptyId = await makeCatalogue(owner.userId, { name: "Agent Empty" });
    const refusal = await create(owner.userId, {
      catalogueId: emptyId,
      artistName: "Henri Matisse",
    }).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(ApiError);
    const error = refusal as ApiError;
    expect(error.code).toBe("validation");
    // The shared schema's own refusal, keyed by the field the agent must fix:
    // the tool does not restate the title rule.
    expect(error.details).toHaveProperty("title");

    // The refused call wrote nothing: the schema refuses it before the
    // dispatcher spends a write or the core opens a row.
    const searched = (await call(owner.userId, "search_artworks", {
      catalogueId: emptyId,
    })) as { total: number };
    expect(searched.total).toBe(0);
  });
});

describe("update_artwork", () => {
  it("changes only the field it names, leaving every other field as it was", async () => {
    const created = await create(owner.userId, {
      catalogueId: inventoryId,
      ...fullWork,
    });

    const written = await update(owner.userId, {
      catalogueId: inventoryId,
      artworkId: created.id,
      medium: "Tempera on canvas",
    });
    expect(written.medium).toBe("Tempera on canvas");

    // Everything the call did not name survives — a set built from absent
    // fields would null them out, and this is the assertion that says so.
    const reread = await getArtwork(owner.userId, inventoryId, created.id);
    expect(reread).toMatchObject({
      title: fullWork.title,
      artistName: fullWork.artistName,
      serie: fullWork.serie,
      dateOfCreation: fullWork.dateOfCreation,
      medium: "Tempera on canvas",
      dimensions: fullWork.dimensions,
      editions: fullWork.editions,
      acquisitionDate: fullWork.acquisitionDate,
      acquisitionPrice: fullWork.acquisitionPrice,
      placeOfOrigin: fullWork.placeOfOrigin,
      provenance: fullWork.provenance,
      notes: fullWork.notes,
      condition: fullWork.condition,
      currentValue: fullWork.currentValue,
      status: fullWork.status,
      availability: fullWork.availability,
    });
  });

  it("records an Availability on a Collection that switched it on", async () => {
    // A Collection's default has Availability off; this one records it.
    const collectionId = await makeCatalogue(owner.userId, {
      name: "Agent Collection",
      kind: "collection",
      artworkFields: { availability: true },
    });

    const created = await create(owner.userId, {
      catalogueId: collectionId,
      title: "Untitled",
      artistName: "Agnes Martin",
      availability: "sold",
    });

    // The Catalogue records the field, so the row carries the state.
    const [row] = await db
      .select({ availability: artworksTable.availability })
      .from(artworksTable)
      .where(eq(artworksTable.id, created.id));
    expect(row?.availability).toBe("sold");

    // The prompt text carries the rule the schema cannot express: a field the
    // Catalogue does not record is refused, and Availability is one of them.
    for (const name of ["create_artwork", "update_artwork"]) {
      const description =
        tools.find((tool) => tool.name === name)?.description ?? "";
      expect(description, name).toMatch(/Availability/);
      expect(description, name).toMatch(/Collection/);
      expect(description, name).toMatch(/field-disabled/);
    }
  });

  it("refuses a missing or hidden Artwork as not-found", async () => {
    await expect(
      update(owner.userId, {
        catalogueId: inventoryId,
        artworkId: "no-such-artwork",
        medium: "Oil",
      }),
    ).rejects.toMatchObject({
      code: "not-found",
      message: "The artwork does not exist",
    });
  });
});

describe("the membership verdict", () => {
  it("lets a collaborator write and refuses a non-member, leaving the row untouched", async () => {
    const created = await create(collaborator.userId, {
      catalogueId: sharedId,
      title: "Shared Draft",
      artistName: "Sonia Delaunay",
      notes: "Before the edit",
    });
    // A collaborator's work mirrors the Catalogue's owner, as a save does.
    expect(created.userId).toBe(owner.userId);

    const written = await update(collaborator.userId, {
      catalogueId: sharedId,
      artworkId: created.id,
      notes: "After the edit",
    });
    expect(written.notes).toBe("After the edit");

    await expect(
      update(stranger.userId, {
        catalogueId: sharedId,
        artworkId: created.id,
        notes: "Hijacked",
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "You do not have access to this catalogue",
    });
    await expect(
      create(stranger.userId, {
        catalogueId: sharedId,
        title: "Hijacked",
        artistName: "Nobody",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    // The refused writes landed nowhere.
    const reread = await getArtwork(owner.userId, sharedId, created.id);
    expect(reread.notes).toBe("After the edit");
  });
});

describe("the write allowance", () => {
  it("spends one account bucket for every write tool: an exhausted account cannot update an Artwork", async () => {
    const busy = await freshUser("ArtworkBusy");
    const catalogueId = await makeCatalogue(busy.userId, { name: "Busy" });
    const artworkId = await makeArtwork(busy.userId, catalogueId);
    // Exhaust the allowance on the other write tool: the bucket is the
    // account's, not the tool's.
    for (let i = 0; i < AGENT_WRITE_CAPACITY; i += 1) {
      await call(busy.userId, "update_catalogue", {
        catalogueId,
        name: `Write ${i}`,
      });
    }

    await expect(
      update(busy.userId, {
        catalogueId,
        artworkId,
        medium: "Refused",
      }),
    ).rejects.toMatchObject({ code: "rate-limited", status: 429 });

    // The refused call wrote nothing.
    const reread = await getArtwork(busy.userId, catalogueId, artworkId);
    expect(reread.medium).toBeUndefined();
  });
});
