// A catalogue's kind, over the wire: chosen at creation, carried on every read,
// and fixed afterwards. Driven in-process with app.request() against the real
// stack, where the Zod contract, the insert and the serializer meet.
//
// Each account here creates one catalogue through the API, so each kind gets
// its own fresh account.

import { describe, expect, it } from "vitest";
import { err, freshUser, json, req } from "./helpers/api";

/** The three kinds ADR-0010 names, each with its own fresh owner below. */
const CATALOGUE_KINDS = ["portfolio", "collection", "inventory"] as const;

interface WireCatalogue {
  id: string;
  name: string;
  kind: string;
}

const create = async (
  cookies: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  await req("POST", "/api/v1/catalogues", {
    cookies,
    body: JSON.stringify(body),
  });

describe("POST /catalogues with a kind", () => {
  it("records each kind and carries it on the create response and both reads", async () => {
    for (const kind of CATALOGUE_KINDS) {
      const owner = await freshUser("Kind");
      const created = await create(owner.cookies, {
        name: `${kind} catalogue`,
        kind,
      });
      expect(created.status).toBe(201);
      const body = await json<WireCatalogue>(created);
      expect(body.kind).toBe(kind);

      const single = await json<WireCatalogue>(
        await req("GET", `/api/v1/catalogues/${body.id}`, {
          cookies: owner.cookies,
        }),
      );
      expect(single.kind).toBe(kind);

      const list = await json<WireCatalogue[]>(
        await req("GET", "/api/v1/catalogues", { cookies: owner.cookies }),
      );
      expect(list.find((row) => row.id === body.id)?.kind).toBe(kind);
    }
  });

  it("defaults an absent kind to collection", async () => {
    const owner = await freshUser("KindDefault");
    const res = await create(owner.cookies, { name: "An older client" });
    expect(res.status).toBe(201);
    expect((await json<WireCatalogue>(res)).kind).toBe("collection");
  });

  it("refuses an unknown kind as a validation error", async () => {
    const owner = await freshUser("KindBad");
    const res = await create(owner.cookies, {
      name: "Not a kind",
      kind: "gallery",
    });
    expect(res.status).toBe(400);
    const body = await err(res);
    expect(body.code).toBe("validation");
    expect(body.fields?.kind).toBeTruthy();
  });
});

describe("PATCH /catalogues with a kind", () => {
  it("accepts a body naming the kind and leaves the stored kind unchanged", async () => {
    const owner = await freshUser("KindPatch");
    const created = await create(owner.cookies, {
      name: "Stays a portfolio",
      kind: "portfolio",
    });
    expect(created.status).toBe(201);
    const row = await json<WireCatalogue>(created);

    // The update schema does not carry `kind`, so the key is dropped before
    // the write. The request is still a successful no-op, not a refusal.
    const patched = await req("PATCH", `/api/v1/catalogues/${row.id}`, {
      cookies: owner.cookies,
      body: JSON.stringify({ kind: "inventory" }),
    });
    expect(patched.status).toBe(200);
    expect((await json<WireCatalogue>(patched)).kind).toBe("portfolio");

    const reread = await json<WireCatalogue>(
      await req("GET", `/api/v1/catalogues/${row.id}`, {
        cookies: owner.cookies,
      }),
    );
    expect(reread.kind).toBe("portfolio");
  });
});
