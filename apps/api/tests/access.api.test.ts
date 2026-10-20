// The access read: who may read and change a collection.
//
// GET /collections/{cid}/access answers the caller's role, the owner and the
// collaborators, and — to the owner only — the pending invitations. It is the
// source of the role the settings and the access card render; the dashboard
// list is not.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collectionCollaborators as collaboratorsTable } from "@arcula/db";
import type { CollectionAccess } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req } from "./helpers/api";
import { makeCollection, makeInvitation } from "./helpers/fixtures";

let owner: { email: string; cookies: string; userId: string };
let mate: { email: string; cookies: string; userId: string };
let mate2: { email: string; cookies: string; userId: string };
let stranger: { email: string; cookies: string; userId: string };
let cid = "";

const access = (cookies: string) =>
  req("GET", `/api/v1/collections/${cid}/access`, { cookies });

beforeAll(async () => {
  owner = await freshUser("AccessOwner");
  mate = await freshUser("AccessMate");
  mate2 = await freshUser("AccessMate2");
  stranger = await freshUser("AccessStranger");
  cid = await makeCollection(owner.userId, {
    name: "Access Wall",
    isPublic: false,
  });
  // Distinct `createdAt`s: the access read lists collaborators in the order
  // they were added, and one multi-row insert would tie them.
  await db
    .insert(collaboratorsTable)
    .values({ collectionId: cid, userId: mate.userId });
  await db.insert(collaboratorsTable).values({
    collectionId: cid,
    userId: mate2.userId,
  });
  // A stray row naming the owner — a hand-written seed, a former transfer's
  // leftover. The owner is the column, so it must not list them twice.
  await db
    .insert(collaboratorsTable)
    .values({ collectionId: cid, userId: owner.userId });
});

afterAll(async () => {
  await closeDb();
});

describe("GET /collections/{cid}/access", () => {
  it("gives the owner the members and every pending invitation", async () => {
    const live = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: "Live-Access@Example.Test",
    });
    const expired = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: "Lapsed-Access@Example.Test",
      createdAt: new Date(Date.now() - 8 * 86_400_000),
      expiresAt: new Date(Date.now() - 86_400_000),
    });
    const resolved = await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: "Resolved-Access@Example.Test",
      status: "revoked",
    });

    const res = await access(owner.cookies);
    expect(res.status).toBe(200);
    const body = await json<CollectionAccess>(res);

    expect(body.role).toBe("owner");
    expect(body.owner).toEqual({
      userId: owner.userId,
      name: "AccessOwner Test",
      email: owner.email,
    });
    // The owner is the owner fact, never one of the collaborators — even
    // though a row naming them exists.
    expect(body.collaborators.map((c) => c.userId)).toEqual([
      mate.userId,
      mate2.userId,
    ]);

    // Expired pending rows are still the owner's business: the status stays
    // `pending`, expiry is read off `expiresAt` by the card.
    const byId = new Map(
      (body.invitations ?? []).map((invitation) => [invitation.id, invitation]),
    );
    expect([...byId.keys()].sort()).toEqual([live.id, expired.id].sort());
    expect(byId.get(expired.id)?.status).toBe("pending");
    expect(
      new Date(byId.get(expired.id)!.expiresAt.seconds * 1000).getTime(),
    ).toBeLessThan(Date.now());
    // A resolved row is history, not access.
    expect(byId.has(resolved.id)).toBe(false);
  });

  it("gives a collaborator the members and no invitation data at all", async () => {
    await makeInvitation({
      collectionId: cid,
      invitedByUserId: owner.userId,
      email: "NotForCollaborators@Example.Test",
    });

    const res = await access(mate.cookies);
    expect(res.status).toBe(200);
    const body = await json<CollectionAccess>(res);

    expect(body.role).toBe("collaborator");
    expect(body.owner.userId).toBe(owner.userId);
    expect(body.collaborators.map((c) => c.userId)).toEqual([
      mate.userId,
      mate2.userId,
    ]);
    // Absent, not empty: the invitation list is the owner's alone.
    expect(body).not.toHaveProperty("invitations");
  });

  it("refuses a non-member and an anonymous reader", async () => {
    for (const cookies of [stranger.cookies, ""]) {
      const res = await access(cookies);
      expect(res.status).toBe(cookies ? 403 : 401);
      expect((await err(res)).code).toBe(
        cookies ? "forbidden" : "unauthorized",
      );
    }
  });

  it("answers 404 for a collection that does not exist", async () => {
    const res = await req(
      "GET",
      "/api/v1/collections/00000000-0000-4000-8000-000000000000/access",
      { cookies: owner.cookies },
    );
    expect(res.status).toBe(404);
    expect((await err(res)).code).toBe("not-found");
  });
});
