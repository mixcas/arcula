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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { collections as collectionsTable } from "@arcula/db";
import { MINTED_ID_RE } from "@arcula/shared";
import { app } from "../src/app";
import { closeDb, db } from "../src/db";

const API = "http://localhost:8000";
const ORIGIN = "http://localhost:3000";

async function req(
  method: string,
  path: string,
  opts: {
    cookies?: string;
    body?: string;
  } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cookies) headers.Cookie = opts.cookies;
  headers.Origin = ORIGIN;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  return await app.request(`${API}${path}`, {
    method,
    headers,
    body: opts.body,
  });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** The error envelope: the code, plus the failed fields. */
async function err(
  res: Response,
): Promise<{ code: string; fields?: Record<string, string> }> {
  const body = await json<{
    error: { code: string; fields?: Record<string, string> };
  }>(res);
  return body.error;
}

async function freshUser(): Promise<{ cookies: string; userId: string }> {
  const email = `coll-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;
  const up = await req("POST", "/api/auth/sign-up/email", {
    body: JSON.stringify({
      email,
      password: "coll-pass-12345",
      name: "Coll Test",
    }),
  });
  expect(up.status).toBe(200);
  const cookies = up.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((c) => !c.includes("Max-Age=0"))
    .join("; ");
  const me = await json<{ id: string }>(
    await req("GET", "/api/v1/me", { cookies }),
  );
  return { cookies, userId: me.id };
}

const uuid = () => crypto.randomUUID();

/** The wire timestamp is `{ seconds, nanoseconds }`. */
function isWireTimestamp(value: unknown): void {
  expect(Object.keys(value as Record<string, unknown>).sort()).toEqual([
    "nanoseconds",
    "seconds",
  ]);
}

let owner: { cookies: string; userId: string };
let stranger: { cookies: string; userId: string };

// Module-level ids, set by the test that creates them: the cap leaves
// each user one collection, so the later describes reuse what the
// earlier ones made.
let studyWallId = "";
let redId = "";
let blueId = "";
let foreignId = "";

beforeAll(async () => {
  owner = await freshUser();
  stranger = await freshUser();
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
    // The exact wire document shape: no blank keys, no extras.
    expect(Object.keys(body).sort()).toEqual([
      "createdAt",
      "id",
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
  it("lists each caller's own collections name-ordered; anon sees only the public ones", async () => {
    // A second, private collection the API cap would refuse: inserted
    // directly so the cap stays a route property, not a table property.
    await db.insert(collectionsTable).values({
      id: uuid(),
      userId: owner.userId,
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
            { title: "Blue No. 9", artistName: "C. Cas", isPublic: false },
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
    // The row said nothing about isPublic: the schema default stands.
    expect(red.isPublic).toBe(true);
    expect(red.deletedAt).toBeNull();
    expect(byTitle.get("Blue No. 9")!.isPublic).toBe(false);
  });

  it("keeps a private imported work off the visitor list", async () => {
    const visitor = await json<Record<string, unknown>[]>(
      await req("GET", `/api/v1/collections/${studyWallId}/artworks`),
    );
    expect(visitor.map((w) => w.title)).toEqual(["Red No. 7"]);
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
