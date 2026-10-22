// The collection resource routes: list/create with the tier cap, the
// owner/visitor reads, the settings-form PATCH (absent-leave / null-clear),
// the CSV import's mixed-batch contract, the bulk soft delete, and the
// unused-in-beta restore — driven in-process with app.request() against the
// real stack.
//
// The beta cap is one collection per free account, so the users in this
// file each get exactly one collection through the API; where a test
// needs a second row it inserts one directly, which keeps the cap test
// about the route and not the table.

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectionAccessGrants as grantsTable,
  collectionCollaborators as collaboratorsTable,
  collections as collectionsTable,
  user as userTable,
} from "@arcula/db";
import { MINTED_ID_RE } from "@arcula/shared";
import { canSeeCollection, membershipOf } from "../src/access";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req, uuid } from "./helpers/api";

/** The wire timestamp is `{ seconds, nanoseconds }`. */
function isWireTimestamp(value: unknown): void {
  expect(Object.keys(value as Record<string, unknown>).sort()).toEqual([
    "nanoseconds",
    "seconds",
  ]);
}

let owner: { cookies: string; userId: string; email: string };
let stranger: { cookies: string; userId: string };
let mate: { cookies: string; userId: string };

// The Protected fixture the list tests share: a public collection with a
// password, made through the settings write path. It is created before any
// list reads so the anonymous list is always exercised with a protected row
// in the database.
let protOwner: { cookies: string; userId: string; email: string };
let protMate: { cookies: string; userId: string };
let protectedId = "";

// Module-level ids, set by the test that creates them: the cap leaves
// each user one collection, so the later describes reuse what the
// earlier ones made.
let studyWallId = "";
let sharedBoardId = "";
let redId = "";
let blueId = "";
let foreignId = "";

beforeAll(async () => {
  owner = await freshUser("Coll");
  stranger = await freshUser("Coll");
  mate = await freshUser("Coll");

  protOwner = await freshUser("Prot");
  protMate = await freshUser("Prot");
  const created = await req("POST", "/api/v1/collections", {
    cookies: protOwner.cookies,
    body: JSON.stringify({ name: "Protected By Link" }),
  });
  expect(created.status).toBe(201);
  protectedId = String((await json<Record<string, unknown>>(created)).id);
  // Through the settings write path, not a hand-written row: the fixture is
  // what the product actually stores when an owner sets a password.
  const locked = await req("PATCH", `/api/v1/collections/${protectedId}`, {
    cookies: protOwner.cookies,
    body: JSON.stringify({
      name: "Protected By Link",
      isPublic: true,
      password: "open-sesame",
    }),
  });
  expect(locked.status).toBe(200);
  expect(
    (await json<Record<string, unknown>>(locked)).isPasswordProtected,
  ).toBe(true);
  await db
    .insert(collaboratorsTable)
    .values({ collectionId: protectedId, userId: protMate.userId });
});

afterAll(async () => {
  await closeDb();
});

describe("POST /collections", () => {
  it("creates with the exact document shape and stops the owner at the cap", async () => {
    const res = await req("POST", "/api/v1/collections", {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "Study Wall", description: "" }),
    });
    expect(res.status).toBe(201);
    const body = await json<Record<string, unknown>>(res);
    // The exact wire document shape: no blank keys, no extras. A brand-new
    // collection is a member read, so it carries the password state.
    expect(Object.keys(body).sort()).toEqual([
      "createdAt",
      "id",
      "isPasswordProtected",
      "isPublic",
      "name",
      "updatedAt",
      "userId",
    ]);
    expect(body.id).toMatch(MINTED_ID_RE);
    expect(body.userId).toBe(owner.userId);
    expect(body.name).toBe("Study Wall");
    expect(body.isPublic).toBe(true);
    isWireTimestamp(body.createdAt);
    isWireTimestamp(body.updatedAt);

    const second = await req("POST", "/api/v1/collections", {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "Second Wall" }),
    });
    expect(second.status).toBe(409);
    expect((await err(second)).code).toBe("limit-reached");
  });

  it("honours explicit values; a blank name 400s even at the cap", async () => {
    const res = await req("POST", "/api/v1/collections", {
      cookies: stranger.cookies,
      body: JSON.stringify({
        name: "Private Wall",
        description: "About the wall",
        isPublic: false,
      }),
    });
    expect(res.status).toBe(201);
    const body = await json<Record<string, unknown>>(res);
    expect(body.description).toBe("About the wall");
    expect(body.isPublic).toBe(false);

    // Validation runs before the cap check: the failure is about the
    // body, not the quota.
    const blank = await req("POST", "/api/v1/collections", {
      cookies: stranger.cookies,
      body: JSON.stringify({ name: "   " }),
    });
    expect(blank.status).toBe(400);
    const e = await err(blank);
    expect(e.code).toBe("validation");
    expect(e.fields?.name).toBeTruthy();
  });
});

describe("GET /collections", () => {
  it("lists each caller's own collections name-ordered; anon sees only the public, unprotected ones", async () => {
    // A second, private collection the API cap would refuse: inserted
    // directly so the cap stays a route property, not a table property.
    await db.insert(collectionsTable).values({
      id: uuid(),
      userId: owner.userId,
      mediaNamespaceId: uuid(),
      name: "AAA Test Wall",
      isPublic: false,
    });

    const own = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections", { cookies: owner.cookies }),
    );
    expect(own.map((c) => c.name)).toEqual(["AAA Test Wall", "Study Wall"]);

    const theirs = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections", { cookies: stranger.cookies }),
    );
    expect(theirs.map((c) => c.name)).toEqual(["Private Wall"]);

    // The test stack persists across runs, so the anon public list also
    // holds earlier runs' public collections: assert membership, not the
    // exact list.
    const anon = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections"),
    );
    const anonNames = anon.map((c) => c.name);
    expect(anonNames).toContain("Study Wall");
    expect(anonNames).not.toContain("AAA Test Wall");
    expect(anonNames).not.toContain("Private Wall");
    // A Protected collection is excluded exactly as a Private one is, and the
    // same fixture is refused by the pure verdict: the SQL filter and
    // canSeeCollection agree on that row.
    expect(anonNames).not.toContain("Protected By Link");
    const [protectedRow] = await db
      .select()
      .from(collectionsTable)
      .where(eq(collectionsTable.id, protectedId));
    if (!protectedRow) {
      throw new Error("the protected fixture is not stored");
    }
    expect(
      canSeeCollection(membershipOf(null, protectedRow, null), protectedRow),
    ).toBe(false);

    // The public list's SQL filter is the anonymous verdict in access.ts
    // spelled in SQL: every row it returns is one canSeeCollection admits.
    // Assert against the stored row, not the wire row, so a listed Protected
    // collection would be caught by the verdict's own password check.
    for (const row of anon) {
      const [stored] = await db
        .select()
        .from(collectionsTable)
        .where(eq(collectionsTable.id, row.id as string));
      if (!stored) {
        throw new Error(`the list returned ${String(row.id)}, not stored`);
      }
      expect(canSeeCollection(membershipOf(null, stored, null), stored)).toBe(
        true,
      );
    }
  });

  it("returns owned and shared collections in one name-ordered list, each row with its role", async () => {
    // One collection of the owner's, shared with `mate`, who also owns one of
    // their own: the list is one list, distinguished by the row's role. The
    // two names are chosen so the order can only come from the sort — "Aaa"
    // is the SHARED one — because the route builds owned rows first and a
    // list that forgot to sort would answer them the other way round.
    sharedBoardId = uuid();
    await db.insert(collectionsTable).values({
      id: sharedBoardId,
      userId: owner.userId,
      mediaNamespaceId: uuid(),
      name: "Aaa Shared Board",
      isPublic: false,
    });
    await db.insert(collaboratorsTable).values({
      collectionId: sharedBoardId,
      userId: mate.userId,
    });
    const own = await req("POST", "/api/v1/collections", {
      cookies: mate.cookies,
      body: JSON.stringify({ name: "Zzz Mate Owned" }),
    });
    expect(own.status).toBe(201);

    const theirs = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections", { cookies: mate.cookies }),
    );
    expect(theirs.map((c) => c.name)).toEqual([
      "Aaa Shared Board",
      "Zzz Mate Owned",
    ]);

    const shared = theirs.find((c) => c.name === "Aaa Shared Board")!;
    expect(shared.role).toBe("collaborator");
    // The owner's display name (their sign-up name here), not their id.
    expect(shared.ownerName).toBe("Coll Test");

    const owned = theirs.find((c) => c.name === "Zzz Mate Owned")!;
    expect(owned.role).toBe("owner");
    expect("ownerName" in owned).toBe(false);

    // The owner's own list carries the same roles from the other side.
    const owners = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections", { cookies: owner.cookies }),
    );
    const board = owners.find((c) => c.name === "Aaa Shared Board")!;
    expect(board.role).toBe("owner");
    expect("ownerName" in board).toBe(false);
  });

  it("falls back to the owner's email when the account has no display name", async () => {
    // `user.name` is nullable; a shared row still has to be attributable.
    await db
      .update(userTable)
      .set({ name: null })
      .where(eq(userTable.id, owner.userId));
    try {
      const theirs = await json<Record<string, unknown>[]>(
        await req("GET", "/api/v1/collections", { cookies: mate.cookies }),
      );
      const shared = theirs.find((c) => c.name === "Aaa Shared Board")!;
      expect(shared.ownerName).toBe(owner.email);
    } finally {
      await db
        .update(userTable)
        .set({ name: "Coll Test" })
        .where(eq(userTable.id, owner.userId));
    }
  });

  it("keeps the anonymous list's shape: public rows only, no role or ownerName", async () => {
    const anon = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections"),
    );
    expect(anon.map((c) => c.name)).toContain("Study Wall");
    for (const row of anon) {
      expect("role" in row).toBe(false);
      expect("ownerName" in row).toBe(false);
    }
  });

  it("does not put another account's shared collection on a signed-in visitor's list", async () => {
    const theirs = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections", { cookies: stranger.cookies }),
    );
    expect(theirs.map((c) => c.name)).toEqual(["Private Wall"]);
  });
});

describe("GET /collections/{cid}", () => {
  it("serves a public collection to anyone and 404s a missing one", async () => {
    const own = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections", { cookies: owner.cookies }),
    );
    studyWallId = String(own.find((c) => c.name === "Study Wall")?.id);
    expect(studyWallId).toMatch(MINTED_ID_RE);

    const missing = await req("GET", `/api/v1/collections/${uuid()}`);
    expect(missing.status).toBe(404);
    expect((await err(missing)).code).toBe("not-found");

    for (const cookies of [owner.cookies, stranger.cookies, undefined]) {
      const res = await req("GET", `/api/v1/collections/${studyWallId}`, {
        cookies,
      });
      expect(res.status).toBe(200);
      expect((await json<Record<string, unknown>>(res)).name).toBe(
        "Study Wall",
      );
    }
  });

  it("403s a visitor on a private collection and still serves the owner", async () => {
    const off = await req("PATCH", `/api/v1/collections/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "Study Wall", isPublic: false }),
    });
    expect(off.status).toBe(200);
    expect((await json<Record<string, unknown>>(off)).isPublic).toBe(false);

    const visitor = await req("GET", `/api/v1/collections/${studyWallId}`, {
      cookies: stranger.cookies,
    });
    expect(visitor.status).toBe(403);
    expect((await err(visitor)).code).toBe("forbidden");

    const anon = await req("GET", `/api/v1/collections/${studyWallId}`);
    expect(anon.status).toBe(403);

    const own = await req("GET", `/api/v1/collections/${studyWallId}`, {
      cookies: owner.cookies,
    });
    expect(own.status).toBe(200);

    // Back to public: the later describes read it as a visitor.
    const on = await req("PATCH", `/api/v1/collections/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "Study Wall", isPublic: true }),
    });
    expect(on.status).toBe(200);
    expect((await json<Record<string, unknown>>(on)).isPublic).toBe(true);
  });
});

describe("PATCH /collections/{cid}", () => {
  it("sets present fields, leaves absent ones, clears nulls", async () => {
    const set = await req("PATCH", `/api/v1/collections/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({
        name: "Renamed",
        isPublic: true,
        description: "About the wall",
        skin: "basicx",
        skinOptions: { transitionSeconds: 1 },
      }),
    });
    expect(set.status).toBe(200);
    let body = await json<Record<string, unknown>>(set);
    expect(body.name).toBe("Renamed");
    expect(body.description).toBe("About the wall");
    expect(body.skin).toBe("basicx");
    expect(body.skinOptions).toEqual({ transitionSeconds: 1 });

    // Absent keys leave the columns alone — the settings form's
    // "write only what changed" payloads depend on exactly this.
    const noChange = await req("PATCH", `/api/v1/collections/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "Renamed", isPublic: true }),
    });
    expect(noChange.status).toBe(200);
    body = await json<Record<string, unknown>>(noChange);
    expect(body.description).toBe("About the wall");
    expect(body.skin).toBe("basicx");
    expect(body.skinOptions).toEqual({ transitionSeconds: 1 });

    // null clears: the key is gone from the document, not set to null.
    const clear = await req("PATCH", `/api/v1/collections/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({
        name: "Study Wall",
        isPublic: true,
        description: null,
        skin: null,
      }),
    });
    expect(clear.status).toBe(200);
    body = await json<Record<string, unknown>>(clear);
    expect("description" in body).toBe(false);
    expect("skin" in body).toBe(false);
    expect(body.skinOptions).toEqual({ transitionSeconds: 1 });

    await req("PATCH", `/api/v1/collections/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({
        name: "Study Wall",
        isPublic: true,
        skinOptions: null,
      }),
    });
  });

  it("rejects a blank name with the failed field", async () => {
    const res = await req("PATCH", `/api/v1/collections/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "  ", isPublic: true }),
    });
    expect(res.status).toBe(400);
    const e = await err(res);
    expect(e.code).toBe("validation");
    expect(e.fields?.name).toBeTruthy();
  });

  it("403s a non-owner", async () => {
    const res = await req("PATCH", `/api/v1/collections/${studyWallId}`, {
      cookies: stranger.cookies,
      body: JSON.stringify({ name: "Hijacked", isPublic: true }),
    });
    expect(res.status).toBe(403);
    expect((await err(res)).code).toBe("forbidden");
  });
});

describe("POST /collections/{cid}/import/csv", () => {
  it("inserts the valid rows and reports broken ones by index", async () => {
    const res = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/import/csv`,
      {
        cookies: owner.cookies,
        body: JSON.stringify({
          rows: [
            {
              title: "Red No. 7",
              artistName: "C. Cas",
              serie: "Reds",
              acquisitionDate: "2024-05-01",
            },
            { artistName: "No Title" },
            { title: "Blue No. 9", artistName: "C. Cas", status: "draft" },
          ],
        }),
      },
    );
    expect(res.status).toBe(200);
    const body = await json<{
      inserted: number;
      rejected: { row: number; errors: Record<string, string> }[];
    }>(res);
    expect(body.inserted).toBe(2);
    expect(body.rejected).toHaveLength(1);
    expect(body.rejected[0].row).toBe(1);
    // The contract is the failed field; the message wording is zod's.
    expect(Object.keys(body.rejected[0].errors)).toEqual(["title"]);

    const list = await json<Record<string, unknown>[]>(
      await req("GET", `/api/v1/collections/${studyWallId}/artworks`, {
        cookies: owner.cookies,
      }),
    );
    expect(list).toHaveLength(2);
    const byTitle = new Map(list.map((w) => [w.title, w]));
    const red = byTitle.get("Red No. 7")!;
    redId = String(red.id);
    blueId = String(byTitle.get("Blue No. 9")!.id);
    expect(redId).toMatch(MINTED_ID_RE);
    expect(red.serie).toBe("Reds");
    expect(red.acquisitionDate).toBe("2024-05-01");
    // A blank optional field is an absent key, not an empty one.
    expect("media" in red).toBe(false);
    // A row that names a status is not obeyed: an import is the owner adding
    // works to a collection, so every imported work is published.
    expect(red.status).toBe("published");
    expect(red.deletedAt).toBeNull();
    expect(byTitle.get("Blue No. 9")!.status).toBe("published");
  });

  it("puts every imported work on the visitor list, since all are published", async () => {
    const visitor = await json<Record<string, unknown>[]>(
      await req("GET", `/api/v1/collections/${studyWallId}/artworks`),
    );
    expect(visitor.map((w) => w.title).sort()).toEqual([
      "Blue No. 9",
      "Red No. 7",
    ]);
  });

  it("403s a non-owner, 401s an anonymous call, 400s a non-array rows", async () => {
    const foreign = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/import/csv`,
      {
        cookies: stranger.cookies,
        body: JSON.stringify({ rows: [{ title: "X", artistName: "Y" }] }),
      },
    );
    expect(foreign.status).toBe(403);

    const anon = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/import/csv`,
      {
        body: JSON.stringify({ rows: [] }),
      },
    );
    expect(anon.status).toBe(401);

    const notArray = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/import/csv`,
      {
        cookies: owner.cookies,
        body: JSON.stringify({ rows: "nope" }),
      },
    );
    expect(notArray.status).toBe(400);
    expect((await err(notArray)).fields?.rows).toBeTruthy();
  });
});

describe("POST /collections/{cid}/artworks/bulk-delete", () => {
  it("tombstones the live works in one go and counts only what moved", async () => {
    // A work in another user's collection, for the foreign-id case.
    const strangerWall = (
      await json<Record<string, unknown>[]>(
        await req("GET", "/api/v1/collections", { cookies: stranger.cookies }),
      )
    )[0];
    const strangerWallId = String(strangerWall.id);
    const foreignCreate = await req(
      "POST",
      `/api/v1/collections/${strangerWallId}/artworks`,
      {
        cookies: stranger.cookies,
        body: JSON.stringify({
          artworkId: uuid(),
          title: "Foreign Work",
          artistName: "F. Foreign",
        }),
      },
    );
    expect(foreignCreate.status).toBe(201);
    foreignId = String((await json<Record<string, unknown>>(foreignCreate)).id);

    const res = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/artworks/bulk-delete`,
      {
        cookies: owner.cookies,
        body: JSON.stringify({ artworkIds: [redId, blueId, foreignId] }),
      },
    );
    expect(res.status).toBe(200);
    // The foreign id is not in this collection: it is not counted.
    expect(await json(res)).toEqual({ deleted: 2 });

    // Both are tombstoned: the owner can still read one, a visitor cannot.
    const red = await req(
      "GET",
      `/api/v1/collections/${studyWallId}/artworks/${redId}`,
      { cookies: owner.cookies },
    );
    expect(red.status).toBe(200);
    isWireTimestamp((await json<Record<string, unknown>>(red)).deletedAt);
    const visitor = await req(
      "GET",
      `/api/v1/collections/${studyWallId}/artworks/${redId}`,
    );
    expect(visitor.status).toBe(404);

    const live = await json<Record<string, unknown>[]>(
      await req("GET", `/api/v1/collections/${studyWallId}/artworks`, {
        cookies: owner.cookies,
      }),
    );
    expect(live).toEqual([]);
  });

  it("counts zero on ids that are already tombstoned", async () => {
    const res = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/artworks/bulk-delete`,
      {
        cookies: owner.cookies,
        body: JSON.stringify({ artworkIds: [redId] }),
      },
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ deleted: 0 });
  });

  it("rejects an empty selection", async () => {
    const res = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/artworks/bulk-delete`,
      {
        cookies: owner.cookies,
        body: JSON.stringify({ artworkIds: [] }),
      },
    );
    expect(res.status).toBe(400);
    const e = await err(res);
    expect(e.code).toBe("validation");
    expect(e.fields?.artworkIds).toBeTruthy();
  });

  it("403s a non-owner", async () => {
    const res = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/artworks/bulk-delete`,
      {
        cookies: stranger.cookies,
        body: JSON.stringify({ artworkIds: [redId] }),
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /collections/{cid}/artworks/{aid}/restore", () => {
  it("clears the tombstone", async () => {
    const res = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/artworks/${redId}/restore`,
      { cookies: owner.cookies },
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ restored: true });

    const red = await req(
      "GET",
      `/api/v1/collections/${studyWallId}/artworks/${redId}`,
      { cookies: owner.cookies },
    );
    expect((await json<Record<string, unknown>>(red)).deletedAt).toBeNull();

    const live = await json<Record<string, unknown>[]>(
      await req("GET", `/api/v1/collections/${studyWallId}/artworks`, {
        cookies: owner.cookies,
      }),
    );
    expect(live.map((w) => w.title)).toEqual(["Red No. 7"]);
  });

  it("404s a missing work and 403s a non-owner", async () => {
    const missing = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/artworks/${uuid()}/restore`,
      { cookies: owner.cookies },
    );
    expect(missing.status).toBe(404);
    expect((await err(missing)).code).toBe("not-found");

    const foreign = await req(
      "POST",
      `/api/v1/collections/${studyWallId}/artworks/${blueId}/restore`,
      { cookies: stranger.cookies },
    );
    expect(foreign.status).toBe(403);
  });
});

// The owner's half of collection passwords: the settings PATCH sets,
// overwrites and removes a password, revokes the collection's outstanding
// Access grants in the same write, and keeps the hash on a private/public
// round trip. The hash itself is never on the wire, under any read.
//
// This lives in the same file as the anonymous-list tests on purpose: the
// shared test database is one, and a protected public collection left in it
// while those tests run must still be absent from the list — the exclusion
// T6 pins below. Files run in parallel, tests in a file do not.
//
// The visitor's half — unlock, the grant cookie and the lock screen — is in
// protectedCollection.api.test.ts, end to end on the real stack.
describe("the collection password write", () => {
  let pwdOwner: { cookies: string; userId: string };
  let pwdMate: { cookies: string; userId: string };
  let protectedId = "";

  beforeAll(async () => {
    pwdOwner = await freshUser("Pwd");
    pwdMate = await freshUser("Pwd");
  });

  /** The stored hash, read directly: the one fact the wire must never carry. */
  const storedHash = async (): Promise<string | null> => {
    const [row] = await db
      .select({ passwordHash: collectionsTable.passwordHash })
      .from(collectionsTable)
      .where(eq(collectionsTable.id, protectedId));
    return row?.passwordHash ?? null;
  };

  /** No read may carry the hash, nor the key the wire does not have. */
  const expectNoHash = (body: unknown, hash: string | null): void => {
    expect(body).not.toHaveProperty("passwordHash");
    if (hash !== null) {
      expect(JSON.stringify(body)).not.toContain(hash);
    }
  };

  const patch = (cookies: string, body: Record<string, unknown>) =>
    req("PATCH", `/api/v1/collections/${protectedId}`, { cookies, body });

  it("sets a password, marks the member read protected, and never emits the hash", async () => {
    const created = await req("POST", "/api/v1/collections", {
      cookies: pwdOwner.cookies,
      body: JSON.stringify({ name: "Protected Wall" }),
    });
    expect(created.status).toBe(201);
    const createdBody = await json<Record<string, unknown>>(created);
    protectedId = String(createdBody.id);
    // A brand-new member read says so explicitly: the form needs the fact,
    // not an absent key it has to interpret.
    expect(createdBody.isPasswordProtected).toBe(false);
    expectNoHash(createdBody, null);

    const res = await patch(pwdOwner.cookies, {
      name: "Protected Wall",
      isPublic: true,
      password: "first-password",
    });
    expect(res.status).toBe(200);
    const body = await json<Record<string, unknown>>(res);
    expect(body.isPasswordProtected).toBe(true);
    expectNoHash(body, await storedHash());

    const hash = await storedHash();
    // The encoding, not the cost: the parameters are deliberately raisable
    // (ADR-0005), so pinning today's `N` would fail an intentional change.
    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    expect(hash).not.toContain("first-password");

    // The single member read.
    const single = await req("GET", `/api/v1/collections/${protectedId}`, {
      cookies: pwdOwner.cookies,
    });
    expect(single.status).toBe(200);
    const singleBody = await json<Record<string, unknown>>(single);
    expect(singleBody.isPasswordProtected).toBe(true);
    expectNoHash(singleBody, hash);

    // The dashboard list's row.
    const list = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections", { cookies: pwdOwner.cookies }),
    );
    const row = list.find((c) => c.id === protectedId)!;
    expect(row.isPasswordProtected).toBe(true);
    expectNoHash(row, hash);

    // An anonymous read is the challenge: a Protected collection is not
    // readable to a non-member without a grant, and the refusal carries
    // neither the flag nor the hash.
    const anon = await req("GET", `/api/v1/collections/${protectedId}`);
    expect(anon.status).toBe(403);
    const anonBody = await json<Record<string, unknown>>(anon);
    expect("isPasswordProtected" in anonBody).toBe(false);
    expectNoHash(anonBody, hash);

    // The anonymous list's rows carry no flag either.
    const anonList = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections"),
    );
    for (const anonRow of anonList) {
      expect("isPasswordProtected" in anonRow).toBe(false);
      expect("passwordHash" in anonRow).toBe(false);
    }
  });

  it("leaves the password alone when the key is absent", async () => {
    const before = await storedHash();
    const res = await patch(pwdOwner.cookies, {
      name: "Renamed Wall",
      isPublic: true,
    });
    expect(res.status).toBe(200);
    const body = await json<Record<string, unknown>>(res);
    expect(body.isPasswordProtected).toBe(true);
    expect(await storedHash()).toBe(before);
    expectNoHash(body, before);
  });

  it("overwrites the password and revokes the collection's grants in one write", async () => {
    const before = await storedHash();
    await db.insert(grantsTable).values({
      collectionId: protectedId,
      tokenHash: `grant-${uuid()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const res = await patch(pwdOwner.cookies, {
      name: "Renamed Wall",
      isPublic: true,
      password: "second-password",
    });
    expect(res.status).toBe(200);
    const after = await storedHash();
    expect(after).not.toBe(before);

    const grants = await db
      .select({ tokenHash: grantsTable.tokenHash })
      .from(grantsTable)
      .where(eq(grantsTable.collectionId, protectedId));
    expect(grants).toEqual([]);
  });

  it("removes the password and clears the member flag", async () => {
    const res = await patch(pwdOwner.cookies, {
      name: "Renamed Wall",
      isPublic: true,
      password: null,
    });
    expect(res.status).toBe(200);
    const body = await json<Record<string, unknown>>(res);
    expect(body.isPasswordProtected).toBe(false);
    expect(await storedHash()).toBeNull();

    const single = await json<Record<string, unknown>>(
      await req("GET", `/api/v1/collections/${protectedId}`, {
        cookies: pwdOwner.cookies,
      }),
    );
    expect(single.isPasswordProtected).toBe(false);
  });

  it("keeps the password when the collection is made private and public again", async () => {
    const set = await patch(pwdOwner.cookies, {
      name: "Renamed Wall",
      isPublic: true,
      password: "third-password",
    });
    expect(set.status).toBe(200);
    const hash = await storedHash();
    expect(hash).not.toBeNull();

    const off = await patch(pwdOwner.cookies, {
      name: "Renamed Wall",
      isPublic: false,
    });
    expect(off.status).toBe(200);
    const offBody = await json<Record<string, unknown>>(off);
    expect(offBody.isPublic).toBe(false);
    expect(offBody.isPasswordProtected).toBe(true);
    expect(await storedHash()).toBe(hash);

    const on = await patch(pwdOwner.cookies, {
      name: "Renamed Wall",
      isPublic: true,
    });
    expect(on.status).toBe(200);
    const onBody = await json<Record<string, unknown>>(on);
    expect(onBody.isPublic).toBe(true);
    expect(onBody.isPasswordProtected).toBe(true);
    expect(await storedHash()).toBe(hash);
  });

  it("rejects a password shorter than the shared minimum without writing", async () => {
    const before = await storedHash();
    const res = await patch(pwdOwner.cookies, {
      name: "Renamed Wall",
      isPublic: true,
      password: "short",
    });
    expect(res.status).toBe(400);
    const body = await json<{
      error: { code: string; fields?: Record<string, string> };
    }>(res);
    expect(body.error.code).toBe("validation");
    expect(body.error.fields?.password).toBeTruthy();
    expect(await storedHash()).toBe(before);
  });

  it("lets a collaborator set and remove the password, as any other setting", async () => {
    await db
      .insert(collaboratorsTable)
      .values({ collectionId: protectedId, userId: pwdMate.userId });

    const set = await patch(pwdMate.cookies, {
      name: "Renamed Wall",
      isPublic: true,
      password: "mate-password",
    });
    expect(set.status).toBe(200);
    expect((await json<Record<string, unknown>>(set)).isPasswordProtected).toBe(
      true,
    );

    const removed = await patch(pwdMate.cookies, {
      name: "Renamed Wall",
      isPublic: true,
      password: null,
    });
    expect(removed.status).toBe(200);
    expect(
      (await json<Record<string, unknown>>(removed)).isPasswordProtected,
    ).toBe(false);
  });
});

// T6: a Protected collection is shared as a link, not found in an index
// (ADR-0005). The anonymous exclusion is pinned by the list test above, on
// the same fixture the verdict refuses; these are the member's side and the
// artwork list's agreement with the collection read.
describe("a protected collection's members", () => {
  it("still see it in their own lists, with the password flag", async () => {
    const own = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections", { cookies: protOwner.cookies }),
    );
    const ownerRow = own.find((c) => c.id === protectedId);
    expect(ownerRow?.role).toBe("owner");
    expect(ownerRow?.isPasswordProtected).toBe(true);

    const shared = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/collections", { cookies: protMate.cookies }),
    );
    const mateRow = shared.find((c) => c.id === protectedId);
    expect(mateRow?.role).toBe("collaborator");
    expect(mateRow?.isPasswordProtected).toBe(true);
  });

  it("refuses a non-member's artwork list too, though only the collection read can name the challenge", async () => {
    // Anonymous and signed-in stranger are one answer: membership is what
    // admits, and neither holds it. The collection read is the challenge point
    // — it names the collection so the lock screen can ask — while the list
    // has no lock screen to open and stays the plain refusal. The public page
    // never sees the second: it asks for the list only once the collection
    // read has answered, and this one refuses first.
    for (const cookies of [undefined, stranger.cookies]) {
      const read = await req("GET", `/api/v1/collections/${protectedId}`, {
        cookies,
      });
      expect(read.status).toBe(403);
      expect((await err(read)).code).toBe("password-required");

      const list = await req(
        "GET",
        `/api/v1/collections/${protectedId}/artworks`,
        { cookies },
      );
      expect(list.status).toBe(403);
      expect((await err(list)).code).toBe("forbidden");
    }
  });
});
