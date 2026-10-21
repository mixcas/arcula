// The collaborator's read side, end to end: one private collection shared with
// a second account, read through the real routes against the real stack.
//
// The module is the wire proof of access.ts's matrix. The owner and the
// collaborator read the same collection, the same drafts and the same
// tombstoned work; a visitor and an anonymous reader get the visitor rule —
// or, for a private collection, its `403`. The list proves the other half:
// it filters on the collection and the tombstone, never on `artworks.userId`,
// so a work whose mirror names the collaborator is still everyone's to read.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  artworks as artworksTable,
  collectionCollaborators as collaboratorsTable,
  collections as collectionsTable,
} from "@arcula/db";
import type { ArtworkRead } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, uuid } from "./helpers/api";

let owner: { cookies: string; userId: string };
let collaborator: { cookies: string; userId: string };
let stranger: { cookies: string; userId: string };

let cid = "";
let publishedId = "";
let draftId = "";
let deletedId = "";
let savedByCollaboratorId = "";

async function insertWork(options: {
  status?: "draft" | "published";
  deleted?: boolean;
  userId?: string;
  createdAt: Date;
}): Promise<string> {
  const id = uuid();
  await db.insert(artworksTable).values({
    id,
    // The mirror of the collection owner. A row whose mirror names the
    // collaborator is the case the list must not filter on: after the write
    // ticket a collaborator's save still records the collection's owner, but
    // the read side may not depend on that to be true.
    userId: options.userId ?? owner.userId,
    collectionId: cid,
    title: "Shared Work",
    artistName: "C. Cas",
    status: options.status ?? "published",
    deletedAt: options.deleted ? new Date("2026-02-01T00:00:00Z") : null,
    createdAt: options.createdAt,
    updatedAt: options.createdAt,
  });
  return id;
}

beforeAll(async () => {
  owner = await freshUser("SharedOwner");
  collaborator = await freshUser("SharedMate");
  stranger = await freshUser("SharedOther");

  cid = uuid();
  await db.insert(collectionsTable).values({
    id: cid,
    userId: owner.userId,
    mediaNamespaceId: uuid(),
    name: "Shared Wall",
    isPublic: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(collaboratorsTable).values({
    collectionId: cid,
    userId: collaborator.userId,
  });

  publishedId = await insertWork({
    createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  draftId = await insertWork({
    status: "draft",
    createdAt: new Date("2026-01-02T00:00:00Z"),
  });
  deletedId = await insertWork({
    deleted: true,
    createdAt: new Date("2026-01-03T00:00:00Z"),
  });
  savedByCollaboratorId = await insertWork({
    userId: collaborator.userId,
    createdAt: new Date("2026-01-04T00:00:00Z"),
  });
});

afterAll(async () => {
  await closeDb();
});

const listPath = () => `/api/v1/collections/${cid}/artworks`;
const onePath = (aid: string) => `/api/v1/collections/${cid}/artworks/${aid}`;

describe("GET /collections/{cid} for a shared collection", () => {
  it("serves the owner and a collaborator; a stranger and an anonymous reader 403", async () => {
    for (const cookies of [owner.cookies, collaborator.cookies]) {
      const res = await req("GET", `/api/v1/collections/${cid}`, { cookies });
      expect(res.status).toBe(200);
      expect((await json<Record<string, unknown>>(res)).name).toBe(
        "Shared Wall",
      );
    }

    for (const cookies of [stranger.cookies, undefined]) {
      const res = await req("GET", `/api/v1/collections/${cid}`, { cookies });
      expect(res.status).toBe(403);
      expect((await err(res)).code).toBe("forbidden");
    }
  });
});

describe("the artwork list of a shared collection", () => {
  it("gives the owner and the collaborator every live work, drafts included", async () => {
    // Deleted is not listed for either of them; nor filtered by `userId`,
    // though one row's mirror names the collaborator.
    const expected = [publishedId, draftId, savedByCollaboratorId];
    for (const cookies of [owner.cookies, collaborator.cookies]) {
      const res = await req("GET", listPath(), { cookies });
      expect(res.status).toBe(200);
      expect((await json<ArtworkRead[]>(res)).map((work) => work.id)).toEqual(
        expected,
      );
    }
  });

  it("403s a stranger and an anonymous reader on the private collection", async () => {
    for (const cookies of [stranger.cookies, undefined]) {
      const res = await req("GET", listPath(), { cookies });
      expect(res.status).toBe(403);
      expect((await err(res)).code).toBe("forbidden");
    }
  });
});

describe("the single read of a shared collection", () => {
  it("reads a draft, a deleted work and a collaborator-mirrored work to the owner and the collaborator", async () => {
    for (const cookies of [owner.cookies, collaborator.cookies]) {
      for (const aid of [publishedId, draftId, savedByCollaboratorId]) {
        const res = await req("GET", onePath(aid), { cookies });
        expect(res.status).toBe(200);
        expect((await json<ArtworkRead>(res)).id).toBe(aid);
      }

      // A tombstoned work is absent from the list but still readable: a
      // restore has to be able to show it.
      const deleted = await req("GET", onePath(deletedId), { cookies });
      expect(deleted.status).toBe(200);
      expect((await json<ArtworkRead>(deleted)).deletedAt).not.toBeNull();
    }
  });

  it("404s a visitor and an anonymous reader, uniformly", async () => {
    // A draft, a tombstoned work and a published work behind a private
    // collection are one answer to a non-member: naming which was refused
    // would be a disclosure.
    for (const cookies of [stranger.cookies, undefined]) {
      for (const aid of [publishedId, draftId, deletedId]) {
        const res = await req("GET", onePath(aid), { cookies });
        expect(res.status).toBe(404);
        expect((await err(res)).code).toBe("not-found");
      }
    }
  });
});
