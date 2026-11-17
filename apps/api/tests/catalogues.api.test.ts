// The catalogue resource routes: list/create with the tier cap, the
// owner/visitor reads, the settings-form PATCH (absent-leave / null-clear),
// the CSV import's mixed-batch contract, the bulk soft delete, and the
// single restore — driven in-process with app.request() against the
// real stack.
//
// The beta cap is ten catalogues per free account. Extra rows a test still
// needs are inserted directly through drizzle, so each fixture's shape is
// chosen by the test rather than by the cap — the cap has its own case.

import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  catalogueAccessGrants as grantsTable,
  catalogueCollaborators as collaboratorsTable,
  catalogues as cataloguesTable,
  user as userTable,
} from "@arcula/db";
import { CATALOGUE_LIMITS, MINTED_ID_RE } from "@arcula/shared";
import { canSeeCatalogue, membershipOf } from "../src/access";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, listedArtworks, req, uuid } from "./helpers/api";
import { seedCatalogues } from "./helpers/fixtures";

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

// The Protected fixture the list tests share: a public catalogue with a
// password, made through the settings write path. It is created before any
// list reads so the anonymous list is always exercised with a protected row
// in the database.
let protOwner: { cookies: string; userId: string; email: string };
let protMate: { cookies: string; userId: string };
let protectedId = "";

// Module-level ids, set by the test that creates them: each fixture user
// creates one catalogue through the API, and the later describes reuse
// what the earlier ones made.
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
  const created = await req("POST", "/api/v1/catalogues", {
    cookies: protOwner.cookies,
    body: JSON.stringify({ name: "Protected By Link" }),
  });
  expect(created.status).toBe(201);
  protectedId = String((await json<Record<string, unknown>>(created)).id);
  // Through the settings write path, not a hand-written row: the fixture is
  // what the product actually stores when an owner sets a password.
  const locked = await req("PATCH", `/api/v1/catalogues/${protectedId}`, {
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
    .values({ catalogueId: protectedId, userId: protMate.userId });
});

afterAll(async () => {
  await closeDb();
});

describe("POST /catalogues", () => {
  it("creates with the exact document shape", async () => {
    const res = await req("POST", "/api/v1/catalogues", {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "Study Wall", description: "" }),
    });
    expect(res.status).toBe(201);
    const body = await json<Record<string, unknown>>(res);
    // The exact wire document shape: no blank keys, no extras. A brand-new
    // catalogue is a member read, so it carries the password state.
    expect(Object.keys(body).sort()).toEqual([
      "createdAt",
      "id",
      "isPasswordProtected",
      "isPublic",
      "kind",
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
  });

  it("stops an account at the free-tier cap, and validates before it does", async () => {
    const capped = await freshUser("Cap");
    // Fill to one below the cap directly: the cap is the route's rule, so
    // the fixture must not spend a create proving the table works.
    await seedCatalogues(capped.userId, CATALOGUE_LIMITS.free - 1);

    // The last create the cap allows.
    const atCap = await req("POST", "/api/v1/catalogues", {
      cookies: capped.cookies,
      body: JSON.stringify({ name: "The Cap Wall" }),
    });
    expect(atCap.status).toBe(201);

    // Validation runs before the cap check: at the cap the failure is about
    // the body, not the quota.
    const blank = await req("POST", "/api/v1/catalogues", {
      cookies: capped.cookies,
      body: JSON.stringify({ name: "   " }),
    });
    expect(blank.status).toBe(400);
    const e = await err(blank);
    expect(e.code).toBe("validation");
    expect(e.fields?.name).toBeTruthy();

    // One over the cap is refused.
    const over = await req("POST", "/api/v1/catalogues", {
      cookies: capped.cookies,
      body: JSON.stringify({ name: "Over The Cap" }),
    });
    expect(over.status).toBe(409);
    expect((await err(over)).code).toBe("limit-reached");
  });

  it("honours explicit values", async () => {
    const res = await req("POST", "/api/v1/catalogues", {
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
  });
});

describe("GET /catalogues", () => {
  it("lists each caller's own catalogues name-ordered; anon sees only the public, unprotected ones", async () => {
    // A second, private catalogue inserted directly: this test controls the
    // list's names and order, and the create route has its own case.
    await db.insert(cataloguesTable).values({
      id: uuid(),
      userId: owner.userId,
      mediaNamespaceId: uuid(),
      name: "AAA Test Wall",
      isPublic: false,
    });

    const own = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues", { cookies: owner.cookies }),
    );
    expect(own.map((c) => c.name)).toEqual(["AAA Test Wall", "Study Wall"]);

    const theirs = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues", { cookies: stranger.cookies }),
    );
    expect(theirs.map((c) => c.name)).toEqual(["Private Wall"]);

    // The test stack persists across runs, so the anon public list also
    // holds earlier runs' public catalogues: assert membership, not the
    // exact list.
    const anon = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues"),
    );
    const anonNames = anon.map((c) => c.name);
    expect(anonNames).toContain("Study Wall");
    expect(anonNames).not.toContain("AAA Test Wall");
    expect(anonNames).not.toContain("Private Wall");
    // A Protected catalogue is excluded exactly as a Private one is, and the
    // same fixture is refused by the pure verdict: the SQL filter and
    // canSeeCatalogue agree on that row.
    expect(anonNames).not.toContain("Protected By Link");
    const [protectedRow] = await db
      .select()
      .from(cataloguesTable)
      .where(eq(cataloguesTable.id, protectedId));
    if (!protectedRow) {
      throw new Error("the protected fixture is not stored");
    }
    expect(
      canSeeCatalogue(membershipOf(null, protectedRow, null), protectedRow),
    ).toBe(false);

    // The public list's SQL filter is the anonymous verdict in access.ts
    // spelled in SQL: every row it returns is one canSeeCatalogue admits.
    // Assert against the stored rows, not the wire rows, so a listed Protected
    // catalogue would be caught by the verdict's own password check. One
    // read for the whole list: a per-row read would time out once earlier runs
    // have filled the shared dev database.
    const storedRows = await db
      .select()
      .from(cataloguesTable)
      .where(
        inArray(
          cataloguesTable.id,
          anon.map((row) => row.id as string),
        ),
      );
    expect(storedRows).toHaveLength(anon.length);
    for (const stored of storedRows) {
      expect(
        canSeeCatalogue(membershipOf(null, stored, null), stored),
        `the anonymous list returned ${stored.name}`,
      ).toBe(true);
    }
  });

  it("returns owned and shared catalogues in one name-ordered list, each row with its role", async () => {
    // One catalogue of the owner's, shared with `mate`, who also owns one of
    // their own: the list is one list, distinguished by the row's role. The
    // two names are chosen so the order can only come from the sort — "Aaa"
    // is the SHARED one — because the route builds owned rows first and a
    // list that forgot to sort would answer them the other way round.
    sharedBoardId = uuid();
    await db.insert(cataloguesTable).values({
      id: sharedBoardId,
      userId: owner.userId,
      mediaNamespaceId: uuid(),
      name: "Aaa Shared Board",
      isPublic: false,
    });
    await db.insert(collaboratorsTable).values({
      catalogueId: sharedBoardId,
      userId: mate.userId,
    });
    const own = await req("POST", "/api/v1/catalogues", {
      cookies: mate.cookies,
      body: JSON.stringify({ name: "Zzz Mate Owned" }),
    });
    expect(own.status).toBe(201);

    const theirs = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues", { cookies: mate.cookies }),
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
      await req("GET", "/api/v1/catalogues", { cookies: owner.cookies }),
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
        await req("GET", "/api/v1/catalogues", { cookies: mate.cookies }),
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
      await req("GET", "/api/v1/catalogues"),
    );
    expect(anon.map((c) => c.name)).toContain("Study Wall");
    for (const row of anon) {
      expect("role" in row).toBe(false);
      expect("ownerName" in row).toBe(false);
    }
  });

  it("does not put another account's shared catalogue on a signed-in visitor's list", async () => {
    const theirs = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues", { cookies: stranger.cookies }),
    );
    expect(theirs.map((c) => c.name)).toEqual(["Private Wall"]);
  });
});

describe("GET /catalogues/{cid}", () => {
  it("serves a public catalogue to anyone and 404s a missing one", async () => {
    const own = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues", { cookies: owner.cookies }),
    );
    studyWallId = String(own.find((c) => c.name === "Study Wall")?.id);
    expect(studyWallId).toMatch(MINTED_ID_RE);

    const missing = await req("GET", `/api/v1/catalogues/${uuid()}`);
    expect(missing.status).toBe(404);
    expect((await err(missing)).code).toBe("not-found");

    for (const cookies of [owner.cookies, stranger.cookies, undefined]) {
      const res = await req("GET", `/api/v1/catalogues/${studyWallId}`, {
        cookies,
      });
      expect(res.status).toBe(200);
      expect((await json<Record<string, unknown>>(res)).name).toBe(
        "Study Wall",
      );
    }
  });

  it("403s a visitor on a private catalogue and still serves the owner", async () => {
    const off = await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "Study Wall", isPublic: false }),
    });
    expect(off.status).toBe(200);
    expect((await json<Record<string, unknown>>(off)).isPublic).toBe(false);

    const visitor = await req("GET", `/api/v1/catalogues/${studyWallId}`, {
      cookies: stranger.cookies,
    });
    expect(visitor.status).toBe(403);
    expect((await err(visitor)).code).toBe("forbidden");

    const anon = await req("GET", `/api/v1/catalogues/${studyWallId}`);
    expect(anon.status).toBe(403);

    const own = await req("GET", `/api/v1/catalogues/${studyWallId}`, {
      cookies: owner.cookies,
    });
    expect(own.status).toBe(200);

    // Back to public: the later describes read it as a visitor.
    const on = await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "Study Wall", isPublic: true }),
    });
    expect(on.status).toBe(200);
    expect((await json<Record<string, unknown>>(on)).isPublic).toBe(true);
  });
});

describe("PATCH /catalogues/{cid}", () => {
  it("sets present fields, leaves absent ones, clears nulls", async () => {
    const set = await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
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
    const noChange = await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "Renamed", isPublic: true }),
    });
    expect(noChange.status).toBe(200);
    body = await json<Record<string, unknown>>(noChange);
    expect(body.description).toBe("About the wall");
    expect(body.skin).toBe("basicx");
    expect(body.skinOptions).toEqual({ transitionSeconds: 1 });

    // null clears: the key is gone from the document, not set to null.
    const clear = await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
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

    await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({
        name: "Study Wall",
        isPublic: true,
        skinOptions: null,
      }),
    });
  });

  it("leaves every other column alone for a body that names one field", async () => {
    const before = await json<Record<string, unknown>>(
      await req("GET", `/api/v1/catalogues/${studyWallId}`, {
        cookies: owner.cookies,
      }),
    );

    // One key only: what the body does not name stays exactly as it was —
    // the settings tabs' per-tab saves are built on exactly this.
    const one = await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ description: "One field only" }),
    });
    expect(one.status).toBe(200);
    const after = await json<Record<string, unknown>>(one);
    expect(after.description).toBe("One field only");
    expect(after.name).toBe(before.name);
    expect(after.isPublic).toBe(before.isPublic);
    expect(after.isPasswordProtected).toBe(before.isPasswordProtected);
    // Absent optional keys stay absent: naming one field does not mint the
    // rest of the document.
    expect("skin" in after).toBe("skin" in before);
    expect("skinOptions" in after).toBe("skinOptions" in before);

    // Leave the fixture as the next describes find it.
    await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ description: null }),
    });
  });

  it("answers a valid no-op for a body that names nothing", async () => {
    const before = await json<Record<string, unknown>>(
      await req("GET", `/api/v1/catalogues/${studyWallId}`, {
        cookies: owner.cookies,
      }),
    );

    const noop = await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({}),
    });
    expect(noop.status).toBe(200);
    // No column moves and the timestamp is not moved: the document comes
    // back exactly as it was, `updatedAt` deep equal to the read that stood
    // before the write.
    expect(await json<Record<string, unknown>>(noop)).toEqual(before);
  });

  it("rejects a blank name with the failed field", async () => {
    const res = await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ name: "  ", isPublic: true }),
    });
    expect(res.status).toBe(400);
    const e = await err(res);
    expect(e.code).toBe("validation");
    expect(e.fields?.name).toBeTruthy();
  });

  it("403s a non-owner", async () => {
    const res = await req("PATCH", `/api/v1/catalogues/${studyWallId}`, {
      cookies: stranger.cookies,
      body: JSON.stringify({ name: "Hijacked", isPublic: true }),
    });
    expect(res.status).toBe(403);
    expect((await err(res)).code).toBe("forbidden");
  });
});

describe("POST /catalogues/{cid}/import/csv", () => {
  it("inserts the valid rows and reports broken ones by index", async () => {
    const res = await req(
      "POST",
      `/api/v1/catalogues/${studyWallId}/import/csv`,
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

    const list = await listedArtworks(
      await req("GET", `/api/v1/catalogues/${studyWallId}/artworks`, {
        cookies: owner.cookies,
      }),
    );
    expect(list).toHaveLength(2);
    const byTitle = new Map(list.map((w) => [w.title, w]));
    const red = byTitle.get("Red No. 7")!;
    redId = red.id;
    blueId = byTitle.get("Blue No. 9")!.id;
    expect(redId).toMatch(MINTED_ID_RE);
    expect(red.serie).toBe("Reds");
    expect(red.acquisitionDate).toBe("2024-05-01");
    // A blank optional field is an absent key, not an empty one.
    expect("medium" in red).toBe(false);
    // A row that names a status is not obeyed: an import is the owner adding
    // works to a catalogue, so every imported work is published.
    expect(red.status).toBe("published");
    expect(red.deletedAt).toBeNull();
    expect(byTitle.get("Blue No. 9")!.status).toBe("published");
  });

  it("puts every imported work on the visitor list, since all are published", async () => {
    const visitor = await listedArtworks(
      await req("GET", `/api/v1/catalogues/${studyWallId}/artworks`),
    );
    expect(visitor.map((w) => w.title).sort()).toEqual([
      "Blue No. 9",
      "Red No. 7",
    ]);
  });

  it("403s a non-owner, 401s an anonymous call, 400s a non-array rows", async () => {
    const foreign = await req(
      "POST",
      `/api/v1/catalogues/${studyWallId}/import/csv`,
      {
        cookies: stranger.cookies,
        body: JSON.stringify({ rows: [{ title: "X", artistName: "Y" }] }),
      },
    );
    expect(foreign.status).toBe(403);

    const anon = await req(
      "POST",
      `/api/v1/catalogues/${studyWallId}/import/csv`,
      {
        body: JSON.stringify({ rows: [] }),
      },
    );
    expect(anon.status).toBe(401);

    const notArray = await req(
      "POST",
      `/api/v1/catalogues/${studyWallId}/import/csv`,
      {
        cookies: owner.cookies,
        body: JSON.stringify({ rows: "nope" }),
      },
    );
    expect(notArray.status).toBe(400);
    expect((await err(notArray)).fields?.rows).toBeTruthy();
  });
});

describe("POST /catalogues/{cid}/artworks/bulk-delete", () => {
  it("tombstones the live works in one go and counts only what moved", async () => {
    // A work in another user's catalogue, for the foreign-id case.
    const strangerWall = (
      await json<Record<string, unknown>[]>(
        await req("GET", "/api/v1/catalogues", { cookies: stranger.cookies }),
      )
    )[0];
    const strangerWallId = String(strangerWall.id);
    const foreignCreate = await req(
      "POST",
      `/api/v1/catalogues/${strangerWallId}/artworks`,
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
      `/api/v1/catalogues/${studyWallId}/artworks/bulk-delete`,
      {
        cookies: owner.cookies,
        body: JSON.stringify({ artworkIds: [redId, blueId, foreignId] }),
      },
    );
    expect(res.status).toBe(200);
    // The foreign id is not in this catalogue: it is not counted.
    expect(await json(res)).toEqual({ deleted: 2 });

    // Both are tombstoned: the owner can still read one, a visitor cannot.
    const red = await req(
      "GET",
      `/api/v1/catalogues/${studyWallId}/artworks/${redId}`,
      { cookies: owner.cookies },
    );
    expect(red.status).toBe(200);
    isWireTimestamp((await json<Record<string, unknown>>(red)).deletedAt);
    const visitor = await req(
      "GET",
      `/api/v1/catalogues/${studyWallId}/artworks/${redId}`,
    );
    expect(visitor.status).toBe(404);

    const live = await listedArtworks(
      await req("GET", `/api/v1/catalogues/${studyWallId}/artworks`, {
        cookies: owner.cookies,
      }),
    );
    expect(live).toEqual([]);
  });

  it("counts zero on ids that are already tombstoned", async () => {
    const res = await req(
      "POST",
      `/api/v1/catalogues/${studyWallId}/artworks/bulk-delete`,
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
      `/api/v1/catalogues/${studyWallId}/artworks/bulk-delete`,
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
      `/api/v1/catalogues/${studyWallId}/artworks/bulk-delete`,
      {
        cookies: stranger.cookies,
        body: JSON.stringify({ artworkIds: [redId] }),
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /catalogues/{cid}/artworks/{aid}/restore", () => {
  it("clears the tombstone", async () => {
    const res = await req(
      "POST",
      `/api/v1/catalogues/${studyWallId}/artworks/${redId}/restore`,
      { cookies: owner.cookies },
    );
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ restored: true });

    const red = await req(
      "GET",
      `/api/v1/catalogues/${studyWallId}/artworks/${redId}`,
      { cookies: owner.cookies },
    );
    expect((await json<Record<string, unknown>>(red)).deletedAt).toBeNull();

    const live = await listedArtworks(
      await req("GET", `/api/v1/catalogues/${studyWallId}/artworks`, {
        cookies: owner.cookies,
      }),
    );
    expect(live.map((w) => w.title)).toEqual(["Red No. 7"]);
  });

  it("404s a missing work and 403s a non-owner", async () => {
    const missing = await req(
      "POST",
      `/api/v1/catalogues/${studyWallId}/artworks/${uuid()}/restore`,
      { cookies: owner.cookies },
    );
    expect(missing.status).toBe(404);
    expect((await err(missing)).code).toBe("not-found");

    const foreign = await req(
      "POST",
      `/api/v1/catalogues/${studyWallId}/artworks/${blueId}/restore`,
      { cookies: stranger.cookies },
    );
    expect(foreign.status).toBe(403);
  });
});

// The owner's half of catalogue passwords: the settings PATCH sets,
// overwrites and removes a password, revokes the catalogue's outstanding
// Access grants in the same write, and keeps the hash on a private/public
// round trip. The hash itself is never on the wire, under any read.
//
// This lives in the same file as the anonymous-list tests on purpose: the
// shared test database is one, and a protected public catalogue left in it
// while those tests run must still be absent from the list — the exclusion
// T6 pins below. Files run in parallel, tests in a file do not.
//
// The visitor's half — unlock, the grant cookie and the lock screen — is in
// protectedCatalogue.api.test.ts, end to end on the real stack.
describe("the catalogue password write", () => {
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
      .select({ passwordHash: cataloguesTable.passwordHash })
      .from(cataloguesTable)
      .where(eq(cataloguesTable.id, protectedId));
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
    req("PATCH", `/api/v1/catalogues/${protectedId}`, { cookies, body });

  it("sets a password, marks the member read protected, and never emits the hash", async () => {
    const created = await req("POST", "/api/v1/catalogues", {
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
    const single = await req("GET", `/api/v1/catalogues/${protectedId}`, {
      cookies: pwdOwner.cookies,
    });
    expect(single.status).toBe(200);
    const singleBody = await json<Record<string, unknown>>(single);
    expect(singleBody.isPasswordProtected).toBe(true);
    expectNoHash(singleBody, hash);

    // The dashboard list's row.
    const list = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues", { cookies: pwdOwner.cookies }),
    );
    const row = list.find((c) => c.id === protectedId)!;
    expect(row.isPasswordProtected).toBe(true);
    expectNoHash(row, hash);

    // An anonymous read is the challenge: a Protected catalogue is not
    // readable to a non-member without a grant, and the refusal carries
    // neither the flag nor the hash.
    const anon = await req("GET", `/api/v1/catalogues/${protectedId}`);
    expect(anon.status).toBe(403);
    const anonBody = await json<Record<string, unknown>>(anon);
    expect("isPasswordProtected" in anonBody).toBe(false);
    expectNoHash(anonBody, hash);

    // The anonymous list's rows carry no flag either.
    const anonList = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues"),
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

  it("overwrites the password and revokes the catalogue's grants in one write", async () => {
    const before = await storedHash();
    await db.insert(grantsTable).values({
      catalogueId: protectedId,
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
      .where(eq(grantsTable.catalogueId, protectedId));
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
      await req("GET", `/api/v1/catalogues/${protectedId}`, {
        cookies: pwdOwner.cookies,
      }),
    );
    expect(single.isPasswordProtected).toBe(false);
  });

  it("keeps the password when the catalogue is made private and public again", async () => {
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
      .values({ catalogueId: protectedId, userId: pwdMate.userId });

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

// T6: a Protected catalogue is shared as a link, not found in an index
// (ADR-0005). The anonymous exclusion is pinned by the list test above, on
// the same fixture the verdict refuses; these are the member's side and the
// artwork list's agreement with the catalogue read.
describe("a protected catalogue's members", () => {
  it("still see it in their own lists, with the password flag", async () => {
    const own = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues", { cookies: protOwner.cookies }),
    );
    const ownerRow = own.find((c) => c.id === protectedId);
    expect(ownerRow?.role).toBe("owner");
    expect(ownerRow?.isPasswordProtected).toBe(true);

    const shared = await json<Record<string, unknown>[]>(
      await req("GET", "/api/v1/catalogues", { cookies: protMate.cookies }),
    );
    const mateRow = shared.find((c) => c.id === protectedId);
    expect(mateRow?.role).toBe("collaborator");
    expect(mateRow?.isPasswordProtected).toBe(true);
  });

  it("refuses a non-member's artwork list too, though only the catalogue read can name the challenge", async () => {
    // Anonymous and signed-in stranger are one answer: membership is what
    // admits, and neither holds it. The catalogue read is the challenge point
    // — it names the catalogue so the lock screen can ask — while the list
    // has no lock screen to open and stays the plain refusal. The public page
    // never sees the second: it asks for the list only once the catalogue
    // read has answered, and this one refuses first.
    for (const cookies of [undefined, stranger.cookies]) {
      const read = await req("GET", `/api/v1/catalogues/${protectedId}`, {
        cookies,
      });
      expect(read.status).toBe(403);
      expect((await err(read)).code).toBe("password-required");

      const list = await req(
        "GET",
        `/api/v1/catalogues/${protectedId}/artworks`,
        { cookies },
      );
      expect(list.status).toBe(403);
      expect((await err(list)).code).toBe("forbidden");
    }
  });
});
