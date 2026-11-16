// The Catalogue alias, which exists only during the rename's expand window
// (ADR-0010, #244): every Collection path is also registered under
// `/api/v1/catalogues`, with the same handlers, and nothing about the old name
// changes. These tests drive both spellings against the real stack and compare
// the wire answers, so a path that was not aliased shows up as a 404 rather
// than as a rename that half landed.
//
// The bodies are compared whole rather than field by field: "the alias answers
// identically" is the requirement, and a difference in either direction means
// the two spellings are not the same resource.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb } from "../src/db";
import { freshUser, json, req, uuid } from "./helpers/api";

let owner: Awaited<ReturnType<typeof freshUser>>;
let collectionId = "";

beforeAll(async () => {
  owner = await freshUser("Alias");

  // Created through the Collection spelling: the alias has to reach rows the
  // old name made, not only rows it made itself.
  const created = await req("POST", "/api/v1/collections", {
    cookies: owner.cookies,
    body: { name: "Aliased Catalogue" },
  });
  expect(created.status).toBe(201);
  collectionId = String((await json<Record<string, unknown>>(created)).id);
});

afterAll(async () => {
  await closeDb();
});

describe("the Catalogue alias", () => {
  it("lists the same Catalogues as the Collection path", async () => {
    const legacy = await req("GET", "/api/v1/collections", {
      cookies: owner.cookies,
    });
    const aliased = await req("GET", "/api/v1/catalogues", {
      cookies: owner.cookies,
    });

    expect(legacy.status).toBe(200);
    expect(aliased.status).toBe(legacy.status);
    expect(await json(aliased)).toEqual(await json(legacy));
  });

  it("reads through /catalogues/:id what /collections/:id created", async () => {
    const legacy = await req("GET", `/api/v1/collections/${collectionId}`, {
      cookies: owner.cookies,
    });
    const aliased = await req("GET", `/api/v1/catalogues/${collectionId}`, {
      cookies: owner.cookies,
    });

    expect(legacy.status).toBe(200);
    expect(aliased.status).toBe(legacy.status);
    expect(await json(aliased)).toEqual(await json(legacy));
  });

  it("writes settings through the alias and reads them through the old path", async () => {
    const written = await req("PATCH", `/api/v1/catalogues/${collectionId}`, {
      cookies: owner.cookies,
      body: { name: "Renamed Through the Alias", isPublic: false },
    });
    expect(written.status).toBe(200);

    const read = await req("GET", `/api/v1/collections/${collectionId}`, {
      cookies: owner.cookies,
    });
    expect(read.status).toBe(200);
    const body = await json<Record<string, unknown>>(read);
    expect(body.name).toBe("Renamed Through the Alias");
    expect(body.isPublic).toBe(false);
  });

  it("creates an artwork under the alias and reads it through the old path", async () => {
    const artworkId = uuid();
    const created = await req(
      "POST",
      `/api/v1/catalogues/${collectionId}/artworks`,
      {
        cookies: owner.cookies,
        body: {
          artworkId,
          title: "Work Made Under the Alias",
          artistName: "A. Artist",
        },
      },
    );
    expect(created.status).toBe(201);

    const read = await req(
      "GET",
      `/api/v1/collections/${collectionId}/artworks/${artworkId}`,
      { cookies: owner.cookies },
    );
    expect(read.status).toBe(200);
    expect(await json(read)).toEqual(await json(created));
  });

  it("answers the access read under both names", async () => {
    const legacy = await req(
      "GET",
      `/api/v1/collections/${collectionId}/access`,
      {
        cookies: owner.cookies,
      },
    );
    const aliased = await req(
      "GET",
      `/api/v1/catalogues/${collectionId}/access`,
      {
        cookies: owner.cookies,
      },
    );

    expect(legacy.status).toBe(200);
    expect(aliased.status).toBe(legacy.status);
    expect(await json(aliased)).toEqual(await json(legacy));
  });

  it("creates an invitation through the alias and reads it in the old access view", async () => {
    const invited = `alias-invite-${uuid()}@example.test`;
    const created = await req(
      "POST",
      `/api/v1/catalogues/${collectionId}/invitations`,
      { cookies: owner.cookies, body: { email: invited } },
    );
    expect(created.status).toBe(201);
    const body = await json<{
      invitation: { email: string; collectionId: string };
    }>(created);
    expect(body.invitation.email).toBe(invited);
    expect(body.invitation.collectionId).toBe(collectionId);

    const access = await req(
      "GET",
      `/api/v1/collections/${collectionId}/access`,
      { cookies: owner.cookies },
    );
    expect(access.status).toBe(200);
    const view = await json<{ invitations: { email: string }[] }>(access);
    expect(view.invitations.map((row) => row.email)).toContain(invited);
  });

  it("answers the artwork media routes under both names", async () => {
    const list = await req(
      "GET",
      `/api/v1/collections/${collectionId}/artworks`,
      {
        cookies: owner.cookies,
      },
    );
    expect(list.status).toBe(200);
    const [work] = await json<{ id: string }[]>(list);
    expect(work).toBeDefined();

    // Discarding an entry that was never staged is the route's idempotent
    // case, so the two answers are comparable without an upload.
    const entryId = uuid();
    const legacy = await req(
      "DELETE",
      `/api/v1/collections/${collectionId}/artworks/${work.id}/photos/${entryId}`,
      { cookies: owner.cookies },
    );
    const aliased = await req(
      "DELETE",
      `/api/v1/catalogues/${collectionId}/artworks/${work.id}/photos/${entryId}`,
      { cookies: owner.cookies },
    );

    expect(legacy.status).toBe(200);
    expect(aliased.status).toBe(legacy.status);
    expect(await json(aliased)).toEqual(await json(legacy));
  });
});
