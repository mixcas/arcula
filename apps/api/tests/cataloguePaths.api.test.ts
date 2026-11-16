// The contract step's one wire fact: the old `/collections` route family is
// gone. `/api/v1/catalogues` is the only spelling, so a link written before
// the rename answers not-found instead of a second copy of the same resource
// (ADR-0010, #248).
//
// Both requests are the family's own — the list, and a nested path under one
// catalogue — because those were registered per route, so a leftover alias
// would have been easy to leave behind on exactly one of them.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../src/db";
import { freshUser, json, req } from "./helpers/api";

let owner: Awaited<ReturnType<typeof freshUser>>;
let catalogueId = "";

beforeAll(async () => {
  owner = await freshUser("OldPath");
  const created = await req("POST", "/api/v1/catalogues", {
    cookies: owner.cookies,
    body: { name: "Only Spelling" },
  });
  expect(created.status).toBe(201);
  catalogueId = String((await json<Record<string, unknown>>(created)).id);
});

afterAll(async () => {
  await closeDb();
});

describe("the retired /collections paths", () => {
  it("answers not-found for the list that used to answer there", async () => {
    const res = await req("GET", "/api/v1/collections", {
      cookies: owner.cookies,
    });

    expect(res.status).toBe(404);
    // Hono's own not-found, not this API's error envelope: the path matches
    // no route at all, which is the point.
    expect(await res.text()).toContain("404");
  });

  it("answers not-found for a nested path under the old name", async () => {
    const res = await req(
      "GET",
      `/api/v1/collections/${catalogueId}/artworks`,
      { cookies: owner.cookies },
    );

    expect(res.status).toBe(404);
    expect(await res.text()).toContain("404");
  });

  it("still answers the catalogue spelling those paths moved to", async () => {
    const res = await req("GET", `/api/v1/catalogues/${catalogueId}`, {
      cookies: owner.cookies,
    });

    expect(res.status).toBe(200);
    expect((await json<Record<string, unknown>>(res)).name).toBe(
      "Only Spelling",
    );
  });
});
