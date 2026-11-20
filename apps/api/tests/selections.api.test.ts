// The member routes of a Selection, against the real app and the real stack.
//
//   GET    /catalogues/{cid}/selections
//   POST   /catalogues/{cid}/selections
//   GET    /catalogues/{cid}/selections/{sid}
//   PATCH  /catalogues/{cid}/selections/{sid}
//   DELETE /catalogues/{cid}/selections/{sid}
//
// The ticket's slice is member-only: every route answers the source Catalogue's
// owner and collaborators, and a stranger gets the same not-found as a
// Selection that does not exist. The delete is the one write that must leave
// everything else alone — the works, their photos and the Catalogue itself.
//
// Works are written straight through drizzle: the curation routes are the next
// slice, and this file's subject is the envelope, the verdict and the
// count. Rows are never cleaned up (the suite's convention), so every fixture
// names its own catalogue.

import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artworkPhotos as artworkPhotosTable,
  artworks as artworksTable,
  catalogueCollaborators as collaboratorsTable,
  catalogues as cataloguesTable,
  selectionAccessGrants as selectionGrantsTable,
  selectionWorks as selectionWorksTable,
  selections as selectionsTable,
} from "@arcula/db";
import type { Selection, SelectionPage } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, uuid } from "./helpers/api";
import { makeArtwork, makeCatalogue } from "./helpers/fixtures";

type Account = { email: string; cookies: string; userId: string };

let owner: Account;
let mate: Account;
let stranger: Account;
let cid = "";

const selectionsPath = (catalogueId: string) =>
  `/api/v1/catalogues/${catalogueId}/selections`;

const selectionPath = (catalogueId: string, selectionId: string) =>
  `${selectionsPath(catalogueId)}/${selectionId}`;

/** Create a Selection through the route and answer its wire document. */
async function createSelection(
  name: string,
  description?: string,
  account: Account = owner,
): Promise<Selection> {
  const res = await req("POST", selectionsPath(cid), {
    cookies: account.cookies,
    body: { name, description },
  });
  expect(res.status).toBe(201);
  return await json<Selection>(res);
}

beforeAll(async () => {
  owner = await freshUser("SelectionOwner");
  mate = await freshUser("SelectionMate");
  stranger = await freshUser("SelectionOther");

  // A private Catalogue: the Selection routes never consult its visibility —
  // they consult membership, which is what makes this the interesting parent.
  cid = await makeCatalogue(owner.userId, {
    isPublic: false,
    name: "Private Wall",
  });
  await db
    .insert(collaboratorsTable)
    .values({ catalogueId: cid, userId: mate.userId });
});

afterAll(closeDb);

describe("POST /catalogues/{cid}/selections", () => {
  it("creates a private Selection with a trimmed name and no empty description", async () => {
    const res = await req("POST", selectionsPath(cid), {
      cookies: owner.cookies,
      body: { name: "  Fair 2026  ", description: "   " },
    });
    expect(res.status).toBe(201);
    const selection = await json<Selection & Record<string, unknown>>(res);
    expect(selection).toMatchObject({
      catalogueId: cid,
      name: "Fair 2026",
      isPublic: false,
      isPasswordProtected: false,
    });
    expect(selection).not.toHaveProperty("description");
    expect(selection.createdAt).toEqual({
      seconds: expect.any(Number) as number,
      nanoseconds: expect.any(Number) as number,
    });
  });

  it("refuses a blank name", async () => {
    const res = await req("POST", selectionsPath(cid), {
      cookies: owner.cookies,
      body: { name: "   " },
    });
    expect(res.status).toBe(400);
    expect((await err(res)).fields?.name).toBe("Selection name is required");
  });

  it("lets a collaborator create one", async () => {
    const selection = await createSelection(
      "Shared Shortlist",
      undefined,
      mate,
    );
    expect(selection.catalogueId).toBe(cid);
    expect(selection.name).toBe("Shared Shortlist");
  });
});

describe("GET /catalogues/{cid}/selections", () => {
  it("lists the Catalogue's Selections by name, each with its live-work count", async () => {
    const selection = await createSelection("Counting Works");
    const published = await makeArtwork(owner.userId, cid);
    const draft = await makeArtwork(owner.userId, cid);
    const deleted = await makeArtwork(owner.userId, cid);
    await db
      .update(artworksTable)
      .set({ status: "draft" })
      .where(eq(artworksTable.id, draft));
    await db
      .update(artworksTable)
      .set({ deletedAt: new Date() })
      .where(eq(artworksTable.id, deleted));
    await db.insert(selectionWorksTable).values([
      { selectionId: selection.id, artworkId: published, position: 0 },
      { selectionId: selection.id, artworkId: draft, position: 1 },
      { selectionId: selection.id, artworkId: deleted, position: 2 },
    ]);

    const res = await req("GET", selectionsPath(cid), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(200);
    const page = await json<SelectionPage>(res);
    const row = page.selections.find((entry) => entry.id === selection.id);
    // A Draft is shown by a Selection, so it counts; a deleted work is not.
    expect(row?.workCount).toBe(2);
    const names = page.selections.map((entry) => entry.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it("lets a collaborator read the list", async () => {
    const res = await req("GET", selectionsPath(cid), {
      cookies: mate.cookies,
    });
    expect(res.status).toBe(200);
  });
});

describe("GET /catalogues/{cid}/selections/{sid}", () => {
  it("reads one Selection", async () => {
    const selection = await createSelection("Read Me");
    const res = await req("GET", selectionPath(cid, selection.id), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(200);
    expect(await json<Selection>(res)).toMatchObject({
      id: selection.id,
      name: "Read Me",
      isPublic: false,
      isPasswordProtected: false,
    });
  });

  it("answers not-found for a Selection in another Catalogue", async () => {
    const otherCid = await makeCatalogue(owner.userId, { isPublic: false });
    const selection = await createSelection("Elsewhere");
    const res = await req("GET", selectionPath(otherCid, selection.id), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(404);
  });
});

describe("PATCH /catalogues/{cid}/selections/{sid}", () => {
  it("renames and describes, then clears the description with null", async () => {
    const selection = await createSelection("Before");
    const renamed = await req("PATCH", selectionPath(cid, selection.id), {
      cookies: owner.cookies,
      body: { name: "  After  ", description: "  A shortlist.  " },
    });
    expect(renamed.status).toBe(200);
    expect(await json<Selection>(renamed)).toMatchObject({
      name: "After",
      description: "A shortlist.",
    });

    const cleared = await req("PATCH", selectionPath(cid, selection.id), {
      cookies: owner.cookies,
      body: { description: null },
    });
    expect(cleared.status).toBe(200);
    expect(await json<Selection>(cleared)).not.toHaveProperty("description");
  });

  it("leaves the name alone when the patch does not name it", async () => {
    const selection = await createSelection("Stay");
    await req("PATCH", selectionPath(cid, selection.id), {
      cookies: owner.cookies,
      body: { description: "Only this changes." },
    });
    const read = await req("GET", selectionPath(cid, selection.id), {
      cookies: owner.cookies,
    });
    expect((await json<Selection>(read)).name).toBe("Stay");
  });

  it("refuses an empty name", async () => {
    const selection = await createSelection("No Blank Names");
    const res = await req("PATCH", selectionPath(cid, selection.id), {
      cookies: owner.cookies,
      body: { name: "   " },
    });
    expect(res.status).toBe(400);
    expect((await err(res)).fields?.name).toBe("Selection name is required");
  });

  it("lets a collaborator write", async () => {
    const selection = await createSelection("Mate Edits");
    const res = await req("PATCH", selectionPath(cid, selection.id), {
      cookies: mate.cookies,
      body: { name: "Mate Renamed" },
    });
    expect(res.status).toBe(200);
    expect((await json<Selection>(res)).name).toBe("Mate Renamed");
  });
});

describe("a stranger", () => {
  it("gets not-found from every member route, before a body is parsed", async () => {
    const selection = await createSelection("Hidden");
    const attempts: Array<[string, string, unknown]> = [
      ["GET", selectionsPath(cid), undefined],
      ["POST", selectionsPath(cid), { name: "Sneaky" }],
      ["GET", selectionPath(cid, selection.id), undefined],
      // A malformed body proves the membership check comes first: the answer is
      // the refusal, not a 400 about the body.
      ["PATCH", selectionPath(cid, selection.id), { name: 42 }],
      ["DELETE", selectionPath(cid, selection.id), undefined],
    ];
    for (const [method, path, body] of attempts) {
      const res = await req(method, path, {
        cookies: stranger.cookies,
        body,
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it("gets not-found for a Catalogue it cannot see even with no Selection id", async () => {
    const selection = await createSelection("Also Hidden");
    const res = await req("GET", selectionPath(cid, selection.id), {
      cookies: stranger.cookies,
    });
    expect((await err(res)).code).toBe("not-found");
  });
});

describe("DELETE /catalogues/{cid}/selections/{sid}", () => {
  it("stamps the Selection, drops its grants and touches nothing else", async () => {
    const selection = await createSelection("Delete Me");
    const artworkId = await makeArtwork(owner.userId, cid);
    const photoId = uuid();
    await db.insert(selectionWorksTable).values({
      selectionId: selection.id,
      artworkId,
      position: 0,
    });
    await db.insert(artworkPhotosTable).values({
      id: photoId,
      artworkId,
      order: 0,
      name: "scan.jpg",
    });
    await db.insert(selectionGrantsTable).values({
      selectionId: selection.id,
      tokenHash: uuid(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const res = await req("DELETE", selectionPath(cid, selection.id), {
      cookies: owner.cookies,
    });
    expect(res.status).toBe(204);

    const [row] = await db
      .select()
      .from(selectionsTable)
      .where(eq(selectionsTable.id, selection.id));
    expect(row.deletedAt).not.toBeNull();

    const grants = await db
      .select()
      .from(selectionGrantsTable)
      .where(eq(selectionGrantsTable.selectionId, selection.id));
    expect(grants).toHaveLength(0);

    const [artwork] = await db
      .select()
      .from(artworksTable)
      .where(eq(artworksTable.id, artworkId));
    expect(artwork).toBeDefined();
    expect(artwork.deletedAt).toBeNull();

    const photos = await db
      .select()
      .from(artworkPhotosTable)
      .where(eq(artworkPhotosTable.id, photoId));
    expect(photos).toHaveLength(1);

    const [catalogue] = await db
      .select()
      .from(cataloguesTable)
      .where(
        and(eq(cataloguesTable.id, cid), isNull(cataloguesTable.deletedAt)),
      );
    expect(catalogue).toBeDefined();

    // The address is dead to every read and write.
    expect(
      (
        await req("GET", selectionPath(cid, selection.id), {
          cookies: owner.cookies,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await req("DELETE", selectionPath(cid, selection.id), {
          cookies: owner.cookies,
        })
      ).status,
    ).toBe(404);
  });

  it("is the only way a Selection leaves the list", async () => {
    const selection = await createSelection("Leaves Soon");
    await req("DELETE", selectionPath(cid, selection.id), {
      cookies: owner.cookies,
    });
    const page = await json<SelectionPage>(
      await req("GET", selectionsPath(cid), { cookies: owner.cookies }),
    );
    expect(page.selections.map((row) => row.id)).not.toContain(selection.id);
  });
});
