// The tool dispatcher at its own seam: a verified user id and an argument bag
// in, the account's Catalogues out. No transport, no token, no Hono Context —
// which is exactly what the ADR promises the tool layer receives.
//
// The cases are the membership matrix the app already enforces: an owner sees
// what they own, a collaborator sees what was shared with them and is named a
// collaborator, and an account with no membership sees nothing. A private
// Catalogue stays invisible to everyone the app does not admit, which is the
// same verdict `GET /catalogues` gives.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogueCollaborators as collaboratorsTable } from "@arcula/db";
import {
  memberArtworkFor,
  memberCatalogueFor,
  readableCatalogueFor,
} from "../src/authorize";
import { closeDb, db } from "../src/db";
import { ApiError } from "../src/errors";
import { dispatchTool } from "../src/mcp/dispatcher";
import { freshUser } from "./helpers/api";
import { makeArtwork, makeCatalogue } from "./helpers/fixtures";

interface CatalogueSummary {
  id: string;
  name: string;
  kind: string;
  visibility: string;
  role: string;
  ownerName?: string;
}

interface ListAnswer {
  total: number;
  catalogues: CatalogueSummary[];
}

const listCatalogues = async (userId: string): Promise<ListAnswer> =>
  (await dispatchTool({
    userId,
    name: "list_catalogues",
    args: {},
  })) as ListAnswer;

let owner: { email: string; cookies: string; userId: string };
let collaborator: { email: string; cookies: string; userId: string };
let stranger: { email: string; cookies: string; userId: string };
let sharedId = "";
let privateId = "";

beforeAll(async () => {
  owner = await freshUser("Owner");
  collaborator = await freshUser("Collaborator");
  stranger = await freshUser("Stranger");

  sharedId = await makeCatalogue(owner.userId, {
    name: "Shared Catalogue",
    isPublic: true,
    kind: "inventory",
  });
  privateId = await makeCatalogue(owner.userId, {
    name: "Private Catalogue",
    isPublic: false,
  });
  await db.insert(collaboratorsTable).values({
    catalogueId: sharedId,
    userId: collaborator.userId,
  });
});

afterAll(async () => {
  await closeDb();
});

describe("list_catalogues", () => {
  it("answers an owner their own Catalogues, with the owner role", async () => {
    const answer = await listCatalogues(owner.userId);
    const shared = answer.catalogues.find((c) => c.id === sharedId);
    expect(shared).toMatchObject({
      name: "Shared Catalogue",
      kind: "inventory",
      visibility: "public",
      role: "owner",
    });
    // An owned row's owner is the caller; no display name is repeated.
    expect(shared?.ownerName).toBeUndefined();
    expect(answer.catalogues.map((c) => c.id)).toContain(privateId);
  });

  it("answers a collaborator the shared Catalogue, named as a collaborator", async () => {
    const answer = await listCatalogues(collaborator.userId);
    expect(answer.total).toBe(1);
    expect(answer.catalogues[0]).toMatchObject({
      id: sharedId,
      role: "collaborator",
      ownerName: "Owner Test",
    });
  });

  it("answers an account with no membership nothing — and never a private row", async () => {
    const answer = await listCatalogues(stranger.userId);
    expect(answer).toEqual({ total: 0, catalogues: [] });
  });

  it("refuses a tool name the registry does not hold", async () => {
    await expect(
      dispatchTool({
        userId: owner.userId,
        name: "delete_everything",
        args: {},
      }),
    ).rejects.toBeInstanceOf(ApiError);
    await expect(
      dispatchTool({
        userId: owner.userId,
        name: "delete_everything",
        args: {},
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });
});

// The cores a later write tool calls: the same verdict and the same words a
// route gives, with the user id the tool layer holds instead of a Context.
describe("the authorization cores the tools call", () => {
  it("refuses a non-member in the app's own words", async () => {
    await expect(
      memberCatalogueFor(stranger.userId, privateId),
    ).rejects.toMatchObject({
      code: "forbidden",
      message: "You do not have access to this catalogue",
    });
  });

  it("refuses an artwork inside a catalogue the caller is not a member of", async () => {
    const artworkId = await makeArtwork(owner.userId, privateId);
    await expect(
      memberArtworkFor(collaborator.userId, privateId, artworkId),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("answers the readable verdict a visitor gets on a public Catalogue", async () => {
    await expect(
      readableCatalogueFor(stranger.userId, sharedId),
    ).resolves.toMatchObject({ audience: "visitor" });
  });
});
