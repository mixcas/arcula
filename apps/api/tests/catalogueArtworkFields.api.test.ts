// A Catalogue's Artwork fields over the wire: the sparse deviations the member
// chose, stored normalised against the Kind's defaults, carried on every read
// (visitors included) and changeable by any member.
//
// Driven in-process with app.request() against the real stack, so the Zod
// contract, the row and the serializer meet exactly as they do in production.
// The one fact that needs the table itself is the storage shape: "back to
// defaults" must leave `null`, never an empty object.

import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  catalogueCollaborators as collaboratorsTable,
  catalogues as cataloguesTable,
} from "@arcula/db";
import type { Catalogue } from "@arcula/shared";
import { closeDb, db } from "../src/db";
import { err, freshUser, json, req } from "./helpers/api";
import { makeCatalogue } from "./helpers/fixtures";

afterAll(async () => {
  await closeDb();
});

const patch = (cookies: string, id: string, body: Record<string, unknown>) =>
  req("PATCH", `/api/v1/catalogues/${id}`, {
    cookies,
    body: JSON.stringify(body),
  });

const readAs = (cookies: string | undefined, id: string) =>
  req("GET", `/api/v1/catalogues/${id}`, { cookies });

/** The stored column, read straight from the row. */
const storedFields = async (id: string) => {
  const [row] = await db
    .select({ artworkFields: cataloguesTable.artworkFields })
    .from(cataloguesTable)
    .where(eq(cataloguesTable.id, id));
  return row.artworkFields;
};

describe("PATCH /catalogues — the Artwork fields map", () => {
  it("round-trips a deviation on the response and every read", async () => {
    const owner = await freshUser("FieldsOwner");
    const cid = await makeCatalogue(owner.userId, { kind: "portfolio" });

    // A Portfolio defaults acquisition price off; switching it on is the
    // direction a disabled-list could not express.
    const saved = await patch(owner.cookies, cid, {
      artworkFields: { acquisitionPrice: true },
    });
    expect(saved.status).toBe(200);
    expect((await json<Catalogue>(saved)).artworkFields).toEqual({
      acquisitionPrice: true,
    });

    const member = await json<Catalogue>(await readAs(owner.cookies, cid));
    expect(member.artworkFields).toEqual({ acquisitionPrice: true });

    // The public read carries them too: the PDF is a public address and
    // resolves the same enabled set from them.
    const visitor = await readAs(undefined, cid);
    expect(visitor.status).toBe(200);
    expect((await json<Catalogue>(visitor)).artworkFields).toEqual({
      acquisitionPrice: true,
    });
  });

  it("normalises the stored map: an entry equal to the default is dropped", async () => {
    const owner = await freshUser("FieldsNormalise");
    const cid = await makeCatalogue(owner.userId, { kind: "collection" });

    // `serie: true` restates a Collection default; only `notes: false` is a
    // choice. The stored map carries the choice alone.
    const saved = await patch(owner.cookies, cid, {
      artworkFields: { serie: true, notes: false },
    });
    expect(saved.status).toBe(200);
    expect((await json<Catalogue>(saved)).artworkFields).toEqual({
      notes: false,
    });
    expect(await storedFields(cid)).toEqual({ notes: false });
  });

  it("resets to defaults on an empty map and stores null, not {}", async () => {
    const owner = await freshUser("FieldsReset");
    const cid = await makeCatalogue(owner.userId, { kind: "portfolio" });
    expect(
      (
        await patch(owner.cookies, cid, {
          artworkFields: { acquisitionPrice: true },
        })
      ).status,
    ).toBe(200);

    // Reset sends `{}`; the route normalises it against the row's own Kind.
    const reset = await patch(owner.cookies, cid, { artworkFields: {} });
    expect(reset.status).toBe(200);
    const body = await json<Catalogue>(reset);
    expect(body).not.toHaveProperty("artworkFields");

    // The column holds null — the state a catalogue that never deviated has,
    // not an empty object the next reader would have to special-case.
    expect(await storedFields(cid)).toBeNull();
  });

  it("refuses an unknown field key as a validation error", async () => {
    const owner = await freshUser("FieldsUnknown");
    const cid = await makeCatalogue(owner.userId, { kind: "collection" });

    const res = await patch(owner.cookies, cid, {
      artworkFields: { colours: false },
    });
    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("validation");
    // Nothing was written: the refusal is before the update.
    expect(await storedFields(cid)).toBeNull();
  });

  it("lets a collaborator change the fields, exactly as the owner does", async () => {
    const owner = await freshUser("FieldsCollabOwner");
    const mate = await freshUser("FieldsCollabMate");
    const cid = await makeCatalogue(owner.userId, { kind: "portfolio" });
    await db.insert(collaboratorsTable).values({
      catalogueId: cid,
      userId: mate.userId,
    });

    const saved = await patch(mate.cookies, cid, {
      artworkFields: { provenance: false },
    });
    expect(saved.status).toBe(200);
    expect((await json<Catalogue>(saved)).artworkFields).toEqual({
      provenance: false,
    });
    expect(await storedFields(cid)).toEqual({ provenance: false });
  });

  it("writes nothing extra when a Catalogue is created", async () => {
    const owner = await freshUser("FieldsCreate");
    // The create contract does not carry the key, so a body naming it is
    // dropped rather than stored: a new catalogue is its Kind's defaults.
    const created = await req("POST", "/api/v1/catalogues", {
      cookies: owner.cookies,
      body: {
        name: "Fresh wall",
        kind: "portfolio",
        artworkFields: { acquisitionPrice: true },
      },
    });
    expect(created.status).toBe(201);
    const body = await json<Catalogue>(created);
    expect(body).not.toHaveProperty("artworkFields");
    expect(await storedFields(body.id)).toBeNull();
  });
});
